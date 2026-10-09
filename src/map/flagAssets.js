/* Прапори для карти.

   ЩО ТУТ ВИПРАВЛЕНО (корінні причини "зниклих" прапорів):
   1. Вбудовані дані прапорів — це "внутрішність" SVG (<path>…) без обгортки.
      Стара обгортка не оголошувала xmlns:xlink, а 55 прапорів (Аргентина,
      Уругвай, Венесуела, Мексика, Кенія, Зімбабве, Камерун, Єгипет, Португалія,
      Білорусь, Китай, Індія, Південна Корея, М'янма, Нова Зеландія, країни
      Центральної Азії та Карибів…) мають xlink:href — для браузера це
      помилка XML, тож картинка просто не завантажувалась. Тепер обгортка
      коректна (xmlns + xmlns:xlink + явні width/height).
   2. У даних були вирізані атрибути id, а посилання на них (<use href="#cn-a">,
      clip-path="url(#np-a)") лишились → у Китаю зникли зірки, в Індії спиці
      чакри, у Кореї триграми тощо. Ідентифікатори відновлюються (flagIdMap.js).
   3. Прапори — вектор: на карту вони малюються з SVG під фактичний розмір на
      екрані (а не з маленьких растрових відер), тому не розмиваються при zoom. */

import { FLAG_ID_MAP } from "./flagIdMap.js";

const XMLNS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

/* Повертає внутрішність SVG прапора з відновленими id. */
export function restoreIds(iso, inner) {
  const map = FLAG_ID_MAP[iso];
  if (!map || !inner || inner.includes(`id="${iso}-`)) return inner;
  const byOrdinal = new Map(Object.entries(map).map(([letter, ord]) => [ord, letter]));
  let n = -1;
  return inner.replace(/<([A-Za-z][\w:.-]*)/g, (match, name) => {
    n += 1;
    const letter = byOrdinal.get(n);
    return letter ? `<${name} id="${iso}-${letter}"` : match;
  });
}

/* { iso: inner } → { iso: inner з відновленими id } (нова копія). */
export function repairFlagSvgs(raw) {
  const out = {};
  for (const key of Object.keys(raw || {})) out[key] = restoreIds(key, raw[key]);
  return out;
}

/* Повноцінний окремий SVG-документ для <img>/drawImage. */
export function flagSvgMarkup(inner) {
  return `<svg ${XMLNS} width="512" height="512" viewBox="0 0 512 512">${inner}</svg>`;
}

/* Прапори НЕстандартної форми. Звичайний прапор — суцільний квадрат/прямокутник,
   його можна розтягнути на територію країни. Прапор Непалу — два
   трикутні вимпели з прозорими проміжками, тож "накладання на геометрію"
   залишало частину території без прапора.
   Рішення: такий прапор (1) вписується ЦІЛКОМ (contain) за габаритами
   реального вмісту, (2) решта території заливається "кольором поля" прапора.
   Форму визначаємо автоматично за прозорістю (покриття < SHAPED_COVERAGE),
   а тут можна точково підправити колір/поведінку для конкретної країни. */
export const FLAG_SHAPE_OVERRIDES = {
  np: { field: "#ce0000" }, // колір вимпелів Непалу (як у SVG)
};
const SHAPED_COVERAGE = 0.8;

const TIERS = [32, 64, 128, 256, 512];
const DIRECT_PX = 640; // більші штампи малюємо напряму з вектора — завжди чітко

function loadSvgImage(markup) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg flag failed to load"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
  });
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export class FlagStore {
  constructor(svgByIso) {
    this.svg = svgByIso || {};
    this.images = new Map(); // iso → HTMLImageElement (вектор)
    this.info = new Map(); // iso → { shaped, field, cx, cy, cw, ch }
    this.tiers = new Map(); // `${iso}:${size}` → { canvas, used }
    this.failed = new Set();
    this.epoch = 0;
  }

  has(iso) {
    return this.images.has(iso);
  }

  /* Завантажує всі прапори (паралельно, обмежена кількість одночасно). */
  async loadAll(onProgress) {
    const keys = Object.keys(this.svg);
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < keys.length) {
        const iso = keys[next++];
        try {
          let img;
          try {
            img = await loadSvgImage(flagSvgMarkup(this.svg[iso]));
          } catch {
            // запасний варіант: без <use> (краще прапор без емблеми, ніж без прапора)
            img = await loadSvgImage(flagSvgMarkup(this.svg[iso].replace(/<use\b[^>]*\/>/g, "")));
          }
          this.images.set(iso, img);
          this.info.set(iso, this._analyze(iso, img));
        } catch (err) {
          this.failed.add(iso);
          console.warn("Прапор не завантажився:", iso, err?.message || err);
        }
        done += 1;
        if (onProgress) onProgress(done, keys.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(12, keys.length) }, worker));
  }

  _analyze(iso, img) {
    const N = 64;
    const canvas = makeCanvas(N, N);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const { data } = ctx.getImageData(0, 0, N, N);
    let solid = 0, minX = N, minY = N, maxX = -1, maxY = -1;
    const counts = new Map();
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        const a = data[i + 3];
        if (a > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (a > 200) {
          solid += 1;
          const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
    let best = 0, bestCount = -1;
    counts.forEach((c, k) => { if (c > bestCount) { best = k; bestCount = c; } });
    const r = ((best >> 8) & 15) * 17, g = ((best >> 4) & 15) * 17, b = (best & 15) * 17;
    const coverage = solid / (N * N);
    const override = FLAG_SHAPE_OVERRIDES[iso];
    const shaped = coverage < SHAPED_COVERAGE || Boolean(override?.shaped);
    const has = maxX >= 0;
    return {
      shaped,
      coverage,
      field: override?.field || `rgb(${r},${g},${b})`,
      cx: has ? minX / N : 0,
      cy: has ? minY / N : 0,
      cw: has ? (maxX - minX + 1) / N : 1,
      ch: has ? (maxY - minY + 1) / N : 1,
    };
  }

  /* Малює прапор у квадрат (x, y, s) напряму з вектора. Нестандартні
     прапори вписуються цілком, а поле під ними заливається кольором прапора. */
  drawVector(ctx, iso, x, y, s) {
    const img = this.images.get(iso);
    const info = this.info.get(iso);
    if (!img || !info) return false;
    ctx.fillStyle = info.field; // підкладка: ховає шви між смугами й закриває прозорі проміжки
    ctx.fillRect(x, y, s, s);
    if (!info.shaped) {
      ctx.drawImage(img, x, y, s, s);
    } else {
      const k = s / Math.max(info.cw, info.ch); // розмір повного 512-боксу, щоб вміст рівно влізав у квадрат
      ctx.drawImage(img, x + s / 2 - (info.cx + info.cw / 2) * k, y + s / 2 - (info.cy + info.ch / 2) * k, k, k);
    }
    return true;
  }

  _tier(iso, devPx) {
    const size = TIERS.find((t) => t >= devPx) || TIERS[TIERS.length - 1];
    const key = `${iso}:${size}`;
    let entry = this.tiers.get(key);
    if (!entry) {
      const canvas = makeCanvas(size, size);
      this.drawVector(canvas.getContext("2d"), iso, 0, 0, size);
      entry = { canvas, used: this.epoch };
      this.tiers.set(key, entry);
    }
    entry.used = this.epoch;
    return entry.canvas;
  }

  /* Малює штамп прапора розміром s (у координатах ctx) — devPx = скільки
     це фізичних пікселів (щоб обрати відповідну якість). */
  stamp(ctx, iso, x, y, s, devPx) {
    if (!this.images.has(iso)) return false;
    if (devPx > DIRECT_PX) return this.drawVector(ctx, iso, x, y, s);
    ctx.drawImage(this._tier(iso, devPx), x, y, s, s);
    return true;
  }

  /* Викликається після кожного запікання: звільняє великі растри, які давно не потрібні. */
  endEpoch() {
    this.epoch += 1;
    for (const [key, entry] of this.tiers) {
      const size = Number(key.slice(key.indexOf(":") + 1));
      if (size >= 256 && entry.used < this.epoch - 2) this.tiers.delete(key);
    }
  }

  /* Вихід з екрана карти: великі растри не тримаємо, розкодовані SVG-прапори лишаються. */
  releaseTiers() {
    this.tiers.clear();
  }

  /* Значок-прапорець для підписів на карті (дрібні країни/далекі острови). */
  badgeImageData(iso, w = 88, h = 66) {
    if (!this.images.has(iso)) return null;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    const pad = 4, r = 8;
    const iw = w - pad * 2, ih = h - pad * 2;
    // тінь + біла рамка
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(1, 1, w - 2, h - 2, r) : ctx.rect(1, 1, w - 2, h - 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    // сам прапор (cover по вікну 4:3)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(pad, pad, iw, ih, r - 3) : ctx.rect(pad, pad, iw, ih);
    ctx.clip();
    const sq = makeCanvas(iw, iw);
    this.drawVector(sq.getContext("2d"), iso, 0, 0, iw);
    ctx.drawImage(sq, 0, (iw - ih) / 2, iw, ih, pad, pad, iw, ih);
    ctx.restore();
    return ctx.getImageData(0, 0, w, h);
  }
}
