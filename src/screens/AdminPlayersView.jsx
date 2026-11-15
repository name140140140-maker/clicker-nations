import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { powerAdminSet, adminPlayerOp, progressOp, stateOp } from "../powerApi";
import { COUNTRY_MAP, Flag, PINFO_PREFIX, PLAYER_PREFIX, PSEEN_PREFIX, cnSfx, fmt, getJSON, setJSON, storageGet, storageSet, timeAgo } from "../app/shared.jsx";


/* Лист від адміністрації: приходить гравцеві в Пошту у розділ «Від адміністрації» */
async function sendAdminMail(playerId, subject, body) {
  return stateOp("mail-admin", { playerIds: [playerId], subject, body });
}

const PALOG_PREFIX = "palog:";


async function adminLogAction(playerId, text) {
  const list = await getJSON(PALOG_PREFIX + playerId, true, []);
  list.push({ ts: Date.now(), type: "admin", text });
  await setJSON(PALOG_PREFIX + playerId, list.slice(-100), true);
}


function fmtDateTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(ts);
  }
}


/* ------------------------------------------------------------------ */
/*  Settings (Theme + Developer/Test panel)                             */
/* ------------------------------------------------------------------ */

/* Адмін: окремий екран зі списком гравців і докладною карткою гравця */
export function AdminPlayersView({ players, me, onSetPlayer, onRefreshGameData, onBack }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const [selId, setSelId] = useState(null);
  const [info, setInfo] = useState(undefined); // undefined — вантажиться, null — даних немає
  const [seen, setSeen] = useState(0);
  const [adminLog, setAdminLog] = useState([]);
  const [logLimit, setLogLimit] = useState(20);
  const [editOpen, setEditOpen] = useState(false);
  const [power, setPower] = useState("");
  const [pts, setPts] = useState("");
  const [clicks, setClicks] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [mSubj, setMSubj] = useState("");
  const [mBody, setMBody] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...(players || [])].sort((a, b) => (b.power || 0) - (a.power || 0));
    if (!q) return all;
    return all.filter(
      (p) =>
        (p.username || "").toLowerCase().includes(q) ||
        String(p.id).toLowerCase().includes(q) ||
        String(p.telegramId || "").includes(q) ||
        (COUNTRY_MAP[p.countryCode]?.name || "").toLowerCase().includes(q)
    );
  }, [players, query]);

  const sel = selId ? (players || []).find((p) => p.id === selId) : null;

  useEffect(() => {
    if (!selId) return undefined;
    let cancelled = false;
    setInfo(undefined);
    setSeen(0);
    setAdminLog([]);
    setLogLimit(20);
    setEditOpen(false);
    setMsg("");
    (async () => {
      const [i, sn, al] = await Promise.all([
        getJSON(PINFO_PREFIX + selId, true, null),
        storageGet(PSEEN_PREFIX + selId, true),
        getJSON(PALOG_PREFIX + selId, true, []),
      ]);
      if (cancelled) return;
      setInfo(i);
      setSeen(Number(sn) || 0);
      setAdminLog(al || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [selId]);

  const saveEdit = async () => {
    if (!sel) return;
    setBusy(true);
    const np = Math.max(0, Math.round(Number(power) || 0));
    const nc = Math.max(0, Math.round(Number(clicks) || 0));
    const npt = Math.max(0, Math.round(Number(pts) || 0));
    const updated = { ...sel, power: np, points: npt, totalClicks: nc };
    const ptRes = await progressOp("admin-set", { playerId: sel.id, points: npt }); // Points змінює сервер
    if (!ptRes.ok) { setMsg("✗ Points не змінено: " + ptRes.reason); setBusy(false); return; }
    await storageSet(PLAYER_PREFIX + sel.id, JSON.stringify(updated), true);
    const pwRes = await powerAdminSet(sel.id, np, false, nc); // Power і кліки змінює сервер
    if (!pwRes.ok && !pwRes.offline) { setMsg("✗ Power не змінено: " + pwRes.reason); setBusy(false); return; }
    await adminLogAction(sel.id, `Адмін змінив Power ${fmt(sel.power || 0)} → ${fmt(np)}, Points ${fmt(sel.points || 0)} → ${fmt(npt)}, кліки ${fmt(sel.totalClicks || 0)} → ${fmt(nc)}`);
    if (me.id === sel.id && onSetPlayer) onSetPlayer(updated);
    setMsg("✓ Збережено");
    setEditOpen(false);
    setAdminLog(await getJSON(PALOG_PREFIX + sel.id, true, []));
    if (onRefreshGameData) await onRefreshGameData();
    setBusy(false);
  };

  const toggleBlock = async () => {
    if (!sel) return;
    setBusy(true);
    const blocked = !sel.blocked;
    const opr = await adminPlayerOp(sel.id, "block", blocked, reason);
    if (!opr.ok) { setMsg("✗ " + opr.reason); setBusy(false); return; }
    const updated = opr.record;
    await adminLogAction(sel.id, blocked ? `Адмін заблокував гравця: ${updated.blockedReason}` : "Адмін розблокував гравця");
    if (me.id === sel.id && onSetPlayer) onSetPlayer(updated);
    setMsg(blocked ? "⛔ Гравця заблоковано" : "✓ Гравця розблоковано");
    setAdminLog(await getJSON(PALOG_PREFIX + sel.id, true, []));
    if (onRefreshGameData) await onRefreshGameData();
    setBusy(false);
  };

  const sendMailToSel = async () => {
    if (!sel || !mBody.trim()) return;
    setBusy(true);
    try {
      await sendAdminMail(sel.id, mSubj.trim() || "Повідомлення від адміністрації", mBody.trim());
      await adminLogAction(sel.id, "Адмін надіслав лист: " + (mSubj.trim() || mBody.trim()).slice(0, 60));
      setMSubj("");
      setMBody("");
      setMsg("✓ Лист надіслано");
      setAdminLog(await getJSON(PALOG_PREFIX + sel.id, true, []));
    } catch (e) {
      setMsg("Не вдалося надіслати лист");
    }
    setBusy(false);
  };

  const togglePremium = async () => {
    if (!sel) return;
    setBusy(true);
    const has = !sel.hasPremiumPass;
    const opr = await adminPlayerOp(sel.id, "premium", has);
    if (!opr.ok) { setMsg("✗ " + opr.reason); setBusy(false); return; }
    const updated = opr.record;
    await adminLogAction(sel.id, has ? "Адмін видав Premium Pass" : "Адмін забрав Premium Pass");
    if (me.id === sel.id && onSetPlayer) onSetPlayer(updated);
    setMsg(has ? "✓ Premium видано" : "✓ Premium забрано");
    setAdminLog(await getJSON(PALOG_PREFIX + sel.id, true, []));
    if (onRefreshGameData) await onRefreshGameData();
    setBusy(false);
  };

  const Row = ({ label, value }) => (
    <div className="cn-pl-row">
      <span className="cn-pl-label">{label}</span>
      <span className="cn-pl-value">{value === undefined || value === null || value === "" ? "—" : value}</span>
    </div>
  );

  if (sel) {
    const cur = info?.current;
    const country = COUNTRY_MAP[sel.countryCode];
    const lastSeen = Math.max(info?.lastSeen || 0, seen || 0);
    const logs = [...(info?.logs || []), ...adminLog].sort((a, b) => b.ts - a.ts);
    const history = [...(info?.history || [])].reverse();
    return (
      <div className="cn-settings cn-pl">
        <div className="cn-lb-header">
          <button className="cn-icon-btn" onClick={() => setSelId(null)} type="button" aria-label="Назад">
            <ChevronLeft size={18} />
          </button>
          <div className="cn-screen-title">{sel.username || "Гравець"}{sel.blocked ? " ⛔" : ""}</div>
          <div style={{ width: 34 }} />
        </div>
        {msg && <div className="cn-dev-status-msg">{msg}</div>}

        <div className="cn-pl-card">
          <div className="cn-pl-title">Профіль</div>
          <Row label="Ігровий нікнейм" value={sel.username} />
          <Row label="Telegram ID" value={sel.telegramId || info?.tgId} />
          <Row label="Telegram @username" value={info?.tgUsername ? "@" + info.tgUsername : ""} />
          <Row label="Ім'я в Telegram" value={info?.tgName} />
          <Row label="ID в грі" value={sel.id} />
          <Row label="Країна" value={country?.name} />
          <Row label="Power / кліки" value={`${fmt(sel.power || 0)} / ${fmt(sel.totalClicks || 0)}`} />
          <Row label="Premium Pass" value={sel.hasPremiumPass ? "Так" : "Ні"} />
          <Row label="Зареєстрований" value={fmtDateTime(sel.createdAt || info?.firstSeen)} />
          <Row label="Востаннє заходив" value={lastSeen ? `${fmtDateTime(lastSeen)} (${timeAgo(lastSeen)})` : ""} />
          {sel.blocked && <Row label="Блокування" value={sel.blockedReason || "Заблоковано"} />}
        </div>

        <div className="cn-pl-card">
          <div className="cn-pl-title">Поточне підключення</div>
          {info === undefined && <div className="cn-control-empty">Завантаження…</div>}
          {info === null && <div className="cn-control-empty">Даних ще немає: гравець не заходив після оновлення.</div>}
          {cur && (
            <>
              <Row label="IP-адреса" value={cur.ip} />
              <Row label="Провайдер / оператор" value={cur.isp || cur.org} />
              <Row label="Організація" value={cur.org && cur.org !== cur.isp ? cur.org : ""} />
              <Row label="ASN" value={cur.asn} />
              <Row label="Тип підключення" value={cur.type} />
              <Row label="Локація (за IP)" value={[cur.city, cur.region, cur.country].filter(Boolean).join(", ")} />
              <Row label="Пристрій" value={cur.device} />
              <Row label="Клієнт" value={cur.client} />
              <Row label="Екран" value={cur.screen} />
              <Row label="Мова" value={cur.lang} />
              <Row label="Часовий пояс" value={cur.tz} />
              <Row label="User-Agent" value={cur.ua} />
              <Row label="Оновлено" value={fmtDateTime(cur.ts)} />
            </>
          )}
        </div>

        <div className="cn-pl-card">
          <div className="cn-pl-title">Історія IP / пристроїв ({history.length})</div>
          {history.length === 0 && <div className="cn-control-empty">Змін поки немає</div>}
          {history.map((h, i) => (
            <div className="cn-pl-hist" key={h.ts + "_" + i}>
              <div className="cn-pl-hist-time">{fmtDateTime(h.ts)}</div>
              <div>{h.ip || "IP невідомий"} · {h.isp || "провайдер невідомий"}</div>
              <div className="cn-pl-sub">{[h.city, h.country].filter(Boolean).join(", ")} · {h.device} · {h.client}</div>
            </div>
          ))}
        </div>

        <div className="cn-pl-card">
          <div className="cn-pl-title">Логи ({logs.length})</div>
          {logs.length === 0 && <div className="cn-control-empty">Подій поки немає</div>}
          {logs.slice(0, logLimit).map((l, i) => (
            <div className={"cn-pl-log cn-pl-log--" + l.type} key={l.ts + "_" + i}>
              <span className="cn-pl-hist-time">{fmtDateTime(l.ts)}</span>
              <span>{l.text}</span>
            </div>
          ))}
          {logs.length > logLimit && (
            <button className="cn-dev-btn" type="button" onClick={() => setLogLimit((n) => n + 40)}>Показати ще</button>
          )}
        </div>

        <div className="cn-pl-card">
          <div className="cn-pl-title">Дії</div>
          {editOpen ? (
            <div className="cn-admin-edit-form">
              <label className="cn-admin-field-label">
                Power
                <input className="cn-admin-input" type="number" value={power} onChange={(e) => setPower(e.target.value)} />
              </label>
              <label className="cn-admin-field-label">
                Points
                <input className="cn-admin-input" type="number" value={pts} onChange={(e) => setPts(e.target.value)} />
              </label>
              <label className="cn-admin-field-label">
                Кількість кліків
                <input className="cn-admin-input" type="number" value={clicks} onChange={(e) => setClicks(e.target.value)} />
              </label>
              <div className="cn-admin-edit-actions">
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={saveEdit}>Зберегти</button>
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={() => setEditOpen(false)}>Скасувати</button>
              </div>
            </div>
          ) : (
            <>
              {!sel.blocked && (
                <input className="cn-admin-input" type="text" placeholder="Причина блокування (необов'язково)" value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
              <div className="cn-admin-edit-actions">
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={() => { setPower(String(Math.round(sel.power || 0))); setPts(String(Math.round(sel.points || 0))); setClicks(String(Math.round(sel.totalClicks || 0))); setEditOpen(true); }}>
                  Редагувати
                </button>
                <button className="cn-dev-btn" type="button" disabled={busy} onClick={togglePremium}>
                  {sel.hasPremiumPass ? "Забрати Premium" : "Видати Premium"}
                </button>
                <button className={"cn-dev-btn" + (sel.blocked ? "" : " cn-dev-btn--danger")} type="button" disabled={busy} onClick={toggleBlock}>
                  {sel.blocked ? "Розблокувати" : "Заблокувати"}
                </button>
              </div>
              <div className="cn-admin-block-title" style={{ marginTop: 10 }}>Написати гравцеві</div>
              <input className="cn-admin-input" type="text" maxLength={80} placeholder="Тема" value={mSubj} onChange={(e) => setMSubj(e.target.value)} />
              <textarea className="cn-admin-input cn-changelog-textarea" rows={3} maxLength={1000} placeholder="Текст листа (прийде в Пошту → Від адміністрації)" value={mBody} onChange={(e) => setMBody(e.target.value)} />
              <button className="cn-dev-btn" type="button" disabled={busy || !mBody.trim()} onClick={sendMailToSel}>Надіслати лист</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="cn-settings cn-pl">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Гравці ({(players || []).length})</div>
        <div style={{ width: 34 }} />
      </div>
      <input
        className="cn-admin-input"
        type="text"
        placeholder="Пошук: нікнейм, Telegram ID, країна…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setLimit(50); }}
      />
      <div className="cn-dip-list" style={{ marginTop: 10 }}>
        {list.length === 0 && <div className="cn-lb-empty">Гравців не знайдено</div>}
        {list.slice(0, limit).map((p) => (
          <button className="cn-pl-item" key={p.id} type="button" onClick={() => { cnSfx.navSwitch(); setSelId(p.id); }}>
            <Flag code={p.countryCode} size={22} className="cn-country-badge--lg" />
            <span className="cn-pl-item-main">
              <span className="cn-pl-item-name">{p.username || p.id}{p.blocked ? " ⛔" : ""}</span>
              <span className="cn-pl-sub">TG: {p.telegramId || "—"} · {COUNTRY_MAP[p.countryCode]?.name || "—"}</span>
            </span>
            <span className="cn-pl-item-power">{fmt(p.power || 0)}</span>
            <ChevronRight size={16} />
          </button>
        ))}
        {list.length > limit && (
          <button className="cn-dev-btn" type="button" onClick={() => setLimit((n) => n + 50)}>Показати ще ({list.length - limit})</button>
        )}
      </div>
    </div>
  );
}
