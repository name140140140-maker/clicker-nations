#!/usr/bin/env node
/* Спрощення геометрії карти для швидкого старту на слабких пристроях.
   Читає public/data/world-topology.json (лише читання!) і пише public/data/world-topology-lite.json.
   Структура TopoJSON не змінюється: ті самі геометрії, properties, індекси дуг (отже сусідство областей і спільні кордони
   зберігаються), лише дуги мають менше точок (Дуглас-Пекер у квантованих одиницях).
   Використання: node scripts/simplify-topology.mjs [допуск у градусах, за замовчуванням 0.01 ≈ 1.1 км] */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "public/data/world-topology.json");
const DST = path.join(root, "public/data/world-topology-lite.json");

/** Дуглас-Пекер (ітеративний) по масиву абсолютних точок [[x,y],...] (одиниці осей уже зведені до градусів); повертає індекси, що лишаються */
export function douglasPeucker(pts, tol) {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > t2 && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Спрощує одну дугу (дельта-кодовану TopoJSON). Малі дуги (острівці, дрібні області) не чіпаємо. */
export function simplifyArc(arc, tol, scale = [1, 1]) {
  const pts = [];
  let x = 0, y = 0;
  for (const [dx, dy] of arc) { x += dx; y += dy; pts.push([x * scale[0], y * scale[1]]); }
  const absOf = (i) => [Math.round(pts[i][0] / scale[0]), Math.round(pts[i][1] / scale[1])];
  if (pts.length <= 4) return arc;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [px, py] of pts) { if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
  if (Math.hypot(maxX - minX, maxY - minY) < tol * 8) return arc;
  const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  let t = tol, idx = douglasPeucker(pts, t);
  // замкнений контур має лишитися полігоном (≥4 точки)
  while (closed && idx.length < 4 && t > 0.05) { t /= 2; idx = douglasPeucker(pts, t); }
  if (closed && idx.length < 4) return arc;
  const out = [];
  let px = 0, py = 0;
  for (const i of idx) { const [ax, ay] = absOf(i); out.push([ax - px, ay - py]); px = ax; py = ay; }
  return out;
}

/** tolDeg — допуск у градусах (осі зважуються на transform.scale, тож відхилення однакове по широті й довготі) */
export function simplifyTopology(topo, tolDeg) {
  const scale = topo.transform.scale;
  const arcs = topo.arcs.map((a) => simplifyArc(a, tolDeg, scale));
  // кільце з кількох коротких дуг могло скластися менш ніж у 4 точки → повертаємо його дугам оригінал (вони можуть бути спільними з сусідами)
  let reverted = 0;
  for (const o of Object.values(topo.objects)) for (const g of o.geometries) {
    const polys = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
    for (const rings of polys) for (const ring of rings) {
      const count = () => ring.reduce((n, r) => n + arcs[r < 0 ? ~r : r].length - 1, 1);
      if (count() < 4) for (const r of ring) { const i = r < 0 ? ~r : r; if (arcs[i] !== topo.arcs[i]) { arcs[i] = topo.arcs[i]; reverted++; } }
    }
  }
  if (reverted) console.log(`повернуто оригінал для ${reverted} дуг (вироджені кільця)`);
  // властивості: лишаємо лише ті, що читає клієнт (src/map/regionsModel.js); fallback-імена зводимо до cn_region_*
  const objects = {};
  for (const [k, o] of Object.entries(topo.objects)) {
    objects[k] = { ...o, geometries: o.geometries.map((g) => {
      const p = g.properties || {};
      return { ...g, properties: { cn_region_name: p.cn_region_name || p.name || "", cn_region_iso: p.cn_region_iso || p.iso || "", cn_region_id: p.cn_region_id } };
    }) };
  }
  return { ...topo, objects, arcs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tol = Number(process.argv[2] || 0.01);
  const topo = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const lite = simplifyTopology(topo, tol);
  const before = topo.arcs.reduce((s, a) => s + a.length, 0), after = lite.arcs.reduce((s, a) => s + a.length, 0);
  fs.writeFileSync(DST, JSON.stringify(lite));
  console.log(`допуск ${tol}°: точок ${before} → ${after} (${((after / before) * 100).toFixed(1)}%), файл ${(fs.statSync(DST).size / 1e6).toFixed(2)} МБ`);
}
