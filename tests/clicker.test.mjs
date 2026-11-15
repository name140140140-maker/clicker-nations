import test from "node:test";
import assert from "node:assert/strict";
import { COMBO_WINDOW_MS, COMBO_LEVELS, comboTap, comboAlive, comboProgress, comboLevelIndex, newCombo } from "../src/clicker/combo.js";
import { createFx, spawnText, spawnSparks, spawnRing, step, MAX_ITEMS } from "../src/clicker/fx.js";
import { seasonClicks, seasonPath, dailyGoals, rollBaseline, dayKey, DAILY_GOALS } from "../src/clicker/progress.js";
import { PASS_REV, PASS_MAX_LEVEL } from "../src/progressData.js";

test("комбо: наростає в межах вікна й скидається після паузи", () => {
  let s = newCombo(); let t = 1000;
  for (let i = 0; i < 5; i++) { s = comboTap(s, t).state; t += 200; }
  assert.equal(s.count, 5);
  s = comboTap(s, t + COMBO_WINDOW_MS + 1).state;
  assert.equal(s.count, 1);
  assert.equal(s.best, 5);
});
test("комбо: рівні вмикаються на порогах і повертають levelUp лише раз", () => {
  let s = newCombo(); let t = 1000; const ups = [];
  for (let i = 0; i < 101; i++) { const r = comboTap(s, t); s = r.state; if (r.levelUp) ups.push([s.count, r.levelUp]); t += 100; }
  assert.deepEqual(ups, [[10, 1], [25, 2], [50, 3], [100, 4]]);
  assert.equal(comboLevelIndex(9), 0); assert.equal(comboLevelIndex(10), 1);
});
test("комбо: alive і прогрес до наступного рівня", () => {
  const s = comboTap(newCombo(), 5000).state;
  assert.ok(comboAlive(s, 5000 + COMBO_WINDOW_MS)); assert.ok(!comboAlive(s, 5000 + COMBO_WINDOW_MS + 1));
  assert.equal(comboProgress(0).pct, 0);
  assert.equal(comboProgress(5).pct, 50); assert.equal(comboProgress(5).next.at, 10);
  assert.equal(comboProgress(500).next, null); assert.equal(comboProgress(500).pct, 100);
  assert.equal(COMBO_LEVELS[0].at, 0);
});

test("fx: пул обмежений, елементи згасають, фізика детермінована", () => {
  const fx = createFx(); let k = 0; const rnd = () => ((k++ * 0.37) % 1);
  for (let i = 0; i < 200; i++) spawnSparks(fx, 10, 10, 6, { rnd });
  assert.ok(fx.items.length <= MAX_ITEMS);
  spawnText(fx, 5, 5, "+1", { rnd }); spawnRing(fx, 5, 5);
  let alive = fx.items.length;
  for (let i = 0; i < 100; i++) alive = step(fx, 0.02);
  assert.equal(alive, 0);
});
test("fx: великий dt (після сплячки) обмежується й не телепортує", () => {
  const fx = createFx(); spawnText(fx, 0, 100, "+1", { rnd: () => 0.5, rise: 70, life: 0.75 });
  step(fx, 10);
  assert.ok(fx.items.length === 1 || fx.items.length === 0);
  if (fx.items.length) assert.ok(fx.items[0].y > 40);
});
test("fx: step рухає іскри вниз гравітацією", () => {
  const fx = createFx(); fx.items.push({ kind: "spark", x: 0, y: 0, vx: 0, vy: 0, life: 1, age: 0, size: 3, color: "#fff" });
  step(fx, 0.05); step(fx, 0.05);
  assert.ok(fx.items[0].vy > 0 && fx.items[0].y > 0);
});

test("шлях сезону: кліки лише з поточної версії, рівень і відсоток", () => {
  assert.equal(seasonClicks(null), 0);
  assert.equal(seasonClicks({ passRev: PASS_REV - 1, totalClicks: 9999, passBaseClicks: 0 }), 0);
  assert.equal(seasonClicks({ passRev: PASS_REV, totalClicks: 1000, passBaseClicks: 400 }), 600);
  const p0 = seasonPath({ passRev: PASS_REV, totalClicks: 0, passBaseClicks: 0 });
  assert.equal(p0.level, 0); assert.ok(p0.toNext > 0); assert.equal(p0.pct, 0);
  const pMax = seasonPath({ passRev: PASS_REV, totalClicks: 10 ** 9, passBaseClicks: 0 });
  assert.equal(pMax.level, PASS_MAX_LEVEL); assert.equal(pMax.pct, 100); assert.equal(pMax.toNext, 0);
  for (let c = 0; c < 20000; c += 777) { const p = seasonPath({ passRev: PASS_REV, totalClicks: c, passBaseClicks: 0 }); assert.ok(p.pct >= 0 && p.pct <= 100); }
});
test("цілі дня: прогрес від baseline, ціль виконана на порозі", () => {
  const g = dailyGoals(1100, 1000);
  assert.equal(g.length, DAILY_GOALS.length);
  assert.ok(g[0].done && !g[1].done); assert.equal(g[1].have, 100); assert.equal(Math.round(g[1].pct), 20);
  assert.ok(dailyGoals(500, 1000).every((x) => x.have === 0)); // baseline більший — без від'ємних
});
test("baseline: нова доба скидає, та сама доба зберігає", () => {
  const t = new Date(2026, 10, 14, 12).getTime();
  const a = rollBaseline(null, 500, t); assert.deepEqual(a, { day: dayKey(t), baseline: 500 });
  assert.deepEqual(rollBaseline(a, 700, t + 3600e3), a);
  const next = rollBaseline(a, 900, t + 24 * 3600e3); assert.equal(next.baseline, 900); assert.notEqual(next.day, a.day);
  assert.equal(rollBaseline({ day: dayKey(t), baseline: 5000 }, 100, t).baseline, 100); // скинуто, якщо baseline > кліків
});
