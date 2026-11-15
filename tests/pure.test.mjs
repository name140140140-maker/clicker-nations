import test from "node:test";
import assert from "node:assert/strict";
import { cureCost, CURE_MAX } from "../src/cureCost.js";
import { PASS_LEVEL_THRESHOLDS, PASS_MAX_LEVEL, PASS_REWARD_TABLE, currentPassLevel, passReward, UPG_PRICES } from "../src/progressData.js";
import { pickPandemic, PANDEMIC_ORIGINS, DISEASES } from "../src/pandemic.js";

test("cureCost: не перевищує 150% знімка й не від'ємна", () => {
  for (const [snap, inf, dead] of [[1000, 0, 0], [1000, 0.2, 0.01], [1000, 5, 5], [0, 1, 1], [123456, 0.7, 0.3]]) {
    const c = cureCost(snap, inf, dead);
    assert.ok(c.total >= 0);
    assert.ok(c.total <= Math.round(c.snap * CURE_MAX) + 1, JSON.stringify(c));
    assert.equal(c.total, c.base + c.byInf + c.byDead);
  }
});
test("cureCost: ціна не спадає зі зростанням хворих", () => {
  let prev = -1;
  for (let i = 0; i <= 10; i++) { const t = cureCost(100000, i / 10, 0).total; assert.ok(t >= prev); prev = t; }
});

test("Battle Pass: пороги зростають, рівні в межах", () => {
  assert.equal(PASS_LEVEL_THRESHOLDS.length, PASS_MAX_LEVEL + 1);
  for (let i = 1; i < PASS_LEVEL_THRESHOLDS.length; i++) assert.ok(PASS_LEVEL_THRESHOLDS[i] > PASS_LEVEL_THRESHOLDS[i - 1]);
  assert.equal(currentPassLevel(0), 0);
  assert.equal(currentPassLevel(null), 0);
  assert.equal(currentPassLevel(49), 0);
  assert.equal(currentPassLevel(50), 1);
  assert.equal(currentPassLevel(10 ** 9), PASS_MAX_LEVEL);
  let prev = 0;
  for (let c = 0; c <= 31000; c += 37) { const l = currentPassLevel(c); assert.ok(l >= prev); prev = l; }
});
test("Battle Pass: нагороди є для кожного рівня обох треків", () => {
  for (let l = 1; l <= PASS_MAX_LEVEL; l++) for (const t of ["free", "premium"]) {
    const r = passReward(t, l);
    assert.ok(r && r.type, `рівень ${l} ${t}`);
    if (r.type === "points") assert.ok(r.amount > 0);
    else assert.ok(r.id, `немає id для ${l} ${t}`);
  }
  assert.ok(PASS_REWARD_TABLE.length >= PASS_MAX_LEVEL);
});
test("Покращення: ціни зростають", () => {
  for (const k in UPG_PRICES) for (let i = 1; i < UPG_PRICES[k].length; i++) assert.ok(UPG_PRICES[k][i] > UPG_PRICES[k][i - 1]);
});

test("Епідемії: вибір осередку детермінований (однаково на клієнті й сервері)", () => {
  for (let seed = 0; seed < 200; seed++) {
    const a = pickPandemic(seed), b = pickPandemic(seed);
    assert.deepEqual(a, b);
    assert.ok(PANDEMIC_ORIGINS.includes(a.code));
    assert.ok(DISEASES.some((d) => d.n === a.disease));
  }
});
