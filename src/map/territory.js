/* Модель територій для карти: декодована топологія, поточні власники
   областей ("живі кордони"), шматки суші (материк/острів/ексклав) кожного
   власника та суміжність. Чистий JS без DOM/React/MapLibre — тому однаково
   працює в рантаймі й в аудит-скриптах/тестах.

   Ключова ідея "живих кордонів": кордон — це не статична лінія країни, а
   СПІЛЬНА арка топології між двома областями, і вона вважається державним
   кордоном лише коли власники цих двох областей зараз різні. Тому захоплена
   область одразу отримує кордон по лінії фронту і втрачає його всередині
   нової держави — без перебудови геометрії. */

import { matchAllAsync } from "./regionMatch.js";
import { REGION_MATCH_OVERRIDES } from "./regionOverrides.js";

export const LAT_LIMIT = 85.0511287798;
const DEG = Math.PI / 180;
const EARTH_KM = 6371.0088;
const KM2_PER_UNIT2 = (2 * Math.PI * EARTH_KM) ** 2; // площа 1×1 одиниці нормалізованого Mercator на екваторі

export const mercX = (lng) => (lng + 180) / 360;
export function mercY(lat) {
  const c = Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat));
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (c * DEG) / 2)) / (2 * Math.PI);
}
export const lngOfX = (x) => x * 360 - 180;
export function latOfY(y) {
  const n = Math.PI * (1 - 2 * y);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/* Поріг класифікації шматків (км²). Це "розумні за замовчуванням" величини —
   їх використовує flagOverlay разом із розміром на екрані та відстанню. */
export const PART_BIG_KM2 = 25000; // Сицилія/Тайвань і більше
export const PART_MEDIUM_KM2 = 1500; // Мальорка/Бали і більше

const round5 = (v) => Math.round(v * 1e5) / 1e5;

/* Розкладає топологію в зручні масиви. yieldFn — щоб віддавати кадр
   браузеру між пачками (інтерфейс не замерзає на слабких телефонах). */
export async function buildTerritory(topology, regionData, yieldFn = async () => {}) {
  const objName = Object.keys(topology.objects)[0];
  const geoms = topology.objects[objName].geometries;
  const tr = topology.transform;
  const arcCount = topology.arcs.length;

  // 1. Арки: Mercator-координати (для малювання/геометрії) + готовий текст
  // GeoJSON (для MapLibre). Текст будуємо один раз на арку: зворотний
  // напрямок — це лише розворот рядка, без повторного форматування чисел.
  const arcMerc = new Array(arcCount);
  const arcText = new Array(arcCount);
  for (let a = 0; a < arcCount; a++) {
    const raw = topology.arcs[a];
    const len = raw.length;
    const merc = new Float64Array(len * 2);
    const parts = new Array(len);
    let qx = 0;
    let qy = 0;
    for (let i = 0; i < len; i++) {
      if (tr) {
        qx += raw[i][0];
        qy += raw[i][1];
      } else {
        qx = raw[i][0];
        qy = raw[i][1];
      }
      const lng = round5(tr ? qx * tr.scale[0] + tr.translate[0] : qx);
      const lat = round5(tr ? qy * tr.scale[1] + tr.translate[1] : qy);
      merc[2 * i] = mercX(lng);
      merc[2 * i + 1] = mercY(lat);
      parts[i] = "[" + lng + "," + lat + "]";
    }
    arcMerc[a] = merc;
    arcText[a] = parts.join(",");
    if (a % 1200 === 1199) await yieldFn();
  }

  // 2. Області → полігони → кільця (посилання на арки), суміжність арок.
  const regions = [];
  const polyRegion = [];
  const polyRings = [];
  const arcRegions = new Int32Array(arcCount * 2).fill(-1);
  const arcPolys = new Int32Array(arcCount * 2).fill(-1);
  const regionArcSets = [];

  for (let r = 0; r < geoms.length; r++) {
    const g = geoms[r];
    const props = g.properties || {};
    const polygons = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
    const region = { index: r, iso: props.iso || "", name: props.name || "", polys: [], areaKm2: 0 };
    const arcSet = new Set();
    for (const rings of polygons) {
      if (!rings || !rings.length) continue;
      const pid = polyRegion.length;
      polyRegion.push(r);
      polyRings.push(rings);
      region.polys.push(pid);
      for (const ring of rings) {
        for (const ref of ring) {
          const a = ref < 0 ? ~ref : ref;
          arcSet.add(a);
          if (arcRegions[2 * a] === -1) arcRegions[2 * a] = r;
          else if (arcRegions[2 * a] !== r && arcRegions[2 * a + 1] === -1) arcRegions[2 * a + 1] = r;
          if (arcPolys[2 * a] === -1) arcPolys[2 * a] = pid;
          else if (arcPolys[2 * a] !== pid && arcPolys[2 * a + 1] === -1) arcPolys[2 * a + 1] = pid;
        }
      }
    }
    regions.push(region);
    regionArcSets.push(arcSet);
  }
  const regionArcs = regionArcSets.map((s) => Array.from(s));

  // 3. Геометрія кожного полігона: bbox, площа (км²), центроїд — за зовнішнім кільцем.
  const polyCount = polyRegion.length;
  const polyBBox = new Float64Array(polyCount * 4);
  const polyAreaKm2 = new Float64Array(polyCount);
  const polyCx = new Float64Array(polyCount);
  const polyCy = new Float64Array(polyCount);
  for (let p = 0; p < polyCount; p++) {
    const ring = polyRings[p][0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let ox = NaN, oy = NaN, px = 0, py = 0, A = 0, Cx = 0, Cy = 0, first = true;
    const visit = (x, y) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (first) { ox = x; oy = y; first = false; px = 0; py = 0; return; }
      const rx = x - ox, ry = y - oy; // відносно першої вершини — менше втрат точності
      const cross = px * ry - rx * py;
      A += cross; Cx += (px + rx) * cross; Cy += (py + ry) * cross;
      px = rx; py = ry;
    };
    for (const ref of ring) {
      const m = arcMerc[ref < 0 ? ~ref : ref];
      const n = m.length / 2;
      if (ref >= 0) for (let i = 0; i < n; i++) visit(m[2 * i], m[2 * i + 1]);
      else for (let i = n - 1; i >= 0; i--) visit(m[2 * i], m[2 * i + 1]);
    }
    // замикаємо до першої вершини
    { const cross = px * 0 - 0 * py; A += cross; }
    const area = Math.abs(A) / 2;
    let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    if (area > 1e-14 && Math.abs(A) > 0) {
      const gx = Cx / (3 * A), gy = Cy / (3 * A);
      if (Number.isFinite(gx) && Number.isFinite(gy)) {
        const tx = ox + gx, ty = oy + gy;
        if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) { cx = tx; cy = ty; }
      }
    }
    const lat = latOfY(cy) * DEG;
    polyBBox[4 * p] = minX; polyBBox[4 * p + 1] = minY; polyBBox[4 * p + 2] = maxX; polyBBox[4 * p + 3] = maxY;
    polyCx[p] = cx; polyCy[p] = cy;
    polyAreaKm2[p] = area * KM2_PER_UNIT2 * Math.cos(lat) * Math.cos(lat);
    regions[polyRegion[p]].areaKm2 += polyAreaKm2[p];
    if (p % 700 === 699) await yieldFn();
  }

  // 4. Суміжність полігонів (по спільних арках) — для шматків одного власника.
  const polyAdj = Array.from({ length: polyCount }, () => []);
  for (let a = 0; a < arcCount; a++) {
    const p1 = arcPolys[2 * a], p2 = arcPolys[2 * a + 1];
    if (p1 >= 0 && p2 >= 0 && p1 !== p2) { polyAdj[p1].push(p2); polyAdj[p2].push(p1); }
  }

  // 5. Зіставлення назв з гри → області топології.
  const topoByIso = {};
  regions.forEach((r) => { if (r.iso) (topoByIso[r.iso] ||= []).push({ i: r.index, name: r.name }); });
  const matched = await matchAllAsync(topoByIso, regionData || {}, REGION_MATCH_OVERRIDES, yieldFn);
  const nameIndex = new Map();
  regions.forEach((r) => nameIndex.set(`${r.iso}|${r.name}`, r.index));
  for (const [iso, byName] of Object.entries(matched.map)) {
    for (const [gameName, idx] of Object.entries(byName)) nameIndex.set(`${iso}|${gameName}`, idx);
  }
  const gameNameOfRegion = new Array(regions.length).fill(null);
  for (const [iso, byName] of Object.entries(matched.map)) {
    for (const [gameName, idx] of Object.entries(byName)) gameNameOfRegion[idx] = gameName;
  }

  const territory = new Territory({
    regions, geoms, arcMerc, arcText, arcRegions, arcPolys, regionArcs,
    polyRegion, polyRings, polyBBox, polyAreaKm2, polyCx, polyCy, polyAdj,
    nameIndex, gameNameOfRegion, matchStats: { hit: matched.hit, total: matched.total },
  });
  await territory.rebuildPartsAsync(null, yieldFn);
  return territory;
}

export class Territory {
  constructor(data) {
    Object.assign(this, data);
    this.owner = this.regions.map((r) => r.iso); // поточні власники (за замовчуванням — "рідні")
    this.parts = [];
    this.partsByOwner = new Map();
    this.polyPart = new Int32Array(this.polyRegion.length).fill(-1);
  }

  /* Текст арок потрібен лише для побудови GeoJSON — після цього його можна звільнити. */
  releaseText() {
    this.arcText = null;
  }

  regionName(r) {
    return this.gameNameOfRegion[r] || this.regions[r].name;
  }

  /* cityControl → масив власників по областях. Ключі гри мають вигляд
     "ISO|назва області з гри". Ключі, яким нема відповідної області на
     карті, пропускаються (їх кількість повертається для діагностики). */
  ownersFromControl(cityControl) {
    const owners = this.regions.map((r) => r.iso);
    let unknown = 0;
    if (cityControl) {
      for (const key of Object.keys(cityControl)) {
        const idx = this.nameIndex.get(key);
        const value = cityControl[key];
        if (idx === undefined || typeof value !== "string" || !value) { unknown++; continue; }
        owners[idx] = value;
      }
    }
    return { owners, unknown };
  }

  /* Застосовує нових власників; повертає список змін [{ r, from, to }]. */
  setOwners(newOwners) {
    const changes = [];
    for (let r = 0; r < newOwners.length; r++) {
      if (newOwners[r] !== this.owner[r]) changes.push({ r, from: this.owner[r], to: newOwners[r] });
    }
    for (const c of changes) this.owner[c.r] = c.to;
    return changes;
  }

  /* Стан для feature-state арки: власники двох сусідніх областей. */
  arcOwners(a) {
    const ra = this.arcRegions[2 * a], rb = this.arcRegions[2 * a + 1];
    return { oa: ra >= 0 ? this.owner[ra] : "", ob: rb >= 0 ? this.owner[rb] : "" };
  }

  /* Шматки суші: зв'язні (по спільних арках) групи полігонів ОДНОГО власника.
     affected — множина власників, яких треба перерахувати (null = усі).
     Реалізовано генератором: синхронний драйвер — для малих оновлень при
     захопленні, асинхронний — для першого повного розрахунку (віддає кадр
     браузеру між пачками, щоб на слабких телефонах інтерфейс не замерзав). */
  rebuildParts(affected) {
    for (const step of this._rebuildPartsSteps(affected)) void step; // eslint-disable-line no-unused-vars
  }

  async rebuildPartsAsync(affected, yieldFn) {
    for (const step of this._rebuildPartsSteps(affected)) { void step; await yieldFn(); }
  }

  *_rebuildPartsSteps(affected) {
    const owners = this.owner;
    const polyOwner = (p) => owners[this.polyRegion[p]];
    const wanted = (o) => !affected || affected.has(o);

    if (affected) {
      this.parts = this.parts.filter((part) => !wanted(part.owner));
      for (const o of affected) this.partsByOwner.delete(o);
    } else {
      this.parts = [];
      this.partsByOwner.clear();
    }
    const seen = new Uint8Array(this.polyRegion.length);
    const fresh = [];
    for (let p = 0; p < this.polyRegion.length; p++) {
      const o = polyOwner(p);
      if (seen[p] || !o || !wanted(o)) continue;
      const stack = [p];
      seen[p] = 1;
      const polys = [];
      while (stack.length) {
        const q = stack.pop();
        polys.push(q);
        for (const nb of this.polyAdj[q]) {
          if (!seen[nb] && polyOwner(nb) === o) { seen[nb] = 1; stack.push(nb); }
        }
      }
      fresh.push(this._makePart(o, polys));
    }
    yield "components";
    for (const part of fresh) this.parts.push(part);

    // групуємо за власником і шукаємо головний шматок + відстань до нього
    const byOwner = new Map();
    for (const part of this.parts) {
      let list = byOwner.get(part.owner);
      if (!list) byOwner.set(part.owner, (list = []));
      list.push(part);
    }
    const toUpdate = affected ? [...affected] : [...byOwner.keys()];
    let sliceStart = performance.now();
    for (const o of toUpdate) {
      const list = byOwner.get(o);
      if (!list) continue;
      this.partsByOwner.set(o, list);
      let main = list[0];
      for (const part of list) if (part.areaKm2 > main.areaKm2) main = part;
      for (const part of list) part.isMain = part === main;
      const samples = this._boundarySamples(main, 450);
      for (const part of list) part.distKm = part.isMain ? 0 : this._distToSamples(part, samples);
      if (performance.now() - sliceStart > 8) { yield "owners"; sliceStart = performance.now(); }
    }
    this.parts.forEach((part, i) => {
      part.id = i;
      for (const p of part.polys) this.polyPart[p] = i;
    });
  }

  _makePart(owner, polys) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let area = 0, sx = 0, sy = 0;
    for (const p of polys) {
      const b = this.polyBBox;
      if (b[4 * p] < minX) minX = b[4 * p];
      if (b[4 * p + 1] < minY) minY = b[4 * p + 1];
      if (b[4 * p + 2] > maxX) maxX = b[4 * p + 2];
      if (b[4 * p + 3] > maxY) maxY = b[4 * p + 3];
      const a = this.polyAreaKm2[p];
      area += a; sx += this.polyCx[p] * a; sy += this.polyCy[p] * a;
    }
    // якір (для значка): центроїд найбільшого полігона шматка
    let big = polys[0];
    for (const p of polys) if (this.polyAreaKm2[p] > this.polyAreaKm2[big]) big = p;
    const cx = area > 0 ? sx / area : (minX + maxX) / 2;
    const cy = area > 0 ? sy / area : (minY + maxY) / 2;
    const klass = area >= PART_BIG_KM2 ? "big" : area >= PART_MEDIUM_KM2 ? "medium" : "small";
    return {
      id: -1, owner, polys, bbox: [minX, minY, maxX, maxY], sizeU: Math.max(maxX - minX, maxY - minY),
      areaKm2: area, cx, cy, anchorX: this.polyCx[big], anchorY: this.polyCy[big], isMain: false, distKm: 0, klass,
    };
  }

  _boundarySamples(part, maxSamples) {
    const pts = [];
    let total = 0;
    for (const p of part.polys) for (const ref of this.polyRings[p][0]) total += this.arcMerc[ref < 0 ? ~ref : ref].length / 2;
    const stride = Math.max(1, Math.ceil(total / maxSamples));
    let k = 0;
    for (const p of part.polys) {
      for (const ref of this.polyRings[p][0]) {
        const m = this.arcMerc[ref < 0 ? ~ref : ref];
        for (let i = 0; i < m.length; i += 2) if (k++ % stride === 0) pts.push(m[i], m[i + 1]);
      }
    }
    return pts;
  }

  _distToSamples(part, samples) {
    if (!samples.length) return 0;
    const ck = Math.cos(latOfY(part.anchorY) * DEG);
    let best = Infinity;
    for (let i = 0; i < samples.length; i += 2) {
      let dx = Math.abs(samples[i] - part.anchorX);
      if (dx > 0.5) dx = 1 - dx;
      const dy = samples[i + 1] - part.anchorY;
      // dx — частка екватора; ×cos(lat) → справжня горизонтальна відстань; dy у Mercator ≈ dLat/cos(lat)
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best) * ck * 2 * Math.PI * EARTH_KM;
  }

  /* ---------- GeoJSON-текст для MapLibre (без проміжних JS-об'єктів) ---------- */

  _ringText(ring) {
    const parts = new Array(ring.length);
    for (let i = 0; i < ring.length; i++) {
      const ref = ring[i];
      if (ref >= 0) parts[i] = this.arcText[ref];
      else {
        const t = this.arcText[~ref]; // "[x,y],[x,y],…" → розворот пар без повторного форматування чисел
        parts[i] = "[" + t.slice(1, -1).split("],[").reverse().join("],[") + "]";
      }
    }
    return "[" + parts.join(",") + "]";
  }

  /* Області (заливка). id = індекс області → feature-state. */
  async regionsGeoJsonChunks(yieldFn = async () => {}) {
    const chunks = ['{"type":"FeatureCollection","features":['];
    for (let r = 0; r < this.regions.length; r++) {
      const reg = this.regions[r];
      const polys = reg.polys.map((p) => "[" + this.polyRings[p].map((ring) => this._ringText(ring)).join(",") + "]");
      if (!polys.length) continue;
      const geometry = `{"type":"MultiPolygon","coordinates":[${polys.join(",")}]}`;
      chunks.push(
        (chunks.length > 1 ? "," : "") +
          `{"type":"Feature","id":${r},"properties":${JSON.stringify({ iso: reg.iso })},"geometry":${geometry}}`,
      );
      if (r % 250 === 249) await yieldFn();
    }
    chunks.push("]}");
    return chunks;
  }

  /* Кордони: кожна арка — окрема лінія (id = номер арки). ia/ib — рідні iso
     двох сусідніх областей; two=0 — зовнішній контур (узбережжя). */
  async bordersGeoJsonChunks(yieldFn = async () => {}) {
    const chunks = ['{"type":"FeatureCollection","features":['];
    for (let a = 0; a < this.arcText.length; a++) {
      const ra = this.arcRegions[2 * a], rb = this.arcRegions[2 * a + 1];
      if (ra < 0) continue;
      const props = { ia: this.regions[ra].iso, ib: rb >= 0 ? this.regions[rb].iso : "", two: rb >= 0 ? 1 : 0 };
      chunks.push(
        (chunks.length > 1 ? "," : "") +
          `{"type":"Feature","id":${a},"properties":${JSON.stringify(props)},"geometry":{"type":"LineString","coordinates":[${this.arcText[a]}]}}`,
      );
      if (a % 2500 === 2499) await yieldFn();
    }
    chunks.push("]}");
    return chunks;
  }
}
