/* Ефекти клікера на одному canvas: плаваючі числа, іскри, кільця. Один rAF-цикл, який працює лише поки є що малювати.
   Фізика (step) — чиста функція: тестується без браузера. Пул обмежений, тож швидкі тапи не накопичують вузлів DOM. */

export const MAX_ITEMS = 70;

const PALETTE = ["#ffd54a", "#ffffff", "#ff6b6b", "#8ad84f", "#7cf0ff", "#b388ff"];

export const createFx = () => ({ items: [] });

function push(fx, item) {
  fx.items.push(item);
  if (fx.items.length > MAX_ITEMS) fx.items.splice(0, fx.items.length - MAX_ITEMS);
}

/** Плаваюче число/текст. Координати — у пікселях canvas (CSS-пікселі). */
export function spawnText(fx, x, y, text, { color = "#ffffff", size = 28, life = 0.75, rise = 70, rnd = Math.random } = {}) {
  push(fx, { kind: "text", x: x + (rnd() - 0.5) * 26, y, vx: (rnd() - 0.5) * 30, vy: -rise / life, life, age: 0, size, color, text });
}

/** Іскри/конфеті навколо точки тапу */
export function spawnSparks(fx, x, y, n = 6, { rnd = Math.random, power = 1 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const sp = (90 + rnd() * 160) * power;
    push(fx, { kind: "spark", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.45 + rnd() * 0.3, age: 0, size: 3 + rnd() * 4, color: PALETTE[(rnd() * PALETTE.length) | 0] });
  }
}

/** Кільце, що розходиться (удар по планеті) */
export function spawnRing(fx, x, y, { color = "#ffffff", size = 70, life = 0.4 } = {}) {
  push(fx, { kind: "ring", x, y, vx: 0, vy: 0, life, age: 0, size, color });
}

/** Крок симуляції: dt у секундах. Повертає кількість живих елементів. */
export function step(fx, dt) {
  const d = Math.min(0.05, Math.max(0, dt)); // обмеження після «сплячки» вкладки
  const alive = [];
  for (const it of fx.items) {
    it.age += d;
    if (it.age >= it.life) continue;
    it.x += it.vx * d;
    it.y += it.vy * d;
    if (it.kind === "spark") it.vy += 520 * d; // гравітація
    if (it.kind === "text") it.vy *= 1 - 2.2 * d; // гальмування підйому
    alive.push(it);
  }
  fx.items = alive;
  return alive.length;
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** Малювання одного кадру */
export function draw(ctx, fx, w, h) {
  ctx.clearRect(0, 0, w, h);
  for (const it of fx.items) {
    const t = it.age / it.life;
    if (it.kind === "text") {
      const pop = t < 0.18 ? 0.6 + (t / 0.18) * 0.6 : 1.2 - Math.min(0.2, (t - 0.18) * 0.4);
      ctx.save();
      ctx.globalAlpha = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
      ctx.translate(it.x, it.y);
      ctx.scale(pop, pop);
      ctx.font = `900 ${it.size}px Nunito, ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(4, it.size / 5);
      ctx.strokeStyle = "#0b2a6b";
      ctx.strokeText(it.text, 0, 0);
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, 0, 0);
      ctx.restore();
    } else if (it.kind === "spark") {
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.size * (0.3 + easeOut(t) * 0.9), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Підключає fx до canvas. Повертає { fx, kick(), resize(), destroy() }. rAF працює лише коли є елементи. */
export function attachFx(canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext("2d");
  const fx = createFx();
  let raf = 0, last = 0, w = 0, h = 0, dpr = 1;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1); // на слабких екранах більше 2× не потрібно
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const frame = (ts) => {
    const dt = last ? (ts - last) / 1000 : 0.016;
    last = ts;
    const n = step(fx, dt);
    draw(ctx, fx, w, h);
    if (n > 0) raf = requestAnimationFrame(frame);
    else { raf = 0; last = 0; ctx.clearRect(0, 0, w, h); }
  };
  resize();
  return {
    fx,
    size: () => ({ w, h }),
    kick() { if (!raf && !reducedMotion) raf = requestAnimationFrame(frame); },
    resize,
    destroy() { if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}
