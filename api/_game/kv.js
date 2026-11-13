// Низькорівневий доступ сервера до kv_store (service role) для ігрових дій: api/_game/world.js
import { SUPABASE_URL, serviceHeaders } from "../_security.js";

const enc = encodeURIComponent;
const rest = (p) => `${SUPABASE_URL}/rest/v1/kv_store${p}`;
export const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };

export async function sbGet(key) {
  const res = await fetch(rest(`?key=eq.${enc(key)}&select=value&limit=1`), { headers: serviceHeaders() });
  const rows = res.ok ? await res.json().catch(() => null) : null;
  return Array.isArray(rows) && rows[0] ? rows[0].value : null;
}
export const getJson = async (key) => parse(await sbGet(key));

/* Усі записи з префіксом: [{ key, value }] або null при помилці */
export async function sbList(prefix) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(rest(`?key=like.${enc(prefix + "%")}&select=key,value&order=key.asc&limit=1000&offset=${from}`), { headers: serviceHeaders() });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return null;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/* "ok" | "exists" | "error" — без перезапису існуючого ключа */
export async function sbInsert(key, value) {
  const res = await fetch(rest(""), {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ key, value: String(value), shared: true }),
  });
  if (res.ok) return "ok";
  return res.status === 409 ? "exists" : "error";
}
export async function sbUpsert(key, value) {
  const res = await fetch(rest("?on_conflict=key"), {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ key, value: String(value), shared: true }),
  });
  return res.ok;
}
export async function sbDelete(key) {
  await fetch(rest(`?key=eq.${enc(key)}`), { method: "DELETE", headers: serviceHeaders() }).catch(() => null);
}

/* Оптимістичне оновлення JSON-значення: fn(поточне|null) → нове (або undefined — нічого не міняти) */
export async function casJson(key, fn) {
  for (let i = 0; i < 6; i++) {
    const raw = await sbGet(key);
    const next = fn(raw === null ? null : parse(raw));
    if (next === undefined) return true;
    const body = JSON.stringify(next);
    if (raw === null) {
      const r = await sbInsert(key, body);
      if (r === "ok") return true;
      if (r === "error") return false;
      continue;
    }
    const up = await fetch(rest(`?key=eq.${enc(key)}&value=eq.${enc(raw)}`), {
      method: "PATCH",
      headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ value: body }),
    });
    const rows = up.ok ? await up.json().catch(() => null) : null;
    if (rows === null) return false;
    if (rows.length === 1) return true;
  }
  return false;
}

/* Новини гри (60 останніх) і від адміністрації (30) */
const trimNews = (list) => {
  const admin = list.filter((n) => n.admin).slice(0, 30);
  const game = list.filter((n) => !n.admin).slice(0, 60);
  return [...admin, ...game].sort((a, b) => (b.ts || 0) - (a.ts || 0));
};
export async function addNews(text, opts = {}) {
  const item = { id: "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text: String(text).slice(0, 600), ts: Date.now(), ...(opts.admin ? { admin: true } : {}) };
  return casJson("game-state", (st) => ({ ...(st || {}), news: trimNews([item, ...((st && st.news) || [])]) }));
}
export async function addMail(playerId, message) {
  const full = { id: "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), read: false, ts: Date.now(), ...message };
  return casJson("mail:" + playerId, (list) => [full, ...(Array.isArray(list) ? list : [])]);
}

/* Гравці: [{ id, countryCode }] */
export async function loadPlayers() {
  const rows = await sbList("players:");
  if (!rows) return [];
  const out = [];
  for (const r of rows) {
    const p = parse(r.value);
    if (p && p.id) out.push({ id: p.id, countryCode: p.countryCode, username: p.username || "" });
  }
  return out;
}
export const leaderOf = async (code) => (await sbGet("leader:" + code)) || null;
