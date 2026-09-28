import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import * as topojson from "topojson-client";
import "maplibre-gl/dist/maplibre-gl.css";

// Крок 2-3 плану: реальна геометрія + реальне володіння (мій/чужий), клік
// вибирає країну, прапори всередині контурів. Розрізнення "союзник/ворог"
// — наступний крок.
//
// ПРО ПРАПОРИ (важлива історія, щоб не наступити на ті самі граблі):
// раніше прапори малювались вручну в окремому HTML <canvas> поверх карти
// (project() кожної вершини + clip + drawImage на кожен moveend/zoomend
// або й кожен кадр) — принципово крихко: (1) наївний project() ламався на
// країнах через лінію зміни дат; (2) прапори "відривались" від контуру
// під час активного pan/zoom, бо перемальовка в JS не встигала за
// рендером карти.
//
// Далі прапори стали нативними шарами MapLibre (image source + raster
// layer), АЛЕ по одному шару на кожен шматок кожного власника території —
// це сотні окремих джерел/шарів, і додавання/оновлення кожного має свою
// вагу (текстура на GPU тощо). При частих захопленнях (перебудова кожні
// ~300 мс) і при першому завантаженні (сотні шарів одразу) це й дало
// відчутні лаги.
//
// ТЕПЕР: прапори запікаються в 6 "відер" по 60° довготи (persistent
// offscreen-canvas на відро) — усього 6 невеликих image-source замість
// сотень, і кожне з них безпечного розміру (один гігантський растр на
// весь світ або координати за межами ±180° у MapLibre рендеряться
// ненадійно — саме так прапори одного разу повністю зникли). Малюємо в
// Web Mercator-y (не лінійно по широті), інакше картинка "зсувається"
// відносно того, що показує сама карта. При зміні cityControl відра
// перемальовуються й оновлюються на місці (source.updateImage).
//
// Кожен ОКРЕМИЙ шматок суші (материк/острів/ексклав) обробляється своєю
// логікою: дрібний шматок або шматок через лінію зміни дат — власний
// маленький canvas (чіткий, незалежно від розміру країни-власника);
// головний (найбільший) шматок кластера чи далека заморська територія —
// спільне "відро"; а великий сусідній острів близько до материка прапора
// не отримує (колір заливки й так показує власника). Обробка кожного
// кластера обгорнута в try/catch — одна "погана" країна більше не обриває
// цикл і не забирає прапори з усіх, хто йде далі в тому проході.
//
// ЗАВАНТАЖЕННЯ: карта показується користувачу лише коли справді все
// готово (топологія + прапори + перше запікання) — жодного "відкрито, але
// лагає". Прогрес-бар на екрані завантаження — реальний, зважений по всіх
// етапах (байти topology.json → завантаження SVG прапорів → запікання
// атласу), і сам процес розбитий на пачки з передачею кадру браузеру між
// ними, щоб інтерфейс лишався живим (крутиться спінер, рухається бар),
// а не завис одним довгим синхронним проходом.
const TOPOLOGY_URL = "/data/world-topology.json";
const REGION_LINES_MIN_ZOOM = 3.5; // з якого зуму показувати межі областей
const REGION_LINES_FULL_ZOOM = 4.5; // з якого зуму межі областей повністю видимі
const FLAG_REBAKE_DEBOUNCE_MS = 300; // не перебудовувати прапори частіше, ніж раз на цей інтервал
const FLAG_BAKE_BATCH_SIZE = 24; // скільки кластерів запікати за один прохід перед тим, як віддати кадр браузеру

const COLOR_WATER = "#7ec9e8";
const COLOR_LAND_NEUTRAL = "#7fb069";
const COLOR_MINE = "#f4b942";
const COLOR_BORDER = "#4a7a3d"; // темніший зелений для меж областей поверх суші
const COLOR_SELECTED_LINE = "#1f2d3d";
const FLAG_FILL_OPACITY = 0.4; // напівпрозорість прапора — колір землі лишається видимим
const FLAG_BUCKET_SOURCE_PREFIX = "flags-bucket-";
const FLAG_INDIVIDUAL_SOURCE_PREFIX = "flags-individual-"; // окремі шматки через лінію дати + всі дрібні (чіткі) шматки

// Прапори запікаються не в один гігантський растр на весь світ (MapLibre
// має відомі проблеми з image-source, що охоплює майже весь світ або
// виходить за ±180° довготи — зображення обрізається або не
// рендериться), а в кілька "відер" по 60° довготи кожне: невеликі,
// безпечні за розміром image-source, яких усього 6 (замість сотень
// окремих шарів). Країни, що фізично перетинають лінію зміни дат,
// малюються окремо — кожна власним маленьким джерелом (їх лише
// кілька), як і раніше.
const BUCKET_COUNT = 6;
const BUCKET_LNG_SPAN = 360 / BUCKET_COUNT;
const BUCKET_CANVAS_WIDTH = 360;
const FLAG_RASTER_MAX_DIM = 224; // розмір canvas для окремих (некрупних) шматків — чіткіше за спільні "відра"

// "Відра" мають фіксовану роздільну здатність на градус, тому дрібна країна
// отримує мало пікселів під свій прапор і виглядає розмито при наближенні
// (а величезна країна — детально, просто тому що вона велика). Тому кожен
// ОКРЕМИЙ шматок суші класифікуємо:
//  - дрібний (площа bbox < SMALL_PART_AREA_DEG2) → власний маленький
//    canvas із власною роздільною здатністю (чітко, незалежно від розміру
//    країни-власника);
//  - головний (найбільший) шматок кластера, або далекий (> FAR_DISTANCE_DEG
//    від головного, напр. заморська територія) → спільне "відро" (досить
//    чітко, бо територія й так велика на екрані);
//  - інакше (великий, але близький до головного сусідній острів) — прапор
//    на ньому НЕ малюємо: колір заливки й так показує чию це територію,
//    зайвий прапор на кожному сусідньому острові лише захаращує карту.
const SMALL_PART_AREA_DEG2 = 4; // приблизно 2°×2° — трохи більше за Кіпр
const FAR_DISTANCE_DEG = 20; // за цією відстанню від головної частини вважаємо територію "заморською"

// ВАЖЛИВО: MapLibre розтягує image-source ЛІНІЙНО між кутами в просторі
// Web Mercator, а Mercator по вертикалі нелінійний (ширина ±90° = майже
// нескінченність). Тому canvas обов'язково малюємо в Mercator-y, а не
// лінійно по широті — інакше картинка "зсувається" і прапори не потрапляють
// на свої країни (а видима частина світу відображається на тонку смужку
// тексту́ри біля екватора, де порожньо).
const LAT_LIMIT = 85.0511;
function mercY(lat) {
  const clamped = Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}
// Відра покривають широти [-58, 84] — там уся заселена суша; Антарктида
// поза межами (прапор там не потрібен), це економить пам'ять canvas.
const BUCKET_LAT_TOP = 84;
const BUCKET_LAT_BOTTOM = -58;
const MERC_TOP = mercY(BUCKET_LAT_TOP);
const MERC_BOTTOM = mercY(BUCKET_LAT_BOTTOM);
const PX_PER_RAD = BUCKET_CANVAS_WIDTH / ((BUCKET_LNG_SPAN * Math.PI) / 180);
const BUCKET_CANVAS_HEIGHT = Math.round((MERC_TOP - MERC_BOTTOM) * PX_PER_RAD);

function bucketMinLng(index) {
  return -180 + index * BUCKET_LNG_SPAN;
}

function bucketCorners(index) {
  const min = bucketMinLng(index);
  const max = min + BUCKET_LNG_SPAN;
  return [
    [min, BUCKET_LAT_TOP],
    [max, BUCKET_LAT_TOP],
    [max, BUCKET_LAT_BOTTOM],
    [min, BUCKET_LAT_BOTTOM],
  ];
}

function bucketToPixel(bucketIndex, [lng, lat]) {
  return [
    ((lng - bucketMinLng(bucketIndex)) / BUCKET_LNG_SPAN) * BUCKET_CANVAS_WIDTH,
    ((MERC_TOP - mercY(lat)) / (MERC_TOP - MERC_BOTTOM)) * BUCKET_CANVAS_HEIGHT,
  ];
}

function isAntimeridianPart(rings) {
  let min = Infinity;
  let max = -Infinity;
  for (const ring of rings) {
    for (const [lng] of ring) {
      if (lng < min) min = lng;
      if (lng > max) max = lng;
    }
  }
  return max - min > 180;
}

// Розбиває Polygon/MultiPolygon на окремі частини (материк, острови,
// ексклави) — кожна частина потім малюється під СВІЙ власний bounding
// box, а не під один спільний для всієї території. Без цього розкидані по
// карті шматки (острови, заморські території, не суміжні шматки одного
// власника) розтягували один прапор на проміжки океану/чужої землі.
function toParts(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

// Деякі шматки суші (Чукотка/Алеутські острови, острови Фіджі, Кірибаті,
// Антарктида) фізично перетинають лінію зміни дат (довгота ±180°). Без
// цієї корекції координати по різні боки лінії дають bounding box шириною
// у весь світ. Зсуваємо "невигідну" половину точок на +360°, щоб контур
// лишався компактним прямокутником у довготі (такі шматки йдуть окремими
// маленькими image-source, а не у "відра").
function unwrapAntimeridian(rings) {
  let min = Infinity;
  let max = -Infinity;
  for (const ring of rings) {
    for (const [lng] of ring) {
      if (lng < min) min = lng;
      if (lng > max) max = lng;
    }
  }
  if (max - min <= 180) return rings;
  const mid = (min + max) / 2;
  return rings.map((ring) => ring.map(([lng, lat]) => (lng < mid ? [lng + 360, lat] : [lng, lat])));
}

function loadFlagImage(innerSvg) {
  return new Promise((resolve, reject) => {
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${innerSvg}</svg>`;
    const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Іноді onload спрацьовує для зображення з нульовим розміром (битий
      // SVG) — ctx.drawImage() з таким зображенням кидає виняток, який без
      // цієї перевірки міг би обірвати весь цикл запікання (і "зʼїсти"
      // прапори всіх країн, що йдуть далі в тому проході). Тому трактуємо
      // це як помилку завантаження тут, а не пізніше під час малювання.
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error("Прапор завантажився з нульовим розміром"));
        return;
      }
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// Прапор Непала — єдиний у світі НЕпрямокутний державний прапор (два
// складені вимпели). У квадратному SVG viewBox навколо самого вимпела
// лишається прозорий простір, і коли ми розтягуємо цей квадрат на
// прямокутну територію країни, частина території лишається без кольору
// (видно голу заливку суші). Тому для Непала домальовуємо суцільну
// підкладку кольору поля прапора ПІД вимпелом один раз при завантаженні —
// результат уже повністю непрозорий прямокутник, як у решти прапорів.
const FLAG_BACKGROUND_FIX = { np: "#c8102e" };
function applyFlagBackgroundFix(iso, image) {
  const color = FLAG_BACKGROUND_FIX[iso];
  if (!color) return image;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  return canvas; // canvas — коректне джерело для ctx.drawImage(), так само як Image
}

// Малює один шматок території в усі "відра", яких він торкається: прапор,
// обрізаний по контуру. Частина, що виходить за межі canvas відра,
// обрізається самим canvas — тож шматки в сусідніх відрах стикуються
// бездоганно, як плитки однієї картинки.
function drawPartIntoBuckets(bucketCtxs, image, rings) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!(maxLng - minLng > 1e-5) || !(maxLat - minLat > 1e-5)) return;

  const first = Math.max(0, Math.floor((minLng + 180) / BUCKET_LNG_SPAN));
  const last = Math.min(BUCKET_COUNT - 1, Math.floor((maxLng + 180) / BUCKET_LNG_SPAN));

  for (let b = first; b <= last; b++) {
    const ctx = bucketCtxs[b];
    if (!ctx) continue;
    const [x0, y0] = bucketToPixel(b, [minLng, maxLat]);
    const [x1, y1] = bucketToPixel(b, [maxLng, minLat]);
    const boxW = Math.abs(x1 - x0);
    const boxH = Math.abs(y1 - y0);
    if (boxW < 0.5 || boxH < 0.5) continue;

    ctx.save();
    ctx.beginPath();
    for (const ring of rings) {
      if (!ring.length) continue;
      const [rx, ry] = bucketToPixel(b, ring[0]);
      ctx.moveTo(rx, ry);
      for (let i = 1; i < ring.length; i++) {
        const [px, py] = bucketToPixel(b, ring[i]);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
    ctx.clip();
    ctx.drawImage(image, Math.min(x0, x1), Math.min(y0, y1), boxW, boxH);
    ctx.restore();
  }
}

// Для рідкісних шматків через лінію дати: власний маленький canvas і
// власні 4 кути (розгорнуті координати) — перевірений спосіб.
function buildFlagRaster(image, rings) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  minLat = Math.max(-LAT_LIMIT, minLat);
  maxLat = Math.min(LAT_LIMIT, maxLat);
  const lngSpan = maxLng - minLng;
  if (!(lngSpan > 1e-5) || !(maxLat - minLat > 1e-5)) return null;

  // Розміри canvas — пропорційні до Mercator-простору (те, що бачить карта).
  const lngRad = (lngSpan * Math.PI) / 180;
  const yTop = mercY(maxLat);
  const ySpan = yTop - mercY(minLat);
  const scale = FLAG_RASTER_MAX_DIM / Math.max(lngRad, ySpan);
  const width = Math.max(4, Math.min(FLAG_RASTER_MAX_DIM, Math.round(lngRad * scale)));
  const height = Math.max(4, Math.min(FLAG_RASTER_MAX_DIM, Math.round(ySpan * scale)));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const toXY = ([lng, lat]) => [((lng - minLng) / lngSpan) * width, ((yTop - mercY(lat)) / ySpan) * height];

  ctx.beginPath();
  for (const ring of rings) {
    if (!ring.length) continue;
    const [x0, y0] = toXY(ring[0]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = toXY(ring[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.clip();
  ctx.drawImage(image, 0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    coordinates: [
      [minLng, maxLat],
      [maxLng, maxLat],
      [maxLng, minLat],
      [minLng, minLat],
    ],
  };
}

// Суміжність областей рахується по топології один раз: якщо арку
// (сегмент межі) використовують РІВНО дві області — вони сусіди. Арки з
// одним власником — це зовнішнє узбережжя/кордон, не рахуються.
function buildRegionAdjacency(geometries) {
  const arcOwners = new Map();
  const visitRing = (ring, regionIndex) => {
    for (const arcRef of ring) {
      const idx = arcRef < 0 ? ~arcRef : arcRef;
      let owners = arcOwners.get(idx);
      if (!owners) {
        owners = new Set();
        arcOwners.set(idx, owners);
      }
      owners.add(regionIndex);
    }
  };
  geometries.forEach((geometry, regionIndex) => {
    const polygons = geometry.type === "Polygon" ? [geometry.arcs] : geometry.type === "MultiPolygon" ? geometry.arcs : [];
    for (const polygon of polygons) for (const ring of polygon) visitRing(ring, regionIndex);
  });

  const adjacency = new Map();
  arcOwners.forEach((owners) => {
    if (owners.size !== 2) return;
    const [a, b] = [...owners];
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  });
  return adjacency;
}

// Хто зараз володіє областю: запис у cityControl (якщо область захоплена),
// інакше — "рідний" iso цієї області.
function resolveOwner(cnKey, iso, cityControl) {
  if (cityControl && Object.prototype.hasOwnProperty.call(cityControl, cnKey)) return cityControl[cnKey];
  return iso;
}

// Групує області в зв'язні кластери одного поточного власника (обхід у
// глибину по графу суміжності, зупиняючись на межі зміни власника). Це і
// є "територія загарбника", що росте разом із захопленням сусідніх
// областей.
function computeOwnerClusters(regionMeta, adjacency, cityControl) {
  const owners = regionMeta.map((r) => resolveOwner(r.cnKey, r.iso, cityControl));
  const visited = new Array(regionMeta.length).fill(false);
  const clusters = [];
  for (let i = 0; i < regionMeta.length; i++) {
    if (visited[i]) continue;
    const owner = owners[i];
    visited[i] = true;
    if (!owner) continue;
    const stack = [i];
    const members = [];
    while (stack.length) {
      const current = stack.pop();
      members.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        if (visited[neighbor] || owners[neighbor] !== owner) continue;
        visited[neighbor] = true;
        stack.push(neighbor);
      }
    }
    clusters.push({ owner, members });
  }
  return clusters;
}

// Чекає на наступний кадр рендеру — використовуємо між пачками важкої
// роботи, щоб віддати керування браузеру й не заморожувати інтерфейс
// одним довгим синхронним проходом (і щоб спінер/прогрес-бар справді
// рухались, а не "замерзали" на екрані завантаження).
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Завантажує JSON з реальним прогресом по байтах (для великого
// world-topology.json, ~5 МБ) — читає потік вручну й порівнює отримані
// байти з Content-Length. Якщо сервер стискає відповідь (gzip/brotli),
// Content-Length відображає розмір ДО розпаковки, а лічильник — вже
// розпаковані байти, тому прогрес може дійти до 100% трохи раніше
// фактичного завершення — це нешкідливо (значення просто притискається
// до 1) і все одно набагато чесніше за статичний спінер.
async function fetchJsonWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const totalHeader = response.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : 0;
  if (!response.body || !total) {
    const data = await response.json();
    onProgress(1);
    return data;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const blob = new Blob(chunks);
  return JSON.parse(await blob.text());
}

// Ваги етапів для суцільного прогрес-бару на екрані завантаження — сума
// дає 1. Підібрано приблизно по тому, скільки часу займає кожен етап.
const STAGE_WEIGHTS = { topology: 0.5, flagImages: 0.2, flagBake: 0.3 };

export default function WorldMapGL({ selected, onSelect, myCountryCode, cityControl, flagSvgs }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadProgress, setLoadProgress] = useState(0); // 0..1, сумарний прогрес усіх етапів
  const [loadStage, setLoadStage] = useState("Завантажуємо карту світу…");

  // Наповнюються один раз при завантаженні топології, читаються при
  // кожній перебудові прапорів — тримаємо в ref, щоб не тягнути їх у
  // залежності ефектів і не перечитувати topology.json повторно.
  const topologyRef = useRef(null);
  const regionMetaRef = useRef(null); // [{ iso, cnKey, geometry }]
  const adjacencyRef = useRef(null); // Map(regionIndex -> Set(regionIndex))
  const flagImageCacheRef = useRef(new Map()); // iso(lowercase) -> завантажений Image
  const bucketCanvasesRef = useRef(null); // persistent offscreen-canvas на кожне "відро" довготи
  const individualLayersRef = useRef([]); // [{ sourceId, layerId }] — власні шари для дрібних/крайових шматків
  const flagGenerationRef = useRef(0); // лічильник перебудов — скасовує застарілі фонові перебудови
  const rebakeTimerRef = useRef(null);
  const flagsReadyRef = useRef(false); // true після першого успішного запікання

  // 1. Ініціалізація карти один раз.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      antialias: true,
      // Карта не обертається й не нахиляється — це проста 2D-карта.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": COLOR_WATER } }],
      },
      center: [20, 35],
      zoom: 1.3,
      minZoom: 1,
      maxZoom: 10,
      attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "Дані: geoBoundaries CGAZ (CC BY 4.0)",
      }),
    );

    mapRef.current = map;

    // Перемальовує "відра" прапорів під актуальний cityControl і оновлює
    // їхні image-source на місці (їх усього BUCKET_COUNT) + кілька окремих
    // шарів для шматків через лінію дати. Розбито на пачки з очікуванням
    // кадру між ними; скасовує сама себе (generation), якщо тим часом
    // запущена новіша перебудова.
    async function rebuildFlagLayers(cityControlSnapshot, onBatchProgress) {
      const topology = topologyRef.current;
      const regionMeta = regionMetaRef.current;
      const adjacency = adjacencyRef.current;
      if (!topology || !regionMeta || !adjacency) return;

      const generation = ++flagGenerationRef.current;
      const clusters = computeOwnerClusters(regionMeta, adjacency, cityControlSnapshot);

      if (!bucketCanvasesRef.current) {
        bucketCanvasesRef.current = Array.from({ length: BUCKET_COUNT }, () => {
          const canvas = document.createElement("canvas");
          canvas.width = BUCKET_CANVAS_WIDTH;
          canvas.height = BUCKET_CANVAS_HEIGHT;
          return canvas;
        });
      }
      const canvases = bucketCanvasesRef.current;
      const bucketCtxs = canvases.map((canvas) => {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return ctx;
      });
      const individualRasters = []; // дрібні шматки + шматки через лінію дати — кожен власним джерелом

      for (let start = 0; start < clusters.length; start += FLAG_BAKE_BATCH_SIZE) {
        if (flagGenerationRef.current !== generation) return; // новіша перебудова вже запущена — цю кидаємо

        const batch = clusters.slice(start, start + FLAG_BAKE_BATCH_SIZE);
        for (const cluster of batch) {
          // Один "поганий" кластер (дивна геометрія, збій merge) не повинен
          // обривати цикл і забирати прапори з УСІХ кластерів, що йдуть
          // далі в цьому проході — а саме так раніше й губилась велика
          // випадкова на вигляд підмножина країн.
          try {
            const image = flagImageCacheRef.current.get(String(cluster.owner || "").toLowerCase());
            if (!image) continue; // немає прапора для цього власника — просто не малюємо

            const geometries = cluster.members.map((idx) => regionMeta[idx].geometry);
            const merged = topojson.merge(topology, geometries);
            const rawParts = toParts(merged).filter((rings) => rings.length);
            if (!rawParts.length) continue;

            const partsMeta = rawParts.map((rings) => {
              let minLng = Infinity;
              let minLat = Infinity;
              let maxLng = -Infinity;
              let maxLat = -Infinity;
              for (const ring of rings) {
                for (const [lng, lat] of ring) {
                  if (lng < minLng) minLng = lng;
                  if (lng > maxLng) maxLng = lng;
                  if (lat < minLat) minLat = lat;
                  if (lat > maxLat) maxLat = lat;
                }
              }
              return {
                rings,
                area: Math.max(0, maxLng - minLng) * Math.max(0, maxLat - minLat),
                cx: (minLng + maxLng) / 2,
                cy: (minLat + maxLat) / 2,
              };
            });
            const main = partsMeta.reduce((a, b) => (b.area > a.area ? b : a));

            for (const part of partsMeta) {
              const isMain = part === main;
              const isSmall = part.area < SMALL_PART_AREA_DEG2;
              const isFar = !isMain && Math.hypot(part.cx - main.cx, part.cy - main.cy) > FAR_DISTANCE_DEG;
              if (!isMain && !isSmall && !isFar) continue; // великий сусідній острів близько до материка — заливки досить

              if (isAntimeridianPart(part.rings)) {
                const raster = buildFlagRaster(image, unwrapAntimeridian(part.rings));
                if (raster) individualRasters.push(raster);
              } else if (isSmall) {
                const raster = buildFlagRaster(image, part.rings); // власний чіткий canvas — незалежно від розміру країни
                if (raster) individualRasters.push(raster);
              } else {
                drawPartIntoBuckets(bucketCtxs, image, part.rings);
              }
            }
          } catch (err) {
            console.warn("Пропускаю прапор для кластера", cluster.owner, err);
          }
        }

        onBatchProgress?.(Math.min(start + FLAG_BAKE_BATCH_SIZE, clusters.length), clusters.length);
        await nextFrame();
      }

      if (flagGenerationRef.current !== generation) return; // ще одна перевірка перед публікацією

      // "Відра": по одному джерелу на відро, оновлюємо на місці.
      canvases.forEach((canvas, index) => {
        const sourceId = `${FLAG_BUCKET_SOURCE_PREFIX}${index}`;
        const layerId = `${sourceId}-layer`;
        const dataUrl = canvas.toDataURL("image/png");
        const existing = map.getSource(sourceId);
        if (existing && typeof existing.updateImage === "function") {
          existing.updateImage({ url: dataUrl, coordinates: bucketCorners(index) });
        } else {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (existing) map.removeSource(sourceId);
          map.addSource(sourceId, { type: "image", url: dataUrl, coordinates: bucketCorners(index) });
          map.addLayer({
            id: layerId,
            type: "raster",
            source: sourceId,
            paint: { "raster-opacity": FLAG_FILL_OPACITY, "raster-fade-duration": 0 },
          });
        }
      });

      // Дрібні/крайові шматки: помірна кількість (не сотні), тож просто
      // замінюємо повністю щоразу.
      const nextIndividual = individualRasters.map((raster, index) => {
        const sourceId = `${FLAG_INDIVIDUAL_SOURCE_PREFIX}${generation}-${index}`;
        const layerId = `${sourceId}-layer`;
        map.addSource(sourceId, { type: "image", url: raster.dataUrl, coordinates: raster.coordinates });
        map.addLayer({
          id: layerId,
          type: "raster",
          source: sourceId,
          paint: { "raster-opacity": FLAG_FILL_OPACITY, "raster-fade-duration": 0 },
        });
        return { sourceId, layerId };
      });
      for (const { sourceId, layerId } of individualLayersRef.current) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
      individualLayersRef.current = nextIndividual;
    }

    map.on("load", async () => {
      try {
        setLoadStage("Завантажуємо карту світу…");
        const topology = await fetchJsonWithProgress(TOPOLOGY_URL, (fraction) =>
          setLoadProgress(fraction * STAGE_WEIGHTS.topology),
        );
        topologyRef.current = topology;
        setLoadStage("Малюємо кордони…");
        setLoadProgress(STAGE_WEIGHTS.topology);

        const objectName = Object.keys(topology.objects)[0];
        const topoObject = topology.objects[objectName];
        const geojson = topojson.feature(topology, topoObject);

        // Стабільний id на регіон = той самий ключ, яким уже користується
        // cityControl у грі ("КОД_КРАЇНИ|Назва області") — щоб не вигадувати
        // окремий формат, а напряму зіставляти з даними гри.
        geojson.features.forEach((feature) => {
          const iso = feature.properties?.iso;
          const name = feature.properties?.name;
          feature.properties.cn_key = `${iso}|${name}`;
        });

        // regionMeta індексується так само, як topoObject.geometries
        // (topojson.feature зберігає порядок) — це і дозволяє напряму
        // зіставляти "область у геоджейсоні" з "область у графі суміжності".
        regionMetaRef.current = geojson.features.map((feature, index) => ({
          iso: feature.properties.iso,
          cnKey: feature.properties.cn_key,
          geometry: topoObject.geometries[index],
        }));
        adjacencyRef.current = buildRegionAdjacency(topoObject.geometries);

        map.addSource("regions", {
          type: "geojson",
          data: geojson,
          promoteId: "cn_key",
        });

        map.addLayer({
          id: "regions-fill",
          type: "fill",
          source: "regions",
          paint: {
            "fill-color": COLOR_LAND_NEUTRAL, // початкове значення, одразу оновиться ефектом нижче
            "fill-opacity": 0.85,
          },
        });

        map.addLayer({
          id: "regions-line",
          type: "line",
          source: "regions",
          paint: {
            "line-color": COLOR_BORDER,
            "line-width": 0.4,
            // Межі областей з'являються поступово, тільки коли наблизились —
            // здалеку показуємо лише суцільні контури країн (шар нижче).
            "line-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              REGION_LINES_MIN_ZOOM,
              0,
              REGION_LINES_FULL_ZOOM,
              1,
            ],
          },
        });

        // Другий шар даних: суцільні контури країн (політичні, статичні —
        // не залежать від того, хто зараз володіє територією; захоплення
        // показує зафарбовування + прапор, а не зміну політичного кордону).
        const geometriesByIso = {};
        for (const geom of topoObject.geometries) {
          const iso = geom.properties?.iso;
          if (!iso) continue;
          (geometriesByIso[iso] ??= []).push(geom);
        }
        const mergedByIso = {};
        for (const [iso, geoms] of Object.entries(geometriesByIso)) {
          mergedByIso[iso] = topojson.merge(topology, geoms);
        }

        const countriesGeojson = {
          type: "FeatureCollection",
          features: Object.entries(mergedByIso).map(([iso, geometry]) => ({
            type: "Feature",
            properties: { iso },
            geometry,
          })),
        };

        map.addSource("countries", {
          type: "geojson",
          data: countriesGeojson,
        });

        map.addLayer({
          id: "countries-line",
          type: "line",
          source: "countries",
          paint: {
            "line-color": COLOR_SELECTED_LINE,
            "line-width": 1.1,
            "line-opacity": 0.55,
          },
        });

        map.on("click", "regions-fill", (event) => {
          const feature = event.features?.[0];
          const iso = feature?.properties?.iso;
          if (iso && onSelect) onSelect(iso);
        });
        map.on("mouseenter", "regions-fill", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "regions-fill", () => {
          map.getCanvas().style.cursor = "";
        });

        // Прапори: спершу завантажуємо КОЖЕН доступний прапор у Image
        // (кешуємо назавжди — самі прапори не змінюються, змінюються лише
        // кластери територій, якими вони обрізаються), а тоді робимо
        // перше запікання спільного атласу. Карта показується користувачу
        // тільки ПІСЛЯ цього — без "відкрито, але лагає".
        if (flagSvgs) {
          setLoadStage("Завантажуємо прапори…");
          const entries = Object.entries(flagSvgs);
          let loadedCount = 0;
          await Promise.all(
            entries.map(async ([isoLower, svg]) => {
              try {
                const image = await loadFlagImage(svg);
                flagImageCacheRef.current.set(isoLower, applyFlagBackgroundFix(isoLower, image));
              } catch (err) {
                console.warn("Не вдалося завантажити прапор", isoLower, err);
              }
              loadedCount += 1;
              setLoadProgress(STAGE_WEIGHTS.topology + (loadedCount / entries.length) * STAGE_WEIGHTS.flagImages);
            }),
          );

          setLoadStage("Малюємо прапори на карті…");
          await rebuildFlagLayers(cityControl, (done, total) => {
            setLoadProgress(STAGE_WEIGHTS.topology + STAGE_WEIGHTS.flagImages + (done / total) * STAGE_WEIGHTS.flagBake);
          });
          flagsReadyRef.current = true;
        }

        setLoadProgress(1);
        setStatus("ready");
      } catch (error) {
        console.error("Не вдалося завантажити карту:", error);
        setStatus("error");
      }
    });

    // Дозволяє ефекту нижче (реакція на зміну cityControl) достукатись до
    // тієї самої функції перебудови без повторного addEventListener.
    map.__rebuildFlagLayers = rebuildFlagLayers;

    return () => {
      if (rebakeTimerRef.current) clearTimeout(rebakeTimerRef.current);
      flagGenerationRef.current += 1; // скасовує будь-яке фонове запікання, що ще триває
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Перефарбовуємо, коли змінюється myCountryCode або cityControl
  // (хтось щось захопив). cityControl[iso+"|"+name] — поточний власник,
  // якщо область захоплена; якщо запису нема — власник той, чий iso
  // "від природи" (записаний у самій геометрії).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !map.getLayer("regions-fill")) return;

    const cc = cityControl || {};
    map.setPaintProperty("regions-fill", "fill-color", [
      "case",
      [
        "==",
        ["coalesce", ["get", ["get", "cn_key"], ["literal", cc]], ["get", "iso"]],
        myCountryCode || "",
      ],
      COLOR_MINE,
      COLOR_LAND_NEUTRAL,
    ]);
  }, [status, myCountryCode, cityControl]);

  // 2b. Перебудовуємо прапори-за-власником при кожній зміні cityControl —
  // з дебаунсом, щоб часті ігрові оновлення (кілька захоплень поспіль) не
  // тригерили перерендер кожного разу окремо. Оновлює той самий шар на
  // місці (без створення нових) — тому не смикає продуктивність під час
  // гри.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !flagsReadyRef.current) return;

    if (rebakeTimerRef.current) clearTimeout(rebakeTimerRef.current);
    rebakeTimerRef.current = setTimeout(() => {
      map.__rebuildFlagLayers?.(cityControl);
    }, FLAG_REBAKE_DEBOUNCE_MS);

    return () => {
      if (rebakeTimerRef.current) clearTimeout(rebakeTimerRef.current);
    };
  }, [status, cityControl]);

  // 3. Підсвічуємо контур вибраної країни. Робимо це на шарі countries-line
  // (завжди видимий), а не regions-line — інакше підсвітка губилась би на
  // віддаленні, коли межі областей ще не показані.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !map.getLayer("countries-line")) return;

    map.setPaintProperty("countries-line", "line-width", [
      "case",
      ["==", ["get", "iso"], selected || ""],
      2.4,
      1.1,
    ]);
    map.setPaintProperty("countries-line", "line-color", COLOR_SELECTED_LINE);
    map.setPaintProperty("countries-line", "line-opacity", [
      "case",
      ["==", ["get", "iso"], selected || ""],
      1,
      0.55,
    ]);
  }, [status, selected]);

  const loadPercent = Math.round(loadProgress * 100);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 420 }}>
      <style>{`
        @keyframes cn-map-spin { to { transform: rotate(360deg); } }
        @keyframes cn-map-shimmer {
          0% { background-position: -120px 0; }
          100% { background-position: 220px 0; }
        }
      `}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden" }} />

      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(160deg, #0d1b33 0%, #16324f 55%, #1c4a5e 100%)",
            borderRadius: 12,
          }}
        >
          <div style={{ width: "min(280px, 80%)", textAlign: "center" }}>
            <div
              style={{
                width: 42,
                height: 42,
                margin: "0 auto 18px",
                borderRadius: "50%",
                border: "3px solid rgba(126,201,232,0.2)",
                borderTopColor: "#7ec9e8",
                borderRightColor: "#f4b942",
                animation: "cn-map-spin 0.9s linear infinite",
              }}
            />
            <div style={{ color: "#dfeffb", fontSize: 13, marginBottom: 12, letterSpacing: 0.2 }}>{loadStage}</div>
            <div
              style={{
                position: "relative",
                height: 6,
                borderRadius: 999,
                background: "rgba(255,255,255,0.12)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${Math.max(loadPercent, 4)}%`,
                  borderRadius: 999,
                  background: "linear-gradient(90deg, #7ec9e8, #f4b942)",
                  transition: "width 0.2s ease-out",
                  backgroundSize: "200px 100%",
                  animation: "cn-map-shimmer 1.4s linear infinite",
                }}
              />
            </div>
            <div style={{ color: "#9fc4dc", fontSize: 11, marginTop: 8 }}>{loadPercent}%</div>
          </div>
        </div>
      )}

      {status === "error" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#f87171",
            fontSize: 13,
            background: COLOR_WATER,
            borderRadius: 12,
            padding: 16,
            textAlign: "center",
          }}
        >
          Не вдалося завантажити карту. Перевір, що файл /data/world-topology.json існує.
        </div>
      )}
    </div>
  );
}
