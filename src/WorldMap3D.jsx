import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cnSfx, getRegionData, getFlagSvgs } from "./App";

/* --- Дані карти ---
   Один локальний файл topojson (arcs зі спільними кордонами між
   сусідніми областями, вже прораховані заздалегідь build-скриптом —
   саме це дозволяє живий кордон рахувати миттєво щокадру, без важких
   геометричних операцій у браузері). */
const WORLD_TOPOLOGY_URL = "/data/world-topology.json";

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

function ownerForRegion(cityControl, key, countryCode) {
  return Object.prototype.hasOwnProperty.call(cityControl || {}, key) ? cityControl[key] : countryCode;
}

/* Стандартне декодування topojson-арки: якщо є transform — координати
   закодовані дельтами і масштабовані (квантизація для економії розміру
   файлу); якщо transform немає — arcs вже містять абсолютні координати. */
function decodeArc(topology, arcIndex) {
  const reversed = arcIndex < 0;
  const idx = reversed ? ~arcIndex : arcIndex;
  const raw = topology.arcs[idx];
  const tr = topology.transform;
  let pts;
  if (tr) {
    let x = 0, y = 0;
    pts = raw.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]];
    });
  } else {
    pts = raw.map(([x, y]) => [x, y]);
  }
  return reversed ? pts.slice().reverse() : pts;
}

function ringsFromArcRefs(topology, arcRefsPerRing, cache) {
  return arcRefsPerRing.map((arcRefs) => {
    const pts = [];
    arcRefs.forEach((arcIndex, i) => {
      const idx = arcIndex < 0 ? ~arcIndex : arcIndex;
      if (!cache[idx]) cache[idx] = decodeArc(topology, idx);
      const decoded = arcIndex < 0 ? cache[idx].slice().reverse() : cache[idx];
      const start = i === 0 ? 0 : 1; // уникаємо дублікату спільної точки між арками
      for (let k = start; k < decoded.length; k++) pts.push(decoded[k]);
    });
    return pts.map(([lon, lat]) => [lon, -lat]);
  });
}

function buildWorldFromTopology(topology) {
  const geoms = topology.objects.regions.geometries;
  const arcCache = {};
  const regions = geoms.map((g, i) => {
    const polys = g.type === "Polygon" ? [g.arcs] : g.arcs;
    const rings = [];
    polys.forEach((poly) => {
      ringsFromArcRefs(topology, poly, arcCache).forEach((r) => rings.push(r));
    });
    const path = new Path2D();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rings.forEach((ring) => {
      ring.forEach(([x, y], j) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (j === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
    });
    return {
      index: i,
      name: g.properties?.name || "",
      iso: g.properties?.iso || "",
      rings,
      path,
      bbox: [minX, minY, maxX, maxY],
    };
  });

  const arcOwners = new Map();
  geoms.forEach((g, i) => {
    const polys = g.type === "Polygon" ? [g.arcs] : g.arcs;
    polys.forEach((poly) => {
      poly.forEach((ring) => {
        ring.forEach((arcIndex) => {
          const idx = arcIndex < 0 ? ~arcIndex : arcIndex;
          if (!arcOwners.has(idx)) arcOwners.set(idx, new Set());
          arcOwners.get(idx).add(i);
        });
      });
    });
  });

  const borders = [];
  arcOwners.forEach((owners, arcIdx) => {
    if (owners.size !== 1 && owners.size !== 2) return;
    if (!arcCache[arcIdx]) arcCache[arcIdx] = decodeArc(topology, arcIdx);
    const line = arcCache[arcIdx].map(([lon, lat]) => [lon, -lat]);
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    line.forEach(([lx, ly]) => {
      if (lx < bMinX) bMinX = lx;
      if (lx > bMaxX) bMaxX = lx;
      if (ly < bMinY) bMinY = ly;
      if (ly > bMaxY) bMaxY = ly;
    });
    const bbox = [bMinX, bMinY, bMaxX, bMaxY];
    if (owners.size === 2) {
      const [a, b] = [...owners];
      borders.push({ a, b, line, bbox });
    } else {
      const [a] = [...owners];
      borders.push({ a, b: null, line, bbox });
    }
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  regions.forEach((r) => {
    if (r.bbox[0] < minX) minX = r.bbox[0];
    if (r.bbox[1] < minY) minY = r.bbox[1];
    if (r.bbox[2] > maxX) maxX = r.bbox[2];
    if (r.bbox[3] > maxY) maxY = r.bbox[3];
  });

  return { regions, borders, bounds: [minX, minY, maxX, maxY] };
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function hitRegion(regions, x, y) {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i];
    const [minX, minY, maxX, maxY] = r.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    for (const ring of r.rings) {
      if (pointInRing(x, y, ring)) return i;
    }
  }
  return -1;
}

function approxAreaKm2FromRings(rings) {
  const KM_PER_DEG = 111.32;
  let total = 0;
  rings.forEach((ring) => {
    const avgY = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const kmPerDegX = KM_PER_DEG * Math.cos((avgY * Math.PI) / 180);
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      sum += x1 * kmPerDegX * (y2 * KM_PER_DEG) - x2 * kmPerDegX * (y1 * KM_PER_DEG);
    }
    total += Math.abs(sum / 2);
  });
  return Math.round(total);
}

function getFlagImage(cache, code, onReady) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) return null;

  const key = normalizedCode.toLowerCase();
  const cacheKey = `flag:${key}:w1280`;
  const entry = cache[cacheKey];

  if (entry) {
    if (entry.failed) return null;
    return entry.complete && entry.naturalWidth > 0 ? entry : null;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    img.__flagReady = true;
    onReady?.();
  };
  img.onerror = () => {
    const inner = getFlagSvgs()?.[key];
    if (!inner) {
      cache[cacheKey] = { failed: true };
      return;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inner}</svg>`;
    img.onload = () => {
      img.__flagReady = true;
      onReady?.();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const url = `https://flagcdn.com/w1280/${key}.png`;
  if (normalizedCode === "UA") {
    console.info("WorldMap3D: UA flag request", { code: normalizedCode, url, expected: "https://flagcdn.com/w1280/ua.png" });
  }
  img.src = url;
  cache[cacheKey] = img;
  return null;
}

function fitCamera(w, h) {
  const lon0 = -172, lon1 = 178, lat0 = -58, lat1 = 82;
  const k = Math.max(w / (lon1 - lon0), h / (lat1 - lat0));
  return { k, x: w / 2 - ((lon0 + lon1) / 2) * k, y: h / 2 - ((lat0 + lat1) / 2) * k };
}

/* Невеликий тайл випадкового "шуму" для текстури океану — генерується
   раз, тайлиться через ctx.createPattern, дуже дешево. */
function makeNoiseTile() {
  const size = 96;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const nctx = c.getContext("2d");
  const img = nctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.floor(Math.random() * 55);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 255;
  }
  nctx.putImageData(img, 0, 0);
  return c;
}

/* Приблизні координати підписів океанів — у внутрішніх (lon, -lat). */
const OCEAN_LABELS = [
  { text: "АТЛАНТИЧНИЙ ОКЕАН", lon: -35, lat: -0 },
  { text: "ТИХИЙ ОКЕАН", lon: -150, lat: -10 },
  { text: "ІНДІЙСЬКИЙ ОКЕАН", lon: 75, lat: 25 },
  { text: "ПІВНІЧНИЙ ЛЬОДОВИТИЙ ОКЕАН", lon: 10, lat: -75 },
  { text: "ПІВДЕННИЙ ОКЕАН", lon: 20, lat: 68 },
];

function drawCompass(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "rgba(180,220,255,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(210,235,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.18, 0);
  ctx.lineTo(0, r * 0.32);
  ctx.lineTo(-r * 0.18, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(150,190,220,0.6)";
  ctx.beginPath();
  ctx.moveTo(0, r);
  ctx.lineTo(0, r * 0.32);
  ctx.moveTo(-r, 0);
  ctx.lineTo(-r * 0.32, 0);
  ctx.moveTo(r, 0);
  ctx.lineTo(r * 0.32, 0);
  ctx.stroke();
  ctx.font = `${Math.round(r * 0.5)}px sans-serif`;
  ctx.fillStyle = "rgba(210,235,255,0.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", 0, -r * 1.35);
  ctx.fillText("S", 0, r * 1.35);
  ctx.fillText("W", -r * 1.35, 0);
  ctx.fillText("E", r * 1.35, 0);
  ctx.restore();
}

/* Найбільша сторона "запеченого" растру — компроміс між різкістю при
   наближенні й пам'яттю/швидкістю. Карта перемальовується в цю картинку
   ОДИН РАЗ (при завантаженні, зміні власника території чи довантаженні
   прапора) — щокадру ми лише показуємо готовий растр, розтягнутий під
   поточний зум, замість перемальовування ~3000 областей 60 разів/сек. */
const BAKE_MAX_SIDE = 6144;
const ADAPTIVE_BAKE_ZOOM = 6;
const ADAPTIVE_BAKE_DELAY = 200;
const OWNER_CLUSTER_DISTANCE = 18;

/* Малює всю карту (підкладка → прапори → кордони) в довільний 2D-контекст,
   вже налаштований трансформацією world→pixel; scaleForLines — величина
   для нормалізації товщини ліній (та ж роль, що "k" камери). Використовується
   і для запікання в offscreen canvas, і не використовується щокадру напряму. */
function paintWorld(ctx, world, owners, ownerClusters, regionClusterIndexes, myCode, flagCache, scaleForLines, onFlagReady) {
  const { regions, borders } = world;

  ctx.fillStyle = "#1a2836";
  for (let i = 0; i < regions.length; i++) ctx.fill(regions[i].path);

  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const [minX, minY, maxX, maxY] = r.bbox;
    const owner = owners[i];
    const clusters = ownerClusters[owner];
    const bb = clusters?.[regionClusterIndexes[i]]?.bbox;
    const flag = getFlagImage(flagCache, owner, onFlagReady);
    ctx.save();
    ctx.clip(r.path);
    if (flag && bb) {
      // "cover", а не розтягування 1:1 — зберігає пропорції прапора, як
      // background-size:cover, замість спотворення на витягнутих країнах.
      const bw = bb[2] - bb[0], bh = bb[3] - bb[1];
      const flagAr = flag.naturalWidth / flag.naturalHeight;
      const boxAr = bw / bh;
      let dw = bw, dh = bh, dx = bb[0], dy = bb[1];
      if (flagAr > boxAr) {
        dw = bh * flagAr;
        dx = bb[0] - (dw - bw) / 2;
      } else {
        dh = bw / flagAr;
        dy = bb[1] - (dh - bh) / 2;
      }
      ctx.drawImage(flag, dx, dy, dw, dh);
      if (owner === myCode) {
        ctx.fillStyle = "rgba(34,211,238,0.72)";
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      }
    } else {
      ctx.fillStyle = owner === myCode ? "#22d3ee" : "#264a63";
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    }
    ctx.restore();

    // Легкий "рельєф": темна тінь по нижньо-правому краю контуру й
    // світліший відблиск по верхньо-лівому — імітує об'єм без справжнього
    // 3D-рендеру (працює на будь-якій формі, дешево, малюється один раз
    // при запіканні).
    ctx.save();
    ctx.clip(r.path);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1.4 / scaleForLines, 0.05);
    ctx.translate(0.5 / scaleForLines, 0.5 / scaleForLines);
    ctx.stroke(r.path);
    ctx.translate(-1 / scaleForLines, -1 / scaleForLines);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.stroke(r.path);
    ctx.restore();
  }

  // Справжні державні кордони (між різними власниками) — з м'яким
  // блакитним світінням, частина растру, видно завжди. Внутрішні лінії
  // між областями ОДНІЄЇ країни сюди більше не входять: їх малює окремий
  // живий шар нижче, тільки при значному наближенні.
  for (const bd of borders) {
    if (bd.b === null) continue;
    if (owners[bd.a] === owners[bd.b]) continue;
    ctx.beginPath();
    bd.line.forEach(([lx, ly], i) => (i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly)));
    ctx.lineJoin = "round";
  ctx.lineCap = "round";
    ctx.save();
    ctx.shadowColor = "#5ad2ff";
    ctx.shadowBlur = 6 / scaleForLines;
    ctx.strokeStyle = "rgba(150,225,255,0.85)";
    ctx.lineWidth = Math.max(1.15 / scaleForLines, 0.04);
    ctx.stroke();
    ctx.restore();
  }
}

export default function WorldMap3D({ selected, onSelect, myCountryCode, cityControl, onCapture }) {
  const canvasRef = useRef(null);
  const worldRef = useRef(null); // { regions, borders, bounds }
  const regionOwnerRef = useRef([]);
  const ownerClustersRef = useRef({});
  const regionClusterIndexesRef = useRef([]);
  const prevCityControlRef = useRef(null);
  const flagCacheRef = useRef({});
  const flashRef = useRef(null);
  const camRef = useRef({ x: 0, y: 0, k: 1 });
  const targetCamRef = useRef(null);
  const dragRef = useRef({ active: false, moved: false, x: 0, y: 0, cx: 0, cy: 0 });
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const myCountryCodeRef = useRef(myCountryCode);
  myCountryCodeRef.current = myCountryCode;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const bakedRef = useRef(null); // { canvas, minX, minY, scale }
  const bakeTimerRef = useRef(null);
  const bakeIdleRef = useRef(null);
  const noisePatternRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  const recomputeOwnersAndBBoxes = (regions, cityControlObj) => {
    const owners = regions.map((r) => ownerForRegion(cityControlObj, r.iso + "|" + r.name, r.iso));
    const grouped = {};
    regions.forEach((region, index) => {
      const owner = owners[index];
      if (!grouped[owner]) grouped[owner] = [];
      const [minX, minY, maxX, maxY] = region.bbox;
      grouped[owner].push({
        index,
        area: approxAreaKm2FromRings(region.rings),
        center: [(minX + maxX) / 2, (minY + maxY) / 2],
        bbox: region.bbox.slice(),
      });
    });

    const clusters = {};
    const regionClusterIndexes = Array(regions.length).fill(0);
    Object.entries(grouped).forEach(([owner, entries]) => {
      const remaining = entries.slice();
      const ownerClusters = [];
      while (remaining.length) {
        remaining.sort((a, b) => b.area - a.area);
        const anchor = remaining.shift();
        const cluster = [anchor];
        for (let i = remaining.length - 1; i >= 0; i--) {
          const candidate = remaining[i];
          const distance = Math.hypot(candidate.center[0] - anchor.center[0], candidate.center[1] - anchor.center[1]);
          if (distance <= OWNER_CLUSTER_DISTANCE) cluster.push(remaining.splice(i, 1)[0]);
        }
        const bbox = cluster.reduce(
          (box, item) => [
            Math.min(box[0], item.bbox[0]),
            Math.min(box[1], item.bbox[1]),
            Math.max(box[2], item.bbox[2]),
            Math.max(box[3], item.bbox[3]),
          ],
          [Infinity, Infinity, -Infinity, -Infinity]
        );
        const clusterIndex = ownerClusters.push({ bbox }) - 1;
        cluster.forEach((item) => {
          regionClusterIndexes[item.index] = clusterIndex;
        });
      }
      clusters[owner] = ownerClusters;
    });
    regionOwnerRef.current = owners;
    ownerClustersRef.current = clusters;
    regionClusterIndexesRef.current = regionClusterIndexes;
  };

  /* Перемальовує всю карту ОДИН РАЗ у фоновий canvas. Викликається лише
     при завантаженні, зміні власника території чи довантаженні прапора —
     ніколи щокадру. */
  const bake = () => {
    const world = worldRef.current;
    if (!world) return;
    const canvasElement = canvasRef.current;
    const camera = camRef.current;
    const adaptive = camera.k > ADAPTIVE_BAKE_ZOOM && canvasElement;
    const width = canvasElement?.clientWidth || 1;
    const height = canvasElement?.clientHeight || 1;
    let [minX, minY, maxX, maxY] = world.bounds;
    if (adaptive) {
      const marginX = width / camera.k * 0.18;
      const marginY = height / camera.k * 0.18;
      minX = Math.max(world.bounds[0], (-camera.x / camera.k) - marginX);
      maxX = Math.min(world.bounds[2], ((width - camera.x) / camera.k) + marginX);
      minY = Math.max(world.bounds[1], (-camera.y / camera.k) - marginY);
      maxY = Math.min(world.bounds[3], ((height - camera.y) / camera.k) + marginY);
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const requestedScale = adaptive ? camera.k * 2.5 : 1;
    const scale = Math.min(BAKE_MAX_SIDE / spanX, BAKE_MAX_SIDE / spanY, Math.max(requestedScale, 1));

    const startedAt = performance.now();
    console.time("WorldMap3D bake");
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(spanX * scale));
    canvas.height = Math.max(1, Math.round(spanY * scale));
    const bctx = canvas.getContext("2d");
    bctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
    bctx.clearRect(minX, minY, spanX, spanY);
    paintWorld(
      bctx,
      world,
      regionOwnerRef.current,
      ownerClustersRef.current,
      regionClusterIndexesRef.current,
      myCountryCodeRef.current,
      flagCacheRef.current,
      scale,
      () => scheduleBake(300),
    );

    bakedRef.current = { canvas, minX, minY, scale, adaptive };
    console.timeEnd("WorldMap3D bake");
    console.info("WorldMap3D bake result", { adaptive, zoom: camera.k, width: canvas.width, height: canvas.height, ms: Math.round(performance.now() - startedAt) });
  };

  const scheduleBake = (delay) => {
    if (bakeTimerRef.current) clearTimeout(bakeTimerRef.current);
    bakeTimerRef.current = setTimeout(() => {
      bakeTimerRef.current = null;
      const run = () => {
        bakeIdleRef.current = null;
        bake();
      };
      if (typeof window.requestIdleCallback === "function") bakeIdleRef.current = window.requestIdleCallback(run, { timeout: 500 });
      else bakeIdleRef.current = setTimeout(run, 0);
    }, delay);
  };

  /* Завантаження карти — один раз */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(WORLD_TOPOLOGY_URL);
        const topology = await res.json();
        const world = buildWorldFromTopology(topology);

        const byIsoAndNorm = {};
        world.regions.forEach((r) => {
          if (!r.iso) return;
          if (!byIsoAndNorm[r.iso]) byIsoAndNorm[r.iso] = {};
          byIsoAndNorm[r.iso][normalizeRegionName(r.name)] = r;
        });
        const matchName = (gameRegionName, byNorm) => {
          const norm = normalizeRegionName(gameRegionName);
          if (byNorm[norm]) return byNorm[norm];
          for (const [key, aliases] of Object.entries(REGION_NAME_ALIASES)) {
            if (key === norm || aliases.some((a) => normalizeRegionName(a) === norm)) {
              if (byNorm[key]) return byNorm[key];
              for (const a of aliases) {
                const an = normalizeRegionName(a);
                if (byNorm[an]) return byNorm[an];
              }
            }
          }
          return null;
        };
        const allRegionData = getRegionData();
        Object.keys(allRegionData).forEach((countryCode) => {
          const byNorm = byIsoAndNorm[countryCode];
          if (!byNorm) return;
          (allRegionData[countryCode]?.regions || []).forEach(({ name }) => {
            const f = matchName(name, byNorm);
            if (f) f.name = name;
          });
        });

        if (cancelled) return;
        worldRef.current = world;
        recomputeOwnersAndBBoxes(world.regions, cityControl);
        prevCityControlRef.current = { ...(cityControl || {}) };
        bake();

        const canvas = canvasRef.current;
        if (canvas) camRef.current = fitCamera(canvas.clientWidth, canvas.clientHeight);
        setLoaded(true);
      } catch (err) {
        console.warn("WorldMap3D: не вдалося завантажити карту:", err?.message || err);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Основний цикл малювання: щокадру лише показує вже готовий "запечений"
     растр під поточний зум/панораму (дешево) + малює тонким вектором
     тільки те, що дійсно змінюється щокадру: біле виділення й спалах
     захоплення. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
  if (ctx) ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!camRef.current.k || camRef.current.k < 0.1) camRef.current = fitCamera(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      if (document.hidden) {
        raf = 0;
        return;
      }
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const ocean = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.85);
      ocean.addColorStop(0, "#0a2138");
      ocean.addColorStop(0.55, "#051422");
      ocean.addColorStop(1, "#02060a");
      ctx.fillStyle = ocean;
      ctx.fillRect(0, 0, w, h);
      if (!noisePatternRef.current) noisePatternRef.current = ctx.createPattern(makeNoiseTile(), "repeat");
      if (noisePatternRef.current) {
        ctx.save();
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = noisePatternRef.current;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      const world = worldRef.current;
      const baked = bakedRef.current;
      if (world && baked) {
        const tgt = targetCamRef.current;
        if (tgt) {
          const dx = tgt.x - camRef.current.x;
          const dy = tgt.y - camRef.current.y;
          const dk = tgt.k - camRef.current.k;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(dk) < 0.002) {
            camRef.current = { ...tgt };
            targetCamRef.current = null;
            scheduleBake(ADAPTIVE_BAKE_DELAY);
          } else {
            camRef.current = {
              x: camRef.current.x + dx * 0.18,
              y: camRef.current.y + dy * 0.18,
              k: camRef.current.k + dk * 0.18,
            };
          }
        }

        const { k, x, y } = camRef.current;
        const owners = regionOwnerRef.current;
        const sel = selectedRef.current;

        // Один-єдиний drawImage замість перемальовування тисяч областей —
        // це і прибирає лаги. Готовий растр просто розтягується під
        // поточний зум/панораму.
        const bw = baked.canvas.width / baked.scale;
        const bh = baked.canvas.height / baked.scale;
        const sx = x + baked.minX * k;
        const sy = y + baked.minY * k;
        ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
        ctx.drawImage(baked.canvas, sx, sy, bw * k, bh * k);

        // Векторний шар кордонів країн:
        // при medium/high zoom не масштабуємо растрову лінію, а малюємо
        // оригінальні TopoJSON-дуги безпосередньо в поточний canvas.
        // Це прибирає "мило" та пікселізацію кордонів при наближенні.
        if (k > 3.5) {
          const visMinX = -x / k, visMaxX = (w - x) / k;
          const visMinY = -y / k, visMaxY = (h - y) / k;
          ctx.save();
          ctx.transform(k, 0, 0, k, x, y);
          ctx.setLineDash([]);
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          for (const bd of world.borders) {
            if (bd.b === null || owners[bd.a] === owners[bd.b]) continue;
            const [bMinX, bMinY, bMaxX, bMaxY] = bd.bbox;
            if (bMaxX < visMinX || bMinX > visMaxX || bMaxY < visMinY || bMinY > visMaxY) continue;
            ctx.beginPath();
            bd.line.forEach(([lx, ly], i) => (i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly)));
            const width = k > 14 ? 0.42 / k : k > 7 ? 0.52 / k : 0.68 / k;
            ctx.strokeStyle = "rgba(103,232,249,0.88)";
            ctx.lineWidth = width;
            ctx.shadowColor = "rgba(90,210,255,0.28)";
            ctx.shadowBlur = k > 7 ? 1.8 / k : 1.2 / k;
            ctx.stroke();
          }
          ctx.restore();
        }

        // Внутрішні лінії між областями ОДНІЄЇ країни — живий шар,
        // з'являється лише при значному наближенні (як у Google Maps:
        // тонкі, напівпрозорі, суцільні), і рахує тільки бордери,
        // що реально потрапляють у видиму область екрана — тому лишається
        // дешевим навіть при тисячах бордерів по всьому світу.
        if (k > 7) {
          const visMinX = -x / k, visMaxX = (w - x) / k;
          const visMinY = -y / k, visMaxY = (h - y) / k;
          ctx.save();
          ctx.transform(k, 0, 0, k, x, y);
          ctx.setLineDash([]);
          ctx.strokeStyle = "rgba(148,163,184,0.32)";
          ctx.lineWidth = Math.max(0.48 / k, 0.016);
          ctx.lineJoin = "round";
  ctx.lineCap = "round";
          for (const bd of world.borders) {
            if (bd.b === null || owners[bd.a] !== owners[bd.b]) continue;
            const [bMinX, bMinY, bMaxX, bMaxY] = bd.bbox;
            if (bMaxX < visMinX || bMinX > visMaxX || bMaxY < visMinY || bMinY > visMaxY) continue;
            ctx.beginPath();
            bd.line.forEach(([lx, ly], i) => (i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly)));
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.restore();
        }

        // Біле виділення (лише зовнішній контур живої території) і спалах
        // захоплення — це малі, дешеві вектори, тому їх можна перемальовувати
        // щокадру без проблем із продуктивністю.
        if (sel || (flashRef.current && Date.now() < flashRef.current.until)) {
          ctx.save();
          ctx.transform(k, 0, 0, k, x, y);

          if (sel) {
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.lineWidth = Math.max(1.3 / k, 0.045);
            ctx.lineJoin = "round";
  ctx.lineCap = "round";
            for (const bd of world.borders) {
              const aIsSel = owners[bd.a] === sel;
              const bIsSel = bd.b !== null && owners[bd.b] === sel;
              if (aIsSel === bIsSel) continue;
              ctx.beginPath();
              bd.line.forEach(([lx, ly], i) => (i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly)));
              ctx.stroke();
            }
          }

          if (flashRef.current && Date.now() < flashRef.current.until) {
            const region = world.regions.find((r) => r.iso + "|" + r.name === flashRef.current.key);
            if (region) {
              ctx.save();
              ctx.shadowColor = "#ffffff";
              ctx.shadowBlur = 8 / k;
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = Math.max(2.4 / k, 0.08);
              ctx.stroke(region.path);
              ctx.restore();
            }
          }
          ctx.restore();
        }

        // Підписи океанів — у світових координатах, показуємо тільки коли
        // потрапляють у видиму область і карта достатньо віддалена (на
        // близькому зумі це вже не потрібно, там дивляться на країни).
        if (k < 6) {
          ctx.save();
          ctx.font = `${Math.max(11, Math.min(15, 12 * (k / 2)))}px sans-serif`;
          ctx.fillStyle = "rgba(150,190,220,0.55)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.letterSpacing = "2px";
          OCEAN_LABELS.forEach((o) => {
            const sx = x + o.lon * k;
            const sy = y + o.lat * k;
            if (sx < -50 || sx > w + 50 || sy < -20 || sy > h + 20) return;
            ctx.fillText(o.text, sx, sy);
          });
          ctx.restore();
        }
      }

      // Компас — фіксований декоративний елемент в кутку екрана (без
      // повороту камери карта завжди "дивиться" на північ, тому компас
      // завжди в одному положенні — це коректно).
      drawCompass(ctx, 34, 34, 20);

      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onVisibilityChange = () => {
      if (!document.hidden && !raf) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const posOf = (ev) => {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };
    const screenToWorld = (px, py) => {
      const { k, x, y } = camRef.current;
      return { x: (px - x) / k, y: (py - y) / k };
    };
    const zoomAt = (mx, my, factor) => {
      const { k, x, y } = camRef.current;
      const next = Math.min(40, Math.max(0.6, k * factor));
      const wx = (mx - x) / k;
      const wy = (my - y) / k;
      targetCamRef.current = null;
      camRef.current = { k: next, x: mx - wx * next, y: my - wy * next };
      scheduleBake(ADAPTIVE_BAKE_DELAY);
    };

    const onDown = (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      const p = posOf(ev);
      pointersRef.current.set(ev.pointerId, p);
      if (pointersRef.current.size === 1) {
        targetCamRef.current = null;
        dragRef.current = { active: true, moved: false, x: p.x, y: p.y, cx: camRef.current.x, cy: camRef.current.y };
      } else if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()];
        pinchRef.current = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onMove = (ev) => {
      const p = posOf(ev);
      if (pointersRef.current.has(ev.pointerId)) pointersRef.current.set(ev.pointerId, p);
      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchRef.current > 0 && d > 0) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          zoomAt(mid.x, mid.y, d / pinchRef.current);
          pinchRef.current = d;
          scheduleBake(ADAPTIVE_BAKE_DELAY);
        }
        return;
      }
      if (dragRef.current.active) {
        const dx = p.x - dragRef.current.x;
        const dy = p.y - dragRef.current.y;
        if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
        camRef.current = { ...camRef.current, x: dragRef.current.cx + dx, y: dragRef.current.cy + dy };
        scheduleBake(ADAPTIVE_BAKE_DELAY);
      }
    };
    const onUp = (ev) => {
      const p = posOf(ev);
      pointersRef.current.delete(ev.pointerId);
      if (!dragRef.current.moved && pointersRef.current.size === 0 && worldRef.current) {
        const wp = screenToWorld(p.x, p.y);
        const idx = hitRegion(worldRef.current.regions, wp.x, wp.y);
        if (idx >= 0) {
          const code = regionOwnerRef.current[idx];
          if (code && onSelectRef.current) onSelectRef.current(code);
        }
      }
      if (pointersRef.current.size === 0) dragRef.current.active = false;
      pinchRef.current = 0;
      scheduleBake(ADAPTIVE_BAKE_DELAY);
    };
    const onWheel = (ev) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = ev.deltaY > 0 ? 0.9 : 1.11;
      zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, factor);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [loaded]);

  /* Перерахунок власників областей при зміні cityControl + перезапікання
     растру (тут, і тільки тут, а не щокадру). */
  useEffect(() => {
    const world = worldRef.current;
    if (!world || !loaded) return;
    const prevControl = prevCityControlRef.current;
    let capturedKey = null;
    let captureEvent = null;

    world.regions.forEach((r) => {
      const key = r.iso + "|" + r.name;
      const newOwner = ownerForRegion(cityControl, key, r.iso);
      const oldOwner = prevControl ? ownerForRegion(prevControl, key, r.iso) : newOwner;
      if (prevControl && newOwner !== oldOwner) {
        capturedKey = key;
        captureEvent = {
          name: r.name,
          previousOwner: oldOwner,
          newOwner,
          areaKm2: approxAreaKm2FromRings(r.rings),
        };
      }
    });

    recomputeOwnersAndBBoxes(world.regions, cityControl);
    prevCityControlRef.current = { ...(cityControl || {}) };
    bake();

    if (capturedKey) {
      cnSfx.purchase();
      flashRef.current = { key: capturedKey, until: Date.now() + 2200 };
      if (captureEvent && onCapture) onCapture(captureEvent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityControl, loaded]);

  /* Довантаження прапорів триває довше за одну секунду на старті (десятки
     паралельних запитів) — перезапікаємо растр з невеликою затримкою
     після кожного нового прапора, а не при кожному окремому onload. */
  useEffect(() => {
    if (!loaded) return;
    scheduleBake(250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /* Переліт камери до реальної живої території обраної країни. */
  useEffect(() => {
    const world = worldRef.current;
    const canvas = canvasRef.current;
    if (!world || !canvas || !loaded) return;
    let resetTimer = null;
    if (!selected) {
      resetTimer = setTimeout(() => {
        if (!selectedRef.current) targetCamRef.current = fitCamera(canvas.clientWidth, canvas.clientHeight);
      }, 200);
      return () => clearTimeout(resetTimer);
    }
    cnSfx.modalOpen();
    const owners = regionOwnerRef.current;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    world.regions.forEach((r, i) => {
      if (owners[i] !== selected) return;
      const [a, b, c, d] = r.bbox;
      if (a < minX) minX = a;
      if (b < minY) minY = b;
      if (c > maxX) maxX = c;
      if (d > maxY) maxY = d;
    });
    if (!isFinite(minX)) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const pad = 0.25;
    const spanX = (maxX - minX) * (1 + pad) || 4;
    const spanY = (maxY - minY) * (1 + pad) || 4;
    const k = Math.min(40, Math.max(0.6, Math.min(w / spanX, h / spanY)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    targetCamRef.current = { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
    scheduleBake(ADAPTIVE_BAKE_DELAY);
    return () => {
      if (resetTimer) clearTimeout(resetTimer);
    };
  }, [selected, loaded]);

  const zoomBy = (delta) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cnSfx.toggle();
    const { k, x, y } = camRef.current;
    const next = Math.min(40, Math.max(0.6, k * (delta > 0 ? 1.35 : 1 / 1.35)));
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const wx = (w / 2 - x) / k, wy = (h / 2 - y) / k;
    targetCamRef.current = null;
    camRef.current = { k: next, x: w / 2 - wx * next, y: h / 2 - wy * next };
    scheduleBake(ADAPTIVE_BAKE_DELAY);
  };
  const resetView = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cnSfx.toggle();
    targetCamRef.current = fitCamera(canvas.clientWidth, canvas.clientHeight);
    scheduleBake(ADAPTIVE_BAKE_DELAY);
  };

  return (
    <div
      className="cn-map3d-wrap"
      style={{
        position: "relative",
        borderRadius: 18,
        overflow: "hidden",
        border: "1px solid rgba(120,190,255,0.35)",
        boxShadow: "0 0 0 1px rgba(80,150,220,0.15), 0 0 26px rgba(60,160,255,0.25), inset 0 0 40px rgba(10,30,55,0.6)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      {/* декоративні кутові акценти — "футуристична рамка" */}
      {[
        { top: 6, left: 6, borderWidth: "2px 0 0 2px" },
        { top: 6, right: 6, borderWidth: "2px 2px 0 0" },
        { bottom: 6, left: 6, borderWidth: "0 0 2px 2px" },
        { bottom: 6, right: 6, borderWidth: "0 2px 2px 0" },
      ].map((pos, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 22,
            height: 22,
            borderColor: "rgba(150,210,255,0.75)",
            borderStyle: "solid",
            pointerEvents: "none",
            ...pos,
          }}
        />
      ))}
      {!loaded && (
        <div className="cn-map3d-loading">
          <RefreshCw size={26} className="cn-spin" />
          <div>Завантаження карти світу…</div>
        </div>
      )}
      <div className="cn-map-toolbar" style={{ gap: 8 }}>
        <button
          className="cn-map-zoom-btn"
          type="button"
          onClick={() => zoomBy(1)}
          aria-label="Наблизити"
          style={{
            background: "linear-gradient(160deg, rgba(30,50,75,0.9), rgba(10,20,32,0.9))",
            border: "1px solid rgba(120,190,255,0.4)",
            boxShadow: "0 0 10px rgba(70,170,255,0.25)",
            color: "#cfeeff",
          }}
        >
          +
        </button>
        <button
          className="cn-map-zoom-btn"
          type="button"
          onClick={() => zoomBy(-1)}
          aria-label="Віддалити"
          style={{
            background: "linear-gradient(160deg, rgba(30,50,75,0.9), rgba(10,20,32,0.9))",
            border: "1px solid rgba(120,190,255,0.4)",
            boxShadow: "0 0 10px rgba(70,170,255,0.25)",
            color: "#cfeeff",
          }}
        >
          −
        </button>
        <button
          className="cn-map-zoom-btn cn-map-zoom-btn--reset"
          type="button"
          onClick={resetView}
          aria-label="Скинути"
          style={{
            background: "linear-gradient(160deg, rgba(30,50,75,0.9), rgba(10,20,32,0.9))",
            border: "1px solid rgba(120,190,255,0.4)",
            boxShadow: "0 0 10px rgba(70,170,255,0.25)",
            color: "#cfeeff",
          }}
        >
          ⟲
        </button>
      </div>
    </div>
  );
}
