/* Прапори на території країн: чітко при будь-якому zoom, адаптивний розмір, розумна
   логіка для островів.

   ЧОМУ НЕ "ВІДРА" ФІКСОВАНОЇ РОЗДІЛЬНОЇ ЗДАТНОСТІ: раніше весь світ запікався в
   6 растрів по ~6 пікселів на градус — на великому zoom це 10-20 пікселів на
   країну → розмиття/піксельність, до того ж кожна зміна власника кодувала PNG
   усього світу. Тепер запікається ТІЛЬКИ видима частина карти (+ запас по
   краях) з роздільною здатністю екрана, прапор малюється з вектора. Після
   кожного pan/zoom (moveend) картинка перезапікається; між перезапіканнями
   MapLibre просто рухає/масштабує поточну текстуру разом із картою.

   РОЗМІР ПРАПОРА (LOD): прапор — це "штамп" з обмеженим екранним розміром. Для
   території рахується базовий розмір (покриває її, а для дуже витягнутих —
   1.8× коротшої сторони); поки штамп вужчий за S_MAX пікселів, це один прапор
   на всю територію, а далі штамп ділиться навпіл (2×2, 4×4…) — рівень LOD
   змінюється дискретно, тому прапор великої країни не "роздувається"
   на тисячі пікселів, а залишається читабельним, і сітка штампів стабільна
   між змінами рівня. Дрібні країни/далекі острови, де прапорець-заливка
   нечитабельна, отримують значок-прапорець (symbol-шар MapLibre).

   ОСТРОВИ: кожен шматок суші (зв'язна група областей одного власника)
   класифікується за площею, відстанню до головного шматка власника та
   розміром на екрані — див. partMode(). Великі близькі острови окремого
   прапора не отримують; середні — залежно від масштабу; дрібні далекі —
   значок. Кількість значків на власника й загалом обмежена. */

import { mercX, mercY, lngOfX, latOfY } from "./territory.js";

const COLS = 6; // стовпці по 60° довготи — безпечний для MapLibre розмір image-source
const COL_W = 1 / COLS;
const MAX_SIDE = 2048; // макс. сторона одного canvas, px
const PX_BUDGET = 4.5e6; // сумарний бюджет пікселів усіх canvas за одне запікання
const MIN_STEP = 0.7; // проріджування вершин: не додаємо точки ближче за це (px canvas)
const MARGIN = 0.12; // запас навколо видимої області (частка розміру вікна)
const BADGE_ZOOM_MIN = 3; // значки далеких островів — не раніше цього zoom
const MAIN_BADGE_PX = 26; // територія головного шматка вужча за це → значок
const MAX_BADGES_PER_OWNER = 3;
const MAX_BADGES_TOTAL = 80;

export const FLAG_OPACITY_EXPR = ["interpolate", ["linear"], ["zoom"], 1, 0.5, 5, 0.62, 9, 0.8];

/* ------------------------------------------------------------------ LOD */

/* Що робити з шматком суші при поточному масштабі: заливка прапором і/або значок. */
export function partMode(part, worldPx, zoom) {
  const px = part.sizeU * worldPx; // найбільший габарит шматка на екрані, css px
  if (part.isMain) return { fill: px >= 4, badge: px < MAIN_BADGE_PX };
  const far = part.distKm;
  if (part.klass === "big") {
    // великий острів поруч з материком — окремий прапор не потрібен; а ось
    // великий ексклав/заморська територія (Аляска, Гаваї) — потрібен
    if (far >= 2500) return { fill: px >= 8, badge: px < 8 && zoom >= BADGE_ZOOM_MIN };
    return { fill: false, badge: false };
  }
  if (part.klass === "medium") {
    if (far >= 1200) return { fill: px >= 22, badge: px < 22 && zoom >= BADGE_ZOOM_MIN };
    return { fill: px >= 80, badge: false };
  }
  if (far >= 500) return { fill: px >= 40, badge: px < 40 && zoom >= BADGE_ZOOM_MIN + 0.2 };
  return { fill: px >= 120, badge: false };
}

/* Сітка штампів прапора для шматка: розмір S у світових одиницях, кількість рядків/стовпців. */
export function stampLayout(part, worldPx, shaped, sMaxCss) {
  const [x0, y0, x1, y1] = part.bbox;
  const W = Math.max(x1 - x0, 1e-9), H = Math.max(y1 - y0, 1e-9);
  const longPx = Math.max(W, H) * worldPx;
  const shortPx = Math.max(Math.min(W, H) * worldPx, 1e-6);
  const aspect = longPx / shortPx;
  // звичайний прапор покриває територію (cover); дуже витягнуту — штамп 1.8× коротшої сторони;
  // нестандартний (Непал) вписується цілком у коротшу сторону
  let basePx = shaped ? shortPx : aspect <= 2.2 ? longPx : shortPx * 1.8;
  basePx = Math.max(basePx, 4);
  const level = Math.max(0, Math.ceil(Math.log2(basePx / sMaxCss)));
  const S = basePx / Math.pow(2, level) / worldPx;
  const cols = Math.max(1, Math.ceil(W / S - 1e-6));
  const rows = Math.max(1, Math.ceil(H / S - 1e-6));
  return { S, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cols, rows, level };
}

/* ------------------------------------------------------------ геометрія */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Sutherland–Hodgman: обрізання багатокутника прямокутником (для величезних
   координат на великих zoom — щоб canvas не отримував мільйони пікселів). */
function clipToRect(pts, xmin, ymin, xmax, ymax) {
  let poly = pts;
  for (let edge = 0; edge < 4 && poly.length; edge++) {
    const out = [];
    const n = poly.length / 2;
    let px = poly[2 * (n - 1)], py = poly[2 * (n - 1) + 1];
    const inside = (x, y) => (edge === 0 ? x >= xmin : edge === 1 ? x <= xmax : edge === 2 ? y >= ymin : y <= ymax);
    let pin = inside(px, py);
    for (let i = 0; i < n; i++) {
      const cx = poly[2 * i], cy = poly[2 * i + 1];
      const cin = inside(cx, cy);
      if (cin !== pin) {
        let t;
        if (edge === 0) t = (xmin - px) / (cx - px);
        else if (edge === 1) t = (xmax - px) / (cx - px);
        else if (edge === 2) t = (ymin - py) / (cy - py);
        else t = (ymax - py) / (cy - py);
        out.push(px + (cx - px) * t, py + (cy - py) * t);
      }
      if (cin) out.push(cx, cy);
      px = cx; py = cy; pin = cin;
    }
    poly = out;
  }
  return poly;
}

function canvasToUrl(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png")), "image/png");
    } else resolve(canvas.toDataURL("image/png"));
  });
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ------------------------------------------------------------ шар прапорів */

export class FlagOverlay {
  constructor({ map, territory, flags, beforeLayerId = null, onStats = null }) {
    this.map = map;
    this.territory = territory;
    this.flags = flags;
    this.beforeLayerId = beforeLayerId;
    this.onStats = onStats;
    this.canvases = new Array(COLS).fill(null);
    this.urls = Array.from({ length: COLS }, () => []);
    this.token = 0;
    this.timer = null;
    this.destroyed = false;
    this.quality = 1;
    this.stats = {};
    this._onMoveEnd = () => this.requestBake(90);
    this._onResize = () => this.requestBake(160);
    this._onVisibility = () => { if (!document.hidden) this.requestBake(60); };
  }

  attach() {
    const map = this.map;
    if (!map.getSource("flag-badges")) {
      map.addSource("flag-badges", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "flag-badges",
        type: "symbol",
        source: "flag-badges",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.36, 5, 0.44, 9, 0.54],
          "icon-allow-overlap": false,
          "icon-ignore-placement": false,
          "icon-padding": 2,
          "symbol-sort-key": ["get", "k"],
        },
      });
    }
    map.on("moveend", this._onMoveEnd);
    map.on("resize", this._onResize);
    document.addEventListener("visibilitychange", this._onVisibility);
  }

  destroy() {
    this.destroyed = true;
    this.token += 1;
    if (this.timer) clearTimeout(this.timer);
    try {
      this.map.off("moveend", this._onMoveEnd);
      this.map.off("resize", this._onResize);
    } catch { /* карту вже знищено */ }
    document.removeEventListener("visibilitychange", this._onVisibility);
    this.urls.forEach((list) => list.forEach((u) => URL.revokeObjectURL(u)));
  }

  requestBake(delay = 120) {
    if (this.destroyed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (document.hidden) return;
      this.bake().catch((err) => console.warn("Запікання прапорів не вдалось:", err));
    }, delay);
  }

  /* Одне запікання: видима область → canvas-и по стовпцях → image-source-и + значки. */
  async bake() {
    if (this.destroyed) return;
    const token = ++this.token;
    const t0 = performance.now();
    const { map, territory, flags } = this;

    const zoom = map.getZoom();
    const gl = map.getCanvas();
    const cssW = gl.clientWidth || 360, cssH = gl.clientHeight || 640;
    const worldPx = 512 * Math.pow(2, zoom);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const sMaxCss = clamp(0.85 * Math.min(cssW, cssH), 220, 380);

    const b = map.getBounds();
    let x0 = mercX(clamp(b.getWest(), -180, 180)), x1 = mercX(clamp(b.getEast(), -180, 180));
    let y0 = mercY(b.getNorth()), y1 = mercY(b.getSouth());
    const mx = (x1 - x0) * MARGIN, my = (y1 - y0) * MARGIN;
    x0 = Math.max(0, x0 - mx); x1 = Math.min(1, x1 + mx);
    y0 = Math.max(0, y0 - my); y1 = Math.min(1, y1 + my);
    if (x1 <= x0 || y1 <= y0) return;

    // стовпці й масштаб (бюджет пікселів)
    const cols = [];
    let totalPx = 0, maxSide = 0;
    for (let c = 0; c < COLS; c++) {
      const cx0 = Math.max(x0, c * COL_W), cx1 = Math.min(x1, (c + 1) * COL_W);
      if (cx1 - cx0 < 1e-7) continue;
      const wp = (cx1 - cx0) * worldPx * dpr, hp = (y1 - y0) * worldPx * dpr;
      cols.push({ c, cx0, cx1 });
      totalPx += wp * hp;
      maxSide = Math.max(maxSide, wp, hp);
    }
    if (!cols.length) return;
    const res = Math.min(1, Math.sqrt(PX_BUDGET / totalPx), MAX_SIDE / maxSide) * this.quality;
    const s = worldPx * dpr * res; // пікселів canvas на одну світову одиницю

    // шматки, що потрапляють у видиму область, і що з ними робити
    const visible = [];
    for (const part of territory.parts) {
      const [bx0, by0, bx1, by1] = part.bbox;
      if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1) continue;
      const mode = partMode(part, worldPx, zoom);
      if (mode.fill || mode.badge) visible.push({ part, mode });
    }

    let stampCount = 0;
    const published = [];
    for (const col of cols) {
      if (token !== this.token) return; // запущено новіше запікання
      const W = Math.max(1, Math.round((col.cx1 - col.cx0) * s));
      const H = Math.max(1, Math.round((y1 - y0) * s));
      const rect = { rx0: col.cx0, ry0: y0, rx1: col.cx0 + W / s, ry1: y0 + H / s };
      let canvas = this.canvases[col.c];
      if (!canvas) canvas = this.canvases[col.c] = document.createElement("canvas");
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const view = { ...rect, s, W, H, worldPx, sMaxCss };

      let sliceStart = performance.now();
      for (const { part, mode } of visible) {
        if (!mode.fill) continue;
        const [bx0, by0, bx1, by1] = part.bbox;
        if (bx1 < rect.rx0 || bx0 > rect.rx1 || by1 < rect.ry0 || by0 > rect.ry1) continue;
        try {
          stampCount += this._drawPart(ctx, part, view);
        } catch (err) {
          console.warn("Пропускаю прапор шматка", part.owner, err);
        }
        // не блокуємо головний потік довше ~12 мс поспіль: інтерфейс і жести лишаються плавними
        if (performance.now() - sliceStart > 12) {
          await nextTick();
          if (token !== this.token) return;
          sliceStart = performance.now();
        }
      }
      published.push({ col, canvas, rect });
      await nextTick();
    }
    if (token !== this.token) return;

    // публікація в MapLibre
    const used = new Set();
    for (const { col, canvas, rect } of published) {
      const url = await canvasToUrl(canvas);
      if (token !== this.token) { URL.revokeObjectURL(url); return; }
      this._publish(col.c, url, rect);
      used.add(col.c);
    }
    for (let c = 0; c < COLS; c++) {
      if (!used.has(c) && this.map.getLayer(`flagov-${c}-layer`)) this.map.setLayoutProperty(`flagov-${c}-layer`, "visibility", "none");
    }

    const badgeCount = await this._publishBadges(visible, { x0, y0, x1, y1 }, token);
    flags.endEpoch();

    const ms = performance.now() - t0;
    // адаптація: на слабких пристроях зменшуємо роздільність наступних запікань
    if (ms > 450) this.quality = Math.max(0.55, this.quality * 0.85);
    else if (ms < 150 && this.quality < 1) this.quality = Math.min(1, this.quality * 1.1);
    this.stats = { ms: Math.round(ms), columns: published.length, stamps: stampCount, badges: badgeCount, parts: visible.length, zoom, res: +res.toFixed(2) };
    if (this.onStats) this.onStats(this.stats);
  }

  _drawPart(ctx, part, view) {
    const { territory, flags } = this;
    const { rx0, ry0, rx1, ry1, s, W, H } = view;
    const pad = 3 / s;
    ctx.beginPath();
    let any = false;
    for (const p of part.polys) {
      const o = 4 * p, bb = territory.polyBBox;
      if (bb[o + 2] < rx0 - pad || bb[o] > rx1 + pad || bb[o + 3] < ry0 - pad || bb[o + 1] > ry1 + pad) continue;
      for (const ring of territory.polyRings[p]) {
        const pts = this._ringPixels(ring, rx0, ry0, s);
        if (pts.length < 6) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          if (pts[i] < minX) minX = pts[i];
          if (pts[i] > maxX) maxX = pts[i];
          if (pts[i + 1] < minY) minY = pts[i + 1];
          if (pts[i + 1] > maxY) maxY = pts[i + 1];
        }
        let use = pts;
        if (minX < -3e4 || minY < -3e4 || maxX > W + 3e4 || maxY > H + 3e4) use = clipToRect(pts, -64, -64, W + 64, H + 64);
        if (use.length < 6) continue;
        ctx.moveTo(use[0], use[1]);
        for (let i = 2; i < use.length; i += 2) ctx.lineTo(use[i], use[i + 1]);
        ctx.closePath();
        any = true;
      }
    }
    if (!any) return 0;

    const iso = String(part.owner).toLowerCase();
    if (!flags.has(iso)) return 0;
    const info = flags.info.get(iso);
    const layout = stampLayout(part, view.worldPx, info.shaped, view.sMaxCss);
    // нестандартний прапор на невеликому шматку — ОДИН прапор по центру (вписаний цілком),
    // решта території заливається кольором поля прапора (Непал: малиновий)
    if (info.shaped && layout.level === 0) { layout.cols = 1; layout.rows = 1; }

    ctx.save();
    ctx.clip();
    if (info.shaped) {
      ctx.fillStyle = info.field;
      ctx.fillRect(0, 0, W, H);
    }
    let drawn = 0;
    const { S, cx, cy, cols, rows } = layout;
    // видимі індекси сітки
    const i0 = Math.max(0, Math.floor((rx0 - cx) / S + (cols - 1) / 2 - 0.5)), i1 = Math.min(cols - 1, Math.ceil((rx1 - cx) / S + (cols - 1) / 2 + 0.5));
    const j0 = Math.max(0, Math.floor((ry0 - cy) / S + (rows - 1) / 2 - 0.5)), j1 = Math.min(rows - 1, Math.ceil((ry1 - cy) / S + (rows - 1) / 2 + 0.5));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const sx = cx + (i - (cols - 1) / 2) * S, sy = cy + (j - (rows - 1) / 2) * S;
        // цілі пікселі — без швів між сусідніми штампами
        const px0 = Math.floor((sx - S / 2 - rx0) * s), py0 = Math.floor((sy - S / 2 - ry0) * s);
        const px1 = Math.ceil((sx + S / 2 - rx0) * s), py1 = Math.ceil((sy + S / 2 - ry0) * s);
        if (px1 < 0 || py1 < 0 || px0 > W || py0 > H) continue;
        const size = Math.max(px1 - px0, py1 - py0);
        if (flags.stamp(ctx, iso, px0, py0, size, size)) drawn += 1;
      }
    }
    ctx.restore();
    return drawn;
  }

  /* Кільце арок → плоский масив пікселів canvas із проріджуванням. */
  _ringPixels(ring, rx0, ry0, s) {
    const { arcMerc } = this.territory;
    const out = [];
    let lx = NaN, ly = NaN;
    for (let k = 0; k < ring.length; k++) {
      const ref = ring[k];
      const m = arcMerc[ref < 0 ? ~ref : ref];
      const n = m.length >> 1;
      if (ref >= 0) {
        for (let i = 0; i < n; i++) {
          const px = (m[2 * i] - rx0) * s, py = (m[2 * i + 1] - ry0) * s;
          if (!out.length || Math.abs(px - lx) + Math.abs(py - ly) >= MIN_STEP) { out.push(px, py); lx = px; ly = py; }
        }
      } else {
        for (let i = n - 1; i >= 0; i--) {
          const px = (m[2 * i] - rx0) * s, py = (m[2 * i + 1] - ry0) * s;
          if (!out.length || Math.abs(px - lx) + Math.abs(py - ly) >= MIN_STEP) { out.push(px, py); lx = px; ly = py; }
        }
      }
    }
    return out;
  }

  _publish(col, url, rect) {
    const map = this.map;
    const id = `flagov-${col}`;
    const layerId = `${id}-layer`;
    const coordinates = [
      [lngOfX(rect.rx0), latOfY(rect.ry0)],
      [lngOfX(rect.rx1), latOfY(rect.ry0)],
      [lngOfX(rect.rx1), latOfY(rect.ry1)],
      [lngOfX(rect.rx0), latOfY(rect.ry1)],
    ];
    const source = map.getSource(id);
    if (source && typeof source.updateImage === "function") {
      source.updateImage({ url, coordinates });
      map.setLayoutProperty(layerId, "visibility", "visible");
    } else {
      map.addSource(id, { type: "image", url, coordinates });
      const layer = {
        id: layerId,
        type: "raster",
        source: id,
        paint: { "raster-opacity": FLAG_OPACITY_EXPR, "raster-fade-duration": 0 },
      };
      if (this.beforeLayerId && map.getLayer(this.beforeLayerId)) map.addLayer(layer, this.beforeLayerId);
      else map.addLayer(layer);
    }
    // blob-URL попередніх запікань звільняємо із запізненням — MapLibre мав час їх прочитати
    const list = this.urls[col];
    list.push(url);
    while (list.length > 2) URL.revokeObjectURL(list.shift());
  }

  async _publishBadges(visible, view, token) {
    const { map, territory, flags } = this;
    const source = map.getSource("flag-badges");
    if (!source) return 0;
    const byOwner = new Map();
    for (const { part, mode } of visible) {
      if (!mode.badge) continue;
      const iso = String(part.owner).toLowerCase();
      if (!flags.has(iso)) continue;
      const ax = part.anchorX, ay = part.anchorY;
      if (ax < view.x0 || ax > view.x1 || ay < view.y0 || ay > view.y1) continue;
      let list = byOwner.get(part.owner);
      if (!list) byOwner.set(part.owner, (list = []));
      list.push(part);
    }
    const picked = [];
    for (const [owner, list] of byOwner) {
      list.sort((a, b) => (b.isMain - a.isMain) || (b.distKm * Math.log10(b.areaKm2 + 10) - a.distKm * Math.log10(a.areaKm2 + 10)));
      for (const part of list.slice(0, MAX_BADGES_PER_OWNER)) picked.push({ owner, part });
    }
    picked.sort((a, b) => b.part.areaKm2 - a.part.areaKm2);
    const features = [];
    let sliceStart = performance.now();
    let rank = 0;
    for (const { owner, part } of picked.slice(0, MAX_BADGES_TOTAL)) {
      const iso = String(owner).toLowerCase();
      const imageId = `fb-${iso}`;
      if (!map.hasImage(imageId)) {
        const data = flags.badgeImageData(iso);
        if (data) map.addImage(imageId, data, { pixelRatio: 2 });
        if (performance.now() - sliceStart > 10) {
          await nextTick();
          if (token !== this.token) return 0;
          sliceStart = performance.now();
        }
      }
      if (!map.hasImage(imageId)) continue;
      features.push({
        type: "Feature",
        properties: { icon: imageId, k: rank++, owner },
        geometry: { type: "Point", coordinates: [lngOfX(part.anchorX), latOfY(part.anchorY)] },
      });
    }
    source.setData({ type: "FeatureCollection", features });
    return features.length;
  }
}
