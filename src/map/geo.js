/* Невеликі геометричні утиліти для міст і зон (чистий JS, без залежностей).
   Координати — [довгота, широта]. Для відстаней у межах однієї області використовуємо
   просту проєкцію x = lng·cos(широта), y = lat — для порівняння відстаней цього досить. */

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

export function ringBBox(ring) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/* Парне-непарне правило: чи лежить точка всередині кільця. */
export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Полігон = [зовнішнє кільце, діри…] */
export function pointInPolygon(x, y, rings) {
  if (!rings.length || !pointInRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (pointInRing(x, y, rings[k])) return false;
  return true;
}

/* Точка всередині полігона (для областей без жодного міста): середина найдовшого
   відрізка, який перетинає полігон горизонтальна пряма на кількох висотах. */
export function interiorPoint(rings) {
  const outer = rings[0];
  const [, s, , n] = ringBBox(outer);
  let best = null;
  for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) {
    const y = s + (n - s) * f;
    const xs = [];
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const yi = outer[i][1], yj = outer[j][1];
      if (yi > y !== yj > y) xs.push(outer[i][0] + ((y - yi) * (outer[j][0] - outer[i][0])) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      const x = (xs[k] + xs[k + 1]) / 2;
      if ((!best || w > best.w) && pointInPolygon(x, y, rings)) best = { x, y, w };
    }
    if (best && best.w > 0) break;
  }
  if (best) return [best.x, best.y];
  return outer[0]; // виродкові випадки
}

/* Залишає частину полігона, де a·x + b·y <= c (Sutherland–Hodgman). */
export function clipHalfPlane(poly, a, b, c) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dp = a * p[0] + b * p[1] - c;
    const dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/* ---- Зони міст -------------------------------------------------------------------------
   Область ділиться між містами зваженою діаграмою Вороного (діаграма потужності): що важливіше
   місто (imp, 0..100), то більшу територію воно отримує. Вага обмежена так, щоб кожне місто
   гарантовано лишалось у власній зоні. Межі між зонами не прямі, а «живі»: ламана з плавним
   шумом. Шум залежить лише від координат, а відрізок обробляється в канонічному напрямку,
   тож обидві сусідні зони отримують однакову лінію без щілин. Зовнішня межа області не змінюється. */

/* Клас напіввіддіку полігона з позначками країв: [x, y, cut], cut — чи є ребро від цієї вершини
   до наступної розрізом (бісектрисою), а не контуром області. */
function clipHalfPlaneFlagged(poly, a, b, c) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dp = a * p[0] + b * p[1] - c;
    const dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) {
      out.push(p);
      if (dq > 0) {
        const t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, true]);
      }
    } else if (dq <= 0) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2]]);
    }
  }
  return out;
}

function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}
/* Гладкий value-noise у [-1, 1] */
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/* Точки «живого» відрізка від A до B (без A, з B). Канонічний напрямок гарантує однаковий результат
   для двох сусідніх зон. Координати — у проєкції зони (x·kx, y). */
function wigglePoints(a, b) {
  const flip = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const A = flip ? b : a, B = flip ? a : b;
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return [b];
  const segs = Math.max(2, Math.min(40, Math.ceil(L / 0.035)));
  const nx = -dy / L, ny = dx / L;
  const amp = Math.min(0.16 * L, 0.09);
  const pts = [];
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const x = A[0] + dx * t, y = A[1] + dy * t;
    const taper = Math.pow(Math.sin(Math.PI * t), 0.8);
    const wv = vnoise(x * 6.5, y * 6.5) * 0.65 + vnoise(x * 19, y * 19) * 0.35;
    const o = wv * amp * taper;
    pts.push([x + nx * o, y + ny * o]);
  }
  pts.push(B);
  if (!flip) return pts;
  // від початкового a до b: обертаємо точки й додаємо b, без a
  const full = [A, ...pts];
  full.reverse();
  return full.slice(1);
}

/* Зони міст (зважена діаграма Вороного, обрізана межами області).
   polygons — полігони області ([кільця…]), sites — [{ x, y, k, imp? }] (k — ключ міста).
   Повертає Map k → масив полігонів [[кільце]] (діри не враховуються — для прев'ю це нормально). */
export function cityZones(polygons, sites, opts = {}) {
  const wiggle = opts.wiggle !== false;
  const result = new Map();
  if (!sites.length) return result;
  const add = (k, ring) => {
    if (ring.length < 3) return;
    let list = result.get(k);
    if (!list) result.set(k, (list = []));
    list.push([ring.concat([ring[0]])]);
  };
  for (const rings of polygons) {
    const outer = rings[0];
    if (!outer || outer.length < 3) continue;
    const inside = sites.filter((s) => pointInPolygon(s.x, s.y, rings));
    if (!inside.length) {
      // полігон без власних міст (острів) — належить найближчому місту області
      const [bw, bs, be, bn] = ringBBox(outer);
      const cx = (bw + be) / 2, cy = (bs + bn) / 2;
      let near = sites[0], bd = Infinity;
      for (const s of sites) {
        const d = (s.x - cx) ** 2 + (s.y - cy) ** 2;
        if (d < bd) { bd = d; near = s; }
      }
      add(near.k, outer);
      continue;
    }
    if (inside.length === 1) { add(inside[0].k, outer); continue; }
    const [, bs, , bn] = ringBBox(outer);
    const kx = Math.cos((((bs + bn) / 2) * Math.PI) / 180) || 1;
    const proj = outer.map(([x, y]) => [x * kx, y, false]);
    // Ваги: w_i = kw · imp_i. Обмеження |w_i − w_j| ≤ 0.6·d²_ij лишає кожне місто у власній зоні.
    let kw = Infinity;
    for (let i = 0; i < inside.length; i++) {
      for (let j = i + 1; j < inside.length; j++) {
        const di = Math.abs((inside[i].imp || 0) - (inside[j].imp || 0));
        if (!di) continue;
        const d2 = (inside[i].x * kx - inside[j].x * kx) ** 2 + (inside[i].y - inside[j].y) ** 2;
        kw = Math.min(kw, (0.6 * d2) / di);
      }
    }
    if (!isFinite(kw)) kw = 0;
    for (const si of inside) {
      const six = si.x * kx, siy = si.y, wi = kw * (si.imp || 0);
      let poly = proj;
      for (const sj of inside) {
        if (sj === si) continue;
        const sjx = sj.x * kx, sjy = sj.y, wj = kw * (sj.imp || 0);
        poly = clipHalfPlaneFlagged(poly, sjx - six, sjy - siy, (sjx * sjx + sjy * sjy - six * six - siy * siy + wi - wj) / 2);
        if (poly.length < 3) break;
      }
      if (poly.length < 3) continue;
      let ring = [];
      if (wiggle) {
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i], q = poly[(i + 1) % poly.length];
          ring.push([p[0], p[1]]);
          if (p[2]) for (const m of wigglePoints(p, q).slice(0, -1)) ring.push(m);
        }
      } else ring = poly.map((p) => [p[0], p[1]]);
      add(si.k, ring.map(([x, y]) => [x / kx, y]));
    }
  }
  return result;
}
