import { mkdir, writeFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mapshaper from "mapshaper";

// CGAZ = Comprehensive Global Administrative Zones (geoBoundaries).
// На відміну від попередньої версії цього скрипта (яка качала кожну країну
// окремо), CGAZ — це один файл на весь світ, де межі між сусідніми країнами
// вже узгоджені (без дірок і накладань). Джерело: https://www.geoboundaries.org
const CGAZ_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/CGAZ/geoBoundariesCGAZ_ADM1.geojson";
const COUNTRIES_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

const DATA_DIR = new URL("../public/data/", import.meta.url);
const OUTPUT_PATH = new URL("../public/data/world-regions.geojson", import.meta.url);

// Скільки % точок лишити на лініях кордонів. Менше число = легший файл,
// але менш точна форма. 8% — орієнтир, щоб на виході вийшло приблизно
// стільки ж, скільки важить поточний world-topology.json (~5-8 МБ).
// Якщо після запуску файл вийде значно більшим/меншим за очікування —
// це перше число, яке варто покрутити.
const SIMPLIFY_PERCENT = "8%";

const RAW_PATH = join(tmpdir(), "geoBoundariesCGAZ_ADM1.geojson");
const SIMPLIFIED_PATH = join(tmpdir(), "geoBoundariesCGAZ_ADM1.simplified.geojson");

async function downloadToFile(url, destPath) {
  console.log(`Завантажую ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} для ${url}`);
  const size = response.headers.get("content-length");
  if (size) console.log(`Розмір на сервері: ${(Number(size) / (1024 * 1024)).toFixed(1)} МБ`);
  await finished(Readable.fromWeb(response.body).pipe(createWriteStream(destPath)));
  console.log(`Збережено у ${destPath}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function main() {
  // 1. Качаємо CGAZ одразу на диск (файл великий, тримати його в пам'яті
  // під час завантаження — зайвий ризик впасти по нестачі пам'яті).
  await downloadToFile(CGAZ_URL, RAW_PATH);

  // 2. Стискаємо через mapshaper. -simplify weighted keep-shapes — головне
  // тут "keep-shapes": воно зберігає спільні лінії між сусідніми країнами
  // під час спрощення, а не спрощує кожну країну окремо (саме це і було
  // причиною дірок між країнами у старій версії карти).
  console.log(`Стискаю через mapshaper до ${SIMPLIFY_PERCENT}...`);
  await mapshaper.runCommands(
    `-i "${RAW_PATH}" -simplify ${SIMPLIFY_PERCENT} weighted keep-shapes -clean -o "${SIMPLIFIED_PATH}" format=geojson`,
  );
  console.log("Стиснення завершено.");

  // 3. Далі — та сама логіка, що була в старому скрипті: перекласти поля
  // CGAZ (shapeName / shapeGroup) у формат, який очікує build-topology.mjs
  // (cn_region_name / cn_region_iso / ...), включно з переводом
  // тризначного ISO-коду (напр. UKR) у двозначний (UA).
  const [simplified, countries] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(SIMPLIFIED_PATH, "utf8")).then(JSON.parse),
    fetchJson(COUNTRIES_URL),
  ]);

  const iso2ByIso3 = new Map();
  for (const feature of countries.features || []) {
    const properties = feature.properties || {};
    const iso3 = properties.ADM0_A3 || properties.ISO_A3 || properties.iso_a3;
    const iso2 = properties.ISO_A2 || properties.iso_a2 || properties.ISO_A2_EH;
    if (iso3 && iso2 && iso2 !== "-99") iso2ByIso3.set(iso3, iso2);
  }

  const features = [];
  let skippedNoIso = 0;
  for (const feature of simplified.features || []) {
    const properties = feature.properties || {};
    if (!feature.geometry || !properties.shapeName) continue;

    const iso3 = properties.shapeGroup;
    const iso2 = iso2ByIso3.get(iso3);
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

  // 4. Приберемо тимчасові файли з диска.
  await rm(RAW_PATH, { force: true });
  await rm(SIMPLIFIED_PATH, { force: true });

  console.log("\nДалі запусти звичайний build-topology (npm run build-topology, або та команда,");
  console.log("що вже є в package.json) — він не змінювався і підхопить цей файл як завжди.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
