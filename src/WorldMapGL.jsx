import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildTerritory } from "./map/territory.js";
import { FlagStore, repairFlagSvgs } from "./map/flagAssets.js";
import { FlagOverlay } from "./map/flagOverlay.js";

// ЖИВІ КОРДОНИ (перенесено зі старої Canvas-версії WorldMap3D у MapLibre-архітектуру).
//
// Принцип старої версії: кордон — це не статична лінія країни, а спільна
// "арка" топології між двома областями; державним кордоном вона вважається
// лише тоді, коли поточні власники цих областей різні. Захоплена область
// одразу зміщує лінію фронту, а межа всередині нової держави стає
// внутрішньою (тонкою) — без жодної перебудови геометрії.
//
// Тут це зроблено через feature-state MapLibre:
//  - джерело "regions": області (id = індекс області), стан { o: власник };
//  - джерело "borders": арки топології як лінії (id = індекс арки),
//    стан { oa, ob } — поточні власники двох сусідніх областей;
//  - шари кордонів показують/ховають лінію виразом над станом, тож при
//    захопленні оновлюється лише кілька областей і арок (setFeatureState),
//    а не весь стиль/плитки.
// Прапори на територіях — окремий шар (src/map/flagOverlay.js): запікаються
// з вектора під поточний масштаб і залежать від того ж поточного власника.
//
// ЗАВАНТАЖЕННЯ: topology.json (~5 МБ) → модель територій (ownership/шматки)
// → GeoJSON збирається одразу ТЕКСТОМ і віддається MapLibre через Blob-URL
// (розбирає воркер, а не головний потік; без гігантського проміжного об'єкта
// і без structured clone) → прапори → перше запікання. Усе розбито на
// пачки з поверненням керування браузеру, щоб інтерфейс не замерзав.
const TOPOLOGY_URL = "/data/world-topology.json";
const MAX_ZOOM = 14; // було 10; джерела мають maxzoom 10 — вище плитки розтягуються, а не перегенеровуються
const SOURCE_MAX_ZOOM = 8; // вище плитки розтягуються (overzoom), а не генеруються — менше роботи воркеру й пам'яті; геометрія та сама

const COLOR_WATER = "#7ec9e8";
const COLOR_LAND_NEUTRAL = "#7fb069";
const COLOR_MINE = "#f4b942";
const COLOR_BORDER = "#4a7a3d"; // темніший зелений для внутрішніх меж областей
const COLOR_STATE_LINE = "#1f2d3d";
const INTERNAL_LINES_MIN_ZOOM = 3.2; // з якого зуму показувати межі областей
const INTERNAL_LINES_FULL_ZOOM = 4.4;
const FLASH_MS = 1500; // тривалість спалаху контуру щойно захопленої області
const MAX_FLASH_ARCS = 120; // обмеження кількості ліній, що анімуються
const LAND_OPACITY = 0.85;
const COLOR_FLASH = "#fff3b0";
const MAX_CAPTURE_EVENTS_AT_ONCE = 25; // масова синхронізація не має засипати гравця сповіщеннями

// Ваги етапів для суцільного прогрес-бару — сума дає 1.
const STAGE_WEIGHTS = { topology: 0.3, model: 0.15, geojson: 0.15, flagImages: 0.25, flagBake: 0.15 };

// Поточний власник сторони арки / області: стан (змінений захопленням) або рідний iso з даних.
const ownerA = ["string", ["feature-state", "oa"], ["get", "ia"]];
const ownerB = ["string", ["feature-state", "ob"], ["get", "ib"]];
const regionOwner = ["string", ["feature-state", "o"], ["get", "iso"]];
const flashValue = ["number", ["feature-state", "flash"], 0];
const isCoast = ["==", ["get", "two"], 0];
const isHighlighted = ["boolean", ["feature-state", "h"], false];

const nextFrame = () =>
  new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(finish);
    setTimeout(finish, 60); // у фоновій вкладці rAF не спрацьовує — не підвисаємо
  });

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

// Завантажує JSON з реальним прогресом по байтах. Якщо сервер стискає
// відповідь, Content-Length — розмір ДО розпаковки, тож прогрес може дійти
// до 100% трохи раніше фактичного завершення — це нешкідливо.
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

// Склеює текстові шматки GeoJSON у Blob невеликими порціями (кодуємо в байти й віддаємо
// кадр між порціями): прямий new Blob(тисячі_рядків) на 15-20 МБ блокує головний потік
// на сотні мілісекунд, а на слабкому телефоні — на секунди.
async function chunksToBlob(chunks, type) {
  if (typeof TextEncoder === "undefined") return new Blob(chunks, { type });
  const encoder = new TextEncoder();
  const parts = [];
  let buffer = [];
  let size = 0;
  let sliceStart = performance.now();
  const flush = () => { if (buffer.length) { parts.push(encoder.encode(buffer.join(""))); buffer = []; size = 0; } };
  for (const chunk of chunks) {
    buffer.push(chunk);
    size += chunk.length;
    if (size > 200000) {
      flush();
      if (performance.now() - sliceStart > 8) { await yieldToBrowser(); sliceStart = performance.now(); }
    }
  }
  flush();
  return new Blob(parts, { type });
}

// GeoJSON-джерело з Blob-URL: воркер MapLibre сам завантажує й розбирає
// файл. Якщо чомусь не вийшло (екзотичний WebView) — запасний шлях: звичайний
// об'єкт через setData.
function addGeoJsonSource(map, id, blob, options) {
  const url = URL.createObjectURL(blob);
  map.addSource(id, { type: "geojson", data: url, ...options });
  let released = false;
  const release = () => { if (!released) { released = true; URL.revokeObjectURL(url); map.off("error", onError); map.off("sourcedata", onData); } };
  const onData = (e) => { if (e.sourceId === id && e.isSourceLoaded) release(); };
  const onError = async (e) => {
    if (e.sourceId !== id || released) return;
    console.warn(`GeoJSON "${id}" через Blob-URL не завантажився, пробую напряму`, e.error);
    release();
    try { map.getSource(id)?.setData(JSON.parse(await blob.text())); } catch (err) { console.error(err); }
  };
  map.on("sourcedata", onData);
  map.on("error", onError);
}

// Важкі дані (геометрія, готові GeoJSON-блоби, розкодовані прапори) переживають вихід
// з екрана карти: повторний вхід не перебудовує все з нуля (~2-3 с економії), а лише
// скидає власників до рідних і застосовує актуальний cityControl.
const worldCache = { regionData: null, flagSvgs: null, territory: null, regionsBlob: null, bordersBlob: null, store: null };

export default function WorldMapGL({ selected, onSelect, myCountryCode, cityControl, flagSvgs, regionData, onCapture }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState("Завантажуємо карту світу…");

  // Усе, що створюється при завантаженні й потрібне ефектам нижче.
  const worldRef = useRef({ territory: null, overlay: null, flash: new Map(), flashRaf: 0, highlightOwner: "" });
  const fillOwnerRef = useRef(null); // для кого зараз налаштовано золоту заливку
  // Актуальні пропси для довгоживучих обробників карти (щоб не перестворювати їх).
  const latest = useRef({});
  latest.current = { onSelect, onCapture, cityControl, myCountryCode, selected };

  // 1. Ініціалізація карти й усіх шарів — один раз.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    let cancelled = false;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // MSAA на екранах з високою щільністю пікселів майже не дає виграшу, зате суттєво
      // навантажує GPU/пам'ять мобільних — вимикаємо там, де DPR ≥ 2.
      antialias: (window.devicePixelRatio || 1) < 2,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      renderWorldCopies: false, // прапори/кордони існують в одній копії світу
      fadeDuration: 0,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": COLOR_WATER } }] },
      center: [20, 35],
      zoom: 1.3,
      minZoom: 1,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Дані: geoBoundaries CGAZ (CC BY 4.0)" }));
    mapRef.current = map;

    map.on("load", async () => {
      try {
        // --- завантаження й модель територій (або повторне використання з кешу) ---
        const cached = worldCache.territory && worldCache.regionData === (regionData || null) && worldCache.flagSvgs === (flagSvgs || null);
        let territory, regionsBlob, bordersBlob;
        let base = 0;
        if (cached) {
          ({ territory, regionsBlob, bordersBlob } = worldCache);
          territory.setOwners(territory.regions.map((r) => r.iso)); // назад до рідних власників
          await territory.rebuildPartsAsync(null, yieldToBrowser);
          base = STAGE_WEIGHTS.topology + STAGE_WEIGHTS.model + STAGE_WEIGHTS.geojson;
          setLoadProgress(base);
        } else {
          setLoadStage("Завантажуємо карту світу…");
          let topology = await fetchJsonWithProgress(TOPOLOGY_URL, (f) => setLoadProgress(f * STAGE_WEIGHTS.topology));
          if (cancelled) return;
          setLoadStage("Будуємо кордони…");
          base = STAGE_WEIGHTS.topology;
          setLoadProgress(base);
          territory = await buildTerritory(topology, regionData || {}, yieldToBrowser);
          topology = null; // сирий JSON (десятки МБ об'єктів) більше не потрібен — звільняємо пам'ять до важких етапів
          if (cancelled) return;
          base += STAGE_WEIGHTS.model;
          setLoadProgress(base);
          regionsBlob = await chunksToBlob(await territory.regionsGeoJsonChunks(yieldToBrowser), "application/json");
          setLoadProgress(base + STAGE_WEIGHTS.geojson * 0.6);
          bordersBlob = await chunksToBlob(await territory.bordersGeoJsonChunks(yieldToBrowser), "application/json");
          territory.releaseText(); // текст арок більше не потрібен (11 МБ рядків)
          if (cancelled) return;
          base += STAGE_WEIGHTS.geojson;
          setLoadProgress(base);
          Object.assign(worldCache, { regionData: regionData || null, flagSvgs: flagSvgs || null, territory, regionsBlob, bordersBlob, store: null });
        }
        const initial = territory.ownersFromControl(latest.current.cityControl);
        const initialChanges = territory.setOwners(initial.owners);
        if (initialChanges.length) await territory.rebuildPartsAsync(new Set(initialChanges.flatMap((c) => [c.from, c.to])), yieldToBrowser);
        worldRef.current.territory = territory;

        // --- джерела: області й кордони ---
        addGeoJsonSource(map, "regions", regionsBlob, { maxzoom: SOURCE_MAX_ZOOM });
        addGeoJsonSource(map, "borders", bordersBlob, { maxzoom: SOURCE_MAX_ZOOM });

        // --- шари (порядок = порядок малювання) ---
        // Усі вирази залежать лише від feature-state: після створення шарів їх НЕ змінюємо —
        // setPaintProperty для data-driven виразів перебудовує всі плитки джерела (важко на телефонах).
        const myAtStart = latest.current.myCountryCode || "";
        fillOwnerRef.current = myAtStart;
        map.addLayer({
          id: "regions-fill",
          type: "fill",
          source: "regions",
          paint: { "fill-color": ["case", ["==", regionOwner, myAtStart], COLOR_MINE, COLOR_LAND_NEUTRAL], "fill-opacity": LAND_OPACITY },
        });
        // растри прапорів (базовий і детальний) вставляються перед цим шаром — під лініями
        // Внутрішні межі областей (між областями ОДНОГО власника): з'являються при наближенні.
        map.addLayer({
          id: "borders-internal",
          type: "line",
          source: "borders",
          minzoom: INTERNAL_LINES_MIN_ZOOM,
          filter: ["==", ["get", "two"], 1],
          paint: {
            "line-color": COLOR_BORDER,
            "line-width": ["case", ["==", ownerA, ownerB], 0.6, 0],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], INTERNAL_LINES_MIN_ZOOM, 0, INTERNAL_LINES_FULL_ZOOM, 0.6],
          },
        });
        // Усі інші лінії — ОДИН шар (кожен додатковий шар дублює геометрію в пам'яті):
        //  • ЖИВИЙ ДЕРЖАВНИЙ КОРДОН — де поточні власники сторін різні;
        //  • узбережжя (зовнішній контур) — тонша й світліша лінія;
        //  • контур вибраної країни за її ПОТОЧНОЮ територією (feature-state h);
        //  • спалах контуру щойно захопленої області (feature-state flash).
        map.addLayer({
          id: "borders-main",
          type: "line",
          source: "borders",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["case", [">", flashValue, 0.02], COLOR_FLASH, COLOR_STATE_LINE],
            "line-width": ["max", ["*", 6, flashValue], ["case", isHighlighted, 2.6, isCoast, 0.9, ["!=", ownerA, ownerB], 1.6, 0]],
            "line-opacity": ["case", [">", flashValue, 0.02], 1, isCoast, 0.55, 0.92],
          },
        });

        // Поточні власники → стан областей і кордонів (після першого завантаження — лише відмінні від рідних).
        applyOwnerChanges(map, territory, initialChanges, "");

        // --- взаємодія: вибір країни за ПОТОЧНИМ власником ---
        map.on("click", (event) => {
          const features = map.queryRenderedFeatures(event.point, { layers: ["flag-badges", "regions-fill"].filter((l) => map.getLayer(l)) });
          const top = features[0];
          if (!top) return;
          const owner = top.layer.id === "flag-badges" ? top.properties?.owner : territory.owner[top.id];
          if (owner && latest.current.onSelect) latest.current.onSelect(owner);
        });
        map.on("mouseenter", "regions-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "regions-fill", () => { map.getCanvas().style.cursor = ""; });

        // --- прапори --- (якщо щось піде не так — карта все одно працює, просто без прапорів)
        if (flagSvgs) {
          try {
            let store = worldCache.territory === territory ? worldCache.store : null;
            if (!store) {
              setLoadStage("Завантажуємо прапори…");
              store = new FlagStore(repairFlagSvgs(flagSvgs));
              await store.loadAll((done, total) => setLoadProgress(base + (done / total) * STAGE_WEIGHTS.flagImages));
              if (cancelled) return;
              if (worldCache.territory === territory) worldCache.store = store;
            }
            base += STAGE_WEIGHTS.flagImages;
            setLoadStage("Малюємо прапори на карті…");
            await nextFrame();
            const overlay = new FlagOverlay({
              map,
              territory,
              flags: store,
              beforeLayerId: "borders-internal",
              colors: { water: COLOR_WATER, neutral: COLOR_LAND_NEUTRAL, mine: COLOR_MINE, landOpacity: LAND_OPACITY },
              getMyCountry: () => latest.current.myCountryCode || "",
            });
            overlay.attach();
            worldRef.current.overlay = overlay;
            await overlay.bakeAll();
          } catch (flagError) {
            console.warn("Прапори на карті недоступні:", flagError);
          }
        }
        if (cancelled) return;
        setLoadProgress(1);
        setStatus("ready");
      } catch (error) {
        console.error("Не вдалося завантажити карту:", error);
        if (!cancelled) setStatus("error");
      }
    });

    return () => {
      cancelled = true;
      const world = worldRef.current;
      if (world.flashRaf) cancelAnimationFrame(world.flashRaf);
      world.overlay?.destroy();
      world.overlay = null;
      worldCache.store?.releaseTiers();
      world.territory = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Колір заливки: "мій" власник — золотий, решта — зелена. Вираз уже створено з актуальним
  // кодом при завантаженні; змінюємо лише коли гравець справді змінився (це перебудовує плитки).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !map.getLayer("regions-fill")) return;
    const mine = myCountryCode || "";
    if (fillOwnerRef.current === mine) return;
    fillOwnerRef.current = mine;
    map.setPaintProperty("regions-fill", "fill-color", ["case", ["==", regionOwner, mine], COLOR_MINE, COLOR_LAND_NEUTRAL]);
    worldRef.current.overlay?.invalidate();
  }, [status, myCountryCode]);

  // 3. ЖИВІ КОРДОНИ: cityControl змінився (хтось щось захопив) → оновлюємо лише змінені області,
  // їхні арки-кордони й прапори; показуємо подію захоплення.
  useEffect(() => {
    const map = mapRef.current;
    const { territory, overlay } = worldRef.current;
    if (!map || status !== "ready" || !territory) return;

    const { owners } = territory.ownersFromControl(cityControl);
    const changes = territory.setOwners(owners);
    if (!changes.length) return;

    applyOwnerChanges(map, territory, changes, worldRef.current.highlightOwner);
    territory.rebuildParts(new Set(changes.flatMap((c) => [c.from, c.to])));
    overlay?.invalidate();
    startFlash(map, worldRef.current, territory, changes);

    if (latest.current.onCapture && changes.length <= MAX_CAPTURE_EVENTS_AT_ONCE) {
      // одна подія на оновлення — найбільша захоплена область
      const biggest = changes.reduce((a, b) => (territory.regions[b.r].areaKm2 > territory.regions[a.r].areaKm2 ? b : a));
      latest.current.onCapture({
        name: territory.regionName(biggest.r),
        previousOwner: biggest.from,
        newOwner: biggest.to,
        areaKm2: Math.round(changes.reduce((sum, c) => sum + territory.regions[c.r].areaKm2, 0)),
      });
    }
  }, [status, cityControl]);

  // 4. Підсвічуємо контур вибраної країни — за її ПОТОЧНОЮ територією. Це feature-state арок
  // (h), тож зміна вибору оновлює лише кілька сотень ліній, а не перебудовує шари.
  useEffect(() => {
    const map = mapRef.current;
    const { territory } = worldRef.current;
    if (!map || status !== "ready" || !territory) return;
    const next = selected || "";
    const prev = worldRef.current.highlightOwner || "";
    if (prev === next) return;
    worldRef.current.highlightOwner = next;
    applyHighlight(map, territory, prev, next);
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
            <div style={{ position: "relative", height: 6, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
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

// Лінія — край вибраної території, якщо рівно одна її сторона належить вибраному власнику.
const isHighlightEdge = (territory, a, owner) => {
  if (!owner) return false;
  const { oa, ob } = territory.arcOwners(a);
  return (oa === owner) !== (ob === owner);
};

// Записує поточних власників у feature-state: області (o) і обидві сторони кожної їхньої арки (oa/ob),
// а також, чи арка зараз є краєм вибраної території (h).
function applyOwnerChanges(map, territory, changes, selectedOwner) {
  if (!changes.length) return;
  const arcs = new Set();
  for (const { r, to } of changes) {
    map.setFeatureState({ source: "regions", id: r }, { o: to });
    for (const a of territory.regionArcs[r]) arcs.add(a);
  }
  for (const a of arcs) {
    const { oa, ob } = territory.arcOwners(a);
    map.setFeatureState({ source: "borders", id: a }, { oa, ob, h: isHighlightEdge(territory, a, selectedOwner) });
  }
}

// Зміна вибраної країни: перераховуємо h лише для арок, що прилягають до областей старого й нового власника.
function applyHighlight(map, territory, prev, next) {
  const arcs = new Set();
  for (let r = 0; r < territory.regions.length; r++) {
    const o = territory.owner[r];
    if (o === prev || o === next) for (const a of territory.regionArcs[r]) arcs.add(a);
  }
  for (const a of arcs) map.setFeatureState({ source: "borders", id: a }, { h: isHighlightEdge(territory, a, next) });
}

// Короткий "спалах" контуру щойно захоплених областей: feature-state flash 1 → 0.
function startFlash(map, world, territory, changes) {
  const now = performance.now();
  for (const { r } of changes) {
    for (const a of territory.regionArcs[r]) {
      if (world.flash.size >= MAX_FLASH_ARCS) break;
      world.flash.set(a, now);
    }
  }
  if (world.flashRaf || !world.flash.size) return;
  const tick = () => {
    const t = performance.now();
    for (const [a, start] of world.flash) {
      const k = (t - start) / FLASH_MS;
      const value = k >= 1 ? 0 : (1 - k) * (1 - k);
      try { map.setFeatureState({ source: "borders", id: a }, { flash: value }); } catch { /* карту вже знищено */ }
      if (k >= 1) world.flash.delete(a);
    }
    world.flashRaf = world.flash.size ? requestAnimationFrame(tick) : 0;
  };
  world.flashRaf = requestAnimationFrame(tick);
}
