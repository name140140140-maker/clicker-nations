/* Події світу: пандемії, землетруси, санкції, революції.

   Розклад подій детермінований: його вираховують за датою (без сервера й cron), тому в усіх гравців
   події однакові й починаються в той самий момент. Події:
   • потрапляють у «Світові новини» (WC NEWS) і в телевипуск;
   • впливають на населення країн (src/population.js): пандемія — щодня трохи зменшує населення всього світу,
     землетрус — одразу забирає частку населення країни, санкції й революція — тиснуть на країну щодня.
   Баланс війни, кліків і армій події НЕ чіпають. */

const DAY = 864e5;
export const EVT_REF_DAY = Math.floor(Date.UTC(2025, 6, 1) / DAY);

import { rnd, pickPandemic, diseaseByName, CONTAG_LABEL, lethalLabel, getManualPandemics, getCancelAt, getCures, pandemicEnd, popRate, arrivals } from "./pandemic.js";

const pick = (arr, key) => arr[Math.floor(rnd(key) * arr.length) % arr.length];

const QUAKE_CODES = ["JP", "ID", "TR", "CL", "MX", "IR", "PE", "PH", "NP", "IT", "GR", "CN", "US", "NZ", "PK", "AF", "EC", "CO", "GT", "DZ", "TW", "AL", "RO", "IN", "PG", "VU", "SV", "CR", "TJ", "KG", "MA", "SY"];
const SANCTION_CODES = ["RU", "IR", "KP", "BY", "VE", "SY", "CU", "MM", "AF", "NI", "ER", "ZW", "SD", "LY", "IQ", "TR", "CN", "AZ", "CD", "SS"];
const REVOLUTION_CODES = ["AM", "GE", "RS", "BY", "TN", "EG", "BD", "PK", "LK", "KE", "NG", "VE", "BO", "PE", "EC", "CU", "HT", "KG", "KZ", "MD", "ML", "BF", "NE", "MG", "TH", "MM", "IQ", "LB", "SD", "ET", "AO", "UG", "ZW", "MZ", "NP", "AL", "BA", "AR", "CO", "HN"];

const TYPE = {
  pandemic: { emoji: "🦠", label: "Пандемія" },
  quake: { emoji: "🌋", label: "Землетрус" },
  sanction: { emoji: "🚫", label: "Санкції" },
  revolution: { emoji: "✊", label: "Революція" },
};

const dn = typeof Intl !== "undefined" && Intl.DisplayNames ? new Intl.DisplayNames(["uk"], { type: "region" }) : null;
const NAME_FB = { XK: "Косово", TW: "Тайвань" };
const nameOf = (c) => NAME_FB[c] || (dn && (() => { try { return dn.of(c); } catch { return ""; } })()) || c;
const flagOf = (c) => String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0)));
const locIn = (c) => nameOf(c); // назва у називному відмінку: у реченнях уживаємо «у країні X»

const memo = new Map();
function startsOnScheduled(day) {
  if (memo.has(day)) return memo.get(day);
  const out = [];
  if (day >= EVT_REF_DAY) {
    const hour = (k) => 5 + Math.floor(rnd(k + day) * 17); // година UTC 05..21
    /* Пандемії — окремо (scheduledPandemics): вони тривають, доки їх не знищать */
    if (rnd("q" + day) < 0.09) {
      const code = pick(QUAKE_CODES, "qc" + day);
      const mag = Math.round((5.6 + rnd("qm" + day) * 2.6) * 10) / 10;
      out.push({ id: "quake-" + day, type: "quake", code, day, dur: 1, mag, start: day * DAY + hour("qh") * 36e5 });
    }
    if (rnd("s" + day) < 0.06) {
      const code = pick(SANCTION_CODES, "sc" + day);
      out.push({ id: "sanction-" + day, type: "sanction", code, day, dur: 5 + Math.floor(rnd("sd" + day) * 5), start: day * DAY + hour("sh") * 36e5 });
    }
    if (rnd("r" + day) < 0.025) {
      const code = pick(REVOLUTION_CODES, "rc" + day);
      out.push({ id: "revolution-" + day, type: "revolution", code, day, dur: 4 + Math.floor(rnd("rd" + day) * 5), start: day * DAY + hour("rh") * 36e5 });
    }
  }
  memo.set(day, out);
  return out;
}

/* Пандемії за розкладом: у середньому 2 на 50-денний сезон. Час ділиться на 25-денні клітинки; у кожній стартує одна
   пандемія у випадковий день (перші 11 днів) із вікном поширення 8–14 днів. Осередок — одна з 20 країн, хвороба
   підбирається логічно. Пандемія триває, доки її не знищать (або адмін не скасує). */
const pandCells = new Map();
function pandemicOfCell(cell) {
  if (pandCells.has(cell)) return pandCells.get(cell);
  const day = EVT_REF_DAY + cell * 25 + Math.floor(rnd("po" + cell) * 11);
  const pd = pickPandemic(cell);
  const hour = 5 + Math.floor(rnd("ph" + day) * 17);
  const e = { id: "pandemic-" + day, type: "pandemic", code: pd.code, disease: pd.disease, day, dur: 8 + Math.floor(rnd("pd" + cell) * 7), start: day * DAY + hour * 36e5 };
  pandCells.set(cell, e);
  return e;
}
/* Усі пандемії, що почались не пізніше моменту upTo (мс): за розкладом + запущені адміном */
export function allPandemics(upTo = Date.now()) {
  const out = [];
  const lastCell = Math.floor((Math.floor(upTo / DAY) - EVT_REF_DAY) / 25);
  for (let c = 0; c <= lastCell; c++) { const e = pandemicOfCell(c); if (e.start <= upTo) out.push(e); }
  for (const m of getManualPandemics()) {
    if (m.start <= upTo) out.push({ id: m.id, type: "pandemic", code: m.code, disease: pickPandemic(m.id, m.code, m.disease).disease, day: Math.floor(m.start / DAY), dur: m.dur || 12, start: m.start, manual: true });
  }
  return out;
}
/* Події-не-пандемії, що стартують у день day */
function startsOn(day) { return startsOnScheduled(day); }
const cancelled = (e) => e.type === "pandemic" && getCancelAt() && e.start <= getCancelAt();

const fmtMag = (m) => m.toFixed(1).replace(".", ",");
const fmtDate = (ms) => new Date(ms).toLocaleDateString("uk-UA", { day: "numeric", month: "long" });

function describe(e) {
  const n = e.code ? nameOf(e.code) : "";
  const f = e.code ? flagOf(e.code) : "";
  const T = TYPE[e.type];
  if (e.type === "pandemic") {
    const d = diseaseByName(e.disease);
    return {
      head: `Пандемія: ${e.disease}. Осередок спалаху — країна ${f} ${n}.`,
      body: `ВООЗ оголосила глобальну тривогу. Заразність: ${CONTAG_LABEL[d.contag]}, летальність: ${lethalLabel(d.cfr)}. Вірус розходиться між країнами, закритий кордон захищає від нього.`,
      effect: `${e.disease}: осередок — ${n}`,
    };
  }
  if (e.type === "quake") {
    return { head: `Землетрус магнітудою ${fmtMag(e.mag)} у країні ${f} ${n}.`, body: `Рятувальники працюють на місці подій. Країна втратила частину населення.`, effect: `Населення ${n} різко впало` };
  }
  if (e.type === "sanction") {
    const by = pick(["ООН", "ЄС і США", "Рада безпеки ООН", "Група провідних економік"], "sb" + e.day);
    return { head: `Санкції проти країни ${f} ${n}.`, body: `Рішення ухвалили: ${by}. Обмеження діятимуть щонайменше ${e.dur} днів і б'ють по добробуту: люди виїжджають.`, effect: `Населення ${n} повільно скорочується` };
  }
  return { head: `Революція в країні ${f} ${n}.`, body: pick(["Натовпи вийшли на вулиці столиці, влада втрачає контроль.", "Армія відмовилась виконувати накази, у містах заворушення.", "Опозиція проголосила перехідний уряд, тривають зіткнення."], "rb" + e.day) + ` Ситуація нестабільна ${e.dur} днів.`, effect: `Населення ${n} скорочується через втечу й втрати`, emoji: T.emoji };
}

/* Події, що діють у момент now (включно з «сьогодні»). */
const LOOKBACK = 40; // найдовша подія (пандемія з місцевими спалахами) триває до ~34 днів

const endOf = (e) => (e.type === "pandemic" ? pandemicEnd(e) : e.start + e.dur * DAY);

export function activeEvents(now = Date.now()) {
  const today = Math.floor(now / DAY);
  const out = [];
  const evs = [];
  for (let d = today - LOOKBACK; d <= today; d++) evs.push(...startsOn(d));
  evs.push(...allPandemics(now));
  for (const e of evs) {
    const end = endOf(e);
    if (e.start <= now && now < end) out.push({ ...e, end, ...describe(e), meta: e.type === "pandemic" ? { ...TYPE.pandemic, label: "Пандемія: " + e.disease } : TYPE[e.type] });
  }
  return out.sort((a, b) => b.start - a.start);
}
export const activeFor = (code, now = Date.now()) => activeEvents(now).filter((e) => e.type === "pandemic" || e.code === code);
export const activePandemics = (now = Date.now()) => activeEvents(now).filter((e) => e.type === "pandemic");

/* Новини про події для WC NEWS: початки, поширення пандемій, завершення та скасування (лише вже настали). */
export function eventNews(now = Date.now(), lookbackDays = 4) {
  const today = Math.floor(now / DAY);
  const since = now - lookbackDays * DAY;
  const out = [];
  const evs = [];
  for (let d = today - lookbackDays - LOOKBACK; d <= today; d++) evs.push(...startsOn(d));
  evs.push(...allPandemics(now));
  {
    for (const e of evs) {
      const info = describe(e);
      const end = endOf(e);
      const T = TYPE[e.type];
      if (e.start <= now && e.start >= since) out.push({ id: "ev-" + e.id, ts: e.start, text: `${T.emoji} ${info.head} ${info.body}` });
      if (e.type === "pandemic") {
        /* Вірус дістався до нових країн (перші 14 прибуттів, без осередку) */
        const arr = arrivals(e).filter((a) => a.code !== e.code).slice(0, 14);
        arr.forEach((a, i) => {
          if (a.ts <= now && a.ts >= since && (!cancelled(e) || a.ts <= getCancelAt())) {
            out.push({ id: `ev-arr-${e.id}-${a.code}`, ts: a.ts, text: `${T.emoji} ${e.disease}: перші випадки в країні ${flagOf(a.code)} ${nameOf(a.code)}. Заражено країн: ${i + 2}.` });
          }
        });
      }
      if (e.type !== "quake" && isFinite(end) && end <= now && end >= since && !cancelled(e)) {
        const n = e.code ? nameOf(e.code) : "";
        const endText = e.type === "pandemic" ? `Пандемія (${e.disease}) подолана: у всіх країнах вірус знищено. ВООЗ знімає обмеження.`
          : e.type === "sanction" ? `Санкції проти країни ${n} скасовано. Обмеження на торгівлю знято.`
          : `У країні ${n} стабілізувалась ситуація. Нова влада обіцяє вибори.`;
        out.push({ id: "ev-end-" + e.id, ts: end, text: `${T.emoji} ${endText}` });
      }
    }
  }
  for (const c of getCures()) {
    if (c.ts <= now && c.ts >= since) {
      const e = evs.find((x) => x.id === c.id);
      if (e) out.push({ id: `ev-cure-${c.id}-${c.code}`, ts: c.ts, text: `💉 ${e.disease}: країна ${flagOf(c.code)} ${nameOf(c.code)} знищила вірус у себе. Нових заражень там немає.` });
    }
  }
  const ca = getCancelAt();
  if (ca && ca <= now && ca >= since) out.push({ id: "ev-cancel-" + ca, ts: ca, text: "🦠 ВООЗ повідомляє: створено універсальну вакцину, всі пандемії у світі подолано. Обмеження знімаються." });
  return out.sort((a, b) => b.ts - a.ts);
}

/* Добовий вплив подій на населення країни (частка: −0.0003 = −0.03%). Використовує src/population.js. */
export function eventRate(code, day) {
  let r = 0;
  for (const e of allPandemics((day + 1) * DAY - 1)) r += popRate(e, code, day);
  for (let d = day - LOOKBACK; d <= day; d++) {
    for (const e of startsOn(d)) {
      if (day < e.day || day >= e.day + e.dur) continue;
      if (e.code !== code) continue;
      if (e.type === "quake") r -= 0.00002 + ((e.mag - 5.6) / 2.6) * 0.0005; // разовий удар у день землетрусу
      else if (e.type === "sanction") r -= 0.0001;
      else if (e.type === "revolution") r -= 0.0002;
    }
  }
  return r;
}
