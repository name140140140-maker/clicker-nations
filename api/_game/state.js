// Загальний стан гри, пошта й журнал оновлень на сервері.
// POST /api/game?action=state  { initData, op, ... }
// Ключі game-state, mail:*, changelog, seasonend:* закриті для анонімного запису (RLS): технічні роботи, новини,
// сезон і пошту змінює лише цей обробник, який перевіряє Telegram-підпис і права.

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, fail } from "../_security.js";
import { sbGet, sbList, getJson, sbInsert, sbUpsert, parse, casJson, addNews, addMail, loadPlayers, leaderOf } from "./kv.js";
import { PASS_REV } from "../../src/progressData.js";
import { publicPlayer } from "./publicPlayer.js";

/* Короткий кеш знімка гравців у пам'яті інстансу (щоб 16 → 10 000 гравців не множили читання бази) */
const SNAP_TTL_MS = 5000;
let snapCache = { ts: 0, list: null };

const DAY = 24 * 3600 * 1000;
const SEASON_DAYS = 50;
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
const NEWS_ID = () => "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function patchState(fn) {
  return casJson("game-state", (st) => ({ ...(st || {}), ...fn(st || {}) }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("state:" + clientIp(req), 90, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");
  const b = req.body || {};
  const user = verifyTelegramInitData(b.initData, BOT_TOKEN);
  if (!user) return fail(res, 401, "Не вдалося підтвердити користувача");
  const tg = String(user.id);
  const isAdmin = adminIds().includes(tg);
  const ok = (extra = {}) => res.status(200).json({ ok: true, ...extra });

  try {
    const pid = await sbGet("tgmap:" + tg);
    const me = pid ? parse(await sbGet("players:" + pid)) : null;
    if (!me || me.id !== pid) return fail(res, 403, "Гравця не знайдено");
    if (me.blocked) return fail(res, 403, "Гравця заблоковано");
    if (!rateLimit("state-p:" + pid, 40, 60_000)) return fail(res, 429, "Забагато дій, зачекай хвилину");
    const op = b.op;
    const needAdmin = () => (isAdmin ? false : (fail(res, 403, "Недостатньо прав"), true));

    /* ===== Сезон: перший, хто зайшов після скидання, запускає відлік ===== */
    if (op === "ensure-season") {
      let started = null;
      let result = null;
      await patchState((st) => {
        const season = st.season || { seasonNumber: 1, durationDays: SEASON_DAYS, startedAt: null, rev: PASS_REV };
        if (season.startedAt && season.rev === PASS_REV) { result = season; return {}; }
        started = { seasonNumber: season.seasonNumber || 1, durationDays: SEASON_DAYS, startedAt: Date.now(), rev: PASS_REV };
        result = started;
        return { season: started };
      });
      if (started) await addNews(`🏆 Стартував сезон ${started.seasonNumber}: ${started.durationDays} днів боротьби та нагород Battle Pass.`);
      return ok({ season: result });
    }
    /* Час сезону вийшов: один раз надсилаємо адміну лист (карта скидається лише вручну) */
    if (op === "season-end-check") {
      const gs = await getJson("game-state");
      const season = gs?.season;
      if (!season?.startedAt || Date.now() < season.startedAt + (season.durationDays || SEASON_DAYS) * DAY) return ok();
      const n = season.seasonNumber || 1;
      const lock = await sbInsert("seasonend:" + n, String(Date.now()));
      if (lock !== "ok") return ok();
      for (const a of adminIds()) {
        const apid = await sbGet("tgmap:" + a);
        if (apid) await addMail(apid, { type: "admin", from: "admin", subject: `Сезон ${n} завершився`, body: `Час сезону ${n} вийшов. Карта сама не скидається: зайди в Налаштування → Адмін-панель → «Кінець сезону», натисни «Скинути карту» і підтверди. Гравці отримають нагороди за місце своєї країни в рейтингу, а карта стане стартовою.` });
      }
      return ok();
    }
    /* Новина про першого гравця-лідера країни (лише про власну країну й лише справжнього лідера) */
    if (op === "news-leader") {
      const code = String(b.code || "");
      if (code !== me.countryCode || (await leaderOf(code)) !== pid) return fail(res, 403, "Недоступно");
      const lock = await sbInsert("leadernews:" + code, String(Date.now()));
      if (lock !== "ok") return ok();
      let name = code;
      try { name = new Intl.DisplayNames(["uk"], { type: "region" }).of(code) || code; } catch { /* код */ }
      await addNews(`🌍 ${name} має першого гравця й лідера.`);
      return ok();
    }

    /* ===== Пошта: гравець керує лише власною скринькою ===== */
    if (op === "mail-add") {
      if (!rateLimit("mail-add:" + pid, 12, 60_000)) return fail(res, 429, "Забагато листів");
      await addMail(pid, { type: "info", subject: clean(b.subject, 80) || "Повідомлення", body: clean(b.body, 1000) });
      return ok();
    }
    if (op === "mail-resolve") {
      const id = String(b.id || ""), resolved = ["accepted", "declined", "stale"].includes(b.resolved) ? b.resolved : "stale";
      const good = await casJson("mail:" + pid, (list) => (Array.isArray(list) ? list : []).map((m) => (m.id === id ? { ...m, read: true, resolved, resolvedNote: clean(b.note, 200) } : m)));
      return good ? ok() : fail(res, 500, "Не вдалося зберегти");
    }
    if (op === "mail-read" || op === "mail-delete" || op === "mail-clear") {
      const id = String(b.id || "");
      const good = await casJson("mail:" + pid, (list) => {
        const l = Array.isArray(list) ? list : [];
        if (op === "mail-clear") return [];
        if (op === "mail-delete") return l.filter((m) => m.id !== id);
        return l.map((m) => (b.all || m.id === id ? { ...m, read: true } : m));
      });
      return good ? ok() : fail(res, 500, "Не вдалося зберегти");
    }

    /* ===== Лише читання: усі гравці одним запитом (замість N+1 з клієнта) =====
       Віддає ЛИШЕ білий список публічних полів (див. publicPlayer). Ніколи не віддає: telegramId (крім адміна),
       пошту, tgmap, leader-токени, енергію, upg, прогрес Battle Pass, причини блокувань. Стан не змінює. */
    if (op === "players-snapshot") {
      if (!rateLimit("snap:" + pid, 20, 60_000)) return fail(res, 429, "Забагато запитів");
      const now = Date.now();
      if (!snapCache.list || now - snapCache.ts > SNAP_TTL_MS) {
        const [prow, wrow] = await Promise.all([sbList("players:"), sbList("pwr:")]);
        if (!prow) return fail(res, 502, "База недоступна");
        const pw = {};
        for (const r of wrow || []) {
          const v = parse(r.value);
          if (v && Number.isFinite(v.p)) pw[String(r.key).slice(4)] = v.p;
        }
        const list = [];
        for (const r of prow) {
          const rec = parse(r.value);
          if (rec && rec.id) list.push({ rec, power: pw[rec.id] });
        }
        snapCache = { ts: now, list };
      }
      const players = snapCache.list.map(({ rec, power }) => publicPlayer(rec, power, isAdmin));
      return ok({ players, ts: snapCache.ts });
    }

    /* ===== Адмін ===== */
    if (op === "maintenance") {
      if (needAdmin()) return;
      const maintenance = { enabled: !!b.enabled, message: clean(b.message, 300) };
      await patchState(() => ({ maintenance }));
      return ok({ maintenance });
    }
    if (op === "season-date") {
      if (needAdmin()) return;
      const startedAt = Number(b.startedAt), durationDays = Math.floor(Number(b.durationDays));
      if (!(durationDays >= 1 && durationDays <= 400) || !(startedAt > 0)) return fail(res, 400, "Невірні дані");
      await patchState((st) => ({ season: { ...(st.season || {}), startedAt, durationDays } }));
      return ok();
    }
    if (op === "news-admin") {
      if (needAdmin()) return;
      const text = clean(b.text, 400);
      if (!text) return fail(res, 400, "Порожній текст");
      await addNews(text, { admin: true });
      return ok();
    }
    if (op === "mail-admin") {
      if (needAdmin()) return;
      const ids = Array.isArray(b.playerIds) ? b.playerIds.map(String).filter((x) => /^[\w-]{3,64}$/.test(x)).slice(0, 2000) : [];
      if (!ids.length) return fail(res, 400, "Немає отримувачів");
      const subject = clean(b.subject, 80) || "Повідомлення від адміністрації", body = clean(b.body, 1000);
      let sent = 0;
      for (const id of ids) { try { await addMail(id, { type: "admin", from: "admin", subject, body }); sent++; } catch { /* далі */ } }
      return ok({ sent });
    }
    if (op === "changelog") {
      if (needAdmin()) return;
      const list = Array.isArray(b.list) ? b.list.slice(0, 200).map((e) => ({ id: clean(e.id, 40), date: clean(e.date, 20), title: clean(e.title, 120), text: clean(e.text, 2000), ts: Number(e.ts) || Date.now() })) : null;
      if (!list) return fail(res, 400, "Невірні дані");
      await sbUpsert("changelog", JSON.stringify(list));
      return ok();
    }
    if (op === "reset-state") {
      if (needAdmin()) return;
      await patchState(() => ({ wars: [], alliances: [], allianceRequests: [], cityControl: {} }));
      return ok();
    }

    return fail(res, 400, "Невідома дія");
  } catch (err) {
    console.error("state error:", err?.message || err);
    fail(res, 500, "Помилка сервера");
  }
}
