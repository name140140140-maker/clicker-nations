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
// ТЕПЕР: ОДИН спільний "атлас" — persistent offscreen-canvas на ввесь світ
// (з невеликим буфером довготи праворуч для країн, що перетинають лінію
// зміни дат: Росія/США/Фіджі/Кірибаті/Нова Зеландія/Антарктида). Кожен
// прапор кожного власника малюється (обрізаний по контуру, як і раніше)
// прямо в цей спільний canvas, а в кінці — ОДИН toDataURL і ОДИН
// image-source + ОДИН raster-layer на всю карту. При зміні cityControl
// повторно перемальовуємо той самий canvas і оновлюємо ЦЕЙ ЖЕ source
// (source.updateImage), а не створюємо нові шари — тому захоплення
// території більше не смикає продуктивність карти.
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
const FLAG_SOURCE_ID = "flags-world";
const FLAG_LAYER_ID = "flags-world-layer";

// Спільний "атлас"-canvas охоплює довготу [-180, 200] (буфер +20° праворуч
// для розгорнутих координат країн через лінію зміни дат — див.
// unwrapAntimeridian нижче) і всю широту [-90, 90].
const WORLD_LNG_MIN = -180;
const WORLD_LNG_MAX = 200;
const WORLD_LAT_MIN = -90;
const WORLD_LAT_MAX = 90;
const WORLD_CANVAS_WIDTH = 2048;
const WORLD_CANVAS_HEIGHT = 1024;
const WORLD_IMAGE_CORNERS = [
  [WORLD_LNG_MIN, WORLD_LAT_MAX],
  [WORLD_LNG_MAX, WORLD_LAT_MAX],
  [WORLD_LNG_MAX, WORLD_LAT_MIN],
  [WORLD_LNG_MIN, WORLD_LAT_MIN],
];

function worldToPixel([lng, lat]) {
  return [
    ((lng - WORLD_LNG_MIN) / (WORLD_LNG_MAX - WORLD_LNG_MIN)) * WORLD_CANVAS_WIDTH,
    ((WORLD_LAT_MAX - lat) / (WORLD_LAT_MAX - WORLD_LAT_MIN)) * WORLD_CANVAS_HEIGHT,
  ];
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
// лишався компактним прямокутником у довготі (звідси й буфер WORLD_LNG_MAX
// вище — щоб розгорнуті координати влізли в спільний атлас).
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
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// Малює один шматок території (rings у географічних координатах) прямо в
// СПІЛЬНИЙ атлас-canvas: прапор, обрізаний точно по контуру. На відміну
// від попередньої версії тут немає власного canvas і власного toDataURL
// на кожен шматок — усе йде в один и той самий контекст, кодується в PNG
// рівно один раз, після того як усі прапори вже намальовані.
function drawClusterFlag(ctx, image, rings) {
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

  const [boxX0, boxY0] = worldToPixel([minLng, maxLat]);
  const [boxX1, boxY1] = worldToPixel([maxLng, minLat]);
  const boxX = Math.min(boxX0, boxX1);
  const boxY = Math.min(boxY0, boxY1);
  const boxW = Math.abs(boxX1 - boxX0);
  const boxH = Math.abs(boxY1 - boxY0);
  if (boxW < 0.5 || boxH < 0.5) return;

  ctx.save();
  ctx.beginPath();
  for (const ring of rings) {
    if (!ring.length) continue;
    const [x0, y0] = worldToPixel(ring[0]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = worldToPixel(ring[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.clip();
  ctx.drawImage(image, boxX, boxY, boxW, boxH);
  ctx.restore();
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
  const worldCanvasRef = useRef(null); // persistent offscreen-canvas — атлас усіх прапорів
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
      maxZoom: 7,
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

    // Перемальовує спільний атлас-canvas під актуальний cityControl і
    // оновлює ОДИН image-source (без створення нових шарів). Розбито на
    // пачки (FLAG_BAKE_BATCH_SIZE кластерів за прохід) з очікуванням
    // кадру між ними; скасовує сама себе (перевірка generation), якщо
    // тим часом уже запущена новіша перебудова.
    async function rebuildFlagLayers(cityControlSnapshot, onBatchProgress) {
      const topology = topologyRef.current;
      const regionMeta = regionMetaRef.current;
      const adjacency = adjacencyRef.current;
      if (!topology || !regionMeta || !adjacency) return;

      const generation = ++flagGenerationRef.current;
      const clusters = computeOwnerClusters(regionMeta, adjacency, cityControlSnapshot);

      let canvas = worldCanvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = WORLD_CANVAS_WIDTH;
        canvas.height = WORLD_CANVAS_HEIGHT;
        worldCanvasRef.current = canvas;
      }
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let start = 0; start < clusters.length; start += FLAG_BAKE_BATCH_SIZE) {
        if (flagGenerationRef.current !== generation) return; // новіша перебудова вже запущена — цю кидаємо

        const batch = clusters.slice(start, start + FLAG_BAKE_BATCH_SIZE);
        for (const cluster of batch) {
          const image = flagImageCacheRef.current.get(String(cluster.owner || "").toLowerCase());
          if (!image) continue; // немає прапора для цього власника — просто не малюємо (колір заливки лишається)

          const geometries = cluster.members.map((idx) => regionMeta[idx].geometry);
          const merged = topojson.merge(topology, geometries);
          const parts = toParts(merged).map(unwrapAntimeridian);
          for (const rings of parts) {
            if (rings.length) drawClusterFlag(ctx, image, rings);
          }
        }

        onBatchProgress?.(Math.min(start + FLAG_BAKE_BATCH_SIZE, clusters.length), clusters.length);
        await nextFrame();
      }

      if (flagGenerationRef.current !== generation) return; // ще одна перевірка перед публікацією

      const dataUrl = canvas.toDataURL("image/png");
      const existingSource = map.getSource(FLAG_SOURCE_ID);
      if (existingSource && typeof existingSource.updateImage === "function") {
        existingSource.updateImage({ url: dataUrl });
      } else {
        if (map.getLayer(FLAG_LAYER_ID)) map.removeLayer(FLAG_LAYER_ID);
        if (map.getSource(FLAG_SOURCE_ID)) map.removeSource(FLAG_SOURCE_ID);
        map.addSource(FLAG_SOURCE_ID, {
          type: "image",
          url: dataUrl,
          coordinates: WORLD_IMAGE_CORNERS,
        });
        map.addLayer({
          id: FLAG_LAYER_ID,
          type: "raster",
          source: FLAG_SOURCE_ID,
          paint: {
            "raster-opacity": FLAG_FILL_OPACITY,
            "raster-fade-duration": 0,
          },
        });
      }
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
                flagImageCacheRef.current.set(isoLower, image);
              } catch {
                // Один битий прапор не повинен ламати решту карти.
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
