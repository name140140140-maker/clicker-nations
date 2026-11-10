import React, { useEffect, useRef, useState } from "react";
import { createRecorder, shareReplay, saveReplay, GAME_TAG } from "./replayShare.js";

/* «Замах»: вид від першого обличчя з даху. Взяти гвинтівку → піти на позицію →
   дочекатися вигаданого лідера → влучити. Чистий canvas, без залежностей.
   Світ — вокселі, люди — намальовані спрайти. Усі персонажі вигадані. */

const NEAR = 0.3;
const GY = -22; // рівень землі (дах — y=0)
const ST = GY + 0.4; // сцена
const ZOOM_MIN = 3, ZOOM_MAX = 10, ZOOM_DEF = 6;
const SKY_H = [196, 222, 246];
const RX = 38; // центр даху зі снайпером (праворуч від площі)
const PODIUM = { x: 8, z: 77.6 };
const DOOR = { x: 8, z: 99 };
const SPOT = { x: RX - 8, z: 8.1 };
const CRATE = { x: RX - 5, z: -1 };
const CAR0 = { x: 24, z: 92 };
const BULLET_DUR = 2.8;
const NCROWD = 120;
const LST = ["hidden", "in", "speech", "startle", "flee", "board", "car", "out", "down", "gone"];

const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hexRgb = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const shadeHex = (c, k) => { const [r, g, b] = hexRgb(c); const m = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, "0"); return "#" + m(r) + m(g) + m(b); };
const lookAt = (p, t) => ({ yaw: Math.atan2(t.x - p.x, t.z - p.z), pitch: Math.atan2(t.y - p.y, Math.hypot(t.x - p.x, t.z - p.z)) });
const ease = (t) => t * t * (3 - 2 * t);

function flagColors(color, name) {
  const h = hashStr(String(name || "x"));
  const base = /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#" + ((h & 0xffffff) | 0x404040).toString(16).slice(-6).padStart(6, "4");
  const pal = ["#f2f2f2", "#1b3f8f", "#d8b300", "#1f8f4a", "#c8281e", "#202020"];
  const a = pal[h % pal.length], b = pal[(h >> 3) % pal.length];
  return [base, a === base ? "#f2f2f2" : a, b === a ? "#202020" : b];
}

function buildWorld(rnd, fc) {
  const S = [];
  const box = (x0, x1, y0, y1, z0, z1, c, o = {}) => { S.push({ x0, x1, y0, y1, z0, z1, c, ...o }); return S[S.length - 1]; };
  // земля, дах, площа, дороги
  box(-400, 400, GY - 2, GY, -60, 520, "#7f8b86", { layer: 0 });
  box(-45, 66, GY, GY + 0.01, 40, 98, "#8e9692", { layer: 0 });
  box(-45, 66, GY, GY + 0.015, 36, 40, "#a29f94", { layer: 0 });
  box(-400, 400, GY, GY + 0.02, 22, 34, "#3b3f44", { layer: 0 });
  box(-400, 400, GY, GY + 0.04, 34, 36, "#b9b6ab", { layer: 0 });
  box(-400, 400, GY, GY + 0.04, 18, 22, "#b9b6ab", { layer: 0 });
  for (let i = 0; i < 40; i++) box(-396 + i * 20, -390 + i * 20, GY + 0.025, GY + 0.03, 27.8, 28.2, "#e8e4c8", { layer: 0 });
  box(RX - 14, RX + 14, -0.6, 0, -10, 10, "#8f969c", { layer: 0 });
  box(-1, 17, GY + 0.012, GY + 0.02, 40, 68, "#a9aaa4", { layer: 0 });
  box(-45, 66, GY + 0.012, GY + 0.02, 52, 54, "#a9aaa4", { layer: 0 });
  // дах: парапет
  box(RX - 14, RX + 14, 0, 0.5, 9.7, 10, "#b9bec4");
  box(RX - 14, RX - 13, 0, 0.9, -10, 10, "#b9bec4");
  box(RX + 13, RX + 14, 0, 0.9, -10, 10, "#b9bec4");
  box(RX - 14, RX + 14, 0, 0.9, -10, -9, "#b9bec4");
  // дах: обладнання
  box(RX + 8, RX + 12.4, 0, 2.7, -9, -5.4, "#a9aeb4"); box(RX + 7.8, RX + 12.6, 2.7, 3, -9.2, -5.2, "#7c8086");
  box(RX + 9, RX + 10.7, 0, 2.0, -5.45, -5.38, "#3a3f46");
  box(RX - 10, RX - 6, 3.1, 5.6, -8.5, -5, "#7e8a94"); box(RX - 10.2, RX - 5.8, 5.6, 6.1, -8.7, -4.8, "#59636c");
  for (const [px, pz] of [[-9.8, -8.3], [-6.3, -8.3], [-9.8, -5.2], [-6.3, -5.2]]) box(RX + px, RX + px + 0.25, 0, 3.1, pz, pz + 0.25, "#4a4f55");
  for (let i = 0; i < 3; i++) { box(RX - 4 + i * 3, RX - 1.6 + i * 3, 0, 1.15, -9, -7.6, "#c9ccd0"); box(RX - 3.8 + i * 3, RX - 1.8 + i * 3, 1.15, 1.25, -8.9, -7.7, "#555a60"); box(RX - 3.4 + i * 3, RX - 2.2 + i * 3, 0.4, 0.9, -7.62, -7.58, "#3c4046"); }
  box(RX + 1, RX + 1.18, 0, 8, -8, -7.82, "#8b9097"); box(RX - 0.6, RX + 2.8, 6.2, 6.3, -8, -7.9, "#8b9097"); box(RX - 0.3, RX + 2.5, 7.1, 7.2, -8, -7.9, "#8b9097"); box(RX + 0.95, RX + 1.23, 8, 8.4, -8.03, -7.8, "#d92b2b");
  for (let i = 0; i < 3; i++) box(RX - 12 + i * 3.1, RX - 9.2 + i * 3.1, 0, 0.5, 2.5, 4.2, "#2c4a7c");
  box(RX + 2, RX + 6, 0, 0.35, -3, 0, "#9fd0e8"); box(RX + 1.8, RX + 6.2, 0, 0.18, -3.2, 0.2, "#5d6368");
  box(RX + 8, RX + 8.15, 0, 2.2, 1, 1.15, "#555"); box(RX + 6.8, RX + 9.6, 2.2, 2.5, 0, 2.2, "#c93b3b");
  box(RX + 7.3, RX + 8.1, 0, 0.5, 3, 3.8, "#e6e0d0"); box(RX + 8.5, RX + 9.3, 0, 0.5, 3, 3.8, "#e6e0d0");
  for (const [px, pz] of [[-12, 4], [-12, -2], [12, 4], [12, 7], [-5, -9.4], [5, -9.4]]) { box(RX + px - 0.4, RX + px + 0.4, 0, 0.5, pz - 0.4, pz + 0.4, "#8a5a3a"); box(RX + px - 0.5, RX + px + 0.5, 0.5, 1.2, pz - 0.5, pz + 0.5, "#3f9a3c"); box(RX + px - 0.3, RX + px + 0.3, 1.2, 1.7, pz - 0.3, pz + 0.3, "#52b04c"); }
  box(RX - 13, RX + 13, 0.0, 0.12, -9, -8.88, "#2b2e33");
  // сусідні нижчі будівлі та їхні дахи
  const nb = (x0, x1, z0, z1, top, tone) => { box(x0, x1, GY, top, z0, z1, tone, { win: true }); box(x0 + 1, x0 + 3.4, top, top + 1, z0 + 1, z0 + 2.6, "#c9ccd0"); box(x1 - 3, x1 - 2.8, top, top + 3.5, z1 - 2, z1 - 1.8, "#8b9097"); };
  nb(RX - 38, RX - 16, -12, 14, -5, "#a9a396"); nb(RX + 16, RX + 40, -14, 12, -8, "#9fa8b2"); nb(RX - 60, RX - 40, -8, 16, -11, "#b3aa9b");
  nb(RX - 30, RX - 18, 16, 30, -9, "#a4aab2");
  // міські будівлі довкола
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const w = 14 + rnd() * 16, d = 14 + rnd() * 16, h = 14 + rnd() * 34;
    const x = side > 0 ? 78 + rnd() * 80 : -62 - rnd() * 80, z = 40 + (i / 26) * 190 + rnd() * 20;
    const tone = ["#9aa7b4", "#b3aa9b", "#8e9aa6", "#a9b0b8", "#c2b9a6"][(rnd() * 5) | 0];
    box(x - w / 2, x + w / 2, GY, GY + h, z, z + d, tone, { win: true });
    box(x - w / 4, x, GY + h, GY + h + 1.2, z + 2, z + 4, "#c4c8cc");
    if (rnd() < 0.5) box(x + w / 4, x + w / 4 + 0.2, GY + h, GY + h + 6, z + 3, z + 3.2, "#8b9097");
  }
  for (let i = 0; i < 9; i++) { const w = 18 + rnd() * 20, h = 24 + rnd() * 46, x = -150 + i * 38 + rnd() * 10; box(x, x + w, GY, GY + h, 150 + rnd() * 90, 175 + rnd() * 90, "#a4afbb", { win: true }); }
  for (let i = 0; i < 7; i++) { const x = -120 + i * 45 + rnd() * 20, z = 150 + rnd() * 120, y = 50 + rnd() * 25; box(x, x + 26, y, y + 4, z, z + 9, "#ffffff", { layer: 0, cloud: true }); box(x + 5, x + 20, y + 4, y + 7, z + 1, z + 7, "#f4f8fc", { layer: 0, cloud: true }); }
  // урядова будівля
  box(-22, 38, GY, GY + 30, 100, 130, "#d4d6d8", { win: true });
  box(-24, 40, GY + 29, GY + 32, 98, 132, "#c2c5c8");
  box(-12, 28, GY + 32, GY + 34.5, 104, 124, "#bfc3c7"); box(2, 14, GY + 34.5, GY + 40, 108, 116, "#cfd2d6"); box(7.9, 8.1, GY + 40, GY + 46, 112, 112.2, "#8b9097");
  for (let i = 0; i < 9; i++) { const x = -18 + i * 7; box(x, x + 1.6, GY, GY + 26, 98.4, 100, "#e9eaec"); }
  for (let i = 0; i < 4; i++) box(-22, 38, GY + i * 0.4, GY + (i + 1) * 0.4, 94 + i * 1.3, 100, "#c9cbcd");
  box(DOOR.x - 2, DOOR.x + 2, GY, GY + 4.4, 99.9, 100.2, "#2b2f36", { door: true });
  [-11, 3, 17, 31].forEach((x) => { box(x, x + 3.2, GY + 8, GY + 20, 98.0, 98.2, fc[0]); box(x, x + 3.2, GY + 8, GY + 12, 97.95, 98.0, fc[1]); box(x, x + 3.2, GY + 12, GY + 16, 97.95, 98.0, fc[2]); });
  // сцена, килим, трибуна
  box(2, 14, GY, ST, 68, 87, "#a9aeb3", { layer: 0 });
  box(4, 12, ST, ST + 0.02, 68, 87, "#b31f24", { layer: 0 });
  box(5, 11, GY, GY + 0.2, 66, 68, "#b31f24", { layer: 0 });
  box(5, 11, GY + 0.2, GY + 0.4, 67, 68, "#b31f24", { layer: 0 });
  box(PODIUM.x - 0.65, PODIUM.x + 0.65, ST, ST + 1.15, PODIUM.z - 0.35, PODIUM.z + 0.35, "#2c3552", { cover: true });
  box(PODIUM.x - 0.25, PODIUM.x + 0.25, ST + 0.55, ST + 0.95, PODIUM.z - 0.37, PODIUM.z - 0.35, "#e3b72b");
  box(PODIUM.x - 0.1, PODIUM.x + 0.1, ST + 1.15, ST + 1.35, PODIUM.z - 0.1, PODIUM.z + 0.1, "#202225");
  [PODIUM.x - 4, PODIUM.x + 4].forEach((x) => { box(x - 0.2, x + 0.2, ST, ST + 0.9, PODIUM.z + 5, PODIUM.z + 5.4, "#7b5a3b"); box(x - 0.15, x + 0.15, ST + 0.9, ST + 1.1, PODIUM.z + 5.02, PODIUM.z + 5.38, "#3c9a42"); });
  [-2, 18, 30].forEach((x) => {
    box(x, x + 0.2, GY, GY + 11, 90, 90.2, "#c9ccd0");
    box(x + 0.2, x + 3.6, GY + 8, GY + 9.4, 90.05, 90.1, fc[0], { flag: 0 });
    box(x + 0.2, x + 3.6, GY + 9.4, GY + 10.8, 90.05, 90.1, fc[1], { flag: 1 });
    box(x + 0.2, x + 3.6, GY + 10.8, GY + 12.2, 90.05, 90.1, fc[2], { flag: 2 });
  });
  for (let i = 0; i < 18; i++) box(-15 + i * 2.2, -13.6 + i * 2.2, GY, GY + 1.1, 66.5, 66.8, "#7e858c");
  // рослинність
  const tree = (x, z, s, kind) => {
    if (kind === 1) {
      box(x - 0.22 * s, x + 0.22 * s, GY, GY + 1.5 * s, z - 0.22 * s, z + 0.22 * s, "#5a3d24");
      for (let i = 0; i < 4; i++) { const w = (2.2 - i * 0.5) * s; box(x - w / 2, x + w / 2, GY + (1.2 + i * 1.05) * s, GY + (2.2 + i * 1.05) * s, z - w / 2, z + w / 2, i % 2 ? "#2f7a3a" : "#2a6d34"); }
    } else {
      const g = ["#3f9a3c", "#4aa845", "#3a8f38", "#5ab34f", "#6bb94a"][(rnd() * 5) | 0];
      box(x - 0.25 * s, x + 0.25 * s, GY, GY + 2.4 * s, z - 0.25 * s, z + 0.25 * s, kind === 2 ? "#d9d5c6" : "#6b4a2b");
      box(x - 1.6 * s, x + 1.6 * s, GY + 2.2 * s, GY + 3.6 * s, z - 1.6 * s, z + 1.6 * s, g);
      box(x - 1.15 * s, x + 1.15 * s, GY + 3.6 * s, GY + 4.8 * s, z - 1.15 * s, z + 1.15 * s, shadeHex(g, 1.1));
      box(x - 0.6 * s, x + 0.6 * s, GY + 4.8 * s, GY + 5.4 * s, z - 0.6 * s, z + 0.6 * s, shadeHex(g, 1.2));
    }
  };
  const bush = (x, z, s) => { const g = ["#3f8f3a", "#4fa545", "#2f7a35"][(rnd() * 3) | 0]; box(x - 0.8 * s, x + 0.8 * s, GY, GY + 0.8 * s, z - 0.7 * s, z + 0.7 * s, g); box(x - 0.55 * s, x + 0.55 * s, GY + 0.8 * s, GY + 1.2 * s, z - 0.5 * s, z + 0.5 * s, shadeHex(g, 1.15)); };
  for (let i = 0; i < 34; i++) {
    let x = -42 + rnd() * 106, z = 38 + rnd() * 58;
    if (x > -3 && x < 18 && z > 40 && z < 96) x += x > 7 ? 15 : -15;
    if (x > 18 && x < 28 && z > 86 && z < 98) continue;
    tree(x, z, 0.85 + rnd() * 0.6, i % 5 === 0 ? 1 : i % 7 === 0 ? 2 : 0);
  }
  for (let i = 0; i < 16; i++) tree(-60 + i * 9, 20.5, 0.9 + rnd() * 0.3, i % 4 === 0 ? 1 : 0);
  for (let i = 0; i < 40; i++) { const x = -42 + rnd() * 106, z = 38 + rnd() * 58; if (x > 0 && x < 16 && z > 40 && z < 90) continue; bush(x, z, 0.7 + rnd() * 0.7); }
  for (let i = 0; i < 12; i++) bush(-8 + i * 2.4, 88.5, 0.9);
  for (let i = 0; i < 12; i++) bush(-14 + i * 4.4, 66, 0.55);
  for (let k = 0; k < 4; k++) { const bx = [-18, 20, 30, 40][k], bz = [74, 74, 62, 78][k]; box(bx - 2, bx + 2, GY, GY + 0.35, bz - 1.2, bz + 1.2, "#6b4a2b"); for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) box(bx - 1.8 + i * 0.65, bx - 1.45 + i * 0.65, GY + 0.35, GY + 0.6 + rnd() * 0.2, bz - 1 + j * 0.8, bz - 0.7 + j * 0.8, ["#e63a4a", "#f2c94c", "#f08ab4", "#ffffff", "#9b6bd6"][(i + j + k) % 5]); }
  const lamp = (x, z) => { box(x, x + 0.18, GY, GY + 5, z, z + 0.18, "#2e3238"); box(x - 0.5, x + 0.2, GY + 4.9, GY + 5.05, z, z + 0.18, "#2e3238"); box(x - 0.8, x - 0.3, GY + 4.75, GY + 5, z - 0.12, z + 0.3, "#fff3c2"); };
  for (let i = 0; i < 9; i++) lamp(-40 + i * 12, 38.5);
  for (let i = 0; i < 5; i++) lamp(-20 + i * 14, 60);
  [-4, 20].forEach((x) => { lamp(x, 66); lamp(x, 50); });
  for (let i = 0; i < 7; i++) lamp(-44 + i * 18, 17.5);
  const bench = (x, z) => { box(x, x + 1.8, GY + 0.45, GY + 0.55, z, z + 0.5, "#8a5a3a"); box(x, x + 1.8, GY + 0.55, GY + 1, z - 0.05, z + 0.05, "#7a4a2a"); box(x + 0.1, x + 0.2, GY, GY + 0.45, z + 0.05, z + 0.15, "#444"); box(x + 1.6, x + 1.7, GY, GY + 0.45, z + 0.05, z + 0.15, "#444"); };
  [[-30, 56], [-12, 56], [28, 56], [44, 56], [-30, 84], [40, 84], [-18, 44], [50, 46]].forEach(([x, z]) => bench(x, z));
  [[-28, 56.2], [-10, 56.2], [30, 56.2], [42, 38]].forEach(([x, z]) => { box(x, x + 0.5, GY, GY + 0.85, z, z + 0.5, "#3d5c46"); box(x - 0.05, x + 0.55, GY + 0.85, GY + 0.95, z - 0.05, z + 0.55, "#2b3a30"); });
  for (let i = 0; i < 30; i++) box(-44 + i * 3.7, -43.8 + i * 3.7, GY, GY + 0.6, 36.3, 36.5, "#c9c5b3");
  { const fx = -22, fz = 62; box(fx - 4, fx + 4, GY, GY + 0.8, fz - 4, fz - 3.4, "#b8bcc0"); box(fx - 4, fx + 4, GY, GY + 0.8, fz + 3.4, fz + 4, "#b8bcc0"); box(fx - 4, fx - 3.4, GY, GY + 0.8, fz - 3.4, fz + 3.4, "#b8bcc0"); box(fx + 3.4, fx + 4, GY, GY + 0.8, fz - 3.4, fz + 3.4, "#b8bcc0"); box(fx - 3.4, fx + 3.4, GY, GY + 0.6, fz - 3.4, fz + 3.4, "#4fa4e0"); box(fx - 0.4, fx + 0.4, GY, GY + 2.2, fz - 0.4, fz + 0.4, "#c9cdd0"); box(fx - 1.3, fx + 1.3, GY + 2.2, GY + 2.5, fz - 1.3, fz + 1.3, "#b8bcc0"); box(fx - 0.15, fx + 0.15, GY + 2.5, GY + 4, fz - 0.15, fz + 0.15, "#bfe6ff"); }
  { const mx = 40, mz = 64; box(mx - 1.6, mx + 1.6, GY, GY + 0.5, mz - 1.6, mz + 1.6, "#9ea3a8"); box(mx - 1.1, mx + 1.1, GY + 0.5, GY + 1.2, mz - 1.1, mz + 1.1, "#b3b8bd"); box(mx - 0.5, mx + 0.5, GY + 1.2, GY + 5.5, mz - 0.5, mz + 0.5, "#c9cdd0"); box(mx - 0.3, mx + 0.3, GY + 5.5, GY + 6.2, mz - 0.3, mz + 0.3, "#d8b300"); }
  for (const x of [-4, 40]) { box(x, x + 0.2, GY, GY + 4.5, 17, 17.2, "#444"); box(x - 0.15, x + 0.35, GY + 3.4, GY + 4.9, 16.9, 17.1, "#222"); box(x - 0.05, x + 0.25, GY + 4.4, GY + 4.7, 16.85, 16.9, "#e53935"); box(x - 0.05, x + 0.25, GY + 3.95, GY + 4.25, 16.85, 16.9, "#fdd835"); box(x - 0.05, x + 0.25, GY + 3.5, GY + 3.8, 16.85, 16.9, "#43a047"); }
  const pcar = (x, z, c) => { box(x, x + 4.4, GY + 0.3, GY + 1.2, z, z + 1.9, c); box(x + 1, x + 3.2, GY + 1.2, GY + 1.9, z + 0.1, z + 1.8, "#6a7a8c"); box(x + 0.3, x + 1, GY, GY + 0.45, z - 0.05, z + 0.3, "#111"); box(x + 3.3, x + 4, GY, GY + 0.45, z - 0.05, z + 0.3, "#111"); box(x + 0.3, x + 1, GY, GY + 0.45, z + 1.6, z + 1.95, "#111"); box(x + 3.3, x + 4, GY, GY + 0.45, z + 1.6, z + 1.95, "#111"); };
  [[-40, 30.3, "#2b2f36"], [-12, 30.3, "#c7c9cc"], [14, 30.3, "#a02b2b"], [46, 30.3, "#2f6fd6"], [64, 30.3, "#e1b52f"]].forEach(([x, z, c]) => pcar(x, z, c));
  return S;
}

export default function SniperGame({ country = "", color = "", onClose }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const apiRef = useRef({});
  const closedRef = useRef(false);
  const phaseRef = useRef("brief");
  const thumbRef = useRef(null);
  const autoSaveRef = useRef(false);
  const [phase, setPhase] = useState("brief"); // brief | play | end | replay | replayEnd
  const [hud, setHud] = useState({ obj: "", bullets: 3, near: false, scope: false, bullet: false });
  const [zoomUI, setZoomUI] = useState(ZOOM_DEF);
  const [res, setRes] = useState(null);
  const [round, setRound] = useState(0);
  const [video, setVideo] = useState(null);
  const [shareMsg, setShareMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const setPh = (p) => { phaseRef.current = p; setPhase(p); };
  const finish = (ok) => { if (closedRef.current) return; closedRef.current = true; onClose(ok); };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let W = 360, H = 640;
    const resize = () => { W = wrap.clientWidth || 360; H = wrap.clientHeight || 640; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    window.addEventListener("resize", resize);

    const rnd = mulberry(Math.floor(Math.random() * 99999) + round * 7919);
    const fc = flagColors(color, country);
    const statics = buildWorld(rnd, fc);
    for (const b of statics) { b.cx = (b.x0 + b.x1) / 2; b.cy = (b.y0 + b.y1) / 2; b.cz = (b.z0 + b.z1) / 2; b.r = Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0) / 2; }
    const recorder = createRecorder(canvas);

    // ---------- люди ----------
    const SKINS = ["#f0c8a8", "#e0b48f", "#c68e63", "#8d5a3a", "#6b4429"];
    const TOPS = ["#5d7ca8", "#b05a4e", "#59896a", "#7e6aa8", "#c9b45a", "#3f4650", "#d0d0d0", "#d4764a", "#4a8fa8", "#8a4a6b", "#2f5d3a", "#e8e0c8"];
    const PANTS = ["#3a4150", "#2b3340", "#5a4a3a", "#44505f", "#6b6f78", "#25272c"];
    const HAIRS = ["#2a1d14", "#5b3a22", "#9b7a3a", "#1d1d1d", "#b8b0a0", "#7a3b1e"];
    const crowd = [];
    for (let i = 0; i < NCROWD; i++) {
      const gx = i % 12, gz = (i / 12) | 0;
      const woman = rnd() < 0.42;
      crowd.push({ x: -22 + gx * 4.6 + (rnd() - 0.5) * 2.4, z: 44 + gz * 2.2 + (rnd() - 0.5) * 1.2, ph: rnd() * 6.28, sc: rnd() < 0.08 ? 0.72 : 0.93 + rnd() * 0.13, skin: SKINS[(rnd() * 5) | 0], top: TOPS[(rnd() * TOPS.length) | 0], pants: PANTS[(rnd() * PANTS.length) | 0], hairC: HAIRS[(rnd() * HAIRS.length) | 0], hair: woman ? (rnd() < 0.6 ? 1 : 4) : rnd() < 0.12 ? 2 : rnd() < 0.22 ? 3 : 0, skirt: woman && rnd() < 0.55, m: 0, dir: 1, mt: 0, vx: 0, vz: 0, after: 0 });
    }
    const guards = [];
    [[2.9, 72], [13.1, 72], [3.2, 82], [12.8, 82], [8, 94]].forEach(([x, z], i) => guards.push({ x, z, m: 0, dir: 1, mt: 0, i }));
    const cars = { t1: -30, t2: 70, limo: { x: CAR0.x, z: CAR0.z, go: false, v: 0 } };

    const S = {
      mode: "walk", // walk | scope | bullet | replay
      p: { x: RX, z: -6 }, yaw: -0.25, pitch: -0.1,
      hasRifle: false, bullets: 3, shotCd: 0, scopeYaw: 0, scopePitch: -0.3,
      ptr: new Map(), keys: {}, t: 0, rt: 0, ts: 1,
      zoom: ZOOM_DEF,
      spawnAt: 16 + rnd() * 4, rifleT: -1, misses: 0, panic: 0,
      L: { st: "hidden", x: DOOR.x, z: DOOR.z, t: 0, dur: 16 + rnd() * 8, ph: rnd() * 6, dir: 1, crouch: 0, gest: false, caut: 0, tt: 0 },
      bul: null, parts: [], msgT: 0, msg: "", over: false, kick: 0, endT: 0, result: false, walkBob: 0,
      buf: [], lastSnap: 0, hitRt: 0, shotRt: 0, hitPos: null, R: null, recUntil: 0,
    };
    if (typeof window !== "undefined" && window.__SNIPER_DEBUG) window.__SNIPER_DEBUG.S = S;
    let raf = 0, last = performance.now(), dead = false, hudT = 0, hudKey = "";

    // ---------- камера ----------
    let cx0 = 0, cy0 = 0, cz0 = 0, fX = 0, fZ = 1, rX = 1, rZ = 0, sp = 0, cp = 1, F = 300;
    const cam = { x: RX, y: 1.7, z: -6, yaw: 0, pitch: 0, zoom: 1 };
    const setCam = (c) => { cx0 = c.x; cy0 = c.y; cz0 = c.z; fX = Math.sin(c.yaw); fZ = Math.cos(c.yaw); rX = Math.cos(c.yaw); rZ = -Math.sin(c.yaw); sp = Math.sin(c.pitch); cp = Math.cos(c.pitch); };
    const toCam = (x, y, z) => { const dx = x - cx0, dy = y - cy0, dz = z - cz0; const xr = dx * rX + dz * rZ, zf = dx * fX + dz * fZ; return [xr, dy * cp - zf * sp, dy * sp + zf * cp]; };
    const scr = (p) => [W / 2 + (p[0] * F) / p[2], H / 2 - (p[1] * F) / p[2]];
    const clip = (poly) => {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ina = a[2] >= NEAR, inb = b[2] >= NEAR;
        if (ina) out.push(a);
        if (ina !== inb) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
      }
      return out;
    };
    const shade = (c, k, f) => {
      const [r, g, b] = hexRgb(c);
      const m = (v, fv) => Math.round(Math.max(0, Math.min(255, v * k)) * (1 - f) + fv * f);
      return `rgb(${m(r, SKY_H[0])},${m(g, SKY_H[1])},${m(b, SKY_H[2])})`;
    };
    const poly3 = (pts, col) => {
      const cp3 = clip(pts.map((q) => toCam(q[0], q[1], q[2])));
      if (cp3.length < 3) return;
      ctx.fillStyle = col; ctx.beginPath();
      for (let i = 0; i < cp3.length; i++) { const s = scr(cp3[i]); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }
      ctx.closePath(); ctx.fill();
    };
    const windows = (b, f) => {
      const cols = Math.max(2, Math.floor((b.x1 - b.x0) / 3.2)), rows = Math.max(2, Math.floor((b.y1 - b.y0 - 3) / 3.6));
      const ww = (b.x1 - b.x0) / cols;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const lit = ((i * 7 + j * 13 + ((b.x0 * 3) | 0)) & 7) === 0;
        const xa = b.x0 + i * ww + ww * 0.22, xb = b.x0 + (i + 1) * ww - ww * 0.22;
        const ya = b.y0 + 2.2 + j * 3.6, yb = ya + 1.9;
        poly3([[xa, ya, b.z0 - 0.02], [xb, ya, b.z0 - 0.02], [xb, yb, b.z0 - 0.02], [xa, yb, b.z0 - 0.02]], lit ? shade("#ffe49a", 1, f) : shade("#3d5878", 1, f));
      }
    };
    const drawBox = (b, dist, sway) => {
      const f = Math.min(0.62, dist / 340);
      let { x0, x1, y0, y1, z0, z1 } = b;
      if (sway) { z0 += sway; z1 += sway; }
      const c = b.c;
      if (cy0 > y1) poly3([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], shade(c, 1, f));
      if (cz0 < z0) {
        poly3([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], shade(c, 0.84, f));
        if (b.win && dist < 190) windows(b, f);
      }
      if (cz0 > z1) poly3([[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], shade(c, 0.7, f));
      if (cx0 < x0) poly3([[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], shade(c, 0.66, f));
      if (cx0 > x1) poly3([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], shade(c, 0.76, f));
    };

    // ---------- спрайти людей ----------
    const rrect = (c, x, y, w, h, r) => { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); c.fill(); };
    const drawHuman = (d, sx, sy, Hh) => {
      const c = ctx, u = Hh, sw = d.walk || 0, run = !!d.run;
      c.save();
      c.fillStyle = "rgba(0,0,0,.22)"; c.beginPath(); c.ellipse(sx, sy, u * 0.13, u * 0.025, 0, 0, 6.283); c.fill();
      if (d.down) {
        c.fillStyle = d.pants; rrect(c, sx + u * 0.04, sy - u * 0.075, u * 0.3, u * 0.07, u * 0.03);
        c.fillStyle = d.top; rrect(c, sx - u * 0.2, sy - u * 0.09, u * 0.26, u * 0.09, u * 0.035);
        c.fillStyle = d.skin; c.beginPath(); c.arc(sx - u * 0.26, sy - u * 0.05, u * 0.05, 0, 6.283); c.fill();
        c.fillStyle = d.hairC; c.beginPath(); c.arc(sx - u * 0.275, sy - u * 0.06, u * 0.045, Math.PI * 0.6, Math.PI * 1.7); c.fill();
        c.fillStyle = d.shoes; c.fillRect(sx + u * 0.33, sy - u * 0.06, u * 0.045, u * 0.05);
        c.restore(); return;
      }
      const cr = d.crouch || 0, k = 1 - cr * 0.38;
      const Y = (v) => sy - v * u * k;
      const skin = d.skin, view = d.view, detail = Hh > 24;
      const lw = (w) => { c.lineWidth = Math.max(1, w * u); };
      c.lineCap = "round"; c.lineJoin = "round";
      if (view !== "s") {
        const back = view === "b";
        for (const s of [-1, 1]) {
          const off = Math.sin(sw + (s > 0 ? Math.PI : 0)) * (run ? 0.05 : 0.02);
          const lx = sx + s * 0.048 * u;
          c.strokeStyle = d.skirt ? skin : d.pants; lw(d.skirt ? 0.06 : 0.082);
          c.beginPath(); c.moveTo(lx, Y(d.skirt ? 0.3 : 0.5)); c.lineTo(lx + s * 0.006 * u, Y(0.045 + off)); c.stroke();
          c.fillStyle = d.shoes; c.beginPath(); c.ellipse(lx + s * 0.012 * u, Y(0.02 + off), 0.05 * u, 0.022 * u * k, 0, 0, 6.283); c.fill();
        }
        if (d.skirt) { c.fillStyle = d.pants; c.beginPath(); c.moveTo(sx - 0.11 * u, Y(0.52)); c.lineTo(sx + 0.11 * u, Y(0.52)); c.lineTo(sx + 0.15 * u, Y(0.27)); c.lineTo(sx - 0.15 * u, Y(0.27)); c.closePath(); c.fill(); }
        c.fillStyle = d.top; c.beginPath();
        c.moveTo(sx - 0.152 * u, Y(0.79)); c.quadraticCurveTo(sx - 0.15 * u, Y(0.845), sx - 0.1 * u, Y(0.85)); c.lineTo(sx + 0.1 * u, Y(0.85)); c.quadraticCurveTo(sx + 0.15 * u, Y(0.845), sx + 0.152 * u, Y(0.79));
        c.lineTo(sx + 0.115 * u, Y(0.5)); c.lineTo(sx - 0.115 * u, Y(0.5)); c.closePath(); c.fill();
        if (!back && d.tie) {
          c.fillStyle = "#f2f2f2"; c.beginPath(); c.moveTo(sx - 0.04 * u, Y(0.85)); c.lineTo(sx + 0.04 * u, Y(0.85)); c.lineTo(sx, Y(0.64)); c.closePath(); c.fill();
          c.fillStyle = d.tie; c.beginPath(); c.moveTo(sx - 0.012 * u, Y(0.835)); c.lineTo(sx + 0.012 * u, Y(0.835)); c.lineTo(sx + 0.02 * u, Y(0.68)); c.lineTo(sx, Y(0.64)); c.lineTo(sx - 0.02 * u, Y(0.68)); c.closePath(); c.fill();
          c.strokeStyle = shadeHex(d.top, 0.6); lw(0.01); c.beginPath(); c.moveTo(sx - 0.04 * u, Y(0.85)); c.lineTo(sx - 0.03 * u, Y(0.62)); c.moveTo(sx + 0.04 * u, Y(0.85)); c.lineTo(sx + 0.03 * u, Y(0.62)); c.stroke();
        }
        for (const s of [-1, 1]) {
          const swing = Math.sin(sw + (s > 0 ? 0 : Math.PI)) * (run ? 0.12 : 0.045);
          let ex = s * 0.172, ey = 0.62, hx = s * 0.176, hy = 0.47 + swing;
          if (d.arm && s > 0) { ex = 0.2; ey = 0.69; hx = 0.19; hy = 0.88; }
          if (d.ear && s > 0) { ex = 0.19; ey = 0.8; hx = 0.07; hy = 0.93; }
          if (d.arm2 && s < 0) { ex = -0.19; ey = 0.7; hx = -0.15; hy = 0.82; }
          c.strokeStyle = d.top; lw(0.058); c.beginPath(); c.moveTo(sx + s * 0.145 * u, Y(0.79)); c.lineTo(sx + ex * u, Y(ey)); c.lineTo(sx + hx * u, Y(hy)); c.stroke();
          c.fillStyle = skin; c.beginPath(); c.arc(sx + hx * u, Y(hy - 0.015), 0.028 * u, 0, 6.283); c.fill();
        }
        c.fillStyle = shadeHex(skin, 0.9); c.fillRect(sx - 0.025 * u, Y(0.865), 0.05 * u, 0.04 * u * k);
        const hy0 = Y(0.925);
        c.fillStyle = skin; c.beginPath(); c.ellipse(sx, hy0, 0.056 * u, 0.066 * u, 0, 0, 6.283); c.fill();
        c.beginPath(); c.arc(sx - 0.056 * u, hy0 + 0.005 * u, 0.012 * u, 0, 6.283); c.arc(sx + 0.056 * u, hy0 + 0.005 * u, 0.012 * u, 0, 6.283); c.fill();
        c.fillStyle = d.hairC;
        if (back) { if (d.hair !== 2) { c.beginPath(); c.ellipse(sx, hy0 - 0.004 * u, 0.06 * u, 0.068 * u, 0, 0, 6.283); c.fill(); if (d.hair === 1) c.fillRect(sx - 0.06 * u, hy0, 0.12 * u, 0.1 * u); } }
        else if (d.hair !== 2) {
          c.beginPath(); c.ellipse(sx, hy0 - 0.012 * u, 0.06 * u, 0.058 * u, 0, Math.PI, 0); c.fill();
          if (d.hair === 1) { c.fillRect(sx - 0.062 * u, hy0 - 0.012 * u, 0.014 * u, 0.09 * u); c.fillRect(sx + 0.048 * u, hy0 - 0.012 * u, 0.014 * u, 0.09 * u); }
          if (d.hair === 4) { c.beginPath(); c.arc(sx, hy0 - 0.08 * u, 0.026 * u, 0, 6.283); c.fill(); }
          if (d.hair === 3) { c.fillStyle = d.top; c.beginPath(); c.ellipse(sx, hy0 - 0.02 * u, 0.062 * u, 0.05 * u, 0, Math.PI, 0); c.fill(); c.fillRect(sx - 0.062 * u, hy0 - 0.024 * u, 0.124 * u, 0.012 * u); }
        }
        if (!back && detail) {
          if (d.glasses) { c.fillStyle = "#0d0f12"; c.fillRect(sx - 0.05 * u, hy0 - 0.012 * u, 0.1 * u, 0.02 * u); }
          else { c.fillStyle = "#1a1a1a"; const er = Math.max(0.6, 0.0065 * u); c.beginPath(); c.arc(sx - 0.022 * u, hy0 + 0.002 * u, er, 0, 6.283); c.arc(sx + 0.022 * u, hy0 + 0.002 * u, er, 0, 6.283); c.fill(); }
          if (Hh > 48) { c.strokeStyle = "#8a4a3a"; lw(0.006); c.beginPath(); c.moveTo(sx - 0.016 * u, hy0 + 0.034 * u); c.lineTo(sx + 0.016 * u, hy0 + 0.034 * u); c.stroke(); c.strokeStyle = shadeHex(skin, 0.8); c.beginPath(); c.moveTo(sx, hy0 + 0.008 * u); c.lineTo(sx + 0.006 * u, hy0 + 0.026 * u); c.stroke(); }
        }
      } else {
        const dr = d.dir || 1, lean = run ? 0.18 : 0;
        for (const s of [0, 1]) {
          const a = Math.sin(sw + s * Math.PI) * (run ? 0.26 : 0.14);
          const lift = run ? Math.max(0, Math.cos(sw + s * Math.PI)) * 0.07 : 0;
          const fx = sx + dr * a * u, fy = Y(0.04 + lift);
          c.strokeStyle = s ? shadeHex(d.pants, 0.78) : d.pants; lw(0.08);
          c.beginPath(); c.moveTo(sx, Y(0.5)); c.lineTo(sx + dr * a * 0.5 * u, Y(0.27 + lift * 0.5)); c.lineTo(fx, fy); c.stroke();
          c.fillStyle = d.shoes; c.beginPath(); c.ellipse(fx + dr * 0.022 * u, fy + 0.012 * u * k, 0.05 * u, 0.022 * u * k, 0, 0, 6.283); c.fill();
        }
        if (d.skirt) { c.fillStyle = d.pants; c.beginPath(); c.moveTo(sx - 0.07 * u, Y(0.52)); c.lineTo(sx + 0.07 * u, Y(0.52)); c.lineTo(sx + 0.11 * u, Y(0.27)); c.lineTo(sx - 0.11 * u, Y(0.27)); c.closePath(); c.fill(); }
        c.save(); c.translate(sx, Y(0.5)); c.rotate(dr * lean); c.translate(-sx, -Y(0.5));
        c.fillStyle = d.top; c.beginPath(); c.moveTo(sx - 0.07 * u, Y(0.84)); c.lineTo(sx + 0.07 * u, Y(0.84)); c.lineTo(sx + 0.06 * u, Y(0.5)); c.lineTo(sx - 0.06 * u, Y(0.5)); c.closePath(); c.fill();
        if (d.tie) { c.fillStyle = d.tie; c.fillRect(sx + dr * 0.06 * u - (dr < 0 ? 0.012 * u : 0), Y(0.82), 0.012 * u, 0.15 * u * k); }
        for (const s of [0, 1]) {
          const a = Math.sin(sw + (s ? 0 : Math.PI)) * (run ? 0.17 : 0.1);
          c.strokeStyle = s ? shadeHex(d.top, 0.8) : d.top; lw(0.052);
          const hxp = sx + dr * a * u, hyp = Y(run ? 0.58 : 0.5);
          c.beginPath(); c.moveTo(sx, Y(0.78)); c.lineTo(sx + dr * a * 0.35 * u, Y(0.62)); c.lineTo(hxp, hyp); c.stroke();
          c.fillStyle = skin; c.beginPath(); c.arc(hxp, hyp - 0.012 * u, 0.026 * u, 0, 6.283); c.fill();
        }
        c.fillStyle = shadeHex(skin, 0.9); c.fillRect(sx - 0.02 * u, Y(0.865), 0.04 * u, 0.04 * u * k);
        const hy0 = Y(0.925), hx0 = sx + dr * 0.01 * u;
        c.fillStyle = skin; c.beginPath(); c.ellipse(hx0, hy0, 0.052 * u, 0.066 * u, 0, 0, 6.283); c.fill();
        c.beginPath(); c.moveTo(hx0 + dr * 0.048 * u, hy0 - 0.004 * u); c.lineTo(hx0 + dr * 0.07 * u, hy0 + 0.02 * u); c.lineTo(hx0 + dr * 0.046 * u, hy0 + 0.026 * u); c.closePath(); c.fill();
        c.fillStyle = d.hairC;
        if (d.hair !== 2) {
          c.beginPath(); c.ellipse(hx0 - dr * 0.012 * u, hy0 - 0.01 * u, 0.056 * u, 0.062 * u, 0, 0, 6.283); c.fill();
          c.fillStyle = skin; c.beginPath(); c.ellipse(hx0 + dr * 0.018 * u, hy0 + 0.012 * u, 0.04 * u, 0.05 * u, 0, 0, 6.283); c.fill();
          c.fillStyle = d.hairC; c.beginPath(); c.ellipse(hx0 + dr * 0.0 * u, hy0 - 0.036 * u, 0.05 * u, 0.026 * u, 0, 0, 6.283); c.fill();
          if (d.hair === 1) c.fillRect(hx0 - dr * 0.06 * u - (dr > 0 ? 0.01 * u : 0), hy0 - 0.01 * u, 0.03 * u, 0.09 * u);
          if (d.hair === 4) { c.beginPath(); c.arc(hx0 - dr * 0.05 * u, hy0 - 0.05 * u, 0.026 * u, 0, 6.283); c.fill(); }
          if (d.hair === 3) { c.fillStyle = d.top; c.fillRect(hx0 - 0.05 * u, hy0 - 0.06 * u, 0.1 * u, 0.025 * u); c.fillRect(hx0 + dr * 0.03 * u - (dr < 0 ? 0.045 * u : 0), hy0 - 0.04 * u, 0.045 * u, 0.012 * u); }
        }
        if (detail) { c.fillStyle = "#151515"; c.beginPath(); c.arc(hx0 + dr * 0.03 * u, hy0 + 0.002 * u, Math.max(0.6, 0.0065 * u), 0, 6.283); c.fill(); if (d.glasses) c.fillRect(hx0 + dr * 0.01 * u - (dr < 0 ? 0.03 * u : 0), hy0 - 0.012 * u, 0.04 * u, 0.018 * u); }
        c.restore();
      }
      c.restore();
    };

    // ---------- збір сцени ----------
    const carBoxes = (out, x, z, c, alongZ, len, big) => {
      const w = 1.9, h = big ? 1.25 : 1.1, L2 = len;
      const mk = (x0, x1, y0, y1, z0, z1, col) => out.push({ x0, x1, y0, y1, z0, z1, c: col, tag: "car", cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, r: 1.2 });
      if (alongZ) {
        mk(x - w / 2, x + w / 2, GY + 0.3, GY + 0.3 + h, z - L2 / 2, z + L2 / 2, c);
        mk(x - w / 2 + 0.1, x + w / 2 - 0.1, GY + 0.3 + h, GY + 0.3 + h + 0.7, z - L2 / 2 + 1.1, z + L2 / 2 - 1.3, "#2a3446");
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk(x + (sx * w) / 2 - 0.12, x + (sx * w) / 2 + 0.12, GY, GY + 0.45, z + sz * (L2 / 2 - 0.8) - 0.4, z + sz * (L2 / 2 - 0.8) + 0.4, "#111");
        mk(x - 0.7, x - 0.4, GY + 0.7, GY + 0.95, z - L2 / 2 - 0.03, z - L2 / 2 + 0.05, "#fff4c4"); mk(x + 0.4, x + 0.7, GY + 0.7, GY + 0.95, z - L2 / 2 - 0.03, z - L2 / 2 + 0.05, "#fff4c4");
      } else {
        mk(x - L2 / 2, x + L2 / 2, GY + 0.3, GY + 0.3 + h, z - w / 2, z + w / 2, c);
        mk(x - L2 / 2 + 1.1, x + L2 / 2 - 1.1, GY + 0.3 + h, GY + 0.3 + h + 0.7, z - w / 2 + 0.1, z + w / 2 - 0.1, "#6a7a8c");
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk(x + sx * (L2 / 2 - 0.8) - 0.4, x + sx * (L2 / 2 - 0.8) + 0.4, GY, GY + 0.45, z + (sz * w) / 2 - 0.12, z + (sz * w) / 2 + 0.12, "#111");
      }
    };
    const crowdDesc = (p) => {
      const bob = S.panic > 0 ? Math.abs(Math.sin(S.t * 10 + p.ph)) * 0.02 : 0;
      const d = { kind: "crowd", x: p.x, y: GY + bob, z: p.z, sc: p.sc, skin: p.skin, top: p.top, pants: p.pants, hairC: p.hairC, hair: p.hair, skirt: p.skirt, shoes: "#23252a", view: "b", dir: p.dir, walk: S.t * 2 + p.ph, run: false, crouch: 0 };
      if (p.m === 1) d.view = "f"; else if (p.m === 2) { d.view = "s"; d.dir = 1; } else if (p.m === 3) { d.view = "s"; d.run = true; d.walk = S.t * 14 + p.ph; } else if (p.m === 4) d.crouch = 0.55;
      return d;
    };
    const guardDesc = (g) => {
      const d = { kind: "guard", x: g.x, y: ST, z: g.z, sc: 1.02, skin: "#d8ac88", top: "#14161a", pants: "#14161a", hairC: "#222", hair: 0, glasses: true, shoes: "#0c0c0c", view: "f", dir: 1, walk: 0 };
      if (g.z > 90 || g.z < 66 || g.x > 15 || g.x < 1) d.y = GY;
      if (g.m === 1) { d.view = "s"; d.dir = 1; d.ear = true; } else if (g.m === 2) { d.view = "s"; d.dir = g.dir; d.run = true; d.walk = S.t * 13 + g.i; d.crouch = 0.15; } else d.ear = g.i === 1 && S.misses === 0 && (S.t * 0.12 + 1) % 1 < 0.2;
      return d;
    };
    const leaderDesc = () => {
      const L = S.L;
      if (L.st === "hidden" || L.st === "gone" || L.st === "car" || L.st === "board") return null;
      const onStage = L.x > 2 && L.x < 14 && L.z > 68 && L.z < 87;
      const d = { kind: "leader", x: L.x, y: onStage ? ST : GY, z: L.z, sc: 1.04, skin: "#e8bc96", top: "#1c2a4d", pants: "#1c2a4d", hairC: "#6b6256", hair: 0, tie: fc[0], shoes: "#0c0c0c", view: "f", dir: 1, walk: 0, crouch: L.crouch, arm: false };
      if (L.st === "in") d.walk = S.t * 7;
      else if (L.st === "speech") { d.arm = L.gest; d.arm2 = !L.gest && Math.sin(L.t * 1.1) > 0.7; }
      else if (L.st === "startle") { d.view = L.tt < 1.3 ? "s" : "f"; d.dir = 1; d.arm = L.tt > 1.3; }
      else if (L.st === "flee") { d.view = "s"; d.dir = L.dir; d.run = true; d.walk = S.t * 14; }
      else if (L.st === "out") { d.view = "b"; d.walk = S.t * 6; }
      else if (L.st === "down") d.down = true;
      return d;
    };
    const humans = () => {
      const out = [];
      for (const p of crowd) if (p.m !== 5) out.push(crowdDesc(p));
      for (const g of guards) out.push(guardDesc(g));
      const l = leaderDesc(); if (l) out.push(l);
      return out;
    };
    const dynBoxes = () => {
      const out = [];
      carBoxes(out, ((cars.t1 + 60) % 160) - 60, 25.2, "#d94f3a", false, 4.4);
      carBoxes(out, 90 - ((cars.t2 + 60) % 160), 31.2, "#e8e8ea", false, 4.6);
      carBoxes(out, cars.limo.x, cars.limo.z, "#16181c", true, 5.6, true);
      return out;
    };
    const hitVolumes = () => {
      const out = dynBoxes();
      for (const d of humans()) {
        if (d.down) { out.push({ x0: d.x - 1.0, x1: d.x + 0.4, y0: d.y, y1: d.y + 0.4, z0: d.z - 0.4, z1: d.z + 0.4, tag: "body" }); continue; }
        const s = d.sc * (1 - (d.crouch || 0) * 0.38);
        out.push({ x0: d.x - 0.17, x1: d.x + 0.17, y0: d.y + 1.52 * s, y1: d.y + 1.86 * s, z0: d.z - 0.17, z1: d.z + 0.17, tag: d.kind === "leader" ? "head" : d.kind });
        out.push({ x0: d.x - 0.27, x1: d.x + 0.27, y0: d.y, y1: d.y + 1.52 * s, z0: d.z - 0.22, z1: d.z + 0.22, tag: d.kind === "leader" ? "body" : d.kind });
      }
      return out;
    };

    // ---------- постріл ----------
    const rayDir = (yaw, pit) => ({ x: Math.sin(yaw) * Math.cos(pit), y: Math.sin(pit), z: Math.cos(yaw) * Math.cos(pit) });
    const shoot = (dyaw, dpitch) => {
      const o = { x: SPOT.x, y: 1.7, z: SPOT.z }, dd = rayDir(S.scopeYaw + dyaw, S.scopePitch + dpitch);
      const vols = hitVolumes();
      const solid = statics.filter((b) => b.layer === undefined);
      for (let t = 1; t < 200; t += 0.2) {
        const x = o.x + dd.x * t, y = o.y + dd.y * t, z = o.z + dd.z * t;
        if (y < GY + 0.02) return { tag: "ground", x, y, z, t, o, dd };
        for (const b of vols) if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return { tag: b.tag, x, y, z, t, o, dd };
        for (const b of solid) if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return { tag: b.cover ? "cover" : "wall", x, y, z, t, o, dd };
      }
      return { tag: "none", x: o.x + dd.x * 200, y: o.y + dd.y * 200, z: o.z + dd.z * 200, t: 200, o, dd };
    };
    const setZoom = (v) => { S.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)); setZoomUI(Math.round(S.zoom * 10) / 10); };
    const say = (m, d = 2.4) => { S.msg = m; S.msgT = d; };
    const endGame = (ok, why, delay) => { if (S.over) return; S.over = true; S.result = ok; S.why = why; S.endT = delay; };
    const doFire = () => {
      if (S.mode !== "scope" || S.shotCd > 0 || S.bullets <= 0 || S.over) return;
      S.bullets--; S.shotCd = 1.0; S.kick = 1;
      const sw = 0.8;
      const dyw = Math.sin(S.t * 1.7) * 0.0012 * sw + Math.sin(S.t * 3.1) * 0.0006 * sw;
      const dpt = Math.cos(S.t * 1.3) * 0.0012 * sw + Math.sin(S.t * 2.7) * 0.0005 * sw;
      const r = shoot(dyw, dpt);
      const len = Math.hypot(r.x - r.o.x, r.y - r.o.y, r.z - r.o.z) || 1;
      S.bul = { o: r.o, e: { x: r.x, y: r.y, z: r.z }, dir: { x: (r.x - r.o.x) / len, y: (r.y - r.o.y) / len, z: (r.z - r.o.z) / len }, u: 0, res: r, trail: [], tcam: null, done: false, hold: 0 };
      S.mode = "bullet"; S.ts = 0.05; S.shotRt = S.rt;
    };
    const run = (p, dirSign) => { p.m = 3; p.dir = dirSign; p.vx = dirSign * (2 + rnd() * 5); p.vz = (rnd() < 0.75 ? -1 : 1) * (1 + rnd() * 4); p.after = 0; p.mt = 0; };
    const react = (level) => {
      if (level === 1) {
        for (const p of crowd) {
          if (p.m === 5) continue;
          const r = rnd();
          if (r < 0.42) { p.m = rnd() < 0.5 ? 1 : 2; p.mt = 2.5 + rnd() * 2.5; }
          else if (r < 0.54) { p.m = 3; p.mt = 1.6 + rnd() * 1.2; p.dir = rnd() < 0.5 ? -1 : 1; p.vx = p.dir * (3 + rnd() * 2.5); p.vz = -(0.5 + rnd() * 2); p.after = 1; }
          else if (r < 0.62) { p.m = 4; p.mt = 2 + rnd(); }
        }
        for (const g of guards) { g.m = 1; g.mt = 2.8; }
        if (S.L.st === "speech" || S.L.st === "in") { S.L.st = "startle"; S.L.tt = 0; S.L.caut = 1; }
      } else {
        for (const p of crowd) { if (p.m === 5) continue; if (rnd() < 0.12) { p.m = 4; p.mt = 1.2; } else run(p, rnd() < 0.5 ? -1 : 1); }
        for (const g of guards) { g.m = 2; g.mt = 99; }
        const L = S.L;
        if (L.st === "speech" || L.st === "in" || L.st === "startle" || L.st === "out") { L.st = "flee"; L.crouch = 0.45; }
        S.panic = 12;
      }
    };
    const impact = () => {
      const B = S.bul; B.done = true; B.hold = 0;
      const r = B.res, L = S.L;
      S.hitPos = { x: r.x, y: r.y, z: r.z }; S.hitRt = S.rt;
      for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, e = Math.random() * 1.2; S.parts.push({ x: r.x, y: r.y, z: r.z, vx: Math.cos(a) * (1 + Math.random() * 4), vy: 1 + Math.sin(e) * 4, vz: Math.sin(a) * (1 + Math.random() * 4), age: 0, life: 0.7 + Math.random() * 0.7, c: r.tag === "head" || r.tag === "body" ? "#fff2c4" : "#d8d4c8" }); }
      if ((r.tag === "head" || r.tag === "body") && L.st !== "down") {
        L.st = "down"; S.panic = 12; S.ts = 0.25;
        for (const p of crowd) if (p.m !== 5) run(p, rnd() < 0.5 ? -1 : 1);
        for (const g of guards) { g.m = 1; g.mt = 99; }
        say(r.tag === "head" ? "ВЛУЧАННЯ В ГОЛОВУ" : "ВЛУЧАННЯ", 3);
        endGame(true, r.tag, 2.8);
        S.recUntil = S.rt + 2.8;
      } else {
        S.misses++; S.ts = 0.25;
        say(r.tag === "cover" ? "Влучив у трибуну" : r.tag === "crowd" ? "Влучив у натовп" : r.tag === "guard" ? "Влучив в охорону" : r.tag === "car" ? "Влучив в авто" : "Промах", 2.4);
        react(S.misses === 1 ? 1 : 2);
        if (S.bullets <= 0 && !S.over) S.endAfterMiss = true;
      }
    };

    // ---------- оновлення світу ----------
    const toward = (o, tx, tz, sp2, dt) => { const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz); if (d < 0.04) return true; const st = Math.min(d, sp2 * dt); o.x += (dx / d) * st; o.z += (dz / d) * st; return d <= sp2 * dt + 0.04; };
    const updateLeader = (dt) => {
      const L = S.L;
      if (L.st === "hidden") { if (S.rifleT >= 0 && S.t - S.rifleT > S.spawnAt) { L.st = "in"; L.x = DOOR.x; L.z = DOOR.z; say("Ціль виходить на трибуну", 3); } }
      else if (L.st === "in") { if (toward(L, PODIUM.x, PODIUM.z, 3.2, dt)) { L.st = "speech"; L.t = 0; } }
      else if (L.st === "speech") {
        L.t += dt;
        const amp = L.caut ? 0.5 : 1;
        L.x = PODIUM.x + (1.9 * Math.sin(L.t * 0.45 + L.ph) + 0.7 * Math.sin(L.t * 1.25)) * amp;
        L.z = PODIUM.z + (Math.sin(L.t * 0.31 + 1) > 0.55 && !L.caut ? -1.2 : 0);
        L.gest = Math.sin(L.t * 2.3) > 0.55;
        L.crouch = L.caut ? 0.12 : 0;
        if (L.t > L.dur) { L.st = "out"; L.crouch = 0; say("Промова закінчується — ціль іде", 3); }
      } else if (L.st === "startle") { L.tt += dt; L.gest = false; if (L.tt > 2.8) L.st = "speech"; }
      else if (L.st === "out") { L.gest = false; if (toward(L, DOOR.x, DOOR.z, 2.8, dt)) { L.st = "gone"; if (!S.over) endGame(false, "gone", 1.2); } }
      else if (L.st === "flee") {
        L.dir = Math.sign(cars.limo.x - 1.5 - L.x) || 1;
        if (toward(L, cars.limo.x - 1.5, cars.limo.z - 0.5, 5.6, dt)) { L.st = "board"; L.t = 0; }
      } else if (L.st === "board") { L.t += dt; if (L.t > 0.5) { L.st = "car"; cars.limo.go = true; say("Ціль сіла в авто", 3); } }
      else if (L.st === "car") { if (cars.limo.z > 112 && !S.over) { L.st = "gone"; endGame(false, "car", 1.0); } }
      for (const g of guards) {
        if (g.m === 1) { g.mt -= dt; if (g.mt <= 0) g.m = 0; }
        else if (g.m === 2) {
          const esc = g.i < 2 && L.st === "flee";
          const tx = esc ? L.x + (g.i ? 1 : -1) * 0.95 : cars.limo.x + (g.i - 2) * 1.2 - 1.2;
          const tz = esc ? L.z - 0.4 : cars.limo.z - 1.5 + g.i * 0.4;
          g.dir = Math.sign(tx - g.x) || 1;
          if (toward(g, tx, tz, esc ? 6.2 : 5, dt) && !esc) g.m = 1;
        }
      }
      if (cars.limo.go) { cars.limo.v = Math.min(14, cars.limo.v + dt * 5); cars.limo.z += cars.limo.v * dt; }
    };
    const updateCrowd = (dt) => {
      for (const p of crowd) {
        if (p.m === 1 || p.m === 2 || p.m === 4) { p.mt -= dt; if (p.mt <= 0) p.m = 0; }
        else if (p.m === 3) {
          p.x += p.vx * dt; p.z += p.vz * dt;
          if (p.mt > 0) { p.mt -= dt; if (p.mt <= 0 && p.after) { p.m = 1; p.mt = 3; p.vx = p.vz = 0; } }
          if (p.z < 36 || p.x < -46 || p.x > 70 || p.z > 99) p.m = 5;
        }
      }
      if (S.panic > 0) S.panic -= dt;
    };
    const enterScope = () => { S.mode = "scope"; const dx = PODIUM.x - SPOT.x, dz = PODIUM.z - SPOT.z; S.scopeYaw = Math.atan2(dx, dz); S.scopePitch = Math.atan2(ST + 1.5 - 1.7, Math.hypot(dx, dz)); S.p.x = SPOT.x; S.p.z = SPOT.z; };
    const exitScope = () => { if (S.mode !== "scope") return; S.mode = "walk"; S.yaw = S.scopeYaw; S.pitch = Math.max(-0.5, Math.min(0.4, S.scopePitch)); S.cooldownEnter = 1.5; };
    const takeRifle = () => { if (S.hasRifle) return; S.hasRifle = true; S.rifleT = S.t; say("Гвинтівка взята. Іди на позицію (жовте коло).", 3.5); };
    const step = (dtReal) => {
      const dt = dtReal * S.ts;
      S.t += dt; S.rt += dtReal;
      cars.t1 += dt * 9; cars.t2 += dt * 7;
      S.shotCd = Math.max(0, S.shotCd - dt);
      S.kick = Math.max(0, S.kick - dtReal * 3);
      if (S.msgT > 0) S.msgT -= dtReal;
      if (S.cooldownEnter > 0) S.cooldownEnter -= dtReal;
      if (S.mode === "scope") { if (S.keys["+"] || S.keys["="]) setZoom(S.zoom + dtReal * 3); if (S.keys["-"] || S.keys._) setZoom(S.zoom - dtReal * 3); }
      updateLeader(dt); updateCrowd(dt);
      for (const q of S.parts) { q.age += dtReal; q.x += q.vx * dtReal * 0.5; q.y += q.vy * dtReal * 0.5; q.z += q.vz * dtReal * 0.5; q.vy -= 9 * dtReal * 0.5; }
      S.parts = S.parts.filter((q) => q.age < q.life);
      if (S.mode === "bullet" && S.bul) {
        const B = S.bul;
        if (!B.done) {
          B.u += dtReal / BULLET_DUR;
          const uu = Math.min(1, B.u);
          B.trail.push({ x: B.o.x + (B.e.x - B.o.x) * uu, y: B.o.y + (B.e.y - B.o.y) * uu, z: B.o.z + (B.e.z - B.o.z) * uu }); if (B.trail.length > 26) B.trail.shift();
          if (B.u >= 1) impact();
        } else {
          B.hold += dtReal;
          if (B.hold > 1.7 && !S.over) { S.mode = "scope"; S.ts = 1; S.bul = null; S.shotCd = 0.3; }
        }
      }
      if (S.over) {
        S.endT -= dtReal;
        if (S.endT <= 0 && phaseRef.current === "play") { setPh("end"); setRes({ ok: S.result, why: S.why }); }
        return;
      }
      if (S.endAfterMiss && S.mode === "scope" && S.L.st !== "down") { S.endAfterMiss = false; endGame(false, "ammo", 0.8); }
      const k = S.keys;
      const look = [0, 0], mv = [0, 0];
      for (const [, p] of S.ptr) {
        if (p.kind === "look") { look[0] += p.dx; look[1] += p.dy; p.dx = 0; p.dy = 0; }
        else if (p.kind === "stick") { mv[0] += Math.max(-1, Math.min(1, (p.x - p.x0) / 50)); mv[1] += Math.max(-1, Math.min(1, (p.y - p.y0) / 50)); }
      }
      if (k.ArrowLeft) look[0] -= 260 * dtReal; if (k.ArrowRight) look[0] += 260 * dtReal;
      if (k.ArrowUp) look[1] -= 260 * dtReal; if (k.ArrowDown) look[1] += 260 * dtReal;
      if (S.mode === "walk") {
        S.yaw += look[0] * 0.005; S.pitch = Math.max(-1.0, Math.min(0.7, S.pitch - look[1] * 0.005));
        let mx = mv[0] + (k.d || k.D ? 1 : 0) - (k.a || k.A ? 1 : 0), my = -mv[1] + (k.w || k.W ? 1 : 0) - (k.s || k.S ? 1 : 0);
        const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; }
        const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw), rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw);
        const nx = S.p.x + (fx * my + rx * mx) * 4.2 * dtReal, nz = S.p.z + (fz * my + rz * mx) * 4.2 * dtReal;
        if (nx > RX - 12.4 && nx < RX + 12.4) S.p.x = nx;
        if (nz > -8.4 && nz < 9.0) S.p.z = nz;
        S.walkBob += m > 0.1 ? dtReal * 9 : 0;
        if (S.hasRifle && !S.cooldownEnter && Math.hypot(S.p.x - SPOT.x, S.p.z - SPOT.z) < 1.1) enterScope();
      } else if (S.mode === "scope") {
        const sens = 0.9 / (W * 0.9 * S.zoom);
        S.scopeYaw += look[0] * sens; S.scopePitch = Math.max(-0.9, Math.min(0.5, S.scopePitch - look[1] * sens));
        if (k[" "] && !S.spaceDown) { S.spaceDown = true; doFire(); } if (!k[" "]) S.spaceDown = false;
      }
      if (k.e || k.E) { if (!S.hasRifle && Math.hypot(S.p.x - CRATE.x, S.p.z - CRATE.z) < 3) takeRifle(); }
    };

    // ---------- запис стану для повтору ----------
    const pack = () => {
      const L = S.L, pos = [L.x, L.z, cars.t1, cars.t2, cars.limo.x, cars.limo.z];
      for (const g of guards) pos.push(g.x, g.z);
      for (const p of crowd) pos.push(p.x, p.z);
      const B = S.bul, uu = B ? Math.min(1, B.u) : 0;
      pos.push(...(B ? [B.o.x + (B.e.x - B.o.x) * uu, B.o.y + (B.e.y - B.o.y) * uu, B.o.z + (B.e.z - B.o.z) * uu, B.dir.x, B.dir.y, B.dir.z] : [0, 0, 0, 0, 0, 0]), cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.zoom);
      const dis = [LST.indexOf(L.st), L.dir, Math.round(L.crouch * 100), L.gest ? 1 : 0, L.tt > 1.3 ? 1 : 0, B && !B.done ? 1 : 0, S.mode === "scope" ? 1 : S.mode === "bullet" ? 2 : 0];
      for (const g of guards) dis.push(g.m, g.dir);
      for (const p of crowd) dis.push(p.m, p.dir);
      return { rt: S.rt, pos, dis };
    };
    const unpack = (pos, dis, rt) => {
      const L = S.L; let i = 0;
      L.x = pos[i++]; L.z = pos[i++]; cars.t1 = pos[i++]; cars.t2 = pos[i++]; cars.limo.x = pos[i++]; cars.limo.z = pos[i++];
      for (const g of guards) { g.x = pos[i++]; g.z = pos[i++]; }
      for (const p of crowd) { p.x = pos[i++]; p.z = pos[i++]; }
      const bl = pos.slice(i, i + 6); i += 6;
      cam.x = pos[i++]; cam.y = pos[i++]; cam.z = pos[i++]; cam.yaw = pos[i++]; cam.pitch = pos[i++]; cam.zoom = pos[i++];
      let j = 0;
      L.st = LST[dis[j++]] || "hidden"; L.dir = dis[j++]; L.crouch = dis[j++] / 100; L.gest = !!dis[j++]; L.tt = dis[j++] ? 2 : 0; const bv = dis[j++]; const md = dis[j++];
      for (const g of guards) { g.m = dis[j++]; g.dir = dis[j++]; }
      for (const p of crowd) { p.m = dis[j++]; p.dir = dis[j++]; }
      S.t = rt; S.panic = 1;
      S.bul = bv ? { o: { x: bl[0], y: bl[1], z: bl[2] }, e: { x: bl[0], y: bl[1], z: bl[2] }, dir: { x: bl[3], y: bl[4], z: bl[5] }, u: 0, trail: [], done: false, rep: true } : null;
      return md;
    };

    // ---------- повтор ----------
    const startReplay = () => {
      const buf = S.buf; if (!buf || buf.length < 6) return;
      const tEnd = buf[buf.length - 1].rt, tStart = Math.max(buf[0].rt, S.hitRt - 15);
      const frames = buf.filter((f) => f.rt >= tStart);
      S.R = { frames, base: tStart, dur: tEnd - tStart, t: 0, i: 0, burst: false, hold: 1.2 };
      S.mode = "replay"; S.ts = 1; S.parts = []; S.bul = null;
      recorder.start();
      setPh("replay");
    };
    const stopReplay = (drop) => { recorder.stop(drop).then((v) => { if (!drop) setVideo(v); }); S.mode = "idle"; S.R = null; S.bul = null; S.parts = []; };
    const finishReplay = () => {
      try { canvas.toBlob((bl) => { thumbRef.current = bl; }, "image/jpeg", 0.8); } catch (e) { thumbRef.current = null; }
      stopReplay(false); setPh("replayEnd");
    };
    const shotCam = (type, tt, Ld) => {
      const t = Ld ? { x: Ld.x, y: ST + 1.45, z: Ld.z } : { x: PODIUM.x, y: ST + 1.45, z: PODIUM.z };
      let p;
      if (type === 0) p = { x: -16, y: ST + 7, z: 46 };
      else if (type === 1) p = { x: t.x + 1.2 * Math.sin(tt * 0.3), y: ST + 1.9, z: t.z - 8.5 };
      else if (type === 2) p = { x: t.x - 11, y: ST + 3.2, z: t.z - 2 + Math.sin(tt * 0.25) * 2 };
      else p = { x: t.x + 17, y: ST + 4.2, z: t.z - 9 };
      const l = lookAt(p, t);
      return { x: p.x, y: p.y, z: p.z, yaw: l.yaw, pitch: l.pitch, zoom: type === 1 ? 1.5 : type === 0 ? 1 : 1.25 };
    };
    const replayStep = (dtReal) => {
      const R = S.R; R.t += dtReal;
      const tt = Math.min(R.t, R.dur), rtAbs = R.base + tt;
      const fr = R.frames;
      while (R.i < fr.length - 2 && fr[R.i + 1].rt <= rtAbs) R.i++;
      const a = fr[R.i], b = fr[Math.min(fr.length - 1, R.i + 1)];
      const u = b.rt > a.rt ? Math.max(0, Math.min(1, (rtAbs - a.rt) / (b.rt - a.rt))) : 0;
      const pos = a.pos.map((v, k) => v + (b.pos[k] - v) * u);
      const md = unpack(pos, a.dis, rtAbs);
      const tShot = S.shotRt - R.base, tHit = S.hitRt - R.base;
      const inBullet = md === 2, scopeEnd = md === 1 && tt > tShot - 2.2;
      if (!inBullet && !scopeEnd) {
        const idx = Math.floor(tt / 3.2) % 4;
        const hasL = LST[a.dis[0]] !== "hidden" && LST[a.dis[0]] !== "gone";
        const c = shotCam(tt > tHit ? 1 : idx, tt, hasL ? { x: pos[0], z: pos[1] } : null);
        cam.x = c.x; cam.y = c.y; cam.z = c.z; cam.yaw = c.yaw; cam.pitch = c.pitch; cam.zoom = c.zoom;
        S.repScope = false;
      } else S.repScope = md === 1;
      if (!R.burst && tt >= tHit && S.hitPos) { R.burst = true; for (let i = 0; i < 26; i++) { const an = Math.random() * 6.28, e = Math.random() * 1.2; S.parts.push({ x: S.hitPos.x, y: S.hitPos.y, z: S.hitPos.z, vx: Math.cos(an) * (1 + Math.random() * 4), vy: 1 + Math.sin(e) * 4, vz: Math.sin(an) * (1 + Math.random() * 4), age: 0, life: 0.9, c: "#fff2c4" }); } }
      for (const q of S.parts) { q.age += dtReal; q.x += q.vx * dtReal * 0.5; q.y += q.vy * dtReal * 0.5; q.z += q.vz * dtReal * 0.5; q.vy -= 9 * dtReal * 0.5; }
      S.parts = S.parts.filter((q) => q.age < q.life);
      if (R.t > R.dur + R.hold) finishReplay();
    };

    // ---------- малювання ----------
    const sky = () => { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#6aa9ea"); g.addColorStop(0.55, "#bcdcf6"); g.addColorStop(1, "#dfeefa"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
    const drawWorld = (zoom) => {
      F = W * 0.9 * zoom;
      sky();
      const list = [];
      for (const b of statics) {
        if (b.layer === 0) continue;
        const c = toCam(b.cx, b.cy, b.cz);
        if (c[2] < -b.r) continue;
        list.push([Math.hypot(b.cx - cx0, b.cy - cy0, b.cz - cz0) - b.r * 0.3, 0, b]);
      }
      for (const b of dynBoxes()) { const c = toCam(b.cx, b.cy, b.cz); if (c[2] < -2) continue; list.push([Math.hypot(b.cx - cx0, b.cy - cy0, b.cz - cz0) - 0.5, 0, b]); }
      for (const h of humans()) { const c = toCam(h.x, h.y + 0.9, h.z); if (c[2] < -1) continue; list.push([Math.hypot(h.x - cx0, h.y + 0.9 - cy0, h.z - cz0) - 0.3, 1, h]); }
      for (const b of statics) if (b.layer === 0 && !b.cloud) drawBox(b, 60, 0);
      for (const b of statics) if (b.cloud) drawBox(b, 200, 0);
      list.sort((a, b2) => b2[0] - a[0]);
      for (const [d, kind, o] of list) {
        if (kind === 1) {
          const c = toCam(o.x, o.y, o.z);
          if (c[2] < NEAR) continue;
          const s = scr(c), Hh = (F / c[2]) * 1.8 * o.sc;
          if (Hh < 2.5) continue;
          drawHuman(o, s[0], s[1], Hh);
        } else if (o.flag !== undefined) drawBox(o, d, Math.sin(S.t * 3 + o.x0 + o.flag) * 0.25);
        else drawBox(o, d, 0);
      }
      if (S.mode === "walk") {
        if (S.hasRifle) { const ring = []; for (let i = 0; i < 16; i++) ring.push([SPOT.x + Math.cos((i / 16) * 6.283) * 0.9, 0.03, SPOT.z + Math.sin((i / 16) * 6.283) * 0.9]); poly3(ring, "rgba(255,210,40,0.8)"); }
        else {
          const dd = Math.hypot(CRATE.x - cx0, CRATE.z - cz0);
          drawBox({ x0: CRATE.x - 0.6, x1: CRATE.x + 0.6, y0: 0, y1: 0.55, z0: CRATE.z - 0.35, z1: CRATE.z + 0.35, c: "#5b6b3f" }, dd, 0);
          drawBox({ x0: CRATE.x - 0.7, x1: CRATE.x + 0.7, y0: 0.56, y1: 0.68, z0: CRATE.z - 0.1, z1: CRATE.z + 0.1, c: "#1f2227" }, dd, 0);
          const pulse = 0.5 + 0.5 * Math.sin(S.t * 5);
          poly3([[CRATE.x - 0.1, 1.5 + pulse * 0.2, CRATE.z], [CRATE.x + 0.1, 1.5 + pulse * 0.2, CRATE.z], [CRATE.x, 1.2 + pulse * 0.2, CRATE.z]], "#ffd22a");
        }
      }
      for (const q of S.parts) { const c = toCam(q.x, q.y, q.z); if (c[2] < NEAR) continue; const s = scr(c), r = Math.max(1.2, (0.07 * F) / c[2]); ctx.globalAlpha = Math.max(0, 1 - q.age / q.life); ctx.fillStyle = q.c; ctx.fillRect(s[0] - r, s[1] - r, r * 2, r * 2); ctx.globalAlpha = 1; }
      const B = S.bul;
      if (B && !B.done) {
        const uu = B.rep ? 0 : Math.min(1, B.u);
        const bp = B.rep ? B.o : { x: B.o.x + (B.e.x - B.o.x) * uu, y: B.o.y + (B.e.y - B.o.y) * uu, z: B.o.z + (B.e.z - B.o.z) * uu };
        const c1 = toCam(bp.x, bp.y, bp.z), c0 = toCam(bp.x - B.dir.x * 2.2, bp.y - B.dir.y * 2.2, bp.z - B.dir.z * 2.2);
        if (c1[2] > NEAR && c0[2] > NEAR) {
          const A = scr(c0), Bs = scr(c1), g = Math.max(2, (0.18 * F) / c1[2]);
          ctx.lineCap = "round"; ctx.strokeStyle = "rgba(255,200,80,.45)"; ctx.lineWidth = g * 1.6; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Bs[0], Bs[1]); ctx.stroke();
          ctx.strokeStyle = "#fff6d0"; ctx.lineWidth = Math.max(1.5, g * 0.6); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Bs[0], Bs[1]); ctx.stroke();
          ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(Bs[0], Bs[1], Math.max(2, g * 0.55), 0, 6.283); ctx.fill();
        }
        for (let i = 1; i < B.trail.length; i++) { const p0 = toCam(B.trail[i - 1].x, B.trail[i - 1].y, B.trail[i - 1].z), p1 = toCam(B.trail[i].x, B.trail[i].y, B.trail[i].z); if (p0[2] > NEAR && p1[2] > NEAR) { const A = scr(p0), Bs = scr(p1); ctx.strokeStyle = `rgba(255,255,255,${(i / B.trail.length) * 0.35})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Bs[0], Bs[1]); ctx.stroke(); } }
      }
    };
    const drawRifleHud = () => {
      if (!S.hasRifle) return;
      const bob = Math.sin(S.walkBob) * 4;
      ctx.save(); ctx.translate(W * 0.62, H - 80 + bob);
      ctx.fillStyle = "#2a2d33"; ctx.beginPath(); ctx.moveTo(0, 60); ctx.lineTo(70, 4); ctx.lineTo(100, 10); ctx.lineTo(30, 70); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#14161a"; ctx.beginPath(); ctx.moveTo(60, 8); ctx.lineTo(170, -26); ctx.lineTo(176, -18); ctx.lineTo(70, 18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#4a4f57"; ctx.fillRect(86, -14, 26, 7);
      ctx.restore();
    };
    const drawScopeFrame = () => {
      const R = Math.min(W, H) * 0.47, cx = W / 2, cy = H / 2;
      ctx.save(); ctx.fillStyle = "#000"; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(cx, cy, R, 0, 6.2832, true); ctx.fill("evenodd"); ctx.restore();
      ctx.strokeStyle = "#0a0a0a"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle = "rgba(10,10,10,.92)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx - 10, cy); ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy - 10); ctx.moveTo(cx, cy + 10); ctx.lineTo(cx, cy + R); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx - R * 0.35, cy); ctx.moveTo(cx + R * 0.35, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy + R * 0.35); ctx.lineTo(cx, cy + R); ctx.stroke();
      ctx.fillStyle = "rgba(10,10,10,.9)";
      for (let i = 1; i <= 5; i++) for (const [dx, dy] of [[i * 14, 0], [-i * 14, 0], [0, i * 14]]) { ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 1.6, 0, 6.2832); ctx.fill(); }
      ctx.fillStyle = "rgba(255,40,40,.9)"; ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, 6.2832); ctx.fill();
    };
    const bulletCam = () => {
      const B = S.bul, u = Math.min(1, B.u);
      const bp = { x: B.o.x + (B.e.x - B.o.x) * u, y: B.o.y + (B.e.y - B.o.y) * u, z: B.o.z + (B.e.z - B.o.z) * u };
      if (u < 0.5 && !B.done) {
        const ya = Math.atan2(B.dir.x, B.dir.z), rx = Math.cos(ya), rz = -Math.sin(ya);
        cam.x = bp.x - B.dir.x * 4.4 + rx * 0.6; cam.y = bp.y - B.dir.y * 4.4 + 0.75; cam.z = bp.z - B.dir.z * 4.4 + rz * 0.6;
        const l = lookAt(cam, { x: bp.x + B.dir.x * 9, y: bp.y + B.dir.y * 9, z: bp.z + B.dir.z * 9 }); cam.yaw = l.yaw; cam.pitch = l.pitch; cam.zoom = 1.25;
      } else {
        if (!B.tcam) {
          const px = B.dir.z, pz = -B.dir.x, ln = Math.hypot(px, pz) || 1;
          const solid = statics.filter((b) => b.layer === undefined && b.r < 60);
          const blocked = (x, y, z) => { for (const b of solid) if (x > b.x0 - 0.7 && x < b.x1 + 0.7 && y > b.y0 - 0.7 && y < b.y1 + 0.7 && z > b.z0 - 0.7 && z < b.z1 + 0.7) return true; return false; };
          let best = null;
          for (const dist of [9, 12, 15, 7]) for (const side of [-1, 1]) for (const back of [4, 8, 0]) for (const up of [1.5, 3.5]) {
            const c = { x: B.e.x - B.dir.x * back + (px / ln) * dist * side, y: Math.max(GY + 1.4, B.e.y + up), z: B.e.z - B.dir.z * back + (pz / ln) * dist * side };
            if (c.z < 38 || c.z > 96 || blocked(c.x, c.y, c.z)) continue;
            let ok = true;
            for (let i = 1; i < 28 && ok; i++) { const t = i / 28, x = c.x + (B.e.x - c.x) * t, y = c.y + (B.e.y - c.y) * t, z = c.z + (B.e.z - c.z) * t; if (Math.hypot(x - B.e.x, z - B.e.z) > 1.3 && blocked(x, y, z)) ok = false; }
            if (ok) { best = c; break; }
          }
          B.tcam = best || { x: B.e.x - B.dir.x * 6 + (px / ln) * 10, y: B.e.y + 5, z: B.e.z - B.dir.z * 6 + (pz / ln) * 10 };
        }
        const k = B.done ? 1 : ease(Math.max(0, (u - 0.5) * 2));
        const tx = bp.x + (B.e.x - bp.x) * (0.5 + 0.5 * k), ty = bp.y + (B.e.y - bp.y) * (0.5 + 0.5 * k), tz = bp.z + (B.e.z - bp.z) * (0.5 + 0.5 * k);
        cam.x = B.tcam.x; cam.y = B.tcam.y; cam.z = B.tcam.z;
        const l = lookAt(cam, { x: tx, y: ty, z: tz }); cam.yaw = l.yaw; cam.pitch = l.pitch; cam.zoom = 1.9;
      }
    };

    const frame = (now) => {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
      const ph = phaseRef.current;
      if (ph === "play" && (S.mode === "walk" || S.mode === "scope" || S.mode === "bullet")) step(dtReal);
      else if (S.mode === "replay" && S.R) replayStep(dtReal);
      else if (ph === "end" || ph === "replayEnd") { S.t += dtReal * 0.5; updateCrowd(dtReal * 0.5); for (const q of S.parts) { q.age += dtReal; q.x += q.vx * dtReal * 0.5; q.y += q.vy * dtReal * 0.5; q.z += q.vz * dtReal * 0.5; q.vy -= 9 * dtReal * 0.5; } S.parts = S.parts.filter((q) => q.age < q.life); }
      else S.t += dtReal;
      let zoom = 1, inScope = false;
      if (S.mode === "replay") { zoom = cam.zoom; inScope = !!S.repScope; }
      else if (S.mode === "scope") {
        const sw = 0.8;
        cam.x = SPOT.x; cam.y = 1.7; cam.z = SPOT.z;
        cam.yaw = S.scopeYaw + Math.sin(S.t * 1.7) * 0.0012 * sw + Math.sin(S.t * 3.1) * 0.0006 * sw;
        cam.pitch = S.scopePitch + Math.cos(S.t * 1.3) * 0.0012 * sw + Math.sin(S.t * 2.7) * 0.0005 * sw + S.kick * 0.012;
        zoom = S.zoom; inScope = true; cam.zoom = S.zoom;
      } else if (S.bul && (S.mode === "bullet" || ph === "end")) { bulletCam(); zoom = cam.zoom; }
      else if (ph === "end" || ph === "replayEnd") { zoom = cam.zoom || 1; }
      else {
        cam.x = S.p.x; cam.z = S.p.z; cam.y = 1.7 + Math.sin(S.walkBob) * 0.04;
        cam.yaw = ph === "brief" ? S.t * 0.1 : S.yaw; cam.pitch = ph === "brief" ? -0.12 : S.pitch; cam.zoom = 1;
      }
      setCam(cam);
      if (inScope) { const R = Math.min(W, H) * 0.47; ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, 6.2832); ctx.clip(); drawWorld(zoom); ctx.restore(); drawScopeFrame(); }
      else { drawWorld(zoom); if (S.mode === "walk") drawRifleHud(); }
      if (S.mode === "bullet" || (S.mode === "replay" && !inScope)) { ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(0, 0, W, H * 0.07); ctx.fillRect(0, H * 0.93, W, H * 0.07); }
      if (S.mode === "replay") {
        ctx.save(); ctx.font = "800 15px system-ui"; ctx.textAlign = "left"; ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(12, 14, 96, 28); ctx.fillStyle = "#ff4b4b"; ctx.beginPath(); ctx.arc(26, 28, 5, 0, 6.28); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText("ПОВТОР", 38, 33);
        ctx.textAlign = "center"; ctx.font = "700 13px system-ui"; ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(W / 2 - 92, H - 46, 184, 26); ctx.fillStyle = "#fff"; ctx.fillText("World Clicker · " + GAME_TAG, W / 2, H - 28); ctx.restore();
      }
      if (S.msgT > 0 && S.msg && S.mode !== "replay") {
        ctx.save(); ctx.globalAlpha = Math.min(1, S.msgT * 2); ctx.font = "700 17px system-ui"; ctx.textAlign = "center";
        const w = Math.min(W - 24, ctx.measureText(S.msg).width + 28); ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(W / 2 - w / 2, H * 0.16, w, 36);
        ctx.fillStyle = "#fff"; ctx.fillText(S.msg, W / 2, H * 0.16 + 24, w - 16); ctx.restore();
      }
      if (ph === "play" && S.rifleT >= 0 && (S.mode === "scope" || S.mode === "bullet") && S.rt - S.lastSnap >= 1 / 30 && (!S.over || S.rt <= S.recUntil)) {
        S.lastSnap = S.rt; S.buf.push(pack());
        while (S.buf.length > 780) S.buf.shift();
      }
      hudT += dtReal;
      if (hudT > 0.12) {
        hudT = 0;
        const L = S.L;
        let obj = "";
        if (!S.hasRifle) obj = "Підійди до ящика й візьми снайперську гвинтівку";
        else if (S.mode === "walk") obj = "Іди на жовту позицію край даху";
        else if (L.st === "hidden") obj = "Очікуй на ціль…";
        else if (L.st === "gone" || L.st === "car") obj = "";
        else if (L.st === "flee") obj = "Ціль тікає — стріляй!";
        else obj = "Ціль на трибуні — стріляй";
        const near = !S.hasRifle && Math.hypot(S.p.x - CRATE.x, S.p.z - CRATE.z) < 3 && S.mode === "walk";
        const h = { obj, bullets: S.bullets, near, scope: S.mode === "scope", bullet: S.mode === "bullet" };
        const key = JSON.stringify(h);
        if (key !== hudKey && phaseRef.current === "play") { hudKey = key; setHud(h); }
      }
    };
    raf = requestAnimationFrame(frame);

    // ---------- ввід ----------
    const rectOf = () => wrap.getBoundingClientRect();
    const down = (e) => {
      if (e.target.closest && e.target.closest("button, input")) return;
      if (phaseRef.current !== "play") return;
      const r = rectOf(), x = e.clientX - r.left, y = e.clientY - r.top;
      const kind = S.mode === "scope" ? "look" : x < r.width * 0.45 ? "stick" : "look";
      S.ptr.set(e.pointerId, { kind, x0: x, y0: y, x, y, dx: 0, dy: 0 });
      try { wrap.setPointerCapture(e.pointerId); } catch { /* */ }
    };
    const move = (e) => { const p = S.ptr.get(e.pointerId); if (!p) return; const r = rectOf(); const x = e.clientX - r.left, y = e.clientY - r.top; p.dx += x - p.x; p.dy += y - p.y; p.x = x; p.y = y; };
    const up = (e) => { S.ptr.delete(e.pointerId); };
    wrap.addEventListener("pointerdown", down); wrap.addEventListener("pointermove", move); wrap.addEventListener("pointerup", up); wrap.addEventListener("pointercancel", up);
    const kd = (e) => { S.keys[e.key] = true; };
    const ku = (e) => { S.keys[e.key] = false; };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    apiRef.current = { fire: doFire, take: takeRifle, exit: exitScope, setZoom: (v) => setZoom(v), replay: startReplay, stopReplay: () => stopReplay(true) };

    return () => {
      dead = true; cancelAnimationFrame(raf); try { recorder.stop(true); } catch (e) { /* */ }
      window.removeEventListener("resize", resize); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
      wrap.removeEventListener("pointerdown", down); wrap.removeEventListener("pointermove", move); wrap.removeEventListener("pointerup", up); wrap.removeEventListener("pointercancel", up);
    };
  }, [round]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => setPh("play");
  const again = () => { setRes(null); setVideo(null); setShareMsg(""); autoSaveRef.current = false; setHud({ obj: "", bullets: 3, near: false, scope: false, bullet: false }); setRound((r) => r + 1); setPh("play"); };
  const startReplay = () => { setShareMsg(""); setVideo(null); apiRef.current.replay?.(); };
  const caption = `🎯 Мій снайперський постріл у World Clicker! Влучив у вигаданого лідера країни ${country || ""} — дивись повтор.\nГрай у ${GAME_TAG}`;
  const doSave = () => saveReplay(video, "world-clicker-shot", setShareMsg, setBusy);
  const doShare = () => shareReplay({ video, thumb: thumbRef.current, caption, filename: "world-clicker-shot", title: "Замах — World Clicker", onMsg: setShareMsg, onBusy: setBusy });
  const downloadFromEnd = () => { if (video) { doSave(); return; } autoSaveRef.current = true; startReplay(); };
  useEffect(() => { if (video && autoSaveRef.current && phase === "replayEnd") { autoSaveRef.current = false; saveReplay(video, "world-clicker-shot", setShareMsg, setBusy); } }, [video, phase]);
  const onX = () => { if (phase === "replay") { apiRef.current.stopReplay?.(); setPh("end"); return; } finish(phase === "end" || phase === "replayEnd" ? !!res?.ok : false); };

  const why = { head: "Влучання в голову", body: "Влучання в ціль", gone: "Ціль втекла в будівлю", ammo: "Патрони закінчились — ціль втекла", car: "Ціль утекла в автомобілі" };
  const btn = { border: 0, borderRadius: 14, padding: "13px 18px", fontSize: 16, fontWeight: 800, color: "#fff", background: "rgba(20,24,32,.78)", touchAction: "none", userSelect: "none" };
  const panel = { position: "absolute", left: 0, right: 0, bottom: 0, padding: "22px 18px 26px", background: "linear-gradient(transparent,rgba(0,0,0,.88) 30%)", color: "#fff", fontFamily: "system-ui", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 };

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#000", touchAction: "none", overflow: "hidden", userSelect: "none", WebkitUserSelect: "none" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <button onClick={onX} style={{ ...btn, position: "absolute", top: 10, right: 10, padding: "8px 14px", borderRadius: 20 }}>✕</button>

      {phase === "play" && (
        <>
          <div style={{ position: "absolute", top: 10, left: 10, right: 64, color: "#fff", fontFamily: "system-ui", fontSize: 14, textShadow: "0 1px 3px #000" }}>
            <div style={{ background: "rgba(10,20,40,.6)", borderRadius: 10, padding: "8px 11px", display: "inline-block" }}>
              <div style={{ fontWeight: 700 }}>{hud.bullet ? "Куля летить…" : hud.obj}</div>
              <div style={{ opacity: 0.85, marginTop: 3 }}>🔫 {hud.bullets}/3</div>
            </div>
          </div>
          {hud.near && <button onClick={() => apiRef.current.take?.()} style={{ ...btn, position: "absolute", left: "50%", bottom: 120, transform: "translateX(-50%)", background: "#d89b00" }}>Взяти гвинтівку</button>}
          {hud.scope && (
            <>
              <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 56, padding: "12px 0", borderRadius: 28, background: "rgba(10,14,22,.62)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "#fff", fontFamily: "system-ui", touchAction: "none" }}>
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>+</div>
                <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step="0.1" value={zoomUI} onChange={(e) => apiRef.current.setZoom?.(parseFloat(e.target.value))}
                  style={{ writingMode: "vertical-lr", direction: "rtl", height: 190, width: 28, accentColor: "#ffd22a", touchAction: "none" }} aria-label="Наближення" />
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>−</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>×{zoomUI.toFixed(1)}</div>
              </div>
              <button onPointerDown={() => apiRef.current.fire?.()} style={{ ...btn, position: "absolute", right: 14, bottom: 34, width: 96, height: 96, borderRadius: 48, padding: 0, background: "#c0262d", fontSize: 18 }}>Вогонь</button>
              <button onClick={() => apiRef.current.exit?.()} style={{ ...btn, position: "absolute", left: "50%", bottom: 38, transform: "translateX(-50%)", padding: "10px 14px", fontSize: 13 }}>Опустити</button>
            </>
          )}
        </>
      )}

      {phase === "brief" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 18, background: "rgba(0,0,0,.5)" }}>
          <div style={{ maxWidth: 360, background: "rgba(14,20,32,.94)", color: "#fff", borderRadius: 18, padding: 20, fontFamily: "system-ui" }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Замах · {country || "країна"}</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.92 }}>
              Ти на даху поруч із урядовою площею. Лідер вигаданий.<br />
              1. Візьми гвинтівку з ящика.<br />
              2. Стань на жовту позицію край даху.<br />
              3. Дочекайся, поки лідер вийде на трибуну.<br />
              4. Прицілься й влуч. Він рухається. Повзунок зліва змінює наближення: ближче чи далі.<br />
              Після першого промаху натовп і лідер озираються, після другого всі тікають, а лідер біжить до авто. По ньому ще можна влучити.<br />
              <span style={{ opacity: 0.7 }}>Лівий палець — рух, правий — огляд. У прицілі тягни пальцем, щоб цілитись. Три патрони.</span>
            </div>
            <button onClick={start} style={{ ...btn, marginTop: 14, width: "100%", background: "#c0262d" }}>Почати</button>
          </div>
        </div>
      )}

      {phase === "end" && res && (
        <div style={panel}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{res.ok ? "Ціль уражено" : "Ціль не вражено"}</div>
          <div style={{ opacity: 0.85 }}>{why[res.why] || ""}</div>
          {shareMsg && <div style={{ fontSize: 13, opacity: 0.9 }}>{shareMsg}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            {res.ok && <button onClick={startReplay} style={{ ...btn, background: "#2f6fd6" }}>🎬 Повтор і поділитися</button>}
            {res.ok && <button onClick={downloadFromEnd} disabled={busy} style={btn}>⬇ Завантажити відео</button>}
            <button onClick={again} style={{ ...btn, background: "#c0262d" }}>Спробувати ще раз</button>
            <button onClick={() => finish(res.ok)} style={btn}>В меню</button>
          </div>
        </div>
      )}

      {phase === "replayEnd" && (
        <div style={panel}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Повтор готовий</div>
          {shareMsg && <div style={{ fontSize: 13, opacity: 0.9 }}>{shareMsg}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={doShare} disabled={busy} style={{ ...btn, background: "#2f6fd6" }}>📤 Поділитися відео</button>
            <button onClick={doSave} disabled={busy || !video} style={btn}>Зберегти відео</button>
            <button onClick={startReplay} style={btn}>Ще раз</button>
            <button onClick={() => setPh("end")} style={btn}>Назад</button>
          </div>
        </div>
      )}
    </div>
  );
}
