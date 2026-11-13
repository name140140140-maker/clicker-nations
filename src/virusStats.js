/* Зведені дані про пандемії для інтерфейсу: країни, карта вірусу, світові підсумки. */
import { activePandemics } from "./worldEvents.js";
import { countryStatus, arrivals, diseaseByName, CONTAG_LABEL, lethalLabel, closedBordersOf } from "./pandemic.js";
import { realPopulation } from "./population.js";

/* { [код]: { infected, deaths, arrived, list: [{ e, infected, deaths }] } } — на момент now */
export function virusByCountry(now = Date.now()) {
  const out = {};
  for (const e of activePandemics(now)) {
    for (const a of arrivals(e)) {
      const st = countryStatus(e, a.code, now);
      if (!st || !st.arrived) continue;
      const row = out[a.code] || (out[a.code] = { infected: 0, deaths: 0, arrived: true, list: [] });
      row.infected = Math.min(0.9, row.infected + st.infected);
      row.deaths = Math.min(0.5, row.deaths + st.deaths);
      row.list.push({ e, infected: st.infected, deaths: st.deaths, cured: st.cured, arrivalTs: st.arrivalTs });
    }
  }
  return out;
}

/* Підсумок по кожній активній пандемії: країни, хворі й померлі (люди) */
export function worldVirus(now = Date.now()) {
  return activePandemics(now).map((e) => {
    const d = diseaseByName(e.disease);
    let nowIll = 0;
    let dead = 0;
    let countries = 0;
    let sick = 0;
    for (const a of arrivals(e)) {
      const st = countryStatus(e, a.code, now);
      if (!st || !st.arrived) continue;
      countries += 1;
      const pop = realPopulation(a.code);
      nowIll += st.infected * pop;
      dead += st.deaths * pop;
      if (st.infected > 0) sick += 1;
    }
    return { e, disease: e.disease, origin: e.code, countries, sick, ill: Math.round(nowIll), dead: Math.round(dead), contag: CONTAG_LABEL[d.contag], lethal: lethalLabel(d.cfr), cfr: d.cfr };
  });
}

export const closedBorders = closedBordersOf;

/* Компактні числа: 1,2 млн / 34 тис. */
export function fmtBig(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(".", ",") + " млрд";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + " млн";
  if (n >= 1e3) return Math.round(n / 1e3) + " тис.";
  return String(Math.round(n));
}
export const fmtPct = (x) => (x * 100 >= 10 ? (x * 100).toFixed(0) : x * 100 >= 1 ? (x * 100).toFixed(1) : (x * 100).toFixed(2)).replace(".", ",") + "%";

/* Кольори карти вірусу. metric: "sick" — хворі зараз, "dead" — померлі */
export const VIRUS_HEALTHY = "#7ccf8a";
export const VIRUS_SCALE = {
  sick: [
    [0, "#d9e36a", "до 0,05%"],
    [0.0005, "#f2d24b", "0,05–0,3%"],
    [0.003, "#f59f42", "0,3–1%"],
    [0.01, "#ee6a3a", "1–3%"],
    [0.03, "#d92f2f", "3–8%"],
    [0.08, "#8c1020", "понад 8%"],
  ],
  dead: [
    [0, "#cfc3e6", "до 0,01%"],
    [0.0001, "#b394dd", "0,01–0,05%"],
    [0.0005, "#8a5ccf", "0,05–0,15%"],
    [0.0015, "#5f2fa0", "0,15–0,4%"],
    [0.004, "#2d0f5a", "понад 0,4%"],
  ],
};
export function virusColor(row, metric) {
  if (!row) return VIRUS_HEALTHY;
  const v = metric === "dead" ? row.deaths : row.infected;
  const sc = VIRUS_SCALE[metric === "dead" ? "dead" : "sick"];
  let c = sc[0][1];
  for (const [th, col] of sc) if (v >= th) c = col;
  return c;
}
