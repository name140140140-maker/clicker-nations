import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/core/storeCore.js";

test("store: set сповіщає лише при зміні значення", () => {
  const st = createStore({ a: 1 });
  let n = 0;
  const off = st.subscribe(() => n++);
  const same = st.getState();
  st.set(same);
  assert.equal(n, 0);
  st.set({ a: 2 });
  assert.equal(n, 1);
  assert.equal(st.getState().a, 2);
  off();
  st.set({ a: 3 });
  assert.equal(n, 1);
});
