import { getFeelPrefs } from "../core/feel.js";
import LoadingScreen from "../LoadingScreen.jsx";
import { REAL_ID_RE, loadRegionOwners } from "../realCountries.js";
import NewsBroadcast from "../NewsBroadcast.jsx";
import React, { useState, useEffect, useRef, useCallback, startTransition } from "react";
import { Zap, Trophy, CalendarDays, User, Users, Map as MapIcon, Lock, Globe2, ScrollText, Flame, Crown, X, ChevronDown, Layers, Check, Handshake, Swords, ShieldCheck, ShoppingBag, Newspaper, Gamepad2, Shield, Compass, MousePointerClick, BarChart3, ShoppingCart, ChevronRight, Coins, Sparkles, LifeBuoy, Image as ImageIcon, Landmark } from "lucide-react";
import { sbStorageGet, sbStorageSet, sbStorageListKeys, sbStorageListEntries } from "../supabaseStorage";
import { MAP_COLORS } from "../map/colors.js";
import { loadCities, cityKey } from "../map/cities";
import { PASS_REV, PASS_MAX_LEVEL, UPG_MAX_LEVEL, PASS_REWARD_TABLE, PASS_TITLE_IDS } from "../progressData";
import { createStore, useStore } from "../core/store.js";
import { fetchPlayersSnapshot } from "../core/gameApi.js";
import { powerSpend, powerRefund, loadPowerMap, hasServerPower, worldOp, stateOp } from "../powerApi";
import { loadNations } from "../nations";
import { setTick, clearTick } from "../core/ticker.js";



const SHOP_BANNER_IMG = "/img/shop-banner-img.jpg";


/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const MAX_ENERGY = 100;

/* Бот підтримки: ім'я користувача (без @) задається змінною VITE_SUPPORT_BOT_USERNAME на Vercel */
const SUPPORT_BOT_USERNAME = (import.meta.env && import.meta.env.VITE_SUPPORT_BOT_USERNAME) || "";

export function openSupportChat() {
  if (!SUPPORT_BOT_USERNAME) {
    alert("Підтримка скоро буде доступна.");
    return;
  }
  const url = `https://t.me/${SUPPORT_BOT_USERNAME}?start=support`;
  const wa = window.Telegram?.WebApp;
  if (wa?.openTelegramLink) wa.openTelegramLink(url);
  else window.open(url, "_blank");
}

export const NO_WARS = [];

/* Кулдаун між діями лідера (8 годин) */
const ACTION_COOLDOWN_MS = 8 * 60 * 60 * 1000;



const ENERGY_REGEN_PER_SEC = 1;
 // Power за захоплення вільної області
const FREE_CAPTURE_CD_MS = 10 * 60 * 1000;
 // пауза між захопленнями однієї країни
const CAPCD_PREFIX = "capcd:";
 // Power за рівень оборони міста
export const PANDEMIC_CFG_KEY = "cfg:pandemic";
 // citydef:<cityKey> → рівень оборони міста (0..5)
export const UPGRADES = [
  {
    id: "emax",
    title: "Максимальна енергія",
    base: 100,
    prices: [10000, 25000, 50000, 90000, 150000],
    values: [120, 140, 170, 210, 250],
    colLabel: "Максимальна енергія",
    fmtVal: (v) => String(v),
  },
  {
    id: "ereg",
    title: "Відновлення енергії",
    base: 1,
    prices: [20000, 45000, 85000, 140000, 200000],
    values: [1.1, 1.2, 1.3, 1.4, 1.5],
    colLabel: "Відновлення",
    fmtVal: (v) => String(v).replace(".", ",") + " енергії/с",
  },
  {
    id: "cdef",
    title: "Оборона міста",
    base: 10000,
    prices: [25000, 60000, 120000, 200000, 300000],
    values: [12000, 15000, 20000, 25000, 30000],
    colLabel: "Поріг захоплення",
    fmtVal: (v) => String(v),
  },
];

export function upgLevel(rec, id) {
  const n = Math.floor(Number(rec?.upg?.[id]) || 0);
  return Math.max(0, Math.min(UPG_MAX_LEVEL, n));
}

export function maxEnergyOf(rec) {
  const l = upgLevel(rec, "emax");
  return l > 0 ? UPGRADES[0].values[l - 1] : MAX_ENERGY;
}

export function energyRegenOf(rec) {
  const l = upgLevel(rec, "ereg");
  return l > 0 ? UPGRADES[1].values[l - 1] : ENERGY_REGEN_PER_SEC;
}

export const ID_KEY = "my-player-id";

export const TUTORIAL_KEY = "tutorial-done-v2";

export const TOS_KEY = "tos-accepted-v2";
 // v2: оновлена угода (згадка про персональні дані)
export const PLAYER_PREFIX = "players:";

// Мапінг Telegram ID -> playerId. Гравець зберігається під рандомним genId(),
// тому щоб серверний webhook міг знайти правильний запис після оплати,
// клієнт при створенні/бекфілі гравця пише сюди tgmap:{telegramId} -> playerId.
const TG_MAP_PREFIX = "tgmap:";

export const LEADERBOARD_STALE_MS = 8000;


/* ------------------------------------------------------------------ */
/*  Extended storage keys & helpers (Mail / Wars / Alliances / Theme)   */
/* ------------------------------------------------------------------ */

const MAIL_PREFIX = "mail:";

const WARS_KEY = "wars";

const ALLIANCES_KEY = "alliances";

const ALLIANCE_REQUESTS_KEY = "alliance-requests";

const CITY_CONTROL_KEY = "city-control";

const LEADER_PREFIX = "leader:";

const THEME_KEY = "theme";

const PREP_MS = 10 * 60 * 1000;

const BATTLE_MS = 60 * 60 * 1000;


/* Влада: у кожній країні один лідер. Радників і повстань у грі немає. */

export async function getJSON(key, shared, fallback) {
  const raw = await storageGet(key, shared);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}


export async function setJSON(key, value, shared) {
  return storageSet(key, JSON.stringify(value), shared);
}


export async function getMail(playerId) {
  return getJSON(MAIL_PREFIX + playerId, true, []);
}


/* Листи пише сервер: гравець додає лише собі (досягнення, нагорода), решту розсилає сервер */
export async function addMail(_playerId, message) {
  const r = await stateOp("mail-add", { subject: message?.subject, body: message?.body });
  return r.ok ? message : null;
}


/* Опитування, що не працює у фоні (вкладка/Telegram згорнуті): економить трафік, батарею й CPU. */
export function visibleInterval(fn, ms) {
  return setTick(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    fn();
  }, ms);
}


const GAME_STATE_KEY = "game-state";

export const SEASON_DURATION_DAYS = 50;

// Версія сезону: при зміні тривалості/нагород сезон стартує заново, а прогрес Battle Pass гравців обнуляється.
export const SEASON_REV = PASS_REV;

export const EMPTY_GAME_STATE = {
  wars: [],
  alliances: [],
  allianceRequests: [],
  cityControl: {},
  cityDefense: {},
  news: [],
  season: { seasonNumber: 1, durationDays: SEASON_DURATION_DAYS, startedAt: null, rev: SEASON_REV },
  maintenance: { enabled: false, message: "" },
};


export async function loadGameState() {
  const state = await getJSON(GAME_STATE_KEY, true, null);
  return state ? { ...EMPTY_GAME_STATE, ...state } : { ...EMPTY_GAME_STATE };
}


async function getWars() {
  return (await loadGameState()).wars;
}


async function getAlliances() {
  return (await loadGameState()).alliances;
}


async function getAllianceRequests() {
  return (await loadGameState()).allianceRequests;
}


async function getCityControl() {
  return (await loadGameState()).cityControl;
}


async function getCityDefense() {
  return (await loadGameState()).cityDefense;
}


async function getNews() {
  return (await loadGameState()).news;
}


/* Кінець сезону: карта скидається ЛИШЕ вручну адміном (адмін-панель → «Кінець сезону»).
   Коли час сезону вийшов, гра один раз надсилає адміну лист у Пошту. */
const SEASON_END_PREFIX = "seasonend:";

export const SEASON_REWARD_PREFIX = "seasonrew:";
 // seasonrew:<playerId> → { season, points, rank, countryCode, claimed }
export function seasonEndsAt(season) {
  return (season?.startedAt || 0) + (season?.durationDays || SEASON_DURATION_DAYS) * 24 * 60 * 60 * 1000;
}

export async function notifyAdminSeasonEnded() {
  return stateOp("season-end-check");
}


/* Season: shared across all players. First player to load it after it's
   unset (or after a new season revision) kicks off the 50-day timer for everyone. */
export async function ensureSeasonStarted() {
  const r = await stateOp("ensure-season");
  return r.ok ? r.season : EMPTY_GAME_STATE.season;
}


/* A country may only be in one war at a time (as attacker or defender) */
function countryAtWar(wars, code) {
  return (wars || []).some((w) => w.status !== "ended" && (w.attackerCountry === code || w.defenderCountry === code));
}


/* Countries allied with `code`, from the [countryA, countryB] pair list */
function getAllyCountries(alliances, code) {
  return (alliances || [])
    .filter((pair) => pair[0] === code || pair[1] === code)
    .map((pair) => (pair[0] === code ? pair[1] : pair[0]));
}


/* Find an active war where an ALLY of `myCountry` is fighting, but
   `myCountry` itself isn't already a side (or ally-of-a-side) in it.
   Used to surface the "your ally is at war" banner with an opt-in
   helper toggle, separate from wars myCountry is directly part of. */

/* Shared: declare a war, with exclusivity checks + mail + news. Returns { ok, reason, war? } */

/* Shared: send an alliance request, with mail + validation. Returns { ok, reason } */

/* Centralized war state reconciliation (prep -> battle -> ended).
   Called from refreshGameData so it runs no matter which tab/screen is
   currently open, instead of depending on the region map being mounted. */

export async function getLeader(code) {
  return storageGet(LEADER_PREFIX + code, true);
}


function areAllies(alliances, a, b) {
  return alliances.some((pair) => (pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a));
}



/* ------------------------------------------------------------------ */
/*  Дипломатія: союзи, пакти про ненапад, 4-годинна заборона нападу      */
/*  Кожна угода — окремий запис dip:<тип>:<пара>, тож паралельні         */
/*  зміни не затирають одна одну.                                        */
/* ------------------------------------------------------------------ */

const DIP_PREFIX = "dip:";

const TRUCE_MS = 4 * 60 * 60 * 1000;


function pairId(a, b) {
  return [a, b].sort().join("~");
}


export async function loadDiplomacy() {
  const out = { allies: [], pacts: [], truces: {}, requests: [], borders: [] };
  const entries = await sbStorageListEntries(DIP_PREFIX, true);
  const brokenAllyPairs = new Set();
  for (const row of entries || []) {
    let v;
    try {
      v = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!v) continue;
    if (v.kind === "req") {
      if (REAL_ID_RE.test(String(v.from)) && REAL_ID_RE.test(String(v.to))) out.requests.push(v);
      continue;
    }
    if (v.kind === "border") {
      if (REAL_ID_RE.test(String(v.a)) && REAL_ID_RE.test(String(v.b)) && Array.isArray(v.hist)) out.borders.push(v);
      continue;
    }
    if (v.kind !== "ally" && v.kind !== "pact") continue;
    if (!REAL_ID_RE.test(String(v.a)) || !REAL_ID_RE.test(String(v.b))) continue;
    const id = pairId(v.a, v.b);
    if (v.active) (v.kind === "ally" ? out.allies : out.pacts).push(v);
    else {
      if (v.kind === "ally") brokenAllyPairs.add(id);
      const until = (v.brokenAt || 0) + TRUCE_MS;
      if (until > Date.now() && until > (out.truces[id] || 0)) out.truces[id] = until;
    }
  }
  // Старі союзи з game-state теж діють, якщо їх не розірвано
  try {
    for (const pair of await getAlliances()) {
      const id = pairId(pair[0], pair[1]);
      if (!brokenAllyPairs.has(id) && !out.allies.some((x) => pairId(x.a, x.b) === id)) {
        out.allies.push({ kind: "ally", a: pair[0], b: pair[1], active: true, ts: 0 });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}


export function dipRelation(dip, a, b) {
  const id = pairId(a, b);
  return {
    ally: !!dip?.allies.some((x) => pairId(x.a, x.b) === id),
    pact: !!dip?.pacts.some((x) => pairId(x.a, x.b) === id),
    truceUntil: dip?.truces?.[id] > Date.now() ? dip.truces[id] : 0,
  };
}


export async function respondDiplomacyRequest(requestId, accept) {
  return worldOp("dip-respond", { requestId, accept: !!accept });
}


/* ------------------------------------------------------------------ */
/*  Перемир'я: лідери головних країн війни домовляються її зупинити.     */
/*  Місто лишається в захисника, обидві сторони відпочивають як після    */
/*  звичайної війни (WAR_COOLDOWN_MS). Запит — dip:req:<id> з type       */
/*  "ceasefire", лист у Пошті той самий "dip-request" (Прийняти/Відхилити)*/
/* ------------------------------------------------------------------ */

async function sendCeasefireRequest(war) {
  if (!war || war.status === "ended") return { ok: false, reason: "Війна вже завершилась" };
  return worldOp("ceasefire-request", { warId: war.id });
}




/* Закриті кордони (захист від пандемій). dip:border:<пара> = { kind:"border", a, b, by, hist:[[закрито, відкрито|0], …] }.
   Закритий кордон блокує поширення вірусу між двома країнами (src/pandemic.js) з моменту закриття. */
const MAX_CLOSED_BORDERS = 5;

const isOpenHist = (b) => b.hist.length > 0 && !b.hist[b.hist.length - 1][1];



/* ------------------------------------------------------------------ */
/*  Війна за місто                                                      */
/*  war:<id>          — запис війни                                     */
/*  warc:<id>:<гравець> — внесок гравця (кліки за сторону)              */
/*  Підготовка 10 хв → битва 1 год. Кліки йдуть на шкалу замість Power.  */
/*  Атакуючий має набрати баланс (кліки атаки − кліки захисту) ≥ 10 000. */
/* ------------------------------------------------------------------ */

const WAR_PREFIX = "war:";

export const COUNTRY_CHANGE_COOLDOWN_MS = 24 * 3600 * 1000;
 // як часто можна змінювати країну
export const WAR_CLICKS_PREFIX = "warc:";

const WAR_PREP_MS = 10 * 60 * 1000;

const WAR_BATTLE_MS = 60 * 60 * 1000;

const WAR_TARGET = 10000;

/* Після війни обидві сторони 4 години не можуть нападати і на них не можна нападати */
const WAR_COOLDOWN_MS = 4 * 60 * 60 * 1000;

const WARCD_PREFIX = "warcd:";

async function getWarCooldown(code) {
  const v = Number(await storageGet(WARCD_PREFIX + code, true).catch(() => 0));
  return v > Date.now() ? v : 0;
}


export function warInvolves(w, code) {
  return !!w && (w.attacker === code || w.defender === code || (w.attAllies || []).includes(code) || (w.defAllies || []).includes(code));
}

export function warSide(w, code) {
  if (!w) return null;
  if (w.attacker === code || (w.attAllies || []).includes(code)) return "att";
  if (w.defender === code || (w.defAllies || []).includes(code)) return "def";
  return null;
}

export function warPhase(w, now = Date.now()) {
  if (!w) return null;
  if (w.status === "ended") return "ended";
  if (now < w.prepEnd) return "prep";
  if (now < w.battleEnd) return "battle";
  return "finish";
}


/* Усі завершені війни (для підрахунку досягнень гравця) */
export async function loadEndedWars() {
  const entries = await sbStorageListEntries(WAR_PREFIX, true);
  const out = [];
  for (const row of entries || []) {
    try {
      const w = JSON.parse(row.value);
      if (w && w.id && w.status === "ended" && w.result) out.push(w);
    } catch {
      /* ignore */
    }
  }
  return out;
}


export async function loadActiveWars() {
  const entries = await sbStorageListEntries(WAR_PREFIX, true);
  const out = [];
  for (const row of entries || []) {
    try {
      const w = JSON.parse(row.value);
      /* війни зі старих вигаданих країн (id не ISO) ігноруємо — світ почався з нуля */
      if (w && w.id && w.status !== "ended" && REAL_ID_RE.test(String(w.attacker)) && REAL_ID_RE.test(String(w.defender))) out.push(w);
    } catch {
      /* ignore */
    }
  }
  return out;
}


export async function fetchWarTotals(warId, myPlayerId = null) {
  const entries = await sbStorageListEntries(WAR_CLICKS_PREFIX + warId + ":", true);
  const t = { att: 0, def: 0, mine: 0 }; // mine — те, що від мене вже лежить у базі в цій вибірці
  for (const row of entries || []) {
    try {
      const v = JSON.parse(row.value);
      if (v && (v.side === "att" || v.side === "def")) {
        t[v.side] += v.n || 0;
        if (myPlayerId && row.key.endsWith(":" + myPlayerId)) t.mine = v.n || 0;
      }
    } catch {
      /* ignore */
    }
  }
  return t;
}


/* Країна не може вступити у війну проти своїх союзників і партнерів за пактом */
function joinWarBlockReason(dip, war, side, code) {
  const enemies = side === "att" ? [war.defender, ...(war.defAllies || [])] : [war.attacker, ...(war.attAllies || [])];
  for (const e of enemies) {
    const r = dipRelation(dip, code, e);
    if (r.ally) return `Союзник — ${COUNTRY_MAP[e]?.name || e} на протилежному боці`;
    if (r.pact) return `З ${COUNTRY_MAP[e]?.name || e} діє пакт про ненапад`;
  }
  return null;
}


async function inviteWarAlly(war, fromCountry, allyCountry) {
  return worldOp("war-invite", { warId: war.id, ally: allyCountry });
}


/* Скільки міст зараз контролює країна. null, якщо дані недоступні. */
async function countryCityCount(code) {
  const [nationsNow, cities] = await Promise.all([loadNations(), loadCities()]);
  if (!nationsNow || !cities.list.length) return null;
  const co = nationsNow.cityOwners || {};
  let n = 0;
  for (const c of cities.list) if ((co[cityKey(c)] || nationsNow.owners[c.rid]) === code) n++;
  return n;
}


/* Країни, які мали міста на старті, а тепер не мають жодного, вибули з гри. */
export async function computeDeadCountries(nations) {
  const co = nations?.cityOwners || {};
  if (!Object.keys(co).length) return new Set();
  const [cities, ro] = await Promise.all([loadCities(), loadRegionOwners()]);
  if (!cities.list.length || !ro) return new Set();
  const had = new Set();
  const have = new Set();
  for (const c of cities.list) {
    const base = ro.r[c.rid];
    if (base) had.add(base);
    const o = co[cityKey(c)] || nations.owners[c.rid];
    if (o) have.add(o);
  }
  return new Set([...had].filter((x) => !have.has(x)));
}


/* Нагадування в Telegram про подію війни (початок битви / підсумок). Сервер сам перевіряє стан війни,
   автора й дублікати; помилки не критичні. */
export const warStartNotified = new Set();

export function notifyWarEvent(war, kind) {
  try {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData || !war?.id) return;
    fetch("/api/game?action=notify-war-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        warId: war.id,
        kind,
        attackerName: COUNTRY_MAP[war.attacker]?.name || war.attacker,
        defenderName: COUNTRY_MAP[war.defender]?.name || war.defender,
      }),
    }).catch(() => null);
  } catch {
    /* сповіщення не критичні */
  }
}


/* Завершення війни: лише один клієнт виконує підсумки (блокування через insert-if-absent) */
export async function finalizeWar(w) {
  const r = await worldOp("war-finish", { warId: w.id });
  if (r.ok && r.done) notifyWarEvent(w, "end");
  return !!(r.ok && r.done);
}


/* ------------------------------------------------------------------ */
/*  Themes                                                              */
/* ------------------------------------------------------------------ */

export const THEMES = {
  darkblue: {
    label: "Мультяшна планета",
    swatch: "#ffd54a",
    vars: {
      "--cn-bg1": "#3aa6ff", "--cn-bg2": "#0f3f93", "--cn-bg3": "#0b2a6b",
      "--cn-panel": "rgba(14,58,140,0.6)", "--cn-panel-border": "rgba(255,255,255,0.35)",
      "--cn-accent": "#ffd54a", "--cn-accent2": "#6c4dff",
      "--cn-text": "#ffffff", "--cn-text-dim": "#dbeaff", "--cn-text-dimmer": "#b9d3ff",
      "--cn-nav-bg": "rgba(11,42,107,0.96)",
    },
  },
};

export const DEFAULT_THEME = "darkblue";



/* ------------------------------------------------------------------ */
/*  Країни гравців                                                      */
/*  Реєстр заповнюється з Supabase (див. src/nations.js). Це змінювані  */
/*  модульні об'єкти: App оновлює їх при завантаженні й перерендерює    */
/*  інтерфейс. Країни реальні (id = ISO), див. src/realCountries.js.    */
/* ------------------------------------------------------------------ */

const NEUTRAL_COUNTRY_COLOR = "#64748b";

export const COUNTRIES = [];

export const COUNTRY_MAP = {};

export let DEAD_COUNTRIES = new Set();
 // країни без жодного міста: вибули з гри
export function setDeadCountries(v) { DEAD_COUNTRIES = v; }

export let countriesRev = 0;
 // зростає при кожному оновленні реєстру — для залежностей useMemo

export function setCountriesRegistry(list) {
  countriesRev++;
  COUNTRIES.length = 0;
  for (const k of Object.keys(COUNTRY_MAP)) delete COUNTRY_MAP[k];
  const sorted = [...(list || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), "uk"));
  for (const c of sorted) {
    const rec = { ...c, code: c.id, flag: c.flag || "" };
    COUNTRIES.push(rec);
    COUNTRY_MAP[rec.code] = rec;
  }
}


/* Країни — реальні (id = ISO, "UA", "PL"…). Старі гравці з вигаданою країною (id іншого вигляду)
   або з кодом, якого немає на карті, мають обрати нову країну; прогрес зберігається. */
export function isLegacyCountryCode(code) {
  if (!code || !REAL_ID_RE.test(String(code))) return true;
  return countriesRev > 0 && (!COUNTRY_MAP[code] || DEAD_COUNTRIES.has(code));
}


/* Прапор країни (емодзі за ISO) на кольоровій плашці її кольору. Пропс code — id країни. */
export function Flag({ code, size = 20, className }) {
  const rec = COUNTRY_MAP[code];
  const color = rec?.color || NEUTRAL_COUNTRY_COLOR;
  return (
    <span
      className={"cn-country-badge" + (className ? " " + className : "")}
      style={{ width: size, height: size, background: color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.62), lineHeight: 1 }}
    >
      {rec?.flag || ""}
    </span>
  );
}


const NAV = [
  { id: "clicker", label: "Clicker", icon: MousePointerClick },
  { id: "map", label: "Карта", icon: MapIcon },
  { id: "hq", label: "Штаб", icon: Landmark },
  { id: "season", label: "Сезон", icon: CalendarDays },
  { id: "shop", label: "Магазин", icon: ShoppingCart },
  { id: "profile", label: "Профіль", icon: User },
];


/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

export function fmt(n) {
  return new Intl.NumberFormat("uk-UA").format(Math.max(0, Math.round(n)));
}


/* Формат "2 год 15 хв" / "45 хв" для таймерів і кулдаунів */
export function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} год ${m} хв`;
  return `${m} хв`;
}


/* Ключ у спільному сховищі для динамічної ціни Premium Pass (у Stars) */
export const PREMIUM_PASS_PRICE_KEY = "premium_pass_price_stars";


/* Супер-адмін: єдиний Telegram-акаунт, якому доступна Developer-панель */
const SUPER_ADMIN_TG_ID = "6667421162";

export function isSuperAdmin() {
  try {
    const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    return tgId != null && String(tgId) === SUPER_ADMIN_TG_ID;
  } catch {
    return false;
  }
}


/* Очищення користувацького тексту (ніки, назви країн): прибираємо керівні та невидимі символи
   (у т.ч. RTL-підміни тексту), зайві пробіли й обмежуємо довжину. */
export function cleanText(v, max = 24) {
  return String(v ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}


export function genId() {
  return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}


export function getCurrentEnergy(rec) {
  if (!rec) return 0;
  const elapsedSec = Math.floor((Date.now() - rec.lastEnergyTs) / 1000);
  return Math.min(maxEnergyOf(rec), rec.energy + Math.max(0, elapsedSec) * energyRegenOf(rec));
}


export function getTelegramUser() {
  try {
    return window.Telegram?.WebApp?.initDataUnsafe?.user || null;
  } catch {
    return null;
  }
}


/* Ім'я гравця = ім'я в Telegram (ім'я + прізвище, інакше @username) */
export function getTelegramDisplayName() {
  const u = getTelegramUser();
  const full = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim();
  return (full || u?.username || "Гравець").slice(0, 32);
}



/* ------------------------------------------------------------------ */
/*  Інформація про гравця для адміна: підключення, пристрій, логи        */
/*  pinfo:<id> — профіль (IP, пристрій, історія змін, логи)              */
/*  pseen:<id> — час останньої активності (оновлюється раз на 5 хв)      */
/*  palog:<id> — дії адміна щодо гравця                                  */
/* ------------------------------------------------------------------ */

export const PINFO_PREFIX = "pinfo:";

export const PSEEN_PREFIX = "pseen:";


async function fetchNetInfo() {
  const withTimeout = async (url) => {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    } finally {
      clearTimeout(tm);
    }
  };
  const a = await withTimeout("/api/whoami");
  if (a && a.ip) return a;
  const j = await withTimeout("https://ipwho.is/");
  if (j && j.success !== false && j.ip) {
    return {
      ip: j.ip,
      country: j.country || "",
      region: j.region || "",
      city: j.city || "",
      isp: j.connection?.isp || "",
      org: j.connection?.org || "",
      asn: j.connection?.asn ? "AS" + j.connection.asn : "",
      type: j.type || "",
    };
  }
  return { ip: "", country: "", region: "", city: "", isp: "", org: "", asn: "", type: "" };
}


async function collectDevice() {
  const ua = navigator.userAgent || "";
  const tg = window.Telegram?.WebApp;
  let model = "";
  try {
    const h = await navigator.userAgentData?.getHighEntropyValues?.(["model"]);
    if (h?.model) model = h.model;
  } catch {
    /* ignore */
  }
  let os = "";
  if (/Android/.test(ua)) {
    os = "Android " + (ua.match(/Android ([\d.]+)/)?.[1] || "");
    if (!model) {
      const m = ua.match(/Android [\d.]+; ([^;)]+)/);
      if (m && m[1].trim() !== "K") model = m[1].trim();
    }
  } else if (/iPhone|iPad|iPod/.test(ua)) {
    os = "iOS " + (ua.match(/OS ([\d_]+)/)?.[1] || "").replace(/_/g, ".");
    model = /iPad/.test(ua) ? "iPad" : "iPhone";
  } else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";
  const client = tg && tg.platform && tg.platform !== "unknown" ? `Telegram ${tg.platform} v${tg.version || "?"}` : "Браузер";
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* ignore */
  }
  return {
    device: [model, os.trim()].filter(Boolean).join(" · ") || "Невідомо",
    os: os.trim(),
    model,
    client,
    screen: `${window.screen?.width || 0}×${window.screen?.height || 0} @${window.devicePixelRatio || 1}x`,
    lang: navigator.language || "",
    tz,
    ua,
  };
}


/* Фіксує вхід гравця: поточні IP/пристрій, історію змін і лог подій */
export async function trackSession(p, nameChange) {
  const tg = getTelegramUser();
  const [info, net, dev] = await Promise.all([getJSON(PINFO_PREFIX + p.id, true, null), fetchNetInfo(), collectDevice()]);
  const now = Date.now();
  const rec = info || { firstSeen: now, history: [], logs: [] };
  rec.history = rec.history || [];
  rec.logs = rec.logs || [];
  rec.tgId = tg?.id || p.telegramId || rec.tgId || null;
  rec.tgUsername = tg?.username || rec.tgUsername || "";
  rec.tgName = tg ? [tg.first_name, tg.last_name].filter(Boolean).join(" ") : rec.tgName || "";
  rec.username = p.username;
  rec.countryCode = p.countryCode;
  rec.lastSeen = now;
  rec.current = { ...net, ...dev, ts: now };
  const fp = [net.ip, net.isp, dev.device, dev.client].join("|");
  const last = rec.history[rec.history.length - 1];
  const addLog = (type, text) => rec.logs.push({ ts: now, type, text });
  if (!last || last.fp !== fp) {
    rec.history.push({ ts: now, fp, ip: net.ip, isp: net.isp, org: net.org, country: net.country, city: net.city, device: dev.device, client: dev.client });
    if (last) {
      if (net.ip && last.ip !== net.ip) addLog("ip", `Змінилась IP-адреса: ${last.ip || "—"} → ${net.ip}`);
      if (net.isp && last.isp !== net.isp) addLog("isp", `Змінився провайдер/оператор: ${last.isp || "—"} → ${net.isp}`);
      if (last.device !== dev.device) addLog("device", `Змінився пристрій: ${last.device || "—"} → ${dev.device}`);
      if (last.client !== dev.client) addLog("client", `Змінився клієнт: ${last.client || "—"} → ${dev.client}`);
    } else {
      addLog("first", `Перша реєстрація даних: ${net.ip || "IP невідомий"} · ${dev.device} · ${dev.client}`);
    }
  }
  if (nameChange) addLog("name", `Змінилось ім'я: «${nameChange.from}» → «${nameChange.to}»`);
  if (!rec.lastLoginLog || now - rec.lastLoginLog > 10 * 60 * 1000) {
    addLog("login", `Вхід у гру · ${net.ip || "IP невідомий"} · ${dev.device}`);
    rec.lastLoginLog = now;
  }
  if (rec.logs.length > 150) rec.logs = rec.logs.slice(-150);
  if (rec.history.length > 60) rec.history = rec.history.slice(-60);
  await setJSON(PINFO_PREFIX + p.id, rec, true);
}


/* ------------------------------------------------------------------ */
/*  Storage helpers — реальна база даних Supabase замість window.storage */
/* ------------------------------------------------------------------ */

export let storagePersistenceHealthy = true;

let lastStorageError = "";


const STORAGE_TIMEOUT_MS = 4000;


async function withStorageTimeout(promiseFactory, fallbackValue) {
  let timer = null;
  try {
    const result = await Promise.race([
      promiseFactory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("storage timeout")), STORAGE_TIMEOUT_MS);
      }),
    ]);
    return result;
  } catch (err) {
    lastStorageError = err?.message || String(err);
    storagePersistenceHealthy = false;
    return fallbackValue;
  } finally {
    if (timer) clearTimeout(timer);
  }
}


export async function storageGet(key, shared) {
  return withStorageTimeout(() => sbStorageGet(key, shared), null);
}


export async function storageSet(key, value, shared) {
  try {
    const ok = await withStorageTimeout(() => sbStorageSet(key, value, shared), false);
    storagePersistenceHealthy = !!ok;
    if (!ok) lastStorageError = "sbStorageSet повернув false";
    return true;
  } catch (err) {
    console.warn("storageSet: не вдалося зберегти в Supabase:", key, err?.message || err);
    lastStorageError = err?.message || String(err);
    storagePersistenceHealthy = false;
    return true;
  }
}


export async function fetchAllPlayers() {
  /* У Telegram — один запит до сервера (білий список публічних полів, Power уже накладений).
     null = помилка: екран лишає попередній список. Старий шлях (N+1) лише для режиму розробки без initData. */
  if (hasServerPower()) return fetchPlayersSnapshot();
  try {
    const keys = await sbStorageListKeys(PLAYER_PREFIX, true);
    const results = await Promise.all(
      keys.map(async (k) => {
        const raw = await storageGet(k, true);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
    );
    /* Power веде сервер: накладаємо pwr:<id> поверх поля power у записі гравця */
    const pm = await loadPowerMap();
    return results.filter(Boolean).map((p) => (pm && pm[p.id] !== undefined ? { ...p, power: pm[p.id] } : p));
  } catch {
    return [];
  }
}


/* Оплата дії Power: Power списує сервер. Спершу підтверджуємо кліки, що ще не дійшли до сервера. */
export let FLUSH_POWER = null;

export function setFlushPower(v) { FLUSH_POWER = v; }

const POWER_COSTS = { war_declare: 5000, free_capture: 5000, city_def: 5000 };
 // має збігатися з api/_game/power.js
/* Дії світу списують Power на сервері самі: перед запитом скидаємо кліки, після — ставимо справжній баланс */
export async function worldPaid(op, body, onUpdatePlayer) {
  if (FLUSH_POWER) await FLUSH_POWER();
  const r = await worldOp(op, body);
  if (r.ok && Number.isFinite(r.power)) onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, power: r.power }));
  return r;
}

async function payPower(kind, onUpdatePlayer) {
  if (!hasServerPower()) {
    const c = POWER_COSTS[kind];
    onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, power: Math.max(0, (prev.power || 0) - c) }));
    return { ok: true, localCost: c };
  }
  if (FLUSH_POWER) await FLUSH_POWER();
  const r = await powerSpend(kind);
  if (!r.ok) return { ok: false, reason: r.reason };
  onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, power: r.power }));
  return { ok: true, receipt: r.receipt };
}

async function refundPower(pay, onUpdatePlayer) {
  if (!pay) return;
  if (pay.localCost) {
    onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, power: (prev.power || 0) + pay.localCost }));
    return;
  }
  const r = await powerRefund(pay.receipt);
  if (r.ok) onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, power: r.power }));
}


/* ------------------------------------------------------------------ */
/*  Lightweight synthesized sound engine (no audio files needed)        */
/* ------------------------------------------------------------------ */

let _cnAudioCtx = null;

function cnGetAudioCtx() {
  if (typeof window === "undefined") return null;
  try {
    if (!_cnAudioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      _cnAudioCtx = new Ctx();
    }
    if (_cnAudioCtx.state === "suspended") _cnAudioCtx.resume();
    return _cnAudioCtx;
  } catch {
    return null;
  }
}


function cnPlayTone({ freq = 440, duration = 0.08, type = "sine", volume = 0.08, glideTo = null }) {
  if (!getFeelPrefs().sound) return;
  const ctx = cnGetAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, ctx.currentTime + duration);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    /* ignore audio errors (e.g. autoplay restrictions) */
  }
}


export const cnSfx = {
  tap: () => cnPlayTone({ freq: 720, duration: 0.06, type: "triangle", volume: 0.07, glideTo: 500 }),
  /* Тап по планеті: тон підіймається разом із комбо (пентатоніка, щоб швидкі тапи звучали приємно) */
  tapCombo: (count = 0) => {
    const scale = [523.25, 587.33, 659.25, 783.99, 880];
    const i = Math.min(scale.length * 2 - 1, Math.floor(count / 4));
    const f = scale[i % scale.length] * (i >= scale.length ? 2 : 1);
    cnPlayTone({ freq: f, duration: 0.07, type: "triangle", volume: 0.07, glideTo: f * 0.8 });
  },
  blip: () => cnPlayTone({ freq: 900 + Math.random() * 200, duration: 0.03, type: "square", volume: 0.035 }),
  step: () => cnPlayTone({ freq: 500, duration: 0.09, type: "sine", volume: 0.06, glideTo: 700 }),
  skip: () => cnPlayTone({ freq: 400, duration: 0.07, type: "sine", volume: 0.05, glideTo: 250 }),
  fanfare: () => {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      setTimeout(() => cnPlayTone({ freq: f, duration: 0.22, type: "triangle", volume: 0.07 }), i * 90);
    });
  },
  navSwitch: () => cnPlayTone({ freq: 380, duration: 0.05, type: "sine", volume: 0.045, glideTo: 520 }),
  modalOpen: () => cnPlayTone({ freq: 460, duration: 0.07, type: "sine", volume: 0.05, glideTo: 640 }),
  modalClose: () => cnPlayTone({ freq: 420, duration: 0.06, type: "sine", volume: 0.045, glideTo: 300 }),
  error: () => cnPlayTone({ freq: 220, duration: 0.12, type: "sawtooth", volume: 0.05, glideTo: 140 }),
  claim: () => {
    [660, 880].forEach((f, i) => setTimeout(() => cnPlayTone({ freq: f, duration: 0.16, type: "triangle", volume: 0.065 }), i * 80));
  },
  purchase: () => {
    [523.25, 783.99].forEach((f, i) => setTimeout(() => cnPlayTone({ freq: f, duration: 0.15, type: "sine", volume: 0.06 }), i * 70));
  },
  toggle: () => cnPlayTone({ freq: 600, duration: 0.04, type: "sine", volume: 0.04 }),
};


/* ------------------------------------------------------------------ */
/*  Localization (multi-language support)                              */
/* ------------------------------------------------------------------ */

export const LANG_KEY = "ui-language";

export const LANG_CHOSEN_KEY = "ui-language-chosen";


export const LANGUAGES = [
  { code: "uk", label: "Українська", flag: "🇺🇦" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "en", label: "English", flag: "🇬🇧" },
];

export const SUPPORTED_LANGS = LANGUAGES.map((l) => l.code);


const TRANSLATIONS = {
  nav_clicker: { uk: "Клікер", pl: "Klikacz", de: "Klicker", ru: "Кликер", it: "Clicker", fr: "Clicker", en: "Clicker", es: "Clicker", ar: "النقر" },
  nav_leaderboard: { uk: "Рейтинг", pl: "Ranking", de: "Rangliste", ru: "Рейтинг", it: "Classifica", fr: "Classement", en: "Leaderboard", es: "Ranking", ar: "المتصدرون" },
  nav_season: { uk: "Сезон", pl: "Sezon", de: "Saison", ru: "Сезон", it: "Stagione", fr: "Saison", en: "Season", es: "Temporada", ar: "الموسم" },
  nav_profile: { uk: "Профіль", pl: "Profil", de: "Profil", ru: "Профиль", it: "Profilo", fr: "Profil", en: "Profile", es: "Perfil", ar: "الملف" },
  nav_shop: { uk: "Магазин", pl: "Sklep", de: "Shop", ru: "Магазин", it: "Negozio", fr: "Boutique", en: "Shop", es: "Tienda", ar: "المتجر" },
  nav_hq: { uk: "Штаб", pl: "Sztab", de: "Hauptquartier", ru: "Штаб", it: "Quartier generale", fr: "QG", en: "HQ", es: "Cuartel", ar: "المقر" },
  nav_map: { uk: "Карта", pl: "Mapa", de: "Karte", ru: "Карта", it: "Mappa", fr: "Carte", en: "Map", es: "Mapa", ar: "الخريطة" },

  lb_countries: { uk: "Країни", pl: "Kraje", de: "Länder", ru: "Страны", it: "Paesi", fr: "Pays", en: "Countries", es: "Países", ar: "الدول" },
  lb_players: { uk: "Гравці", pl: "Gracze", de: "Spieler", ru: "Игроки", it: "Giocatori", fr: "Joueurs", en: "Players", es: "Jugadores", ar: "اللاعبون" },
  lb_mycountry: { uk: "Моя країна", pl: "Mój kraj", de: "Mein Land", ru: "Моя страна", it: "Il mio paese", fr: "Mon pays", en: "My country", es: "Mi país", ar: "بلدي" },
  lb_empty: { uk: "Тут поки нікого немає.", pl: "Tu jeszcze nikogo nie ma.", de: "Hier ist noch niemand.", ru: "Тут пока никого нет.", it: "Non c'è ancora nessuno qui.", fr: "Il n'y a encore personne ici.", en: "No one here yet.", es: "Aún no hay nadie aquí.", ar: "لا يوجد أحد هنا بعد." },
  lb_loading: { uk: "Завантаження рейтингу…", pl: "Ładowanie rankingu…", de: "Rangliste wird geladen…", ru: "Загрузка рейтинга…", it: "Caricamento classifica…", fr: "Chargement du classement…", en: "Loading leaderboard…", es: "Cargando ranking…", ar: "جارٍ تحميل المتصدرين…" },

  settings_theme: { uk: "Тема", pl: "Motyw", de: "Design", ru: "Тема", it: "Tema", fr: "Thème", en: "Theme", es: "Tema", ar: "المظهر" },
  settings_language: { uk: "Мова", pl: "Język", de: "Sprache", ru: "Язык", it: "Lingua", fr: "Langue", en: "Language", es: "Idioma", ar: "اللغة" },
  settings_help: { uk: "Довідка", pl: "Pomoc", de: "Hilfe", ru: "Справка", it: "Aiuto", fr: "Aide", en: "Help", es: "Ayuda", ar: "المساعدة" },
  settings_tutorial_replay: { uk: "Показати навчання ще раз", pl: "Pokaż samouczek ponownie", de: "Tutorial erneut anzeigen", ru: "Показать обучение снова", it: "Mostra di nuovo il tutorial", fr: "Revoir le tutoriel", en: "Show tutorial again", es: "Mostrar el tutorial de nuevo", ar: "إظهار البرنامج التعليمي مرة أخرى" },

  tos_title: { uk: "Угода користувача", pl: "Umowa użytkownika", de: "Nutzungsvereinbarung", ru: "Пользовательское соглашение", it: "Accordo utente", fr: "Accord utilisateur", en: "User Agreement", es: "Acuerdo de usuario", ar: "اتفاقية المستخدم" },
  tos_body: {
    uk: "Гра розважальна, віртуальні предмети не мають реальної вартості. Гра збирає персональні дані, потрібні для її роботи. Погоджуючись, ти приймаєш ці умови.",
    pl: "Gra ma charakter rozrywkowy, przedmioty wirtualne nie mają realnej wartości. Gra zbiera dane osobowe potrzebne do jej działania. Akceptując, przyjmujesz te warunki.",
    de: "Das Spiel dient der Unterhaltung, virtuelle Gegenstände haben keinen realen Wert. Das Spiel erhebt personenbezogene Daten, die für den Betrieb nötig sind. Mit der Zustimmung akzeptierst du diese Bedingungen.",
    ru: "Игра развлекательная, виртуальные предметы не имеют реальной стоимости. Игра собирает персональные данные, необходимые для её работы. Соглашаясь, ты принимаешь эти условия.",
    it: "Il gioco è di intrattenimento, gli oggetti virtuali non hanno valore reale. Il gioco raccoglie dati personali necessari al suo funzionamento. Accettando, accetti questi termini.",
    fr: "Le jeu est un divertissement, les objets virtuels n'ont aucune valeur réelle. Le jeu collecte des données personnelles nécessaires à son fonctionnement. En acceptant, vous acceptez ces conditions.",
    en: "The game is for entertainment, virtual items have no real value. The game collects personal data needed for it to work. By accepting, you agree to these terms.",
    es: "El juego es de entretenimiento, los objetos virtuales no tienen valor real. El juego recopila datos personales necesarios para su funcionamiento. Al aceptar, aceptas estos términos.",
    ar: "اللعبة للترفيه، والعناصر الافتراضية ليس لها قيمة حقيقية. تجمع اللعبة بيانات شخصية لازمة لعملها. بالموافقة، فإنك تقبل هذه الشروط.",
  },
  tos_accept: { uk: "Погоджуюсь і граю", pl: "Zgadzam się i gram", de: "Zustimmen und spielen", ru: "Соглашаюсь и играю", it: "Accetto e gioco", fr: "J'accepte et je joue", en: "Agree and play", es: "Aceptar y jugar", ar: "أوافق وألعب" },
  tos_decline: { uk: "Не погоджуюсь", pl: "Nie zgadzam się", de: "Ablehnen", ru: "Не соглашаюсь", it: "Non accetto", fr: "Je refuse", en: "Decline", es: "Rechazar", ar: "أرفض" },
  tos_declined_title: { uk: "Гру не розпочато", pl: "Gra nie została rozpoczęta", de: "Spiel nicht gestartet", ru: "Игра не начата", it: "Gioco non avviato", fr: "Jeu non démarré", en: "Game not started", es: "Juego no iniciado", ar: "لم تبدأ اللعبة" },
  tos_declined_body: {
    uk: "Щоб грати, потрібно погодитися з угодою користувача. Ти можеш переглянути її ще раз і погодитися, коли будеш готовий.",
    pl: "Aby grać, musisz zaakceptować umowę użytkownika. Możesz wrócić i zaakceptować ją, gdy będziesz gotowy.",
    de: "Um zu spielen, musst du der Nutzungsvereinbarung zustimmen. Du kannst später zurückkehren und zustimmen.",
    ru: "Чтобы играть, нужно принять пользовательское соглашение. Ты можешь вернуться и согласиться позже.",
    it: "Per giocare devi accettare l'accordo utente. Puoi tornare e accettarlo quando sei pronto.",
    fr: "Pour jouer, vous devez accepter l'accord utilisateur. Vous pouvez revenir et l'accepter quand vous êtes prêt.",
    en: "To play, you need to accept the user agreement. You can come back and accept it whenever you're ready.",
    es: "Para jugar, debes aceptar el acuerdo de usuario. Puedes volver y aceptarlo cuando estés listo.",
    ar: "للعب، تحتاج إلى الموافقة على اتفاقية المستخدم. يمكنك العودة والموافقة عليها عندما تكون مستعدًا.",
  },
  tos_review_again: { uk: "Переглянути угоду знову", pl: "Przejrzyj umowę ponownie", de: "Vereinbarung erneut ansehen", ru: "Просмотреть соглашение снова", it: "Rivedi di nuovo l'accordo", fr: "Revoir l'accord", en: "Review agreement again", es: "Revisar el acuerdo de nuevo", ar: "مراجعة الاتفاقية مرة أخرى" },

  /* Language select screen */
  lang_select_title: { uk: "Обери мову", pl: "Wybierz język", de: "Sprache wählen", ru: "Выбери язык", it: "Scegli la lingua", fr: "Choisissez la langue", en: "Choose your language", es: "Elige tu idioma", ar: "اختر لغتك" },
  lang_select_sub: { uk: "Мову можна буде змінити пізніше в налаштуваннях", pl: "Język można później zmienić w ustawieniach", de: "Du kannst die Sprache später in den Einstellungen ändern", ru: "Язык можно будет изменить позже в настройках", it: "Potrai cambiare la lingua più tardi nelle impostazioni", fr: "Vous pourrez changer la langue plus tard dans les paramètres", en: "You can change the language later in settings", es: "Podrás cambiar el idioma más tarde en los ajustes", ar: "يمكنك تغيير اللغة لاحقًا في الإعدادات" },
  lang_select_continue: { uk: "Продовжити", pl: "Kontynuuj", de: "Weiter", ru: "Продолжить", it: "Continua", fr: "Continuer", en: "Continue", es: "Continuar", ar: "متابعة" },

  /* Boot screen */
  boot_loading: { uk: "Завантаження світу…", pl: "Ładowanie świata…", de: "Welt wird geladen…", ru: "Загрузка мира…", it: "Caricamento del mondo…", fr: "Chargement du monde…", en: "Loading the world…", es: "Cargando el mundo…", ar: "جارٍ تحميل العالم…" },

  /* Onboarding */
  onboard_sub: { uk: "Обери реальну країну, за яку гратимеш.", en: "Choose the real country you will play for.", ru: "Выбери реальную страну, за которую будешь играть." },
  onboard_name_label: { uk: "Ім'я гравця", pl: "Nazwa gracza", de: "Spielername", ru: "Имя игрока", it: "Nome giocatore", fr: "Nom du joueur", en: "Player name", es: "Nombre del jugador", ar: "اسم اللاعب" },
  onboard_name_placeholder: { uk: "Введи своє ім'я", pl: "Wpisz swoje imię", de: "Gib deinen Namen ein", ru: "Введи своё имя", it: "Inserisci il tuo nome", fr: "Entrez votre nom", en: "Enter your name", es: "Escribe tu nombre", ar: "أدخل اسمك" },
  onboard_country_label: { uk: "Країна", pl: "Kraj", de: "Land", ru: "Страна", it: "Paese", fr: "Pays", en: "Country", es: "País", ar: "الدولة" },
  onboard_country_choose: { uk: "Обери країну зі списку", pl: "Wybierz kraj z listy", de: "Wähle ein Land aus der Liste", ru: "Выбери страну из списка", it: "Scegli un paese dall'elenco", fr: "Choisissez un pays dans la liste", en: "Choose a country from the list", es: "Elige un país de la lista", ar: "اختر دولة من القائمة" },
  onboard_country_search: { uk: "Пошук країни…", pl: "Szukaj kraju…", de: "Land suchen…", ru: "Поиск страны…", it: "Cerca paese…", fr: "Rechercher un pays…", en: "Search country…", es: "Buscar país…", ar: "البحث عن دولة…" },
  onboard_country_empty: { uk: "Нічого не знайдено", pl: "Nic nie znaleziono", de: "Nichts gefunden", ru: "Ничего не найдено", it: "Nessun risultato trovato", fr: "Aucun résultat trouvé", en: "Nothing found", es: "No se encontró nada", ar: "لم يتم العثور على شيء" },
  onboard_start_btn: { uk: "Почати гру", pl: "Rozpocznij grę", de: "Spiel starten", ru: "Начать игру", it: "Inizia il gioco", fr: "Commencer le jeu", en: "Start the game", es: "Empezar el juego", ar: "ابدأ اللعبة" },
  onboard_creating_btn: { uk: "Створення…", pl: "Tworzenie…", de: "Wird erstellt…", ru: "Создание…", it: "Creazione…", fr: "Création…", en: "Creating…", es: "Creando…", ar: "جارٍ الإنشاء…" },
  onboard_lock_note: { uk: "Країну неможливо буде змінити після підтвердження.", pl: "Kraju nie będzie można zmienić po potwierdzeniu.", de: "Das Land kann nach der Bestätigung nicht mehr geändert werden.", ru: "Страну нельзя будет изменить после подтверждения.", it: "Il paese non potrà essere cambiato dopo la conferma.", fr: "Le pays ne pourra plus être modifié après confirmation.", en: "The country can't be changed after confirming.", es: "El país no se podrá cambiar después de confirmar.", ar: "لا يمكن تغيير الدولة بعد التأكيد." },

  nn_play_existing: { uk: "Грати за існуючу країну", en: "Play for an existing country", ru: "Играть за существующую страну" },
  nn_play_existing_sub: { uk: "Обери країну зі списку", en: "Pick a country from the list", ru: "Выбери страну из списка" },
  nn_create_own: { uk: "Створити свою країну", en: "Create your own country", ru: "Создать свою страну" },
  nn_create_own_sub: { uk: "Займи вільну область на карті", en: "Claim a free region on the map", ru: "Займи свободную область на карте" },
  nn_list_title: { uk: "Обери країну", en: "Choose a country", ru: "Выбери страну" },
  nn_list_empty: { uk: "Країни ще завантажуються. Спробуй за мить.", en: "Countries are still loading. Try again in a moment.", ru: "Страны ещё загружаются. Попробуй через мгновение." },
  nn_confirm_title: { uk: "Підтвердження", en: "Confirmation", ru: "Подтверждение" },
  nn_confirm_text: { uk: "Ти дійсно хочеш грати за країну «{name}»? Змінити її пізніше можна в Штабі (розділ «Армія»).", en: "Do you really want to play for «{name}»? You can change it later in HQ (Army section).", ru: "Ты действительно хочешь играть за страну «{name}»? Позже её можно сменить в Штабе (раздел «Армия»)." },
  nn_confirm_yes: { uk: "Так, грати", en: "Yes, play", ru: "Да, играть" },
  nn_confirm_no: { uk: "Скасувати", en: "Cancel", ru: "Отмена" },
  nn_create_title: { uk: "Створи країну", en: "Create a country", ru: "Создай страну" },
  nn_create_hint: { uk: "Обери вільну область на карті й натисни «Підтвердити».", en: "Pick a free region on the map and press “Confirm”.", ru: "Выбери свободную область на карте и нажми «Подтвердить»." },
  nn_region_taken: { uk: "Ця область уже належить країні «{name}». Обери вільну.", en: "This region already belongs to «{name}». Pick a free one.", ru: "Эта область уже принадлежит стране «{name}». Выбери свободную." },
  nn_region_selected: { uk: "Обрана область", en: "Selected region", ru: "Выбранная область" },
  nn_country_name_label: { uk: "Назва країни", en: "Country name", ru: "Название страны" },
  nn_country_name_ph: { uk: "Наприклад, Республіка Вільних", en: "For example, Republic of the Free", ru: "Например, Республика Свободных" },
  nn_confirm_btn: { uk: "Підтвердити", en: "Confirm", ru: "Подтвердить" },
  nn_back: { uk: "Назад", en: "Back", ru: "Назад" },
  nn_cities_count: { uk: "Міст", en: "Cities", ru: "Городов" },
  nn_regions_count: { uk: "областей", en: "regions", ru: "областей" },
  nn_reassign_note: { uk: "У грі тепер реальні країни. Твій прогрес збережено — обери країну, за яку гратимеш далі.", en: "The game now uses real countries. Your progress is kept — pick the country you will play for.", ru: "В игре теперь реальные страны. Твой прогресс сохранён — выбери страну, за которую будешь играть." },
  nn_legend_free: { uk: "Вільні", en: "Free", ru: "Свободные" },
  nn_legend_occupied: { uk: "Зайняті", en: "Occupied", ru: "Занятые" },
  nn_legend_own: { uk: "Власні", en: "Your own", ru: "Свои" },
  nn_map_hint: { uk: "Перетягуй карту, наближай і натискай на область, щоб побачити, кому вона належить.", en: "Drag and zoom the map, tap a region to see who owns it.", ru: "Перетаскивай карту, приближай и нажимай на область, чтобы увидеть, кому она принадлежит." },
  nn_goto_mine: { uk: "До моєї країни", en: "Go to my country", ru: "К моей стране" },
  nn_region_free_text: { uk: "Вільна територія — її ніхто не контролює.", en: "Free territory — nobody controls it.", ru: "Свободная территория — её никто не контролирует." },
  nn_world_rank: { uk: "Місце у світі", en: "World rank", ru: "Место в мире" },
  nn_leader: { uk: "Лідер", en: "Leader", ru: "Лидер" },
  nn_capital: { uk: "Столиця", en: "Capital", ru: "Столица" },
  nn_regional_center: { uk: "Центр області", en: "Regional center", ru: "Центр области" },
  nn_controlled_by: { uk: "Контролює", en: "Controlled by", ru: "Контролирует" },
  nn_region: { uk: "Область", en: "Region", ru: "Область" },
  nn_population: { uk: "Населення", en: "Population", ru: "Население" },
  nn_importance: { uk: "Важливість", en: "Importance", ru: "Важность" },
  nn_attack_soon: { uk: "Атака — незабаром", en: "Attack — coming soon", ru: "Атака — скоро" },

  /* Tutorial modal chrome */
  tutorial_skip_btn: { uk: "Пропустити", pl: "Pomiń", de: "Überspringen", ru: "Пропустить", it: "Salta", fr: "Passer", en: "Skip", es: "Omitir", ar: "تخطي" },
  tutorial_back_btn: { uk: "Назад", pl: "Wstecz", de: "Zurück", ru: "Назад", it: "Indietro", fr: "Retour", en: "Back", es: "Atrás", ar: "رجوع" },
  tutorial_next_btn: { uk: "Далі", pl: "Dalej", de: "Weiter", ru: "Далее", it: "Avanti", fr: "Suivant", en: "Next", es: "Siguiente", ar: "التالي" },
  tutorial_start_btn: { uk: "Почати гру", pl: "Rozpocznij grę", de: "Spiel starten", ru: "Начать игру", it: "Inizia il gioco", fr: "Commencer le jeu", en: "Start the game", es: "Empezar el juego", ar: "ابدأ اللعبة" },
  tutorial_mentor_name: { uk: "Глобі", en: "Globby", ru: "Глоби" },

  /* Tutorial steps */
};


export function t(lang, key) {
  const entry = TRANSLATIONS[key];
  if (!entry) return key;
  return entry[lang] || entry.en || entry.uk || key;
}


/* ------------------------------------------------------------------ */
/*  Root component                                                      */
/* ------------------------------------------------------------------ */

/* «Живий» запис гравця: оновлюється на кожен клік, але React-стан App змінюється рідко (див. setPlayer нижче).
   Лише дрібні листкові компоненти клікера підписані на нього напряму. */
export const liveStore = createStore(null);

export const CLICK_COMMIT_MS = 1000;


/* ------------------------------------------------------------------ */
/*  Onboarding tutorial (dialogue with mentor character)                */
/* ------------------------------------------------------------------ */

/* Якщо екран «впав», показуємо повідомлення з кнопкою «Назад», а не чорний екран. */
export class ScreenErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("Screen crashed:", error);
  }
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#cbd5e1" }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Цей розділ тимчасово не працює</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 14 }}>Спробуй перейти в інший розділ або перезапусти гру.</div>
        <button className="cn-primary-btn" type="button" onClick={() => this.setState({ error: null })}>
          <span className="cn-primary-btn-label">Спробувати ще раз</span>
        </button>
      </div>
    );
  }
}


export function GameLogo({ size = 40, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="27" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="3" />
      <ellipse cx="32" cy="32" rx="11" ry="27" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.4" />
      <path d="M5.5 32h53" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.4" />
      <path d="M17 21l6.5 21.5L32 28l8.5 14.5L47 21" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


/* Іконка Power: кулак. Малюється SVG, колір береться з currentColor. */
function FistIcon({ size = 24, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4.2" y="6.4" width="3.7" height="7.4" rx="1.85" />
      <rect x="8.1" y="4.6" width="3.7" height="9" rx="1.85" />
      <rect x="12" y="4.6" width="3.7" height="9" rx="1.85" />
      <rect x="15.9" y="6.4" width="3.7" height="7.4" rx="1.85" />
      <path d="M4.2 12.2h15.4v3.6a5.2 5.2 0 0 1-5.2 5.2H9.4a5.2 5.2 0 0 1-5.2-5.2z" />
      <rect x="2.6" y="13.6" width="8.4" height="3.6" rx="1.8" fill="rgba(0,0,0,0.28)" />
    </svg>
  );
}


/* Іконка Points: кристал (діамант). */
export function GemIcon({ size = 24, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.2 3.5h11.6l4.2 5.3L12 21 2 8.8z" fill="currentColor" fillOpacity="0.9" />
      <path d="M2 8.8h20M9 3.5l-2.6 5.3L12 21M15 3.5l2.6 5.3L12 21" stroke="rgba(0,0,0,0.32)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}


export function BootScreen({ lang = "uk" }) {
  return <LoadingScreen lang={lang} variant="full" />;
}


/* ------------------------------------------------------------------ */
/*  Language select screen (shown once, before the TOS gate)           */
/* ------------------------------------------------------------------ */

export function LanguageSelectScreen({ lang, onSetLanguage, onContinue }) {
  return (
    <div className="cn-tos-screen">
      <div className="cn-tos-glow" />
      <div className="cn-tos-card">
        <GameLogo size={48} className="cn-tos-icon" />
        <div className="cn-tos-title">{t(lang, "lang_select_title")}</div>
        <div className="cn-tos-body">{t(lang, "lang_select_sub")}</div>
        <div className="cn-lang-select-grid">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              className={"cn-lang-select-btn" + (lang === l.code ? " cn-lang-select-btn--active" : "")}
              onClick={() => {
                cnSfx.toggle();
                onSetLanguage(l.code);
              }}
            >
              <span className="cn-lang-select-flag">{l.flag}</span>
              <span className="cn-lang-select-label">{l.label}</span>
              {lang === l.code && <Check size={14} className="cn-lang-select-check" />}
            </button>
          ))}
        </div>
        <div className="cn-tos-actions">
          <button className="cn-primary-btn" type="button" onClick={onContinue}>
            <span className="cn-primary-btn-label">{t(lang, "lang_select_continue")}</span>
            <ChevronRight size={20} className="cn-primary-btn-chevron" />
          </button>
        </div>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Terms of service gate                                               */
/* ------------------------------------------------------------------ */

export function TosGateScreen({ lang, onAccept, onDecline }) {
  return (
    <div className="cn-tos-screen">
      <div className="cn-tos-glow" />
      <div className="cn-tos-card">
        <ScrollText size={36} className="cn-tos-icon" />
        <div className="cn-tos-title">{t(lang, "tos_title")}</div>
        <div className="cn-tos-body">{t(lang, "tos_body")}</div>
        <div className="cn-tos-actions">
          <button className="cn-primary-btn" type="button" onClick={onAccept}>
            <span className="cn-primary-btn-label">{t(lang, "tos_accept")}</span>
            <ChevronRight size={20} className="cn-primary-btn-chevron" />
          </button>
          <button className="cn-tos-decline-btn" type="button" onClick={onDecline}>
            {t(lang, "tos_decline")}
          </button>
        </div>
      </div>
    </div>
  );
}


export function TosDeclinedScreen({ lang, onReview }) {
  return (
    <div className="cn-tos-screen">
      <div className="cn-tos-glow" />
      <div className="cn-tos-card">
        <ScrollText size={36} className="cn-tos-icon cn-tos-icon--dim" />
        <div className="cn-tos-title">{t(lang, "tos_declined_title")}</div>
        <div className="cn-tos-body">{t(lang, "tos_declined_body")}</div>
        <div className="cn-tos-actions">
          <button className="cn-primary-btn" type="button" onClick={onReview}>
            <span className="cn-primary-btn-label">{t(lang, "tos_review_again")}</span>
            <ChevronRight size={20} className="cn-primary-btn-chevron" />
          </button>
        </div>
      </div>
    </div>
  );
}


export function BlockedScreen({ reason }) {
  return (
    <div className="cn-blocked">
      <img className="cn-blocked-bg" src="/img/blocked-bg.webp" alt="" />
      <div className="cn-blocked-shade" />
      <div className="cn-blocked-top">
        <div className="cn-blocked-title">Доступ закрито</div>
        <div className="cn-blocked-sub">Твій акаунт заблоковано адміністрацією.</div>
        {reason ? (
          <div className="cn-blocked-reason">
            <small>Причина</small>
            {reason}
          </div>
        ) : null}
      </div>
      <div className="cn-blocked-bottom">
        <div className="cn-blocked-hint">Вважаєш, що це помилка? Напиши в підтримку, і ми розглянемо розблокування твого акаунту.</div>
        <button type="button" className="cn-blocked-btn" onClick={() => { cnSfx.modalOpen(); openSupportChat(); }}>
          <LifeBuoy size={18} /> Написати в підтримку
        </button>
      </div>
    </div>
  );
}


/* Легенда карти: три типи територій */
export function MapLegend({ lang = "uk", myColor }) {
  return (
    <div className="cn-tmap-legend">
      <span className="cn-tmap-legend-item">
        <span className="cn-tmap-legend-dot" style={{ background: MAP_COLORS.free }} /> {t(lang, "nn_legend_free")}
      </span>
      <span className="cn-tmap-legend-item">
        <span className="cn-tmap-legend-dot cn-tmap-legend-dot--multi" /> {t(lang, "nn_legend_occupied")}
      </span>
      <span className="cn-tmap-legend-item">
        <span className="cn-tmap-legend-dot cn-tmap-legend-dot--own" style={myColor ? { background: myColor } : undefined} /> {t(lang, "nn_legend_own")}
      </span>
    </div>
  );
}



/* ------------------------------------------------------------------ */
/*  Війна: інтерфейс у Клікері (підготовка / битва)                      */
/* ------------------------------------------------------------------ */

function fmtClock(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}


export function WarHud({ war, me, isLeader, totals, pendingRef, players = [] }) {
  const [alliesOpen, setAlliesOpen] = useState(false);
  const [ceaseMsg, setCeaseMsg] = useState("");
  const [ceaseBusy, setCeaseBusy] = useState(false);
  const now = Date.now();
  const phase = warPhase(war, now);
  const att = COUNTRY_MAP[war.attacker];
  const def = COUNTRY_MAP[war.defender];
  const mySide = warSide(war, me.countryCode);
  const canCall = isLeader && (me.countryCode === war.attacker || me.countryCode === war.defender) && phase !== "finish";
  const pend = pendingRef?.current;
  const pn = pend && pend.warId === war.id ? pend.n : 0;
  /* Свій внесок беремо з локального лічильника, а не з останнього опитування бази:
     інакше після відправки кліків шкала на мить відскакує до старого значення. */
  const myLocal = pend && pend.warId === war.id && pend.loaded ? (pend.base || 0) + pn : null;
  const myDelta = myLocal === null ? pn : myLocal - (totals?.mine || 0);
  const attTotal = Math.max(0, (totals?.att || 0) + (mySide === "att" ? myDelta : 0));
  const defTotal = Math.max(0, (totals?.def || 0) + (mySide === "def" ? myDelta : 0));
  const target = war.target || WAR_TARGET;
  const net = attTotal - defTotal;
  const pct = Math.max(0, Math.min(100, (net / target) * 100));
  const mine = pend && pend.warId === war.id ? (pend.base || 0) + pn : 0;
  const allies = (side) => (side === "att" ? war.attAllies : war.defAllies) || [];

  const sideCard = (kind, code, total) => (
    <div className={"cn-warside cn-warside--" + kind}>
      <span className="cn-warside-role">{kind === "att" ? "Атака" : "Захист"}</span>
      <span className="cn-warside-name">
        <Flag code={code} size={16} /> {COUNTRY_MAP[code]?.name || "—"}
      </span>
      {phase === "battle" && <span className="cn-warside-num">{fmt(total)}</span>}
      {allies(kind).length > 0 && <span className="cn-warside-allies">+{allies(kind).length} союзн.</span>}
    </div>
  );

  return (
    <div className={"cn-warhud cn-warhud--" + (phase === "prep" ? "prep" : "battle")}>
      <div className="cn-warhud-kicker">
        <Swords size={14} /> {phase === "prep" ? "ПІДГОТОВКА ДО ВІЙНИ" : "БИТВА ТРИВАЄ"}
      </div>
      <div className="cn-warhud-city">
        {phase === "prep" ? "Війна за місто" : "Битва за місто"} <b>{war.cityName}</b>
      </div>
      {war.botDef > 0 && <div className="cn-dip-sub" style={{ textAlign: "center" }}>У країни-захисника немає гравців: її обороняє бот (+{fmt(war.botDef)}).</div>}

      <div className="cn-warhud-sides">
        {sideCard("att", war.attacker, attTotal)}
        <span className="cn-warhud-vs">VS</span>
        {sideCard("def", war.defender, defTotal)}
      </div>

      {phase === "prep" && (
        <div className="cn-warhud-count">
          Битва почнеться через <b>{fmtClock(war.prepEnd - now)}</b>
        </div>
      )}

      {phase === "battle" && (
        <>
          <div className="cn-warbar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="cn-warbar-att" style={{ width: Math.max(pct, 3) + "%" }} />
            <div className="cn-warbar-spark" style={{ left: Math.max(pct, 3) + "%" }} />
          </div>
          <div className="cn-warbar-legend">
            <span>0</span>
            <span className="cn-warbar-net">Баланс атаки: {net >= 0 ? "+" : "−"}{fmt(Math.abs(net))} / {fmt(target)}</span>
            <span>{fmt(target)}</span>
          </div>
          <div className="cn-warhud-count">
            До кінця битви <b>{fmtClock(war.battleEnd - now)}</b>
          </div>
          <div className="cn-warhud-mine">
            {mySide === "att" ? "Кліки йдуть на атаку" : "Кліки йдуть на захист"} · твій внесок: <b>{fmt(mine)}</b>
          </div>
        </>
      )}

      {canCall && (
        <button className="cn-warhud-btn" type="button" onClick={() => { cnSfx.modalOpen(); setAlliesOpen(true); }}>
          <Handshake size={15} /> Покликати союзників
        </button>
      )}
      {canCall && (
        <button
          className="cn-warhud-btn"
          type="button"
          disabled={ceaseBusy}
          onClick={async () => {
            cnSfx.modalOpen();
            setCeaseBusy(true);
            const res = await sendCeasefireRequest(war);
            setCeaseMsg(res.ok ? "🕊️ Пропозицію перемир'я надіслано лідеру ворога." : "✗ " + res.reason);
            if (!res.ok) cnSfx.error();
            setCeaseBusy(false);
          }}
        >
          🕊️ Запропонувати перемир'я
        </button>
      )}
      {ceaseMsg && <div className="cn-dip-sub" style={{ textAlign: "center" }}>{ceaseMsg}</div>}
      {alliesOpen && <WarAlliesModal war={war} me={me} onClose={() => setAlliesOpen(false)} />}
      <WarParticipants war={war} me={me} players={players} pendingRef={pendingRef} />
    </div>
  );
}


/* Список учасників війни: усі, хто хоч раз клікнув у цій війні (warc:<війна>:<гравець>) */
function WarParticipants({ war, me, players, pendingRef }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = async () => {
      const entries = await sbStorageListEntries(WAR_CLICKS_PREFIX + war.id + ":", true);
      const out = [];
      for (const row of entries || []) {
        try {
          const v = JSON.parse(row.value);
          if (v && (v.side === "att" || v.side === "def") && (v.n || 0) > 0) {
            out.push({ id: row.key.split(":").pop(), side: v.side, c: v.c, n: v.n || 0 });
          }
        } catch {
          /* ignore */
        }
      }
      if (alive) setRows(out);
    };
    load();
    const t = visibleInterval(load, 10000);
    return () => {
      alive = false;
      clearTick(t);
    };
  }, [open, war.id]);

  const pend = pendingRef?.current;
  const myLocal = pend && pend.warId === war.id && pend.loaded ? (pend.base || 0) + (pend.n || 0) : 0;
  const byId = {};
  (players || []).forEach((p) => { byId[p.id] = p; });
  const list = (rows || []).map((r) => (r.id === me.id && myLocal > r.n ? { ...r, n: myLocal } : r));
  if (rows && !list.some((r) => r.id === me.id) && myLocal > 0) {
    list.push({ id: me.id, side: warSide(war, me.countryCode), c: me.countryCode, n: myLocal });
  }
  const sideList = (side) => list.filter((r) => r.side === side).sort((a, b) => b.n - a.n);
  const renderSide = (side) => {
    const l = sideList(side);
    const total = l.reduce((a, r) => a + r.n, 0);
    const code = side === "att" ? war.attacker : war.defender;
    return (
      <div className="cn-wp-side" key={side}>
        <div className={"cn-wp-side-head cn-wp-side-head--" + side}>
          <span>{side === "att" ? "Атака" : "Захист"} · <Flag code={code} size={13} /> {COUNTRY_MAP[code]?.name}</span>
          <b>{l.length} гр. · {fmt(total)}</b>
        </div>
        {l.length === 0 && <div className="cn-wp-empty">Поки ніхто не клікав</div>}
        {l.map((r, i) => {
          const p = byId[r.id];
          const icon = p ? iconById(p.equippedIcon) : null;
          return (
            <div className={"cn-wp-row" + (r.id === me.id ? " cn-wp-row--me" : "")} key={r.id}>
              <span className="cn-wp-rank">{i + 1}</span>
              <span className="cn-wp-ava">{icon ? <ProfileIconGlyph opt={icon} size={22} /> : <User size={14} />}</span>
              <span className="cn-wp-name">{p ? <Nick p={p} /> : "Гравець"}{r.c && r.c !== code ? <> <Flag code={r.c} size={11} /></> : null}</span>
              <span className="cn-wp-clicks">{fmt(r.n)}<small>{total ? Math.round((r.n / total) * 100) : 0}%</small></span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="cn-wp">
      <button className="cn-warhud-btn" type="button" onClick={() => { cnSfx.navSwitch(); setOpen((o) => !o); }}>
        <Users size={15} /> Учасники війни
        <ChevronDown size={15} className={"cn-chevron" + (open ? " cn-chevron--open" : "")} />
      </button>
      {open && (
        <div className="cn-wp-body">
          {rows === null ? <div className="cn-wp-empty">Завантаження…</div> : (
            <>
              <div className="cn-wp-summary">Усього учасників: <b>{list.length}</b> · кліків: <b>{fmt(list.reduce((a, r) => a + r.n, 0))}</b></div>
              {renderSide("att")}
              {renderSide("def")}
            </>
          )}
        </div>
      )}
    </div>
  );
}


function WarAlliesModal({ war, me, onClose }) {
  const [dip, setDip] = useState(null);
  const [busy, setBusy] = useState(null);
  const [sent, setSent] = useState({});
  const [msg, setMsg] = useState("");
  useEffect(() => {
    loadDiplomacy().then(setDip);
  }, []);
  const close = () => { cnSfx.modalClose(); onClose(); };
  const mine = me.countryCode;
  const list = (dip?.allies || [])
    .filter((x) => x.a === mine || x.b === mine)
    .map((x) => (x.a === mine ? x.b : x.a))
    .filter((c) => COUNTRY_MAP[c] && !warInvolves(war, c));

  const invite = async (code) => {
    setBusy(code);
    setMsg("");
    const res = await inviteWarAlly(war, mine, code);
    if (res.ok) {
      cnSfx.purchase();
      setSent((m) => ({ ...m, [code]: true }));
    } else {
      cnSfx.error();
      setMsg("✗ " + res.reason);
    }
    setBusy(null);
  };

  return (
    <div className="cn-modal-overlay" onClick={close}>
      <div className="cn-modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cn-modal-header">
          <div className="cn-modal-title">
            <Handshake size={16} /> Покликати союзників
          </div>
          <button className="cn-icon-btn" type="button" onClick={close} aria-label="Закрити">
            <X size={16} />
          </button>
        </div>
        <div className="cn-dip-sub" style={{ marginBottom: 8 }}>
          Лідер союзника отримає лист у Пошті. Коли він прийме, гравці його країни кликатимуть на вашу сторону.
        </div>
        {msg && <div className="cn-dev-status-msg">{msg}</div>}
        <div className="cn-dip-list">
          {!dip && <div className="cn-lb-empty">Завантаження…</div>}
          {dip && list.length === 0 && <div className="cn-lb-empty">Немає союзників, яких можна покликати</div>}
          {list.map((c) => (
            <div className="cn-dip-row" key={c}>
              <Flag code={c} size={22} className="cn-country-badge--lg" />
              <div className="cn-dip-row-name">{COUNTRY_MAP[c].name}</div>
              <button className="cn-dev-btn" type="button" disabled={busy === c || sent[c]} onClick={() => invite(c)}>
                {sent[c] ? "Запрошено ✓" : "Покликати"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  News                                                                */
/* ------------------------------------------------------------------ */

export function NewsModal({ news, onClose }) {
  const close = () => { cnSfx.modalClose(); onClose(); };
  return <NewsBroadcast news={news} onClose={close} timeAgo={timeAgo} />;
}


export const NICK_COLORS = [
  { id: "gold", label: "Золотий", a: "#B7791F", b: "#FFF3B0" },
  { id: "blue", label: "Синій", a: "#2563EB", b: "#BFE0FF" },
  { id: "cyan", label: "Бірюзовий", a: "#0891B2", b: "#C7F9FF" },
  { id: "green", label: "Зелений", a: "#16A34A", b: "#C9FFD8" },
  { id: "red", label: "Червоний", a: "#DC2626", b: "#FFD0CC" },
  { id: "pink", label: "Рожевий", a: "#DB2777", b: "#FFD3EA" },
  { id: "purple", label: "Фіолетовий", a: "#7C3AED", b: "#E2D1FF" },
  { id: "rainbow", label: "Веселка", rainbow: true },
];

function nickFxStyle(p) {
  if (!p || !p.hasPremiumPass || !p.nickFx) return null;
  const c = NICK_COLORS.find((x) => x.id === p.nickColor) || NICK_COLORS[0];
  const grad = c.rainbow
    ? "linear-gradient(90deg,#ff5f6d,#ffc371,#fff07a,#6ee7a0,#5eb5ff,#b794ff,#ff5f6d)"
    : `linear-gradient(90deg,${c.a},${c.b},${c.a},${c.b},${c.a})`;
  return { backgroundImage: grad };
}

/* Нікнейм гравця: з Premium та увімкненою косметикою — переливається обраним кольором */
export function Nick({ p, children }) {
  const st = nickFxStyle(p);
  const text = children !== undefined ? children : p?.username;
  if (!st) return <>{text}</>;
  return <span className="cn-nick-fx" style={st}>{text}</span>;
}


/* ------------------------------------------------------------------ */
/*  Profile screen                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Profile customization: icons, titles, achievements/badges          */
/* ------------------------------------------------------------------ */

const AVATAR_KNIGHT_BLUE = "/img/avatar-knight-blue.webp";

const AVATAR_KNIGHT_GOLD = "/img/avatar-knight-gold.webp";

const AVATAR_KNIGHT_BANNER = "/img/avatar-knight-banner.webp";

const AVATAR_KING_CROWNED = "/img/avatar-king-crowned.webp";

const AVATAR_WANDERER = "/img/avatar-wanderer.webp";

const AVATAR_LION_WARLORD = "/img/avatar-lion-warlord.webp";

const AVATAR_DONKEY = "/img/avatar-donkey.webp";

const AVATAR_SWORD = "/img/avatar-sword.webp";

const AVATAR_CROWN_PILLOW = "/img/avatar-crown-pillow.webp";


/* ------------------------------------------------------------------ */
/*  Profile banners (embedded)                                          */
/* ------------------------------------------------------------------ */

const AVATAR_PRINCE = "/img/avatar-prince.webp";

const AVATAR_WARRIOR = "/img/avatar-warrior.webp";

const BANNER_CAMPFIRE = "/img/banner-campfire.jpg";

const BANNER_CLIFFSIDE = "/img/banner-cliffside.jpg";

const BANNER_GRAND_CASTLE = "/img/banner-grand-castle.jpg";

const BANNER_KINGS_VIEW = "/img/banner-kings-view.jpg";

const BANNER_MARCH = "/img/banner-march.jpg";

const BANNER_MEADOW = "/img/banner-meadow.jpg";


export const BANNER_OPTIONS = [
  { id: "campfire", img: BANNER_CAMPFIRE, label: "Табір лицарів" },
  { id: "cliffside", img: BANNER_CLIFFSIDE, label: "Замок на скелі" },
  { id: "grand_castle", img: BANNER_GRAND_CASTLE, label: "Королівська фортеця" },
  { id: "kings_view", img: BANNER_KINGS_VIEW, label: "Світанок королівства" },
  { id: "march", img: BANNER_MARCH, label: "Шлях лицаря" },
  { id: "meadow", img: BANNER_MEADOW, label: "Мирна долина" },
];


export function bannerById(id) {
  return BANNER_OPTIONS.find((b) => b.id === id) || null;
}


export const PROFILE_ICONS = [
  { id: "avatar_recruit", img: AVATAR_WANDERER, label: "Новобранець", req: 0, passIcon: true },
  { id: "avatar_warrior", img: AVATAR_KNIGHT_BLUE, label: "Воїн", req: 0, passIcon: true },
  { id: "avatar_knight", img: AVATAR_WARRIOR, label: "Лицар", req: 0, passIcon: true },
  { id: "avatar_golden_knight", img: AVATAR_KNIGHT_GOLD, label: "Золотий Лицар", req: 0, passIcon: true },
  { id: "avatar_prince", img: AVATAR_PRINCE, label: "Принц", req: 0, passIcon: true },
  { id: "avatar_king", img: AVATAR_KING_CROWNED, label: "Король", req: 0, passIcon: true },
  { id: "knight_blue", img: AVATAR_KNIGHT_BLUE, label: "Лицар Блакиті", req: 0, passIcon: true, legacy: true },
  { id: "knight_gold", img: AVATAR_KNIGHT_GOLD, label: "Золотий Лицар", req: 0, passIcon: true, legacy: true },
  { id: "knight_banner", img: AVATAR_KNIGHT_BANNER, label: "Лицар зі Стягом", req: 0, passIcon: true, legacy: true },
  { id: "king_crowned", img: AVATAR_KING_CROWNED, label: "Коронований Король", req: 0, passIcon: true, legacy: true },
  { id: "wanderer", img: AVATAR_WANDERER, label: "Мандрівник", req: 0, passIcon: true, legacy: true },
  { id: "lion_warlord", img: AVATAR_LION_WARLORD, label: "Лев-Полководець", req: 0, passIcon: true, legacy: true },
  { id: "donkey", img: AVATAR_DONKEY, label: "Ослик", req: 0, passIcon: true, secret: true },
  { id: "sword", img: AVATAR_SWORD, label: "Легендарний Меч", req: 0 },
  { id: "crown_pillow", img: AVATAR_CROWN_PILLOW, label: "Корона на Подушці", req: 0, passIcon: true, legacy: true },
  { id: "crown", Icon: Crown, req: 0 },
  { id: "flame", Icon: Flame, req: 0 },
  { id: "zap", Icon: Zap, req: 0 },
  { id: "trophy", Icon: Trophy, req: 0 },
  { id: "shield", Icon: Shield, req: 0 },
  { id: "compass", Icon: Compass, req: 0 },
  { id: "shieldcheck", Icon: ShieldCheck, req: 300 },
  { id: "swords", Icon: Swords, req: 300 },
  { id: "gamepad", Icon: Gamepad2, req: 600 },
  { id: "coins", Icon: Coins, req: 600 },
  { id: "mouse", Icon: MousePointerClick, req: 1200 },
  { id: "chart", Icon: BarChart3, req: 1200 },
  { id: "handshake", Icon: Handshake, req: 2500 },
  { id: "layers", Icon: Layers, req: 2500 },
  { id: "users", Icon: Users, req: 5000 },
  { id: "globe", Icon: Globe2, req: 8000 },
];


export function iconById(id) {
  return PROFILE_ICONS.find((i) => i.id === id) || null;
}


export function ProfileIconGlyph({ opt, size }) {
  if (!opt) return null;
  if (opt.img) {
    return (
      <img
        src={opt.img}
        alt={opt.label || ""}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "50%",
          display: "block",
        }}
      />
    );
  }
  const Icon = opt.Icon;
  return <Icon size={size} />;
}


/* ------------------------------------------------------------------ */
/*  Battle Pass / Premium Pass                                         */
/* ------------------------------------------------------------------ */

const BATTLE_PASS_LEVELS = PASS_MAX_LEVEL + 1;


/* Нагороди, які гравець уже забрав у цьому сезоні. */
export function passClaimedList(me, track) {
  if (!me || me.passRev !== PASS_REV) return [];
  return (track === "premium" ? me.passClaimedPremium : me.passClaimedFree) || [];
}


/* Новий сезон: обнуляємо прогрес проходу, відлік кліків іде від поточного значення. */
export function migratePass(me) {
  if (!me || me.passRev === PASS_REV) return me;
  return { ...me, passRev: PASS_REV, passBaseClicks: me.totalClicks || 0, passClaimedFree: [], passClaimedPremium: [], points: me.points || 0 };
}


/* Таблиця нагород: [free, premium] для кожного рівня 0–50.
   Типи: p — Points (кількість), t — титул, b — банер профілю, a — аватар (фото профілю).
   Титули, банери й фото профілю поки в розробці: нагорода записується гравцю, а самі розділи з'являться пізніше. */

const PASS_ICON_DEFS = {
  "Новобранець": { iconId: "avatar_recruit", img: AVATAR_WANDERER },
  "Воїн": { iconId: "avatar_warrior", img: AVATAR_KNIGHT_BLUE },
  "Лицар": { iconId: "avatar_knight", img: AVATAR_WARRIOR },
  "Золотий Лицар": { iconId: "avatar_golden_knight", img: AVATAR_KNIGHT_GOLD },
  "Принц": { iconId: "avatar_prince", img: AVATAR_PRINCE },
  "Король": { iconId: "avatar_king", img: AVATAR_KING_CROWNED },
};

const PASS_BANNER_DEFS = {
  // Free
  "Мирна долина": { bannerId: "meadow", img: BANNER_MEADOW },
  "Шлях лицаря": { bannerId: "march", img: BANNER_MARCH },
  "Світанок королівства": { bannerId: "kings_view", img: BANNER_KINGS_VIEW },
  // Premium
  "Табір лицарів": { bannerId: "campfire", img: BANNER_CAMPFIRE },
  "Замок на скелі": { bannerId: "cliffside", img: BANNER_CLIFFSIDE },
  "Королівська фортеця": { bannerId: "grand_castle", img: BANNER_GRAND_CASTLE },
};


function buildPassTrack(track) {
  const idx = track === "premium" ? 1 : 0;
  return PASS_REWARD_TABLE.map((pair, level) => {
    const [kind, v] = pair[idx];
    if (kind === "p") return { level, type: "points", amount: v };
    if (kind === "t") return { level, type: "title", titleId: PASS_TITLE_IDS[v], label: v };
    if (kind === "a") return { level, type: "icon", iconId: PASS_ICON_DEFS[v].iconId, img: PASS_ICON_DEFS[v].img, label: v };
    return { level, type: "banner", bannerId: PASS_BANNER_DEFS[v].bannerId, img: PASS_BANNER_DEFS[v].img, label: v };
  });
}


export const FREE_PASS_REWARDS = buildPassTrack("free");

export const PREMIUM_PASS_REWARDS = buildPassTrack("premium");


function passRewardByLevel(track, level) {
  const list = track === "premium" ? PREMIUM_PASS_REWARDS : FREE_PASS_REWARDS;
  return list.find((r) => r.level === level) || null;
}


function applyPassReward(updated, reward) {
  if (reward.type === "points") {
    updated.points = (updated.points || 0) + reward.amount;
  } else if (reward.type === "banner") {
    updated.unlockedPassBanners = Array.from(new Set([...(updated.unlockedPassBanners || []), reward.bannerId]));
  } else if (reward.type === "icon") {
    updated.unlockedIcons = Array.from(new Set([...(updated.unlockedIcons || []), reward.iconId]));
  } else if (reward.type === "title") {
    updated.unlockedTitles = Array.from(new Set([...(updated.unlockedTitles || []), reward.titleId]));
  } else if (reward.type === "badge") {
    updated.unlockedBadges = Array.from(new Set([...(updated.unlockedBadges || []), reward.badgeId]));
  }
}


export async function buyPremiumPass(me, onSetPlayer) {
  if (!me || me.hasPremiumPass) return false;

  const tg = window.Telegram?.WebApp;
  if (!tg?.openInvoice) {
    alert("Оплата Telegram Stars доступна лише всередині Telegram.");
    return false;
  }

  let link;
  try {
    const resp = await fetch("/api/create-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData || "" }),
    });
    const data = await resp.json();
    if (!data.link) throw new Error(data.error || "Не вдалося створити рахунок");
    link = data.link;
  } catch (err) {
    console.warn("buyPremiumPass: помилка створення рахунку:", err?.message || err);
    alert("Не вдалося відкрити оплату. Спробуй ще раз пізніше.");
    return false;
  }

  return new Promise((resolve) => {
    tg.openInvoice(link, async (status) => {
      if (status !== "paid") {
        resolve(false);
        return;
      }
      // Premium видає СЕРВЕР через /api/webhook після реального платежу.
      // Клієнт більше нічого сам не пише — лише чекає, поки запис
      // гравця (players:{me.id}) оновиться в базі.
      const finalRecord = await waitForPremiumGrant(me.id);
      if (finalRecord) {
        onSetPlayer(finalRecord);
      } else {
        alert("Оплата пройшла, але активація Premium триває довше зазвичай. Онови гру за хвилину.");
      }
      resolve(!!finalRecord?.hasPremiumPass);
    });
  });
}


async function waitForPremiumGrant(playerId, attempts = 8, delayMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    const raw = await storageGet(PLAYER_PREFIX + playerId, true);
    if (raw) {
      try {
        const rec = JSON.parse(raw);
        if (rec.hasPremiumPass) return rec;
      } catch {
        /* ignore corrupt record, keep polling */
      }
    }
  }
  return null;
}


/* ------------------------------------------------------------------ */
/*  Mail                                                                */
/* ------------------------------------------------------------------ */

export function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "щойно";
  if (min < 60) return min + " хв тому";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + " год тому";
  const days = Math.floor(hr / 24);
  return days + " дн тому";
}


function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}


/* ------------------------------------------------------------------ */
/*  Shop screen                                                         */
/* ------------------------------------------------------------------ */

const PASS_POINTS_SUM = (list) => list.reduce((a, r) => a + (r.type === "points" ? r.amount : 0), 0);


function PremiumOffer({ me, onOpen }) {
  const owned = !!me?.hasPremiumPass;
  const [price, setPrice] = useState(null);
  useEffect(() => {
    storageGet(PREMIUM_PASS_PRICE_KEY, true)
      .then((raw) => {
        const n = raw ? Number(JSON.parse(raw)) : 50;
        if (Number.isFinite(n) && n > 0) setPrice(Math.round(n));
      })
      .catch(() => {});
  }, []);
  const freePts = PASS_POINTS_SUM(FREE_PASS_REWARDS);
  const premPts = PASS_POINTS_SUM(PREMIUM_PASS_REWARDS);
  const demoNick = { hasPremiumPass: true, nickFx: true, nickColor: "rainbow" };

  return (
    <div className="cn-offer" data-tut="premium-offer">
      <div className="cn-offer-hero">
        <img className="cn-offer-img" src={SHOP_BANNER_IMG} alt="Premium Pass" />
        <div className="cn-offer-shade" />
        <span className="cn-offer-spark cn-offer-spark--1" />
        <span className="cn-offer-spark cn-offer-spark--2" />
        <span className="cn-offer-spark cn-offer-spark--3" />
        <span className="cn-offer-spark cn-offer-spark--4" />
        <div className="cn-offer-badge"><Crown size={13} /> PREMIUM PASS</div>
        <div className="cn-offer-hero-text">
          <div className="cn-offer-title">Стань легендою сезону</div>
          <div className="cn-offer-sub">Подвійні нагороди, ексклюзивні аватарки, банери й титули та нікнейм, що сяє золотом.</div>
        </div>
      </div>

      <div className="cn-offer-grid">
        <div className="cn-offer-card">
          <div className="cn-offer-card-title"><GemIcon size={14} /> Points ×2</div>
          <div className="cn-offer-bars">
            <div className="cn-offer-bar-row"><span>Free</span><i className="cn-offer-bar"><b className="cn-offer-bar-fill cn-offer-bar-fill--free" /></i><em>{fmt(freePts)}</em></div>
            <div className="cn-offer-bar-row"><span>Premium</span><i className="cn-offer-bar"><b className="cn-offer-bar-fill cn-offer-bar-fill--prem" /></i><em>{fmt(premPts)}</em></div>
          </div>
          <div className="cn-offer-card-sub">вдвічі більше Points за рівні Battle Pass</div>
        </div>

        <div className="cn-offer-card">
          <div className="cn-offer-card-title"><Sparkles size={14} /> Сяючий нікнейм</div>
          <div className="cn-offer-nick"><Nick p={demoNick}>{me?.username || "Твій нік"}</Nick></div>
          <div className="cn-offer-dots">
            {NICK_COLORS.map((c) => (
              <i key={c.id} style={{ background: c.rainbow ? "linear-gradient(90deg,#ff5f6d,#ffc371,#6ee7a0,#5eb5ff,#b794ff)" : `linear-gradient(135deg,${c.a},${c.b})` }} />
            ))}
          </div>
          <div className="cn-offer-card-sub">переливається в рейтингу й профілі, 8 кольорів</div>
        </div>

        <div className="cn-offer-card">
          <div className="cn-offer-card-title"><User size={14} /> Ексклюзивні аватарки</div>
          <div className="cn-offer-avatars">
            {[AVATAR_KNIGHT_BLUE, AVATAR_KNIGHT_GOLD, AVATAR_KING_CROWNED].map((img, i) => (
              <span className="cn-offer-ava" key={i} style={{ animationDelay: i * 0.25 + "s" }}><img src={img} alt="" /></span>
            ))}
          </div>
          <div className="cn-offer-card-sub">Воїн, Золотий Лицар, Король</div>
        </div>

        <div className="cn-offer-card">
          <div className="cn-offer-card-title"><ImageIcon size={14} /> Банери й титули</div>
          <div className="cn-offer-banners">
            {[BANNER_CAMPFIRE, BANNER_CLIFFSIDE, BANNER_GRAND_CASTLE].map((img, i) => (
              <img key={i} src={img} alt="" className={"cn-offer-banner cn-offer-banner--" + i} />
            ))}
          </div>
          <div className="cn-offer-card-sub">3 банери та 3 титули тільки для Premium</div>
        </div>
      </div>

      <div className="cn-offer-lb">
        <div className="cn-offer-lb-label">В рейтингу ти виглядаєш інакше</div>
        <div className="cn-offer-lb-row">
          <span className="cn-offer-lb-rank">1</span>
          <span className="cn-offer-lb-ava"><User size={16} /><Crown size={11} className="cn-offer-lb-crown" /></span>
          <span className="cn-offer-lb-name"><Nick p={{ ...demoNick, nickColor: "gold" }}>{me?.username || "Твій нік"}</Nick></span>
          <span className="cn-offer-lb-val">{fmt(me?.power || 0)}</span>
        </div>
        <div className="cn-offer-card-sub">золота корона на аватарці й виділений рядок</div>
      </div>

      <button className={"cn-offer-cta" + (owned ? " cn-offer-cta--owned" : "")} type="button" onClick={onOpen}>
        <span className="cn-offer-cta-shine" />
        {owned ? (<><Check size={16} /> Premium Pass активний</>) : (<><Crown size={16} /> Отримати Premium Pass{price ? <b className="cn-offer-price">⭐ {price}</b> : null}</>)}
      </button>
    </div>
  );
}


export function ShopScreen({ onGoToSeason, me, onSetPlayer, isLeader, onRefreshGameData }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const tapRef = useRef({ n: 0, t: 0 });
  const onSoonTap = () => {
    const now = Date.now();
    const r = tapRef.current;
    r.n = now - r.t > 1500 ? 1 : r.n + 1;
    r.t = now;
    if (r.n >= 10) {
      r.n = 0;
      cnSfx.modalOpen();
      setTermOpen(true);
    }
  };

  return (
    <div className="cn-shop">
      <PremiumOffer me={me} onOpen={() => { cnSfx.modalOpen(); setDetailsOpen(true); }} />

      <div className="cn-shop-soon" onClick={onSoonTap} role="presentation">
        <div className="cn-shop-soon-ico"><ShoppingBag size={22} /></div>
        <div className="cn-shop-soon-title">Нові товари вже в дорозі</div>
        <div className="cn-shop-soon-text">Ми готуємо для тебе ексклюзивні набори, косметику та сюрпризи. Заглядай сюди частіше — скоро тут стане цікавіше.</div>
        <div className="cn-shop-soon-dots"><i /><i /><i /></div>
      </div>

      {termOpen && <SecretTerminal me={me} onSetPlayer={onSetPlayer} onClose={() => setTermOpen(false)} />}
      {detailsOpen && (
        <PremiumPassModal onClose={() => setDetailsOpen(false)} me={me} onSetPlayer={onSetPlayer} onGoToSeason={onGoToSeason} />
      )}
    </div>
  );
}


function SecretTerminal({ me, onSetPlayer, onClose }) {
  const [lines, setLines] = useState([
    { c: "dim", t: "WORLD CLICKER // SECRET TERMINAL v1.0" },
    { c: "dim", t: "З'єднання встановлено… OK" },
    { c: "ok", t: "Введи команду та натисни Enter." },
  ]);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    const hide = () => { if (document.hidden) onClose(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", onClose);
    if (inputRef.current) inputRef.current.focus();
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", onClose);
    };
  }, [onClose]);
  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: "end" }); }, [lines]);

  const push = (arr) => setLines((l) => [...l, ...arr]);
  const run = async (e) => {
    e.preventDefault();
    const cmd = val.trim();
    setVal("");
    if (!cmd || busy) return;
    const echo = { c: "cmd", t: "> " + cmd };
    const low = cmd.toLowerCase();
    if (low === "oslyk") {
      if ((me.unlockedIcons || []).includes("donkey")) {
        push([echo, { c: "warn", t: "Доступ уже відкрито: фото профілю «Ослик» у тебе є." }]);
        return;
      }
      setBusy(true);
      push([echo, { c: "dim", t: "Перевірка ключа…" }]);
      const updated = { ...me, unlockedIcons: Array.from(new Set([...(me.unlockedIcons || []), "donkey"])) };
      await storageSet(PLAYER_PREFIX + me.id, JSON.stringify(updated), true);
      onSetPlayer(updated);
      cnSfx.purchase();
      push([
        { c: "ok", t: "ДОСТУП ДОЗВОЛЕНО" },
        { c: "ok", t: "🫏 Розблоковано фото профілю «Ослик»! Знайдеш його в Профіль → Косметика." },
      ]);
      setBusy(false);
    } else if (low === "clear") {
      setLines([]);
    } else if (low === "exit") {
      onClose();
    } else {
      push([echo, { c: "err", t: `ПОМИЛКА 404: команду «${cmd.slice(0, 40)}» не розпізнано. Доступ відхилено.` }]);
    }
  };

  return (
    <div className="cn-term-overlay">
      <div className="cn-term">
        <div className="cn-term-bar">
          <span className="cn-term-dot cn-term-dot--r" />
          <span className="cn-term-dot cn-term-dot--y" />
          <span className="cn-term-dot cn-term-dot--g" />
          <span className="cn-term-title">secret@world-clicker:~</span>
          <button type="button" className="cn-term-min" onClick={() => { cnSfx.modalClose(); onClose(); }} aria-label="Згорнути термінал">—</button>
        </div>
        <div className="cn-term-body" onClick={() => inputRef.current && inputRef.current.focus()}>
          {lines.map((l, i) => <div key={i} className={"cn-term-line cn-term-line--" + l.c}>{l.t}</div>)}
          <form className="cn-term-form" onSubmit={run}>
            <span className="cn-term-prompt">&gt;</span>
            <input
              ref={inputRef}
              className="cn-term-input"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
            />
          </form>
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}


function PremiumPassModal({ onClose, me, onSetPlayer, onGoToSeason }) {
  const perks = [
    { icon: GemIcon, title: "POINTS ×2", desc: "Нагороди Premium-лінії Battle Pass дають удвічі більше Points на кожному рівні." },
    { icon: User, title: "ЕКСКЛЮЗИВНІ АВАТАРКИ", desc: "Воїн, Золотий Лицар і Король: фото профілю, яких немає у безкоштовній лінії." },
    { icon: ImageIcon, title: "БАНЕРИ Й ТИТУЛИ", desc: "Табір лицарів, Замок на скелі, Королівська фортеця та титули Воїн, Золотий Лицар, Король." },
    { icon: Sparkles, title: "СЯЮЧИЙ НІКНЕЙМ", desc: "Нікнейм переливається обраним кольором у профілі та в рейтингу." },
    { icon: Crown, title: "КОРОНА В РЕЙТИНГУ", desc: "Золота корона на аватарці й виділений рядок серед інших гравців." },
    { icon: ShieldCheck, title: "ПРЕМІУМ-ЗНАЧКИ", desc: "Ексклюзивні значки за 15, 30 та 45 рівні Premium Pass." },
  ];

  const owned = !!me?.hasPremiumPass;
  const close = () => { cnSfx.modalClose(); onClose(); };

  const handleBuy = async () => {
    if (!me || owned) return;
    const paid = await buyPremiumPass(me, onSetPlayer);
    if (!paid) return;
    cnSfx.purchase();
    onClose();
    if (onGoToSeason) onGoToSeason();
  };

  return (
    <div className="cn-modal-overlay" onClick={close}>
      <div className="cn-modal-sheet cn-premium-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cn-premium-hero">
          <img className="cn-premium-hero-img" src={SHOP_BANNER_IMG} alt="Premium Pass" />
          <button className="cn-icon-btn cn-premium-close" type="button" onClick={close} aria-label="Закрити">
            <X size={16} />
          </button>
        </div>

        <div className="cn-premium-perks-title">
          <span className="cn-premium-perks-line" />
          ТИ ОТРИМУЄШ
          <span className="cn-premium-perks-line" />
        </div>

        <div className="cn-premium-perks">
          {perks.map((p) => (
            <div className="cn-premium-perk" key={p.title}>
              <div className="cn-premium-perk-icon">
                <p.icon size={20} />
              </div>
              <div>
                <div className="cn-premium-perk-title">{p.title}</div>
                <div className="cn-premium-perk-desc">{p.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          className="cn-shop-more-btn cn-premium-buy-btn"
          type="button"
          disabled={owned}
          onClick={handleBuy}
        >
          <Crown size={16} /> {owned ? "Вже придбано" : "Активувати Premium Pass"}
        </button>
      </div>
    </div>
  );
}


function ComingSoon({ title, description, icon: Icon }) {

  return (
    <div className="cn-soon">
      <div className="cn-soon-icon-wrap">
        <Icon size={30} className="cn-soon-icon" />
        <div className="cn-soon-lock">
          <Lock size={12} />
        </div>
      </div>
      <div className="cn-soon-title">{title}</div>
      <div className="cn-soon-badge">Coming Soon</div>
      <div className="cn-soon-desc">{description}</div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Bottom navigation                                                   */
/* ------------------------------------------------------------------ */

export function BottomNav({ tab, setTab, unreadMail, lang = "uk" }) {
  const [pending, setPending] = useState(null);
  useEffect(() => { setPending(null); }, [tab]);
  const shownTab = pending || tab;
  return (
    <nav className="cn-nav" aria-label="Головна навігація">
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = shownTab === item.id;
        return (
          <button
            key={item.id}
            data-tut={"nav-" + item.id}
            className={"cn-nav-btn" + (active ? " cn-nav-btn--active" : "")}
            onClick={() => {
              if (item.id !== tab) cnSfx.navSwitch();
              setPending(item.id);
              startTransition(() => setTab(item.id));
            }}
            type="button"
            aria-current={active ? "page" : undefined}
          >
            <div className="cn-nav-icon-wrap">
              <Icon size={22} />
              {item.soon && <span className="cn-nav-dot" />}
              {item.id === "hq" && unreadMail > 0 && (
                <span className="cn-nav-badge">{unreadMail > 9 ? "9+" : unreadMail}</span>
              )}
            </div>
            <span className="cn-nav-label">{t(lang, "nav_" + item.id)}</span>
          </button>
        );
      })}
    </nav>
  );
}


/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

/* Заглушка на час підвантаження лінивого чанка екрана (тематичний спінер «Мультяшної планети») */
export function LazyFallback() {
  return (
    <div className="cn-lazy-fallback" role="status" aria-live="polite">
      <span className="cn-lazy-orb" aria-hidden="true" />
      <span className="cn-lazy-text">Завантаження…</span>
    </div>
  );
}
