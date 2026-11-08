// Vercel Serverless Function: POST /api/webhook
// Telegram надсилає сюди події бота. Найважливіша подія для оплати —
// pre_checkout_query: бот МУСИТЬ підтвердити її протягом ~10 секунд,
// інакше Telegram вважає платіж невдалим і показує нескінченну загрузку.
//
// Друга важлива подія — message.successful_payment: вона прилітає лише
// ПІСЛЯ реального успішного платежу і саме тут (і тільки тут) видається
// Premium Pass. Клієнту більше не довіряємо — hasPremiumPass ставиться
// виключно сервером, через service_role ключ Supabase.
//
// ID гравця (players:{id}) — це рандомний genId(), НЕ Telegram ID.
// Тому щоб знайти правильний запис гравця за telegramId з payload,
// використовуємо окремий ключ-мапінг tgmap:{telegramId} -> playerId,
// який пише клієнт при створенні гравця (див. createPlayer у App.jsx).

import { safeEqual, SUPABASE_URL, serviceHeaders } from "./_security.js";

const PLAYER_PREFIX = "players:";
const TG_MAP_PREFIX = "tgmap:";

async function sbGet(key) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: serviceHeaders() }
  );
  const rows = await res.json();
  return rows?.[0]?.value ?? null;
}

async function sbPatch(key, value) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ value }),
  });
  return res.ok;
}

async function grantPremiumPass(telegramId) {
  // Крок 1: telegramId -> playerId через мапінг
  const playerId = await sbGet(TG_MAP_PREFIX + telegramId);
  if (!playerId) {
    console.warn("webhook: немає tgmap для telegramId:", telegramId);
    return false;
  }

  // Крок 2: беремо реальний запис гравця по playerId
  const playerKey = PLAYER_PREFIX + playerId;
  const raw = await sbGet(playerKey);
  if (!raw) {
    console.warn("webhook: запис гравця не знайдено за playerId:", playerId);
    return false;
  }

  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    console.warn("webhook: пошкоджений запис гравця:", playerKey);
    return false;
  }

  if (rec.hasPremiumPass) return true; // вже видано (повторний webhook — норм)

  const updated = { ...rec, hasPremiumPass: true };
  return sbPatch(playerKey, JSON.stringify(updated));
}

/* Перевіряємо оплату НАПРЯМУ в Telegram: чи є в транзакціях бота платіж із таким charge id від цього користувача.
   Так підроблений "successful_payment" (POST будь-кого на цей URL) не дасть Premium. */
async function verifyStarPayment(botToken, chargeId, userId) {
  if (!chargeId) return false;
  for (let offset = 0; offset < 500; offset += 100) {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getStarTransactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset, limit: 100 }),
    });
    const d = await r.json().catch(() => null);
    const list = d?.ok ? d.result?.transactions : null;
    if (!Array.isArray(list)) return false;
    const hit = list.find((t) => String(t.id) === String(chargeId));
    if (hit) return String(hit.source?.user?.id ?? "") === String(userId) && Number(hit.amount) > 0;
    if (list.length < 100) return false;
  }
  return false;
}

/* Запобігаємо повторній видачі за один і той самий платіж */
async function claimPayment(chargeId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
    method: "POST",
    headers: { ...serviceHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ key: "payment:" + chargeId, value: String(Date.now()), shared: true }),
  });
  return res.ok;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  /* Якщо задано TELEGRAM_WEBHOOK_SECRET — приймаємо лише запити з правильним секретним заголовком Telegram. */
  const hookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (hookSecret && !safeEqual(req.headers["x-telegram-bot-api-secret-token"], hookSecret)) {
    res.status(401).send("unauthorized");
    return;
  }
  const update = req.body || {};

  try {
    const pre = update.pre_checkout_query;
    if (pre && BOT_TOKEN) {
      const [kind, payloadId] = String(pre.invoice_payload || "").split(":");
      const valid = kind === "premium_pass" && String(payloadId) === String(pre.from?.id) && pre.currency === "XTR";
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          valid
            ? { pre_checkout_query_id: pre.id, ok: true }
            : { pre_checkout_query_id: pre.id, ok: false, error_message: "Невірні дані платежу" }
        ),
      });
    }

    const payment = update.message?.successful_payment;
    if (payment && BOT_TOKEN) {
      const [kind, payloadId] = (payment.invoice_payload || "").split(":");
      const fromId = update.message?.from?.id;
      const chargeId = payment.telegram_payment_charge_id;
      if (kind === "premium_pass" && payloadId && String(payloadId) === String(fromId) && payment.currency === "XTR") {
        const genuine = await verifyStarPayment(BOT_TOKEN, chargeId, fromId);
        if (!genuine) {
          console.warn("webhook: платіж не підтверджено Telegram (можливе підроблене повідомлення):", chargeId);
        } else if (await claimPayment(chargeId)) {
          const ok = await grantPremiumPass(payloadId);
          if (!ok) console.error("webhook: не вдалося видати Premium Pass:", payloadId);
        } else {
          console.info("webhook: платіж уже оброблено:", chargeId);
        }
      } else {
        console.warn("webhook: підозрілий successful_payment payload:", payment.invoice_payload);
      }
    }
  } catch (err) {
    console.error("webhook error:", err?.message || err);
  }

  res.status(200).send("ok");
}
