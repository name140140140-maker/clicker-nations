// Сховище Power на сервері. pwr:<playerId> = { p: Power, e: енергія, t: мс, v: версія, rc: чек останньої витрати }.
// Запис ключа pwr:* закритий для анонімного ключа (RLS), тож змінити Power може лише сервер.
// Усі зміни — оптимістичні (умовний PATCH за старим значенням) з повтором, тому паралельні запити не губляться.

import { SUPABASE_URL, serviceHeaders } from "../_security.js";

export const PWR_PREFIX = "pwr:";
const enc = encodeURIComponent;
const rest = (p) => `${SUPABASE_URL}/rest/v1/kv_store${p}`;
export const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };

/* Покращення енергії (дублюють UPGRADES у src/App.jsx — тримай синхронно) */
const MAX_ENERGY = 100;
const EMAX = [120, 140, 170, 210, 250];
const EREG = [1.1, 1.2, 1.3, 1.4, 1.5];
const lvl = (rec, id) => Math.max(0, Math.min(5, Math.floor(Number(rec?.upg?.[id]) || 0)));
export const maxEnergyOf = (rec) => (lvl(rec, "emax") > 0 ? EMAX[lvl(rec, "emax") - 1] : MAX_ENERGY);
export const regenOf = (rec) => (lvl(rec, "ereg") > 0 ? EREG[lvl(rec, "ereg") - 1] : 1);

export async function sbGet(key) {
  const res = await fetch(rest(`?key=eq.${enc(key)}&select=value&limit=1`), { headers: serviceHeaders() });
  const rows = res.ok ? await res.json().catch(() => null) : null;
  return Array.isArray(rows) && rows[0] ? rows[0].value : null;
}

/* Запис гравця (для країни, покращень енергії та початкового значення Power) */
export const getRecord = async (playerId) => parse(await sbGet("players:" + playerId));

/* Поточний стан Power; якщо запису ще немає — створюємо з клієнтського запису гравця (одноразова міграція) */
export async function readPwr(playerId, rec) {
  const raw = await sbGet(PWR_PREFIX + playerId);
  if (raw !== null) {
    const st = parse(raw);
    if (st && Number.isFinite(st.p)) return { raw, st };
  }
  const r = rec || (await getRecord(playerId)) || {};
  return {
    raw: null,
    st: { p: Math.max(0, Math.floor(Number(r.power) || 0)), e: Number.isFinite(Number(r.energy)) ? Number(r.energy) : maxEnergyOf(r), t: Number(r.lastEnergyTs) || Date.now(), v: 0 },
  };
}

/* fn(st, now) → { st: новий стан, out } або { error }. Повертає { ok, out, st } або { ok:false, error } */
export async function mutatePwr(playerId, fn, rec) {
  for (let i = 0; i < 6; i++) {
    const { raw, st } = await readPwr(playerId, rec);
    const now = Date.now();
    const r = fn(st, now);
    if (r.error) return { ok: false, error: r.error };
    const next = { ...r.st, v: (st.v || 0) + 1 };
    const body = JSON.stringify(next);
    if (raw === null) {
      const ins = await fetch(rest(""), {
        method: "POST",
        headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify({ key: PWR_PREFIX + playerId, value: body, shared: true }),
      });
      if (ins.ok) return { ok: true, out: r.out, st: next };
      if (ins.status !== 409) return { ok: false, error: "Помилка бази" };
      continue;
    }
    const up = await fetch(rest(`?key=eq.${enc(PWR_PREFIX + playerId)}&value=eq.${enc(raw)}`), {
      method: "PATCH",
      headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ value: body }),
    });
    const rows = up.ok ? await up.json().catch(() => []) : null;
    if (rows === null) return { ok: false, error: "Помилка бази" };
    if (Array.isArray(rows) && rows.length === 1) return { ok: true, out: r.out, st: next };
  }
  return { ok: false, error: "Сервер зайнятий, спробуй ще раз" };
}

/* Енергія на момент now */
export const energyNow = (st, rec, now) => Math.min(maxEnergyOf(rec), (st.e || 0) + Math.max(0, Math.floor((now - (st.t || now)) / 1000)) * regenOf(rec));

/* Що віддаємо клієнту */
export const publicState = (st, rec, now) => ({ power: st.p, energy: Math.floor(energyNow(st, rec, now) * 100) / 100 });

/* Списання/нарахування Power як окрема операція (для банку) */
export const adjustPower = (playerId, delta, rec) =>
  mutatePwr(playerId, (st) => (st.p + delta < 0 ? { error: "У тебе немає стільки Power" } : { st: { ...st, p: st.p + delta } }), rec);
