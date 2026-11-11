/* Повтор змін на карті: журнал подій mapevt:* + малювання кадрів на 2D-canvas.
   Подія: { t, k: "ct"|"rg", ck?, rid, from, to, name } — місто або область змінили власника. */

import { buildRegionModel } from "./regionsModel.js";
import { loadCities, cityKey } from "./cities.js";
import { loadNations } from "../nations.js";
import { sbStorageSet, sbStorageListEntries } from "../supabaseStorage.js";

export const MAPEVT_PREFIX = "mapevt:";
const WATER = "#1f7fe8";
const FREE = "#8ad84f";
const LAT_N = 83;
const LAT_S = -58;
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));

/* Запис події (помилки журналу ніколи не ламають гру) */
export async function logMapEvent(ev) {
  try {
    const t = Date.now();
    const key = MAPEVT_PREFIX + String(t).padStart(14, "0") + "-" + Math.random().toString(36).slice(2, 6);
    await sbStorageSet(key, JSON.stringify({ t, ...ev }), true);
  } catch {
    /* ignore */
  }
}

export async function loadMapEvents(sinceMs) {
  const rows = (await sbStorageListEntries(MAPEVT_PREFIX, true)) || [];
  const out = [];
  for (const r of rows) {
    try {
      const e = typeof r.value === "string" ? JSON.parse(r.value) : r.value;
      if (e && typeof e.t === "number" && e.t >= sinceMs) out.push(e);
    } catch {
      /* ignore */
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/* Готує сцену: повертає { H, startState(events), draw(state, ctx, highlight) } */
export async function prepareReplay({ width = 900, lang = "uk" } = {}) {
  const [res, nations, cities] = await Promise.all([fetch("/data/world-topology.json"), loadNations(lang), loadCities()]);
  if (!res.ok || !nations) throw new Error("Не вдалося завантажити карту");
  const model = await buildRegionModel(await res.json(), () => new Promise((r) => setTimeout(r, 0)));
  const W = width;
  const yTop = merc(LAT_N);
  const H = Math.round(((yTop - merc(LAT_S)) / (2 * Math.PI)) * W);
  const px = (lng) => ((lng + 180) / 360) * W;
  const py = (lat) => ((yTop - merc(lat)) / (2 * Math.PI)) * W;
  const colorOf = {};
  for (const c of nations.countries) colorOf[c.id] = c.color;

  const paths = model.regions.map((r, i) => {
    const p = new Path2D();
    for (const rings of model.regionPolygons(i)) {
      for (const ring of rings) {
        ring.forEach((pt, k) => (k ? p.lineTo(px(pt[0]), py(pt[1])) : p.moveTo(px(pt[0]), py(pt[1]))));
        p.closePath();
      }
    }
    return p;
  });
  const ridIdx = model.regions.map((r) => String(r.rid));
  const bigCities = cities.list.filter((c) => c.cap >= 1);

  /* поточний стан */
  const current = { reg: { ...nations.owners }, city: { ...(nations.cityOwners || {}) } };
  const baseRegion = (rid) => current.reg[rid] || "";

  /* стан на початок вікна = поточний, відкочений назад по подіях */
  const stateAt = (events) => {
    const reg = { ...current.reg };
    const city = {};
    for (const c of bigCities) city[cityKey(c)] = current.city[cityKey(c)] || reg[String(c.rid)] || "";
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.k === "rg") {
        reg[String(e.rid)] = e.from || "";
      } else if (e.ck) city[e.ck] = e.from || "";
    }
    return { reg, city };
  };
  const apply = (st, e) => {
    if (e.k === "rg") st.reg[String(e.rid)] = e.to || "";
    else if (e.ck) st.city[e.ck] = e.to || "";
  };
  const draw = (ctx, st, last) => {
    ctx.fillStyle = WATER;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < paths.length; i++) {
      ctx.fillStyle = colorOf[st.reg[ridIdx[i]]] || FREE;
      ctx.fill(paths[i], "evenodd");
    }
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 0.4;
    for (let i = 0; i < paths.length; i++) ctx.stroke(paths[i]);
    for (const c of bigCities) {
      const k = cityKey(c);
      const owner = st.city[k] || "";
      ctx.beginPath();
      ctx.arc(px(c.x), py(c.y), c.cap === 2 ? 3.2 : 2, 0, Math.PI * 2);
      ctx.fillStyle = colorOf[owner] || "#fff";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
    if (last && (last.ck || last.k === "rg")) {
      let x;
      let y;
      if (last.ck) {
        const c = cities.list.find((q) => cityKey(q) === last.ck);
        if (c) { x = px(c.x); y = py(c.y); }
      }
      if (x !== undefined) {
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#ffd84a";
        ctx.stroke();
      }
    }
  };
  return { W, H, stateAt, apply, draw, colorOf, countries: nations.countries, baseRegion };
}
