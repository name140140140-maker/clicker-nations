// Банк країни і знищення вірусу: POST /api/game?action=bank  { initData, op, ... }
// Журнал bank:<країна>:<id>, cure:<пандемія>:<країна> і virussnap:<пандемія>:<країна> пише ЛИШЕ сервер (RLS закриває їх
// для анонімного запису), тому клієнт не може підробити внесок, зняти чужі кошти чи знищити вірус безкоштовно.
// Сервер сам перевіряє: підпис Telegram, країну гравця, лідера, баланс і вартість знищення (рахує ту саму модель пандемії).
//   op: "deposit" {amount} | "withdraw" {amount} (лише лідер) | "snaps" | "cure" {eventId, maxCost} (лише лідер)

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "../_security.js";
import { setPandemicState, countryStatus, pandemicEnd } from "../../src/pandemic.js";
import { allPandemics } from "../../src/worldEvents.js";
import { cureCost } from "../../src/cureCost.js";
import { adjustPower } from "./pwrStore.js";

const MAX_AMOUNT = 1e12;
const rest = (path) => `${SUPABASE_URL}/rest/v1/kv_store${path}`;
const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
const enc = encodeURIComponent;

async function sbGet(key) {
  const res = await fetch(rest(`?key=eq.${enc(key)}&select=value&limit=1`), { headers: serviceHeaders() });
  const rows = res.ok ? await res.json().catch(() => null) : null;
  return Array.isArray(rows) && rows[0] ? rows[0].value : null;
}
async function sbList(prefix) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(rest(`?key=like.${enc(prefix + "%")}&select=key,value&order=key.asc&limit=1000&offset=${from}`), { headers: serviceHeaders() });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return null;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
/* "ok" | "exists" | "error" — без перезапису існуючого ключа */
async function sbInsert(key, value) {
  const res = await fetch(rest(""), {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ key, value, shared: true }),
  });
  if (res.ok) return "ok";
  return res.status === 409 ? "exists" : "error";
}
async function sbUpsert(key, value) {
  await fetch(rest("?on_conflict=key"), {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ key, value, shared: true }),
  }).catch(() => null);
}
async function sbDelete(key) {
  await fetch(rest(`?key=eq.${enc(key)}`), { method: "DELETE", headers: serviceHeaders() }).catch(() => null);
}

/* Баланс банку країни за журналом */
async function balanceOf(code) {
  const rows = await sbList("bank:" + code + ":");
  if (!rows) return null;
  let b = 0;
  for (const r of rows) {
    const v = parse(r.value);
    if (!v || !(Number(v.a) > 0)) continue;
    if (v.t === "dep") b += Math.floor(Number(v.a));
    else if (v.t === "wd" || v.t === "cure") b -= Math.floor(Number(v.a));
  }
  return b;
}
async function addEntry(code, t, player, a, extra = {}) {
  const key = "bank:" + code + ":" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const ok = (await sbInsert(key, JSON.stringify({ t, p: player.id, n: player.username || "", a: Math.floor(a), ts: Date.now(), ...extra }))) === "ok";
  return ok ? key : null;
}

/* Модель пандемій на сервері: ті самі закриті кордони, налаштування адміна й знищені віруси, що й у гравців */
async function loadSim() {
  const [cfgRaw, dips, cures] = await Promise.all([sbGet("cfg:pandemic"), sbList("dip:border:"), sbList("cure:")]);
  if (!dips || !cures) return false;
  const borders = dips.map((r) => parse(r.value)).filter((v) => v && v.kind === "border");
  const cl = cures.map((r) => parse(r.value)).filter((v) => v && v.id && v.code && Number(v.ts));
  setPandemicState({ borders, cfg: parse(cfgRaw) || null, cures: cl });
  return true;
}

/* Знімок Power країни на момент появи вірусу: лише сервер, один раз */
async function ensureSnap(eventId, code) {
  const key = "virussnap:" + eventId + ":" + code;
  const have = parse(await sbGet(key));
  if (have && Number(have.power) >= 0) return Number(have.power);
  let power = 0;
  const pw = await sbList("pwr:");
  const pwMap = new Map();
  for (const r of pw || []) { const v = parse(r.value); if (v && Number.isFinite(v.p)) pwMap.set(r.key.slice(4), v.p); }
  const pl = await sbList("players:");
  if (!pl) return null;
  for (const r of pl) {
    const p = parse(r.value);
    if (!p || p.countryCode !== code) continue;
    power += Math.max(0, pwMap.has(p.id) ? pwMap.get(p.id) : Number(p.power) || 0);
  }
  power = Math.round(power);
  await sbInsert(key, JSON.stringify({ power, ts: Date.now() }));
  const again = parse(await sbGet(key));
  return again && Number(again.power) >= 0 ? Number(again.power) : power;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("bank:" + clientIp(req), 40, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const { initData, op, eventId } = req.body || {};
  const user = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!user) return fail(res, 401, "Не вдалося підтвердити користувача");
  const amount = Math.floor(Number((req.body || {}).amount));
  const maxCost = Number((req.body || {}).maxCost);

  try {
    const playerId = await sbGet("tgmap:" + user.id);
    const player = playerId ? parse(await sbGet("players:" + playerId)) : null;
    if (!player || !player.id || !/^[A-Z]{2}$/.test(String(player.countryCode || ""))) return fail(res, 403, "Гравця не знайдено");
    const code = player.countryCode;
    if (!rateLimit("bank-p:" + player.id, 12, 60_000)) return fail(res, 429, "Забагато операцій, зачекай хвилину");

    /* Лідер — лише за серверним ключем leader:<країна> (анонімний запис у нього закритий) */
    const isLeader = async () => (await sbGet("leader:" + code)) === player.id;
    const leaderFail = () => fail(res, 403, "Це може лише лідер країни");
    const money = () => Number.isFinite(amount) && amount >= 1 && amount <= MAX_AMOUNT;

    if (op === "deposit") {
      if (!money()) return fail(res, 400, "Вкажи суму");
      if (!rateLimit("bank-dep:" + player.id, 1, 1_500)) return fail(res, 429, "Не так швидко");
      /* Спершу списуємо Power на сервері, потім пишемо внесок; якщо запис не вдався, Power повертається */
      const taken = await adjustPower(player.id, -amount, player);
      if (!taken.ok) return fail(res, 400, taken.error);
      if (!(await addEntry(code, "dep", player, amount))) {
        await adjustPower(player.id, amount, player);
        return fail(res, 500, "Не вдалося записати внесок");
      }
      return res.status(200).json({ ok: true, balance: await balanceOf(code), power: taken.st.p });
    }

    if (op === "withdraw") {
      if (!money()) return fail(res, 400, "Вкажи суму");
      if (!(await isLeader())) return leaderFail();
      const before = await balanceOf(code);
      if (before === null) return fail(res, 500, "Помилка бази");
      if (amount > before) return fail(res, 400, "У банку менше, ніж ти хочеш зняти");
      const key = await addEntry(code, "wd", player, amount);
      if (!key) return fail(res, 500, "Не вдалося записати зняття");
      /* Перевірка після запису: якщо паралельний запит уже забрав кошти, скасовуємо своє зняття */
      const after = await balanceOf(code);
      if (after === null || after < 0) {
        await sbDelete(key);
        return fail(res, 409, "Баланс змінився, спробуй ще раз");
      }
      const got = await adjustPower(player.id, amount, player);
      if (!got.ok) {
        await sbDelete(key);
        return fail(res, 500, "Не вдалося нарахувати Power, зняття скасовано");
      }
      return res.status(200).json({ ok: true, balance: after, power: got.st.p });
    }

    if (op === "snaps" || op === "cure") {
      if (!(await loadSim())) return fail(res, 500, "Помилка бази");
      const now = Date.now();
      const sick = allPandemics(now).filter((e) => {
        const st = countryStatus(e, code, now);
        return st && st.arrived && !st.cured && pandemicEnd(e) > now;
      });

      if (op === "snaps") {
        const snaps = {};
        for (const e of sick) {
          const s = await ensureSnap(e.id, code);
          if (s !== null) snaps[e.id] = s;
        }
        return res.status(200).json({ ok: true, snaps });
      }

      if (!(await isLeader())) return leaderFail();
      const e = sick.find((x) => x.id === eventId);
      if (!e) return fail(res, 400, "Цей вірус у вашій країні вже не діє");
      const snap = await ensureSnap(e.id, code);
      if (snap === null) return fail(res, 500, "Помилка бази");
      const st = countryStatus(e, code, now);
      const cost = cureCost(snap, st.infected, st.deaths).total;
      if (Number.isFinite(maxCost) && cost > maxCost * 1.05 + 1) return fail(res, 409, `Ціна змінилась: тепер ${cost} Power. Оновіть екран`);
      const before = await balanceOf(code);
      if (before === null) return fail(res, 500, "Помилка бази");
      if (before < cost) return fail(res, 400, "У банку недостатньо Power");
      const ck = "cure:" + e.id + ":" + code;
      const lock = await sbInsert(ck, JSON.stringify({ id: e.id, code, ts: now, by: player.id, cost }));
      if (lock === "exists") return fail(res, 409, "Вірус уже знищено");
      if (lock !== "ok") return fail(res, 500, "Не вдалося записати результат");
      const bk = await addEntry(code, "cure", player, cost, { ev: e.id });
      const after = bk ? await balanceOf(code) : null;
      if (!bk || after === null || after < 0) {
        if (bk) await sbDelete(bk);
        await sbDelete(ck);
        return fail(res, 409, "Баланс змінився, спробуй ще раз");
      }
      return res.status(200).json({ ok: true, ts: now, cost, balance: after, disease: e.disease });
    }

    return fail(res, 400, "Невідома дія");
  } catch (err) {
    console.error("bank error:", err?.message || err);
    fail(res, 500, "Помилка сервера");
  }
}
