import { useState } from "react";
import { Users, Lock, Ban, Handshake, ShieldCheck, ArrowLeft } from "lucide-react";
import { COUNTRY_MAP, Flag, cnSfx, fmtDuration } from "../app/shared.jsx";



/* Дипломатія (лише лідер): союзи та пакти про ненапад */
export function DiplomacyPanel({ me, dip, msg, onStartPick, onBreak, onOpenBorder }) {
  const [sub, setSub] = useState(null); // null | "allies" | "pacts" | "borders"
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const mine = me.countryCode;

  const others = (list) =>
    (list || [])
      .filter((x) => x.a === mine || x.b === mine)
      .map((x) => (x.a === mine ? x.b : x.a))
      .filter((c) => COUNTRY_MAP[c]);

  const doBreak = async (kind, other) => {
    const id = kind + other;
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setBusy(true);
    await onBreak(kind, other);
    setConfirmId(null);
    setBusy(false);
  };

  const truces = Object.entries(dip?.truces || {})
    .filter(([id, until]) => until > Date.now() && id.split("~").includes(mine))
    .map(([id, until]) => ({ other: id.split("~").find((c) => c !== mine), until }))
    .filter((x) => COUNTRY_MAP[x.other]);

  const renderList = (kind) => {
    const list = others(kind === "ally" ? dip?.allies : dip?.pacts);
    return (
      <div className="cn-dip-list">
        {!dip && <div className="cn-lb-empty">Завантаження…</div>}
        {dip && list.length === 0 && (
          <div className="cn-lb-empty">{kind === "ally" ? "Союзників поки немає" : "Підписаних пактів поки немає"}</div>
        )}
        {list.map((c) => (
          <div className="cn-dip-row" key={c}>
            <Flag code={c} size={22} className="cn-country-badge--lg" />
            <div className="cn-dip-row-name">{COUNTRY_MAP[c].name}</div>
            <button
              className={"cn-dev-btn cn-dev-btn--danger" + (confirmId === kind + c ? " cn-dev-btn--confirm" : "")}
              type="button"
              disabled={busy}
              onClick={() => doBreak(kind, c)}
            >
              {confirmId === kind + c ? "Підтвердити" : "Розірвати"}
            </button>
          </div>
        ))}
        {list.length > 0 && <div className="cn-dip-sub">Після розриву нападати на цю країну заборонено ще 4 години.</div>}
      </div>
    );
  };

  const myBorders = (dip?.borders || []).filter((b) => (b.a === mine || b.b === mine) && b.hist?.length && !b.hist[b.hist.length - 1][1]);
  if (sub === "borders") {
    return (
      <div className="cn-dip-menu">
        <button className="cn-dev-btn" type="button" onClick={() => { setSub(null); setConfirmId(null); }} style={{ alignSelf: "flex-start" }}>
          <ArrowLeft size={13} /> Закриті кордони
        </button>
        {msg && <div className="cn-dev-status-msg">{msg}</div>}
        <div className="cn-dip-list">
          {!dip && <div className="cn-lb-empty">Завантаження…</div>}
          {dip && myBorders.length === 0 && <div className="cn-lb-empty">Закритих кордонів немає</div>}
          {myBorders.map((b) => {
            const other = b.a === mine ? b.b : b.a;
            const byMe = b.by === mine;
            return (
              <div className="cn-dip-row" key={other}>
                <Flag code={other} size={22} className="cn-country-badge--lg" />
                <div className="cn-dip-row-name">{COUNTRY_MAP[other]?.name || other}</div>
                {byMe ? (
                  <button type="button" className="cn-dev-btn" disabled={busy} onClick={async () => { setBusy(true); await onOpenBorder(other); setBusy(false); }}>Відкрити</button>
                ) : (
                  <span className="cn-dip-sub">закрила вона</span>
                )}
              </div>
            );
          })}
          {myBorders.length > 0 && <div className="cn-dip-sub">Закритий кордон зупиняє вірус між вашими країнами в обидва боки. Країну, яку вже заразили, це не лікує.</div>}
        </div>
      </div>
    );
  }
  if (sub) {
    return (
      <div className="cn-dip-menu">
        <button className="cn-dev-btn" type="button" onClick={() => { setSub(null); setConfirmId(null); }} style={{ alignSelf: "flex-start" }}>
          <ArrowLeft size={13} /> {sub === "allies" ? "Список союзників" : "Договори"}
        </button>
        {msg && <div className="cn-dev-status-msg">{msg}</div>}
        {renderList(sub === "allies" ? "ally" : "pact")}
      </div>
    );
  }

  const items = [
    { id: "allies", label: "Список союзників", Icon: Users, run: () => setSub("allies") },
    { id: "pacts", label: "Договори", Icon: ShieldCheck, run: () => setSub("pacts") },
    { id: "ally", label: "Підписати союз", Icon: Handshake, run: () => onStartPick("ally") },
    { id: "pact", label: "Підписати пакт про ненапад", Icon: Ban, run: () => onStartPick("pact") },
    { id: "border", label: "Закрити кордон (від епідемій)", Icon: Lock, run: () => onStartPick("border") },
    { id: "borders", label: `Закриті кордони${myBorders.length ? " · " + myBorders.length : ""}`, Icon: ShieldCheck, run: () => setSub("borders") },
  ];
  return (
    <div className="cn-dip-menu">
      {msg && <div className="cn-dev-status-msg">{msg}</div>}
      {items.map((it) => (
        <button key={it.id} type="button" className="cn-hq-tile" onClick={() => { cnSfx.navSwitch(); it.run(); }}>
          <span className="cn-hq-tile-icon"><it.Icon size={21} /></span>
          <span className="cn-hq-tile-label">{it.label}</span>
        </button>
      ))}
      {truces.length > 0 && (
        <div className="cn-dip-list">
          <div className="cn-dip-sub">Заборона нападу після розриву:</div>
          {truces.map((x) => (
            <div className="cn-dip-row" key={x.other}>
              <Flag code={x.other} size={22} className="cn-country-badge--lg" />
              <div className="cn-dip-row-name">{COUNTRY_MAP[x.other].name}</div>
              <span className="cn-dip-sub">ще {fmtDuration(x.until - Date.now())}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
