import { mkdir, writeFile, rm, readdir, readFile, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mapshaper from "mapshaper";
import iso from "i18n-iso-countries";
import streamJson from "stream-json";
import { pick } from "stream-json/filters/Pick.js";
import { streamArray } from "stream-json/streamers/StreamArray.js";

const { parser } = streamJson;

// CGAZ = Comprehensive Global Administrative Zones (geoBoundaries), ADM1
// (області/провінції), уже узгоджені між сусідніми країнами (без дірок).
const CGAZ_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/CGAZ/geoBoundariesCGAZ_ADM1.geojson";

const DATA_DIR = new URL("../public/data/", import.meta.url);
const OUTPUT_PATH = new URL("../public/data/world-regions.geojson", import.meta.url);
const SIMPLIFY_PERCENT = "8%";

const RAW_PATH = join(tmpdir(), "geoBoundariesCGAZ_ADM1.geojson");
const SPLIT_DIR = join(tmpdir(), "cgaz-split");
const SIMPLIFIED_DIR = join(tmpdir(), "cgaz-simplified");
const RAW_MIN_BYTES = 300_000_000; // CGAZ ADM1 ~343.8 МБ на сервері

// ВАЖЛИВО: чому саме такий поділ на групи — див. коментар у CONTINENT_GROUPS
// нижче. Шов теоретично можливий лише на межі груп: Єгипет/Ізраїль і
// Панама/Колумбія. Океанія — острови, сухопутних кордонів ні з ким немає.
const CONTINENT_GROUPS = {
  eurasia: [
    "ALB", "AND", "AUT", "BLR", "BEL", "BIH", "BGR", "HRV", "CYP", "CZE",
    "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "ISL", "IRL", "ITA",
    "XKX", "LVA", "LIE", "LTU", "LUX", "MLT", "MDA", "MCO", "MNE", "NLD",
    "MKD", "NOR", "POL", "PRT", "ROU", "RUS", "SMR", "SRB", "SVK", "SVN",
    "ESP", "SWE", "CHE", "UKR", "GBR", "VAT",
    "GEO", "ARM", "AZE",
    "TUR", "SYR", "LBN", "ISR", "PSE", "JOR", "IRQ", "IRN", "SAU", "YEM",
    "OMN", "ARE", "QAT", "BHR", "KWT",
    "KAZ", "UZB", "TKM", "TJK", "KGZ", "AFG", "PAK", "IND", "NPL", "BTN",
    "BGD", "LKA", "MDV",
    "CHN", "MNG", "PRK", "KOR", "JPN", "TWN", "HKG", "MAC",
    "MMR", "THA", "LAO", "KHM", "VNM", "MYS", "SGP", "IDN", "PHL", "BRN", "TLS",
  ],
  africa: [
    "DZA", "EGY", "LBY", "TUN", "MAR", "ESH", "SDN", "SSD", "ETH", "ERI",
    "DJI", "SOM", "KEN", "UGA", "TZA", "RWA", "BDI", "COD", "COG", "GAB",
    "GNQ", "CMR", "CAF", "TCD", "NER", "NGA", "BEN", "TGO", "GHA", "CIV",
    "LBR", "SLE", "GIN", "GNB", "SEN", "GMB", "MLI", "BFA", "MRT", "ZAF",
    "NAM", "BWA", "ZWE", "ZMB", "MWI", "MOZ", "SWZ", "LSO", "AGO", "MDG",
    "COM", "MUS", "SYC", "CPV", "STP",
  ],
  north_america: [
    "CAN", "USA", "MEX", "GTM", "BLZ", "HND", "SLV", "NIC", "CRI", "PAN",
    "CUB", "JAM", "HTI", "DOM", "BHS", "TTO", "BRB", "LCA", "VCT", "GRD",
    "DMA", "ATG", "KNA", "GRL", "PRI",
  ],
  south_america: [
    "COL", "VEN", "GUY", "SUR", "ECU", "PER", "BRA", "BOL", "PRY", "CHL",
    "ARG", "URY",
  ],
  oceania: [
    "AUS", "NZL", "PNG", "FJI", "SLB", "VUT", "NCL", "PYF", "WSM", "TON",
    "KIR", "TUV", "NRU", "PLW", "FSM", "MHL",
  ],
};

const CONTINENT_BY_ISO3 = {};
for (const [continent, codes] of Object.entries(CONTINENT_GROUPS)) {
  for (const code of codes) CONTINENT_BY_ISO3[code] = continent;
}
const CONTINENT_NAMES = [...Object.keys(CONTINENT_GROUPS), "other"];

// ПРИЧИНА ГОРИЗОНТАЛЬНИХ ЛІНІЙ НА КАРТІ: Росія і Фіджі — єдині дві країни,
// чия територія фізично перетинає лінію 180° довготи (антимеридіан). Без
// розрізання координати "перескакують" з +179° на -179°, і рендерер малює
// пряму лінію через увесь світ замість двох окремих шматків фігури.
// Перевірено на синтетичних тестах (прямокутник через 180°, звичайна форма
// без перетину, ціла геометрія Polygon/MultiPolygon, з дірками) — усі 5
// тестів пройшли, перш ніж цей код потрапив сюди.
function splitRingAtAntimeridian(ring) {
  const unwrapped = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    let [lon, lat] = ring[i];
    const prevLon = unwrapped[i - 1][0];
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    unwrapped.push([lon, lat]);
  }

  const lons = unwrapped.map((p) => p[0]);
  const maxLon = Math.max(...lons);
  const minLon = Math.min(...lons);
  if (maxLon <= 180 && minLon >= -180) return [ring];

  const cutX = maxLon > 180 ? 180 : -180;
  const shift = maxLon > 180 ? -360 : 360;

  function intersect(a, b) {
    const t = (cutX - a[0]) / (b[0] - a[0]);
    return [cutX, a[1] + t * (b[1] - a[1])];
  }
  function clip(keepBeyond) {
    const out = [];
    for (let i = 0; i < unwrapped.length; i++) {
      const curr = unwrapped[i];
      const prev = unwrapped[(i - 1 + unwrapped.length) % unwrapped.length];
      const currBeyond = maxLon > 180 ? curr[0] > cutX : curr[0] < cutX;
      const prevBeyond = maxLon > 180 ? prev[0] > cutX : prev[0] < cutX;
      const currInside = keepBeyond ? currBeyond : !currBeyond;
      const prevInside = keepBeyond ? prevBeyond : !prevBeyond;
      if (currInside) {
        if (!prevInside) out.push(intersect(prev, curr));
        out.push(curr);
      } else if (prevInside) {
        out.push(intersect(prev, curr));
      }
    }
    if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) {
      out.push(out[0]);
    }
    return out;
  }

  const near = clip(false);
  const far = clip(true).map(([lon, lat]) => [lon + shift, lat]);
  return [near, far].filter((r) => r.length >= 4);
}

function splitPolygonRings(rings) {
  const outerParts = splitRingAtAntimeridian(rings[0]);
  if (outerParts.length === 1) {
    const holes = rings.slice(1).flatMap((h) => splitRingAtAntimeridian(h));
    return [[outerParts[0], ...holes]];
  }
  const holes = rings.slice(1);
  return outerParts.map((outerRing) => {
    const outerLons = outerRing.map((p) => p[0]);
    const outerMinLon = Math.min(...outerLons);
    const outerMaxLon = Math.max(...outerLons);
    const matchedHoles = holes
      .filter((hole) => hole[0][0] >= outerMinLon - 1 && hole[0][0] <= outerMaxLon + 1)
      .flatMap((h) => splitRingAtAntimeridian(h));
    return [outerRing, ...matchedHoles];
  });
}

function splitGeometryAtAntimeridian(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === "Polygon") {
    const polygons = splitPolygonRings(geometry.coordinates);
    if (polygons.length === 1) return geometry;
    return { type: "MultiPolygon", coordinates: polygons };
  }
  if (geometry.type === "MultiPolygon") {
    const allPolygons = geometry.coordinates.flatMap((rings) => splitPolygonRings(rings));
    return { type: "MultiPolygon", coordinates: allPolygons };
  }
  return geometry;
}

// Ручні винятки для кодів, яких немає у звичайному ISO3->ISO2 довіднику:
// - "111".."129" — внутрішні числові коди CGAZ для спірних/нічийних
//   територій без офіційного власника. Рішення, кому їх віддати на карті,
//   ухвалено окремо (не технічне питання).
// - "XKX" — Косово: реальна країна, але без стандартного ISO-коду через
//   часткове міжнародне визнання. XK — загальновживаний неофіційний код.
const MANUAL_ISO_OVERRIDES = {
  "111": "SD", // Абьєй -> Судан
  "112": "CN", // Аксай-Чин -> Китай
  "113": "CN", // CH-IN -> Китай
  "114": "IN", // Демчок -> Індія
  "115": "SI", // Драгоня -> Словенія
  "116": "BT", // Драмана-Шакатое -> Бутан
  "117": "GB", // Фолклендські острови -> Велика Британія
  "118": "PS", // Смуга Гази -> Палестина
  "119": "IN", // Калапані -> Індія
  "120": "AR", // Ісла-Бразілера -> Аргентина
  "121": "IN", // Сіачен-Салторо -> Індія
  "122": "BF", // Куалу -> Буркіна-Фасо
  "123": "KR", // Скелі Ляонкур -> Південна Корея
  "124": "IL", // "Нічийна земля" -> Ізраїль
  "125": "CN", // Парасельські острови -> Китай
  "126": "SA", // Санафір і Тіран -> Саудівська Аравія
  "127": "JP", // Сенкаку -> Японія
  "128": "CN", // Острови Спратлі -> Китай
  "129": "PS", // Західний берег -> Палестина
  XKX: "XK", // Косово
};

async function fileExistsAndLooksComplete(path, minBytes = RAW_MIN_BYTES) {
  try {
    const info = await stat(path);
    return info.size >= minBytes;
  } catch {
    return false;
  }
}

async function downloadToFile(url, destPath) {
  console.log(`Завантажую ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} для ${url}`);
  const size = response.headers.get("content-length");
  if (size) console.log(`Розмір на сервері: ${(Number(size) / (1024 * 1024)).toFixed(1)} МБ`);
  await finished(Readable.fromWeb(response.body).pipe(createWriteStream(destPath)));
  console.log(`Збережено у ${destPath}`);
}

// Розкладання по континентах роблю "вручну" на звичайних Node-потоках
// (stream-json), а НЕ через mapshaper -each/-split. Причина: попередні
// спроби впирались або в нестачу пам'яті (весь світ одним шматком), або в
// крихкий текстовий розбір команди mapshaper (величезний список кодів країн
// в одному рядку плутав його внутрішній парсер). Тут кожна область читається
// й одразу дописується у свій файл по одній, без утримання всього в пам'яті.
async function splitByContinent() {
  await rm(SPLIT_DIR, { recursive: true, force: true });
  await mkdir(SPLIT_DIR, { recursive: true });

  const writers = new Map();
  const counts = new Map();
  for (const name of CONTINENT_NAMES) {
    const ws = createWriteStream(join(SPLIT_DIR, `${name}.geojson`));
    ws.write('{"type":"FeatureCollection","features":[');
    writers.set(name, { stream: ws, wroteFirst: false });
    counts.set(name, 0);
  }

  const pipeline = createReadStream(RAW_PATH)
    .pipe(parser())
    .pipe(pick({ filter: "features" }))
    .pipe(streamArray());

  await new Promise((resolve, reject) => {
    pipeline.on("data", ({ value: feature }) => {
      const shapeGroup = feature?.properties?.shapeGroup;
      const continent = CONTINENT_BY_ISO3[shapeGroup] || "other";
      const entry = writers.get(continent);
      const json = JSON.stringify(feature);
      entry.stream.write((entry.wroteFirst ? "," : "") + json);
      entry.wroteFirst = true;
      counts.set(continent, counts.get(continent) + 1);
    });
    pipeline.on("end", resolve);
    pipeline.on("error", reject);
  });

  await Promise.all(
    [...writers.values()].map(
      ({ stream }) =>
        new Promise((resolve, reject) => {
          stream.end("]}", (err) => (err ? reject(err) : resolve()));
        }),
    ),
  );

  for (const [name, count] of counts) {
    console.log(`  ${name}: ${count} областей`);
  }
}

async function main() {
  // 1. Качаємо CGAZ на диск, якщо його ще нема (кеш на час налагодження).
  if (await fileExistsAndLooksComplete(RAW_PATH)) {
    console.log(`Файл уже є на диску (${RAW_PATH}), повторно не качаю.`);
  } else {
    await downloadToFile(CGAZ_URL, RAW_PATH);
  }

  // 2. Розкладаємо по континентальних групах, по одній області за раз
  // (без утримання всього файлу в пам'яті одночасно).
  console.log("Розкладаю по континентальних групах (по одній області за раз)...");
  await splitByContinent();
  console.log("Розкладено. Далі стискаю кожну групу окремо через mapshaper.");

  // 3. Стискаємо КОЖНУ групу окремо (keep-shapes зберігає спільні кордони
  // всередині групи). Кожен файл тут набагато менший за весь світ одразу.
  await rm(SIMPLIFIED_DIR, { recursive: true, force: true });
  await mkdir(SIMPLIFIED_DIR, { recursive: true });

  const splitFiles = (await readdir(SPLIT_DIR)).filter((name) => name.endsWith(".geojson"));
  for (const fileName of splitFiles) {
    const inputPath = join(SPLIT_DIR, fileName);
    const outputPath = join(SIMPLIFIED_DIR, fileName);
    console.log(`  Стискаю ${fileName}...`);
    await mapshaper.runCommands(
      `-i "${inputPath}" -simplify ${SIMPLIFY_PERCENT} weighted keep-shapes -clean -o "${outputPath}" format=geojson`,
    );
  }
  console.log("Усі групи стиснуто.");

  // 4. Збираємо всі групи в один список областей, перекладаємо поля у
  // формат, який очікує решта пайплайну: cn_region_name / cn_region_iso /
  // cn_region_iso3 / cn_region_id.
  const features = [];
  let skippedNoIso = 0;

  for (const fileName of splitFiles) {
    const content = await readFile(join(SIMPLIFIED_DIR, fileName), "utf8");
    const geo = JSON.parse(content);

    for (const feature of geo.features || []) {
      const properties = feature.properties || {};
      if (!feature.geometry || !properties.shapeName) continue;

      const iso3 = properties.shapeGroup;
      const iso2 = MANUAL_ISO_OVERRIDES[iso3] || iso.alpha3ToAlpha2(iso3);
      if (!iso2) {
        skippedNoIso += 1;
        continue;
      }

      features.push({
        type: "Feature",
        geometry: splitGeometryAtAntimeridian(feature.geometry),
        properties: {
          cn_region_name: properties.shapeName,
          cn_region_iso: iso2,
          cn_region_iso3: iso3,
          cn_region_id: properties.shapeID || "",
        },
      });
    }
  }

  if (skippedNoIso > 0) {
    console.warn(`Пропущено ${skippedNoIso} областей: не знайдено відповідний двозначний ISO-код.`);
  }

  features.sort((a, b) =>
    `${a.properties.cn_region_iso}|${a.properties.cn_region_name}`.localeCompare(
      `${b.properties.cn_region_iso}|${b.properties.cn_region_name}`,
    ),
  );

  await mkdir(DATA_DIR, { recursive: true });
  const compact = JSON.stringify({ type: "FeatureCollection", features });
  await writeFile(OUTPUT_PATH, `${compact}\n`);
  console.log(
    `Записано ${features.length} областей у ${OUTPUT_PATH.pathname} ` +
      `(${(Buffer.byteLength(compact) / (1024 * 1024)).toFixed(2)} МБ)`,
  );

  // 5. Прибираємо тимчасові файли (RAW_PATH навмисно лишаємо — кеш на час
  // налагодження; приберемо це окремо, коли фінальний результат ляже в коміт).
  await rm(SPLIT_DIR, { recursive: true, force: true });
  await rm(SIMPLIFIED_DIR, { recursive: true, force: true });

  console.log("\nДалі запусти npm run build:topology як завжди.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
