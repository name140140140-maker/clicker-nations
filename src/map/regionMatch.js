/* Зіставлення назв областей з гри (REGION_DATA) з полігонами топології.
   Ключі cityControl мають вигляд "ISO|назва з гри" — щоб територія змінила
   власника на карті, кожній назві з гри потрібен свій полігон.
   Чисті функції без DOM/React: використовуються і в рантаймі, і в аудит-скриптах. */

const STOP_WORDS =
  /\b(oblast|obwod|region|regiao|province|provincia|prefecture|city|municipality|metropolitan|county|department|departement|district|governorate|gouvernorat|state|territory|autonomous|republic|krai|kray|okrug|capital|federal|special|administrative|area|zone|parish|canton|voivodeship|wilaya|division|commune|of|the|de|du|la|le|el|al)\b/g;

export function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\(.*?\)/g, " ")
    .replace(/['’‘`´]/g, "")
    .replace(STOP_WORDS, " ")
    .replace(/[^a-z]/g, "");
}

/* Фонетичний ключ: стирає відмінності транслітерації (Vinnytsya/Vinnytsia,
   Mykolayiv/Mykolaiv, Zaporizhzhya/Zaporizhia, Gorno-Altay/Gorno-Altai). */
export function phoneticKey(norm) {
  return norm
    .replace(/tch|ch|sh|zh|kh|ts|ph|ck/g, (m) => ({ tch: "c", ch: "c", sh: "s", zh: "z", kh: "h", ts: "c", ph: "f", ck: "k" }[m]))
    .replace(/y/g, "i")
    .replace(/j/g, "i")
    .replace(/w/g, "v")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/ou/g, "u")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/ii+/g, "i");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const similarity = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

/* Алиаси: назва з гри (нормалізована) → можливі назви на карті.
   Глобальні — для відомих розбіжностей; "ISO:назва" — тільки для країни. */
const ALIASES = {
  "kirovohrad": ["kropyvnytskyi", "kirovograd"],
  "transcarpathia": ["zakarpattia", "zakarpatska", "zakarpattya"],
  "lviv": ["lvivska", "lvov"],
  "odessa": ["odesa", "odeska"],
  "crimea": ["avtonomnarespublikakrym", "autonomousrepublicofcrimea", "krym"],
  "kyivcity": ["kyiv", "kiev", "misto kyiv"],
  "kiev": ["kyiv"],
  "kyiv": ["kiev", "kyivcity"],
  "RU:gornoaltay": ["altai republic", "altairepublic"],
  "RU:altay": ["altai krai"],
  "RU:buryat": ["buryatia", "buryatiya"],
  "RU:yevrey": ["jewish", "jewishautonomous", "jewish autonomous oblast"],
  "RU:primorie": ["primorsky", "primorskiy"],
  "RU:primorye": ["primorsky", "primorskiy"],
  "RU:chukchi": ["chukotka", "chukotkaautonomous"],
  "RU:yamalnenets": ["yamalonenets", "yamalo nenets"],
  "RU:khantymansi": ["khantymansiyskyugra", "khanty mansi"],
  "RU:kabardinobalkar": ["kabardinobalkaria", "kabardino balkar"],
  "RU:karachayevcherkess": ["karachaycherkessia", "karachay cherkess"],
  "RU:northosetia": ["northossetiaalania", "north ossetia"],
  "RU:chechen": ["chechnya"],
  "RU:chuvash": ["chuvashia"],
  "RU:mariel": ["mariel", "mari el"],
  "RU:mordovia": ["mordovia"],
  "RU:udmurt": ["udmurtia"],
  "RU:tatarstan": ["tatarstan"],
  "RU:bashkortostan": ["bashkortostan", "bashkiria"],
  "RU:komi": ["komi"],
  "RU:sakha": ["sakha", "yakutia"],
  "RU:tuva": ["tuva", "tyva"],
  "RU:khakassia": ["khakassia"],
  "RU:kalmyk": ["kalmykia"],
  "RU:adygey": ["adygea"],
  "RU:dagestan": ["dagestan"],
  "RU:ingush": ["ingushetia"],
  "RU:perm": ["perm"],
  "RU:stpetersburg": ["saintpetersburg", "sankt petersburg"],
  "CN:xizang": ["tibet"],
  "CN:innermongol": ["innermongolia", "neimenggu"],
  "CN:xinjiang": ["xinjiangUyghur", "xinjiang uygur"],
  "CN:ningxia": ["ningxiaHui", "ningxia hui"],
  "CN:guangxi": ["guangxiZhuang", "guangxi zhuang"],
  "CN:hongkong": ["hongkongsar"],
  "CN:macau": ["macao", "macausar"],
  "CZ:praha": ["prague"],
  "PL:mazowieckie": ["masovian"],
  "IN:andamanandnicobar": ["andamanandnicobarislands"],
};

function aliasCandidates(iso, norm) {
  const out = [];
  for (const k of [`${iso}:${norm}`, norm]) {
    const list = ALIASES[k];
    if (list) for (const a of list) out.push(normalizeName(a));
  }
  return out;
}

/* topoRegions: [{ i, name }]; gameRegions: [{ name }]
   → { [gameName]: topoIndex } для однієї країни. */
export function matchCountry(iso, topoRegions, gameRegions, overrides = {}) {
  const T = topoRegions.map((t) => {
    const n = normalizeName(t.name);
    return { i: t.i, name: t.name, n, p: phoneticKey(n), taken: false };
  });
  const G = gameRegions.map((g) => {
    const n = normalizeName(g.name);
    return { name: g.name, n, p: phoneticKey(n), matched: -1 };
  });
  const pair = (g, t) => { g.matched = t.i; t.taken = true; };
  const free = (arr) => arr.filter((x) => (x.taken === undefined ? x.matched < 0 : !x.taken));

  // 0. Явні відповідності (згенеровані за геометрією, tools/build-region-overrides.mjs)
  for (const g of G) {
    const wanted = overrides[g.name];
    if (!wanted) continue;
    const t = T.find((x) => !x.taken && x.name === wanted);
    if (t) pair(g, t);
  }

  const passes = [
    (g, t) => g.n && g.n === t.n,
    (g, t) => g.p && g.p === t.p,
    (g, t) => aliasCandidates(iso, g.n).some((a) => a === t.n || phoneticKey(a) === t.p),
    (g, t) => g.p.length >= 4 && t.p.length >= 4 && (t.p.includes(g.p) || g.p.includes(t.p)) && Math.min(g.p.length, t.p.length) / Math.max(g.p.length, t.p.length) >= 0.55,
  ];
  for (const test of passes) {
    for (const g of free(G)) {
      const cands = free(T).filter((t) => test(g, t));
      if (cands.length === 1) pair(g, cands[0]);
      else if (cands.length > 1) {
        // неоднозначно — беремо найближчий за довжиною
        cands.sort((a, b) => Math.abs(a.p.length - g.p.length) - Math.abs(b.p.length - g.p.length));
        pair(g, cands[0]);
      }
    }
  }
  // нечіткий збіг — глобально найкращі пари
  const scored = [];
  for (const g of free(G)) for (const t of free(T)) {
    if (g.p.length < 4 || t.p.length < 4) continue;
    const s = similarity(g.p, t.p);
    if (s >= 0.74) scored.push({ g, t, s });
  }
  scored.sort((a, b) => b.s - a.s);
  for (const { g, t } of scored) if (g.matched < 0 && !t.taken) pair(g, t);
  // залишилась рівно по одній — парою за відсіканням (лише коли кількості збігаються)
  const fg = free(G), ft = free(T);
  if (fg.length === 1 && ft.length === 1 && G.length === T.length) pair(fg[0], ft[0]);

  const out = {};
  for (const g of G) if (g.matched >= 0) out[g.name] = g.matched;
  return out;
}

/* Усі країни одразу: topoByIso: { ISO: [{i,name}] }, regionData: { ISO: { regions:[{name}] } }
   → { ISO: { gameName: topoIndex } } + статистика покриття. */
export function matchAll(topoByIso, regionData, overrides = {}) {
  const result = {};
  let total = 0, hit = 0;
  const perCountry = {};
  for (const iso of Object.keys(regionData || {})) {
    const T = topoByIso[iso];
    const gr = regionData[iso]?.regions || [];
    total += gr.length;
    if (!T || !gr.length) { perCountry[iso] = { game: gr.length, hit: 0, topo: T ? T.length : 0 }; continue; }
    const m = matchCountry(iso, T, gr, overrides[iso] || {});
    result[iso] = m;
    const h = Object.keys(m).length;
    hit += h;
    perCountry[iso] = { game: gr.length, hit: h, topo: T.length };
  }
  return { map: result, total, hit, perCountry };
}

/* Те саме, але віддає кадр браузеру між країнами — для рантайму на телефонах. */
export async function matchAllAsync(topoByIso, regionData, overrides = {}, yieldFn = async () => {}) {
  const result = {};
  let total = 0, hit = 0;
  const perCountry = {};
  let sliceStart = performance.now();
  for (const iso of Object.keys(regionData || {})) {
    const T = topoByIso[iso];
    const gr = regionData[iso]?.regions || [];
    total += gr.length;
    if (!T || !gr.length) { perCountry[iso] = { game: gr.length, hit: 0, topo: T ? T.length : 0 }; continue; }
    const mm = matchCountry(iso, T, gr, overrides[iso] || {});
    result[iso] = mm;
    const h = Object.keys(mm).length;
    hit += h;
    perCountry[iso] = { game: gr.length, hit: h, topo: T.length };
    if (performance.now() - sliceStart > 8) { await yieldFn(); sliceStart = performance.now(); }
  }
  return { map: result, total, hit, perCountry };
}
