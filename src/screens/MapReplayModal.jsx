import { useState, useEffect, useRef } from "react";
import { loadMapEvents, prepareReplay } from "../map/replay";
import { COUNTRY_MAP } from "../app/shared.jsx";
import { setTick, clearTick } from "../core/ticker.js";



/* ------------------------------------------------------------------ */
/*  Leaderboard screen                                                  */
/* ------------------------------------------------------------------ */

/* Повтор змін на карті: вікно 24 години / 7 днів, відтворення подій захоплення з журналу mapevt:* */
export function MapReplayModal({ lang = "uk", onClose }) {
  const [range, setRange] = useState("day");
  const [stage, setStage] = useState("Завантажуємо карту…");
  const [err, setErr] = useState("");
  const [events, setEvents] = useState([]);
  const [idx, setIdx] = useState(0); // скільки подій уже застосовано
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const stateRef = useRef(null);
  /* зум і переміщення: масштаб k, зсув (x, y) у пікселях вікна */
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const boxRef = useRef(null);
  const ptrs = useRef(new Map());
  const gest = useRef(null);
  const clampView = (v) => {
    const el = boxRef.current;
    if (!el) return v;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const k = Math.min(12, Math.max(1, v.k));
    return { k, x: Math.min(0, Math.max(w - w * k, v.x)), y: Math.min(0, Math.max(h - h * k, v.y)) };
  };
  const zoomAt = (cx, cy, factor) =>
    setView((v) => {
      const k = Math.min(12, Math.max(1, v.k * factor));
      const f = k / v.k;
      return clampView({ k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f });
    });
  const onPtrDown = (e) => {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    gest.current = null;
  };
  const onPtrMove = (e) => {
    const m = ptrs.current;
    if (!m.has(e.pointerId)) return;
    const prev = m.get(e.pointerId);
    m.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = boxRef.current.getBoundingClientRect();
    if (m.size === 1) {
      setView((v) => clampView({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    } else if (m.size === 2) {
      const [a, b] = [...m.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2 - rect.left;
      const cy = (a.y + b.y) / 2 - rect.top;
      if (gest.current) zoomAt(cx, cy, d / gest.current);
      gest.current = d;
    }
  };
  const onPtrUp = (e) => {
    ptrs.current.delete(e.pointerId);
    gest.current = null;
  };
  const onWheel = (e) => {
    const rect = boxRef.current.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.25 : 0.8);
  };
  const zoomBtn = (f) => {
    const el = boxRef.current;
    if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, f);
  };

  useEffect(() => {
    let off = false;
    prepareReplay({ width: 1800, lang })
      .then((sc) => { if (!off) { sceneRef.current = sc; setStage(""); } })
      .catch((e) => !off && setErr(e?.message || "Помилка"));
    return () => { off = true; };
  }, [lang]);

  useEffect(() => {
    let off = false;
    const since = Date.now() - (range === "day" ? 864e5 : 7 * 864e5);
    loadMapEvents(since).then((ev) => { if (!off) { setEvents(ev); setIdx(0); setPlaying(false); } }).catch(() => !off && setEvents([]));
    return () => { off = true; };
  }, [range]);

  /* кадр: стан на початок вікна + перші idx подій */
  useEffect(() => {
    const sc = sceneRef.current;
    const cv = canvasRef.current;
    if (!sc || !cv || stage) return;
    const st = sc.stateAt(events);
    for (let i = 0; i < idx; i++) sc.apply(st, events[i]);
    stateRef.current = st;
    cv.width = sc.W;
    cv.height = sc.H;
    sc.setChanged(events, idx);
    sc.draw(cv.getContext("2d"), st, idx > 0 ? events[idx - 1] : null);
  }, [stage, events, idx]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setTick(() => {
      setIdx((i) => {
        if (i >= events.length) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 900);
    return () => clearTick(id);
  }, [playing, events.length]);

  const cur = idx > 0 ? events[idx - 1] : null;
  const nm = (c) => COUNTRY_MAP[c]?.name || (c ? c : "вільна територія");
  return (
    <div className="cn-replay-back" onClick={onClose}>
      <div className="cn-replay" onClick={(e) => e.stopPropagation()}>
        <div className="cn-replay-head">
          <b>Повтор карти</b>
          <div className="cn-metric-chips" style={{ margin: 0 }}>
            {[["day", "24 години"], ["week", "7 днів"]].map(([k, l]) => (
              <button key={k} type="button" className={"cn-metric-chip" + (range === k ? " cn-metric-chip--on" : "")} onClick={() => setRange(k)}>{l}</button>
            ))}
          </div>
          <button type="button" className="cn-replay-x" onClick={onClose} aria-label="Закрити">×</button>
        </div>
        {err ? <div className="cn-replay-note">{err}</div> : stage ? <div className="cn-replay-note">{stage}</div> : (
          <div className="cn-replay-view" ref={boxRef} onPointerDown={onPtrDown} onPointerMove={onPtrMove} onPointerUp={onPtrUp} onPointerCancel={onPtrUp} onWheel={onWheel} onDoubleClick={() => setView({ k: 1, x: 0, y: 0 })}>
            <canvas ref={canvasRef} className="cn-replay-canvas" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }} />
            <div className="cn-replay-zoom">
              <button type="button" onClick={() => zoomBtn(1.6)} aria-label="Наблизити">+</button>
              <button type="button" onClick={() => zoomBtn(1 / 1.6)} aria-label="Віддалити">−</button>
              <button type="button" onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label="Скинути">⟲</button>
            </div>
          </div>
        )}
        <div className="cn-replay-cap">
          {cur
            ? `${new Date(cur.t).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${cur.name || "Область"}: ${nm(cur.from)} → ${nm(cur.to)}`
            : events.length ? "Початок періоду" : "За цей період змін на карті не було"}
        </div>
        <div className="cn-replay-ctl">
          <button type="button" className="cn-adm-btn" disabled={!events.length} onClick={() => { if (idx >= events.length) setIdx(0); setPlaying((p) => !p); }}>
            {playing ? "Пауза" : idx >= events.length && events.length ? "Ще раз" : "Грати"}
          </button>
          <input type="range" min={0} max={events.length} value={idx} disabled={!events.length} onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }} style={{ flex: 1 }} />
          <span className="cn-replay-n">{idx}/{events.length}</span>
        </div>
      </div>
    </div>
  );
}
