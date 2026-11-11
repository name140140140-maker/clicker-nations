import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

/* «Світові новини» — компактна стрічка подій гри: рубрика кольором, час і короткий заголовок.
   Без ефектів та емодзі; одним рядком — підсумок за добу. */

const CATS = {
  war: { label: "ВІЙНА", color: "#ff4d5e", icon: "" },
  conquest: { label: "КОРДОНИ", color: "#ff9a3c", icon: "" },
  unrest: { label: "НЕСПОКІЙ", color: "#ff6bd6", icon: "" },
  diplomacy: { label: "ДИПЛОМАТІЯ", color: "#47d7ac", icon: "" },
  world: { label: "СВІТ", color: "#5bb8ff", icon: "" },
  season: { label: "СЕЗОН", color: "#f4c542", icon: "" },
  staff: { label: "ШТАБ", color: "#ffd24a", icon: "" },
};
const EMOJI_CAT = [
  ["⚔", "war"], ["🛡", "war"], ["🏴", "conquest"], ["🚩", "conquest"], ["🔥", "unrest"], ["👑", "unrest"],
  ["🤝", "diplomacy"], ["🕊", "diplomacy"], ["📜", "diplomacy"], ["💔", "diplomacy"], ["🏆", "season"], ["🌍", "world"],
];
const EMOJI_RE = /^([\p{Extended_Pictographic}\uFE0F\u200D]+)\s*/u;

function parse(n) {
  let text = String(n.text || "");
  let icon = "";
  const m = text.match(EMOJI_RE);
  if (m) { icon = m[1]; text = text.slice(m[0].length).trim(); }
  let cat = n.admin ? "staff" : "world";
  if (!n.admin) for (const [e, c] of EMOJI_CAT) if (icon.includes(e)) { cat = c; break; }
  const cut = text.search(/[.!?](\s|$)/);
  const head = cut > 0 && cut < text.length - 1 ? text.slice(0, cut + 1) : text;
  const rest = head === text ? "" : text.slice(head.length).trim();
  return { id: n.id, ts: n.ts, cat, head, rest, admin: !!n.admin };
}

const FILTERS = [["all", "Усе"], ["war", "Війни"], ["conquest", "Кордони"], ["diplomacy", "Дипломатія"], ["world", "Світ"]];
const pad = (x) => String(x).padStart(2, "0");

const CSS = `
.nb { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: #070b14; color: #e8eef8; font-family: inherit; padding-top: env(safe-area-inset-top); }
.nb-top { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.nb-logo { font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 800; letter-spacing: 0.05em; }
.nb-logo i { font-style: normal; margin-left: 8px; font-size: 9px; font-weight: 600; letter-spacing: 0.18em; color: #7e93b3; }
.nb-clock { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 12px; color: #8fa3c2; }
.nb-x { width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: transparent; color: #fff; display: grid; place-items: center; cursor: pointer; flex-shrink: 0; }
.nb-scroll { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 8px 12px 14px; }
.nb-chan { display: flex; gap: 6px; }
.nb-chan button { padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: transparent; color: #9db0cc; font: 600 12px/1 inherit; cursor: pointer; }
.nb-chan button.on { background: #e8eef8; color: #0a0f1a; border-color: #e8eef8; }
.nb-sum { margin: 8px 0 0; font-size: 11px; color: #7e93b3; }
.nb-sum b { color: #c9d6ea; font-weight: 600; }
.nb-filters { display: flex; gap: 12px; overflow-x: auto; margin-top: 6px; border-bottom: 1px solid rgba(255,255,255,0.08); scrollbar-width: none; }
.nb-filters::-webkit-scrollbar { display: none; }
.nb-chip { flex-shrink: 0; padding: 6px 0; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #8fa3c2; font: 600 12px/1 inherit; cursor: pointer; }
.nb-chip.on { color: #fff; border-bottom-color: #5bb8ff; }
.nb-feed { margin-top: 2px; }
.nb-item { display: flex; gap: 9px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
.nb-dot { flex-shrink: 0; width: 6px; height: 6px; margin-top: 6px; border-radius: 50%; background: var(--c); }
.nb-item-main { min-width: 0; flex: 1; }
.nb-item-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 9.5px; }
.nb-tag { font-weight: 700; letter-spacing: 0.12em; color: var(--c); }
.nb-time { color: #6f84a3; font-variant-numeric: tabular-nums; }
.nb-item-h { margin-top: 1px; font-size: 13px; font-weight: 600; line-height: 1.35; color: #eef3fa; }
.nb-item-p { margin-top: 2px; font-size: 11.5px; line-height: 1.4; color: #8fa3c2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.nb-empty { padding: 28px 8px; text-align: center; color: #7e93b3; font-size: 12.5px; line-height: 1.5; }
`;

export default function NewsBroadcast({ news, onClose, timeAgo }) {
  const [chan, setChan] = useState("game");
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);

  const all = useMemo(() => (news || []).map(parse), [news]);
  const game = useMemo(() => all.filter((x) => !x.admin), [all]);
  const staff = useMemo(() => all.filter((x) => x.admin), [all]);
  const list = chan === "staff" ? staff : game;
  const feed = chan === "staff" || filter === "all" ? list : list.filter((x) => x.cat === filter || (filter === "world" && (x.cat === "season" || x.cat === "unrest")));

  const day = Date.now() - 86400000;
  const rec = game.filter((x) => (x.ts || 0) > day);
  const cnt = (c) => rec.filter((x) => x.cat === c).length;

  return (
    <div className="nb" role="dialog" aria-label="Світові новини">
      <style>{CSS}</style>
      <div className="nb-top">
        <div className="nb-logo">WC NEWS<i>СВІТОВІ НОВИНИ</i></div>
        <div className="nb-clock">{pad(now.getHours())}:{pad(now.getMinutes())}</div>
        <button className="nb-x" type="button" onClick={onClose} aria-label="Закрити"><X size={15} /></button>
      </div>

      <div className="nb-scroll">
        <div className="nb-chan">
          <button type="button" className={chan === "game" ? "on" : ""} onClick={() => setChan("game")}>Світ · {game.length}</button>
          <button type="button" className={chan === "staff" ? "on" : ""} onClick={() => setChan("staff")}>Штаб · {staff.length}</button>
        </div>

        {chan === "game" && (
          <>
            <div className="nb-sum">За 24 години: <b>{rec.length}</b> подій · війн <b>{cnt("war")}</b> · кордонів <b>{cnt("conquest")}</b> · дипломатії <b>{cnt("diplomacy")}</b></div>
            <div className="nb-filters">
              {FILTERS.map(([k, l]) => <button key={k} type="button" className={"nb-chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
          </>
        )}

        <div className="nb-feed">
          {feed.map((x) => {
            const c = CATS[x.cat];
            return (
              <div key={x.id} className="nb-item" style={{ "--c": c.color }}>
                <span className="nb-dot" />
                <div className="nb-item-main">
                  <div className="nb-item-meta"><span className="nb-tag">{c.label}</span><span className="nb-time">{timeAgo(x.ts)}</span></div>
                  <div className="nb-item-h">{x.head}</div>
                  {x.rest && <div className="nb-item-p">{x.rest}</div>}
                </div>
              </div>
            );
          })}
          {feed.length === 0 && (
            <div className="nb-empty">
              {chan === "staff" ? "Штаб поки мовчить." : list.length ? "У цій рубриці поки порожньо." : "Поки новин немає. Війни, захоплення міст, союзи й пакти з'являтимуться тут."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
