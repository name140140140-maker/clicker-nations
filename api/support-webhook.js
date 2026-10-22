// Vercel Serverless Function: POST /api/support-webhook
// Бот підтримки World Clicker (окремий бот). Схема:
//  • гравець пише боту в приват → бот створює для нього ТЕМУ (гілку) у групі підтримки
//    (супергрупа з увімкненими Topics) і копіює туди повідомлення;
//  • адмін відповідає всередині теми → бот копіює відповідь гравцеві;
//  • /close в темі закриває звернення; після 4 годин без активності воно закривається саме;
//  • нове повідомлення гравця знову відкриває ту саму тему.
//
// Змінні середовища Vercel:
//   SUPPORT_BOT_TOKEN       — токен бота підтримки (BotFather)
//   SUPPORT_CHAT_ID         — ID групи підтримки (число, зазвичай починається з -100)
//   SUPPORT_WEBHOOK_SECRET  — довільний секрет (літери/цифри/_/-), перевіряється на вебхуку
//   SUPABASE_SERVICE_KEY    — вже є (використовується й для оплати)
//
// Стан зберігається в Supabase kv_store (shared):
//   support:user:<tgId>   → { threadId, status, lastAt, name, rl }
//   support:thread:<id>   → <tgId>

const SUPABASE_URL = "https://zrpwgavfploiaqrqpcvv.supabase.co";
const USER_PREFIX = "support:user:";
const THREAD_PREFIX = "support:thread:";
const TG_MAP_PREFIX = "tgmap:";
const PLAYER_PREFIX = "players:";
export const INACTIVE_MS = 4 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 15;

const sbHeaders = (extra = {}) => ({
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  ...extra,
});

async function sbGet(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`, { headers: sbHeaders() });
  const rows = await res.json();
  return rows?.[0]?.value ?? null;
}

async function sbSet(key, value) {
  // upsert: спершу оновлюємо, якщо запису немає — вставляємо
  const body = JSON.stringify({ value: typeof value === "string" ? value : JSON.stringify(value) });
  const patch = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body,
  });
  const rows = patch.ok ? await patch.json().catch(() => []) : [];
  if (Array.isArray(rows) && rows.length > 0) return true;
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ key, value: typeof value === "string" ? value : JSON.stringify(value), shared: true }),
  });
  return ins.ok;
}

async function getJson(key) {
  const raw = await sbGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tg(method, params) {
  return fetch(`https://api.telegram.org/bot${process.env.SUPPORT_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
    .then((r) => r.json())
    .catch((e) => ({ ok: false, description: String(e) }));
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Інформація про гравця з гри (за Telegram ID) — для шапки теми */
async function playerInfo(tgId) {
  try {
    const pid = await sbGet(TG_MAP_PREFIX + tgId);
    if (!pid) return null;
    return await getJson(PLAYER_PREFIX + pid);
  } catch {
    return null;
  }
}

async function openThreadFor(user, from) {
  const chatId = process.env.SUPPORT_CHAT_ID;
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "Гравець";
  const topicName = `${name} · ${user}`.slice(0, 120);
  const created = await tg("createForumTopic", { chat_id: chatId, name: topicName });
  if (!created.ok) return { error: created.description || "createForumTopic failed" };
  const threadId = created.result.message_thread_id;
  const p = await playerInfo(user);
  const lines = [
    `🆕 <b>Нове звернення</b>`,
    `👤 ${esc(name)}${from.username ? " (@" + esc(from.username) + ")" : ""}`,
    `🆔 Telegram ID: <code>${user}</code>`,
  ];
  if (p) {
    lines.push(`🎮 Нік у грі: <b>${esc(p.username)}</b>`);
    lines.push(`🌍 Країна: ${esc(p.countryCode || "—")} · ⚡ Power: ${Math.round(p.power || 0)} · 👆 Кліки: ${Math.round(p.totalClicks || 0)}`);
    lines.push(`💎 Premium: ${p.hasPremiumPass ? "так" : "ні"}${p.blocked ? " · ⛔ заблокований" : ""}`);
  } else {
    lines.push("🎮 Гравця в базі гри не знайдено (не відкривав гру або ID не збігається).");
  }
  lines.push("", "Відповідай у цій темі — відповідь піде гравцеві. <code>/close</code> — закрити звернення.");
  await tg("sendMessage", { chat_id: chatId, message_thread_id: threadId, text: lines.join("\n"), parse_mode: "HTML" });
  await sbSet(THREAD_PREFIX + threadId, String(user));
  return { threadId, name };
}

async function handleUserMessage(msg) {
  const chatId = process.env.SUPPORT_CHAT_ID;
  const from = msg.from;
  const user = String(from.id);
  const text = msg.text || "";

  if (text.startsWith("/start")) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text:
        "👋 Привіт! Це підтримка гри World Clicker.\n\n" +
        "Напиши сюди свою проблему або питання (можна додати скріншот) — ми відповімо тут же.\n" +
        "Постарайся описати: що сталося, на якому розділі гри й що очікував побачити.",
    });
    return;
  }
  if (text.startsWith("/")) return; // інші команди ігноруємо

  let rec = (await getJson(USER_PREFIX + user)) || {};
  const now = Date.now();

  // Захист від спаму: не більше RATE_MAX повідомлень на хвилину
  const rl = rec.rl && now - rec.rl.w < RATE_WINDOW_MS ? rec.rl : { w: now, n: 0 };
  rl.n += 1;
  if (rl.n > RATE_MAX) {
    if (rl.n === RATE_MAX + 1) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "⏳ Забагато повідомлень за короткий час. Зачекай хвилину." });
      await sbSet(USER_PREFIX + user, { ...rec, rl });
    }
    return;
  }

  let justOpened = false;
  if (rec.threadId && rec.status === "open") {
    // тема вже відкрита — просто пересилаємо
  } else if (rec.threadId && rec.status === "closed") {
    const re = await tg("reopenForumTopic", { chat_id: chatId, message_thread_id: rec.threadId });
    if (re.ok || /TOPIC_NOT_MODIFIED/i.test(re.description || "")) {
      rec.status = "open";
      justOpened = true;
    } else {
      rec = {}; // тему видалено — створимо нову
    }
  }
  if (!rec.threadId) {
    const created = await openThreadFor(user, from);
    if (created.error) {
      console.error("support: не вдалося створити тему:", created.error);
      await tg("sendMessage", { chat_id: msg.chat.id, text: "⚠️ Підтримка тимчасово недоступна. Спробуй, будь ласка, трохи пізніше." });
      return;
    }
    rec = { threadId: created.threadId, status: "open", name: created.name };
    justOpened = true;
  }

  const copied = await tg("copyMessage", {
    chat_id: chatId,
    from_chat_id: msg.chat.id,
    message_id: msg.message_id,
    message_thread_id: rec.threadId,
  });
  if (!copied.ok) {
    // тема могла бути видалена вручну — створюємо нову й пробуємо ще раз
    const created = await openThreadFor(user, from);
    if (created.error) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "⚠️ Не вдалося передати повідомлення. Спробуй пізніше." });
      return;
    }
    rec = { threadId: created.threadId, status: "open", name: created.name };
    justOpened = true;
    await tg("copyMessage", { chat_id: chatId, from_chat_id: msg.chat.id, message_id: msg.message_id, message_thread_id: rec.threadId });
  }

  rec.lastAt = now;
  rec.rl = rl;
  await sbSet(USER_PREFIX + user, rec);
  if (justOpened) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: "✅ Повідомлення передано в підтримку. Відповімо тут, щойно зможемо. Можеш дописати подробиці." });
  }
}

async function closeThread(threadId, userId, { notifyText } = {}) {
  const chatId = process.env.SUPPORT_CHAT_ID;
  await tg("closeForumTopic", { chat_id: chatId, message_thread_id: threadId });
  const rec = (await getJson(USER_PREFIX + userId)) || {};
  await sbSet(USER_PREFIX + userId, { ...rec, status: "closed", lastAt: Date.now() });
  if (notifyText) await tg("sendMessage", { chat_id: userId, text: notifyText });
}

async function handleGroupMessage(msg) {
  const threadId = msg.message_thread_id;
  if (!threadId) return; // загальна тема — ігноруємо
  if (msg.from?.is_bot) return;
  // службові повідомлення (створення/закриття теми тощо) не пересилаємо
  if (msg.forum_topic_created || msg.forum_topic_closed || msg.forum_topic_reopened || msg.forum_topic_edited || msg.pinned_message) return;

  const userId = await sbGet(THREAD_PREFIX + threadId);
  if (!userId) return;
  const text = msg.text || "";

  if (/^\/close(@\w+)?(\s|$)/.test(text)) {
    await closeThread(threadId, userId, {
      notifyText: "✅ Звернення закрито. Якщо проблема лишилась — просто напиши нове повідомлення.",
    });
    return;
  }
  if (text.startsWith("/")) return;

  const res = await tg("copyMessage", { chat_id: userId, from_chat_id: msg.chat.id, message_id: msg.message_id });
  if (!res.ok) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      message_thread_id: threadId,
      text: "⚠️ Не вдалося доставити: " + (res.description || "невідома помилка") + " (гравець міг заблокувати бота).",
    });
    return;
  }
  const rec = (await getJson(USER_PREFIX + userId)) || {};
  await sbSet(USER_PREFIX + userId, { ...rec, status: "open", lastAt: Date.now() });
}

/* Закриває теми, у яких не було активності понад 4 години */
export async function sweepInactive() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/kv_store?key=like.${encodeURIComponent(USER_PREFIX + "%")}&shared=eq.true&select=key,value&limit=1000`,
    { headers: sbHeaders() }
  );
  const rows = await res.json();
  if (!Array.isArray(rows)) return 0;
  let closed = 0;
  const now = Date.now();
  for (const row of rows) {
    try {
      const rec = JSON.parse(row.value);
      if (rec.status === "open" && rec.threadId && now - (rec.lastAt || 0) > INACTIVE_MS) {
        const userId = row.key.slice(USER_PREFIX.length);
        await closeThread(rec.threadId, userId, {
          notifyText: "🕓 Звернення автоматично закрито через відсутність активності. Якщо потрібна допомога — напиши нове повідомлення.",
        });
        closed++;
      }
    } catch {
      /* пропускаємо пошкоджені записи */
    }
  }
  return closed;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }
  const secret = process.env.SUPPORT_WEBHOOK_SECRET;
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    res.status(401).send("unauthorized");
    return;
  }
  if (!process.env.SUPPORT_BOT_TOKEN || !process.env.SUPPORT_CHAT_ID || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("support-webhook: не задано SUPPORT_BOT_TOKEN / SUPPORT_CHAT_ID / SUPABASE_SERVICE_KEY");
    res.status(200).send("ok");
    return;
  }

  try {
    const msg = (req.body || {}).message;
    if (msg) {
      if (String(msg.chat?.id) === String(process.env.SUPPORT_CHAT_ID)) await handleGroupMessage(msg);
      else if (msg.chat?.type === "private" && msg.from && !msg.from.is_bot) await handleUserMessage(msg);
    }
    await sweepInactive().catch((e) => console.warn("support sweep:", e?.message || e));
  } catch (err) {
    console.error("support-webhook error:", err?.message || err);
  }
  res.status(200).send("ok");
}
