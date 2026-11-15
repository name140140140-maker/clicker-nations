import { useState, useCallback } from "react";
import { RefreshCw, ChevronLeft, Mail, MailOpen, Check, Ban } from "lucide-react";
import { worldOp, stateOp } from "../powerApi";
import { respondDiplomacyRequest, timeAgo } from "../app/shared.jsx";



async function acceptWarInvite(meta) {
  return worldOp("war-join", { warId: meta.warId, side: meta.side, fromCountry: meta.fromCountry });
}


export function MailScreen({ me, mail, onBack, onRefresh, onRefreshGameData }) {
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [box, setBox] = useState("game"); // game | admin
  const unreadGame = mail.filter((m) => !m.read && m.from !== "admin").length;
  const unreadAdmin = mail.filter((m) => !m.read && m.from === "admin").length;
  const shownMail = mail.filter((m) => (box === "admin" ? m.from === "admin" : m.from !== "admin"));

  const markRead = useCallback(
    async (id) => {
      await stateOp("mail-read", { id });
      onRefresh();
    },
    [me.id, onRefresh]
  );

  const openMessage = (m) => {
    setOpenId(m.id === openId ? null : m.id);
    if (!m.read) markRead(m.id);
  };

  const respondDipRequest = useCallback(
    async (msg, accept) => {
      setBusyId(msg.id);
      const res = await respondDiplomacyRequest(msg.meta.requestId, accept);
      await stateOp("mail-resolve", { id: msg.id, resolved: res.ok ? (accept ? "accepted" : "declined") : "stale", note: res.ok ? "" : res.reason });
      onRefresh();
      onRefreshGameData && onRefreshGameData();
      setBusyId(null);
    },
    [me.id, onRefresh, onRefreshGameData]
  );

  const respondWarInvite2 = useCallback(
    async (msg, accept) => {
      setBusyId(msg.id);
      let res = { ok: true };
      if (accept) res = await acceptWarInvite(msg.meta);
      await stateOp("mail-resolve", { id: msg.id, resolved: res.ok ? (accept ? "accepted" : "declined") : "stale", note: res.ok ? "" : res.reason });
      onRefresh();
      onRefreshGameData && onRefreshGameData();
      setBusyId(null);
    },
    [me.id, onRefresh, onRefreshGameData]
  );


  return (
    <div className="cn-mail">
      <div className="cn-lb-header">
        <button className="cn-icon-btn" onClick={onBack} type="button" aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="cn-screen-title">Пошта</div>
        <button className="cn-icon-btn" onClick={onRefresh} type="button" aria-label="Оновити">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="cn-box-tabs">
        <button type="button" className={"cn-box-tab" + (box === "game" ? " cn-box-tab--active" : "")} onClick={() => setBox("game")}>
          Від гри{unreadGame > 0 && <span className="cn-box-badge">{unreadGame}</span>}
        </button>
        <button type="button" className={"cn-box-tab" + (box === "admin" ? " cn-box-tab--active" : "")} onClick={() => setBox("admin")}>
          Від адміністрації{unreadAdmin > 0 && <span className="cn-box-badge">{unreadAdmin}</span>}
        </button>
      </div>

      {shownMail.length === 0 && <div className="cn-lb-empty">Повідомлень поки немає</div>}

      <div className="cn-mail-list">
        {shownMail.map((m) => {
          const open = openId === m.id;
          return (
            <div key={m.id} className={"cn-mail-item" + (!m.read ? " cn-mail-item--unread" : "")}>
              <button className="cn-mail-item-head" type="button" onClick={() => openMessage(m)}>
                {m.read ? <MailOpen size={14} className="cn-mail-item-icon" /> : <Mail size={14} className="cn-mail-item-icon" />}
                <div className="cn-mail-item-text">
                  <div className="cn-mail-item-subject">{m.subject}</div>
                  <div className="cn-mail-item-time">{timeAgo(m.ts)}</div>
                </div>
                {!m.read && <span className="cn-mail-dot" />}
              </button>
              {open && (
                <div className="cn-mail-item-body">
                  <div>{m.body}</div>
                  {m.type === "war-invite" && m.meta && (
                    m.resolved ? (
                      <div className="cn-mail-resolved">
                        {m.resolved === "accepted" ? "✓ Ви вступили у війну" : m.resolved === "declined" ? "✗ Відхилено" : m.resolvedNote || "Вже неактуально"}
                      </div>
                    ) : (
                      <div className="cn-mail-actions">
                        <button className="cn-mail-action cn-mail-action--accept" disabled={busyId === m.id} onClick={() => respondWarInvite2(m, true)} type="button">
                          <Check size={14} /> Прийняти
                        </button>
                        <button className="cn-mail-action cn-mail-action--decline" disabled={busyId === m.id} onClick={() => respondWarInvite2(m, false)} type="button">
                          <Ban size={14} /> Відхилити
                        </button>
                      </div>
                    )
                  )}
                  {m.type === "dip-request" && m.meta && (
                    m.resolved ? (
                      <div className="cn-mail-resolved">
                        {m.resolved === "accepted" ? (m.meta.kind === "ceasefire" ? "✓ Перемир'я укладено" : "✓ Прийнято") : m.resolved === "declined" ? "✗ Відхилено" : m.resolvedNote || "Вже неактуально"}
                      </div>
                    ) : (
                      <div className="cn-mail-actions">
                        <button className="cn-mail-action cn-mail-action--accept" disabled={busyId === m.id} onClick={() => respondDipRequest(m, true)} type="button">
                          <Check size={14} /> Прийняти
                        </button>
                        <button className="cn-mail-action cn-mail-action--decline" disabled={busyId === m.id} onClick={() => respondDipRequest(m, false)} type="button">
                          <Ban size={14} /> Відхилити
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
