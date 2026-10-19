// Vercel Serverless Function: POST /api/notify-war
// Коли країна оголошує війну, бот пише в Telegram усім гравцям обох країн-учасниць.
// Захист від зловживань:
//  • перевіряємо Telegram initData (HMAC);
//  • війна має реально існувати в базі, бути активною і свіжою (до 15 хв);
//  • автор запиту має належати до атакуючої сторони цієї війни;
//  • сповіщення на одну війну розсилається лише один раз (блокування warnotify:<id>).
// Потрібні змінні середовища Vercel: BOT_TOKEN, SUPABASE_SERVICE_KEY,
// (необов'язково) WEBAPP_URL — посилання на гру для кнопки «Відкрити гру».

import { verifyTelegramInitData } from "./_telegramAuth.js";

const SUPABASE_URL = "https://zrpwgavfploiaqrqpcvv.supabase.co";
const PLAYER_PREFIX = "players:";
const TG_MAP_PREFIX = "tgmap:";
const WAR_PREFIX = "war:";
const MAX_WAR_AGE_MS = 15 * 60 * 1000;

function headers(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    ...extra,
  };
}

async function sbGet(key) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: headers() }
  );
  const rows = await res.json();
  return rows?.[0]?.value ?? null;
}

/* true — блокування наше (перший запит); false — вже існує */
async function sbLock(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ key, value: String(Date.now()), shared: true }),
  });
  return res.ok;
}

async function allPlayers() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_store?key=like.${encodeURIComponent(PLAYER_PREFIX + "%")}&shared=eq.true&select=value`,
      { headers: headers({ Range: `${from}-${from + 999}` }) }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) break;
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.value));
      } catch {
        /* пропускаємо пошкоджені записи */
      }
    }
    if (rows.length < 1000) break;
  }
  return out;
}

const esc = (s) =>
  String(s || "").slice(0, 40).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  const { initData, warId, attackerName, defenderName } = req.body || {};
  const user = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!user || !warId) {
    res.status(401).json({ error: "Не вдалося підтвердити користувача" });
    return;
  }

  try {
    const warRaw = await sbGet(WAR_PREFIX + warId);
    const war = warRaw ? JSON.parse(warRaw) : null;
    if (!war || war.status === "ended" || Date.now() - (war.createdAt || 0) > MAX_WAR_AGE_MS) {
      res.status(400).json({ error: "Війну не знайдено або вона застаріла" });
      return;
    }

    const playerId = await sbGet(TG_MAP_PREFIX + user.id);
    const callerRaw = playerId ? await sbGet(PLAYER_PREFIX + playerId) : null;
    const caller = callerRaw ? JSON.parse(callerRaw) : null;
    if (!caller || !(caller.countryCode === war.attacker || (war.attAllies || []).includes(caller.countryCode))) {
      res.status(403).json({ error: "Немає права сповіщати про цю війну" });
      return;
    }

    if (!(await sbLock("warnotify:" + warId))) {
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    const players = await allPlayers();
    const city = esc(war.cityName);
    const textDef =
      `⚔️ <b>На вашу країну напали!</b>\n\n` +
      `${esc(attackerName) || "Ворожа країна"} оголосили війну ${esc(defenderName) || "вашій країні"}.\n` +
      `Битва за місто <b>${city}</b> почнеться через 10 хвилин і триватиме годину.\n\n` +
      `Заходь у гру та клікай, щоб захистити місто!`;
    const textAtt =
      `⚔️ <b>Ваша країна оголосила війну!</b>\n\n` +
      `${esc(attackerName) || "Ваша країна"} воюють проти ${esc(defenderName) || "ворога"}.\n` +
      `Битва за місто <b>${city}</b> почнеться через 10 хвилин і триватиме годину.\n\n` +
      `Заходь у гру та клікай, щоб захопити місто!`;
    const targets = players
      .filter((p) => p.telegramId && !p.blocked && (p.countryCode === war.defender || p.countryCode === war.attacker))
      .map((p) => ({ ...p, __text: p.countryCode === war.defender ? textDef : textAtt }));
    const replyMarkup = process.env.WEBAPP_URL
      ? { inline_keyboard: [[{ text: "🛡 Відкрити гру", web_app: { url: process.env.WEBAPP_URL } }]] }
      : undefined;

    let sent = 0;
    for (let i = 0; i < targets.length; i += 25) {
      const batch = targets.slice(i, i + 25);
      const results = await Promise.allSettled(
        batch.map((p) =>
          fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: p.telegramId, text: p.__text, parse_mode: "HTML", reply_markup: replyMarkup }),
          }).then((r) => r.json())
        )
      );
      sent += results.filter((r) => r.status === "fulfilled" && r.value?.ok).length;
    }
    res.status(200).json({ ok: true, sent, total: targets.length });
  } catch (err) {
    console.error("notify-war error:", err?.message || err);
    res.status(500).json({ error: "Помилка розсилки" });
  }
}
