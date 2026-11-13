/* Модель пандемії: хвороби (заразність, летальність), поширення між країнами, закриті кордони, місцеві спалахи.

   Усе обчислюється детерміновано з розкладу подій, закритих кордонів і налаштувань адміна — без сервера й cron,
   тож в усіх гравців однакова картина.

   • Поширення: країни — вершини графа. Ребра: наземні/морські сусіди (5 найближчих за відстанню) і «повітряні»
     лінії між 34 найбільшими хабами. Час передачі = відстань / швидкість хвороби (контактні хвороби повільні,
     повітряно-крапельні швидкі); повітряні лінії діють лише для хвороб, що передаються по повітрю.
   • Закритий кордон між двома країнами блокує передачу між ними (в обидва боки) з моменту закриття.
     Заразитися цим шляхом пізніше вже не можна, але країна, яку вже заразили, від закриття не одужує.
   • Місцевий спалах у країні: після прибуття вірусу інфікована частка росте й спадає за L днів (синус);
     померлі накопичуються за інтегралом цієї кривої: усього померлих = inf × cfr × K від населення. */

import { GEO } from "./countryGeo.js";

const DAY = 864e5;
const K_DEATH = 3; // ігрове підсилення втрат, щоб ефект був помітний

/* Детермінований «випадковий» 0..1 за рядковим ключем */
export function rnd(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const pick = (arr, key) => arr[Math.floor(rnd(key) * arr.length) % arr.length];

/* Осередки пандемій: лише ці 20 країн */
export const PANDEMIC_ORIGINS = ["CD", "PG", "BR", "ID", "NG", "UG", "IN", "BD", "CM", "GN", "SL", "LR", "SS", "TZ", "KE", "CN", "VN", "KH", "MY", "BO"];
const AFR = ["CD", "NG", "UG", "CM", "GN", "SL", "LR", "SS", "TZ", "KE"];
const ASIA = ["IN", "BD", "CN", "VN", "KH", "MY", "ID", "PG"];
const AM = ["BR", "BO"];
const ALL20 = PANDEMIC_ORIGINS;

/* Хвороби.
   inf — пік зараженої частки населення країни (%), cfr — летальність серед хворих (%), v — швидкість наземного
   поширення (км/добу), air — наскільки хвороба передається авіа (0–1), L — тривалість місцевого спалаху (днів),
   contag — заразність 1–5 для відображення, where — де хвороба характерна (осередки). */
export const DISEASES = [
  { n: "Чума", where: ALL20, inf: 0.8, cfr: 30, v: 220, air: 0.15, L: 12, contag: 3 },
  { n: "Холера", where: [...AFR, "BD", "IN", "PG", "ID"], inf: 3, cfr: 2.5, v: 160, air: 0.05, L: 12, contag: 3 },
  { n: "Ебола", where: AFR, inf: 0.15, cfr: 45, v: 90, air: 0.03, L: 18, contag: 2 },
  { n: "Марбург", where: ["UG", "TZ", "KE", "CD", "GN", "SL"], inf: 0.1, cfr: 50, v: 80, air: 0.02, L: 16, contag: 2 },
  { n: "Вірус Ніпах", where: ["BD", "IN", "MY"], inf: 0.05, cfr: 60, v: 70, air: 0.02, L: 14, contag: 1 },
  { n: "Гарячка Ласса", where: ["NG", "GN", "SL", "LR"], inf: 0.3, cfr: 15, v: 100, air: 0.04, L: 16, contag: 2 },
  { n: "Зіка", where: [...AM, "ID", "VN", "KH", "MY", "PG"], inf: 8, cfr: 0.05, v: 140, air: 0.2, L: 14, contag: 3 },
  { n: "Денге", where: [...ASIA, ...AM], inf: 6, cfr: 0.4, v: 130, air: 0.18, L: 14, contag: 3 },
  { n: "Жовта гарячка", where: [...AFR, ...AM], inf: 1, cfr: 7, v: 140, air: 0.1, L: 14, contag: 2 },
  { n: "Пташиний грип", where: ["CN", "VN", "KH", "ID", "IN", "BD", "MY"], inf: 0.4, cfr: 40, v: 160, air: 0.14, L: 10, contag: 1 },
  { n: "Свинячий грип", where: [...AM, "CN", "VN"], inf: 18, cfr: 0.08, v: 900, air: 0.7, L: 10, contag: 5 },
  { n: "Коронавірус", where: ["CN", "VN", "KH", "MY", "ID"], inf: 25, cfr: 1.2, v: 1100, air: 0.75, L: 12, contag: 5 },
  { n: "SARS", where: ["CN", "VN"], inf: 1.2, cfr: 10, v: 300, air: 0.35, L: 10, contag: 4 },
  { n: "MERS", where: ALL20, inf: 0.3, cfr: 35, v: 200, air: 0.2, L: 12, contag: 2 },
  { n: "Віспа мавп", where: AFR, inf: 0.5, cfr: 3, v: 150, air: 0.15, L: 14, contag: 2 },
  { n: "Поліомієліт", where: ["NG", "PG", "IN", "BD", "ID", "CM", "CD"], inf: 0.4, cfr: 5, v: 130, air: 0.08, L: 16, contag: 2 },
  { n: "Туберкульоз", where: ["IN", "ID", "PG", "NG", "CD", "BD"], inf: 1, cfr: 12, v: 80, air: 0.1, L: 20, contag: 2 },
  { n: "Малярія", where: [...AFR, "PG", "IN"], inf: 5, cfr: 0.3, v: 90, air: 0.05, L: 16, contag: 2 },
  { n: "Черевний тиф", where: ["IN", "BD", "PG", "CD", "UG"], inf: 2, cfr: 1, v: 110, air: 0.05, L: 14, contag: 2 },
  { n: "Гарячка Західного Нілу", where: ["KE", "UG", "BR", "IN", "TZ"], inf: 1.5, cfr: 1.5, v: 130, air: 0.03, L: 12, contag: 2 },
];
export const diseaseByName = (n) => DISEASES.find((d) => d.n === n) || DISEASES[0];
export const CONTAG_LABEL = ["", "низька", "помірна", "висока", "дуже висока", "надзвичайна"];
export const lethalLabel = (cfr) => (cfr >= 30 ? "дуже висока" : cfr >= 8 ? "висока" : cfr >= 1 ? "помірна" : "низька");

/* Осередок і хвороба: хвороба обирається з тих, що характерні для країни-осередку */
export function pickPandemic(seed, forcedCode = null, forcedDisease = null) {
  const code = forcedCode || pick(PANDEMIC_ORIGINS, "pc" + seed);
  let d = forcedDisease ? DISEASES.find((x) => x.n === forcedDisease) : null;
  if (!d) {
    const fit = DISEASES.filter((x) => x.where.includes(code));
    d = pick(fit.length ? fit : DISEASES, "pn" + seed);
  }
  return { code, disease: d.n };
}

/* ---------- Стан: закриті кордони й налаштування адміна ---------- */
const pairKey = (a, b) => (a < b ? a + "~" + b : b + "~" + a);
let STATE = { borders: new Map(), manual: [], cancelAt: 0, cures: new Map(), version: 0, sig: "" };
export const stateVersion = () => STATE.version;
export const getManualPandemics = () => STATE.manual;
export const getCancelAt = () => STATE.cancelAt;
/* Знищений вірус у країні: ключ "<id пандемії>|<країна>" → мс */
export const getCures = () => [...STATE.cures].map(([k, ts]) => { const [id, code] = k.split("|"); return { id, code, ts }; });
export const cureTs = (e, code) => STATE.cures.get(e.id + "|" + code);

/* borders: [{ a, b, hist: [[since, until|0], …] }]; cfg: { manual: [{ id, code, disease, start, dur }], cancelAt } */
export function setPandemicState({ borders = [], cfg, cures } = {}) {
  const m = new Map();
  for (const b of borders || []) {
    if (!b || !GEO[b.a] || !GEO[b.b] || !Array.isArray(b.hist)) continue;
    m.set(pairKey(b.a, b.b), b.hist.map((h) => [Number(h[0]) || 0, Number(h[1]) || Infinity]));
  }
  /* cfg === undefined — налаштування адміна не змінюємо (оновлюємо лише кордони) */
  const manual = cfg === undefined ? STATE.manual : Array.isArray(cfg?.manual) ? cfg.manual.filter((x) => x && x.id && GEO[x.code] && typeof x.start === "number") : [];
  const cancelAt = cfg === undefined ? STATE.cancelAt : Number(cfg?.cancelAt) || 0;
  /* cures === undefined — перелік знищених вірусів не змінюємо */
  let cm = STATE.cures;
  if (cures !== undefined) {
    cm = new Map();
    for (const c of cures || []) if (c && c.id && GEO[c.code] && Number(c.ts)) cm.set(c.id + "|" + c.code, Number(c.ts));
  }
  const sig = JSON.stringify([[...m], manual, cancelAt, [...cm]]);
  if (sig === STATE.sig) return false;
  STATE = { borders: m, manual, cancelAt, cures: cm, version: STATE.version + 1, sig };
  OUT.clear();
  notifyPandemicChange();
  return true;
}
export function isBorderClosed(a, b, now = Date.now()) {
  const iv = STATE.borders.get(pairKey(a, b));
  return !!iv && iv.some(([s, u]) => now >= s && now < u);
}
export function closedBordersOf(code, now = Date.now()) {
  const out = [];
  for (const [id, iv] of STATE.borders) {
    const [a, b] = id.split("~");
    if (a !== code && b !== code) continue;
    if (iv.some(([s, u]) => now >= s && now < u)) out.push(a === code ? b : a);
  }
  return out;
}

/* ---------- Граф поширення ---------- */
const HUBS = ["CN", "IN", "US", "ID", "PK", "NG", "BR", "BD", "RU", "ET", "MX", "JP", "EG", "PH", "CD", "VN", "IR", "TR", "DE", "TZ", "GB", "FR", "TH", "ZA", "IT", "KE", "KR", "CO", "ES", "AR", "SA", "AE", "SG", "NL"];
let G = null;
function km(a, b) {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR;
  const dLng = (b[1] - a[1]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
function graph() {
  if (G) return G;
  const codes = Object.keys(GEO);
  const adj = {};
  for (const c of codes) adj[c] = new Map();
  const add = (a, b, air) => {
    const d = km(GEO[a], GEO[b]);
    const prev = adj[a].get(b);
    if (!prev || (prev.air && !air)) {
      adj[a].set(b, { km: d, air });
      adj[b].set(a, { km: d, air });
    }
  };
  for (const a of codes) {
    const near = codes.filter((b) => b !== a).map((b) => [b, km(GEO[a], GEO[b])]).sort((x, y) => x[1] - y[1]).slice(0, 5);
    for (const [b] of near) add(a, b, false);
  }
  const hubs = HUBS.filter((h) => GEO[h]);
  for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) add(hubs[i], hubs[j], true);
  G = { codes, adj };
  return G;
}

/* ---------- Події-пандемії ---------- */
/* e: { id, type:"pandemic", code (осередок), disease, start (мс), dur (вікно поширення, днів) } */
const OUT = new Map();
function cancelFor(e) {
  return STATE.cancelAt && e.start <= STATE.cancelAt ? STATE.cancelAt : Infinity;
}
export function outbreak(e) {
  const key = e.id + "|" + STATE.version;
  const hit = OUT.get(key);
  if (hit) return hit;
  const d = diseaseByName(e.disease);
  const S = e.dur;
  const cancel = cancelFor(e);
  const { adj } = graph();
  const arr = {};
  const done = new Set();
  arr[e.code] = 0;
  for (;;) {
    let u = null;
    for (const c in arr) if (!done.has(c) && (u === null || arr[c] < arr[u])) u = c;
    if (u === null) break;
    done.add(u);
    for (const [v, ed] of adj[u]) {
      if (done.has(v)) continue;
      const ek = pairKey(u, v);
      let t;
      if (ed.air) {
        if (rnd("air|" + e.id + ek) >= d.air * d.air) continue;
        t = 1.5 + 4 * rnd("at|" + e.id + ek);
      } else {
        t = (ed.km / d.v) * (0.7 + 0.6 * rnd("lt|" + e.id + ek));
      }
      let tc = arr[u] + t;
      if (tc > S) continue;
      const cu = STATE.cures.get(e.id + "|" + u);
      if (cu !== undefined && e.start + tc * DAY > cu) continue; // країна вже вилікувана й вірус далі не передає
      const iv = STATE.borders.get(ek);
      if (iv) {
        for (let loop = 0; loop < 6; loop++) {
          const abs = e.start + tc * DAY;
          const h = iv.find(([s, un]) => abs >= s && abs < un);
          if (!h) break;
          if (!isFinite(h[1])) { tc = Infinity; break; }
          tc = (h[1] - e.start) / DAY;
        }
        if (tc > S) continue;
      }
      if (e.start + tc * DAY > cancel) continue;
      if (arr[v] === undefined || tc < arr[v]) arr[v] = tc;
    }
  }
  OUT.set(key, arr);
  return arr;
}
const bump = (x) => (x <= 0 ? 0 : x < 1 ? Math.sin((Math.PI * x) / 2) : 1); // наростання, далі плато до знищення вірусу
const F = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : (1 - Math.cos(Math.PI * x)) / 2);
/* Накопичена частка померлих (відносно deathTot): за L днів зростає до 1, далі повільно, поки вірус не знищено */
const D = (x) => (x <= 0 ? 0 : x < 1 ? F(x) : 1 + 0.25 * (x - 1));

/* Пандемії, що почались до цієї дати, скінчаються самі (стара поведінка); пізніші тривають, доки їх не знищать */
export const PERSIST_FROM = Date.UTC(2026, 10, 13);
function stopOf(e, code, A, L) {
  return Math.min(cancelFor(e), STATE.cures.get(e.id + "|" + code) ?? Infinity, e.start < PERSIST_FROM ? A + L : Infinity);
}

/* Параметри місцевого спалаху в країні (null — вірус сюди не дійшов).
   Вірус у країні триває, доки його не знищать (cures) або адмін не скасує пандемію. */
function local(e, code) {
  const a = outbreak(e)[code];
  if (a === undefined) return null;
  const d = diseaseByName(e.disease);
  const susc = 0.6 + 0.8 * rnd("su|" + e.id + code);
  const boost = code === e.code ? 1.5 : 1;
  const peak = Math.min(0.6, (d.inf / 100) * susc * boost);
  const L = d.L * DAY;
  const A = e.start + a * DAY;
  const stop = stopOf(e, code, A, L); // момент, з якого вірус тут зупинено
  return { A, L, peak, deathTot: Math.min(0.2, peak * (d.cfr / 100) * K_DEATH), d, stop, arrival: a };
}
const deathsAt = (l, t) => Math.min(0.3, l.deathTot * D((Math.min(t, l.stop) - l.A) / l.L));

/* Стан країни за однією пандемією на момент now */
export function countryStatus(e, code, now = Date.now()) {
  const l = local(e, code);
  if (!l) return null;
  const x = (now - l.A) / l.L;
  return {
    arrived: now >= l.A,
    cured: now >= l.stop && l.stop !== Infinity,
    infected: now < l.stop && x > 0 ? Math.min(0.9, l.peak * bump(x)) : 0, // частка населення, що хворіє зараз
    deaths: deathsAt(l, now), // частка населення, що вже померла
    arrivalTs: l.A,
  };
}

/* Добовий вплив пандемії на населення країни за добу day: від'ємна частка */
export function popRate(e, code, day) {
  const l = local(e, code);
  if (!l) return 0;
  return -(deathsAt(l, (day + 1) * DAY) - deathsAt(l, day * DAY));
}

/* Момент завершення пандемії: коли вірус зупинено в усіх країнах (або скасовано адміном); Infinity — триває */
export function pandemicEnd(e) {
  const d = diseaseByName(e.disease);
  let end = e.start;
  const arr = outbreak(e);
  for (const code in arr) {
    const st = stopOf(e, code, e.start + arr[code] * DAY, d.L * DAY);
    if (st === Infinity) return Infinity;
    end = Math.max(end, st);
  }
  return end;
}

/* Країни, куди вірус дійшов, у порядку прибуття: [{ code, ts }] */
export function arrivals(e) {
  const a = outbreak(e);
  return Object.keys(a).map((code) => ({ code, ts: e.start + a[code] * DAY })).sort((x, y) => x.ts - y.ts);
}

/* ---------- Підписка на зміни стану (для React) ---------- */
const listeners = new Set();
export function onPandemicChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function notifyPandemicChange() {
  for (const cb of listeners) {
    try { cb(); } catch { /* ignore */ }
  }
}
