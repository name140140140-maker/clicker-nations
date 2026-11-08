// Vercel Serverless Function: POST /api/drone-share
// Дозволяє поділитися відеоповтором удару дроном у Telegram (відео доходить саме як відео).
//  1) {action:"init"}  — перевіряє Telegram initData і видає одноразові підписані посилання
//     для завантаження відео та прев'ю у Supabase Storage (бакет "drone-replays").
//     Відео вантажиться напряму з телефона в сховище, тому ліміт 4.5 МБ Vercel не заважає.
//  2) {action:"send"}  — створює «підготовлене повідомлення» (savePreparedInlineMessage) для
//     вікна вибору чату в Telegram. Якщо воно недоступне — бот надсилає відео користувачу в особистий чат.
// Потрібні змінні Vercel: BOT_TOKEN, SUPABASE_SERVICE_KEY.

import crypto from "crypto";
import { verifyTelegramInitData } from "./_telegramAuth.js";
import { rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "./_security.js";

const BUCKET = "drone-replays";
const MIME_EXT = { "video/mp4": "mp4", "video/webm": "webm" };

async function signedUpload(path) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", "x-upsert": "true" }),
    body: "{}",
  });
  if (!r.ok) throw new Error("sign " + r.status);
  const j = await r.json();
  const token = new URL("https://x" + String(j.url || "")).searchParams.get("token");
  if (!token) throw new Error("no token");
  return token;
}

async function bot(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return j && j.ok ? j.result : null;
}

const publicUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
const okPath = (p, uid) => typeof p === "string" && p.startsWith(uid + "/") && !p.includes("..") && /^[0-9]+\/[A-Za-z0-9._-]+$/.test(p);

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");
  if (!rateLimit("droneshare:" + clientIp(req), 20, 60_000)) return fail(res, 429, "Забагато запитів");

  const body = req.body || {};
  const user = verifyTelegramInitData(body.initData, BOT_TOKEN);
  if (!user) return fail(res, 401, "Не вдалося підтвердити Telegram-користувача");
  const uid = String(user.id);

  try {
    if (body.action === "init") {
      const ext = MIME_EXT[String(body.mime || "")];
      if (!ext) return fail(res, 400, "Непідтримуваний формат відео");
      const base = `${uid}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const path = `${base}.${ext}`;
      const thumbPath = `${base}.jpg`;
      const [token, thumbToken] = await Promise.all([signedUpload(path), signedUpload(thumbPath)]);
      return res.status(200).json({ path, token, thumbPath, thumbToken, url: publicUrl(path) });
    }

    if (body.action === "send") {
      const { path, thumbPath } = body;
      if (!okPath(path, uid) || !okPath(thumbPath, uid)) return fail(res, 400, "Невірний шлях файлу");
      const isMp4 = path.endsWith(".mp4");
      const caption = String(body.caption || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, 900);
      const video = publicUrl(path), thumb = publicUrl(thumbPath);

      if (isMp4) {
        const prepared = await bot(BOT_TOKEN, "savePreparedInlineMessage", {
          user_id: user.id,
          result: {
            type: "video", id: crypto.randomBytes(8).toString("hex"), video_url: video, mime_type: "video/mp4",
            thumbnail_url: thumb, title: "Удар дроном — World Clicker", caption,
          },
          allow_user_chats: true, allow_bot_chats: false, allow_group_chats: true, allow_channel_chats: true,
        });
        if (prepared && prepared.id) return res.status(200).json({ preparedId: prepared.id });
      }
      // запасний шлях: бот шле відео користувачу в чат, звідки його можна переслати друзям
      let sent = await bot(BOT_TOKEN, "sendVideo", { chat_id: user.id, video, caption, supports_streaming: true });
      if (!sent) sent = await bot(BOT_TOKEN, "sendDocument", { chat_id: user.id, document: video, caption });
      if (!sent) return fail(res, 502, "Не вдалося надіслати відео. Спершу відкрий бота й натисни /start");
      return res.status(200).json({ sent: true });
    }
    return fail(res, 400, "Невідома дія");
  } catch {
    return fail(res, 500, "Не вдалося підготувати відео");
  }
}
