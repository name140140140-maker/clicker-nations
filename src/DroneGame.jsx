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
  const items = [];
  const cell = 26;
  const zStart = 80;
  const zEnd = 690;
  const tzRow = zStart + (12 + Math.floor(rnd() * 5)) * cell;
  const sideSign = rnd() < 0.5 ? -1 : 1;
  const tx = sideSign * (1 + Math.floor(rnd() * 3)) * cell;
  const pal = ["#8c9bb0", "#a39a8c", "#7f8fa3", "#b0a58f", "#6f7d92", "#9aa8b8", "#b8a890", "#a8b2a0", "#c2b49a", "#8e9ba8"];
  const carCols = ["#d64545", "#3b7fd6", "#e8e8e8", "#2d2f33", "#e0b73a", "#4aa86a", "#9aa0a8"];
  const wallCols = ["#f0e6d0", "#e8d8b8", "#d9e4ee", "#f2d9d0", "#e9e2c8", "#d8e8d0"];
  const roofCols = ["#c4442e", "#8a4a32", "#5a6b86", "#a0523d", "#6b5a48"];
  let id = 0;
  const box = (x0, x1, z0, z1, h, color, extra) => {
    const b = { type: "box", id: id++, x0, x1, z0, z1, h, rgb: hexRgb(color), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, cy: ((extra && extra.y0 ? extra.y0 : 0) + h) / 2, burnt: 0, t: false, win: true, ...extra };
    items.push(b);
    return b;
  };
  const deco = (x0, x1, z0, z1, h, color, extra) => box(x0, x1, z0, z1, h, color, { deco: true, win: false, far: 170, ...extra });
  const tree = (x, z, sc, pine) => items.push({ type: "tree", id: id++, cx: x, cz: z, cy: 3, s: sc, pine: !!pine, c: rnd() < 0.5 ? "#2f8f3d" : "#3da34a", far: 330 });
  const lamp = (x, z) => items.push({ type: "lamp", id: id++, cx: x, cz: z, cy: 3, arm: x > 0 ? -1 : 1, far: 210 });
  const bench = (x, z, alongZ) => {
    if (alongZ) { deco(x - 0.4, x + 0.4, z - 1.1, z + 1.1, 0.6, "#8a5a2b", { far: 120 }); deco(x - (x > 0 ? -0.4 : 0.4) - 0.2, x - (x > 0 ? -0.4 : 0.4) + 0.2, z - 1.1, z + 1.1, 1.2, "#6b4423", { far: 120 }); }
    else { deco(x - 1.1, x + 1.1, z - 0.4, z + 0.4, 0.6, "#8a5a2b", { far: 120 }); deco(x - 1.1, x + 1.1, z - 0.6, z - 0.4, 1.2, "#6b4423", { far: 120 }); }
  };
  const car = (x, z) => {
    const c = carCols[Math.floor(rnd() * carCols.length)];
    deco(x, x + 4.2, z - 0.95, z + 0.95, 1.1, c, { far: 150 });
    deco(x + 0.9, x + 3.2, z - 0.85, z + 0.85, 1.9, shadeHex(c, 0.85), { far: 150, y0: 1.1, glass: true });
  };
  // дім із двосхилим дахом, дверима, димарем і живоплотом
  const house = (cx, cz, w, d, axis, doorFace) => {
    const h = 4 + rnd() * 2.2;
    const wall = wallCols[Math.floor(rnd() * wallCols.length)];
    const roof = roofCols[Math.floor(rnd() * roofCols.length)];
    box(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, h, wall, { win: true, noTop: true, door: doorFace, far: 420 });
    const rh = 2.3 + rnd() * 1.2;
    items.push({ type: "roof", id: id++, x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0: h, h: h + rh, axis, rgb: hexRgb(roof), wall: hexRgb(wall), cx, cz, cy: h + rh / 2, ly: 1, far: 420 });
    if (rnd() < 0.6) deco(cx + w * 0.15, cx + w * 0.15 + 0.9, cz - 0.5, cz + 0.5, h + rh + 0.6, "#8a7a6a", { y0: h + 0.8, ly: 2, far: 110 });
    // живопліт перед входом
    if (doorFace === 1) deco(cx - w / 2 - 1.6, cx - w / 2 - 1.1, cz - d / 2, cz + d / 2, 1.1, "#3f9a3f", { far: 120 });
    else if (doorFace === 2) deco(cx + w / 2 + 1.1, cx + w / 2 + 1.6, cz - d / 2, cz + d / 2, 1.1, "#3f9a3f", { far: 120 });
    else if (doorFace === 3) deco(cx - w / 2, cx + w / 2, cz - d / 2 - 1.6, cz - d / 2 - 1.1, 1.1, "#3f9a3f", { far: 120 });
    else deco(cx - w / 2, cx + w / 2, cz + d / 2 + 1.1, cz + d / 2 + 1.6, 1.1, "#3f9a3f", { far: 120 });
  };

  let target = null;
  const parks = [];
  for (let gz = zStart; gz < zEnd; gz += cell) {
    for (let gx = -130; gx <= 130; gx += cell) {
      if (gx === 0) continue; // головний проспект
      const isTarget = gz === tzRow && gx === tx;
      const centerBoost = 1 - Math.min(1, Math.abs(gx) / 140);
      if (!isTarget && rnd() < 0.13) {
        // парк: газон, дерева, лавка
        parks.push({ x: gx, z: gz });
        for (let k = 0; k < 5; k++) tree(gx + (rnd() - 0.5) * 18, gz + (rnd() - 0.5) * 18, 0.9 + rnd() * 0.6, rnd() < 0.2);
        bench(gx, gz + 6.5, false);
        continue;
      }
      const w = 11 + rnd() * 7;
      const d = 11 + rnd() * 7;
      let h = 8 + rnd() * (16 + 36 * centerBoost);
      if (!isTarget && Math.abs(gz - tzRow) < 55 && Math.abs(gx - tx) < 55) h = Math.min(h, 24);
      if (isTarget) { target = box(gx - 9, gx + 9, gz - 9, gz + 9, 40, "#e2452f", { t: true, win: false }); continue; }
      const col = pal[Math.floor(rnd() * pal.length)];
      const x0 = gx - w / 2, x1 = gx + w / 2, z0 = gz - d / 2, z1 = gz + d / 2;
      const b = box(x0, x1, z0, z1, h, col);
      if (h > 26) {
        // уступ угорі
        const th = h + 5 + rnd() * 6;
        b.noTop = true;
        box(x0 + 2.2, x1 - 2.2, z0 + 2.2, z1 - 2.2, th, shadeHex(col, 1.08), { y0: h, ly: 1 });
        deco(x0 + 0.4, x0 + 2, z0 + 0.4, z0 + 1.6, h + 1.2, "#9aa0a6", { y0: h, ly: 2, far: 120 });
      } else if (h > 12) {
        deco(x0 + 1, x0 + 3.2, z0 + 1, z0 + 2.4, h + 1.3, "#9aa0a6", { y0: h, ly: 2, far: 120 });
        if (rnd() < 0.5) deco(x1 - 3, x1 - 1, z1 - 2.4, z1 - 1, h + 1, "#8a9096", { y0: h, ly: 2, far: 120 });
      }
    }
  }
  // вуличні ліхтарі, дерева й лавки вздовж проспекту
  for (let z = -200; z < zEnd + 10; z += 26) {
    lamp(12, z); lamp(-12, z + 13);
    if (z > zStart - 20) {
      tree(15.5, z + 7, 0.7 + rnd() * 0.2); tree(-15.5, z + 20, 0.7 + rnd() * 0.2);
      if (Math.round((z - zStart) / 26) % 3 === 0) { bench(11.2, z + 5, true); bench(-11.2, z + 18, true); }
    }
  }
  // припарковані авто на поперечних вулицях
  for (let rc = zStart - 13; rc <= zEnd; rc += cell) {
    for (let k = 0; k < 5; k++) {
      const x = (rnd() < 0.5 ? -1 : 1) * (18 + rnd() * 120);
      if (Math.abs(((x + 143) % 26)) < 5 || Math.abs(((x + 143) % 26)) > 21) continue;
      car(x, rc + (rnd() < 0.5 ? -1.7 : 1.7));
    }
  }
  // передмістя: будинки вздовж дороги та провулки
  const lanes = [-148, -104, -22];
  for (let z = -170; z < 60; z += 14) {
    for (const side of [-1, 1]) {
      if (rnd() < 0.2) continue;
      if (Math.abs(z + 66) < 13 && side === 1) continue; // табличка
      if (lanes.some((lz) => Math.abs(z - lz) < 9)) continue; // провулки
      const x = side * (21 + rnd() * 3);
      house(x, z, 7 + rnd() * 2, 7.5 + rnd() * 1.5, "z", side > 0 ? 1 : 2);
    }
  }
  for (const lz of lanes) {
    for (const side of [-1, 1]) {
      for (let x = 34; x < 100; x += 15) {
        for (const lz2 of [-1, 1]) {
          if (rnd() < 0.25) continue;
          house(side * (x + rnd() * 3), lz + lz2 * 9.5, 8 + rnd() * 2, 7 + rnd(), "x", lz2 > 0 ? 3 : 4);
        }
      }
      for (let x = 30; x < 100; x += 18) lamp(side * x, lz + 4.2);
    }
  }
  // дерева й сосни навколо
  for (let i = 0; i < 150; i++) {
    const x = (rnd() * 2 - 1) * 170;
    const z = -170 + rnd() * 240;
    if (Math.abs(x) < 15) continue;
    if (lanes.some((lz) => Math.abs(z - lz) < 8)) continue;
    tree(x, z, 0.8 + rnd() * 0.7, rnd() < 0.3);
  }
  // табличка з назвою міста біля дороги
  const sign = { type: "sign", id: id++, x0: 14, x1: 30, z0: -66, z1: -65.4, y0: 4, h: 11, cx: 22, cz: -66, cy: 8, name: cityName, rgb: hexRgb("#1f7a45") };
  items.push(sign);
  deco(14.4, 15.2, -66.2, -65.2, 4, "#6b5a48", { far: 300 });
  deco(28.8, 29.6, -66.2, -65.2, 4, "#6b5a48", { far: 300 });
  const boxes = items.filter((b) => b.type === "box" && !b.deco);
  return { items, boxes, target, cell, zStart, zEnd, parks, lanes };
}

function shadeHex(hex, k) {
  const [r, g, b] = hexRgb(hex);
  const h = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

export const DRONE_MODELS = {
  quad: { id: "quad", name: "Квадрокоптер", desc: "Маневровий, зависає й різко повертає", speed: 1 },
  shahed: { id: "shahed", name: "Шахед", desc: "Трикутне крило, швидкий, інерційний", speed: 1.3 },
  bayraktar: { id: "bayraktar", name: "Байрактар", desc: "Літак з крилами, плавний і керований", speed: 1.1 },
};

// моделі-літаки: полігони в локальних координатах (x вправо, y вгору, z вперед)
const box3 = (x0, x1, y0, y1, z0, z1, col) => [
  { c: col, p: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] },
  { c: col, k: 0.75, p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
  { c: col, k: 0.6, p: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]] },
  { c: col, k: 0.6, p: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
  { c: col, k: 0.7, p: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]] },
];
const PLANE_MODELS = {
  shahed: [
    { c: "#d9d2bf", p: [[0, 0.1, 3.4], [3, 0.1, -1.9], [-3, 0.1, -1.9]] },
    { c: "#a9a290", k: 0.7, p: [[0, -0.12, 3.4], [3, -0.12, -1.9], [-3, -0.12, -1.9]] },
    { c: "#cfc8b4", p: [[0, 0.1, 3.4], [0.45, 0.1, -1.9], [-0.45, 0.1, -1.9]] },
    ...box3(-0.38, 0.38, -0.1, 0.5, -1.2, 2.6, "#e8e2d0"),
    { c: "#2f6fd6", p: [[-0.36, 0.52, 2.6], [0.36, 0.52, 2.6], [0.3, 0.4, 3.5], [-0.3, 0.4, 3.5]] },
    { c: "#1d1f22", k: 1, p: [[-0.3, 0.4, 3.0], [0.3, 0.4, 3.0], [0.33, 0.5, 3.1], [-0.33, 0.5, 3.1]] },
    { c: "#9b9482", k: 0.8, p: [[3, 0.1, -1.9], [3.15, 0.1, -1.4], [3.15, 1.1, -1.9], [3, 1.1, -2.2]] },
    { c: "#9b9482", k: 0.8, p: [[-3, 0.1, -1.9], [-3.15, 0.1, -1.4], [-3.15, 1.1, -1.9], [-3, 1.1, -2.2]] },
    ...box3(-0.3, 0.3, -0.05, 0.4, -1.8, -1.2, "#3a3d42"),
  ],
  bayraktar: [
    ...box3(-0.32, 0.32, -0.25, 0.4, -2.4, 2.6, "#cfd3d8"),
    { c: "#e4e7ea", p: [[-0.3, 0.41, 0.4], [0.3, 0.41, 0.4], [0.2, 0.5, 2.4], [-0.2, 0.5, 2.4]] },
    { c: "#2b3036", p: [[-0.2, -0.2, 2.7], [0.2, -0.2, 2.7], [0.25, 0.1, 2.6], [-0.25, 0.1, 2.6]] },
    { c: "#b8bec6", p: [[-0.25, 0.28, 0.9], [-5.4, 0.28, 0.2], [-5.4, 0.28, -0.4], [-0.25, 0.28, -0.4]] },
    { c: "#b8bec6", p: [[0.25, 0.28, 0.9], [5.4, 0.28, 0.2], [5.4, 0.28, -0.4], [0.25, 0.28, -0.4]] },
    { c: "#8d949c", k: 1, p: [[-0.25, 0.26, -0.4], [-5.4, 0.26, -0.4], [-5.4, 0.26, -0.55], [-0.25, 0.26, -0.55]] },
    { c: "#8d949c", k: 1, p: [[0.25, 0.26, -0.4], [5.4, 0.26, -0.4], [5.4, 0.26, -0.55], [0.25, 0.26, -0.55]] },
    { c: "#a2a9b1", k: 0.85, p: [[-0.2, 0.0, -2.4], [-0.2, 0.0, -3.9], [-1.4, 1.4, -4.3], [-1.4, 1.4, -3.7]] },
    { c: "#a2a9b1", k: 0.85, p: [[0.2, 0.0, -2.4], [0.2, 0.0, -3.9], [1.4, 1.4, -4.3], [1.4, 1.4, -3.7]] },
    { c: "#c23b32", p: [[-0.9, 1.0, -4.0], [-0.7, 1.2, -4.0], [-0.7, 1.2, -3.9], [-0.9, 1.0, -3.9]] },
    { c: "#2b3036", p: [[-0.5, -0.25, -0.2], [-0.5, -0.7, -0.2], [-0.4, -0.7, -0.1], [-0.4, -0.25, -0.1]] },
    { c: "#2b3036", p: [[0.5, -0.25, -0.2], [0.5, -0.7, -0.2], [0.4, -0.7, -0.1], [0.4, -0.25, -0.1]] },
  ],
};

export default function DroneGame({ city, targetName, model = "quad", onClose }) {
  const MODEL = DRONE_MODELS[model] || DRONE_MODELS.quad;
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState("brief"); // brief | play | end
  const [banner, setBanner] = useState("");
  const [round, setRound] = useState(0);
  const [result, setResult] = useState(false);
  const [video, setVideo] = useState(null); // { blob, mime, ext }
  const [shareMsg, setShareMsg] = useState("");
  const phaseRef = useRef("brief");
  const closedRef = useRef(false);
  const stateRef = useRef(null);
  const autoRef = useRef(false);
  const thumbRef = useRef(null);
  const autoSaveRef = useRef(false);
  const [sharing, setSharing] = useState(false);
  const seedRef = useRef(Math.floor(Math.random() * 99999));
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
    const C = buildCity((city?.key || city?.name || "city") + ":" + seedRef.current, cityName);
    const { items, boxes, target } = C;
    const S = {
      p: { x: 0, y: 16, z: -120 }, yaw: 0, vel: { x: 0, y: 0, z: 0 }, lean: 0, leanF: 0,
      t: 0, parts: [], flash: 0, shake: 0, spin: 0,
      ptr: new Map(), keys: {},
      cam: { x: 0, y: 22, z: -140, yaw: 0, pitch: 0.4 },
      mode: "brief", // brief | fly | slow | burn
      timeScale: 1, slowT: 0, expT: 0, impactPos: null, cine: null, hitBox: null, result: false,
      exploded: false, doneShown: false, track: [], frames: [], replayTrack: null, rep: null, shown: false, dur: 0, rt: 0, pendingHit: null,
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
      if (b.door === face) {
        const d0 = lerp3(0.4, 0.5), d1 = lerp3(0.6, 0.5), d2 = lerp3(0.6, 1), d3 = lerp3(0.4, 1);
        ctx.fillStyle = "#6b4423"; ctx.beginPath(); ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d2[0], d2[1]); ctx.lineTo(d3[0], d3[1]); ctx.closePath(); ctx.fill();
      }
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (b.door === face && j === rows - 1 && Math.abs((i + 0.5) / cols - 0.5) < 0.2) continue;
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
      if (cy0 > y1 && !b.noTop) fillWorld([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], b.burnt ? fogCol([42, 30, 26], 1, dist) : fogCol(b.rgb, 1.15, dist));
      if (cx0 < x0) drawFace(b, 1, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 0.62, dist, z1 - z0, y1 - y0);
      else if (cx0 > x1) drawFace(b, 2, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 0.62, dist, z1 - z0, y1 - y0);
      if (cz0 < z0) drawFace(b, 3, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], 0.86, dist, x1 - x0, y1 - y0);
      else if (cz0 > z1) drawFace(b, 4, [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], 0.86, dist, x1 - x0, y1 - y0);
    };

    const drawTree = (t, dist) => {
      const p = toCam(t.cx, 0, t.cz);
      if (p[2] < NEAR) return;
      const s2 = (FOCAL / p[2]) * t.s;
      const [sx, sy] = scr(p);
      ctx.fillStyle = fogCol([110, 74, 40], 1, dist); ctx.fillRect(sx - s2 * 0.35, sy - s2 * 2, s2 * 0.7, s2 * 2);
      if (t.pine) {
        const col = fogCol([34, 120, 62], 1, dist);
        ctx.fillStyle = col;
        for (let i = 0; i < 3; i++) {
          const yy = sy - s2 * (1.6 + i * 1.5), ww = s2 * (2.3 - i * 0.55);
          ctx.beginPath(); ctx.moveTo(sx, yy - s2 * 2); ctx.lineTo(sx - ww, yy + s2 * 0.4); ctx.lineTo(sx + ww, yy + s2 * 0.4); ctx.closePath(); ctx.fill();
        }
        return;
      }
      ctx.fillStyle = fogCol(hexRgb(t.c), 1, dist); ctx.beginPath(); ctx.arc(sx, sy - s2 * 3.4, s2 * 2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.beginPath(); ctx.arc(sx - s2 * 0.6, sy - s2 * 4, s2 * 0.9, 0, 6.2832); ctx.fill();
    };

    const drawLamp = (l, dist) => {
      const a = toCam(l.cx, 0, l.cz), b = toCam(l.cx, 6.8, l.cz);
      if (a[2] < NEAR || b[2] < NEAR) return;
      const A = scr(a), B = scr(b);
      const w = Math.max(1, (FOCAL / a[2]) * 0.22);
      ctx.strokeStyle = fogCol([60, 66, 72], 1, dist); ctx.lineWidth = w; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      const c = toCam(l.cx + l.arm * 1.6, 6.8, l.cz);
      if (c[2] > NEAR) {
        const C2 = scr(c);
        ctx.beginPath(); ctx.moveTo(B[0], B[1]); ctx.lineTo(C2[0], C2[1]); ctx.stroke();
        ctx.fillStyle = fogCol([255, 238, 170], 1, dist); ctx.beginPath(); ctx.ellipse(C2[0], C2[1] + w, w * 2.2, w * 1.1, 0, 0, 6.2832); ctx.fill();
      }
    };

    // двосхилий дах: усі грані з перевіркою напрямку до камери
    const drawRoof = (r, dist) => {
      const { x0, x1, z0, z1, y0, h: top } = r;
      const oz = r.axis === "z" ? 0.3 : 0.6, ox = r.axis === "z" ? 0.6 : 0.3;
      const X0 = x0 - ox, X1 = x1 + ox, Z0 = z0 - oz, Z1 = z1 + oz;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      let faces;
      if (r.axis === "z") {
        faces = [
          { p: [[X0, y0, Z0], [X0, y0, Z1], [cx, top, Z1], [cx, top, Z0]], roof: true },
          { p: [[X1, y0, Z1], [X1, y0, Z0], [cx, top, Z0], [cx, top, Z1]], roof: true },
          { p: [[x0, y0, z0], [x1, y0, z0], [cx, top, z0]], roof: false },
          { p: [[x1, y0, z1], [x0, y0, z1], [cx, top, z1]], roof: false },
        ];
      } else {
        faces = [
          { p: [[X0, y0, Z0], [X1, y0, Z0], [X1, top, cz], [X0, top, cz]], roof: true },
          { p: [[X1, y0, Z1], [X0, y0, Z1], [X0, top, cz], [X1, top, cz]], roof: true },
          { p: [[x0, y0, z0], [x0, y0, z1], [x0, top, cz]], roof: false },
          { p: [[x1, y0, z1], [x1, y0, z0], [x1, top, cz]], roof: false },
        ];
      }
      const cen = [cx, y0, cz];
      for (const f of faces) {
        const [p0, p1, p2] = f.p;
        let n = [(p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]), (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]), (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])];
        const mx = f.p.reduce((a, q) => a + q[0], 0) / f.p.length, my = f.p.reduce((a, q) => a + q[1], 0) / f.p.length, mz = f.p.reduce((a, q) => a + q[2], 0) / f.p.length;
        if (n[0] * (mx - cen[0]) + n[1] * (my - cen[1]) + n[2] * (mz - cen[2]) < 0) n = [-n[0], -n[1], -n[2]];
        if (n[0] * (cx0 - mx) + n[1] * (cy0 - my) + n[2] * (cz0 - mz) <= 0) continue;
        const len = Math.hypot(n[0], n[1], n[2]) || 1;
        const k = f.roof ? 0.72 + 0.3 * Math.max(0, n[1] / len) : 0.88;
        fillWorld(f.p, fogCol(f.roof ? r.rgb : r.wall, k, dist));
      }
    };

    // текстура таблички малюється один раз; потім накладається на 3D-площину шматками (афінно по клітинках)
    const signTex = (() => {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 224;
      const g = c.getContext("2d");
      g.fillStyle = "#1f7a45"; g.fillRect(0, 0, 512, 224);
      g.strokeStyle = "#fff"; g.lineWidth = 8; g.strokeRect(14, 14, 484, 196);
      g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "600 34px sans-serif"; g.fillText("ВІТАЄМО У МІСТІ", 256, 56);
      let fs = 120;
      g.font = `800 ${fs}px sans-serif`;
      while (g.measureText(cityName).width > 440 && fs > 24) { fs -= 4; g.font = `800 ${fs}px sans-serif`; }
      g.fillText(cityName, 256, 135);
      return c;
    })();

    const drawSign = (sg, dist) => {
      const b = { ...sg, win: false, burnt: 0, t: false, id: sg.id };
      drawBox(b, dist);
      if (cz0 >= sg.z0 || dist > 260) return;
      const N = 8, M = 3;
      const W = signTex.width, H = signTex.height;
      const pt = (u, v) => toCam(sg.x0 + (sg.x1 - sg.x0) * u, sg.h - (sg.h - sg.y0) * v, sg.z0 - 0.02);
      const grid = [];
      for (let j = 0; j <= M; j++) { const row = []; for (let i = 0; i <= N; i++) row.push(pt(i / N, j / M)); grid.push(row); }
      for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
          const tl = grid[j][i], tr = grid[j][i + 1], bl = grid[j + 1][i];
          if (tl[2] < NEAR || tr[2] < NEAR || bl[2] < NEAR || grid[j + 1][i + 1][2] < NEAR) continue;
          const A = scr(tl), B = scr(tr), Cc = scr(bl);
          const sx = (W / N) * i, sy = (H / M) * j, sw = W / N, sh = H / M;
          ctx.save();
          ctx.transform((B[0] - A[0]) / sw, (B[1] - A[1]) / sw, (Cc[0] - A[0]) / sh, (Cc[1] - A[1]) / sh, A[0], A[1]);
          ctx.drawImage(signTex, sx, sy, sw, sh, -0.4, -0.4, sw + 0.8, sh + 0.8);
          ctx.restore();
        }
      }
    };

    const drawPlane = () => {
      const poly = PLANE_MODELS[model];
      const sy_ = Math.sin(S.yaw), cy_ = Math.cos(S.yaw), rl = S.lean * 0.5, sr = Math.sin(rl), cr = Math.cos(rl);
      const sc3 = model === "bayraktar" ? 0.6 : 0.75;
      const out = [];
      for (const f of poly) {
        const pts = [];
        let ok = true, dsum = 0;
        for (const q of f.p) {
          // крен навколо осі польоту, потім поворот за курсом
          const x1 = q[0] * cr - q[1] * sr, y1 = q[0] * sr + q[1] * cr, z1 = q[2];
          const wx = S.p.x + (x1 * cy_ + z1 * sy_) * sc3, wz = S.p.z + (-x1 * sy_ + z1 * cy_) * sc3, wy = S.p.y + y1 * sc3;
          const c = toCam(wx, wy, wz);
          if (c[2] < NEAR) { ok = false; break; }
          pts.push(scr(c)); dsum += c[2];
        }
        if (ok) out.push({ f, pts, d: dsum / pts.length });
      }
      out.sort((a, b) => b.d - a.d);
      const g = toCam(S.p.x, 0.05, S.p.z);
      if (g[2] > NEAR) { const [gx, gy] = scr(g); const w = (FOCAL / g[2]) * 5; ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(gx, gy, w * 0.5, w * 0.12, 0, 0, 6.2832); ctx.fill(); }
      for (const o of out) {
        ctx.fillStyle = o.f.k && o.f.k < 1 ? shadeHex(o.f.c, o.f.k) : o.f.c;
        ctx.strokeStyle = "rgba(20,22,26,0.55)"; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(o.pts[0][0], o.pts[0][1]);
        for (let i = 1; i < o.pts.length; i++) ctx.lineTo(o.pts[i][0], o.pts[i][1]);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    };

    const drawDrone = (dist) => {
      if (PLANE_MODELS[model]) { drawPlane(); return; }
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

    const sample = (fr, t) => {
      if (t <= fr[0].t) return fr[0];
      for (let i = 1; i < fr.length; i++) {
        if (fr[i].t >= t) {
          const a = fr[i - 1], b = fr[i], u = (t - a.t) / (b.t - a.t || 1), L = (k) => a[k] + (b[k] - a[k]) * u;
          return { x: L("x"), y: L("y"), z: L("z"), vx: L("vx"), vy: L("vy"), vz: L("vz"), yaw: L("yaw"), lean: L("lean"), leanF: L("leanF") };
        }
      }
      return fr[fr.length - 1];
    };
    const applyFrame = (f) => { S.p.x = f.x; S.p.y = f.y; S.p.z = f.z; S.vel.x = f.vx; S.vel.y = f.vy; S.vel.z = f.vz; S.yaw = f.yaw; S.lean = f.lean; S.leanF = f.leanF; };
    // чи є пряма видимість між двома точками (без будівель на шляху)
    const clearLine = (a, b) => {
      const n = Math.max(4, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 2));
      for (let i = 1; i < n; i++) {
        const u = i / n, x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, z = a.z + (b.z - a.z) * u;
        for (const bx of boxes) if (x > bx.x0 - 0.3 && x < bx.x1 + 0.3 && z > bx.z0 - 0.3 && z < bx.z1 + 0.3 && y < bx.h + 0.3) return false;
      }
      return true;
    };
    // найкраща точка камери: поза будівлями, з видом на весь шлях дрона до удару, збоку від напрямку польоту
    const pickCam = (fr) => {
      const last = fr[fr.length - 1], first = fr[0], mid = fr[Math.floor(fr.length / 2)];
      const hv = Math.hypot(last.vx, last.vz) || 1;
      const dir = { x: last.vx / hv, z: last.vz / hv };
      const pts = [first, mid, last, { x: last.x, y: Math.max(2, last.y - 2), z: last.z }];
      let best = null, bestScore = -1e9;
      for (let ai = 0; ai < 16; ai++) {
        const ang = (ai / 16) * Math.PI * 2;
        for (const dist of [28, 38, 50]) {
          for (const hgt of [6, 12, 20]) {
            const c = { x: last.x + Math.sin(ang) * dist, y: Math.max(3, last.y + hgt), z: last.z + Math.cos(ang) * dist };
            if (c.x < -BOUNDS.x || c.x > BOUNDS.x || c.z < BOUNDS.zMin) continue;
            if (hitTest(c.x, c.y, c.z) || c.y < 3) continue;
            let sc = 0;
            for (const q of pts) sc += clearLine(c, q) ? 10 : -4;
            const side = Math.abs(Math.sin(ang) * dir.z - Math.cos(ang) * dir.x); // 1 = строго збоку
            sc += side * 6 - dist * 0.02 - hgt * 0.03;
            if (sc > bestScore) { bestScore = sc; best = c; }
          }
        }
      }
      return best || { x: last.x - dir.x * 26, y: last.y + 14, z: last.z - dir.z * 26 };
    };
    const explode = (h) => {
      S.exploded = true; S.expT = S.t; S.impactPos = { ...S.p }; S.flash = 1; S.shake = 1;
      S.hitBox = h.ground ? null : h;
      S.result = !!h.t;
      if (!h.ground) h.burnt = 1;
      emitBurst(S.p, 90);
    };
    const burnTick = (dtS) => {
      if (S.hitBox) {
        emitFire(S.hitBox);
        for (const b of boxes) if (!b.burnt && Math.abs(b.cx - S.hitBox.cx) < 42 && Math.abs(b.cz - S.hitBox.cz) < 42 && Math.random() < dtS * 0.5) b.burnt = 1;
      } else emitBurst({ x: S.impactPos.x, y: 1, z: S.impactPos.z }, 1);
      for (const b of boxes) if (b.burnt && b !== S.hitBox && Math.random() < 0.18) emitFire(b);
    };
    const aimCam = (focus, dtR) => {
      const c = S.cine.pos;
      S.cam.x = c.x; S.cam.y = c.y; S.cam.z = c.z;
      const l = lookAt(S.cam, focus);
      const k = 1 - Math.exp(-dtR * 5);
      S.cam.yaw = angLerp(S.cam.yaw, l.yaw, k);
      S.cam.pitch += (l.pitch - S.cam.pitch) * k;
    };
    const angLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
    const lookAt = (from, to) => {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)) };
    };

    const camByShot = (sh, dtR, R) => {
      if (sh.fixed) { aimCam(S.p, dtR); return; }
      const p = S.p, fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
      let pos;
      if (sh.type === "chase") pos = { x: p.x - fx * 15, y: p.y + 7.5, z: p.z - fz * 15 };
      else if (sh.type === "high") pos = { x: p.x - fx * 8, y: p.y + 40, z: p.z - fz * 8 };
      else if (sh.type === "front") pos = { x: p.x + fx * 24, y: p.y + 4, z: p.z + fz * 24 };
      else { const a = S.yaw + Math.PI + (R.rt - sh.a) * 0.6; pos = { x: p.x + Math.sin(a) * 24, y: p.y + 9, z: p.z + Math.cos(a) * 24 }; }
      const h = hitTest(pos.x, pos.y, pos.z);
      if (h && !h.ground) pos.y = h.h + 4;
      pos.y = Math.max(2.5, pos.y);
      S.cam.x = pos.x; S.cam.y = pos.y; S.cam.z = pos.z;
      if (sh.type === "chase") { S.cam.yaw = S.yaw; S.cam.pitch = 0.3; }
      else { const l = lookAt(pos, { x: p.x, y: p.y + 1, z: p.z }); S.cam.yaw = l.yaw; S.cam.pitch = l.pitch; }
    };

    // ---- запис відео повтору (canvas → MediaRecorder) ----
    let rec = null, chunks = [], recMime = "";
    const startRec = () => {
      rec = null;
      try {
        if (!canvas.captureStream || typeof window.MediaRecorder === "undefined") return;
        const mts = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
        recMime = mts.find((m) => window.MediaRecorder.isTypeSupported(m)) || "";
        if (!recMime) return;
        rec = new window.MediaRecorder(canvas.captureStream(30), { mimeType: recMime, videoBitsPerSecond: 2000000 });
        chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          const mime = recMime.split(";")[0];
          if (!discard && chunks.length) setVideo({ blob: new Blob(chunks, { type: mime }), mime, ext: mime.includes("mp4") ? "mp4" : "webm" });
          else if (!discard) setVideo(null);
        };
        rec.start(250);
      } catch (e) { rec = null; }
    };
    let discard = false;
    const stopRec = (drop) => { discard = !!drop; try { if (rec && rec.state !== "inactive") rec.stop(); } catch (e) { /* ok */ } rec = null; };

    const finishReplay = () => {
      try { canvas.toBlob((bl) => { thumbRef.current = bl; }, "image/jpeg", 0.8); } catch (e) { thumbRef.current = null; }
      stopRec(false);
      S.mode = "burn"; S.timeScale = 1; S.rep = null;
      setPh("replayEnd");
    };
    S.startReplay = () => {
      const tr = S.replayTrack;
      if (!tr || tr.length < 4) return;
      const t1 = tr[tr.length - 1].t;
      const D = Math.min(15, t1 - tr[0].t);
      const t0 = t1 - D;
      const body = Math.max(0.5, D - 1.5);
      const n = Math.max(1, Math.round(body / 3));
      const types = ["chase", "side", "high", "front", "orbit", "side", "chase"];
      const shots = [];
      for (let i = 0; i < n; i++) {
        const a = (body * i) / n, b = (body * (i + 1)) / n;
        let type = types[i % types.length];
        const sh = { a, b, type, fixed: false };
        if (type === "side") {
          const slice = tr.filter((f) => f.t >= t0 + a && f.t <= t0 + b);
          if (slice.length >= 2) { sh.fixed = true; sh.pos = pickCam(slice); } else sh.type = "chase";
        }
        shots.push(sh);
      }
      shots.push({ a: body, b: D + 5, type: "final", fixed: true, pos: pickCam(S.frames) });
      for (const b of boxes) b.burnt = 0;
      S.parts = []; S.exploded = false; S.hitBox = null; S.impactPos = null; S.flash = 0; S.shake = 0;
      S.rep = { tr, t0, D, rt: 0, shots, cur: null, cutT: 0, ended: false, age: 0 };
      S.mode = "replay"; S.timeScale = 1;
      setBanner("");
      startRec();
    };
    S.stopReplay = () => {
      stopRec(true);
      S.mode = "burn"; S.timeScale = 1; S.rep = null;
      setPh("result");
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
        const tvx = (fx * -my + rx * mx) * SPEED * MODEL.speed, tvz = (fz * -my + rz * mx) * SPEED * MODEL.speed, tvy = -ly * VSPEED;
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
        // історія кадрів (останні ~1 с) для відмотки часу
        S.track.push({ t: S.t, x: S.p.x, y: S.p.y, z: S.p.z, vx: S.vel.x, vy: S.vel.y, vz: S.vel.z, yaw: S.yaw, lean: S.lean, leanF: S.leanF });
        while (S.track.length > 2 && S.t - S.track[0].t > 16.5) S.track.shift();
        // справжнє зіткнення → відмотка назад і повтор у слоу-мо
        const hit = hitTest(S.p.x, S.p.y, S.p.z);
        if (hit && S.track.length > 4) {
          S.pendingHit = hit;
          const tEnd = S.track[S.track.length - 1].t;
          S.frames = S.track.filter((f) => f.t >= tEnd - 0.9);
          S.replayTrack = S.track.slice();
          S.dur = S.frames[S.frames.length - 1].t - S.frames[0].t;
          S.rt = S.dur; S.mode = "rewind"; S.timeScale = 1; S.cine = { pos: pickCam(S.frames) };
        }
        if (S.t > 150 && S.mode === "fly") { S.mode = "burn"; S.exploded = false; S.result = false; S.expT = S.t; S.timeoutEnd = true; setBanner("Зв'язок із дроном втрачено"); }
      } else if (ph === "replay") {
        const R = S.rep;
        const remain = R.D - R.rt;
        let ts = 1;
        if (!R.ended) ts = remain > 1.5 ? 1 : 0.3 + 0.7 * Math.max(0, (remain - 1.2) / 0.3);
        else ts = 0.3 + 0.7 * Math.min(1, Math.max(0, (R.age - 3.2) / 1.2));
        S.timeScale = ts;
        if (!R.ended) {
          R.rt = Math.min(R.D, R.rt + dtReal * ts);
          applyFrame(sample(R.tr, R.t0 + R.rt));
          const shot = R.shots.find((x) => R.rt >= x.a && R.rt < x.b) || R.shots[R.shots.length - 1];
          if (shot !== R.cur) {
            R.cur = shot; R.cutT = S.t;
            if (shot.fixed) { S.cine = { pos: shot.pos }; const l = lookAt(shot.pos, S.p); S.cam.yaw = l.yaw; S.cam.pitch = l.pitch; }
          }
          camByShot(shot, dtReal, R);
          if (R.rt >= R.D) { explode(S.pendingHit); R.ended = true; R.age = 0; }
        } else {
          R.age += dtReal;
          S.flash = Math.max(0, S.flash - dtReal * 1.6); S.shake = Math.max(0, S.shake - dtReal * 1.2);
          aimCam({ x: S.impactPos.x, y: S.impactPos.y + 6, z: S.impactPos.z }, dtReal);
          burnTick(dtReal * ts);
          if (R.age > 6.2) finishReplay();
        }
      } else if (ph === "rewind") {
        // відмотка: швидко назад по записаних кадрах
        S.rt = Math.max(0, S.rt - dtReal * 2.4);
        const f = sample(S.frames, S.frames[0].t + S.rt);
        applyFrame(f);
        aimCam(S.p, dtReal);
        if (S.rt <= 0) {
          S.mode = "slow"; S.slowT = S.t; S.timeScale = 0.3; S.rt = 0;
        }
      } else if (ph === "slow" || ph === "burn") {
        if (ph === "slow" && !S.exploded) {
          S.rt = Math.min(S.dur, S.rt + dt);
          applyFrame(sample(S.frames, S.frames[0].t + S.rt));
          const h = S.rt >= S.dur ? S.pendingHit : null;
          if (h) {
            explode(h);
            setBanner(h.t ? "ДРОН ВЛУЧИВ У ЦІЛЬ" : "ДРОН НЕ ВЛУЧИВ У ЦІЛЬ");
          }
        }
        // камера стоїть на місці, лише плавно повертається слідом за дроном
        if (S.cine) aimCam(S.exploded ? { x: S.impactPos.x, y: S.impactPos.y + 6, z: S.impactPos.z } : S.p, dtReal);
        if (S.exploded) {
          const ee = S.t - S.expT;
          S.flash = Math.max(0, S.flash - dtReal * 1.6); S.shake = Math.max(0, S.shake - dtReal * 1.2);
          if (ee > 1.4 && S.timeScale < 1) S.timeScale = Math.min(1, S.timeScale + dtReal * 1.2);
          burnTick(dt);
          if (ee > 5.6 && !S.shown) { S.shown = true; setResult(S.result); setBanner(""); setPh("result"); }
        } else if (S.timeoutEnd && S.t - S.expT > 2 && !S.shown) { S.shown = true; setResult(false); setBanner(""); setPh("result"); }
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
      // тротуари вздовж проспекту, перехрестя, потім суцільний проспект поверх них
      for (const pk of C.parks) {
        if (Math.abs(pk.z - cz0) > 260) continue;
        road(pk.x - 11, pk.x + 11, pk.z - 11, pk.z + 11, "#74b85f");
        road(pk.x - 1, pk.x + 1, pk.z - 11, pk.z + 11, "#c9c2a4");
        road(pk.x - 11, pk.x + 11, pk.z - 1, pk.z + 1, "#c9c2a4");
      }
      // провулки в передмісті
      for (const lz of C.lanes) {
        road(10, 120, lz - 3, lz + 3, "#4a4e51"); road(-120, -10, lz - 3, lz + 3, "#4a4e51");
        road(10, 120, lz - 4.4, lz - 3, "#9a9d98"); road(10, 120, lz + 3, lz + 4.4, "#9a9d98");
        road(-120, -10, lz - 4.4, lz - 3, "#9a9d98"); road(-120, -10, lz + 3, lz + 4.4, "#9a9d98");
      }
      road(-14, -10, -230, C.zEnd + 20, "#8d9290");
      road(10, 14, -230, C.zEnd + 20, "#8d9290");
      for (let z = C.zStart - 13; z <= C.zEnd; z += C.cell) road(-148, 148, z - 3.5, z + 3.5, "#3d4144");
      for (let x = -143; x <= 143; x += C.cell) if (Math.abs(x) > 14) road(x - 3.5, x + 3.5, C.zStart - 13, C.zEnd, "#3d4144");
      road(-10, 10, -260, C.zEnd + 20, "#33373a");
      // розмітка: суцільні лінії по краях, пунктир між смугами й посередині
      road(-9.6, -9.2, -260, C.zEnd + 20, "#e8e8e8");
      road(9.2, 9.6, -260, C.zEnd + 20, "#e8e8e8");
      // пішохідні переходи на перехрестях біля камери
      for (let rc = C.zStart - 13; rc <= C.zEnd; rc += C.cell) {
        if (Math.abs(rc - cz0) > 150) continue;
        for (let x = -8.4; x <= 8.4; x += 2.1) road(x - 0.45, x + 0.45, rc - 6.2, rc - 3.9, "#ececec");
      }
      const dz0 = Math.floor((cz0 - 60) / 12) * 12;
      for (let z = dz0; z < dz0 + 360; z += 12) {
        if (z < -260 || z > C.zEnd + 20) continue;
        road(-0.3, 0.3, z, z + 6, "#f4f4f4");
        road(-5.15, -4.85, z, z + 4, "#d8d8d8");
        road(4.85, 5.15, z, z + 4, "#d8d8d8");
      }
      // підсвітка зони цілі (зелений квадрат навколо): допомагає знайти
      winBudget = 900;
      // упорядкування: дальні першими
      const dr = [];
      for (const it of items) {
        const dx = it.cx - cx0, dz = it.cz - cz0, dy = (it.cy || 0) - cy0;
        const d2 = dx * dx + dz * dz + dy * dy;
        const far = it.far || 640;
        if (d2 > far * far) continue;
        const pz = dx * fX + dz * fZ;
        if (pz < -45) continue;
        dr.push({ it, d2: d2 - (it.ly || 0) * 60 });
      }
      dr.push({ it: { type: "drone" }, d2: (S.p.x - cx0) ** 2 + (S.p.z - cz0) ** 2 + (S.p.y - cy0) ** 2 });
      dr.sort((a, b) => b.d2 - a.d2);
      // вікна найближчим: рахуємо в зворотному порядку не будемо; бюджет лишаємо першим-бо-далеким → нижчий дистанцій. Тому ліміт по відстані 150
      for (const { it, d2 } of dr) {
        const dist = Math.sqrt(Math.max(0, d2));
        if (it.type === "box") drawBox(it, dist);
        else if (it.type === "tree") drawTree(it, dist);
        else if (it.type === "lamp") drawLamp(it, dist);
        else if (it.type === "roof") drawRoof(it, dist);
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
        if (p.kind === 2) { ctx.fillStyle = `rgba(55,55,60,${0.55 * (1 - u)})`; ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, base * (2 + u * 3.2)), 0, 6.2832); ctx.fill(); }
        else {
          ctx.fillStyle = u < 0.35 ? `rgba(255,${Math.round(220 - u * 250)},70,${0.95 - u * 0.6})` : `rgba(235,${Math.round(100 - u * 50)},25,${0.9 * (1 - u)})`;
          ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, base * (p.kind === 0 ? 1 : 1.7 - u * 0.9)), 0, 6.2832); ctx.fill();
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
      if (S.mode === "replay" && S.rep) {
        const R = S.rep;
        const ct = S.t - R.cutT;
        if (ct < 0.18) { ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - ct / 0.18)})`; ctx.fillRect(0, 0, Wd, Hd); }
        ctx.fillStyle = "#ff3b30"; if (Math.floor(S.t * 2) % 2 === 0) { ctx.beginPath(); ctx.arc(22, 26, 6, 0, 6.2832); ctx.fill(); }
        ctx.fillStyle = "#fff"; ctx.font = "bold 14px monospace"; ctx.textAlign = "left"; ctx.fillText("ПОВТОР", 36, 31);
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, Hd - 54, Wd, 54);
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "800 15px sans-serif"; ctx.fillText("WORLD CLICKER · УДАР ДРОНОМ", Wd / 2, Hd - 32);
        ctx.font = "600 13px sans-serif"; ctx.fillStyle = "#ffd9a0"; ctx.fillText(cityName, Wd / 2, Hd - 14);
        if (R.ended) {
          ctx.font = "900 26px sans-serif"; ctx.textAlign = "center";
          ctx.fillStyle = S.result ? "#ffb347" : "#ff6a5c"; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 5;
          const txt = S.result ? "ДРОН ВЛУЧИВ У ЦІЛЬ" : "ДРОН НЕ ВЛУЧИВ У ЦІЛЬ";
          ctx.strokeText(txt, Wd / 2, 96); ctx.fillText(txt, Wd / 2, 96);
        }
      }
      if (S.mode === "rewind") {
        ctx.fillStyle = "rgba(70,110,255,0.16)"; ctx.fillRect(0, 0, Wd, Hd);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        for (let y = (S.t * 300) % 6; y < Hd; y += 6) ctx.fillRect(0, y, Wd, 2);
        ctx.fillStyle = "#fff"; ctx.font = "bold 18px monospace"; ctx.textAlign = "center"; ctx.fillText("◀◀ ПЕРЕМОТКА", Wd / 2, 100);
      }
      if (S.timeScale < 0.9 && S.mode !== "brief" && S.mode !== "rewind") {
        ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = "bold 13px monospace"; ctx.textAlign = "right"; ctx.fillText("СЛОУ-МО ▶", Wd - 56, 30);
      }
    };
    raf = requestAnimationFrame(frame);

    // старт польоту
    S.start = () => { S.mode = "fly"; S.yaw = 0; };
    stateRef.current = S;
    if (autoRef.current) { autoRef.current = false; S.start(); }

    const pos = (e) => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onDown = (e) => {
      if (S.mode !== "fly") return;
      if (e.target && e.target.closest && e.target.closest("button")) return;
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
      dead = true; cancelAnimationFrame(raf); stopRec(true);
      window.removeEventListener("resize", resize);
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, round]);

  useEffect(() => {
    if (video && autoSaveRef.current) { autoSaveRef.current = false; saveVideo(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video]);

  const btn = { padding: "12px 22px", borderRadius: 12, border: "none", fontWeight: 800, fontSize: 15, color: "#fff", background: "linear-gradient(180deg,#3b8cff,#1f64d6)", boxShadow: "0 4px 0 #14439a", cursor: "pointer" };
  const btn2 = { ...btn, background: "linear-gradient(180deg,#667,#445)", boxShadow: "0 4px 0 #223" };
  const btnG = { ...btn, background: "linear-gradient(180deg,#3fc25a,#1f9a3c)", boxShadow: "0 4px 0 #136b28" };

  const retry = () => {
    autoRef.current = true;
    setBanner(""); setResult(false); setVideo(null); setShareMsg("");
    setPh("play"); setRound((r) => r + 1);
  };
  const startReplay = () => { setShareMsg(""); setVideo(null); setPh("replay"); if (stateRef.current) stateRef.current.startReplay(); };
  const GAME_TAG = "@worldclicker_bot";
  const shareText = `🚁 Мій удар дроном по місту ${city?.name || ""}${targetName ? " (" + targetName + ")" : ""} у World Clicker! ${result ? "🎯 Влучив у ціль — місто у вогні 🔥" : "💥 Не влучив у ціль, але було видовищно!"}\nГрай у ${GAME_TAG}`;
  const SB_URL = "https://zrpwgavfploiaqrqpcvv.supabase.co";
  const SB_KEY = "sb_publishable_Kp13ZD0NtWypUYegahB35g_X2nOWmzn";
  const apiPost = async (payload) => {
    const r = await fetch("/api/drone-share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, initData: window.Telegram?.WebApp?.initData || "" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Помилка сервера");
    return j;
  };
  const uploadSigned = async (path, token, blob, mime) => {
    const fd = new window.FormData();
    fd.append("cacheControl", "3600");
    fd.append("", blob);
    const r = await fetch(`${SB_URL}/storage/v1/object/upload/sign/drone-replays/${path}?token=${encodeURIComponent(token)}`, {
      method: "PUT", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "x-upsert": "true" }, body: fd,
    });
    if (!r.ok) throw new Error("Не вдалося завантажити відео");
    void mime;
  };
  const saveVideo = async () => {
    if (!video || sharing) return;
    setShareMsg("");
    const tg = window.Telegram && window.Telegram.WebApp;
    // у Telegram звичайне завантаження з сторінки часто заблоковане: даємо Telegram публічне посилання, і він сам зберігає файл
    if (tg && tg.initData && typeof tg.downloadFile === "function") {
      setSharing(true); setShareMsg("Готуємо файл…");
      try {
        const init = await apiPost({ action: "init", mime: video.mime });
        await uploadSigned(init.path, init.token, video.blob, video.mime);
        setSharing(false); setShareMsg("");
        tg.downloadFile({ url: init.url, file_name: `drone-strike.${video.ext}` }, (ok) => setShareMsg(ok ? "Відео збережено ✓" : ""));
        return;
      } catch (e) { setSharing(false); setShareMsg(""); }
    }
    try {
      const url = URL.createObjectURL(video.blob);
      const a = document.createElement("a");
      a.href = url; a.download = `drone-strike.${video.ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      setShareMsg("Відео збережено на пристрій.");
    } catch (e) { setShareMsg("Не вдалося зберегти відео на цьому пристрої."); }
  };
  // «Завантажити відео» після удару: якщо повтор ще не записаний — запускаємо його (відео записується під час перегляду)
  const downloadFromResult = () => {
    if (video) { saveVideo(); return; }
    autoSaveRef.current = true;
    startReplay();
  };
  const shareVideo = async () => {
    if (sharing) return;
    setShareMsg("");
    const tg = window.Telegram && window.Telegram.WebApp;
    // 1) у Telegram: відео вантажиться на сервер, і бот створює повідомлення з відео для вибору чату
    if (video && tg && tg.initData) {
      setSharing(true); setShareMsg("Готуємо відео до відправки…");
      try {
        const init = await apiPost({ action: "init", mime: video.mime });
        await uploadSigned(init.path, init.token, video.blob, video.mime);
        const thumb = thumbRef.current || new Blob([], { type: "image/jpeg" });
        await uploadSigned(init.thumbPath, init.thumbToken, thumb, "image/jpeg");
        const r = await apiPost({ action: "send", path: init.path, thumbPath: init.thumbPath, caption: shareText });
        setSharing(false);
        if (r.preparedId && tg.shareMessage) {
          setShareMsg("");
          tg.shareMessage(r.preparedId, (ok) => { if (ok) setShareMsg("Відео надіслано ✓"); });
          return;
        }
        setShareMsg("Відео надіслано тобі в чат з ботом — перешли його друзям.");
        return;
      } catch (e) {
        setSharing(false);
        setShareMsg(String(e && e.message ? e.message : "Не вдалося надіслати відео"));
      }
    }
    // 2) поза Telegram: системне меню «Поділитися» з файлом
    if (video) {
      try {
        const file = new window.File([video.blob], `drone-strike.${video.ext}`, { type: video.mime });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: shareText, title: "World Clicker — удар дроном" });
          return;
        }
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    // 3) запасний шлях: Telegram з текстом (відео можна зберегти кнопкою)
    const u = `https://t.me/share/url?url=&text=${encodeURIComponent(shareText)}`;
    if (tg && tg.openTelegramLink) tg.openTelegramLink(u); else window.open(u, "_blank");
    if (video) setShareMsg("Відео напряму надіслати не вдалося: збережи його кнопкою «Зберегти відео» і додай до повідомлення.");
  };
  const onX = () => {
    if (phase === "replay") { if (stateRef.current) stateRef.current.stopReplay(); return; }
    finish(phase === "result" || phase === "replayEnd" ? result : false);
  };
  const panel = { position: "absolute", left: 0, right: 0, bottom: 0, padding: "22px 18px 26px", background: "linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.78) 28%)", textAlign: "center", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 };

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#000", touchAction: "none", userSelect: "none", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <button type="button" aria-label="Закрити" onClick={onX} style={{ position: "absolute", top: 10, right: 10, width: 38, height: 38, borderRadius: 19, border: "none", background: "rgba(0,0,0,.55)", color: "#fff", fontSize: 18, cursor: "pointer", zIndex: 2 }}>✕</button>
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
      {banner && phase === "play" && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 70, textAlign: "center", pointerEvents: "none" }}>
          <div style={{ display: "inline-block", fontSize: 24, fontWeight: 900, color: banner.includes("НЕ ВЛУЧИВ") || banner.includes("втрачено") ? "#ff6a5c" : "#ffb347", textShadow: "0 2px 8px rgba(0,0,0,.8)" }}>{banner}</div>
        </div>
      )}
      {phase === "result" && (
        <div style={panel}>
          <div style={{ fontSize: 26, fontWeight: 900, color: result ? "#ffb347" : "#ff6a5c", textShadow: "0 2px 8px rgba(0,0,0,.8)" }}>{result ? "🎯 ДРОН ВЛУЧИВ У ЦІЛЬ" : "💥 ДРОН НЕ ВЛУЧИВ У ЦІЛЬ"}</div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>{result ? `Місто ${city?.name || ""} у вогні` : "Спробуй ще раз — цілься в червону будівлю"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 4 }}>
            <button type="button" style={btn} onClick={retry}>Атакувати ще раз</button>
            <button type="button" style={btnG} onClick={startReplay}>🎬 Повтор і поділитися</button>
            <button type="button" style={btn} onClick={downloadFromResult} disabled={sharing}>⬇ Завантажити відео</button>
            <button type="button" style={btn2} onClick={() => finish(result)}>В меню</button>
          </div>
        </div>
      )}
      {phase === "replayEnd" && (
        <div style={panel}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>🎬 Повтор готовий</div>
          <div style={{ fontSize: 13, opacity: 0.85, maxWidth: 320 }}>{video ? "Останні секунди польоту з різних ракурсів і слоу-мо удару." : "Цей пристрій не записує відео, але можна поділитися описом."}</div>
          {shareMsg && <div style={{ fontSize: 12, color: "#ffd9a0", maxWidth: 320 }}>{shareMsg}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
            <button type="button" style={btnG} onClick={shareVideo} disabled={sharing}>{sharing ? "Надсилаємо…" : "📤 Поділитися відео"}</button>
            {video && <button type="button" style={btn} onClick={saveVideo}>Зберегти відео</button>}
            <button type="button" style={btn} onClick={startReplay}>Ще раз</button>
            <button type="button" style={btn2} onClick={() => setPh("result")}>Назад</button>
          </div>
        </div>
      )}
    </div>
  );
}
