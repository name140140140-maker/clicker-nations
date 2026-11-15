import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { DRONE_MODELS } from "../droneModels.js";
import { Lock, Crown, X, Search, Settings, Mail, Handshake, Swords, Crosshair, Target, ArrowLeftRight, Palette, Shield, Compass, ArrowLeft, ChevronRight, Coins, Sparkles, Info, TrendingUp, BarChart2 } from "lucide-react";
import { activeFor, activePandemics } from "../worldEvents";
import { UPG_MAX_LEVEL } from "../progressData";
import { worldOp, progressOp } from "../powerApi";
import { loadBank, bankDeposit, bankWithdraw, cureVirus, ensureSnaps, cureCost, CURE_BASE } from "../bank";
import { setPandemicState, getCures, countryStatus, onPandemicChange, closedBordersOf, diseaseByName, CONTAG_LABEL, lethalLabel } from "../pandemic";
import { virusByCountry, fmtPct } from "../virusStats";
import { LazyFallback, COUNTRY_MAP, DEAD_COUNTRIES, FLUSH_POWER, Flag, Nick, UPGRADES, addMail, cnSfx, dipRelation, fmt, fmtDuration, isSuperAdmin, loadDiplomacy, respondDiplomacyRequest, storageGet, t, upgLevel, warPhase, warSide, worldPaid } from "../app/shared.jsx";
import { MapScreen } from "./MapScreen.jsx";
import { MailScreen } from "./MailScreen.jsx";
import { DiplomacyPanel } from "./DiplomacyPanel.jsx";
import { setTick, clearTick } from "../core/ticker.js";



/* Міні-ігри завантажуються лише коли гравець їх запускає (окремі чанки, не в стартовому бандлі) */
const DroneGame = lazy(() => import("../DroneGame.jsx"));

const SniperGame = lazy(() => import("../SniperGame.jsx"));


/* ------------------------------------------------------------------ */
/*  Покращення (за Points): енергія та оборона міста                   */
/*  player.upg = { emax, ereg, cdef } — куплений рівень 0..5          */
/* ------------------------------------------------------------------ */
const WAR_DECLARE_COST = 5000;
 // capcd:<країна> → час, до якого країна не може захоплювати вільні області
const CITY_DEF_UPGRADE_COST = 5000;
 // "off" — адмін вимкнув Telegram-сповіщення для всіх
const CITY_DEF_PREFIX = "citydef:";

const CITY_DEF_THRESHOLDS = [10000, 12000, 15000, 20000, 25000, 30000];

async function getCityDefLevel(cityKeyStr) {
  const raw = await storageGet(CITY_DEF_PREFIX + cityKeyStr, true);
  const n = Math.floor(Number(raw) || 0);
  return Math.max(0, Math.min(UPG_MAX_LEVEL, n));
}

const DIP_KIND = {
  ally: { noun: "союз", title: "Союз", req: "Запит на союз" },
  pact: { noun: "пакт про ненапад", title: "Пакт про ненапад", req: "Пропозиція пакту про ненапад" },
};


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
  return worldOp("dip-request", { kind, to });
}

async function closeBorder(mine, other) {
  if (!COUNTRY_MAP[other] || other === mine) return { ok: false, reason: "Обери іншу країну" };
  const r = await worldOp("border-close", { other });
  if (!r.ok) return r;
  const dip = await loadDiplomacy();
  setPandemicState({ borders: dip.borders, cfg: undefined });
  return { ok: true };
}

async function openBorder(mine, other) {
  return worldOp("border-open", { other });
}


async function breakDiplomacy(kind, mine, other) {
  return worldOp("dip-break", { kind, other });
}



async function declareWar2({ attacker, defender, city, selfId = null, onUpdatePlayer = null }) {
  if (!COUNTRY_MAP[defender]) return { ok: false, reason: "Країну не знайдено" };
  if (attacker === defender) return { ok: false, reason: "Не можна нападати на себе" };
  const r = await worldPaid("war-declare", { defender, cityKey: city.key || "", cityId: city.id }, onUpdatePlayer);
  if (!r.ok) return r;
  const war = r.war;
  const id = war.id;
  const an = COUNTRY_MAP[attacker]?.name || attacker;
  const dn = COUNTRY_MAP[defender]?.name || defender;
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
                (d.disabled ? " Сповіщення вимкнено в адмін-панелі." : "") +
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
  return { ok: true, war };
}


/* ------------------------------------------------------------------ */
/*  Boot screen                                                         */
/* ------------------------------------------------------------------ */

/* Логотип гри: глобус із літерою W посередині. Малюється SVG, колір береться з акценту теми. */


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
  { id: "bank", label: "Банк країни", Icon: Coins, text: "" },
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


/* Оперативна стрічка Штабу: що важливого зараз для твоєї країни (запити, війна, події світу, пошта) */
function HqBrief({ me, players = [], isLeader, dip, war, unreadCount = 0, onOpenMail, onAnswered, onOpenBank, onUpdatePlayer }) {
  const mine = me.countryCode;
  const [bankBal, setBankBal] = useState(null);
  const [snaps, setSnaps] = useState({}); // id пандемії → знімок Power країни
  const [cureBusy, setCureBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState("");
  const [, setTick] = useState(0);
  useEffect(() => onPandemicChange(() => setTick((x) => x + 1)), []);
  useEffect(() => {
    const id = setTick(() => setTick((x) => x + 1), 30000);
    return () => clearTick(id);
  }, []);
  const sickIds = activePandemics(Date.now()).filter((e) => { const st = countryStatus(e, mine, Date.now()); return st && st.arrived && !st.cured; }).map((e) => e.id).join(",");
  useEffect(() => {
    if (!sickIds) return undefined;
    let dead = false;
    (async () => {
      const b = await loadBank(mine);
      if (!dead && b) setBankBal(b.balance);
      const sn = await ensureSnaps(); // знімок Power країни фіксує сервер
      if (!dead && sn) setSnaps(sn);
    })();
    return () => { dead = true; };
  }, [sickIds, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)} г ${m % 60} хв` : `${m} хв`;
  };
  const KIND = { ally: "Союз", pact: "Пакт про ненапад", ceasefire: "Перемир'я" };
  const now = Date.now();
  const incoming = (dip?.requests || []).filter((r) => r.status === "pending" && r.to === mine && now - (r.ts || 0) < 24 * 3600 * 1000);
  const outgoing = (dip?.requests || []).filter((r) => r.status === "pending" && r.from === mine && now - (r.ts || 0) < 24 * 3600 * 1000);
  const answer = async (r, accept) => {
    if (busyId) return;
    setBusyId(r.id);
    setNote("");
    const res = await respondDiplomacyRequest(r.id, accept);
    setNote(res.ok ? (accept ? "✓ Прийнято" : "✓ Відхилено") : "✗ " + (res.reason || "Не вдалося"));
    setBusyId(null);
    onAnswered && onAnswered();
  };
  const items = [];
  for (const r of incoming) {
    items.push(
      <div key={"in" + r.id} className="cn-brief-card cn-brief-card--hot">
        <Flag code={r.from} size={24} className="cn-country-badge--lg" />
        <div className="cn-brief-main">
          <div className="cn-brief-title">{KIND[r.type] || "Пропозиція"}: {COUNTRY_MAP[r.from]?.name || r.from}</div>
          <div className="cn-brief-sub">{isLeader ? "Чекає твоєї відповіді" : "Вирішує лідер країни"} · ще {left(24 * 3600 * 1000 - (now - r.ts))}</div>
        </div>
        {isLeader && (
          <div className="cn-brief-act">
            <button type="button" className="cn-dev-btn cn-dev-btn--primary" disabled={!!busyId} onClick={() => answer(r, true)}>Прийняти</button>
            <button type="button" className="cn-dev-btn" disabled={!!busyId} onClick={() => answer(r, false)}>Ні</button>
          </div>
        )}
      </div>
    );
  }
  if (war && war.status !== "ended") {
    const ph = warPhase(war);
    const side = warSide(war, mine);
    if (ph === "prep" || ph === "battle") {
      const endAt = ph === "prep" ? war.prepEnd : war.battleEnd;
      items.push(
        <div key="war" className="cn-brief-card cn-brief-card--war">
          <Swords size={20} />
          <div className="cn-brief-main">
            <div className="cn-brief-title">{COUNTRY_MAP[war.attacker]?.name || war.attacker} → {COUNTRY_MAP[war.defender]?.name || war.defender}: {war.cityName}</div>
            <div className="cn-brief-sub">{side === "att" ? "Ви нападаєте" : side === "def" ? "Ви обороняєтесь" : "Війна"} · {ph === "prep" ? "підготовка" : "битва"}, ще {left(endAt - now)}</div>
          </div>
        </div>
      );
    }
  }
  /* Знищення вірусу у своїй країні: оплачується з банку країни, лише лідер */
  const cureBlock = (e, r) => {
    if (!r || r.cured) return null;
    const snap = snaps[e.id];
    if (snap === undefined) return <div className="cn-cure-line">Рахуємо вартість знищення…</div>;
    const c = cureCost(snap, r.infected, r.deaths);
    const short = bankBal === null ? 0 : Math.max(0, c.total - bankBal);
    const doCure = async () => {
      if (cureBusy || !isLeader) return;
      setCureBusy(true);
      setNote("");
      const res = await cureVirus(e.id, c.total);
      if (res.ok) {
        const prev = getCures();
        setPandemicState({ cures: [...prev, { id: e.id, code: mine, ts: res.ts }] });
        setBankBal(res.balance);
        setNote("✓ Вірус знищено");
      } else setNote("✗ " + res.reason);
      setCureBusy(false);
    };
    return (
      <div className="cn-cure">
        <div className="cn-cure-line">Знищити вірус у країні: <b>{fmt(c.total)} Power</b></div>
        <div className="cn-cure-line cn-cure-sub">
          База ({Math.round(CURE_BASE * 100)}% від {fmt(c.snap)} Power гравців на початку) {fmt(c.base)} · за хворих +{fmt(c.byInf)} · за померлих +{fmt(c.byDead)}
        </div>
        <div className="cn-cure-line cn-cure-sub">У банку країни: {bankBal === null ? "…" : fmt(bankBal)} Power{short > 0 ? ` · не вистачає ${fmt(short)}` : ""}</div>
        <div className="cn-brief-act cn-cure-act">
          {isLeader ? (
            <button type="button" className="cn-dev-btn cn-dev-btn--primary" disabled={cureBusy || short > 0 || bankBal === null} onClick={doCure}>Знищити вірус</button>
          ) : (
            <span className="cn-cure-line cn-cure-sub">Знищити може лише лідер</span>
          )}
          <button type="button" className="cn-dev-btn" onClick={onOpenBank}>Внести в банк</button>
        </div>
      </div>
    );
  };
  /* Пандемії: як вони стосуються моєї країни */
  const vByC = virusByCountry(now);
  const closedN = closedBordersOf(mine, now).length;
  for (const e of activePandemics(now)) {
    const d = diseaseByName(e.disease);
    const row = vByC[mine]?.list.find((l) => l.e.id === e.id);
    items.push(
      <div key={"vir" + e.id} className={"cn-brief-card cn-brief-card--evt cn-brief-card--col"}>
        <div className="cn-brief-row">
          <span className="cn-brief-emoji">🦠</span>
          <div className="cn-brief-main">
            <div className="cn-brief-title">Пандемія: {e.disease} · осередок {COUNTRY_MAP[e.code]?.name || e.code}</div>
            <div className="cn-brief-sub">
              {row
                ? (row.cured ? `У вас вірус знищено. Померло ${fmtPct(row.deaths)}` : `У вас: хворіє ${fmtPct(row.infected)}, померло ${fmtPct(row.deaths)}`)
                : `Вірус ще не дійшов до вас${closedN ? "" : isLeader ? ". Закрий кордони в Дипломатії" : ""}`}
              {" · "}заразність {CONTAG_LABEL[d.contag]}, летальність {lethalLabel(d.cfr)}
              {closedN ? ` · закритих кордонів: ${closedN}` : ""}
            </div>
          </div>
        </div>
        {cureBlock(e, row)}
      </div>
    );
  }
  for (const e of activeFor(mine).filter((x) => x.type !== "pandemic")) {
    items.push(
      <div key={e.id} className="cn-brief-card cn-brief-card--evt">
        <span className="cn-brief-emoji">{e.meta.emoji}</span>
        <div className="cn-brief-main">
          <div className="cn-brief-title">{e.meta.label}{e.code ? "" : ": весь світ"}</div>
          <div className="cn-brief-sub">{e.effect} · до {new Date(e.end).toLocaleDateString("uk-UA", { day: "numeric", month: "short" })}</div>
        </div>
      </div>
    );
  }
  for (const r of outgoing) {
    items.push(
      <div key={"out" + r.id} className="cn-brief-card">
        <Flag code={r.to} size={24} className="cn-country-badge--lg" />
        <div className="cn-brief-main">
          <div className="cn-brief-title">{KIND[r.type] || "Пропозиція"}: чекаємо {COUNTRY_MAP[r.to]?.name || r.to}</div>
          <div className="cn-brief-sub">Відповідь протягом {left(24 * 3600 * 1000 - (now - r.ts))}</div>
        </div>
      </div>
    );
  }
  if (unreadCount > 0) {
    items.push(
      <button key="mail" type="button" className="cn-brief-card cn-brief-card--btn" onClick={onOpenMail}>
        <Mail size={20} />
        <div className="cn-brief-main">
          <div className="cn-brief-title">Нові листи: {unreadCount}</div>
          <div className="cn-brief-sub">Відкрити пошту</div>
        </div>
        <ChevronRight size={16} />
      </button>
    );
  }
  return (
    <div className="cn-brief">
      <div className="cn-brief-head">Головне зараз{items.length ? <span className="cn-brief-count">{items.length}</span> : null}</div>
      {note && <div className="cn-brief-note">{note}</div>}
      {items.length ? items : (
        <div className="cn-brief-empty">
          <Shield size={26} strokeWidth={1.6} />
          <div>Усе спокійно. Нових запитів і загроз немає.</div>
        </div>
      )}
    </div>
  );
}


export function HQScreen({ player, players, nations, isLeader, onChangeCountryColor, onChangeCountry, lang = "uk", mail = [], unreadCount = 0, onRefreshMail, onRefreshData, war = null, onWarDeclared, onUpdatePlayer }) {
  const [view, setView] = useState(null); // null | id розділу | "dev"
  const [pickKind, setPickKind] = useState(null); // null | "ally" | "pact"
  const [dip, setDip] = useState(null);
  const [dipMsg, setDipMsg] = useState("");
  const [lockedMsg, setLockedMsg] = useState("");
  const [warPick, setWarPick] = useState(null); // null | { step: "country" } | { step: "city", country }
  const [warMsg, setWarMsg] = useState("");
  const [armySub, setArmySub] = useState(null); // null | id підрозділу Армії
  const [switchOpen, setSwitchOpen] = useState(false); // вибір нової країни
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
  /* Головний екран Штабу: підтягуємо дипломатію (запити на союз/пакт/перемир'я) і оновлюємо раз на 30 с */
  useEffect(() => {
    if (view) return undefined;
    reloadDip();
    const id = setTick(reloadDip, 30000);
    return () => clearTick(id);
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
    if (kind === "border") {
      const r = await closeBorder(player.countryCode, countryId);
      if (r.ok) { cnSfx.purchase(); setDipMsg(`✓ Кордон із ${COUNTRY_MAP[countryId]?.name || countryId} закрито`); }
      else { cnSfx.error(); setDipMsg("✗ " + r.reason); }
      reloadDip();
      return;
    }
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
      selfId: player.id,
      onUpdatePlayer,
    });
    if (res.ok) {
      cnSfx.purchase();
      setWarMsg("");
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
    (async () => {
      const r = await progressOp("buy-upgrade", { id });
      if (!r.ok) { cnSfx.error(); setUpgMsg("✗ " + r.reason); return; }
      onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, points: r.points, upg: r.upg }));
      cnSfx.purchase();
      setUpgMsg(`✓ «${u.title}»: рівень ${lvl + 1} відкрито`);
    })();
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
    const dr = await worldPaid("citydef", { cityKey: defCity.key }, onUpdatePlayer);
    if (!dr.ok) return fail(dr.reason);
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
      <Suspense fallback={<LazyFallback />}>
        <SniperGame
          country={COUNTRY_MAP[sniperRun.country]?.name || ""}
          color={COUNTRY_MAP[sniperRun.country]?.color || ""}
          onClose={(ok) => {
            const n = COUNTRY_MAP[sniperRun.country]?.name || "";
            setSniperRun(null);
            setWarMsg(ok ? `✓ Замах на лідера країни ${n} вдався` : `Замах на лідера країни ${n} не вдався`);
          }}
        />
      </Suspense>
    );
  }

  if (view === "army" && droneRun) {
    return (
      <Suspense fallback={<LazyFallback />}>
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
      </Suspense>
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
            label: pickKind === "ally" ? "Обери країну для союзу" : pickKind === "border" ? "Обери країну, з якою закрити кордон" : "Обери країну для пакту про ненапад",
            onPick: onPickCountry,
            onCancel: () => setPickKind(null),
            virus: pickKind === "border",
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
        {switchOpen && (
          <CountrySwitchModal
            countries={nations?.countries || []}
            current={player.countryCode}
            lang={lang}
            onClose={() => setSwitchOpen(false)}
            onConfirm={async (id) => {
              const res = await onChangeCountry(id);
              if (res.ok) { setSwitchOpen(false); setView(null); }
              return res;
            }}
          />
        )}
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
            onChangeCountry={() => { cnSfx.navSwitch(); setSwitchOpen(true); }}
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
            onOpenBorder={async (other) => {
              const r = await openBorder(player.countryCode, other);
              setDipMsg(r.ok ? `✓ Кордон із ${COUNTRY_MAP[other]?.name || other} відкрито` : "✗ " + r.reason);
              reloadDip();
            }}
            onBreak={async (kind, other) => {
              await breakDiplomacy(kind, player.countryCode, other);
              setDipMsg(`✓ ${DIP_KIND[kind].title} з ${COUNTRY_MAP[other]?.name || other} розірвано. 4 години нападати заборонено.`);
              reloadDip();
              onRefreshData && onRefreshData();
            }}
          />
        ) : view === "bank" ? (
          <BankPanel me={player} players={players} isLeader={isLeader} onUpdatePlayer={onUpdatePlayer} />
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

      <HqBrief
        me={player}
        players={players}
        onUpdatePlayer={onUpdatePlayer}
        onOpenBank={() => openView("bank")}
        isLeader={isLeader}
        dip={dip}
        war={war}
        unreadCount={unreadCount}
        onOpenMail={() => openView("mail")}
        onAnswered={() => { reloadDip(); onRefreshData && onRefreshData(); }}
      />

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




/* Банк країни: внески роблять усі гравці країни, знімає й витрачає на знищення вірусів лише лідер */
function BankPanel({ me, players, isLeader, onUpdatePlayer }) {
  const code = me.countryCode;
  const [bank, setBank] = useState(undefined); // undefined — вантажимо, null — помилка
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => setBank(await loadBank(code)), [code]);
  useEffect(() => {
    reload();
    const id = setTick(reload, 20000);
    return () => clearTick(id);
  }, [reload]);
  const nameOf = (id, fallback) => (players || []).find((p) => p.id === id)?.username || fallback || "Гравець";
  const num = Math.floor(Number(String(amount).replace(/\s/g, "")) || 0);
  const deposit = async () => {
    if (busy) return;
    if (num <= 0) return setMsg("✗ Вкажи суму");
    if (num > (me.power || 0)) return setMsg("✗ У тебе немає стільки Power");
    setBusy(true);
    setMsg("");
    if (FLUSH_POWER) await FLUSH_POWER();
    const r = await bankDeposit(num);
    if (!r.ok) {
      setMsg("✗ " + r.reason);
    } else {
      onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, power: r.power }));
      setMsg(`✓ Внесено ${fmt(num)} Power`);
      setAmount("");
    }
    await reload();
    setBusy(false);
  };
  const withdraw = async () => {
    if (busy || !isLeader) return;
    if (num <= 0) return setMsg("✗ Вкажи суму");
    setBusy(true);
    setMsg("");
    const r = await bankWithdraw(num);
    if (r.ok) {
      onUpdatePlayer && onUpdatePlayer((prev) => ({ ...prev, power: r.power }));
      setMsg(`✓ Знято ${fmt(num)} Power`);
      setAmount("");
    } else setMsg("✗ " + r.reason);
    await reload();
    setBusy(false);
  };
  const KIND = { dep: "Внесок", wd: "Зняття", cure: "Знищення вірусу" };
  return (
    <div className="cn-bank">
      <div className="cn-bank-card">
        <div className="cn-bank-label">Банк країни {COUNTRY_MAP[code]?.name || code}</div>
        <div className="cn-bank-sum">{bank === undefined ? "…" : bank === null ? "—" : fmt(bank.balance)} <small>Power</small></div>
        <div className="cn-bank-hint">Вносити можуть усі гравці країни. Зняти може лише лідер. З банку оплачується знищення вірусів.</div>
      </div>
      <div className="cn-bank-form">
        <input className="cn-bank-input" inputMode="numeric" placeholder="Сума Power" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9\s]/g, ""))} />
        <div className="cn-bank-btns">
          <button type="button" className="cn-dev-btn cn-dev-btn--primary" disabled={busy} onClick={deposit}>Внести</button>
          <button type="button" className="cn-dev-btn" disabled={busy || !isLeader} onClick={withdraw}>{isLeader ? "Зняти" : "Зняти (лідер)"}</button>
        </div>
        <div className="cn-bank-sub">Твій Power: {fmt(me.power || 0)}</div>
        {msg && <div className="cn-bank-msg">{msg}</div>}
      </div>
      {bank && bank.top.length > 0 && (
        <div className="cn-bank-block">
          <div className="cn-bank-h">Найбільші внески</div>
          {bank.top.slice(0, 5).map((t, i) => (
            <div key={i} className="cn-bank-row"><span>{i + 1}. {t.n || "Гравець"}</span><b>{fmt(t.a)}</b></div>
          ))}
        </div>
      )}
      {bank && (
        <div className="cn-bank-block">
          <div className="cn-bank-h">Останні операції</div>
          {bank.list.length === 0 && <div className="cn-bank-sub">Поки порожньо</div>}
          {bank.list.slice(0, 12).map((x, i) => (
            <div key={i} className="cn-bank-row">
              <span>{KIND[x.t]} · {nameOf(x.p, x.n)} <small>{new Date(x.ts).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></span>
              <b className={x.t === "dep" ? "cn-bank-plus" : "cn-bank-minus"}>{x.t === "dep" ? "+" : "−"}{fmt(x.a)}</b>
            </div>
          ))}
        </div>
      )}
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
function CountrySwitchModal({ countries, current, lang = "uk", onClose, onConfirm }) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return countries.filter((c) => c.id !== current && !DEAD_COUNTRIES.has(c.id) && (!q || String(c.name).toLowerCase().includes(q) || String(c.nameEn || "").toLowerCase().includes(q) || c.id.toLowerCase() === q));
  }, [countries, current, query]);
  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true); setError("");
    const res = await onConfirm(pending.id);
    if (!res.ok) { setError(res.reason || "Не вдалося змінити країну"); setBusy(false); setPending(null); }
  };
  return (
    <div className="cn-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="cn-modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cn-modal-header">
          <div className="cn-modal-title"><ArrowLeftRight size={16} /> Змінити країну</div>
          <button className="cn-icon-btn" type="button" onClick={() => !busy && onClose()} aria-label="Закрити"><X size={16} /></button>
        </div>
        {pending ? (
          <div className="cn-confirm-modal" style={{ position: "static", boxShadow: "none", background: "transparent", border: 0 }}>
            <Flag code={pending.id} size={52} className="cn-country-badge--lg" />
            <div className="cn-confirm-title">{pending.name}</div>
            <div className="cn-confirm-text">Перейти до цієї країни? Наступна зміна можлива лише через добу. Якщо ти лідер своєї країни, ти втратиш цю роль.</div>
            <div className="cn-confirm-actions">
              <button type="button" className="cn-dev-btn" disabled={busy} onClick={() => setPending(null)}>Назад</button>
              <button type="button" className="cn-dev-btn cn-dev-btn--primary" disabled={busy} onClick={confirm}>{busy ? "…" : "Перейти"}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="cn-country-search-wrap cn-country-search-wrap--static">
              <Search size={15} className="cn-country-search-icon" />
              <input className="cn-country-search" placeholder={t(lang, "onboard_country_search")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {error && <div className="cn-onboard-blocked-msg">{error}</div>}
            <div className="cn-nation-list">
              {list.map((c) => (
                <button key={c.id} type="button" className="cn-nation-row" onClick={() => { cnSfx.toggle(); setError(""); setPending(c); }}>
                  <Flag code={c.id} size={30} className="cn-country-badge--lg" />
                  <span className="cn-nation-name">{c.name}</span>
                  <span className="cn-nation-meta">{c.regionCount || 0} {t(lang, "nn_regions_count")}</span>
                  <ChevronRight size={18} />
                </button>
              ))}
              {list.length === 0 && <div className="cn-nation-empty">{t(lang, "onboard_country_empty")}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


function ArmyPanel({ war, msg, onDeclare, onLaunchDrone, onSniper, onChangeCountry, sub, onSub, player, defCity, defLevel, defMsg, onPickDefCity, onUpgradeDef }) {
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
      <HqRowTile Icon={ArrowLeftRight} label="Змінити країну" hint={"Зараз: " + (COUNTRY_MAP[player.countryCode]?.name || "—") + ". Раз на добу, не під час війни"} onClick={onChangeCountry} />
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
