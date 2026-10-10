/* Прапори на територіях країн: один цілий прапор на територію, чітко при будь-якому
   zoom, значки для дрібних країн і далеких островів.

   ДВА ШАРИ (обидва — image-source у MapLibre, тож рухаються/масштабуються разом з картою):
   • БАЗОВИЙ — увесь світ у помірній роздільності (≈2046 px по ширині). Запікається один раз
     (і після змін власників), тому під час руху/масштабування НІКОЛИ не видно "голих" зелених
     територій — у гіршому разі прапор тимчасово трохи м'якший.
   • ДЕТАЛЬНИЙ (zoom ≥ 3) — лише видима частина карти + запас по краях, у роздільності екрана,
     прапор малюється з вектора. Перезапікається після кожного pan/zoom (moveend) і лягає
     поверх базового; між перезапіканнями MapLibre просто рухає поточну текстуру.
   Обидва шари непрозорі всередині території: колір суші й прапор змішуються вже на canvas
   (прапор з прозорістю поверх кольору суші), тому деталь точно замінює базу без накладання
   двох напівпрозорих шарів.

   РОЗМІР ПРАПОРА (адаптивний): на кожен шматок суші — ОДИН цілий прапор, без повторень.
   • Поки територія порівнянна з екраном — прапор розтягується на весь її габарит.
   • Коли територія значно більша за екран (ми "всередині" країни) — прапор підганяється під
     ВИДИМУ її частину, тож на екрані завжди читабельний цілий прапор, а не суцільна смуга
     одного кольору. Це перераховується лише коли видима область справді вийшла за межі
     запеченої (або zoom змінився суттєво), тому між жестами прапор не "стрибає".
   • Розтягнення квадратного прапора обмежене 1.8× (дуже витягнуті області обрізаються).
   • Нестандартні прапори (Непал) вписуються цілком.
   Малюється лише частина прапора, що потрапляє на canvas, тож при великому збільшенні пам'ять
   і час малювання обмежені розміром екрана, а не розміром країни.

   ОСТРОВИ І ДРІБНІ КРАЇНИ: кожен шматок суші (зв'язна група областей одного власника)
   класифікується за площею, відстанню до головного шматка власника та розміром на екрані —
   див. partMode(). Великі острови поряд з материком окремого прапора не отримують; середні —
   залежно від масштабу; дрібні далекі та мікродержави — значок-прапорець (symbol-шар
   MapLibre, з обмеженням кількості на власника й загалом). */

import { mercX, mercY, lngOfX, latOfY } from "./territory.js";

const COLS = 6; // стовпці по 60° довготи — безпечний для MapLibre розмір image-source
const COL_W = 1 / COLS;
const MAX_SIDE = 2048; // макс. сторона одного canvas деталі, px
const MIN_STEP = 0.7; // проріджування вершин: не додаємо точки ближче за це (px canvas)
const DETAIL_MIN_ZOOM = 3; // нижче — достатньо базового шару
const MARGINS = [0.25, 0.15, 0.08]; // запас навколо видимої області (бажаний → мінімальний, якщо не влізає в бюджет)
const WINDOW_RATIO = 1.5; // територія більша за запечену область у стільки разів → прапор підганяється під видиму частину
const REBAKE_ZOOM_DELTA = 0.35; // на скільки має змінитись zoom, щоб перезапекти деталь (інакше лише рухаємо текстуру)
const MAX_FLAG_DISTORTION = 1.8; // наскільки можна розтягнути квадратний прапор під габарит території
const BADGE_ZOOM_MIN = 3; // значки далеких островів — не раніше цього zoom
const MAIN_BADGE_PX = 26; // територія головного шматка вужча за це → значок
const MAX_BADGES_PER_OWNER = 3;
const MAX_BADGES_TOTAL = 80;
const BASE_MODE_ZOOM = 2; // за яким масштабом приймаємо рішення "малювати/ні" для базового шару

// Бюджети пам'яті: на пристроях із ≤4 ГБ (багато Android-телефонів у Telegram) — скромніші.
const LOW_MEMORY = typeof navigator !== "undefined" && Number(navigator.deviceMemory || 4) <= 4;
const PX_BUDGET = LOW_MEMORY ? 2.2e6 : 4.5e6; // сумарні пікселі canvas деталі за одне запікання
const BASE_WORLD_PX = LOW_MEMORY ? 1536 : 2046; // ширина всього світу в базовому шарі (ділиться на 6)
const BASE_ROWS = [[0, 0.5], [0.5, 1]]; // базовий шар ділимо навпіл по висоті — кожен image-source менший за світ

/* Прозорість прапора поверх суші залежить від zoom: здалеку м'якше, ближче — виразніше. */
export function flagAlpha(zoom) {
  const stops = [[1, 0.5], [5, 0.62], [9, 0.8]];
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (zoom <= stops[i][0]) {
      const [z0, a0] = stops[i - 1], [z1, a1] = stops[i];
      return a0 + ((a1 - a0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return stops[stops.length - 1][1];
}

/* ------------------------------------------------------------------ LOD */

/* Що робити з шматком суші при поточному масштабі: заливка прапором і/або значок. */
export function partMode(part, worldPx, zoom) {
  const px = part.sizeU * worldPx; // найбільший габарит шматка на екрані, css px
  if (part.isMain) return { fill: px >= 4, badge: px < MAIN_BADGE_PX };
  const far = part.distKm;
  if (part.klass === "big") {
    // великий острів поряд з материком — окремий прапор не потрібен; а ось
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

/* Прямокутник прапора (у світових одиницях) для габариту box = [x0,y0,x1,y1]: ОДИН прапор на
   весь габарит. Квадратний прапор розтягується на габарит, але не більш ніж у MAX_FLAG_DISTORTION
   разів — для дуже витягнутих габаритів прапор лишається "майже пропорційним" і покриває габарит
   (зайве обрізається контуром країни). Нестандартний прапор вписується цілком у коротшу сторону. */
export function flagPlacement(box, shaped) {
  const [x0, y0, x1, y1] = box;
  const W = Math.max(x1 - x0, 1e-9), H = Math.max(y1 - y0, 1e-9);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (shaped) {
    const side = Math.min(W, H);
    return { cx, cy, w: side, h: side };
  }
  return { cx, cy, w: Math.max(W, H / MAX_FLAG_DISTORTION), h: Math.max(H, W / MAX_FLAG_DISTORTION) };
}

/* Габарит шматка, під який підганяється прапор: увесь, якщо він порівнянний із запеченою
   областю; інакше — лише його перетин із нею (видима частина). */
export function flagBox(bbox, extent) {
  const [x0, y0, x1, y1] = bbox;
  const ratio = Math.max((x1 - x0) / (extent.x1 - extent.x0), (y1 - y0) / (extent.y1 - extent.y0));
  if (ratio <= WINDOW_RATIO) return bbox;
  const ix0 = Math.max(x0, extent.x0), iy0 = Math.max(y0, extent.y0), ix1 = Math.min(x1, extent.x1), iy1 = Math.min(y1, extent.y1);
  return ix1 > ix0 && iy1 > iy0 ? [ix0, iy0, ix1, iy1] : bbox;
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

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mixColors = (a, b, t) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
};

/* ------------------------------------------------------------ шар прапорів */

export class FlagOverlay {
  /* colors: { water, neutral, mine, landOpacity } — кольори суші як у заливці regions-fill. */
  constructor({ map, territory, flags, beforeLayerId = null, colors, getMyCountry = () => "", onStats = null }) {
    this.map = map;
    this.territory = territory;
    this.flags = flags;
    this.beforeLayerId = beforeLayerId;
    this.onStats = onStats;
    this.getMyCountry = getMyCountry;
    this.land = {
      neutral: mixColors(colors.water, colors.neutral, colors.landOpacity),
      mine: mixColors(colors.water, colors.mine, colors.landOpacity),
    };
    this.canvases = { base: new Map(), detail: new Map() };
    this.urls = { base: new Map(), detail: new Map() };
    this.layerIds = { base: new Set(), detail: new Set() };
    this.tokens = { base: 0, detail: 0 };
    this.timers = { base: null, detail: null };
    this.destroyed = false;
    this.quality = 1;
    this.dirty = true; // потрібне повне перезапікання деталі (власники/колір змінились)
    this.last = null; // { extent, zoom } останнього запікання деталі
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
    this.tokens.base += 1;
    this.tokens.detail += 1;
    for (const k of ["base", "detail"]) {
      if (this.timers[k]) clearTimeout(this.timers[k]);
      this.urls[k].forEach((list) => list.forEach((u) => URL.revokeObjectURL(u)));
    }
    try {
      this.map.off("moveend", this._onMoveEnd);
      this.map.off("resize", this._onResize);
    } catch { /* карту вже знищено */ }
    document.removeEventListener("visibilitychange", this._onVisibility);
  }

  /* Перше повне запікання: база + деталь. */
  async bakeAll() {
    await this.bakeBase();
    await this.bake();
  }

  /* Власники/колір "мого" змінились — базу й деталь треба перемалювати. */
  invalidate() {
    this.dirty = true;
    this.requestBaseBake(700);
    this.requestBake(220);
  }

  requestBake(delay = 120) {
    this._schedule("detail", delay, () => this.bake());
  }

  requestBaseBake(delay = 700) {
    this._schedule("base", delay, () => this.bakeBase());
  }

  _schedule(kind, delay, job) {
    if (this.destroyed) return;
    if (this.timers[kind]) clearTimeout(this.timers[kind]);
    this.timers[kind] = setTimeout(() => {
      this.timers[kind] = null;
      if (document.hidden) return;
      job().catch((err) => console.warn("Запікання прапорів не вдалось:", err));
    }, delay);
  }

  /* ---------------------------------------------------------------- база */

  async bakeBase() {
    if (this.destroyed) return;
    const token = ++this.tokens.base;
    const t0 = performance.now();
    const items = [];
    for (const part of this.territory.parts) if (partMode(part, BASE_WORLD_PX, BASE_MODE_ZOOM).fill) items.push({ part, box: part.bbox });
    const cells = [];
    for (let c = 0; c < COLS; c++) for (let r = 0; r < BASE_ROWS.length; r++) cells.push({ id: `${c}-${r}`, x0: c * COL_W, x1: (c + 1) * COL_W, y0: BASE_ROWS[r][0], y1: BASE_ROWS[r][1] });
    const res = await this._bakeCells("base", token, { cells, s: BASE_WORLD_PX, items, alpha: flagAlpha(BASE_MODE_ZOOM) });
    if (!res) return;
    this.stats.base = { ms: Math.round(performance.now() - t0), cells: res.cells, parts: items.length, flags: res.flags };
  }

  /* -------------------------------------------------------------- деталь */

  /* Одне запікання деталі: видима область → canvas-и по стовпцях → image-source-и; плюс значки. */
  async bake() {
    if (this.destroyed) return;
    const token = ++this.tokens.detail;
    const t0 = performance.now();
    const { map, territory, flags } = this;

    const zoom = map.getZoom();
    const gl = map.getCanvas();
    const cssW = gl.clientWidth || 360, cssH = gl.clientHeight || 640;
    const worldPx = 512 * Math.pow(2, zoom);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const b = map.getBounds();
    const bx0 = mercX(clamp(b.getWest(), -180, 180)), bx1 = mercX(clamp(b.getEast(), -180, 180));
    const by0 = mercY(b.getNorth()), by1 = mercY(b.getSouth());
    if (!(cssW > 0 && cssH > 0) || bx1 <= bx0 || by1 <= by0) return;

    // що видно (з невеликим запасом) і що з цим робити
    const padX = (bx1 - bx0) * 0.5, padY = (by1 - by0) * 0.5;
    const vis = { x0: bx0 - padX, x1: bx1 + padX, y0: by0 - padY, y1: by1 + padY };
    const visible = [];
    for (const part of territory.parts) {
      const [px0, py0, px1, py1] = part.bbox;
      if (px1 < vis.x0 || px0 > vis.x1 || py1 < vis.y0 || py0 > vis.y1) continue;
      const mode = partMode(part, worldPx, zoom);
      if (mode.fill || mode.badge) visible.push({ part, mode });
    }

    // значки потрібні на будь-якому zoom (дрібні країни на світовому плані)
    const badgeCount = await this._publishBadges(visible, { x0: bx0, y0: by0, x1: bx1, y1: by1 }, token);
    if (token !== this.tokens.detail) return;

    if (zoom < DETAIL_MIN_ZOOM) {
      this._hideKind("detail");
      this.last = null;
      this.stats.detail = { ms: Math.round(performance.now() - t0), skipped: "zoom<" + DETAIL_MIN_ZOOM, badges: badgeCount, zoom };
      if (this.onStats) this.onStats(this.stats);
      return;
    }

    // видима область ще всередині запеченої, zoom майже не змінився й нічого не змінювалось —
    // текстура лишається, MapLibre просто рухає її разом із картою (прапор не "стрибає")
    const last = this.last;
    if (!this.dirty && last && Math.abs(zoom - last.zoom) < REBAKE_ZOOM_DELTA
      && bx0 >= last.extent.x0 && bx1 <= last.extent.x1 && by0 >= last.extent.y0 && by1 <= last.extent.y1) {
      this.stats.detail = { ...this.stats.detail, reused: true, badges: badgeCount, zoom };
      return;
    }

    // запас навколо вікна: бажаний, а якщо не влізає в бюджет пікселів — менший
    let layout = null;
    for (let i = 0; i < MARGINS.length; i++) {
      const mx = (bx1 - bx0) * MARGINS[i], my = (by1 - by0) * MARGINS[i];
      const x0 = Math.max(0, bx0 - mx), x1 = Math.min(1, bx1 + mx), y0 = Math.max(0, by0 - my), y1 = Math.min(1, by1 + my);
      const cells = [];
      let totalPx = 0, maxSide = 0;
      for (let c = 0; c < COLS; c++) {
        const cx0 = Math.max(x0, c * COL_W), cx1 = Math.min(x1, (c + 1) * COL_W);
        if (cx1 - cx0 < 1e-7) continue;
        cells.push({ id: String(c), x0: cx0, x1: cx1, y0, y1 });
        const wp = (cx1 - cx0) * worldPx * dpr, hp = (y1 - y0) * worldPx * dpr;
        totalPx += wp * hp;
        maxSide = Math.max(maxSide, wp, hp);
      }
      if (!cells.length) return;
      const res = Math.min(1, Math.sqrt(PX_BUDGET / totalPx), MAX_SIDE / maxSide);
      layout = { cells, res, margin: MARGINS[i], extent: { x0, x1, y0, y1 } };
      if (res >= 0.999) break;
    }
    const s = worldPx * dpr * layout.res * this.quality; // пікселів canvas на одну світову одиницю
    const items = visible.filter((v) => v.mode.fill).map(({ part }) => ({ part, box: flagBox(part.bbox, layout.extent) }));
    const res = await this._bakeCells("detail", token, { cells: layout.cells, s, items, alpha: flagAlpha(zoom) });
    if (!res) return;
    this.dirty = false;
    this.last = { extent: layout.extent, zoom };

    flags.endEpoch();
    const ms = performance.now() - t0;
    // адаптація: на слабких пристроях зменшуємо роздільність наступних запікань
    if (ms > 450) this.quality = Math.max(0.55, this.quality * 0.85);
    else if (ms < 150 && this.quality < 1) this.quality = Math.min(1, this.quality * 1.1);
    this.stats.detail = { ms: Math.round(ms), columns: res.cells, flags: res.flags, badges: badgeCount, parts: items.length, zoom, res: +layout.res.toFixed(2), margin: layout.margin };
    if (this.onStats) this.onStats(this.stats);
  }

  /* ------------------------------------------------- спільне запікання */

  /* Запікає прямокутні комірки (x0..x1 × y0..y1 у нормалізованому Mercator) у canvas-и з
     масштабом s (px на одиницю) і публікує їх як image-source-и виду kind ("base"/"detail"). */
  async _bakeCells(kind, token, { cells, s, items, alpha }) {
    const published = [];
    let flagCount = 0;
    for (const cell of cells) {
      if (token !== this.tokens[kind]) return null; // запущено новіше запікання
      const W = Math.max(1, Math.round((cell.x1 - cell.x0) * s)), H = Math.max(1, Math.round((cell.y1 - cell.y0) * s));
      let canvas = this.canvases[kind].get(cell.id);
      if (!canvas) { canvas = document.createElement("canvas"); this.canvases[kind].set(cell.id, canvas); }
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // точні масштаби по осях: комірка рівно покриває свій прямокутник (без щілин між сусідніми)
      const view = { rx0: cell.x0, ry0: cell.y0, rx1: cell.x1, ry1: cell.y1, sx: W / (cell.x1 - cell.x0), sy: H / (cell.y1 - cell.y0), W, H };
      let drawn = 0;
      let sliceStart = performance.now();
      for (const item of items) {
        const [bx0, by0, bx1, by1] = item.part.bbox;
        if (bx1 < view.rx0 || bx0 > view.rx1 || by1 < view.ry0 || by0 > view.ry1) continue;
        try {
          drawn += this._drawPart(ctx, item, view, alpha);
        } catch (err) {
          console.warn("Пропускаю прапор шматка", item.part.owner, err);
        }
        // не блокуємо головний потік довше ~12 мс поспіль: інтерфейс і жести лишаються плавними
        if (performance.now() - sliceStart > 12) {
          await nextTick();
          if (token !== this.tokens[kind]) return null;
          sliceStart = performance.now();
        }
      }
      flagCount += drawn;
      published.push({ id: cell.id, canvas, cell, drawn });
      await nextTick();
    }
    if (token !== this.tokens[kind]) return null;

    const used = new Set();
    for (const { id, canvas, cell, drawn } of published) {
      if (!drawn && kind === "base") continue; // порожню комірку бази не публікуємо
      const url = await canvasToUrl(canvas);
      if (token !== this.tokens[kind]) { URL.revokeObjectURL(url); return null; }
      this._publish(kind, id, url, cell);
      used.add(id);
    }
    this._hideKind(kind, used);
    if (kind === "base") this._releaseCanvases("base"); // база статична до наступної зміни — пам'ять canvas звільняємо
    return { cells: used.size, flags: flagCount };
  }

  /* Малює один шматок: суша під прапором + прапор, обрізані контуром шматка. Повертає 1, якщо намальовано. */
  _drawPart(ctx, { part, box }, view, alpha) {
    const { territory, flags } = this;
    const { rx0, ry0, rx1, ry1, sx, sy, W, H } = view;
    const iso = String(part.owner).toLowerCase();
    const info = flags.info.get(iso);
    if (!info) return 0;

    const padX = 3 / sx, padY = 3 / sy;
    ctx.beginPath();
    let any = false;
    for (const p of part.polys) {
      const o = 4 * p, bb = territory.polyBBox;
      if (bb[o + 2] < rx0 - padX || bb[o] > rx1 + padX || bb[o + 3] < ry0 - padY || bb[o + 1] > ry1 + padY) continue;
      for (const ring of territory.polyRings[p]) {
        const pts = this._ringPixels(ring, rx0, ry0, sx, sy);
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

    const mine = this.getMyCountry();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = mine && part.owner === mine ? this.land.mine : this.land.neutral; // непрозора суша під прапором
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    if (info.shaped) { // нестандартний прапор: решта території — кольором поля прапора
      ctx.fillStyle = info.field;
      ctx.fillRect(0, 0, W, H);
    }
    const place = flagPlacement(box, info.shaped);
    const ok = flags.drawFlag(ctx, iso, (place.cx - place.w / 2 - rx0) * sx, (place.cy - place.h / 2 - ry0) * sy, place.w * sx, place.h * sy, W, H);
    ctx.restore();
    return ok ? 1 : 0;
  }

  /* Кільце арок → плоский масив пікселів canvas із проріджуванням. */
  _ringPixels(ring, rx0, ry0, sx, sy) {
    const { arcMerc } = this.territory;
    const out = [];
    let lx = NaN, ly = NaN;
    for (let k = 0; k < ring.length; k++) {
      const ref = ring[k];
      const m = arcMerc[ref < 0 ? ~ref : ref];
      const n = m.length >> 1;
      if (ref >= 0) {
        for (let i = 0; i < n; i++) {
          const px = (m[2 * i] - rx0) * sx, py = (m[2 * i + 1] - ry0) * sy;
          if (!out.length || Math.abs(px - lx) + Math.abs(py - ly) >= MIN_STEP) { out.push(px, py); lx = px; ly = py; }
        }
      } else {
        for (let i = n - 1; i >= 0; i--) {
          const px = (m[2 * i] - rx0) * sx, py = (m[2 * i + 1] - ry0) * sy;
          if (!out.length || Math.abs(px - lx) + Math.abs(py - ly) >= MIN_STEP) { out.push(px, py); lx = px; ly = py; }
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------ публікація в MapLibre */

  _publish(kind, id, url, cell) {
    const map = this.map;
    const sourceId = `flag${kind}-${id}`;
    const layerId = `${sourceId}-layer`;
    const coordinates = [
      [lngOfX(cell.x0), latOfY(cell.y0)],
      [lngOfX(cell.x1), latOfY(cell.y0)],
      [lngOfX(cell.x1), latOfY(cell.y1)],
      [lngOfX(cell.x0), latOfY(cell.y1)],
    ];
    const source = map.getSource(sourceId);
    if (source && typeof source.updateImage === "function") {
      source.updateImage({ url, coordinates });
      map.setLayoutProperty(layerId, "visibility", "visible");
    } else {
      map.addSource(sourceId, { type: "image", url, coordinates });
      const layer = { id: layerId, type: "raster", source: sourceId, paint: { "raster-opacity": 1, "raster-fade-duration": 0 } };
      if (this.beforeLayerId && map.getLayer(this.beforeLayerId)) map.addLayer(layer, this.beforeLayerId);
      else map.addLayer(layer);
      this.layerIds[kind].add(layerId);
    }
    // blob-URL попередніх запікань звільняємо із запізненням — MapLibre мав час їх прочитати
    let list = this.urls[kind].get(id);
    if (!list) this.urls[kind].set(id, (list = []));
    list.push(url);
    while (list.length > 2) URL.revokeObjectURL(list.shift());
  }

  _releaseCanvases(kind) {
    for (const canvas of this.canvases[kind].values()) { canvas.width = 0; canvas.height = 0; }
    this.canvases[kind].clear();
  }

  _hideKind(kind, except = new Set()) {
    if (kind === "detail" && except.size === 0) this._releaseCanvases("detail");
    for (const layerId of this.layerIds[kind]) {
      const id = layerId.slice(`flag${kind}-`.length, -"-layer".length);
      if (!except.has(id) && this.map.getLayer(layerId)) this.map.setLayoutProperty(layerId, "visibility", "none");
    }
  }

  async _publishBadges(visible, view, token) {
    const { map, flags } = this;
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
          if (token !== this.tokens.detail) return 0;
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
