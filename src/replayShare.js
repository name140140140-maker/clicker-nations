// Спільні функції для відеоповторів: запис canvas у відео, збереження на пристрій, поширення в Telegram.
// Логіка така сама, як у повторі дрона (див. DroneGame.jsx), але винесена окремо для режиму «Замах».

export const GAME_TAG = "@worldclicker_bot";
const SB_URL = "https://zrpwgavfploiaqrqpcvv.supabase.co";
const SB_KEY = "sb_publishable_Kp13ZD0NtWypUYegahB35g_X2nOWmzn";

async function apiPost(payload) {
  const r = await fetch("/api/drone-share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, initData: window.Telegram?.WebApp?.initData || "" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Помилка сервера");
  return j;
}

async function uploadSigned(path, token, blob) {
  const fd = new window.FormData();
  fd.append("cacheControl", "3600");
  fd.append("", blob);
  const r = await fetch(`${SB_URL}/storage/v1/object/upload/sign/drone-replays/${path}?token=${encodeURIComponent(token)}`, {
    method: "PUT",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "x-upsert": "true" },
    body: fd,
  });
  if (!r.ok) throw new Error("Не вдалося завантажити відео");
}

/* Запис canvas. stop(drop) повертає Promise<{blob,mime,ext}|null>. */
export function createRecorder(canvas) {
  let rec = null, chunks = [], mime = "", resolveStop = null, discard = false;
  const start = () => {
    rec = null;
    try {
      if (!canvas.captureStream || typeof window.MediaRecorder === "undefined") return false;
      const mts = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      mime = mts.find((m) => window.MediaRecorder.isTypeSupported(m)) || "";
      if (!mime) return false;
      rec = new window.MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 2000000 });
      chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const m = mime.split(";")[0];
        const out = !discard && chunks.length ? { blob: new Blob(chunks, { type: m }), mime: m, ext: m.includes("mp4") ? "mp4" : "webm" } : null;
        if (resolveStop) resolveStop(out);
        resolveStop = null;
      };
      rec.start(250);
      return true;
    } catch (e) { rec = null; return false; }
  };
  const stop = (drop) => new Promise((resolve) => {
    discard = !!drop;
    if (!rec || rec.state === "inactive") { rec = null; resolve(null); return; }
    resolveStop = resolve;
    try { rec.stop(); } catch (e) { resolve(null); }
    rec = null;
  });
  return { start, stop };
}

/* Зберегти відео на пристрій. onMsg(text) — підказка для гравця. */
export async function saveReplay(video, filename, onMsg, onBusy) {
  if (!video) return;
  onMsg("");
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.initData && typeof tg.downloadFile === "function") {
    onBusy(true); onMsg("Готуємо файл…");
    try {
      const init = await apiPost({ action: "init", mime: video.mime });
      await uploadSigned(init.path, init.token, video.blob);
      onBusy(false); onMsg("");
      tg.downloadFile({ url: init.url, file_name: `${filename}.${video.ext}` }, (ok) => onMsg(ok ? "Відео збережено ✓" : ""));
      return;
    } catch (e) { onBusy(false); onMsg(""); }
  }
  try {
    const url = URL.createObjectURL(video.blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${filename}.${video.ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    onMsg("Відео збережено на пристрій.");
  } catch (e) { onMsg("Не вдалося зберегти відео на цьому пристрої."); }
}

/* Поділитися відео: Telegram (відео доходить саме як відео) → системне меню → текст. */
export async function shareReplay({ video, thumb, caption, filename, title, onMsg, onBusy }) {
  onMsg("");
  const tg = window.Telegram && window.Telegram.WebApp;
  if (video && tg && tg.initData) {
    onBusy(true); onMsg("Готуємо відео до відправки…");
    try {
      const init = await apiPost({ action: "init", mime: video.mime });
      await uploadSigned(init.path, init.token, video.blob);
      await uploadSigned(init.thumbPath, init.thumbToken, thumb || new Blob([], { type: "image/jpeg" }));
      const r = await apiPost({ action: "send", path: init.path, thumbPath: init.thumbPath, caption, title });
      onBusy(false);
      if (r.preparedId && tg.shareMessage) {
        onMsg("");
        tg.shareMessage(r.preparedId, (ok) => { if (ok) onMsg("Відео надіслано ✓"); });
        return;
      }
      onMsg("Відео надіслано тобі в чат з ботом — перешли його друзям.");
      return;
    } catch (e) {
      onBusy(false);
      onMsg(String(e && e.message ? e.message : "Не вдалося надіслати відео"));
    }
  }
  if (video) {
    try {
      const file = new window.File([video.blob], `${filename}.${video.ext}`, { type: video.mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: caption, title });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  const u = `https://t.me/share/url?url=&text=${encodeURIComponent(caption)}`;
  if (tg && tg.openTelegramLink) tg.openTelegramLink(u); else window.open(u, "_blank");
  if (video) onMsg("Відео напряму надіслати не вдалося: збережи його кнопкою «Зберегти відео» і додай до повідомлення.");
}
