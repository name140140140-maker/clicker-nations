import { mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mapshaper from "mapshaper";
import iso from "i18n-iso-countries";

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

// ВАЖЛИВО: чому саме такий поділ на групи, а не "по країнах" (стара помилка)
// і не "по 190+ країнах окремо" (знову з'являться дірки).
//
// Кожна група стискається ОДНИМ шматком, зі збереженням спільних кордонів
// (keep-shapes) всередині групи. Дірка/шов теоретично можливий ТІЛЬКИ на
// межі між групами. Тому Євразія тут навмисно одна велика група: Росія,
// Казахстан, Китай, Монголія, Індія, Туреччина, вся Європа — усе разом,
// щоб жоден їхній спільний кордон не порізало по групах.
//
// Реальний "шов" лишається рівно у двох місцях у світі:
//   Єгипет/Ізраїль (межа Євразія <-> Африка)
//   Панама/Колумбія (межа Північна <-> Південна Америка)
// Океанія — острови, сухопутних кордонів ні з ким не має, шва не буде.
const CONTINENT_GROUPS = {
  eurasia: [
    // Європа
    "ALB", "AND", "AUT", "BLR", "BEL", "BIH", "BGR", "HRV", "CYP", "CZE",
    "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "ISL", "IRL", "ITA",
    "XKX", "LVA", "LIE", "LTU", "LUX", "MLT", "MDA", "MCO", "MNE", "NLD",
    "MKD", "NOR", "POL", "PRT", "ROU", "RUS", "SMR", "SRB", "SVK", "SVN",
    "ESP", "SWE", "CHE", "UKR", "GBR", "VAT",
    // Кавказ
    "GEO", "ARM", "AZE",
    // Близький Схід
    "TUR", "SYR", "LBN", "ISR", "PSE", "JOR", "IRQ", "IRN", "SAU", "YEM",
    "OMN", "ARE", "QAT", "BHR", "KWT",
    // Центральна й Південна Азія
    "KAZ", "UZB", "TKM", "TJK", "KGZ", "AFG", "PAK", "IND", "NPL", "BTN",
    "BGD", "LKA", "MDV",
    // Східна й Південно-Східна Азія
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

async function downloadToFile(url, destPath) {
  console.log(`Завантажую ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} для ${url}`);
  const size = response.headers.get("content-length");
  if (size) console.log(`Розмір на сервері: ${(Number(size) / (1024 * 1024)).toFixed(1)} МБ`);
  await finished(Readable.fromWeb(response.body).pipe(createWriteStream(destPath)));
  console.log(`Збережено у ${destPath}`);
}

async function main() {
  // 1. Качаємо CGAZ на диск (як і раніше).
  await downloadToFile(CGAZ_URL, RAW_PATH);

  // 2. ОДИН прохід по всьому файлу: розкладаємо області по 5 групах
  // (eurasia / africa / north_america / south_america / oceania / other).
  // Це легша операція за повне спрощення, бо тут ще не будується спільна
  // топологія кордонів — просто розкладання по теці.
  console.log("Розкладаю по континентальних групах (один прохід)...");
  await rm(SPLIT_DIR, { recursive: true, force: true });
  await mkdir(SPLIT_DIR, { recursive: true });

  const lookupJson = JSON.stringify(CONTINENT_BY_ISO3);
  const eachExpr = `var CONT_LOOKUP = ${lookupJson}; continent = CONT_LOOKUP[shapeGroup] || 'other';`;

  await mapshaper.runCommands(
    `-i "${RAW_PATH}" -each '${eachExpr}' -split continent -o dir="${SPLIT_DIR}" format=geojson`,
  );
  console.log("Розкладено. Далі стискаю кожну групу окремо.");

  // 3. Тепер стискаємо КОЖНУ групу окремо через mapshaper (keep-shapes
  // зберігає спільні кордони всередині групи). Кожен файл тут набагато
  // менший за весь світ одразу, тому пам'яті треба в рази менше.
  await rm(SIMPLIFIED_DIR, { recursive: true, force: true });
  await mkdir(SIMPLIFIED_DIR, { recursive: true });

  const splitFiles = (await readdir(SPLIT_DIR)).filter((name) => name.endsWith(".geojson"));
  if (splitFiles.length === 0) {
    throw new Error(`У ${SPLIT_DIR} не знайдено жодного .geojson після розкладання — щось пішло не так на кроці 2.`);
  }

  for (const fileName of splitFiles) {
    const inputPath = join(SPLIT_DIR, fileName);
    const outputPath = join(SIMPLIFIED_DIR, fileName);
    console.log(`  Стискаю ${fileName}...`);
    await mapshaper.runCommands(
      `-i "${inputPath}" -simplify ${SIMPLIFY_PERCENT} weighted keep-shapes -clean -o "${outputPath}" format=geojson`,
    );
  }
  console.log("Усі групи стиснуто.");

  // 4. Збираємо всі групи в один список областей і перекладаємо поля у
  // формат, який очікує решта пайплайну (той самий контракт, що й раніше):
  // cn_region_name / cn_region_iso / cn_region_iso3 / cn_region_id.
  const features = [];
  let skippedNoIso = 0;

  for (const fileName of splitFiles) {
    const content = await readFile(join(SIMPLIFIED_DIR, fileName), "utf8");
    const geo = JSON.parse(content);

    for (const feature of geo.features || []) {
      const properties = feature.properties || {};
      if (!feature.geometry || !properties.shapeName) continue;

      const iso3 = properties.shapeGroup;
      const iso2 = iso.alpha3ToAlpha2(iso3);
      if (!iso2) {
        skippedNoIso += 1;
        continue;
      }

      features.push({
        type: "Feature",
        geometry: feature.geometry,
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

  // 5. Прибираємо тимчасові файли.
  await rm(RAW_PATH, { force: true });
  await rm(SPLIT_DIR, { recursive: true, force: true });
  await rm(SIMPLIFIED_DIR, { recursive: true, force: true });

  console.log("\nДалі запусти npm run build:topology як завжди.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
