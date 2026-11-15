import { useState, useEffect } from "react";
import { Lock, Crown, Check, Gift, Coins, Award, Sparkles } from "lucide-react";
import { PASS_REV, PASS_MAX_LEVEL, PASS_LEVEL_THRESHOLDS, currentPassLevel } from "../progressData";
import { progressOp } from "../powerApi";
import { FREE_PASS_REWARDS, PREMIUM_PASS_REWARDS, SEASON_DURATION_DAYS, buyPremiumPass, cnSfx, fmt, passClaimedList, t } from "../app/shared.jsx";
import { setTick, clearTick } from "../core/ticker.js";


const SEASON_BANNER_IMG = "/img/season-banner-img.jpg";
 // кількість рівнів у проході
// Версія проходу = версія сезону. У гравців зі старою версією прогрес і отримані нагороди обнуляються.

/* Сумарна кількість кліків сезону, потрібна для рівня N (рівень 0 — 0 кліків). */


/* Кліки, зараховані в Battle Pass поточного сезону (від моменту початку сезону для гравця). */
function passClicks(me) {
  if (!me || me.passRev !== PASS_REV) return 0;
  return Math.max(0, (me.totalClicks || 0) - (me.passBaseClicks || 0));
}

// Рівні з особливими нагородами (титул/банер/аватар) виділяються в списку.
const PASS_MILESTONE_LEVELS = FREE_PASS_REWARDS.filter((r) => r.type !== "points").map((r) => r.level);


/* Нагороди проходу видає сервер: він рахує рівень за своїми кліками й записує нагороду гравцю */
function mergePass(me, r) {
  const { ok, ...fields } = r;
  return { ...me, ...fields };
}

async function claimPassReward(me, track, level, onSetPlayer) {
  const r = await progressOp("claim-pass", { track, level });
  if (r.ok) onSetPlayer(mergePass(me, r));
  else cnSfx.error();
}


async function claimAllPassRewards(me, onSetPlayer) {
  const r = await progressOp("claim-pass", { all: true });
  if (r.ok) onSetPlayer(mergePass(me, r));
  else cnSfx.error();
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


export function SeasonScreen({ season, me, onSetPlayer, onRefresh }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setTick(() => setNow(Date.now()), 60000);
    return () => clearTick(t);
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
