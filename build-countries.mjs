import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mapshaper from "mapshaper";

// Другий шар даних: суцільний контур кожної країни (218 форм), окремо від
// 3224 окремих областей у world-regions.geojson. Використовується для
// кордонів країн, які мають бути видимі завжди, незалежно від зуму — на
// відміну від меж областей, які показуються тільки зблизька.
//
// Важливо: беремо як вхідні дані вже ОБРОБЛЕНИЙ world-regions.geojson (після
// розрізання по антимеридіану), а не сирий CGAZ. Завдяки цьому країни, що
// перетинають лінію 180° (Росія), об'єднуються правильно — mapshaper бачить
// уже розрізані шматки як природно роз'єднані частини (як острови), а не
// намагається "зшити" їх назад через увесь світ.

const DATA_DIR = fileURLToPath(new URL("../public/data/", import.meta.url));
const INPUT_PATH = fileURLToPath(new URL("../public/data/world-regions.geojson", import.meta.url));
const OUTPUT_PATH = fileURLToPath(new URL("../public/data/world-countries.geojson", import.meta.url));

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  console.log("Об'єдную області в суцільні контури країн (mapshaper -dissolve)...");
  await mapshaper.runCommands(
    `-i "${INPUT_PATH}" -dissolve cn_region_iso copy-fields=cn_region_iso3 -o "${OUTPUT_PATH}" format=geojson`,
  );

  const { readFile } = await import("node:fs/promises");
  const written = JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
  console.log(
    `Записано ${OUTPUT_PATH}: ${written.features.length} країн ` +
      `(${(Buffer.byteLength(JSON.stringify(written)) / (1024 * 1024)).toFixed(2)} МБ)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
