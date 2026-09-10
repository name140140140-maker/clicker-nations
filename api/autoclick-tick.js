// Vercel Serverless Function: /api/autoclick-tick
// Викликається періодично (Vercel Cron або зовнішній cron-пінгер) і
// нараховує прогрес усім гравцям з увімкненим автоклікером — незалежно
// від того, чи відкрита в них зараз гра. Це і є "робота офлайн".
//
// Логіка на добавок до банку енергії (макс. 100) в тому, що кожен виклик
// цієї функції "проганяє" накопичену енергію в Power одразу на сервері,
// а потім енергія знову накопичується до наступного виклику. Тобто чим
// частіше викликається цей endpoint (кожні кілька хвилин), тим ближче
// прогрес гравця до "реального часу", а не лише одноразового банку 100
// одиниць за один візит.

const SUPABASE_URL = "https://zrpwgavfploiaqrqpcvv.supabase.co";
const SUPABASE_KEY = "sb_publishable_Kp13ZD0NtWypUYegahB35g_X2nOWmzn";

const MAX_ENERGY = 100;
const ENERGY_REGEN_PER_SEC = 1;
const AUTO_CLICKER_DAILY_LIMIT_MS = 12 * 60 * 60 * 1000;

function getCurrentEnergy(rec, now) {
  const elapsedSec = Math.max(0, (now - (rec.lastEnergyTs || now)) / 1000);
  return Math.min(MAX_ENERGY, (rec.energy || 0) + elapsedSec * ENERGY_REGEN_PER_SEC);
}

async function fetchAutoClickerPlayers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/kv_store?key=like.players:*&shared=eq.true&select=key,value`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error("Не вдалося отримати список гравців із Supabase");
  return res.json();
}

async function savePlayer(key, value) {
  await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ value }),
  });
}

export default async function handler(req, res) {
  const now = Date.now();
  const todayKey = new Date(now).toISOString().slice(0, 10);
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const rows = await fetchAutoClickerPlayers();

    for (const row of rows) {
      let rec;
      try {
        rec = JSON.parse(row.value);
      } catch {
        errors++;
        continue;
      }

      if (!rec.hasPremiumPass || !rec.autoClickerOn) {
        skipped++;
        continue;
      }

      const usedToday = rec.autoClickerDate === todayKey ? rec.autoClickerUsedMs || 0 : 0;
      const remainingBudgetMs = AUTO_CLICKER_DAILY_LIMIT_MS - usedToday;
      if (remainingBudgetMs <= 0) {
        await savePlayer(row.key, JSON.stringify({ ...rec, autoClickerOn: false }));
        skipped++;
        continue;
      }

      const currentEnergy = getCurrentEnergy(rec, now);
      const clicksToApply = Math.floor(currentEnergy);
      if (clicksToApply <= 0) {
        skipped++;
        continue;
      }

      const elapsedSinceLastTickMs = Math.max(0, now - (rec.lastEnergyTs || now));
      const usedMs = Math.min(AUTO_CLICKER_DAILY_LIMIT_MS, usedToday + Math.min(elapsedSinceLastTickMs, remainingBudgetMs));

      const updated = {
        ...rec,
        power: (rec.power || 0) + clicksToApply,
        totalClicks: (rec.totalClicks || 0) + clicksToApply,
        energy: currentEnergy - clicksToApply,
        lastEnergyTs: now,
        autoClickerDate: todayKey,
        autoClickerUsedMs: usedMs,
        autoClickerOn: usedMs < AUTO_CLICKER_DAILY_LIMIT_MS,
      };

      await savePlayer(row.key, JSON.stringify(updated));
      processed++;
    }

    res.status(200).json({ ok: true, processed, skipped, errors, totalRows: rows.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || "Невідома помилка" });
  }
}
