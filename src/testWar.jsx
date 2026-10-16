import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Compass, MousePointerClick, Send, X } from "lucide-react";
import TerritoryMap from "./TerritoryMap";
import { sbStorageGet, sbStorageSet } from "./supabaseStorage";

/* ТЕСТОВА військово-економічна механіка (не повноцінна):
   • «Створити бізнес» — точка на території своєї країни, 100 ХП;
   • «Створити ППО» — точка на території своєї країни, діє в обмеженому радіусі;
   • «Запустити дрон» — два режими: «Прокласти маршрут» (3 точки, остання — на бізнесі) і «Керувати самостійно».
     Дрон, що влучив у бізнес, віднімає 20 ХП; дрон, що влетів у зону ППО, збивається.
   Дані зберігаються приватно для кожного гравця (Supabase, ключ testwar-v1), тож не впливають на інших. */

export const TW_KEY = "testwar-v1";
export const BIZ_MAX_HP = 100;
export const DRONE_DAMAGE = 20;
export const AA_RADIUS_KM = 250;
export const MAX_OBJECTS = 10;
const MANUAL_FUEL_SEC = 60;
const BIZ_COLOR = "#f59e0b";
const AA_COLOR = "#22d3ee";
const DRONE_COLOR = "#ef4444";

export const EMPTY_TW = { biz: [], aa: [] };

export async function loadTestWar() {
  try {
    const raw = await sbStorageGet(TW_KEY, false);
    if (!raw) return { ...EMPTY_TW };
    const d = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { biz: Array.isArray(d.biz) ? d.biz : [], aa: Array.isArray(d.aa) ? d.aa : [] };
  } catch {
    return { ...EMPTY_TW };
  }
}

export async function saveTestWar(data) {
  try {
    await sbStorageSet(TW_KEY, JSON.stringify(data), false);
  } catch {
    /* тестові дані: помилку збереження ігноруємо */
  }
}

const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------------- Геометрія ---------------- */

const R_EARTH = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function distKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Багатокутник-коло радіусом km навколо точки (для зони ППО).
function circleRing(lng, lat, km, n = 64) {
  const ring = [];
  const dLat = (km / R_EARTH) * (180 / Math.PI);
  const dLng = dLat / Math.max(0.2, Math.cos(rad(lat)));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
  }
  return ring;
}

// Точка на ламаній на відстані d км від початку.
function along(path, cum, d) {
  for (let i = 1; i < path.length; i++) {
    if (d <= cum[i] || i === path.length - 1) {
      const seg = cum[i] - cum[i - 1] || 1;
      const k = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
      return { lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * k, lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * k };
    }
  }
  return path[path.length - 1];
}

const pointF = (p, props) => ({ type: "Feature", properties: { t: "", r: 6, ...props }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } });

/* ---------------- Екран карти для дій ---------------- */

const TITLES = { business: "Створити бізнес", aa: "Створити ППО", drone: "Запустити дрон" };

export function TestWarMapScreen({ action, me, nations, lang = "uk", data, onChange, onClose }) {
  const mapRef = useRef(null);
  const myId = me.countryCode;
  const dataRef = useRef(data);
  dataRef.current = data;

  const [step, setStep] = useState(action === "drone" ? "mode" : "pick");
  const [note, setNote] = useState(null); // { ok, text } — короткі підказки/помилки
  const [result, setResult] = useState(null); // { ok, text }
  const [pts, setPts] = useState([]); // точки маршруту
  const [targetBiz, setTargetBiz] = useState(null);
  const [drone, setDrone] = useState(null);
  const [fuel, setFuel] = useState(MANUAL_FUEL_SEC);
  const sim = useRef(null);

  useEffect(() => {
    if (!note) return undefined;
    const tm = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(tm);
  }, [note]);

  // Завершення польоту: застосовуємо шкоду бізнесу й показуємо результат.
  const finish = (res, hitBizId) => {
    sim.current = null;
    setDrone(null);
    if (hitBizId) {
      const cur = dataRef.current;
      const biz = cur.biz
        .map((b) => (b.id === hitBizId ? { ...b, hp: b.hp - DRONE_DAMAGE } : b))
        .filter((b) => b.hp > 0);
      onChange({ ...cur, biz });
    }
    setResult(res);
    setStep("result");
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const hitText = (b) => {
    const left = b.hp - DRONE_DAMAGE;
    return left > 0
      ? `Дрон влучив у бізнес: −${DRONE_DAMAGE} ХП. Лишилось ${left}/${BIZ_MAX_HP} ХП.`
      : `Дрон влучив у бізнес: −${DRONE_DAMAGE} ХП. Бізнес зруйновано!`;
  };

  /* --- Розміщення бізнесу / ППО --- */
  const place = (p) => {
    if (p.ownerId !== myId) {
      setNote({ ok: false, text: "Можна лише на території своєї країни" });
      return;
    }
    const cur = dataRef.current;
    const key = action === "business" ? "biz" : "aa";
    if (cur[key].length >= MAX_OBJECTS) {
      setNote({ ok: false, text: `Ліміт: не більше ${MAX_OBJECTS}` });
      return;
    }
    const item = action === "business" ? { id: uid(), lng: p.lng, lat: p.lat, hp: BIZ_MAX_HP } : { id: uid(), lng: p.lng, lat: p.lat };
    onChange({ ...cur, [key]: [...cur[key], item] });
    setNote({
      ok: true,
      text: action === "business" ? `✓ Бізнес створено (${BIZ_MAX_HP}/${BIZ_MAX_HP} ХП)` : `✓ ППО встановлено (радіус ${AA_RADIUS_KM} км)`,
    });
  };

  /* --- Дрон: маршрут з 3 точок --- */
  const pickRoute = (p) => {
    if (pts.length >= 3) return;
    if (pts.length === 2) {
      const snap = Math.max(40, 22 * p.pxKm);
      let best = null;
      for (const b of dataRef.current.biz) {
        const d = distKm(b, p);
        if (d <= snap && (!best || d < best.d)) best = { b, d };
      }
      if (!best) {
        setNote({ ok: false, text: "Остання точка має бути на бізнесі: торкнись маркера бізнесу" });
        return;
      }
      setTargetBiz(best.b.id);
      setPts([...pts, { lng: best.b.lng, lat: best.b.lat }]);
      return;
    }
    setPts([...pts, { lng: p.lng, lat: p.lat }]);
  };

  /* --- Дрон: ручне керування --- */
  const pickManual = (p) => {
    if (step === "launch") {
      if (p.ownerId !== myId) {
        setNote({ ok: false, text: "Запуск можливий лише з території своєї країни" });
        return;
      }
      sim.current = { lng: p.lng, lat: p.lat, tx: null, ty: null, fuel: MANUAL_FUEL_SEC };
      setDrone({ lng: p.lng, lat: p.lat });
      setFuel(MANUAL_FUEL_SEC);
      setStep("fly-manual");
      return;
    }
    if (step === "fly-manual" && sim.current) {
      sim.current.tx = p.lng;
      sim.current.ty = p.lat;
    }
  };

  const onPointPick = (p) => {
    if (action === "drone") {
      if (step === "route") pickRoute(p);
      else if (step === "launch" || step === "fly-manual") pickManual(p);
      return;
    }
    if (step === "pick") place(p);
  };

  /* Політ за маршрутом. */
  useEffect(() => {
    if (step !== "fly-route" || pts.length < 3) return undefined;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distKm(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1] || 1;
    const dur = Math.max(5, Math.min(14, total / 250)) * 1000;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const pos = along(pts, cum, k * total);
      setDrone(pos);
      const aa = dataRef.current.aa.find((a) => distKm(a, pos) <= AA_RADIUS_KM);
      if (aa) {
        finishRef.current({ ok: false, text: "Дрон збито системою ППО. Маршрут не має проходити через зону ППО." });
        return;
      }
      if (k >= 1) {
        const b = dataRef.current.biz.find((x) => x.id === targetBiz);
        if (b) finishRef.current({ ok: true, text: hitText(b) }, b.id);
        else finishRef.current({ ok: false, text: "Ціль уже не існує." });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /* Політ під ручним керуванням: дрон летить до останньої точки, на яку торкнулись. */
  useEffect(() => {
    if (step !== "fly-manual") return undefined;
    let last = performance.now();
    let raf = 0;
    const tick = (now) => {
      const s = sim.current;
      if (!s) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pxKm = mapRef.current?.getPxKm ? mapRef.current.getPxKm() : 5;
      s.fuel -= dt;
      if (s.tx != null) {
        const speed = Math.max(40, Math.min(1800, 70 * pxKm)); // ≈70 пікселів/с незалежно від масштабу
        const dist = distKm(s, { lng: s.tx, lat: s.ty });
        const stepKm = speed * dt;
        if (dist <= stepKm) {
          s.lng = s.tx;
          s.lat = s.ty;
          s.tx = null;
          s.ty = null;
        } else {
          const f = stepKm / dist;
          s.lng += (s.tx - s.lng) * f;
          s.lat += (s.ty - s.lat) * f;
        }
      }
      const pos = { lng: s.lng, lat: s.lat };
      setDrone(pos);
      setFuel(Math.max(0, s.fuel));
      const cur = dataRef.current;
      if (cur.aa.some((a) => distKm(a, pos) <= AA_RADIUS_KM)) {
        finishRef.current({ ok: false, text: "Дрон збито системою ППО." });
        return;
      }
      const hitR = Math.max(30, 12 * pxKm);
      const b = cur.biz.find((x) => distKm(x, pos) <= hitR);
      if (b) {
        finishRef.current({ ok: true, text: hitText(b) }, b.id);
        return;
      }
      if (s.fuel <= 0) {
        finishRef.current({ ok: false, text: "Дрон розбився: закінчилося пальне." });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const restart = () => {
    setResult(null);
    setPts([]);
    setTargetBiz(null);
    setDrone(null);
    setStep(action === "drone" ? "mode" : "pick");
  };

  /* --- Що малювати поверх карти --- */
  const overlay = useMemo(() => {
    const f = [];
    for (const a of data.aa) {
      f.push({ type: "Feature", properties: { kind: "zone", c: AA_COLOR }, geometry: { type: "Polygon", coordinates: [circleRing(a.lng, a.lat, AA_RADIUS_KM)] } });
      f.push(pointF(a, { kind: "aa", c: AA_COLOR, r: 8, t: "ППО" }));
    }
    for (const b of data.biz) f.push(pointF(b, { kind: "biz", c: BIZ_COLOR, r: 9, t: `Бізнес ${b.hp}/${BIZ_MAX_HP}` }));
    if (pts.length >= 2) {
      f.push({ type: "Feature", properties: { kind: "route", c: DRONE_COLOR }, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lng, p.lat]) } });
    }
    pts.forEach((p, i) => f.push(pointF(p, { kind: "wp", c: "#ffffff", r: 5, t: String(i + 1) })));
    if (drone) f.push(pointF(drone, { kind: "drone", c: DRONE_COLOR, r: 8, t: "Дрон" }));
    return { type: "FeatureCollection", features: f };
  }, [data, pts, drone]);

  /* --- Підказка у верхній смузі --- */
  let banner = "";
  if (action === "business") banner = "Торкнись карти на території своєї країни, щоб поставити бізнес";
  else if (action === "aa") banner = "Торкнись карти на території своєї країни, щоб поставити ППО";
  else if (step === "mode") banner = "Обери режим запуску дрона";
  else if (step === "route") banner = pts.length < 2 ? `Маршрут: постав точку ${pts.length + 1} з 3` : pts.length === 2 ? "Маршрут: остання точка має бути на бізнесі" : "Маршрут готовий";
  else if (step === "launch") banner = "Обери точку запуску на території своєї країни";
  else if (step === "fly-manual") banner = "Торкайся карти — дрон летить у цю точку. Влучи в бізнес";
  else if (step === "fly-route") banner = "Дрон летить за маршрутом…";
  else if (step === "result") banner = "Політ завершено";

  const count = action === "business" ? data.biz.length : data.aa.length;

  return (
    <div className="cn-map-screen">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" type="button" onClick={onClose} aria-label="Назад">
          <ArrowLeft size={18} />
        </button>
        <div className="cn-screen-title">{TITLES[action]}</div>
        <div style={{ width: 34 }} />
      </div>

      <div className="cn-map-pick-banner">
        <span>{banner}</span>
        <button type="button" className="cn-dev-btn" onClick={onClose}>
          {step === "pick" ? "Готово" : "Закрити"}
        </button>
      </div>

      <div className="cn-map-viewport-wrap">
        <div className="cn-tmap-viewport">
          <TerritoryMap
            ref={mapRef}
            mode="view"
            owners={nations?.owners || {}}
            countries={nations?.countries || []}
            myCountryId={myId}
            showCities
            cityOwners={nations?.cityOwners}
            lang={lang}
            overlay={overlay}
            onPointPick={onPointPick}
          />
          {note && <div className={"cn-tmap-toast" + (note.ok ? " cn-tw-toast--ok" : "")}>{note.text}</div>}
        </div>
      </div>

      <div className="cn-tw-panel">
        {(action === "business" || action === "aa") && (
          <>
            <div className="cn-tw-line">
              {action === "business" ? "Бізнес" : "ППО"}: <b>{count}/{MAX_OBJECTS}</b>
              {action === "business" ? ` · ${BIZ_MAX_HP} ХП кожен` : ` · радіус дії ${AA_RADIUS_KM} км`}
            </div>
            <div className="cn-dip-sub">Торкайся карти скільки потрібно — кожне торкання ставить один об'єкт. Це тестова механіка.</div>
          </>
        )}

        {action === "drone" && step === "mode" && (
          <>
            {data.biz.length === 0 ? (
              <div className="cn-tw-line">Спершу створи бізнес у розділі «Економіка» — це ціль для дрона.</div>
            ) : (
              <>
                <button className="cn-tw-mode" type="button" onClick={() => { setPts([]); setStep("route"); }}>
                  <span className="cn-tw-mode-ic"><Compass size={22} /></span>
                  <span className="cn-warhud-declare-text">
                    <b>Прокласти маршрут</b>
                    <small>3 точки на карті, остання — на бізнесі. Дрон прилетить сам.</small>
                  </span>
                </button>
                <button className="cn-tw-mode" type="button" onClick={() => setStep("launch")}>
                  <span className="cn-tw-mode-ic"><MousePointerClick size={22} /></span>
                  <span className="cn-warhud-declare-text">
                    <b>Керувати самостійно</b>
                    <small>Запусти дрон зі своєї території й веди його торканням по карті. Пального на {MANUAL_FUEL_SEC} с.</small>
                  </span>
                </button>
              </>
            )}
            <div className="cn-dip-sub">ППО збиває дрон у радіусі {AA_RADIUS_KM} км. Влучання віднімає {DRONE_DAMAGE} ХП бізнесу.</div>
          </>
        )}

        {action === "drone" && step === "route" && (
          <div className="cn-tw-row">
            <div className="cn-tw-line">Точок: <b>{pts.length}/3</b></div>
            <button type="button" className="cn-dev-btn" onClick={() => { setPts([]); setTargetBiz(null); }} disabled={!pts.length}>
              <X size={13} /> Скинути
            </button>
            <button type="button" className="cn-primary-btn cn-tw-go" disabled={pts.length < 3} onClick={() => setStep("fly-route")}>
              <span className="cn-primary-btn-label"><Send size={14} /> Запустити</span>
            </button>
          </div>
        )}

        {action === "drone" && step === "launch" && <div className="cn-tw-line">Торкнись своєї території на карті — звідти стартує дрон.</div>}

        {action === "drone" && step === "fly-manual" && (
          <div className="cn-tw-row">
            <div className="cn-tw-line">Пальне: <b>{Math.ceil(fuel)} с</b></div>
            <button type="button" className="cn-dev-btn cn-dev-btn--danger" onClick={() => finish({ ok: false, text: "Дрон відкликано." })}>
              Відкликати
            </button>
          </div>
        )}

        {step === "result" && result && (
          <>
            <div className={"cn-tw-result " + (result.ok ? "cn-tw-result--ok" : "cn-tw-result--bad")}>{result.text}</div>
            <div className="cn-tw-row">
              <button type="button" className="cn-primary-btn cn-tw-go" onClick={restart}>
                <span className="cn-primary-btn-label">Ще раз</span>
              </button>
              <button type="button" className="cn-dev-btn" onClick={onClose}>Закрити</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
