import { useState, useEffect, useRef, useMemo } from "react";
import { User, Lock, Crown, X, ChevronLeft, Search, Settings, Check, Palette, ArrowLeft, MousePointerClick, BarChart3, ChevronRight, Sparkles, Star, UserPlus, Pencil, Image as ImageIcon } from "lucide-react";
import { WAR_ACHIEVEMENTS, normalizeAch } from "../achievements";
import { BANNER_OPTIONS, COUNTRIES, COUNTRY_MAP, FREE_PASS_REWARDS, Flag, GameLogo, NICK_COLORS, Nick, PLAYER_PREFIX, PREMIUM_PASS_REWARDS, PROFILE_ICONS, ProfileIconGlyph, bannerById, cleanText, cnSfx, fmt, getTelegramUser, iconById, maxEnergyOf, passClaimedList, storageSet, t } from "../app/shared.jsx";
import { MailScreen } from "./MailScreen.jsx";
import { SettingsScreen } from "./SettingsScreen.jsx";


/* Підпис ролі гравця: радників більше немає, лишились лідер і учасник */
function roleStatusLabel(isLeader) {
  return isLeader ? "Лідер" : "Учасник";
}


function isIconUnlocked(me, opt) {
  if (opt.passIcon) return (me.unlockedIcons || []).includes(opt.id);
  return (me.power || 0) >= (opt.req || 0);
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


/* Значки за війни, серію входів і сезони (логіка — src/achievements.js, лічильники — me.ach) */
const WAR_ACH_ICONS = {
  first_city: BADGE_ICON_BRONZE1, conqueror: BADGE_ICON_SILVER2, destroyer: BADGE_ICON_GOLD3, defender: BADGE_ICON_SILVER3,
  veteran: BADGE_ICON_GOLD2, streak3: BADGE_ICON_BRONZE2, streak7: BADGE_ICON_SILVER1, streak30: BADGE_ICON_GOLD1,
  podium: BADGE_ICON_BRONZE3, champion: BADGE_ICON_GOLD3, clicks10k: BADGE_ICON_BRONZE3, clicks100k: BADGE_ICON_SILVER3,
};

const WAR_ACH_ENTRIES = WAR_ACHIEVEMENTS.filter((x) => !x.id.startsWith("clicks")).map((x) => ({
  id: x.id,
  label: x.name,
  desc: x.desc,
  icon: WAR_ACH_ICONS[x.id],
  req: (me) => {
    const [cur, need] = x.prog(normalizeAch(me.ach), me);
    return cur >= need;
  },
}));


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
  ...WAR_ACH_ENTRIES,
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


export function ProfileScreen({
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
        <button
          className="cn-adm-btn"
          type="button"
          onClick={() => {
            cnSfx.navSwitch();
            const got = ACHIEVEMENTS.filter((a) => a.req(me, ctx));
            const text = `Мої досягнення у World Clicker (${got.length} з ${ACHIEVEMENTS.length}): ` + (got.length ? got.map((a) => a.label).join(", ") : "ще попереду") + ". Приєднуйся і захоплюй світ!";
            const url = "https://t.me/share/url?url=" + encodeURIComponent("https://t.me/worldclicker_bot") + "&text=" + encodeURIComponent(text);
            try {
              if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(url);
              else window.open(url, "_blank");
            } catch {
              /* ignore */
            }
          }}
        >
          Поділитися
        </button>
      </div>

      <div className="cn-achv-hint">
        Обрано {equippedBadges.length}/{MAX_EQUIPPED_BADGES} значків для профілю · серія входів {normalizeAch(me.ach).streak} дн. (рекорд {normalizeAch(me.ach).bestStreak})
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
