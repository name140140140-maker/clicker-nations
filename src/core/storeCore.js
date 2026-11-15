/* Мінімальний зовнішній стор без React (чистий модуль, тестується в tests/store.test.mjs). */
/** @template T @param {T} initial */
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    getState: () => state,
    /** Замінює стан; підписників сповіщає лише якщо значення змінилось (Object.is). */
    set(next) {
      if (Object.is(next, state)) return;
      state = next;
      for (const fn of [...subs]) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
