import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, Music } from "lucide-react";

const MAINTENANCE_BG = "/img/maintenance-bg.webp";

const FACTS = [
  ["Історія", "Київ згадується в літописах уже понад 1500 років — одне з найдавніших міст Європи."],
  ["Географія", "Україна — найбільша країна, що повністю лежить у Європі: близько 603 500 км²."],
  ["Історія", "Софійський собор у Києві збудовано в XI столітті за часів Ярослава Мудрого."],
  ["Географія", "Найвища точка України — гора Говерла в Карпатах, 2061 метр."],
  ["Географія", "Дунай впадає в Чорне море трьома рукавами, утворюючи найбільшу в Європі добре збережену дельту."],
  ["Історія", "Великий шовковий шлях тягнувся понад 6 000 км і з’єднував Китай із Середземномор’ям."],
  ["Географія", "Байкал — найглибше озеро планети (понад 1 600 м) і містить близько п’ятої частини світового запасу прісної води."],
  ["Історія", "Давній Рим у період розквіту об’єднував землі навколо всього Середземного моря."],
  ["Географія", "Росія охоплює 11 часових поясів, а Франція разом із заморськими територіями — аж 12, найбільше у світі."],
  ["Історія", "Піраміда Хеопса залишалася найвищою спорудою світу близько 3 800 років."],
  ["Географія", "Сахара — найбільша гаряча пустеля світу, за площею майже як вся Європа."],
  ["Історія", "Друкарський верстат Гутенберга близько 1450 року кардинально пришвидшив поширення знань."],
  ["Географія", "Найглибша точка океану — Маріанська западина, приблизно 11 000 метрів під водою."],
  ["Історія", "Іван Федоров 1574 року у Львові надрукував першу датовану друковану книжку на українських землях — «Апостол»."],
  ["Географія", "Ватикан — найменша держава світу: лише близько 0,44 км²."],
  ["Історія", "Китайська стіна будувалася й добудовувалася протягом багатьох століть різними династіями."],
  ["Географія", "Ніл — одна з найдовших річок світу, понад 6 600 км, і тече на північ."],
  ["Історія", "Магдебурзьке право отримали десятки українських міст, зокрема Київ, Львів і Кам’янець-Подільський."],
  ["Географія", "Австралія — єдиний у світі материк, що водночас є однією державою."],
  ["Історія", "Острів Хортиця в Запоріжжі — місце, де була заснована перша Запорозька Січ близько 1552 року."],
  ["Географія", "Монако — друга за розміром держава світу, менш ніж 2,1 км²."],
  ["Географія", "Гренландія — найбільший у світі острів, понад 2 мільйони км², здебільшого вкритий кригою."],
  ["Історія", "Вікінги дісталися Північної Америки близько 1000 року — майже за пів тисячі років до Колумба."],
];

// Усе (звук цокання, мелодія і візуальна секундна стрілка) тактується одним
// годинником — AudioContext.currentTime. Цокання заплановані наперед на точні
// секундні межі, а стрілка рахується з того самого часу (з поправкою на
// затримку виводу), тому візуальний «крок» і звук збігаються.
const NOTES = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // A-мінорна пентатоніка/діатоніка
const CHORDS = [[110, 164.81, 220], [87.31, 130.81, 174.61], [98, 146.83, 196], [110, 164.81, 220]];

function useClockAudio(tickOn, musicOn) {
  const ref = useRef({ ctx: null, tickGain: null, musicGain: null, nextTick: 0, tickN: 0, nextNote: 0, nextChord: 0, chordN: 0, timer: null });

  const ensure = () => {
    const r = ref.current;
    if (r.ctx) return r;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return r;
    const ctx = new AudioCtx();
    r.ctx = ctx;
    r.tickGain = ctx.createGain();
    r.tickGain.gain.value = 0;
    r.tickGain.connect(ctx.destination);
    r.musicGain = ctx.createGain();
    r.musicGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    r.musicGain.connect(lp).connect(ctx.destination);
    // Розклад цокань іде по цілих секундах performance-годинника (його ж читає
    // стрілка); у час AudioContext вони переводяться зі зсувом, що оновлюється.
    r.nextTick = Math.ceil(performance.now() / 1000 + 0.1);
    r.tickN = 0;
    r.nextNote = ctx.currentTime + 0.5;
    r.nextChord = ctx.currentTime + 0.2;
    return r;
  };

  const scheduleTick = (r, t, n) => {
    const ctx = r.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = n % 2 === 0 ? 1250 : 950; // тік-так
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    osc.connect(g).connect(r.tickGain);
    osc.start(t);
    osc.stop(t + 0.06);
  };

  const scheduleNote = (r, t, f, dur, vol) => {
    const ctx = r.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(r.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };

  // Єдиний планувальник: щоразу, раз на 200 мс, планує події на 1.2 с уперед.
  useEffect(() => {
    if (!tickOn && !musicOn) return undefined;
    const r = ensure();
    if (!r.ctx) return undefined;
    if (r.ctx.state === "suspended") r.ctx.resume();
    const now = r.ctx.currentTime;
    r.tickGain.gain.setTargetAtTime(tickOn ? 0.06 : 0, now, 0.05);
    r.musicGain.gain.setTargetAtTime(musicOn ? 0.5 : 0, now, 0.4);
    if (r.timer) return undefined;
    r.timer = setInterval(() => {
      const c = r.ctx;
      const horizon = c.currentTime + 1.2;
      const offset = c.currentTime - performance.now() / 1000;
      while (r.nextTick + offset < horizon) {
        scheduleTick(r, Math.max(r.nextTick + offset, c.currentTime), r.tickN);
        r.tickN += 1;
        r.nextTick += 1;
      }
      while (r.nextChord < horizon) {
        const ch = CHORDS[r.chordN % CHORDS.length];
        ch.forEach((f) => scheduleNote(r, r.nextChord, f, 8, 0.05));
        r.chordN += 1;
        r.nextChord += 6;
      }
      while (r.nextNote < horizon) {
        const f = NOTES[Math.floor(Math.random() * NOTES.length)] * (Math.random() < 0.3 ? 2 : 1);
        scheduleNote(r, r.nextNote, f, 3.2, 0.035);
        r.nextNote += 1.5 + Math.floor(Math.random() * 3) * 0.75;
      }
    }, 200);
    return undefined;
  }, [tickOn, musicOn]);

  useEffect(() => () => {
    const r = ref.current;
    if (r.timer) clearInterval(r.timer);
    r.timer = null;
    if (r.ctx) r.ctx.close().catch(() => {});
    r.ctx = null;
  }, []);

  // Час для стрілки: той самий performance-годинник мінус затримка виводу звуку,
  // тож «крок» стрілки припадає на момент, коли цокання реально лунає.
  const getTime = () => {
    const r = ref.current;
    const lat = r.ctx && r.timer ? r.ctx.outputLatency || r.ctx.baseLatency || 0 : 0;
    return performance.now() / 1000 - lat;
  };
  return getTime;
}

function stepAngle(t, perTick) {
  // Різкий «крок» стрілки (з легким пружним доводом) на початку кожної секунди.
  const n = Math.floor(t);
  const f = t - n;
  const k = Math.min(1, f / 0.12);
  const ease = 1 - Math.pow(1 - k, 3);
  const over = k < 1 ? 0 : Math.max(0, 1 - (f - 0.12) / 0.15) * 0.18 * Math.sin((f - 0.12) * 60);
  return (n - 1 + ease + over) * perTick;
}

export default function MaintenanceScreen({ message }) {
  const [tickOn, setTickOn] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const getTime = useClockAudio(tickOn, musicOn);
  void getTime;

  // Факти: перемішаний порядок, зміна кожні 5 секунд із плавним затуханням.
  const [order] = useState(() => {
    const a = FACTS.map((_, i) => i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });
  const [pos, setPos] = useState(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 50);
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setPos((p) => (p + 1) % order.length);
        setVisible(true);
      }, 600);
    }, 5000);
    return () => { clearTimeout(show); clearInterval(id); };
  }, [order.length]);
  const fact = FACTS[order[pos]];

  return (
    <div className="cn-maint-screen">
      <button
        className="cn-maint-sound-btn cn-maint-sound-btn--music"
        onClick={() => setMusicOn((v) => !v)}
        aria-label={musicOn ? "Вимкнути музику" : "Увімкнути музику"}
        style={{ opacity: musicOn ? 1 : 0.7 }}
      >
        <Music size={18} />
      </button>
      <button
        className="cn-maint-sound-btn"
        onClick={() => setTickOn((v) => !v)}
        aria-label={tickOn ? "Вимкнути цокання" : "Увімкнути цокання"}
      >
        {tickOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>

      <img src={MAINTENANCE_BG} alt="" className="cn-maint-bg" />
      <div className="cn-maint-shade" />

      <div className="cn-maint-card">
        <div className="cn-maint-badge">🚧 Технічна перерва</div>
        <h1 className="cn-maint-title">Світ у ремонті!</h1>
        <p className="cn-maint-body">
          {message || "Ми підкручуємо гайки, чистимо кордони й готуємо для тебе щось нове. Скоро повернемось — тримай свої території!"}
        </p>
        <p className="cn-maint-sub">Прогрес збережено — нічого не втрачено 💙</p>
      </div>

      <div className="cn-maint-facts" aria-live="polite">
        <span className="cn-maint-facts-tag">{fact[0]}</span>
        <div className={"cn-maint-facts-text" + (visible ? " cn-maint-facts-text--in" : "")}>{fact[1]}</div>
      </div>

      <style>{`
        .cn-maint-screen { position: fixed; inset: 0; z-index: 9999; background: #0b2a9a; overflow: hidden; }
        .cn-maint-screen, .cn-maint-screen * { -webkit-tap-highlight-color: transparent; }
        .cn-maint-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 72%; }
        .cn-maint-shade { position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(180deg, rgba(5,15,70,0.55) 0%, rgba(5,15,70,0) 38%, rgba(5,15,70,0) 70%, rgba(5,10,60,0.65) 100%); }
        .cn-maint-sound-btn {
          position: absolute; z-index: 3;
          top: calc(16px + env(safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px));
          right: 16px; outline: none; width: 40px; height: 40px; border-radius: 999px; border: none;
          background: rgba(0,0,0,0.3); color: #fff; display: flex; align-items: center; justify-content: center;
        }
        .cn-maint-sound-btn--music { right: 64px; }
        .cn-maint-card {
          position: absolute; z-index: 2; left: 0; right: 0;
          top: calc(64px + env(safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px));
          margin: 0 auto; padding: 0 24px; max-width: 380px;
          display: flex; flex-direction: column; align-items: center; text-align: center; color: #fff;
          text-shadow: 0 2px 10px rgba(0,0,40,0.55);
        }
        .cn-maint-badge { font-size: 12px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
          background: #ffb81f; color: #3a2400; padding: 6px 14px; border-radius: 999px; text-shadow: none; margin-bottom: 14px;
          box-shadow: 0 4px 14px rgba(255,184,31,0.35); }
        .cn-maint-title { font-size: 30px; font-weight: 900; line-height: 1.1; margin: 0 0 10px; }
        .cn-maint-body { font-size: 15.5px; line-height: 1.45; margin: 0 0 8px; }
        .cn-maint-sub { font-size: 13px; margin: 0; opacity: 0.85; }
        .cn-maint-facts { position: absolute; z-index: 2; left: 0; right: 0;
          bottom: calc(16px + env(safe-area-inset-bottom, 0px)); padding: 0 28px; text-align: center; pointer-events: none; }
        .cn-maint-facts-tag { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase;
          color: #fff; background: rgba(255,255,255,0.18); padding: 4px 10px; border-radius: 999px; margin-bottom: 8px; }
        .cn-maint-facts-text { font-size: 14px; line-height: 1.45; color: #fff; min-height: 60px; text-shadow: 0 1px 8px rgba(0,0,40,0.7);
          opacity: 0; transform: translateY(6px); transition: opacity 0.6s ease, transform 0.6s ease; }
        .cn-maint-facts-text--in { opacity: 1; transform: translateY(0); }
      `}</style>
    </div>
  );
}
