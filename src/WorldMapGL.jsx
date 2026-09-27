import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import * as topojson from "topojson-client";
import "maplibre-gl/dist/maplibre-gl.css";

// Крок 2-3 плану: реальна геометрія + реальне володіння (мій/чужий), клік
// вибирає країну, прапори всередині контурів. Розрізнення "союзник/ворог"
// і "живе" оновлення без перезавантаження — наступні кроки.
//
// ПРО ПРАПОРИ: раніше прапори малювались вручну в окремому HTML <canvas>
// поверх карти (project() кожної вершини + clip + drawImage на кожен
// moveend/zoomend, потім навіть на кожен кадр через requestAnimationFrame).
// Це виявилось принципово крихким: (1) наївний project() ламався на
// країнах, що перетинають лінію зміни дат (Росія/США/Фіджі/Нова
// Зеландія/Кірибаті/Антарктида) — контур перетворювався на лінію через
// увесь світ; (2) навіть після виправлення цього прапори все одно
// "відривались" від контуру під час активного pan/zoom, бо перемальовка
// в JS ніколи не гарантовано встигає точно за рендером самої карти.
//
// Натомість тепер прапори — це НАТИВНІ шари MapLibre: для кожного
// острова/материка країни один раз (при завантаженні) рендеримо offscreen
// canvas — прапор, обрізаний точно по контуру цього шматка суші (з
// прозорістю зовні контуру) — і додаємо як image-джерело, прив'язане до
// 4 географічних кутів свого bounding box, плюс raster-шар поверх нього.
// Далі MapLibre сам перепроєктує цю картинку щокадру разом з рештою
// карти (так само, як він це вже робить із самими контурами країн) —
// жодного JS-коду на pan/zoom/resize більше не потрібно, тому відрив чи
// розсинхронізація стають неможливими в принципі.
const TOPOLOGY_URL = "/data/world-topology.json";
const REGION_LINES_MIN_ZOOM = 3.5; // з якого зуму показувати межі областей
const REGION_LINES_FULL_ZOOM = 4.5; // з якого зуму межі областей повністю видимі

const COLOR_WATER = "#7ec9e8";
const COLOR_LAND_NEUTRAL = "#7fb069";
const COLOR_MINE = "#f4b942";
const COLOR_BORDER = "#4a7a3d"; // темніший зелений для меж областей поверх суші
const COLOR_SELECTED_LINE = "#1f2d3d";
const FLAG_FILL_OPACITY = 0.4; // напівпрозорість прапора — колір землі лишається видимим
const FLAG_RASTER_MAX_DIM = 256; // максимальний розмір offscreen-canvas для одного шматка суші (px)

// Розбиває Polygon/MultiPolygon на окремі частини (материк, острови,
// ексклави) — кожна частина потім рендериться й позиціонується під СВІЙ
// власний bounding box, а не під один спільний для всієї країни. Без
// цього острівні держави чи країни із заморськими територіями (напр.
// Британія + Фолкленди) розтягували один прапор на проміжки океану між
// шматками суші.
function toParts(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

// Деякі шматки суші (Чукотка/Алеутські острови, острови Фіджі, Кірибаті,
// Антарктида) фізично перетинають лінію зміни дат (довгота ±180°). Без
// цієї корекції координати по різні боки лінії дають bounding box шириною
// у весь світ. Зсуваємо "невигідну" половину точок на +360°, щоб контур
// лишався компактним прямокутником у довготі.
function unwrapAntimeridian(rings) {
  let min = Infinity;
  let max = -Infinity;
  for (const ring of rings) {
    for (const [lng] of ring) {
      if (lng < min) min = lng;
      if (lng > max) max = lng;
    }
  }
  if (max - min <= 180) return rings;
  const mid = (min + max) / 2;
  return rings.map((ring) => ring.map(([lng, lat]) => (lng < mid ? [lng + 360, lat] : [lng, lat])));
}

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

// Рендерить один шматок суші (rings у географічних координатах) в offscreen
// canvas: прапор, обрізаний точно по контуру, з прозорістю зовні. Повертає
// PNG data URL і 4 географічні кути bounding box (для image-джерела
// MapLibre) — або null, якщо шматок вироджений.
function buildFlagRaster(image, rings) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  if (!(lngSpan > 1e-5) || !(latSpan > 1e-5)) return null;

  const scale = FLAG_RASTER_MAX_DIM / Math.max(lngSpan, latSpan);
  const width = Math.max(4, Math.min(FLAG_RASTER_MAX_DIM, Math.round(lngSpan * scale)));
  const height = Math.max(4, Math.min(FLAG_RASTER_MAX_DIM, Math.round(latSpan * scale)));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const toXY = ([lng, lat]) => [((lng - minLng) / lngSpan) * width, ((maxLat - lat) / latSpan) * height];

  ctx.beginPath();
  for (const ring of rings) {
    if (!ring.length) continue;
    const [x0, y0] = toXY(ring[0]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = toXY(ring[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.clip();
  ctx.drawImage(image, 0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    // За годинниковою стрілкою, починаючи з верхнього лівого кута — саме
    // так їх очікує image-джерело MapLibre.
    coordinates: [
      [minLng, maxLat],
      [maxLng, maxLat],
      [maxLng, minLat],
      [minLng, minLat],
    ],
  };
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
      antialias: true,
      // Карта не обертається й не нахиляється — це проста 2D-карта.
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

        // Прапори: для кожного шматка суші кожної країни рендеримо offscreen
        // canvas один раз і додаємо як нативне image-джерело + raster-шар —
        // MapLibre сам тримає їх прив'язаними до контуру на будь-якому
        // pan/zoom/resize, без жодного додаткового JS-коду під час руху
        // карти (додаються останніми, тому лягають поверх ліній кордонів,
        // як і раніше).
        if (flagSvgs) {
          await Promise.all(
            Object.entries(mergedByIso).map(async ([iso, geometry]) => {
              const svg = flagSvgs[iso.toLowerCase()];
              if (!svg) return;
              try {
                const image = await loadFlagImage(svg);
                const parts = toParts(geometry).map(unwrapAntimeridian);
                parts.forEach((rings, partIndex) => {
                  if (!rings.length) return;
                  const raster = buildFlagRaster(image, rings);
                  if (!raster) return;
                  const sourceId = `flag-${iso}-${partIndex}`;
                  map.addSource(sourceId, {
                    type: "image",
                    url: raster.dataUrl,
                    coordinates: raster.coordinates,
                  });
                  map.addLayer({
                    id: `${sourceId}-layer`,
                    type: "raster",
                    source: sourceId,
                    paint: {
                      "raster-opacity": FLAG_FILL_OPACITY,
                      "raster-fade-duration": 0,
                    },
                  });
                });
              } catch {
                // Один битий прапор не повинен ламати решту карти.
              }
            }),
          );
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
