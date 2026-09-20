import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cnSfx, getRegionData } from "./App";

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
   файлу); якщо transform немає — arcs вже містять абсолютні координати.
   Підтримуємо обидва випадки, щоб не залежати від того, як саме
   build-скрипт викликав topojson-server. */
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

/* Y = -lat всюди в наших внутрішніх координатах (один раз тут, на етапі
   декодування) — це прибирає плутанину зі знаком під час трансформації
   canvas: далі скрізь (шляхи, картинки прапорів, кліки) працюємо з
   одним і тим самим напрямком осей, без окремого "перевертання". */
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

/* Будує повний список областей (з готовими Path2D) і список кордонів
   між сусідніми областями (з готовою geometry лінії) з topojson-об'єкта.
   Кордон між двома різними ОБЛАСТЯМИ рахується як межа між "власниками"
   щокадру (просто порівняння двох рядків), тому не потребує жодного
   перерахунку геометрії при захопленні території. */
function buildWorldFromTopology(topology) {
  const geoms = topology.objects.regions.geometries;
  const arcCache = {};
  const regions = geoms.map((g, i) => {
    const polys = g.type === "Polygon" ? [g.arcs] : g.arcs; // MultiPolygon: arcs = Polygon[][]
    const rings = [];
    polys.forEach((poly) => {
      ringsFromArcRefs(topology, poly, arcCache).forEach((r) => rings.push(r));
    });
    const path = new Path2D();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let sx = 0, sy = 0, sn = 0;
    rings.forEach((ring) => {
      ring.forEach(([x, y], j) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        sx += x;
        sy += y;
        sn++;
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
      cx: sn ? sx / sn : (minX + maxX) / 2,
      cy: sn ? sy / sn : (minY + maxY) / 2,
    };
  });

  /* Хто якою аркою "володіє" — щоб знайти арки, спільні рівно для ДВОХ
     різних областей (це і є межа між ними; арка лише з одним власником
     — це зовнішній/берегова лінія, окремо малювати не треба, море й так
     контрастує з будь-якою заливкою суші). */
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
    if (owners.size === 2) {
      const [a, b] = [...owners];
      borders.push({ a, b, line });
    } else {
      // "берегова" арка — межує лише з однією областю (з іншого боку
      // океан). Не малюється як звичайний кордон, але потрібна, щоб
      // обвести ЗОВНІШНІЙ контур країни при виділенні, не чіпаючи
      // внутрішні лінії між власними областями.
      const [a] = [...owners];
      borders.push({ a, b: null, line });
    }
  });

  return { regions, borders };
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

/* Прапор для коду країни: публічний безкоштовний CDN, без ключів.
   Кешується один раз на код. */
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

function fitCamera(w, h) {
  // "cover", а не "contain": карта завжди заповнює весь canvas без
  // порожніх країв, навіть якщо це трохи обрізає полюси/океан по краях.
  const lon0 = -172, lon1 = 178, lat0 = -58, lat1 = 82; // тут вже у внутрішніх (lon, -lat) координатах
  const k = Math.max(w / (lon1 - lon0), h / (lat1 - lat0));
  return { k, x: w / 2 - ((lon0 + lon1) / 2) * k, y: h / 2 - ((lat0 + lat1) / 2) * k };
}

export default function WorldMap3D({ selected, onSelect, myCountryCode, cityControl, onCapture }) {
  const canvasRef = useRef(null);
  const worldRef = useRef(null); // { regions, borders }
  const regionOwnerRef = useRef([]); // паралельний regions масив — поточний власник кожної області
  const ownerBBoxRef = useRef({}); // owner -> [minX,minY,maxX,maxY], для розтягування прапора на всю країну
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
  const [loaded, setLoaded] = useState(false);

  const recomputeOwnersAndBBoxes = (regions, cityControlObj) => {
    const owners = regions.map((r) => ownerForRegion(cityControlObj, r.iso + "|" + r.name, r.iso));
    const bboxes = {};
    regions.forEach((r, i) => {
      const o = owners[i];
      const [minX, minY, maxX, maxY] = r.bbox;
      if (!bboxes[o]) bboxes[o] = [minX, minY, maxX, maxY];
      else {
        const b = bboxes[o];
        if (minX < b[0]) b[0] = minX;
        if (minY < b[1]) b[1] = minY;
        if (maxX > b[2]) b[2] = maxX;
        if (maxY > b[3]) b[3] = maxY;
      }
    });
    regionOwnerRef.current = owners;
    ownerBBoxRef.current = bboxes;
  };

  /* Завантаження карти — один раз */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(WORLD_TOPOLOGY_URL);
        const topology = await res.json();
        const { regions: rawRegions, borders } = buildWorldFromTopology(topology);

        /* Зіставляємо назви областей гри з topojson-фічами по країнах —
           та ж логіка, що й раніше, тепер лише проти нових даних. */
        const byIsoAndNorm = {};
        rawRegions.forEach((r) => {
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
            if (f) f.name = name; // приводимо назву до тієї, що використовує гра (для cityControl-ключів)
          });
        });

        if (cancelled) return;
        worldRef.current = { regions: rawRegions, borders };
        recomputeOwnersAndBBoxes(rawRegions, cityControl);
        prevCityControlRef.current = { ...(cityControl || {}) };

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

  /* Основний цикл малювання + обробка вводу — окремий ефект, живе, поки
     живий canvas; дані (worldRef/regionOwnerRef/...) читаються "наживо"
     з ref'ів, тож не треба перезапускати цей ефект при кожній зміні гри. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
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
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ocean = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.85);
      ocean.addColorStop(0, "#0e2e4d");
      ocean.addColorStop(0.55, "#081a2e");
      ocean.addColorStop(1, "#04090f");
      ctx.fillStyle = ocean;
      ctx.fillRect(0, 0, w, h);

      const world = worldRef.current;
      if (world) {
        // плавний переліт камери до цілі (виділена країна / огляд світу)
        const tgt = targetCamRef.current;
        if (tgt) {
          const dx = tgt.x - camRef.current.x;
          const dy = tgt.y - camRef.current.y;
          const dk = tgt.k - camRef.current.k;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(dk) < 0.002) {
            camRef.current = { ...tgt };
            targetCamRef.current = null;
          } else {
            camRef.current = {
              x: camRef.current.x + dx * 0.18,
              y: camRef.current.y + dy * 0.18,
              k: camRef.current.k + dk * 0.18,
            };
          }
        }

        const { k, x, y } = camRef.current;
        const { regions, borders } = world;
        const owners = regionOwnerRef.current;
        const ownerBBoxes = ownerBBoxRef.current;
        const mine = myCountryCodeRef.current;
        const sel = selectedRef.current;

        const visMinX = -x / k, visMaxX = (w - x) / k;
        const visMinY = -y / k, visMaxY = (h - y) / k;

        ctx.save();
        ctx.transform(k, 0, 0, k, x, y);

        // Суцільна "підкладка" під усіма областями одним проходом — без
        // неї на стиках сусідніх областей (де кожна малюється й
        // обрізається окремо) з'являються тонкі чорні щілини через
        // згладжування країв canvas. Підкладка ховає ці щілини під
        // нейтральним тоном суходолу замість чорного океану.
        ctx.fillStyle = "#213244";
        for (let i = 0; i < regions.length; i++) {
          const r = regions[i];
          const [minX, minY, maxX, maxY] = r.bbox;
          if (maxX < visMinX || minX > visMaxX || maxY < visMinY || minY > visMaxY) continue;
          ctx.fill(r.path);
        }

        for (let i = 0; i < regions.length; i++) {
          const r = regions[i];
          const [minX, minY, maxX, maxY] = r.bbox;
          if (maxX < visMinX || minX > visMaxX || maxY < visMinY || minY > visMaxY) continue;
          const owner = owners[i];
          const bb = ownerBBoxes[owner];
          const flag = getFlagImage(flagCacheRef.current, owner, () => {
            /* прапор довантажився — наступний кадр підхопить сам, окремого
               forceUpdate не треба, цикл малювання й так триває постійно */
          });
          ctx.save();
          ctx.clip(r.path);
          if (flag && bb) {
            ctx.drawImage(flag, bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]);
            if (owner === mine) {
              ctx.fillStyle = "rgba(34,211,238,0.14)";
              ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
            }
          } else {
            ctx.fillStyle = owner === mine ? "#22d3ee" : "#264a63";
            ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
          }
          ctx.restore();
        }

        // кордони: тонкі всередині країни, чіткі яскраві між різними
        // країнами — і це рахується щокадру одним порівнянням власників,
        // тому кордон "рухається" миттєво в момент захоплення території.
        for (const bd of borders) {
          if (bd.b === null) continue; // берегові арки тут не малюємо, лише для контуру виділення нижче
          const oa = owners[bd.a];
          const ob = owners[bd.b];
          const same = oa === ob;
          if (same && k < 3.4) continue;
          ctx.beginPath();
          bd.line.forEach(([lx, ly], i) => (i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly)));
          ctx.lineJoin = "round";
          if (same) {
            ctx.strokeStyle = "rgba(8,16,26,0.22)";
            ctx.lineWidth = Math.max(0.28 / k, 0.012);
          } else {
            ctx.strokeStyle = "rgba(210,224,245,0.6)";
            ctx.lineWidth = Math.max(1.0 / k, 0.035);
          }
          ctx.stroke();
        }

        // виділена країна — тепер обводимо ЛИШЕ зовнішній контур її живої
        // території (кордон із сусідом-іншим-власником або з океаном),
        // а не кожну внутрішню лінію між власними областями.
        if (sel) {
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = Math.max(1.3 / k, 0.045);
          ctx.lineJoin = "round";
          for (const bd of borders) {
            const aIsSel = owners[bd.a] === sel;
            const bIsSel = bd.b !== null && owners[bd.b] === sel;
            if (aIsSel === bIsSel) continue; // обидві сторони "моя" або обидві "чужі" — не зовнішній контур
            ctx.beginPath();
            bd.line.forEach(([lx, ly], i) => (i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly)));
            ctx.stroke();
          }
        }

        // спалах при щойному захопленні конкретної області
        if (flashRef.current && Date.now() < flashRef.current.until) {
          const region = regions.find((r) => r.iso + "|" + r.name === flashRef.current.key);
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

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

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
        }
        return;
      }
      if (dragRef.current.active) {
        const dx = p.x - dragRef.current.x;
        const dy = p.y - dragRef.current.y;
        if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
        camRef.current = { ...camRef.current, x: dragRef.current.cx + dx, y: dragRef.current.cy + dy };
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
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [loaded]);

  /* Перерахунок власників областей при зміні cityControl — лише масив
     рядків + bbox-агрегація (жодної геометрії), тому миттєво й дешево. */
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

    if (capturedKey) {
      cnSfx.purchase();
      flashRef.current = { key: capturedKey, until: Date.now() + 2200 };
      if (captureEvent && onCapture) onCapture(captureEvent);
    }
  }, [cityControl, loaded]);

  /* Переліт камери до реальної живої території обраної країни. */
  useEffect(() => {
    const world = worldRef.current;
    const canvas = canvasRef.current;
    if (!world || !canvas || !loaded) return;
    if (!selected) {
      targetCamRef.current = fitCamera(canvas.clientWidth, canvas.clientHeight);
      return;
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
  };
  const resetView = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cnSfx.toggle();
    targetCamRef.current = fitCamera(canvas.clientWidth, canvas.clientHeight);
  };

  return (
    <div className="cn-map3d-wrap" style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
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
