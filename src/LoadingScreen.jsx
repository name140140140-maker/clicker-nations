import React, { useEffect, useMemo, useState } from "react";

/* Екран завантаження: анімований глобус із орбітами, смуга прогресу й підказки, що змінюються. */

const TIPS = {
  uk: [
    "Клікай по глобусу — кожен дотик збільшує твою силу.",
    "Країни можна захоплювати на карті територій: обери регіон і готуйся до бою.",
    "Дрони бувають різні: квадрокоптер маневровий, Шахед швидкий, Байрактар найстійкіший.",
    "Заходь щодня — нагороди за серію днів із кожним днем більші.",
    "Союзники в війні — половина перемоги. Домовляйся з іншими гравцями.",
    "Перед ударом дрона переглянь маршрут: ППО не прощає помилок.",
    "У розділі «Армія» ховається щось, що вимагає терпіння, влучності й твердої руки.",
    "Повтор вдалого удару можна зберегти як відео й надіслати друзям.",
    "Шепочуть, що в магазині напис «Нові товари вже в дорозі» живий: якщо досить швидко й наполегливо тицяти в нього, відкриється щось незвичне. Пароль — вухатий упертюх, названий дуже лагідно.",
    "Косметика в профілі не впливає на силу, але виділяє тебе серед інших.",
  ],
  en: [
    "Tap the globe — every tap makes you stronger.",
    "You can capture countries on the territory map: pick a region and get ready for battle.",
    "Drones differ: the quadcopter is agile, the Shahed is fast, the Bayraktar is the toughest.",
    "Come back every day — streak rewards grow with each day.",
    "Allies are half the victory in war. Make deals with other players.",
    "Check the route before a drone strike: air defence forgives nothing.",
    "Something in the Army section demands patience, a steady hand and a good aim.",
    "A successful strike replay can be saved as a video and sent to friends.",
    "Rumour has it the shop's “New items are on the way” sign is alive: poke it fast and stubbornly enough and something unusual opens. The password is a long-eared stubborn beast with a very affectionate name (in Ukrainian).",
    "Profile cosmetics don't change your power, but they make you stand out.",
  ],
  ru: [
    "Кликай по глобусу — каждое касание делает тебя сильнее.",
    "Страны можно захватывать на карте территорий: выбери регион и готовься к бою.",
    "Дроны разные: квадрокоптер манёвренный, Шахед быстрый, Байрактар самый живучий.",
    "Заходи каждый день — награды за серию растут с каждым днём.",
    "Союзники в войне — половина победы. Договаривайся с другими игроками.",
    "Перед ударом дрона проверь маршрут: ПВО не прощает ошибок.",
    "В разделе «Армия» есть кое-что, что требует терпения, меткости и твёрдой руки.",
    "Повтор удачного удара можно сохранить как видео и отправить друзьям.",
    "Шепчут, что надпись «Новые товары уже в пути» в магазине живая: если достаточно быстро и настойчиво тыкать в неё, откроется что-то необычное. Пароль — ушастый упрямец с очень ласковым именем (по-украински).",
    "Косметика в профиле не влияет на силу, но выделяет тебя среди других.",
  ],
  pl: [
    "Klikaj w globus — każde dotknięcie czyni cię silniejszym.",
    "Kraje możesz zdobywać na mapie terytoriów: wybierz region i szykuj się do bitwy.",
    "Drony są różne: quadcopter jest zwrotny, Szahid szybki, a Bayraktar najwytrzymalszy.",
    "Wchodź codziennie — nagrody za serię rosną z każdym dniem.",
    "Sojusznicy to połowa zwycięstwa. Dogaduj się z innymi graczami.",
    "Przed atakiem drona sprawdź trasę: obrona przeciwlotnicza nie wybacza błędów.",
    "W sekcji „Armia” ukryto coś, co wymaga cierpliwości, celności i twardej ręki.",
    "Powtórkę udanego ataku możesz zapisać jako wideo i wysłać znajomym.",
    "Szepczą, że napis „Nowe produkty już w drodze” w sklepie żyje: stuknij w niego szybko i uparcie, a otworzy się coś niezwykłego. Hasło to długouchy uparciuch o bardzo pieszczotliwej nazwie (po ukraińsku).",
    "Kosmetyka w profilu nie zmienia siły, ale wyróżnia cię z tłumu.",
  ],
  de: [
    "Tippe auf den Globus — jeder Tipp macht dich stärker.",
    "Länder kannst du auf der Gebietskarte erobern: Wähle eine Region und mach dich kampfbereit.",
    "Drohnen sind verschieden: Der Quadrocopter ist wendig, die Schahed schnell, die Bayraktar am robustesten.",
    "Komm jeden Tag wieder — Serienbelohnungen wachsen mit jedem Tag.",
    "Verbündete sind die halbe Miete im Krieg. Schließe Abkommen mit anderen Spielern.",
    "Prüfe vor einem Drohnenangriff die Route: Die Flugabwehr verzeiht keine Fehler.",
    "Im Bereich „Armee“ steckt etwas, das Geduld, Zielgenauigkeit und eine ruhige Hand verlangt.",
    "Die Wiederholung eines gelungenen Treffers kannst du als Video speichern und an Freunde schicken.",
    "Man munkelt, der Schriftzug „Neue Artikel sind unterwegs“ im Shop lebt: Tippe schnell und beharrlich darauf, und etwas Ungewöhnliches öffnet sich. Das Passwort ist ein langohriger Sturkopf mit sehr liebevollem Namen (auf Ukrainisch).",
    "Kosmetik im Profil ändert deine Stärke nicht, hebt dich aber von anderen ab.",
  ],
  it: [
    "Tocca il globo: ogni tocco ti rende più forte.",
    "Puoi conquistare i paesi sulla mappa dei territori: scegli una regione e preparati alla battaglia.",
    "I droni sono diversi: il quadricottero è agile, lo Shahed veloce, il Bayraktar il più resistente.",
    "Torna ogni giorno: i premi della serie crescono ogni giorno.",
    "Gli alleati sono metà della vittoria in guerra. Accordati con gli altri giocatori.",
    "Prima di un attacco con drone controlla la rotta: la contraerea non perdona.",
    "Nella sezione «Esercito» c'è qualcosa che richiede pazienza, mira e mano ferma.",
    "Il replay di un colpo riuscito si può salvare come video e inviare agli amici.",
    "Si sussurra che la scritta «Nuovi articoli in arrivo» nel negozio sia viva: toccala in fretta e con insistenza e si aprirà qualcosa di insolito. La password è un testardo dalle lunghe orecchie con un nome affettuosissimo (in ucraino).",
    "I cosmetici del profilo non cambiano la forza, ma ti fanno distinguere.",
  ],
};
const SECRET_IDX = 8;

const LOADING_WORD = {
  uk: "Завантаження", en: "Loading", ru: "Загрузка", pl: "Ładowanie", de: "Laden", it: "Caricamento",
};
const TIP_LABEL = { uk: "Підказка", en: "Tip", ru: "Подсказка", pl: "Wskazówka", de: "Tipp", it: "Suggerimento" };

const CSS = `
.cn-ld { position: relative; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; box-sizing: border-box; padding: 24px 20px; color: var(--cn-text, #e6f1fb); overflow: hidden; }
.cn-ld--full { min-height: 100vh; }
.cn-ld--fill { position: absolute; inset: 0; z-index: 5; background: radial-gradient(ellipse at 50% 30%, #16324f 0%, #0d1b33 60%, #070d1a 100%); }
.cn-ld--block { padding: 20px 16px; }
.cn-ld-stars { position: absolute; inset: 0; pointer-events: none; opacity: 0.7;
  background-image: radial-gradient(1.2px 1.2px at 12% 22%, #fff 50%, transparent 52%), radial-gradient(1px 1px at 78% 14%, #cfe8ff 50%, transparent 52%), radial-gradient(1.4px 1.4px at 88% 68%, #fff 50%, transparent 52%), radial-gradient(1px 1px at 22% 82%, #cfe8ff 50%, transparent 52%), radial-gradient(1.2px 1.2px at 52% 8%, #fff 50%, transparent 52%), radial-gradient(1px 1px at 40% 62%, #cfe8ff 50%, transparent 52%), radial-gradient(1px 1px at 66% 90%, #fff 50%, transparent 52%);
  animation: cn-ld-twinkle 3.2s ease-in-out infinite; }
@keyframes cn-ld-twinkle { 0%,100% { opacity: 0.45; } 50% { opacity: 0.9; } }
.cn-ld-orb { position: relative; width: 132px; height: 132px; flex-shrink: 0; }
.cn-ld--sm .cn-ld-orb { width: 96px; height: 96px; }
.cn-ld-glow { position: absolute; inset: -26px; border-radius: 50%; background: radial-gradient(circle, rgba(var(--cn-accent-rgb,126,201,232),0.34) 0%, transparent 68%); animation: cn-ld-breathe 2.4s ease-in-out infinite; }
@keyframes cn-ld-breathe { 0%,100% { transform: scale(0.92); opacity: 0.7; } 50% { transform: scale(1.08); opacity: 1; } }
.cn-ld-globe { position: absolute; inset: 22%; border-radius: 50%; overflow: hidden;
  background: radial-gradient(circle at 34% 30%, #6fc3ff 0%, #2478d4 45%, #0c3a78 100%); box-shadow: inset -8px -10px 18px rgba(0,0,0,0.45), 0 0 18px rgba(var(--cn-accent-rgb,126,201,232),0.5); }
.cn-ld-land { position: absolute; top: 0; left: 0; height: 100%; width: 200%; display: flex; animation: cn-ld-spin 7s linear infinite; }
.cn-ld-land svg { width: 50%; height: 100%; flex-shrink: 0; }
@keyframes cn-ld-spin { to { transform: translateX(-50%); } }
.cn-ld-shade { position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle at 30% 28%, rgba(255,255,255,0.28), transparent 45%), radial-gradient(circle at 78% 82%, rgba(0,0,0,0.5), transparent 60%); }
.cn-ld-ring { position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid rgba(var(--cn-accent-rgb,126,201,232),0.28); }
.cn-ld-ring--b { inset: 9%; border-style: dashed; border-color: rgba(244,185,66,0.28); }
.cn-ld-orbit { position: absolute; inset: 0; animation: cn-ld-rot 2.6s linear infinite; }
.cn-ld-orbit--b { inset: 9%; animation-duration: 4.2s; animation-direction: reverse; }
.cn-ld-sat { position: absolute; top: -5px; left: 50%; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--cn-accent-bright, #9fdcf5); box-shadow: 0 0 10px 2px rgba(var(--cn-accent-rgb,126,201,232),0.9); }
.cn-ld-orbit--b .cn-ld-sat { background: #f4b942; box-shadow: 0 0 10px 2px rgba(244,185,66,0.9); width: 8px; height: 8px; margin-left: -4px; top: -4px; }
@keyframes cn-ld-rot { to { transform: rotate(360deg); } }
.cn-ld-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; letter-spacing: 0.14em; font-size: 15px; text-align: center; }
.cn-ld-sub { font-size: 12.5px; color: var(--cn-text-dim, #9fc4dc); text-align: center; min-height: 16px; }
.cn-ld-dots::after { content: ""; animation: cn-ld-dots 1.4s steps(4, end) infinite; }
@keyframes cn-ld-dots { 0% { content: ""; } 25% { content: "."; } 50% { content: ".."; } 75%,100% { content: "..."; } }
.cn-ld-bar { position: relative; width: min(260px, 74vw); height: 6px; border-radius: 999px; background: rgba(255,255,255,0.12); overflow: hidden; }
.cn-ld-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: linear-gradient(90deg, var(--cn-accent, #7ec9e8), #f4b942); transition: width 0.25s ease-out; }
.cn-ld-fill--ind { width: 38%; animation: cn-ld-slide 1.3s ease-in-out infinite; }
@keyframes cn-ld-slide { 0% { left: -40%; } 100% { left: 102%; } }
.cn-ld-pct { font-size: 11px; color: var(--cn-text-dim, #9fc4dc); margin-top: -6px; }
.cn-ld-tip { width: min(330px, 88vw); margin-top: 6px; padding: 11px 14px 12px; border-radius: 14px; box-sizing: border-box; text-align: left;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(var(--cn-accent-rgb,126,201,232),0.22); backdrop-filter: blur(4px); }
.cn-ld-tip-h { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #f4b942; margin-bottom: 5px; }
.cn-ld-tip-t { font-size: 12.5px; line-height: 1.45; color: var(--cn-text, #e6f1fb); min-height: 78px; animation: cn-ld-tipin 0.5s ease-out; }
@keyframes cn-ld-tipin { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.cn-ld-pips { display: flex; justify-content: center; gap: 5px; margin-top: 8px; }
.cn-ld-pip { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.22); transition: background 0.3s, transform 0.3s; }
.cn-ld-pip--on { background: #f4b942; transform: scale(1.35); }
@media (prefers-reduced-motion: reduce) { .cn-ld * { animation-duration: 0.01s !important; animation-iteration-count: 1 !important; } .cn-ld-land, .cn-ld-orbit, .cn-ld-fill--ind { animation-iteration-count: infinite !important; animation-duration: 12s !important; } }
`;

const LAND = (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <g fill="#5fcf7a" fillOpacity="0.88">
      <path d="M8 30c6-9 18-10 24-4 4 5-2 10 2 15s-2 12-8 11-6 9-12 6-9-12-12-18 2-6 6-10z" />
      <path d="M44 52c7-3 14 1 15 9s-5 16-10 21-7-8-8-14 0-12 3-16z" />
      <path d="M52 14c9-5 22-3 30 3s5 11-3 13-8 8-16 6-6-8-12-9-5-9 1-13z" />
      <path d="M72 55c6-2 12 2 12 8s-5 9-10 8-6-12-2-16z" />
    </g>
  </svg>
);

export default function LoadingScreen({ lang = "uk", variant = "full", title = null, stage = null, progress = null, tips = true, size = "md" }) {
  const list = TIPS[lang] || TIPS.en;
  const [i, setI] = useState(() => Math.floor(Math.random() * list.length));
  useEffect(() => {
    if (!tips) return undefined;
    const id = setInterval(() => setI((x) => (x + 1) % list.length), 5200);
    return () => clearInterval(id);
  }, [tips, list.length]);
  const word = LOADING_WORD[lang] || LOADING_WORD.en;
  const pct = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress * 100)));
  const pips = useMemo(() => list.map((_, k) => k), [list]);
  const cls = `cn-ld cn-ld--${variant}${size === "sm" ? " cn-ld--sm" : ""}`;
  return (
    <div className={cls} role="status" aria-live="polite">
      <style>{CSS}</style>
      {variant !== "block" && <div className="cn-ld-stars" />}
      <div className="cn-ld-orb">
        <div className="cn-ld-glow" />
        <div className="cn-ld-ring" />
        <div className="cn-ld-ring cn-ld-ring--b" />
        <div className="cn-ld-orbit"><div className="cn-ld-sat" /></div>
        <div className="cn-ld-orbit cn-ld-orbit--b"><div className="cn-ld-sat" /></div>
        <div className="cn-ld-globe">
          <div className="cn-ld-land">{LAND}{LAND}</div>
          <div className="cn-ld-shade" />
        </div>
      </div>
      {title !== false && <div className="cn-ld-title">{title || "WORLD CLICKER"}</div>}
      <div className="cn-ld-sub">{stage ? stage : <>{word}<span className="cn-ld-dots" /></>}</div>
      <div className="cn-ld-bar"><div className={`cn-ld-fill${pct == null ? " cn-ld-fill--ind" : ""}`} style={pct == null ? undefined : { width: `${Math.max(pct, 4)}%` }} /></div>
      {pct != null && <div className="cn-ld-pct">{pct}%</div>}
      {tips && (
        <div className="cn-ld-tip">
          <div className="cn-ld-tip-h">{TIP_LABEL[lang] || TIP_LABEL.en}</div>
          <div className="cn-ld-tip-t" key={i}>{list[i]}</div>
          <div className="cn-ld-pips">{pips.map((k) => <span key={k} className={`cn-ld-pip${k === i ? " cn-ld-pip--on" : ""}`} />)}</div>
        </div>
      )}
    </div>
  );
}

export { SECRET_IDX };
