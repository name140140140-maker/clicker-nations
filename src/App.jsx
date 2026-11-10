/* build: 1787523498 */
import DroneGame, { DRONE_MODELS } from "./DroneGame.jsx";
import SniperGame from "./SniperGame.jsx";
import LoadingScreen from "./LoadingScreen.jsx";
import { REAL_ID_RE } from "./realCountries.js";
import NewsBroadcast from "./NewsBroadcast.jsx";
import React, { useState, useEffect, useRef, useMemo, useCallback, startTransition } from "react";
import {
  Zap,
  Trophy,
  CalendarDays,
  User,
  Users,
  Map as MapIcon,
  Lock,
  Globe2,
  ScrollText,
  RefreshCw,
  Flame,
  Crown,
  X,
  ChevronDown,
  ChevronLeft,
  Search,
  Layers,
  Settings,
  Mail,
  MailOpen,
  Send,
  Check,
  Ban,
  ArrowRight,
  Trash2,
  Bug,
  Handshake,
  Swords,
  Crosshair,
  Target,
  ShieldCheck,
  UserCog,
  Palette,
  ShoppingBag,
  Newspaper,
  Gift,
  Gamepad2,
  Shield,
  Compass,
  Minus,
  Plus,
  ArrowLeft,
  MousePointerClick,
  BarChart3,
  ShoppingCart,
  ChevronRight,
  Clock3,
  Coins,
  Award,
  Sparkles,
  LifeBuoy,
  Star,
  UserPlus,
  Pencil,
  Copy,
  Image as ImageIcon,
  Info,
  TrendingUp,
  Landmark,
  BarChart2,
} from "lucide-react";
import { sbStorageGet, sbStorageSet, sbStorageListKeys, sbStorageListEntries, sbStorageInsertIfAbsent } from "./supabaseStorage";
import TerritoryMap, { MAP_COLORS } from "./TerritoryMap";
import { fmtPopulation, loadCities, cityKey } from "./map/cities";
import {
  loadNations,
  createCountry,
  updateCountryColor,
  pickFreeColor,
  validateCountryName,
  loadChangelog,
  saveChangelog,
  COUNTRY_COLORS,
  TERRITORY_PREFIX,
  CITY_OWN_PREFIX,
  NAME_MIN,
  NAME_MAX,
} from "./nations";
import { BUILTIN_CHANGELOG } from "./changelog";
import MaintenanceScreen from "./MaintenanceScreen";

/* ------------------------------------------------------------------ */
/*  Season banner artwork (embedded)                                   */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/*  Tutorial mentor portraits (embedded)                               */
/* ------------------------------------------------------------------ */

const GLOBY_IDLE_IMG = "/img/globy-idle-img.jpg";
const GLOBY_POINT_IMG = "/img/globy-point-img.jpg";
const GLOBY_WAVE2_IMG = "/img/globy-wave2-img.jpg";
const GLOBY_WAVE_IMG = "/img/globy-wave-img.jpg";
const GLOBY_PRESENT_IMG = "/img/globy-present-img.jpg";

const SHOP_BANNER_IMG = "/img/shop-banner-img.jpg";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_ENERGY = 100;
/* Бот підтримки: ім'я користувача (без @) задається змінною VITE_SUPPORT_BOT_USERNAME на Vercel */
const SUPPORT_BOT_USERNAME = (import.meta.env && import.meta.env.VITE_SUPPORT_BOT_USERNAME) || "";
function openSupportChat() {
  if (!SUPPORT_BOT_USERNAME) {
    alert("Підтримка скоро буде доступна.");
    return;
  }
  const url = `https://t.me/${SUPPORT_BOT_USERNAME}?start=support`;
  const wa = window.Telegram?.WebApp;
  if (wa?.openTelegramLink) wa.openTelegramLink(url);
  else window.open(url, "_blank");
}
const NO_WARS = [];
/* Кулдаун між діями лідера/радника/повстанця (8 годин) */
const ACTION_COOLDOWN_MS = 8 * 60 * 60 * 1000;
export { cnSfx };

const ENERGY_REGEN_PER_SEC = 1;

/* ------------------------------------------------------------------ */
/*  Покращення (за Points): енергія та оборона міста                   */
/*  player.upg = { emax, ereg, cdef } — куплений рівень 0..5          */
/* ------------------------------------------------------------------ */
const UPG_MAX_LEVEL = 5;
const WAR_DECLARE_COST = 5000; // Power за оголошення війни
const FREE_CAPTURE_COST = 5000; // Power за захоплення вільної області
const FREE_CAPTURE_CD_MS = 10 * 60 * 1000; // пауза між захопленнями однієї країни
const CAPCD_PREFIX = "capcd:"; // capcd:<країна> → час, до якого країна не може захоплювати вільні області
const CITY_DEF_UPGRADE_COST = 5000; // Power за рівень оборони міста
const CITY_DEF_PREFIX = "citydef:"; // citydef:<cityKey> → рівень оборони міста (0..5)
const UPGRADES = [
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
const CITY_DEF_THRESHOLDS = [10000, 12000, 15000, 20000, 25000, 30000];
function upgLevel(rec, id) {
  const n = Math.floor(Number(rec?.upg?.[id]) || 0);
  return Math.max(0, Math.min(UPG_MAX_LEVEL, n));
}
function maxEnergyOf(rec) {
  const l = upgLevel(rec, "emax");
  return l > 0 ? UPGRADES[0].values[l - 1] : MAX_ENERGY;
}
function energyRegenOf(rec) {
  const l = upgLevel(rec, "ereg");
  return l > 0 ? UPGRADES[1].values[l - 1] : ENERGY_REGEN_PER_SEC;
}
async function getCityDefLevel(cityKeyStr) {
  const raw = await storageGet(CITY_DEF_PREFIX + cityKeyStr, true);
  const n = Math.floor(Number(raw) || 0);
  return Math.max(0, Math.min(UPG_MAX_LEVEL, n));
}
const ID_KEY = "my-player-id";
const TUTORIAL_KEY = "tutorial-done-v2";
const TOS_KEY = "tos-accepted-v2"; // v2: оновлена угода (згадка про персональні дані)
const PLAYER_PREFIX = "players:";
// Мапінг Telegram ID -> playerId. Гравець зберігається під рандомним genId(),
// тому щоб серверний webhook міг знайти правильний запис після оплати,
// клієнт при створенні/бекфілі гравця пише сюди tgmap:{telegramId} -> playerId.
const TG_MAP_PREFIX = "tgmap:";
const LEADERBOARD_STALE_MS = 8000;

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

/* Government roles: Лідер (1), Радники (до MAX_ADVISORS). Звичайні громадяни:
   Звичайний громадянин / Повстанець. Ролі 2-4 купуються в магазині за
   ROLE_PRICE Power кожна. */
const ROLE_PRICE = 20000;
const MAX_ADVISORS = 20;

async function getJSON(key, shared, fallback) {
  const raw = await storageGet(key, shared);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function setJSON(key, value, shared) {
  return storageSet(key, JSON.stringify(value), shared);
}

async function getMail(playerId) {
  return getJSON(MAIL_PREFIX + playerId, true, []);
}

async function addMail(playerId, message) {
  const list = await getMail(playerId);
  const full = { id: "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), read: false, ts: Date.now(), ...message };
  list.unshift(full);
  await setJSON(MAIL_PREFIX + playerId, list, true);
  return full;
}

/* Опитування, що не працює у фоні (вкладка/Telegram згорнуті): економить трафік, батарею й CPU. */
function visibleInterval(fn, ms) {
  return setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    fn();
  }, ms);
}

const GAME_STATE_KEY = "game-state";
const SEASON_DURATION_DAYS = 50;
// Версія сезону: при зміні тривалості/нагород сезон стартує заново, а прогрес Battle Pass гравців обнуляється.
const SEASON_REV = 2;
const EMPTY_GAME_STATE = {
  wars: [],
  alliances: [],
  allianceRequests: [],
  cityControl: {},
  cityDefense: {},
  news: [],
  season: { seasonNumber: 1, durationDays: SEASON_DURATION_DAYS, startedAt: null, rev: SEASON_REV },
  advisors: {}, // { [countryCode]: [playerId, ...] } — Рада (до MAX_ADVISORS)
  councilProposals: {}, // { [countryCode]: [proposal, ...] }
  rebellions: [], // повстання проти лідера/радника всередині країни
  maintenance: { enabled: false, message: "" },
};

async function loadGameState() {
  const state = await getJSON(GAME_STATE_KEY, true, null);
  return state ? { ...EMPTY_GAME_STATE, ...state } : { ...EMPTY_GAME_STATE };
}
async function saveGameStatePart(partial) {
  const state = await loadGameState();
  const updated = { ...state, ...partial };
  await setJSON(GAME_STATE_KEY, updated, true);
  return updated;
}

async function getWars() {
  return (await loadGameState()).wars;
}
async function saveWars(list) {
  return saveGameStatePart({ wars: list });
}

async function getAlliances() {
  return (await loadGameState()).alliances;
}
async function saveAlliances(list) {
  return saveGameStatePart({ alliances: list });
}

async function getAllianceRequests() {
  return (await loadGameState()).allianceRequests;
}
async function saveAllianceRequests(list) {
  return saveGameStatePart({ allianceRequests: list });
}

async function getCityControl() {
  return (await loadGameState()).cityControl;
}
async function saveCityControl(obj) {
  return saveGameStatePart({ cityControl: obj });
}

async function getCityDefense() {
  return (await loadGameState()).cityDefense;
}
async function saveCityDefense(obj) {
  return saveGameStatePart({ cityDefense: obj });
}

async function getNews() {
  return (await loadGameState()).news;
}
/* Новина, що не ламає основну дію, якщо запис не вдався */
function pushNews(text) {
  return addNews(text).catch(() => null);
}
/* Новини гри (60 останніх) і новини від адміністрації (30 останніх) обрізаються окремо,
   щоб потік ігрових подій не витісняв оголошення адміна. */
function trimNews(list) {
  const admin = list.filter((n) => n.admin).slice(0, 30);
  const game = list.filter((n) => !n.admin).slice(0, 60);
  return [...admin, ...game].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
async function addNews(text, opts = {}) {
  const state = await loadGameState();
  const item = { id: "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text, ts: Date.now() };
  if (opts.admin) item.admin = true;
  const news = trimNews([item, ...state.news]);
  await saveGameStatePart({ news });
  return item;
}
/* Лист від адміністрації: приходить гравцеві в Пошту у розділ «Від адміністрації» */
async function sendAdminMail(playerId, subject, body) {
  return addMail(playerId, { type: "admin", from: "admin", subject: String(subject || "Повідомлення від адміністрації").slice(0, 80), body: String(body || "").slice(0, 1000) });
}

/* Season: shared across all players. First player to load it after it's
   unset (or after a new season revision) kicks off the 50-day timer for everyone. */
async function ensureSeasonStarted() {
  const state = await loadGameState();
  const season = state.season || EMPTY_GAME_STATE.season;
  if (season.startedAt && season.rev === SEASON_REV) return season;
  // Новий сезон (50 днів): стартує одразу для всіх гравців.
  const started = { seasonNumber: season.seasonNumber || 1, durationDays: SEASON_DURATION_DAYS, startedAt: Date.now(), rev: SEASON_REV };
  const updated = await saveGameStatePart({ season: started });
  await pushNews(`🏆 Стартував сезон ${started.seasonNumber}: ${started.durationDays} днів боротьби та нагород Battle Pass.`);
  return updated.season;
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
function findAllyWar(wars, alliances, myCountry) {
  const myAllies = getAllyCountries(alliances, myCountry);
  if (!myAllies.length) return null;
  return (wars || []).find((w) => {
    if (w.status === "ended") return false;
    const ownInvolved =
      w.attackerCountry === myCountry ||
      w.defenderCountry === myCountry ||
      (w.attackerAllies || []).includes(myCountry) ||
      (w.defenderAllies || []).includes(myCountry);
    if (ownInvolved) return false;
    return myAllies.includes(w.attackerCountry) || myAllies.includes(w.defenderCountry);
  });
}

/* Shared: declare a war, with exclusivity checks + mail + news. Returns { ok, reason, war? } */
async function declareWarAction(attackerCode, defenderCode, city) {
  if (attackerCode === defenderCode) return { ok: false, reason: "Не можна нападати на себе" };
  const blocked = attackBlockReason(await loadDiplomacy(), attackerCode, defenderCode);
  if (blocked) return { ok: false, reason: blocked };
  const wars = await getWars();
  if (countryAtWar(wars, attackerCode)) return { ok: false, reason: "Твоя країна вже веде війну" };
  if (countryAtWar(wars, defenderCode)) return { ok: false, reason: "Ця країна вже веде іншу війну" };

  const now2 = Date.now();
  const cityDefense = await getCityDefense();
  const stockKey = defenderCode + "|" + city;
  const startingDefense = cityDefense[stockKey] || 0;

  const war = {
    id: "w_" + now2.toString(36) + Math.random().toString(36).slice(2, 7),
    attackerCountry: attackerCode,
    defenderCountry: defenderCode,
    city,
    declaredAt: now2,
    prepEndsAt: now2 + PREP_MS,
    battleEndsAt: now2 + PREP_MS + BATTLE_MS,
    status: "prep",
    attackerPower: 0,
    defenderPower: startingDefense,
    attackerAllies: [],
    defenderAllies: [],
  };
  const list = [...wars, war];
  await saveWars(list);

  if (startingDefense > 0) {
    delete cityDefense[stockKey];
    await saveCityDefense(cityDefense);
  }

  const defenderLeader = await getLeader(defenderCode);
  if (defenderLeader) {
    await addMail(defenderLeader, {
      type: "war-declared",
      subject: `Війна оголошена за ${city}!`,
      body: `${COUNTRY_MAP[attackerCode]?.flag || ""} ${COUNTRY_MAP[attackerCode]?.name || attackerCode} оголосили війну за ${city}. Підготовка триває 10 хвилин, далі — година битви.`,
      meta: { warId: war.id },
    });
  }
  const attackerLeader = await getLeader(attackerCode);
  if (attackerLeader) {
    await addMail(attackerLeader, {
      type: "info",
      subject: `Ти оголосив(ла) війну за ${city}`,
      body: `Підготовка триває 10 хвилин, потім почнеться битва (1 година). Заходь у Панель управління → Атака, щоб внести Power.`,
      meta: { warId: war.id },
    });
  }
  await addNews(
    `⚔️ ${COUNTRY_MAP[attackerCode]?.flag || ""} ${COUNTRY_MAP[attackerCode]?.name || attackerCode} оголосили війну ${COUNTRY_MAP[defenderCode]?.flag || ""} ${COUNTRY_MAP[defenderCode]?.name || defenderCode}. Точиться боротьба за область «${city}».`
  );

  return { ok: true, war };
}

/* ------------------------------------------------------------------ */
/*  Повстання: Повстанець проти лідера чи одного з радників             */
/* ------------------------------------------------------------------ */

async function getRebellions() {
  return (await loadGameState()).rebellions || [];
}
async function saveRebellions(list) {
  return saveGameStatePart({ rebellions: list });
}

/* A country can only have one active rebellion at a time */
function countryAtRebellion(rebellions, code) {
  return (rebellions || []).some((r) => r.status !== "ended" && r.countryCode === code);
}

/* Shared: start a rebellion, with exclusivity checks + mail + news.
   targetType is "leader" or "advisor"; targetPlayerId is the player being
   challenged. Returns { ok, reason, rebellion? } */
async function declareRebellionAction(rebelId, rebelName, countryCode, targetType, targetPlayerId, targetName) {
  const rebellions = await getRebellions();
  if (countryAtRebellion(rebellions, countryCode)) {
    return { ok: false, reason: "У країні вже точиться повстання" };
  }
  if (!targetPlayerId) return { ok: false, reason: "Не обрано ціль повстання" };
  if (targetPlayerId === rebelId) return { ok: false, reason: "Не можна повстати проти самого себе" };

  const now2 = Date.now();
  const rebellion = {
    id: "reb_" + now2.toString(36) + Math.random().toString(36).slice(2, 7),
    countryCode,
    rebelId,
    rebelName,
    targetType, // "leader" | "advisor"
    targetPlayerId,
    targetName,
    declaredAt: now2,
    prepEndsAt: now2 + PREP_MS,
    battleEndsAt: now2 + PREP_MS + BATTLE_MS,
    status: "prep",
    rebelPower: 0,
    authorityPower: 0,
  };
  const list = [...rebellions, rebellion];
  await saveRebellions(list);

  const leaderId = await getLeader(countryCode);
  if (leaderId) {
    await addMail(leaderId, {
      type: "rebellion-declared",
      subject: `Повстання проти ${targetType === "leader" ? "тебе" : targetName}!`,
      body: `${rebelName} підняв(ла) повстання проти ${targetType === "leader" ? "лідера" : "радника " + targetName}. Підготовка триває 10 хвилин, далі — година битви. Заходь у Панель управління → Влада → Повстання, щоб внести Power на бік влади.`,
      meta: { rebellionId: rebellion.id },
    });
  }
  await addNews(
    `🔥 ${COUNTRY_MAP[countryCode]?.flag || ""} ${rebelName} підняв(ла) повстання проти ${
      targetType === "leader" ? "лідера" : "радника " + (targetName || "")
    } у ${COUNTRY_MAP[countryCode]?.name || countryCode}.`
  );

  return { ok: true, rebellion };
}

/* Centralized rebellion reconciliation (prep -> battle -> ended), mirrors
   reconcileWars(). Called from refreshGameData so it runs regardless of
   which screen is open. */
async function reconcileRebellions() {
  const now = Date.now();
  const rebellions = await getRebellions();
  let changed = false;
  for (const r of rebellions) {
    if (r.status === "prep" && now >= r.prepEndsAt) {
      r.status = "battle";
      changed = true;
    } else if (r.status === "battle" && now >= r.battleEndsAt) {
      const rebelWins = (r.rebelPower || 0) > (r.authorityPower || 0);
      r.status = "ended";
      r.winner = rebelWins ? "rebel" : "authority";
      changed = true;

      let resultText;
      if (rebelWins) {
        if (r.targetType === "leader") {
          await storageSet(LEADER_PREFIX + r.countryCode, "", true);
        } else {
          const advisors = await getAdvisors(r.countryCode);
          await saveAdvisors(r.countryCode, advisors.filter((id) => id !== r.targetPlayerId));
        }
        resultText = `${r.rebelName} переміг(ла) у повстанні: ${
          r.targetType === "leader" ? "лідера" : "радника " + (r.targetName || "")
        } усунено від влади в ${COUNTRY_MAP[r.countryCode]?.name || r.countryCode}!`;
      } else {
        resultText = `Влада ${COUNTRY_MAP[r.countryCode]?.name || r.countryCode} придушила повстання ${r.rebelName}.`;
      }

      const leaderId = await getLeader(r.countryCode);
      if (leaderId) await addMail(leaderId, { type: "info", subject: "Повстання завершено", body: resultText });
      await addMail(r.rebelId, { type: "info", subject: "Повстання завершено", body: resultText });
      await addNews("🔥 " + resultText);
    }
  }
  if (changed) await saveRebellions(rebellions);
  return changed ? rebellions : null;
}

/* Shared: send an alliance request, with mail + validation. Returns { ok, reason } */
async function sendAllianceRequestAction(fromCode, toCode) {
  if (fromCode === toCode) return { ok: false, reason: "Не можна укласти союз із собою" };
  const alliances = await getAlliances();
  if (areAllies(alliances, fromCode, toCode)) return { ok: false, reason: "Ви вже союзники" };
  const requests = await getAllianceRequests();
  if (requests.some((r) => r.fromCountry === fromCode && r.toCountry === toCode && r.status === "pending")) {
    return { ok: false, reason: "Запит вже надіслано" };
  }
  const reqId = "r_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const list = [...requests, { id: reqId, fromCountry: fromCode, toCountry: toCode, status: "pending", createdAt: Date.now() }];
  await saveAllianceRequests(list);
  const leaderId = await getLeader(toCode);
  if (leaderId) {
    await addMail(leaderId, {
      type: "alliance-request",
      subject: `Запит на союз від ${COUNTRY_MAP[fromCode]?.name || fromCode}`,
      body: `${COUNTRY_MAP[fromCode]?.flag || ""} ${COUNTRY_MAP[fromCode]?.name || fromCode} пропонує союз.`,
      meta: { requestId: reqId, fromCountry: fromCode, toCountry: toCode },
    });
  }
  return { ok: true };
}

/* Centralized war state reconciliation (prep -> battle -> ended).
   Called from refreshGameData so it runs no matter which tab/screen is
   currently open, instead of depending on the region map being mounted. */
async function reconcileWars() {
  const now = Date.now();
  const wars = await getWars();
  let changed = false;
  for (const w of wars) {
    if (w.status === "prep" && now >= w.prepEndsAt) {
      w.status = "battle";
      changed = true;
    } else if (w.status === "battle" && now >= w.battleEndsAt) {
      const attackerWins = (w.attackerPower || 0) > (w.defenderPower || 0);
      w.status = "ended";
      w.winner = attackerWins ? w.attackerCountry : w.defenderCountry;
      changed = true;

      const cc = await getCityControl();
      if (attackerWins) cc[w.defenderCountry + "|" + w.city] = w.attackerCountry;
      await saveCityControl(cc);

      const attackerLeader = await getLeader(w.attackerCountry);
      const defenderLeader = await getLeader(w.defenderCountry);
      const resultText = attackerWins
        ? `${COUNTRY_MAP[w.attackerCountry]?.flag || ""} ${COUNTRY_MAP[w.attackerCountry]?.name} переміг(ла) і забирає область «${w.city}» у ${COUNTRY_MAP[w.defenderCountry]?.name}!`
        : `${COUNTRY_MAP[w.defenderCountry]?.flag || ""} ${COUNTRY_MAP[w.defenderCountry]?.name} відбив(ла) атаку і захистив(ла) область «${w.city}» від ${COUNTRY_MAP[w.attackerCountry]?.name}.`;
      if (attackerLeader) await addMail(attackerLeader, { type: "info", subject: "Війна завершена", body: resultText });
      if (defenderLeader) await addMail(defenderLeader, { type: "info", subject: "Війна завершена", body: resultText });
      await addNews("🏆 " + resultText);
    }
  }
  if (changed) await saveWars(wars);
  return changed ? wars : null;
}

async function getLeader(code) {
  return storageGet(LEADER_PREFIX + code, true);
}
async function setLeaderStorage(code, playerId) {
  return storageSet(LEADER_PREFIX + code, playerId, true);
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
const DIP_KIND = {
  ally: { noun: "союз", title: "Союз", req: "Запит на союз" },
  pact: { noun: "пакт про ненапад", title: "Пакт про ненапад", req: "Пропозиція пакту про ненапад" },
};

function pairId(a, b) {
  return [a, b].sort().join("~");
}

async function loadDiplomacy() {
  const out = { allies: [], pacts: [], truces: {}, requests: [] };
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
      if (REAL_ID_RE.test(String(v.fromCountry)) && REAL_ID_RE.test(String(v.toCountry))) out.requests.push(v);
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

function dipRelation(dip, a, b) {
  const id = pairId(a, b);
  return {
    ally: !!dip?.allies.some((x) => pairId(x.a, x.b) === id),
    pact: !!dip?.pacts.some((x) => pairId(x.a, x.b) === id),
    truceUntil: dip?.truces?.[id] > Date.now() ? dip.truces[id] : 0,
  };
}

/* Причина, чому нападати заборонено (або null, якщо можна) */
function attackBlockReason(dip, a, b, ignoreTime = false) {
  const r = dipRelation(dip, a, b);
  if (r.ally) return "Це ваш союзник — нападати не можна";
  if (r.pact) return "З цією країною діє пакт про ненапад";
  if (r.truceUntil && !ignoreTime) return "Нападати заборонено ще " + fmtDuration(r.truceUntil - Date.now());
  return null;
}

async function sendDiplomacyRequest(kind, from, to) {
  if (from === to) return { ok: false, reason: "Не можна обрати власну країну" };
  if (!COUNTRY_MAP[to]) return { ok: false, reason: "Країну не знайдено" };
  const toLeader = await getLeader(to);
  if (!toLeader) return { ok: false, reason: "У цієї країни немає лідера" };
  const dip = await loadDiplomacy();
  const rel = dipRelation(dip, from, to);
  if (kind === "ally" && rel.ally) return { ok: false, reason: "Ви вже союзники" };
  if (kind === "pact" && (rel.pact || rel.ally)) return { ok: false, reason: rel.ally ? "Союзникам пакт не потрібен" : "Пакт уже підписано" };
  if (dip.requests.some((r) => r.status === "pending" && r.type === kind && pairId(r.from, r.to) === pairId(from, to) && Date.now() - r.ts < 24 * 3600 * 1000)) {
    return { ok: false, reason: "Пропозицію вже надіслано — чекаємо відповіді" };
  }
  const id = "q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const req = { kind: "req", id, type: kind, from, to, status: "pending", ts: Date.now() };
  await setJSON(DIP_PREFIX + "req:" + id, req, true);
  const fromName = COUNTRY_MAP[from]?.name || from;
  await addMail(toLeader, {
    type: "dip-request",
    subject: `${DIP_KIND[kind].req} від ${fromName}`,
    body: `${COUNTRY_MAP[from]?.flag || ""} ${fromName} пропонує ${kind === "ally" ? "укласти союз" : "підписати пакт про ненапад"}. Можна прийняти, відхилити або проігнорувати.`,
    meta: { requestId: id, kind, fromCountry: from, toCountry: to },
  });
  return { ok: true };
}

async function respondDiplomacyRequest(requestId, accept) {
  const req = await getJSON(DIP_PREFIX + "req:" + requestId, true, null);
  if (!req) return { ok: false, reason: "Пропозицію не знайдено" };
  if (req.status !== "pending") return { ok: false, reason: "На цю пропозицію вже відповіли" };
  await setJSON(DIP_PREFIX + "req:" + requestId, { ...req, status: accept ? "accepted" : "declined", answeredAt: Date.now() }, true);
  if (accept) {
    await setJSON(DIP_PREFIX + req.type + ":" + pairId(req.from, req.to), { kind: req.type, a: req.from, b: req.to, active: true, ts: Date.now() }, true);
    await pushNews(
      req.type === "ally"
        ? `🤝 ${COUNTRY_MAP[req.from]?.flag || ""} ${COUNTRY_MAP[req.from]?.name || req.from} і ${COUNTRY_MAP[req.to]?.flag || ""} ${COUNTRY_MAP[req.to]?.name || req.to} уклали союз.`
        : `📜 ${COUNTRY_MAP[req.from]?.flag || ""} ${COUNTRY_MAP[req.from]?.name || req.from} і ${COUNTRY_MAP[req.to]?.flag || ""} ${COUNTRY_MAP[req.to]?.name || req.to} підписали пакт про ненапад.`
    );
  }
  const fromLeader = await getLeader(req.from);
  if (fromLeader) {
    const toName = COUNTRY_MAP[req.to]?.name || req.to;
    await addMail(fromLeader, {
      type: "info",
      subject: accept ? `${DIP_KIND[req.type].title} укладено` : "Пропозицію відхилено",
      body: accept
        ? `${toName} прийняли вашу пропозицію: ${DIP_KIND[req.type].noun}.`
        : `${toName} відхилили вашу пропозицію: ${DIP_KIND[req.type].noun}.`,
    });
  }
  return { ok: true };
}

async function breakDiplomacy(kind, mine, other) {
  await setJSON(
    DIP_PREFIX + kind + ":" + pairId(mine, other),
    { kind, a: mine, b: other, active: false, brokenAt: Date.now(), brokenBy: mine },
    true
  );
  await pushNews(
    `💔 ${COUNTRY_MAP[mine]?.flag || ""} ${COUNTRY_MAP[mine]?.name || mine} розірвали ${kind === "ally" ? "союз" : "пакт про ненапад"} з ${COUNTRY_MAP[other]?.flag || ""} ${COUNTRY_MAP[other]?.name || other}.`
  );
  if (kind === "ally") {
    try {
      const list = await getAlliances();
      await saveAlliances(list.filter((pr) => pairId(pr[0], pr[1]) !== pairId(mine, other)));
    } catch {
      /* ignore */
    }
  }
  const otherLeader = await getLeader(other);
  if (otherLeader) {
    await addMail(otherLeader, {
      type: "info",
      subject: kind === "ally" ? "Союз розірвано" : "Пакт розірвано",
      body: `${COUNTRY_MAP[mine]?.name || mine} розірвали ${DIP_KIND[kind].noun}. Протягом 4 годин нападати одне на одного заборонено.`,
    });
  }
  return { ok: true };
}


/* ------------------------------------------------------------------ */
/*  Війна за місто                                                      */
/*  war:<id>          — запис війни                                     */
/*  warc:<id>:<гравець> — внесок гравця (кліки за сторону)              */
/*  Підготовка 10 хв → битва 1 год. Кліки йдуть на шкалу замість Power.  */
/*  Атакуючий має набрати баланс (кліки атаки − кліки захисту) ≥ 10 000. */
/* ------------------------------------------------------------------ */

const WAR_PREFIX = "war:";
const WAR_CLICKS_PREFIX = "warc:";
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

function warInvolves(w, code) {
  return !!w && (w.attacker === code || w.defender === code || (w.attAllies || []).includes(code) || (w.defAllies || []).includes(code));
}
function warSide(w, code) {
  if (!w) return null;
  if (w.attacker === code || (w.attAllies || []).includes(code)) return "att";
  if (w.defender === code || (w.defAllies || []).includes(code)) return "def";
  return null;
}
function warPhase(w, now = Date.now()) {
  if (!w) return null;
  if (w.status === "ended") return "ended";
  if (now < w.prepEnd) return "prep";
  if (now < w.battleEnd) return "battle";
  return "finish";
}

async function loadActiveWars() {
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

async function fetchWarTotals(warId, myPlayerId = null) {
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

async function mailMany(players, codes, message) {
  const targets = (players || []).filter((pl) => codes.includes(pl.countryCode));
  await Promise.all(targets.map((pl) => addMail(pl.id, message).catch(() => null)));
}

async function declareWar2({ attacker, defender, city, owners, cityOwners, players, immune = false, selfId = null }) {
  if (!COUNTRY_MAP[defender]) return { ok: false, reason: "Країну не знайдено" };
  if (attacker === defender) return { ok: false, reason: "Не можна нападати на себе" };
  if (owners && ((cityOwners && cityOwners[city.key]) || owners[city.rid]) !== defender) return { ok: false, reason: "Це місто вже не належить цій країні" };
  const blocked = attackBlockReason(await loadDiplomacy(), attacker, defender, immune);
  if (blocked) return { ok: false, reason: blocked };
  const active = await loadActiveWars();
  if (active.some((w) => warInvolves(w, attacker))) return { ok: false, reason: "Твоя країна вже бере участь у війні" };
  if (active.some((w) => warInvolves(w, defender))) return { ok: false, reason: "Ця країна вже веде війну або готується до неї" };
  if (!immune) {
    const [cdA, cdD] = await Promise.all([getWarCooldown(attacker), getWarCooldown(defender)]);
    if (cdA) return { ok: false, reason: "Твоя країна відновлюється після війни: нападати можна через " + fmtDuration(cdA - Date.now()) };
    if (cdD) return { ok: false, reason: "Ця країна щойно закінчила війну: напад можливий через " + fmtDuration(cdD - Date.now()) };
  }
  const now = Date.now();
  const id = "w_" + now.toString(36) + Math.random().toString(36).slice(2, 5);
  const defLevel = await getCityDefLevel(city.key || "").catch(() => 0);
  const war = {
    id,
    attacker,
    defender,
    cityId: city.id,
    cityName: city.name,
    cityRid: city.rid,
    cityKey: city.key || "",
    createdAt: now,
    prepEnd: now + WAR_PREP_MS,
    battleEnd: now + WAR_PREP_MS + WAR_BATTLE_MS,
    attAllies: [],
    defAllies: [],
    target: CITY_DEF_THRESHOLDS[defLevel] || WAR_TARGET,
    defLevel,
    status: "active",
  };
  await setJSON(WAR_PREFIX + id, war, true);
  const an = COUNTRY_MAP[attacker]?.name || attacker;
  const dn = COUNTRY_MAP[defender]?.name || defender;
  await pushNews(
    `⚔️ ${COUNTRY_MAP[attacker]?.flag || ""} ${COUNTRY_MAP[attacker]?.name || attacker} оголосили війну ${COUNTRY_MAP[defender]?.flag || ""} ${COUNTRY_MAP[defender]?.name || defender} за місто ${city.name}. Поріг захоплення: ${fmt(war.target)}.`
  );
  /* Бот пише в Telegram усім гравцям країни, на яку напали */
  try {
    const initData = window.Telegram?.WebApp?.initData;
    if (initData) {
      fetch("/api/notify-war", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, warId: id, attackerName: an, defenderName: dn }),
      })
        .then((r) => r.json().catch(() => null))
        .then((d) => {
          console.info("notify-war:", d);
          /* Для адміна показуємо відповідь сервера, щоб легко знайти причину, якщо сповіщення не доходять */
          if (isSuperAdmin() && selfId) {
            const body = d && d.ok
              ? `Сервер відповів: надіслано ${d.sent ?? 0} із ${d.total ?? 0} гравців.` +
                (d.skipped ? " Розсилку для цієї війни вже було виконано раніше." : "") +
                (d.firstError ? `\nПомилка Telegram: ${d.firstError}` : "") +
                (d.total === 0 ? "\nУ країн-учасниць немає гравців із Telegram ID." : "")
              : `Сервер відхилив запит: ${(d && d.error) || "невідома помилка"}`;
            addMail(selfId, { type: "info", subject: "🔧 Діагностика сповіщень про війну", body }).catch(() => null);
          }
        })
        .catch((e) => {
          console.warn("notify-war failed:", e);
          if (isSuperAdmin() && selfId) {
            addMail(selfId, { type: "info", subject: "🔧 Діагностика сповіщень про війну", body: "Запит до /api/notify-war не вдався: " + e + ". Ймовірно, файл api/notify-war.js не задеплоєно." }).catch(() => null);
          }
        });
    } else if (isSuperAdmin() && selfId) {
      addMail(selfId, { type: "info", subject: "🔧 Діагностика сповіщень про війну", body: "Сповіщення не надіслано: гра не передала Telegram initData (відкрий гру саме через бота в Telegram, а не в браузері)." }).catch(() => null);
    }
  } catch {
    /* сповіщення не критичні */
  }
  await mailMany(players, [attacker, defender], {
    type: "info",
    subject: `⚔️ Підготовка до війни за ${city.name}`,
    body: `${an} оголосили війну ${dn}. Битва за місто ${city.name} почнеться через 10 хвилин і триватиме годину. Усі кліки гравців підуть на шкалу битви. Залишайся в грі!`,
  });
  return { ok: true, war };
}

async function inviteWarAlly(war, fromCountry, allyCountry) {
  const side = warSide(war, fromCountry);
  if (!side) return { ok: false, reason: "Твоя країна не бере участі у війні" };
  const active = await loadActiveWars();
  if (active.some((w) => warInvolves(w, allyCountry))) return { ok: false, reason: "Ця країна вже у війні" };
  const leaderId = await getLeader(allyCountry);
  if (!leaderId) return { ok: false, reason: "У країни немає лідера" };
  const fromName = COUNTRY_MAP[fromCountry]?.name || fromCountry;
  await addMail(leaderId, {
    type: "war-invite",
    subject: `Заклик до війни від ${fromName}`,
    body: `${COUNTRY_MAP[fromCountry]?.flag || ""} ${fromName} просять допомогти у битві за ${war.cityName} на стороні ${side === "att" ? "атаки" : "захисту"}. Якщо приймеш, гравці твоєї країни кликатимуть за цю сторону.`,
    meta: { warId: war.id, side, fromCountry, toCountry: allyCountry },
  });
  return { ok: true };
}

async function acceptWarInvite(meta) {
  const war = await getJSON(WAR_PREFIX + meta.warId, true, null);
  if (!war || war.status === "ended" || Date.now() >= war.battleEnd) return { ok: false, reason: "Війна вже завершилась" };
  const active = await loadActiveWars();
  if (active.some((w) => warInvolves(w, meta.toCountry))) return { ok: false, reason: "Твоя країна вже бере участь у війні" };
  const key = meta.side === "att" ? "attAllies" : "defAllies";
  const next = { ...war, [key]: [...(war[key] || []), meta.toCountry] };
  await setJSON(WAR_PREFIX + war.id, next, true);
  await pushNews(`🤝 ${COUNTRY_MAP[meta.toCountry]?.flag || ""} ${COUNTRY_MAP[meta.toCountry]?.name || meta.toCountry} вступили у війну за місто ${war.cityName} на боці ${meta.side === "att" ? "атаки" : "захисту"}.`);
  const fromLeader = await getLeader(meta.fromCountry);
  if (fromLeader) {
    await addMail(fromLeader, {
      type: "info",
      subject: "Союзник приєднався до війни",
      body: `${COUNTRY_MAP[meta.toCountry]?.name || meta.toCountry} прийняли заклик і вступили в битву за ${war.cityName}.`,
    });
  }
  return { ok: true };
}

/* Завершення війни: лише один клієнт виконує підсумки (блокування через insert-if-absent) */
async function finalizeWar(w, players, forcedWinner = null) {
  const lock = await sbStorageInsertIfAbsent("warend:" + w.id, String(Date.now()), true);
  if (lock !== "ok") return false;
  const totals = await fetchWarTotals(w.id);
  const net = totals.att - totals.def;
  const win = forcedWinner ? forcedWinner === "att" : net >= (w.target || WAR_TARGET);
  const winner = win ? w.attacker : w.defender;
  await setJSON(
    WAR_PREFIX + w.id,
    { ...w, status: "ended", result: { att: totals.att, def: totals.def, net, winner, endedAt: Date.now() } },
    true
  );
  const an = COUNTRY_MAP[w.attacker]?.name || w.attacker;
  const dn = COUNTRY_MAP[w.defender]?.name || w.defender;
  let respawnNote = "";
  if (win) {
    if (w.cityKey) await storageSet(CITY_OWN_PREFIX + w.cityKey, w.attacker, true);
    else await storageSet(TERRITORY_PREFIX + w.cityRid, w.attacker, true);
    // нова власниця починає з нульової оборони міста
    if (w.cityKey) await storageSet(CITY_DEF_PREFIX + w.cityKey, "0", true);
    // Якщо в захисника не лишилось ні областей, ні міст — він з'являється у вільній області
    const nationsNow = await loadNations();
    if (nationsNow) {
      const regionsLeft = Object.values(nationsNow.owners).filter((c) => c === w.defender).length;
      const citiesLeft = Object.values(nationsNow.cityOwners || {}).filter((c) => c === w.defender).length;
      if (regionsLeft === 0 && citiesLeft === 0) {
        try {
          const cities = await loadCities();
          const free = [...cities.byRid.keys()].filter((rid) => !nationsNow.owners[rid]);
          if (free.length) {
            const rid = free[Math.floor(Math.random() * free.length)];
            if ((await sbStorageInsertIfAbsent(TERRITORY_PREFIX + rid, w.defender, true)) === "ok") {
              respawnNote = " Країна втратила все, тож відроджується у вільній області.";
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  const attSide = [w.attacker, ...(w.attAllies || [])];
  const defSide = [w.defender, ...(w.defAllies || [])];
  const cdUntil = Date.now() + WAR_COOLDOWN_MS;
  await Promise.all([...attSide, ...defSide].map((c) => storageSet(WARCD_PREFIX + c, String(cdUntil), true).catch(() => null)));
  const text = win
    ? `${an} перемогли в битві за ${w.cityName} (баланс +${fmt(net)}) і забрали місто в ${dn}.${respawnNote}`
    : `${dn} відбили атаку на ${w.cityName}: баланс ${fmt(Math.max(net, 0))} із ${fmt(w.target || WAR_TARGET)}. ${an} не змогли взяти місто.`;
  await pushNews(
    win
      ? `🏴 ${COUNTRY_MAP[w.attacker]?.flag || ""} ${an} захопили місто ${w.cityName} у ${COUNTRY_MAP[w.defender]?.flag || ""} ${dn}.${respawnNote}`
      : `🛡️ ${COUNTRY_MAP[w.defender]?.flag || ""} ${dn} відбили атаку ${an} на місто ${w.cityName}.`
  );
  await mailMany(players, [...attSide, ...defSide], { type: "info", subject: win ? `Війна завершена: ${w.cityName} захоплено` : `Війна завершена: ${w.cityName} вистояло`, body: text });
  return true;
}

/* ------------------------------------------------------------------ */
/*  Влада: Рада (радники) + рішення ради                                */
/* ------------------------------------------------------------------ */

async function getAdvisors(code) {
  return (await loadGameState()).advisors[code] || [];
}
async function saveAdvisors(code, list) {
  const state = await loadGameState();
  const advisors = { ...state.advisors, [code]: list };
  return saveGameStatePart({ advisors });
}

/* Leader-only: kick an advisor from the council immediately, no vote needed. */
async function leaderKickAdvisor(code, targetPlayerId) {
  const list = await getAdvisors(code);
  await saveAdvisors(code, list.filter((id) => id !== targetPlayerId));
}

async function getCouncilProposals(code) {
  const list = (await loadGameState()).councilProposals[code] || [];
  return list.filter((p) => p.status === "pending");
}
async function saveCouncilProposals(code, list) {
  const state = await loadGameState();
  const councilProposals = { ...state.councilProposals, [code]: list };
  return saveGameStatePart({ councilProposals });
}

/* A council member (advisor) puts forward a decision: war / alliance /
   kicking the leader / kicking another advisor. */
async function createCouncilProposal(code, { type, payload }, proposedBy) {
  const state = await loadGameState();
  const list = state.councilProposals[code] || [];
  const proposal = {
    id: "prop_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    type,
    payload,
    proposedBy,
    votes: [proposedBy],
    status: "pending",
    createdAt: Date.now(),
  };
  await saveCouncilProposals(code, [...list, proposal]);
  return proposal;
}

/* Cast a vote on a pending proposal. Once more than half the council has
   voted for it, the decision is executed and marked resolved. */
async function voteCouncilProposal(code, proposalId, voterId) {
  const state = await loadGameState();
  const list = state.councilProposals[code] || [];
  const idx = list.findIndex((p) => p.id === proposalId);
  if (idx === -1) return { ok: false, reason: "Рішення не знайдено" };
  const proposal = { ...list[idx] };
  if (proposal.status !== "pending") return { ok: false, reason: "Рішення вже вирішено" };
  if (!proposal.votes.includes(voterId)) proposal.votes = [...proposal.votes, voterId];

  const advisors = await getAdvisors(code);
  const majority = Math.floor(advisors.length / 2) + 1;
  let executed = false;
  if (proposal.votes.length >= majority) {
    await executeCouncilProposal(code, proposal);
    proposal.status = "approved";
    executed = true;
  }
  const updated = [...list];
  updated[idx] = proposal;
  await saveCouncilProposals(code, updated);
  return { ok: true, executed };
}

async function executeCouncilProposal(code, proposal) {
  if (proposal.type === "war") {
    return declareWarAction(code, proposal.payload.targetCountry, proposal.payload.city);
  }
  if (proposal.type === "alliance") {
    return sendAllianceRequestAction(code, proposal.payload.targetCountry);
  }
  if (proposal.type === "kickLeader") {
    await storageSet(LEADER_PREFIX + code, "", true);
    await addNews(`👑 Рада ${COUNTRY_MAP[code]?.name || code} проголосувала за відставку лідера.`);
    return { ok: true };
  }
  if (proposal.type === "kickAdvisor") {
    const advisors = await getAdvisors(code);
    await saveAdvisors(code, advisors.filter((id) => id !== proposal.payload.targetPlayerId));
    return { ok: true };
  }
  return { ok: false };
}

function roleStatusLabel(isLeader, roleField) {
  if (isLeader) return "Лідер країни";
  return "Громадянин";
}

function describeCouncilProposal(p) {
  if (p.type === "war") {
    return `Оголосити війну за «${p.payload.city}» (${COUNTRY_MAP[p.payload.targetCountry]?.name || p.payload.targetCountry})`;
  }
  if (p.type === "alliance") {
    return `Укласти союз із ${COUNTRY_MAP[p.payload.targetCountry]?.name || p.payload.targetCountry}`;
  }
  if (p.type === "kickLeader") return "Усунути лідера країни";
  if (p.type === "kickAdvisor") return `Вигнати з ради: ${p.payload.targetName || "радник"}`;
  return "Рішення ради";
}

/* ------------------------------------------------------------------ */
/*  Themes                                                              */
/* ------------------------------------------------------------------ */

const THEMES = {
  darkblue: {
    label: "Dark Blue",
    swatch: "#22D3EE",
    vars: {
      "--cn-bg1": "#0E2749", "--cn-bg2": "#060B18", "--cn-bg3": "#030710",
      "--cn-panel": "rgba(13,25,46,0.55)", "--cn-panel-border": "rgba(56,189,248,0.15)",
      "--cn-accent": "#22D3EE", "--cn-accent2": "#3B82F6",
      "--cn-text": "#EAF4FF", "--cn-text-dim": "#9DB4D6", "--cn-text-dimmer": "#82A0C4",
      "--cn-nav-bg": "rgba(6,11,24,0.92)",
    },
  },
};
const DEFAULT_THEME = "darkblue";


/* ------------------------------------------------------------------ */
/*  Країни гравців                                                      */
/*  Реєстр заповнюється з Supabase (див. src/nations.js). Це змінювані  */
/*  модульні об'єкти: App оновлює їх при завантаженні й перерендерює    */
/*  інтерфейс. Країни реальні (id = ISO), див. src/realCountries.js.    */
/* ------------------------------------------------------------------ */

const NEUTRAL_COUNTRY_COLOR = "#64748b";
const COUNTRIES = [];
const COUNTRY_MAP = {};
let countriesRev = 0; // зростає при кожному оновленні реєстру — для залежностей useMemo

function setCountriesRegistry(list) {
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
function isLegacyCountryCode(code) {
  if (!code || !REAL_ID_RE.test(String(code))) return true;
  return countriesRev > 0 && !COUNTRY_MAP[code];
}

/* Прапор країни (емодзі за ISO) на кольоровій плашці її кольору. Пропс code — id країни. */
function Flag({ code, size = 20, className }) {
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

function fmt(n) {
  return new Intl.NumberFormat("uk-UA").format(Math.max(0, Math.round(n)));
}

/* Формат "2 год 15 хв" / "45 хв" для таймерів і кулдаунів */
function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} год ${m} хв`;
  return `${m} хв`;
}

/* Ключ у спільному сховищі для динамічної ціни Premium Pass (у Stars) */
const PREMIUM_PASS_PRICE_KEY = "premium_pass_price_stars";

/* Супер-адмін: єдиний Telegram-акаунт, якому доступна Developer-панель */
const SUPER_ADMIN_TG_ID = "6667421162";
function isSuperAdmin() {
  try {
    const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    return tgId != null && String(tgId) === SUPER_ADMIN_TG_ID;
  } catch {
    return false;
  }
}

/* Очищення користувацького тексту (ніки, назви країн): прибираємо керівні та невидимі символи
   (у т.ч. RTL-підміни тексту), зайві пробіли й обмежуємо довжину. */
function cleanText(v, max = 24) {
  return String(v ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function genId() {
  return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function getCurrentEnergy(rec) {
  if (!rec) return 0;
  const elapsedSec = Math.floor((Date.now() - rec.lastEnergyTs) / 1000);
  return Math.min(maxEnergyOf(rec), rec.energy + Math.max(0, elapsedSec) * energyRegenOf(rec));
}

function getTelegramUser() {
  try {
    return window.Telegram?.WebApp?.initDataUnsafe?.user || null;
  } catch {
    return null;
  }
}

/* Ім'я гравця = ім'я в Telegram (ім'я + прізвище, інакше @username) */
function getTelegramDisplayName() {
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

const PINFO_PREFIX = "pinfo:";
const PSEEN_PREFIX = "pseen:";
const PALOG_PREFIX = "palog:";

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
async function trackSession(p, nameChange) {
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

async function adminLogAction(playerId, text) {
  const list = await getJSON(PALOG_PREFIX + playerId, true, []);
  list.push({ ts: Date.now(), type: "admin", text });
  await setJSON(PALOG_PREFIX + playerId, list.slice(-100), true);
}

function fmtDateTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(ts);
  }
}

/* ------------------------------------------------------------------ */
/*  Storage helpers — реальна база даних Supabase замість window.storage */
/* ------------------------------------------------------------------ */

let storagePersistenceHealthy = true;
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

async function storageGet(key, shared) {
  return withStorageTimeout(() => sbStorageGet(key, shared), null);
}

async function storageSet(key, value, shared) {
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

async function fetchAllPlayers() {
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
    return results.filter(Boolean);
  } catch {
    return [];
  }
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

const cnSfx = {
  tap: () => cnPlayTone({ freq: 720, duration: 0.06, type: "triangle", volume: 0.07, glideTo: 500 }),
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

const LANG_KEY = "ui-language";
const LANG_CHOSEN_KEY = "ui-language-chosen";

const LANGUAGES = [
  { code: "uk", label: "Українська", flag: "🇺🇦" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "en", label: "English", flag: "🇬🇧" },
];
const SUPPORTED_LANGS = LANGUAGES.map((l) => l.code);

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

function t(lang, key) {
  const entry = TRANSLATIONS[key];
  if (!entry) return key;
  return entry[lang] || entry.en || entry.uk || key;
}

/* ------------------------------------------------------------------ */
/*  Tutorial script                                                     */
/* ------------------------------------------------------------------ */

const TUTORIAL_STEPS = [
  { img: GLOBY_WAVE2_IMG, tab: "clicker", target: null, pos: "center",
    title: { uk: "Привіт, {name}!", en: "Hi, {name}!", ru: "Привет, {name}!" },
    text: { uk: "Мене звати Глобі. Я покажу, як тут усе працює, і це займе хвилину.", en: "My name is Globby. I'll show you how everything works. It'll take a minute.", ru: "Меня зовут Глоби. Я покажу, как тут всё устроено, это займёт минуту." } },
  { img: GLOBY_POINT_IMG, tab: "clicker", target: "globe", pos: "top",
    title: { uk: "Це твій глобус", en: "This is your globe", ru: "Это твой глобус" },
    text: { uk: "Натискай на нього. За кожен клік ти отримуєш Power.", en: "Tap it. Every tap gives you Power.", ru: "Нажимай на него. За каждый клик ты получаешь Power." } },
  { img: GLOBY_POINT_IMG, tab: "clicker", target: "power", pos: "bottom",
    title: { uk: "Power і Points", en: "Power and Points", ru: "Power и Points" },
    text: { uk: "Power визначає твоє місце в рейтингу. Points ти отримуєш за нагороди сезону й витрачаєш на покращення.", en: "Power sets your place in the ranking. You get Points from season rewards and spend them on upgrades.", ru: "Power определяет твоё место в рейтинге. Points ты получаешь за награды сезона и тратишь на улучшения." } },
  { img: GLOBY_IDLE_IMG, tab: "clicker", target: "energy", pos: "top",
    title: { uk: "Енергія", en: "Energy", ru: "Энергия" },
    text: { uk: "Кожен клік коштує 1 енергії. Вона відновлюється сама, тож просто заходь у гру частіше.", en: "Each tap costs 1 energy. It refills on its own, so just visit more often.", ru: "Каждый клик стоит 1 энергии. Она восстанавливается сама, так что просто заходи в игру чаще." } },
  { img: GLOBY_POINT_IMG, tab: "clicker", target: "actions", pos: "bottom",
    title: { uk: "Кнопки вгорі", en: "Top buttons", ru: "Кнопки сверху" },
    text: { uk: "Тут рейтинг, підтримка в Telegram і новини гри.", en: "Here you'll find the ranking, Telegram support and game news.", ru: "Здесь рейтинг, поддержка в Telegram и новости игры." } },
  { img: GLOBY_PRESENT_IMG, tab: "map", target: null, pos: "top",
    title: { uk: "Карта", en: "The map", ru: "Карта" },
    text: { uk: "Тут видно території всіх країн. Торкнись міста чи області, щоб дізнатись, кому вони належать.", en: "Here you can see every country's territory. Tap a city or region to see who owns it.", ru: "Здесь видны территории всех стран. Нажми на город или область, чтобы узнать, кому они принадлежат." } },
  { img: GLOBY_PRESENT_IMG, tab: "hq", target: "hq-dev", pos: "bottom",
    title: { uk: "Штаб країни", en: "Country HQ", ru: "Штаб страны" },
    text: { uk: "У «Покращеннях» ти за Points збільшуєш енергію та міцність міст.", en: "In 'Upgrades' you spend Points to boost your energy and city defense.", ru: "В «Улучшениях» ты за Points увеличиваешь энергию и крепость городов." } },
  { img: GLOBY_POINT_IMG, tab: "hq", target: "hq-army", pos: "top",
    title: { uk: "Війни", en: "Wars", ru: "Войны" },
    text: { uk: "Війну оголошує лідер країни. Спочатку йде підготовка, потім бій. Країну, яка вже воює, атакувати не можна.", en: "The country's leader declares wars. First comes preparation, then the battle. A country already at war can't be attacked.", ru: "Войну объявляет лидер страны. Сначала подготовка, потом бой. Страну, которая уже воюет, атаковать нельзя." } },
  { img: GLOBY_PRESENT_IMG, tab: "hq", target: "hq-diplomacy", pos: "top",
    title: { uk: "Дипломатія", en: "Diplomacy", ru: "Дипломатия" },
    text: { uk: "Тут лідер домовляється з іншими країнами та кличе союзників на допомогу.", en: "Here the leader makes deals with other countries and calls allies for help.", ru: "Здесь лидер договаривается с другими странами и зовёт союзников на помощь." } },
  { img: GLOBY_POINT_IMG, tab: "hq", target: "hq-mail", pos: "top",
    title: { uk: "Пошта", en: "Mail", ru: "Почта" },
    text: { uk: "Сюди приходять листи від гри та адміністрації.", en: "Letters from the game and admins arrive here.", ru: "Сюда приходят письма от игры и администрации." } },
  { img: GLOBY_POINT_IMG, tab: "hq", target: "hq-settings", pos: "top",
    title: { uk: "Налаштування", en: "Settings", ru: "Настройки" },
    text: { uk: "Тут звук і мова. Якщо щось забудеш, туторіал можна пройти ще раз.", en: "Sound and language are here. If you forget something, you can replay this tutorial.", ru: "Здесь звук и язык. Если что-то забудешь, туториал можно пройти ещё раз." } },
  { img: GLOBY_PRESENT_IMG, tab: "season", target: "season-banner", pos: "bottom",
    title: { uk: "Сезон", en: "Season", ru: "Сезон" },
    text: { uk: "Кліками ти піднімаєш рівень і забираєш нагороди. Сезон триває 50 днів.", en: "Your taps raise your level and unlock rewards. The season lasts 50 days.", ru: "Кликами ты повышаешь уровень и забираешь награды. Сезон длится 50 дней." } },
  { img: GLOBY_POINT_IMG, tab: "shop", target: "premium-offer", pos: "bottom",
    title: { uk: "Premium Pass", en: "Premium Pass", ru: "Premium Pass" },
    text: { uk: "Дає більше нагород і красивий нік. Він необов'язковий, грати можна й без нього.", en: "Gives you more rewards and a fancy nickname. It's optional, you can play without it.", ru: "Даёт больше наград и красивый ник. Он необязателен, играть можно и без него." } },
  { img: GLOBY_PRESENT_IMG, tab: "profile", target: "prof-cosm", pos: "top",
    title: { uk: "Профіль", en: "Profile", ru: "Профиль" },
    text: { uk: "У «Косметиці» обирай фото, банер, титул і колір ніка. Закриті нагороди теж видно, а підказка скаже, як їх відкрити.", en: "In 'Cosmetics' pick your avatar, banner, title and nickname color. Locked items are visible too, and a hint shows how to unlock them.", ru: "В «Косметике» выбирай фото, баннер, титул и цвет ника. Закрытые награды тоже видны, а подсказка скажет, как их открыть." } },
  { img: GLOBY_WAVE_IMG, tab: "clicker", target: null, pos: "center",
    title: { uk: "Це все, {name}!", en: "That's it, {name}!", ru: "Это всё, {name}!" },
    text: { uk: "Тепер ти знаєш, де що лежить. Клікай, піднімайся в рейтингу й розвивай свою країну. Успіхів!", en: "Now you know where everything is. Tap, climb the ranking and grow your country. Good luck!", ru: "Теперь ты знаешь, где что лежит. Кликай, поднимайся в рейтинге и развивай свою страну. Успехов!" } },
];
function tutPick(obj, lang) { return obj[lang] || obj.en || obj.uk; }

/* ------------------------------------------------------------------ */
/*  Root component                                                      */
/* ------------------------------------------------------------------ */

export default function App() {
  const [booting, setBooting] = useState(true);
  const [player, setPlayer] = useState(null);
  const [tab, setTab] = useState("clicker");
  const [allPlayers, setAllPlayers] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const lastFetchRef = useRef(0);
  const saveTimerRef = useRef(null);
  const lastFlushRef = useRef(0);
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [mail, setMail] = useState([]);
  /* Країни гравців і володіння територіями (Supabase: country:* і terr:*) */
  const [nations, setNations] = useState({ countries: [], owners: {} });
  const [nationsLoaded, setNationsLoaded] = useState(false);
  const wars = NO_WARS; // воєнну механіку тимчасово вимкнено (див. changelog)
  const [news, setNews] = useState([]);
  const [season, setSeason] = useState(EMPTY_GAME_STATE.season);
  const [maintenance, setMaintenance] = useState(EMPTY_GAME_STATE.maintenance);
  const [isLeader, setIsLeader] = useState(false);
  const [isAdvisor, setIsAdvisor] = useState(false);
  const [war, setWar] = useState(null); // активна війна моєї країни (підготовка або битва)
  const [warTotals, setWarTotals] = useState({ att: 0, def: 0 });
  const warRef = useRef(null);
  const warPendingRef = useRef({ warId: null, n: 0, base: 0, loaded: false });
  const allPlayersRef = useRef([]);
  const gameDataStaleRef = useRef(0);
  const [showTutorial, setShowTutorial] = useState(false);
  const tutorialCheckedRef = useRef(false);
  const [language, setLanguageState] = useState("uk");
  const [languageChosen, setLanguageChosen] = useState(null); // null = still checking, true/false once known

  useEffect(() => {
    (async () => {
      const saved = await storageGet(LANG_KEY, false);
      if (saved && SUPPORTED_LANGS.includes(saved)) setLanguageState(saved);
      const chosen = await storageGet(LANG_CHOSEN_KEY, false);
      setLanguageChosen(!!chosen);
    })();
  }, []);

  const setLanguage = useCallback((code) => {
    if (!SUPPORTED_LANGS.includes(code)) return;
    setLanguageState(code);
    storageSet(LANG_KEY, code, false);
  }, []);

  const confirmLanguageChoice = useCallback(() => {
    cnSfx.claim();
    setLanguageChosen(true);
    storageSet(LANG_CHOSEN_KEY, "1", false);
  }, []);

  const [tosStatus, setTosStatus] = useState("checking"); // checking | gate | accepted | declined
  useEffect(() => {
    (async () => {
      const accepted = await storageGet(TOS_KEY, false);
      setTosStatus(accepted ? "accepted" : "gate");
    })();
  }, []);
  const acceptTos = useCallback(() => {
    cnSfx.claim();
    storageSet(TOS_KEY, "1", false);
    setTosStatus("accepted");
  }, []);
  const declineTos = useCallback(() => {
    cnSfx.error();
    setTosStatus("declined");
  }, []);
  const reviewTosAgain = useCallback(() => setTosStatus("gate"), []);

  const refreshMail = useCallback(async () => {
    if (!player) return;
    const list = await getMail(player.id);
    setMail(list);
  }, [player]);

  /* Завантажує країни й володіння. Якщо база недоступна — лишаємо те, що вже було. */
  const refreshNations = useCallback(async () => {
    let timer;
    const data = await Promise.race([
      loadNations(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 10000); }),
    ]);
    clearTimeout(timer);
    if (!data) return false;
    setCountriesRegistry(data.countries);
    setNations(data);
    setNationsLoaded(true);
    return true;
  }, []);

  const refreshGameData = useCallback(
    async (force) => {
      const now = Date.now();
      if (!force && now - gameDataStaleRef.current < 15000) return;
      gameDataStaleRef.current = now;
      await refreshNations();
      const state = await loadGameState();
      setNews(state.news);
      setSeason(state.season && state.season.startedAt && state.season.rev === SEASON_REV ? state.season : await ensureSeasonStarted());
      if (player) {
        const leaderId = (await getLeader(player.countryCode)) || COUNTRY_MAP[player.countryCode]?.leaderId || null;
        setIsLeader(leaderId === player.id);
        const advisors = await getAdvisors(player.countryCode);
        setIsAdvisor(advisors.includes(player.id));
        // Синхронізуємо статус блокування (адмін міг заблокувати гравця з панелі)
        try {
          const freshRaw = await storageGet(PLAYER_PREFIX + player.id, true);
          if (freshRaw) {
            const fresh = JSON.parse(freshRaw);
            if (!!fresh.blocked !== !!player.blocked || fresh.blockedReason !== player.blockedReason) {
              setPlayer((prev) => (prev ? { ...prev, blocked: !!fresh.blocked, blockedReason: fresh.blockedReason || "" } : prev));
            }
          }
        } catch {
          /* ignore */
        }
      }
    },
    [player, refreshNations]
  );

  useEffect(() => {
    let cancelled = false;
    async function checkMaintenance() {
      try {
        const state = await loadGameState();
        if (!cancelled) setMaintenance(state.maintenance || EMPTY_GAME_STATE.maintenance);
      } catch {
        // не блокуємо гру, якщо перевірка не вдалась
      }
    }
    checkMaintenance();
    const t = visibleInterval(checkMaintenance, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (player) refreshMail();
    const t = visibleInterval(() => {
      if (player) refreshMail();
    }, 45000);
    return () => clearInterval(t);
  }, [player, refreshMail]);

  /* Роль лідера визначаємо одразу після входу (а не чекаємо на throttled refreshGameData) */
  const playerId = player?.id;
  const playerCountry = player?.countryCode;
  useEffect(() => {
    if (!playerId || !playerCountry) return undefined;
    let cancelled = false;
    (async () => {
      let leaderId = await getLeader(playerCountry);
      if (!leaderId) leaderId = COUNTRY_MAP[playerCountry]?.leaderId || null;
      if (!cancelled) setIsLeader(leaderId === playerId);
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, playerCountry]);

  useEffect(() => {
    if (tab === "map" || tab === "clicker" || tab === "profile" || tab === "season" || tab === "hq") {
      refreshGameData(false);
    }
  }, [tab, refreshGameData]);

  /* Keep war state reconciling in the background regardless of which tab
     is open, so e.g. a war's prep -> battle transition and the Attack
     button becoming usable doesn't depend on visiting a specific screen. */
  useEffect(() => {
    if (!player) return;
    const t = visibleInterval(() => refreshGameData(false), 20000);
    return () => clearInterval(t);
  }, [player, refreshGameData]);

  const unreadCount = useMemo(() => mail.filter((m) => !m.read).length, [mail]);

  /* Show the onboarding tutorial once per player, the first time they land
     on the main app after boot/creation. */
  useEffect(() => {
    if (!player || tutorialCheckedRef.current) return;
    tutorialCheckedRef.current = true;
    (async () => {
      const done = await storageGet(TUTORIAL_KEY, false);
      if (!done) setShowTutorial(true);
    })();
  }, [player]);

  const closeTutorial = useCallback(() => {
    setShowTutorial(false);
    storageSet(TUTORIAL_KEY, "1", false);
  }, []);

  const openTutorial = useCallback(() => {
    setShowTutorial(true);
  }, []);

  /* Load Google fonts once */
  useEffect(() => {
    if (!document.getElementById("cn-fonts")) {
      const link = document.createElement("link");
      link.id = "cn-fonts";
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  /* Telegram WebApp init */
  useEffect(() => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor && tg.setHeaderColor("#060B18");
        tg.setBackgroundColor && tg.setBackgroundColor("#060B18");
      }
    } catch {
      /* not inside telegram, ignore */
    }
  }, []);

  /* Load existing player on mount */
  useEffect(() => {
    (async () => {
      await refreshNations();
      const id = await storageGet(ID_KEY, false);
      if (id) {
        const raw = await storageGet(PLAYER_PREFIX + id, true);
        if (raw) {
          try {
            let rec = JSON.parse(raw);
            // Новий сезон: обнуляємо прогрес Battle Pass (кліки рахуються від поточного значення)
            const passMigrated = migratePass(rec);
            const needsPassSave = passMigrated !== rec;
            rec = passMigrated;
            setPlayer(rec);
            if (rec.__offlineCredited) {
              const { __offlineCredited, ...clean } = rec;
              await storageSet(PLAYER_PREFIX + id, JSON.stringify(clean), true);
              rec = clean;
            }
            if (needsPassSave) {
              const { __offlineCredited: _oc, ...cleanRec } = rec;
              await storageSet(PLAYER_PREFIX + id, JSON.stringify(cleanRec), true);
            }
            // Бекфіл: у старих записах ще немає telegramId — доклеюємо
            // поле й мапінг, інакше сервер не зможе видати Premium Pass.
            const tgUser = getTelegramUser();
            if (tgUser?.id && !rec.telegramId) {
              const patched = { ...rec, telegramId: tgUser.id };
              setPlayer(patched);
              await storageSet(PLAYER_PREFIX + id, JSON.stringify(patched), true);
              await storageSet(TG_MAP_PREFIX + tgUser.id, id, true);
            }
          } catch {
            /* corrupt record, ignore */
          }
        }
      }
      setBooting(false);
    })();
  }, []);

  /* Завершення онбордингу: приєднання до існуючої країни або створення власної.
     Для старих гравців (країна — реальна держава, якої більше немає) оновлюємо
     лише країну в існуючому записі, прогрес зберігається. */
  const finishOnboarding = useCallback(
    async ({ username, mode, countryId, name, regionId }) => {
      const base = player && isLegacyCountryCode(player.countryCode) ? player : null;
      const id = base ? base.id : genId();
      let targetCountry = countryId;
      const isCreator = mode === "create";

      if (isCreator) {
        const res = await createCountry({
          name,
          color: pickFreeColor(nations.countries),
          leaderId: id,
          regionId,
        });
        if (!res.ok) return res;
        targetCountry = res.country.id;
        await setLeaderStorage(targetCountry, id);
        await pushNews(`🌍 З'явилась нова країна «${name}». Світ став трохи тіснішим!`);
      } else if (!COUNTRY_MAP[targetCountry]) {
        await refreshNations();
        if (!COUNTRY_MAP[targetCountry]) return { ok: false, reason: "Цієї країни більше не існує. Обери іншу." };
      }
      /* Перший гравець реальної країни стає її лідером (далі — перевороти, повстання, голосування). */
      let becameLeader = isCreator;
      if (!isCreator && !(await getLeader(targetCountry))) {
        await setLeaderStorage(targetCountry, id);
        becameLeader = true;
        await pushNews(`🌍 ${COUNTRY_MAP[targetCountry]?.flag || ""} ${COUNTRY_MAP[targetCountry]?.name || targetCountry} має першого гравця й лідера.`);
      }

      const tgUser = getTelegramUser();
      const telegramId = base ? base.telegramId ?? tgUser?.id ?? null : tgUser?.id ?? null;
      let rec;
      if (base) {
        const { role, ...rest } = base;
        rec = { ...rest, username: cleanText(username, 24) || base.username || "Гравець", countryCode: targetCountry, telegramId };
      } else {
        rec = {
          id,
          telegramId,
          username: cleanText(username, 24) || "Гравець",
          countryCode: targetCountry,
          power: 0,
          totalClicks: 0,
          energy: MAX_ENERGY,
          lastEnergyTs: Date.now(),
          createdAt: Date.now(),
          points: 0,
          hasPremiumPass: false,
          passRev: PASS_REV,
          passBaseClicks: 0,
          passClaimedFree: [],
          passClaimedPremium: [],
          unlockedIcons: [],
          unlockedTitles: [],
          unlockedBadges: [],
        };
      }
      rec = migratePass(rec);
      if (isCreator) rec.role = "leader";
      await storageSet(ID_KEY, id, false);
      await storageSet(PLAYER_PREFIX + id, JSON.stringify(rec), true);
      if (telegramId) await storageSet(TG_MAP_PREFIX + telegramId, id, true);
      await refreshNations();
      setIsLeader(becameLeader);
      setPlayer(rec);
      return { ok: true };
    },
    [player, nations, refreshNations]
  );

  /* Лідер змінює колір своєї країни (Панель управління) */
  const changeCountryColor = useCallback(
    async (color) => {
      if (!player || !isLeader) return { ok: false, reason: "Лише лідер може змінювати колір" };
      const taken = nations.countries.some((c) => c.id !== player.countryCode && c.color === color);
      if (taken) return { ok: false, reason: "Цей колір уже обрала інша країна" };
      const res = await updateCountryColor(player.countryCode, color);
      if (res.ok) await refreshNations();
      return res;
    },
    [player, isLeader, nations, refreshNations]
  );

  /* Debounced save of the player's record to shared storage */
  const flush = useCallback((record) => {
    lastFlushRef.current = Date.now();
    storageSet(PLAYER_PREFIX + record.id, JSON.stringify(record), true);
  }, []);

  const scheduleSave = useCallback(
    (record) => {
      const now = Date.now();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (now - lastFlushRef.current > 3000) {
        flush(record);
      } else {
        saveTimerRef.current = setTimeout(() => flush(record), 700);
      }
    },
    [flush]
  );

  /* Flush on unmount / tab hide */
  useEffect(() => {
    const handler = () => {
      if (player) flush(player);
    };
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("beforeunload", handler);
      if (player) flush(player);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  /* Миттєве оновлення гравця (покупки, оплата дій) із негайним збереженням */
  const updatePlayer = useCallback(
    (fn) => {
      setPlayer((prev) => {
        if (!prev) return prev;
        const u = fn(prev);
        if (!u || u === prev) return prev;
        flush(u);
        return u;
      });
    },
    [flush]
  );

  /* Click handler */
  const handleClick = useCallback(
    (spawnEffects) => {
      setPlayer((prev) => {
        if (!prev) return prev;
        const curEnergy = getCurrentEnergy(prev);
        if (curEnergy < 1) {
          return { ...prev, energy: curEnergy, lastEnergyTs: Date.now() };
        }
        /* Під час битви кліки йдуть на шкалу війни, а не на баланс Power */
        const w = warRef.current;
        const inBattle = !!w && warPhase(w) === "battle" && !!warSide(w, prev.countryCode);
        if (inBattle) {
          const pend = warPendingRef.current;
          if (pend.warId !== w.id) {
            pend.warId = w.id;
            pend.n = 0;
            pend.base = 0;
            pend.loaded = false;
          }
          pend.n += 1;
        }
        const updated = {
          ...prev,
          power: inBattle ? prev.power : prev.power + 1,
          totalClicks: prev.totalClicks + 1,
          energy: curEnergy - 1,
          lastEnergyTs: Date.now(),
        };
        scheduleSave(updated);
        if (spawnEffects) spawnEffects(true);
        return updated;
      });
    },
    [scheduleSave]
  );

  /* Leaderboard refresh */
  const refreshLeaderboard = useCallback(async (force) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < LEADERBOARD_STALE_MS) return;
    lastFetchRef.current = now;
    setLbLoading(true);
    const list = await fetchAllPlayers();
    setAllPlayers(list);
    setLbLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "leaderboard" || tab === "profile" || tab === "map" || tab === "hq") {
      refreshLeaderboard(false);
    }
  }, [tab, refreshLeaderboard]);

  /* Merge own freshest state into the leaderboard list */
  const mergedPlayers = useMemo(() => {
    if (!player) return allPlayers;
    const exists = allPlayers.some((p) => p.id === player.id);
    const list = exists
      ? allPlayers.map((p) => (p.id === player.id ? { ...p, ...player } : p))
      : [...allPlayers, player];
    return list;
    // На екрані кліку не перераховуємо список усіх гравців на кожен клік (це O(n) і гальмує);
    // він оновиться при зміні вкладки чи завантаженні рейтингу.
  }, [allPlayers, tab, tab === "clicker" ? null : player]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayedEnergy = player ? getCurrentEnergy(player) : 0;

  /* ---- Війна: оновлення стану, відправка кліків, шкала, підсумки ---- */
  useEffect(() => {
    warRef.current = war;
  }, [war]);
  useEffect(() => {
    allPlayersRef.current = mergedPlayers;
  }, [mergedPlayers]);

  /* Ім'я = ім'я в Telegram (синхронізується при кожному вході) + запис підключення/пристрою для адміна */
  const trackedPlayerRef = useRef(null);
  useEffect(() => {
    if (!player || isLegacyCountryCode(player.countryCode) || trackedPlayerRef.current === player.id) return undefined;
    trackedPlayerRef.current = player.id;
    let nameChange = null;
    if (getTelegramUser()?.id) {
      const tgName = getTelegramDisplayName();
      if (tgName && tgName !== player.username) {
        nameChange = { from: player.username, to: tgName };
        setPlayer((prev) => (prev ? { ...prev, username: tgName } : prev));
        // Зберігаємо вже оновлений запис (трохи згодом, щоб не затерти старим значенням при flush на зміну стану)
        setTimeout(() => {
          setPlayer((prev) => {
            if (prev) scheduleSave(prev);
            return prev;
          });
        }, 800);
      }
    }
    trackSession({ ...player, username: nameChange ? nameChange.to : player.username }, nameChange).catch(() => {});
    return undefined;
  }, [player, scheduleSave]);

  const seenPlayerId = player?.id;
  useEffect(() => {
    if (!seenPlayerId) return undefined;
    const beat = () => storageSet(PSEEN_PREFIX + seenPlayerId, String(Date.now()), true);
    beat();
    const hb = visibleInterval(beat, 5 * 60 * 1000);
    return () => clearInterval(hb);
  }, [seenPlayerId]);

  const playerIdForWar = player?.id;
  const playerCountryForWar = player?.countryCode;
  useEffect(() => {
    if (!playerIdForWar || !playerCountryForWar || isLegacyCountryCode(playerCountryForWar)) return undefined;
    let stopped = false;
    let timer = null;

    const flushClicks = async (w) => {
      const pend = warPendingRef.current;
      if (pend.warId !== w.id) {
        pend.warId = w.id;
        pend.n = 0;
        pend.base = 0;
        pend.loaded = false;
      }
      const key = WAR_CLICKS_PREFIX + w.id + ":" + playerIdForWar;
      if (!pend.loaded) {
        const rec = await getJSON(key, true, null);
        pend.base = rec?.n || 0;
        pend.loaded = true;
      }
      if (pend.n > 0) {
        const take = pend.n;
        pend.n = 0;
        pend.base += take;
        const ok = await setJSON(key, { side: warSide(w, playerCountryForWar), c: playerCountryForWar, n: pend.base }, true);
        if (!ok) {
          pend.base -= take;
          pend.n += take;
        }
      }
    };

    const tick = async () => {
      let delay = 12000;
      try {
        const wars = await loadActiveWars();
        let mine = wars.find((w) => warInvolves(w, playerCountryForWar)) || null;
        if (mine && warPhase(mine) === "finish") {
          await flushClicks(mine);
          await finalizeWar(mine, allPlayersRef.current);
          mine = null;
          await refreshNations();
          refreshMail();
        }
        if (stopped) return;
        setWar((prev) => (JSON.stringify(prev) === JSON.stringify(mine) ? prev : mine));
        const phase = mine ? warPhase(mine) : null;
        if (phase === "battle") {
          await flushClicks(mine);
          const totals = await fetchWarTotals(mine.id, playerIdForWar);
          if (!stopped) setWarTotals(totals);
          delay = 3000;
        } else if (phase === "prep") {
          delay = 5000;
        }
      } catch {
        /* повторимо на наступному кроці */
      }
      if (!stopped) timer = setTimeout(tick, delay);
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [playerIdForWar, playerCountryForWar]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cn-root" style={THEMES[theme]?.vars}>
      <GlobalStyles />
      {maintenance.enabled && !isSuperAdmin() ? (
        <MaintenanceScreen message={maintenance.message} />
      ) : booting || tosStatus === "checking" || languageChosen === null ? (
        <BootScreen lang={language} />
      ) : !languageChosen ? (
        <LanguageSelectScreen lang={language} onSetLanguage={setLanguage} onContinue={confirmLanguageChoice} />
      ) : tosStatus === "gate" ? (
        <TosGateScreen lang={language} onAccept={acceptTos} onDecline={declineTos} />
      ) : tosStatus === "declined" ? (
        <TosDeclinedScreen lang={language} onReview={reviewTosAgain} />
      ) : !player ? (
        <OnboardingScreen onFinish={finishOnboarding} lang={language} nations={nations} onReloadNations={refreshNations} />
      ) : player.blocked ? (
        <BlockedScreen reason={player.blockedReason} />
      ) : isLegacyCountryCode(player.countryCode) ? (
        <OnboardingScreen
          onFinish={finishOnboarding}
          lang={language}
          nations={nations}
          onReloadNations={refreshNations}
          reassign
          initialName={player.username}
        />
      ) : (
        <div className="cn-app">
          <div key={tab} className={"cn-content cn-content--anim" + (tab === "map" ? " cn-content--map" : "")}>
            <ScreenErrorBoundary resetKey={tab}>
            {tab === "clicker" && (
              <ClickerScreen
                player={player}
                onClick={handleClick}
                isLeader={isLeader}
                news={news}
                countries={nations.countries}
                onSetPlayer={setPlayer}
                onOpenLeaderboard={() => setTab("leaderboard")}
                war={war}
                warTotals={warTotals}
                warPendingRef={warPendingRef}
                players={mergedPlayers}
              />
            )}
            {tab === "leaderboard" && (
              <LeaderboardScreen
                me={player}
                players={mergedPlayers}
                loading={lbLoading}
                onRefresh={() => refreshLeaderboard(true)}
                onBack={() => setTab("clicker")}
                lang={language}
              />
            )}
            {tab === "hq" && (
              <HQScreen
                player={player}
                players={mergedPlayers}
                nations={nations}
                isLeader={isLeader}
                onChangeCountryColor={changeCountryColor}
                lang={language}
                mail={mail}
                unreadCount={unreadCount}
                onRefreshMail={refreshMail}
                onRefreshData={() => refreshGameData(true)}
                war={war}
                onUpdatePlayer={updatePlayer}
                onWarDeclared={(w) => { setWar(w); setTab("clicker"); }}
              />
            )}
            {tab === "profile" && (
              <ProfileScreen
                me={player}
                players={mergedPlayers}
                energy={displayedEnergy}
                theme={theme}
                mail={mail}
                unreadCount={unreadCount}
                onRefreshMail={refreshMail}
                wars={wars}
                season={season}
                isLeader={isLeader}
                onSetPlayer={setPlayer}
                onRefreshGameData={() => refreshGameData(true)}
                onOpenTutorial={openTutorial}
                lang={language}
                onSetLanguage={setLanguage}
                maintenance={maintenance}
                onSaveMaintenance={async (payload) => {
                  const updated = await saveGameStatePart({ maintenance: payload });
                  setMaintenance(updated.maintenance);
                }}
              />
            )}
            {tab === "season" && (
              <SeasonScreen
                season={season}
                me={player}
                onSetPlayer={setPlayer}
                onRefresh={() => refreshGameData(true)}
              />
            )}
            {tab === "shop" && (
              <ShopScreen
                onGoToSeason={() => setTab("season")}
                me={player}
                onSetPlayer={setPlayer}
                isLeader={isLeader}
                isAdvisor={isAdvisor}
                onRefreshGameData={() => refreshGameData(true)}
              />
            )}
            {tab === "map" && (
              <MapScreen
                isLeader={isLeader}
                onUpdatePlayer={setPlayer}
                players={mergedPlayers}
                me={player}
                loading={lbLoading}
                onRefresh={() => {
                  refreshLeaderboard(true);
                  refreshNations();
                }}
                nations={nations}
                lang={language}
              />
            )}
            </ScreenErrorBoundary>
          </div>
          <BottomNav tab={tab} setTab={setTab} unreadMail={unreadCount} lang={language} />
        </div>
      )}
      {showTutorial && player && <TutorialModal onClose={closeTutorial} lang={language} setTab={setTab} name={player.username} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Onboarding tutorial (dialogue with mentor character)                */
/* ------------------------------------------------------------------ */

/* Якщо екран «впав», показуємо повідомлення з кнопкою «Назад», а не чорний екран. */
class ScreenErrorBoundary extends React.Component {
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

function TutorialModal({ onClose, lang = "uk", setTab, name = "" }) {
  const [step, setStep] = useState(0);
  const [typingDone, setTypingDone] = useState(false);
  const textRef = useRef(null);
  const [rect, setRect] = useState(null);
  const total = TUTORIAL_STEPS.length;
  const current = TUTORIAL_STEPS[step];
  const playerName = String(name || "").trim() || (lang === "uk" ? "друже" : lang === "ru" ? "друг" : "friend");
  const currentTitle = tutPick(current.title, lang).replace("{name}", playerName);
  const currentText = tutPick(current.text, lang).replace("{name}", playerName);
  const isLast = step === total - 1;
  const typeTimerRef = useRef(null);
  const vh = typeof window !== "undefined" ? window.innerHeight : 700;
  const isCenter = current.pos === "center";
  const guided = !!current.target;

  /* Глобі сам переводить гравця на потрібну вкладку. */
  useEffect(() => {
    if (current.tab && setTab) startTransition(() => setTab(current.tab));
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Шукаємо на екрані елемент, на який вказує Глобі, і стежимо за його положенням. */
  useEffect(() => {
    setRect(null);
    if (!current.target) return undefined;
    let scrolled = false;
    const measure = () => {
      const el = document.querySelector('[data-tut="' + current.target + '"]');
      if (!el) { setRect(null); return; }
      if (!scrolled) {
        scrolled = true;
        try { el.scrollIntoView({ block: "center", behavior: "auto" }); } catch (e) { /* ignore */ }
      }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) { setRect(null); return; }
      setRect((prev) =>
        prev && Math.abs(prev.x - r.left) < 1 && Math.abs(prev.y - r.top) < 1 && Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { x: r.left, y: r.top, w: r.width, h: r.height }
      );
    };
    const first = setTimeout(measure, 80);
    const iv = setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(first); clearInterval(iv); window.removeEventListener("resize", measure); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Заздалегідь декодуємо всі пози, щоб зміна кроку не гальмувала. */
  const preloadRef = useRef([]);
  useEffect(() => {
    preloadRef.current = [GLOBY_IDLE_IMG, GLOBY_POINT_IMG, GLOBY_WAVE_IMG, GLOBY_WAVE2_IMG, GLOBY_PRESENT_IMG].map((src) => {
      const im = new Image();
      im.src = src;
      try { if (im.decode) im.decode().catch(() => {}); } catch (e) { /* ignore */ }
      return im;
    });
  }, []);

  /* Друкарський ефект іде напряму в DOM (без перерендеру React на кожну літеру) через rAF. */
  useEffect(() => {
    const el = textRef.current;
    const full = currentText;
    setTypingDone(false);
    if (!el) return undefined;
    el.textContent = "";
    let raf = 0;
    let lastN = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const n = Math.min(full.length, Math.floor((now - t0) / 18) + 1);
      if (n !== lastN) {
        el.textContent = full.slice(0, n);
        if (Math.floor(n / 4) !== Math.floor(lastN / 4)) cnSfx.blip();
        lastN = n;
      }
      if (n >= full.length) { setTypingDone(true); return; }
      raf = requestAnimationFrame(tick);
    };
    // даємо першому кадру нового кроку відмалюватись, потім починаємо друк
    raf = requestAnimationFrame(tick);
    typeTimerRef.current = () => cancelAnimationFrame(raf);
    return () => cancelAnimationFrame(raf);
  }, [step, currentText]);

  const skipTyping = () => {
    if (typeof typeTimerRef.current === "function") typeTimerRef.current();
    if (textRef.current) textRef.current.textContent = currentText;
    setTypingDone(true);
  };

  const finish = () => {
    if (setTab) startTransition(() => setTab("clicker"));
    onClose();
  };
  const next = () => {
    if (isLast) {
      cnSfx.fanfare();
      finish();
    } else {
      cnSfx.step();
      setStep((s) => Math.min(s + 1, total - 1));
    }
  };
  const prev = () => {
    cnSfx.step();
    setStep((s) => Math.max(s - 1, 0));
  };
  const handleSkipTutorial = () => {
    cnSfx.skip();
    finish();
  };

  /* Картку ставимо туди, де більше вільного місця відносно підсвіченого елемента. */
  const place = current.pos === "bottom" ? "bottom" : "top";
  const showArrow = rect && rect.h < vh * 0.45;
  const overlayCls =
    "cn-tutorial-overlay" +
    (isCenter ? "" : " cn-tutorial-overlay--guided cn-tutorial-overlay--" + place) +
    (!isCenter && !guided ? " cn-tutorial-overlay--free" : "") +
    (guided && !rect ? " cn-tutorial-overlay--dim" : "");

  return (
    <div className={overlayCls} role="dialog" aria-modal="true">
      {guided && rect && (
        <>
          <div
            className="cn-tut-spot"
            style={{ width: rect.w + 12, height: rect.h + 12, transform: `translate3d(${rect.x - 6}px, ${rect.y - 6}px, 0)` }}
          />
          {showArrow && (
            <span
              className={"cn-tut-arrow cn-tut-arrow--" + (place === "bottom" ? "up" : "down")}
              style={{ transform: `translate3d(${rect.x + rect.w / 2 - 14}px, ${place === "bottom" ? rect.y + rect.h + 8 : rect.y - 38}px, 0)` }}
            />
          )}
        </>
      )}
      <div className={"cn-tutorial-card cn-tutorial-card--enter" + (isCenter ? "" : " cn-tutorial-card--compact")}>
        <button className="cn-tutorial-skip" type="button" onClick={handleSkipTutorial} aria-label={t(lang, "tutorial_skip_btn")}>
          <X size={16} /> {t(lang, "tutorial_skip_btn")}
        </button>

        <div className={"cn-tutorial-portrait-wrap"}>
          <div className="cn-tutorial-frame">
            <img key={step} src={current.img} alt={t(lang, "tutorial_mentor_name")} className="cn-tutorial-portrait" draggable={false} decoding="async" />
          </div>
        </div>
        <div className="cn-tutorial-name-tag">{t(lang, "tutorial_mentor_name")} · {step + 1}/{total}</div>

        <div key={step} className="cn-tutorial-bubble cn-tutorial-bubble--enter" onClick={skipTyping}>
          <div className="cn-tutorial-title">{currentTitle}</div>
          <div className="cn-tutorial-text">
            <span ref={textRef} />
            {!typingDone && <span className="cn-tutorial-caret" />}
          </div>
        </div>

        <div className="cn-tutorial-dots">
          {TUTORIAL_STEPS.map((_, i) => (
            <span key={i} className={"cn-tutorial-dot" + (i === step ? " cn-tutorial-dot--active" : "")} />
          ))}
        </div>

        <div className="cn-tutorial-actions">
          {step > 0 ? (
            <button className="cn-tutorial-btn cn-tutorial-btn--ghost" type="button" onClick={prev}>
              <ChevronLeft size={18} /> {t(lang, "tutorial_back_btn")}
            </button>
          ) : (
            <span />
          )}
          <button className="cn-primary-btn cn-tutorial-btn--next cn-tutorial-btn--pulse" type="button" onClick={next}>
            <span className="cn-primary-btn-label">{isLast ? t(lang, "tutorial_start_btn") : t(lang, "tutorial_next_btn")}</span>
            <ChevronRight size={20} className="cn-primary-btn-chevron" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Boot screen                                                         */
/* ------------------------------------------------------------------ */

/* Логотип гри: глобус із літерою W посередині. Малюється SVG, колір береться з акценту теми. */
function GameLogo({ size = 40, className }) {
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
function GemIcon({ size = 24, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.2 3.5h11.6l4.2 5.3L12 21 2 8.8z" fill="currentColor" fillOpacity="0.9" />
      <path d="M2 8.8h20M9 3.5l-2.6 5.3L12 21M15 3.5l2.6 5.3L12 21" stroke="rgba(0,0,0,0.32)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function BootScreen({ lang = "uk" }) {
  return <LoadingScreen lang={lang} variant="full" />;
}

/* ------------------------------------------------------------------ */
/*  Language select screen (shown once, before the TOS gate)           */
/* ------------------------------------------------------------------ */

function LanguageSelectScreen({ lang, onSetLanguage, onContinue }) {
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

function TosGateScreen({ lang, onAccept, onDecline }) {
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

function TosDeclinedScreen({ lang, onReview }) {
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

function BlockedScreen({ reason }) {
  return (
    <div className="cn-tos-screen">
      <div className="cn-tos-glow" />
      <div className="cn-tos-card">
        <Ban size={36} className="cn-tos-icon cn-tos-icon--dim" />
        <div className="cn-tos-title">Акаунт заблоковано</div>
        <div className="cn-tos-body">
          {reason || "Доступ до гри для цього акаунту обмежено адміністрацією."}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Onboarding                                                          */
/* ------------------------------------------------------------------ */

function OnboardingScreen({ onFinish, lang = "uk", nations, onReloadNations, reassign = false, initialName = "" }) {
  const [username] = useState(initialName || getTelegramDisplayName());
  const [step, setStep] = useState("list"); // list (лише вибір реальної країни)
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(null); // країна, яка чекає підтвердження
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [region, setRegion] = useState(null); // { rid, name } — вибрана вільна область
  const [countryName, setCountryName] = useState("");
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);

  const countries = nations?.countries || [];
  const owners = nations?.owners || {};
  const hasName = username.trim().length > 0;

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  const flash = (text) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 3200);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => String(c.name).toLowerCase().includes(q) || String(c.nameEn || "").toLowerCase().includes(q) || c.id.toLowerCase() === q);
  }, [query, countries]);

  const goBack = () => {
    cnSfx.toggle();
    setStep("choice");
    setPending(null);
    setError("");
    setQuery("");
  };

  const joinCountry = async () => {
    if (!pending || submitting) return;
    setSubmitting(true);
    setError("");
    const res = await onFinish({ username, mode: "join", countryId: pending.id });
    if (!res.ok) {
      setError(res.reason || "Не вдалося приєднатися");
      setPending(null);
      setSubmitting(false);
    }
  };

  const handleSelectRegion = (r) => {
    if (r.ownerId) {
      const c = COUNTRY_MAP[r.ownerId];
      cnSfx.error();
      flash(t(lang, "nn_region_taken").replace("{name}", c?.name || "—"));
      return;
    }
    setError("");
    setRegion({ rid: r.rid, name: r.name });
  };

  const nameError = countryName.trim() ? validateCountryName(countryName, countries) : "";
  const canCreate = !!region && countryName.trim().length >= NAME_MIN && !nameError && !submitting;

  const createCountryNow = async () => {
    if (!canCreate) return;
    setSubmitting(true);
    setError("");
    const res = await onFinish({ username, mode: "create", name: countryName, regionId: region.rid });
    if (!res.ok) {
      setError(res.reason || "Не вдалося створити країну");
      setSubmitting(false);
      if (res.taken) {
        setRegion(null);
        onReloadNations();
      }
    }
  };

  /* ---------- Крок 1: вибір — існуюча країна чи власна ---------- */
  if (step === "choice") {
    return (
      <div className="cn-onboard">
        <div className="cn-onboard-header">
          <GameLogo size={56} className="cn-onboard-icon" />
          <div className="cn-onboard-title">WORLD CLICKER</div>
          <div className="cn-onboard-sub">{t(lang, "onboard_sub")}</div>
        </div>

        {reassign && <div className="cn-onboard-reassign">{t(lang, "nn_reassign_note")}</div>}

        <div className="cn-choice-list">
          <button type="button" className="cn-choice-btn" disabled={!hasName} onClick={() => { cnSfx.toggle(); setStep("list"); }}>
            <span className="cn-choice-icon"><Users size={26} /></span>
            <span className="cn-choice-text">
              <span className="cn-choice-title">{t(lang, "nn_play_existing")}</span>
              <span className="cn-choice-sub">{t(lang, "nn_play_existing_sub")} ({countries.length})</span>
            </span>
            <ChevronRight size={20} />
          </button>
        </div>
        {error && <div className="cn-onboard-blocked-msg">{error}</div>}

        <div className="cn-onboard-note">
          <Shield size={13} className="cn-onboard-note-icon" />
          {t(lang, "onboard_lock_note")}
        </div>
      </div>
    );
  }

  /* ---------- Крок 2а: список існуючих країн ---------- */
  if (step === "list") {
    return (
      <div className="cn-onboard">
        <div className="cn-onboard-header">
          <GameLogo size={48} className="cn-onboard-icon" />
          <div className="cn-onboard-title">{t(lang, "nn_list_title")}</div>
          <div className="cn-onboard-sub">{t(lang, "onboard_sub")}</div>
        </div>
        {reassign && <div className="cn-onboard-reassign">{t(lang, "nn_reassign_note")}</div>}

        <div className="cn-country-search-wrap cn-country-search-wrap--static">
          <Search size={15} className="cn-country-search-icon" />
          <input
            className="cn-country-search"
            placeholder={t(lang, "onboard_country_search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error && <div className="cn-onboard-blocked-msg">{error}</div>}

        <div className="cn-nation-list">
          {countries.length === 0 && (
            <div className="cn-nation-empty">
              {t(lang, "nn_list_empty")}
            </div>
          )}
          {countries.length > 0 && filtered.length === 0 && (
            <div className="cn-nation-empty">{t(lang, "onboard_country_empty")}</div>
          )}
          {filtered.map((c) => (
            <button key={c.id} type="button" className="cn-nation-row" onClick={() => { cnSfx.toggle(); setPending(c); }}>
              <Flag code={c.id} size={30} className="cn-country-badge--lg" />
              <span className="cn-nation-name">{c.name}</span>
              <span className="cn-nation-meta">{c.regionCount || 0} {t(lang, "nn_regions_count")}</span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>

        {pending && (
          <div className="cn-modal-overlay cn-modal-overlay--center" onClick={() => !submitting && setPending(null)}>
            <div className="cn-confirm-modal" onClick={(e) => e.stopPropagation()}>
              <Flag code={pending.id} size={52} className="cn-country-badge--lg" />
              <div className="cn-confirm-title">{t(lang, "nn_confirm_title")}</div>
              <div className="cn-confirm-text">{t(lang, "nn_confirm_text").replace("{name}", pending.name)}</div>
              <div className="cn-confirm-actions">
                <button type="button" className="cn-dev-btn" disabled={submitting} onClick={() => setPending(null)}>
                  {t(lang, "nn_confirm_no")}
                </button>
                <button type="button" className="cn-dev-btn cn-dev-btn--primary" disabled={submitting} onClick={joinCountry}>
                  {submitting ? t(lang, "onboard_creating_btn") : t(lang, "nn_confirm_yes")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ---------- Крок 2б: створення своєї країни — вибір вільної області ---------- */
  return (
    <div className="cn-onboard cn-onboard--map">
      <div className="cn-step-bar">
        <button type="button" className="cn-back-btn" onClick={goBack} aria-label={t(lang, "nn_back")}>
          <ArrowLeft size={20} />
        </button>
        <div className="cn-step-title">{t(lang, "nn_create_title")}</div>
      </div>
      <div className="cn-create-panel">
        <label className="cn-label">{t(lang, "nn_country_name_label")}</label>
        <input
          className="cn-input"
          maxLength={NAME_MAX}
          placeholder={t(lang, "nn_country_name_ph")}
          value={countryName}
          onChange={(e) => setCountryName(e.target.value)}
        />
        {(nameError || error) && <div className="cn-onboard-blocked-msg">{nameError || error}</div>}
      </div>

      <div className="cn-create-region" style={{ marginTop: 12, marginBottom: 10 }}>
        <MapIcon size={15} />
        {region ? (
          <span>{t(lang, "nn_region_selected")}: <b>{region.name}</b></span>
        ) : (
          <span className="cn-create-region-empty">{t(lang, "nn_create_hint")}</span>
        )}
      </div>

      <div className="cn-tmap-viewport">
        <TerritoryMap mode="pick" owners={owners} countries={countries} selectedRid={region?.rid} onSelectRegion={handleSelectRegion} />
        {toast && <div className="cn-tmap-toast">{toast}</div>}
      </div>

      <MapLegend lang={lang} />

      <button className="cn-primary-btn" disabled={!canCreate} onClick={createCountryNow} style={{ marginTop: 4 }}>
        <span className="cn-primary-btn-emoji">🏁</span>
        <span className="cn-primary-btn-label">{submitting ? t(lang, "onboard_creating_btn") : t(lang, "nn_confirm_btn")}</span>
        <ChevronRight size={20} className="cn-primary-btn-chevron" />
      </button>
    </div>
  );
}

/* Легенда карти: три типи територій */
function MapLegend({ lang = "uk", myColor }) {
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
/*  Clicker screen                                                      */
/* ------------------------------------------------------------------ */

function ClickerScreen({
  player,
  onClick,
  isLeader,
  news,
  countries,
  onSetPlayer,
  onOpenLeaderboard,
  war = null,
  warTotals = { att: 0, def: 0 },
  warPendingRef = null,
  players = [],
}) {
  const country = COUNTRY_MAP[player.countryCode];
  const [effects, setEffects] = useState([]);
  const [pressed, setPressed] = useState(false);
  const [shake, setShake] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const globeRef = useRef(null);
  const lastEffectTsRef = useRef(0);
  const MAX_EFFECTS = 6;

  /* Local energy tick - scoped to this screen only, so other tabs
     (Map, Profile, etc.) don't re-render every second for no reason. */
  const [, localTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => localTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const energy = getCurrentEnergy(player);


  const spawnEffects = useCallback((clientX, clientY, allowed) => {
    if (!allowed) {
      setShake(true);
      cnSfx.error();
      setTimeout(() => setShake(false), 350);
      return;
    }
    /* Every click always earns Power immediately (handled by the caller).
       The ripple/+1 animation is a visual flourish only, so during very
       fast clicking we throttle *just this* and cap how many are alive
       at once, to avoid piling up DOM nodes/animations and causing jank. */
    const now = Date.now();
    if (now - lastEffectTsRef.current < 35) return;
    lastEffectTsRef.current = now;

    const rect = globeRef.current?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : 0;
    const y = rect ? clientY - rect.top : 0;
    const id = now + Math.random();
    setEffects((prev) => {
      const next = [...prev, { id, x, y }];
      return next.length > MAX_EFFECTS ? next.slice(next.length - MAX_EFFECTS) : next;
    });
    setTimeout(() => setEffects((prev) => prev.filter((i) => i.id !== id)), 700);
  }, []);

  const handlePress = (e) => {
    const clientX = e.clientX ?? 0;
    const clientY = e.clientY ?? 0;
    setPressed(true);
    setTimeout(() => setPressed(false), 120);
    cnSfx.tap();
    onClick((allowed) => spawnEffects(clientX, clientY, allowed));
  };

  const energyPct = Math.max(0, Math.min(100, (energy / maxEnergyOf(player)) * 100));
  const isEmpty = energy < 1;
  const unreadNews = news && news.length > 0;
  const inWar = !!war && !!warSide(war, player.countryCode); // підготовка або битва
  const actionBtns = (
    <>
      <button className="cn-icon-tile" type="button" onClick={() => { cnSfx.navSwitch(); onOpenLeaderboard && onOpenLeaderboard(); }} aria-label="Рейтинг">
        <Trophy size={19} />
      </button>
      <button className="cn-icon-tile" type="button" onClick={() => { cnSfx.modalOpen(); openSupportChat(); }} aria-label="Підтримка">
        <LifeBuoy size={19} />
      </button>
      <button className="cn-icon-tile" type="button" onClick={() => { cnSfx.modalOpen(); setNewsOpen(true); }} aria-label="Новини">
        <Newspaper size={19} />
        {unreadNews && <span className="cn-icon-btn-dot" />}
      </button>
    </>
  );

  return (
    <div className="cn-clicker">
      <div className="cn-clicker-topbar">
        <span className="cn-country-pill">
          <Flag code={country?.code} size={16} /> {country?.name}
        </span>
        {!inWar && <div className="cn-clicker-top-actions" data-tut="actions">{actionBtns}</div>}
      </div>

      {war && warSide(war, player.countryCode) && (
        <WarHud war={war} me={player} isLeader={isLeader} totals={warTotals} pendingRef={warPendingRef} players={players} />
      )}

      <div className="cn-power-block" data-tut="power" style={war && warPhase(war) === "battle" && warSide(war, player.countryCode) ? { display: "none" } : undefined}>
        <div className="cn-power-value-row" aria-label="Power">
          <GemIcon size={30} className="cn-power-icon cn-power-icon--power" />
          <span className="cn-power-value">{fmt(player.power)}</span>
        </div>
        <div className="cn-power-value-row cn-power-value-row--points" aria-label="Points">
          <GemIcon size={30} className="cn-power-icon cn-power-icon--points" />
          <span className="cn-power-value">{fmt(player.points || 0)}</span>
        </div>
      </div>

      <div
        ref={globeRef}
        data-tut="globe"
        className={
          "cn-globe-wrap" +
          (pressed ? " cn-globe-wrap--pressed" : "") +
          (shake ? " cn-globe-wrap--shake" : "") +
          (isEmpty ? " cn-globe-wrap--empty" : "")
        }
        onPointerDown={handlePress}
        role="button"
        aria-label="Клікни по глобусу"
      >
        <div className="cn-globe-glow" />
        <svg viewBox="0 0 200 200" className="cn-globe-svg">
          <defs>
            <radialGradient id="globeGrad" cx="35%" cy="28%" r="75%">
              <stop offset="0%" stopColor="#1E5A8E" />
              <stop offset="55%" stopColor="#0B2A4A" />
              <stop offset="100%" stopColor="#040D1C" />
            </radialGradient>
          </defs>
          <circle cx="100" cy="100" r="92" fill="url(#globeGrad)" stroke="#22D3EE" strokeOpacity="0.55" strokeWidth="1.5" />
          <g className="cn-globe-lines">
            <ellipse cx="100" cy="100" rx="92" ry="28" fill="none" stroke="#3FD6E8" strokeOpacity="0.3" strokeWidth="1" />
            <ellipse cx="100" cy="100" rx="92" ry="55" fill="none" stroke="#3FD6E8" strokeOpacity="0.3" strokeWidth="1" />
            <ellipse cx="100" cy="100" rx="28" ry="92" fill="none" stroke="#3FD6E8" strokeOpacity="0.3" strokeWidth="1" />
            <ellipse cx="100" cy="100" rx="55" ry="92" fill="none" stroke="#3FD6E8" strokeOpacity="0.3" strokeWidth="1" />
            <line x1="8" y1="100" x2="192" y2="100" stroke="#3FD6E8" strokeOpacity="0.25" strokeWidth="1" />
          </g>
          <circle cx="100" cy="100" r="92" fill="none" stroke="#22D3EE" strokeOpacity="0.9" strokeWidth="2" className="cn-globe-ring" />
        </svg>
        {effects.map((eft) => (
          <React.Fragment key={eft.id}>
            <span className="cn-ripple" style={{ left: eft.x, top: eft.y }} />
            <span className="cn-particle" style={{ left: eft.x, top: eft.y }}>
              +1
            </span>
          </React.Fragment>
        ))}
      </div>

      <div data-tut="energy" className={"cn-energy-block cn-en cn-en--" + (energyPct > 50 ? "high" : energyPct > 20 ? "mid" : "low")}>
        <div className="cn-en-card">
          <span className="cn-en-icon"><Zap size={20} strokeWidth={2.4} /></span>
          <div className="cn-en-main">
            <div className="cn-en-top">
              <span className="cn-en-label">ЕНЕРГІЯ</span>
              <span className="cn-en-val"><b>{Math.floor(energy)}</b> / {maxEnergyOf(player)}</span>
            </div>
            <div className="cn-en-bar">
              <div className="cn-en-fill" style={{ width: energyPct + "%" }} />
              <div className="cn-en-ticks" />
            </div>
          </div>
        </div>
        {isEmpty && <div className="cn-energy-empty-note"><Zap size={13} className="cn-energy-empty-ico" /><span>Енергія відновлюється</span><b>+{String(energyRegenOf(player)).replace(".", ",")} / сек</b></div>}
      </div>


      <div className="cn-stats-row">
        <div className="cn-stat-chip">
          <span className="cn-stat-chip-dots">⁚⁚</span>
          <div className="cn-stat-chip-body">
            <span className="cn-stat-chip-label">TOTAL CLICKS</span>
            <span className="cn-stat-chip-value">{fmt(player.totalClicks)}</span>
          </div>
          <span className="cn-stat-chip-dots">⁚⁚</span>
        </div>
      </div>

      {inWar && <div className="cn-clicker-bottom-actions">{actionBtns}</div>}

      {newsOpen && <NewsModal news={news} onClose={() => setNewsOpen(false)} />}
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

function WarHud({ war, me, isLeader, totals, pendingRef, players = [] }) {
  const [alliesOpen, setAlliesOpen] = useState(false);
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
      clearInterval(t);
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
/*  Штаб (HQ)                                                           */
/* ------------------------------------------------------------------ */

const HQ_SECTIONS = [
  { id: "dev", label: "Покращення", Icon: TrendingUp, text: "" },
  { id: "army", label: "Армія", leaderOnly: true, Icon: Swords, noSoon: true, text: "Тут ви керуватимете військами: набір, розміщення та підготовка до війни." },
  { id: "diplomacy", label: "Дипломатія", leaderOnly: true, Icon: Handshake, text: "" },
  { id: "mail", label: "Пошта", Icon: Mail, text: "" },
  { id: "info", label: "Інформація", Icon: Info, text: "" },
  { id: "settings", label: "Налаштування", Icon: Settings, text: "" },
  { id: "economy", label: "Економіка", Icon: Coins, soon: true, text: "Тут з'являться податки, торгівля та бюджет країни: гроші від територій і союзів." },
  { id: "intel", label: "Розвідка", Icon: Compass, soon: true, text: "Тут можна буде розвідувати чужі країни: сила армії, оборона міст і плани ворога." },
  { id: "tech", label: "Технології", Icon: Sparkles, soon: true, text: "Тут країна відкриватиме технології, які підсилюють армію, оборону та економіку." },
];
// Підрозділи «Інформації» (раніше були окремими кнопками Штабу)
const HQ_SUB = [
  { id: "stats", label: "Статистика", Icon: BarChart2 },
];
// Підрозділи «Армії»: лише «Оборона» (поруч із кнопкою «Оголосити війну»)
const ARMY_SUBS = [
  { id: "defense", label: "Оборона", Icon: Shield, text: "" },
];

function HQScreen({ player, players, nations, isLeader, onChangeCountryColor, lang = "uk", mail = [], unreadCount = 0, onRefreshMail, onRefreshData, war = null, onWarDeclared, onUpdatePlayer }) {
  const [view, setView] = useState(null); // null | id розділу | "dev"
  const [pickKind, setPickKind] = useState(null); // null | "ally" | "pact"
  const [dip, setDip] = useState(null);
  const [dipMsg, setDipMsg] = useState("");
  const [lockedMsg, setLockedMsg] = useState("");
  const [warPick, setWarPick] = useState(null); // null | { step: "country" } | { step: "city", country }
  const [warMsg, setWarMsg] = useState("");
  const [armySub, setArmySub] = useState(null); // null | id підрозділу Армії
  const [droneModel, setDroneModel] = useState("quad");
  const [droneChoose, setDroneChoose] = useState(false);
  const [sniperRun, setSniperRun] = useState(null); // null | { country } — замах
  const [droneRun, setDroneRun] = useState(null); // null | { city, country } — політ дрона
  const [defPick, setDefPick] = useState(false); // вибір власного міста на карті
  const [defCity, setDefCity] = useState(null); // { id, name, rid, key }
  const [defLevel, setDefLevel] = useState(0);
  const [defMsg, setDefMsg] = useState("");
  const [upgMsg, setUpgMsg] = useState("");

  const reloadDip = useCallback(async () => {
    setDip(await loadDiplomacy());
  }, []);
  useEffect(() => {
    if (view === "diplomacy" || view === "army") reloadDip();
  }, [view, reloadDip]);
  useEffect(() => {
    if (!lockedMsg) return undefined;
    const tm = setTimeout(() => setLockedMsg(""), 2400);
    return () => clearTimeout(tm);
  }, [lockedMsg]);
  const country = COUNTRY_MAP[player.countryCode];
  const color = country?.color || "#3b82f6";

  const stats = useMemo(() => {
    const power = {};
    let members = 0;
    for (const p of players || []) {
      power[p.countryCode] = (power[p.countryCode] || 0) + (p.power || 0);
      if (p.countryCode === player.countryCode) members += 1;
    }
    const ranked = Object.keys(power).sort((a, b) => power[b] - power[a]);
    const rank = ranked.indexOf(player.countryCode) + 1;
    let regions = 0;
    for (const rid in nations?.owners || {}) if (nations.owners[rid] === player.countryCode) regions += 1;
    return { power: power[player.countryCode] || 0, members, rank, regions };
  }, [players, nations, player.countryCode]);

  const leader = (players || []).find((p) => p.id === country?.leaderId);

  const openView = (id) => {
    const sec = HQ_SECTIONS.find((x) => x.id === id);
    if (sec?.leaderOnly && !isLeader) {
      cnSfx.error();
      setLockedMsg(`Розділ «${sec.label}» доступний лише лідеру країни`);
      return;
    }
    cnSfx.navSwitch();
    setDipMsg("");
    setUpgMsg("");
    setArmySub(null);
    setDefCity(null);
    setDefMsg("");
    setView(id);
  };
  const goBack = () => {
    if (view === "stats") setView("info");
    else if (view === "army" && armySub) {
      setArmySub(null);
      setDefCity(null);
      setDefMsg("");
    }
    else {
      setArmySub(null);
      setView(null);
    }
  };

  const onPickCountry = async (countryId) => {
    const kind = pickKind;
    setPickKind(null);
    const res = await sendDiplomacyRequest(kind, player.countryCode, countryId);
    if (res.ok) {
      cnSfx.purchase();
      setDipMsg(`✓ Пропозицію надіслано лідеру ${COUNTRY_MAP[countryId]?.name || countryId}`);
    } else {
      cnSfx.error();
      setDipMsg("✗ " + res.reason);
    }
    reloadDip();
  };

  const declareOn = async (city) => {
    const target = warPick?.country;
    setWarPick(null);
    if ((player.power || 0) < WAR_DECLARE_COST) {
      cnSfx.error();
      setWarMsg(`✗ Для оголошення війни потрібно ${fmt(WAR_DECLARE_COST)} Power`);
      return;
    }
    const res = await declareWar2({
      attacker: player.countryCode,
      defender: target,
      city,
      owners: nations?.owners,
      cityOwners: nations?.cityOwners,
      players,
      immune: isSuperAdmin() && !!player.timeImmunity,
      selfId: player.id,
    });
    if (res.ok) {
      cnSfx.purchase();
      setWarMsg("");
      onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, power: Math.max(0, (prev.power || 0) - WAR_DECLARE_COST) }));
      onWarDeclared && onWarDeclared(res.war);
    } else {
      cnSfx.error();
      setWarMsg("✗ " + res.reason);
    }
  };

  const buyUpgrade = (id) => {
    const u = UPGRADES.find((x) => x.id === id);
    const lvl = upgLevel(player, id);
    if (!u || lvl >= UPG_MAX_LEVEL) return;
    const price = u.prices[lvl];
    if ((player.points || 0) < price) {
      cnSfx.error();
      setUpgMsg(`✗ Недостатньо Points: потрібно ${fmt(price)}`);
      return;
    }
    onUpdatePlayer &&
      onUpdatePlayer((prev) => {
        if ((prev.points || 0) < price || upgLevel(prev, id) !== lvl) return prev;
        return { ...prev, points: prev.points - price, upg: { ...(prev.upg || {}), [id]: lvl + 1 } };
      });
    cnSfx.purchase();
    setUpgMsg(`✓ «${u.title}»: рівень ${lvl + 1} відкрито`);
  };

  const pickDefCity = (city) => {
    setDefPick(false);
    setDefCity(city);
    setDefMsg("");
    setDefLevel(0);
    getCityDefLevel(city.key).then(setDefLevel).catch(() => {});
  };

  const upgradeDef = async () => {
    if (!defCity) return;
    const lvl = await getCityDefLevel(defCity.key);
    setDefLevel(lvl);
    const fail = (t) => {
      cnSfx.error();
      setDefMsg("✗ " + t);
    };
    if (lvl >= UPG_MAX_LEVEL) return fail("Оборона міста вже на максимальному рівні");
    const owner = (nations?.cityOwners || {})[defCity.key] || nations?.owners?.[defCity.rid];
    if (owner !== player.countryCode) return fail("Це місто більше не належить твоїй країні");
    if (war && war.status !== "ended" && war.cityKey === defCity.key) return fail("Під час війни за місто оборону покращувати не можна");
    if (lvl + 1 > upgLevel(player, "cdef")) return fail(`Спершу відкрий рівень ${lvl + 1} «Оборона міста» у розділі «Покращення» (за Points)`);
    if ((player.power || 0) < CITY_DEF_UPGRADE_COST) return fail(`Потрібно ${fmt(CITY_DEF_UPGRADE_COST)} Power`);
    await storageSet(CITY_DEF_PREFIX + defCity.key, String(lvl + 1), true);
    onUpdatePlayer && onUpdatePlayer((prev) => ((prev.power || 0) >= CITY_DEF_UPGRADE_COST ? { ...prev, power: prev.power - CITY_DEF_UPGRADE_COST } : prev));
    cnSfx.purchase();
    setDefLevel(lvl + 1);
    setDefMsg(`✓ Оборону міста ${defCity.name} покращено до рівня ${lvl + 1}`);
  };

  if (view === "army" && droneChoose && !droneRun) {
    const art = {
      quad: <svg viewBox="0 0 100 60" width="100%" height="100%"><g stroke="#20252b" strokeWidth="3" strokeLinecap="round"><path d="M50 30L18 14M50 30L82 14M50 30L18 46M50 30L82 46" /></g><g fill="#9fb4c8" opacity=".7"><ellipse cx="18" cy="14" rx="13" ry="4" /><ellipse cx="82" cy="14" rx="13" ry="4" /><ellipse cx="18" cy="46" rx="13" ry="4" /><ellipse cx="82" cy="46" rx="13" ry="4" /></g><ellipse cx="50" cy="30" rx="11" ry="8" fill="#2f3640" /><circle cx="50" cy="33" r="2.5" fill="#ff3b30" /></svg>,
      shahed: <svg viewBox="0 0 100 60" width="100%" height="100%"><path d="M50 4L92 52L8 52Z" fill="#d9d2bf" stroke="#8d8672" strokeWidth="1.5" /><rect x="45" y="14" width="10" height="34" rx="4" fill="#ece6d4" /><path d="M45 16Q50 2 55 16Z" fill="#2f6fd6" /><rect x="6" y="40" width="3" height="14" fill="#9b9482" /><rect x="91" y="40" width="3" height="14" fill="#9b9482" /></svg>,
      bayraktar: <svg viewBox="0 0 100 60" width="100%" height="100%"><path d="M4 34L48 26L48 32L4 38Z" fill="#b8bec6" /><path d="M96 34L52 26L52 32L96 38Z" fill="#b8bec6" /><rect x="46" y="10" width="8" height="40" rx="4" fill="#dfe3e7" /><path d="M46 50L36 58L38 52ZM54 50L64 58L62 52Z" fill="#a2a9b1" /></svg>,
    };
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "linear-gradient(#0d1b2a,#16283d)", color: "#fff", display: "flex", flexDirection: "column", padding: "18px 16px", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Обери дрон</div>
          <button onClick={() => { cnSfx.navSwitch(); setDroneChoose(false); }} style={{ background: "rgba(255,255,255,.12)", border: 0, color: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 15 }}>✕</button>
        </div>
        {Object.values(DRONE_MODELS).map((m) => (
          <button key={m.id} onClick={() => { cnSfx.navSwitch(); setDroneModel(m.id); setDroneChoose(false); setWarPick({ step: "country", drone: true }); }}
            style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", marginBottom: 12, padding: 12, borderRadius: 16, border: droneModel === m.id ? "2px solid #5ec2ff" : "2px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.07)", color: "#fff" }}>
            <div style={{ width: 110, height: 70, flex: "none", background: "linear-gradient(#6fb1f0,#8cc4f5)", borderRadius: 12, padding: 6 }}>{art[m.id]}</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{m.name}</div>
              <div style={{ fontSize: 13, opacity: 0.8, marginTop: 3 }}>{m.desc}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }

  if (view === "army" && sniperRun) {
    return (
      <SniperGame
        country={COUNTRY_MAP[sniperRun.country]?.name || ""}
        color={COUNTRY_MAP[sniperRun.country]?.color || ""}
        onClose={(ok) => {
          const n = COUNTRY_MAP[sniperRun.country]?.name || "";
          setSniperRun(null);
          setWarMsg(ok ? `✓ Замах на лідера країни ${n} вдався` : `Замах на лідера країни ${n} не вдався`);
        }}
      />
    );
  }

  if (view === "army" && droneRun) {
    return (
      <DroneGame
        model={droneModel}
        city={droneRun.city}
        targetName={droneRun.country ? COUNTRY_MAP[droneRun.country]?.name : ""}
        onClose={(ok) => {
          const c = droneRun.city;
          setDroneRun(null);
          setWarMsg(ok ? `✓ Дрон влучив у ціль у місті ${c.name}` : "Дрон не влучив у ціль");
        }}
      />
    );
  }

  if (view === "army" && defPick) {
    return (
      <div className="cn-hq" style={{ "--hq": color }}>
        <MapScreen
          players={players}
          me={player}
          loading={false}
          onRefresh={onRefreshData || (() => {})}
          nations={nations}
          lang={lang}
          dip={dip}
          pick={{
            step: "city",
            country: player.countryCode,
            label: "Обери своє місто для оборони",
            cityBtn: (n) => `🛡️ Обрати ${n}`,
            hint: "Обери місто своєї країни",
            onPickCity: pickDefCity,
            onCancel: () => setDefPick(false),
          }}
        />
      </div>
    );
  }

  if (view === "army" && warPick) {
    return (
      <div className="cn-hq" style={{ "--hq": color }}>
        <MapScreen
          players={players}
          me={player}
          loading={false}
          onRefresh={onRefreshData || (() => {})}
          nations={nations}
          lang={lang}
          dip={dip}
          pick={{
            step: warPick.step,
            country: warPick.country,
            label: warPick.sniper
              ? "Обери країну для замаху"
              : warPick.drone
              ? (warPick.step === "country" ? "Обери країну для удару дроном" : "Обери місто для удару дроном")
              : warPick.step === "country" ? "Обери країну, на яку нападаєш" : "Обери місто для атаки",
            onPick: (cid) => {
              if (warPick.sniper) {
                if (cid === player.countryCode) { cnSfx.error(); setWarMsg("✗ Не можна робити замах у власній країні"); setWarPick(null); return; }
                setWarPick(null); cnSfx.navSwitch(); setSniperRun({ country: cid });
                return;
              }
              if (warPick.drone) {
                if (cid === player.countryCode) { cnSfx.error(); setWarMsg("✗ Не можна бити по власній країні"); setWarPick(null); return; }
                setWarPick({ step: "city", country: cid, drone: true });
                return;
              }
              const block = attackBlockReason(dip, player.countryCode, cid);
              if (block) {
                cnSfx.error();
                setWarMsg("✗ " + block);
                setWarPick(null);
                return;
              }
              setWarPick({ step: "city", country: cid });
            },
            onPickCity: (city) => {
              if (warPick.drone) { const country = warPick.country; setWarPick(null); cnSfx.navSwitch(); setDroneRun({ city, country }); return; }
              declareOn(city);
            },
            onCancel: () => setWarPick(null),
          }}
        />
      </div>
    );
  }

  if (view === "diplomacy" && pickKind) {
    return (
      <div className="cn-hq" style={{ "--hq": color }}>
        <MapScreen
          players={players}
          me={player}
          loading={false}
          onRefresh={onRefreshData || (() => {})}
          nations={nations}
          lang={lang}
          dip={dip}
          pick={{
            label: pickKind === "ally" ? "Обери країну для союзу" : "Обери країну для пакту про ненапад",
            onPick: onPickCountry,
            onCancel: () => setPickKind(null),
          }}
        />
      </div>
    );
  }

  if (view === "mail") {
    return (
      <div className="cn-hq" style={{ "--hq": color }}>
        <MailScreen
          me={player}
          mail={mail}
          onBack={() => setView(null)}
          onRefresh={onRefreshMail || (() => {})}
          onRefreshGameData={onRefreshData}
        />
      </div>
    );
  }

  if (view) {
    const section = [...HQ_SECTIONS, ...HQ_SUB].find((s) => s.id === view);
    const armySubInfo = view === "army" ? ARMY_SUBS.find((x) => x.id === armySub) : null;
    const title = armySubInfo ? armySubInfo.label : section?.label;
    const Icon = section?.Icon;
    return (
      <div className="cn-hq" style={{ "--hq": color }}>
        <div className="cn-hq-subhead">
          <button className="cn-refresh-btn" type="button" onClick={goBack} aria-label="Назад">
            <ArrowLeft size={16} />
          </button>
          <div className="cn-screen-title">{title}</div>
        </div>
        {view === "army" ? (
          <ArmyPanel
            war={war}
            msg={warMsg}
            sub={armySub}
            onSub={(id) => { cnSfx.navSwitch(); setArmySub(id); }}
            player={player}
            defCity={defCity}
            defLevel={defLevel}
            defMsg={defMsg}
            onPickDefCity={() => { cnSfx.navSwitch(); setDefMsg(""); setDefPick(true); }}
            onUpgradeDef={upgradeDef}
            onSniper={() => { cnSfx.navSwitch(); setWarMsg(""); setWarPick({ step: "country", sniper: true }); }}
            onLaunchDrone={() => { cnSfx.navSwitch(); setWarMsg(""); setDroneChoose(true); }}
            onDeclare={async () => {
              setWarMsg("");
              if ((player.power || 0) < WAR_DECLARE_COST) {
                cnSfx.error();
                setWarMsg(`✗ Для оголошення війни потрібно ${fmt(WAR_DECLARE_COST)} Power`);
                return;
              }
              setDip(await loadDiplomacy());
              setWarPick({ step: "country" });
            }}
          />
        ) : view === "dev" ? (
          <UpgradesPanel player={player} msg={upgMsg} onBuy={buyUpgrade} />
        ) : view === "info" ? (
          <InfoPanel
            country={country}
            leader={leader}
            stats={stats}
            unreadCount={unreadCount}
            onOpen={(id) => { cnSfx.navSwitch(); setView(id); }}
          />
        ) : view === "stats" ? (
          <CountryStatsPanel stats={stats} />
        ) : view === "diplomacy" ? (
          <DiplomacyPanel
            me={player}
            dip={dip}
            msg={dipMsg}
            onStartPick={(k) => { setDipMsg(""); setPickKind(k); }}
            onBreak={async (kind, other) => {
              await breakDiplomacy(kind, player.countryCode, other);
              setDipMsg(`✓ ${DIP_KIND[kind].title} з ${COUNTRY_MAP[other]?.name || other} розірвано. 4 години нападати заборонено.`);
              reloadDip();
              onRefreshData && onRefreshData();
            }}
          />
        ) : view === "settings" ? (
          <ControlPanel
            player={player}
            isLeader={isLeader}
            countries={nations?.countries}
            onChangeCountryColor={onChangeCountryColor}
          />
        ) : (
          <div className="cn-hq-wip">
            <div className="cn-hq-wip-icon"><Icon size={34} /></div>
            <div className="cn-hq-wip-title">{section?.soon ? "Скоро" : "У розробці"}</div>
            <div className="cn-hq-wip-text">{section?.text}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cn-hq" style={{ "--hq": color }}>
      <div className="cn-hq-top">
        <div className="cn-hq-title">
          <span className="cn-hq-kicker">ШТАБ</span>
          <span className="cn-hq-name">{country?.name || "Країна"}</span>
        </div>
        {leader && (
          <span className="cn-hq-leader"><Crown size={12} /> <Nick p={leader} /></span>
        )}
      </div>

      <div className="cn-hq-stage">
        <div className="cn-hq-hero">
          <svg className="cn-hq-radar" viewBox="0 0 200 200" aria-hidden="true">
            <defs>
              <radialGradient id="cn-hq-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--hq)" stopOpacity="0.55" />
                <stop offset="70%" stopColor="var(--hq)" stopOpacity="0.12" />
                <stop offset="100%" stopColor="var(--hq)" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="cn-hq-sweep" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--hq)" stopOpacity="0" />
                <stop offset="100%" stopColor="var(--hq)" stopOpacity="0.55" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r="98" fill="url(#cn-hq-core)" />
            <circle cx="100" cy="100" r="92" className="cn-hq-ring" />
            <circle cx="100" cy="100" r="68" className="cn-hq-ring cn-hq-ring--dash" />
            <circle cx="100" cy="100" r="44" className="cn-hq-ring" />
            {Array.from({ length: 24 }).map((_, i) => (
              <line key={i} x1="100" y1="6" x2="100" y2={i % 6 === 0 ? 16 : 11} className="cn-hq-tick" transform={`rotate(${i * 15} 100 100)`} />
            ))}
            <g className="cn-hq-sweep-g">
              <path d="M100 100 L100 8 A92 92 0 0 1 178 54 Z" fill="url(#cn-hq-sweep)" />
            </g>
          </svg>
          <div className="cn-hq-core">
            <Shield size={46} strokeWidth={1.6} />
            <span className="cn-hq-core-label">{country?.name}</span>
          </div>
        </div>
      </div>

      <div className="cn-hq-chips">
        <div className="cn-hq-chip"><span>Сила</span><b>{fmt(stats.power)}</b></div>
        <div className="cn-hq-chip"><span>Області</span><b>{fmt(stats.regions)}</b></div>
        <div className="cn-hq-chip"><span>Місце</span><b>#{stats.rank || "—"}</b></div>
        <div className="cn-hq-chip"><span>Гравці</span><b>{fmt(stats.members)}</b></div>
      </div>

      <div className="cn-hq-grid">
        {HQ_SECTIONS.map((s) => {
          const locked = s.leaderOnly && !isLeader;
          const soon = !!s.soon;
          return (
            <button
              key={s.id}
              type="button"
              data-tut={"hq-" + s.id}
              className={"cn-hq-tile cn-hq-tile--third" + (locked ? " cn-hq-tile--locked" : "")}
              onClick={() => openView(s.id)}
            >
              <span className="cn-hq-tile-icon"><s.Icon size={21} /></span>
              <span className="cn-hq-tile-label">{s.label}</span>
              {locked && <Lock size={12} className="cn-hq-lock" />}
              {!locked && soon && <span className="cn-hq-soon cn-hq-soon--tile">Скоро</span>}
              {s.id === "mail" && unreadCount > 0 && <span className="cn-hq-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
          );
        })}
      </div>
      {lockedMsg && <div className="cn-hq-toast">{lockedMsg}</div>}
    </div>
  );
}



/* Плитка-рядок для меню розділів Армії/Економіки */
function HqRowTile({ Icon, label, hint, onClick, badge }) {
  return (
    <button type="button" className="cn-hq-tile cn-tw-tile" onClick={onClick}>
      <span className="cn-hq-tile-icon"><Icon size={21} /></span>
      <span className="cn-tw-tile-text">
        <span className="cn-hq-tile-label">{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      {badge != null && <span className="cn-tw-badge">{badge}</span>}
      <ChevronRight size={16} className="cn-tw-chev" />
    </button>
  );
}

/* Армія (лише лідер): Оголосити війну та Оборона міста */
function ArmyPanel({ war, msg, onDeclare, onLaunchDrone, onSniper, sub, onSub, player, defCity, defLevel, defMsg, onPickDefCity, onUpgradeDef }) {
  const phase = war ? warPhase(war) : null;
  if (sub === "defense") {
    const unlocked = upgLevel(player, "cdef");
    const maxed = defLevel >= UPG_MAX_LEVEL;
    const needUnlock = !maxed && defLevel + 1 > unlocked;
    return (
      <div className="cn-dip-menu">
        {defMsg && <div className="cn-dev-status-msg">{defMsg}</div>}
        <HqRowTile Icon={Shield} label={defCity ? "Обрати інше місто" : "Обрати місто на карті"} hint="Обери своє місто, щоб покращити його оборону" onClick={onPickDefCity} />
        <div className="cn-tw-line">Відкрито рівнів у «Покращення»: <b>{unlocked}/{UPG_MAX_LEVEL}</b></div>
        {defCity && (
          <div className="cn-def-card">
            <div className="cn-def-city">{defCity.name}</div>
            <div className="cn-def-lvl">Рівень оборони <b>{defLevel}/{UPG_MAX_LEVEL}</b></div>
            <div className="cn-dip-list">
              <div className="cn-dip-row"><div className="cn-dip-row-name">Поточний поріг захоплення</div><b className="cn-tw-hp-num">{fmt(CITY_DEF_THRESHOLDS[defLevel])}</b></div>
              {!maxed && <div className="cn-dip-row"><div className="cn-dip-row-name">Наступний рівень</div><b className="cn-tw-hp-num">{fmt(CITY_DEF_THRESHOLDS[defLevel + 1])}</b></div>}
            </div>
            {maxed ? (
              <div className="cn-dip-sub" style={{ textAlign: "center" }}>Максимальний рівень оборони</div>
            ) : (
              <>
                <button type="button" className="cn-primary-btn cn-map-pick-btn" disabled={needUnlock} onClick={onUpgradeDef} style={needUnlock ? { opacity: 0.5 } : undefined}>
                  <span className="cn-primary-btn-label">Покращити до рівня {defLevel + 1} · {fmt(CITY_DEF_UPGRADE_COST)} Power</span>
                </button>
                {needUnlock && <div className="cn-dip-sub" style={{ textAlign: "center" }}>Спершу відкрий рівень {defLevel + 1} «Оборона міста» у розділі «Покращення» за Points.</div>}
              </>
            )}
          </div>
        )}
        <div className="cn-dip-sub">Поріг захоплення — скільки балансу кліків має набрати атакуюча сторона, щоб узяти місто. Після захоплення оборона міста скидається.</div>
      </div>
    );
  }
  return (
    <div className="cn-dip-menu">
      {msg && <div className="cn-dev-status-msg">{msg}</div>}
      {war ? (
        <div className="cn-warhud cn-warhud--prep">
          <div className="cn-warhud-kicker"><Swords size={14} /> {phase === "battle" ? "ЙДЕ БИТВА" : "ВІЙНА ТРИВАЄ"}</div>
          <div className="cn-warhud-city">За місто <b>{war.cityName}</b></div>
          <div className="cn-dip-sub" style={{ textAlign: "center" }}>
            {COUNTRY_MAP[war.attacker]?.name} проти {COUNTRY_MAP[war.defender]?.name}. Стеж за ходом битви в розділі «Клікер».
          </div>
        </div>
      ) : (
        <button type="button" className="cn-warhud-declare" onClick={() => { cnSfx.navSwitch(); onDeclare(); }}>
          <span className="cn-hq-tile-icon"><Swords size={22} /></span>
          <span className="cn-warhud-declare-text">
            <b>Оголосити війну · {fmt(WAR_DECLARE_COST)} Power</b>
            <small>Обери країну й місто на карті. 10 хвилин підготовки, далі година битви.</small>
          </span>
        </button>
      )}
      <HqRowTile Icon={Target} label="Замах" hint="Снайпер на даху: дочекайся лідера й влуч" onClick={onSniper} />
      <HqRowTile Icon={Crosshair} label="Запустити дрон" hint="Обери місто й сам керуй дроном у 3D" onClick={onLaunchDrone} />
      {ARMY_SUBS.map((x) => (
        <HqRowTile key={x.id} Icon={x.Icon} label={x.label} hint="Покращення оборони твоїх міст" onClick={() => onSub(x.id)} />
      ))}
      <div className="cn-dip-sub">Правила: кліки всіх гравців країн-учасниць під час битви йдуть на шкалу. Атака має набрати баланс (кліки атаки мінус кліки захисту), що дорівнює порогу захоплення міста (від {fmt(CITY_DEF_THRESHOLDS[0])} до {fmt(CITY_DEF_THRESHOLDS[UPG_MAX_LEVEL])} залежно від оборони) за годину, інакше місто лишається в захисника.</div>
    </div>
  );
}

/* Покращення за Points: енергія та оборона міста */
function UpgradesPanel({ player, msg, onBuy }) {
  const roman = ["I", "II", "III", "IV", "V"];
  return (
    <div className="cn-dip-menu">
      {msg && <div className="cn-dev-status-msg">{msg}</div>}
      <div className="cn-tw-line">Мої Points: <b>{fmt(player.points || 0)}</b></div>
      {UPGRADES.map((u, ui) => {
        const lvl = upgLevel(player, u.id);
        const total = u.prices.reduce((a, b) => a + b, 0);
        const next = lvl < UPG_MAX_LEVEL ? u.prices[lvl] : null;
        return (
          <div className="cn-upg" key={u.id}>
            <div className="cn-upg-title">{ui + 1}. {u.title}</div>
            <div className="cn-upg-table">
              <div className="cn-upg-row cn-upg-row--head"><span>Рівень</span><span>Ціна в Points</span><span>{u.colLabel}</span></div>
              <div className="cn-upg-row cn-upg-row--done"><span>База</span><span>—</span><span>{u.fmtVal(u.base).replace(/^(\d+)$/, (m) => fmt(Number(m)))}</span></div>
              {u.prices.map((pr, i) => (
                <div key={i} className={"cn-upg-row" + (i < lvl ? " cn-upg-row--done" : i === lvl ? " cn-upg-row--next" : "")}>
                  <span>{roman[i]}{i < lvl ? " ✓" : ""}</span>
                  <span>{fmt(pr)}</span>
                  <span>{u.id === "ereg" ? u.fmtVal(u.values[i]) : fmt(u.values[i])}</span>
                </div>
              ))}
            </div>
            <div className="cn-upg-total">Загальна вартість: <b>{fmt(total)} Points</b></div>
            {next != null ? (
              <button type="button" className="cn-primary-btn cn-map-pick-btn" onClick={() => onBuy(u.id)} style={(player.points || 0) < next ? { opacity: 0.55 } : undefined}>
                <span className="cn-primary-btn-label">Відкрити рівень {roman[lvl]} · {fmt(next)} Points</span>
              </button>
            ) : (
              <div className="cn-dip-sub" style={{ textAlign: "center" }}>Усі рівні відкрито</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* Інформація: Пошта, Статистика та коротко про країну */
function InfoPanel({ country, leader, stats, unreadCount, onOpen }) {
  return (
    <div className="cn-dip-menu">
      <HqRowTile Icon={BarChart2} label="Статистика" onClick={() => onOpen("stats")} />
      <div className="cn-dip-list">
        <div className="cn-dip-row"><div className="cn-dip-row-name">Країна</div><b className="cn-tw-hp-num">{country?.name || "—"}</b></div>
        <div className="cn-dip-row"><div className="cn-dip-row-name">Лідер</div><b className="cn-tw-hp-num">{leader?.username || "—"}</b></div>
        <div className="cn-dip-row"><div className="cn-dip-row-name">Гравців</div><b className="cn-tw-hp-num">{fmt(stats.members)}</b></div>
      </div>
    </div>
  );
}

/* Статистика країни */
function CountryStatsPanel({ stats }) {
  const rows = [
    ["Сила країни", fmt(stats.power)],
    ["Місце у світі", "#" + (stats.rank || "—")],
    ["Області", fmt(stats.regions)],
    ["Гравці", fmt(stats.members)],
  ];
  return (
    <div className="cn-dip-list">
      {rows.map(([l, v]) => (
        <div className="cn-dip-row" key={l}><div className="cn-dip-row-name">{l}</div><b className="cn-tw-hp-num">{v}</b></div>
      ))}
    </div>
  );
}

/* Дипломатія (лише лідер): союзи та пакти про ненапад */
function DiplomacyPanel({ me, dip, msg, onStartPick, onBreak }) {
  const [sub, setSub] = useState(null); // null | "allies" | "pacts"
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const mine = me.countryCode;

  const others = (list) =>
    (list || [])
      .filter((x) => x.a === mine || x.b === mine)
      .map((x) => (x.a === mine ? x.b : x.a))
      .filter((c) => COUNTRY_MAP[c]);

  const doBreak = async (kind, other) => {
    const id = kind + other;
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setBusy(true);
    await onBreak(kind, other);
    setConfirmId(null);
    setBusy(false);
  };

  const truces = Object.entries(dip?.truces || {})
    .filter(([id, until]) => until > Date.now() && id.split("~").includes(mine))
    .map(([id, until]) => ({ other: id.split("~").find((c) => c !== mine), until }))
    .filter((x) => COUNTRY_MAP[x.other]);

  const renderList = (kind) => {
    const list = others(kind === "ally" ? dip?.allies : dip?.pacts);
    return (
      <div className="cn-dip-list">
        {!dip && <div className="cn-lb-empty">Завантаження…</div>}
        {dip && list.length === 0 && (
          <div className="cn-lb-empty">{kind === "ally" ? "Союзників поки немає" : "Підписаних пактів поки немає"}</div>
        )}
        {list.map((c) => (
          <div className="cn-dip-row" key={c}>
            <Flag code={c} size={22} className="cn-country-badge--lg" />
            <div className="cn-dip-row-name">{COUNTRY_MAP[c].name}</div>
            <button
              className={"cn-dev-btn cn-dev-btn--danger" + (confirmId === kind + c ? " cn-dev-btn--confirm" : "")}
              type="button"
              disabled={busy}
              onClick={() => doBreak(kind, c)}
            >
              {confirmId === kind + c ? "Підтвердити" : "Розірвати"}
            </button>
          </div>
        ))}
        {list.length > 0 && <div className="cn-dip-sub">Після розриву нападати на цю країну заборонено ще 4 години.</div>}
      </div>
    );
  };

  if (sub) {
    return (
      <div className="cn-dip-menu">
        <button className="cn-dev-btn" type="button" onClick={() => { setSub(null); setConfirmId(null); }} style={{ alignSelf: "flex-start" }}>
          <ArrowLeft size={13} /> {sub === "allies" ? "Список союзників" : "Договори"}
        </button>
        {msg && <div className="cn-dev-status-msg">{msg}</div>}
        {renderList(sub === "allies" ? "ally" : "pact")}
      </div>
    );
  }

  const items = [
    { id: "allies", label: "Список союзників", Icon: Users, run: () => setSub("allies") },
    { id: "pacts", label: "Договори", Icon: ShieldCheck, run: () => setSub("pacts") },
    { id: "ally", label: "Підписати союз", Icon: Handshake, run: () => onStartPick("ally") },
    { id: "pact", label: "Підписати пакт про ненапад", Icon: Ban, run: () => onStartPick("pact") },
  ];
  return (
    <div className="cn-dip-menu">
      {msg && <div className="cn-dev-status-msg">{msg}</div>}
      {items.map((it) => (
        <button key={it.id} type="button" className="cn-hq-tile" onClick={() => { cnSfx.navSwitch(); it.run(); }}>
          <span className="cn-hq-tile-icon"><it.Icon size={21} /></span>
          <span className="cn-hq-tile-label">{it.label}</span>
        </button>
      ))}
      {truces.length > 0 && (
        <div className="cn-dip-list">
          <div className="cn-dip-sub">Заборона нападу після розриву:</div>
          {truces.map((x) => (
            <div className="cn-dip-row" key={x.other}>
              <Flag code={x.other} size={22} className="cn-country-badge--lg" />
              <div className="cn-dip-row-name">{COUNTRY_MAP[x.other].name}</div>
              <span className="cn-dip-sub">ще {fmtDuration(x.until - Date.now())}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Control Panel (поки що лише колір країни на карті)                  */
/* ------------------------------------------------------------------ */

function ControlPanel({ player, isLeader, countries, onChangeCountryColor }) {
  const country = COUNTRY_MAP[player.countryCode];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  const takenByOthers = useMemo(
    () => new Set((countries || []).filter((c) => c.id !== player.countryCode).map((c) => c.color)),
    [countries, player.countryCode]
  );
  const current = country?.color;

  const pick = async (color) => {
    if (!isLeader || busy || color === current || takenByOthers.has(color)) return;
    setBusy(true);
    setMsg(null);
    const res = await onChangeCountryColor(color);
    if (res.ok) cnSfx.claim();
    else cnSfx.error();
    setMsg(res.ok ? { ok: true, text: "Колір країни змінено" } : { ok: false, text: res.reason || "Не вдалося змінити колір" });
    setBusy(false);
  };

  return (
    <div className="cn-control-panel">
      <div className="cn-control-header">
        <Flag code={player.countryCode} size={56} className="cn-country-badge--lg" />
        <div className="cn-control-header-text">
          <div className="cn-control-header-country">{country?.name || "Країна"}</div>
          <div className="cn-control-header-power">
            Баланс: <span className="cn-control-header-power-value">{fmt(player.power)} Power</span>
          </div>
        </div>
      </div>

      <div className="cn-color-section">
        <div className="cn-color-title">
          <Palette size={16} /> Колір країни на карті
        </div>
        <div className="cn-control-hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="cn-country-badge" style={{ width: 18, height: 18, background: current }} />
          Колір призначається автоматично, щоб сусідні країни завжди відрізнялись.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  News                                                                */
/* ------------------------------------------------------------------ */

function NewsModal({ news, onClose }) {
  const close = () => { cnSfx.modalClose(); onClose(); };
  return <NewsBroadcast news={news} onClose={close} timeAgo={timeAgo} />;
}

/* ------------------------------------------------------------------ */
/*  Leaderboard screen                                                  */
/* ------------------------------------------------------------------ */

function LeaderboardScreen({ me, players, loading, onRefresh, onBack, lang = "uk" }) {
  const [mode, setMode] = useState("countries"); // countries | global | mycountry

  const countriesRanked = useMemo(() => {
    const map = {};
    for (const p of players) {
      map[p.countryCode] = (map[p.countryCode] || 0) + (p.power || 0);
    }
    return COUNTRIES.map((c) => ({ ...c, power: map[c.code] || 0 })).sort((a, b) => b.power - a.power);
  }, [players, countriesRev]); // eslint-disable-line react-hooks/exhaustive-deps

  const globalRanked = useMemo(() => {
    return [...players].sort((a, b) => (b.power || 0) - (a.power || 0));
  }, [players]);

  const countryRanked = useMemo(() => {
    return globalRanked.filter((p) => p.countryCode === me.countryCode);
  }, [globalRanked, me.countryCode]);

  return (
    <div className="cn-lb">
      <div className="cn-lb-header">
        {onBack && (
          <button className="cn-refresh-btn" onClick={onBack} type="button" aria-label="Назад" style={{ marginRight: 8 }}>
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="cn-screen-title" style={{ flex: 1 }}>{t(lang, "nav_leaderboard")}</div>
        <button className="cn-refresh-btn" onClick={onRefresh} type="button" aria-label="Refresh">
          <RefreshCw size={16} className={loading ? "cn-spin" : ""} />
        </button>
      </div>

      <div className="cn-segmented">
        <button
          className={"cn-seg-btn" + (mode === "countries" ? " cn-seg-btn--active" : "")}
          onClick={() => setMode("countries")}
        >
          {t(lang, "lb_countries")}
        </button>
        <button
          className={"cn-seg-btn" + (mode === "global" ? " cn-seg-btn--active" : "")}
          onClick={() => setMode("global")}
        >
          {t(lang, "lb_players")}
        </button>
        <button
          className={"cn-seg-btn" + (mode === "mycountry" ? " cn-seg-btn--active" : "")}
          onClick={() => setMode("mycountry")}
        >
          {t(lang, "lb_mycountry")}
        </button>
      </div>

      {loading && players.length === 0 ? (
        <LoadingScreen lang={lang} variant="block" size="sm" title={false} tips={false} stage={t(lang, "lb_loading")} />
      ) : mode === "countries" ? (
        <CountryList list={countriesRanked} myCountry={me.countryCode} />
      ) : mode === "global" ? (
        <PlayerList list={globalRanked} meId={me.id} lang={lang} />
      ) : (
        <PlayerList list={countryRanked} meId={me.id} lang={lang} />
      )}
    </div>
  );
}

function rankClass(rank) {
  if (rank === 1) return " cn-rank--1";
  if (rank === 2) return " cn-rank--2";
  if (rank === 3) return " cn-rank--3";
  return "";
}

function CountryList({ list, myCountry }) {
  return (
    <div className="cn-list cn-list--dense">
      {list.map((c, i) => {
        const rank = i + 1;
        const isMine = c.code === myCountry;
        return (
          <div key={c.code} className={"cn-row cn-row--light" + (isMine ? " cn-row--mine" : "")}>
            <span className={"cn-row-rank" + rankClass(rank)}>{rank}</span>
            <Flag code={c.code} size={20} className="cn-row-flag" />
            <span className="cn-row-name">{c.name}</span>
            <span className="cn-row-value">{fmt(c.power)}</span>
          </div>
        );
      })}
    </div>
  );
}

function LbAvatar({ player }) {
  const icon = iconById(player.equippedIcon);
  const premium = !!player.hasPremiumPass;
  return (
    <span className={"cn-lb-avatar" + (premium ? " cn-lb-avatar--premium" : "")}>
      <span className="cn-lb-avatar-inner">
        {icon ? <ProfileIconGlyph opt={icon} size={30} /> : <User size={16} />}
      </span>
      {premium && <Crown size={11} className="cn-lb-avatar-crown" />}
    </span>
  );
}

const NICK_COLORS = [
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
function Nick({ p, children }) {
  const st = nickFxStyle(p);
  const text = children !== undefined ? children : p?.username;
  if (!st) return <>{text}</>;
  return <span className="cn-nick-fx" style={st}>{text}</span>;
}

function PlayerRow({ p, rank, isMine, country }) {
  const banner = bannerById(p.equippedBanner);
  return (
    <div
      className={
        "cn-row cn-row--player" +
        (isMine ? " cn-row--mine" : "") +
        (p.hasPremiumPass ? " cn-row--premium" : "") +
        (banner ? " cn-row--banner" : "")
      }
      style={
        banner
          ? { backgroundImage: `linear-gradient(180deg, rgba(6,10,18,0) 40%, rgba(6,10,18,0.88) 100%), url(${banner.img})` }
          : undefined
      }
    >
      <span className={"cn-row-rank" + rankClass(rank)}>{rank}</span>
      <LbAvatar player={p} />
      <Flag code={country?.code} size={16} className="cn-row-flag" />
      <span className="cn-row-name"><Nick p={p} /></span>
      <span className="cn-row-value">{fmt(p.power)}</span>
    </div>
  );
}

function PlayerList({ list, meId, lang = "uk" }) {
  const TOP_N = 30;
  const myIndex = list.findIndex((p) => p.id === meId);
  const top = list.slice(0, TOP_N);
  const meInTop = myIndex >= 0 && myIndex < TOP_N;
  const mePlayer = myIndex >= 0 ? list[myIndex] : null;

  if (list.length === 0) {
    return <div className="cn-lb-empty">{t(lang, "lb_empty")}</div>;
  }

  return (
    <div className="cn-list">
      {top.map((p, i) => {
        const rank = i + 1;
        const isMine = p.id === meId;
        const country = COUNTRY_MAP[p.countryCode];
        return <PlayerRow key={p.id} p={p} rank={rank} isMine={isMine} country={country} />;
      })}
      {!meInTop && mePlayer && (
        <>
          <div className="cn-row-divider">•••</div>
          <PlayerRow
            p={mePlayer}
            rank={myIndex + 1}
            isMine
            country={COUNTRY_MAP[mePlayer.countryCode]}
          />
        </>
      )}
    </div>
  );
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
const SEASON_BANNER_IMG = "/img/season-banner-img.jpg";
const BANNER_KINGS_VIEW = "/img/banner-kings-view.jpg";
const BANNER_MARCH = "/img/banner-march.jpg";
const BANNER_MEADOW = "/img/banner-meadow.jpg";

const BANNER_OPTIONS = [
  { id: "campfire", img: BANNER_CAMPFIRE, label: "Табір лицарів" },
  { id: "cliffside", img: BANNER_CLIFFSIDE, label: "Замок на скелі" },
  { id: "grand_castle", img: BANNER_GRAND_CASTLE, label: "Королівська фортеця" },
  { id: "kings_view", img: BANNER_KINGS_VIEW, label: "Світанок королівства" },
  { id: "march", img: BANNER_MARCH, label: "Шлях лицаря" },
  { id: "meadow", img: BANNER_MEADOW, label: "Мирна долина" },
];

function bannerById(id) {
  return BANNER_OPTIONS.find((b) => b.id === id) || null;
}

const PROFILE_ICONS = [
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

function iconById(id) {
  return PROFILE_ICONS.find((i) => i.id === id) || null;
}

function isIconUnlocked(me, opt) {
  if (opt.passIcon) return (me.unlockedIcons || []).includes(opt.id);
  return (me.power || 0) >= (opt.req || 0);
}

function ProfileIconGlyph({ opt, size }) {
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

const TITLES = [
  { id: "rookie", label: "Новачок", req: () => true },
  { id: "clicker", label: "Клікер-Активіст", req: (me) => (me.totalClicks || 0) >= 500 },
  { id: "veteran_clicks", label: "Ветеран Кліків", req: (me) => (me.totalClicks || 0) >= 5000 },
  { id: "grinder", label: "Одержимий Кліками", req: (me) => (me.totalClicks || 0) >= 20000 },
  { id: "strong", label: "Сила Нації", req: (me) => (me.power || 0) >= 1000 },
  { id: "elite", label: "Елітний Гравець", req: (me) => (me.power || 0) >= 5000 },
  { id: "legend", label: "Легенда", req: (me) => (me.power || 0) >= 20000 },
  { id: "leader", label: "Лідер Країни", req: (me, ctx) => !!ctx.isLeader },
  { id: "patriot", label: "Патріот", req: (me) => Date.now() - (me.createdAt || Date.now()) >= 7 * 86400000 },
  { id: "top30", label: "Топ-30 Світу", req: (me, ctx) => typeof ctx.globalRank === "number" && ctx.globalRank <= 30 },
  { id: "recruit", label: "Новобранець", req: (me) => (me.unlockedTitles || []).includes("recruit") },
  { id: "peasant", label: "Селянин", req: (me) => (me.unlockedTitles || []).includes("peasant") },
  { id: "warrior", label: "Воїн", req: (me) => (me.unlockedTitles || []).includes("warrior") },
  { id: "knight", label: "Лицар", req: (me) => (me.unlockedTitles || []).includes("knight") },
  { id: "golden_knight", label: "Золотий Лицар", req: (me) => (me.unlockedTitles || []).includes("golden_knight") },
  { id: "prince", label: "Принц", req: (me) => (me.unlockedTitles || []).includes("prince") },
  { id: "king", label: "Король", req: (me) => (me.unlockedTitles || []).includes("king") },
];

function titleById(id) {
  return TITLES.find((t) => t.id === id) || null;
}

const BADGE_ICON_BRONZE1 = "/img/badge-icon-bronze1.webp";
const BADGE_ICON_BRONZE2 = "/img/badge-icon-bronze2.webp";
const BADGE_ICON_BRONZE3 = "/img/badge-icon-bronze3.webp";
const BADGE_ICON_SILVER1 = "/img/badge-icon-silver1.webp";
const BADGE_ICON_SILVER2 = "/img/badge-icon-silver2.webp";
const BADGE_ICON_SILVER3 = "/img/badge-icon-silver3.webp";
const BADGE_ICON_GOLD1 = "/img/badge-icon-gold1.webp";
const BADGE_ICON_GOLD2 = "/img/badge-icon-gold2.webp";
const BADGE_ICON_GOLD3 = "/img/badge-icon-gold3.webp";
const BADGE_ICON_PURPLE1 = "/img/badge-icon-purple1.webp";
const BADGE_ICON_PURPLE2 = "/img/badge-icon-purple2.webp";
const BADGE_ICON_PURPLE3 = "/img/badge-icon-purple3.webp";
const BADGE_ICON_BLUE1 = "/img/badge-icon-blue1.webp";
const BADGE_ICON_BLUE2 = "/img/badge-icon-blue2.webp";
const BADGE_ICON_BLUE3 = "/img/badge-icon-blue3.webp";

const ACHIEVEMENTS = [
  { id: "first_click", label: "Перший клік", desc: "Зроби свій перший клік", icon: BADGE_ICON_BRONZE1, req: (me) => (me.totalClicks || 0) >= 1 },
  { id: "clicks_100", label: "Розігрівся", desc: "Набери 100 кліків", icon: BADGE_ICON_BRONZE2, req: (me) => (me.totalClicks || 0) >= 100 },
  { id: "clicks_1000", label: "На повну", desc: "Набери 1,000 кліків", icon: BADGE_ICON_BRONZE3, req: (me) => (me.totalClicks || 0) >= 1000 },
  { id: "clicks_10000", label: "Машина Кліків", desc: "Набери 10,000 кліків", icon: BADGE_ICON_GOLD1, req: (me) => (me.totalClicks || 0) >= 10000 },
  { id: "power_100", label: "Перша Сила", desc: "Досягни 100 Power", icon: BADGE_ICON_SILVER1, req: (me) => (me.power || 0) >= 100 },
  { id: "power_1000", label: "Зростаюча Сила", desc: "Досягни 1,000 Power", icon: BADGE_ICON_SILVER2, req: (me) => (me.power || 0) >= 1000 },
  { id: "power_10000", label: "Наддержава", desc: "Досягни 10,000 Power", icon: BADGE_ICON_SILVER3, req: (me) => (me.power || 0) >= 10000 },
  { id: "leader_ach", label: "При владі", desc: "Стань лідером країни", icon: BADGE_ICON_GOLD3, req: (me, ctx) => !!ctx.isLeader },
  { id: "week_old", label: "Ветеран Тижня", desc: "Грай понад 7 днів", icon: BADGE_ICON_GOLD2, req: (me) => Date.now() - (me.createdAt || Date.now()) >= 7 * 86400000 },
  { id: "top30_ach", label: "Світова Еліта", desc: "Увійди в топ-30 світу", icon: BADGE_ICON_BLUE3, req: (me, ctx) => typeof ctx.globalRank === "number" && ctx.globalRank <= 30 },
  { id: "pass_badge_1", label: "Перші Кроки Проходу", desc: "Досягни 15 рівня Battle Pass", icon: BADGE_ICON_PURPLE1, req: (me) => (me.unlockedBadges || []).includes("pass_badge_1") },
  { id: "pass_badge_2", label: "Половина Шляху", desc: "Досягни 30 рівня Battle Pass", icon: BADGE_ICON_PURPLE2, req: (me) => (me.unlockedBadges || []).includes("pass_badge_2") },
  { id: "pass_badge_3", label: "Майже На Вершині", desc: "Досягни 45 рівня Battle Pass", icon: BADGE_ICON_PURPLE3, req: (me) => (me.unlockedBadges || []).includes("pass_badge_3") },
  { id: "premium_badge_1", label: "Преміум Розвідник", desc: "Досягни 15 рівня Premium Pass", icon: BADGE_ICON_BLUE1, req: (me) => (me.unlockedBadges || []).includes("premium_badge_1") },
  { id: "premium_badge_2", label: "Преміум Магнат", desc: "Досягни 30 рівня Premium Pass", icon: BADGE_ICON_BLUE2, req: (me) => (me.unlockedBadges || []).includes("premium_badge_2") },
  { id: "premium_badge_3", label: "Тінь Легенди", desc: "Досягни 45 рівня Premium Pass", icon: BADGE_ICON_BLUE3, req: (me) => (me.unlockedBadges || []).includes("premium_badge_3") },
];

function achievementById(id) {
  return ACHIEVEMENTS.find((a) => a.id === id) || null;
}

async function equipField(me, field, value, onSetPlayer) {
  const updated = { ...me, [field]: value };
  await storageSet(PLAYER_PREFIX + me.id, JSON.stringify(updated), true);
  onSetPlayer(updated);
}

const MAX_EQUIPPED_BADGES = 5;

async function toggleBadge(me, id, onSetPlayer) {
  const current = Array.isArray(me.equippedBadges) ? me.equippedBadges : [];
  let next;
  if (current.includes(id)) {
    next = current.filter((x) => x !== id);
  } else {
    if (current.length >= MAX_EQUIPPED_BADGES) return;
    next = [...current, id];
  }
  const updated = { ...me, equippedBadges: next };
  await storageSet(PLAYER_PREFIX + me.id, JSON.stringify(updated), true);
  onSetPlayer(updated);
}

/* ------------------------------------------------------------------ */
/*  Battle Pass / Premium Pass                                         */
/* ------------------------------------------------------------------ */

const PASS_MAX_LEVEL = 50; // рівні 0–50 (51 рівень)
const BATTLE_PASS_LEVELS = PASS_MAX_LEVEL + 1; // кількість рівнів у проході
// Версія проходу = версія сезону. У гравців зі старою версією прогрес і отримані нагороди обнуляються.
const PASS_REV = SEASON_REV;

/* Сумарна кількість кліків сезону, потрібна для рівня N (рівень 0 — 0 кліків). */
const PASS_LEVEL_THRESHOLDS = [
  0, 50, 100, 200, 300, 450, 600, 800, 1000, 1250, 1500, 1850, 2200, 2550, 2950, 3350, 3750, 4200, 4650, 5100, 5600,
  6150, 6700, 7300, 7900, 8500, 9150, 9800, 10450, 11100, 11800, 12500, 13250, 14000, 14750, 15550, 16350, 17150, 18000,
  18850, 19700, 20600, 21500, 22400, 23350, 24300, 25350, 26450, 27600, 28800, 30000,
];

function currentPassLevel(passClicks) {
  const clicks = passClicks || 0;
  let lvl = 0;
  for (let i = 1; i <= PASS_MAX_LEVEL; i++) {
    if (clicks >= PASS_LEVEL_THRESHOLDS[i]) lvl = i;
    else break;
  }
  return lvl;
}

/* Кліки, зараховані в Battle Pass поточного сезону (від моменту початку сезону для гравця). */
function passClicks(me) {
  if (!me || me.passRev !== PASS_REV) return 0;
  return Math.max(0, (me.totalClicks || 0) - (me.passBaseClicks || 0));
}

/* Нагороди, які гравець уже забрав у цьому сезоні. */
function passClaimedList(me, track) {
  if (!me || me.passRev !== PASS_REV) return [];
  return (track === "premium" ? me.passClaimedPremium : me.passClaimedFree) || [];
}

/* Новий сезон: обнуляємо прогрес проходу, відлік кліків іде від поточного значення. */
function migratePass(me) {
  if (!me || me.passRev === PASS_REV) return me;
  return { ...me, passRev: PASS_REV, passBaseClicks: me.totalClicks || 0, passClaimedFree: [], passClaimedPremium: [], points: me.points || 0 };
}

/* Таблиця нагород: [free, premium] для кожного рівня 0–50.
   Типи: p — Points (кількість), t — титул, b — банер профілю, a — аватар (фото профілю).
   Титули, банери й фото профілю поки в розробці: нагорода записується гравцю, а самі розділи з'являться пізніше. */
const PASS_REWARD_TABLE = [
  [["t", "Новобранець"], ["t", "Воїн"]], // 0
  [["p", 1500], ["p", 3000]], // 1
  [["p", 2500], ["p", 5000]], // 2
  [["p", 3000], ["p", 6000]], // 3
  [["p", 3500], ["p", 7000]], // 4
  [["p", 3500], ["p", 7000]], // 5
  [["b", "Мирна долина"], ["b", "Табір лицарів"]], // 6
  [["p", 5000], ["p", 10000]], // 7
  [["p", 5500], ["p", 11000]], // 8
  [["p", 6500], ["p", 13000]], // 9
  [["a", "Новобранець"], ["a", "Воїн"]], // 10
  [["p", 6500], ["p", 13000]], // 11
  [["p", 7500], ["p", 15000]], // 12
  [["p", 8000], ["p", 16000]], // 13
  [["p", 8500], ["p", 17000]], // 14
  [["p", 9500], ["p", 19000]], // 15
  [["b", "Шлях лицаря"], ["b", "Замок на скелі"]], // 16
  [["p", 12500], ["p", 25000]], // 17
  [["p", 13500], ["p", 27000]], // 18
  [["p", 15500], ["p", 31000]], // 19
  [["t", "Лицар"], ["t", "Золотий Лицар"]], // 20
  [["p", 12500], ["p", 25000]], // 21
  [["p", 13500], ["p", 27000]], // 22
  [["p", 15500], ["p", 31000]], // 23
  [["p", 16500], ["p", 33000]], // 24
  [["p", 18500], ["p", 37000]], // 25
  [["p", 19500], ["p", 39000]], // 26
  [["p", 21500], ["p", 43000]], // 27
  [["p", 23000], ["p", 46000]], // 28
  [["p", 24000], ["p", 48000]], // 29
  [["a", "Лицар"], ["a", "Золотий Лицар"]], // 30
  [["p", 18000], ["p", 36000]], // 31
  [["p", 19000], ["p", 38000]], // 32
  [["p", 21000], ["p", 42000]], // 33
  [["p", 23000], ["p", 46000]], // 34
  [["p", 24000], ["p", 48000]], // 35
  [["p", 25000], ["p", 50000]], // 36
  [["p", 27000], ["p", 54000]], // 37
  [["p", 29000], ["p", 58000]], // 38
  [["p", 30000], ["p", 60000]], // 39
  [["t", "Принц"], ["t", "Король"]], // 40
  [["p", 24000], ["p", 48000]], // 41
  [["p", 25000], ["p", 50000]], // 42
  [["p", 27000], ["p", 54000]], // 43
  [["b", "Світанок королівства"], ["b", "Королівська фортеця"]], // 44
  [["p", 30000], ["p", 60000]], // 45
  [["p", 33000], ["p", 66000]], // 46
  [["p", 36000], ["p", 72000]], // 47
  [["p", 42000], ["p", 84000]], // 48
  [["p", 50000], ["p", 100000]], // 49
  [["a", "Принц"], ["a", "Король"]], // 50
];

const PASS_TITLE_IDS = {
  "Новобранець": "recruit",
  "Воїн": "warrior",
  "Лицар": "knight",
  "Золотий Лицар": "golden_knight",
  "Принц": "prince",
  "Король": "king",
};
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

const FREE_PASS_REWARDS = buildPassTrack("free");
const PREMIUM_PASS_REWARDS = buildPassTrack("premium");
// Рівні з особливими нагородами (титул/банер/аватар) виділяються в списку.
const PASS_MILESTONE_LEVELS = FREE_PASS_REWARDS.filter((r) => r.type !== "points").map((r) => r.level);

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

async function claimPassReward(me, track, level, onSetPlayer) {
  const claimedKey = track === "premium" ? "passClaimedPremium" : "passClaimedFree";
  const claimed = passClaimedList(me, track);
  if (claimed.includes(level)) return;
  if (level > currentPassLevel(passClicks(me))) return;
  if (track === "premium" && !me.hasPremiumPass) return;
  const reward = passRewardByLevel(track, level);
  if (!reward) return;
  const base = migratePass(me);
  const updated = { ...base, [claimedKey]: [...passClaimedList(base, track), level] };
  applyPassReward(updated, reward);
  await storageSet(PLAYER_PREFIX + me.id, JSON.stringify(updated), true);
  onSetPlayer(updated);
}

async function claimAllPassRewards(me, onSetPlayer) {
  const lvl = currentPassLevel(passClicks(me));
  const updated = { ...migratePass(me) };
  let changed = false;
  const freeClaimed = new Set(passClaimedList(updated, "free"));
  for (const r of FREE_PASS_REWARDS) {
    if (r.level <= lvl && !freeClaimed.has(r.level)) {
      freeClaimed.add(r.level);
      changed = true;
      applyPassReward(updated, r);
    }
  }
  updated.passClaimedFree = Array.from(freeClaimed);
  if (updated.hasPremiumPass) {
    const premClaimed = new Set(passClaimedList(updated, "premium"));
    for (const r of PREMIUM_PASS_REWARDS) {
      if (r.level <= lvl && !premClaimed.has(r.level)) {
        premClaimed.add(r.level);
        changed = true;
        applyPassReward(updated, r);
      }
    }
    updated.passClaimedPremium = Array.from(premClaimed);
  }
  if (!changed) return;
  await storageSet(PLAYER_PREFIX + me.id, JSON.stringify(updated), true);
  onSetPlayer(updated);
}

async function buyPremiumPass(me, onSetPlayer) {
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

function ProfileScreen({
  me,
  players,
  energy,
  theme,
  onChangeTheme,
  mail,
  unreadCount,
  onRefreshMail,
  wars,
  season,
  isLeader,
  onSetPlayer,
  onRefreshGameData,
  onOpenTutorial,
  lang,
  onSetLanguage,
  maintenance,
  onSaveMaintenance,
}) {
  const [view, setView] = useState("main"); // main | mail | settings | search | titles | icons | banners | cosmetics | stats
  const [cosmBack, setCosmBack] = useState("cosmetics"); // куди повертає «Назад» з титулів/фото/банерів
  const openCosm = (v, back) => { setCosmBack(back); setView(v); };
  const country = COUNTRY_MAP[me.countryCode];

  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(me.username || "");
  const [renameSaving, setRenameSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const globalRank = useMemo(() => {
    const sorted = [...players].sort((a, b) => (b.power || 0) - (a.power || 0));
    const idx = sorted.findIndex((p) => p.id === me.id);
    return idx >= 0 ? idx + 1 : "—";
  }, [players, me.id]);

  const countryRank = useMemo(() => {
    const sorted = players
      .filter((p) => p.countryCode === me.countryCode)
      .sort((a, b) => (b.power || 0) - (a.power || 0));
    const idx = sorted.findIndex((p) => p.id === me.id);
    return idx >= 0 ? idx + 1 : "—";
  }, [players, me.id, me.countryCode]);

  const ctx = useMemo(() => ({ isLeader, globalRank }), [isLeader, globalRank]);

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countryQuery]);

  const changeCountry = async (code) => {
    if (code === me.countryCode) {
      setCountryPickerOpen(false);
      return;
    }
    const ok = window.confirm(`Змінити країну на ${COUNTRY_MAP[code]?.name || code}? Це вплине на командну статистику.`);
    if (!ok) return;
    const updated = { ...me, countryCode: code };
    await storageSet(PLAYER_PREFIX + me.id, JSON.stringify(updated), true);
    onSetPlayer(updated);
    setCountryPickerOpen(false);
    setCountryQuery("");
  };

  const openRename = () => {
    setRenameDraft(me.username || "");
    setRenameOpen(true);
  };

  const saveUsername = async () => {
    const name = cleanText(renameDraft, 24);
    if (!name) return;
    setRenameSaving(true);
    const updated = { ...me, username: name };
    await storageSet(PLAYER_PREFIX + me.id, JSON.stringify(updated), true);
    onSetPlayer(updated);
    setRenameSaving(false);
    setRenameOpen(false);
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(String(me.id));
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } catch (e) {
      // clipboard unavailable, ignore
    }
  };

  const equippedIcon = iconById(me.equippedIcon);
  const equippedBanner = bannerById(me.equippedBanner);
  const equippedTitle = titleById(me.equippedTitle);
  const equippedTitleUnlocked = equippedTitle && equippedTitle.req(me, ctx) ? equippedTitle : null;
  const equippedBadgesList = (Array.isArray(me.equippedBadges) ? me.equippedBadges : [])
    .map((id) => achievementById(id))
    .filter((b) => b && b.req(me, ctx))
    .slice(0, MAX_EQUIPPED_BADGES);
  const unlockedTitlesCount = TITLES.filter((t) => t.req(me, ctx)).length;
  const unlockedIconsCount = PROFILE_ICONS.filter((i) => isIconUnlocked(me, i)).length;
  const unlockedAchievementsCount = ACHIEVEMENTS.filter((a) => a.req(me, ctx)).length;

  if (view === "mail") {
    return (
      <MailScreen
        me={me}
        mail={mail}
        onBack={() => setView("main")}
        onRefresh={onRefreshMail}
        onRefreshGameData={onRefreshGameData}
      />
    );
  }
  if (view === "settings") {
    return (
      <SettingsScreen
        me={me}
        theme={theme}
        onChangeTheme={onChangeTheme}
        onBack={() => setView("main")}
        onSetPlayer={onSetPlayer}
        wars={wars}
        season={season}
        players={players}
        isLeader={isLeader}
        mail={mail}
        unreadCount={unreadCount}
        onRefreshMail={onRefreshMail}
        onRefreshGameData={onRefreshGameData}
        onOpenTutorial={onOpenTutorial}
        lang={lang}
        onSetLanguage={onSetLanguage}
        maintenance={maintenance}
        onSaveMaintenance={onSaveMaintenance}
      />
    );
  }
  if (view === "search") {
    return <SearchPlayersScreen me={me} players={players} onBack={() => setView("main")} />;
  }
  if (view === "titles") {
    return (
      <TitlesScreen
        me={me}
        ctx={ctx}
        onBack={() => setView(cosmBack)}
        onEquip={(id) => equipField(me, "equippedTitle", id, onSetPlayer)}
      />
    );
  }
  if (view === "icons") {
    return (
      <IconsScreen
        me={me}
        onBack={() => setView(cosmBack)}
        onEquip={(id) => equipField(me, "equippedIcon", id, onSetPlayer)}
      />
    );
  }
  if (view === "banners") {
    return (
      <BannersScreen
        me={me}
        onBack={() => setView(cosmBack)}
        onEquip={(id) => equipField(me, "equippedBanner", id, onSetPlayer)}
      />
    );
  }
  if (view === "nickfx") {
    const prem = !!me.hasPremiumPass;
    const curColor = NICK_COLORS.find((x) => x.id === me.nickColor) || NICK_COLORS[0];
    const previewP = { ...me, hasPremiumPass: true, nickFx: true, nickColor: curColor.id };
    return (
      <div className="cn-profile">
        <div className="cn-lb-header">
          <button className="cn-icon-btn" type="button" onClick={() => setView("cosmetics")} aria-label="Назад"><ArrowLeft size={18} /></button>
          <div className="cn-screen-title">Переливний нікнейм</div>
          <span style={{ width: 36 }} />
        </div>
        <div className="cn-nickfx-preview" style={!prem ? { opacity: 0.6 } : undefined}>
          <Nick p={previewP} />
        </div>
        <button
          className="cn-dev-btn"
          type="button"
          disabled={!prem}
          style={{ width: "100%" }}
          onClick={() => equipField(me, "nickFx", !me.nickFx, onSetPlayer)}
        >
          {me.nickFx && prem ? "Вимкнути переливання" : "Увімкнути переливання"}
        </button>
        <div className="cn-nickfx-colors" style={!prem ? { opacity: 0.5 } : undefined}>
          {NICK_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={!prem}
              title={c.label}
              aria-label={c.label}
              className={"cn-nickfx-color" + (curColor.id === c.id ? " cn-nickfx-color--active" : "")}
              style={{ background: c.rainbow ? "linear-gradient(90deg,#ff5f6d,#ffc371,#fff07a,#6ee7a0,#5eb5ff,#b794ff)" : `linear-gradient(135deg,${c.a},${c.b})` }}
              onClick={() => equipField(me, "nickColor", c.id, onSetPlayer)}
            />
          ))}
        </div>
        {!prem && <div className="cn-nickfx-lock"><Lock size={12} /> Ця функція доступна лише власникам Premium Pass.</div>}
      </div>
    );
  }
  if (view === "cosmetics") {
    return (
      <div className="cn-profile">
        <div className="cn-lb-header">
          <button className="cn-icon-btn" type="button" onClick={() => setView("main")} aria-label="Назад"><ArrowLeft size={18} /></button>
          <div className="cn-screen-title">Косметика</div>
          <span style={{ width: 36 }} />
        </div>
        <div className="cn-menu-list">
          <button className="cn-menu-card" type="button" onClick={() => openCosm("icons", "cosmetics")}>
            <span className="cn-menu-card-icon cn-menu-card-icon--blue"><Palette size={24} /></span>
            <span className="cn-menu-card-text">
              <span className="cn-menu-card-title">Фото профілю</span>
              <span className="cn-menu-card-sub">Аватарки · {unlockedIconsCount}/{PROFILE_ICONS.length}</span>
            </span>
            <ChevronRight size={20} className="cn-menu-card-chevron" />
          </button>
          <button className="cn-menu-card" type="button" onClick={() => openCosm("banners", "cosmetics")}>
            <span className="cn-menu-card-icon cn-menu-card-icon--blue"><ImageIcon size={24} /></span>
            <span className="cn-menu-card-text">
              <span className="cn-menu-card-title">Банер профілю</span>
              <span className="cn-menu-card-sub">{equippedBanner ? equippedBanner.label : "Ще не обрано"}</span>
            </span>
            <ChevronRight size={20} className="cn-menu-card-chevron" />
          </button>
          <button className="cn-menu-card" type="button" onClick={() => setView("nickfx")}>
            <span className="cn-menu-card-icon cn-menu-card-icon--blue"><Sparkles size={24} /></span>
            <span className="cn-menu-card-text">
              <span className="cn-menu-card-title">Переливний нікнейм</span>
              <span className="cn-menu-card-sub">{!me.hasPremiumPass ? "Лише з Premium" : me.nickFx ? "Увімкнено" : "Вимкнено"}</span>
            </span>
            <ChevronRight size={20} className="cn-menu-card-chevron" />
          </button>
          <button className="cn-menu-card" type="button" onClick={() => openCosm("titles", "cosmetics")}>
            <span className="cn-menu-card-icon cn-menu-card-icon--blue"><Crown size={24} /></span>
            <span className="cn-menu-card-text">
              <span className="cn-menu-card-title">Титули</span>
              <span className="cn-menu-card-sub">{equippedTitleUnlocked ? equippedTitleUnlocked.label : "Без титулу"} · {unlockedTitlesCount}/{TITLES.length}</span>
            </span>
            <ChevronRight size={20} className="cn-menu-card-chevron" />
          </button>
        </div>
      </div>
    );
  }
  if (view === "achievements") {
    return (
      <AchievementsScreen
        me={me}
        ctx={ctx}
        equippedBadges={Array.isArray(me.equippedBadges) ? me.equippedBadges : []}
        onBack={() => setView("main")}
        onToggle={(id) => toggleBadge(me, id, onSetPlayer)}
      />
    );
  }

  if (view === "stats") {
    return (
      <StatsScreen
        me={me}
        energy={energy}
        globalRank={globalRank}
        countryRank={countryRank}
        isLeader={isLeader}
        mail={mail}
        wars={wars}
        onBack={() => setView("main")}
      />
    );
  }

  return (
    <div className="cn-profile">
      <div className="cn-lb-header">
        <div className="cn-screen-title">Профіль</div>
        <div className="cn-profile-header-actions">

        </div>
      </div>

      <div className={"cn-profile-banner" + (equippedBanner ? " cn-profile-banner--img" : "")}>
        <div className="cn-profile-banner-bg">
          {equippedBanner ? (
            <img src={equippedBanner.img} alt={equippedBanner.label} className="cn-profile-banner-img" />
          ) : (
            <span className="cn-profile-banner-dev-tag">Банера немає</span>
          )}
        </div>
        <button
          type="button"
          className="cn-profile-banner-edit-btn"
          onClick={() => openCosm("banners", "main")}
          aria-label="Змінити банер профілю"
        >
          <ImageIcon size={14} /> {equippedBanner ? "Змінити банер" : "Обрати банер"}
        </button>

        <div className="cn-profile-hero">
          <button
            type="button"
            className="cn-profile-avatar-ring"
            onClick={() => openCosm("icons", "main")}
            aria-label="Змінити іконку профілю"
          >
            {equippedIcon ? <ProfileIconGlyph opt={equippedIcon} size={48} /> : <User size={48} />}
          </button>

          <div className="cn-profile-name-banner">
            {isLeader && <Crown size={14} className="cn-profile-name-banner-crown" />}
            <div className="cn-profile-name-row">
              <div className="cn-profile-name"><Nick p={me} /></div>
              {!getTelegramUser()?.id && (
                <button className="cn-profile-edit-btn" type="button" onClick={openRename} aria-label="Змінити ім'я">
                  <Pencil size={13} />
                </button>
              )}
            </div>
            <button type="button" className="cn-profile-title-pill" onClick={() => openCosm("titles", "main")}>
              {equippedTitleUnlocked ? equippedTitleUnlocked.label : "Без титулу"}
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="cn-profile-role-row">
        <span className={"cn-profile-chip" + (isLeader ? " cn-profile-chip--leader" : "")}>
          {isLeader ? <Crown size={12} /> : <User size={12} />} {roleStatusLabel(isLeader, me.role)}
        </span>
      </div>

      <div className="cn-profile-stats-bar">
        <button className="cn-profile-stats-item" type="button" onClick={() => setView("stats")}>
          <span className="cn-profile-stats-icon"><MousePointerClick size={18} /></span>
          <span className="cn-profile-stats-text">
            <span className="cn-profile-stats-label">Кліки</span>
            <span className="cn-profile-stats-value">{fmt(me.totalClicks)}</span>
          </span>
        </button>

        <div className="cn-profile-stats-divider" />

        <button className="cn-profile-stats-item" type="button" onClick={() => setCountryPickerOpen(true)}>
          <span className="cn-profile-stats-icon"><GameLogo size={18} /></span>
          <span className="cn-profile-stats-text">
            <span className="cn-profile-stats-label">Країна</span>
            <span className="cn-profile-stats-value cn-profile-stats-value--country">
              <Flag code={country?.code} size={14} className="cn-profile-stats-flag" /> {country?.name}
            </span>
          </span>
        </button>

        <div className="cn-profile-stats-divider" />

        <div className="cn-profile-stats-item cn-profile-stats-item--static">
          <span className="cn-profile-stats-icon"><Star size={18} /></span>
          <span className="cn-profile-stats-text">
            <span className="cn-profile-stats-label">Рейтинг</span>
            <span className="cn-profile-stats-value">
              {typeof globalRank === "number" ? "#" + fmt(globalRank) : globalRank}
            </span>
          </span>
        </div>
      </div>

      <div className="cn-menu-list">
        <button className="cn-menu-card" type="button" onClick={() => setView("settings")}>
          <span className="cn-menu-card-icon cn-menu-card-icon--blue"><Settings size={24} /></span>
          <span className="cn-menu-card-text">
            <span className="cn-menu-card-title">Налаштування</span>
            <span className="cn-menu-card-sub">Звук, мова, сповіщення</span>
          </span>
          <ChevronRight size={20} className="cn-menu-card-chevron" />
        </button>

        <button className="cn-menu-card" type="button" onClick={() => setView("stats")}>
          <span className="cn-menu-card-icon cn-menu-card-icon--blue"><BarChart3 size={24} /></span>
          <span className="cn-menu-card-text">
            <span className="cn-menu-card-title">Статистика</span>
            <span className="cn-menu-card-sub">Детальна статистика гри</span>
          </span>
          <ChevronRight size={20} className="cn-menu-card-chevron" />
        </button>

        <button className="cn-menu-card" data-tut="prof-cosm" type="button" onClick={() => setView("cosmetics")}>
          <span className="cn-menu-card-icon cn-menu-card-icon--blue"><Palette size={24} /></span>
          <span className="cn-menu-card-text">
            <span className="cn-menu-card-title">Косметика</span>
            <span className="cn-menu-card-sub">Банер, фото профілю, титули</span>
          </span>
          <ChevronRight size={20} className="cn-menu-card-chevron" />
        </button>

        <button className="cn-menu-card" type="button" onClick={() => setView("search")}>
          <span className="cn-menu-card-icon cn-menu-card-icon--blue"><UserPlus size={24} /></span>
          <span className="cn-menu-card-text">
            <span className="cn-menu-card-title">Пошук гравців</span>
            <span className="cn-menu-card-sub">Знайти інших гравців за нікнеймом</span>
          </span>
          <ChevronRight size={20} className="cn-menu-card-chevron" />
        </button>

      </div>

      {countryPickerOpen && (
        <div className="cn-modal-overlay" onClick={() => setCountryPickerOpen(false)}>
          <div className="cn-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="cn-modal-header">
              <div className="cn-modal-title">
                <GameLogo size={16} /> Змінити країну
              </div>
              <button className="cn-icon-btn" type="button" onClick={() => setCountryPickerOpen(false)} aria-label="Закрити">
                <X size={16} />
              </button>
            </div>
            <div className="cn-country-search-wrap" style={{ marginBottom: 10 }}>
              <Search size={15} className="cn-country-search-icon" />
              <input
                className="cn-country-search"
                placeholder="Пошук країни…"
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="cn-country-dropdown-list cn-country-dropdown-list--modal">
              {filteredCountries.map((c) => (
                <button key={c.code} type="button" className="cn-country-dropdown-item" onClick={() => changeCountry(c.code)}>
                  <Flag code={c.code} size={18} className="cn-country-dropdown-flag" />
                  <span className="cn-country-dropdown-name">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {renameOpen && (
        <div className="cn-modal-overlay" onClick={() => setRenameOpen(false)}>
          <div className="cn-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="cn-modal-header">
              <div className="cn-modal-title">
                <Pencil size={16} /> Змінити ім'я
              </div>
              <button className="cn-icon-btn" type="button" onClick={() => setRenameOpen(false)} aria-label="Закрити">
                <X size={16} />
              </button>
            </div>
            <div className="cn-input-icon-wrap" style={{ margin: "4px 0 14px" }}>
              <User size={18} className="cn-input-icon" />
              <input
                className="cn-input cn-input--icon"
                maxLength={20}
                placeholder="Введи своє ім'я"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                autoFocus
              />
            </div>
            <button
              className="cn-dev-btn"
              type="button"
              disabled={!renameDraft.trim() || renameSaving}
              onClick={saveUsername}
              style={{ width: "100%" }}
            >
              Зберегти
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileStat({ label, value }) {
  return (
    <div className="cn-profile-stat">
      <div className="cn-profile-stat-label">{label}</div>
      <div className="cn-profile-stat-value">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Detailed statistics                                                 */
/* ------------------------------------------------------------------ */

function StatsScreen({ me, energy, globalRank, countryRank, isLeader, mail, wars, onBack }) {
  const accountDays = Math.max(0, Math.floor((Date.now() - (me.createdAt || Date.now())) / 86400000));
  const avgPowerPerClick = me.totalClicks > 0 ? (me.power / me.totalClicks).toFixed(2) : "0.00";

  return (
    <div className="cn-profile">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Статистика</div>
        <div style={{ width: 34 }} />
      </div>

      <div className="cn-profile-grid" style={{ marginBottom: 10 }}>
        <ProfileStat label="Power" value={fmt(me.power)} />
        <ProfileStat label="Total Clicks" value={fmt(me.totalClicks)} />
        <ProfileStat label="Energy" value={`${Math.floor(energy)} / ${maxEnergyOf(me)}`} />
        <ProfileStat label="Global Rank" value={typeof globalRank === "number" ? "#" + fmt(globalRank) : globalRank} />
        <ProfileStat label="Country Rank" value={typeof countryRank === "number" ? "#" + fmt(countryRank) : countryRank} />
        <ProfileStat label="Power / Click" value={avgPowerPerClick} />
        <ProfileStat label="Днів у грі" value={fmt(accountDays)} />
        <ProfileStat label="Повідомлень" value={fmt(mail ? mail.length : 0)} />
        <ProfileStat label="Статус" value={roleStatusLabel(isLeader, me.role)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Player search                                                      */
/* ------------------------------------------------------------------ */

function SearchPlayersScreen({ me, players, onBack }) {
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...players].sort((a, b) => (b.power || 0) - (a.power || 0));
    const filtered = q ? sorted.filter((p) => (p.username || "").toLowerCase().includes(q)) : sorted;
    return filtered.slice(0, 60);
  }, [players, query]);

  return (
    <div className="cn-profile">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Пошук гравців</div>
        <div style={{ width: 34 }} />
      </div>

      <div className="cn-country-search-wrap cn-player-search-wrap">
        <Search size={15} className="cn-country-search-icon" />
        <input
          className="cn-country-search"
          placeholder="Введи нікнейм гравця…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {results.length === 0 ? (
        <div className="cn-lb-empty">Гравців не знайдено</div>
      ) : (
        <div className="cn-list">
          {results.map((p) => {
            const c = COUNTRY_MAP[p.countryCode];
            const icon = iconById(p.equippedIcon);
            const isMine = p.id === me.id;
            return (
              <button
                key={p.id}
                type="button"
                className={"cn-row cn-search-row" + (isMine ? " cn-row--mine" : "")}
                onClick={() => setViewing(p)}
              >
                <span className="cn-search-row-avatar">
                  {icon ? <ProfileIconGlyph opt={icon} size={14} /> : <Flag code={c?.code} size={14} />}
                </span>
                <Flag code={c?.code} size={18} className="cn-row-flag" />
                <span className="cn-row-name"><Nick p={p} /></span>
                <span className="cn-row-value">{fmt(p.power)}</span>
              </button>
            );
          })}
        </div>
      )}

      {viewing && <PlayerPeekModal player={viewing} players={players} onClose={() => setViewing(null)} />}
    </div>
  );
}

function PlayerPeekModal({ player, players, onClose }) {
  const country = COUNTRY_MAP[player.countryCode];
  const icon = iconById(player.equippedIcon);
  const banner = bannerById(player.equippedBanner);
  const title = titleById(player.equippedTitle);

  const globalRank = useMemo(() => {
    const sorted = [...players].sort((a, b) => (b.power || 0) - (a.power || 0));
    const idx = sorted.findIndex((p) => p.id === player.id);
    return idx >= 0 ? idx + 1 : "—";
  }, [players, player.id]);

  return (
    <div className="cn-modal-overlay" onClick={onClose}>
      <div className="cn-modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cn-modal-header">
          <div className="cn-modal-title">
            <User size={16} /> Профіль гравця
          </div>
          <button className="cn-icon-btn" type="button" onClick={onClose} aria-label="Закрити">
            <X size={16} />
          </button>
        </div>

        <div className={"cn-profile-banner cn-profile-banner--peek" + (banner ? " cn-profile-banner--img" : "")}>
          <div className="cn-profile-banner-bg">
            {banner ? (
              <img src={banner.img} alt={banner.label} className="cn-profile-banner-img" />
            ) : (
              <span className="cn-profile-banner-dev-tag">Банера немає</span>
            )}
          </div>

          <div className="cn-profile-hero">
            <div className="cn-profile-avatar-ring cn-profile-avatar-ring--static">
              {icon ? <ProfileIconGlyph opt={icon} size={44} /> : <Flag code={country?.code} size={40} />}
            </div>

            <div className="cn-profile-name-banner">
              <div className="cn-profile-name-row">
                <div className="cn-profile-name"><Nick p={player} /></div>
              </div>
              <span className="cn-profile-title-pill cn-profile-title-pill--static">
                {title ? title.label : "Без титулу"}
              </span>
            </div>
          </div>
        </div>

        <div className="cn-profile-stats-bar">
          <div className="cn-profile-stats-item cn-profile-stats-item--static">
            <span className="cn-profile-stats-icon"><MousePointerClick size={18} /></span>
            <span className="cn-profile-stats-text">
              <span className="cn-profile-stats-label">Кліки</span>
              <span className="cn-profile-stats-value">{fmt(player.totalClicks)}</span>
            </span>
          </div>

          <div className="cn-profile-stats-divider" />

          <div className="cn-profile-stats-item cn-profile-stats-item--static">
            <span className="cn-profile-stats-icon"><GameLogo size={18} /></span>
            <span className="cn-profile-stats-text">
              <span className="cn-profile-stats-label">Країна</span>
              <span className="cn-profile-stats-value cn-profile-stats-value--country">
                <Flag code={country?.code} size={14} className="cn-profile-stats-flag" /> {country?.name}
              </span>
            </span>
          </div>

          <div className="cn-profile-stats-divider" />

          <div className="cn-profile-stats-item cn-profile-stats-item--static">
            <span className="cn-profile-stats-icon"><Star size={18} /></span>
            <span className="cn-profile-stats-text">
              <span className="cn-profile-stats-label">Рейтинг</span>
              <span className="cn-profile-stats-value">
                {typeof globalRank === "number" ? "#" + fmt(globalRank) : globalRank}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Titles                                                              */
/* ------------------------------------------------------------------ */

function TitlesScreen({ me, ctx, onBack, onEquip }) {
  return (
    <div className="cn-profile">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Титули</div>
        <div style={{ width: 34 }} />
      </div>

      <div className="cn-select-list">
        {TITLES.map((t) => {
          const unlocked = t.req(me, ctx);
          const active = me.equippedTitle === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={!unlocked}
              className={
                "cn-select-row" +
                (active ? " cn-select-row--active" : "") +
                (!unlocked ? " cn-select-row--locked" : "")
              }
              onClick={() => unlocked && onEquip(active ? null : t.id)}
            >
              <span className="cn-select-row-icon">{unlocked ? <Sparkles size={16} /> : <Lock size={15} />}</span>
              <span className="cn-select-row-label">{t.label}</span>
              {active && <Check size={16} className="cn-select-row-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile icons                                                       */
/* ------------------------------------------------------------------ */

function passLockHint(me, type, id) {
  const idKey = type === "icon" ? "iconId" : "bannerId";
  const f = FREE_PASS_REWARDS.find((r) => r.type === type && r[idKey] === id);
  if (f) return `Розблокується безкоштовно в Battle Pass (Free) на ${f.level} рівні`;
  const p = PREMIUM_PASS_REWARDS.find((r) => r.type === type && r[idKey] === id);
  if (p) return me.hasPremiumPass
    ? `Нагорода Premium Pass на ${p.level} рівні — дійди до нього й забери`
    : `Потрібен Premium Pass: нагорода на ${p.level} рівні`;
  return "Ця нагорода зараз недоступна";
}

function useLockHint() {
  const [hint, setHint] = useState("");
  const tRef = useRef(null);
  const show = (text) => {
    setHint(text);
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setHint(""), 3500);
  };
  useEffect(() => () => tRef.current && clearTimeout(tRef.current), []);
  return [hint, show];
}

function IconsScreen({ me, onBack, onEquip }) {
  const [hint, showHint] = useLockHint();
  return (
    <div className="cn-profile">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Іконки профілю</div>
        <div style={{ width: 34 }} />
      </div>

      {hint && <div className="cn-lock-hint"><Lock size={13} /> {hint}</div>}
      <div className="cn-icon-grid">
        {PROFILE_ICONS.filter((o) => !o.legacy || isIconUnlocked(me, o) || me.equippedIcon === o.id).map((opt) => {
          const unlocked = isIconUnlocked(me, opt);
          const active = me.equippedIcon === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              className={
                "cn-icon-cell" +
                (active ? " cn-icon-cell--active" : "") +
                (!unlocked ? " cn-icon-cell--locked" : "")
              }
              onClick={() => {
                if (unlocked) onEquip(active ? null : opt.id);
                else if (opt.secret) showHint("???");
                else if (opt.passIcon) showHint(opt.legacy ? "Ця аватарка більше недоступна" : passLockHint(me, "icon", opt.id));
                else showHint(`Потрібно ${fmt(opt.req)} Power`);
              }}
            >
              <span className="cn-icon-cell-glyph" style={{ display: "flex" }}><ProfileIconGlyph opt={opt} size={opt.img ? 40 : 22} /></span>
              {!unlocked && <span className="cn-icon-cell-lock"><Lock size={10} /></span>}
              {!unlocked && (
                <span className="cn-icon-cell-req">{opt.passIcon ? "Pass" : fmt(opt.req)}</span>
              )}
              {active && <Check size={12} className="cn-icon-cell-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile banners                                                     */
/* ------------------------------------------------------------------ */

function isBannerUnlocked(me, bannerId) {
  if ((me.unlockedPassBanners || []).includes(bannerId)) return true;
  const fromTrack = (track, list) =>
    passClaimedList(me, track).some((lvl) => {
      const r = list.find((x) => x.level === lvl);
      return r && r.type === "banner" && r.bannerId === bannerId;
    });
  return fromTrack("free", FREE_PASS_REWARDS) || fromTrack("premium", PREMIUM_PASS_REWARDS);
}

function BannersScreen({ me, onBack, onEquip }) {
  const [hint, showHint] = useLockHint();
  return (
    <div className="cn-profile">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Банер профілю</div>
        <div style={{ width: 34 }} />
      </div>

      <div className="cn-achv-hint">Обери банер, який буде відображатись у верхній частині твого профілю.</div>

      {hint && <div className="cn-lock-hint"><Lock size={13} /> {hint}</div>}
      <div className="cn-banner-grid">
        <button
          type="button"
          className={"cn-banner-cell" + (!me.equippedBanner ? " cn-banner-cell--active" : "")}
          onClick={() => onEquip(null)}
        >
          <span className="cn-banner-cell-placeholder">Без банера</span>
          {!me.equippedBanner && <Check size={14} className="cn-banner-cell-check" />}
        </button>
        {BANNER_OPTIONS.map((opt) => {
          const active = me.equippedBanner === opt.id;
          const unlocked = isBannerUnlocked(me, opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              className={"cn-banner-cell" + (active ? " cn-banner-cell--active" : "")}
              style={!unlocked ? { opacity: 0.5 } : undefined}
              onClick={() => (unlocked || active ? onEquip(active ? null : opt.id) : showHint(passLockHint(me, "banner", opt.id)))}
            >
              <img src={opt.img} alt={opt.label} className="cn-banner-cell-img" style={!unlocked ? { filter: "grayscale(1) brightness(.6)" } : undefined} />
              <span className="cn-banner-cell-label">{opt.label}</span>
              {!unlocked && <Lock size={16} style={{ position: "absolute", top: 8, right: 8 }} />}
              {active && <Check size={14} className="cn-banner-cell-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Achievements / badges                                               */
/* ------------------------------------------------------------------ */

function AchievementsScreen({ me, ctx, equippedBadges, onBack, onToggle }) {
  const atMax = equippedBadges.length >= MAX_EQUIPPED_BADGES;
  return (
    <div className="cn-profile">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Досягнення</div>
        <div style={{ width: 34 }} />
      </div>

      <div className="cn-achv-hint">
        Обрано {equippedBadges.length}/{MAX_EQUIPPED_BADGES} значків для профілю
      </div>

      <div className="cn-achv-list">
        {ACHIEVEMENTS.map((a) => {
          const unlocked = a.req(me, ctx);
          const active = equippedBadges.includes(a.id);
          const disabled = !unlocked || (!active && atMax);
          return (
            <button
              key={a.id}
              type="button"
              disabled={disabled}
              className={
                "cn-achv-row" +
                (unlocked ? " cn-achv-row--unlocked" : "") +
                (active ? " cn-achv-row--active" : "")
              }
              onClick={() => unlocked && onToggle(a.id)}
            >
              <span className="cn-achv-row-icon">{unlocked ? <img src={a.icon} alt="" style={{ width: 22, height: 22 }} /> : <Lock size={16} />}</span>
              <span className="cn-achv-row-text">
                <span className="cn-achv-row-title">{a.label}</span>
                <span className="cn-achv-row-desc">{a.desc}</span>
              </span>
              {active && <Check size={16} className="cn-achv-row-check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mail                                                                */
/* ------------------------------------------------------------------ */

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "щойно";
  if (min < 60) return min + " хв тому";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + " год тому";
  const days = Math.floor(hr / 24);
  return days + " дн тому";
}

function MailScreen({ me, mail, onBack, onRefresh, onRefreshGameData }) {
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [box, setBox] = useState("game"); // game | admin
  const unreadGame = mail.filter((m) => !m.read && m.from !== "admin").length;
  const unreadAdmin = mail.filter((m) => !m.read && m.from === "admin").length;
  const shownMail = mail.filter((m) => (box === "admin" ? m.from === "admin" : m.from !== "admin"));

  const markRead = useCallback(
    async (id) => {
      const list = await getMail(me.id);
      const updated = list.map((m) => (m.id === id ? { ...m, read: true } : m));
      await setJSON(MAIL_PREFIX + me.id, updated, true);
      onRefresh();
    },
    [me.id, onRefresh]
  );

  const openMessage = (m) => {
    setOpenId(m.id === openId ? null : m.id);
    if (!m.read) markRead(m.id);
  };

  const respondAllianceRequest = useCallback(
    async (msg, accept) => {
      setBusyId(msg.id);
      const requests = await getAllianceRequests();
      const updated = requests.map((r) =>
        r.id === msg.meta.requestId ? { ...r, status: accept ? "accepted" : "declined" } : r
      );
      await saveAllianceRequests(updated);
      if (accept) {
        const alliances = await getAlliances();
        alliances.push([msg.meta.fromCountry, msg.meta.toCountry]);
        await saveAlliances(alliances);
        const fromLeader = await getLeader(msg.meta.fromCountry);
        if (fromLeader) {
          await addMail(fromLeader, {
            type: "info",
            subject: "Союз укладено",
            body: `${COUNTRY_MAP[msg.meta.toCountry]?.name || msg.meta.toCountry} прийняли твою пропозицію союзу.`,
          });
        }
      }
      await markRead(msg.id);
      onRefreshGameData && onRefreshGameData();
      setBusyId(null);
    },
    [markRead, onRefreshGameData]
  );

  const respondDipRequest = useCallback(
    async (msg, accept) => {
      setBusyId(msg.id);
      const res = await respondDiplomacyRequest(msg.meta.requestId, accept);
      const list = await getMail(me.id);
      const resolved = res.ok ? (accept ? "accepted" : "declined") : "stale";
      await setJSON(
        MAIL_PREFIX + me.id,
        list.map((m) => (m.id === msg.id ? { ...m, read: true, resolved, resolvedNote: res.ok ? "" : res.reason } : m)),
        true
      );
      onRefresh();
      onRefreshGameData && onRefreshGameData();
      setBusyId(null);
    },
    [me.id, onRefresh, onRefreshGameData]
  );

  const respondWarInvite2 = useCallback(
    async (msg, accept) => {
      setBusyId(msg.id);
      let res = { ok: true };
      if (accept) res = await acceptWarInvite(msg.meta);
      const list = await getMail(me.id);
      await setJSON(
        MAIL_PREFIX + me.id,
        list.map((m) =>
          m.id === msg.id ? { ...m, read: true, resolved: res.ok ? (accept ? "accepted" : "declined") : "stale", resolvedNote: res.ok ? "" : res.reason } : m
        ),
        true
      );
      onRefresh();
      onRefreshGameData && onRefreshGameData();
      setBusyId(null);
    },
    [me.id, onRefresh, onRefreshGameData]
  );

  const respondWarInvite = useCallback(
    async (msg, accept) => {
      setBusyId(msg.id);
      const wars = await getWars();
      const idx = wars.findIndex((w) => w.id === msg.meta.warId);
      if (idx >= 0) {
        const war = wars[idx];
        const sideKey = msg.meta.side === "attacker" ? "attackerAllies" : "defenderAllies";
        const list = war[sideKey] || [];
        if (accept && !list.includes(me.countryCode)) {
          war[sideKey] = [...list, me.countryCode];
          wars[idx] = war;
          await saveWars(wars);
        }
      }
      await markRead(msg.id);
      onRefreshGameData && onRefreshGameData();
      setBusyId(null);
    },
    [me.countryCode, markRead, onRefreshGameData]
  );

  return (
    <div className="cn-mail">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Пошта</div>
        <button className="cn-icon-btn" onClick={onRefresh} type="button" aria-label="Оновити">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="cn-box-tabs">
        <button type="button" className={"cn-box-tab" + (box === "game" ? " cn-box-tab--active" : "")} onClick={() => setBox("game")}>
          Від гри{unreadGame > 0 && <span className="cn-box-badge">{unreadGame}</span>}
        </button>
        <button type="button" className={"cn-box-tab" + (box === "admin" ? " cn-box-tab--active" : "")} onClick={() => setBox("admin")}>
          Від адміністрації{unreadAdmin > 0 && <span className="cn-box-badge">{unreadAdmin}</span>}
        </button>
      </div>

      {shownMail.length === 0 && <div className="cn-lb-empty">Повідомлень поки немає</div>}

      <div className="cn-mail-list">
        {shownMail.map((m) => {
          const open = openId === m.id;
          return (
            <div key={m.id} className={"cn-mail-item" + (!m.read ? " cn-mail-item--unread" : "")}>
              <button className="cn-mail-item-head" type="button" onClick={() => openMessage(m)}>
                {m.read ? <MailOpen size={16} className="cn-mail-item-icon" /> : <Mail size={16} className="cn-mail-item-icon" />}
                <div className="cn-mail-item-text">
                  <div className="cn-mail-item-subject">{m.subject}</div>
                  <div className="cn-mail-item-time">{timeAgo(m.ts)}</div>
                </div>
                {!m.read && <span className="cn-mail-dot" />}
              </button>
              {open && (
                <div className="cn-mail-item-body">
                  <div>{m.body}</div>
                  {m.type === "alliance-request" && m.meta && (
                    <div className="cn-mail-actions">
                      <button
                        className="cn-mail-action cn-mail-action--accept"
                        disabled={busyId === m.id}
                        onClick={() => respondAllianceRequest(m, true)}
                        type="button"
                      >
                        <Check size={14} /> Прийняти
                      </button>
                      <button
                        className="cn-mail-action cn-mail-action--decline"
                        disabled={busyId === m.id}
                        onClick={() => respondAllianceRequest(m, false)}
                        type="button"
                      >
                        <Ban size={14} /> Відхилити
                      </button>
                    </div>
                  )}
                  {m.type === "war-invite" && m.meta && (
                    m.resolved ? (
                      <div className="cn-mail-resolved">
                        {m.resolved === "accepted" ? "✓ Ви вступили у війну" : m.resolved === "declined" ? "✗ Відхилено" : m.resolvedNote || "Вже неактуально"}
                      </div>
                    ) : (
                      <div className="cn-mail-actions">
                        <button className="cn-mail-action cn-mail-action--accept" disabled={busyId === m.id} onClick={() => respondWarInvite2(m, true)} type="button">
                          <Check size={14} /> Прийняти
                        </button>
                        <button className="cn-mail-action cn-mail-action--decline" disabled={busyId === m.id} onClick={() => respondWarInvite2(m, false)} type="button">
                          <Ban size={14} /> Відхилити
                        </button>
                      </div>
                    )
                  )}
                  {m.type === "dip-request" && m.meta && (
                    m.resolved ? (
                      <div className="cn-mail-resolved">
                        {m.resolved === "accepted" ? "✓ Прийнято" : m.resolved === "declined" ? "✗ Відхилено" : m.resolvedNote || "Вже неактуально"}
                      </div>
                    ) : (
                      <div className="cn-mail-actions">
                        <button className="cn-mail-action cn-mail-action--accept" disabled={busyId === m.id} onClick={() => respondDipRequest(m, true)} type="button">
                          <Check size={14} /> Прийняти
                        </button>
                        <button className="cn-mail-action cn-mail-action--decline" disabled={busyId === m.id} onClick={() => respondDipRequest(m, false)} type="button">
                          <Ban size={14} /> Відхилити
                        </button>
                      </div>
                    )
                  )}
                  {m.type === "ally-war-invite" && m.meta && (
                    <div className="cn-mail-actions">
                      <button
                        className="cn-mail-action cn-mail-action--accept"
                        disabled={busyId === m.id}
                        onClick={() => respondWarInvite(m, true)}
                        type="button"
                      >
                        <Check size={14} /> Accept
                      </button>
                      <button
                        className="cn-mail-action cn-mail-action--decline"
                        disabled={busyId === m.id}
                        onClick={() => respondWarInvite(m, false)}
                        type="button"
                      >
                        <Ban size={14} /> Decline
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings (Theme + Developer/Test panel)                             */
/* ------------------------------------------------------------------ */

/* Адмін: окремий екран зі списком гравців і докладною карткою гравця */
function AdminPlayersView({ players, me, onSetPlayer, onRefreshGameData, onBack }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const [selId, setSelId] = useState(null);
  const [info, setInfo] = useState(undefined); // undefined — вантажиться, null — даних немає
  const [seen, setSeen] = useState(0);
  const [adminLog, setAdminLog] = useState([]);
  const [logLimit, setLogLimit] = useState(20);
  const [editOpen, setEditOpen] = useState(false);
  const [power, setPower] = useState("");
  const [pts, setPts] = useState("");
  const [clicks, setClicks] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [mSubj, setMSubj] = useState("");
  const [mBody, setMBody] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...(players || [])].sort((a, b) => (b.power || 0) - (a.power || 0));
    if (!q) return all;
    return all.filter(
      (p) =>
        (p.username || "").toLowerCase().includes(q) ||
        String(p.id).toLowerCase().includes(q) ||
        String(p.telegramId || "").includes(q) ||
        (COUNTRY_MAP[p.countryCode]?.name || "").toLowerCase().includes(q)
    );
  }, [players, query]);

  const sel = selId ? (players || []).find((p) => p.id === selId) : null;

  useEffect(() => {
    if (!selId) return undefined;
    let cancelled = false;
    setInfo(undefined);
    setSeen(0);
    setAdminLog([]);
    setLogLimit(20);
    setEditOpen(false);
    setMsg("");
    (async () => {
      const [i, sn, al] = await Promise.all([
        getJSON(PINFO_PREFIX + selId, true, null),
        storageGet(PSEEN_PREFIX + selId, true),
        getJSON(PALOG_PREFIX + selId, true, []),
      ]);
      if (cancelled) return;
      setInfo(i);
      setSeen(Number(sn) || 0);
      setAdminLog(al || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [selId]);

  const saveEdit = async () => {
    if (!sel) return;
    setBusy(true);
    const np = Math.max(0, Math.round(Number(power) || 0));
    const nc = Math.max(0, Math.round(Number(clicks) || 0));
    const npt = Math.max(0, Math.round(Number(pts) || 0));
    const updated = { ...sel, power: np, points: npt, totalClicks: nc };
    await storageSet(PLAYER_PREFIX + sel.id, JSON.stringify(updated), true);
    await adminLogAction(sel.id, `Адмін змінив Power ${fmt(sel.power || 0)} → ${fmt(np)}, Points ${fmt(sel.points || 0)} → ${fmt(npt)}, кліки ${fmt(sel.totalClicks || 0)} → ${fmt(nc)}`);
    if (me.id === sel.id && onSetPlayer) onSetPlayer(updated);
    setMsg("✓ Збережено");
    setEditOpen(false);
    setAdminLog(await getJSON(PALOG_PREFIX + sel.id, true, []));
    if (onRefreshGameData) await onRefreshGameData();
    setBusy(false);
  };

  const toggleBlock = async () => {
    if (!sel) return;
    setBusy(true);
    const blocked = !sel.blocked;
    const updated = { ...sel, blocked, blockedReason: blocked ? reason || "Заблоковано адміністрацією" : "" };
    await storageSet(PLAYER_PREFIX + sel.id, JSON.stringify(updated), true);
    await adminLogAction(sel.id, blocked ? `Адмін заблокував гравця: ${updated.blockedReason}` : "Адмін розблокував гравця");
    if (me.id === sel.id && onSetPlayer) onSetPlayer(updated);
    setMsg(blocked ? "⛔ Гравця заблоковано" : "✓ Гравця розблоковано");
    setAdminLog(await getJSON(PALOG_PREFIX + sel.id, true, []));
    if (onRefreshGameData) await onRefreshGameData();
    setBusy(false);
  };

  const sendMailToSel = async () => {
    if (!sel || !mBody.trim()) return;
    setBusy(true);
    try {
      await sendAdminMail(sel.id, mSubj.trim() || "Повідомлення від адміністрації", mBody.trim());
      await adminLogAction(sel.id, "Адмін надіслав лист: " + (mSubj.trim() || mBody.trim()).slice(0, 60));
      setMSubj("");
      setMBody("");
      setMsg("✓ Лист надіслано");
      setAdminLog(await getJSON(PALOG_PREFIX + sel.id, true, []));
    } catch (e) {
      setMsg("Не вдалося надіслати лист");
    }
    setBusy(false);
  };

  const togglePremium = async () => {
    if (!sel) return;
    setBusy(true);
    const has = !sel.hasPremiumPass;
    const updated = { ...sel, hasPremiumPass: has };
    await storageSet(PLAYER_PREFIX + sel.id, JSON.stringify(updated), true);
    await adminLogAction(sel.id, has ? "Адмін видав Premium Pass" : "Адмін забрав Premium Pass");
    if (me.id === sel.id && onSetPlayer) onSetPlayer(updated);
    setMsg(has ? "✓ Premium видано" : "✓ Premium забрано");
    setAdminLog(await getJSON(PALOG_PREFIX + sel.id, true, []));
    if (onRefreshGameData) await onRefreshGameData();
    setBusy(false);
  };

  const Row = ({ label, value }) => (
    <div className="cn-pl-row">
      <span className="cn-pl-label">{label}</span>
      <span className="cn-pl-value">{value === undefined || value === null || value === "" ? "—" : value}</span>
    </div>
  );

  if (sel) {
    const cur = info?.current;
    const country = COUNTRY_MAP[sel.countryCode];
    const lastSeen = Math.max(info?.lastSeen || 0, seen || 0);
    const logs = [...(info?.logs || []), ...adminLog].sort((a, b) => b.ts - a.ts);
    const history = [...(info?.history || [])].reverse();
    return (
      <div className="cn-settings cn-pl">
        <div className="cn-lb-header">
          <button className="cn-icon-btn" onClick={() => setSelId(null)} type="button" aria-label="Назад">
            <ChevronLeft size={18} />
          </button>
          <div className="cn-screen-title">{sel.username || "Гравець"}{sel.blocked ? " ⛔" : ""}</div>
          <div style={{ width: 34 }} />
        </div>
        {msg && <div className="cn-dev-status-msg">{msg}</div>}

        <div className="cn-pl-card">
          <div className="cn-pl-title">Профіль</div>
          <Row label="Ігровий нікнейм" value={sel.username} />
          <Row label="Telegram ID" value={sel.telegramId || info?.tgId} />
          <Row label="Telegram @username" value={info?.tgUsername ? "@" + info.tgUsername : ""} />
          <Row label="Ім'я в Telegram" value={info?.tgName} />
          <Row label="ID в грі" value={sel.id} />
          <Row label="Країна" value={country?.name} />
          <Row label="Power / кліки" value={`${fmt(sel.power || 0)} / ${fmt(sel.totalClicks || 0)}`} />
          <Row label="Premium Pass" value={sel.hasPremiumPass ? "Так" : "Ні"} />
          <Row label="Зареєстрований" value={fmtDateTime(sel.createdAt || info?.firstSeen)} />
          <Row label="Востаннє заходив" value={lastSeen ? `${fmtDateTime(lastSeen)} (${timeAgo(lastSeen)})` : ""} />
          {sel.blocked && <Row label="Блокування" value={sel.blockedReason || "Заблоковано"} />}
        </div>

        <div className="cn-pl-card">
          <div className="cn-pl-title">Поточне підключення</div>
          {info === undefined && <div className="cn-control-empty">Завантаження…</div>}
          {info === null && <div className="cn-control-empty">Даних ще немає: гравець не заходив після оновлення.</div>}
          {cur && (
            <>
              <Row label="IP-адреса" value={cur.ip} />
              <Row label="Провайдер / оператор" value={cur.isp || cur.org} />
              <Row label="Організація" value={cur.org && cur.org !== cur.isp ? cur.org : ""} />
              <Row label="ASN" value={cur.asn} />
              <Row label="Тип підключення" value={cur.type} />
              <Row label="Локація (за IP)" value={[cur.city, cur.region, cur.country].filter(Boolean).join(", ")} />
              <Row label="Пристрій" value={cur.device} />
              <Row label="Клієнт" value={cur.client} />
              <Row label="Екран" value={cur.screen} />
              <Row label="Мова" value={cur.lang} />
              <Row label="Часовий пояс" value={cur.tz} />
              <Row label="User-Agent" value={cur.ua} />
              <Row label="Оновлено" value={fmtDateTime(cur.ts)} />
            </>
          )}
        </div>

        <div className="cn-pl-card">
          <div className="cn-pl-title">Історія IP / пристроїв ({history.length})</div>
          {history.length === 0 && <div className="cn-control-empty">Змін поки немає</div>}
          {history.map((h, i) => (
            <div className="cn-pl-hist" key={h.ts + "_" + i}>
              <div className="cn-pl-hist-time">{fmtDateTime(h.ts)}</div>
              <div>{h.ip || "IP невідомий"} · {h.isp || "провайдер невідомий"}</div>
              <div className="cn-pl-sub">{[h.city, h.country].filter(Boolean).join(", ")} · {h.device} · {h.client}</div>
            </div>
          ))}
        </div>

        <div className="cn-pl-card">
          <div className="cn-pl-title">Логи ({logs.length})</div>
          {logs.length === 0 && <div className="cn-control-empty">Подій поки немає</div>}
          {logs.slice(0, logLimit).map((l, i) => (
            <div className={"cn-pl-log cn-pl-log--" + l.type} key={l.ts + "_" + i}>
              <span className="cn-pl-hist-time">{fmtDateTime(l.ts)}</span>
              <span>{l.text}</span>
            </div>
          ))}
          {logs.length > logLimit && (
            <button className="cn-dev-btn" type="button" onClick={() => setLogLimit((n) => n + 40)}>Показати ще</button>
          )}
        </div>

        <div className="cn-pl-card">
          <div className="cn-pl-title">Дії</div>
          {editOpen ? (
            <div className="cn-admin-edit-form">
              <label className="cn-admin-field-label">
                Power
                <input className="cn-admin-input" type="number" value={power} onChange={(e) => setPower(e.target.value)} />
              </label>
              <label className="cn-admin-field-label">
                Points
                <input className="cn-admin-input" type="number" value={pts} onChange={(e) => setPts(e.target.value)} />
              </label>
              <label className="cn-admin-field-label">
                Кількість кліків
                <input className="cn-admin-input" type="number" value={clicks} onChange={(e) => setClicks(e.target.value)} />
              </label>
              <div className="cn-admin-edit-actions">
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={saveEdit}>Зберегти</button>
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={() => setEditOpen(false)}>Скасувати</button>
              </div>
            </div>
          ) : (
            <>
              {!sel.blocked && (
                <input className="cn-admin-input" type="text" placeholder="Причина блокування (необов'язково)" value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
              <div className="cn-admin-edit-actions">
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={() => { setPower(String(Math.round(sel.power || 0))); setPts(String(Math.round(sel.points || 0))); setClicks(String(Math.round(sel.totalClicks || 0))); setEditOpen(true); }}>
                  Редагувати
                </button>
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={togglePremium}>
                  {sel.hasPremiumPass ? "Забрати Premium" : "Видати Premium"}
                </button>
                <button className={"cn-dev-btn" + (sel.blocked ? "" : " cn-dev-btn--danger")} type="button" disabled={busy} onClick={toggleBlock}>
                  {sel.blocked ? "Розблокувати" : "Заблокувати"}
                </button>
              </div>
              <div className="cn-admin-block-title" style={{ marginTop: 10 }}>Написати гравцеві</div>
              <input className="cn-admin-input" type="text" maxLength={80} placeholder="Тема" value={mSubj} onChange={(e) => setMSubj(e.target.value)} />
              <textarea className="cn-admin-input cn-changelog-textarea" rows={3} maxLength={1000} placeholder="Текст листа (прийде в Пошту → Від адміністрації)" value={mBody} onChange={(e) => setMBody(e.target.value)} />
              <button className="cn-dev-btn" type="button" disabled={busy || !mBody.trim()} onClick={sendMailToSel}>Надіслати лист</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="cn-settings cn-pl">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Гравці ({(players || []).length})</div>
        <div style={{ width: 34 }} />
      </div>
      <input
        className="cn-admin-input"
        type="text"
        placeholder="Пошук: нікнейм, Telegram ID, країна…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setLimit(50); }}
      />
      <div className="cn-dip-list" style={{ marginTop: 10 }}>
        {list.length === 0 && <div className="cn-lb-empty">Гравців не знайдено</div>}
        {list.slice(0, limit).map((p) => (
          <button className="cn-pl-item" key={p.id} type="button" onClick={() => { cnSfx.navSwitch(); setSelId(p.id); }}>
            <Flag code={p.countryCode} size={22} className="cn-country-badge--lg" />
            <span className="cn-pl-item-main">
              <span className="cn-pl-item-name">{p.username || p.id}{p.blocked ? " ⛔" : ""}</span>
              <span className="cn-pl-sub">TG: {p.telegramId || "—"} · {COUNTRY_MAP[p.countryCode]?.name || "—"}</span>
            </span>
            <span className="cn-pl-item-power">{fmt(p.power || 0)}</span>
            <ChevronRight size={16} />
          </button>
        ))}
        {list.length > limit && (
          <button className="cn-dev-btn" type="button" onClick={() => setLimit((n) => n + 50)}>Показати ще ({list.length - limit})</button>
        )}
      </div>
    </div>
  );
}

function SettingsScreen({ me, theme, onChangeTheme, onBack, onSetPlayer, wars, season, players, isLeader, mail, unreadCount, onRefreshMail, onRefreshGameData, onOpenTutorial, lang = "uk", onSetLanguage, maintenance, onSaveMaintenance }) {
  const [adminPlayersOpen, setAdminPlayersOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const statusTimerRef = useRef(null);

  /* --- Адмін-панель (лише SUPER_ADMIN_TG_ID) --- */
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminQuery, setAdminQuery] = useState("");
  const [adminEditId, setAdminEditId] = useState(null);
  const [adminEditPower, setAdminEditPower] = useState("");
  const [adminEditClicks, setAdminEditClicks] = useState("");
  const [adminBlockReason, setAdminBlockReason] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [bcNews, setBcNews] = useState("");
  const [bcSubj, setBcSubj] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcInfo, setBcInfo] = useState("");
  const [adminMsg, setAdminMsg] = useState("");
  const [adminSeasonDate, setAdminSeasonDate] = useState("");
  const [adminPassPrice, setAdminPassPrice] = useState("");
  const [adminPassPriceLoaded, setAdminPassPriceLoaded] = useState(false);
  const [adminMaintMsg, setAdminMaintMsg] = useState(maintenance.message || "");
  /* Список оновлень: вбудовані записи (changelog.js) + додані адміном (Supabase) */
  const [clStored, setClStored] = useState(null); // null = ще не завантажено
  const [clOpen, setClOpen] = useState(false);
  const [adminWars, setAdminWars] = useState(null);
  const [adminWarMsg, setAdminWarMsg] = useState("");
  const [adminWarBusy, setAdminWarBusy] = useState(false);
  const [clDate, setClDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [clTitle, setClTitle] = useState("");
  const [clText, setClText] = useState("");

  useEffect(() => {
    if (!adminOpen || !isSuperAdmin()) return;
    if (season?.startedAt) {
      const endsAt = season.startedAt + (season.durationDays || SEASON_DURATION_DAYS) * 24 * 60 * 60 * 1000;
      setAdminSeasonDate(new Date(endsAt).toISOString().slice(0, 10));
    }
    if (clStored === null) {
      loadChangelog().then((list) => setClStored(list));
    }
    if (!adminPassPriceLoaded) {
      storageGet(PREMIUM_PASS_PRICE_KEY, true).then((raw) => {
        setAdminPassPrice(raw ? String(JSON.parse(raw)) : "50");
        setAdminPassPriceLoaded(true);
      });
    }
  }, [adminOpen, season, adminPassPriceLoaded, clStored]);

  const reloadAdminWars = useCallback(async () => {
    setAdminWars(await loadActiveWars());
  }, []);
  useEffect(() => {
    if (adminOpen && isSuperAdmin()) reloadAdminWars();
  }, [adminOpen, reloadAdminWars]);

  const adminWarAction = async (fn, okText) => {
    setAdminWarBusy(true);
    try {
      await fn();
      setAdminWarMsg("✓ " + okText);
    } catch (err) {
      setAdminWarMsg("✗ " + (err?.message || "Помилка"));
    }
    await reloadAdminWars();
    if (onRefreshMail) onRefreshMail();
    if (onRefreshGameData) onRefreshGameData();
    setAdminWarBusy(false);
  };
  const skipWarPrep = (w) =>
    adminWarAction(async () => {
      const now = Date.now();
      await setJSON(WAR_PREFIX + w.id, { ...w, prepEnd: now, battleEnd: now + WAR_BATTLE_MS }, true);
    }, "Підготовку завершено, битва почалась");
  const endWarNow = (w) =>
    adminWarAction(async () => {
      await setJSON(WAR_PREFIX + w.id, { ...w, battleEnd: Date.now() - 1 }, true);
    }, "Війну завершено за поточним балансом (підсумки підрахує гра за кілька секунд)");
  const setWarWinner = (w, side) =>
    adminWarAction(async () => {
      await finalizeWar(w, players, side);
    }, `Переможець: ${COUNTRY_MAP[side === "att" ? w.attacker : w.defender]?.name || ""}`);

  const adminResults = useMemo(() => {
    if (!adminOpen || !adminPlayersOpen) return [];
    const q = adminQuery.trim().toLowerCase();
    const list = players || [];
    if (!q) return list.slice(0, 25);
    return list.filter((p) => (p.username || "").toLowerCase().includes(q) || p.id.toLowerCase().includes(q)).slice(0, 25);
  }, [adminOpen, adminPlayersOpen, adminQuery, players]);

  const startEditPlayer = (p) => {
    setAdminEditId(p.id);
    setAdminEditPower(String(Math.round(p.power || 0)));
    setAdminEditClicks(String(Math.round(p.totalClicks || 0)));
    setAdminBlockReason(p.blockedReason || "");
    setAdminMsg("");
  };

  const saveAdminPlayerEdit = async (p) => {
    setAdminBusy(true);
    const power = Math.max(0, Math.round(Number(adminEditPower) || 0));
    const totalClicks = Math.max(0, Math.round(Number(adminEditClicks) || 0));
    const updated = { ...p, power, totalClicks };
    await storageSet(PLAYER_PREFIX + p.id, JSON.stringify(updated), true);
    if (me.id === p.id && onSetPlayer) onSetPlayer(updated);
    setAdminMsg(`✓ Оновлено гравця ${p.username || p.id}`);
    setAdminEditId(null);
    if (onRefreshGameData) await onRefreshGameData();
    setAdminBusy(false);
  };

  const toggleBlockPlayer = async (p) => {
    setAdminBusy(true);
    const updated = { ...p, blocked: !p.blocked, blockedReason: !p.blocked ? adminBlockReason || "Заблоковано адміністрацією" : "" };
    await storageSet(PLAYER_PREFIX + p.id, JSON.stringify(updated), true);
    if (me.id === p.id && onSetPlayer) onSetPlayer(updated);
    setAdminMsg(updated.blocked ? `⛔ Гравця ${p.username || p.id} заблоковано` : `✓ Гравця ${p.username || p.id} розблоковано`);
    if (onRefreshGameData) await onRefreshGameData();
    setAdminBusy(false);
  };

  const saveSeasonEndDate = async () => {
    if (!adminSeasonDate) return;
    setAdminBusy(true);
    const startedAt = season?.startedAt || Date.now();
    const targetMs = new Date(adminSeasonDate + "T23:59:59").getTime();
    const durationDays = Math.max(1, Math.ceil((targetMs - startedAt) / (24 * 60 * 60 * 1000)));
    await saveGameStatePart({ season: { ...(season || EMPTY_GAME_STATE.season), startedAt, durationDays } });
    setAdminMsg("✓ Дату завершення сезону оновлено");
    if (onRefreshGameData) await onRefreshGameData();
    setAdminBusy(false);
  };

  const savePremiumPassPrice = async () => {
    const price = Math.max(1, Math.round(Number(adminPassPrice) || 0));
    setAdminBusy(true);
    try {
      /* Ціну змінює лише сервер після перевірки, що запит від адміна (Telegram initData). */
      const r = await fetch("/api/admin-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: window.Telegram?.WebApp?.initData || "", price }),
      });
      const d = await r.json().catch(() => ({}));
      setAdminMsg(r.ok && d.ok ? `✓ Вартість Premium Pass тепер ${d.price} ⭐` : `✗ ${d.error || "Не вдалося змінити ціну"}`);
    } catch {
      setAdminMsg("✗ Немає зв'язку із сервером");
    }
    setAdminBusy(false);
  };

  const toggleMaintenanceMode = async () => {
    setAdminBusy(true);
    const nextEnabled = !maintenance.enabled;
    await onSaveMaintenance({ enabled: nextEnabled, message: adminMaintMsg });
    setAdminMsg(nextEnabled ? "🛠 Технічний перерив увімкнено" : "✓ Технічний перерив вимкнено");
    setAdminBusy(false);
  };

  const changelogList = useMemo(
    () =>
      [...BUILTIN_CHANGELOG.map((e) => ({ ...e, builtin: true })), ...(clStored || [])].sort(
        (a, b) => String(b.date).localeCompare(String(a.date)) || (b.ts || 0) - (a.ts || 0)
      ),
    [clStored]
  );

  const publishAdminNews = async () => {
    const text = bcNews.trim();
    if (!text) return;
    setAdminBusy(true);
    try {
      await addNews(text.slice(0, 400), { admin: true });
      setBcNews("");
      setBcInfo("✓ Новину опубліковано (Світові новини → Від адміністрації)");
      onRefreshGameData && onRefreshGameData();
    } catch (e) {
      setBcInfo("Не вдалося опублікувати новину");
    }
    setAdminBusy(false);
  };
  const broadcastAdminMail = async () => {
    const body = bcBody.trim();
    if (!body) return;
    if (!window.confirm("Надіслати цей лист УСІМ гравцям?")) return;
    setAdminBusy(true);
    setBcInfo("Надсилаємо…");
    const list = (players || []).filter((p) => p && p.id);
    let ok = 0;
    for (let i = 0; i < list.length; i += 8) {
      const part = list.slice(i, i + 8);
      const res = await Promise.allSettled(part.map((p) => sendAdminMail(p.id, bcSubj.trim() || "Повідомлення від адміністрації", body)));
      ok += res.filter((r) => r.status === "fulfilled").length;
    }
    setBcBody("");
    setBcSubj("");
    setBcInfo(`✓ Надіслано ${ok} із ${list.length} гравців`);
    setAdminBusy(false);
  };

  const addChangelogEntry = async () => {
    const title = clTitle.trim();
    const text = clText.trim();
    if (!title || !text || !clDate) {
      setAdminMsg("✗ Заповни дату, назву й короткий опис");
      return;
    }
    setAdminBusy(true);
    const entry = { id: "cl_" + Date.now().toString(36), date: clDate, title, text, ts: Date.now() };
    const next = [...(clStored || []), entry];
    const ok = await saveChangelog(next);
    if (ok) {
      setClStored(next);
      setClTitle("");
      setClText("");
      setAdminMsg("✓ Оновлення додано до списку");
    } else {
      setAdminMsg("✗ Не вдалося зберегти оновлення");
    }
    setAdminBusy(false);
  };

  const removeChangelogEntry = async (id) => {
    setAdminBusy(true);
    const next = (clStored || []).filter((e) => e.id !== id);
    const ok = await saveChangelog(next);
    if (ok) {
      setClStored(next);
      setAdminMsg("✓ Запис видалено");
    } else {
      setAdminMsg("✗ Не вдалося видалити запис");
    }
    setAdminBusy(false);
  };

  const flashStatus = (msg) => {
    setStatusMsg(msg);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatusMsg(""), 2800);
  };

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countryQuery]);

  const devChangeCountry = async (code) => {
    setBusy(true);
    const updated = { ...me, countryCode: code };
    const ok = await storageSet(PLAYER_PREFIX + me.id, JSON.stringify(updated), true);
    onSetPlayer(updated);
    setCountryPickerOpen(false);
    setBusy(false);
    flashStatus(ok ? `✓ Країну змінено на ${COUNTRY_MAP[code]?.name || code}` : "✗ Помилка збереження");
  };

  const devBecomeLeader = async () => {
    setBusy(true);
    try {
      await setLeaderStorage(me.countryCode, me.id);
      await onRefreshGameData();
      flashStatus(
        storagePersistenceHealthy
          ? `✓ Тепер ти лідер ${COUNTRY_MAP[me.countryCode]?.name || me.countryCode}`
          : `✓ Тепер ти лідер ${COUNTRY_MAP[me.countryCode]?.name || me.countryCode} (лише в цій сесії — сховище недоступне)`
      );
    } catch (err) {
      flashStatus("✗ Помилка: " + (err?.message || "невідома"));
    }
    setBusy(false);
  };

  const devTestMessage = async () => {
    setBusy(true);
    try {
      await addMail(me.id, {
        type: "info",
        subject: "Тестове повідомлення",
        body: "Це тестове повідомлення, створене з Developer/Test панелі о " + new Date().toLocaleTimeString(),
      });
      if (onRefreshMail) await onRefreshMail();
      flashStatus("✓ Повідомлення створено — перевір Пошту");
    } catch (err) {
      flashStatus("✗ Помилка: " + (err?.message || "невідома"));
    }
    setBusy(false);
  };

  const devClearStorage = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      flashStatus("Натисни ще раз, щоб підтвердити скидання");
      return;
    }
    setBusy(true);
    try {
      await storageSet(PLAYER_PREFIX + me.id, JSON.stringify({ ...me, power: 0, points: 0, passBaseClicks: 0, totalClicks: 0, upg: {}, energy: MAX_ENERGY, lastEnergyTs: Date.now() }), true);
      await setJSON(MAIL_PREFIX + me.id, [], true);
      await saveWars([]);
      await saveAlliances([]);
      await saveAllianceRequests([]);
      await saveCityControl({});
    } catch {
      /* ignore */
    }
    if (onRefreshMail) await onRefreshMail();
    await onRefreshGameData();
    setConfirmClear(false);
    setBusy(false);
    flashStatus("✓ Дані скинуто");
  };

  if (adminPlayersOpen && isSuperAdmin()) {
    return (
      <AdminPlayersView
        players={players}
        me={me}
        onSetPlayer={onSetPlayer}
        onRefreshGameData={onRefreshGameData}
        onBack={() => setAdminPlayersOpen(false)}
      />
    );
  }

  return (
    <div className="cn-settings">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Налаштування</div>
        <div style={{ width: 34 }} />
      </div>

      <div className="cn-settings-section-title">
        <GameLogo size={14} /> {t(lang, "settings_language")}
      </div>
      <div className="cn-lang-grid">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            className={"cn-lang-btn" + (lang === l.code ? " cn-lang-btn--active" : "")}
            onClick={() => { cnSfx.toggle(); onSetLanguage && onSetLanguage(l.code); }}
          >
            <span className="cn-lang-flag">{l.flag}</span>
            <span className="cn-lang-label">{l.label}</span>
            {lang === l.code && <Check size={13} className="cn-lang-check" />}
          </button>
        ))}
      </div>

      <div className="cn-settings-section-title">
        <Compass size={14} /> {t(lang, "settings_help")}
      </div>
      <button className="cn-tutorial-replay-btn" type="button" onClick={() => { cnSfx.modalOpen(); onOpenTutorial(); }}>
        <MousePointerClick size={16} />
        <span>{t(lang, "settings_tutorial_replay")}</span>
        <ChevronRight size={16} />
      </button>

      {isSuperAdmin() && (
        <>
          <button className="cn-dev-toggle" type="button" onClick={() => { cnSfx.toggle(); setAdminOpen((o) => !o); }}>
            <ShieldCheck size={14} /> Адмін-панель
            <ChevronDown size={16} className={"cn-chevron" + (adminOpen ? " cn-chevron--open" : "")} />
          </button>

          {adminOpen && (
            <div className="cn-dev-panel">
              {adminMsg && <div className="cn-dev-status-msg">{adminMsg}</div>}

              <button className="cn-dev-toggle" type="button" onClick={() => { cnSfx.navSwitch(); setAdminPlayersOpen(true); }}>
                <Users size={14} /> Список гравців ({(players || []).length})
                <ChevronRight size={16} />
              </button>

              <div className="cn-admin-block-title" style={{ marginTop: 14 }}>Імунітет до лімітів часу</div>
              <div className="cn-admin-row">
                <div style={{ flex: 1, fontSize: 12, color: "var(--cn-text-dim)" }}>
                  {me.timeImmunity ? "УВІМКНЕНО: ігноруються кулдауни війни та заборона нападу" : "Вимкнено"}
                </div>
                <button
                  className="cn-dev-btn"
                  type="button"
                  disabled={adminBusy}
                  onClick={async () => {
                    setAdminBusy(true);
                    const updated = { ...me, timeImmunity: !me.timeImmunity };
                    await storageSet(PLAYER_PREFIX + me.id, JSON.stringify(updated), true);
                    if (onSetPlayer) onSetPlayer(updated);
                    setAdminMsg(updated.timeImmunity ? "✓ Імунітет до лімітів часу увімкнено" : "✓ Імунітет вимкнено");
                    setAdminBusy(false);
                  }}
                >
                  {me.timeImmunity ? "Вимкнути" : "Увімкнути"}
                </button>
              </div>

              <div className="cn-admin-block-title" style={{ marginTop: 14 }}>Дата завершення сезону</div>
              <div className="cn-admin-row">
                <input
                  className="cn-admin-input"
                  type="date"
                  value={adminSeasonDate}
                  onChange={(e) => setAdminSeasonDate(e.target.value)}
                />
                <button className="cn-dev-btn" type="button" disabled={adminBusy} onClick={saveSeasonEndDate}>
                  Зберегти
                </button>
              </div>

              <div className="cn-admin-block-title" style={{ marginTop: 14 }}>Вартість Premium Pass (⭐)</div>
              <div className="cn-admin-row">
                <input
                  className="cn-admin-input"
                  type="number"
                  min="1"
                  value={adminPassPrice}
                  onChange={(e) => setAdminPassPrice(e.target.value)}
                />
                <button className="cn-dev-btn" type="button" disabled={adminBusy} onClick={savePremiumPassPrice}>
                  Зберегти
                </button>
              </div>

              <div className="cn-admin-block-title" style={{ marginTop: 14 }}>Війни</div>
              {adminWarMsg && <div className="cn-dev-status-msg">{adminWarMsg}</div>}
              {adminWars === null && <div className="cn-control-empty">Завантаження…</div>}
              {adminWars && adminWars.length === 0 && <div className="cn-control-empty">Активних воєн немає</div>}
              {(adminWars || []).map((w) => {
                const phase = warPhase(w);
                const mine = warInvolves(w, me.countryCode);
                return (
                  <div className="cn-admin-player-row" key={w.id}>
                    <div className="cn-admin-player-head">
                      <span className="cn-admin-player-name">
                        {COUNTRY_MAP[w.attacker]?.name || w.attacker} → {COUNTRY_MAP[w.defender]?.name || w.defender}{mine ? " (твоя)" : ""}
                      </span>
                      <span className="cn-admin-player-sub">
                        {w.cityName} · {phase === "prep" ? "підготовка" : phase === "battle" ? "битва" : "завершується"}
                      </span>
                    </div>
                    <div className="cn-admin-edit-actions" style={{ flexWrap: "wrap" }}>
                      {phase === "prep" && (
                        <button className="cn-dev-btn" type="button" disabled={adminWarBusy} onClick={() => skipWarPrep(w)}>
                          Завершити підготовку
                        </button>
                      )}
                      {phase === "battle" && (
                        <button className="cn-dev-btn" type="button" disabled={adminWarBusy} onClick={() => endWarNow(w)}>
                          Завершити війну
                        </button>
                      )}
                      <button className="cn-dev-btn" type="button" disabled={adminWarBusy} onClick={() => setWarWinner(w, "att")}>
                        Переміг: атака
                      </button>
                      <button className="cn-dev-btn" type="button" disabled={adminWarBusy} onClick={() => setWarWinner(w, "def")}>
                        Переміг: захист
                      </button>
                    </div>
                  </div>
                );
              })}
              <button className="cn-dev-btn" type="button" disabled={adminWarBusy} onClick={reloadAdminWars} style={{ marginTop: 6 }}>
                Оновити список воєн
              </button>

              <button className="cn-dev-toggle" type="button" style={{ marginTop: 14 }} onClick={() => { cnSfx.toggle(); setClOpen((o) => !o); }}>
                <Newspaper size={14} /> Список оновлень
                <ChevronDown size={16} className={"cn-chevron" + (clOpen ? " cn-chevron--open" : "")} />
              </button>
              {clOpen && (<>
              <div className="cn-changelog-list">
                {clStored === null && <div className="cn-control-empty">Завантаження…</div>}
                {changelogList.map((e) => (
                  <div className="cn-changelog-item" key={e.id}>
                    <div className="cn-changelog-head">
                      <span className="cn-changelog-date">{new Date(e.date + "T12:00:00").toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" })}</span>
                      {!e.builtin && (
                        <button className="cn-dev-btn cn-dev-btn--danger cn-changelog-del" type="button" disabled={adminBusy} onClick={() => removeChangelogEntry(e.id)}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    <div className="cn-changelog-title">{e.title}</div>
                    <div className="cn-changelog-text">{e.text}</div>
                  </div>
                ))}
              </div>
              <div className="cn-changelog-form">
                <input className="cn-admin-input" type="date" value={clDate} onChange={(e) => setClDate(e.target.value)} />
                <input
                  className="cn-admin-input"
                  type="text"
                  maxLength={80}
                  placeholder="Назва оновлення"
                  value={clTitle}
                  onChange={(e) => setClTitle(e.target.value)}
                />
                <textarea
                  className="cn-admin-input cn-changelog-textarea"
                  maxLength={500}
                  rows={3}
                  placeholder="Короткий опис"
                  value={clText}
                  onChange={(e) => setClText(e.target.value)}
                />
                <button className="cn-dev-btn" type="button" disabled={adminBusy} onClick={addChangelogEntry}>
                  Додати оновлення
                </button>
              </div>
              </>)}

              <div className="cn-admin-block-title" style={{ marginTop: 14 }}>Світові новини від адміністрації</div>
              <div className="cn-changelog-form">
                <textarea className="cn-admin-input cn-changelog-textarea" rows={3} maxLength={400} placeholder="Текст новини" value={bcNews} onChange={(e) => setBcNews(e.target.value)} />
                <button className="cn-dev-btn" type="button" disabled={adminBusy || !bcNews.trim()} onClick={publishAdminNews}>Опублікувати в новини</button>
              </div>
              <div className="cn-admin-block-title" style={{ marginTop: 14 }}>Лист усім гравцям</div>
              <div className="cn-changelog-form">
                <input className="cn-admin-input" type="text" maxLength={80} placeholder="Тема" value={bcSubj} onChange={(e) => setBcSubj(e.target.value)} />
                <textarea className="cn-admin-input cn-changelog-textarea" rows={3} maxLength={1000} placeholder="Текст листа" value={bcBody} onChange={(e) => setBcBody(e.target.value)} />
                <button className="cn-dev-btn" type="button" disabled={adminBusy || !bcBody.trim()} onClick={broadcastAdminMail}>Розіслати всім</button>
                {bcInfo && <div className="cn-control-hint">{bcInfo}</div>}
              </div>
              <div className="cn-control-hint">Листа одному гравцеві можна написати в «Гравці» → вибрати гравця → «Написати гравцеві».</div>

              <div className="cn-admin-block-title" style={{ marginTop: 14 }}>
                Технічний перерив {maintenance.enabled ? "(зараз УВІМКНЕНО 🛠)" : "(зараз вимкнено)"}
              </div>
              <div className="cn-admin-row">
                <input
                  className="cn-admin-input"
                  type="text"
                  placeholder="Повідомлення для гравців (необов'язково)"
                  value={adminMaintMsg}
                  onChange={(e) => setAdminMaintMsg(e.target.value)}
                />
                <button
                  className="cn-dev-btn"
                  type="button"
                  disabled={adminBusy}
                  onClick={toggleMaintenanceMode}
                  style={maintenance.enabled ? { background: "#dc2626" } : undefined}
                >
                  {maintenance.enabled ? "Вимкнути" : "Увімкнути"}
                </button>
              </div>

              <div className="cn-admin-block-title">Тестові інструменти</div>
              {!storagePersistenceHealthy && (
                <div className="cn-dev-warning">
                  ⚠️ Хмарне сховище зараз недоступне. Усе працює в межах цієї сесії, але зміни можуть не зберегтися після перезавантаження.
                </div>
              )}
              <div className="cn-dev-status-row">
                <UserCog size={13} />
                Ти {isLeader ? <b className="cn-dev-status-yes">лідер {COUNTRY_MAP[me.countryCode]?.name}</b> : <span>не лідер</span>}
              </div>
              <div className="cn-dev-status-row">
                <Mail size={13} />
                Повідомлень: <b>{mail ? mail.length : 0}</b> (непрочитаних: <b>{unreadCount || 0}</b>)
              </div>

              {statusMsg && <div className="cn-dev-status-msg">{statusMsg}</div>}

              <div className="cn-dev-row">
                <span className="cn-dev-row-label">Країна</span>
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={() => setCountryPickerOpen((o) => !o)}>
                  Змінити
                </button>
              </div>
              {countryPickerOpen && (
                <div className="cn-country-dropdown cn-dev-country-dropdown">
                  <div className="cn-country-search-wrap">
                    <Search size={15} className="cn-country-search-icon" />
                    <input
                      className="cn-country-search"
                      placeholder="Пошук країни…"
                      value={countryQuery}
                      onChange={(e) => setCountryQuery(e.target.value)}
                    />
                  </div>
                  <div className="cn-country-dropdown-list">
                    {filteredCountries.map((c) => (
                      <button key={c.code} type="button" className="cn-country-dropdown-item" onClick={() => devChangeCountry(c.code)}>
                        <Flag code={c.code} size={18} className="cn-country-dropdown-flag" />
                        <span className="cn-country-dropdown-name">{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="cn-dev-row">
                <span className="cn-dev-row-label">Лідер країни</span>
                <button className="cn-dev-btn" type="button" disabled={busy || isLeader} onClick={devBecomeLeader}>
                  {isLeader ? "Ти вже лідер ✓" : "Стати лідером"}
                </button>
              </div>
              <div className="cn-dev-row">
                <span className="cn-dev-row-label">Тестове повідомлення</span>
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={devTestMessage}>
                  Створити
                </button>
              </div>
              <div className="cn-dev-row">
                <span className="cn-dev-row-label">Скинути дані гравця</span>
                <button
                  className={"cn-dev-btn cn-dev-btn--danger" + (confirmClear ? " cn-dev-btn--confirm" : "")}
                  type="button"
                  disabled={busy}
                  onClick={devClearStorage}
                >
                  <Trash2 size={13} /> {confirmClear ? "Підтвердити" : "Очистити"}
                </button>
              </div>

            </div>
          )}

        </>
      )}
    </div>
  );
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function MapScreen({ players, me, loading, onRefresh, nations, lang = "uk", pick = null, dip = null, isLeader = false, onUpdatePlayer = null }) {
  const [selected, setSelected] = useState(null); // { rid, name, ownerId }
  const [selectedCity, setSelectedCity] = useState(null); // { city, regionName, ownerId }
  const [leaderName, setLeaderName] = useState(null); // undefined = завантаження
  const mapRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState([]);
  const [wars, setWars] = useState([]);
  const [warsOpen, setWarsOpen] = useState(false);
  const [, setWarTick] = useState(0);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMsg, setClaimMsg] = useState(null); // { ok, text }
  useEffect(() => { setClaimMsg(null); }, [selected?.rid]);

  const countries = nations?.countries || [];
  const owners = nations?.owners || {};
  const myCountry = COUNTRY_MAP[me?.countryCode];

  /* Активні конфлікти: завантажуємо при вході, при оновленні та раз на хвилину */
  const loadWars = useCallback(async () => {
    try {
      const list = await loadActiveWars();
      setWars(list.filter((w) => warPhase(w) !== "finish").sort((a, b) => a.createdAt - b.createdAt));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    loadWars();
    const iv = visibleInterval(loadWars, 60000);
    const tk = setInterval(() => setWarTick((n) => n + 1), 15000);
    return () => {
      clearInterval(iv);
      clearInterval(tk);
    };
  }, [loadWars]);

  const runSearch = (q) => {
    setSearchQ(q);
    setSearchRes(mapRef.current ? mapRef.current.search(q, lang) : []);
  };
  const pickResult = (item) => {
    cnSfx.navSwitch();
    setSearchOpen(false);
    setSearchQ("");
    setSearchRes([]);
    if (mapRef.current) mapRef.current.goTo(item);
  };
  const flyToWar = async (w) => {
    try {
      const data = await loadCities();
      const c = data.list[w.cityId] || data.list.find((x) => cityKey(x) === w.cityKey);
      if (c && mapRef.current) mapRef.current.flyTo(c.x, c.y, 6.5);
    } catch {
      /* ignore */
    }
  };

  const stats = useMemo(() => {
    const power = {};
    const count = {};
    for (const p of players || []) {
      power[p.countryCode] = (power[p.countryCode] || 0) + (p.power || 0);
      count[p.countryCode] = (count[p.countryCode] || 0) + 1;
    }
    const ranked = countries
      .map((c) => ({ id: c.id, power: power[c.id] || 0 }))
      .sort((a, b) => b.power - a.power)
      .map((c, i) => [c.id, i + 1]);
    return { power, count, rank: Object.fromEntries(ranked) };
  }, [players, countries]);

  const selectedCountry = selected?.ownerId ? COUNTRY_MAP[selected.ownerId] : null;
  const kind = !selected ? null : !selected.ownerId ? "free" : selected.ownerId === me?.countryCode ? "own" : "occupied";
  const cityName = (c) => (lang === "uk" && c.u ? c.u : c.n);

  useEffect(() => {
    if (!selectedCountry) {
      setLeaderName(null);
      return;
    }
    let cancelled = false;
    setLeaderName(undefined);
    (async () => {
      const leaderId = selectedCountry.leaderId || (await getLeader(selectedCountry.id));
      if (cancelled) return;
      const p = (players || []).find((pl) => pl.id === leaderId);
      setLeaderName(p ? p.username : leaderId ? "Гравець" : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCountry?.id, players]); // eslint-disable-line react-hooks/exhaustive-deps

  const relTag = (() => {
    if (!dip || !selectedCountry || kind !== "occupied") return null;
    const r = dipRelation(dip, me.countryCode, selectedCountry.id);
    if (r.ally) return { text: "Союзник", cls: "ally" };
    if (r.pact) return { text: "Пакт про ненапад", cls: "pact" };
    if (r.truceUntil) return { text: "Заборона нападу " + fmtDuration(r.truceUntil - Date.now()), cls: "truce" };
    return null;
  })();
  const cityPickBtn =
    pick && pick.step === "city" && selectedCity && selected?.ownerId === pick.country ? (
      <button
        className="cn-primary-btn cn-map-pick-btn"
        type="button"
        onClick={() => pick.onPickCity({ id: selectedCity.city.i, name: cityName(selectedCity.city), rid: selectedCity.city.rid, key: cityKey(selectedCity.city) })}
      >
        <span className="cn-primary-btn-label">{pick.cityBtn ? pick.cityBtn(cityName(selectedCity.city)) : `⚔️ Напасти на ${cityName(selectedCity.city)}`}</span>
      </button>
    ) : pick && pick.step === "city" ? (
      <div className="cn-map-card-sub" style={{ marginTop: 8 }}>
        {pick.hint || `Обери місто країни «${COUNTRY_MAP[pick.country]?.name}»`}
      </div>
    ) : null;
  const pickBtn =
    pick && pick.step === "city" ? null : pick && selectedCountry && kind === "occupied" ? (
      <button className="cn-primary-btn cn-map-pick-btn" type="button" onClick={() => pick.onPick(selectedCountry.id)}>
        <span className="cn-primary-btn-label">Обрати: {selectedCountry.name}</span>
      </button>
    ) : pick && selected ? (
      <div className="cn-map-card-sub" style={{ marginTop: 8 }}>
        {kind === "own" ? "Це твоя країна" : "Обери територію іншої країни"}
      </div>
    ) : null;

  /* Захоплення вільної області: лише лідер, за Power, з паузою між захопленнями. */
  const claimFree = async (sel) => {
    if (!sel || claimBusy || !me) return;
    setClaimMsg(null);
    if (!isLeader) { cnSfx.error(); setClaimMsg({ ok: false, text: "Захоплювати території може лише лідер країни" }); return; }
    if ((me.power || 0) < FREE_CAPTURE_COST) { cnSfx.error(); setClaimMsg({ ok: false, text: `Потрібно ${fmt(FREE_CAPTURE_COST)} Power` }); return; }
    setClaimBusy(true);
    try {
      const cd = Number(await storageGet(CAPCD_PREFIX + me.countryCode, true)) || 0;
      if (cd > Date.now()) { cnSfx.error(); setClaimMsg({ ok: false, text: "Наступне захоплення через " + fmtDuration(cd - Date.now()) }); setClaimBusy(false); return; }
      const active = await loadActiveWars();
      if (active.some((w) => warInvolves(w, me.countryCode))) { cnSfx.error(); setClaimMsg({ ok: false, text: "Під час війни захоплювати вільні області не можна" }); setClaimBusy(false); return; }
      const fresh = await loadNations();
      if (fresh && fresh.owners[sel.rid]) {
        cnSfx.error(); setClaimMsg({ ok: false, text: "Цю область уже захопили" }); onRefresh && onRefresh(); setClaimBusy(false); return;
      }
      const res = await sbStorageInsertIfAbsent(TERRITORY_PREFIX + sel.rid, me.countryCode, true);
      if (res !== "ok") { cnSfx.error(); setClaimMsg({ ok: false, text: "Цю область уже захопили" }); onRefresh && onRefresh(); setClaimBusy(false); return; }
      await storageSet(CAPCD_PREFIX + me.countryCode, String(Date.now() + FREE_CAPTURE_CD_MS), true);
      onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, power: Math.max(0, (prev.power || 0) - FREE_CAPTURE_COST) }));
      const cn = COUNTRY_MAP[me.countryCode];
      pushNews(`🚩 ${cn?.flag || ""} ${cn?.name || me.countryCode} захопили вільну область «${sel.name}».`);
      cnSfx.purchase();
      setClaimMsg({ ok: true, text: `✓ Область «${sel.name}» тепер належить твоїй країні` });
      onRefresh && onRefresh();
    } catch (e) {
      cnSfx.error();
      setClaimMsg({ ok: false, text: "Не вдалося захопити область. Спробуй ще раз" });
    }
    setClaimBusy(false);
  };
  const claimBtn = (sel) =>
    !pick && me && kind === "free" && sel ? (
      <>
        <button className="cn-primary-btn cn-map-pick-btn" type="button" disabled={claimBusy} onClick={() => claimFree(sel)}>
          <span className="cn-primary-btn-label">🚩 Захопити область · {fmt(FREE_CAPTURE_COST)} Power</span>
        </button>
        {claimMsg && <div className={"cn-color-msg" + (claimMsg.ok ? " cn-color-msg--ok" : " cn-color-msg--err")} style={{ marginTop: 8 }}>{claimMsg.text}</div>}
      </>
    ) : null;

  const goToMine = () => {
    const rid = Object.keys(owners).find((r) => owners[r] === me?.countryCode);
    if (rid && mapRef.current) mapRef.current.flyToRid(rid);
  };

  return (
    <div className="cn-map-screen">
      <div className="cn-map-viewport-wrap">
        <div className="cn-map-top">
          {searchOpen ? (
            <div className="cn-map-search">
              <div className="cn-map-search-box">
                <Search size={15} />
                <input
                  autoFocus
                  type="text"
                  value={searchQ}
                  placeholder="Місто, область, країна, море…"
                  onChange={(e) => runSearch(e.target.value)}
                />
                <button type="button" aria-label="Закрити пошук" onClick={() => { setSearchOpen(false); setSearchQ(""); setSearchRes([]); }}>
                  <X size={15} />
                </button>
              </div>
              {searchQ.trim().length >= 2 && (
                <div className="cn-map-search-list">
                  {searchRes.length === 0 && <div className="cn-map-search-empty">Нічого не знайдено</div>}
                  {searchRes.map((r, i) => (
                    <button type="button" key={r.kind + i + r.label} className="cn-map-search-item" onClick={() => pickResult(r)}>
                      <b>{r.label}</b>
                      <small>{r.sub}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : pick ? (
            <div className="cn-map-pick-banner">
              <span>{pick.label}</span>
              <button type="button" className="cn-dev-btn" onClick={pick.onCancel}>Скасувати</button>
            </div>
          ) : (
            <>
              <div className="cn-map-title">{t(lang, "nav_map")}</div>
              <div className="cn-map-sub">{t(lang, "nn_map_hint")}</div>
            </>
          )}
        </div>
        <div className="cn-tmap-viewport">
          <TerritoryMap
            ref={mapRef}
            mode="view"
            owners={owners}
            countries={countries}
            myCountryId={me?.countryCode}
            selectedRid={selected?.rid}
            onSelectRegion={(r) => {
              setSelectedCity(null);
              setSelected((prev) => (prev?.rid === r.rid && prev?.ownerId === r.ownerId ? null : r));
            }}
            showCities
            tools={[
              { id: "search", label: "Пошук", svg: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', onClick: () => setSearchOpen((v) => !v) },
              { id: "refresh", label: "Оновити", svg: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', onClick: () => { onRefresh(); loadWars(); } },
            ]}
            cityOwners={nations?.cityOwners}
            selectedZoneOwner={selected?.ownerId || null}
            lang={lang}
            selectedCityId={selectedCity ? selectedCity.city.i : null}
            onSelectCity={(sel) => {
              setSelectedCity(sel);
              setSelected({ rid: sel.city.rid, name: sel.regionName, ownerId: sel.ownerId });
            }}
          />
        </div>
        {!selected && (
          <div className="cn-map-bottom">
      <div className="cn-conflicts">
        <button type="button" className="cn-conflicts-head" onClick={() => setWarsOpen((v) => !v)} aria-expanded={warsOpen}>
          <Swords size={15} />
          <span>Активні конфлікти</span>
          <b className={"cn-conflicts-count" + (wars.length ? " cn-conflicts-count--on" : "")}>{wars.length}</b>
          <ChevronRight size={16} className={"cn-conflicts-chev" + (warsOpen ? " cn-conflicts-chev--open" : "")} />
        </button>
        {warsOpen && (
          <div className="cn-conflicts-list">
            {wars.length === 0 && <div className="cn-conflicts-empty">Зараз немає активних війн</div>}
            {wars.map((w) => {
              const ph = warPhase(w);
              const left = ph === "prep" ? w.prepEnd - Date.now() : w.battleEnd - Date.now();
              return (
                <button type="button" key={w.id} className="cn-conflict-row" onClick={() => flyToWar(w)}>
                  <span className="cn-conflict-sides">
                    <Flag code={w.attacker} size={16} /> <span>{COUNTRY_MAP[w.attacker]?.name || w.attacker}</span>
                    <Swords size={12} className="cn-conflict-vs" />
                    <Flag code={w.defender} size={16} /> <span>{COUNTRY_MAP[w.defender]?.name || w.defender}</span>
                  </span>
                  <span className="cn-conflict-meta">
                    за {w.cityName} · {ph === "prep" ? "підготовка" : "битва"} · {fmtDuration(left)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
            <div className="cn-map-bottom-row">
              <MapLegend lang={lang} myColor={myCountry?.color} />
              <button className="cn-map-mine-pill" type="button" onClick={goToMine}>
                <Compass size={14} /> {t(lang, "nn_goto_mine")}
              </button>
            </div>
          </div>
        )}
        {selectedCity && selected && (
          <div className="cn-map-card cn-map-card--anim cn-city-card" key={"city" + selectedCity.city.i}>
            <button className="cn-map-card-close" onClick={() => { setSelectedCity(null); setSelected(null); }} type="button" aria-label="Закрити">
              <X size={14} />
            </button>
            <div className="cn-map-card-name">
              {cityName(selectedCity.city)}
              {selectedCity.city.cap === 2 && <span className="cn-map-card-tag">{t(lang, "nn_capital")}</span>}
              {selectedCity.city.cap === 1 && <span className="cn-map-card-tag cn-map-card-tag--soft">{t(lang, "nn_regional_center")}</span>}
            </div>
            <div className="cn-city-line">
              {selectedCountry ? (
                <>
                  {t(lang, "nn_controlled_by")}: <Flag code={selectedCountry.id} size={14} className="cn-country-badge--lg" /> <b>{selectedCountry.name}</b>
                </>
              ) : (
                t(lang, "nn_region_free_text")
              )}
            </div>
            <div className="cn-city-line">{t(lang, "nn_region")}: <b>{selected.name}</b></div>
            {!selectedCity.city.f && (
              <div className="cn-city-line">{t(lang, "nn_population")}: <b>{fmtPopulation(selectedCity.city.p)}</b></div>
            )}
            <div className="cn-city-importance">
              <span>{t(lang, "nn_importance")}</span>
              <span className="cn-city-importance-bar"><span style={{ width: selectedCity.city.imp + "%" }} /></span>
              <b>{selectedCity.city.imp}%</b>
            </div>
            {relTag && <div className={"cn-rel-tag cn-rel-tag--" + relTag.cls}>{relTag.text}</div>}
            {pick ? (
              pick.step === "city" ? cityPickBtn : pickBtn
            ) : kind === "free" ? (
              claimBtn(selected)
            ) : (
              <button className="cn-primary-btn cn-city-attack" type="button" disabled>
                <span className="cn-primary-btn-label">{t(lang, "nn_attack_soon")}</span>
              </button>
            )}
          </div>
        )}

        {selected && !selectedCity && (
          <div className="cn-map-card cn-map-card--anim" key={selected.rid}>
            <button className="cn-map-card-close" onClick={() => setSelected(null)} type="button" aria-label="Закрити">
              <X size={14} />
            </button>
            <div className="cn-map-card-name">
              {selected.name}
              {kind === "own" && <span className="cn-map-card-tag">{t(lang, "nn_legend_own")}</span>}
            </div>
            {kind === "free" && <div className="cn-map-card-sub">{t(lang, "nn_region_free_text")}</div>}
            {selectedCountry && (
              <>
                <div className="cn-map-card-country">
                  <Flag code={selectedCountry.id} size={22} className="cn-country-badge--lg" /> {selectedCountry.name}
                </div>
                <div className="cn-map-card-stats">
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">Country Power</span>
                    <span className="cn-map-card-stat-value">{fmt(stats.power[selectedCountry.id] || 0)}</span>
                  </div>
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">{t(lang, "nn_world_rank")}</span>
                    <span className="cn-map-card-stat-value">#{stats.rank[selectedCountry.id] || "—"}</span>
                  </div>
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">{t(lang, "lb_players")}</span>
                    <span className="cn-map-card-stat-value">{fmt(stats.count[selectedCountry.id] || 0)}</span>
                  </div>
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">{t(lang, "nn_leader")}</span>
                    <span className="cn-map-card-stat-value cn-map-card-stat-value--leader">
                      {leaderName === undefined ? "…" : leaderName || "—"}
                    </span>
                  </div>
                </div>
                {relTag && <div className={"cn-rel-tag cn-rel-tag--" + relTag.cls}>{relTag.text}</div>}
              </>
            )}
            {pick && pick.step === "city" ? cityPickBtn : pickBtn}
            {claimBtn(selected)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Season screen                                                       */
/* ------------------------------------------------------------------ */

function formatCountdown(ms) {
  if (ms <= 0) return "Сезон завершено";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  return `${days}д ${hours}г`;
}

function passRewardVisual(reward) {
  if (reward.type === "points") return { kind: "points" };
  if (reward.type === "banner") return { kind: "banner", img: reward.img, label: reward.label };
  if (reward.type === "icon") return { kind: "icon", img: reward.img, label: reward.label };
  if (reward.type === "title") return { kind: "title", label: reward.label };
  if (reward.type === "badge") return { kind: "badge", label: reward.label, Icon: reward.Icon };
  return { kind: "points" };
}

function PassRewardCell({ track, reward, unlockedLevel, claimed, hasPremium, onClaim }) {
  const isPremium = track === "premium";
  const reached = reward.level <= unlockedLevel;
  const needsPremium = isPremium && !hasPremium;
  const visual = passRewardVisual(reward);

  let content;
  if (visual.kind === "points") {
    content = (
      <>
        <span className="cn-pass-reward-icon">
          <Coins size={18} />
        </span>
        <span className="cn-pass-reward-amount">+{fmt(reward.amount)}</span>
        <span className="cn-pass-reward-label">Points</span>
      </>
    );
  } else if (visual.kind === "banner") {
    content = (
      <>
        <span className="cn-pass-reward-icon cn-pass-reward-icon--banner">
          <img src={visual.img} alt={visual.label} />
        </span>
        <span className="cn-pass-reward-label">{visual.label}</span>
      </>
    );
  } else if (visual.kind === "icon") {
    content = (
      <>
        <span className="cn-pass-reward-icon cn-pass-reward-icon--avatar">
          <img src={visual.img} alt={visual.label} />
        </span>
        <span className="cn-pass-reward-label">{visual.label}</span>
      </>
    );
  } else if (visual.kind === "title") {
    content = (
      <>
        <span className="cn-pass-reward-icon">
          <Sparkles size={18} />
        </span>
        <span className="cn-pass-reward-label">{visual.label}</span>
      </>
    );
  } else {
    const BIcon = visual.Icon || Award;
    content = (
      <>
        <span className="cn-pass-reward-icon">
          <BIcon size={18} />
        </span>
        <span className="cn-pass-reward-label">{visual.label}</span>
      </>
    );
  }

  return (
    <div
      className={
        "cn-pass-reward-cell" +
        (isPremium ? " cn-pass-reward-cell--premium" : " cn-pass-reward-cell--free") +
        (!reached ? " cn-pass-reward-cell--locked" : "") +
        (claimed ? " cn-pass-reward-cell--claimed" : "")
      }
    >
      {content}
      {claimed ? (
        <span className="cn-pass-reward-state cn-pass-reward-state--claimed">
          <Check size={13} /> Отримано
        </span>
      ) : needsPremium ? (
        <span className="cn-pass-reward-state cn-pass-reward-state--premium">
          <Crown size={12} /> Premium
        </span>
      ) : reached ? (
        <button className="cn-pass-reward-claim" type="button" onClick={onClaim}>
          Забрати
        </button>
      ) : (
        <span className="cn-pass-reward-state cn-pass-reward-state--locked">
          <Lock size={12} /> {fmt(PASS_LEVEL_THRESHOLDS[reward.level])} кл.
        </span>
      )}
    </div>
  );
}

function SeasonScreen({ season, me, onSetPlayer, onRefresh }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  if (!me) return null;

  const startedAt = season?.startedAt || now;
  const durationDays = season?.durationDays || SEASON_DURATION_DAYS;
  const seasonNumber = season?.seasonNumber || 1;
  const endsAt = startedAt + durationDays * 24 * 60 * 60 * 1000;
  const remaining = endsAt - now;

  const totalClicks = passClicks(me);
  const level = currentPassLevel(totalClicks);
  const nextThreshold = PASS_LEVEL_THRESHOLDS[Math.min(level + 1, PASS_MAX_LEVEL)];
  const prevThreshold = PASS_LEVEL_THRESHOLDS[level];
  const progressPct =
    level >= PASS_MAX_LEVEL
      ? 100
      : Math.max(0, Math.min(100, ((totalClicks - prevThreshold) / (nextThreshold - prevThreshold)) * 100));
  const clicksToNext = level >= PASS_MAX_LEVEL ? 0 : Math.max(0, nextThreshold - totalClicks);

  const freeClaimed = passClaimedList(me, "free");
  const premClaimed = passClaimedList(me, "premium");
  const hasClaimable =
    FREE_PASS_REWARDS.some((r) => r.level <= level && !freeClaimed.includes(r.level)) ||
    (me.hasPremiumPass && PREMIUM_PASS_REWARDS.some((r) => r.level <= level && !premClaimed.includes(r.level)));

  return (
    <div className="cn-season">
      <div className="cn-season-banner" data-tut="season-banner" style={{ backgroundImage: `url(${SEASON_BANNER_IMG})` }}>
        <div className="cn-season-banner-overlay" />
        <div className="cn-season-timer">
          <span className="cn-clock" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9.5" />
              <line className="cn-clock-hand cn-clock-hand--h" x1="12" y1="12" x2="12" y2="7.5" />
              <line className="cn-clock-hand cn-clock-hand--m" x1="12" y1="12" x2="12" y2="4.5" />
            </svg>
          </span>
          <span>ЗАЛИШИЛОСЬ: {formatCountdown(remaining)}</span>
        </div>
        <div className="cn-season-banner-text">
          <div className="cn-season-badge">СЕЗОН {seasonNumber}</div>
          <div className="cn-season-title">СХОДЖЕННЯ НАЦІЙ</div>
          <div className="cn-season-sub">Світ чекає, щоб його підкорили.</div>
        </div>
      </div>

      <div className="cn-pass-summary">
        <div className="cn-pass-summary-top">
          <div className="cn-pass-summary-level">
            <span className="cn-pass-summary-lvlnum">{level}</span>
            <span className="cn-pass-summary-lvltxt">Рівень<small> / {PASS_MAX_LEVEL}</small></span>
          </div>
          {hasClaimable && (
            <button
              className="cn-pass-claim-all-btn"
              type="button"
              onClick={() => claimAllPassRewards(me, onSetPlayer)}
            >
              <Gift size={13} /> Забрати все
            </button>
          )}
        </div>
        <div className="cn-pass-track-line">
          <div className="cn-pass-track-fill" style={{ width: progressPct + "%" }} />
        </div>
        <div className="cn-pass-summary-sub">
          <span>{Math.round(progressPct)}%</span>
          {level >= PASS_MAX_LEVEL
            ? "Прохід повністю пройдено!"
            : `До наступного рівня: ${fmt(clicksToNext)} кліків`}
        </div>
      </div>

      {!me.hasPremiumPass && (
        <div className="cn-pass-promo">
          <div className="cn-pass-promo-icon">
            <Crown size={20} />
          </div>
          <div className="cn-pass-promo-text">
            <div className="cn-pass-promo-title">PREMIUM PASS</div>
            <div className="cn-pass-promo-desc">2× Points, ексклюзивні аватарки, титули та банери</div>
          </div>
          <button
            className="cn-pass-buy-btn"
            type="button"
            onClick={async () => {
              const paid = await buyPremiumPass(me, onSetPlayer);
              if (paid) cnSfx.purchase();
            }}
          >
            <Crown size={13} /> Купити Premium Pass
          </button>
        </div>
      )}

      <div className="cn-pass-level-list-wrap">
        <div className="cn-pass-level-list" style={{ "--cn-pass-n": FREE_PASS_REWARDS.length }}>
          <span className="cn-pass-track-label cn-pass-track-label--premium cn-pass-track-label--row1"><Crown size={12} /> Premium нагороди</span>
          <span className="cn-pass-track-label cn-pass-track-label--free cn-pass-track-label--row4"><Gift size={12} /> Безкоштовні нагороди</span>
          {FREE_PASS_REWARDS.map((freeReward, idx) => {
            const premReward = PREMIUM_PASS_REWARDS[idx];
            const lvl = freeReward.level;
            const isMilestone = PASS_MILESTONE_LEVELS.includes(lvl);
            const isCurrent = lvl === level;
            return (
              <div
                key={lvl}
                className={
                  "cn-pass-level-col" +
                  (isMilestone ? " cn-pass-level-col--milestone" : "") +
                  (isCurrent ? " cn-pass-level-col--current" : "")
                }
              >
                <PassRewardCell
                  track="premium"
                  reward={premReward}
                  unlockedLevel={level}
                  claimed={premClaimed.includes(lvl)}
                  hasPremium={me.hasPremiumPass}
                  onClaim={() => claimPassReward(me, "premium", lvl, onSetPlayer)}
                />
                <div
                  className={
                    "cn-pass-level-badge" + (lvl <= level ? " cn-pass-level-badge--reached" : "")
                  }
                >
                  {lvl}
                </div>
                <PassRewardCell
                  track="free"
                  reward={freeReward}
                  unlockedLevel={level}
                  claimed={freeClaimed.includes(lvl)}
                  hasPremium={me.hasPremiumPass}
                  onClaim={() => claimPassReward(me, "free", lvl, onSetPlayer)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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

function ShopScreen({ onGoToSeason, me, onSetPlayer, isLeader, isAdvisor, onRefreshGameData }) {
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

function BottomNav({ tab, setTab, unreadMail, lang = "uk" }) {
  const [pending, setPending] = useState(null);
  useEffect(() => { setPending(null); }, [tab]);
  const shownTab = pending || tab;
  return (
    <nav className="cn-nav">
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

function GlobalStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      :root {
        --cn-panel-rgb: 13,25,46;
        --cn-border-rgb: 56,189,248;
        --cn-nav-rgb: 6,11,24;
        --cn-accent-rgb: 34,211,238;
        --cn-accent-bright: #7CF0FF;
      }

      /* Без синього підсвічування при тапі (глобус, кнопки меню) */
      .cn-root, .cn-root * {
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
      }
      .cn-root button, .cn-root [role="button"], .cn-globe-wrap, .cn-globe-wrap * , .cn-nav, .cn-nav * {
        -webkit-user-select: none; user-select: none; outline: none;
      }
      .cn-root button:focus, .cn-root button:focus-visible, .cn-globe-wrap:focus, .cn-globe-wrap:focus-visible { outline: none; }
      .cn-globe-svg, .cn-globe-svg * { -webkit-user-drag: none; pointer-events: none; }
      .cn-root {
        height: 100vh; height: var(--tg-viewport-stable-height, 100dvh);
        min-height: 0; overflow: hidden;
        width: 100%;
        position: relative;
        color: var(--cn-text);
        font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
        display: flex;
        justify-content: center;
      }
      .cn-root::before {
        content: "";
        position: fixed;
        inset: 0;
        z-index: 0;
        background-image: url('/img/bg-f12dcba3.jpg');
        background-size: cover;
        background-position: center top;
        background-repeat: no-repeat;
      }
      .cn-app { position: relative; z-index: 1; }

      .cn-app {
        width: 100%;
        max-width: 480px;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .cn-content {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: calc(10px + env(safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px)) 18px 6px;
      }

      .cn-content--anim { animation: cnTabIn 0.2s ease-out; }
      @keyframes cnTabIn { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
      @media (prefers-reduced-motion: reduce) { .cn-content--anim { animation: none; } }

      /* Boot */
      .cn-boot {
        position: relative; z-index: 1;
        min-height: 100vh;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        position: relative;
      }
      .cn-boot-glow {
        position: absolute;
        width: 260px; height: 260px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--cn-accent-rgb),0.25) 0%, transparent 70%);
        filter: blur(10px);
      }
      .cn-boot-icon { color: var(--cn-accent); filter: drop-shadow(0 0 12px rgba(var(--cn-accent-rgb),0.6)); animation: cn-pulse 2s ease-in-out infinite; }
      .cn-boot-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; letter-spacing: 0.12em; font-size: 15px; color: var(--cn-text); }
      .cn-boot-sub { font-size: 12px; color: var(--cn-text-dimmer); }
      @keyframes cn-pulse { 0%,100% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }

      /* Terms of service gate */
      .cn-tos-screen {
        position: relative; z-index: 1; min-height: 100vh; width: 100%;
        display: flex; align-items: center; justify-content: center; padding: 24px;
      }
      .cn-tos-glow {
        position: absolute; width: 320px; height: 320px; border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--cn-accent-rgb),0.2) 0%, transparent 70%);
        filter: blur(14px);
      }
      .cn-tos-card {
        position: relative; width: 100%; max-width: 420px; display: flex; flex-direction: column; align-items: center;
        text-align: center; gap: 12px; padding: 32px 24px; border-radius: 24px;
        background: rgba(var(--cn-panel-rgb),0.5); border: 1px solid rgba(var(--cn-accent-rgb),0.3);
              }
      .cn-tos-icon { color: var(--cn-accent); filter: drop-shadow(0 0 14px rgba(var(--cn-accent-rgb),0.6)); }
      .cn-tos-icon--dim { color: var(--cn-text-dimmer); filter: none; }
      .cn-tos-title {
        font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 22px; color: var(--cn-text);
        text-shadow: 0 0 20px rgba(var(--cn-accent-rgb),0.3);
      }
      .cn-tos-body { font-size: 13.5px; line-height: 1.6; color: var(--cn-text-dim); }
      .cn-tos-actions { width: 100%; display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
      .cn-tos-decline-btn {
        background: transparent; border: none; color: var(--cn-text-dimmer); font-size: 13px;
        padding: 8px; cursor: pointer;
      }
      .cn-tos-decline-btn:hover { color: var(--cn-text-dim); }

      /* Onboarding */
      .cn-onboard { position: relative; z-index: 1; padding: 28px 20px 40px; max-width: 480px; margin: 0 auto; width: 100%; max-height: 100%; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
      .cn-onboard-header {
        display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 28px; gap: 8px;
        padding: 28px 20px 24px; border-radius: 24px;
        background: rgba(var(--cn-panel-rgb),0.35); border: 1px solid rgba(var(--cn-accent-rgb),0.25);
              }
      .cn-onboard-icon { color: var(--cn-accent); filter: drop-shadow(0 0 16px rgba(var(--cn-accent-rgb),0.75)); margin-bottom: 2px; }
      .cn-onboard-title {
        font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 34px; line-height: 1.05;
        letter-spacing: 0.01em; color: #fff; text-shadow: 0 0 24px rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-onboard-sub { font-size: 13.5px; color: var(--cn-text-dim); margin-top: 2px; }
      .cn-field { margin-bottom: 22px; }
      .cn-label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--cn-text-dimmer); margin-bottom: 8px; font-weight: 700; }
      .cn-input-icon-wrap { position: relative; display: flex; align-items: center; }
      .cn-input-icon { position: absolute; left: 14px; color: var(--cn-text-dimmer); pointer-events: none; }
      .cn-input--icon { padding-left: 42px !important; }
      .cn-input {
        width: 100%; padding: 13px 14px; border-radius: 14px;
        background: rgba(3,8,20,0.75); border: 1px solid rgba(var(--cn-accent-rgb),0.5);
        color: var(--cn-text); font-size: 15px; outline: none; font-family: 'Inter', sans-serif;
        box-shadow: 0 0 16px rgba(var(--cn-accent-rgb),0.15);
      }
      .cn-input::placeholder { color: var(--cn-text-dimmer); }
      .cn-input:focus { border-color: var(--cn-accent); box-shadow: 0 0 0 3px rgba(var(--cn-accent-rgb),0.2); }
      .cn-field--picker { position: relative; }
      .cn-country-select {
        width: 100%; display: flex; align-items: center; justify-content: space-between;
        padding: 13px 14px; border-radius: 14px;
        background: rgba(3,8,20,0.75); border: 1px solid rgba(var(--cn-accent-rgb),0.25);
        color: var(--cn-text); font-size: 15px; font-family: 'Inter', sans-serif; cursor: pointer;
      }
      .cn-country-select-value { display: flex; align-items: center; gap: 10px; }
      .cn-country-select-flag { font-size: 20px; }
      .cn-select-icon { color: var(--cn-text-dimmer); flex-shrink: 0; }
      .cn-country-select-placeholder { color: var(--cn-text-dimmer); }
      .cn-chevron { color: var(--cn-text-dimmer); transition: transform 0.15s ease; flex-shrink: 0; }
      .cn-chevron--open { transform: rotate(180deg); color: var(--cn-accent); }
      .cn-picker-overlay { position: fixed; inset: 0; z-index: 40; background: transparent; }
      .cn-country-dropdown {
        position: absolute; top: calc(100% + 8px); left: 0; right: 0; z-index: 50;
        background: #0B1730; border: 1px solid rgba(var(--cn-accent-rgb),0.4); border-radius: 16px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.5); overflow: hidden;
      }
      .cn-country-search-wrap {
        display: flex; align-items: center; gap: 8px; padding: 10px 12px;
        border-bottom: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-country-search-icon { color: var(--cn-text-dimmer); flex-shrink: 0; }
      .cn-country-search {
        flex: 1; background: none; border: none; outline: none;
        color: var(--cn-text); font-size: 14px; font-family: 'Inter', sans-serif;
      }
      .cn-country-search::placeholder { color: var(--cn-text-dimmer); }
      .cn-country-dropdown-list { max-height: 260px; overflow-y: auto; padding: 6px; }
      .cn-country-dropdown-list--modal { max-height: 320px; }
      .cn-country-dropdown-item {
        width: 100%; display: flex; align-items: center; gap: 10px;
        padding: 10px 10px; border-radius: 10px; border: none; background: none;
        color: var(--cn-text); font-size: 14px; text-align: left; cursor: pointer;
      }
      .cn-country-dropdown-item:active { background: rgba(var(--cn-accent-rgb),0.1); }
      .cn-country-dropdown-item--active { background: rgba(var(--cn-accent-rgb),0.14); color: var(--cn-accent-bright); }
      .cn-country-dropdown-flag { font-size: 18px; flex-shrink: 0; }
      .cn-country-dropdown-empty { padding: 16px; text-align: center; color: var(--cn-text-dimmer); font-size: 13px; }
      .cn-primary-btn {
        width: 100%; padding: 17px 20px; border-radius: 16px; border: none;
        display: flex; align-items: center; justify-content: center; gap: 10px;
        background: linear-gradient(180deg, #4E9BFF 0%, #1E6DE8 55%, #1558C0 100%);
        color: #fff; font-weight: 700; font-size: 17px; letter-spacing: 0.01em;
        cursor: pointer; box-shadow: 0 0 28px rgba(var(--cn-accent-rgb),0.55), inset 0 1px 0 rgba(255,255,255,0.35);
        transition: opacity 0.15s ease, transform 0.1s ease;
      }
      .cn-primary-btn-emoji { font-size: 20px; }
      .cn-primary-btn-label { flex: 1; text-align: center; }
      .cn-primary-btn-chevron { opacity: 0.85; }
      .cn-primary-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }
      .cn-primary-btn:not(:disabled):active { transform: scale(0.98); }
      .cn-onboard-note {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        text-align: center; font-size: 12px; color: var(--cn-text-dim); margin-top: 14px;
      }
      .cn-onboard-note-icon { color: var(--cn-accent); flex-shrink: 0; }

      /* Clicker */
      .cn-clicker { display: flex; flex-direction: column; align-items: center; }
      .cn-clicker-topbar { width: 100%; display: flex; justify-content: center; margin-bottom: 10px; }
      .cn-country-pill {
        font-size: 14.5px; font-weight: 700; padding: 9px 20px; border-radius: 999px;
        background: rgba(6,16,34,0.7); border: 1.5px solid rgba(var(--cn-accent-rgb),0.5);
        color: #fff; letter-spacing: 0.01em; display: inline-flex; align-items: center; gap: 8px;
        box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.2);
      }
      .cn-power-block { text-align: center; margin: 4px 0 2px; }
      .cn-power-label {
        font-size: 13px; letter-spacing: 0.22em; color: #A9CBEF; font-weight: 700;
      }
      .cn-power-value-row { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 2px; }
      .cn-power-dots { color: var(--cn-accent); font-size: 16px; letter-spacing: 2px; opacity: 0.85; align-self: center; }
      .cn-power-icon { flex-shrink: 0; color: var(--cn-accent-bright, #7DD3FC); filter: drop-shadow(0 0 8px rgba(var(--cn-accent-rgb),0.6)); }
      .cn-power-icon--power { color: #38BDF8; filter: drop-shadow(0 0 8px rgba(56,189,248,0.65)); }
      .cn-power-icon--points { color: #FBBF24; filter: drop-shadow(0 0 8px rgba(251,191,36,0.6)); }
      .cn-power-value-row--points { margin-top: 0; }
      .cn-power-value {
        font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: clamp(38px, 7vh, 56px);
        color: #FFFFFF; text-shadow: 0 3px 0 rgba(2,8,22,0.55), 0 0 30px rgba(var(--cn-accent-rgb),0.55);
        line-height: 1.05;
      }

      .cn-globe-wrap {
        position: relative; width: clamp(150px, 31vh, 250px); height: clamp(150px, 31vh, 250px); margin: 8px 0 10px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; user-select: none; touch-action: manipulation;
        transition: transform 0.08s ease;
      }
      .cn-globe-wrap--pressed { transform: scale(0.96); }
      .cn-globe-wrap--shake { animation: cn-shake 0.35s ease; }
      .cn-globe-wrap--empty .cn-globe-svg { position: relative; z-index: 1; filter: saturate(0.4) brightness(0.75); }
      @keyframes cn-shake {
        0%,100% { transform: translateX(0); }
        25% { transform: translateX(-6px); }
        75% { transform: translateX(6px); }
      }
      .cn-globe-glow {
        position: absolute; inset: -20px; border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--cn-accent-rgb),0.35) 0%, rgba(var(--cn-accent-rgb),0.08) 45%, transparent 72%);
        filter: blur(4px);
        animation: cn-glow-breathe 3.4s ease-in-out infinite;
      }
      @keyframes cn-glow-breathe { 0%,100% { opacity: 0.7; } 50% { opacity: 1; } }
      .cn-globe-svg { width: 100%; height: 100%; position: relative; z-index: 1; filter: drop-shadow(0 0 18px rgba(var(--cn-accent-rgb),0.25)); }
      .cn-globe-lines { transform-box: fill-box; transform-origin: center; animation: cn-rotate 50s linear infinite; }
      .cn-globe-ring { animation: cn-ring-pulse 2.6s ease-in-out infinite; }
      @keyframes cn-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes cn-ring-pulse { 0%,100% { stroke-opacity: 0.5; } 50% { stroke-opacity: 1; } }

      .cn-ripple {
        position: absolute; z-index: 5; width: 14px; height: 14px; margin: -7px;
        border-radius: 50%; border: 2px solid rgba(var(--cn-accent-rgb),0.85);
        pointer-events: none; animation: cn-ripple-anim 0.6s ease-out forwards;
      }
      @keyframes cn-ripple-anim { from { transform: scale(0.4); opacity: 1; } to { transform: scale(4.2); opacity: 0; } }
      .cn-particle {
        position: absolute; z-index: 5; font-size: 15px; font-weight: 700; color: var(--cn-accent-bright);
        text-shadow: 0 0 10px rgba(var(--cn-accent-rgb),0.8);
        pointer-events: none; animation: cn-particle-anim 0.85s ease-out forwards;
      }
      @keyframes cn-particle-anim {
        0% { transform: translate(-50%,-50%) translateY(0); opacity: 1; }
        100% { transform: translate(-50%,-50%) translateY(-46px); opacity: 0; }
      }

      .cn-energy-block { width: 100%; max-width: 320px; display: flex; flex-direction: column; align-items: center; }
      .cn-en { --en1: #22D3EE; --en2: #34D399; --en-glow: rgba(34,211,238,0.5); }
      .cn-en--mid { --en1: #FBBF24; --en2: #F59E0B; --en-glow: rgba(251,191,36,0.5); }
      .cn-en--low { --en1: #F87171; --en2: #EF4444; --en-glow: rgba(239,68,68,0.55); }
      .cn-en-card {
        width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 14px 10px 10px; border-radius: 18px;
        background: linear-gradient(160deg, rgba(10,24,48,0.92), rgba(5,12,28,0.92));
        border: 1.5px solid rgba(255,255,255,0.1); box-shadow: 0 6px 18px rgba(0,0,0,0.35), 0 0 18px var(--en-glow);
      }
      .cn-en--low .cn-en-card { animation: cn-en-low 1.4s ease-in-out infinite; }
      @keyframes cn-en-low { 0%,100% { box-shadow: 0 6px 18px rgba(0,0,0,0.35), 0 0 10px var(--en-glow); } 50% { box-shadow: 0 6px 18px rgba(0,0,0,0.35), 0 0 26px var(--en-glow); } }
      .cn-en-icon {
        flex-shrink: 0; width: 40px; height: 40px; border-radius: 13px; display: flex; align-items: center; justify-content: center;
        color: #04101f; background: linear-gradient(145deg, var(--en1), var(--en2)); box-shadow: 0 0 14px var(--en-glow), inset 0 1px 0 rgba(255,255,255,0.5);
      }
      .cn-en-main { flex: 1; min-width: 0; }
      .cn-en-top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
      .cn-en-label { font-size: 10.5px; font-weight: 800; letter-spacing: 0.2em; color: rgba(255,255,255,0.6); }
      .cn-en-val { font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.65); }
      .cn-en-val b { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 800; color: #fff; }
      .cn-en-bar { position: relative; height: 12px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,0.07); box-shadow: inset 0 2px 5px rgba(0,0,0,0.5); }
      .cn-en-fill {
        position: relative; height: 100%; border-radius: 999px; transition: width 0.4s ease;
        background: linear-gradient(90deg, var(--en1), var(--en2)); box-shadow: 0 0 12px var(--en-glow);
        overflow: hidden;
      }
      .cn-en-fill::after {
        content: ""; position: absolute; top: 0; bottom: 0; width: 40%; left: -40%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent); animation: cn-en-shine 2.6s ease-in-out infinite;
      }
      @keyframes cn-en-shine { 0% { left: -40%; } 60%, 100% { left: 110%; } }
      .cn-en-ticks { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1.5px), rgba(4,12,26,0.55) calc(10% - 1.5px) 10%); }
      .cn-energy-empty-note {
        display: inline-flex; align-items: center; gap: 7px; align-self: center; margin-top: 8px;
        padding: 6px 14px; border-radius: 999px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em;
        color: #FDE9C4; background: linear-gradient(135deg, rgba(251,146,60,0.18), rgba(var(--cn-accent-rgb),0.14));
        border: 1px solid rgba(251,146,60,0.45); box-shadow: 0 0 14px rgba(251,146,60,0.18), inset 0 0 10px rgba(255,255,255,0.04);
        animation: cn-energy-note-in 0.3s ease, cn-energy-note-pulse 2s ease-in-out 0.3s infinite;
      }
      .cn-energy-empty-note b { color: #FBBF24; font-weight: 800; font-family: 'Space Grotesk', sans-serif; }
      .cn-energy-empty-ico { color: #FBBF24; flex-shrink: 0; }
      @keyframes cn-energy-note-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      @keyframes cn-energy-note-pulse { 0%,100% { box-shadow: 0 0 10px rgba(251,146,60,0.14); } 50% { box-shadow: 0 0 20px rgba(251,146,60,0.34); } }
      .cn-onboard-blocked-msg { color: #F87171; font-size: 12px; margin-top: 6px; text-align: center; }
      .cn-country-dropdown-item--disabled { opacity: 0.4; cursor: not-allowed; }
      .cn-admin-block-title { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 12px; color: #FDE68A; letter-spacing: 0.03em; margin-bottom: 6px; }
      .cn-admin-input {
        width: 100%; padding: 8px 10px; border-radius: 10px; margin-bottom: 8px;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
        color: #EAF2FF; font-size: 12.5px; font-family: inherit;
      }
      .cn-admin-row { display: flex; gap: 8px; align-items: center; }
      .cn-admin-row .cn-admin-input { margin-bottom: 0; flex: 1; }
      .cn-admin-player-list { display: flex; flex-direction: column; gap: 8px; max-height: 340px; overflow-y: auto; }
      .cn-admin-player-row { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 10px; }
      .cn-admin-player-head { display: flex; flex-direction: column; margin-bottom: 8px; }
      .cn-admin-player-name { font-weight: 700; font-size: 12.5px; color: #EAF2FF; }
      .cn-admin-player-sub { font-size: 10.5px; color: #8FA6C4; margin-top: 2px; }
      .cn-admin-edit-form { display: flex; flex-direction: column; gap: 4px; }
      .cn-admin-field-label { font-size: 10.5px; color: #8FA6C4; display: flex; flex-direction: column; gap: 3px; }
      .cn-admin-edit-actions { display: flex; gap: 8px; flex-wrap: wrap; }

      .cn-stats-row { margin-top: 22px; width: 100%; display: flex; justify-content: center; }
      .cn-pass-reward-icon--banner img { width: 44px; height: 26px; border-radius: 6px; object-fit: cover; display: block; }
      .cn-stat-chip {
        display: flex; align-items: center; gap: 16px;
        padding: 14px 26px; border-radius: 18px; min-width: 260px; justify-content: center;
        background: rgba(6,16,34,0.7); border: 1.5px solid rgba(var(--cn-accent-rgb),0.5);
        box-shadow: 0 0 16px rgba(var(--cn-accent-rgb),0.2);
      }
      .cn-stat-chip-body { display: flex; flex-direction: column; align-items: center; gap: 3px; }
      .cn-stat-chip-label { font-size: 12px; letter-spacing: 0.1em; color: #A9CBEF; font-weight: 700; text-transform: uppercase; }
      .cn-stat-chip-value { font-size: 24px; font-weight: 800; color: #FFFFFF; font-family: 'Space Grotesk', sans-serif; }
      .cn-stat-chip-dots {
        display: block; color: transparent; font-size: 0; flex-shrink: 0;
        width: 14px; height: 30px;
        background-image: radial-gradient(circle, rgba(var(--cn-accent-rgb),0.6) 1.4px, transparent 1.4px);
        background-size: 6px 6px; background-repeat: repeat;
      }

      /* Clicker top actions (news / daily rewards) */
      .cn-clicker-topbar { position: relative; }
      .cn-clicker-top-actions {
        position: absolute; right: 0; top: 0;
        display: flex; flex-direction: column; gap: 10px;
      }
      .cn-clicker-bottom-actions { display: flex; justify-content: center; gap: 12px; margin-top: 12px; }
      .cn-icon-tile {
        position: relative; width: 42px; height: 42px; border-radius: 14px;
        background: rgba(6,16,34,0.85); border: 1.5px solid rgba(var(--cn-accent-rgb),0.5);
        color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer;
        box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.25), inset 0 0 10px rgba(var(--cn-accent-rgb),0.08);
        transition: transform 0.12s ease;
      }
      .cn-icon-tile:active { transform: scale(0.94); }
      .cn-icon-btn-dot {
        position: absolute; top: -4px; right: -4px; width: 10px; height: 10px; border-radius: 50%;
        background: #F59E0B; border: 2px solid #050B18; box-shadow: 0 0 6px rgba(245,158,11,0.8);
      }

      /* Control panel */
      .cn-control-toggle {
        width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
        margin-top: 20px; padding: 12px; border-radius: 14px;
        background: rgba(var(--cn-panel-rgb),0.55); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        color: var(--cn-text); font-size: 13.5px; font-weight: 600; cursor: pointer;
      }
      .cn-control-toggle .cn-chevron { margin-left: auto; }
      .cn-control-panel {
        margin-top: 12px; padding: 16px; border-radius: 22px;
        background: linear-gradient(180deg, rgba(6,14,34,0.96), rgba(3,8,20,0.98));
        border: 1px solid rgba(var(--cn-accent-rgb),0.5);
        box-shadow: 0 0 0 1px rgba(var(--cn-accent-rgb),0.12), 0 0 26px rgba(var(--cn-accent-rgb),0.22), inset 0 0 30px rgba(var(--cn-accent-rgb),0.05);
      }
      .cn-control-header {
        display: flex; align-items: center; gap: 16px; margin-bottom: 16px;
        padding: 16px; border-radius: 16px;
        background: rgba(var(--cn-accent-rgb),0.05);
        border: 1px solid rgba(var(--cn-accent-rgb),0.35);
      }
      .cn-country-shape { filter: drop-shadow(0 0 8px rgba(var(--cn-accent-rgb),0.85)) drop-shadow(0 0 16px rgba(var(--cn-accent-rgb),0.4)); flex-shrink: 0; }
      .cn-country-shape path { fill: rgba(var(--cn-accent-rgb),0.28); stroke: var(--cn-accent-bright); stroke-width: 0.9; }
      .cn-country-shape-fallback { color: var(--cn-text-dim); }
      .cn-control-header-country {
        display: flex; align-items: center; gap: 10px;
        font-weight: 800; font-size: 20px; color: #F5F9FF; font-family: 'Space Grotesk', sans-serif;
      }
      .cn-control-header-power { font-size: 15px; color: var(--cn-text-dim); margin-top: 8px; }
      .cn-control-header-power-value { color: var(--cn-accent-bright); font-weight: 700; }
      .cn-control-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 4px; }
      .cn-control-btn {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 20px 4px;
        border-radius: 16px; background: rgba(var(--cn-accent-rgb),0.05); border: 1px solid rgba(var(--cn-accent-rgb),0.35);
        color: #E4ECFB; font-size: 13.5px; font-weight: 600; cursor: pointer; text-align: center;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .cn-control-btn-icon { color: var(--cn-accent-bright); filter: drop-shadow(0 0 6px rgba(var(--cn-accent-rgb),0.85)); }
      .cn-control-btn-emoji { font-size: 30px; filter: drop-shadow(0 0 6px rgba(var(--cn-accent-rgb),0.85)); }
      .cn-control-btn--active {
        border-color: var(--cn-accent-bright); background: rgba(var(--cn-accent-rgb),0.16); color: #fff;
        box-shadow: 0 0 16px rgba(var(--cn-accent-rgb),0.35);
      }
      .cn-control-subgrid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 8px;
        margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--cn-panel-border);
      }
      .cn-control-subbtn {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 12px 4px;
        border-radius: 12px; background: rgba(var(--cn-accent-rgb),0.04); border: 1px solid rgba(var(--cn-accent-rgb),0.25);
        color: #E4ECFB; font-size: 11.5px; font-weight: 600; cursor: pointer; text-align: center; line-height: 1.25;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .cn-control-subbtn--active {
        border-color: var(--cn-accent-bright); background: rgba(var(--cn-accent-rgb),0.14); color: #fff;
      }
      .cn-country-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .cn-country-bar-name { flex: 0 0 90px; font-size: 11.5px; color: var(--cn-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cn-country-bar-track { flex: 1; height: 10px; border-radius: 6px; background: rgba(var(--cn-accent-rgb),0.1); overflow: hidden; }
      .cn-country-bar-fill { height: 100%; background: linear-gradient(90deg, var(--cn-accent), var(--cn-accent-bright)); border-radius: 6px; }
      .cn-country-bar-value { flex: 0 0 auto; font-size: 11px; font-weight: 700; color: var(--cn-accent-bright); min-width: 46px; text-align: right; }
      .cn-control-section { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--cn-panel-border); }
      .cn-control-empty { font-size: 12.5px; color: var(--cn-text-dim); line-height: 1.5; text-align: center; padding: 10px 4px; }
      .cn-control-hint { font-size: 11px; color: var(--cn-text-dimmer); margin: 6px 0; }
      .cn-control-wip { display: flex; align-items: center; gap: 10px; color: var(--cn-text-dim); font-size: 12px; line-height: 1.5; padding: 6px 2px; }
      .cn-power-input-row { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; }
      .cn-power-input {
        flex: 1; text-align: center; padding: 9px; border-radius: 10px; background: rgba(var(--cn-panel-rgb),0.6);
        border: 1px solid rgba(var(--cn-accent-rgb),0.4); color: var(--cn-text); font-size: 15px; font-weight: 700;
      }

      /* Modal sheet (news / daily rewards) */
      .cn-modal-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.55); display: flex; align-items: flex-end; justify-content: center; }
      .cn-modal-sheet {
        width: 100%; max-width: 480px; max-height: 78vh; overflow-y: auto; background: var(--cn-bg2);
        border-radius: 20px 20px 0 0; border: 1px solid rgba(var(--cn-accent-rgb),0.4); padding: 16px 16px 24px;
      }
      .cn-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .cn-modal-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; color: var(--cn-text); font-family: 'Space Grotesk', sans-serif; }
      .cn-news-list { display: flex; flex-direction: column; gap: 8px; }
      .cn-news-item { padding: 11px 13px; border-radius: 12px; background: rgba(var(--cn-panel-rgb),0.5); border: 1px solid rgba(var(--cn-accent-rgb),0.4); }
      .cn-news-text { font-size: 13px; color: var(--cn-text); line-height: 1.5; }
      .cn-news-time { font-size: 10.5px; color: var(--cn-text-dimmer); margin-top: 4px; }
      .cn-rewards-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .cn-reward-cell {
        display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 4px;
        border-radius: 12px; background: rgba(var(--cn-panel-rgb),0.5); border: 1px dashed rgba(var(--cn-accent-rgb),0.35);
        color: var(--cn-text-dimmer); font-size: 10.5px;
      }

      /* Tutorial */
      .cn-tutorial-overlay {
        position: fixed; inset: 0; z-index: 80; background: rgba(2,6,16,0.82);
        display: flex; align-items: center; justify-content: center; padding: 18px;
              }
      .cn-tutorial-card {
        position: relative; width: 100%; max-width: 400px; max-height: calc(100dvh - 24px); overflow-y: auto; background: var(--cn-bg2);
        border: 1px solid rgba(var(--cn-accent-rgb),0.45); border-radius: 22px; padding: 44px 18px 18px;
        box-shadow: 0 0 30px rgba(var(--cn-accent-rgb),0.18); display: flex; flex-direction: column; align-items: center;
      }
      .cn-tutorial-skip {
        position: absolute; top: 12px; right: 12px; display: flex; align-items: center; gap: 4px;
        background: rgba(var(--cn-panel-rgb),0.6); border: 1px solid rgba(var(--cn-accent-rgb),0.3);
        color: var(--cn-text-dimmer); font-size: 11px; padding: 6px 10px; border-radius: 999px; cursor: pointer;
      }
      .cn-tutorial-portrait-wrap {
        position: relative; width: 190px; height: 190px; margin-top: -6px; flex-shrink: 0;
      }
      .cn-tutorial-frame {
        width: 100%; height: 100%; border-radius: 28px; overflow: hidden; padding: 2px;
        background: linear-gradient(135deg, rgba(var(--cn-accent-rgb),0.95), rgba(var(--cn-accent-rgb),0.2));
        box-shadow: 0 0 28px rgba(var(--cn-accent-rgb),0.35), 0 8px 24px rgba(0,0,0,0.45);
      }
      .cn-tutorial-portrait { width: 100%; height: 100%; object-fit: cover; border-radius: 26px; display: block; user-select: none; -webkit-user-drag: none; }
      .cn-tutorial-bubble {
        margin-top: 16px; width: 100%; background: rgba(var(--cn-panel-rgb),0.6);
        border: 1px solid rgba(var(--cn-accent-rgb),0.35); border-radius: 16px; padding: 14px 16px;
        position: relative;
      }
      .cn-tutorial-bubble::before {
        content: ""; position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
        width: 14px; height: 14px; background: rgba(var(--cn-panel-rgb),0.6);
        border-left: 1px solid rgba(var(--cn-accent-rgb),0.35); border-top: 1px solid rgba(var(--cn-accent-rgb),0.35);
        rotate: 45deg;
      }
      .cn-tutorial-title {
        font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px; color: var(--cn-text);
        margin-bottom: 6px;
      }
      .cn-tutorial-text { font-size: 13px; line-height: 1.55; color: var(--cn-text-dimmer); }
      .cn-tutorial-dots { display: flex; gap: 6px; margin-top: 16px; }
      .cn-tutorial-dot {
        width: 6px; height: 6px; border-radius: 50%; background: rgba(var(--cn-accent-rgb),0.25);
        transition: background 0.2s, width 0.2s;
      }
      .cn-tutorial-dot--active { background: var(--cn-accent-bright); width: 16px; border-radius: 4px; }
      .cn-tutorial-actions {
        display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 18px; gap: 10px;
      }
      .cn-tutorial-btn--ghost {
        display: flex; align-items: center; gap: 4px; background: transparent; border: none;
        color: var(--cn-text-dimmer); font-size: 13px; cursor: pointer; padding: 8px 4px;
      }
      .cn-tutorial-btn--next { flex: 1; max-width: 200px; margin-left: auto; }
      .cn-tutorial-replay-btn {
        display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; margin-bottom: 14px;
        background: rgba(var(--cn-panel-rgb),0.5); border: 1px solid rgba(var(--cn-accent-rgb),0.35);
        border-radius: 14px; color: var(--cn-text); font-size: 13px; cursor: pointer;
      }
      .cn-tutorial-replay-btn span:first-of-type { flex: 1; text-align: left; }

      @keyframes cnTutorialOverlayIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cnTutorialCardIn {
        from { opacity: 0; transform: translateY(18px) scale(0.94); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes cnTutorialBubbleIn {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes cnGlobyBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      @keyframes cnGlobyTilt { 0%,100% { rotate: -1.5deg; } 50% { rotate: 1.5deg; } }
      @keyframes cnGlobyPop { from { opacity: 0; transform: scale(0.88) rotate(-4deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
      @keyframes cnTutStar { 0%,100% { opacity: 0; transform: scale(0.4) rotate(0); } 40% { opacity: 1; transform: scale(1) rotate(45deg); } 70% { opacity: 0.6; } }
      @keyframes cnPortraitBreathe {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.035); }
      }
      @keyframes cnPortraitPop {
        from { opacity: 0; transform: scale(0.85) rotate(-3deg); }
        to { opacity: 1; transform: scale(1) rotate(0deg); }
      }
      @keyframes cnBtnPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(var(--cn-accent-rgb),0.45); }
        50% { box-shadow: 0 0 0 8px rgba(var(--cn-accent-rgb),0); }
      }
      @keyframes cnCaretBlink {
        0%, 49% { opacity: 1; }
        50%, 100% { opacity: 0; }
      }
      @keyframes cnSparkleFloat {
        0% { opacity: 0; transform: translateY(0) scale(0.4) rotate(0deg); }
        30% { opacity: 1; }
        100% { opacity: 0; transform: translateY(-38px) scale(1.1) rotate(90deg); }
      }

      .cn-tutorial-overlay { animation: cnTutorialOverlayIn 0.22s ease-out; }
      .cn-tutorial-card--enter { animation: cnTutorialCardIn 0.32s cubic-bezier(.2,.8,.2,1); }
      .cn-tutorial-bubble--enter { animation: cnTutorialBubbleIn 0.22s ease-out; cursor: pointer; }
      .cn-tutorial-name-tag {
        margin-top: 8px; font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase;
        color: var(--cn-text-dimmer); font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      }
      .cn-tutorial-caret {
        display: inline-block; width: 2px; height: 12px; background: var(--cn-accent-bright);
        margin-left: 2px; vertical-align: middle; animation: cnCaretBlink 0.8s step-start infinite;
      }
      .cn-tutorial-btn--pulse { animation: cnBtnPulse 2.2s ease-out infinite; }
      .cn-tutorial-spark {
        position: absolute; font-size: 14px; pointer-events: none; color: var(--cn-accent-bright);
        animation: cnSparkleFloat 1.6s ease-out infinite;
      }
      .cn-tutorial-spark::before { content: "✦"; }
      .cn-tutorial-spark-1 { top: -6px; left: 6px; animation-delay: 0s; }
      .cn-tutorial-spark-2 { top: 4px; right: -8px; animation-delay: 0.5s; }
      .cn-tutorial-spark-3 { bottom: -4px; left: 44%; animation-delay: 1s; }

      /* Tutorial: guided mode (spotlight + compact card) */
      .cn-tutorial-overlay--guided { background: transparent; padding: 12px; }
      .cn-tutorial-overlay--top { align-items: flex-start; }
      .cn-tutorial-overlay--bottom { align-items: flex-end; padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
      .cn-tutorial-overlay--dim { background: rgba(2,6,16,0.6); }
      .cn-tutorial-overlay--free { pointer-events: none; }
      .cn-tutorial-overlay--free .cn-tutorial-card { pointer-events: auto; }
      .cn-tut-spot {
        position: fixed; left: 0; top: 0; border-radius: 16px; pointer-events: none;
        box-shadow: 0 0 0 100vmax rgba(2,6,16,0.8); border: 2px solid var(--cn-accent-bright);
        transition: transform 0.28s ease; will-change: transform; backface-visibility: hidden;
      }
      .cn-tut-spot::after {
        content: ""; position: absolute; inset: -2px; border-radius: 16px; border: 2px solid #FBBF24;
        opacity: 0; animation: cnTutSpotPulse 1.6s ease-in-out infinite; will-change: opacity;
      }
      .cn-tut-arrow { position: fixed; left: 0; top: 0; width: 28px; height: 28px; pointer-events: none; z-index: 2; transition: transform 0.28s ease; will-change: transform; }
      .cn-tut-arrow::before {
        content: ""; position: absolute; left: 4px; top: 4px; width: 0; height: 0;
        border-left: 10px solid transparent; border-right: 10px solid transparent;
        filter: drop-shadow(0 0 6px rgba(251,191,36,0.9));
      }
      .cn-tut-arrow--up::before { border-bottom: 18px solid #FBBF24; animation: cnTutArrowUp 0.9s ease-in-out infinite; }
      .cn-tut-arrow--down::before { border-top: 18px solid #FBBF24; animation: cnTutArrowDown 0.9s ease-in-out infinite; }
      .cn-tutorial-card--compact {
        display: grid; grid-template-columns: 84px 1fr; gap: 6px 12px; align-items: start; padding: 14px;
        max-width: 430px; position: relative; z-index: 3; overflow: visible;
      }
      .cn-tutorial-card--compact .cn-tutorial-portrait-wrap { width: 84px; height: 84px; margin-top: 0; grid-row: 1 / span 2; }
      .cn-tutorial-card--compact .cn-tutorial-frame { border-radius: 18px; }
      .cn-tutorial-card--compact .cn-tutorial-portrait { border-radius: 16px; }
      .cn-tutorial-card--compact .cn-tutorial-name-tag { display: none; }
      .cn-tutorial-card--compact .cn-tutorial-bubble { margin-top: 0; padding: 10px 12px; min-height: 86px; grid-column: 2; grid-row: 1 / span 2; }
      .cn-tutorial-card--compact .cn-tutorial-bubble::before { display: none; }
      .cn-tutorial-card--compact .cn-tutorial-title { font-size: 14px; margin-bottom: 4px; }
      .cn-tutorial-card--compact .cn-tutorial-text { font-size: 12.5px; line-height: 1.5; }
      .cn-tutorial-card--compact .cn-tutorial-dots { grid-column: 1 / -1; justify-content: center; flex-wrap: wrap; margin-top: 6px; }
      .cn-tutorial-card--compact .cn-tutorial-actions { grid-column: 1 / -1; margin-top: 8px; }
      .cn-tutorial-card--compact .cn-tutorial-skip { top: -36px; right: 0; background: rgba(2,6,16,0.75); }
      .cn-tutorial-overlay--top .cn-tutorial-card--compact .cn-tutorial-skip { top: auto; bottom: -36px; }
      @keyframes cnTutSpotPulse {
        0%, 100% { opacity: 0; }
        50% { opacity: 1; }
      }
      @keyframes cnTutArrowUp { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
      @keyframes cnTutArrowDown { 0%,100% { transform: translateY(0); } 50% { transform: translateY(7px); } }

      .cn-box-tabs { display: flex; gap: 6px; margin: 0 0 12px; padding: 4px; background: rgba(var(--cn-panel-rgb),0.5); border: 1px solid rgba(var(--cn-accent-rgb),0.2); border-radius: 14px; }
      .cn-box-tab {
        flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 8px; border: none; border-radius: 10px;
        background: transparent; color: var(--cn-text-dimmer); font-size: 12.5px; font-weight: 600; cursor: pointer; transition: background 0.2s, color 0.2s;
      }
      .cn-box-tab--active { background: rgba(var(--cn-accent-rgb),0.22); color: var(--cn-text); }
      .cn-box-badge { min-width: 16px; padding: 0 5px; height: 16px; border-radius: 8px; background: #EF4444; color: #fff; font-size: 10px; line-height: 16px; text-align: center; }
      .cn-news-item--admin { border-left: 3px solid #FBBF24; }

      /* Season */
      .cn-season { display: flex; flex-direction: column; gap: 14px; }
      .cn-season-banner {
        position: relative; border-radius: 22px; overflow: hidden; aspect-ratio: 1200 / 508; width: 100%;
        background-size: cover; background-position: center; border: 1px solid rgba(var(--cn-accent-rgb),0.45);
        display: flex; flex-direction: column; justify-content: flex-end; box-shadow: 0 10px 30px rgba(0,0,0,0.4), 0 0 22px rgba(var(--cn-accent-rgb),0.15);
      }
      .cn-season-banner-overlay {
        position: absolute; inset: 0;
        background: linear-gradient(180deg, rgba(3,8,20,0.25) 0%, rgba(3,8,20,0) 30%, rgba(2,6,16,0.75) 80%, rgba(2,6,16,0.92) 100%);
      }
      .cn-season-timer {
        position: absolute; top: 12px; right: 12px; z-index: 2;
        display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px;
        background: rgba(4,10,24,0.8); border: 1px solid rgba(var(--cn-accent-rgb),0.5);
        color: #EAF4FF; font-size: 11.5px; font-weight: 700;       }
      .cn-clock { display: inline-flex; color: var(--cn-accent); animation: cn-clock-pulse 2s ease-in-out infinite; }
      .cn-clock-hand { transform-origin: 12px 12px; }
      .cn-clock-hand--m { animation: cn-clock-spin 6s linear infinite; }
      .cn-clock-hand--h { animation: cn-clock-spin 72s linear infinite; }
      @keyframes cn-clock-spin { to { transform: rotate(360deg); } }
      @keyframes cn-clock-pulse { 0%,100% { filter: drop-shadow(0 0 0 rgba(var(--cn-accent-rgb),0)); } 50% { filter: drop-shadow(0 0 5px rgba(var(--cn-accent-rgb),0.9)); } }
      .cn-season-timer svg { color: var(--cn-accent); flex-shrink: 0; }
      .cn-season-banner-text { position: relative; z-index: 2; padding: 14px 16px 16px; }
      .cn-season-badge {
        display: inline-block; font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; color: #fff;
        padding: 3px 10px; border-radius: 999px; background: rgba(var(--cn-accent-rgb),0.35);
        border: 1px solid rgba(var(--cn-accent-rgb),0.7);       }
      .cn-season-title {
        font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 24px; color: #fff;
        letter-spacing: 0.01em; text-shadow: 0 2px 10px rgba(0,0,0,0.6); margin-top: 2px;
      }
      .cn-season-sub { font-size: 12.5px; color: #C4D6EF; margin-top: 3px; }

      .cn-pass-buy-btn {
        display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 10px; border: none;
        background: linear-gradient(135deg, #FACC15, #F59E0B); color: #2A1B00; font-size: 12px; font-weight: 800;
        flex-shrink: 0; cursor: pointer; opacity: 1;
        box-shadow: 0 0 12px rgba(250,204,21,0.35);
      }
      .cn-pass-buy-btn:active { transform: scale(0.97); }
      .cn-pass-track-line { height: 9px; border-radius: 999px; background: rgba(255,255,255,0.1); position: relative; overflow: hidden; }
      .cn-pass-track-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #3B82F6, var(--cn-accent)); transition: width 0.3s ease; }

      /* Battle pass summary + level list */
      .cn-pass-summary {
        border-radius: 20px; padding: 14px 16px; border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        background: linear-gradient(165deg, rgba(var(--cn-accent-rgb),0.12), rgba(3,8,20,0.7));
        box-shadow: 0 6px 20px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 10px;
      }
      .cn-pass-summary-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .cn-pass-summary-level {
        font-family: 'Space Grotesk', sans-serif; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 10px;
      }
      .cn-pass-summary-lvlnum {
        min-width: 42px; height: 42px; padding: 0 8px; border-radius: 13px; display: inline-flex; align-items: center; justify-content: center;
        font-size: 20px; background: linear-gradient(135deg, #3B82F6, var(--cn-accent)); color: #06121F;
        box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.45);
      }
      .cn-pass-summary-lvltxt { font-size: 15px; }
      .cn-pass-summary-lvltxt small { font-size: 12px; color: var(--cn-text-dimmer); font-weight: 700; }
      .cn-pass-summary-sub { font-size: 11.5px; color: var(--cn-text-dimmer); display: flex; justify-content: space-between; gap: 8px; }
      .cn-pass-summary-sub span:first-child { color: var(--cn-accent-bright); font-weight: 800; }
      .cn-pass-claim-all-btn {
        display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 10px; border: none;
        background: rgba(var(--cn-accent-rgb),0.18); border: 1px solid rgba(var(--cn-accent-rgb),0.5);
        color: var(--cn-accent-bright); font-size: 11.5px; font-weight: 800; cursor: pointer; flex-shrink: 0;
      }
      .cn-pass-claim-all-btn:active { transform: scale(0.97); }

      .cn-pass-promo {
        display: flex; align-items: center; gap: 12px; border-radius: 18px; padding: 12px 14px;
        background: linear-gradient(165deg, rgba(120,84,10,0.4), rgba(28,20,4,0.75));
        border: 1px solid rgba(234,179,8,0.4);
      }
      .cn-pass-promo-icon {
        width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(234,179,8,0.18); border: 1px solid rgba(250,204,21,0.5); color: #FDE68A;
      }
      .cn-pass-promo-text { flex: 1; min-width: 0; }
      .cn-pass-promo-title { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 13px; color: #FDE68A; letter-spacing: 0.02em; }
      .cn-pass-promo-desc { font-size: 11px; color: #C4D6EF; margin-top: 2px; }

      .cn-pass-level-list-wrap { display: flex; flex-direction: column; gap: 6px; }
      .cn-pass-track-labels {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        font-size: 10px; font-weight: 800; color: var(--cn-text-dimmer); padding: 0 2px;
      }
      .cn-pass-track-label { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
      .cn-pass-track-label--premium { color: #FDE68A; }
      .cn-pass-level-list {
        display: grid; grid-template-columns: repeat(var(--cn-pass-n, 51), 76px); grid-template-rows: auto auto auto auto auto;
        column-gap: 8px; row-gap: 6px; overflow-x: auto; overflow-y: hidden;
        padding: 4px 2px 10px 2px; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch;
      }
      .cn-pass-level-list::-webkit-scrollbar { height: 5px; }
      .cn-pass-level-list::-webkit-scrollbar-thumb { background: rgba(var(--cn-accent-rgb),0.4); border-radius: 999px; }
      .cn-pass-level-col { display: contents; }
      .cn-pass-level-col > :nth-child(1) { grid-row: 2; }
      .cn-pass-level-col > :nth-child(2) { grid-row: 3; }
      .cn-pass-level-col > :nth-child(3) { grid-row: 5; }
      .cn-pass-track-label--row1, .cn-pass-track-label--row4 {
        grid-column: 1 / -1; justify-self: start; position: sticky; left: 2px; z-index: 1;
        padding: 3px 9px; border-radius: 999px; background: rgba(3,8,20,0.55); border: 1px solid rgba(148,163,184,0.2);
        font-size: 10px; font-weight: 800; letter-spacing: 0.02em;
      }
      .cn-pass-track-label--row1 { grid-row: 1; }
      .cn-pass-track-label--row4 { grid-row: 4; margin-top: 4px; color: #93C5FD; }
      .cn-pass-level-col--current .cn-pass-level-badge {
        box-shadow: 0 0 0 2px var(--cn-accent-bright), 0 0 10px rgba(var(--cn-accent-rgb),0.6);
      }
      .cn-pass-level-col--milestone .cn-pass-level-badge { color: var(--cn-accent-bright); }
      .cn-pass-level-badge {
        display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;
        color: #7C93B8; background: rgba(255,255,255,0.06); border-radius: 8px; height: 22px; flex-shrink: 0;
      }
      .cn-pass-level-badge--reached { background: rgba(var(--cn-accent-rgb),0.18); color: var(--cn-accent-bright); }
      .cn-pass-reward-cell {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
        border-radius: 12px; padding: 8px 4px; text-align: center; min-height: 84px; width: 100%;
        background: rgba(3,8,20,0.5); border: 1px dashed rgba(148,163,184,0.3); flex-shrink: 0;
      }
      .cn-pass-reward-cell--free { border-color: rgba(59,130,246,0.35); }
      .cn-pass-reward-cell--premium { border-color: rgba(234,179,8,0.35); }
      .cn-pass-reward-cell--locked { opacity: 0.55; }
      .cn-pass-reward-cell--claimed { border-style: solid; opacity: 0.9; }
      .cn-pass-reward-icon { color: var(--cn-text-dim); display: flex; align-items: center; justify-content: center; }
      .cn-pass-reward-icon--avatar img { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; display: block; }
      .cn-pass-reward-amount { font-size: 12.5px; font-weight: 800; color: #fff; }
      .cn-pass-reward-label { font-size: 9.5px; color: var(--cn-text-dimmer); line-height: 1.2; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-pass-reward-state {
        display: flex; align-items: center; gap: 3px; font-size: 9.5px; font-weight: 700; color: var(--cn-text-dimmer);
      }
      .cn-pass-reward-state--claimed { color: var(--cn-accent-bright); }
      .cn-pass-reward-state--premium { color: #FDE68A; }
      .cn-pass-reward-claim {
        margin-top: 2px; padding: 4px 10px; border-radius: 999px; border: none; cursor: pointer;
        background: linear-gradient(135deg, #3B82F6, var(--cn-accent)); color: #06121F;
        font-size: 10.5px; font-weight: 800; box-shadow: 0 0 10px rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-pass-reward-claim:active { transform: scale(0.95); }

      /* Shop */
      .cn-shop { display: flex; flex-direction: column; gap: 14px; min-height: 60vh; }
      .cn-shop-soon {
        margin-top: auto; text-align: center; padding: 20px 18px; border-radius: 20px; user-select: none; -webkit-user-select: none;
        background: linear-gradient(165deg, rgba(var(--cn-accent-rgb),0.14), rgba(3,8,20,0.6));
        border: 1px dashed rgba(var(--cn-accent-rgb),0.45);
      }
      .cn-shop-soon-ico { width: 46px; height: 46px; margin: 0 auto 10px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: var(--cn-accent-bright); background: rgba(var(--cn-accent-rgb),0.16); border: 1px solid rgba(var(--cn-accent-rgb),0.5); box-shadow: 0 0 18px rgba(var(--cn-accent-rgb),0.3); }
      .cn-shop-soon-title { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 16px; color: #fff; }
      .cn-shop-soon-text { font-size: 12px; line-height: 1.5; color: var(--cn-text-dim); margin-top: 6px; }
      .cn-shop-soon-dots { display: flex; justify-content: center; gap: 6px; margin-top: 12px; }
      .cn-shop-soon-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--cn-accent); opacity: 0.35; animation: cn-soon-dot 1.4s ease-in-out infinite; }
      .cn-shop-soon-dots i:nth-child(2) { animation-delay: 0.2s; } .cn-shop-soon-dots i:nth-child(3) { animation-delay: 0.4s; }
      @keyframes cn-soon-dot { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.4); } }
      .cn-term-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; padding: 16px; }
      .cn-term { width: 100%; max-width: 440px; border-radius: 14px; overflow: hidden; background: #020a06; border: 1px solid rgba(74,222,128,0.5); box-shadow: 0 0 30px rgba(74,222,128,0.25), inset 0 0 40px rgba(0,60,20,0.35); font-family: 'Courier New', ui-monospace, monospace; }
      .cn-term-bar { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: #06160d; border-bottom: 1px solid rgba(74,222,128,0.3); }
      .cn-term-dot { width: 10px; height: 10px; border-radius: 50%; } .cn-term-dot--r { background: #ef4444; } .cn-term-dot--y { background: #eab308; } .cn-term-dot--g { background: #22c55e; }
      .cn-term-title { flex: 1; text-align: center; font-size: 11px; color: #86efac; opacity: 0.8; }
      .cn-term-min { background: transparent; border: 1px solid rgba(74,222,128,0.5); color: #4ade80; border-radius: 6px; width: 26px; height: 20px; cursor: pointer; line-height: 1; }
      .cn-term-body { height: 300px; overflow-y: auto; padding: 12px; font-size: 13px; line-height: 1.5; color: #4ade80; text-shadow: 0 0 6px rgba(74,222,128,0.5); background: repeating-linear-gradient(180deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px); }
      .cn-term-line { word-break: break-word; }
      .cn-term-line--dim { color: #22804a; } .cn-term-line--cmd { color: #bbf7d0; } .cn-term-line--ok { color: #4ade80; font-weight: 700; }
      .cn-term-line--err { color: #f87171; text-shadow: 0 0 6px rgba(248,113,113,0.5); } .cn-term-line--warn { color: #fbbf24; }
      .cn-term-form { display: flex; align-items: center; gap: 6px; }
      .cn-term-prompt { color: #4ade80; }
      .cn-term-input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: #bbf7d0; font: inherit; caret-color: #4ade80; }
      .cn-shop-card {
        border-radius: 20px; overflow: hidden; border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        background: rgba(3,8,20,0.5); box-shadow: 0 0 20px rgba(var(--cn-accent-rgb),0.15);
      }
      .cn-shop-banner-img { display: block; width: 100%; height: auto; }
      .cn-shop-more-btn {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: calc(100% - 28px); margin: 14px; padding: 13px; border-radius: 14px; border: none;
        background: linear-gradient(135deg, #3B82F6, var(--cn-accent)); color: #06121F;
        font-size: 14.5px; font-weight: 800; letter-spacing: 0.01em; cursor: pointer;
        box-shadow: 0 0 16px rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-shop-more-btn:active { transform: scale(0.98); }

      /* Premium offer (вітрина магазину) */
      .cn-offer { display: flex; flex-direction: column; gap: 12px; }
      .cn-offer-hero { position: relative; border-radius: 22px; overflow: hidden; border: 1px solid rgba(250,204,21,0.55); box-shadow: 0 10px 30px rgba(0,0,0,0.4), 0 0 26px rgba(250,204,21,0.25); }
      .cn-offer-img { display: block; width: 100%; height: auto; animation: cn-offer-zoom 14s ease-in-out infinite alternate; transform-origin: 60% 60%; }
      @keyframes cn-offer-zoom { from { transform: scale(1); } to { transform: scale(1.07); } }
      .cn-offer-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(3,8,20,0.35) 0%, rgba(3,8,20,0) 32%, rgba(3,8,20,0.88) 100%); }
      .cn-offer-badge { position: absolute; top: 12px; left: 12px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: #2A1B00; background: linear-gradient(135deg, #FDE68A, #F59E0B); box-shadow: 0 0 16px rgba(250,204,21,0.55); }
      .cn-offer-hero-text { position: absolute; left: 14px; right: 14px; bottom: 12px; }
      .cn-offer-title { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 22px; color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,0.8); }
      .cn-offer-sub { margin-top: 3px; font-size: 12px; line-height: 1.4; color: #E6F0FF; text-shadow: 0 1px 6px rgba(0,0,0,0.9); }
      .cn-offer-spark { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #FDE68A; box-shadow: 0 0 10px 3px rgba(250,204,21,0.8); opacity: 0; animation: cn-offer-twinkle 3.2s ease-in-out infinite; }
      .cn-offer-spark--1 { left: 58%; top: 58%; } .cn-offer-spark--2 { left: 70%; top: 50%; animation-delay: 0.8s; } .cn-offer-spark--3 { left: 64%; top: 66%; animation-delay: 1.6s; } .cn-offer-spark--4 { left: 52%; top: 48%; animation-delay: 2.3s; }
      @keyframes cn-offer-twinkle { 0%,100% { opacity: 0; transform: scale(0.4); } 50% { opacity: 1; transform: scale(1.2); } }
      .cn-offer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .cn-offer-card { display: flex; flex-direction: column; gap: 8px; padding: 11px 11px 10px; border-radius: 16px; background: linear-gradient(165deg, rgba(120,84,10,0.28), rgba(3,8,20,0.7)); border: 1px solid rgba(250,204,21,0.3); min-width: 0; }
      .cn-offer-card-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: #FDE68A; letter-spacing: 0.02em; }
      .cn-offer-card-sub { font-size: 10.5px; line-height: 1.35; color: var(--cn-text-dim); margin-top: auto; }
      .cn-offer-bars { display: flex; flex-direction: column; gap: 7px; }
      .cn-offer-bar-row { display: grid; grid-template-columns: 44px 1fr; grid-template-rows: auto auto; column-gap: 6px; row-gap: 1px; align-items: center; font-size: 9.5px; color: var(--cn-text-dim); }
      .cn-offer-bar-row em { grid-column: 2; font-style: normal; font-size: 10px; font-weight: 800; color: #fff; }
      .cn-offer-bar { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.1); overflow: hidden; display: block; }
      .cn-offer-bar-fill { display: block; height: 100%; border-radius: 999px; transform-origin: left; }
      .cn-offer-bar-fill--free { width: 50%; background: linear-gradient(90deg, #3B82F6, #60A5FA); animation: cn-offer-grow-free 4s ease-in-out infinite; }
      .cn-offer-bar-fill--prem { width: 100%; background: linear-gradient(90deg, #F59E0B, #FDE68A); box-shadow: 0 0 10px rgba(250,204,21,0.6); animation: cn-offer-grow-prem 4s ease-in-out infinite; }
      @keyframes cn-offer-grow-free { 0% { transform: scaleX(0); } 35%, 85% { transform: scaleX(1); } 100% { transform: scaleX(1); opacity: 0.4; } }
      @keyframes cn-offer-grow-prem { 0% { transform: scaleX(0); } 70%, 85% { transform: scaleX(1); } 100% { transform: scaleX(1); opacity: 0.4; } }
      .cn-offer-nick { font-family: 'Space Grotesk', sans-serif; font-size: 20px; text-align: center; padding: 8px 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-offer-nick .cn-nick-fx { animation-duration: 3s; }
      .cn-offer-dots { display: flex; justify-content: center; gap: 5px; }
      .cn-offer-dots i { width: 11px; height: 11px; border-radius: 50%; display: block; animation: cn-offer-dot 2.4s ease-in-out infinite; }
      .cn-offer-dots i:nth-child(2n) { animation-delay: 0.3s; } .cn-offer-dots i:nth-child(3n) { animation-delay: 0.6s; }
      @keyframes cn-offer-dot { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.2); } }
      .cn-offer-avatars { display: flex; justify-content: center; gap: 6px; padding: 4px 0; }
      .cn-offer-ava { position: relative; width: 38px; height: 38px; border-radius: 50%; overflow: hidden; border: 2px solid #FACC15; box-shadow: 0 0 10px rgba(250,204,21,0.5); animation: cn-offer-bob 2.2s ease-in-out infinite; display: block; }
      .cn-offer-ava img { width: 100%; height: 100%; object-fit: cover; display: block; }
      @keyframes cn-offer-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
      .cn-offer-banners { position: relative; height: 56px; border-radius: 10px; overflow: hidden; border: 1px solid rgba(250,204,21,0.35); }
      .cn-offer-banner { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; animation: cn-offer-fade 7.5s ease-in-out infinite; }
      .cn-offer-banner--0 { animation-delay: 0s; } .cn-offer-banner--1 { animation-delay: 2.5s; } .cn-offer-banner--2 { animation-delay: 5s; }
      @keyframes cn-offer-fade { 0% { opacity: 0; } 8%, 30% { opacity: 1; } 40%, 100% { opacity: 0; } }
      .cn-offer-lb { padding: 11px 12px; border-radius: 16px; background: linear-gradient(165deg, rgba(120,84,10,0.28), rgba(3,8,20,0.7)); border: 1px solid rgba(250,204,21,0.3); display: flex; flex-direction: column; gap: 8px; }
      .cn-offer-lb-label { font-size: 12px; font-weight: 800; color: #FDE68A; }
      .cn-offer-lb-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 13px; background: linear-gradient(90deg, rgba(250,204,21,0.22), rgba(250,204,21,0.06)); border: 1px solid rgba(250,204,21,0.55); animation: cn-offer-glow 2.6s ease-in-out infinite; }
      @keyframes cn-offer-glow { 0%,100% { box-shadow: 0 0 6px rgba(250,204,21,0.2); } 50% { box-shadow: 0 0 18px rgba(250,204,21,0.55); } }
      .cn-offer-lb-rank { width: 20px; text-align: center; font-weight: 800; color: #FCD34D; }
      .cn-offer-lb-ava { position: relative; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #EAF6FF; background: rgba(6,14,32,0.9); border: 2px solid #FACC15; }
      .cn-offer-lb-crown { position: absolute; top: -9px; left: 50%; margin-left: -5px; color: #FACC15; filter: drop-shadow(0 0 4px rgba(250,204,21,0.9)); animation: cn-offer-bob 2s ease-in-out infinite; }
      .cn-offer-lb-name { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-offer-lb-val { font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #FDE68A; font-size: 13px; }
      .cn-offer-cta { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 15px; border: none; border-radius: 16px; cursor: pointer; font-size: 16px; font-weight: 800; color: #2A1B00; background: linear-gradient(135deg, #FDE68A, #F59E0B); box-shadow: 0 0 22px rgba(250,204,21,0.5); animation: cn-offer-pulse 2.2s ease-in-out infinite; }
      .cn-offer-cta:active { transform: scale(0.98); }
      .cn-offer-cta--owned { background: linear-gradient(135deg, #34D399, #059669); color: #03150E; box-shadow: 0 0 16px rgba(52,211,153,0.4); animation: none; }
      .cn-offer-price { margin-left: 6px; padding: 2px 9px; border-radius: 999px; font-size: 13px; background: rgba(42,27,0,0.18); }
      .cn-offer-cta-shine { position: absolute; top: 0; bottom: 0; width: 40%; left: -50%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.55), transparent); transform: skewX(-20deg); animation: cn-offer-sweep 3.2s ease-in-out infinite; pointer-events: none; }
      @keyframes cn-offer-sweep { 0% { left: -50%; } 55%, 100% { left: 130%; } }
      @keyframes cn-offer-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.015); } }
      @media (prefers-reduced-motion: reduce) { .cn-offer *, .cn-offer { animation: none !important; } .cn-offer-banner--0 { opacity: 1; } }

      /* Premium Pass modal */
      .cn-premium-modal { padding: 0 0 18px; overflow-x: hidden; overflow-y: auto; }
      .cn-premium-hero { position: relative; }
      .cn-premium-hero-img { display: block; width: 100%; height: auto; border-radius: 20px 20px 0 0; }
      .cn-premium-close {
        position: absolute; top: 12px; right: 12px; background: rgba(4,10,24,0.7);
        border: 1px solid rgba(var(--cn-accent-rgb),0.5);
      }
      .cn-premium-perks-title {
        display: flex; align-items: center; justify-content: center; gap: 10px;
        margin: 20px 16px 14px; font-size: 14px; font-weight: 800; letter-spacing: 0.08em;
        color: #FDE68A; font-family: 'Space Grotesk', sans-serif;
      }
      .cn-premium-perks-line { flex: 1; max-width: 60px; height: 1px; background: rgba(253,230,138,0.4); }
      .cn-premium-perks { display: flex; flex-direction: column; gap: 4px; padding: 0 16px; }
      .cn-premium-perk {
        display: flex; align-items: flex-start; gap: 12px; padding: 10px 4px;
        border-bottom: 1px solid rgba(var(--cn-accent-rgb),0.15);
      }
      .cn-premium-perk:last-child { border-bottom: none; }
      .cn-premium-perk-icon {
        width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(var(--cn-accent-rgb),0.15); border: 1px solid rgba(var(--cn-accent-rgb),0.4); color: var(--cn-accent-bright);
      }
      .cn-premium-perk-title { font-size: 12.5px; font-weight: 800; letter-spacing: 0.03em; color: #FDE68A; }
      .cn-premium-perk-desc { font-size: 12.5px; color: #C4D6EF; margin-top: 2px; line-height: 1.35; }
      .cn-premium-buy-btn {
        width: calc(100% - 32px); margin: 16px 16px 0; display: flex; align-items: center; justify-content: center; gap: 8px;
      }
      .cn-premium-buy-btn:disabled { opacity: 0.55; cursor: not-allowed; }

      /* Region ownership highlight */
      .cn-region-group--captured .cn-region-path { stroke: #FBBF24; stroke-width: 1.3; }

      /* Common titles */
      .cn-screen-title {
        font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 19px;
        color: var(--cn-text); letter-spacing: 0.02em; margin-bottom: 14px;
        text-shadow: 0 0 18px rgba(var(--cn-accent-rgb),0.25);
      }

      /* Leaderboard */
      .cn-lb-header { display: flex; align-items: center; justify-content: space-between; }
      .cn-refresh-btn {
        width: 34px; height: 34px; border-radius: 10px; border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        background: rgba(var(--cn-panel-rgb),0.6); color: var(--cn-text-dim); display: flex; align-items: center; justify-content: center;
        cursor: pointer; margin-bottom: 14px;
      }
      .cn-spin { animation: cn-spin 0.9s linear infinite; }
      @keyframes cn-spin { to { transform: rotate(360deg); } }
      .cn-segmented {
        display: flex; background: rgba(var(--cn-panel-rgb),0.6); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        border-radius: 12px; padding: 4px; margin-bottom: 16px; gap: 4px;
      }
      .cn-seg-btn {
        flex: 1; padding: 9px 4px; border-radius: 9px; border: none; background: transparent;
        color: var(--cn-text-dim); font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;
      }
      .cn-seg-btn--active { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.5); background: linear-gradient(135deg, var(--cn-accent), var(--cn-accent2)); color: #041220; }
      .cn-lb-loading, .cn-lb-empty { text-align: center; color: var(--cn-text-dimmer); font-size: 13px; padding: 30px 0; }

      .cn-list { display: flex; flex-direction: column; gap: 7px; padding-bottom: 12px; }
      .cn-row {
        display: flex; align-items: center; gap: 10px; padding: 11px 13px;
        border-radius: 13px; background: rgba(var(--cn-panel-rgb),0.45); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-row--mine { border-color: rgba(var(--cn-accent-rgb),0.55); background: rgba(var(--cn-accent-rgb),0.1); box-shadow: 0 0 16px rgba(var(--cn-accent-rgb),0.15); }
      .cn-row--light { background: rgba(var(--cn-panel-rgb),0.28); }
      .cn-list--dense { gap: 5px; }
      .cn-row-rank { width: 22px; text-align: center; font-size: 13px; font-weight: 700; color: var(--cn-text-dimmer); }
      .cn-rank--1 { color: #FCD34D; }
      .cn-rank--2 { color: #CBD5E1; }
      .cn-rank--3 { color: #D9A066; }
      .cn-row-flag { font-size: 18px; }
      .cn-flag-wrap {
        display: inline-flex; flex-shrink: 0; border-radius: 3px; overflow: hidden;
        border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 0 0 1px rgba(0,0,0,0.15) inset;
      }
      .cn-flag-wrap svg { display: block; }
      .cn-flag-emoji { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .cn-row-name { flex: 1; font-size: 13.5px; color: var(--cn-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-row-value { font-size: 13.5px; font-weight: 700; color: var(--cn-accent-bright); font-family: 'Space Grotesk', sans-serif; }
      .cn-row-divider { text-align: center; color: #445A7C; letter-spacing: 0.3em; font-size: 12px; padding: 2px 0; }

      /* Leaderboard avatars + premium frame */
      .cn-row--player { padding: 8px 13px; }
      .cn-row--banner {
        aspect-ratio: 2 / 1; align-items: flex-end; padding-bottom: 10px; background-repeat: no-repeat;
        background-size: cover;
        background-position: center;
        border-color: rgba(255,255,255,0.18);
      }
      .cn-row--banner .cn-row-name,
      .cn-row--banner .cn-row-value { color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
      .cn-row--banner.cn-row--mine { background-blend-mode: normal; box-shadow: 0 0 16px rgba(var(--cn-accent-rgb),0.35); }
      .cn-lb-avatar {
        position: relative; width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(var(--cn-panel-rgb),0.7); border: 1.5px solid rgba(var(--cn-accent-rgb),0.35);
      }
      .cn-lb-avatar-inner {
        position: relative; width: 30px; height: 30px; border-radius: 50%; overflow: hidden;
        display: flex; align-items: center; justify-content: center; color: var(--cn-text-dimmer);
        background: rgba(var(--cn-panel-rgb),0.9);
      }
      .cn-lb-avatar--premium {
        border: none; padding: 2px;
        background: linear-gradient(135deg, #FCD34D, #F59E0B, #FCD34D);
        box-shadow: 0 0 10px rgba(252,211,77,0.55);
      }
      .cn-lb-avatar--premium .cn-lb-avatar-inner {
        width: 100%; height: 100%; border: 1.5px solid rgba(4,18,32,0.55);
      }
      .cn-lb-avatar-crown {
        position: absolute; top: -7px; left: 50%; transform: translateX(-50%) rotate(0deg);
        color: #FCD34D; filter: drop-shadow(0 0 3px rgba(252,211,77,0.9));
      }
      .cn-row--premium {
        border-color: rgba(252,211,77,0.45);
        background: linear-gradient(90deg, rgba(252,211,77,0.08), rgba(var(--cn-panel-rgb),0.45));
      }
      .cn-row--premium.cn-row--mine {
        border-color: rgba(252,211,77,0.65);
        box-shadow: 0 0 16px rgba(252,211,77,0.25);
      }
      .cn-row--premium .cn-row-name { font-weight: 700; }

      /* Profile */
      .cn-profile-card {
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 26px 16px; border-radius: 20px; margin-bottom: 18px;
        background: radial-gradient(120% 100% at 50% 0%, rgba(var(--cn-accent-rgb),0.14), rgba(var(--cn-panel-rgb),0.5));
        border: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-profile-flag { font-size: 46px; margin-bottom: 4px; filter: drop-shadow(0 0 14px rgba(var(--cn-accent-rgb),0.35)); }
      .cn-profile-name { font-size: 18px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; color: var(--cn-text); }
      .cn-profile-country { font-size: 12.5px; color: var(--cn-text-dim); }
      .cn-leader-badge {
        display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: #FCD34D;
        background: rgba(252,211,77,0.12); border: 1px solid rgba(252,211,77,0.35);
        padding: 5px 12px; border-radius: 999px; margin-top: 8px;
      }
      .cn-profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .cn-profile-stat {
        padding: 14px; border-radius: 14px; background: rgba(var(--cn-panel-rgb),0.5); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-profile-stat-label { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cn-text-dimmer); margin-bottom: 4px; }
      .cn-profile-stat-value { font-size: 17px; font-weight: 700; color: var(--cn-text); font-family: 'Space Grotesk', sans-serif; }

      /* Profile: avatar, chips, menu list */
      .cn-profile-card--peek { margin-bottom: 14px; padding: 20px 16px; }
      .cn-profile-avatar {
        width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: radial-gradient(120% 120% at 30% 20%, rgba(var(--cn-accent-rgb),0.35), rgba(var(--cn-panel-rgb),0.9));
        border: 1px solid rgba(var(--cn-accent-rgb),0.55); color: var(--cn-accent-bright); margin-bottom: 8px;
        box-shadow: 0 0 18px rgba(var(--cn-accent-rgb),0.3);
        position: relative; overflow: hidden;
      }
      .cn-profile-chips { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; margin-top: 10px; }
      .cn-profile-chip {
        display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600;
        padding: 5px 11px; border-radius: 999px; white-space: nowrap;
      }
      .cn-profile-chip--title { color: var(--cn-accent-bright); background: rgba(var(--cn-accent-rgb),0.12); border: 1px solid rgba(var(--cn-accent-rgb),0.4); }
      .cn-profile-chip--badge { color: #C4B5FD; background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.35); }
      .cn-profile-chip--leader { color: #FCD34D; background: rgba(252,211,77,0.12); border: 1px solid rgba(252,211,77,0.35); }

      /* Profile banner (background placeholder + hero avatar/name) */
      .cn-profile-banner {
        position: relative; border-radius: 22px; overflow: hidden; margin-bottom: 14px;
        border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      }
      .cn-profile-banner-bg {
        position: absolute; inset: 0;
        background:
          repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 14px, rgba(255,255,255,0) 14px 28px),
          radial-gradient(140% 120% at 20% 0%, rgba(var(--cn-accent-rgb),0.32), transparent 60%),
          radial-gradient(140% 120% at 100% 100%, rgba(var(--cn-accent-rgb),0.22), transparent 55%),
          linear-gradient(160deg, #060c1c, #0b1730 55%, #060c1c);
      }
      .cn-profile-banner-dev-tag {
        position: absolute; top: 10px; left: 10px; z-index: 1;
        font-size: 9.5px; letter-spacing: 0.04em; font-weight: 700; text-transform: uppercase;
        color: var(--cn-text-dim); background: rgba(3,8,20,0.55); border: 1px solid rgba(var(--cn-accent-rgb),0.35);
        padding: 4px 9px; border-radius: 999px;
      }
      .cn-profile-banner-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .cn-profile-banner-bg::after {
        content: ""; position: absolute; inset: 0;
        background: linear-gradient(180deg, rgba(3,8,20,0.05) 0%, rgba(3,8,20,0.55) 75%, rgba(3,8,20,0.75) 100%);
      }
      .cn-profile-banner-edit-btn {
        position: absolute; top: 10px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 5px;
        font-size: 10.5px; font-weight: 700; color: var(--cn-text);
        background: rgba(3,8,20,0.55); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        padding: 5px 10px; border-radius: 999px; cursor: pointer;
      }

      /* Banner picker grid */
      .cn-banner-grid { display: flex; flex-direction: column; gap: 12px; padding-bottom: 16px; }
      .cn-banner-cell {
        position: relative; border-radius: 16px; overflow: hidden; border: 1.5px solid rgba(var(--cn-accent-rgb),0.25);
        background: rgba(var(--cn-panel-rgb),0.45); cursor: pointer; padding: 0; aspect-ratio: 2 / 1; width: 100%;
        display: flex; align-items: flex-end;
      }
      .cn-banner-cell--active { border-color: rgba(var(--cn-accent-rgb),0.85); box-shadow: 0 0 16px rgba(var(--cn-accent-rgb),0.35); }
      .cn-banner-cell-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .cn-banner-cell-label {
        position: relative; z-index: 1; width: 100%; padding: 8px 12px; font-size: 12.5px; font-weight: 700; color: #fff;
        background: linear-gradient(180deg, rgba(3,8,20,0) 0%, rgba(3,8,20,0.75) 100%); text-align: left;
      }
      .cn-banner-cell-placeholder {
        width: 100%; text-align: center; padding: 0; align-self: center; font-size: 12.5px; font-weight: 700; color: var(--cn-text-dimmer);
      }
      .cn-banner-cell-check {
        position: absolute; top: 8px; right: 8px; z-index: 2; color: #fff; background: rgba(var(--cn-accent-rgb),0.9);
        border-radius: 50%; padding: 3px;
      }

      /* Profile hero (avatar ring, name, id) */
      .cn-profile-hero { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 0; padding: 26px 16px 22px; }
      .cn-profile-banner--img { aspect-ratio: 2 / 1; display: flex; flex-direction: column; justify-content: center; }
      .cn-profile-banner--img .cn-profile-hero { padding: 14px 16px 12px; }
      .cn-profile-avatar-ring {
        width: 104px; height: 104px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: radial-gradient(120% 120% at 30% 20%, rgba(var(--cn-accent-rgb),0.28), rgba(6,14,32,0.9));
        border: 3px solid rgba(var(--cn-accent-rgb),0.85); color: #EAF6FF; cursor: pointer;
        box-shadow: 0 0 32px rgba(var(--cn-accent-rgb),0.5), inset 0 0 16px rgba(255,255,255,0.08);
        margin-bottom: -14px; position: relative; overflow: hidden; z-index: 2;
      }
      .cn-profile-name-banner {
        position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
        padding: 22px 22px 12px; margin-top: 0; min-width: 190px;
        background: none; border: 0; border-radius: 0; box-shadow: none;
      }
      .cn-profile-name-banner .cn-profile-name {
        color: #fff; font-size: 21px; font-weight: 800;
        text-shadow: 0 0 2px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,0.95), 0 2px 10px rgba(0,0,0,0.9), 0 0 22px rgba(0,0,0,0.75);
      }
      .cn-profile-name-banner .cn-profile-title-pill { background: rgba(4,10,24,0.55); }
      .cn-profile-role-row { display: flex; justify-content: center; margin: 2px 0 14px; }
      .cn-profile-name-banner-crown {
        position: absolute; top: -9px; left: 50%; transform: translateX(-50%);
        color: #FCD34D; filter: drop-shadow(0 0 4px rgba(252,211,77,0.9));
      }
      .cn-profile-name-row { display: flex; align-items: center; gap: 8px; }
      .cn-profile-edit-btn {
        width: 24px; height: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
        background: rgba(var(--cn-accent-rgb),0.14); border: 1px solid rgba(var(--cn-accent-rgb),0.4); color: var(--cn-accent-bright); cursor: pointer;
      }
      .cn-profile-title-pill {
        display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700;
        color: var(--cn-accent-bright); background: rgba(var(--cn-accent-rgb),0.14);
        border: 1px solid rgba(var(--cn-accent-rgb),0.4); border-radius: 999px; padding: 5px 12px; cursor: pointer;
      }
      .cn-profile-id-row {
        display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--cn-text-dim); margin-top: 2px;
      }
      .cn-profile-id-row--centered { justify-content: center; margin: 4px 0 14px; }
      .cn-profile-copy-btn {
        width: 22px; height: 22px; border-radius: 7px; display: flex; align-items: center; justify-content: center;
        background: rgba(var(--cn-accent-rgb),0.1); border: 1px solid rgba(var(--cn-accent-rgb),0.3); color: var(--cn-text-dim); cursor: pointer;
      }

      /* Profile stats bar: total clicks / country / global rank */
      .cn-profile-stats-bar {
        display: flex; align-items: stretch; gap: 4px; padding: 14px 10px; margin-bottom: 14px;
        border-radius: 18px; background: rgba(var(--cn-panel-rgb),0.45); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-profile-stats-item {
        flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; background: none; border: none; cursor: pointer;
        padding: 2px; text-align: center; overflow: hidden;
      }
      .cn-profile-stats-item--static { cursor: default; }
      .cn-profile-stats-icon {
        width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: rgba(var(--cn-accent-rgb),0.14); border: 1px solid rgba(var(--cn-accent-rgb),0.4); color: var(--cn-accent-bright);
      }
      .cn-profile-stats-text { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; max-width: 100%; }
      .cn-profile-stats-label {
        font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--cn-text-dimmer); white-space: nowrap;
      }
      .cn-profile-stats-value {
        font-size: 13.5px; font-weight: 700; color: var(--cn-text); font-family: 'Space Grotesk', sans-serif;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cn-profile-stats-value--country { display: flex; align-items: center; justify-content: center; gap: 5px; max-width: 100%; }
      .cn-profile-stats-flag { border-radius: 3px; flex-shrink: 0; }
      .cn-profile-stats-divider { width: 1px; align-self: stretch; background: rgba(var(--cn-accent-rgb),0.22); flex-shrink: 0; }

      /* Profile badges card */
      .cn-profile-badges-card {
        padding: 14px; border-radius: 18px; margin-bottom: 18px;
        background: rgba(var(--cn-panel-rgb),0.45); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-profile-badges-header {
        display: flex; align-items: center; justify-content: space-between; width: 100%;
        background: none; border: none; cursor: pointer; color: var(--cn-text); padding: 0 0 12px;
      }
      .cn-profile-badges-header-left { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 700; }
      .cn-profile-badges-header-right {
        display: flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 700; color: var(--cn-text-dim);
      }
      .cn-profile-badge-row {
        display: flex; gap: 10px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none;
      }
      .cn-profile-badge-row::-webkit-scrollbar { display: none; }
      .cn-badge-slot2 {
        flex: 0 0 auto; width: 58px; display: flex; flex-direction: column; align-items: center; gap: 6px;
        background: none; border: none; cursor: pointer; color: var(--cn-text-dimmer);
      }
      .cn-badge-slot2-ring {
        width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: rgba(3,8,20,0.5); border: 1.5px dashed rgba(var(--cn-accent-rgb),0.35); color: var(--cn-text-dimmer);
        overflow: hidden; flex-shrink: 0;
      }
      .cn-badge-slot2-ring img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block; }
      .cn-badge-slot2--filled .cn-badge-slot2-ring {
        border-style: solid; border-width: 1px; border-color: rgba(var(--cn-accent-rgb),0.55);
        background: rgba(6,14,32,0.9);
        box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.35);
      }
      .cn-badge-slot2-label {
        font-size: 9.5px; font-weight: 600; text-align: center; line-height: 1.15; color: var(--cn-text-dim);
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      .cn-badge-slot2--filled .cn-badge-slot2-label { color: var(--cn-text); }
      .cn-achv-hint { font-size: 12px; color: var(--cn-text-dimmer); margin-bottom: 12px; }

      /* Read-only variants (viewing another player's profile) */
      .cn-profile-banner--peek { margin-bottom: 12px; }
      .cn-profile-avatar-ring--static { cursor: default; }
      .cn-profile-title-pill--static { cursor: default; }
      .cn-profile-badges-header--static { cursor: default; padding-bottom: 12px; }

      .cn-menu-list { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; padding-bottom: 12px; }
      .cn-menu-row {
        display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
        padding: 12px 13px; border-radius: 14px; background: rgba(var(--cn-panel-rgb),0.45);
        border: 1px solid rgba(var(--cn-accent-rgb),0.4); color: var(--cn-text); cursor: pointer;
      }
      .cn-menu-row-icon {
        width: 34px; height: 34px; flex-shrink: 0; border-radius: 10px; display: flex; align-items: center; justify-content: center;
        background: rgba(var(--cn-accent-rgb),0.12); color: var(--cn-accent-bright);
      }
      .cn-menu-row-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .cn-menu-row-title { font-size: 13.5px; font-weight: 700; color: var(--cn-text); }
      .cn-menu-row-sub { font-size: 11px; color: var(--cn-text-dimmer); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-menu-row-chevron { color: var(--cn-text-dimmer); flex-shrink: 0; }

      /* Profile menu: big cards (Settings/Mail/Stats/Badges/Titles style) */
      .cn-menu-card {
        display: flex; align-items: center; gap: 16px; width: 100%; text-align: left;
        padding: 18px 20px; border-radius: 22px; cursor: pointer; border: 1px solid rgba(var(--cn-accent-rgb),0.28);
        background: linear-gradient(135deg, rgba(24,50,94,0.85), rgba(10,22,48,0.9));
        box-shadow: 0 10px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04);
      }
      .cn-menu-card-icon--blue {
        width: 52px; height: 52px; flex-shrink: 0; border-radius: 16px; display: flex; align-items: center; justify-content: center;
        background: radial-gradient(120% 120% at 30% 20%, rgba(var(--cn-accent-rgb),0.5), rgba(11,23,48,0.6));
        border: 1px solid rgba(var(--cn-accent-rgb),0.45); color: #EAF6FF;
        box-shadow: 0 0 18px rgba(var(--cn-accent-rgb),0.4), inset 0 0 10px rgba(255,255,255,0.08);
      }
      .cn-menu-card-text { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .cn-menu-card-title {
        font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 15.5px; letter-spacing: 0.03em;
        text-transform: uppercase; color: #fff;
      }
      .cn-menu-card-sub { font-size: 12px; color: #93A6C9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-menu-card-chevron { color: #7C93BC; flex-shrink: 0; }
      .cn-menu-card-badge {
        min-width: 24px; height: 24px; padding: 0 6px; border-radius: 999px; background: #EF4444; color: #fff;
        font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }

      /* Player search */
      .cn-player-search-wrap { margin-bottom: 14px; border-radius: 14px; background: rgba(3,8,20,0.75); border: 1px solid rgba(var(--cn-accent-rgb),0.4); }
      .cn-search-row { width: 100%; text-align: left; cursor: pointer; }
      .cn-search-row-avatar {
        width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
        background: rgba(var(--cn-accent-rgb),0.12); color: var(--cn-accent-bright);
        position: relative; overflow: hidden;
      }

      /* Titles select list */
      .cn-select-list { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; }
      .cn-select-row {
        display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
        padding: 13px 14px; border-radius: 14px; background: rgba(var(--cn-panel-rgb),0.45);
        border: 1px solid rgba(var(--cn-accent-rgb),0.4); color: var(--cn-text); cursor: pointer;
      }
      .cn-select-row-icon { color: var(--cn-accent-bright); flex-shrink: 0; display: flex; }
      .cn-select-row-label { flex: 1; font-size: 13.5px; font-weight: 600; }
      .cn-select-row-check { color: var(--cn-accent-bright); flex-shrink: 0; }
      .cn-select-row--active { border-color: rgba(var(--cn-accent-rgb),0.6); background: rgba(var(--cn-accent-rgb),0.12); box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.2); }
      .cn-select-row--locked { opacity: 0.45; cursor: not-allowed; }
      .cn-select-row--locked .cn-select-row-icon { color: var(--cn-text-dimmer); }

      /* Icon picker grid */
      .cn-icon-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding-bottom: 12px; }
      .cn-icon-cell {
        position: relative; aspect-ratio: 1; border-radius: 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
        background: rgba(var(--cn-panel-rgb),0.45); border: 1px solid rgba(var(--cn-accent-rgb),0.4); color: var(--cn-accent-bright); cursor: pointer;
        overflow: hidden;
      }
      .cn-icon-cell--active { border-color: rgba(var(--cn-accent-rgb),0.7); background: rgba(var(--cn-accent-rgb),0.16); box-shadow: 0 0 16px rgba(var(--cn-accent-rgb),0.3); }
      .cn-icon-cell--locked { opacity: 0.55; cursor: pointer; color: var(--cn-text-dimmer); }
      .cn-nick-fx {
        display: inline-block; max-width: 100%; background-size: 300% 100%;
        -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
        text-shadow: none; animation: cn-nick-shine 7s linear infinite; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55));
        overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; font-weight: 800;
      }
      @keyframes cn-nick-shine { from { background-position: 0% 50%; } to { background-position: 300% 50%; } }
      .cn-nickfx-preview { text-align: center; font-family: 'Space Grotesk', sans-serif; font-size: 24px; padding: 18px 10px; border-radius: 16px; background: rgba(var(--cn-panel-rgb),0.45); border: 1px solid rgba(var(--cn-accent-rgb),0.35); margin-bottom: 12px; }
      .cn-nickfx-colors { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0; }
      .cn-nickfx-color { position: relative; height: 44px; border-radius: 12px; border: 2px solid transparent; cursor: pointer; padding: 0; }
      .cn-nickfx-color--active { border-color: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.4); }
      .cn-nickfx-lock { text-align: center; font-size: 12.5px; color: var(--cn-text-dim); margin-top: 8px; }
      .cn-icon-cell--locked .cn-icon-cell-glyph { filter: grayscale(1) brightness(0.6); }
      .cn-lock-hint { display: flex; align-items: center; gap: 7px; padding: 9px 12px; border-radius: 12px; margin-bottom: 10px; font-size: 12.5px; font-weight: 700; color: #FDE68A; background: rgba(120,84,10,0.35); border: 1px solid rgba(250,204,21,0.45); }
      .cn-icon-cell-lock { position: absolute; top: 5px; left: 5px; color: #fff; background: rgba(3,8,20,0.7); border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; }
      .cn-icon-cell-req { font-size: 9px; font-weight: 700; color: var(--cn-text-dimmer); }
      .cn-icon-cell-check {
        position: absolute; top: 5px; right: 5px; width: 15px; height: 15px; border-radius: 50%;
        background: var(--cn-accent); color: #041220; display: flex; align-items: center; justify-content: center;
      }

      /* Achievements list */
      .cn-achv-list { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; }
      .cn-achv-row {
        display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
        padding: 12px 13px; border-radius: 14px; background: rgba(var(--cn-panel-rgb),0.45);
        border: 1px solid rgba(var(--cn-accent-rgb),0.4); color: var(--cn-text); cursor: not-allowed; opacity: 0.5;
      }
      .cn-achv-row-icon {
        width: 32px; height: 32px; flex-shrink: 0; border-radius: 10px; display: flex; align-items: center; justify-content: center;
        background: rgba(var(--cn-accent-rgb),0.1); color: var(--cn-text-dimmer);
      }
      .cn-achv-row-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .cn-achv-row-title { font-size: 13px; font-weight: 700; }
      .cn-achv-row-desc { font-size: 11px; color: var(--cn-text-dimmer); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-achv-row-check { color: var(--cn-accent-bright); flex-shrink: 0; }
      .cn-achv-row--unlocked { cursor: pointer; opacity: 1; }
      .cn-achv-row--unlocked .cn-achv-row-icon { background: rgba(var(--cn-accent-rgb),0.16); color: var(--cn-accent-bright); }
      .cn-achv-row--active { border-color: rgba(var(--cn-accent-rgb),0.6); background: rgba(var(--cn-accent-rgb),0.12); box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.2); }

      /* World map */
      .cn-map-screen { display: flex; flex-direction: column; }
      .cn-map-hint { font-size: 11px; color: var(--cn-text-dimmer); margin-bottom: 6px; margin-top: -6px; }
      .cn-map-loading {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
        padding: 80px 20px; color: var(--cn-text-dim); font-size: 13.5px;
      }
      /* ---- Країни гравців: значок, вибір, список, карта територій ---- */
      .cn-country-badge {
        display: inline-block; flex-shrink: 0; border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.35); box-shadow: 0 0 0 1px rgba(0,0,0,0.25) inset;
      }
      .cn-country-badge--lg { border-radius: 10px; border-width: 2px; }
      .cn-choice-list { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
      .cn-choice-btn {
        display: flex; align-items: center; gap: 14px; width: 100%; padding: 16px 16px; text-align: left; cursor: pointer;
        border-radius: 18px; color: var(--cn-text); font-family: inherit;
        background: linear-gradient(180deg, rgba(var(--cn-accent-rgb),0.1), rgba(3,8,20,0.7));
        border: 1px solid rgba(var(--cn-accent-rgb),0.45);
        box-shadow: 0 0 18px rgba(var(--cn-accent-rgb),0.12);
      }
      .cn-choice-btn:not(:disabled):active { transform: scale(0.985); }
      .cn-choice-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .cn-choice-icon {
        width: 48px; height: 48px; border-radius: 14px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
        color: var(--cn-accent-bright); background: rgba(var(--cn-accent-rgb),0.14); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-choice-text { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .cn-choice-title { font-weight: 700; font-size: 16px; font-family: 'Space Grotesk', sans-serif; }
      .cn-choice-sub { font-size: 12.5px; color: var(--cn-text-dim); }
      .cn-onboard-reassign {
        margin-bottom: 16px; padding: 12px 14px; border-radius: 14px; font-size: 13px; line-height: 1.45; color: #FDE68A;
        background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.35);
      }
      .cn-step-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .cn-back-btn {
        width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; cursor: pointer;
        color: var(--cn-text); background: rgba(var(--cn-accent-rgb),0.12); border: 1px solid rgba(var(--cn-accent-rgb),0.45);
      }
      .cn-back-btn:active { transform: scale(0.94); }
      .cn-step-title { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 20px; color: var(--cn-text); }
      .cn-country-search-wrap--static {
        margin-bottom: 12px; border-radius: 14px; background: rgba(3,8,20,0.75); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-nation-list { display: flex; flex-direction: column; gap: 8px; }
      .cn-nation-row {
        display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; cursor: pointer; text-align: left;
        border-radius: 14px; color: var(--cn-text); font-family: inherit;
        background: rgba(var(--cn-panel-rgb),0.6); border: 1px solid rgba(var(--cn-accent-rgb),0.3);
      }
      .cn-nation-row:active { transform: scale(0.99); }
      .cn-nation-name { flex: 1; font-weight: 700; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-nation-meta { font-size: 11.5px; color: var(--cn-text-dimmer); white-space: nowrap; }
      .cn-nation-empty { text-align: center; padding: 26px 12px; color: var(--cn-text-dim); font-size: 13.5px; display: flex; flex-direction: column; align-items: center; }
      .cn-modal-overlay--center { align-items: center; padding: 20px; }
      .cn-confirm-modal {
        width: 100%; max-width: 360px; padding: 22px 20px 18px; border-radius: 22px; text-align: center;
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        background: var(--cn-bg2); border: 1px solid rgba(var(--cn-accent-rgb),0.5); box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      }
      .cn-confirm-title { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 18px; color: var(--cn-text); }
      .cn-confirm-text { font-size: 14.5px; line-height: 1.45; color: var(--cn-text-dim); }
      .cn-confirm-actions { display: flex; gap: 10px; width: 100%; margin-top: 8px; }
      .cn-confirm-actions .cn-dev-btn { flex: 1; justify-content: center; padding: 12px 10px; font-size: 14px; border-radius: 12px; }
      .cn-dev-btn--primary { background: linear-gradient(135deg, var(--cn-accent), var(--cn-accent2)); color: #04101f; border-color: transparent; }
      .cn-onboard--map { max-width: 640px; }
      .cn-onboard--map .cn-tmap-viewport { height: min(46vh, 460px); min-height: 280px; }
      .cn-map-hint--onboard { margin-top: 0; margin-bottom: 10px; font-size: 13px; color: var(--cn-text-dim); }
      .cn-tmap-viewport {
        position: relative; width: 100%; height: min(58vh, 560px); min-height: 340px; border-radius: 22px; overflow: hidden;
        border: 1px solid rgba(var(--cn-accent-rgb),0.45); background: #0c2236; touch-action: none;
        box-shadow: 0 0 0 1px rgba(var(--cn-accent-rgb),0.12), 0 0 26px rgba(60,150,255,0.35), 0 16px 44px rgba(0,0,0,0.5);
      }
      .cn-map-viewport-wrap .cn-tmap-viewport { height: min(70vh, 680px); margin: 0 10px; width: auto; border: 1px solid rgba(var(--cn-accent-rgb),0.45); border-radius: 16px; box-shadow: none; isolation: isolate; clip-path: inset(0 round 16px); }
      .cn-map-top { position: absolute; top: 1px; left: 11px; right: 11px; z-index: 4; padding: 14px 58px 26px 14px; border-radius: 15px 15px 0 0; pointer-events: none; background: linear-gradient(180deg, rgba(6,14,28,0.62), rgba(6,14,28,0)); }
      .cn-map-top > * { pointer-events: auto; }
      .cn-map-title { font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.7), 0 0 18px rgba(var(--cn-accent-rgb),0.6); pointer-events: none; }
      .cn-map-sub { margin-top: 3px; font-size: 11.5px; color: rgba(255,255,255,0.88); text-shadow: 0 1px 6px rgba(0,0,0,0.8); pointer-events: none; max-width: 80%; }
      .cn-map-search { position: relative; }
      .cn-map-search-box { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; color: #fff; background: rgba(8,16,30,0.88); border: 1px solid rgba(var(--cn-accent-rgb),0.55); }
      .cn-map-search-box input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: #fff; font-size: 14px; }
      .cn-map-search-box button { background: transparent; border: 0; color: rgba(255,255,255,0.8); display: flex; padding: 2px; cursor: pointer; }
      .cn-map-search-list { margin-top: 6px; max-height: 42vh; overflow-y: auto; border-radius: 12px; background: rgba(8,16,30,0.94); border: 1px solid rgba(255,255,255,0.12); }
      .cn-map-search-item { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; padding: 9px 12px; background: transparent; border: 0; border-bottom: 1px solid rgba(255,255,255,0.07); color: #fff; text-align: left; cursor: pointer; }
      .cn-map-search-item b { font-size: 14px; }
      .cn-map-search-item small { font-size: 11px; color: rgba(255,255,255,0.6); }
      .cn-map-search-empty { padding: 12px; font-size: 13px; color: rgba(255,255,255,0.7); }
      .cn-conflicts { margin: 12px 0 4px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); overflow: hidden; }
      .cn-conflicts-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 11px 14px; background: transparent; border: 0; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; text-align: left; }
      .cn-conflicts-head > span { flex: 1; }
      .cn-conflicts-count { min-width: 22px; padding: 1px 7px; text-align: center; border-radius: 999px; font-size: 12px; background: rgba(255,255,255,0.12); }
      .cn-conflicts-count--on { background: #ef4444; }
      .cn-conflicts-chev { transition: transform 0.2s; }
      .cn-conflicts-chev--open { transform: rotate(90deg); }
      .cn-conflicts-list { border-top: 1px solid rgba(255,255,255,0.08); max-height: 220px; overflow-y: auto; }
      .cn-conflicts-empty { padding: 12px 14px; font-size: 13px; color: rgba(255,255,255,0.65); }
      .cn-conflict-row { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 10px 14px; background: transparent; border: 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #fff; text-align: left; cursor: pointer; }
      .cn-conflict-sides { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 700; flex-wrap: wrap; }
      .cn-conflict-vs { color: #f87171; margin: 0 2px; }
      .cn-conflict-meta { font-size: 11.5px; color: rgba(255,255,255,0.65); }
      .cn-tmap-toast {
        position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 5; padding: 10px 14px; border-radius: 12px;
        font-size: 13px; text-align: center; color: #FEE2E2; background: rgba(127,29,29,0.92); border: 1px solid rgba(248,113,113,0.5);
      }
      .cn-tmap-legend { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 18px; margin: 10px 0 12px; font-size: 12px; color: var(--cn-text-dim); }
      .cn-tmap-legend-item { display: inline-flex; align-items: center; gap: 7px; }
      .cn-tmap-legend-dot { width: 14px; height: 14px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.35); }
      .cn-tmap-legend-dot--multi { background: linear-gradient(135deg, #ef4444 0 33%, #3b82f6 33% 66%, #22c55e 66%); }
      .cn-tmap-legend-dot--own { background: #f59e0b; border: 2px solid #fff; box-shadow: 0 0 6px rgba(255,255,255,0.6); }
      .cn-tmap-mine-btn { margin: 0 auto 12px; }
      .cn-create-panel { margin-top: 4px; }
      .cn-create-region {
        display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 10px 12px; border-radius: 12px; font-size: 13.5px;
        color: var(--cn-text); background: rgba(var(--cn-accent-rgb),0.08); border: 1px solid rgba(var(--cn-accent-rgb),0.3);
      }
      .cn-create-region-empty { color: var(--cn-text-dimmer); }
      .cn-map-card-sub { font-size: 12.5px; color: var(--cn-text-dim); text-align: center; }
      .cn-map-card-country { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--cn-text); margin-top: 4px; }
      .cn-color-section { display: flex; flex-direction: column; gap: 10px; }
      .cn-color-title { display: flex; align-items: center; gap: 8px; font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 15px; color: var(--cn-text); }
      .cn-color-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
      .cn-color-swatch {
        position: relative; aspect-ratio: 1 / 1; border-radius: 12px; border: 2px solid rgba(255,255,255,0.18); cursor: pointer;
        display: flex; align-items: center; justify-content: center; color: #fff; padding: 0;
        text-shadow: 0 1px 2px rgba(0,0,0,0.6);
      }
      .cn-color-swatch:not(:disabled):active { transform: scale(0.92); }
      .cn-color-swatch:disabled { cursor: not-allowed; }
      .cn-color-swatch--active { border-color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,0.35), 0 0 14px rgba(255,255,255,0.35); }
      .cn-color-swatch--taken { opacity: 0.32; }
      .cn-color-msg { font-size: 13px; text-align: center; padding: 8px 10px; border-radius: 10px; }
      .cn-color-msg--ok { color: #86EFAC; background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.35); }
      .cn-color-msg--err { color: #FCA5A5; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35); }
      .cn-changelog-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; max-height: 320px; overflow-y: auto; }
      .cn-changelog-item { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); }
      .cn-changelog-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .cn-changelog-date { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: #FDE68A; text-transform: uppercase; }
      .cn-changelog-del { padding: 4px 8px; }
      .cn-changelog-title { font-weight: 700; font-size: 13.5px; color: #F1F6FF; margin-top: 4px; }
      .cn-changelog-text { font-size: 12.5px; line-height: 1.45; color: #B8C7E0; margin-top: 3px; white-space: pre-wrap; }
      .cn-changelog-form { display: flex; flex-direction: column; }
      .cn-changelog-form .cn-dev-btn { align-self: flex-start; }
      .cn-changelog-textarea { resize: vertical; min-height: 64px; }
      .cn-city-card { align-items: stretch; text-align: left; }
      .cn-city-card .cn-map-card-name { justify-content: center; flex-wrap: wrap; }
      .cn-city-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--cn-text-dim); }
      .cn-city-line b { color: var(--cn-text); }
      .cn-map-card-tag--soft { color: var(--cn-text-dim); background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.18); }
      .cn-city-importance { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--cn-text-dim); margin-top: 4px; }
      .cn-city-importance-bar { flex: 1; height: 8px; border-radius: 99px; background: rgba(255,255,255,0.1); overflow: hidden; }
      .cn-city-importance-bar > span { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--cn-accent), var(--cn-accent-bright)); }
      .cn-city-importance b { color: var(--cn-accent-bright); min-width: 38px; text-align: right; }
      .cn-city-attack { margin-top: 10px; padding: 12px; }
      .cn-map-viewport-wrap { position: relative; margin: 0 -10px; }
      /* Повноекранна карта у вкладці «Карта»: без рамок і відступів, інтерфейс — поверх карти */
      .cn-content--map { padding: 0; overflow: hidden; }
      .cn-content--map .cn-map-screen { height: 100%; }
      .cn-content--map .cn-map-viewport-wrap { margin: 0; height: 100%; }
      .cn-content--map .cn-map-viewport-wrap .cn-tmap-viewport { height: 100%; min-height: 0; margin: 0; border: 0; border-radius: 0; clip-path: none; box-shadow: none; }
      .cn-content--map .cn-map-top { left: 0; right: 0; top: 0; border-radius: 0; padding: calc(14px + env(safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px)) 66px 34px 18px; background: linear-gradient(180deg, rgba(6,14,28,0.72), rgba(6,14,28,0)); }
      .cn-content--map .maplibregl-ctrl-top-right { top: calc(10px + env(safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px)); }
      .cn-content--map .cn-map-viewport-wrap > .cn-map-card { left: 12px; right: 12px; bottom: 12px; }
      .cn-map-bottom { position: absolute; left: 12px; right: 52px; bottom: 12px; z-index: 6; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
      .cn-map-bottom > * { pointer-events: auto; }
      .cn-map-bottom .cn-conflicts { margin: 0; display: flex; flex-direction: column-reverse; background: rgba(6,14,28,0.78); border: 1px solid rgba(var(--cn-accent-rgb),0.35); border-radius: 16px; box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
      .cn-map-bottom .cn-conflicts-list { border-top: 0; border-bottom: 1px solid rgba(255,255,255,0.08); max-height: 30vh; }
      .cn-map-bottom-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .cn-map-bottom .cn-tmap-legend { margin: 0; gap: 4px 12px; padding: 7px 12px; border-radius: 999px; background: rgba(6,14,28,0.78); border: 1px solid rgba(var(--cn-accent-rgb),0.3); font-size: 11px; color: #E6F0FF; flex-wrap: nowrap; }
      .cn-map-bottom .cn-tmap-legend-item { gap: 5px; white-space: nowrap; }
      .cn-map-bottom .cn-tmap-legend-dot { width: 10px; height: 10px; border-radius: 3px; }
      .cn-map-mine-pill { display: inline-flex; align-items: center; gap: 5px; padding: 8px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 700; color: var(--cn-accent-bright); background: rgba(6,14,28,0.78); border: 1px solid rgba(var(--cn-accent-rgb),0.5); cursor: pointer; white-space: nowrap; }
      .cn-map-viewport {
        position: relative; width: 100%; aspect-ratio: 4 / 3; border-radius: 22px; max-height: 84vh;
        overflow: hidden; border: 1px solid rgba(var(--cn-accent-rgb),0.45);
        box-shadow: 0 0 0 1px rgba(var(--cn-accent-rgb),0.12), 0 16px 44px rgba(0,0,0,0.5), inset 0 0 56px rgba(var(--cn-accent-rgb),0.1);
        background-image: url('/img/bg-1cb01a84.jpg');
        background-size: cover; background-position: center;
        cursor: grab; touch-action: none;
      }
      .cn-map-viewport--big { aspect-ratio: 4 / 3; }
      .cn-map3d-wrap { position: absolute; inset: 0; width: 100%; height: 100%; }
      .cn-map3d-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .cn-map3d-loading {
        position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 12px; background: #050810; color: var(--cn-text-dim); font-size: 13px;
      }
      .maplibregl-ctrl-attrib { font-size: 9px; opacity: 0.5; }
      @keyframes cn-card-in {
        from { opacity: 0; transform: translateY(14px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .cn-map-card--anim { animation: cn-card-in 0.38s cubic-bezier(0.22, 1, 0.36, 1); }
      @keyframes cn-toast-in {
        from { opacity: 0; transform: translate(-50%, -10px) scale(0.95); }
        to { opacity: 1; transform: translate(-50%, 0) scale(1); }
      }
      .cn-capture-toast {
        position: absolute; top: 14px; left: 50%; z-index: 6; min-width: 200px; max-width: 84%;
        padding: 12px 16px; border-radius: 14px; text-align: center;
        background: linear-gradient(160deg, rgba(8,16,30,0.92), rgba(10,25,45,0.88));
        border: 1px solid rgba(34,211,238,0.55);
        box-shadow: 0 0 0 1px rgba(34,211,238,0.15), 0 0 26px rgba(34,211,238,0.35), 0 10px 30px rgba(0,0,0,0.5);
        animation: cn-toast-in 0.4s cubic-bezier(0.22, 1, 0.36, 1);
              }
      .cn-capture-toast-title { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 11px; letter-spacing: 0.06em; color: #7cf0ff; text-transform: uppercase; }
      .cn-capture-toast-name { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 16px; color: #fff; margin-top: 2px; }
      .cn-capture-toast-row { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: #C4D6EF; margin-top: 4px; }
      .cn-capture-toast-size { font-size: 10.5px; color: #7CA9D6; margin-top: 4px; }
      .cn-map-viewport:active { cursor: grabbing; }
      .cn-map-svg { width: 100%; height: 100%; display: block; transform-origin: 0 0; }
      .cn-map-country path { stroke: var(--cn-accent); stroke-width: 1; cursor: pointer; transition: filter 0.15s ease, stroke-width 0.15s ease; }
      .cn-map-country:hover path { filter: brightness(1.15); }
      .cn-map-country--mine path { stroke: #FBBF24; stroke-width: 1.3; }
      .cn-map-country--selected path { stroke-width: 2; filter: drop-shadow(0 0 6px rgba(var(--cn-accent-rgb),0.85)); }
      .cn-map-crown, .cn-map-flag-label { filter: drop-shadow(0 0 3px rgba(0,0,0,0.7)); }
      .cn-map-pulse-ring { fill: none; stroke: #FBBF24; stroke-width: 2; animation: cn-map-pulse 2.2s ease-out infinite; }
      @keyframes cn-map-pulse {
        0% { r: 10; stroke-opacity: 0.9; }
        100% { r: 34; stroke-opacity: 0; }
      }
      .cn-map-toolbar {
        position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 7px;
      }
      .cn-map-zoom-btn {
        width: 34px; height: 34px; border-radius: 11px; border: 1px solid rgba(var(--cn-accent-rgb),0.5);
        background: rgba(var(--cn-nav-rgb),0.8); color: var(--cn-text-dim);
        font-size: 17px; font-weight: 700; display: flex; align-items: center; justify-content: center;
        cursor: pointer; line-height: 1; box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 0 10px rgba(var(--cn-accent-rgb),0.15);
      }
      .cn-map-zoom-btn--reset { font-size: 14px; }
      .cn-map-legend { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--cn-text-dimmer); margin: 8px 0 10px; }
      .cn-map-legend-dot { width: 8px; height: 8px; border-radius: 50%; background: radial-gradient(circle, var(--cn-accent-bright), var(--cn-accent)); box-shadow: 0 0 6px rgba(var(--cn-accent-rgb),0.6); }
      .cn-map-card {
        position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px;
        padding: 14px 14px; border-radius: 16px; margin-bottom: 12px;
        background: radial-gradient(120% 100% at 50% 0%, rgba(var(--cn-accent-rgb),0.14), rgba(var(--cn-panel-rgb),0.55));
        border: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      /* Картка області/міста — нижня панель поверх карти, прокручувати сторінку не потрібно */
      .cn-map-viewport-wrap > .cn-map-card {
        position: absolute; left: 20px; right: 20px; bottom: 10px; z-index: 8; margin: 0;
        max-height: 58%; overflow-y: auto; overscroll-behavior: contain;
        background: linear-gradient(180deg, rgba(var(--cn-accent-rgb),0.16), rgba(6,14,28,0.94) 38%), rgba(6,14,28,0.94);
                box-shadow: 0 -8px 28px rgba(0,0,0,0.5), 0 0 0 1px rgba(var(--cn-accent-rgb),0.25);
      }
      .cn-map-viewport-wrap > .cn-map-card::before {
        content: ""; width: 38px; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.28); margin: -4px 0 4px;
      }
      .cn-map-card-close {
        position: absolute; top: 10px; right: 10px; width: 26px; height: 26px; border-radius: 8px;
        background: rgba(255,255,255,0.06); border: none; color: var(--cn-text-dim); display: flex; align-items: center; justify-content: center; cursor: pointer;
      }
      .cn-map-card-flag { font-size: 38px; filter: drop-shadow(0 0 12px rgba(var(--cn-accent-rgb),0.35)); }
      .cn-map-card-name { font-size: 16px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; color: var(--cn-text); display: flex; align-items: center; gap: 8px; }
      .cn-map-card-tag { font-size: 10px; font-weight: 600; letter-spacing: 0.04em; color: #FBBF24; background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.35); padding: 2px 8px; border-radius: 999px; }
      .cn-map-card-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; margin-top: 10px; width: 100%; max-width: 280px; }
      .cn-map-card-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .cn-map-card-stat-value--leader { font-size: 14px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-map-card-stat-label { font-size: 10.5px; color: var(--cn-text-dimmer); text-transform: uppercase; letter-spacing: 0.06em; }
      .cn-map-card-stat-value { font-size: 17px; font-weight: 700; color: var(--cn-accent-bright); font-family: 'Space Grotesk', sans-serif; }

      /* Map mode toggle */
      .cn-map-mode-toggle { margin-bottom: 10px; }
      .cn-seg-btn { display: flex; align-items: center; justify-content: center; gap: 5px; }

      /* Region (administrative borders) map */
      .cn-region-picker { display: flex; flex-direction: column; }
      .cn-region-search-wrap { margin: 2px 0 12px; border-radius: 12px; background: rgba(var(--cn-panel-rgb),0.7); border: 1px solid rgba(var(--cn-accent-rgb),0.4); }
      .cn-region-country-list { display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow-y: auto; padding-bottom: 8px; }
      .cn-region-country-row {
        display: flex; align-items: center; gap: 10px; width: 100%;
        padding: 11px 13px; border-radius: 13px; border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        background: rgba(var(--cn-panel-rgb),0.45); color: var(--cn-text); cursor: pointer; text-align: left;
      }
      .cn-region-country-row:active { background: rgba(var(--cn-accent-rgb),0.1); }
      .cn-region-country-flag { font-size: 19px; flex-shrink: 0; }
      .cn-region-country-name { flex: 1; font-size: 14px; }
      .cn-region-country-count { font-size: 11px; color: var(--cn-text-dimmer); flex-shrink: 0; }
      .cn-region-country-captured-tag {
        font-size: 9.5px; font-weight: 700; color: #FCD34D; background: rgba(252,211,77,0.14);
        border: 1px solid rgba(252,211,77,0.35); padding: 1px 6px; border-radius: 999px; margin-left: 8px;
      }

      .cn-region-map { display: flex; flex-direction: column; }
      .cn-region-back {
        display: flex; align-items: center; gap: 4px; align-self: flex-start;
        background: none; border: none; color: var(--cn-text-dim); font-size: 13px; font-weight: 500;
        cursor: pointer; padding: 4px 0; margin-bottom: 8px;
      }
      .cn-region-title {
        display: flex; align-items: center; gap: 8px; font-family: 'Space Grotesk', sans-serif;
        font-weight: 700; font-size: 17px; color: var(--cn-text); margin-bottom: 12px; flex-wrap: wrap;
      }
      .cn-region-title-flag { font-size: 22px; }
      .cn-region-count { font-size: 11px; font-weight: 500; color: var(--cn-text-dimmer); background: rgba(255,255,255,0.05); padding: 3px 9px; border-radius: 999px; }

      .cn-region-group { cursor: pointer; }
      .cn-region-path {
        fill: #163657; stroke: var(--cn-accent); stroke-width: 0.6; stroke-opacity: 0.4;
        transition: fill 0.15s ease, stroke-width 0.15s ease;
        vector-effect: non-scaling-stroke;
      }
      .cn-region-group:hover .cn-region-path { fill: #1d4a73; }
      .cn-region-group--selected .cn-region-path { fill: var(--cn-accent); stroke-opacity: 1; stroke-width: 1.6; }

      .cn-region-card-name { font-size: 16px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; color: var(--cn-text); text-align: center; }
      .cn-region-card-sub { font-size: 12px; color: var(--cn-text-dim); text-align: center; }

      /* Coming soon */

      .cn-soon { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 60px 20px; gap: 8px; }
      .cn-soon-icon-wrap { position: relative; width: 64px; height: 64px; border-radius: 18px; background: rgba(var(--cn-panel-rgb),0.6); border: 1px solid rgba(var(--cn-accent-rgb),0.4); display: flex; align-items: center; justify-content: center; margin-bottom: 6px; }
      .cn-soon-icon { color: #4C6B93; }
      .cn-soon-lock { position: absolute; bottom: -6px; right: -6px; width: 24px; height: 24px; border-radius: 50%; background: #0E2749; border: 1px solid rgba(var(--cn-accent-rgb),0.4); display: flex; align-items: center; justify-content: center; color: var(--cn-accent); }
      .cn-soon-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 18px; color: var(--cn-text); }
      .cn-soon-badge { font-size: 11px; letter-spacing: 0.1em; color: var(--cn-accent); background: rgba(var(--cn-accent-rgb),0.1); border: 1px solid rgba(var(--cn-accent-rgb),0.3); padding: 4px 12px; border-radius: 999px; }
      .cn-soon-desc { font-size: 13px; color: var(--cn-text-dimmer); max-width: 260px; line-height: 1.5; margin-top: 4px; }


      /* ---- Штаб ---- */
      /* ---- Тестова механіка: бізнес, ППО, дрон ---- */
      .cn-tw-tile { justify-content: flex-start !important; text-align: left; gap: 12px !important; padding: 12px 14px !important; }
      .cn-tw-tile-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
      .cn-tw-tile-text small { font-size: 11px; font-weight: 500; color: var(--cn-text-dim); line-height: 1.3; }
      .cn-tw-chev { opacity: 0.6; flex-shrink: 0; }
      .cn-tw-badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #fff; background: #ef4444; }
      .cn-tw-line { font-size: 13px; color: var(--cn-text-dim); }
      .cn-tw-line b { color: #fff; }
      .cn-tw-hp { width: 70px; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.12); overflow: hidden; flex-shrink: 0; }
      .cn-tw-hp-fill { display: block; height: 100%; background: linear-gradient(90deg, #ef4444, #22c55e); border-radius: 999px; }
      .cn-tw-hp-num { color: #fff; font-size: 13px; white-space: nowrap; }
      .cn-tw-panel { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
      .cn-tw-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .cn-tw-go { width: auto; padding: 10px 18px; }
      .cn-tw-mode { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 18px; cursor: pointer; text-align: left; color: #fff; background: linear-gradient(160deg, rgba(var(--cn-accent-rgb),0.22), rgba(6,16,34,0.85)); border: 1px solid rgba(var(--cn-accent-rgb),0.45); }
      .cn-tw-mode:active { transform: scale(0.98); }
      .cn-tw-mode-ic { width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--cn-accent-bright); background: rgba(var(--cn-accent-rgb),0.16); border: 1px solid rgba(var(--cn-accent-rgb),0.4); }
      .cn-tw-result { padding: 12px 14px; border-radius: 14px; font-size: 14px; font-weight: 700; color: #fff; }
      .cn-tw-result--ok { background: rgba(21,128,61,0.35); border: 1px solid rgba(74,222,128,0.5); }
      .cn-tw-result--bad { background: rgba(127,29,29,0.4); border: 1px solid rgba(248,113,113,0.5); }
      .cn-tmap-toast.cn-tw-toast--ok { color: #DCFCE7; background: rgba(21,128,61,0.92); border-color: rgba(74,222,128,0.5); }
      .cn-hq { display: flex; flex-direction: column; gap: 10px; --hq: #3b82f6; min-height: 100%; }
      .cn-hq-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .cn-hq-title { display: flex; flex-direction: column; line-height: 1.1; min-width: 0; }
      .cn-hq-kicker { font-size: 10px; letter-spacing: 0.28em; font-weight: 800; color: var(--hq); }
      .cn-hq-name { font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 800; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-hq-leader {
        display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; color: #FDE68A;
        padding: 5px 10px; border-radius: 999px; background: rgba(6,16,34,0.7); border: 1px solid rgba(253,230,138,0.35); white-space: nowrap; max-width: 45%; overflow: hidden; text-overflow: ellipsis;
      }
      .cn-hq-stage { display: flex; gap: 10px; align-items: stretch; flex: 1; min-height: 210px; }
      .cn-hq-hero {
        position: relative; flex: 1; min-width: 0;
        border-radius: 24px; display: flex; align-items: center; justify-content: center; overflow: hidden;
        background: radial-gradient(circle at 50% 45%, rgba(6,16,34,0.35), rgba(3,8,20,0.82));
        border: 1px solid color-mix(in srgb, var(--hq) 55%, transparent);
        box-shadow: 0 0 28px color-mix(in srgb, var(--hq) 28%, transparent), inset 0 0 40px color-mix(in srgb, var(--hq) 12%, transparent);
      }
      .cn-hq-radar { position: absolute; top: 50%; left: 50%; height: min(94%, 100vw); aspect-ratio: 1 / 1; max-width: 96%; transform: translate(-50%, -50%); }
      .cn-hq-ring { fill: none; stroke: var(--hq); stroke-opacity: 0.55; stroke-width: 1.2; }
      .cn-hq-ring--dash { stroke-dasharray: 3 6; stroke-opacity: 0.4; transform-origin: 100px 100px; animation: cn-hq-spin 40s linear infinite reverse; }
      .cn-hq-tick { stroke: var(--hq); stroke-opacity: 0.6; stroke-width: 1.2; }
      .cn-hq-sweep-g { transform-origin: 100px 100px; animation: cn-hq-spin 6s linear infinite; }
      @keyframes cn-hq-spin { to { transform: rotate(360deg); } }
      .cn-hq-core {
        position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 0 14px;
        color: var(--hq); filter: drop-shadow(0 0 14px var(--hq));
      }
      .cn-hq-core-label { font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 800; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.7); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-hq-dev {
        position: relative; width: 76px; flex-shrink: 0; border-radius: 20px; cursor: pointer; padding: 12px 6px;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px;
        background: linear-gradient(180deg, rgba(251,191,36,0.2), rgba(6,16,34,0.82)); color: #FDE68A;
        border: 1px solid rgba(251,191,36,0.5); box-shadow: 0 0 18px rgba(251,191,36,0.18);
      }
      .cn-hq-dev:active { transform: scale(0.96); }
      .cn-hq-dev-icon { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(251,191,36,0.16); border: 1px solid rgba(251,191,36,0.5); }
      .cn-hq-dev-label { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; writing-mode: vertical-rl; transform: rotate(180deg); }
      .cn-hq-soon { font-size: 9px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #06121F; background: #FBBF24; padding: 2px 7px; border-radius: 999px; }
      .cn-hq-soon--tile { position: absolute; top: 6px; right: 6px; padding: 1px 6px; font-size: 8px; background: rgba(251,191,36,0.9); }
      .cn-hq-chips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
      .cn-hq-chip {
        display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 7px 4px; border-radius: 12px;
        background: rgba(6,16,34,0.7); border: 1px solid rgba(var(--cn-accent-rgb),0.3);
      }
      .cn-hq-chip span { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cn-text-dimmer); }
      .cn-hq-chip b { font-family: 'Space Grotesk', sans-serif; font-size: 14px; color: #fff; }
      .cn-hq-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
      .cn-hq-tile {
        position: relative; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 6px; border-radius: 16px; cursor: pointer;
        background: linear-gradient(160deg, rgba(var(--cn-accent-rgb),0.16), rgba(6,16,34,0.82)); color: #E6F0FF;
        border: 1px solid rgba(var(--cn-accent-rgb),0.4); font-weight: 700; font-size: 12px; transition: transform 0.12s ease;
      }
      .cn-hq-tile:active { transform: scale(0.96); }
      .cn-hq-tile--third { grid-column: span 2; flex-direction: column; gap: 6px; padding: 12px 4px 10px; }
      .cn-hq-tile--half { grid-column: span 3; flex-direction: row; }
      .cn-hq-tile-icon { width: 38px; height: 38px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--cn-accent-bright); background: rgba(var(--cn-accent-rgb),0.14); border: 1px solid rgba(var(--cn-accent-rgb),0.35); }
      .cn-hq-tile-label { font-size: 12px; }
      .cn-map-pick-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-radius: 12px; font-size: 13px; font-weight: 700; color: #fff; background: rgba(251,191,36,0.16); border: 1px solid rgba(251,191,36,0.55); }
      .cn-map-pick-btn { margin-top: 10px; padding: 12px; }
      .cn-upg { padding: 12px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); margin-bottom: 12px; }
      .cn-upg-title { font-size: 15px; font-weight: 800; color: #fff; margin-bottom: 8px; }
      .cn-upg-row { display: grid; grid-template-columns: 0.7fr 1.2fr 1.4fr; gap: 6px; padding: 7px 4px; font-size: 13px; color: rgba(255,255,255,0.85); border-bottom: 1px solid rgba(255,255,255,0.07); }
      .cn-upg-row span:nth-child(2), .cn-upg-row span:nth-child(3) { text-align: right; }
      .cn-upg-row--head { font-weight: 800; color: #fff; font-size: 12px; }
      .cn-upg-row--done { color: #34D399; }
      .cn-upg-row--next { background: rgba(251,191,36,0.12); border-radius: 8px; color: #FBBF24; font-weight: 700; }
      .cn-upg-total { margin-top: 8px; font-size: 13px; color: rgba(255,255,255,0.75); }
      .cn-def-card { padding: 12px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); }
      .cn-def-city { font-size: 17px; font-weight: 800; color: #fff; }
      .cn-def-lvl { font-size: 13px; color: rgba(255,255,255,0.75); margin: 2px 0 8px; }
      .cn-rel-tag { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; }
      .cn-rel-tag--ally { color: #06121F; background: #34D399; }
      .cn-rel-tag--pact { color: #06121F; background: #60A5FA; }
      .cn-rel-tag--truce { color: #06121F; background: #FBBF24; }
      .cn-dip-list { display: flex; flex-direction: column; gap: 8px; }
      .cn-dip-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: rgba(6,16,34,0.7); border: 1px solid rgba(var(--cn-accent-rgb),0.3); }
      .cn-dip-row-name { flex: 1; min-width: 0; font-weight: 700; color: #fff; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-dip-sub { font-size: 11px; color: var(--cn-text-dim); }
      .cn-dip-menu { display: flex; flex-direction: column; gap: 10px; }
      .cn-dip-menu .cn-hq-tile { flex-direction: row; justify-content: flex-start; padding: 14px; }
      .cn-warhud { align-self: center; width: 100%; max-width: 440px; margin: 4px auto 0; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 18px; background: linear-gradient(160deg, rgba(127,29,29,0.5), rgba(6,16,34,0.9) 60%); border: 1px solid rgba(248,113,113,0.5); box-shadow: 0 0 22px rgba(239,68,68,0.18); }
      .cn-warhud--prep { background: linear-gradient(160deg, rgba(120,53,15,0.5), rgba(6,16,34,0.9) 60%); border-color: rgba(251,191,36,0.55); box-shadow: 0 0 22px rgba(251,191,36,0.14); }
      .cn-warhud-kicker { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 10.5px; font-weight: 800; letter-spacing: 0.22em; color: #FCA5A5; }
      .cn-warhud--prep .cn-warhud-kicker { color: #FCD34D; }
      .cn-warhud-city { text-align: center; font-size: 13px; color: var(--cn-text-dim); }
      .cn-warhud-city b { display: block; font-family: 'Space Grotesk', sans-serif; font-size: 18px; color: #fff; line-height: 1.15; }
      .cn-warhud-sides { display: flex; align-items: stretch; gap: 8px; }
      .cn-warhud-vs { align-self: center; font-size: 11px; font-weight: 800; color: #fff; opacity: 0.7; }
      .cn-warside { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 7px 9px; border-radius: 12px; }
      .cn-warside--att { align-items: flex-start; text-align: left; background: rgba(239,68,68,0.16); border: 1px solid rgba(239,68,68,0.5); }
      .cn-warside--def { align-items: flex-end; text-align: right; background: rgba(59,130,246,0.16); border: 1px solid rgba(59,130,246,0.5); }
      .cn-warside-role { font-size: 9.5px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.8; color: #fff; }
      .cn-warside-name { display: flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; color: #fff; max-width: 100%; line-height: 1.15; word-break: break-word; }
      .cn-warside-name svg, .cn-warside-name img, .cn-warside-name .cn-flag { flex-shrink: 0; }
      .cn-warside-num { font-family: 'Space Grotesk', sans-serif; font-size: 17px; font-weight: 800; color: #fff; }
      .cn-warside-allies { font-size: 10px; color: var(--cn-text-dim); }
      .cn-warhud-count { text-align: center; font-size: 12.5px; color: var(--cn-text-dim); }
      .cn-warhud-count b { color: #FBBF24; font-family: 'Space Grotesk', sans-serif; font-size: 15px; }
      .cn-warhud-mine { text-align: center; font-size: 11.5px; color: var(--cn-text-dim); }
      .cn-warhud-mine b { color: #fff; }
      .cn-warbar { position: relative; height: 18px; border-radius: 999px; overflow: hidden; background: linear-gradient(90deg, #1D4ED8, #3B82F6); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18); }
      .cn-warbar-att { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #B91C1C, #F87171); transition: width 0.6s ease; }
      .cn-warbar-spark { position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1.5px; background: #fff; box-shadow: 0 0 10px #fff; transition: left 0.6s ease; }
      .cn-warbar-legend { display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: var(--cn-text-dimmer); }
      .cn-warbar-net { font-size: 12px; font-weight: 800; color: #fff; }
      .cn-warhud-btn { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 9px; border-radius: 12px; cursor: pointer; font-weight: 800; font-size: 12.5px; color: #fff; background: rgba(var(--cn-accent-rgb),0.22); border: 1px solid rgba(var(--cn-accent-rgb),0.55); }
      .cn-wp-body { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; max-height: 320px; overflow-y: auto; }
      .cn-wp-summary { text-align: center; font-size: 11.5px; color: var(--cn-text-dim); }
      .cn-wp-summary b { color: #fff; }
      .cn-wp-side { display: flex; flex-direction: column; gap: 4px; }
      .cn-wp-side-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px; font-weight: 800; padding: 5px 9px; border-radius: 9px; color: #fff; }
      .cn-wp-side-head--att { background: rgba(220,38,38,0.28); }
      .cn-wp-side-head--def { background: rgba(37,99,235,0.3); }
      .cn-wp-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 9px; background: rgba(255,255,255,0.05); font-size: 12.5px; }
      .cn-wp-row--me { background: rgba(var(--cn-accent-rgb),0.2); }
      .cn-wp-rank { width: 18px; text-align: center; color: var(--cn-text-dimmer); font-weight: 700; font-size: 11.5px; }
      .cn-wp-ava { position: relative; width: 24px; height: 24px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.08); flex-shrink: 0; }
      .cn-wp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff; }
      .cn-wp-clicks { font-weight: 800; color: #FBBF24; font-family: 'Space Grotesk', sans-serif; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
      .cn-wp-clicks small { font-size: 9.5px; color: var(--cn-text-dimmer); font-weight: 600; }
      .cn-wp-empty { text-align: center; font-size: 11.5px; color: var(--cn-text-dimmer); padding: 4px; }
      .cn-warhud-btn:active { transform: scale(0.97); }
      .cn-warhud-declare { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 18px; cursor: pointer; text-align: left; color: #fff; background: linear-gradient(160deg, rgba(185,28,28,0.45), rgba(6,16,34,0.85)); border: 1px solid rgba(248,113,113,0.55); }
      .cn-warhud-declare:active { transform: scale(0.98); }
      .cn-warhud-declare-text { display: flex; flex-direction: column; gap: 3px; }
      .cn-warhud-declare-text b { font-size: 16px; font-family: 'Space Grotesk', sans-serif; }
      .cn-warhud-declare-text small { font-size: 11.5px; color: var(--cn-text-dim); line-height: 1.35; }
      .cn-pl { display: flex; flex-direction: column; gap: 10px; }
      .cn-pl-card { padding: 12px; border-radius: 16px; background: rgba(6,16,34,0.7); border: 1px solid rgba(var(--cn-accent-rgb),0.3); display: flex; flex-direction: column; gap: 6px; }
      .cn-pl-title { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 13px; color: #FDE68A; margin-bottom: 2px; }
      .cn-pl-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; }
      .cn-pl-label { color: var(--cn-text-dim); flex-shrink: 0; }
      .cn-pl-value { color: #fff; text-align: right; word-break: break-all; user-select: text; }
      .cn-pl-sub { font-size: 11.5px; color: var(--cn-text-dim); word-break: break-word; }
      .cn-pl-hist { padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,0.05); font-size: 12.5px; color: #fff; word-break: break-word; }
      .cn-pl-hist-time { display: block; font-size: 10.5px; font-weight: 700; color: #FDE68A; }
      .cn-pl-log { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; border-radius: 8px; font-size: 12px; color: #E6F0FF; border-left: 3px solid rgba(var(--cn-accent-rgb),0.6); background: rgba(255,255,255,0.04); word-break: break-word; }
      .cn-pl-log--ip, .cn-pl-log--isp, .cn-pl-log--device, .cn-pl-log--client { border-left-color: #FBBF24; }
      .cn-pl-log--admin { border-left-color: #F87171; }
      .cn-pl-log--name { border-left-color: #34D399; }
      .cn-pl-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; cursor: pointer; text-align: left; color: #fff; background: rgba(6,16,34,0.7); border: 1px solid rgba(var(--cn-accent-rgb),0.3); }
      .cn-pl-item:active { transform: scale(0.98); }
      .cn-pl-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .cn-pl-item-name { font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-pl-item-power { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 13px; color: #FBBF24; }
      .cn-mail-resolved { margin-top: 8px; font-size: 12px; font-weight: 700; color: var(--cn-text-dim); }
      .cn-hq-tile--locked { opacity: 0.5; }
      .cn-hq-lock { position: absolute; top: 7px; right: 7px; color: #FBBF24; }
      .cn-hq-badge { position: absolute; top: 5px; right: 6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: #EF4444; color: #fff; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
      .cn-hq-toast { padding: 8px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; text-align: center; color: #fff; background: rgba(251,191,36,0.16); border: 1px solid rgba(251,191,36,0.5); }
      .cn-hq-subhead { display: flex; align-items: center; gap: 10px; }
      .cn-hq-wip { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 34px 20px; border-radius: 20px; background: rgba(6,16,34,0.7); border: 1px dashed rgba(var(--cn-accent-rgb),0.45); }
      .cn-hq-wip-icon { width: 70px; height: 70px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--cn-accent-bright); background: rgba(var(--cn-accent-rgb),0.12); border: 1px solid rgba(var(--cn-accent-rgb),0.4); }
      .cn-hq-wip-title { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 800; color: #fff; }
      .cn-hq-wip-text { font-size: 13px; line-height: 1.5; color: var(--cn-text-dim); max-width: 280px; }

      /* Bottom nav */
      .cn-nav {
        display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px;
        padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
        flex-shrink: 0;
        background: rgba(var(--cn-nav-rgb),0.96);         border-top: 1px solid rgba(var(--cn-accent-rgb),0.4);
      }
      .cn-nav-btn {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
        background: rgba(var(--cn-panel-rgb),0.55); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        border-radius: 14px; color: #C7D8F0; cursor: pointer; padding: 8px 2px; -webkit-tap-highlight-color: transparent;
        transition: color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
      }
      .cn-nav-btn--active {
        color: var(--cn-accent); border-color: var(--cn-accent);
        background: rgba(var(--cn-accent-rgb),0.14);
        box-shadow: 0 0 18px rgba(var(--cn-accent-rgb),0.5), inset 0 0 16px rgba(var(--cn-accent-rgb),0.12);
      }
      .cn-nav-btn--active .cn-nav-icon-wrap { animation: cn-nav-glow-pulse 1.8s ease-in-out infinite; }
      @keyframes cn-nav-glow-pulse {
        0%, 100% { filter: drop-shadow(0 0 3px rgba(var(--cn-accent-rgb),0.6)); }
        50% { filter: drop-shadow(0 0 9px rgba(var(--cn-accent-rgb),0.95)); }
      }
      .cn-nav-icon-wrap { position: relative; display: flex; }
      .cn-nav-dot { position: absolute; top: -2px; right: -4px; width: 6px; height: 6px; border-radius: 50%; background: #FBBF24; }
      .cn-nav-label { font-size: 8.5px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; text-align: center; line-height: 1.15; }

      ::-webkit-scrollbar { width: 0px; height: 0px; }
      /* Nav badge (unread mail) */
      .cn-nav-badge {
        position: absolute; top: -6px; right: -8px; min-width: 15px; height: 15px; padding: 0 3px;
        border-radius: 999px; background: #EF4444; color: #fff; font-size: 9px; font-weight: 700;
        display: flex; align-items: center; justify-content: center; line-height: 1;
      }

      /* Profile header icon buttons */
      .cn-profile-header-actions { display: flex; gap: 8px; }
      .cn-icon-btn {
        position: relative; width: 34px; height: 34px; border-radius: 10px;
        border: 1px solid rgba(var(--cn-accent-rgb),0.4); background: rgba(var(--cn-panel-rgb),0.6);
        color: var(--cn-text-dim); display: flex; align-items: center; justify-content: center; cursor: pointer;
      }
      .cn-icon-btn-badge {
        position: absolute; top: -5px; right: -5px; min-width: 15px; height: 15px; padding: 0 3px;
        border-radius: 999px; background: #EF4444; color: #fff; font-size: 9px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
      }

      /* Mail */
      .cn-mail-list { display: flex; flex-direction: column; gap: 8px; }
      .cn-mail-item { border-radius: 14px; background: rgba(var(--cn-panel-rgb),0.45); border: 1px solid rgba(var(--cn-accent-rgb),0.4); overflow: hidden; }
      .cn-mail-item--unread { border-color: rgba(var(--cn-accent-rgb),0.5); background: rgba(var(--cn-accent-rgb),0.08); }
      .cn-mail-item-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: none; border: none; cursor: pointer; text-align: left; }
      .cn-mail-item-icon { color: var(--cn-text-dim); flex-shrink: 0; }
      .cn-mail-item-text { flex: 1; min-width: 0; }
      .cn-mail-item-subject { font-size: 13.5px; color: var(--cn-text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cn-mail-item-time { font-size: 11px; color: var(--cn-text-dimmer); margin-top: 2px; }
      .cn-mail-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--cn-accent); flex-shrink: 0; }
      .cn-mail-item-body { padding: 0 14px 14px; font-size: 13px; color: var(--cn-text-dim); line-height: 1.5; }
      .cn-mail-actions { display: flex; gap: 8px; margin-top: 10px; }
      .cn-mail-action {
        flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
        padding: 9px; border-radius: 10px; border: none; font-size: 12.5px; font-weight: 600; cursor: pointer;
      }
      .cn-mail-action--accept { background: rgba(16,185,129,0.15); color: #34D399; border: 1px solid rgba(16,185,129,0.35); }
      .cn-mail-action--decline { background: rgba(239,68,68,0.12); color: #F87171; border: 1px solid rgba(239,68,68,0.3); }

      /* Settings */
      .cn-settings-section-title, .cn-alliance-section-title {
        display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
        color: var(--cn-text-dimmer); text-transform: uppercase; letter-spacing: 0.06em; margin: 4px 0 10px;
      }
      .cn-theme-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
      .cn-theme-swatch {
        position: relative; display: flex; align-items: center; gap: 8px; padding: 10px 12px;
        border-radius: 12px; background: rgba(var(--cn-panel-rgb),0.5); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        color: var(--cn-text); cursor: pointer; font-size: 13px;
      }
      .cn-theme-swatch--active { border-color: var(--cn-accent); background: rgba(var(--cn-accent-rgb),0.12); }
      .cn-theme-swatch-dot { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.25); }
      .cn-theme-swatch-label { flex: 1; text-align: left; }
      .cn-theme-swatch-check { color: var(--cn-accent); flex-shrink: 0; }

      .cn-lang-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
      .cn-lang-btn {
        position: relative; display: flex; align-items: center; gap: 8px; padding: 10px 12px;
        border-radius: 12px; background: rgba(var(--cn-panel-rgb),0.5); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        color: var(--cn-text); cursor: pointer; font-size: 13px;
      }
      .cn-lang-btn--active { border-color: var(--cn-accent); background: rgba(var(--cn-accent-rgb),0.12); }
      .cn-lang-flag { font-size: 17px; flex-shrink: 0; }
      .cn-lang-label { flex: 1; text-align: left; }
      .cn-lang-check { color: var(--cn-accent); flex-shrink: 0; }

      .cn-lang-select-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 18px 0; width: 100%; }
      .cn-lang-select-btn {
        position: relative; display: flex; align-items: center; gap: 8px; padding: 11px 12px;
        border-radius: 12px; background: rgba(var(--cn-panel-rgb),0.5); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        color: var(--cn-text); cursor: pointer; font-size: 13px;
      }
      .cn-lang-select-btn--active { border-color: var(--cn-accent); background: rgba(var(--cn-accent-rgb),0.12); }
      .cn-lang-select-flag { font-size: 17px; flex-shrink: 0; }
      .cn-lang-select-label { flex: 1; text-align: left; }
      .cn-lang-select-check { color: var(--cn-accent); flex-shrink: 0; }

      .cn-dev-toggle {
        width: 100%; display: flex; align-items: center; gap: 8px; padding: 12px 14px;
        border-radius: 12px; background: rgba(var(--cn-panel-rgb),0.5); border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        color: var(--cn-text-dim); font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .cn-dev-toggle .cn-chevron { margin-left: auto; }
      .cn-dev-panel { margin-top: 8px; padding: 12px; border-radius: 12px; background: rgba(0,0,0,0.15); border: 1px dashed rgba(var(--cn-accent-rgb),0.35); display: flex; flex-direction: column; gap: 8px; }
      .cn-dev-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .cn-dev-row-label { font-size: 12.5px; color: var(--cn-text-dim); }
      .cn-dev-btn {
        display: flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 9px; border: 1px solid rgba(var(--cn-accent-rgb),0.4);
        background: rgba(var(--cn-accent-rgb),0.1); color: var(--cn-accent); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
      }
      .cn-dev-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .cn-dev-btn--danger { background: rgba(239,68,68,0.12); color: #F87171; border-color: rgba(239,68,68,0.3); }
      .cn-dev-btn--confirm { background: #EF4444; color: #fff; }
      .cn-dev-country-dropdown { position: static; margin-top: 4px; box-shadow: none; }
      .cn-dev-status-row {
        display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--cn-text-dim);
        padding-bottom: 4px; border-bottom: 1px dashed var(--cn-panel-border);
      }
      .cn-dev-status-yes { color: #34D399; }
      .cn-dev-status-msg {
        font-size: 12px; color: var(--cn-accent); background: rgba(var(--cn-accent-rgb),0.1);
        border: 1px solid rgba(var(--cn-accent-rgb),0.3); padding: 7px 10px; border-radius: 9px;
      }
      .cn-dev-warning {
        font-size: 11.5px; line-height: 1.4; color: #FBBF24; background: rgba(251,191,36,0.1);
        border: 1px solid rgba(251,191,36,0.3); padding: 8px 10px; border-radius: 9px;
      }

      /* Alliance */
      .cn-alliance-icon { color: var(--cn-accent); margin-left: auto; }
      .cn-alliance-hint { font-size: 11.5px; color: var(--cn-text-dimmer); margin-left: auto; }

      /* War */
      .cn-war-banner {
        padding: 14px; border-radius: 16px; margin-bottom: 14px;
        background: linear-gradient(135deg, rgba(239,68,68,0.12), rgba(var(--cn-panel-rgb),0.5));
        border: 1px solid rgba(239,68,68,0.3);
      }
      .cn-clicker-war-banner {
        width: 100%; max-width: 320px; padding: 12px 14px; border-radius: 14px; margin-bottom: 6px;
        background: linear-gradient(135deg, rgba(239,68,68,0.14), rgba(var(--cn-panel-rgb),0.5));
        border: 1px solid rgba(239,68,68,0.35);
      }
      .cn-war-banner-row { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; font-weight: 600; color: var(--cn-text); }
      .cn-war-vs-icon { color: #F87171; }
      .cn-war-city { text-align: center; font-size: 11.5px; color: var(--cn-text-dim); margin-top: 2px; }
      .cn-war-timer { text-align: center; font-size: 12.5px; color: #FBBF24; font-weight: 600; margin: 8px 0; }
      .cn-war-power-bars { margin-bottom: 10px; }
      .cn-war-power-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--cn-text-dim); font-weight: 600; }
      .cn-war-power-bar { flex: 1; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; }
      .cn-war-power-fill--attacker { height: 100%; background: linear-gradient(90deg, #F87171, #FBBF24); }
      .cn-clicker-ally-war-banner {
        cursor: pointer; user-select: none;
        background: linear-gradient(135deg, rgba(56,189,248,0.14), rgba(var(--cn-panel-rgb),0.5));
        border: 1px solid rgba(56,189,248,0.35);
        transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      }
      .cn-clicker-ally-war-banner:active { transform: scale(0.98); }
      .cn-clicker-ally-war-banner--helping {
        background: linear-gradient(135deg, rgba(34,211,238,0.22), rgba(var(--cn-panel-rgb),0.5));
        border: 1px solid rgba(34,211,238,0.6);
        box-shadow: 0 0 14px rgba(34,211,238,0.25);
      }
      .cn-war-attack-btn {
        width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
        padding: 12px; border-radius: 12px; border: none; background: linear-gradient(135deg, #EF4444, #F97316);
        color: #fff; font-weight: 700; font-size: 14px; cursor: pointer;
      }
      .cn-war-attack-btn:active { transform: scale(0.97); }
      .cn-ally-invite-list { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
      .cn-war-declare-btn {
        margin-top: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
        padding: 11px; border-radius: 12px; border: none; background: linear-gradient(135deg, #EF4444, #DC2626);
        color: #fff; font-weight: 700; font-size: 13.5px; cursor: pointer;
      }
      .cn-region-card-owner { font-size: 11.5px; color: #FBBF24; text-align: center; margin-top: 4px; }
      .cn-region-card-note { font-size: 11px; color: var(--cn-text-dimmer); text-align: center; margin-top: 8px; }
      .cn-map-fire-icon { filter: drop-shadow(0 0 4px rgba(239,68,68,0.8)); }

    
      /* ---- Global glow pass (whole-game redesign) ---- */
      .cn-profile-card { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-mail-item { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-map-card { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-war-banner { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-clicker-war-banner { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-country-select { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-dev-panel { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-theme-swatch { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-stat-chip { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-region-country-row { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-country-dropdown { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-row { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-boot { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-onboard-header { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-icon-btn { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-refresh-btn { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-map-zoom-btn { box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 0 14px rgba(var(--cn-accent-rgb),0.18); }
      .cn-map-viewport { box-shadow: 0 0 0 1px rgba(var(--cn-accent-rgb),0.12), 0 16px 44px rgba(0,0,0,0.5), inset 0 0 56px rgba(var(--cn-accent-rgb),0.1); }
      .cn-region-country-list { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-news-item { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-reward-cell { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }
      .cn-country-dropdown-item { box-shadow: 0 0 14px rgba(var(--cn-accent-rgb),0.1); }

      .cn-screen-title {
        text-shadow: 0 0 18px rgba(var(--cn-accent-rgb),0.35);
      }
      .cn-profile-name, .cn-map-card-name, .cn-region-title, .cn-modal-title, .cn-mail-item-subject {
        text-shadow: 0 0 12px rgba(var(--cn-accent-rgb),0.25);
      }

      /* Buttons: give primary/dev/action buttons the same glowing-tile language */
      .cn-primary-btn { box-shadow: 0 0 22px rgba(var(--cn-accent-rgb),0.45), 0 8px 24px rgba(0,0,0,0.35); }
      .cn-dev-btn, .cn-war-attack-btn, .cn-war-declare-btn, .cn-mail-action--accept {
        box-shadow: 0 0 12px rgba(var(--cn-accent-rgb),0.2);
      }
      .cn-country-select-flag, .cn-flag-wrap { filter: drop-shadow(0 0 4px rgba(var(--cn-accent-rgb),0.4)); }

      /* Onboarding + Boot screen icons pick up the same glow family */
      .cn-onboard-icon, .cn-boot-icon { filter: drop-shadow(0 0 14px rgba(var(--cn-accent-rgb),0.6)); }
`}</style>
  );
}
