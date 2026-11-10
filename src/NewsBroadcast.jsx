import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

/* «Світовий ефір» — новини гри у вигляді телевізійного випуску:
   ТЕРМІНОВО-картка з радаром, лічильники за добу, стрічка подій і біжучий рядок внизу. */

const CATS = {
  war: { label: "ВІЙНА", color: "#ff4d5e", icon: "⚔️" },
  conquest: { label: "КОРДОНИ", color: "#ff9a3c", icon: "🏴" },
  unrest: { label: "НЕСПОКІЙ", color: "#ff6bd6", icon: "🔥" },
  diplomacy: { label: "ДИПЛОМАТІЯ", color: "#47d7ac", icon: "🤝" },
  world: { label: "СВІТ", color: "#5bb8ff", icon: "🌍" },
  season: { label: "СЕЗОН", color: "#f4c542", icon: "🏆" },
  staff: { label: "ШТАБ", color: "#ffd24a", icon: "📣" },
};
const EMOJI_CAT = [
  ["⚔", "war"], ["🛡", "war"], ["🏴", "conquest"], ["🚩", "conquest"], ["🔥", "unrest"], ["👑", "unrest"],
  ["🤝", "diplomacy"], ["📜", "diplomacy"], ["💔", "diplomacy"], ["🏆", "season"], ["🌍", "world"],
];
const EMOJI_RE = /^([\p{Extended_Pictographic}️‍]+)\s*/u;

function parse(n) {
  let text = String(n.text || "");
  let icon = "";
  const m = text.match(EMOJI_RE);
  if (m) { icon = m[1]; text = text.slice(m[0].length); }
  let cat = n.admin ? "staff" : "world";
  if (!n.admin) for (const [e, c] of EMOJI_CAT) if (icon.includes(e)) { cat = c; break; }
  const cut = text.search(/[.!?](\s|$)/);
  const head = cut > 0 && cut < text.length - 1 ? text.slice(0, cut + 1) : text;
  const rest = head === text ? "" : text.slice(head.length).trim();
  return { id: n.id, ts: n.ts, cat, icon: icon || CATS[cat].icon, head, rest, admin: !!n.admin };
}

const FILTERS = [["all", "Усе"], ["war", "Війни"], ["conquest", "Кордони"], ["diplomacy", "Дипломатія"], ["world", "Світ"]];
const pad = (x) => String(x).padStart(2, "0");

const CSS = `
.nb { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: #05070d; color: #e8eef8; font-family: inherit; animation: nb-in 0.28s ease-out; padding-top: env(safe-area-inset-top); }
@keyframes nb-in { from { opacity: 0; transform: translateY(14px) scale(0.985); } to { opacity: 1; transform: none; } }
.nb::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 3; background: repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px); mix-blend-mode: overlay; }
.nb-top { position: relative; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: linear-gradient(180deg, #101827, #0a0f1a); border-bottom: 2px solid #ff4d5e; }
.nb-logo { display: flex; flex-direction: column; line-height: 1; }
.nb-logo b { font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 800; letter-spacing: 0.04em; background: linear-gradient(90deg, #fff, #8fd0ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.nb-logo i { font-style: normal; font-size: 8.5px; letter-spacing: 0.3em; color: #7e93b3; margin-top: 3px; }
.nb-live { display: flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 4px; background: #e0283c; font-size: 10.5px; font-weight: 800; letter-spacing: 0.14em; }
.nb-live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #fff; animation: nb-blink 1s steps(2, start) infinite; }
@keyframes nb-blink { 50% { opacity: 0.15; } }
.nb-clock { margin-left: auto; text-align: right; font-variant-numeric: tabular-nums; font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 700; line-height: 1.1; }
.nb-clock small { display: block; font-size: 9px; letter-spacing: 0.14em; color: #7e93b3; font-weight: 600; }
.nb-x { width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); color: #fff; display: grid; place-items: center; cursor: pointer; flex-shrink: 0; }
.nb-scroll { position: relative; z-index: 1; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding-bottom: 12px; }
.nb-chan { display: flex; gap: 6px; padding: 10px 12px 0; }
.nb-chan button { flex: 1; padding: 9px 6px; border-radius: 8px 8px 0 0; border: 1px solid rgba(255,255,255,0.12); border-bottom: 0; background: rgba(255,255,255,0.04); color: #8fa3c2; font: 700 11.5px/1 inherit; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
.nb-chan button.on { background: linear-gradient(180deg, #1b2a44, #111a2b); color: #fff; border-color: #3b79c4; box-shadow: inset 0 2px 0 #5bb8ff; }
.nb-chan button.on.staff { border-color: #c9a227; box-shadow: inset 0 2px 0 #ffd24a; }
.nb-hero { position: relative; margin: 0 12px; padding: 16px 14px 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.12); border-radius: 0 0 14px 14px; background: linear-gradient(160deg, #0f1b30 0%, #0a1220 100%); min-height: 176px; }
.nb-hero::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--c); box-shadow: 0 0 18px var(--c); }
.nb-radar { position: absolute; right: -60px; top: -60px; width: 220px; height: 220px; border-radius: 50%; opacity: 0.55; pointer-events: none;
  background: repeating-radial-gradient(circle, transparent 0 17px, color-mix(in srgb, var(--c) 35%, transparent) 17px 18px), linear-gradient(var(--c), var(--c)) center/1px 100% no-repeat, linear-gradient(var(--c), var(--c)) center/100% 1px no-repeat; }
.nb-radar::before { content: ""; position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 0deg, color-mix(in srgb, var(--c) 60%, transparent), transparent 28%); animation: nb-sweep 3.4s linear infinite; }
.nb-radar::after { content: ""; position: absolute; left: 62%; top: 38%; width: 7px; height: 7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px 3px var(--c); animation: nb-ping 1.7s ease-out infinite; }
@keyframes nb-sweep { to { transform: rotate(360deg); } }
@keyframes nb-ping { 0% { transform: scale(0.6); opacity: 1; } 100% { transform: scale(3.2); opacity: 0; } }
.nb-flash { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 3px; background: var(--c); color: #0a0d14; font-size: 10.5px; font-weight: 900; letter-spacing: 0.16em; animation: nb-flash 1.6s ease-in-out infinite; }
@keyframes nb-flash { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.35); } }
.nb-hero-time { position: relative; display: inline-block; margin-left: 8px; font-size: 10.5px; color: #8fa3c2; letter-spacing: 0.06em; }
.nb-hero-h { position: relative; margin: 12px 0 0; font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 21px; line-height: 1.22; max-width: 88%; text-wrap: balance; animation: nb-glitch 0.55s steps(1, end) 1; }
@keyframes nb-glitch { 0% { transform: translateX(-6px); opacity: 0; text-shadow: 3px 0 #ff2d55, -3px 0 #2dd4ff; } 25% { transform: translateX(4px); opacity: 1; text-shadow: -3px 0 #ff2d55, 3px 0 #2dd4ff; } 50% { transform: translateX(-2px); text-shadow: 2px 0 #ff2d55, -2px 0 #2dd4ff; } 100% { transform: none; text-shadow: none; } }
.nb-hero-p { position: relative; margin: 8px 0 0; font-size: 12.5px; line-height: 1.5; color: #b6c4db; max-width: 88%; }
.nb-hero-ico { position: absolute; right: 14px; bottom: 8px; font-size: 44px; filter: drop-shadow(0 0 14px var(--c)); opacity: 0.9; }
.nb-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 10px 12px 0; }
.nb-stat { padding: 8px 4px 7px; text-align: center; border-radius: 10px; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.08); }
.nb-stat b { display: block; font-family: 'Space Grotesk', sans-serif; font-size: 18px; line-height: 1; color: var(--c); }
.nb-stat span { display: block; margin-top: 4px; font-size: 8.5px; letter-spacing: 0.1em; color: #7e93b3; text-transform: uppercase; }
.nb-filters { display: flex; gap: 6px; overflow-x: auto; padding: 10px 12px 2px; scrollbar-width: none; }
.nb-filters::-webkit-scrollbar { display: none; }
.nb-chip { flex-shrink: 0; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: transparent; color: #9db0cc; font: 600 11.5px/1 inherit; cursor: pointer; }
.nb-chip.on { background: #e8eef8; color: #0a0f1a; border-color: #e8eef8; }
.nb-feed { position: relative; padding: 10px 12px 4px 30px; }
.nb-feed::before { content: ""; position: absolute; left: 21px; top: 16px; bottom: 10px; width: 2px; background: linear-gradient(180deg, #3b79c4, rgba(59,121,196,0.05)); }
.nb-item { position: relative; margin-bottom: 9px; padding: 10px 12px 10px 12px; border-radius: 4px 12px 12px 4px; background: linear-gradient(90deg, color-mix(in srgb, var(--c) 14%, #0d1424) 0%, #0d1424 70%); border: 1px solid rgba(255,255,255,0.07); border-left: 3px solid var(--c); opacity: 0; animation: nb-item 0.42s ease-out forwards; }
@keyframes nb-item { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
.nb-item::before { content: attr(data-ico); position: absolute; left: -29px; top: 10px; width: 24px; height: 24px; display: grid; place-items: center; font-size: 13px; background: #0a0f1a; border: 2px solid var(--c); border-radius: 50%; box-shadow: 0 0 10px color-mix(in srgb, var(--c) 60%, transparent); }
.nb-item-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.nb-tag { font-size: 9px; font-weight: 800; letter-spacing: 0.16em; color: var(--c); }
.nb-time { font-size: 10px; color: #7e93b3; font-variant-numeric: tabular-nums; }
.nb-item-h { font-size: 13.5px; font-weight: 700; line-height: 1.4; color: #f1f5fb; }
.nb-item-p { margin-top: 3px; font-size: 12px; line-height: 1.45; color: #9db0cc; }
.nb-item--staff { background: repeating-linear-gradient(135deg, rgba(255,210,74,0.1) 0 10px, rgba(255,210,74,0.04) 10px 20px), #0d1424; }
.nb-empty { margin: 14px 12px; padding: 26px 16px; text-align: center; border: 1px dashed rgba(255,255,255,0.18); border-radius: 14px; color: #8fa3c2; font-size: 12.5px; line-height: 1.5; }
.nb-empty big { display: block; font-size: 30px; margin-bottom: 6px; animation: nb-blink 1.6s ease-in-out infinite; }
.nb-ticker { position: relative; z-index: 2; display: flex; align-items: stretch; height: 34px; background: #0a0f1a; border-top: 2px solid #5bb8ff; padding-bottom: env(safe-area-inset-bottom); box-sizing: content-box; }
.nb-ticker-tag { display: flex; align-items: center; padding: 0 11px; background: #5bb8ff; color: #06101e; font-size: 10px; font-weight: 900; letter-spacing: 0.14em; white-space: nowrap; clip-path: polygon(0 0, 100% 0, calc(100% - 9px) 100%, 0 100%); padding-right: 16px; }
.nb-ticker-win { flex: 1; overflow: hidden; display: flex; align-items: center; }
.nb-ticker-run { display: flex; white-space: nowrap; font-size: 12px; color: #d4deee; animation: nb-run var(--d, 40s) linear infinite; will-change: transform; }
.nb-ticker-run span { padding: 0 16px; }
.nb-ticker-run em { font-style: normal; color: #5bb8ff; }
@keyframes nb-run { to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .nb *, .nb { animation-duration: 0.01s !important; animation-iteration-count: 1 !important; } .nb-ticker-run { animation: none !important; } }
`;

export default function NewsBroadcast({ news, onClose, timeAgo }) {
  const [chan, setChan] = useState("game");
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);

  const all = useMemo(() => (news || []).map(parse), [news]);
  const game = useMemo(() => all.filter((x) => !x.admin), [all]);
  const staff = useMemo(() => all.filter((x) => x.admin), [all]);
  const list = chan === "staff" ? staff : game;
  const filtered = chan === "staff" || filter === "all" ? list : list.filter((x) => x.cat === filter || (filter === "world" && (x.cat === "season" || x.cat === "unrest")));
  const hero = list[0] || null;
  const feed = hero && filter === "all" ? filtered.slice(1) : filtered;

  const day = Date.now() - 86400000;
  const rec = game.filter((x) => (x.ts || 0) > day);
  const cnt = (cats) => rec.filter((x) => cats.includes(x.cat)).length;
  const tickerItems = (all.length ? all : []).slice(0, 8);
  const tickerText = tickerItems.length ? tickerItems : [{ id: "e", head: "Ефір чекає на перші події світу. Оголоси війну, захопи область — і про тебе заговорять." }];
  const hc = hero ? CATS[hero.cat] : CATS.world;
  const stat = [["Подій", rec.length, "#e8eef8"], ["Війни", cnt(["war"]), CATS.war.color], ["Кордони", cnt(["conquest"]), CATS.conquest.color], ["Союзи", cnt(["diplomacy"]), CATS.diplomacy.color]];

  return (
    <div className="nb" role="dialog" aria-label="Світові новини">
      <style>{CSS}</style>
      <div className="nb-top">
        <div className="nb-logo"><b>WC NEWS</b><i>СВІТОВИЙ ЕФІР</i></div>
        <div className="nb-live">ЕФІР</div>
        <div className="nb-clock">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}<small>ЧАС У ГРІ</small></div>
        <button className="nb-x" type="button" onClick={onClose} aria-label="Закрити"><X size={17} /></button>
      </div>

      <div className="nb-scroll">
        <div className="nb-chan">
          <button type="button" className={chan === "game" ? "on" : ""} onClick={() => setChan("game")}>Світ · {game.length}</button>
          <button type="button" className={"staff" + (chan === "staff" ? " on staff" : "")} onClick={() => setChan("staff")}>Штаб · {staff.length}</button>
        </div>

        <div className="nb-hero" style={{ "--c": hc.color }} key={hero ? hero.id : "none"}>
          <div className="nb-radar" />
          {hero ? (
            <>
              <span className="nb-flash">{chan === "staff" ? "ОГОЛОШЕННЯ ШТАБУ" : "ТЕРМІНОВО · " + hc.label}</span>
              <span className="nb-hero-time">{timeAgo(hero.ts)}</span>
              <h2 className="nb-hero-h">{hero.head}</h2>
              {hero.rest && <p className="nb-hero-p">{hero.rest}</p>}
              <div className="nb-hero-ico">{hero.icon}</div>
            </>
          ) : (
            <div className="nb-empty" style={{ border: 0, margin: 0 }}>
              <big>📡</big>
              {chan === "staff" ? "Штаб поки мовчить. Важливі оголошення з'являться тут." : "У ефірі тиша. Війни, захоплення міст, союзи, пакти, нові країни й сезони виходитимуть тут у прямому ефірі."}
            </div>
          )}
        </div>

        {chan === "game" && (
          <>
            <div className="nb-stats">
              {stat.map(([l, v, c]) => <div className="nb-stat" key={l} style={{ "--c": c }}><b>{v}</b><span>{l} / 24г</span></div>)}
            </div>
            <div className="nb-filters">
              {FILTERS.map(([k, l]) => <button key={k} type="button" className={"nb-chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
          </>
        )}

        <div className="nb-feed">
          {feed.map((x, i) => {
            const c = CATS[x.cat];
            return (
              <div key={x.id} className={"nb-item" + (x.admin ? " nb-item--staff" : "")} data-ico={x.icon} style={{ "--c": c.color, animationDelay: Math.min(i, 12) * 45 + "ms" }}>
                <div className="nb-item-meta"><span className="nb-tag">{c.label}</span><span className="nb-time">{timeAgo(x.ts)}</span></div>
                <div className="nb-item-h">{x.head}</div>
                {x.rest && <div className="nb-item-p">{x.rest}</div>}
              </div>
            );
          })}
          {feed.length === 0 && filtered.length === 0 && hero && <div className="nb-empty" style={{ margin: "6px 0" }}>У цій рубриці поки порожньо.</div>}
        </div>
      </div>

      <div className="nb-ticker">
        <div className="nb-ticker-tag">ОСТАННЄ</div>
        <div className="nb-ticker-win">
          <div className="nb-ticker-run" style={{ "--d": Math.max(24, tickerText.length * 9) + "s" }}>
            {[0, 1].map((k) => tickerText.map((x) => <span key={k + x.id}><em>◆</em> {x.head}</span>))}
          </div>
        </div>
      </div>
    </div>
  );
}
