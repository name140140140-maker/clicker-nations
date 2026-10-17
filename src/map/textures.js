/* Процедурні текстури карти (без зовнішніх файлів): хвилі води й трава/рельєф суші.
   Плитки безшовні: кожен штрих малюється з дублюванням через край. */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

// Малює фігуру з дублюванням на сусідні плитки, щоб шов не було видно.
function wrapDraw(size, x, y, r, draw) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const X = x + dx, Y = y + dy;
      if (X + r < 0 || X - r > size || Y + r < 0 || Y - r > size) continue;
      draw(X, Y);
    }
  }
}

// Нерівна «мазкова» пляма: многокутник із випадковим радіусом (виглядає як мазок пензля).
function blob(g, x, y, r, rand, fill) {
  const n = 16;
  g.beginPath();
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (0.8 + rand() * 0.35);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.8;
    if (k === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

/* Вода: насичений яскраво-синій мультяшний океан із мазковою (малярською) текстурою. */
export function waterTexture(baseColor = "#1457c2") {
  const size = 128;
  const c = makeCanvas(size);
  const g = c.getContext("2d");
  g.fillStyle = baseColor;
  g.fillRect(0, 0, size, size);
  const rand = rng(7);
  // великі м'які плями глибини: темніший і світліший синій
  for (let i = 0; i < 9; i++) {
    const x = rand() * size, y = rand() * size, r = 22 + rand() * 28;
    const dark = rand() < 0.55;
    wrapDraw(size, x, y, r, (X, Y) => {
      const grad = g.createRadialGradient(X, Y, 0, X, Y, r);
      grad.addColorStop(0, dark ? "rgba(6,38,130,0.30)" : "rgba(70,170,255,0.20)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(X - r, Y - r, r * 2, r * 2);
    });
  }
  // дрібні мазки пензля
  for (let i = 0; i < 70; i++) {
    const x = rand() * size, y = rand() * size, r = 4 + rand() * 9;
    const dark = rand() < 0.5;
    const a = 0.05 + rand() * 0.09;
    wrapDraw(size, x, y, r, (X, Y) => blob(g, X, Y, r, rand, dark ? `rgba(8,45,150,${a})` : `rgba(90,185,255,${a})`));
  }
  return { size, data: g.getImageData(0, 0, size, size) };
}

/* Суша: прозора плитка з моховою/пензлевою текстурою — накладається на колір області
   (на вільних землях це яскраво-салатовий мультяшний мох, на зайнятих — ледь помітна). */
export function landTexture() {
  const size = 128;
  const c = makeCanvas(size);
  const g = c.getContext("2d");
  const rand = rng(21);
  for (let i = 0; i < 12; i++) {
    const x = rand() * size, y = rand() * size, r = 20 + rand() * 26;
    const light = rand() < 0.5;
    wrapDraw(size, x, y, r, (X, Y) => {
      const grad = g.createRadialGradient(X, Y, 0, X, Y, r);
      grad.addColorStop(0, light ? "rgba(214,255,110,0.30)" : "rgba(20,100,10,0.28)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(X - r, Y - r, r * 2, r * 2);
    });
  }
  // «моховий» ворс: багато дрібних плямок двох відтінків
  for (let i = 0; i < 150; i++) {
    const x = rand() * size, y = rand() * size, r = 2 + rand() * 5;
    const light = rand() < 0.5;
    const a = 0.16 + rand() * 0.2;
    wrapDraw(size, x, y, r, (X, Y) => blob(g, X, Y, r, rand, light ? `rgba(220,255,120,${a})` : `rgba(25,110,12,${a})`));
  }
  g.lineCap = "round";
  for (let i = 0; i < 120; i++) {
    const x = rand() * size, y = rand() * size, len = 2 + rand() * 4;
    const ang = rand() * Math.PI * 2;
    const a = 0.14 + rand() * 0.16;
    wrapDraw(size, x, y, len, (X, Y) => {
      g.strokeStyle = `rgba(235,255,150,${a})`;
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(X, Y);
      g.lineTo(X + Math.cos(ang) * len, Y + Math.sin(ang) * len);
      g.stroke();
    });
  }
  return { size, data: g.getImageData(0, 0, size, size) };
}
