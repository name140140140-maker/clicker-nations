/* Екран клікера «Мультяшна планета».
   Принципи продуктивності:
   - тап не викликає setState: ефекти (canvas), пружність планети (WAAPI) і комбо (прямі оновлення DOM через ref) живуть поза React;
   - числа Power/кліків/енергія — листкові компоненти, підписані на liveStore, а не весь екран;
   - один canvas для всіх ефектів, rAF працює лише коли є що малювати.
   Power, енергію й нагороди веде сервер; комбо — візуальний/тактильний відгук (див. combo.js). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy, LifeBuoy, Newspaper, Zap, Flame, Target, ChevronRight } from "lucide-react";
import "./clicker.css";
import { useStore } from "../core/store.js";
import { setTick, clearTick } from "../core/ticker.js";
import { haptic, prefersReducedMotion } from "../core/feel.js";
import { COMBO_WINDOW_MS, COMBO_LEVELS, comboTap, comboProgress, newCombo } from "./combo.js";
import { attachFx, spawnText, spawnSparks, spawnRing } from "./fx.js";
import { seasonPath, dailyGoals, rollBaseline } from "./progress.js";
import { Planet } from "./Planet.jsx";
import {
  COUNTRY_MAP, Flag, GemIcon, NewsModal, WarHud, cnSfx, energyRegenOf, fmt, getCurrentEnergy, liveStore, maxEnergyOf,
  openSupportChat, warPhase, warSide,
} from "../app/shared.jsx";

/* ---------- Листкові компоненти (оновлюються на кожен тап, решта екрана — ні) ---------- */

function LiveNumber({ field, className = "cc-stat-value" }) {
  const v = useStore(liveStore, (s) => (s ? Number(s[field]) || 0 : 0));
  return <span className={className}>{fmt(v)}</span>;
}

function EnergyBar({ player }) {
  const rec = useStore(liveStore, (s) => s) || player;
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setTick(() => tick((x) => x + 1), 1000);
    return () => clearTick(id);
  }, []);
  const energy = getCurrentEnergy(rec);
  const max = maxEnergyOf(rec);
  const pct = Math.max(0, Math.min(100, (energy / max) * 100));
  const empty = energy < 1;
  const tone = pct > 50 ? "high" : pct > 20 ? "mid" : "low";
  return (
    <div data-tut="energy" className={"cc-energy cc-energy--" + tone}>
      <div className="cc-energy-row">
        <span className="cc-energy-label"><Zap size={16} strokeWidth={3} aria-hidden="true" /> Енергія</span>
        <span className="cc-energy-val"><b>{Math.floor(energy)}</b> / {max}</span>
      </div>
      <div className="cc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.floor(energy)} aria-label="Енергія">
        <div className="cc-bar-fill" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      {empty && <div className="cc-energy-note">Енергія відновлюється: +{String(energyRegenOf(rec)).replace(".", ",")} / сек</div>}
    </div>
  );
}

function SeasonCard({ onOpen }) {
  const me = useStore(liveStore, (s) => s);
  const p = useMemo(() => seasonPath(me), [me?.totalClicks, me?.passRev, me?.passBaseClicks]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = p.level >= p.max ? "Максимальний рівень шляху" : `Ще ${fmt(p.toNext)} кліків${p.nextReward ? " до нагороди: " + p.nextReward : ""}`;
  return (
    <button type="button" className="cc-card cc-season" onClick={onOpen} disabled={!onOpen} aria-label={`Шлях сезону, рівень ${p.level} з ${p.max}. ${text}`}>
      <span className="cc-season-lvl" aria-hidden="true">{p.level}</span>
      <span className="cc-season-main">
        <span className="cc-season-title">Шлях сезону</span>
        <span className="cc-bar cc-bar--thin" aria-hidden="true"><span className="cc-bar-fill cc-bar-fill--violet" style={{ transform: `scaleX(${p.pct / 100})` }} /></span>
        <span className="cc-season-sub">{text}</span>
      </span>
      {onOpen && <ChevronRight size={20} strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}

function DailyGoals({ playerId }) {
  const total = useStore(liveStore, (s) => (s ? s.totalClicks || 0 : 0));
  const key = "cn-daily:" + (playerId || "me");
  const [base, setBase] = useState(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* ignore */ }
    return rollBaseline(saved, liveStore.getState()?.totalClicks || 0);
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(base)); } catch { /* ignore */ }
  }, [key, base]);
  // нова доба під час відкритої гри
  useEffect(() => {
    const id = setTick(() => setBase((b) => rollBaseline(b, liveStore.getState()?.totalClicks || 0)), 60000);
    return () => clearTick(id);
  }, []);
  const goals = dailyGoals(total, base.baseline);
  const done = goals.filter((g) => g.done).length;
  return (
    <div className="cc-card cc-goals" aria-label="Цілі на сьогодні">
      <div className="cc-goals-head">
        <span className="cc-goals-title"><Target size={16} strokeWidth={3} aria-hidden="true" /> Цілі на сьогодні</span>
        <span className="cc-goals-count">{done}/{goals.length}</span>
      </div>
      <div className="cc-goals-row">
        {goals.map((g) => (
          <div key={g.id} className={"cc-goal" + (g.done ? " cc-goal--done" : "")} role="progressbar" aria-valuemin={0} aria-valuemax={g.target} aria-valuenow={g.have} aria-label={g.label}>
            <span className="cc-goal-fill" style={{ transform: `scaleX(${g.pct / 100})` }} />
            <span className="cc-goal-text">{g.done ? "✓ " : ""}{g.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Екран ---------- */

export function ClickerScreen({
  player, onClick, isLeader, news, onOpenLeaderboard, onOpenSeason,
  war = null, warTotals = { att: 0, def: 0 }, warPendingRef = null, players = [],
}) {
  const country = COUNTRY_MAP[player.countryCode];
  const [newsOpen, setNewsOpen] = useState(false);
  const wrapRef = useRef(null);
  const planetRef = useRef(null);
  const canvasRef = useRef(null);
  const fxRef = useRef(null);
  const comboRef = useRef(newCombo());
  const comboEls = useRef({ box: null, num: null, name: null, bar: null });
  const hideTimer = useRef(0);
  const liveMsg = useRef(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  const isEmpty = useStore(liveStore, (s) => !!s && getCurrentEnergy(s) < 1);
  const emptyRef = useRef(false);
  emptyRef.current = isEmpty;
  const [, emptyTick] = useState(0);
  useEffect(() => {
    if (!isEmpty) return undefined;
    const t = setTick(() => emptyTick((x) => x + 1), 1000);
    return () => clearTick(t);
  }, [isEmpty]);

  const inBattle = !!war && warPhase(war) === "battle" && !!warSide(war, player.countryCode);
  const inWar = !!war && !!warSide(war, player.countryCode);
  const inBattleRef = useRef(inBattle);
  inBattleRef.current = inBattle;

  /* canvas-ефекти */
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const a = attachFx(c, { reducedMotion: reduced });
    fxRef.current = a;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => a.resize()) : null;
    if (ro) ro.observe(c);
    return () => { if (ro) ro.disconnect(); a.destroy(); fxRef.current = null; clearTimeout(hideTimer.current); };
  }, [reduced]);

  const squash = useCallback((strong) => {
    const el = planetRef.current;
    if (!el || reduced || !el.animate) return;
    const k = strong ? 1.1 : 1;
    el.animate(
      [
        { transform: "scale(1,1)" },
        { transform: `scale(${1 + 0.07 * k},${1 - 0.07 * k})`, offset: 0.3 },
        { transform: `scale(${1 - 0.035 * k},${1 + 0.04 * k})`, offset: 0.62 },
        { transform: "scale(1,1)" },
      ],
      { duration: 170, easing: "ease-out" }
    );
  }, [reduced]);

  const showCombo = useCallback((st, levelUp) => {
    const e = comboEls.current;
    if (!e.box) return;
    const prog = comboProgress(st.count);
    const lvl = COMBO_LEVELS[prog.level];
    if (st.count >= 3) {
      e.box.classList.add("cc-combo--on");
      e.num.textContent = "×" + st.count;
      e.name.textContent = lvl.name || "Комбо";
      e.bar.style.transform = `scaleX(${prog.pct / 100})`;
      e.box.dataset.level = String(prog.level);
    }
    if (levelUp && liveMsg.current) liveMsg.current.textContent = `Комбо: ${COMBO_LEVELS[levelUp].name}`;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      comboRef.current = { ...comboRef.current, count: 0, last: 0 };
      e.box && e.box.classList.remove("cc-combo--on");
    }, COMBO_WINDOW_MS);
  }, []);

  const press = useCallback((clientX, clientY) => {
    const wrap = wrapRef.current;
    const rect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    // координати відносно canvas (він трохи більший за планету: inset -18%)
    const cv = canvasRef.current ? canvasRef.current.getBoundingClientRect() : rect;
    const x = (clientX || rect.left + rect.width / 2) - cv.left;
    const y = (clientY || rect.top + rect.height / 2) - cv.top;
    const empty = emptyRef.current;

    onClick(); // Power/енергію рахує App (оптимістично) і зводить із сервером

    if (empty) {
      cnSfx.error();
      haptic("warning");
      const el = planetRef.current;
      if (el && el.animate && !reduced) el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-7px)" }, { transform: "translateX(7px)" }, { transform: "translateX(0)" }], { duration: 220 });
      const a = fxRef.current;
      if (a) { spawnText(a.fx, x, y, "Немає енергії", { color: "#ff9a9a", size: 20, life: 0.9, rise: 40 }); a.kick(); }
      return;
    }

    const now = Date.now();
    const r = comboTap(comboRef.current, now);
    comboRef.current = r.state;
    const count = r.state.count;
    squash(!!r.levelUp);
    cnSfx.tapCombo(Math.min(count, 100));
    haptic(r.levelUp ? "success" : count >= 25 ? "medium" : "light");

    const a = fxRef.current;
    if (a) {
      const battle = inBattleRef.current;
      spawnText(a.fx, x, y - 14, "+1", { color: battle ? "#ff9a9a" : "#ffe27a", size: 26 + Math.min(14, count / 6) });
      spawnSparks(a.fx, x, y, count >= 25 ? 8 : 4, { power: count >= 50 ? 1.3 : 1 });
      if (count % 5 === 0) spawnRing(a.fx, x, y, { color: count >= 25 ? "#ffd54a" : "#ffffff" });
      if (r.levelUp) {
        const { w, h } = a.size();
        spawnText(a.fx, w / 2, h * 0.22, COMBO_LEVELS[r.levelUp].name, { color: COMBO_LEVELS[r.levelUp].color, size: 34, life: 1.1, rise: 30 });
        spawnRing(a.fx, w / 2, h / 2, { color: COMBO_LEVELS[r.levelUp].color, size: w * 0.45, life: 0.6 });
        spawnSparks(a.fx, w / 2, h / 2, 18, { power: 1.6 });
      }
      a.kick();
    }
    showCombo(r.state, r.levelUp);
  }, [onClick, squash, showCombo, reduced]);

  const onPointerDown = (e) => { e.preventDefault(); press(e.clientX, e.clientY); };
  const onKeyDown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); press(0, 0); } };

  const unreadNews = news && news.length > 0;
  const actionBtns = (
    <>
      <button className="cc-icon-btn" type="button" onClick={() => { cnSfx.navSwitch(); haptic("select"); onOpenLeaderboard && onOpenLeaderboard(); }} aria-label="Рейтинг"><Trophy size={20} strokeWidth={2.6} /></button>
      <button className="cc-icon-btn" type="button" onClick={() => { cnSfx.modalOpen(); openSupportChat(); }} aria-label="Підтримка"><LifeBuoy size={20} strokeWidth={2.6} /></button>
      <button className="cc-icon-btn" type="button" onClick={() => { cnSfx.modalOpen(); setNewsOpen(true); }} aria-label="Новини">
        <Newspaper size={20} strokeWidth={2.6} />
        {unreadNews && <span className="cc-dot" aria-label="Є нові новини" />}
      </button>
    </>
  );

  return (
    <div className={"cn-clicker cc-clicker" + (isEmpty ? " cc-clicker--empty" : "")}>
      <div className="cc-top">
        <span className="cc-country"><Flag code={country?.code} size={18} /> <span>{country?.name}</span></span>
        {!inWar && <div className="cc-actions" data-tut="actions">{actionBtns}</div>}
      </div>

      {inWar && <WarHud war={war} me={player} isLeader={isLeader} totals={warTotals} pendingRef={warPendingRef} players={players} />}

      <div className="cc-stats" data-tut="power" style={inBattle ? { display: "none" } : undefined}>
        <div className="cc-stat cc-stat--power" aria-label="Power">
          <GemIcon size={30} className="cn-power-icon cn-power-icon--power" />
          <span className="cc-stat-col"><span className="cc-stat-label">Power</span><LiveNumber field="power" /></span>
        </div>
        <div className="cc-stat cc-stat--points" aria-label="Points">
          <GemIcon size={30} className="cn-power-icon cn-power-icon--points" />
          <span className="cc-stat-col"><span className="cc-stat-label">Points</span><span className="cc-stat-value">{fmt(player.points || 0)}</span></span>
        </div>
      </div>

      <div ref={wrapRef} className="cc-stage" data-tut="globe">
        <div
          className={"cc-planet-btn" + (isEmpty ? " cc-planet-btn--empty" : "")}
          role="button"
          tabIndex={0}
          aria-label="Тапай по планеті, щоб заробляти Power"
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
        >
          <Planet innerRef={planetRef} />
        </div>
        <canvas ref={canvasRef} className="cc-fx" aria-hidden="true" />
        <div className="cc-combo" ref={(el) => { comboEls.current.box = el; if (el) { comboEls.current.num = el.querySelector(".cc-combo-num"); comboEls.current.name = el.querySelector(".cc-combo-name"); comboEls.current.bar = el.querySelector(".cc-combo-bar"); } }} aria-hidden="true">
          <Flame size={18} strokeWidth={3} />
          <span className="cc-combo-num">×0</span>
          <span className="cc-combo-name">Комбо</span>
          <span className="cc-combo-track"><span className="cc-combo-bar" /></span>
        </div>
        <span ref={liveMsg} className="cc-sr" role="status" aria-live="polite" />
      </div>

      <EnergyBar player={player} />
      <SeasonCard onOpen={onOpenSeason} />
      <DailyGoals playerId={player.id} />
      <div className="cc-total">Всього кліків: <LiveNumber field="totalClicks" className="cc-total-val" /></div>

      {inWar && <div className="cc-actions cc-actions--bottom">{actionBtns}</div>}
      {newsOpen && <NewsModal news={news} onClose={() => setNewsOpen(false)} />}
    </div>
  );
}
