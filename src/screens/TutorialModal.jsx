import { useState, useEffect, useRef, startTransition } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { cnSfx, t } from "../app/shared.jsx";
import { setTick, clearTick } from "../core/ticker.js";



/* ------------------------------------------------------------------ */
/*  Season banner artwork (embedded)                                   */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/*  Tutorial mentor portraits (embedded)                               */
/* ------------------------------------------------------------------ */

const GLOBY_IDLE_IMG = "/img/globy-idle-img.jpg";

const GLOBY_POINT_IMG = "/img/globy-point-img.jpg";

const GLOBY_WAVE2_IMG = "/img/globy-wave2-img.jpg";

const GLOBY_WAVE_IMG = "/img/globy-wave-img.jpg";

const GLOBY_PRESENT_IMG = "/img/globy-present-img.jpg";


/* ------------------------------------------------------------------ */
/*  Tutorial script                                                     */
/* ------------------------------------------------------------------ */

const TUTORIAL_STEPS = [
  { img: GLOBY_WAVE2_IMG, tab: "clicker", target: null, pos: "center",
    title: { uk: "Привіт, {name}!", en: "Hi, {name}!", ru: "Привет, {name}!" },
    text: { uk: "Мене звати Глобі. Я покажу, як тут усе працює, і це займе хвилину.", en: "My name is Globby. I'll show you how everything works. It'll take a minute.", ru: "Меня зовут Глоби. Я покажу, как тут всё устроено, это займёт минуту." } },
  { img: GLOBY_POINT_IMG, tab: "clicker", target: "globe", pos: "top",
    title: { uk: "Це твій глобус", en: "This is your globe", ru: "Это твой глобус" },
    text: { uk: "Натискай на нього. За кожен клік ти отримуєш Power.", en: "Tap it. Every tap gives you Power.", ru: "Нажимай на него. За каждый клик ты получаешь Power." } },
  { img: GLOBY_POINT_IMG, tab: "clicker", target: "power", pos: "bottom",
    title: { uk: "Power і Points", en: "Power and Points", ru: "Power и Points" },
    text: { uk: "Power визначає твоє місце в рейтингу. Points ти отримуєш за нагороди сезону й витрачаєш на покращення.", en: "Power sets your place in the ranking. You get Points from season rewards and spend them on upgrades.", ru: "Power определяет твоё место в рейтинге. Points ты получаешь за награды сезона и тратишь на улучшения." } },
  { img: GLOBY_IDLE_IMG, tab: "clicker", target: "energy", pos: "top",
    title: { uk: "Енергія", en: "Energy", ru: "Энергия" },
    text: { uk: "Кожен клік коштує 1 енергії. Вона відновлюється сама, тож просто заходь у гру частіше.", en: "Each tap costs 1 energy. It refills on its own, so just visit more often.", ru: "Каждый клик стоит 1 энергии. Она восстанавливается сама, так что просто заходи в игру чаще." } },
  { img: GLOBY_POINT_IMG, tab: "clicker", target: "actions", pos: "bottom",
    title: { uk: "Кнопки вгорі", en: "Top buttons", ru: "Кнопки сверху" },
    text: { uk: "Тут рейтинг, підтримка в Telegram і новини гри.", en: "Here you'll find the ranking, Telegram support and game news.", ru: "Здесь рейтинг, поддержка в Telegram и новости игры." } },
  { img: GLOBY_PRESENT_IMG, tab: "map", target: null, pos: "top",
    title: { uk: "Карта", en: "The map", ru: "Карта" },
    text: { uk: "Тут видно території всіх країн. Торкнись міста чи області, щоб дізнатись, кому вони належать.", en: "Here you can see every country's territory. Tap a city or region to see who owns it.", ru: "Здесь видны территории всех стран. Нажми на город или область, чтобы узнать, кому они принадлежат." } },
  { img: GLOBY_PRESENT_IMG, tab: "hq", target: "hq-dev", pos: "bottom",
    title: { uk: "Штаб країни", en: "Country HQ", ru: "Штаб страны" },
    text: { uk: "У «Покращеннях» ти за Points збільшуєш енергію та міцність міст.", en: "In 'Upgrades' you spend Points to boost your energy and city defense.", ru: "В «Улучшениях» ты за Points увеличиваешь энергию и крепость городов." } },
  { img: GLOBY_POINT_IMG, tab: "hq", target: "hq-army", pos: "top",
    title: { uk: "Війни", en: "Wars", ru: "Войны" },
    text: { uk: "Війну оголошує лідер країни. Спочатку йде підготовка, потім бій. Країну, яка вже воює, атакувати не можна.", en: "The country's leader declares wars. First comes preparation, then the battle. A country already at war can't be attacked.", ru: "Войну объявляет лидер страны. Сначала подготовка, потом бой. Страну, которая уже воюет, атаковать нельзя." } },
  { img: GLOBY_PRESENT_IMG, tab: "hq", target: "hq-diplomacy", pos: "top",
    title: { uk: "Дипломатія", en: "Diplomacy", ru: "Дипломатия" },
    text: { uk: "Тут лідер домовляється з іншими країнами та кличе союзників на допомогу.", en: "Here the leader makes deals with other countries and calls allies for help.", ru: "Здесь лидер договаривается с другими странами и зовёт союзников на помощь." } },
  { img: GLOBY_POINT_IMG, tab: "hq", target: "hq-mail", pos: "top",
    title: { uk: "Пошта", en: "Mail", ru: "Почта" },
    text: { uk: "Сюди приходять листи від гри та адміністрації.", en: "Letters from the game and admins arrive here.", ru: "Сюда приходят письма от игры и администрации." } },
  { img: GLOBY_POINT_IMG, tab: "hq", target: "hq-settings", pos: "top",
    title: { uk: "Налаштування", en: "Settings", ru: "Настройки" },
    text: { uk: "Тут звук і мова. Якщо щось забудеш, туторіал можна пройти ще раз.", en: "Sound and language are here. If you forget something, you can replay this tutorial.", ru: "Здесь звук и язык. Если что-то забудешь, туториал можно пройти ещё раз." } },
  { img: GLOBY_PRESENT_IMG, tab: "season", target: "season-banner", pos: "bottom",
    title: { uk: "Сезон", en: "Season", ru: "Сезон" },
    text: { uk: "Кліками ти піднімаєш рівень і забираєш нагороди. Сезон триває 50 днів.", en: "Your taps raise your level and unlock rewards. The season lasts 50 days.", ru: "Кликами ты повышаешь уровень и забираешь награды. Сезон длится 50 дней." } },
  { img: GLOBY_POINT_IMG, tab: "shop", target: "premium-offer", pos: "bottom",
    title: { uk: "Premium Pass", en: "Premium Pass", ru: "Premium Pass" },
    text: { uk: "Дає більше нагород і красивий нік. Він необов'язковий, грати можна й без нього.", en: "Gives you more rewards and a fancy nickname. It's optional, you can play without it.", ru: "Даёт больше наград и красивый ник. Он необязателен, играть можно и без него." } },
  { img: GLOBY_PRESENT_IMG, tab: "profile", target: "prof-cosm", pos: "top",
    title: { uk: "Профіль", en: "Profile", ru: "Профиль" },
    text: { uk: "У «Косметиці» обирай фото, банер, титул і колір ніка. Закриті нагороди теж видно, а підказка скаже, як їх відкрити.", en: "In 'Cosmetics' pick your avatar, banner, title and nickname color. Locked items are visible too, and a hint shows how to unlock them.", ru: "В «Косметике» выбирай фото, баннер, титул и цвет ника. Закрытые награды тоже видны, а подсказка скажет, как их открыть." } },
  { img: GLOBY_WAVE_IMG, tab: "clicker", target: null, pos: "center",
    title: { uk: "Це все, {name}!", en: "That's it, {name}!", ru: "Это всё, {name}!" },
    text: { uk: "Тепер ти знаєш, де що лежить. Клікай, піднімайся в рейтингу й розвивай свою країну. Успіхів!", en: "Now you know where everything is. Tap, climb the ranking and grow your country. Good luck!", ru: "Теперь ты знаешь, где что лежит. Кликай, поднимайся в рейтинге и развивай свою страну. Успехов!" } },
];

function tutPick(obj, lang) { return obj[lang] || obj.en || obj.uk; }


export function TutorialModal({ onClose, lang = "uk", setTab, name = "" }) {
  const [step, setStep] = useState(0);
  const [typingDone, setTypingDone] = useState(false);
  const textRef = useRef(null);
  const [rect, setRect] = useState(null);
  const total = TUTORIAL_STEPS.length;
  const current = TUTORIAL_STEPS[step];
  const playerName = String(name || "").trim() || (lang === "uk" ? "друже" : lang === "ru" ? "друг" : "friend");
  const currentTitle = tutPick(current.title, lang).replace("{name}", playerName);
  const currentText = tutPick(current.text, lang).replace("{name}", playerName);
  const isLast = step === total - 1;
  const typeTimerRef = useRef(null);
  const vh = typeof window !== "undefined" ? window.innerHeight : 700;
  const isCenter = current.pos === "center";
  const guided = !!current.target;

  /* Глобі сам переводить гравця на потрібну вкладку. */
  useEffect(() => {
    if (current.tab && setTab) startTransition(() => setTab(current.tab));
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Шукаємо на екрані елемент, на який вказує Глобі, і стежимо за його положенням. */
  useEffect(() => {
    setRect(null);
    if (!current.target) return undefined;
    let scrolled = false;
    const measure = () => {
      const el = document.querySelector('[data-tut="' + current.target + '"]');
      if (!el) { setRect(null); return; }
      if (!scrolled) {
        scrolled = true;
        try { el.scrollIntoView({ block: "center", behavior: "auto" }); } catch (e) { /* ignore */ }
      }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) { setRect(null); return; }
      setRect((prev) =>
        prev && Math.abs(prev.x - r.left) < 1 && Math.abs(prev.y - r.top) < 1 && Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { x: r.left, y: r.top, w: r.width, h: r.height }
      );
    };
    const first = setTimeout(measure, 80);
    const iv = setTick(measure, 400);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(first); clearTick(iv); window.removeEventListener("resize", measure); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Заздалегідь декодуємо всі пози, щоб зміна кроку не гальмувала. */
  const preloadRef = useRef([]);
  useEffect(() => {
    preloadRef.current = [GLOBY_IDLE_IMG, GLOBY_POINT_IMG, GLOBY_WAVE_IMG, GLOBY_WAVE2_IMG, GLOBY_PRESENT_IMG].map((src) => {
      const im = new Image();
      im.src = src;
      try { if (im.decode) im.decode().catch(() => {}); } catch (e) { /* ignore */ }
      return im;
    });
  }, []);

  /* Друкарський ефект іде напряму в DOM (без перерендеру React на кожну літеру) через rAF. */
  useEffect(() => {
    const el = textRef.current;
    const full = currentText;
    setTypingDone(false);
    if (!el) return undefined;
    el.textContent = "";
    let raf = 0;
    let lastN = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const n = Math.min(full.length, Math.floor((now - t0) / 18) + 1);
      if (n !== lastN) {
        el.textContent = full.slice(0, n);
        if (Math.floor(n / 4) !== Math.floor(lastN / 4)) cnSfx.blip();
        lastN = n;
      }
      if (n >= full.length) { setTypingDone(true); return; }
      raf = requestAnimationFrame(tick);
    };
    // даємо першому кадру нового кроку відмалюватись, потім починаємо друк
    raf = requestAnimationFrame(tick);
    typeTimerRef.current = () => cancelAnimationFrame(raf);
    return () => cancelAnimationFrame(raf);
  }, [step, currentText]);

  const skipTyping = () => {
    if (typeof typeTimerRef.current === "function") typeTimerRef.current();
    if (textRef.current) textRef.current.textContent = currentText;
    setTypingDone(true);
  };

  const finish = () => {
    if (setTab) startTransition(() => setTab("clicker"));
    onClose();
  };
  const next = () => {
    if (isLast) {
      cnSfx.fanfare();
      finish();
    } else {
      cnSfx.step();
      setStep((s) => Math.min(s + 1, total - 1));
    }
  };
  const prev = () => {
    cnSfx.step();
    setStep((s) => Math.max(s - 1, 0));
  };
  const handleSkipTutorial = () => {
    cnSfx.skip();
    finish();
  };

  /* Картку ставимо туди, де більше вільного місця відносно підсвіченого елемента. */
  const place = current.pos === "bottom" ? "bottom" : "top";
  const showArrow = rect && rect.h < vh * 0.45;
  const overlayCls =
    "cn-tutorial-overlay" +
    (isCenter ? "" : " cn-tutorial-overlay--guided cn-tutorial-overlay--" + place) +
    (!isCenter && !guided ? " cn-tutorial-overlay--free" : "") +
    (guided && !rect ? " cn-tutorial-overlay--dim" : "");

  return (
    <div className={overlayCls} role="dialog" aria-modal="true">
      {guided && rect && (
        <>
          <div
            className="cn-tut-spot"
            style={{ width: rect.w + 12, height: rect.h + 12, transform: `translate3d(${rect.x - 6}px, ${rect.y - 6}px, 0)` }}
          />
          {showArrow && (
            <span
              className={"cn-tut-arrow cn-tut-arrow--" + (place === "bottom" ? "up" : "down")}
              style={{ transform: `translate3d(${rect.x + rect.w / 2 - 14}px, ${place === "bottom" ? rect.y + rect.h + 8 : rect.y - 38}px, 0)` }}
            />
          )}
        </>
      )}
      <div className={"cn-tutorial-card cn-tutorial-card--enter" + (isCenter ? "" : " cn-tutorial-card--compact")}>
        <button className="cn-tutorial-skip" type="button" onClick={handleSkipTutorial} aria-label={t(lang, "tutorial_skip_btn")}>
          <X size={16} /> {t(lang, "tutorial_skip_btn")}
        </button>

        <div className={"cn-tutorial-portrait-wrap"}>
          <div className="cn-tutorial-frame">
            <img key={step} src={current.img} alt={t(lang, "tutorial_mentor_name")} className="cn-tutorial-portrait" draggable={false} decoding="async" />
          </div>
        </div>
        <div className="cn-tutorial-name-tag">{t(lang, "tutorial_mentor_name")} · {step + 1}/{total}</div>

        <div key={step} className="cn-tutorial-bubble cn-tutorial-bubble--enter" onClick={skipTyping}>
          <div className="cn-tutorial-title">{currentTitle}</div>
          <div className="cn-tutorial-text">
            <span ref={textRef} />
            {!typingDone && <span className="cn-tutorial-caret" />}
          </div>
        </div>

        <div className="cn-tutorial-dots">
          {TUTORIAL_STEPS.map((_, i) => (
            <span key={i} className={"cn-tutorial-dot" + (i === step ? " cn-tutorial-dot--active" : "")} />
          ))}
        </div>

        <div className="cn-tutorial-actions">
          {step > 0 ? (
            <button className="cn-tutorial-btn cn-tutorial-btn--ghost" type="button" onClick={prev}>
              <ChevronLeft size={18} /> {t(lang, "tutorial_back_btn")}
            </button>
          ) : (
            <span />
          )}
          <button className="cn-primary-btn cn-tutorial-btn--next cn-tutorial-btn--pulse" type="button" onClick={next}>
            <span className="cn-primary-btn-label">{isLast ? t(lang, "tutorial_start_btn") : t(lang, "tutorial_next_btn")}</span>
            <ChevronRight size={20} className="cn-primary-btn-chevron" />
          </button>
        </div>
      </div>
    </div>
  );
}
