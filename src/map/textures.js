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

/* Вода: насичений синій з ледь помітними хвилями та світлими відблисками. */
export function waterTexture(baseColor = "#17608f") {
  const size = 128;
  const c = makeCanvas(size);
  const g = c.getContext("2d");
  g.fillStyle = baseColor;
  g.fillRect(0, 0, size, size);
  const rand = rng(7);
  // м'які плями глибини
  for (let i = 0; i < 10; i++) {
    const x = rand() * size, y = rand() * size, r = 18 + rand() * 26;
    const dark = rand() < 0.5;
    wrapDraw(size, x, y, r, (X, Y) => {
      const grad = g.createRadialGradient(X, Y, 0, X, Y, r);
      grad.addColorStop(0, dark ? "rgba(5,30,60,0.22)" : "rgba(120,200,255,0.12)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(X - r, Y - r, r * 2, r * 2);
    });
  }
  // хвилі: короткі дуги
  g.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    const x = rand() * size, y = rand() * size, w = 8 + rand() * 12;
    const alpha = 0.10 + rand() * 0.14, lw = 1 + rand() * 0.8;
    wrapDraw(size, x, y, w, (X, Y) => {
      g.strokeStyle = `rgba(190,230,255,${alpha})`;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(X - w, Y);
      g.quadraticCurveTo(X - w / 2, Y - 3, X, Y);
      g.quadraticCurveTo(X + w / 2, Y + 3, X + w, Y);
      g.stroke();
    });
  }
  return { size, data: g.getImageData(0, 0, size, size) };
}

/* Суша: прозора плитка з травою, плямами та крапками — накладається на колір області. */
export function landTexture() {
  const size = 128;
  const c = makeCanvas(size);
  const g = c.getContext("2d");
  const rand = rng(21);
  for (let i = 0; i < 14; i++) {
    const x = rand() * size, y = rand() * size, r = 16 + rand() * 24;
    const light = rand() < 0.5;
    wrapDraw(size, x, y, r, (X, Y) => {
      const grad = g.createRadialGradient(X, Y, 0, X, Y, r);
      grad.addColorStop(0, light ? "rgba(235,250,190,0.22)" : "rgba(25,60,25,0.22)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(X - r, Y - r, r * 2, r * 2);
    });
  }
  g.lineCap = "round";
  for (let i = 0; i < 260; i++) {
    const x = rand() * size, y = rand() * size, len = 2.5 + rand() * 4;
    const ang = -Math.PI / 2 + (rand() - 0.5) * 0.9;
    const dark = rand() < 0.6;
    const a = 0.2 + rand() * 0.2;
    wrapDraw(size, x, y, len, (X, Y) => {
      g.strokeStyle = dark ? `rgba(30,70,30,${a})` : `rgba(225,245,170,${a})`;
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(X, Y);
      g.lineTo(X + Math.cos(ang) * len, Y + Math.sin(ang) * len);
      g.stroke();
    });
  }
  for (let i = 0; i < 40; i++) {
    const x = rand() * size, y = rand() * size;
    const a = 0.08 + rand() * 0.1;
    wrapDraw(size, x, y, 2, (X, Y) => {
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.arc(X, Y, 0.9, 0, Math.PI * 2);
      g.fill();
    });
  }
  return { size, data: g.getImageData(0, 0, size, size) };
}
