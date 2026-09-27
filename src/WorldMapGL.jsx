import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import * as topojson from "topojson-client";
import "maplibre-gl/dist/maplibre-gl.css";

// Крок 2-3 плану: реальна геометрія + реальне володіння (мій/чужий), клік
// вибирає країну, прапори всередині контурів. Розрізнення "союзник/ворог"
// і "живе" оновлення без перезавантаження — наступні кроки.
//
// ВАЖЛИВО про прапори: MapLibre-стиль fill-pattern завжди ПОВТОРЮЄ картинку
// плиткою по формі (як шпалери), а не розтягує один прапор на всю країну —
// саме тому перша версія показувала багато дрібних прапорів або лише
// шматок прапора (Польща/Франція обрізались посеред візерунка). Щоб
// показати ОДИН прапор, розтягнутий на всю форму країни, MapLibre-стилі
// для цього не підходять — довелось намалювати прапори вручну, окремим
// прозорим canvas поверх карти, який сам обчислює контур країни на екрані
// і "вирізає" прапор точно по цій формі (canvas clip + drawImage).
const TOPOLOGY_URL = "/data/world-topology.json";
const REGION_LINES_MIN_ZOOM = 3.5; // з якого зуму показувати межі областей
const REGION_LINES_FULL_ZOOM = 4.5; // з якого зуму межі областей повністю видимі

const COLOR_WATER = "#7ec9e8";
const COLOR_LAND_NEUTRAL = "#7fb069";
const COLOR_MINE = "#f4b942";
const COLOR_BORDER = "#4a7a3d"; // темніший зелений для меж областей поверх суші
const COLOR_SELECTED_LINE = "#1f2d3d";
const FLAG_FILL_OPACITY = 0.4; // напівпрозорість прапора — колір землі лишається видимим

function loadFlagImage(innerSvg) {
  return new Promise((resolve, reject) => {
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${innerSvg}</svg>`;
    const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

export default function WorldMapGL({ selected, onSelect, myCountryCode, cityControl, flagSvgs }) {
  const containerRef = useRef(null);
  const flagCanvasRef = useRef(null);
  const mapRef = useRef(null);
  const flagDataRef = useRef(null); // { iso: { image, rings: [[lng,lat], ...][] } }[]
  const [status, setStatus] = useState("loading"); // loading | ready | error

  // Малює прапори поверх карти: для кожної країни проєктує її контур у
  // піксельні координати екрана, вирізає цю форму (clip) і розтягує прапор
  // на весь баундінг-бокс — тому прапор завжди один і показаний повністю,
  // незалежно від розміру країни.
  function drawFlags() {
    const map = mapRef.current;
    const canvas = flagCanvasRef.current;
    const flagData = flagDataRef.current;
    if (!map || !canvas || !flagData) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = FLAG_FILL_OPACITY;

    for (const { image, rings } of Object.values(flagData)) {
      if (!image || !rings.length) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const projectedRings = rings.map((ring) =>
        ring.map(([lng, lat]) => {
          const p = map.project([lng, lat]);
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
          return p;
        }),
      );

      // Пропускаємо країни, які зараз повністю поза екраном — для швидкості.
      if (maxX < 0 || minX > width || maxY < 0 || minY > height) continue;

      ctx.save();
      ctx.beginPath();
      for (const ring of projectedRings) {
        if (!ring.length) continue;
        ctx.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
        ctx.closePath();
      }
      ctx.clip();
      ctx.drawImage(image, minX, minY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1));
      ctx.restore();
    }
  }

  // 1. Ініціалізація карти один раз.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      antialias: true,
      // Карта не обертається й не нахиляється — це проста 2D-карта, і
      // нахил/поворот раніше "ламав" вигляд прапорів (горизонтальні смуги
      // ставали діагональними).
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
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
    map.touchZoomRotate.disableRotation();

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

        // Другий шар даних: суцільні контури країн — обчислюються прямо в
        // браузері з тих самих даних (без окремого важкого файлу).
        const geometriesByIso = {};
        for (const geom of topoObject.geometries) {
          const iso = geom.properties?.iso;
          if (!iso) continue;
          (geometriesByIso[iso] ??= []).push(geom);
        }
        const mergedByIso = {};
        for (const [iso, geoms] of Object.entries(geometriesByIso)) {
          mergedByIso[iso] = topojson.merge(topology, geoms);
        }

        const countriesGeojson = {
          type: "FeatureCollection",
          features: Object.entries(mergedByIso).map(([iso, geometry]) => ({
            type: "Feature",
            properties: { iso },
            geometry,
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

        // Прапори: завантажуємо картинки один раз і зберігаємо контури
        // кожної країни (у географічних координатах — самі пікселі
        // перераховуються щоразу під час малювання, бо міняються з зумом).
        if (flagSvgs) {
          const flagData = {};
          await Promise.all(
            Object.entries(mergedByIso).map(async ([iso, geometry]) => {
              const svg = flagSvgs[iso.toLowerCase()];
              if (!svg) return;
              try {
                const image = await loadFlagImage(svg);
                const rings =
                  geometry.type === "Polygon"
                    ? geometry.coordinates
                    : geometry.coordinates.flat();
                flagData[iso] = { image, rings };
              } catch {
                // Один битий прапор не повинен ламати решту карти.
              }
            }),
          );
          flagDataRef.current = flagData;
          drawFlags();
          map.on("moveend", drawFlags);
          map.on("zoomend", drawFlags);
          map.on("resize", drawFlags);
        }

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
      <canvas
        ref={flagCanvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          borderRadius: 12,
        }}
      />
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
