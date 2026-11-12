// Vercel Serverless Function: POST /api/admin-season-reset
// Завершення сезону вручну адміном: нагороди за місце країни в рейтингу + скидання карти.
// Лише адмін (перевірка підпису Telegram initData і ADMIN_TELEGRAM_IDS). Робиться на сервері,
// бо анонімний ключ клієнта не має права видаляти записи (supabase/hardening.sql).
//
// Що відбувається:
//  1. Рейтинг країн за сумою Power гравців. Гравці країн топ-20 (з Power > 0) отримують Points:
//     запис seasonrew:<playerId>, який клієнт гравця забирає при наступному вході й пише лист.
//  2. Карта скидається до стартової: видаляються terr:*, cityown:*, citydef:*, війни, дипломатія,
//     кулдауни. Гравці, країни, лідери й прогрес гравців лишаються.
//  3. Сезон збільшується на 1 і відлік 50 днів іде спочатку; результати пишуться в seasonHistory.
// Повторний запит із тим самим номером сезону відхиляється (захист від подвійного кліку).

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "../_security.js";

const GAME_STATE_KEY = "game-state";
const WIPE_PREFIXES = ["terr:", "cityown:", "citydef:", "war:", "warc:", "warcd:", "warend:", "warevt:", "mapevt:", "dip:", "capcd:"];
const REWARDS = [50000, 30000, 20000, 12000, 12000, 7000, 7000, 7000, 7000, 7000]; // місця 1–10
const REWARD_11_20 = 3000;

const rewardFor = (rank) => (rank <= 10 ? REWARDS[rank - 1] : rank <= 20 ? REWARD_11_20 : 0);

async function sbGet(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value&limit=1`, { headers: serviceHeaders() });
  const rows = await res.json();
  return rows?.[0]?.value ?? null;
}

async function sbUpsert(key, value) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?on_conflict=key`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(Array.isArray(key) ? key : { key, value, shared: true }),
  });
  return res.ok;
}

async function sbLock(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ key, value: String(Date.now()), shared: true }),
  });
  return res.ok;
}

async function sbDeletePrefix(prefix) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=like.${encodeURIComponent(prefix + "*")}`, {
    method: "DELETE",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
  });
  return res.ok;
}

async function allPlayers() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_store?key=like.${encodeURIComponent("players:*")}&shared=eq.true&select=value&order=key.asc&limit=1000&offset=${from}`,
      { headers: serviceHeaders() }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("players read failed");
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.value));
      } catch {
        /* пошкоджений запис */
      }
    }
    if (rows.length < 1000) break;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("admin-season:" + clientIp(req), 5, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const { initData, seasonNumber, confirm } = req.body || {};
  const user = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!user || !adminIds().includes(String(user.id))) return fail(res, 403, "Недостатньо прав");
  if (confirm !== true) return fail(res, 400, "Потрібне підтвердження");

  try {
    const stateRaw = await sbGet(GAME_STATE_KEY);
    const state = stateRaw ? JSON.parse(stateRaw) : {};
    const season = state.season || {};
    const n = Number(season.seasonNumber) || 1;
    if (Number(seasonNumber) !== n) return fail(res, 409, "Сезон уже змінився. Онови адмін-панель");
    if (!(await sbLock("seasonreset:" + n))) return fail(res, 409, "Цей сезон уже завершено");

    /* 1. Рейтинг країн і нагороди */
    const players = await allPlayers();
    const power = {};
    for (const p of players) if (p.countryCode) power[p.countryCode] = (power[p.countryCode] || 0) + (p.power || 0);
    const ranked = Object.entries(power)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([code, v], i) => ({ code, power: v, rank: i + 1 }));
    const rankOf = Object.fromEntries(ranked.map((r) => [r.code, r.rank]));
    const rows = [];
    for (const p of players) {
      const rank = rankOf[p.countryCode];
      const points = rank ? rewardFor(rank) : 0;
      if (!p.id || !points || !((p.power || 0) > 0)) continue;
      rows.push({ key: "seasonrew:" + p.id, value: JSON.stringify({ season: n, points, rank, countryCode: p.countryCode, claimed: false }), shared: true });
    }
    for (let i = 0; i < rows.length; i += 200) await sbUpsert(rows.slice(i, i + 200));

    /* 2. Скидання карти */
    const wiped = [];
    for (const prefix of WIPE_PREFIXES) wiped.push(await sbDeletePrefix(prefix));
    if (wiped.some((ok) => !ok)) console.error("admin-season-reset: частину ключів не вдалося видалити", wiped);

    /* 3. Новий сезон і історія */
    const history = [...(state.seasonHistory || []), { season: n, endedAt: Date.now(), top: ranked.slice(0, 10) }].slice(-20);
    const next = {
      ...state,
      wars: [],
      alliances: [],
      allianceRequests: [],
      seasonHistory: history,
      season: { ...season, seasonNumber: n + 1, durationDays: season.durationDays || 50, startedAt: Date.now() },
    };
    await sbUpsert(GAME_STATE_KEY, JSON.stringify(next));

    res.status(200).json({ ok: true, newSeason: n + 1, rewarded: rows.length, top: ranked.slice(0, 3), wipeOk: wiped.every(Boolean) });
  } catch (err) {
    console.error("admin-season-reset error:", err?.message || err);
    fail(res, 500, "Помилка сервера");
  }
}
