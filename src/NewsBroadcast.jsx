import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { sbStorageGet } from "./supabaseStorage";
import { activeEvents, eventNews } from "./worldEvents";
import { worldVirus, fmtBig } from "./virusStats";
import { onPandemicChange } from "./pandemic";

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
  event: { label: "ПОДІЯ", color: "#c28bff", icon: "" },
};
const EMOJI_CAT = [
  ["⚔", "war"], ["🛡", "war"], ["🏴", "conquest"], ["🚩", "conquest"], ["🔥", "unrest"], ["👑", "unrest"],
  ["🤝", "diplomacy"], ["🕊", "diplomacy"], ["📜", "diplomacy"], ["💔", "diplomacy"], ["🏆", "season"], ["🌍", "world"], ["🌋", "event"], ["🦠", "event"], ["🚫", "event"], ["✊", "event"],
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

const FILTERS = [["all", "Усе"], ["war", "Війни"], ["conquest", "Кордони"], ["event", "Події"], ["diplomacy", "Дипломатія"], ["world", "Світ"]];
/* Телепередача: виходить лише двічі на день за місцевим часом гравця — ранковий (07:00–12:00) й вечірній (19:00–24:00) випуски. */
const EDITIONS = [
  { id: "morning", from: 7, to: 12, name: "Ранковий випуск", hello: "Доброго ранку! Це WC NEWS, і ось головне за ніч і вечір.", since: (d) => { const t = new Date(d); t.setDate(t.getDate() - 1); t.setHours(19, 0, 0, 0); return +t; } },
  { id: "evening", from: 19, to: 24, name: "Вечірній випуск", hello: "Добрий вечір! З вами WC NEWS: головні події дня.", since: (d) => { const t = new Date(d); t.setHours(7, 0, 0, 0); return +t; } },
];
const TEST_EDITION = { id: "test", name: "Тестовий випуск", hello: "Це тестовий випуск WC NEWS. Ось головне за останній час.", since: (d) => +d - 12 * 3600000 };
const onAir = (d, test) => (test && +d >= test.at && +d < test.until ? TEST_EDITION : EDITIONS.find((e) => d.getHours() >= e.from && d.getHours() < e.to) || null);
const nextEdition = (d) => {
  const h = d.getHours();
  const e = EDITIONS.find((x) => h < x.from) || EDITIONS[0];
  return e;
};
const score = (x) => (/вибула|знищен|втратила всі міста/i.test(x.head + " " + x.rest) ? 5 : x.cat === "conquest" || x.cat === "event" ? 4 : x.cat === "war" ? 3 : x.cat === "diplomacy" ? 2 : 1);
const OUTRO = ["Це були головні новини. Залишайтеся з нами.", "На цьому все. Наступний випуск — вже скоро."];

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
.nb-tvbtn { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(255,77,94,0.5); background: rgba(255,77,94,0.1); color: #fff; font: 600 12px/1 inherit; cursor: pointer; text-align: left; }
.nb-tvbtn i { font-style: normal; font-size: 9px; font-weight: 800; letter-spacing: 0.14em; padding: 3px 6px; border-radius: 4px; background: #ff4d5e; }
.nb-tv { margin-top: 8px; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; overflow: hidden; background: #0c1424; }
.nb-tv-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: linear-gradient(90deg, #15264a, #0c1424); font-size: 12px; font-weight: 700; }
.nb-tv-live { font-size: 9px; font-weight: 800; letter-spacing: 0.14em; padding: 3px 6px; border-radius: 4px; background: #ff4d5e; }
.nb-tv-live.off { background: #3a4a66; }
.nb-tv-body { padding: 10px; }
.nb-tv-say { font-size: 12.5px; line-height: 1.5; color: #c9d6ea; margin: 0 0 8px; }
.nb-tv-story { display: flex; gap: 9px; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.07); }
.nb-tv-n { flex-shrink: 0; width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; background: var(--c); color: #0a0f1a; font-size: 11px; font-weight: 800; }
.nb-tv-ticker { padding: 6px 10px; font-size: 10.5px; color: #8fa3c2; background: rgba(255,255,255,0.04); }
.nb-active { margin-top: 8px; padding: 7px 9px; border-radius: 10px; border: 1px solid rgba(194,139,255,0.35); background: rgba(194,139,255,0.07); font-size: 11.5px; line-height: 1.45; color: #d9c5f5; }
.nb-active b { color: #fff; }
.nb-empty { padding: 28px 8px; text-align: center; color: #7e93b3; font-size: 12.5px; line-height: 1.5; }
`;

export default function NewsBroadcast({ news, onClose, timeAgo }) {
  const [chan, setChan] = useState("game"); // game | staff | tv
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(() => new Date());
  /* Тестовий таймер від адміна (cfg:tvtest = {at, until}) */
  const [test, setTest] = useState(null);
  useEffect(() => {
    let off = false;
    const load = async () => {
      const raw = await sbStorageGet("cfg:tvtest", true);
      let v = null;
      try { v = raw ? JSON.parse(raw) : null; } catch { v = null; }
      if (!off) setTest(v && typeof v.at === "number" && typeof v.until === "number" ? v : null);
    };
    load();
    const id = setInterval(load, 20000);
    return () => { off = true; clearInterval(id); };
  }, []);
  useEffect(() => { const id = setInterval(() => setNow(new Date()), test ? 2000 : 30000); return () => clearInterval(id); }, [!!test]);

  /* Події світу (пандемії, землетруси, санкції, революції) рахуються за датою й додаються до стрічки */
  const minute = Math.floor(now.getTime() / 60000);
  const evNews = useMemo(() => eventNews(Date.now(), 4).map((e) => ({ ...e, admin: false })), [minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pv, setPv] = useState(0);
  useEffect(() => onPandemicChange(() => setPv((x) => x + 1)), []);
  const active = useMemo(() => activeEvents(Date.now()).filter((e) => e.type !== "pandemic"), [minute, pv]); // eslint-disable-line react-hooks/exhaustive-deps
  const virus = useMemo(() => worldVirus(Date.now()), [minute, pv]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => [...(news || []), ...evNews].sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(parse), [news, evNews]);
  const game = useMemo(() => all.filter((x) => !x.admin), [all]);
  const staff = useMemo(() => all.filter((x) => x.admin), [all]);
  const list = chan === "staff" ? staff : game;
  const feed = chan === "staff" || filter === "all" ? list : list.filter((x) => x.cat === filter || (filter === "world" && (x.cat === "season" || x.cat === "unrest")));

  const air = onAir(now, test);
  const nxt = nextEdition(now);
  const tv = useMemo(() => {
    if (!air) return null;
    const since = air.since(now);
    const seen = new Set();
    const pool = game.filter((x) => (x.ts || 0) >= since && !seen.has(x.head) && seen.add(x.head));
    const top = [...pool].sort((a, b) => score(b) - score(a) || (b.ts || 0) - (a.ts || 0)).slice(0, 5);
    return { air, total: pool.length, top };
  }, [air && air.id, game, Math.floor(now.getTime() / 600000)]);

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
          <button type="button" className={chan === "tv" ? "on" : ""} onClick={() => setChan("tv")}>ТБ</button>
        </div>

        {chan === "game" && air && (
          <button type="button" className="nb-tvbtn" onClick={() => setChan("tv")}><i>В ЕФІРІ</i>{air.name}: головне за останній час</button>
        )}

        {chan === "tv" && (
          <div className="nb-tv">
            <div className="nb-tv-head">
              <span className={"nb-tv-live" + (air ? "" : " off")}>{air ? "В ЕФІРІ" : "ПЕРЕРВА"}</span>
              WC NEWS · {air ? air.name : "наступний випуск"}
            </div>
            {air && tv ? (
              <div className="nb-tv-body">
                <p className="nb-tv-say">{air.hello} {tv.top.length ? `Подій у стрічці: ${tv.total}. Найважливіше:` : "Спокійний період: значних подій не було."}</p>
                {tv.top.map((x, i) => {
                  const c = CATS[x.cat];
                  return (
                    <div key={x.id} className="nb-tv-story" style={{ "--c": c.color }}>
                      <span className="nb-tv-n">{i + 1}</span>
                      <div className="nb-item-main">
                        <div className="nb-item-meta"><span className="nb-tag">{c.label}</span><span className="nb-time">{timeAgo(x.ts)}</span></div>
                        <div className="nb-item-h">{x.head}</div>
                        {x.rest && <div className="nb-item-p">{x.rest}</div>}
                      </div>
                    </div>
                  );
                })}
                <p className="nb-tv-say" style={{ marginTop: 8, marginBottom: 0 }}>{OUTRO[(tv.total + now.getDate()) % OUTRO.length]}</p>
              </div>
            ) : (
              <div className="nb-empty">Зараз перерва між випусками.<br />Наступний — {nxt.name.toLowerCase()} о {pad(nxt.from)}:00 (ранковий з 07:00, вечірній з 19:00 за вашим часом).</div>
            )}
            <div className="nb-tv-ticker">Випуски виходять двічі на день: зранку (07:00–12:00) й увечері (19:00–24:00).</div>
          </div>
        )}

        {chan !== "tv" && chan === "game" && (
          <>
            <div className="nb-sum">За 24 години: <b>{rec.length}</b> подій · війн <b>{cnt("war")}</b> · кордонів <b>{cnt("conquest")}</b> · дипломатії <b>{cnt("diplomacy")}</b></div>
            {virus.map((w) => (
              <div key={w.e.id} className="nb-active">
                🦠 <b>Пандемія: {w.disease}</b> · заражено країн {w.countries} · хворіють ≈ {fmtBig(w.ill)} · померло ≈ {fmtBig(w.dead)}
                <br />заразність {w.contag}, летальність {w.lethal}. Закритий кордон захищає від вірусу.
              </div>
            ))}
            {active.length > 0 && (
              <div className="nb-active">
                <b>Зараз у світі:</b> {active.map((e) => `${e.meta.emoji} ${e.meta.label}${e.code ? " · " + e.code : ""}`).join("  ·  ")}
              </div>
            )}
            <div className="nb-filters">
              {FILTERS.map(([k, l]) => <button key={k} type="button" className={"nb-chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
          </>
        )}

        <div className="nb-feed" style={chan === "tv" ? { display: "none" } : undefined}>
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
