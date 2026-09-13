import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

/* Публічні, безкоштовні джерела даних — без API-ключів:
   - базова "підложка" карти (океан/суша) від OpenFreeMap
   - реальні межі країн від Natural Earth (публічний домен) */
const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const COUNTRIES_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

/* Перефарбовує стандартний світлий стиль OpenFreeMap у темний,
   "кінематографічний" вигляд гри, і прибирає зайві підписи міст/доріг,
   щоб карта лишалась чистою (лише країни + кордони). */
function applyDarkCinematicTheme(map) {
  try {
    if (map.getLayer("background")) {
      map.setPaintProperty("background", "background-color", "#070b13");
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
        map.setPaintProperty(layer.id, "fill-color", "#0a1c30");
        continue;
      }
      if (layer.type === "fill" && /(landcover|landuse|land\b|park)/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-color", "#101a28");
        continue;
      }
      if (layer.type === "line" && /(boundary|border|admin)/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "line-color", "#22314a");
        map.setPaintProperty(layer.id, "line-opacity", 0.5);
        continue;
      }
      if (layer.type === "line") {
        // прибираємо дороги/річки — зайва деталізація на рівні світу
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    } catch {
      /* якийсь шар стилю несумісний — просто пропускаємо */
    }
  }
}

export default function WorldMap3D({ ranked, selected, onSelect, myCountryCode }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const rankedRef = useRef(ranked);
  rankedRef.current = ranked;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* Ініціалізація карти — один раз */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE_URL,
      center: [15, 25],
      zoom: 1.2,
      pitch: 0,
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
          const entry = rankedRef.current.find((c) => c.code === code);
          f.properties.cn_code = code;
          f.properties.cn_ratio = entry ? entry.ratio : 0;
          f.properties.cn_mine = code === myCountryCode ? 1 : 0;
        });

        map.addSource("cn-countries", { type: "geojson", data: geo });

        map.addLayer({
          id: "cn-countries-fill",
          type: "fill",
          source: "cn-countries",
          paint: {
            "fill-color": [
              "case",
              ["==", ["get", "cn_mine"], 1],
              "#3a2f10",
              ["interpolate", ["linear"], ["get", "cn_ratio"], 0, "#14415f", 1, "#ffb703"],
            ],
            "fill-opacity": 0.82,
          },
        });

        map.addLayer({
          id: "cn-countries-outline",
          type: "line",
          source: "cn-countries",
          paint: { "line-color": "#050810", "line-width": 0.6 },
        });

        map.addLayer({
          id: "cn-countries-selected",
          type: "line",
          source: "cn-countries",
          filter: ["==", ["get", "cn_code"], "___none___"],
          paint: { "line-color": "#7dd3fc", "line-width": 2.4 },
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
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* Оновлення забарвлення країн при зміні даних гравців (влада/сила) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("cn-countries");
    if (!src || typeof src.getData !== "function") return;
    let cancelled = false;
    src.getData().then((data) => {
      if (cancelled || !data) return;
      data.features.forEach((f) => {
        const code = f.properties.cn_code;
        const entry = ranked.find((c) => c.code === code);
        f.properties.cn_ratio = entry ? entry.ratio : 0;
        f.properties.cn_mine = code === myCountryCode ? 1 : 0;
      });
      src.setData(data);
    });
    return () => {
      cancelled = true;
    };
  }, [ranked, myCountryCode]);

  /* Підсвітка обраної країни */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("cn-countries-selected")) return;
    map.setFilter("cn-countries-selected", ["==", ["get", "cn_code"], selected || "___none___"]);
  }, [selected]);

  const zoomBy = (delta) => {
    const map = mapRef.current;
    if (map) map.easeTo({ zoom: map.getZoom() + delta, duration: 250 });
  };
  const resetView = () => {
    const map = mapRef.current;
    if (map) map.easeTo({ center: [15, 25], zoom: 1.2, pitch: 0, bearing: 0, duration: 400 });
  };

  return (
    <div className="cn-map3d-wrap">
      <div ref={containerRef} className="cn-map3d-canvas" />
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
