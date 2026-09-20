import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { RefreshCw } from "lucide-react";
import { featureCollection, union } from "@turf/turf";
import { cnSfx, getRegionData } from "./App";

/* --- Реальні межі областей для ВСІХ країн ---
   Один локальний файл ADM1 GeoJSON, зібраний build-скриптом з
   geoBoundaries для всіх доступних країн. */
const WORLD_REGIONS_URL = "/data/world-regions.geojson";

/* Відомі розбіжності назв між грою та реальним геонабором даних. */
const REGION_NAME_ALIASES = {
  kirovohrad: ["kropyvnytskyi", "kirovograd"],
  transcarpathia: ["zakarpattia", "zakarpatska", "zakarpattya"],
  lviv: ["lvivska", "lvov"],
  odessa: ["odesa", "odeska"],
  crimea: ["avtonomnarespublikakrym", "autonomousrepublicofcrimea"],
  kyivcity: ["kyiv city", "misto kyiv", "kyivcity"],
};

function normalizeRegionName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’‘]/g, "")
    .replace(/\b(oblast|region|province|city|autonomous republic of|republic of|county|department|district)\b/g, "")
    .replace(/[^a-z]/g, "")
    .trim();
}

function matchGameRegionToFeature(gameRegionName, featuresByNormName) {
  const norm = normalizeRegionName(gameRegionName);
  if (featuresByNormName[norm]) return featuresByNormName[norm];
  for (const [key, aliases] of Object.entries(REGION_NAME_ALIASES)) {
    if (key === norm || aliases.some((a) => normalizeRegionName(a) === norm)) {
      if (featuresByNormName[key]) return featuresByNormName[key];
      for (const a of aliases) {
        const an = normalizeRegionName(a);
        if (featuresByNormName[an]) return featuresByNormName[an];
      }
    }
  }
  return null;
}

function ownerForRegion(cityControl, key, countryCode) {
  return Object.prototype.hasOwnProperty.call(cityControl || {}, key)
    ? cityControl[key]
    : countryCode;
}

function polygonPartsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/* Об'єднує (dissolve) полігони всіх областей одного власника в одну
   суцільну територію — це основа "живого" державного кордону: коли
   область переходить іншому власнику, вона переходить з однієї
   dissolve-групи в іншу, і форма (та її прапор-заливка) сама змінюється
   для БУДЬ-ЯКОЇ країни світу. */
function dissolveOwnerTerritory(features) {
  if (!features.length) return null;
  let acc = features[0].geometry;
  for (let i = 1; i < features.length; i++) {
    const nextGeom = features[i].geometry;
    try {
      const merged = union(
        featureCollection([
          { type: "Feature", properties: {}, geometry: acc },
          { type: "Feature", properties: {}, geometry: nextGeom },
        ]),
      );
      if (merged && merged.geometry) {
        acc = merged.geometry;
        continue;
      }
    } catch {
      /* впало на цій парі — з'єднуємо нижче без dissolve внутрішнього шва */
    }
    acc = { type: "MultiPolygon", coordinates: [...polygonPartsOf(acc), ...polygonPartsOf(nextGeom)] };
  }
  return acc;
}

function computeTerritories(regionFeatures) {
  const byOwner = {};
  regionFeatures.forEach((f) => {
    const owner = f.properties.cn_region_owner;
    (byOwner[owner] = byOwner[owner] || []).push(f);
  });
  return Object.entries(byOwner)
    .map(([owner, feats]) => {
      const geometry = dissolveOwnerTerritory(feats);
      if (!geometry) return null;
      return { type: "Feature", properties: { cn_owner: owner }, geometry };
    })
    .filter(Boolean);
}

const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const COUNTRIES_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

const WORLD_VIEW = { center: [15, 25], zoom: 1.2, pitch: 0, bearing: 0 };

function applyDarkCinematicTheme(map) {
  try {
    if (map.getLayer("background")) {
      map.setPaintProperty("background", "background-color", "#050810");
    }
  } catch {
    /* ignore */
  }
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers) {
    try {
      if (layer.type === "symbol") {
        map.setLayoutProperty(layer.id, "visibility", "none");
        continue;
      }
      if (layer.type === "fill" && /water/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-color", "#08101f");
        continue;
      }
      if (layer.type === "fill" && /(landcover|landuse|land\b|park)/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-color", "#050a13");
        continue;
      }
      if (layer.type === "line") {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    } catch {
      /* якийсь шар стилю несумісний — просто пропускаємо */
    }
  }
}

function boundsFromGeometry(geometry) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    coords.forEach(walk);
  };
  walk(geometry.coordinates);
  if (!isFinite(minLng)) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

function approxAreaKm2(geometry) {
  const KM_PER_DEG_LAT = 111.32;
  const ringArea = (ring) => {
    let sum = 0;
    const avgLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const kmPerDegLng = KM_PER_DEG_LAT * Math.cos((avgLat * Math.PI) / 180);
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng1, lat1] = ring[i];
      const [lng2, lat2] = ring[i + 1];
      sum += lng1 * kmPerDegLng * (lat2 * KM_PER_DEG_LAT) - lng2 * kmPerDegLng * (lat1 * KM_PER_DEG_LAT);
    }
    return Math.abs(sum / 2);
  };
  let total = 0;
  const polys = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  polys.forEach((poly) => {
    if (poly[0]) total += ringArea(poly[0]);
  });
  return Math.round(total);
}

/* Прапор для коду країни — публічний безкоштовний CDN, без ключів.
   Кешується один раз на код; onReady викликається, коли зображення
   реально завантажилось (щоб перемалювати оверлей саме тоді). */
function getFlagImage(cache, code, onReady) {
  if (!code) return null;
  const entry = cache[code];
  if (entry) return entry.failed ? null : entry.complete && entry.naturalWidth ? entry : null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => onReady();
  img.onerror = () => {
    cache[code] = { failed: true };
  };
  img.src = `https://flagcdn.com/h240/${code.toLowerCase()}.png`;
  cache[code] = img;
  return null;
}

/* Проектує геометрію (Polygon/MultiPolygon, лат/лон) в екранні пікселі
   поточного вигляду карти й одразу повертає готовий Path2D + bbox —
   саме це дозволяє "заливати" фігуру растровим зображенням (прапором),
   обрізаним рівно по контуру, синхронно з панорамуванням/зумом/нахилом. */
function buildScreenPath(map, geometry) {
  const path = new Path2D();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  polys.forEach((poly) => {
    poly.forEach((ring) => {
      const sub = new Path2D();
      ring.forEach(([lng, lat], i) => {
        const p = map.project([lng, lat]);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        if (i === 0) sub.moveTo(p.x, p.y);
        else sub.lineTo(p.x, p.y);
      });
      sub.closePath();
      path.addPath(sub);
    });
  });
  if (!isFinite(minX)) return null;
  return { path, bbox: { minX, minY, maxX, maxY } };
}

export default function WorldMap3D({ selected, onSelect, myCountryCode, cityControl, onCapture }) {
  const containerRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const mapRef = useRef(null);
  const featuresByCodeRef = useRef({});
  const regionFeaturesRef = useRef([]);
  const territoriesRef = useRef([]);
  const flagImagesRef = useRef({});
  const prevCityControlRef = useRef(null);
  const flashRef = useRef(null);
  const prevSelectedRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const myCountryCodeRef = useRef(myCountryCode);
  myCountryCodeRef.current = myCountryCode;
  const [loaded, setLoaded] = useState(false);

  /* Малює весь видимий шар країн/територій — прапор-заливка, кордони,
     світіння "моєї" країни, білий контур виділення, спалах захоплення.
     Викликається на кожен рендер карти (map.on("render", ...)) — тобто
     завжди синхронно з поточним поворотом/нахилом/зумом. */
  useEffect(() => {
    const drawOverlay = () => {
      const map = mapRef.current;
      const canvas = overlayCanvasRef.current;
      if (!map || !canvas) return;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (!cssW || !cssH) return;
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const drawables = territoriesRef.current.map((t) => ({
        code: t.properties.cn_owner,
        geometry: t.geometry,
      }));
      const covered = new Set(drawables.map((d) => d.code));
      Object.values(featuresByCodeRef.current).forEach((f) => {
        const code = f.properties.cn_code;
        if (!code || covered.has(code)) return;
        drawables.push({ code, geometry: f.geometry });
      });

      drawables.forEach(({ code, geometry }) => {
        const built = buildScreenPath(map, geometry);
        if (!built) return;
        const { path, bbox } = built;
        const mine = code === myCountryCodeRef.current;
        const img = getFlagImage(flagImagesRef.current, code, () => map.triggerRepaint());

        ctx.save();
        ctx.clip(path);
        if (img) {
          ctx.drawImage(img, bbox.minX, bbox.minY, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
          if (mine) {
            ctx.fillStyle = "rgba(34,211,238,0.16)";
            ctx.fillRect(bbox.minX, bbox.minY, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
          }
        } else {
          ctx.fillStyle = mine ? "#22d3ee" : "#1c4f7a";
          ctx.fillRect(bbox.minX, bbox.minY, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
        }
        ctx.restore();

        ctx.lineWidth = 1;
        ctx.strokeStyle = "#0a1626";
        ctx.stroke(path);

        if (mine) {
          ctx.save();
          ctx.shadowColor = "#7cf0ff";
          ctx.shadowBlur = 14;
          ctx.strokeStyle = "#baf6ff";
          ctx.lineWidth = 2;
          ctx.stroke(path);
          ctx.restore();
        }

        if (selectedRef.current && code === selectedRef.current) {
          ctx.save();
          ctx.shadowColor = "#ffffff";
          ctx.shadowBlur = 10;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2.6;
          ctx.stroke(path);
          ctx.restore();
        }
      });

      // тонкі внутрішні лінії поділу на області — однакові завжди,
      // не позначають державний кордон (той малюється вище, по контуру
      // dissolve-території кожного власника).
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(10,22,38,0.55)";
      regionFeaturesRef.current.forEach((f) => {
        const built = buildScreenPath(map, f.geometry);
        if (built) ctx.stroke(built.path);
      });

      if (flashRef.current && Date.now() < flashRef.current.until) {
        const region = regionFeaturesRef.current.find((f) => f.properties.cn_region_key === flashRef.current.key);
        if (region) {
          const built = buildScreenPath(map, region.geometry);
          if (built) {
            ctx.save();
            ctx.shadowColor = "#ffffff";
            ctx.shadowBlur = 10;
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3;
            ctx.stroke(built.path);
            ctx.restore();
          }
        }
        map.triggerRepaint();
      }
    };

    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE_URL,
      center: WORLD_VIEW.center,
      zoom: WORLD_VIEW.zoom,
      pitch: WORLD_VIEW.pitch,
      minZoom: 0.8,
      maxZoom: 8,
      maxPitch: 55,
      attributionControl: false,
      dragRotate: true,
      touchPitch: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    map.on("render", drawOverlay);

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(containerRef.current);

    map.on("load", async () => {
      applyDarkCinematicTheme(map);

      try {
        const res = await fetch(COUNTRIES_GEOJSON_URL);
        const geo = await res.json();

        geo.features.forEach((f) => {
          const code = f.properties.ISO_A2 || f.properties.iso_a2 || f.properties.ISO_A2_EH || "";
          f.properties.cn_code = code;
          if (code) featuresByCodeRef.current[code] = f;
        });

        map.addSource("cn-countries", { type: "geojson", data: geo });

        /* Невидимий шар — потрібен лише для визначення кліку по країні
           (весь видимий вигляд малює overlay-канвас поверх). */
        map.addLayer({
          id: "cn-countries-fill",
          type: "fill",
          source: "cn-countries",
          paint: { "fill-color": "#000000", "fill-opacity": 0 },
        });

        map.on("click", "cn-countries-fill", (e) => {
          const code = e.features?.[0]?.properties?.cn_code;
          if (code && onSelectRef.current) onSelectRef.current(code);
        });
        map.on("mouseenter", "cn-countries-fill", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "cn-countries-fill", () => {
          map.getCanvas().style.cursor = "";
        });

        try {
          const regionsRes = await fetch(WORLD_REGIONS_URL);
          const worldGeo = await regionsRes.json();

          const featuresByIsoAndNormName = {};
          worldGeo.features.forEach((f) => {
            const iso = f.properties.cn_region_iso;
            if (!iso) return;
            if (!featuresByIsoAndNormName[iso]) featuresByIsoAndNormName[iso] = {};
            featuresByIsoAndNormName[iso][normalizeRegionName(f.properties.cn_region_name)] = f;
          });

          const allRegionData = getRegionData();
          const matchedFeatures = [];
          const unmatchedByCountry = {};

          Object.keys(allRegionData).forEach((countryCode) => {
            const featuresByNormName = featuresByIsoAndNormName[countryCode];
            if (!featuresByNormName) return;
            const gameRegions = (allRegionData[countryCode]?.regions || []).map((r) => r.name);
            gameRegions.forEach((name) => {
              const f = matchGameRegionToFeature(name, featuresByNormName);
              if (f) {
                const copy = JSON.parse(JSON.stringify(f));
                const key = countryCode + "|" + name;
                const owner = ownerForRegion(cityControl, key, countryCode);
                copy.properties.cn_region_name = name;
                copy.properties.cn_region_iso = countryCode;
                copy.properties.cn_region_key = key;
                copy.properties.cn_region_owner = owner;
                matchedFeatures.push(copy);
              } else {
                (unmatchedByCountry[countryCode] = unmatchedByCountry[countryCode] || []).push(name);
              }
            });
          });

          if (Object.keys(unmatchedByCountry).length) {
            console.warn("WorldMap3D: не знайдено відповідність для областей:", unmatchedByCountry);
          }

          regionFeaturesRef.current = matchedFeatures;
          prevCityControlRef.current = { ...(cityControl || {}) };
          territoriesRef.current = computeTerritories(matchedFeatures);
          map.triggerRepaint();
        } catch (err) {
          console.warn("WorldMap3D: шар областей не завантажився:", err?.message || err);
        }
      } catch (err) {
        console.warn("WorldMap3D: не вдалося завантажити межі країн:", err?.message || err);
      }
      setLoaded(true);
      map.triggerRepaint();
    });

    return () => {
      resizeObserver.disconnect();
      map.off("render", drawOverlay);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Тільки перемальовка (жодних setData) — "моя країна" рахується live
     прямо в drawOverlay з myCountryCodeRef, тож ніякого застарілого
     прапорця десь у даних просто не існує — ця ціла категорія багів
     (стара країна лишається підсвіченою) структурно неможлива тепер. */
  useEffect(() => {
    mapRef.current?.triggerRepaint();
  }, [myCountryCode]);

  /* Перерахувати "живу" територію кожної країни при зміні cityControl —
     єдине місце, де справді потрібна повторна dissolve-геометрія. */
  useEffect(() => {
    if (!loaded) return;
    const prevControl = prevCityControlRef.current;
    let capturedRegionKey = null;
    let captureEvent = null;

    const updatedRegions = regionFeaturesRef.current.map((f) => {
      const key = f.properties.cn_region_key;
      const countryCode = f.properties.cn_region_iso;
      const newOwner = ownerForRegion(cityControl, key, countryCode);
      const oldOwner = prevControl ? ownerForRegion(prevControl, key, countryCode) : newOwner;
      if (prevControl && newOwner !== oldOwner) {
        capturedRegionKey = key;
        captureEvent = {
          name: f.properties.cn_region_name,
          previousOwner: oldOwner,
          newOwner,
          areaKm2: approxAreaKm2(f.geometry),
        };
      }
      return { ...f, properties: { ...f.properties, cn_region_owner: newOwner } };
    });
    regionFeaturesRef.current = updatedRegions;
    prevCityControlRef.current = { ...(cityControl || {}) };
    territoriesRef.current = computeTerritories(updatedRegions);

    if (capturedRegionKey) {
      cnSfx.purchase();
      flashRef.current = { key: capturedRegionKey, until: Date.now() + 2200 };
      if (captureEvent && onCapture) onCapture(captureEvent);
    }
    mapRef.current?.triggerRepaint();
  }, [cityControl, loaded]);

  /* Виділення + переліт камери до реальної (живої) території країни. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    if (selected && selected !== prevSelectedRef.current) {
      cnSfx.modalOpen();
      const territory = territoriesRef.current.find((t) => t.properties.cn_owner === selected);
      const geometryForBounds = territory ? territory.geometry : featuresByCodeRef.current[selected]?.geometry;
      const bounds = geometryForBounds ? boundsFromGeometry(geometryForBounds) : null;
      if (bounds) {
        try {
          const cam = map.cameraForBounds(bounds, { padding: 60, pitch: 42, bearing: 0, maxZoom: 6 });
          if (cam) {
            map.flyTo({ ...cam, duration: 1500, curve: 1.3, essential: true });
          } else {
            const center = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
            map.flyTo({ center, zoom: 4, pitch: 42, duration: 1500, essential: true });
          }
        } catch {
          /* ignore camera errors on odd geometries */
        }
      }
    } else if (!selected && prevSelectedRef.current) {
      cnSfx.modalClose();
      map.flyTo({ ...WORLD_VIEW, duration: 1200, essential: true });
    }
    prevSelectedRef.current = selected;
    map.triggerRepaint();
  }, [selected, cityControl, loaded]);

  const zoomBy = (delta) => {
    const map = mapRef.current;
    if (map) {
      cnSfx.toggle();
      map.easeTo({ zoom: map.getZoom() + delta, duration: 250 });
    }
  };
  const resetView = () => {
    const map = mapRef.current;
    if (map) {
      cnSfx.toggle();
      map.flyTo({ ...WORLD_VIEW, duration: 900 });
    }
  };

  return (
    <div className="cn-map3d-wrap" style={{ position: "relative" }}>
      <div ref={containerRef} className="cn-map3d-canvas" style={{ position: "absolute", inset: 0 }} />
      <canvas
        ref={overlayCanvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
      {!loaded && (
        <div className="cn-map3d-loading">
          <RefreshCw size={26} className="cn-spin" />
          <div>Завантаження карти світу…</div>
        </div>
      )}
      <div className="cn-map-toolbar">
        <button className="cn-map-zoom-btn" type="button" onClick={() => zoomBy(1)} aria-label="Наблизити">
          +
        </button>
        <button className="cn-map-zoom-btn" type="button" onClick={() => zoomBy(-1)} aria-label="Віддалити">
          −
        </button>
        <button className="cn-map-zoom-btn cn-map-zoom-btn--reset" type="button" onClick={resetView} aria-label="Скинути">
          ⟲
        </button>
      </div>
    </div>
  );
}
