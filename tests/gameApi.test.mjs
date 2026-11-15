import test from "node:test";
import assert from "node:assert/strict";

function setup(initData, fetchImpl) {
  globalThis.window = { Telegram: initData ? { WebApp: { initData } } : undefined };
  globalThis.fetch = fetchImpl;
}
const { gameCall, fetchPlayersSnapshot } = await import("../src/core/gameApi.js");

test("gameCall: без initData не робить запит", async () => {
  let called = false;
  setup(null, async () => { called = true; });
  const r = await gameCall("power", { op: "sync" }, { offlineFlag: true });
  assert.equal(called, false);
  assert.equal(r.ok, false);
  assert.equal(r.offline, true);
});

test("gameCall: передає action, op, initData і повертає ok-відповідь", async () => {
  let seen;
  setup("tg=1", async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { status: 200, json: async () => ({ ok: true, power: 5 }) }; });
  const r = await gameCall("power", { op: "sync", pow: 3 });
  assert.equal(seen.url, "/api/game?action=power");
  assert.deepEqual(seen.body, { initData: "tg=1", op: "sync", pow: 3 });
  assert.equal(r.power, 5);
});

test("gameCall: помилка сервера → reason, status лише з extra", async () => {
  setup("tg=1", async () => ({ status: 429, json: async () => ({ ok: false, error: "Забагато" }) }));
  assert.deepEqual(await gameCall("x", {}), { ok: false, reason: "Забагато" });
  assert.deepEqual(await gameCall("x", {}, { extra: true }), { ok: false, reason: "Забагато", status: 429 });
});

test("gameCall: мережева помилка і битий JSON", async () => {
  setup("tg=1", async () => { throw new Error("net"); });
  assert.equal((await gameCall("x")).reason, "Немає зв'язку з сервером");
  setup("tg=1", async () => ({ status: 500, json: async () => { throw new Error("bad"); } }));
  assert.equal((await gameCall("x")).reason, "Немає відповіді сервера");
});

test("fetchPlayersSnapshot: масив або null", async () => {
  setup("tg=1", async () => ({ status: 200, json: async () => ({ ok: true, players: [{ id: "a" }] }) }));
  assert.deepEqual(await fetchPlayersSnapshot(), [{ id: "a" }]);
  setup("tg=1", async () => ({ status: 429, json: async () => ({ ok: false, error: "x" }) }));
  assert.equal(await fetchPlayersSnapshot(), null);
});
