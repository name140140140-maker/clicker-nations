// api/_telegramAuth.js
// Перевірка Telegram WebApp initData на сервері (офіційний алгоритм Telegram).
// Файл починається з "_" — Vercel НЕ перетворює його на окремий ендпоінт,
// це просто спільний модуль для інших функцій у /api.

import crypto from "crypto";

export function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");

    const pairs = [];
    for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
    pairs.sort();
    const dataCheckString = pairs.join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (computedHash !== hash) return null;

    const authDate = Number(params.get("auth_date"));
    if (Number.isFinite(authDate) && Date.now() / 1000 - authDate > 24 * 60 * 60) {
      return null; // initData старше доби — відхиляємо
    }

    const userRaw = params.get("user");
    const user = userRaw ? JSON.parse(userRaw) : null;
    if (!user?.id) return null;
    return user;
  } catch {
    return null;
  }
}
