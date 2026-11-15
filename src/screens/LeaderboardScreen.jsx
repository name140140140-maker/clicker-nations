import LoadingScreen from "../LoadingScreen.jsx";
import { useState, useEffect, useMemo } from "react";
import { User, RefreshCw, Crown, ArrowLeft, Play } from "lucide-react";
import { fmtPopulation, loadCities, cityKey } from "../map/cities";
import { computeNationPops, fmtPop, fmtDelta } from "../population";
import { COUNTRIES, COUNTRY_MAP, Flag, Nick, ProfileIconGlyph, bannerById, cnSfx, countriesRev, fmt, iconById, t } from "../app/shared.jsx";
import { MapReplayModal } from "./MapReplayModal.jsx";



export function LeaderboardScreen({ me, players, loading, onRefresh, onBack, lang = "uk", nations = null }) {
  const [mode, setMode] = useState("countries"); // countries | global | mycountry
  const [metric, setMetric] = useState("power"); // power | cities | pop | members
  const [cityStats, setCityStats] = useState(null); // { [країна]: [міст, населення] }
  const [replayOpen, setReplayOpen] = useState(false);

  /* Міста й населення країн: кожне місто належить власнику міста або власнику своєї області */
  useEffect(() => {
    let off = false;
    loadCities().then((data) => {
      if (off) return;
      const m = {};
      for (const c of data.list) {
        const o = (nations?.cityOwners && nations.cityOwners[cityKey(c)]) || nations?.owners?.[c.rid];
        if (!o) continue;
        const row = m[o] || (m[o] = [0, 0, 0]);
        row[0] += 1;
      }
      setCityStats(m);
      /* Справжнє населення країн (з щоденною зміною) замість суми міст */
      computeNationPops(nations).then((pops) => {
        if (off) return;
        const next = { ...m };
        for (const code of Object.keys(pops)) {
          const row = next[code] ? [...next[code]] : [0, 0, 0];
          row[1] = pops[code][0];
          row[2] = pops[code][1];
          next[code] = row;
        }
        setCityStats(next);
      }).catch(() => {});
    });
    return () => { off = true; };
  }, [nations]);

  const countriesRanked = useMemo(() => {
    const map = {};
    const members = {};
    for (const p of players) {
      map[p.countryCode] = (map[p.countryCode] || 0) + (p.power || 0);
      members[p.countryCode] = (members[p.countryCode] || 0) + 1;
    }
    const keyOf = { power: "power", cities: "cities", pop: "pop", members: "members" }[metric] || "power";
    return COUNTRIES.map((c) => ({
      ...c,
      power: map[c.code] || 0,
      members: members[c.code] || 0,
      cities: cityStats?.[c.code]?.[0] || 0,
      pop: cityStats?.[c.code]?.[1] || 0,
      popDelta: cityStats?.[c.code]?.[2] || 0,
    })).sort((a, b) => b[keyOf] - a[keyOf] || b.power - a.power);
  }, [players, countriesRev, cityStats, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  const globalRanked = useMemo(() => {
    return [...players].sort((a, b) => (b.power || 0) - (a.power || 0));
  }, [players]);

  const countryRanked = useMemo(() => {
    return globalRanked.filter((p) => p.countryCode === me.countryCode);
  }, [globalRanked, me.countryCode]);

  return (
    <div className="cn-lb">
      <div className="cn-lb-header">
        {onBack && (
          <button className="cn-refresh-btn" onClick={onBack} type="button" aria-label="Назад" style={{ marginRight: 8 }}>
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="cn-screen-title" style={{ flex: 1 }}>{t(lang, "nav_leaderboard")}</div>
        <button className="cn-refresh-btn" onClick={onRefresh} type="button" aria-label="Refresh">
          <RefreshCw size={16} className={loading ? "cn-spin" : ""} />
        </button>
      </div>

      <button className="cn-replay-open" type="button" onClick={() => { cnSfx.navSwitch(); setReplayOpen(true); }}>
        <Play size={13} /> Повтор карти: як змінювалися кордони
      </button>
      {replayOpen && <MapReplayModal lang={lang} onClose={() => setReplayOpen(false)} />}

      <div className="cn-segmented">
        <button
          className={"cn-seg-btn" + (mode === "countries" ? " cn-seg-btn--active" : "")}
          onClick={() => setMode("countries")}
        >
          {t(lang, "lb_countries")}
        </button>
        <button
          className={"cn-seg-btn" + (mode === "global" ? " cn-seg-btn--active" : "")}
          onClick={() => setMode("global")}
        >
          {t(lang, "lb_players")}
        </button>
        <button
          className={"cn-seg-btn" + (mode === "mycountry" ? " cn-seg-btn--active" : "")}
          onClick={() => setMode("mycountry")}
        >
          {t(lang, "lb_mycountry")}
        </button>
      </div>

      {loading && players.length === 0 ? (
        <LoadingScreen lang={lang} variant="block" size="sm" title={false} tips={false} stage={t(lang, "lb_loading")} />
      ) : mode === "countries" ? (
        <>
          <div className="cn-metric-chips">
            {[["power", "Армія"], ["cities", "Міста"], ["pop", "Населення"], ["members", "Гравці"]].map(([k, l]) => (
              <button key={k} type="button" className={"cn-metric-chip" + (metric === k ? " cn-metric-chip--on" : "")} onClick={() => setMetric(k)}>{l}</button>
            ))}
          </div>
          <CountryList list={countriesRanked} myCountry={me.countryCode} metric={metric} />
        </>
      ) : mode === "global" ? (
        <PlayerList list={globalRanked} meId={me.id} lang={lang} />
      ) : (
        <PlayerList list={countryRanked} meId={me.id} lang={lang} />
      )}
    </div>
  );
}


function rankClass(rank) {
  if (rank === 1) return " cn-rank--1";
  if (rank === 2) return " cn-rank--2";
  if (rank === 3) return " cn-rank--3";
  return "";
}


function CountryList({ list, myCountry, metric = "power" }) {
  const main = (c) => (metric === "cities" ? fmt(c.cities) : metric === "pop" ? fmtPopulation(c.pop) : metric === "members" ? fmt(c.members) : fmt(c.power));
  return (
    <div className="cn-list cn-list--dense">
      {list.map((c, i) => {
        const rank = i + 1;
        const isMine = c.code === myCountry;
        return (
          <div key={c.code} className={"cn-row cn-row--light" + (isMine ? " cn-row--mine" : "")}>
            <span className={"cn-row-rank" + rankClass(rank)}>{rank}</span>
            <Flag code={c.code} size={20} className="cn-row-flag" />
            <span className="cn-row-name">
              {c.name}
              <span className="cn-row-sub">міст {fmt(c.cities)} · нас. {c.pop ? fmtPop(c.pop) : "—"}{c.pop ? ` (${fmtDelta(c.popDelta)}/добу)` : ""} · армія {fmt(c.power)} · гравців {fmt(c.members)}</span>
            </span>
            <span className="cn-row-value">{main(c)}</span>
          </div>
        );
      })}
    </div>
  );
}


function LbAvatar({ player }) {
  const icon = iconById(player.equippedIcon);
  const premium = !!player.hasPremiumPass;
  return (
    <span className={"cn-lb-avatar" + (premium ? " cn-lb-avatar--premium" : "")}>
      <span className="cn-lb-avatar-inner">
        {icon ? <ProfileIconGlyph opt={icon} size={30} /> : <User size={16} />}
      </span>
      {premium && <Crown size={11} className="cn-lb-avatar-crown" />}
    </span>
  );
}


function PlayerRow({ p, rank, isMine, country }) {
  const banner = bannerById(p.equippedBanner);
  return (
    <div
      className={
        "cn-row cn-row--player" +
        (isMine ? " cn-row--mine" : "") +
        (p.hasPremiumPass ? " cn-row--premium" : "") +
        (banner ? " cn-row--banner" : "")
      }
      style={
        banner
          ? { backgroundImage: `linear-gradient(180deg, rgba(6,10,18,0) 40%, rgba(6,10,18,0.88) 100%), url(${banner.img})` }
          : undefined
      }
    >
      <span className={"cn-row-rank" + rankClass(rank)}>{rank}</span>
      <LbAvatar player={p} />
      <Flag code={country?.code} size={16} className="cn-row-flag" />
      <span className="cn-row-name"><Nick p={p} /></span>
      <span className="cn-row-value">{fmt(p.power)}</span>
    </div>
  );
}


function PlayerList({ list, meId, lang = "uk" }) {
  const TOP_N = 30;
  const myIndex = list.findIndex((p) => p.id === meId);
  const top = list.slice(0, TOP_N);
  const meInTop = myIndex >= 0 && myIndex < TOP_N;
  const mePlayer = myIndex >= 0 ? list[myIndex] : null;

  if (list.length === 0) {
    return <div className="cn-lb-empty">{t(lang, "lb_empty")}</div>;
  }

  return (
    <div className="cn-list">
      {top.map((p, i) => {
        const rank = i + 1;
        const isMine = p.id === meId;
        const country = COUNTRY_MAP[p.countryCode];
        return <PlayerRow key={p.id} p={p} rank={rank} isMine={isMine} country={country} />;
      })}
      {!meInTop && mePlayer && (
        <>
          <div className="cn-row-divider">•••</div>
          <PlayerRow
            p={mePlayer}
            rank={myIndex + 1}
            isMine
            country={COUNTRY_MAP[mePlayer.countryCode]}
          />
        </>
      )}
    </div>
  );
}
