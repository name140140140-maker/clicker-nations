import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { RefreshCw } from "lucide-react";
import { featureCollection, union } from "@turf/turf";
import { cnSfx, getRegionData } from "./App";

/* --- Реальні межі областей для ВСІХ країн ---
   Раніше тут була "пілотна зона" лише для України (окремий remote
  geoBoundaries-фетч). Тепер це один локальний файл ADM1 GeoJSON,
  зібраний build-скриптом з geoBoundaries для всіх доступних країн. */
const WORLD_REGIONS_URL = "/data/world-regions.geojson";

/* Відомі розбіжності назв між грою та реальним геонабором даних
   (перейменування областей, старі/нові назви тощо). Ключі — нормалізовані
  назви з боку гри; значення — можливі варіанти назв у geoBoundaries.
   Наразі перевірено детально тільки для України; для інших країн
   збіги йдуть за прямим нормалізованим порівнянням назв і можуть
   потребувати доповнення цього списку з часом (незбіги просто
   пропускаються, не ламаючи решту карти). */
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

/* Зіставляє назву області гри з реальним об'єктом геоданих (в межах
   однієї країни) за нормалізованою назвою або відомим аліасом;
   повертає null, якщо впевненого збігу не знайдено (тоді ця область
   просто не бере участі в шарі — не ламає решту карти). */
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

function selectedTerritoryFeature(selected, regionFeatures) {
  const selectedFeatures = regionFeatures.filter(
    (feature) => feature.properties.cn_region_owner === selected,
  );
  if (!selectedFeatures.length) return null;
  if (selectedFeatures.length === 1) return selectedFeatures[0];
  try {
    const merged = union(featureCollection(selectedFeatures));
    return merged && merged.geometry ? merged : null;
  } catch {
    return null;
  }
}

/* Публічні, безкоштовні джерела даних — без API-ключів:
   - базова "підложка" карти (океан/суша) від OpenFreeMap
   - реальні межі країн від Natural Earth (публічний домен) */
const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const COUNTRIES_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

const WORLD_VIEW = { center: [15, 25], zoom: 1.2, pitch: 0, bearing: 0 };

/* Насичена, "кінематографічна" темна палітра замість типової блідої
   карти — глибокий океан, майже чорна суша-підложка (самі країни
   малюються окремим яскравим шаром поверх), без зайвих підписів. */
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
        // прибираємо всі лінії базової карти (дороги, річки, стандартні
        // кордони) — наш власний шар країн малює власні чіткі кордони.
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    } catch {
      /* якийсь шар стилю несумісний — просто пропускаємо */
    }
  }
}

/* Проходить довільно вкладену структуру координат GeoJSON
   (Polygon/MultiPolygon) і повертає межі [[minLng,minLat],[maxLng,maxLat]] */
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

/* Приблизна площа полігону в км² (формула Гаусса/шнурівки з поправкою
   на широту). Достатньо точно для показу орієнтовного розміру території
   у сповіщенні — не для точних географічних вимірювань. */
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
    if (poly[0]) total += ringArea(poly[0]); // зовнішній контур; діри не враховуємо — достатньо для орієнтовної оцінки
  });
  return Math.round(total);
}

/* Знаходить id джерела вектор-тайлів, яке містить вказаний source-layer
   (напр. "boundary" чи "place") — без здогадок про конкретну назву,
   читаємо її напряму зі стилю, що вже завантажений. */
function findVectorSourceId(style, sourceLayerName) {
  const layer = style.layers?.find((l) => l["source-layer"] === sourceLayerName);
  return layer ? layer.source : null;
}

/* Додає кордони областей (тонкі пунктирні лінії) та назви міст —
   з'являються лише при наближенні, дані беремо з тієї самої базової
   карти (OpenFreeMap), нічого додатково завантажувати не треба. */
function addRegionsAndCityLabels(map) {
  const style = map.getStyle();
  const boundarySourceId = findVectorSourceId(style, "boundary");
  const placeSourceId = findVectorSourceId(style, "place");
  const textFont =
    style.layers?.find((l) => l.type === "symbol" && l.layout?.["text-font"])?.layout?.["text-font"] ||
    ["Noto Sans Regular"];

  if (boundarySourceId) {
    try {
      map.addLayer({
        id: "cn-admin-regions",
        type: "line",
        source: boundarySourceId,
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], true]],
        minzoom: 3.2,
        paint: {
          "line-color": "#4d7fac",
          "line-width": 1,
          "line-dasharray": [2, 2],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.2, 0, 4.5, 0.75],
        },
      });
    } catch {
      /* базова карта може не мати цього джерела — пропускаємо без помилки */
    }
  }

  if (placeSourceId) {
    try {
      map.addLayer({
        id: "cn-place-cities",
        type: "symbol",
        source: placeSourceId,
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        minzoom: 4,
        layout: {
          "text-field": ["get", "name"],
          "text-font": textFont,
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13],
          "text-anchor": "top",
          "text-offset": [0, 0.3],
        },
        paint: {
          "text-color": "#dbe9ff",
          "text-halo-color": "#050810",
          "text-halo-width": 1.2,
        },
      });
    } catch {
      /* немає шару міст у цій базовій карті — пропускаємо без помилки */
    }
  }
}

export default function WorldMap3D({ selected, onSelect, myCountryCode, cityControl, onCapture }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const featuresByCodeRef = useRef({});
  const regionFeaturesRef = useRef([]);
  const prevCityControlRef = useRef(null);
  const flashTimerRef = useRef(null);
  const prevSelectedRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const cityControlRef = useRef(cityControl);
  cityControlRef.current = cityControl;
  const myCountryCodeRef = useRef(myCountryCode);
  myCountryCodeRef.current = myCountryCode;
  const [loaded, setLoaded] = useState(false);

  /* Ініціалізація карти — один раз */
  useEffect(() => {
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

    map.on("load", async () => {
      applyDarkCinematicTheme(map);

      try {
        const res = await fetch(COUNTRIES_GEOJSON_URL);
        const geo = await res.json();

        geo.features.forEach((f) => {
          const code = f.properties.ISO_A2 || f.properties.iso_a2 || f.properties.ISO_A2_EH || "";
          f.properties.cn_code = code;
          f.properties.cn_mine = code === myCountryCode ? 1 : 0;
          if (code) featuresByCodeRef.current[code] = f;
        });

        map.addSource("cn-countries", { type: "geojson", data: geo });

        /* Усі країни — однаковий насичений синій. Лише країна гравця
           світиться яскравіше (окремий шар + два шари світіння лінією). */
        map.addLayer({
          id: "cn-countries-fill",
          type: "fill",
          source: "cn-countries",
          paint: {
            "fill-color": ["case", ["==", ["get", "cn_mine"], 1], "#22d3ee", "#1c4f7a"],
            "fill-opacity": ["case", ["==", ["get", "cn_mine"], 1], 0.55, 0.72],
          },
        });

        map.addLayer({
          id: "cn-countries-outline",
          type: "line",
          source: "cn-countries",
          paint: { "line-color": "#0a1626", "line-width": 0.6 },
        });

        /* Зовнішнє "світіння" навколо країни гравця */
        map.addLayer({
          id: "cn-mine-glow-outer",
          type: "line",
          source: "cn-countries",
          filter: ["==", ["get", "cn_mine"], 1],
          paint: { "line-color": "#7cf0ff", "line-width": 7, "line-opacity": 0.22, "line-blur": 3 },
        });
        map.addLayer({
          id: "cn-mine-glow-inner",
          type: "line",
          source: "cn-countries",
          filter: ["==", ["get", "cn_mine"], 1],
          paint: { "line-color": "#baf6ff", "line-width": 1.8, "line-opacity": 0.95 },
        });

        map.addLayer({
          id: "cn-countries-selected",
          type: "line",
          source: "cn-countries",
          filter: ["==", ["get", "cn_code"], "___none___"],
          paint: { "line-color": "#ffffff", "line-width": 2.2, "line-opacity": 0.9 },
        });
        map.addSource("cn-selected-territory-outline", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "cn-selected-territory-outline",
          type: "line",
          source: "cn-selected-territory-outline",
          paint: { "line-color": "#ffffff", "line-width": 2.2, "line-opacity": 0.9 },
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

        addRegionsAndCityLabels(map);

        /* --- Шар реальних областей для всіх країн, кольор залежить
           від того, хто зараз контролює область у грі --- */
        try {
          const regionsRes = await fetch(WORLD_REGIONS_URL);
          const worldGeo = await regionsRes.json();

          /* Групуємо geoBoundaries-фічі по ISO2 країни та нормалізованій назві,
             щоб зіставити їх з іменами регіонів гри окремо для кожної країни. */
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
            if (!featuresByNormName) return; // для країни немає ADM1-даних — пропускаємо
            const gameRegions = (allRegionData[countryCode]?.regions || []).map((r) => r.name);
            gameRegions.forEach((name) => {
              const f = matchGameRegionToFeature(name, featuresByNormName);
              if (f) {
                const copy = JSON.parse(JSON.stringify(f));
                const key = countryCode + "|" + name;
                const owner = ownerForRegion(cityControlRef.current, key, countryCode);
                copy.properties.cn_region_name = name;
                copy.properties.cn_region_iso = countryCode;
                copy.properties.cn_region_key = key;
                copy.properties.cn_region_owner = owner;
                copy.properties.cn_region_mine = owner === myCountryCodeRef.current ? 1 : 0;
                matchedFeatures.push(copy);
              } else {
                (unmatchedByCountry[countryCode] = unmatchedByCountry[countryCode] || []).push(name);
              }
            });
          });

          if (Object.keys(unmatchedByCountry).length) {
            console.warn("WorldMap3D: не знайдено відповідність для областей:", unmatchedByCountry);
          }

          const countryCodesWithRegions = [...new Set(
            matchedFeatures.map((feature) => feature.properties.cn_region_iso).filter(Boolean),
          )];
          geo.features.forEach((feature) => {
            const code = feature.properties.cn_code;
            feature.properties.cn_has_regions = countryCodesWithRegions.includes(code) ? 1 : 0;
          });
          map.getSource("cn-countries")?.setData(geo);
          map.setFilter("cn-countries-outline", [
            "!",
            ["in", ["get", "cn_code"], ["literal", countryCodesWithRegions]],
          ]);

          regionFeaturesRef.current = matchedFeatures;
          prevCityControlRef.current = { ...(cityControlRef.current || {}) };

          map.addSource("cn-pilot-regions", {
            type: "geojson",
            data: { type: "FeatureCollection", features: matchedFeatures },
          });

          map.addLayer({
            id: "cn-pilot-regions-fill",
            type: "fill",
            source: "cn-pilot-regions",
            minzoom: 3.2,
            paint: {
              "fill-color": ["case", ["==", ["get", "cn_region_mine"], 1], "#22d3ee", "#1c4f7a"],
              "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3.2, 0, 4, 0.78],
            },
          });
          map.addLayer({
            id: "cn-pilot-regions-outline",
            type: "line",
            source: "cn-pilot-regions",
            minzoom: 3.2,
            paint: {
              "line-color": "#0a1626",
              "line-width": 0.7,
              "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.2, 0, 4, 1],
            },
          });

          /* "Спалах" при щойному захопленні території — кероване через
             filter/paint напряму з JS (див. ефект нижче) */
          map.addLayer({
            id: "cn-pilot-regions-flash",
            type: "line",
            source: "cn-pilot-regions",
            filter: ["==", ["get", "cn_region_key"], "___none___"],
            paint: { "line-color": "#ffffff", "line-width": 3.5, "line-opacity": 1, "line-blur": 1.5 },
          });
        } catch (err) {
          console.warn("WorldMap3D: шар областей не завантажився:", err?.message || err);
        }

        readyRef.current = true;
      } catch (err) {
        console.warn("WorldMap3D: не вдалося завантажити межі країн:", err?.message || err);
      }
      setLoaded(true);
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* Перефарбувати "свою" країну, якщо гравець змінив країну */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("cn-countries");
    if (!src || typeof src.getData !== "function") return;
    let cancelled = false;
    src.getData().then((data) => {
      if (cancelled || !data) return;
      data.features.forEach((f) => {
        f.properties.cn_mine = f.properties.cn_code === myCountryCode ? 1 : 0;
      });
      src.setData(data);
    });
    return () => {
      cancelled = true;
    };
  }, [myCountryCode]);

  /* Перефарбувати шар областей, коли змінюється хто контролює область
     (наприклад після завершення війни) або коли гравець змінив свою
     країну. Якщо власник конкретної області змінився — показуємо
     короткий "спалах" на її кордоні та повідомляємо батьківський
     компонент (для сповіщення "Територію захоплено"). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("cn-pilot-regions");
    if (!src) return;

    const prevControl = prevCityControlRef.current;
    let capturedRegionKey = null;
    let captureEvent = null;

    const updated = regionFeaturesRef.current.map((f) => {
      const key = f.properties.cn_region_key;
      const countryCode = f.properties.cn_region_iso;
      const hasExplicitOwner = Object.prototype.hasOwnProperty.call(cityControl || {}, key);
      const newOwner = hasExplicitOwner ? cityControl[key] : countryCode;
      const hadPrevOwner = prevControl && Object.prototype.hasOwnProperty.call(prevControl, key);
      const oldOwner = hadPrevOwner ? prevControl[key] : countryCode;
      if (prevControl && newOwner !== oldOwner) {
        capturedRegionKey = key;
        captureEvent = {
          name: f.properties.cn_region_name,
          previousOwner: oldOwner,
          newOwner,
          areaKm2: approxAreaKm2(f.geometry),
        };
      }
      return {
        ...f,
        properties: {
          ...f.properties,
          cn_region_owner: newOwner,
          cn_region_mine: newOwner === myCountryCode ? 1 : 0,
        },
      };
    });
    regionFeaturesRef.current = updated;
    prevCityControlRef.current = { ...(cityControl || {}) };
    src.setData({ type: "FeatureCollection", features: updated });

    if (capturedRegionKey && map.getLayer("cn-pilot-regions-flash")) {
      cnSfx.purchase();
      map.setFilter("cn-pilot-regions-flash", ["==", ["get", "cn_region_key"], capturedRegionKey]);
      map.setPaintProperty("cn-pilot-regions-flash", "line-opacity", 1);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        map.setFilter("cn-pilot-regions-flash", ["==", ["get", "cn_region_key"], "___none___"]);
      }, 2200);
    }
    if (captureEvent && onCapture) onCapture(captureEvent);
  }, [cityControl, myCountryCode]);

  /* Підсвітка обраної країни + кінематографічний переліт камери до неї,
     і назад до огляду світу при знятті виділення. Плюс звук. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const territorySource = map.getSource("cn-selected-territory-outline");
    const territoryFeature = selected && regionFeaturesRef.current.length
      ? selectedTerritoryFeature(selected, regionFeaturesRef.current)
      : null;

    if (territorySource && typeof territorySource.setData === "function") {
      territorySource.setData({
        type: "FeatureCollection",
        features: territoryFeature ? [territoryFeature] : [],
      });
    }

    if (map.getLayer("cn-countries-selected")) {
      if (territoryFeature) {
        map.setFilter("cn-countries-selected", ["==", ["get", "cn_code"], "___none___"]);
      } else {
        map.setFilter("cn-countries-selected", ["==", ["get", "cn_code"], selected || "___none___"]);
      }
    }

    if (selected && selected !== prevSelectedRef.current) {
      cnSfx.modalOpen();
      const feature = featuresByCodeRef.current[selected];
      const bounds = feature ? boundsFromGeometry(feature.geometry) : null;
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
  }, [selected, cityControl]);

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
    <div className="cn-map3d-wrap">
      <div ref={containerRef} className="cn-map3d-canvas" />
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
