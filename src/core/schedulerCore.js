/* Єдиний планувальник періодичних завдань (чистий модуль: час і таймери передаються ззовні, тому тестується без браузера).
   Замість десятка окремих setInterval — один системний таймер, який спрацьовує лише на найближчий дедлайн.
   Поки вкладка/Telegram згорнуті (isVisible() === false), завдання не виконуються; після повернення кожне прострочене
   завдання виконується один раз (без «навали» пропущених тиків). */

/** @param {{now: () => number, setTimer: (fn: Function, ms: number) => any, clearTimer: (h: any) => void, isVisible: () => boolean}} env */
export function createScheduler(env) {
  const tasks = new Map(); // id -> { fn, ms, next, always }
  let seq = 0;
  let handle = null;
  let handleAt = 0;

  const stop = () => { if (handle !== null) { env.clearTimer(handle); handle = null; handleAt = 0; } };

  function arm() {
    if (!tasks.size) return stop();
    if (!env.isVisible()) {
      // згорнуто: будимо лише завдання з always (рідко потрібні); інакше таймер не тримаємо
      let min = Infinity;
      for (const t of tasks.values()) if (t.always && t.next < min) min = t.next;
      if (min === Infinity) return stop();
      return schedule(min);
    }
    let min = Infinity;
    for (const t of tasks.values()) if (t.next < min) min = t.next;
    schedule(min);
  }

  function schedule(at) {
    if (handle !== null && handleAt <= at && handleAt >= env.now()) return; // вже стоїть не пізніше
    stop();
    handleAt = at;
    handle = env.setTimer(run, Math.max(0, at - env.now()));
  }

  function run() {
    handle = null; handleAt = 0;
    const now = env.now();
    const visible = env.isVisible();
    for (const [id, t] of [...tasks]) {
      if (t.next > now) continue;
      if (!visible && !t.always) { t.next = now + t.ms; continue; }
      t.next = now + t.ms; // спершу переносимо: помилка в fn не зупинить планувальник
      try { t.fn(); } catch (e) { if (typeof console !== "undefined") console.error("[scheduler]", e); }
      if (!tasks.has(id)) continue;
    }
    arm();
  }

  return {
    /** Додає періодичне завдання; повертає числовий id для cancel. */
    every(fn, ms, opts = {}) {
      const id = ++seq;
      tasks.set(id, { fn, ms: Math.max(10, ms | 0), next: env.now() + Math.max(10, ms | 0), always: !!opts.always });
      arm();
      return id;
    },
    cancel(id) {
      tasks.delete(id);
      arm();
    },
    /** Викликати при visibilitychange: прострочені завдання виконуються одразу один раз. */
    wake() {
      stop();
      if (env.isVisible()) run(); else arm();
    },
    size: () => tasks.size,
    hasTimer: () => handle !== null,
  };
}
