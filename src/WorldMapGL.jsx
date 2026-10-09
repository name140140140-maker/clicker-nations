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
const SOURCE_MAX_ZOOM = 10;

const COLOR_WATER = "#7ec9e8";
const COLOR_LAND_NEUTRAL = "#7fb069";
const COLOR_MINE = "#f4b942";
const COLOR_BORDER = "#4a7a3d"; // темніший зелений для внутрішніх меж областей
const COLOR_STATE_LINE = "#1f2d3d";
const INTERNAL_LINES_MIN_ZOOM = 3.2; // з якого зуму показувати межі областей
const INTERNAL_LINES_FULL_ZOOM = 4.4;
const FLASH_MS = 1500; // тривалість підсвічування щойно захопленої області
const MAX_CAPTURE_EVENTS_AT_ONCE = 25; // масова синхронізація не має засипати гравця сповіщеннями

// Ваги етапів для суцільного прогрес-бару — сума дає 1.
const STAGE_WEIGHTS = { topology: 0.3, model: 0.15, geojson: 0.15, flagImages: 0.25, flagBake: 0.15 };

// Поточний власник сторони арки / області: стан (змінений захопленням) або рідний iso з даних.
const ownerA = ["string", ["feature-state", "oa"], ["get", "ia"]];
const ownerB = ["string", ["feature-state", "ob"], ["get", "ib"]];
const regionOwner = ["string", ["feature-state", "o"], ["get", "iso"]];

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
  const worldRef = useRef({ territory: null, overlay: null, flash: new Map(), flashRaf: 0 });
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
        map.addLayer({
          id: "regions-fill",
          type: "fill",
          source: "regions",
          paint: { "fill-color": COLOR_LAND_NEUTRAL, "fill-opacity": 0.85 },
        });
        // прапори (image-source) вставляються перед цим шаром; вище — спалах захоплення й кордони
        map.addLayer({
          id: "regions-flash",
          type: "fill",
          source: "regions",
          paint: { "fill-color": "#fff3b0", "fill-opacity": ["*", 0.8, ["number", ["feature-state", "flash"], 0]] },
        });
        // Внутрішні межі областей (між областями ОДНОГО власника): з'являються при наближенні.
        map.addLayer({
          id: "borders-internal",
          type: "line",
          source: "borders",
          filter: ["==", ["get", "two"], 1],
          paint: {
            "line-color": COLOR_BORDER,
            "line-width": ["case", ["==", ownerA, ownerB], 0.6, 0],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], INTERNAL_LINES_MIN_ZOOM, 0, INTERNAL_LINES_FULL_ZOOM, 0.6],
          },
        });
        // Узбережжя / зовнішній контур — завжди.
        map.addLayer({
          id: "borders-coast",
          type: "line",
          source: "borders",
          filter: ["==", ["get", "two"], 0],
          paint: { "line-color": COLOR_STATE_LINE, "line-width": 0.9, "line-opacity": 0.55 },
        });
        // ЖИВИЙ ДЕРЖАВНИЙ КОРДОН: лише там, де поточні власники сторін різні.
        for (const [id, minzoom, maxzoom, width] of [["borders-state-lo", 0, 6, 1.3], ["borders-state-hi", 6, 24, 2.3]]) {
          map.addLayer({
            id,
            type: "line",
            source: "borders",
            minzoom,
            maxzoom,
            filter: ["==", ["get", "two"], 1],
            layout: { "line-join": "round" },
            paint: { "line-color": COLOR_STATE_LINE, "line-width": ["case", ["!=", ownerA, ownerB], width, 0], "line-opacity": 0.92 },
          });
        }
        // Контур вибраної країни (за ПОТОЧНОЮ територією власника): де рівно одна зі сторін — вибраний власник.
        map.addLayer({
          id: "borders-selected",
          type: "line",
          source: "borders",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": COLOR_STATE_LINE, "line-width": 0, "line-opacity": 1 },
        });

        // Поточні власники → стан областей і кордонів (після першого завантаження — лише відмінні від рідних).
        applyOwnerChanges(map, territory, initialChanges);

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
            const overlay = new FlagOverlay({ map, territory, flags: store, beforeLayerId: "regions-flash" });
            overlay.attach();
            worldRef.current.overlay = overlay;
            await overlay.bake();
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

  // 2. Колір заливки: "мій" власник — золотий, решта — зелена.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !map.getLayer("regions-fill")) return;
    map.setPaintProperty("regions-fill", "fill-color", ["case", ["==", regionOwner, myCountryCode || ""], COLOR_MINE, COLOR_LAND_NEUTRAL]);
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

    applyOwnerChanges(map, territory, changes);
    territory.rebuildParts(new Set(changes.flatMap((c) => [c.from, c.to])));
    overlay?.requestBake(250);
    startFlash(map, worldRef.current, changes);

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

  // 4. Підсвічуємо контур вибраної країни — за її ПОТОЧНОЮ територією.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !map.getLayer("borders-selected")) return;
    const sel = selected || "";
    map.setPaintProperty("borders-selected", "line-width", sel ? ["case", ["!=", ["==", ownerA, sel], ["==", ownerB, sel]], 2.6, 0] : 0);
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

// Записує поточних власників у feature-state: області (o) і обидві сторони кожної їхньої арки (oa/ob).
function applyOwnerChanges(map, territory, changes) {
  if (!changes.length) return;
  const arcs = new Set();
  for (const { r, to } of changes) {
    map.setFeatureState({ source: "regions", id: r }, { o: to });
    for (const a of territory.regionArcs[r]) arcs.add(a);
  }
  for (const a of arcs) {
    const { oa, ob } = territory.arcOwners(a);
    map.setFeatureState({ source: "borders", id: a }, { oa, ob });
  }
}

// Короткий "спалах" щойно захоплених областей: feature-state flash 1 → 0.
function startFlash(map, world, changes) {
  const now = performance.now();
  for (const { r } of changes) world.flash.set(r, now);
  if (world.flashRaf) return;
  const tick = () => {
    const t = performance.now();
    for (const [r, start] of world.flash) {
      const k = (t - start) / FLASH_MS;
      const value = k >= 1 ? 0 : (1 - k) * (1 - k);
      try { map.setFeatureState({ source: "regions", id: r }, { flash: value }); } catch { /* карту вже знищено */ }
      if (k >= 1) world.flash.delete(r);
    }
    world.flashRaf = world.flash.size ? requestAnimationFrame(tick) : 0;
  };
  world.flashRaf = requestAnimationFrame(tick);
}
