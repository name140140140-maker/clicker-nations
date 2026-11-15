import test from "node:test";
import assert from "node:assert/strict";
import { publicPlayer, PUBLIC_PLAYER_FIELDS } from "../api/_game/publicPlayer.js";

const rec = {
  id: "p_1", username: "Ann", countryCode: "UA", power: 10, totalClicks: 5, points: 7, hasPremiumPass: true, createdAt: 1,
  telegramId: 123456, tgId: 9, energy: 50, lastEnergyTs: 1, upg: { emax: 3 }, passClaimedFree: [1], unlockedTitles: ["x"],
  blocked: true, blockedReason: "spam", mail: [{ id: "m" }], leaderToken: "secret", equippedBadges: ["a", "b"],
};

test("publicPlayer: не віддає чутливі поля", () => {
  const out = publicPlayer(rec, 99, false);
  for (const k of ["telegramId", "tgId", "energy", "lastEnergyTs", "upg", "passClaimedFree", "unlockedTitles", "blocked", "blockedReason", "mail", "leaderToken"]) {
    assert.ok(!(k in out), "витік поля " + k);
  }
  assert.deepEqual(Object.keys(out).sort(), [...PUBLIC_PLAYER_FIELDS].sort());
});

test("publicPlayer: Power береться з pwr, інакше із запису", () => {
  assert.equal(publicPlayer(rec, 99).power, 99);
  assert.equal(publicPlayer(rec, undefined).power, 10);
});

test("publicPlayer: telegramId лише для адміна", () => {
  assert.equal(publicPlayer(rec, 1, true).telegramId, 123456);
  assert.ok(!("telegramId" in publicPlayer(rec, 1, false)));
});

test("publicPlayer: некоректні дані не ламають відповідь", () => {
  const out = publicPlayer({ id: "x", totalClicks: "abc", equippedBadges: "no" }, NaN);
  assert.equal(out.totalClicks, 0);
  assert.deepEqual(out.equippedBadges, []);
  assert.equal(out.power, 0);
});
