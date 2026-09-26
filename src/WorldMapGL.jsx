import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import * as topojson from "topojson-client";
import { getFlagSvgs } from "./App";
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
const FLAG_FILL_OPACITY = 0.58;
const FLAG_TEXTURE_SIZE = 128;

function rasterizeFlag(innerSvg) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = FLAG_TEXTURE_SIZE;
      canvas.height = FLAG_TEXTURE_SIZE;
      const context = canvas.getContext("2d");
      if (!context) return resolve(null);
      context.drawImage(image, 0, 0, FLAG_TEXTURE_SIZE, FLAG_TEXTURE_SIZE);
      resolve(context.getImageData(0, 0, FLAG_TEXTURE_SIZE, FLAG_TEXTURE_SIZE));
    };
    image.onerror = () => resolve(null);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${innerSvg}</svg>`;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export default function WorldMapGL({ selected, onSelect, myCountryCode, cityControl }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const flagImageIdsRef = useRef([]);
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

        const flagSvgs = getFlagSvgs();
        const flagCodes = Object.keys(geometriesByIso).filter((iso) => flagSvgs[iso.toLowerCase()]);
        const flagImages = await Promise.all(
          flagCodes.map(async (iso) => [iso, await rasterizeFlag(flagSvgs[iso.toLowerCase()])]),
        );
        if (!map.getSource("countries")) return;
        map.addImage("flag-empty", { width: 1, height: 1, data: new Uint8Array(4) });
        const flagPatternMatch = ["match", ["get", "iso"]];
        flagImages.forEach(([iso, image]) => {
          if (!image) return;
          const imageId = `flag-${iso.toLowerCase()}`;
          map.addImage(imageId, image);
          flagImageIdsRef.current.push([iso, imageId]);
        });
        flagImageIdsRef.current.forEach(([iso, imageId]) => flagPatternMatch.push(iso, imageId));
        flagPatternMatch.push("flag-empty");

        map.addLayer({
          id: "regions-flag-fill",
          type: "fill",
          source: "regions",
          paint: {
            "fill-pattern": flagPatternMatch,
            "fill-opacity": FLAG_FILL_OPACITY,
          },
        }, "regions-line");

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
  // "від природи" (записаний у самій геометрії).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !map.getLayer("regions-fill")) return;

    const cc = cityControl || {};
    map.setPaintProperty("regions-fill", "fill-color", [
      "case",
      [
        "==",
        ["coalesce", ["get", ["get", "cn_key"], ["literal", cc]], ["get", "iso"]],
        myCountryCode || "",
      ],
      COLOR_MINE,
      COLOR_LAND_NEUTRAL,
    ]);

    const owner = ["coalesce", ["get", ["get", "cn_key"], ["literal", cc]], ["get", "iso"]];
    const flagPatternMatch = ["match", owner];
    flagImageIdsRef.current.forEach(([iso, imageId]) => flagPatternMatch.push(iso, imageId));
    flagPatternMatch.push("flag-empty");
    map.setPaintProperty("regions-flag-fill", "fill-pattern", flagPatternMatch);
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
