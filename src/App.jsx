import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { WAR_ACHIEVEMENTS, normalizeAch, withLoginStreak, withWarResults, unlockedIds } from "./achievements";
import { PASS_REV } from "./progressData";
import { powerSync, linkTelegram, claimLeader, hasServerPower, worldOp, stateOp } from "./powerApi";
import { loadCures } from "./bank";
import { setPandemicState } from "./pandemic";
import { loadNations, createCountry, updateCountryColor, pickFreeColor } from "./nations";
import MaintenanceScreen from "./MaintenanceScreen";
import { LazyFallback, BlockedScreen, BootScreen, BottomNav, CLICK_COMMIT_MS, COUNTRY_CHANGE_COOLDOWN_MS, COUNTRY_MAP, DEAD_COUNTRIES, DEFAULT_THEME, EMPTY_GAME_STATE, FLUSH_POWER, ID_KEY, LANG_CHOSEN_KEY, LANG_KEY, LEADERBOARD_STALE_MS, LanguageSelectScreen, MAX_ENERGY, NO_WARS, PANDEMIC_CFG_KEY, PLAYER_PREFIX, PSEEN_PREFIX, SEASON_REV, SEASON_REWARD_PREFIX, SUPPORTED_LANGS, ScreenErrorBoundary, ShopScreen, THEMES, TOS_KEY, TUTORIAL_KEY, TosDeclinedScreen, TosGateScreen, WAR_CLICKS_PREFIX, addMail, cleanText, cnSfx, computeDeadCountries, ensureSeasonStarted, fetchAllPlayers, fetchWarTotals, finalizeWar, fmt, genId, getCurrentEnergy, getJSON, getLeader, getMail, getTelegramDisplayName, getTelegramUser, isLegacyCountryCode, isSuperAdmin, liveStore, loadActiveWars, loadDiplomacy, loadEndedWars, loadGameState, migratePass, notifyAdminSeasonEnded, notifyWarEvent, seasonEndsAt, setCountriesRegistry, setDeadCountries, setFlushPower, storageGet, storageSet, t, trackSession, visibleInterval, warInvolves, warPhase, warSide, warStartNotified } from "./app/shared.jsx";
import { setTick, clearTick } from "./core/ticker.js";

import { ClickerScreen } from "./clicker/ClickerScreen.jsx";

const MapScreen = lazy(() => import("./screens/MapScreen.jsx").then((m) => ({ default: m.MapScreen })));
const HQScreen = lazy(() => import("./screens/HQScreen.jsx").then((m) => ({ default: m.HQScreen })));
const LeaderboardScreen = lazy(() => import("./screens/LeaderboardScreen.jsx").then((m) => ({ default: m.LeaderboardScreen })));
const ProfileScreen = lazy(() => import("./screens/ProfileScreen.jsx").then((m) => ({ default: m.ProfileScreen })));
const SeasonScreen = lazy(() => import("./screens/SeasonScreen.jsx").then((m) => ({ default: m.SeasonScreen })));
const OnboardingScreen = lazy(() => import("./screens/OnboardingScreen.jsx").then((m) => ({ default: m.OnboardingScreen })));
const TutorialModal = lazy(() => import("./screens/TutorialModal.jsx").then((m) => ({ default: m.TutorialModal })));



export default function App() {
  const [booting, setBooting] = useState(true);
  const [player, setPlayerState] = useState(null);
  /* Єдина точка запису гравця. Усі колишні виклики setPlayer(...) працюють як раніше (значення або функція),
     але функція тепер отримує найсвіжіший запис, включно з кліками, які ще не потрапили в React-стан.
     soft=true (лише клік) відкладає перемальовування кореня до CLICK_COMMIT_MS; решта оновлень коммітяться одразу. */
  const liveRef = useRef(null);
  const commitTimerRef = useRef(0);
  const commitLive = useCallback(() => {
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = 0; }
    setPlayerState(liveRef.current);
  }, []);
  const setPlayer = useCallback((arg, soft) => {
    const base = liveRef.current;
    const next = typeof arg === "function" ? arg(base) : arg;
    if (next === base) return;
    liveRef.current = next;
    liveStore.set(next);
    if (soft) {
      if (!commitTimerRef.current) commitTimerRef.current = setTimeout(commitLive, CLICK_COMMIT_MS);
    } else {
      commitLive();
    }
  }, [commitLive]);
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
  const [war, setWar] = useState(null); // активна війна моєї країни (підготовка або битва)
  const [warTotals, setWarTotals] = useState({ att: 0, def: 0 });
  const warRef = useRef(null);
  const warPendingRef = useRef({ warId: null, n: 0, base: 0, loaded: false });
  const powPendRef = useRef({ pow: 0, war: 0, busy: false }); // кліки, ще не підтверджені сервером
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
  const [, setDeadRev] = useState(0);
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
    computeDeadCountries(data)
      .then((set) => {
        const same = set.size === DEAD_COUNTRIES.size && [...set].every((x) => DEAD_COUNTRIES.has(x));
        if (!same) { setDeadCountries(set); setDeadRev((n) => n + 1); }
      })
      .catch(() => null);
    return true;
  }, []);

  /* Стан пандемій: закриті кордони (dip:border:*) і налаштування адміна (cfg:pandemic) — раз на хвилину */
  const syncPandemic = useCallback(async () => {
    try {
      const [dipData, raw, cures] = await Promise.all([loadDiplomacy(), storageGet(PANDEMIC_CFG_KEY, true), loadCures()]);
      let cfg = null;
      try { cfg = raw ? JSON.parse(raw) : null; } catch { cfg = null; }
      setPandemicState({ borders: dipData.borders, cfg, cures: cures || undefined });
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    syncPandemic();
    const id = setTick(syncPandemic, 60000);
    return () => clearTick(id);
  }, [syncPandemic]);

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
      clearTick(t);
    };
  }, []);

  useEffect(() => {
    if (player) refreshMail();
    const t = visibleInterval(() => {
      if (player) refreshMail();
    }, 45000);
    return () => clearTick(t);
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
    return () => clearTick(t);
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
        "https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&display=swap";
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
        tg.setHeaderColor && tg.setHeaderColor("#1f7fe8");
        tg.setBackgroundColor && tg.setBackgroundColor("#1f7fe8");
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
              await linkTelegram(id);
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
      } else if (!COUNTRY_MAP[targetCountry]) {
        await refreshNations();
        if (!COUNTRY_MAP[targetCountry]) return { ok: false, reason: "Цієї країни більше не існує. Обери іншу." };
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
      if (base) {
        // країну в існуючому записі змінює сервер (поле countryCode для клієнта закрите)
        const sc = await worldOp("set-country", { countryCode: targetCountry });
        if (!sc.ok) return { ok: false, reason: sc.reason };
        rec = { ...rec, countryChangedAt: Date.now() };
      }
      await storageSet(PLAYER_PREFIX + id, JSON.stringify(rec), true);
      /* Прив'язку Telegram і лідерство веде сервер (ключі tgmap:* і leader:* закриті для запису з клієнта) */
      if (telegramId) await linkTelegram(id);
      const cl = await claimLeader(targetCountry);
      const becameLeader = !!cl.leader;
      if (becameLeader && !isCreator) await stateOp("news-leader", { code: targetCountry });
      await refreshNations();
      setIsLeader(becameLeader);
      setPlayer(rec);
      return { ok: true };
    },
    [player, nations, refreshNations]
  );

  /* Зміна країни (Штаб → Армія): раз на добу, не під час війни своєї країни. */
  const changeCountry = useCallback(
    async (newId) => {
      if (!player) return { ok: false, reason: "Немає гравця" };
      const old = player.countryCode;
      if (!COUNTRY_MAP[newId]) return { ok: false, reason: "Такої країни немає" };
      if (newId === old) return { ok: false, reason: "Ти вже граєш за цю країну" };
      const dead = DEAD_COUNTRIES.has(old);
      const left = dead ? 0 : (player.countryChangedAt || 0) + COUNTRY_CHANGE_COOLDOWN_MS - Date.now();
      if (left > 0) return { ok: false, reason: "Змінити країну можна раз на добу. Лишилось " + Math.ceil(left / 3600000) + " год." };
      const r = await worldOp("set-country", { countryCode: newId });
      if (!r.ok) return { ok: false, reason: r.reason };
      const rec = { ...player, countryCode: newId, countryChangedAt: Date.now() };
      const becameLeader = !!r.leader;
      await refreshNations();
      setIsLeader(becameLeader);
      setPlayer(rec);
      return { ok: true };
    },
    [player, refreshNations]
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
    /* Зберігаємо найсвіжіший запис (liveRef), а не React-стан: він може відставати на кілька кліків */
    const handler = () => {
      const cur = liveRef.current || player;
      if (cur) flush(cur);
    };
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("beforeunload", handler);
      const cur = liveRef.current || player;
      if (cur) flush(cur);
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
    [flush, setPlayer]
  );

  /* Нагорода за місце країни в рейтингу сезону: забираємо один раз і пишемо лист */
  useEffect(() => {
    if (!player?.id) return;
    let off = false;
    (async () => {
      try {
        const initData = window.Telegram?.WebApp?.initData;
        if (!initData || off) return;
        /* Нагороду видає й відмічає сервер: клієнт не може змінювати seasonrew:* (RLS) */
        const raw = await storageGet(SEASON_REWARD_PREFIX + player.id, true);
        if (!raw) return;
        const pre = JSON.parse(raw);
        if (!pre || pre.claimed || !(pre.points > 0)) return;
        const r = await fetch("/api/game?action=claim-season-reward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        const rec = await r.json().catch(() => null);
        if (!r.ok || !rec || !(rec.points > 0) || off) return;
        updatePlayer((prev) => {
          const a = normalizeAch(prev.ach);
          return { ...prev, points: Number.isFinite(rec.total) ? rec.total : (prev.points || 0) + rec.points, ach: { ...a, seasonTop: a.seasonTop ? Math.min(a.seasonTop, rec.rank || 99) : rec.rank || null } };
        });
        await addMail(player.id, {
          type: "info",
          subject: `Нагорода за сезон ${rec.season}`,
          body: `Твоя країна ${COUNTRY_MAP[rec.countryCode]?.name || rec.countryCode} посіла ${rec.rank}-е місце в рейтингу сезону. Нагорода: +${fmt(rec.points)} Points. Карту скинуто, починається новий сезон!`,
        });
        refreshMail();
      } catch {
        /* нагорода підхопиться при наступному вході */
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id]);

  /* Досягнення: серія входів + підсумки завершених воєн; про нові значки пишемо в Пошту */
  useEffect(() => {
    if (!player?.id) return;
    let off = false;
    (async () => {
      try {
        const wars = await loadEndedWars();
        if (off) return;
        updatePlayer((prev) => {
          const before = normalizeAch(prev.ach);
          const after = withWarResults(withLoginStreak(before), prev, wars);
          if (JSON.stringify(before) === JSON.stringify(after)) return prev;
          const had = new Set(unlockedIds(before, prev));
          const fresh = WAR_ACHIEVEMENTS.filter((x) => unlockedIds(after, prev).includes(x.id) && !had.has(x.id));
          for (const x of fresh) {
            addMail(prev.id, { type: "info", subject: `Нове досягнення: ${x.name}`, body: `${x.icon} ${x.name}: ${x.desc}. Усі значки дивись у Профілі → Досягнення, ними можна поділитися з друзями.` }).catch(() => null);
          }
          return { ...prev, ach: after };
        });
      } catch {
        /* досягнення підрахуються при наступному вході */
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id]);

  /* Сезон закінчився: один раз надсилаємо адміну лист у Пошту (карту скидає лише адмін вручну) */
  useEffect(() => {
    if (!season?.startedAt || Date.now() < seasonEndsAt(season)) return;
    notifyAdminSeasonEnded().catch(() => null);
  }, [season?.startedAt, season?.seasonNumber, season?.durationDays]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Підтягуємо відкладений стан кліків у React при зміні вкладки та при згортанні гри */
  useEffect(() => { commitLive(); }, [tab, commitLive]);
  useEffect(() => {
    const onHide = () => { if (document.hidden) commitLive(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [commitLive]);

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
        if (inBattle) { powPendRef.current.war += 1; powPendRef.current.warId = w.id; }
        else powPendRef.current.pow += 1;
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
      }, true);
    },
    [scheduleSave, setPlayer]
  );

  /* Power веде сервер: кліки йдуть пакетами, у відповідь приходить справжній Power і енергія */
  const flushPower = useCallback(async (force) => {
    const pp = powPendRef.current;
    if (pp.busy || !hasServerPower()) return;
    const pow = pp.pow;
    const war = pp.war;
    const warId = pp.warId;
    if (!pow && !war && !force) return;
    pp.busy = true;
    pp.pow = 0;
    pp.war = 0;
    const r = await powerSync(pow, war, warId);
    pp.busy = false;
    if (!r.ok) {
      pp.pow += pow; // спробуємо ще раз із наступним пакетом
      pp.war += war;
      return;
    }
    setPlayer((prev) => (prev ? { ...prev, power: r.power + pp.pow, energy: Math.max(0, r.energy - pp.pow - pp.war), lastEnergyTs: Date.now() } : prev));
  }, []);
  const powerPlayerId = player?.id;
  useEffect(() => {
    setFlushPower(() => flushPower(true));
    return () => { setFlushPower(null); };
  }, [flushPower]);
  useEffect(() => {
    if (!powerPlayerId) return undefined;
    flushPower(true);
    let tick = 0;
    const iv = visibleInterval(() => { tick += 1; flushPower(tick % 15 === 0); }, 4000); // раз на хвилину звіряємось із сервером і без кліків
    const onHide = () => { if (document.hidden) flushPower(false); };
    document.addEventListener("visibilitychange", onHide);
    return () => { clearTick(iv); document.removeEventListener("visibilitychange", onHide); };
  }, [powerPlayerId, flushPower]);

  /* Leaderboard refresh */
  const refreshLeaderboard = useCallback(async (force) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < LEADERBOARD_STALE_MS) return;
    lastFetchRef.current = now;
    setLbLoading(true);
    const list = await fetchAllPlayers();
    if (list) setAllPlayers(list);
    else lastFetchRef.current = 0; // помилка: наступний захід на вкладку спробує знову
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
    return () => clearTick(hb);
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
      if (FLUSH_POWER) await FLUSH_POWER(); // кліки в битву зараховує сервер разом із синхронізацією Power
      const rec = await getJSON(WAR_CLICKS_PREFIX + w.id + ":" + playerIdForWar, true, null);
      pend.base = rec?.n || 0;
      pend.n = powPendRef.current.war; // ще не підтверджені сервером
      pend.loaded = true;
    };

    const tick = async () => {
      let delay = 12000;
      try {
        const wars = await loadActiveWars();
        let mine = wars.find((w) => warInvolves(w, playerCountryForWar)) || null;
        if (mine && warPhase(mine) === "finish") {
          await flushClicks(mine);
          await finalizeWar(mine);
          mine = null;
          await refreshNations();
          refreshMail();
        }
        if (stopped) return;
        setWar((prev) => (JSON.stringify(prev) === JSON.stringify(mine) ? prev : mine));
        const phase = mine ? warPhase(mine) : null;
        if (phase === "battle") {
          if (!warStartNotified.has(mine.id)) {
            warStartNotified.add(mine.id);
            notifyWarEvent(mine, "start");
          }
          await flushClicks(mine);
          const totals = await fetchWarTotals(mine.id, playerIdForWar);
          if (!stopped) setWarTotals({ ...totals, def: totals.def + (mine.botDef || 0) });
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
        <Suspense fallback={null}><OnboardingScreen onFinish={finishOnboarding} lang={language} nations={nations} onReloadNations={refreshNations} /></Suspense>
      ) : player.blocked ? (
        <BlockedScreen reason={player.blockedReason} />
      ) : isLegacyCountryCode(player.countryCode) ? (
        <Suspense fallback={null}><OnboardingScreen
          onFinish={finishOnboarding}
          lang={language}
          nations={nations}
          onReloadNations={refreshNations}
          reassign
          initialName={player.username}
        /></Suspense>
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
                onOpenSeason={() => setTab("season")}
                war={war}
                warTotals={warTotals}
                warPendingRef={warPendingRef}
                players={mergedPlayers}
              />
            )}
            {tab === "leaderboard" && (
              <Suspense fallback={<LazyFallback />}><LeaderboardScreen
                me={player}
                players={mergedPlayers}
                loading={lbLoading}
                onRefresh={() => refreshLeaderboard(true)}
                onBack={() => setTab("clicker")}
                lang={language}
                nations={nations}
              /></Suspense>
            )}
            {tab === "hq" && (
              <Suspense fallback={<LazyFallback />}><HQScreen
                player={player}
                players={mergedPlayers}
                nations={nations}
                isLeader={isLeader}
                onChangeCountryColor={changeCountryColor}
                onChangeCountry={changeCountry}
                lang={language}
                mail={mail}
                unreadCount={unreadCount}
                onRefreshMail={refreshMail}
                onRefreshData={() => refreshGameData(true)}
                war={war}
                onUpdatePlayer={updatePlayer}
                onWarDeclared={(w) => { setWar(w); setTab("clicker"); }}
              /></Suspense>
            )}
            {tab === "profile" && (
              <Suspense fallback={<LazyFallback />}><ProfileScreen
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
                  const r = await stateOp("maintenance", payload);
                  if (r.ok) setMaintenance(r.maintenance);
                }}
              /></Suspense>
            )}
            {tab === "season" && (
              <Suspense fallback={<LazyFallback />}><SeasonScreen
                season={season}
                me={player}
                onSetPlayer={setPlayer}
                onRefresh={() => refreshGameData(true)}
              /></Suspense>
            )}
            {tab === "shop" && (
              <ShopScreen
                onGoToSeason={() => setTab("season")}
                me={player}
                onSetPlayer={setPlayer}
                isLeader={isLeader}
                onRefreshGameData={() => refreshGameData(true)}
              />
            )}
            {tab === "map" && (
              <Suspense fallback={<LazyFallback />}><MapScreen
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
              /></Suspense>
            )}
            </ScreenErrorBoundary>
          </div>
          <BottomNav tab={tab} setTab={setTab} unreadMail={unreadCount} lang={language} />
        </div>
      )}
      {showTutorial && player && <Suspense fallback={null}><TutorialModal onClose={closeTutorial} lang={language} setTab={setTab} name={player.username} /></Suspense>}
    </div>
  );
}
