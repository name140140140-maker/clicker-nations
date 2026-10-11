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

/* Зони міст (діаграма Вороного, обрізана межами області).
   polygons — полігони області ([кільця…]), sites — [{ x, y, k }] (k — ключ міста).
   Повертає Map k → масив полігонів [[кільце]] (діри не враховуються — для прев'ю це нормально). */
export function cityZones(polygons, sites) {
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
    const proj = outer.map(([x, y]) => [x * kx, y]);
    for (const si of inside) {
      const six = si.x * kx, siy = si.y;
      let poly = proj;
      for (const sj of inside) {
        if (sj === si) continue;
        const sjx = sj.x * kx, sjy = sj.y;
        poly = clipHalfPlane(poly, sjx - six, sjy - siy, (sjx * sjx + sjy * sjy - six * six - siy * siy) / 2);
        if (poly.length < 3) break;
      }
      if (poly.length >= 3) add(si.k, poly.map(([x, y]) => [x / kx, y]));
    }
  }
  return result;
}
