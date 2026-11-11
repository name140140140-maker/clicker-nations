/* Експорт повної карти світу в PNG (для адміна). Малюється окремо від живої карти на 2D-canvas:
   області в кольорах власників, кордони (товсті між країнами, тонкі всередині), столиці й легенда.
   Не залежить від WebGL і від того, чи відкрита вкладка «Карта». */

import { buildRegionModel } from "./regionsModel.js";
import { loadCities, cityKey } from "./cities.js";
import { loadNations } from "../nations.js";

const WATER = "#1f7fe8";
const FREE = "#8ad84f";
const LAT_N = 83;
const LAT_S = -58;

const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));
const tick = () => new Promise((r) => setTimeout(r, 0));

export async function renderWorldImage({ width = 4096, lang = "uk", onStage = () => {} } = {}) {
  onStage("Завантажуємо дані…");
  const [res, nations, cities] = await Promise.all([fetch("/data/world-topology.json"), loadNations(lang), loadCities()]);
  if (!res.ok || !nations) throw new Error("Не вдалося завантажити карту");
  const topology = await res.json();
  onStage("Будуємо кордони…");
  const model = await buildRegionModel(topology, tick);

  const W = width;
  const s = W / 2048;
  const yTop = merc(LAT_N);
  const yBot = merc(LAT_S);
  const H = Math.round(((yTop - yBot) / (2 * Math.PI)) * W);
  const px = (lng) => ((lng + 180) / 360) * W;
  const py = (lat) => ((yTop - merc(lat)) / (2 * Math.PI)) * W;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не дозволяє створити зображення");
  ctx.fillStyle = WATER;
  ctx.fillRect(0, 0, W, H);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const colorOf = {};
  for (const c of nations.countries) colorOf[c.id] = c.color;
  const ownerOfIdx = new Array(model.regions.length).fill("");
  model.regions.forEach((r, i) => { ownerOfIdx[i] = nations.owners[r.rid] || ""; });

  onStage("Малюємо країни…");
  for (let i = 0; i < model.regions.length; i++) {
    const polys = model.regionPolygons(i);
    if (!polys.length) continue;
    ctx.beginPath();
    for (const rings of polys) {
      for (const ring of rings) {
        ring.forEach((pt, k) => (k ? ctx.lineTo(px(pt[0]), py(pt[1])) : ctx.moveTo(px(pt[0]), py(pt[1]))));
        ctx.closePath();
      }
    }
    ctx.fillStyle = colorOf[ownerOfIdx[i]] || FREE;
    ctx.fill("evenodd");
    if (i % 400 === 399) await tick();
  }

  onStage("Малюємо кордони…");
  const inner = new Path2D();
  const outer = new Path2D();
  for (let a = 0; a < model.arcCount; a++) {
    const ra = model.arcRegions[2 * a];
    const rb = model.arcRegions[2 * a + 1];
    if (ra < 0) continue;
    const pts = model.arcPoints(a);
    const target = rb < 0 || ownerOfIdx[ra] !== ownerOfIdx[rb] ? outer : inner;
    for (let k = 0; k < pts.length; k += 2) {
      if (k === 0) target.moveTo(px(pts[0]), py(pts[1]));
      else target.lineTo(px(pts[k]), py(pts[k + 1]));
    }
    if (a % 3000 === 2999) await tick();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 0.6 * s;
  ctx.stroke(inner);
  ctx.strokeStyle = "#0b2412";
  ctx.lineWidth = 1.7 * s;
  ctx.stroke(outer);

  onStage("Додаємо міста…");
  const co = nations.cityOwners || {};
  ctx.textAlign = "center";
  ctx.font = `700 ${11 * s}px sans-serif`;
  const placed = [];
  for (const c of cities.list) {
    if (c.cap < 1) continue;
    const idx = model.indexByRid.get(String(c.rid));
    const owner = co[cityKey(c)] || (idx !== undefined ? ownerOfIdx[idx] : "");
    const x = px(c.x);
    const y = py(c.y);
    if (y < 0 || y > H) continue;
    ctx.beginPath();
    ctx.arc(x, y, (c.cap === 2 ? 3.2 : 2) * s, 0, Math.PI * 2);
    ctx.fillStyle = colorOf[owner] || "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.2 * s;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    if (c.cap === 2) {
      const label = c.u || c.n;
      /* підписи, що налазять на вже намальовані, пропускаємо */
      const w = ctx.measureText(label).width;
      const box = [x - w / 2 - 2 * s, y - 19 * s, x + w / 2 + 2 * s, y - 3 * s];
      if (placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
      placed.push(box);
      ctx.lineWidth = 3 * s;
      ctx.strokeStyle = "rgba(8,20,40,0.85)";
      ctx.strokeText(label, x, y - 6 * s);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x, y - 6 * s);
    }
  }

  /* Заголовок і легенда: топ країн за кількістю областей */
  const top = [...nations.countries].filter((c) => c.regionCount > 0).sort((a, b) => b.regionCount - a.regionCount).slice(0, 12);
  const pad = 14 * s;
  const rowH = 17 * s;
  const boxW = 230 * s;
  const boxH = pad * 2 + 22 * s + top.length * rowH;
  ctx.fillStyle = "rgba(6,16,36,0.78)";
  ctx.fillRect(pad, H - boxH - pad, boxW, boxH);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${14 * s}px sans-serif`;
  const date = new Date().toLocaleString("uk-UA", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  ctx.fillText("World Clicker · " + date, pad * 2, H - boxH - pad + pad + 12 * s);
  ctx.font = `600 ${12 * s}px sans-serif`;
  top.forEach((c, i) => {
    const y = H - boxH - pad + pad + 22 * s + (i + 1) * rowH - 4 * s;
    ctx.fillStyle = c.color;
    ctx.fillRect(pad * 2, y - 10 * s, 12 * s, 10 * s);
    ctx.fillStyle = "#e8eef8";
    ctx.fillText(`${c.name} — ${c.regionCount}`, pad * 2 + 18 * s, y);
  });

  onStage("Зберігаємо зображення…");
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error("Не вдалося створити файл");
  return blob;
}
