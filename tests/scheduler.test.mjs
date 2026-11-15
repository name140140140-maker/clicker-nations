import test from "node:test";
import assert from "node:assert/strict";
import { createScheduler } from "../src/core/schedulerCore.js";

// Віртуальний годинник і таймер
function makeEnv() {
  const env = { t: 0, visible: true, timers: new Map(), seq: 0 };
  env.now = () => env.t;
  env.setTimer = (fn, ms) => { const id = ++env.seq; env.timers.set(id, { fn, at: env.t + ms }); return id; };
  env.clearTimer = (id) => env.timers.delete(id);
  env.isVisible = () => env.visible;
  env.advance = (ms) => {
    const end = env.t + ms;
    for (;;) {
      let nid = null, nat = Infinity;
      for (const [id, x] of env.timers) if (x.at < nat) { nat = x.at; nid = id; }
      if (nid === null || nat > end) break;
      const x = env.timers.get(nid); env.timers.delete(nid); env.t = nat; x.fn();
    }
    env.t = end;
  };
  return env;
}

test("scheduler: виконує завдання з заданим інтервалом через ОДИН таймер", () => {
  const env = makeEnv(); const s = createScheduler(env);
  let a = 0, b = 0;
  s.every(() => a++, 1000); s.every(() => b++, 5000);
  assert.equal(env.timers.size, 1);
  env.advance(10000);
  assert.equal(a, 10); assert.equal(b, 2);
  assert.equal(env.timers.size, 1);
});

test("scheduler: cancel зупиняє завдання; без завдань таймера немає", () => {
  const env = makeEnv(); const s = createScheduler(env);
  let n = 0; const id = s.every(() => n++, 100);
  env.advance(250); assert.equal(n, 2);
  s.cancel(id); env.advance(1000);
  assert.equal(n, 2); assert.equal(env.timers.size, 0); assert.equal(s.hasTimer(), false);
});

test("scheduler: у згорнутому стані не виконується, після wake — один раз", () => {
  const env = makeEnv(); const s = createScheduler(env);
  let n = 0; s.every(() => n++, 1000);
  env.advance(1500); assert.equal(n, 1);
  env.visible = false; s.wake();
  assert.equal(env.timers.size, 0);
  env.advance(60000); assert.equal(n, 1);
  env.visible = true; s.wake();
  assert.equal(n, 2); // прострочене виконалось рівно раз
  env.advance(1000); assert.equal(n, 3);
});

test("scheduler: помилка в завданні не ламає інші", () => {
  const env = makeEnv(); const s = createScheduler(env);
  const origErr = console.error; console.error = () => {};
  let ok = 0; s.every(() => { throw new Error("x"); }, 100); s.every(() => ok++, 100);
  env.advance(350); console.error = origErr;
  assert.equal(ok, 3);
});

test("scheduler: завдання може скасувати себе всередині виклику", () => {
  const env = makeEnv(); const s = createScheduler(env);
  let n = 0; let id; id = s.every(() => { n++; s.cancel(id); }, 100);
  env.advance(1000); assert.equal(n, 1); assert.equal(s.size(), 0);
});

test("scheduler: always-завдання працює і в згорнутому стані", () => {
  const env = makeEnv(); const s = createScheduler(env);
  let n = 0; s.every(() => n++, 1000, { always: true });
  env.visible = false; s.wake();
  env.advance(3500); assert.equal(n, 3);
});
