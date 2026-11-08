import React, { useEffect, useRef, useState } from "react";

/* Дрон-камікадзе: псевдо-3D політ над містом (чистий canvas, без залежностей).
   Гравець тягне пальцем (або стрілки/WASD), дрон летить уперед сам. Треба влучити у червону ціль.
   Легка сцена: ~150 коробок-будівель, малюються painter's-алгоритмом, ліміт 160 часток вогню. */

const W3 = { near: 1, endZ: 700, speed: 28, maxLat: 22, maxVert: 20 };

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

function buildCity(seedStr) {
  const rnd = mulberry(hashSeed(seedStr));
  const blocks = [];
  const cell = 26;
  const tz = 380 + Math.floor(rnd() * 5) * 26; // ряд цілі
  const tx = Math.floor((rnd() * 6 - 3)) * cell;
  const pal = ["#8c9bb0", "#a39a8c", "#7f8fa3", "#b0a58f", "#6f7d92", "#9aa8b8", "#b8a890"];
  for (let gz = 80; gz < W3.endZ - 20; gz += cell) {
    for (let gx = -130; gx <= 130; gx += cell) {
      const isTarget = gz === tz && Math.abs(gx - tx) < cell / 2;
      const centerBoost = 1 - Math.min(1, Math.abs(gx) / 140);
      if (!isTarget && rnd() < 0.18) continue; // вулиці/парки
      const w = 11 + rnd() * 8;
      const d = 11 + rnd() * 8;
      let h = 8 + rnd() * (18 + 34 * centerBoost);
      if (!isTarget && Math.abs(gz - tz) < 60 && Math.abs(gx - tx) < 60) h = Math.min(h, 22); // навколо цілі нижче
      blocks.push({
        x0: gx - w / 2, x1: gx + w / 2, z0: gz - d / 2, z1: gz + d / 2,
        h: isTarget ? 36 : h, c: isTarget ? "#e2452f" : pal[Math.floor(rnd() * pal.length)], t: isTarget, burnt: 0,
      });
    }
  }
  return { blocks, target: blocks.find((b) => b.t) };
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `rgb(${r},${g},${b})`;
}

export default function DroneGame({ city, targetName, onClose }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState("brief"); // brief | fly | hit | crash | miss
  const [round, setRound] = useState(0);
  const phaseRef = useRef("brief");
  const setPh = (p) => { phaseRef.current = p; setPhase(p); };

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

    const cityData = buildCity((city?.key || city?.name || "city") + ":" + round);
    const S = {
      x: 0, y: 58, z: 0, vx: 0, vy: 0, roll: 0, t: 0,
      stick: { on: false, ox: 0, oy: 0, dx: 0, dy: 0 },
      keys: {}, parts: [], flash: 0, shake: 0, endT: 0,
      cam: { x: 0, y: 58, z: 0 }, camBack: 0,
    };
    let raf = 0, last = performance.now(), dead = false;

    const proj = (x, y, z, cam) => {
      const dz = z - cam.z;
      const f = Hd * 0.85;
      return [Wd / 2 + ((x - cam.x) / dz) * f, Hd * 0.42 - ((y - cam.y) / dz) * f, dz];
    };

    const quad = (pts, fill) => {
      ctx.fillStyle = fill; ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath(); ctx.fill();
    };

    const drawBox = (b, cam, nowS) => {
      const z0 = Math.max(b.z0, cam.z + W3.near);
      if (b.z1 <= cam.z + W3.near) return;
      const burn = b.burnt;
      const base = burn > 0 ? "#3a2a24" : b.c;
      const P = (x, y, z) => proj(x, y, z, cam);
      const bl = P(b.x0, 0, z0), br = P(b.x1, 0, z0), tr = P(b.x1, b.h, z0), tl = P(b.x0, b.h, z0);
      if (cam.y > b.h) quad([tl, tr, P(b.x1, b.h, b.z1), P(b.x0, b.h, b.z1)], shade(base, 1.15));
      if (cam.x < b.x0) quad([P(b.x0, 0, z0), P(b.x0, 0, b.z1), P(b.x0, b.h, b.z1), P(b.x0, b.h, z0)], shade(base, 0.62));
      else if (cam.x > b.x1) quad([P(b.x1, 0, z0), P(b.x1, 0, b.z1), P(b.x1, b.h, b.z1), P(b.x1, b.h, z0)], shade(base, 0.62));
      let front = shade(base, 0.85);
      if (b.t && !burn) front = shade(b.c, 0.9 + 0.25 * Math.sin(nowS * 7));
      quad([bl, br, tr, tl], front);
      const sw = br[0] - bl[0];
      if (sw > 16 && sw < 900 && !b.t) {
        ctx.fillStyle = burn ? "rgba(255,140,40,0.7)" : "rgba(255,240,170,0.55)";
        const cols = Math.max(2, Math.min(6, Math.floor(sw / 9)));
        const rows = Math.max(2, Math.min(8, Math.floor((bl[1] - tl[1]) / 11)));
        const cw = sw / (cols * 2 + 1), ch = (bl[1] - tl[1]) / (rows * 2 + 1);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          if (((r * 7 + c * 3 + Math.floor(b.x0 + b.z0)) & 3) === 0) continue;
          ctx.fillRect(bl[0] + cw * (2 * c + 1), tl[1] + ch * (2 * r + 1), cw, ch);
        }
      }
    };

    const emit = (b) => {
      if (S.parts.length > 160) return;
      for (let i = 0; i < 3; i++) {
        S.parts.push({
          x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.h * (0.5 + Math.random() * 0.5), z: b.z0 + Math.random() * (b.z1 - b.z0),
          vx: (Math.random() - 0.5) * 3, vy: 6 + Math.random() * 10, vz: (Math.random() - 0.5) * 3,
          life: 1.4 + Math.random() * 1.2, age: 0, smoke: Math.random() < 0.4,
        });
      }
    };

    const frame = (now) => {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const nowS = now / 1000;
      const ph = phaseRef.current;
      const { blocks, target } = cityData;

      if (ph === "fly") {
        S.t += dt;
        let ix = 0, iy = 0;
        if (S.stick.on) { ix = S.stick.dx; iy = S.stick.dy; }
        const k = S.keys;
        if (k.ArrowLeft || k.a) ix -= 1;
        if (k.ArrowRight || k.d) ix += 1;
        if (k.ArrowUp || k.w) iy -= 1;
        if (k.ArrowDown || k.s) iy += 1;
        ix = Math.max(-1, Math.min(1, ix)); iy = Math.max(-1, Math.min(1, iy));
        S.vx += (ix * W3.maxLat - S.vx) * Math.min(1, dt * 5);
        S.vy += (-iy * W3.maxVert - S.vy) * Math.min(1, dt * 5);
        S.roll += (S.vx / W3.maxLat * 0.22 - S.roll) * Math.min(1, dt * 6);
        S.x += S.vx * dt; S.y += S.vy * dt; S.z += W3.speed * dt * (1 + S.t * 0.01);
        S.x = Math.max(-150, Math.min(150, S.x)); S.y = Math.min(90, S.y);
        S.cam.x = S.x; S.cam.y = S.y + 2; S.cam.z = S.z - 6;
        // зіткнення (радіус 2.2)
        const m = 2.2;
        for (const b of blocks) {
          if (b.z1 < S.z - 10 || b.z0 > S.z + 10) continue;
          if (S.x > b.x0 - m && S.x < b.x1 + m && S.z > b.z0 - m && S.z < b.z1 + m && S.y < b.h + m) {
            S.endT = nowS;
            if (b.t) { b.burnt = 1; S.flash = 1; S.camBack = 0; S.hitCam = { x: S.x, y: S.y, z: S.z }; setPh("hit"); }
            else { S.flash = 1; S.shake = 1; setPh("crash"); }
            break;
          }
        }
        if (phaseRef.current === "fly") {
          if (S.y < 1.5) { S.flash = 1; S.shake = 1; S.endT = nowS; setPh("crash"); }
          else if (S.z > W3.endZ - 10) { S.endT = nowS; setPh("miss"); }
        }
      } else if (ph === "hit") {
        const e = nowS - S.endT;
        const tx = (target.x0 + target.x1) / 2, tz = (target.z0 + target.z1) / 2;
        const goal = { x: tx + 40, y: 52, z: tz - 90 };
        const kk = Math.min(1, e / 1.6);
        const ease = kk * kk * (3 - 2 * kk);
        S.cam.x = S.hitCam.x + (goal.x - S.hitCam.x) * ease;
        S.cam.y = S.hitCam.y + (goal.y - S.hitCam.y) * ease;
        S.cam.z = S.hitCam.z - 6 + (goal.z - (S.hitCam.z - 6)) * ease;
        S.flash = Math.max(0, S.flash - dt * 2);
        if (Math.random() < 0.9) emit(target);
        // сусідні будівлі теж загораються з часом
        if (e > 1.5) for (const b of blocks) if (!b.burnt && Math.abs(b.x0 - target.x0) < 40 && Math.abs(b.z0 - target.z0) < 40 && Math.random() < dt * 0.6) b.burnt = 1;
        for (const b of blocks) if (b.burnt && b !== target && Math.random() < 0.25) emit(b);
      } else if (ph === "crash") {
        S.flash = Math.max(0, S.flash - dt * 1.5); S.shake = Math.max(0, S.shake - dt * 1.5);
      } else if (ph === "brief") {
        S.z += 6 * dt * 0; S.cam.x = 0; S.cam.y = 70; S.cam.z = -6 + Math.sin(nowS * 0.5) * 3;
      }

      // оновлення часток
      for (let i = S.parts.length - 1; i >= 0; i--) {
        const p = S.parts[i];
        p.age += dt; if (p.age > p.life) { S.parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }

      // ---- малювання ----
      const cam = S.cam;
      ctx.save();
      if (S.shake > 0) ctx.translate((Math.random() - 0.5) * 14 * S.shake, (Math.random() - 0.5) * 14 * S.shake);
      if (ph === "fly") { ctx.translate(Wd / 2, Hd / 2); ctx.rotate(S.roll); ctx.translate(-Wd / 2, -Hd / 2); }
      // небо
      const hz = Hd * 0.42;
      const sky = ctx.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, "#5aa7ff"); sky.addColorStop(1, "#cfe8ff");
      ctx.fillStyle = sky; ctx.fillRect(-40, -40, Wd + 80, hz + 40);
      // земля
      const gr = ctx.createLinearGradient(0, hz, 0, Hd);
      gr.addColorStop(0, "#6c7a6a"); gr.addColorStop(1, "#4a5648");
      ctx.fillStyle = gr; ctx.fillRect(-40, hz, Wd + 80, Hd - hz + 40);
      // дороги: лінії сітки на землі
      ctx.strokeStyle = "rgba(40,44,40,0.55)"; ctx.lineWidth = 2;
      const zs = Math.floor((cam.z + 1) / 26) * 26;
      for (let z = zs; z < zs + 520; z += 26) {
        const a = proj(-220, 0, z + 13, cam), b2 = proj(220, 0, z + 13, cam);
        if (a[2] < 1) continue; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
      }
      for (let x = -130; x <= 130; x += 26) {
        const a = proj(x + 13, 0, cam.z + 1, cam), b2 = proj(x + 13, 0, cam.z + 520, cam);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
      }
      // будівлі: далекі першими
      const vis = [];
      for (const b of blocks) if (b.z1 > cam.z + W3.near && b.z0 < cam.z + 420) vis.push(b);
      vis.sort((a, b) => b.z0 - a.z0 || Math.abs(b.x0 + b.x1 - 2 * cam.x) - Math.abs(a.x0 + a.x1 - 2 * cam.x));
      for (const b of vis) drawBox(b, cam, nowS);

      // вогонь і дим
      for (const p of S.parts) {
        const [sx, sy, dz] = proj(p.x, p.y, p.z, cam);
        if (dz < 1) continue;
        const u = p.age / p.life;
        const r = Math.max(2, (p.smoke ? 9 + u * 18 : 7 + (1 - u) * 8) * (Hd * 0.85) / dz / 6);
        if (p.smoke) ctx.fillStyle = `rgba(50,50,55,${0.5 * (1 - u)})`;
        else ctx.fillStyle = u < 0.35 ? `rgba(255,${200 - u * 200},60,${0.9 - u})` : `rgba(235,${90 - u * 40},20,${0.85 * (1 - u)})`;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
      }

      // маркер цілі
      if (target && (ph === "fly" || ph === "brief")) {
        const tx = (target.x0 + target.x1) / 2, tz = (target.z0 + target.z1) / 2;
        const [sx, sy, dz] = proj(tx, target.h + 8, tz, cam);
        if (dz > 2) {
          const pulse = 1 + 0.15 * Math.sin(nowS * 6);
          const sxc = Math.max(24, Math.min(Wd - 24, sx));
          const syc = Math.max(70, Math.min(Hd - 110, sy));
          ctx.save(); ctx.translate(sxc, syc);
          ctx.strokeStyle = "#ff3b30"; ctx.fillStyle = "#ff3b30"; ctx.lineWidth = 3;
          if (sxc === sx && syc === sy) {
            ctx.beginPath(); ctx.arc(0, 0, 18 * pulse, 0, 6.2832); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-10, 0); ctx.moveTo(26, 0); ctx.lineTo(10, 0); ctx.moveTo(0, -26); ctx.lineTo(0, -10); ctx.moveTo(0, 26); ctx.lineTo(0, 10); ctx.stroke();
          } else {
            ctx.rotate(Math.atan2(sy - Hd * 0.5, sx - Wd * 0.5));
            ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, 10); ctx.lineTo(-8, -10); ctx.closePath(); ctx.fill();
          }
          ctx.restore();
        }
      }
      ctx.restore();

      // спалах/вініетка
      if (S.flash > 0) {
        ctx.fillStyle = (phaseRef.current === "crash" ? "rgba(255,40,40," : "rgba(255,240,200,") + (0.85 * S.flash) + ")";
        ctx.fillRect(0, 0, Wd, Hd);
      }
      const vg = ctx.createRadialGradient(Wd / 2, Hd / 2, Hd * 0.3, Wd / 2, Hd / 2, Hd * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, Wd, Hd);

      // HUD
      if (ph === "fly") {
        const tz = (target.z0 + target.z1) / 2;
        const dist = Math.max(0, Math.round(Math.hypot(S.z - tz, S.x - (target.x0 + target.x1) / 2)));
        ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(10, 10, 150, 58);
        ctx.fillStyle = "#9cff9c"; ctx.font = "bold 13px monospace"; ctx.textAlign = "left";
        ctx.fillText("ЦІЛЬ  " + dist + " м", 18, 29);
        ctx.fillText("ВИСОТА " + Math.round(S.y) + " м", 18, 47);
        ctx.fillText("ШВИДК. " + Math.round(W3.speed * 3.6) + " км/г", 18, 63);
        if (S.stick.on) {
          ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(S.stick.ox, S.stick.oy, 46, 0, 6.2832); ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.beginPath(); ctx.arc(S.stick.ox + S.stick.dx * 46, S.stick.oy + S.stick.dy * 46, 18, 0, 6.2832); ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(frame);

    const pos = (e) => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onDown = (e) => {
      if (phaseRef.current !== "fly") return;
      const [x, y] = pos(e);
      S.stick.on = true; S.stick.ox = x; S.stick.oy = y; S.stick.dx = 0; S.stick.dy = 0;
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    };
    const onMove = (e) => {
      if (!S.stick.on) return;
      const [x, y] = pos(e);
      let dx = (x - S.stick.ox) / 46, dy = (y - S.stick.oy) / 46;
      const n = Math.hypot(dx, dy); if (n > 1) { dx /= n; dy /= n; }
      S.stick.dx = dx; S.stick.dy = dy;
    };
    const onUp = () => { S.stick.on = false; S.stick.dx = 0; S.stick.dy = 0; };
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
  }, [round, city]);

  const btn = { padding: "12px 22px", borderRadius: 12, border: "none", fontWeight: 800, fontSize: 15, color: "#fff", background: "linear-gradient(180deg,#3b8cff,#1f64d6)", boxShadow: "0 4px 0 #14439a", cursor: "pointer" };
  const banner = (title, sub, color) => (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, textAlign: "center", padding: "0 20px", pointerEvents: "none" }}>
      <div style={{ fontSize: 26, fontWeight: 900, color, textShadow: "0 2px 8px rgba(0,0,0,.7)" }}>{title}</div>
      <div style={{ fontSize: 14, color: "#fff", margin: "6px 0 14px", textShadow: "0 2px 6px rgba(0,0,0,.8)" }}>{sub}</div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", pointerEvents: "auto" }}>
        <button type="button" style={btn} onClick={() => { setRound((r) => r + 1); setPh("fly"); }}>Ще раз</button>
        <button type="button" style={{ ...btn, background: "linear-gradient(180deg,#667,#445)", boxShadow: "0 4px 0 #223" }} onClick={() => onClose(phase === "hit")}>Закрити</button>
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#000", touchAction: "none", userSelect: "none", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <button type="button" aria-label="Закрити" onClick={() => onClose(false)} style={{ position: "absolute", top: 10, right: 10, width: 38, height: 38, borderRadius: 19, border: "none", background: "rgba(0,0,0,.55)", color: "#fff", fontSize: 18, cursor: "pointer", zIndex: 2 }}>✕</button>
      {phase === "brief" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 48, background: "linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.6))", textAlign: "center", color: "#fff", padding: "0 24px 48px" }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: "#ffb3a8" }}>УДАР ДРОНОМ</div>
          <div style={{ fontSize: 28, fontWeight: 900, margin: "6px 0" }}>{city?.name}</div>
          {targetName && <div style={{ fontSize: 14, opacity: 0.85 }}>{targetName}</div>}
          <div style={{ fontSize: 14, margin: "14px 0 18px", maxWidth: 320, lineHeight: 1.45 }}>Тягни пальцем екран, щоб керувати дроном: вліво/вправо і вгору/вниз. Облітай будівлі й влуч у <b style={{ color: "#ff6a5c" }}>червону ціль</b>.</div>
          <button type="button" style={btn} onClick={() => setPh("fly")}>Запустити</button>
        </div>
      )}
      {phase === "hit" && banner("ЦІЛЬ ЗНИЩЕНА", "Місто " + (city?.name || "") + " у вогні", "#ffb347")}
      {phase === "crash" && banner("ДРОН РОЗБИТО", "Ти врізався не в ту будівлю", "#ff6a5c")}
      {phase === "miss" && banner("ПРОМАХ", "Дрон пролетів повз ціль", "#ffd166")}
    </div>
  );
}
