import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * WorldMapGL — тестова заміна WorldMap3D.
 * Поки що БЕЗ областей: просто базова карта MapLibre, той самий стиль,
 * що на https://maplibre.org/maplibre-gl-js/docs/examples/display-a-map/
 * Мета цього кроку — перевірити сам рендер (zoom/pan/тайли), а не логіку гри.
 */
export default function WorldMapGL({ selected, onSelect, myCountryCode, cityControl, onCapture }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json", // той самий демо-стиль, що в прикладі
      center: [0, 20],
      zoom: 1.3,
      attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 420,
        borderRadius: 12,
        overflow: "hidden",
      }}
    />
  );
}
