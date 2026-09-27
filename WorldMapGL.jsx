import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import * as topojson from "topojson-client";
import "maplibre-gl/dist/maplibre-gl.css";

// Крок 2 плану: реальна геометрія + реальне володіння (мій/чужий), клік
// вибирає країну. Розрізнення "союзник/ворог" (і саме "живе" оновлення
// кольору без перезавантаження) — наступні кроки, тут ще НЕ підключено,
// бо для цього потрібні ще й wars/alliances, яких компонент поки не отримує.
// onCapture поки що нічим не викликається — сама подія захоплення
// прилітає з сервера через cityControl, а не вирішується тут, у карті.

const TOPOLOGY_URL = "/data/world-topology.json";
const REGION_LINES_MIN_ZOOM = 3.5; // з якого зуму показувати межі областей
const REGION_LINES_FULL_ZOOM = 4.5; // з якого зуму межі областей повністю видимі

const COLOR_WATER = "#7ec9e8";
const COLOR_LAND_NEUTRAL = "#7fb069";
const COLOR_MINE = "#f4b942";
const COLOR_BORDER = "#4a7a3d"; // темніший зелений для меж областей поверх суші
const COLOR_SELECTED_LINE = "#1f2d3d";
const FLAG_FILL_OPACITY = 0.4; // напівпрозорість прапора — колір землі лишається видимим
const FLAG_IMAGE_SIZE = 64; // px, растеризований прапор

// MapLibre fill-pattern потребує растрове зображення, а прапори в грі
// зберігаються як SVG (getFlagSvgs() у App.jsx). Растеризуємо прямо в
// браузері, одноразово при завантаженні карти — без нового файлу чи
// білд-кроку.
async function rasterizeFlag(innerSvg, size = FLAG_IMAGE_SIZE) {
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${innerSvg}</svg>`;
  const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function WorldMapGL({ selected, onSelect, myCountryCode, cityControl, flagSvgs }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error

  // 1. Ініціалізація карти один раз.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      antialias: true, // прибирає тонкі "шви" між внутрішніми тайлами GeoJSON-джерела
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

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "Дані: geoBoundaries CGAZ (CC BY 4.0)",
      }),
    );

    mapRef.current = map;

    map.on("load", async () => {
      try {
        const response = await fetch(TOPOLOGY_URL);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const topology = await response.json();

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

        // Прапори всередині контурів, напівпрозоро — колір власника (шар
        // вище) лишається видимим під прапором, а не замінюється ним.
        if (flagSvgs) {
          const uniqueIsos = [...new Set(geojson.features.map((f) => f.properties?.iso).filter(Boolean))];
          await Promise.all(
            uniqueIsos.map(async (iso) => {
              const svg = flagSvgs[iso.toLowerCase()];
              if (!svg || map.hasImage(iso)) return;
              try {
                const imageData = await rasterizeFlag(svg);
                if (!map.hasImage(iso)) map.addImage(iso, imageData);
              } catch {
                // Якщо конкретний прапор не растеризувався — просто лишаємо
                // ту область без прапора, решта карти працює далі.
              }
            }),
          );

          map.addLayer({
            id: "regions-flag-pattern",
            type: "fill",
            source: "regions",
            paint: {
              "fill-pattern": ["get", "iso"], // початково — прапор "домашньої" країни
              "fill-opacity": FLAG_FILL_OPACITY,
            },
          });
        }

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

        // Другий шар даних: суцільні контури країн — БЕЗ окремого важкого
        // файлу (попередня версія тягла ще +14 МБ world-countries.geojson,
        // саме це, найімовірніше, спричиняло фрізи й вильоти на слабких
        // телефонах). Замість цього "склеюємо" області в контур країни
        // прямо в браузері, з тих самих даних, що вже завантажені —
        // topojson.merge() робить це швидко (одноразово, при завантаженні).
        const geometriesByIso = {};
        for (const geom of topoObject.geometries) {
          const iso = geom.properties?.iso;
          if (!iso) continue;
          (geometriesByIso[iso] ??= []).push(geom);
        }
        const countriesGeojson = {
          type: "FeatureCollection",
          features: Object.entries(geometriesByIso).map(([iso, geoms]) => ({
            type: "Feature",
            properties: { iso },
            geometry: topojson.merge(topology, geoms),
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

        setStatus("ready");
      } catch (error) {
        console.error("Не вдалося завантажити карту:", error);
        setStatus("error");
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Перефарбовуємо, коли змінюється myCountryCode або cityControl
  // (хтось щось захопив). cityControl[iso+"|"+name] — поточний власник,
  // якщо область захоплена; якщо запису нема — власник той, чий iso
  // "від природи" (записаний у самій геометрії). Той самий вираз "хто
  // власник" використовується і для кольору, і для прапора — якщо область
  // захоплено, прапор теж має показувати нового власника, не "домашню"
  // країну.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !map.getLayer("regions-fill")) return;

    const cc = cityControl || {};
    const ownerExpr = ["coalesce", ["get", ["get", "cn_key"], ["literal", cc]], ["get", "iso"]];

    map.setPaintProperty("regions-fill", "fill-color", [
      "case",
      ["==", ownerExpr, myCountryCode || ""],
      COLOR_MINE,
      COLOR_LAND_NEUTRAL,
    ]);

    if (map.getLayer("regions-flag-pattern")) {
      map.setPaintProperty("regions-flag-pattern", "fill-pattern", ownerExpr);
    }
  }, [status, myCountryCode, cityControl]);

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

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 420 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden" }} />
      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#7f97a6",
            fontSize: 13,
            background: COLOR_WATER,
            borderRadius: 12,
          }}
        >
          Завантажуємо карту…
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
