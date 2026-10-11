import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildRegionModel } from "./map/regionsModel.js";

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
  water: "#0c2236",
  free: "#a9b4a3",
  border: "#0b1620",
  borderInternal: "#33424d",
  mine: "#ffffff",
  selected: "#ffd54a",
};

const OWNER_OPACITY = 0.9;

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
  { mode = "view", owners, countries, myCountryId, selectedRid, onSelectRegion },
  ref,
) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState("Завантажуємо карту…");

  // Усе, що створюється при завантаженні й потрібне ефектам нижче.
  const worldRef = useRef({
    model: null,
    ownerByIndex: null, // поточні власники областей (id країни або "")
    colorByIndex: null,
    selectedIndex: -1,
    focused: false,
  });
  // Актуальні пропси для довгоживучих обробників карти.
  const latest = useRef({});
  latest.current = { onSelectRegion, owners, countries, myCountryId, mode };

  useImperativeHandle(ref, () => ({
    flyToRid(rid) {
      const { model } = worldRef.current;
      const map = mapRef.current;
      if (!model || !map) return;
      const idx = model.indexByRid.get(String(rid));
      if (idx === undefined) return;
      fitRegion(map, model, [idx], 5.5);
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
      fadeDuration: 0,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": MAP_COLORS.water } }] },
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

        addGeoJsonSource(map, "regions", regionsBlob, { maxzoom: SOURCE_MAX_ZOOM });
        addGeoJsonSource(map, "borders", bordersBlob, { maxzoom: SOURCE_MAX_ZOOM });

        // Усі вирази залежать лише від feature-state: після створення шарів їх не змінюємо
        // (зміна data-driven виразу перебудовує плитки всього джерела — важко на телефонах).
        const mine = latest.current.myCountryId || "";
        const mineEdge = mine
          ? ["all", ["!=", ownerA, ownerB], ["any", ["==", ownerA, mine], ["==", ownerB, mine]]]
          : false;

        map.addLayer({
          id: "regions-fill",
          type: "fill",
          source: "regions",
          paint: {
            "fill-color": ["to-color", ["coalesce", ["feature-state", "c"], MAP_COLORS.free]],
            "fill-opacity": ["case", ["==", regionOwner, ""], 0.92, OWNER_OPACITY],
          },
        });
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
        // Усі інші лінії — один шар: кордон між різними власниками, узбережжя,
        // рамка власної території, контур вибраної області.
        map.addLayer({
          id: "borders-main",
          type: "line",
          source: "borders",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["case", isHighlighted, MAP_COLORS.selected, mineEdge, MAP_COLORS.mine, MAP_COLORS.border],
            "line-width": ["case", isHighlighted, 3, mineEdge, 2.4, isCoast, 0.7, ["!=", ownerA, ownerB], 1.5, 0],
            "line-opacity": ["case", isHighlighted, 1, mineEdge, 1, isCoast, 0.6, 0.9],
          },
        });

        map.on("click", (event) => {
          const top = map.queryRenderedFeatures(event.point, { layers: ["regions-fill"] })[0];
          if (!top || top.id === undefined) return;
          const w = worldRef.current;
          const idx = Number(top.id);
          const region = w.model.regions[idx];
          if (!region || !latest.current.onSelectRegion) return;
          latest.current.onSelectRegion({ rid: region.rid, name: region.name, index: idx, ownerId: w.ownerByIndex[idx] || "" });
        });
        map.on("mouseenter", "regions-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "regions-fill", () => { map.getCanvas().style.cursor = ""; });

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
      worldRef.current.model = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // Один раз після завантаження: у режимі перегляду наближаємо камеру до власної країни.
    if (!w.focused && latest.current.mode === "view" && latest.current.myCountryId) {
      const mineIdx = [];
      for (const [idx, cid] of nextOwner) if (cid === latest.current.myCountryId) mineIdx.push(idx);
      if (mineIdx.length) {
        w.focused = true;
        fitRegion(map, model, mineIdx, 5, false);
      }
    }
  }, [status, owners, countries]);

  // 3. Вибрана область: підсвітка + контур.
  useEffect(() => {
    const map = mapRef.current;
    const w = worldRef.current;
    if (!map || status !== "ready" || !w.model) return;
    const { model } = w;
    const next = selectedRid ? model.indexByRid.get(String(selectedRid)) ?? -1 : -1;
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
  }, [status, selectedRid]);

  const loadPercent = Math.round(loadProgress * 100);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 360 }}>
      <style>{`
        @keyframes cn-tmap-spin { to { transform: rotate(360deg); } }
      `}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden" }} />

      {status === "loading" && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
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
