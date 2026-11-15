/* Мультяшна планета: океан, материки, що «обертаються» (стрічка рухається через transform на композиторі),
   хмарки, товсте біле обведення й чорнильна тінь. Статична розмітка: жодного перемальовування React під час тапів. */
import React from "react";

/* Один «тайл» світу 200×200. Фігури не торкаються лівого/правого краю, тому стрічка зшивається без швів. */
function WorldTile() {
  return (
    <svg viewBox="0 0 200 200" className="cc-tile" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g fill="#8ad84f" stroke="#4f9a2f" strokeWidth="2.5" strokeLinejoin="round">
        <path d="M22 62c8-14 28-20 44-14 12 4 18 14 14 26-3 10-14 12-18 22-4 9-16 8-24 2-12-8-24-20-16-36z" />
        <path d="M78 118c10-6 24-4 30 6 6 11 2 28-6 40-6 9-18 8-22-2-5-13-8-33-2-44z" />
        <path d="M112 54c10-10 30-12 44-4 10 6 12 18 4 26-6 6-6 14-16 16-12 3-24-4-32-12-6-6-6-20 0-26z" />
        <path d="M140 108c8-4 20-2 26 6 6 9 4 22-4 28-9 6-22 2-26-8-3-9-2-22 4-26z" />
      </g>
      <g fill="#b7ee7c" opacity="0.8">
        <ellipse cx="46" cy="58" rx="12" ry="5" transform="rotate(-18 46 58)" />
        <ellipse cx="130" cy="58" rx="12" ry="4.5" transform="rotate(-12 130 58)" />
        <ellipse cx="96" cy="128" rx="6" ry="9" />
      </g>
      <g fill="#3f8a2a" opacity="0.55">
        <circle cx="52" cy="74" r="3" /><circle cx="64" cy="66" r="2.4" /><circle cx="94" cy="148" r="3" />
        <circle cx="150" cy="118" r="2.6" /><circle cx="132" cy="70" r="2.4" />
      </g>
      <g fill="#ffffff" opacity="0.9">
        <ellipse cx="30" cy="136" rx="20" ry="7" /><ellipse cx="44" cy="130" rx="14" ry="6" />
        <ellipse cx="164" cy="40" rx="18" ry="6.5" /><ellipse cx="176" cy="46" rx="12" ry="5" />
        <ellipse cx="92" cy="26" rx="16" ry="5.5" />
      </g>
    </svg>
  );
}

export function Planet({ innerRef }) {
  return (
    <div className="cc-planet-wrap">
      <div className="cc-halo" aria-hidden="true" />
      <div className="cc-planet" ref={innerRef}>
        <div className="cc-clip">
          <div className="cc-strip"><WorldTile /><WorldTile /></div>
          <div className="cc-shade" />
        </div>
        <div className="cc-gloss" aria-hidden="true" />
      </div>
    </div>
  );
}
