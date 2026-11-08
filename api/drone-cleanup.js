// Vercel Serverless Function: GET /api/drone-cleanup
// Видаляє відеоповтори дрона зі сховища Supabase (бакет "drone-replays"), старші за 10 хвилин.
// Викликається щохвилини планувальником Supabase (pg_cron) і раз на добу cron-ом Vercel (запасний варіант).
// Доступ лише з секретом CRON_SECRET (заголовок Authorization: Bearer <секрет>).

import { safeEqual, SUPABASE_URL, serviceHeaders, fail } from "./_security.js";

const BUCKET = "drone-replays";
const MAX_AGE_MS = 10 * 60 * 1000;

async function list(prefix) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "created_at", order: "asc" } }),
  });
  if (!r.ok) throw new Error("list " + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");
  const auth = String(req.headers.authorization || "");
  const hdr = String(req.headers["x-cron-secret"] || "");
  if (!(safeEqual(auth, `Bearer ${secret}`) || safeEqual(hdr, secret))) return fail(res, 401, "Forbidden");

  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    const old = [];
    const root = await list("");
    for (const e of root) {
      if (e.id === null || e.id === undefined) {
        // папка користувача
        const files = await list(e.name);
        for (const f of files) if (f.id && Date.parse(f.created_at) < cutoff) old.push(`${e.name}/${f.name}`);
      } else if (Date.parse(e.created_at) < cutoff) {
        old.push(e.name);
      }
    }
    let removed = 0;
    for (let i = 0; i < old.length; i += 100) {
      const batch = old.slice(i, i + 100);
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: "DELETE",
        headers: serviceHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefixes: batch }),
      });
      if (r.ok) removed += batch.length;
    }
    res.status(200).json({ removed });
  } catch {
    fail(res, 500, "Не вдалося очистити сховище");
  }
}
