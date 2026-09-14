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

const SUPABASE_URL = "https://zrpwgavfploiaqrqpcvv.supabase.co";
const PLAYER_PREFIX = "players:";
const TG_MAP_PREFIX = "tgmap:";

function serviceHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  };
}

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const update = req.body || {};

  try {
    if (update.pre_checkout_query && BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pre_checkout_query_id: update.pre_checkout_query.id,
          ok: true,
        }),
      });
    }

    const payment = update.message?.successful_payment;
    if (payment) {
      const [kind, payloadId] = (payment.invoice_payload || "").split(":");
      const fromId = update.message?.from?.id;
      if (kind === "premium_pass" && payloadId && String(payloadId) === String(fromId)) {
        const ok = await grantPremiumPass(payloadId);
        if (!ok) console.error("webhook: не вдалося видати Premium Pass:", payloadId);
      } else {
        console.warn("webhook: підозрілий successful_payment payload:", payment.invoice_payload);
      }
    }
  } catch (err) {
    console.error("webhook error:", err?.message || err);
  }

  res.status(200).send("ok");
}
