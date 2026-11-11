// Vercel Serverless Function: POST /api/notify-war-event
// Нагадування в Telegram про ключові події війни, щоб повертати гравців у гру:
//  • kind "start" — «Битва за місто почалась» (обом сторонам);
//  • kind "end"   — «Війну завершено»: місто захоплено / вистояло / перемир'я, а також «Країну знищено».
// Захист від зловживань:
//  • перевіряємо Telegram initData (HMAC);
//  • подія має справді відбутись у базі (стан війни читаємо з Supabase, а не з запиту);
//  • автор запиту належить до країни-учасниці цієї війни;
//  • на кожну подію розсилка лише раз (блокування warevt:<kind>:<id>).
// Потрібні змінні середовища Vercel: BOT_TOKEN, SUPABASE_SERVICE_KEY, (необов'язково) WEBAPP_URL.

import { verifyTelegramInitData } from "./_telegramAuth.js";
import { rateLimit, clientIp, SUPABASE_URL, serviceHeaders } from "./_security.js";

const PLAYER_PREFIX = "players:";
const TG_MAP_PREFIX = "tgmap:";
const WAR_PREFIX = "war:";
const MAX_AGE_MS = 30 * 60 * 1000;

async function sbGet(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value&limit=1`, { headers: serviceHeaders() });
  const rows = await res.json();
  return rows?.[0]?.value ?? null;
}

async function sbLock(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ key, value: String(Date.now()), shared: true }),
  });
  return res.ok;
}

async function allPlayers() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_store?key=like.${encodeURIComponent(PLAYER_PREFIX + "%")}&shared=eq.true&select=value&order=key.asc&limit=1000&offset=${from}`,
      { headers: serviceHeaders() }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) break;
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

const esc = (s) => String(s || "").slice(0, 40).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function messages(kind, war, names) {
  const city = esc(war.cityName);
  if (kind === "start") {
    const t = `⚔️ <b>Битва за ${city} почалась!</b>\n\nКліки гравців зараз йдуть на шкалу битви. Заходь і клікай!`;
    return { att: t, def: t };
  }
  const r = war.result || {};
  if (r.ceasefire) {
    const t = `🕊️ <b>Війна закінчилась перемир'ям</b>\n\nБитву за ${city} припинено, місто лишається в захисника. Кілька годин нападати не можна.`;
    return { att: t, def: t };
  }
  if (r.winner === war.attacker) {
    return {
      att: `🏴 <b>Місто ${city} захоплено!</b>\n\n${esc(names.att)} перемогли у війні. Заходь і подивись нові кордони.`,
      def: r.eliminated
        ? `☠️ <b>Країну знищено</b>\n\n${esc(names.def)} втратила всі міста й вибула з гри. Заходь у гру і обери нову країну.`
        : `💥 <b>Твоє місто ${city} захоплено</b>\n\nВійну завершено. Заходь у гру й готуйся повернути втрачене.`,
    };
  }
  return {
    att: `🛡 <b>Атака не вдалась</b>\n\nВійну завершено: ${esc(names.def)} відбили напад на ${city}.`,
    def: `🛡 <b>Місто ${city} вистояло!</b>\n\nВійну завершено, ворога відбито. Дякуємо за кліки!`,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(500).json({ error: "Сервер не налаштований" });
    return;
  }
  /* Адмін може вимкнути Telegram-сповіщення для всіх гравців (ключ cfg:tgnotify = "off") */
  try {
    const flag = await sbGet("cfg:tgnotify");
    if (String(flag || "").replace(/"/g, "") === "off") {
      res.status(200).json({ ok: true, disabled: true, sent: 0, total: 0 });
      return;
    }
  } catch {
    /* якщо прапорець не прочитався — діємо як зазвичай */
  }
  if (!rateLimit("notifyevt:" + clientIp(req), 20, 60_000)) {
    res.status(429).json({ error: "Забагато запитів" });
    return;
  }
  const { initData, warId, kind, attackerName, defenderName } = req.body || {};
  if (typeof warId !== "string" || !/^[\w-]{1,40}$/.test(warId) || (kind !== "start" && kind !== "end")) {
    res.status(400).json({ error: "Некоректний запит" });
    return;
  }
  const user = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!user) {
    res.status(401).json({ error: "Не вдалося підтвердити користувача" });
    return;
  }

  try {
    const warRaw = await sbGet(WAR_PREFIX + warId);
    const war = warRaw ? JSON.parse(warRaw) : null;
    if (!war) {
      res.status(400).json({ error: "Війну не знайдено" });
      return;
    }
    const now = Date.now();
    if (kind === "start") {
      if (war.status === "ended" || now < (war.prepEnd || Infinity) || now - (war.prepEnd || 0) > MAX_AGE_MS) {
        res.status(400).json({ error: "Битва ще не почалась або вже давно йде" });
        return;
      }
    } else if (war.status !== "ended" || !war.result || now - (war.result.endedAt || 0) > MAX_AGE_MS) {
      res.status(400).json({ error: "Війну не завершено або це давня подія" });
      return;
    }

    const attSide = [war.attacker, ...(war.attAllies || [])];
    const defSide = [war.defender, ...(war.defAllies || [])];
    const playerId = await sbGet(TG_MAP_PREFIX + user.id);
    const callerRaw = playerId ? await sbGet(PLAYER_PREFIX + playerId) : null;
    const caller = callerRaw ? JSON.parse(callerRaw) : null;
    if (!caller || ![...attSide, ...defSide].includes(caller.countryCode)) {
      res.status(403).json({ error: "Немає права сповіщати про цю війну" });
      return;
    }

    const lockKey = "warevt:" + kind + ":" + warId;
    if (!(await sbLock(lockKey))) {
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    const text = messages(kind, war, { att: attackerName || war.attacker, def: defenderName || war.defender });
    const players = await allPlayers();
    const targets = players
      .filter((p) => p.telegramId && !p.blocked && (attSide.includes(p.countryCode) || defSide.includes(p.countryCode)))
      .map((p) => ({ chat: p.telegramId, text: attSide.includes(p.countryCode) ? text.att : text.def }));

    const rawUrl = String(process.env.WEBAPP_URL || "").trim().replace(/^http:\/\//i, "https://");
    let replyMarkup;
    if (/^https:\/\//i.test(rawUrl)) {
      const isTme = /^https:\/\/(t\.me|telegram\.me)\//i.test(rawUrl);
      const btn = isTme ? { text: "🌍 Відкрити гру", url: rawUrl } : { text: "🌍 Відкрити гру", web_app: { url: rawUrl } };
      replyMarkup = { inline_keyboard: [[btn]] };
    }

    let sent = 0;
    for (let i = 0; i < targets.length; i += 25) {
      const results = await Promise.allSettled(
        targets.slice(i, i + 25).map((t) =>
          fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: t.chat, text: t.text, parse_mode: "HTML", reply_markup: replyMarkup }),
          }).then((r) => r.json())
        )
      );
      sent += results.filter((r) => r.status === "fulfilled" && r.value?.ok).length;
    }
    if (sent === 0 && targets.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(lockKey)}`, { method: "DELETE", headers: serviceHeaders() }).catch(() => null);
    }
    console.log("notify-war-event:", { warId, kind, sent, total: targets.length });
    res.status(200).json({ ok: true, sent, total: targets.length });
  } catch (err) {
    console.error("notify-war-event error:", err?.message || err);
    res.status(500).json({ error: "Помилка розсилки" });
  }
}
