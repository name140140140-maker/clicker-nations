import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { CalendarDays, Users, ChevronDown, ChevronLeft, Search, Settings, Wrench, Mail, Check, Trash2, Swords, ShieldCheck, UserCog, Newspaper, Compass, MousePointerClick, ChevronRight, Play } from "lucide-react";
import { renderWorldImage } from "../map/exportImage";
import { activePandemics } from "../worldEvents";
import { powerAdminSet, adminPlayerOp, adminSetLeader, worldOp, progressOp, stateOp } from "../powerApi";
import { setPandemicState, DISEASES } from "../pandemic";
import { loadChangelog, saveChangelog } from "../nations";
import { BUILTIN_CHANGELOG } from "../changelog";
import { COUNTRIES, COUNTRY_MAP, Flag, GameLogo, LANGUAGES, MAX_ENERGY, PLAYER_PREFIX, PREMIUM_PASS_PRICE_KEY, SEASON_DURATION_DAYS, cnSfx, isSuperAdmin, loadActiveWars, seasonEndsAt, storageGet, storagePersistenceHealthy, storageSet, t, warPhase } from "../app/shared.jsx";
import { AdminPlayersView } from "./AdminPlayersView.jsx";
import { setTick, clearTick } from "../core/ticker.js";
import { getFeelPrefs, setFeelPref, haptic } from "../core/feel.js";

 // { manual: [{ id, code, disease, start, dur }], cancelAt } — пише лише сервер
const TG_NOTIFY_KEY = "cfg:tgnotify";


/* Перемикачі звуку й вібрації: лише локальні налаштування, ігрової логіки не торкаються */
function FeelToggles() {
  const [p, setP] = useState(getFeelPrefs);
  const flip = (key) => { const v = !p[key]; setFeelPref(key, v); setP(getFeelPrefs()); if (v && key === "haptic") haptic("medium"); if (v && key === "sound") cnSfx.toggle(); };
  const rows = [["sound", "Звуки кліків"], ["haptic", "Вібрація"]];
  return (
    <div className="cn-feel-toggles">
      {rows.map(([k, label]) => (
        <button key={k} type="button" role="switch" aria-checked={!!p[k]} className={"cn-feel-toggle" + (p[k] ? " cn-feel-toggle--on" : "")} onClick={() => flip(k)}>
          <span>{label}</span><i aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/* Новина від адміністрації: публікує сервер (лише адмін) */
function pushNews(text) {
  return stateOp("news-admin", { text }).catch(() => null);
}


/* Компактна секція адмін-панелі: заголовок-рядок, розгортається одна за раз */
function AdmSec({ id, cur, setCur, Icon, title, badge = null, children }) {
  const open = cur === id;
  return (
    <div className={"cn-adm-sec" + (open ? " cn-adm-sec--open" : "")}>
      <button className="cn-adm-head" type="button" onClick={() => { cnSfx.toggle(); setCur(open ? null : id); }}>
        <Icon size={14} /> <span>{title}</span>
        {badge !== null && <em className="cn-adm-badge">{badge}</em>}
        <ChevronDown size={15} className={"cn-chevron" + (open ? " cn-chevron--open" : "")} />
      </button>
      {open && <div className="cn-adm-body">{children}</div>}
    </div>
  );
}


export function SettingsScreen({ me, theme, onChangeTheme, onBack, onSetPlayer, wars, season, players, isLeader, mail, unreadCount, onRefreshMail, onRefreshGameData, onOpenTutorial, lang = "uk", onSetLanguage, maintenance, onSaveMaintenance }) {
  const [adminPlayersOpen, setAdminPlayersOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const statusTimerRef = useRef(null);

  /* --- Адмін-панель (лише SUPER_ADMIN_TG_ID) --- */
  const [adminOpen, setAdminOpen] = useState(false);
  const [admSec, setAdmSec] = useState(null);
  const [seasonConfirm, setSeasonConfirm] = useState(false);
  const [mapExp, setMapExp] = useState({ busy: false, stage: "", url: "", err: "" });
  const [tgOff, setTgOff] = useState(null); // null — ще не завантажено; true — сповіщення вимкнено для всіх
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
    if (tgOff === null) {
      storageGet(TG_NOTIFY_KEY, true).then((raw) => setTgOff(String(raw || "").replace(/"/g, "") === "off"));
    }
    if (!adminPassPriceLoaded) {
      storageGet(PREMIUM_PASS_PRICE_KEY, true).then((raw) => {
        setAdminPassPrice(raw ? String(JSON.parse(raw)) : "50");
        setAdminPassPriceLoaded(true);
      });
    }
  }, [adminOpen, season, adminPassPriceLoaded, clStored, tgOff]);

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
  const adminWarOp = async (w, action, side) => {
    const r = await worldOp("admin-war", { warId: w.id, action, side });
    if (!r.ok) throw new Error(r.reason);
  };
  const skipWarPrep = (w) => adminWarAction(() => adminWarOp(w, "skip-prep"), "Підготовку завершено, битва почалась");
  const endWarNow = (w) => adminWarAction(() => adminWarOp(w, "end-now"), "Війну завершено за поточним балансом (підсумки підрахує гра за кілька секунд)");
  const forceCeasefire = (w) => adminWarAction(() => adminWarOp(w, "ceasefire"), "Війну припинено перемир'ям");
  const setWarWinner = (w, side) =>
    adminWarAction(() => adminWarOp(w, "winner", side), `Переможець: ${COUNTRY_MAP[side === "att" ? w.attacker : w.defender]?.name || ""}`);

  const saveSeasonEndDate = async () => {
    if (!adminSeasonDate) return;
    setAdminBusy(true);
    const startedAt = season?.startedAt || Date.now();
    const targetMs = new Date(adminSeasonDate + "T23:59:59").getTime();
    const durationDays = Math.max(1, Math.ceil((targetMs - startedAt) / (24 * 60 * 60 * 1000)));
    await stateOp("season-date", { startedAt, durationDays });
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

  const exportMapImage = async () => {
    if (mapExp.busy) return;
    if (mapExp.url) URL.revokeObjectURL(mapExp.url);
    setMapExp({ busy: true, stage: "Готуємо…", url: "", err: "" });
    try {
      const blob = await renderWorldImage({ width: 4096, lang, onStage: (stage) => setMapExp((m) => ({ ...m, stage })) });
      setMapExp({ busy: false, stage: "", url: URL.createObjectURL(blob), err: "", blob });
    } catch (e) {
      setMapExp({ busy: false, stage: "", url: "", err: e?.message || "Не вдалося створити зображення" });
    }
  };
  /* Надсилає карту адміну в Telegram документом (надійно; збереження blob у Telegram WebView часто не працює) */
  const sendMapImage = async () => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!mapExp.blob) return;
    if (!initData) { setAdminMsg("✗ Відкрий гру через бота в Telegram, щоб надіслати карту"); return; }
    setAdminBusy(true);
    setAdminMsg("");
    try {
      let blob = mapExp.blob;
      if (blob.size > 4_000_000) {
        /* завелике для сервера — стискаємо в JPEG */
        const bmp = await createImageBitmap(blob);
        const cv = document.createElement("canvas");
        cv.width = bmp.width;
        cv.height = bmp.height;
        cv.getContext("2d").drawImage(bmp, 0, 0);
        blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.9));
      }
      const r = await fetch("/api/game?action=admin-map-send", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "x-init-data": initData },
        body: blob,
      });
      const d = await r.json().catch(() => ({}));
      setAdminMsg(r.ok && d.ok ? "✓ Карту надіслано в чат з ботом (файлом)" : "✗ " + (d.error || "Не вдалося надіслати"));
    } catch {
      setAdminMsg("✗ Немає зв'язку із сервером");
    }
    setAdminBusy(false);
  };
  const saveMapImage = async () => {
    const blob = mapExp.blob;
    if (!blob) return;
    const name = "world-clicker-map-" + new Date().toISOString().slice(0, 10) + ".png";
    try {
      const file = new File([blob], name, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "World Clicker — карта світу" });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    try {
      const a = document.createElement("a");
      a.href = mapExp.url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      /* ignore */
    }
  };

  const resetSeasonNow = async () => {
    setAdminBusy(true);
    try {
      const r = await fetch("/api/game?action=admin-season-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: window.Telegram?.WebApp?.initData || "", seasonNumber: season?.seasonNumber || 1, confirm: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setAdminMsg("✗ " + (d.error || "Не вдалося скинути карту"));
      } else {
        const top = (d.top || []).map((x, i) => `${i + 1}. ${COUNTRY_MAP[x.code]?.name || x.code}`).join(", ");
        await pushNews(`🏆 Сезон ${(d.newSeason || 2) - 1} завершено! Карту скинуто, починається сезон ${d.newSeason}.${top ? " Переможці: " + top + "." : ""} Нагороди отримали гравці ${d.rewarded} учасників.`);
        setAdminMsg(`✓ Карту скинуто. Сезон ${d.newSeason} розпочато, нагороди отримають ${d.rewarded} гравців. Гра перезавантажиться…`);
        setTimeout(() => window.location.reload(), 2500);
      }
    } catch {
      setAdminMsg("✗ Не вдалося зв'язатися із сервером");
    }
    setSeasonConfirm(false);
    setAdminBusy(false);
  };

  /* Тестовий таймер телепередачі: через N хвилин у вкладці «ТБ» на 30 хвилин іде випуск */
  const [tvTest, setTvTest] = useState(null);
  const [tvMin, setTvMin] = useState(1);
  const [tvTick, setTvTick] = useState(0);
  useEffect(() => {
    if (!adminOpen) return undefined;
    let off = false;
    storageGet("cfg:tvtest", true).then((raw) => {
      try { const v = raw ? JSON.parse(raw) : null; if (!off) setTvTest(v && v.at ? v : null); } catch { /* ignore */ }
    }).catch(() => {});
    const id = setTick(() => setTvTick((x) => x + 1), 1000);
    return () => { off = true; clearTick(id); };
  }, [adminOpen]);
  const setTvTimer = async (clear) => {
    setAdminBusy(true);
    try {
      const r = await fetch("/api/game?action=admin-tv-timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: window.Telegram?.WebApp?.initData || "", minutes: tvMin, clear: !!clear }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Не вдалося встановити таймер");
      setTvTest(d.value || null);
      setAdminMsg(clear ? "✓ Таймер ТБ скасовано" : `📺 Тестовий випуск вийде через ${tvMin} хв`);
    } catch (e) {
      setAdminMsg("✗ " + (e?.message || "Помилка"));
    }
    setAdminBusy(false);
  };
  /* Пандемії: запуск в обраній країні або негайне припинення в усьому світі */
  const [pdCode, setPdCode] = useState("CD");
  const [pdDisease, setPdDisease] = useState("");
  const pandemicOp = async (op) => {
    if (op === "cancel" && !window.confirm("Припинити ВСІ пандемії у світі зараз?")) return;
    setAdminBusy(true);
    try {
      const r = await fetch("/api/game?action=admin-pandemic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: window.Telegram?.WebApp?.initData || "", op, code: pdCode, disease: pdDisease }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Не вдалося");
      setPandemicState({ cfg: d.cfg });
      setAdminMsg(op === "start" ? `🦠 Пандемію запущено: ${COUNTRY_MAP[pdCode]?.name || pdCode}` : "✓ Усі пандемії у світі припинено");
    } catch (e) {
      setAdminMsg("✗ " + (e?.message || "Помилка"));
    }
    setAdminBusy(false);
  };
  const tvLeft = tvTest ? tvTest.at - Date.now() : 0; // eslint-disable-line no-unused-vars
  void tvTick;
  const toggleTgNotify = async () => {
    setAdminBusy(true);
    const nextOff = !tgOff;
    try {
      const r = await fetch("/api/game?action=admin-tg-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: window.Telegram?.WebApp?.initData || "", off: nextOff }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Не вдалося змінити налаштування");
      setTgOff(nextOff);
      setAdminMsg(nextOff ? "🔕 Сповіщення в Telegram вимкнено для всіх гравців" : "🔔 Сповіщення в Telegram увімкнено");
    } catch (e) {
      setAdminMsg("✗ " + (e?.message || "Помилка"));
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
      await stateOp("news-admin", { text: text.slice(0, 400) });
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
    const br = await stateOp("mail-admin", { playerIds: list.map((p) => p.id), subject: bcSubj.trim() || "Повідомлення від адміністрації", body });
    const ok = br.ok ? br.sent : 0;
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
      const lr = await adminSetLeader(me.countryCode, me.id); // лише адмін, перевіряє сервер
      if (!lr.ok) { flashStatus("✗ " + lr.reason); setBusy(false); return; }
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

  const devClearStorage = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      flashStatus("Натисни ще раз, щоб підтвердити скидання");
      return;
    }
    setBusy(true);
    try {
      await storageSet(PLAYER_PREFIX + me.id, JSON.stringify({ ...me, power: 0, points: 0, passBaseClicks: 0, totalClicks: 0, upg: {}, energy: MAX_ENERGY, lastEnergyTs: Date.now() }), true);
      await powerAdminSet(me.id, 0, true);
      await progressOp("admin-reset", { playerId: me.id });
      await stateOp("mail-clear");
      await stateOp("reset-state");
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
        <MousePointerClick size={14} /> Відчуття гри
      </div>
      <FeelToggles />

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
            <div className="cn-adm">
              {adminMsg && <div className="cn-adm-msg">{adminMsg}</div>}
              {mapExp.url && (
                <div className="cn-adm-mapview">
                  <img src={mapExp.url} alt="Карта світу" />
                  <div className="cn-adm-hint">У Telegram найнадійніше — «Надіслати в Telegram»: бот пришле карту файлом у чат, звідти її можна зберегти.</div>
                  <div className="cn-adm-btns">
                    <button className="cn-adm-btn" type="button" disabled={adminBusy} onClick={sendMapImage}>Надіслати в Telegram</button>
                    <button className="cn-adm-btn" type="button" onClick={saveMapImage}>Зберегти на пристрій</button>
                    <button className="cn-adm-btn" type="button" onClick={() => { URL.revokeObjectURL(mapExp.url); setMapExp({ busy: false, stage: "", url: "", err: "" }); }}>Закрити</button>
                  </div>
                </div>
              )}

              <div className="cn-adm-stats">
                <div><b>{(players || []).length}</b><span>гравців</span></div>
                <div><b>{(players || []).filter((p) => p.blocked).length}</b><span>заблок.</span></div>
                <div><b>{new Set((players || []).map((p) => p.countryCode)).size}</b><span>країн</span></div>
                <div><b>{adminWars === null ? "…" : adminWars.length}</b><span>воєн</span></div>
              </div>

              <button className="cn-adm-head" type="button" onClick={() => { cnSfx.navSwitch(); setAdminPlayersOpen(true); }}>
                <Users size={14} /> <span>Гравці</span> <ChevronRight size={15} />
              </button>

              <AdmSec id="wars" cur={admSec} setCur={setAdmSec} Icon={Swords} title="Війни" badge={adminWars && adminWars.length ? adminWars.length : null}>
                {adminWarMsg && <div className="cn-adm-msg">{adminWarMsg}</div>}
                {adminWars === null && <div className="cn-adm-empty">Завантаження…</div>}
                {adminWars && adminWars.length === 0 && <div className="cn-adm-empty">Активних воєн немає</div>}
                {(adminWars || []).map((w) => {
                  const phase = warPhase(w);
                  return (
                    <div className="cn-adm-item" key={w.id}>
                      <div className="cn-adm-item-t">
                        {COUNTRY_MAP[w.attacker]?.name || w.attacker} → {COUNTRY_MAP[w.defender]?.name || w.defender}
                        <small>{w.cityName} · {phase === "prep" ? "підготовка" : phase === "battle" ? "битва" : "завершується"}</small>
                      </div>
                      <div className="cn-adm-btns">
                        {phase === "prep" && <button className="cn-adm-btn" type="button" disabled={adminWarBusy} onClick={() => skipWarPrep(w)}>До битви</button>}
                        {phase === "battle" && <button className="cn-adm-btn" type="button" disabled={adminWarBusy} onClick={() => endWarNow(w)}>Завершити</button>}
                        <button className="cn-adm-btn" type="button" disabled={adminWarBusy} onClick={() => setWarWinner(w, "att")}>Атака</button>
                        <button className="cn-adm-btn" type="button" disabled={adminWarBusy} onClick={() => setWarWinner(w, "def")}>Захист</button>
                        <button className="cn-adm-btn" type="button" disabled={adminWarBusy} onClick={() => forceCeasefire(w)}>Перемир'я</button>
                      </div>
                    </div>
                  );
                })}
                <button className="cn-adm-btn" type="button" disabled={adminWarBusy} onClick={reloadAdminWars}>Оновити</button>
              </AdmSec>

              <AdmSec id="season" cur={admSec} setCur={setAdmSec} Icon={CalendarDays} title="Кінець сезону" badge={season?.startedAt && Date.now() >= seasonEndsAt(season) ? "!" : null}>
                {(() => {
                  const endsAt = seasonEndsAt(season);
                  const left = endsAt - Date.now();
                  return (
                    <div className="cn-adm-state">
                      Сезон {season?.seasonNumber || 1}: {left <= 0 ? "час вийшов, очікує твого рішення" : "ще " + Math.ceil(left / 86400000) + " дн."}
                    </div>
                  );
                })()}
                <div className="cn-adm-hint">
                  Карта сама не скидається: коли сезон закінчується, гра надсилає тобі лист у Пошту. Скидання: країни повертаються на стартову карту, війни, союзи й пакти зникають, нагороди (Points) отримують гравці країн із топ-20 рейтингу (за сумою Power), сезон збільшується на 1. Гравці, країни й прогрес лишаються.
                </div>
                {!seasonConfirm ? (
                  <button className="cn-adm-btn cn-adm-btn--danger" type="button" disabled={adminBusy} onClick={() => { cnSfx.toggle(); setSeasonConfirm(true); }}>
                    Скинути карту й завершити сезон
                  </button>
                ) : (
                  <div className="cn-adm-warn">
                    Це незворотно: усі зміни кордонів і війни буде видалено.{season?.startedAt && Date.now() < seasonEndsAt(season) ? " Сезон ще не закінчився!" : ""}
                    <div className="cn-adm-btns">
                      <button className="cn-adm-btn cn-adm-btn--danger cn-adm-btn--confirm" type="button" disabled={adminBusy} onClick={resetSeasonNow}>Так, скинути карту</button>
                      <button className="cn-adm-btn" type="button" disabled={adminBusy} onClick={() => setSeasonConfirm(false)}>Скасувати</button>
                    </div>
                  </div>
                )}
              </AdmSec>

              <AdmSec id="game" cur={admSec} setCur={setAdmSec} Icon={Settings} title="Сезон і ціни">
                <label className="cn-adm-lab">Кінець сезону</label>
                <div className="cn-adm-row">
                  <input className="cn-adm-in" type="date" value={adminSeasonDate} onChange={(e) => setAdminSeasonDate(e.target.value)} />
                  <button className="cn-adm-btn" type="button" disabled={adminBusy} onClick={saveSeasonEndDate}>Зберегти</button>
                </div>
                <label className="cn-adm-lab">Premium Pass (⭐)</label>
                <div className="cn-adm-row">
                  <input className="cn-adm-in" type="number" min="1" value={adminPassPrice} onChange={(e) => setAdminPassPrice(e.target.value)} />
                  <button className="cn-adm-btn" type="button" disabled={adminBusy} onClick={savePremiumPassPrice}>Зберегти</button>
                </div>
                <label className="cn-adm-lab">Імунітет до лімітів часу (кулдауни війни й заборона нападу)</label>
                <div className="cn-adm-row">
                  <span className="cn-adm-state">{me.timeImmunity ? "Увімкнено" : "Вимкнено"}</span>
                  <button
                    className="cn-adm-btn"
                    type="button"
                    disabled={adminBusy}
                    onClick={async () => {
                      setAdminBusy(true);
                      const opr = await adminPlayerOp(me.id, "immunity", !me.timeImmunity);
                      if (!opr.ok) { setAdminMsg("✗ " + opr.reason); setAdminBusy(false); return; }
                      const updated = opr.record;
                      if (onSetPlayer) onSetPlayer(updated);
                      setAdminMsg(updated.timeImmunity ? "✓ Імунітет до лімітів часу увімкнено" : "✓ Імунітет вимкнено");
                      setAdminBusy(false);
                    }}
                  >
                    {me.timeImmunity ? "Вимкнути" : "Увімкнути"}
                  </button>
                </div>
              </AdmSec>

              <AdmSec id="content" cur={admSec} setCur={setAdmSec} Icon={Newspaper} title="Новини, листи, оновлення">
                <label className="cn-adm-lab">Новина від адміністрації</label>
                <textarea className="cn-adm-in" rows={2} maxLength={400} placeholder="Текст новини" value={bcNews} onChange={(e) => setBcNews(e.target.value)} />
                <button className="cn-adm-btn" type="button" disabled={adminBusy || !bcNews.trim()} onClick={publishAdminNews}>Опублікувати</button>

                <label className="cn-adm-lab">Лист усім гравцям</label>
                <input className="cn-adm-in" type="text" maxLength={80} placeholder="Тема" value={bcSubj} onChange={(e) => setBcSubj(e.target.value)} />
                <textarea className="cn-adm-in" rows={2} maxLength={1000} placeholder="Текст листа" value={bcBody} onChange={(e) => setBcBody(e.target.value)} />
                <button className="cn-adm-btn" type="button" disabled={adminBusy || !bcBody.trim()} onClick={broadcastAdminMail}>Розіслати всім</button>
                {bcInfo && <div className="cn-adm-hint">{bcInfo}</div>}
                <div className="cn-adm-hint">Лист одному гравцеві: Гравці → вибрати гравця → «Написати гравцеві».</div>

                <label className="cn-adm-lab">Список оновлень ({changelogList.length})</label>
                <button className="cn-adm-btn" type="button" onClick={() => { cnSfx.toggle(); setClOpen((o) => !o); }}>{clOpen ? "Сховати список" : "Показати список"}</button>
                {clOpen && (
                  <div className="cn-adm-cl">
                    {clStored === null && <div className="cn-adm-empty">Завантаження…</div>}
                    {changelogList.map((e) => (
                      <div className="cn-adm-item" key={e.id}>
                        <div className="cn-adm-item-t">
                          {e.title}
                          <small>{new Date(e.date + "T12:00:00").toLocaleDateString("uk-UA", { day: "numeric", month: "short", year: "numeric" })}</small>
                        </div>
                        {!e.builtin && (
                          <button className="cn-adm-btn cn-adm-btn--danger" type="button" disabled={adminBusy} onClick={() => removeChangelogEntry(e.id)} aria-label="Видалити"><Trash2 size={12} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <input className="cn-adm-in" type="date" value={clDate} onChange={(e) => setClDate(e.target.value)} />
                <input className="cn-adm-in" type="text" maxLength={80} placeholder="Назва оновлення" value={clTitle} onChange={(e) => setClTitle(e.target.value)} />
                <textarea className="cn-adm-in" rows={2} maxLength={500} placeholder="Короткий опис" value={clText} onChange={(e) => setClText(e.target.value)} />
                <button className="cn-adm-btn" type="button" disabled={adminBusy} onClick={addChangelogEntry}>Додати оновлення</button>
              </AdmSec>

              <AdmSec id="mapimg" cur={admSec} setCur={setAdmSec} Icon={Compass} title="Зображення карти">
                <div className="cn-adm-hint">Створює повну карту світу (PNG, 4096 px): кольори країн, кордони, столиці й легенда. Відкривати вкладку «Карта» не потрібно.</div>
                <button className="cn-adm-btn" type="button" disabled={mapExp.busy} onClick={exportMapImage}>
                  {mapExp.busy ? mapExp.stage || "Створюємо…" : "Створити зображення карти"}
                </button>
                {mapExp.err && <div className="cn-adm-warn">{mapExp.err}</div>}
              </AdmSec>

              <AdmSec id="tg" cur={admSec} setCur={setAdmSec} Icon={Mail} title="Сповіщення в Telegram" badge={tgOff ? "OFF" : null}>
                <div className="cn-adm-row">
                  <span className="cn-adm-state">{tgOff === null ? "Завантаження…" : tgOff ? "Вимкнено для всіх гравців" : "Увімкнено: бот пише про війни"}</span>
                  <button className={"cn-adm-btn" + (tgOff ? "" : " cn-adm-btn--danger")} type="button" disabled={adminBusy || tgOff === null} onClick={toggleTgNotify}>
                    {tgOff ? "Увімкнути" : "Вимкнути"}
                  </button>
                </div>
                <div className="cn-adm-hint">Стосується повідомлень про війни: напад, початок битви, підсумки, перемир'я, знищення країни. Листи в грі працюють як завжди.</div>
              </AdmSec>

              <AdmSec id="tvtest" cur={admSec} setCur={setAdmSec} Icon={Play} title="Тест телепередачі" badge={tvTest && Date.now() < tvTest.until ? "ТБ" : null}>
                <div className="cn-adm-row">
                  <select className="cn-adm-in" value={tvMin} onChange={(e) => setTvMin(+e.target.value)}>
                    {[0, 1, 2, 5, 10, 30].map((m) => <option key={m} value={m}>{m === 0 ? "Одразу" : `Через ${m} хв`}</option>)}
                  </select>
                  <button className="cn-adm-btn" type="button" disabled={adminBusy} onClick={() => setTvTimer(false)}>Запустити таймер</button>
                  {tvTest && <button className="cn-adm-btn cn-adm-btn--danger" type="button" disabled={adminBusy} onClick={() => setTvTimer(true)}>Скасувати</button>}
                </div>
                <div className="cn-adm-hint">
                  {tvTest
                    ? Date.now() < tvTest.at
                      ? `Випуск почнеться за ${Math.max(0, Math.ceil(tvLeft / 1000))} с. Далі 30 хв у новинах, вкладка «ТБ».`
                      : Date.now() < tvTest.until
                        ? "Тестовий випуск зараз в ефірі (вкладка «ТБ» у світових новинах)."
                        : "Останній тест завершено."
                    : "Після таймера у вкладці «ТБ» світових новин 30 хвилин іде випуск, незалежно від ранку чи вечора. Бачать усі гравці."}
                </div>
              </AdmSec>

              <AdmSec id="pandemic" cur={admSec} setCur={setAdmSec} Icon={Wrench} title="Пандемія" badge={activePandemics().length ? String(activePandemics().length) : null}>
                <div className="cn-adm-row">
                  <select className="cn-adm-in" value={pdCode} onChange={(e) => setPdCode(e.target.value)}>
                    {[...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, "uk")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select className="cn-adm-in" value={pdDisease} onChange={(e) => setPdDisease(e.target.value)}>
                    <option value="">Хвороба: підібрати логічно</option>
                    {DISEASES.map((d) => <option key={d.n} value={d.n}>{d.n}</option>)}
                  </select>
                </div>
                <div className="cn-adm-row">
                  <button className="cn-adm-btn" type="button" disabled={adminBusy} onClick={() => pandemicOp("start")}>Запустити в цій країні</button>
                  <button className="cn-adm-btn cn-adm-btn--danger" type="button" disabled={adminBusy} onClick={() => pandemicOp("cancel")}>Припинити в усьому світі</button>
                </div>
                <div className="cn-adm-hint">
                  {activePandemics().length
                    ? "Зараз: " + activePandemics().map((e) => `${e.disease} (${COUNTRY_MAP[e.code]?.name || e.code})`).join(", ")
                    : "Зараз пандемій немає."}{" "}
                  Запуск працює в будь-якій країні, навіть поза списком 20 осередків. Припинення зупиняє вірус у всіх країнах одразу.
                </div>
              </AdmSec>

              <AdmSec id="maint" cur={admSec} setCur={setAdmSec} Icon={Wrench} title="Технічна перерва" badge={maintenance.enabled ? "ON" : null}>
                <div className="cn-adm-row">
                  <input className="cn-adm-in" type="text" placeholder="Повідомлення для гравців (необов'язково)" value={adminMaintMsg} onChange={(e) => setAdminMaintMsg(e.target.value)} />
                  <button className={"cn-adm-btn" + (maintenance.enabled ? " cn-adm-btn--danger" : "")} type="button" disabled={adminBusy} onClick={toggleMaintenanceMode}>
                    {maintenance.enabled ? "Вимкнути" : "Увімкнути"}
                  </button>
                </div>
              </AdmSec>

              <AdmSec id="test" cur={admSec} setCur={setAdmSec} Icon={UserCog} title="Тестування">
                {!storagePersistenceHealthy && (
                  <div className="cn-adm-warn">Хмарне сховище недоступне: зміни можуть не зберегтися після перезавантаження.</div>
                )}
                {statusMsg && <div className="cn-adm-msg">{statusMsg}</div>}
                <div className="cn-adm-row">
                  <span className="cn-adm-state">Країна: {COUNTRY_MAP[me.countryCode]?.name || me.countryCode}</span>
                  <button className="cn-adm-btn" type="button" disabled={busy} onClick={() => setCountryPickerOpen((o) => !o)}>Змінити</button>
                </div>
                {countryPickerOpen && (
                  <div className="cn-country-dropdown cn-dev-country-dropdown">
                    <div className="cn-country-search-wrap">
                      <Search size={15} className="cn-country-search-icon" />
                      <input className="cn-country-search" placeholder="Пошук країни…" value={countryQuery} onChange={(e) => setCountryQuery(e.target.value)} />
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
                <div className="cn-adm-row">
                  <span className="cn-adm-state">{isLeader ? "Ти лідер своєї країни" : "Ти не лідер"}</span>
                  <button className="cn-adm-btn" type="button" disabled={busy || isLeader} onClick={devBecomeLeader}>Стати лідером</button>
                </div>
                <div className="cn-adm-row">
                  <span className="cn-adm-state">Скинути дані гравця</span>
                  <button className={"cn-adm-btn cn-adm-btn--danger" + (confirmClear ? " cn-adm-btn--confirm" : "")} type="button" disabled={busy} onClick={devClearStorage}>
                    <Trash2 size={12} /> {confirmClear ? "Підтвердити" : "Очистити"}
                  </button>
                </div>
              </AdmSec>
            </div>
          )}

        </>
      )}
    </div>
  );
}
