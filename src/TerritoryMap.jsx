import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildRegionModel } from "./map/regionsModel.js";
import { loadCities, citiesGeoJson, cityKey } from "./map/cities.js";
import { cityZones, pointInPolygon } from "./map/geo.js";
import { waterTexture, landTexture } from "./map/textures.js";
import { geoLabelsGeoJson } from "./map/geoLabels.js";

// КАРТА ТЕРРИТОРІЙ
// Лише адміністративні області й їхні кордони — без реальних держав і прапорів.
// Три типи територій:
//   • вільні    — ніхто не контролює (нейтральний колір);
//   • зайняті   — контролюють інші країни (колір країни, який обрав її лідер);
//   • власні    — контролює країна гравця (її колір + біла рамка по зовнішньому краю).
// Колір і власник області — це feature-state MapLibre: при зміні (нова країна, зміна кольору)
// оновлюються лише потрібні області й кордони, без перебудови шарів чи плиток.
// Кордон між областями різних власників — товстіша лінія, між областями одного власника — тонка.
//
// Режими: "view" — перегляд карти (клік показує інформацію про область);
//         "pick" — вибір вільної області для створення нової країни.

const TOPOLOGY_URL = "/data/world-topology.json";
const MAX_ZOOM = 12;
const SOURCE_MAX_ZOOM = 8;

export const MAP_COLORS = {
  water: "#1457c2", // яскравий мультяшний океан
  free: "#6fd01f", // насичений салатовий мох
  border: "#0b2412",
  borderInternal: "#2f7a14",
  mine: "#ffffff",
  selected: "#ffd54a",
  coast: "#e6ff8f", // світла облямівка узбережжя
  glow: "#4fb0ff", // блакитне сяйво навколо суші
};

const OWNER_OPACITY = 0.9;

// Підписи міст потребують шрифтів (glyphs). Це публічний набір Noto Sans від Protomaps;
// за потреби його можна покласти у public/fonts і змінити URL тут (див. src/map/README.md).
const GLYPHS_URL = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const LABEL_FONT = ["Noto Sans Medium"];

// Шари міст за важливістю: що важливіше — те з'являється раніше при наближенні.
// Рівні міст: від великих столиць до дрібних міст. p — населення, cap: 2 столиця, 1 центр області.
// Здалека лишаються лише найважливіші столиці (Лондон, Париж…), дрібніші столиці
// (Кишинів, Вадуц…) з'являються при наближенні, далі великі, а потім дрібні міста.
const isCap = ["==", ["get", "cap"], 2];
const notFb = ["==", ["get", "f"], 0];
const pop = ["get", "p"];
// Прозорість від 0 на порозі масштабу до 1 через 0.7 рівня зуму.
const fadeIn = (z) => ["interpolate", ["linear"], ["zoom"], z, 0, z + 0.7, 1];
const CITY_TIERS = [
  { id: "a", filter: ["all", notFb, ["any", ["all", isCap, [">=", pop, 4000000]], [">=", pop, 12000000]]], minzoom: 2.3 },
  { id: "b", filter: ["all", notFb, ["any", ["all", isCap, [">=", pop, 1500000], ["<", pop, 4000000]], ["all", [">=", pop, 6000000], ["<", pop, 12000000]]]], minzoom: 3.4 },
  { id: "c", filter: ["all", notFb, ["any", ["all", isCap, ["<", pop, 1500000]], ["all", [">=", pop, 3000000], ["<", pop, 6000000], ["!", isCap]]]], minzoom: 4.4 },
  { id: "e", filter: ["all", notFb, ["!", isCap], [">=", pop, 1000000], ["<", pop, 3000000]], minzoom: 5.4 },
  { id: "f", filter: ["all", notFb, ["!", isCap], ["<", pop, 1000000], ["any", [">=", pop, 300000], ["==", ["get", "cap"], 1]]], minzoom: 6.6 },
  { id: "g", filter: ["all", notFb, ["!", isCap], ["<", pop, 300000], ["!=", ["get", "cap"], 1]], minzoom: 7.8 },
  { id: "d", filter: ["==", ["get", "f"], 1], minzoom: 8.5 }, // області без реального міста: точка з назвою області
];
const labelField = (lang) => (lang === "uk" ? ["get", "u"] : ["get", "n"]);


// Підписи природних об'єктів (океани, моря, гори, пустелі…): 4 рівні за важливістю, чим важливіше — тим раніше з'являється.
const GEO_TIERS = [
  { tier: 1, minzoom: 0, maxzoom: 6.5, size: 16, spacing: 0.32, upper: true },
  { tier: 2, minzoom: 1.8, maxzoom: 8.5, size: 13, spacing: 0.16, upper: false },
  { tier: 3, minzoom: 2.9, maxzoom: 24, size: 11.5, spacing: 0.08, upper: false },
  { tier: 4, minzoom: 4.2, maxzoom: 24, size: 10.5, spacing: 0.05, upper: false },
];
const geoIsWater = ["in", ["get", "k"], ["literal", ["o", "s", "g", "t", "l"]]];
const geoIsCont = ["==", ["get", "k"], "c"];

const STAGE_WEIGHTS = { topology: 0.55, model: 0.3, geojson: 0.15 };

const ownerA = ["string", ["feature-state", "oa"], ""];
const ownerB = ["string", ["feature-state", "ob"], ""];
const regionOwner = ["string", ["feature-state", "o"], ""];
const isHighlighted = ["boolean", ["feature-state", "h"], false];
const isCoast = ["==", ["get", "two"], 0];

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

async function fetchJsonWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const total = Number(response.headers.get("content-length")) || 0;
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
  return JSON.parse(await new Blob(chunks).text());
}

// Склеює текстові шматки GeoJSON у Blob порціями, віддаючи кадр браузеру (щоб не підвисав інтерфейс).
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

// GeoJSON-джерело з Blob-URL: файл розбирає воркер MapLibre, а не головний потік.
function addGeoJsonSource(map, id, blob, options) {
  const url = URL.createObjectURL(blob);
  map.addSource(id, { type: "geojson", data: url, ...options });
  let released = false;
  const release = () => { if (!released) { released = true; URL.revokeObjectURL(url); map.off("error", onError); map.off("sourcedata", onData); } };
  const onData = (e) => { if (e.sourceId === id && e.isSourceLoaded) release(); };
  const onError = async (e) => {
    if (e.sourceId !== id || released) return;
    release();
    try { map.getSource(id)?.setData(JSON.parse(await blob.text())); } catch (err) { console.error(err); }
  };
  map.on("sourcedata", onData);
  map.on("error", onError);
}

// Важкі дані переживають вихід з екрана карти: повторний вхід не перебудовує все з нуля.
const worldCache = { model: null, regionsBlob: null, bordersBlob: null };

const TerritoryMap = forwardRef(function TerritoryMap(
  { mode = "view", owners, countries, myCountryId, selectedRid, onSelectRegion, showCities = false, lang = "uk", selectedCityId = null, onSelectCity, cityOwners = null, selectedZoneOwner = null, onPointPick = null, overlay = null },
  ref,
) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState("Завантажуємо карту…");
  const [citiesReady, setCitiesReady] = useState(false);
  // Екран завантаження тримається, доки карта справді не відмалювала області
  // (інакше після "ready" кілька секунд видно порожній темно-синій фон).
  const [painted, setPainted] = useState(false);
  const [veilGone, setVeilGone] = useState(false);

  useEffect(() => {
    if (status !== "ready" || painted) return undefined;
    const map = mapRef.current;
    let done = false;
    const finish = () => { if (!done) { done = true; requestAnimationFrame(() => requestAnimationFrame(() => setPainted(true))); } };
    const timer = setTimeout(finish, 7000); // запобіжник
    if (map) {
      // Дочекаємось, поки плитки областей будуть намальовані (idle після ready).
      const check = () => { if (map.areTilesLoaded && map.areTilesLoaded()) finish(); else map.once("idle", finish); };
      setTimeout(check, 150);
    } else finish();
    return () => { clearTimeout(timer); };
  }, [status, painted]);

  useEffect(() => {
    if (!painted) return undefined;
    const t = setTimeout(() => setVeilGone(true), 500);
    return () => clearTimeout(t);
  }, [painted]);

  // Усе, що створюється при завантаженні й потрібне ефектам нижче.
  const worldRef = useRef({
    model: null,
    ownerByIndex: null, // поточні власники областей (id країни або "")
    colorByIndex: null,
    selectedIndex: -1,
    focused: false,
    cities: null, // { list, byRid } після завантаження шару міст
    cityColor: new Map(), // індекс міста → колір власника (застосований у feature-state)
    selectedCity: -1,
    split: new Map(), // rid → { zones: Map(індекс міста → { owner, polys }) } для областей із захопленими містами
  });
  // Актуальні пропси для довгоживучих обробників карти.
  const latest = useRef({});
  latest.current = { onSelectRegion, owners, countries, myCountryId, mode, onSelectCity, lang, cityOwners, onPointPick };

  useImperativeHandle(ref, () => ({
    flyToRid(rid) {
      const { model } = worldRef.current;
      const map = mapRef.current;
      if (!model || !map) return;
      const idx = model.indexByRid.get(String(rid));
      if (idx === undefined) return;
      fitRegion(map, model, [idx], 5.5);
    },
    flyTo(lng, lat, zoom = 5) {
      const map = mapRef.current;
      if (map) map.flyTo({ center: [lng, lat], zoom, duration: 800 });
    },
    // Скільки кілометрів у одному пікселі на поточному масштабі (для прив'язки кліків і радіусів).
    getPxKm() {
      const map = mapRef.current;
      if (!map) return 5;
      const lat = map.getCenter().lat;
      return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom() + 1) / 1000;
    },
  }));

  // 1. Ініціалізація карти й шарів — один раз.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    let cancelled = false;

    const map = new maplibregl.Map({
      container: containerRef.current,
      antialias: (window.devicePixelRatio || 1) < 2,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      renderWorldCopies: false,
      fadeDuration: 250, // плавна поява/зникнення підписів міст
      maxTileCacheSize: 32, // менше плиток у пам'яті: на слабких телефонах WebView інакше вилітає
      style: { version: 8, glyphs: GLYPHS_URL, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": MAP_COLORS.water } }] },
      center: [15, 30],
      zoom: 1.4,
      minZoom: 1,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Дані: geoBoundaries CGAZ (CC BY 4.0)" }));
    mapRef.current = map;

    // Якщо система забрала WebGL-контекст (нестача пам'яті) — не лишаємо порожній екран.
    const canvas = map.getCanvas();
    const onLost = (e) => { e.preventDefault(); if (!cancelled) setStatus("lost"); };
    canvas.addEventListener("webglcontextlost", onLost);

    map.on("load", async () => {
      try {
        let model, regionsBlob, bordersBlob;
        if (worldCache.model) {
          ({ model, regionsBlob, bordersBlob } = worldCache);
          setLoadProgress(0.9);
        } else {
          setLoadStage("Завантажуємо карту…");
          let topology = await fetchJsonWithProgress(TOPOLOGY_URL, (f) => setLoadProgress(f * STAGE_WEIGHTS.topology));
          if (cancelled) return;
          setLoadStage("Будуємо кордони областей…");
          let base = STAGE_WEIGHTS.topology;
          model = await buildRegionModel(topology, yieldToBrowser);
          topology = null; // сирий JSON більше не потрібен — звільняємо пам'ять
          if (cancelled) return;
          base += STAGE_WEIGHTS.model;
          setLoadProgress(base);
          regionsBlob = await chunksToBlob(await model.regionsGeoJsonChunks(), "application/json");
          setLoadProgress(base + STAGE_WEIGHTS.geojson * 0.6);
          bordersBlob = await chunksToBlob(await model.bordersGeoJsonChunks(), "application/json");
          model.release();
          if (cancelled) return;
          Object.assign(worldCache, { model, regionsBlob, bordersBlob });
        }
        worldRef.current.model = model;
        worldRef.current.ownerByIndex = new Array(model.regions.length).fill("");
        worldRef.current.colorByIndex = new Array(model.regions.length).fill("");

        addGeoJsonSource(map, "regions", regionsBlob, { maxzoom: SOURCE_MAX_ZOOM, tolerance: 0.9, buffer: 32 });
        addGeoJsonSource(map, "borders", bordersBlob, { maxzoom: SOURCE_MAX_ZOOM, tolerance: 0.9, buffer: 32 });

        // Усі вирази залежать лише від feature-state: після створення шарів їх не змінюємо
        // (зміна data-driven виразу перебудовує плитки всього джерела — важко на телефонах).
        const mine = latest.current.myCountryId || "";
        const mineEdge = mine
          ? ["all", ["!=", ownerA, ownerB], ["any", ["==", ownerA, mine], ["==", ownerB, mine]]]
          : false;

        // Текстури: хвилі на воді та трава/рельєф на суші (генеруються в коді).
        try {
          const wt = waterTexture(MAP_COLORS.water);
          const lt = landTexture();
          if (!map.hasImage("water-tex")) map.addImage("water-tex", wt.data, { pixelRatio: 2 });
          if (!map.hasImage("land-tex")) map.addImage("land-tex", lt.data, { pixelRatio: 2 });
          map.setPaintProperty("bg", "background-pattern", "water-tex");
        } catch (err) { console.warn("Текстури карти недоступні:", err); }

        map.addLayer({
          id: "regions-fill",
          type: "fill",
          source: "regions",
          paint: {
            "fill-color": ["to-color", ["coalesce", ["feature-state", "c"], MAP_COLORS.free]],
            "fill-opacity": ["case", ["==", regionOwner, ""], 0.92, OWNER_OPACITY],
          },
        });
        // Текстура суші: виразна на вільних територіях, ледь помітна на зайнятих.
        if (map.hasImage("land-tex")) {
          map.addLayer({
            id: "regions-texture",
            type: "fill",
            source: "regions",
            paint: {
              "fill-pattern": "land-tex",
              "fill-opacity": ["case", ["==", regionOwner, ""], 0.9, 0.34],
            },
          });
        }
        // Підсвітка вибраної області (режим вибору й перегляду).
        map.addLayer({
          id: "regions-selected",
          type: "fill",
          source: "regions",
          paint: {
            "fill-color": "#ffffff",
            "fill-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 0.5, 0],
          },
        });
        // Адміністративні межі всередині одного власника: з'являються при наближенні.
        map.addLayer({
          id: "borders-internal",
          type: "line",
          source: "borders",
          minzoom: 2.2,
          filter: ["==", ["get", "two"], 1],
          paint: {
            "line-color": MAP_COLORS.borderInternal,
            "line-width": ["case", ["==", ownerA, ownerB], 0.6, 0],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 2.2, 0, 4, 0.75],
          },
        });
        // Блакитне сяйво вздовж узбережжя (як ореол навколо планети на референсі).
        map.addLayer({
          id: "coast-glow",
          type: "line",
          source: "borders",
          filter: ["==", ["get", "two"], 0],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": MAP_COLORS.glow, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 4, 6, 9], "line-blur": 4, "line-opacity": 0.4 },
        });
        // Усі інші лінії — один шар: кордон між різними власниками, узбережжя,
        // рамка власної території, контур вибраної області.
        map.addLayer({
          id: "borders-main",
          type: "line",
          source: "borders",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["case", isHighlighted, MAP_COLORS.selected, mineEdge, MAP_COLORS.mine, isCoast, MAP_COLORS.coast, MAP_COLORS.border],
            "line-width": ["case", isHighlighted, 3, mineEdge, 2.4, isCoast, 1.3, ["!=", ownerA, ownerB], 1.5, 0],
            "line-opacity": ["case", isHighlighted, 1, mineEdge, 1, isCoast, 0.85, 0.9],
          },
        });

        // Підписи природних об'єктів: під містами й ігровими об'єктами, але над областями.
        try {
        map.addSource("geolabels", { type: "geojson", data: geoLabelsGeoJson() });
        for (const g of GEO_TIERS) {
          map.addLayer({
            id: "geolabels-" + g.tier,
            type: "symbol",
            source: "geolabels",
            minzoom: g.minzoom,
            maxzoom: g.maxzoom,
            filter: ["==", ["get", "tier"], g.tier],
            layout: {
              "text-field": labelField(latest.current.lang),
              "text-font": LABEL_FONT,
              "text-size": g.size,
              "text-letter-spacing": g.spacing,
              "text-transform": g.upper ? "uppercase" : "none",
              "text-max-width": g.tier === 1 ? 12 : 7,
              "text-rotate": ["get", "rot"],
              "text-rotation-alignment": "map",
              "text-pitch-alignment": "map",
              "text-padding": 4,
              "symbol-sort-key": ["-", 0, ["get", "tier"]],
            },
            paint: {
              "text-color": ["case", geoIsWater, "#dcefff", geoIsCont, "rgba(255,255,255,0.9)", "#f8ffd9"],
              "text-halo-color": ["case", geoIsWater, "rgba(6,40,120,0.85)", geoIsCont, "rgba(10,50,20,0.75)", "rgba(24,78,10,0.9)"],
              "text-halo-width": 1.6,
              "text-opacity": ["interpolate", ["linear"], ["zoom"], g.minzoom, 0, g.minzoom + 0.7, g.tier === 1 || g.tier === 2 ? 0.92 : 0.88],
            },
          });
        }
        } catch (err) { console.warn("Підписи природних об'єктів недоступні:", err); }

        // Ігрові об'єкти (бізнеси, ППО, маршрути дронів): один GeoJSON-джерело "ovl", малюється поверх областей.
        map.addSource("ovl", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "ovl-zone-fill", type: "fill", source: "ovl", filter: ["==", ["get", "kind"], "zone"], paint: { "fill-color": ["get", "c"], "fill-opacity": 0.16 } });
        map.addLayer({ id: "ovl-zone-line", type: "line", source: "ovl", filter: ["==", ["get", "kind"], "zone"], paint: { "line-color": ["get", "c"], "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.9 } });
        map.addLayer({ id: "ovl-route", type: "line", source: "ovl", filter: ["==", ["get", "kind"], "route"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "c"], "line-width": 3, "line-dasharray": [1.5, 1.5], "line-opacity": 0.95 } });
        map.addLayer({
          id: "ovl-points", type: "circle", source: "ovl", filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "c"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-opacity": 0.95 },
        });
        map.addLayer({
          id: "ovl-labels", type: "symbol", source: "ovl", filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "t"], ""]],
          layout: { "text-field": ["get", "t"], "text-font": LABEL_FONT, "text-size": 11, "text-offset": [0, 1.7], "text-anchor": "top", "text-allow-overlap": true },
          paint: { "text-color": "#ffffff", "text-halo-color": "rgba(5,12,28,0.9)", "text-halo-width": 1.6 },
        });

        map.on("click", (event) => {
          const w = worldRef.current;
          // Режим вибору точки (бізнес, ППО, маршрут дрона): віддаємо координати й власника території під пальцем.
          if (latest.current.onPointPick) {
            const t0 = map.queryRenderedFeatures(event.point, { layers: ["regions-fill"] })[0];
            let ownerId = "";
            let rid = "";
            if (t0 && t0.id !== undefined && w.model) {
              const i0 = Number(t0.id);
              const r0 = w.model.regions[i0];
              if (r0) {
                rid = r0.rid;
                ownerId = w.ownerByIndex[i0] || "";
                const sp = w.split.get(r0.rid);
                if (sp) {
                  for (const z of sp.zones.values()) {
                    if (z.polys.some((poly) => pointInPolygon(event.lngLat.lng, event.lngLat.lat, poly))) { ownerId = z.owner; break; }
                  }
                }
              }
            }
            const lat0 = event.lngLat.lat;
            const pxKm = (156543.03392 * Math.cos((lat0 * Math.PI) / 180)) / Math.pow(2, map.getZoom() + 1) / 1000;
            latest.current.onPointPick({ lng: event.lngLat.lng, lat: lat0, ownerId, rid, pxKm });
            return;
          }
          // місто має пріоритет: хіт-зона трохи більша за маркер (зручно пальцем)
          const cityLayers = CITY_TIERS.map((t) => "cities-dot-" + t.id).filter((id) => map.getLayer(id));
          if (cityLayers.length && w.cities) {
            const { x, y } = event.point;
            const hit = map.queryRenderedFeatures([[x - 9, y - 9], [x + 9, y + 9]], { layers: cityLayers })[0];
            if (hit && hit.id !== undefined) {
              const city = w.cities.list[Number(hit.id)];
              if (city && latest.current.onSelectCity) {
                const idx = w.model.indexByRid.get(city.rid);
                latest.current.onSelectCity({ city, regionName: idx !== undefined ? w.model.regions[idx].name : "", ownerId: (latest.current.cityOwners && latest.current.cityOwners[cityKey(city)]) || (idx !== undefined ? w.ownerByIndex[idx] || "" : "") });
                return;
              }
            }
          }
          const top = map.queryRenderedFeatures(event.point, { layers: ["regions-fill"] })[0];
          if (!top || top.id === undefined) return;
          const idx = Number(top.id);
          const region = w.model.regions[idx];
          if (!region || !latest.current.onSelectRegion) return;
          let ownerId = w.ownerByIndex[idx] || "";
          // Область поділена між країнами: власник = той, чия зона під пальцем
          const split = w.split.get(region.rid);
          if (split) {
            const { lng, lat } = event.lngLat;
            for (const z of split.zones.values()) {
              if (z.polys.some((poly) => pointInPolygon(lng, lat, poly))) {
                ownerId = z.owner;
                break;
              }
            }
          }
          latest.current.onSelectRegion({ rid: region.rid, name: region.name, index: idx, ownerId });
        });
        map.on("mouseenter", "regions-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "regions-fill", () => { map.getCanvas().style.cursor = ""; });

        if (cancelled) return;
        setLoadProgress(1);
        setLoadStage("Малюємо карту…");
        setStatus("ready");
      } catch (error) {
        console.error("Не вдалося завантажити карту:", error);
        if (!cancelled) setStatus("error");
      }
    });

    return () => {
      cancelled = true;
      worldRef.current.model = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ігрові об'єкти: оновлюємо дані джерела "ovl" (бізнеси, ППО, дрон) і тримаємо їх над шарами міст.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const src = map.getSource("ovl");
    if (src) src.setData(overlay || { type: "FeatureCollection", features: [] });
  }, [overlay, status]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    for (const id of ["ovl-zone-fill", "ovl-zone-line", "ovl-route", "ovl-points", "ovl-labels"]) {
      if (map.getLayer(id)) map.moveLayer(id);
    }
  }, [citiesReady, status]);

  // Мова підписів природних об'єктів.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    for (const g of GEO_TIERS) if (map.getLayer("geolabels-" + g.tier)) map.setLayoutProperty("geolabels-" + g.tier, "text-field", labelField(lang));
  }, [lang, status]);

  // 2. Власники й кольори → feature-state областей та їхніх кордонів (лише змінені).
  useEffect(() => {
    const map = mapRef.current;
    const w = worldRef.current;
    if (!map || status !== "ready" || !w.model) return;
    const { model, ownerByIndex, colorByIndex } = w;

    const colorOf = {};
    for (const c of countries || []) colorOf[c.id] = c.color;

    const nextOwner = new Map();
    for (const rid in owners || {}) {
      const idx = model.indexByRid.get(rid);
      if (idx !== undefined) nextOwner.set(idx, owners[rid]);
    }

    const ownerChanged = [];
    // Області, що змінили власника або колір
    for (const [idx, cid] of nextOwner) {
      const color = colorOf[cid] || MAP_COLORS.free;
      const ownerDiff = ownerByIndex[idx] !== cid;
      if (ownerDiff) {
        ownerByIndex[idx] = cid;
        ownerChanged.push(idx);
      }
      if (ownerDiff || colorByIndex[idx] !== color) {
        colorByIndex[idx] = color;
        map.setFeatureState({ source: "regions", id: idx }, { o: cid, c: color });
      }
    }
    // Області, що стали вільними (на випадок видалення власника)
    for (let idx = 0; idx < ownerByIndex.length; idx++) {
      if (ownerByIndex[idx] && !nextOwner.has(idx)) {
        ownerByIndex[idx] = "";
        colorByIndex[idx] = "";
        map.setFeatureState({ source: "regions", id: idx }, { o: "", c: null });
        ownerChanged.push(idx);
      }
    }

    if (ownerChanged.length) {
      const arcs = new Set();
      for (const idx of ownerChanged) for (const a of model.regionArcs[idx]) arcs.add(a);
      for (const a of arcs) {
        const ra = model.arcRegions[2 * a];
        const rb = model.arcRegions[2 * a + 1];
        map.setFeatureState(
          { source: "borders", id: a },
          { oa: ra >= 0 ? ownerByIndex[ra] : "", ob: rb >= 0 ? ownerByIndex[rb] : "" },
        );
      }
    }

    syncCityColors(map, w, colorOf, cityOwners);

    // Один раз після завантаження: у режимі перегляду наближаємо камеру до власної країни.
    if (!w.focused && latest.current.mode === "view" && latest.current.myCountryId) {
      const mineIdx = [];
      for (const [idx, cid] of nextOwner) if (cid === latest.current.myCountryId) mineIdx.push(idx);
      if (mineIdx.length) {
        w.focused = true;
        fitRegion(map, model, mineIdx, 5, false);
      }
    }
  }, [status, owners, countries, citiesReady, cityOwners]);

  // 2б. Шар міст: маркери за важливістю, підписи, зони міст вибраної області.
  useEffect(() => {
    const map = mapRef.current;
    const w = worldRef.current;
    if (!map || status !== "ready" || !showCities || !w.model || w.cities) return;
    let cancelled = false;
    (async () => {
      const data = await loadCities();
      if (cancelled || !mapRef.current || !data.list.length) return;
      w.cities = data;
      map.addSource("cities", { type: "geojson", data: citiesGeoJson(data.list) });
      map.addSource("zones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // Території захоплених міст: зона міста (діаграма Вороного) фарбується в колір нового власника.
      map.addSource("selzone", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("captured", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "captured-fill", type: "fill", source: "captured", paint: { "fill-color": ["get", "c"], "fill-opacity": OWNER_OPACITY } });
      // Та сама текстура суші, що й на решті території власника, щоб захоплена зона не відрізнялась.
      if (map.hasImage("land-tex")) map.addLayer({ id: "captured-texture", type: "fill", source: "captured", paint: { "fill-pattern": "land-tex", "fill-opacity": 0.34 } });
      map.addLayer({ id: "captured-line", type: "line", source: "captured", paint: { "line-color": ["get", "c"], "line-width": 2.2, "line-opacity": 0.95 } });
      // Зони міст усередині вибраної області (прев'ю: де проходитиме лінія фронту між містами)
      // Підсвітка вибраної території однієї країни в поділеній області
      map.addLayer({ id: "selzone-fill", type: "fill", source: "selzone", paint: { "fill-color": "#ffffff", "fill-opacity": 0.5 } });
      map.addLayer({ id: "selzone-line", type: "line", source: "selzone", paint: { "line-color": MAP_COLORS.selected, "line-width": 3 } });
      map.addLayer({
        id: "zones-fill", type: "fill", source: "zones",
        paint: { "fill-color": "#ffffff", "fill-opacity": ["get", "a"] },
      });
      map.addLayer({
        id: "zones-line", type: "line", source: "zones",
        paint: { "line-color": "#ffffff", "line-width": 1.1, "line-opacity": 0.85, "line-dasharray": [2, 2] },
      });
      for (const tier of CITY_TIERS) {
        map.addLayer({
          id: "cities-dot-" + tier.id, type: "circle", source: "cities", minzoom: tier.minzoom, filter: tier.filter,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, ["+", 1.4, ["*", ["get", "imp"], 0.02]], 8, ["+", 2.6, ["*", ["get", "imp"], 0.06]]],
            "circle-color": ["case", ["==", ["get", "cap"], 2], "#ffd54a", ["==", ["get", "f"], 1], "#9fb0bd", "#ffffff"],
            "circle-stroke-width": ["case", ["==", ["get", "cap"], 2], 2.2, 1.6],
            "circle-stroke-color": ["coalesce", ["feature-state", "oc"], "#0b1620"],
            // Плавно проявляється після порогу масштабу й так само згасає при віддаленні.
            "circle-opacity": fadeIn(tier.minzoom),
            "circle-stroke-opacity": fadeIn(tier.minzoom),
          },
        });
        map.addLayer({
          id: "cities-label-" + tier.id, type: "symbol", source: "cities", minzoom: tier.minzoom, filter: tier.filter,
          layout: {
            "text-field": labelField(latest.current.lang),
            "text-font": LABEL_FONT,
            "text-size": ["interpolate", ["linear"], ["zoom"], 2, 9, 8, ["+", 11, ["*", ["get", "imp"], 0.04]]],
            "text-offset": [0, 0.85],
            "text-anchor": "top",
            "text-optional": true,
            "symbol-sort-key": ["-", 0, ["get", "imp"]],
          },
          paint: { "text-color": "#ffffff", "text-halo-color": "rgba(6,14,28,0.95)", "text-halo-width": 1.5, "text-opacity": fadeIn(tier.minzoom + 0.15) },
        });
      }
      map.addLayer({
        id: "cities-selected", type: "circle", source: "cities", filter: ["has", "imp"],
        paint: {
          "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2.5, "circle-stroke-color": MAP_COLORS.selected,
          "circle-stroke-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 1, 0],
        },
      });
      setCitiesReady(true);
    })();
    return () => { cancelled = true; };
  }, [status, showCities]);

  // Мова підписів міст.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !citiesReady) return;
    for (const t of CITY_TIERS) if (map.getLayer("cities-label-" + t.id)) map.setLayoutProperty("cities-label-" + t.id, "text-field", labelField(lang));
  }, [citiesReady, lang]);

  // Вибране місто: контур навколо маркера.
  useEffect(() => {
    const map = mapRef.current;
    const w = worldRef.current;
    if (!map || !citiesReady) return;
    if (w.selectedCity >= 0) map.setFeatureState({ source: "cities", id: w.selectedCity }, { sel: false });
    w.selectedCity = selectedCityId === null || selectedCityId === undefined ? -1 : selectedCityId;
    if (w.selectedCity >= 0) map.setFeatureState({ source: "cities", id: w.selectedCity }, { sel: true });
  }, [citiesReady, selectedCityId]);

  // Зони захоплених міст (місто належить іншій країні, ніж його область).
  useEffect(() => {
    const map = mapRef.current;
    const w = worldRef.current;
    if (!map || !citiesReady || !w.model || !w.cities || !map.getSource("captured")) return;
    const colorOf = {};
    for (const c of countries || []) colorOf[c.id] = c.color;
    const byRid = new Map();
    if (cityOwners) {
      for (const c of w.cities.list) {
        const ow = cityOwners[cityKey(c)];
        if (!ow || !colorOf[ow]) continue;
        const idx = w.model.indexByRid.get(c.rid);
        if (idx === undefined || w.ownerByIndex[idx] === ow) continue;
        let arr = byRid.get(c.rid);
        if (!arr) byRid.set(c.rid, (arr = []));
        arr.push(c);
      }
    }
    const features = [];
    w.split = new Map();
    for (const [rid, caps] of byRid) {
      const idx = w.model.indexByRid.get(rid);
      const list = w.cities.byRid.get(rid) || [];
      const zones = cityZones(w.model.regionPolygons(idx), zoneSites(list, cityOwners));
      const zmap = new Map();
      for (const [k, polys] of zones) {
        const city = w.cities.list[k];
        zmap.set(k, { owner: (city && cityOwners[cityKey(city)]) || w.ownerByIndex[idx] || "", polys });
      }
      w.split.set(rid, { zones: zmap });
      for (const c of caps) {
        const geo = zones.get(c.i);
        if (geo) features.push({ type: "Feature", properties: { c: colorOf[cityOwners[cityKey(c)]] }, geometry: { type: "MultiPolygon", coordinates: geo } });
      }
    }
    map.getSource("captured").setData({ type: "FeatureCollection", features });
  }, [citiesReady, cityOwners, countries, owners]);

  // Зони міст вибраної області (діаграма Вороного, обрізана межами області) і підсвітка
  // території однієї країни, якщо область поділена між країнами.
  useEffect(() => {
    const map = mapRef.current;
    const w = worldRef.current;
    if (!map || !citiesReady || !w.model || !map.getSource("zones")) return;
    const src = map.getSource("zones");
    const selSrc = map.getSource("selzone");
    const empty = { type: "FeatureCollection", features: [] };
    const rid = selectedRid ? String(selectedRid) : null;
    const split = rid ? w.split.get(rid) : null;
    if (split) {
      src.setData(empty);
      const regionOwner = w.ownerByIndex[w.model.indexByRid.get(rid)] || "";
      const want = selectedZoneOwner || regionOwner;
      const features = [];
      for (const z of split.zones.values()) {
        if (z.owner === want) features.push({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: z.polys } });
      }
      selSrc.setData({ type: "FeatureCollection", features });
      return;
    }
    selSrc.setData(empty);
    const idx = rid ? w.model.indexByRid.get(rid) : undefined;
    const list = idx !== undefined ? w.cities.byRid.get(rid) || [] : [];
    if (list.length < 2) { src.setData(empty); return; }
    const polys = w.model.regionPolygons(idx);
    const zones = cityZones(polys, zoneSites(list, latest.current.cityOwners));
    const features = [];
    let n = 0;
    for (const [k, polysOfCity] of zones) {
      features.push({ type: "Feature", properties: { k, a: n++ % 2 ? 0.06 : 0.16 }, geometry: { type: "MultiPolygon", coordinates: polysOfCity } });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [citiesReady, selectedRid, selectedZoneOwner, cityOwners, countries, owners]);

  // 3. Вибрана область: підсвітка + контур.
  useEffect(() => {
    const map = mapRef.current;
    const w = worldRef.current;
    if (!map || status !== "ready" || !w.model) return;
    const { model } = w;
    // У поділеній області підсвічується лише територія однієї країни (шар selzone), а не вся область.
    const isSplit = selectedRid ? w.split.has(String(selectedRid)) : false;
    const next = selectedRid && !isSplit ? model.indexByRid.get(String(selectedRid)) ?? -1 : -1;
    const prev = w.selectedIndex;
    if (prev === next) return;
    if (prev >= 0) {
      map.setFeatureState({ source: "regions", id: prev }, { sel: false });
      for (const a of model.regionArcs[prev]) map.setFeatureState({ source: "borders", id: a }, { h: false });
    }
    if (next >= 0) {
      map.setFeatureState({ source: "regions", id: next }, { sel: true });
      for (const a of model.regionArcs[next]) map.setFeatureState({ source: "borders", id: a }, { h: true });
    }
    w.selectedIndex = next;
  }, [status, selectedRid, citiesReady, cityOwners, countries, owners]);

  const loadPercent = Math.round(loadProgress * 100);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 360 }}>
      <style>{`
        @keyframes cn-tmap-spin { to { transform: rotate(360deg); } }
      `}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden" }} />

      {status !== "error" && !veilGone && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            opacity: painted ? 0 : 1, transition: "opacity 0.45s ease", pointerEvents: painted ? "none" : "auto", zIndex: 5,
            background: "linear-gradient(160deg, #0d1b33 0%, #16324f 55%, #1c4a5e 100%)", borderRadius: 12,
          }}
        >
          <div style={{ width: "min(280px, 80%)", textAlign: "center" }}>
            <div
              style={{
                width: 42, height: 42, margin: "0 auto 18px", borderRadius: "50%",
                border: "3px solid rgba(126,201,232,0.2)", borderTopColor: "#7ec9e8", borderRightColor: "#f4b942",
                animation: "cn-tmap-spin 0.9s linear infinite",
              }}
            />
            <div style={{ color: "#dfeffb", fontSize: 13, marginBottom: 12 }}>{loadStage}</div>
            <div style={{ position: "relative", height: 6, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
              <div
                style={{
                  position: "absolute", inset: 0, width: `${Math.max(loadPercent, 4)}%`, borderRadius: 999,
                  background: "linear-gradient(90deg, #7ec9e8, #f4b942)", transition: "width 0.2s ease-out",
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
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            color: "#f87171", fontSize: 13, background: MAP_COLORS.water, borderRadius: 12, padding: 16, textAlign: "center",
          }}
        >
          Не вдалося завантажити карту. Перевір, що файл /data/world-topology.json існує.
        </div>
      )}

      {status === "lost" && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center",
            color: "#dfeffb", fontSize: 13, background: MAP_COLORS.water, borderRadius: 12, padding: 16, textAlign: "center", zIndex: 6,
          }}
        >
          <div>Карту призупинено, бо на пристрої бракує пам'яті.</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: "8px 18px", borderRadius: 999, border: "1px solid rgba(126,201,232,0.6)", background: "rgba(126,201,232,0.15)", color: "#fff", fontWeight: 700 }}
          >
            Перезавантажити
          </button>
        </div>
      )}
    </div>
  );
});

export default TerritoryMap;

// Наближає камеру до групи областей (об'єднані межі), не більше ніж до maxZoom.
function fitRegion(map, model, indices, maxZoom, animate = true) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const idx of indices) {
    const [bw, bs, be, bn] = model.regionBounds(idx);
    if (!Number.isFinite(bw)) continue;
    if (bw < w) w = bw;
    if (bs < s) s = bs;
    if (be > e) e = be;
    if (bn > n) n = bn;
  }
  if (!Number.isFinite(w)) return;
  // Області, що перетинають 180-й меридіан, мають хибні межі на пів світу — не наближаємо до них.
  if (e - w > 120) return;
  map.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom, duration: animate ? 900 : 0 });
}

// Міста для діаграми Вороного: 40 найважливіших міст області + усі захоплені.
function zoneSites(list, cityOwners) {
  const top = list.slice(0, 40);
  if (cityOwners && list.length > 40) {
    for (let i = 40; i < list.length; i++) if (cityOwners[cityKey(list[i])]) top.push(list[i]);
  }
  return top.map((c) => ({ x: c.x, y: c.y, k: c.i }));
}

// Колір маркерів міст = колір країни, яка володіє областю міста (feature-state oc).
function syncCityColors(map, w, colorOf, cityOwners) {
  if (!w.cities || !map.getSource("cities")) return;
  for (const c of w.cities.list) {
    const idx = w.model.indexByRid.get(c.rid);
    const owner = (cityOwners && cityOwners[cityKey(c)]) || (idx !== undefined ? w.ownerByIndex[idx] : "");
    const color = owner ? colorOf[owner] || "" : "";
    if ((w.cityColor.get(c.i) || "") === color) continue;
    w.cityColor.set(c.i, color);
    if (color) map.setFeatureState({ source: "cities", id: c.i }, { oc: color });
    else map.removeFeatureState({ source: "cities", id: c.i }, "oc");
  }
}
