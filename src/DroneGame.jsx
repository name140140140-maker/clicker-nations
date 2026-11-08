import React, { useEffect, useRef, useState } from "react";

/* Дрон-камікадзе: псевдо-3D політ над містом (чистий canvas, без залежностей).
   Камера «від третьої особи» — ззаду зверху. Лівий палець (ліва половина екрана) — рух
   вперед/назад/вбік, правий палець — поворот і висота. Клавіатура: WASD — рух, ←/→ — поворот, ↑/↓ або Q/E — висота.
   Перед зіткненням вмикається слоу-мо: камера відлітає вбік, видно удар, вибух і пожежу, далі гра повертається в меню. */

const NEAR = 0.8;
const SPEED = 34;
const VSPEED = 20;
const YAW_RATE = 1.9;
const BOUNDS = { x: 175, zMin: -170, zMax: 760, yMax: 130 };
const FOG = [196, 224, 250];

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const win = (id, f, i, j) => (((Math.imul(id + 1, 73856093) ^ Math.imul(f + 3, 19349663) ^ Math.imul(i + 7, 83492791) ^ Math.imul(j + 11, 2654435761)) >>> 0) % 7);
function fogCol(rgb, k, dist) {
  const f = Math.max(0, Math.min(0.78, (dist - 110) / 520));
  const r = Math.round(Math.min(255, rgb[0] * k) * (1 - f) + FOG[0] * f);
  const g = Math.round(Math.min(255, rgb[1] * k) * (1 - f) + FOG[1] * f);
  const b = Math.round(Math.min(255, rgb[2] * k) * (1 - f) + FOG[2] * f);
  return `rgb(${r},${g},${b})`;
}

function buildCity(seedStr, cityName) {
  const rnd = mulberry(hashSeed(seedStr));
  const items = []; // коробки, дерева, табличка
  const cell = 26;
  const zStart = 80;
  const zEnd = 690;
  const tzRow = zStart + (12 + Math.floor(rnd() * 5)) * cell;
  const sideSign = rnd() < 0.5 ? -1 : 1;
  const tx = sideSign * (1 + Math.floor(rnd() * 3)) * cell;
  const pal = ["#8c9bb0", "#a39a8c", "#7f8fa3", "#b0a58f", "#6f7d92", "#9aa8b8", "#b8a890", "#a8b2a0"];
  let id = 0;
  const box = (x0, x1, z0, z1, h, color, extra) => {
    const b = { type: "box", id: id++, x0, x1, z0, z1, h, rgb: hexRgb(color), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, cy: h / 2, burnt: 0, t: false, win: true, ...extra };
    items.push(b);
    return b;
  };
  let target = null;
  for (let gz = zStart; gz < zEnd; gz += cell) {
    for (let gx = -130; gx <= 130; gx += cell) {
      if (gx === 0) continue; // головний проспект
      const isTarget = gz === tzRow && gx === tx;
      const centerBoost = 1 - Math.min(1, Math.abs(gx) / 140);
      if (!isTarget && rnd() < 0.14) continue;
      const w = 11 + rnd() * 7;
      const d = 11 + rnd() * 7;
      let h = 8 + rnd() * (16 + 36 * centerBoost);
      if (!isTarget && Math.abs(gz - tzRow) < 55 && Math.abs(gx - tx) < 55) h = Math.min(h, 24);
      if (isTarget) { target = box(gx - 9, gx + 9, gz - 9, gz + 9, 40, "#e2452f", { t: true, win: false }); }
      else box(gx - w / 2, gx + w / 2, gz - d / 2, gz + d / 2, h, pal[Math.floor(rnd() * pal.length)]);
    }
  }
  // передмістя: будиночки вздовж дороги
  for (let z = -150; z < 56; z += 15) {
    for (const side of [-1, 1]) {
      if (rnd() < 0.25) continue;
      const x = side * (16 + rnd() * 18);
      const hh = 5 + rnd() * 3;
      const col = ["#f0e6d0", "#e8d8b8", "#d9e4ee", "#f2d9d0"][Math.floor(rnd() * 4)];
      box(x - 3.5, x + 3.5, z - 3.5, z + 3.5, hh, col, { win: false });
      box(x - 4.2, x + 4.2, z - 4.2, z + 4.2, hh + 1.4, "#c4442e", { win: false, roofOnly: true, y0: hh });
    }
  }
  // дерева
  for (let i = 0; i < 110; i++) {
    const x = (rnd() * 2 - 1) * 170;
    const z = -160 + rnd() * 230;
    if (Math.abs(x) < 12) continue;
    items.push({ type: "tree", id: id++, cx: x, cz: z, cy: 3, s: 0.8 + rnd() * 0.7, c: rnd() < 0.5 ? "#2f8f3d" : "#3da34a" });
  }
  // табличка з назвою міста біля дороги
  const sign = { type: "sign", id: id++, x0: 8, x1: 24, z0: -66, z1: -65.4, y0: 4, h: 11, cx: 16, cz: -66, cy: 8, name: cityName, rgb: hexRgb("#1f7a45") };
  items.push(sign);
  items.push({ type: "box", id: id++, x0: 9, x1: 9.8, z0: -66.2, z1: -65.2, h: 4, rgb: hexRgb("#6b5a48"), cx: 9.4, cz: -65.7, cy: 2, burnt: 0, t: false, win: false });
  items.push({ type: "box", id: id++, x0: 22.2, x1: 23, z0: -66.2, z1: -65.2, h: 4, rgb: hexRgb("#6b5a48"), cx: 22.6, cz: -65.7, cy: 2, burnt: 0, t: false, win: false });
  return { items, boxes: items.filter((b) => b.type === "box" && !b.roofOnly), target, cell, zStart, zEnd };
}

export default function DroneGame({ city, targetName, onClose }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState("brief"); // brief | play | end
  const [banner, setBanner] = useState("");
  const phaseRef = useRef("brief");
  const closedRef = useRef(false);
  const stateRef = useRef(null);
  const setPh = (p) => { phaseRef.current = p; setPhase(p); };
  const finish = (ok) => { if (closedRef.current) return; closedRef.current = true; onClose(ok); };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let Wd = 360, Hd = 640;
    const resize = () => {
      Wd = wrap.clientWidth || 360; Hd = wrap.clientHeight || 640;
      canvas.width = Math.round(Wd * dpr); canvas.height = Math.round(Hd * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const cityName = (city?.name || "МІСТО").toUpperCase();
    const C = buildCity((city?.key || city?.name || "city") + ":" + Math.floor(Math.random() * 99999), cityName);
    const { items, boxes, target } = C;
    const S = {
      p: { x: 0, y: 16, z: -120 }, yaw: 0, vel: { x: 0, y: 0, z: 0 }, lean: 0, leanF: 0,
      t: 0, parts: [], flash: 0, shake: 0, spin: 0,
      ptr: new Map(), keys: {},
      cam: { x: 0, y: 22, z: -140, yaw: 0, pitch: 0.4 },
      mode: "brief", // brief | fly | slow | burn
      timeScale: 1, slowT: 0, expT: 0, impactPos: null, cine: null, hitBox: null, result: false,
      exploded: false, doneShown: false,
    };
    let raf = 0, last = performance.now(), dead = false;
    const camSolve = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0.4 };

    // ---- 3D-математика ----
    let cx0 = 0, cy0 = 0, cz0 = 0, fX = 0, fZ = 1, rX = 1, rZ = 0, sp = 0, cp = 1, FOCAL = 500;
    const setCam = (c) => {
      cx0 = c.x; cy0 = c.y; cz0 = c.z;
      fX = Math.sin(c.yaw); fZ = Math.cos(c.yaw); rX = Math.cos(c.yaw); rZ = -Math.sin(c.yaw);
      sp = Math.sin(c.pitch); cp = Math.cos(c.pitch);
      FOCAL = Hd * 0.9;
    };
    const toCam = (x, y, z) => {
      const dx = x - cx0, dy = y - cy0, dz = z - cz0;
      const hf = dx * fX + dz * fZ;
      return [dx * rX + dz * rZ, hf * sp + dy * cp, hf * cp - dy * sp];
    };
    const scr = (p) => [Wd / 2 + (p[0] / p[2]) * FOCAL, Hd * 0.5 - (p[1] / p[2]) * FOCAL];
    const clipNear = (poly) => {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ina = a[2] >= NEAR, inb = b[2] >= NEAR;
        if (ina) out.push(a);
        if (ina !== inb) {
          const t = (NEAR - a[2]) / (b[2] - a[2]);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
        }
      }
      return out;
    };
    const fillWorld = (wp, fill) => {
      let cp3 = wp.map((p) => toCam(p[0], p[1], p[2]));
      if (cp3.every((p) => p[2] < NEAR)) return null;
      if (cp3.some((p) => p[2] < NEAR)) cp3 = clipNear(cp3);
      if (cp3.length < 3) return null;
      ctx.fillStyle = fill; ctx.beginPath();
      for (let i = 0; i < cp3.length; i++) { const s = scr(cp3[i]); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); }
      ctx.closePath(); ctx.fill();
      return cp3;
    };

    let winBudget = 0;
    const drawFace = (b, face, corners, k, dist, wwid, whei) => {
      const fill = b.burnt ? fogCol([58, 42, 36], k, dist) : fogCol(b.rgb, k, dist);
      const poly = fillWorld(corners, b.t && !b.burnt ? fogCol([226, 69, 47], k * (0.95 + 0.2 * Math.sin(S.t * 6)), dist) : fill);
      if (!poly || !b.win || dist > 95 || winBudget <= 0 || poly.length !== 4) return;
      // вікна фіксовані в просторі будівлі (інтерполяція у координатах камери — афінно точна)
      const c = poly; // [bl, br, tr, tl] у просторі камери
      if (c.some((p) => p[2] < NEAR)) return;
      const cols = Math.max(2, Math.round(wwid / 3.6)), rows = Math.max(2, Math.round(whei / 4.4));
      const lerp3 = (u, v) => {
        const a = [c[0][0] + (c[1][0] - c[0][0]) * u, c[0][1] + (c[1][1] - c[0][1]) * u, c[0][2] + (c[1][2] - c[0][2]) * u];
        const bb = [c[3][0] + (c[2][0] - c[3][0]) * u, c[3][1] + (c[2][1] - c[3][1]) * u, c[3][2] + (c[2][2] - c[3][2]) * u];
        return scr([a[0] + (bb[0] - a[0]) * v, a[1] + (bb[1] - a[1]) * v, a[2] + (bb[2] - a[2]) * v]);
      };
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (winBudget-- <= 0) return;
          const h = win(b.id, face, i, j);
          const u0 = (i + 0.2) / cols, u1 = (i + 0.8) / cols, v0 = (j + 0.2) / rows, v1 = (j + 0.8) / rows;
          const p0 = lerp3(u0, v0), p1 = lerp3(u1, v0), p2 = lerp3(u1, v1), p3 = lerp3(u0, v1);
          ctx.fillStyle = b.burnt ? (h < 4 ? "#ff8a2a" : "#2a1c16") : h === 0 ? "#ffe9a0" : h === 1 ? "#cfe9ff" : "#34506f";
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath(); ctx.fill();
        }
      }
    };

    const drawBox = (b, dist) => {
      const y0 = b.y0 || 0, y1 = b.h;
      const { x0, x1, z0, z1 } = b;
      if (cy0 > y1) fillWorld([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], b.burnt ? fogCol([42, 30, 26], 1, dist) : fogCol(b.rgb, 1.15, dist));
      if (cx0 < x0) drawFace(b, 1, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 0.62, dist, z1 - z0, y1 - y0);
      else if (cx0 > x1) drawFace(b, 2, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 0.62, dist, z1 - z0, y1 - y0);
      if (cz0 < z0) drawFace(b, 3, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], 0.86, dist, x1 - x0, y1 - y0);
      else if (cz0 > z1) drawFace(b, 4, [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], 0.86, dist, x1 - x0, y1 - y0);
    };

    const drawTree = (t, dist) => {
      const p = toCam(t.cx, 0, t.cz);
      if (p[2] < NEAR) return;
      const s = (FOCAL / p[2]) * t.s;
      const [sx, sy] = scr(p);
      ctx.fillStyle = fogCol([110, 74, 40], 1, dist); ctx.fillRect(sx - s * 0.35, sy - s * 2, s * 0.7, s * 2);
      ctx.fillStyle = fogCol(hexRgb(t.c), 1, dist); ctx.beginPath(); ctx.arc(sx, sy - s * 3.4, s * 2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.beginPath(); ctx.arc(sx - s * 0.6, sy - s * 4, s * 0.9, 0, 6.2832); ctx.fill();
    };

    const drawSign = (sg, dist) => {
      const b = { ...sg, win: false, burnt: 0, t: false, id: sg.id };
      drawBox(b, dist);
      if (cz0 < sg.z0) {
        const a = toCam(sg.x0, sg.y0, sg.z0), c = toCam(sg.x1, sg.h, sg.z0);
        if (a[2] < NEAR || c[2] < NEAR) return;
        const [ax, ay] = scr(a), [cx2, cy2] = scr(c);
        const w = Math.abs(cx2 - ax), h = Math.abs(ay - cy2);
        if (w < 12) return;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1, w * 0.012);
        ctx.strokeRect(Math.min(ax, cx2) + w * 0.03, Math.min(ay, cy2) + h * 0.06, w * 0.94, h * 0.88);
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const fs = Math.min(w / (sg.name.length * 0.62 + 0.5), h * 0.42);
        ctx.font = `800 ${fs}px sans-serif`;
        ctx.fillText(sg.name, (ax + cx2) / 2, Math.min(ay, cy2) + h * 0.45);
        ctx.font = `600 ${fs * 0.38}px sans-serif`;
        ctx.fillText("ВІТАЄМО", (ax + cx2) / 2, Math.min(ay, cy2) + h * 0.82);
        ctx.textBaseline = "alphabetic";
      }
    };

    const drawDrone = (dist) => {
      const p = toCam(S.p.x, S.p.y, S.p.z);
      if (p[2] < NEAR) return;
      const [sx, sy] = scr(p);
      const sc = FOCAL / p[2];
      const sw = sc * 3.4;
      // тінь
      const g = toCam(S.p.x, 0.05, S.p.z);
      if (g[2] > NEAR) { const [gx, gy] = scr(g); ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(gx, gy, sw * 0.5, sw * 0.14, 0, 0, 6.2832); ctx.fill(); }
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(S.lean * 0.5);
      const squash = 1 - Math.min(0.35, Math.abs(S.leanF) * 0.4);
      ctx.scale(1, squash);
      ctx.strokeStyle = "#20252b"; ctx.lineWidth = sw * 0.09; ctx.lineCap = "round";
      const arms = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [ax, az] of arms) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ax * sw * 0.5, az * sw * 0.2); ctx.stroke(); }
      for (const [ax, az] of arms) {
        const rx = ax * sw * 0.5, ry = az * sw * 0.2;
        ctx.fillStyle = "rgba(200,215,230,0.45)"; ctx.beginPath(); ctx.ellipse(rx, ry, sw * 0.27, sw * 0.09, 0, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = "rgba(30,30,30,0.7)"; ctx.lineWidth = Math.max(1, sw * 0.03);
        const a = S.spin + (ax * az > 0 ? 0 : 1.5);
        ctx.beginPath(); ctx.moveTo(rx - Math.cos(a) * sw * 0.27, ry - Math.sin(a) * sw * 0.09); ctx.lineTo(rx + Math.cos(a) * sw * 0.27, ry + Math.sin(a) * sw * 0.09); ctx.stroke();
      }
      ctx.fillStyle = "#2f3640"; ctx.beginPath(); ctx.ellipse(0, 0, sw * 0.22, sw * 0.14, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = Math.sin(S.t * 14) > 0 ? "#ff3b30" : "#7a1d18"; ctx.beginPath(); ctx.arc(0, sw * 0.07, sw * 0.045, 0, 6.2832); ctx.fill();
      ctx.restore();
      void dist;
    };

    const emitBurst = (pos, n) => {
      for (let i = 0; i < n && S.parts.length < 240; i++) {
        const a = Math.random() * 6.2832, e = (Math.random() - 0.2) * 1.4, sp2 = 8 + Math.random() * 26;
        S.parts.push({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * sp2, vy: Math.sin(e) * sp2 * 0.8 + 6, vz: Math.sin(a) * sp2, life: 0.9 + Math.random() * 1.2, age: 0, kind: 0 });
      }
    };
    const emitFire = (b) => {
      if (S.parts.length > 230) return;
      const smoke = Math.random() < 0.45;
      S.parts.push({
        x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.h * (0.55 + Math.random() * 0.45), z: b.z0 + Math.random() * (b.z1 - b.z0),
        vx: (Math.random() - 0.5) * 3, vy: 6 + Math.random() * 9, vz: (Math.random() - 0.5) * 3,
        life: smoke ? 2.4 + Math.random() * 1.6 : 1.1 + Math.random() * 1, age: 0, kind: smoke ? 2 : 1,
      });
    };

    const hitTest = (x, y, z) => {
      if (y < 1.4) return { ground: true };
      const m = 2.2;
      for (const b of boxes) {
        if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m && y < b.h + m && y > (b.y0 || 0)) return b;
      }
      return null;
    };

    const angLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
    const lookAt = (from, to) => {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)) };
    };

    const frame = (now) => {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
      const dt = dtReal * S.timeScale;
      const ph = S.mode;
      S.t += dtReal; S.spin += dtReal * 40;

      if (ph === "brief") {
        S.cam.yaw = -0.5 + Math.sin(S.t * 0.4) * 0.15; S.cam.pitch = 0.3;
        S.cam.x = S.p.x + 36 * Math.sin(-S.cam.yaw); S.cam.z = S.p.z - 36 * Math.cos(S.cam.yaw); S.cam.y = S.p.y + 10;
        const l = lookAt(S.cam, { x: S.p.x, y: S.p.y + 4, z: S.p.z }); S.cam.yaw = l.yaw; S.cam.pitch = l.pitch;
      } else if (ph === "fly") {
        // ввід: ліва половина — рух, права — поворот/висота
        let mx = 0, my = 0, lx = 0, ly = 0;
        for (const p of S.ptr.values()) { if (p.side === 0) { mx = p.dx; my = p.dy; } else { lx = p.dx; ly = p.dy; } }
        const k = S.keys;
        if (k.a) mx -= 1; if (k.d) mx += 1; if (k.w) my -= 1; if (k.s) my += 1;
        if (k.ArrowLeft) lx -= 1; if (k.ArrowRight) lx += 1; if (k.ArrowUp || k.q) ly -= 1; if (k.ArrowDown || k.e) ly += 1;
        const cl = (v) => Math.max(-1, Math.min(1, v));
        mx = cl(mx); my = cl(my); lx = cl(lx); ly = cl(ly);
        S.yaw += lx * YAW_RATE * dt;
        const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw), rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw);
        const tvx = (fx * -my + rx * mx) * SPEED, tvz = (fz * -my + rz * mx) * SPEED, tvy = -ly * VSPEED;
        const a = Math.min(1, dt * 4.5);
        S.vel.x += (tvx - S.vel.x) * a; S.vel.y += (tvy - S.vel.y) * a; S.vel.z += (tvz - S.vel.z) * a;
        S.lean += (mx * 0.3 - S.lean) * Math.min(1, dt * 6);
        S.leanF += (-my - S.leanF) * Math.min(1, dt * 6);
        S.p.x = Math.max(-BOUNDS.x, Math.min(BOUNDS.x, S.p.x + S.vel.x * dt));
        S.p.z = Math.max(BOUNDS.zMin, Math.min(BOUNDS.zMax, S.p.z + S.vel.z * dt));
        S.p.y = Math.max(0.5, Math.min(BOUNDS.yMax, S.p.y + S.vel.y * dt));
        // камера за дроном (зверху)
        S.cam.x = S.p.x - Math.sin(S.yaw) * 15; S.cam.z = S.p.z - Math.cos(S.yaw) * 15; S.cam.y = S.p.y + 7.5;
        S.cam.yaw = S.yaw; S.cam.pitch = 0.3;
        // передбачення зіткнення на 0.7 с вперед → слоу-мо
        const sp2 = Math.hypot(S.vel.x, S.vel.y, S.vel.z);
        if (sp2 > 6) {
          for (let s = 0.1; s <= 0.7; s += 0.1) {
            const h = hitTest(S.p.x + S.vel.x * s, S.p.y + S.vel.y * s, S.p.z + S.vel.z * s);
            if (h) {
              S.mode = "slow"; S.slowT = S.t; S.timeScale = 0.2;
              const hv = Math.hypot(S.vel.x, S.vel.z) || 1;
              const sx = S.vel.z / hv, sz = -S.vel.x / hv;
              let best = null;
              for (const sg of [1, -1]) {
                const cand = { x: S.p.x + sx * 24 * sg - (S.vel.x / hv) * 4, y: S.p.y + 5, z: S.p.z + sz * 24 * sg - (S.vel.z / hv) * 4 };
                if (!hitTest(cand.x, cand.y, cand.z) && !best) best = cand;
              }
              S.cine = { from: { ...S.cam }, pos: best || { x: S.p.x + sx * 24, y: S.p.y + 12, z: S.p.z + sz * 24 } };
              break;
            }
          }
        }
        if (S.t > 150 && S.mode === "fly") { S.mode = "burn"; S.exploded = false; S.result = false; S.expT = S.t; S.timeoutEnd = true; setBanner("Зв'язок із дроном втрачено"); }
      } else if (ph === "slow" || ph === "burn") {
        if (ph === "slow" && !S.exploded) {
          S.p.x += S.vel.x * dt; S.p.y += S.vel.y * dt; S.p.z += S.vel.z * dt;
          const h = hitTest(S.p.x, S.p.y, S.p.z);
          if (h) {
            S.exploded = true; S.expT = S.t; S.impactPos = { ...S.p }; S.flash = 1; S.shake = 1;
            S.hitBox = h.ground ? null : h;
            S.result = !!(h.t);
            if (h.t) { h.burnt = 1; } else if (!h.ground) { h.burnt = 1; }
            emitBurst(S.p, 90);
            setBanner(h.t ? "ЦІЛЬ ЗНИЩЕНА" : "ДРОН РОЗБИТО");
          }
        }
        // камера: від позиції за дроном до бокового плану
        const e = S.t - S.slowT;
        const k = Math.min(1, e / 0.9); const ease = k * k * (3 - 2 * k);
        const focus = S.exploded ? S.impactPos : S.p;
        if (S.cine) {
          let tp = S.cine.pos;
          if (S.exploded) { const o = (S.t - S.expT) * 0.12; const ang = Math.atan2(tp.x - focus.x, tp.z - focus.z) + o; const dd = Math.min(46, Math.hypot(tp.x - focus.x, tp.z - focus.z) + (S.t - S.expT) * 2.5); tp = { x: focus.x + Math.sin(ang) * dd, y: Math.max(tp.y, focus.y + 12 + (S.t - S.expT) * 1.5), z: focus.z + Math.cos(ang) * dd }; }
          const from = S.cine.from;
          S.cam.x = from.x + (tp.x - from.x) * ease; S.cam.y = from.y + (tp.y - from.y) * ease; S.cam.z = from.z + (tp.z - from.z) * ease;
          const l = lookAt(S.cam, { x: focus.x, y: focus.y + (S.exploded ? 6 : 0), z: focus.z });
          S.cam.yaw = angLerp(from.yaw, l.yaw, ease); S.cam.pitch = from.pitch + (l.pitch - from.pitch) * ease;
        }
        if (S.exploded) {
          const ee = S.t - S.expT;
          S.flash = Math.max(0, S.flash - dtReal * 1.6); S.shake = Math.max(0, S.shake - dtReal * 1.2);
          if (ee > 1.4 && S.timeScale < 1) S.timeScale = Math.min(1, S.timeScale + dtReal * 1.2);
          if (S.hitBox) {
            emitFire(S.hitBox);
            for (const b of boxes) if (!b.burnt && Math.abs(b.cx - S.hitBox.cx) < 42 && Math.abs(b.cz - S.hitBox.cz) < 42 && Math.random() < dt * 0.5) b.burnt = 1;
          } else emitBurst({ x: S.impactPos.x, y: 1, z: S.impactPos.z }, 1);
          for (const b of boxes) if (b.burnt && b !== S.hitBox && Math.random() < 0.18) emitFire(b);
          if (ee > 5.6) { S.mode = "done"; finish(S.result); }
        } else if (S.timeoutEnd && S.t - S.expT > 2) { S.mode = "done"; finish(false); }
      }

      // частинки
      for (let i = S.parts.length - 1; i >= 0; i--) {
        const p = S.parts[i];
        p.age += dt; if (p.age > p.life) { S.parts.splice(i, 1); continue; }
        if (p.kind === 0) p.vy -= 12 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }

      // ---- малювання ----
      camSolve.x = S.cam.x; camSolve.y = S.cam.y; camSolve.z = S.cam.z; camSolve.yaw = S.cam.yaw; camSolve.pitch = S.cam.pitch;
      if (S.shake > 0) { camSolve.x += (Math.random() - 0.5) * 1.6 * S.shake; camSolve.y += (Math.random() - 0.5) * 1.6 * S.shake; }
      setCam(camSolve);
      ctx.save();
      const sky = ctx.createLinearGradient(0, 0, 0, Hd);
      sky.addColorStop(0, "#4f9cf5"); sky.addColorStop(0.55, "#cfe8ff"); sky.addColorStop(1, "#dff0ff");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, Wd, Hd);
      // земля: трава + асфальт міста
      fillWorld([[-1500, 0, -700], [1500, 0, -700], [1500, 0, 1500], [-1500, 0, 1500]], "#6aa354");
      fillWorld([[-148, 0.02, C.zStart - 13], [148, 0.02, C.zStart - 13], [148, 0.02, C.zEnd], [-148, 0.02, C.zEnd]], "#5c625c");
      // дороги
      const road = (x0, x1, z0, z1, col) => fillWorld([[x0, 0.05, z0], [x1, 0.05, z0], [x1, 0.05, z1], [x0, 0.05, z1]], col);
      road(-6.5, 6.5, -260, C.zEnd + 20, "#33373a");
      for (let z = C.zStart - 13; z <= C.zEnd; z += C.cell) road(-148, 148, z - 3.5, z + 3.5, "#3d4144");
      for (let x = -143; x <= 143; x += C.cell) if (Math.abs(x) > 8) road(x - 3.5, x + 3.5, C.zStart - 13, C.zEnd, "#3d4144");
      const dz0 = Math.floor((cz0 - 60) / 10) * 10;
      for (let z = dz0; z < dz0 + 340; z += 10) { if (z < -260) continue; road(-0.35, 0.35, z, z + 5, "#f2f2f2"); }
      // підсвітка зони цілі (зелений квадрат навколо): допомагає знайти
      winBudget = 900;
      // упорядкування: дальні першими
      const dr = [];
      for (const it of items) {
        const dx = it.cx - cx0, dz = it.cz - cz0, dy = (it.cy || 0) - cy0;
        const d2 = dx * dx + dz * dz + dy * dy;
        if (d2 > 640 * 640) continue;
        const pz = dx * fX + dz * fZ;
        if (pz < -45) continue;
        dr.push({ it, d2 });
      }
      dr.push({ it: { type: "drone" }, d2: (S.p.x - cx0) ** 2 + (S.p.z - cz0) ** 2 + (S.p.y - cy0) ** 2 });
      dr.sort((a, b) => b.d2 - a.d2);
      // вікна найближчим: рахуємо в зворотному порядку не будемо; бюджет лишаємо першим-бо-далеким → нижчий дистанцій. Тому ліміт по відстані 150
      for (const { it, d2 } of dr) {
        const dist = Math.sqrt(d2);
        if (it.type === "box") drawBox(it, dist);
        else if (it.type === "tree") drawTree(it, dist);
        else if (it.type === "sign") drawSign(it, dist);
        else if (it.type === "drone") { if (!S.exploded) drawDrone(dist); }
      }
      // маяк цілі: червоний стовп
      if (target && !target.burnt) {
        const tx = target.cx, tz = target.cz;
        const a = toCam(tx, target.h, tz), b = toCam(tx, 220, tz);
        if (a[2] > NEAR && b[2] > NEAR) {
          const [ax, ay] = scr(a), [bx, by] = scr(b);
          const wpx = Math.max(3, (FOCAL / a[2]) * 3);
          const g = ctx.createLinearGradient(0, ay, 0, by);
          g.addColorStop(0, "rgba(255,60,40,0.75)"); g.addColorStop(1, "rgba(255,60,40,0)");
          ctx.fillStyle = g; ctx.fillRect(ax - wpx / 2, Math.min(ay, by), wpx, Math.abs(ay - by));
        }
      }
      // вогонь і дим (поверх)
      ctx.globalCompositeOperation = "source-over";
      for (const p of S.parts) {
        const q = toCam(p.x, p.y, p.z);
        if (q[2] < NEAR) continue;
        const [sx, sy] = scr(q);
        const u = p.age / p.life;
        const base = (FOCAL / q[2]);
        if (p.kind === 2) { ctx.fillStyle = `rgba(55,55,60,${0.55 * (1 - u)})`; ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, base * (2.5 + u * 5)), 0, 6.2832); ctx.fill(); }
        else {
          ctx.fillStyle = u < 0.35 ? `rgba(255,${Math.round(220 - u * 250)},70,${0.95 - u * 0.6})` : `rgba(235,${Math.round(100 - u * 50)},25,${0.9 * (1 - u)})`;
          ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, base * (p.kind === 0 ? 1.4 : 2.2 - u * 1.2)), 0, 6.2832); ctx.fill();
        }
      }
      // ударна хвиля
      if (S.exploded && S.impactPos) {
        const ee = S.t - S.expT;
        if (ee < 1.2) {
          const q = toCam(S.impactPos.x, S.impactPos.y, S.impactPos.z);
          if (q[2] > NEAR) { const [sx, sy] = scr(q); ctx.strokeStyle = `rgba(255,230,160,${1 - ee / 1.2})`; ctx.lineWidth = 5 * (1 - ee / 1.2) + 1; ctx.beginPath(); ctx.arc(sx, sy, (FOCAL / q[2]) * (4 + ee * 45), 0, 6.2832); ctx.stroke(); }
        }
      }
      ctx.restore();

      if (S.flash > 0) { ctx.fillStyle = `rgba(255,240,200,${0.85 * S.flash})`; ctx.fillRect(0, 0, Wd, Hd); }
      const vg = ctx.createRadialGradient(Wd / 2, Hd / 2, Hd * 0.32, Wd / 2, Hd / 2, Hd * 0.78);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, S.timeScale < 0.9 ? "rgba(40,0,0,0.5)" : "rgba(0,0,0,0.38)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, Wd, Hd);

      // HUD
      if (ph === "fly" && target) {
        const tp = toCam(target.cx, target.h + 6, target.cz);
        const dist = Math.round(Math.hypot(S.p.x - target.cx, S.p.z - target.cz));
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(10, 10, 168, 58);
        ctx.fillStyle = "#9cff9c"; ctx.font = "bold 13px monospace"; ctx.textAlign = "left";
        ctx.fillText("ЦІЛЬ    " + dist + " м", 18, 29);
        ctx.fillText("ВИСОТА  " + Math.round(S.p.y) + " м", 18, 47);
        ctx.fillText("ШВИДК.  " + Math.round(Math.hypot(S.vel.x, S.vel.z) * 3.6) + " км/г", 18, 63);
        // маркер цілі (кільце або стрілка по краю екрана)
        let sx, sy, on = false;
        if (tp[2] > NEAR) { [sx, sy] = scr(tp); on = sx > 28 && sx < Wd - 28 && sy > 70 && sy < Hd - 28; }
        const pulse = 1 + 0.15 * Math.sin(S.t * 6);
        ctx.strokeStyle = "#ff3b30"; ctx.fillStyle = "#ff3b30"; ctx.lineWidth = 3;
        if (on) {
          ctx.beginPath(); ctx.arc(sx, sy, 20 * pulse, 0, 6.2832); ctx.stroke();
          ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("ЦІЛЬ", sx, sy - 28);
        } else {
          let dx = tp[0], dy = -tp[1]; if (tp[2] < 0) { dx = -dx; dy = -dy; }
          const ang = Math.atan2(dy, dx);
          const ex = Wd / 2 + Math.cos(ang) * (Wd / 2 - 34), ey = Math.max(80, Math.min(Hd - 40, Hd / 2 + Math.sin(ang) * (Hd / 2 - 60)));
          ctx.save(); ctx.translate(Math.max(30, Math.min(Wd - 30, ex)), ey); ctx.rotate(ang);
          ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, 12); ctx.lineTo(-10, -12); ctx.closePath(); ctx.fill(); ctx.restore();
        }
        // стіки
        ctx.lineWidth = 2;
        for (const p of S.ptr.values()) {
          ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(p.ox, p.oy, 46, 0, 6.2832); ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.beginPath(); ctx.arc(p.ox + p.dx * 46, p.oy + p.dy * 46, 18, 0, 6.2832); ctx.fill();
        }
      }
      if (S.timeScale < 0.9 && S.mode !== "brief") {
        ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = "bold 13px monospace"; ctx.textAlign = "right"; ctx.fillText("СЛОУ-МО ▶", Wd - 56, 30);
      }
    };
    raf = requestAnimationFrame(frame);

    // старт польоту
    S.start = () => { S.mode = "fly"; S.yaw = 0; };
    stateRef.current = S;

    const pos = (e) => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onDown = (e) => {
      if (S.mode !== "fly") return;
      const [x, y] = pos(e);
      S.ptr.set(e.pointerId, { side: x < Wd / 2 ? 0 : 1, ox: x, oy: y, dx: 0, dy: 0 });
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    };
    const onMove = (e) => {
      const p = S.ptr.get(e.pointerId); if (!p) return;
      const [x, y] = pos(e);
      let dx = (x - p.ox) / 46, dy = (y - p.oy) / 46;
      const n = Math.hypot(dx, dy); if (n > 1) { dx /= n; dy /= n; }
      p.dx = dx; p.dy = dy;
    };
    const onUp = (e) => { S.ptr.delete(e.pointerId); };
    const kd = (e) => { S.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true; };
    const ku = (e) => { S.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; };
    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    return () => {
      dead = true; cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  const btn = { padding: "12px 26px", borderRadius: 12, border: "none", fontWeight: 800, fontSize: 15, color: "#fff", background: "linear-gradient(180deg,#3b8cff,#1f64d6)", boxShadow: "0 4px 0 #14439a", cursor: "pointer" };

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#000", touchAction: "none", userSelect: "none", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <button type="button" aria-label="Закрити" onClick={() => finish(false)} style={{ position: "absolute", top: 10, right: 10, width: 38, height: 38, borderRadius: 19, border: "none", background: "rgba(0,0,0,.55)", color: "#fff", fontSize: 18, cursor: "pointer", zIndex: 2 }}>✕</button>
      {phase === "brief" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", background: "linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.6))", textAlign: "center", color: "#fff", padding: "0 24px 48px" }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: "#ffb3a8" }}>УДАР ДРОНОМ</div>
          <div style={{ fontSize: 28, fontWeight: 900, margin: "6px 0" }}>{city?.name}</div>
          {targetName && <div style={{ fontSize: 14, opacity: 0.85 }}>{targetName}</div>}
          <div style={{ fontSize: 14, margin: "14px 0 18px", maxWidth: 330, lineHeight: 1.5 }}>
            Ліва половина екрана — рух (вперед, назад, вбік). Права — поворот і висота. Знайди <b style={{ color: "#ff6a5c" }}>червону ціль</b> із червоним променем і влуч у неї.
          </div>
          <button type="button" style={btn} onClick={() => { setPh("play"); if (stateRef.current) stateRef.current.start(); }}>Запустити</button>
        </div>
      )}
      {banner && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 70, textAlign: "center", pointerEvents: "none" }}>
          <div style={{ display: "inline-block", fontSize: 24, fontWeight: 900, color: banner.startsWith("ЦІЛЬ") ? "#ffb347" : "#ff6a5c", textShadow: "0 2px 8px rgba(0,0,0,.8)" }}>{banner}</div>
        </div>
      )}
    </div>
  );
}
