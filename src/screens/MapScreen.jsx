import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { X, ChevronDown, Search, Swords, ShieldCheck, Compass, ChevronRight } from "lucide-react";
import TerritoryMap, { GLOBE_SUPPORTED } from "../TerritoryMap";
import { fmtPopulation, loadCities, cityKey } from "../map/cities";
import { activeFor } from "../worldEvents";
import { worldOp } from "../powerApi";
import { onPandemicChange } from "../pandemic";
import { virusByCountry, worldVirus, fmtBig, fmtPct, virusColor, VIRUS_SCALE, VIRUS_HEALTHY } from "../virusStats";
import { computeNationPops, fmtPop, fmtDelta } from "../population";
import { COUNTRIES, COUNTRY_MAP, Flag, MapLegend, cnSfx, dipRelation, fmt, fmtDuration, getLeader, isSuperAdmin, loadActiveWars, t, visibleInterval, warPhase, worldPaid } from "../app/shared.jsx";
import { setTick, clearTick } from "../core/ticker.js";

 // Power за оголошення війни
const FREE_CAPTURE_COST = 5000;


/* Легенда режиму «Вірус»: перемикач метрики, шкала кольорів, підсумок активних пандемій */
function VirusLegend({ metric, onMetric, world }) {
  const sc = VIRUS_SCALE[metric === "dead" ? "dead" : "sick"];
  return (
    <div className="cn-virus-legend">
      <div className="cn-virus-chips">
        <button type="button" className={"cn-metric-chip" + (metric === "sick" ? " cn-metric-chip--on" : "")} onClick={() => onMetric("sick")}>Хворі</button>
        <button type="button" className={"cn-metric-chip" + (metric === "dead" ? " cn-metric-chip--on" : "")} onClick={() => onMetric("dead")}>Померлі</button>
      </div>
      {world.length === 0 ? (
        <div className="cn-virus-line">Пандемій зараз немає, світ здоровий</div>
      ) : (
        world.map((w) => (
          <div key={w.e.id} className="cn-virus-line">
            🦠 <b>{w.disease}</b> · країн {w.countries} · хворі ≈ {fmtBig(w.ill)} · померло ≈ {fmtBig(w.dead)}
          </div>
        ))
      )}
      <div className="cn-virus-scale">
        <span className="cn-virus-sw" style={{ background: VIRUS_HEALTHY }} />нема
        {sc.map(([th, col, label]) => (
          <span key={label} className="cn-virus-sw-wrap"><span className="cn-virus-sw" style={{ background: col }} />{label}</span>
        ))}
      </div>
    </div>
  );
}


/* Адмін: редактор власників на карті. Передає місто чи всю область країні або повертає початкового власника. */
function AdminMapEditor({ city = null, rid, regionName, onDone }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const list = useMemo(() => [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, "uk")), []);
  if (!isSuperAdmin()) return null;

  const cityOf = async () => {
    const data = await loadCities();
    return data.byRid.get(rid) || [];
  };
  const run = async (fn, okText) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setMsg("✓ " + okText);
      if (onDone) await onDone();
    } catch (e) {
      setMsg("✗ " + (e?.message || "Помилка"));
    }
    setBusy(false);
  };
  const mapOp = async (action, extra = {}) => {
    const r = await worldOp("admin-map", { action, rid, name: regionName, ...extra });
    if (!r.ok) throw new Error(r.reason);
  };
  const giveCity = (owner) => run(() => mapOp("giveCity", { owner, cityKey: cityKey(city) }), "Місто передано: " + (COUNTRY_MAP[owner]?.name || owner));
  const giveRegion = (owner) => run(() => mapOp("giveRegion", { owner }), "Область передано: " + (COUNTRY_MAP[owner]?.name || owner));
  const resetCity = () => run(() => mapOp("resetCity", { cityKey: cityKey(city) }), "Місто повернуто початковому власнику");
  const resetRegion = () => run(() => mapOp("resetRegion"), "Область повернуто початковому власнику");

  return (
    <div className="cn-adm cn-adm-map">
      <button className="cn-adm-head" type="button" onClick={() => { cnSfx.toggle(); setOpen((o) => !o); }}>
        <ShieldCheck size={13} /> <span>Адмін: змінити власника</span>
        <ChevronDown size={14} className={"cn-chevron" + (open ? " cn-chevron--open" : "")} />
      </button>
      {open && (
        <div className="cn-adm-body" style={{ border: "1px solid rgba(var(--cn-accent-rgb),0.25)", borderRadius: 9 }}>
          <select className="cn-adm-in" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">Обери країну…</option>
            {list.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <div className="cn-adm-btns">
            {city && <button className="cn-adm-btn" type="button" disabled={busy || !code} onClick={() => giveCity(code)}>Передати місто</button>}
            <button className="cn-adm-btn" type="button" disabled={busy || !code} onClick={() => giveRegion(code)}>Передати область{regionName ? "" : ""}</button>
          </div>
          <div className="cn-adm-btns">
            {city && <button className="cn-adm-btn" type="button" disabled={busy} onClick={resetCity}>Місто: як було</button>}
            <button className="cn-adm-btn" type="button" disabled={busy} onClick={resetRegion}>Область: як було</button>
          </div>
          {msg && <div className="cn-adm-msg">{msg}</div>}
          <div className="cn-adm-hint">«Передати область» переписує й усі міста області. «Як було» повертає початкового власника зі стартової карти.</div>
        </div>
      )}
    </div>
  );
}


export function MapScreen({ players, me, loading, onRefresh, nations, lang = "uk", pick = null, dip = null, isLeader = false, onUpdatePlayer = null }) {
  const [selected, setSelected] = useState(null); // { rid, name, ownerId }
  const [selectedCity, setSelectedCity] = useState(null); // { city, regionName, ownerId }
  const [leaderName, setLeaderName] = useState(null); // undefined = завантаження
  const mapRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState([]);
  const [wars, setWars] = useState([]);
  const [warsOpen, setWarsOpen] = useState(false);
  const [, setWarTick] = useState(0);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMsg, setClaimMsg] = useState(null); // { ok, text }
  const [globe, setGlobe] = useState(() => {
    try { return GLOBE_SUPPORTED && localStorage.getItem("cn_map_globe") === "1"; } catch { return false; }
  });
  const toggleGlobe = () => {
    cnSfx.toggle();
    setGlobe((g) => {
      const next = !g;
      try { localStorage.setItem("cn_map_globe", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  useEffect(() => { setClaimMsg(null); }, [selected?.rid]);

  /* Режими карти: плоска/глобус та шар «Вірус» (колір країн за захворюваністю або летальністю) */
  const [virusMode, setVirusMode] = useState(() => {
    try { return localStorage.getItem("cn_map_virus") === "1"; } catch { return false; }
  });
  const [virusMetric, setVirusMetric] = useState("sick"); // "sick" | "dead"
  const [modeMenu, setModeMenu] = useState(false);
  const [virusTick, setVirusTick] = useState(0);
  useEffect(() => onPandemicChange(() => setVirusTick((x) => x + 1)), []);
  useEffect(() => {
    const id = setTick(() => setVirusTick((x) => x + 1), 5 * 60000);
    return () => clearTick(id);
  }, []);
  const setVirus = (on) => {
    cnSfx.toggle();
    setVirusMode(on);
    try { localStorage.setItem("cn_map_virus", on ? "1" : "0"); } catch { /* ignore */ }
  };
  const virusShown = virusMode || !!pick?.virus; // при виборі країни для закриття кордону вірус показуємо завжди
  const virusNow = useMemo(() => {
    const now = Date.now();
    return { byCountry: virusByCountry(now), world: worldVirus(now) };
  }, [virusTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseCountries = nations?.countries || [];
  /* У режимі вірусу колір кожної країни замінюється кольором шкали (хворі/померлі) */
  const countries = useMemo(
    () => (virusShown ? baseCountries.map((c) => ({ ...c, color: virusColor(virusNow.byCountry[c.id], virusMetric) })) : baseCountries),
    [virusShown, virusMetric, virusNow, baseCountries]
  );
  const owners = nations?.owners || {};
  const myCountry = COUNTRY_MAP[me?.countryCode];
  const [citiesData, setCitiesData] = useState(null);
  useEffect(() => { let off = false; loadCities().then((d) => { if (!off) setCitiesData(d); }).catch(() => {}); return () => { off = true; }; }, []);
  /* Справжнє населення країн із щоденною зміною */
  const [natPops, setNatPops] = useState({});
  useEffect(() => {
    let off = false;
    computeNationPops(nations).then((p) => { if (!off) setNatPops(p); }).catch(() => {});
    return () => { off = true; };
  }, [nations]);
  /* Скільки міст зараз контролює кожна країна (захоплені міста мають власний запис) */
  const cityCounts = useMemo(() => {
    const out = {};
    if (!citiesData) return out;
    const co = nations?.cityOwners || {};
    for (const c of citiesData.list) {
      const o = co[cityKey(c)] || owners[c.rid];
      if (o) out[o] = (out[o] || 0) + 1;
    }
    return out;
  }, [citiesData, owners, nations?.cityOwners]);

  /* Активні конфлікти: завантажуємо при вході, при оновленні та раз на хвилину */
  const loadWars = useCallback(async () => {
    try {
      const list = await loadActiveWars();
      setWars(list.filter((w) => warPhase(w) !== "finish").sort((a, b) => a.createdAt - b.createdAt));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    loadWars();
    const iv = visibleInterval(loadWars, 60000);
    const tk = setTick(() => setWarTick((n) => n + 1), 15000);
    return () => {
      clearTick(iv);
      clearTick(tk);
    };
  }, [loadWars]);

  const runSearch = (q) => {
    setSearchQ(q);
    setSearchRes(mapRef.current ? mapRef.current.search(q, lang) : []);
  };
  const pickResult = (item) => {
    cnSfx.navSwitch();
    setSearchOpen(false);
    setSearchQ("");
    setSearchRes([]);
    if (mapRef.current) mapRef.current.goTo(item);
  };
  const flyToWar = async (w) => {
    try {
      const data = await loadCities();
      const c = data.list[w.cityId] || data.list.find((x) => cityKey(x) === w.cityKey);
      if (c && mapRef.current) mapRef.current.flyTo(c.x, c.y, 6.5);
    } catch {
      /* ignore */
    }
  };

  const stats = useMemo(() => {
    const power = {};
    const count = {};
    for (const p of players || []) {
      power[p.countryCode] = (power[p.countryCode] || 0) + (p.power || 0);
      count[p.countryCode] = (count[p.countryCode] || 0) + 1;
    }
    const ranked = countries
      .map((c) => ({ id: c.id, power: power[c.id] || 0 }))
      .sort((a, b) => b.power - a.power)
      .map((c, i) => [c.id, i + 1]);
    return { power, count, rank: Object.fromEntries(ranked) };
  }, [players, countries]);

  const selectedCountry = selected?.ownerId ? COUNTRY_MAP[selected.ownerId] : null;
  const kind = !selected ? null : !selected.ownerId ? "free" : selected.ownerId === me?.countryCode ? "own" : "occupied";
  const cityName = (c) => (lang === "uk" && c.u ? c.u : c.n);

  useEffect(() => {
    if (!selectedCountry) {
      setLeaderName(null);
      return;
    }
    let cancelled = false;
    setLeaderName(undefined);
    (async () => {
      const leaderId = selectedCountry.leaderId || (await getLeader(selectedCountry.id));
      if (cancelled) return;
      const p = (players || []).find((pl) => pl.id === leaderId);
      setLeaderName(p ? p.username : leaderId ? "Гравець" : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCountry?.id, players]); // eslint-disable-line react-hooks/exhaustive-deps

  const relTag = (() => {
    if (!dip || !selectedCountry || kind !== "occupied") return null;
    const r = dipRelation(dip, me.countryCode, selectedCountry.id);
    if (r.ally) return { text: "Союзник", cls: "ally" };
    if (r.pact) return { text: "Пакт про ненапад", cls: "pact" };
    if (r.truceUntil) return { text: "Заборона нападу " + fmtDuration(r.truceUntil - Date.now()), cls: "truce" };
    return null;
  })();
  const cityPickBtn =
    pick && pick.step === "city" && selectedCity && selected?.ownerId === pick.country ? (
      <button
        className="cn-primary-btn cn-map-pick-btn"
        type="button"
        onClick={() => pick.onPickCity({ id: selectedCity.city.i, name: cityName(selectedCity.city), rid: selectedCity.city.rid, key: cityKey(selectedCity.city) })}
      >
        <span className="cn-primary-btn-label">{pick.cityBtn ? pick.cityBtn(cityName(selectedCity.city)) : `⚔️ Напасти на ${cityName(selectedCity.city)}`}</span>
      </button>
    ) : pick && pick.step === "city" ? (
      <div className="cn-map-card-sub" style={{ marginTop: 8 }}>
        {pick.hint || `Обери місто країни «${COUNTRY_MAP[pick.country]?.name}»`}
      </div>
    ) : null;
  const pickBtn =
    pick && pick.step === "city" ? null : pick && selectedCountry && kind === "occupied" ? (
      <button className="cn-primary-btn cn-map-pick-btn" type="button" onClick={() => pick.onPick(selectedCountry.id)}>
        <span className="cn-primary-btn-label">Обрати: {selectedCountry.name}</span>
      </button>
    ) : pick && selected ? (
      <div className="cn-map-card-sub" style={{ marginTop: 8 }}>
        {kind === "own" ? "Це твоя країна" : "Обери територію іншої країни"}
      </div>
    ) : null;

  /* Захоплення вільної області: лише лідер, за Power, з паузою між захопленнями. */
  const claimFree = async (sel) => {
    if (!sel || claimBusy || !me) return;
    setClaimMsg(null);
    if (!isLeader) { cnSfx.error(); setClaimMsg({ ok: false, text: "Захоплювати території може лише лідер країни" }); return; }
    if ((me.power || 0) < FREE_CAPTURE_COST) { cnSfx.error(); setClaimMsg({ ok: false, text: `Потрібно ${fmt(FREE_CAPTURE_COST)} Power` }); return; }
    setClaimBusy(true);
    try {
      const cr = await worldPaid("capture", { rid: sel.rid, name: sel.name }, onUpdatePlayer);
      if (!cr.ok) { cnSfx.error(); setClaimMsg({ ok: false, text: cr.reason }); onRefresh && onRefresh(); setClaimBusy(false); return; }
      cnSfx.purchase();
      setClaimMsg({ ok: true, text: `✓ Область «${sel.name}» тепер належить твоїй країні` });
      onRefresh && onRefresh();
    } catch (e) {
      cnSfx.error();
      setClaimMsg({ ok: false, text: "Не вдалося захопити область. Спробуй ще раз" });
    }
    setClaimBusy(false);
  };
  const claimBtn = (sel) =>
    !pick && me && kind === "free" && sel ? (
      <>
        <button className="cn-primary-btn cn-map-pick-btn" type="button" disabled={claimBusy} onClick={() => claimFree(sel)}>
          <span className="cn-primary-btn-label">🚩 Захопити область · {fmt(FREE_CAPTURE_COST)} Power</span>
        </button>
        {claimMsg && <div className={"cn-color-msg" + (claimMsg.ok ? " cn-color-msg--ok" : " cn-color-msg--err")} style={{ marginTop: 8 }}>{claimMsg.text}</div>}
      </>
    ) : null;

  const goToMine = () => {
    const rid = Object.keys(owners).find((r) => owners[r] === me?.countryCode);
    if (rid && mapRef.current) mapRef.current.flyToRid(rid);
  };

  return (
    <div className="cn-map-screen">
      <div className="cn-map-viewport-wrap">
        <div className="cn-map-top">
          {searchOpen ? (
            <div className="cn-map-search">
              <div className="cn-map-search-box">
                <Search size={15} />
                <input
                  autoFocus
                  type="text"
                  value={searchQ}
                  placeholder="Місто, область, країна, море…"
                  onChange={(e) => runSearch(e.target.value)}
                />
                <button type="button" aria-label="Закрити пошук" onClick={() => { setSearchOpen(false); setSearchQ(""); setSearchRes([]); }}>
                  <X size={15} />
                </button>
              </div>
              {searchQ.trim().length >= 2 && (
                <div className="cn-map-search-list">
                  {searchRes.length === 0 && <div className="cn-map-search-empty">Нічого не знайдено</div>}
                  {searchRes.map((r, i) => (
                    <button type="button" key={r.kind + i + r.label} className="cn-map-search-item" onClick={() => pickResult(r)}>
                      <b>{r.label}</b>
                      <small>{r.sub}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : pick ? (
            <div className="cn-map-pick-banner">
              <span>{pick.label}</span>
              <button type="button" className="cn-dev-btn" onClick={pick.onCancel}>Скасувати</button>
            </div>
          ) : (
            <>
              <div className="cn-map-title">{t(lang, "nav_map")}</div>
              <div className="cn-map-sub">{t(lang, "nn_map_hint")}</div>
            </>
          )}
        </div>
        {modeMenu && (
          <div className="cn-mode-menu" onClick={(e) => e.stopPropagation()}>
            <div className="cn-mode-head">Вигляд</div>
            <button type="button" className={"cn-mode-opt" + (!globe ? " on" : "")} onClick={() => { if (globe) toggleGlobe(); setModeMenu(false); }}>Звичайна карта</button>
            {GLOBE_SUPPORTED && <button type="button" className={"cn-mode-opt" + (globe ? " on" : "")} onClick={() => { if (!globe) toggleGlobe(); setModeMenu(false); }}>Глобус</button>}
            <div className="cn-mode-head">Шар</div>
            <button type="button" className={"cn-mode-opt" + (!virusMode ? " on" : "")} onClick={() => { setVirus(false); setModeMenu(false); }}>Країни</button>
            <button type="button" className={"cn-mode-opt" + (virusMode ? " on" : "")} onClick={() => { setVirus(true); setModeMenu(false); }}>Вірус: хворі й померлі</button>
          </div>
        )}
        <div className="cn-tmap-viewport">
          <TerritoryMap
            ref={mapRef}
            mode="view"
            owners={owners}
            countries={countries}
            myCountryId={me?.countryCode}
            selectedRid={selected?.countryLevel ? null : selected?.rid}
            selectedCountryId={selected?.countryLevel ? selected.ownerId : null}
            projection={globe ? "globe" : "mercator"}
            onSelectRegion={(r) => {
              setSelectedCity(null);
              setSelected((prev) => (prev?.rid === r.rid && prev?.ownerId === r.ownerId ? null : { ...r, countryLevel: !!r.ownerId && (r.zoom ?? 99) < 4.5 }));
            }}
            showCities
            tools={[
              { id: "mode", label: "Режим карти", svg: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>', onClick: () => setModeMenu((v) => !v) },
              { id: "search", label: "Пошук", svg: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', onClick: () => setSearchOpen((v) => !v) },
              { id: "refresh", label: "Оновити", svg: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', onClick: () => { onRefresh(); loadWars(); } },
            ]}
            cityOwners={nations?.cityOwners}
            selectedZoneOwner={selected?.ownerId || null}
            lang={lang}
            selectedCityId={selectedCity ? selectedCity.city.i : null}
            onSelectCity={(sel) => {
              setSelectedCity(sel);
              setSelected({ rid: sel.city.rid, name: sel.regionName, ownerId: sel.ownerId });
            }}
          />
        </div>
        {!selected && (
          <div className="cn-map-bottom">
      <div className="cn-conflicts">
        <button type="button" className="cn-conflicts-head" onClick={() => setWarsOpen((v) => !v)} aria-expanded={warsOpen}>
          <Swords size={15} />
          <span>Активні конфлікти</span>
          <b className={"cn-conflicts-count" + (wars.length ? " cn-conflicts-count--on" : "")}>{wars.length}</b>
          <ChevronRight size={16} className={"cn-conflicts-chev" + (warsOpen ? " cn-conflicts-chev--open" : "")} />
        </button>
        {warsOpen && (
          <div className="cn-conflicts-list">
            {wars.length === 0 && <div className="cn-conflicts-empty">Зараз немає активних війн</div>}
            {wars.map((w) => {
              const ph = warPhase(w);
              const left = ph === "prep" ? w.prepEnd - Date.now() : w.battleEnd - Date.now();
              return (
                <button type="button" key={w.id} className="cn-conflict-row" onClick={() => flyToWar(w)}>
                  <span className="cn-conflict-sides">
                    <Flag code={w.attacker} size={16} /> <span>{COUNTRY_MAP[w.attacker]?.name || w.attacker}</span>
                    <Swords size={12} className="cn-conflict-vs" />
                    <Flag code={w.defender} size={16} /> <span>{COUNTRY_MAP[w.defender]?.name || w.defender}</span>
                  </span>
                  <span className="cn-conflict-meta">
                    за {w.cityName} · {ph === "prep" ? "підготовка" : "битва"} · {fmtDuration(left)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
            <div className="cn-map-bottom-row">
              {virusShown ? <VirusLegend metric={virusMetric} onMetric={setVirusMetric} world={virusNow.world} /> : <MapLegend lang={lang} myColor={myCountry?.color} />}
              <button className="cn-map-mine-pill" type="button" onClick={goToMine}>
                <Compass size={14} /> {t(lang, "nn_goto_mine")}
              </button>
            </div>
          </div>
        )}
        {selectedCity && selected && (
          <div className="cn-map-card cn-map-card--anim cn-city-card" key={"city" + selectedCity.city.i}>
            <button className="cn-map-card-close" onClick={() => { setSelectedCity(null); setSelected(null); }} type="button" aria-label="Закрити">
              <X size={14} />
            </button>
            <div className="cn-map-card-name">
              {cityName(selectedCity.city)}
              {selectedCity.city.cap === 2 && <span className="cn-map-card-tag">{t(lang, "nn_capital")}</span>}
              {selectedCity.city.cap === 1 && <span className="cn-map-card-tag cn-map-card-tag--soft">{t(lang, "nn_regional_center")}</span>}
            </div>
            <div className="cn-city-line">
              {selectedCountry ? (
                <>
                  {t(lang, "nn_controlled_by")}: <Flag code={selectedCountry.id} size={14} className="cn-country-badge--lg" /> <b>{selectedCountry.name}</b>
                </>
              ) : (
                t(lang, "nn_region_free_text")
              )}
            </div>
            <div className="cn-city-line">{t(lang, "nn_region")}: <b>{selected.name}</b></div>
            {!selectedCity.city.f && (
              <div className="cn-city-line">{t(lang, "nn_population")}: <b>{fmtPopulation(selectedCity.city.p)}</b></div>
            )}
            <div className="cn-city-importance">
              <span>{t(lang, "nn_importance")}</span>
              <span className="cn-city-importance-bar"><span style={{ width: selectedCity.city.imp + "%" }} /></span>
              <b>{selectedCity.city.imp}%</b>
            </div>
            {relTag && <div className={"cn-rel-tag cn-rel-tag--" + relTag.cls}>{relTag.text}</div>}
            {pick ? (
              pick.step === "city" ? cityPickBtn : pickBtn
            ) : kind === "free" ? (
              claimBtn(selected)
            ) : (
              <button className="cn-primary-btn cn-city-attack" type="button" disabled>
                <span className="cn-primary-btn-label">{t(lang, "nn_attack_soon")}</span>
              </button>
            )}
            <AdminMapEditor city={selectedCity.city} rid={selected.rid} regionName={selected.name} onDone={onRefresh} />
          </div>
        )}

        {selected && !selectedCity && (
          <div className="cn-map-card cn-map-card--anim" key={selected.rid}>
            <button className="cn-map-card-close" onClick={() => setSelected(null)} type="button" aria-label="Закрити">
              <X size={14} />
            </button>
            {selectedCountry ? (
              <div className="cn-country-head">
                <Flag code={selectedCountry.id} size={46} className="cn-country-badge--lg" />
                <div className="cn-country-head-text">
                  <div className="cn-map-card-name">
                    {selectedCountry.name}
                    {kind === "own" && <span className="cn-map-card-tag">{t(lang, "nn_legend_own")}</span>}
                  </div>
                  <div className="cn-map-card-sub" style={{ margin: 0 }}>
                    {selected.countryLevel ? `${selectedCountry.regionCount || 0} ${t(lang, "nn_regions_count")}` : `${t(lang, "nn_region")}: ${selected.name}`}
                  </div>
                </div>
              </div>
            ) : (
              <div className="cn-map-card-name">{selected.name}</div>
            )}
            {kind === "free" && <div className="cn-map-card-sub">{t(lang, "nn_region_free_text")}</div>}
            {selectedCountry && (
              <>
                <div className="cn-map-card-stats">
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">Country Power</span>
                    <span className="cn-map-card-stat-value">{fmt(stats.power[selectedCountry.id] || 0)}</span>
                  </div>
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">{t(lang, "nn_world_rank")}</span>
                    <span className="cn-map-card-stat-value">#{stats.rank[selectedCountry.id] || "—"}</span>
                  </div>
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">{t(lang, "lb_players")}</span>
                    <span className="cn-map-card-stat-value">{fmt(stats.count[selectedCountry.id] || 0)}</span>
                  </div>
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">{t(lang, "nn_regions_count")}</span>
                    <span className="cn-map-card-stat-value">{fmt(selectedCountry.regionCount || 0)}</span>
                  </div>
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">{t(lang, "nn_population")}</span>
                    <span className="cn-map-card-stat-value">
                      {natPops[selectedCountry.id] ? fmtPop(natPops[selectedCountry.id][0]) : "—"}
                      {natPops[selectedCountry.id] && <small style={{ display: "block", fontSize: 10, fontWeight: 600, color: natPops[selectedCountry.id][1] >= 0 ? "#6fe3a1" : "#ff8a8a" }}>{fmtDelta(natPops[selectedCountry.id][1])} за добу</small>}
                    </span>
                  </div>
                  {virusNow.byCountry[selectedCountry.id] && (
                    <div className="cn-map-card-stat">
                      <span className="cn-map-card-stat-label">Вірус</span>
                      <span className="cn-map-card-stat-value">
                        {fmtPct(virusNow.byCountry[selectedCountry.id].infected)} хворих
                        <small style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#ff9a9a" }}>померло {fmtPct(virusNow.byCountry[selectedCountry.id].deaths)}</small>
                      </span>
                    </div>
                  )}
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">{t(lang, "nn_cities_count")}</span>
                    <span className="cn-map-card-stat-value">{fmt(cityCounts[selectedCountry.id] || 0)}</span>
                  </div>
                  <div className="cn-map-card-stat">
                    <span className="cn-map-card-stat-label">{t(lang, "nn_leader")}</span>
                    <span className="cn-map-card-stat-value cn-map-card-stat-value--leader">
                      {leaderName === undefined ? "…" : leaderName || "—"}
                    </span>
                  </div>
                </div>
                {activeFor(selectedCountry.id).map((e) => (
                  <div key={e.id} className="cn-rel-tag" style={{ background: "rgba(194,139,255,0.14)", color: "#e3d2fa", border: "1px solid rgba(194,139,255,0.4)" }}>{e.meta.emoji} {e.meta.label}: {e.effect}</div>
                ))}
                {relTag && <div className={"cn-rel-tag cn-rel-tag--" + relTag.cls}>{relTag.text}</div>}
              </>
            )}
            {pick && pick.step === "city" ? cityPickBtn : pickBtn}
            {claimBtn(selected)}
            <AdminMapEditor rid={selected.rid} regionName={selected.name} onDone={onRefresh} />
          </div>
        )}
      </div>
    </div>
  );
}
