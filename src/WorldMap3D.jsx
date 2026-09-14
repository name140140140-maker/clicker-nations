import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { RefreshCw } from "lucide-react";
import { cnSfx } from "./App";

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

export default function WorldMap3D({ selected, onSelect, myCountryCode }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const featuresByCodeRef = useRef({});
  const prevSelectedRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
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

  /* Підсвітка обраної країни + кінематографічний переліт камери до неї,
     і назад до огляду світу при знятті виділення. Плюс звук. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("cn-countries-selected")) return;
    map.setFilter("cn-countries-selected", ["==", ["get", "cn_code"], selected || "___none___"]);

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
  }, [selected]);

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
