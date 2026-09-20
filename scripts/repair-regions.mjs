import { readFile, writeFile } from "node:fs/promises";
import { buffer } from "@turf/turf";

const SOURCE_PATH = new URL("../public/data/world-regions.geojson", import.meta.url);
const OUTPUT_PATH = new URL("../public/data/world-regions-repaired.geojson", import.meta.url);
const PROGRESS_INTERVAL = 200;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function hasValidGeometry(feature) {
  return Boolean(
    feature &&
      feature.type === "Feature" &&
      feature.geometry &&
      typeof feature.geometry.type === "string" &&
      Array.isArray(feature.geometry.coordinates),
  );
}

function repairFeature(feature) {
  try {
    const repaired = buffer(feature, 0);
    return hasValidGeometry(repaired)
      ? { ...feature, geometry: repaired.geometry }
      : feature;
  } catch {
    return feature;
  }
}

async function main() {
  const regions = await readJson(SOURCE_PATH);
  if (regions.type !== "FeatureCollection" || !Array.isArray(regions.features)) {
    throw new Error("world-regions.geojson must be a FeatureCollection");
  }

  const total = regions.features.length;
  let repairedCount = 0;
  let unchangedCount = 0;
  const repairedFeatures = [];

  for (let index = 0; index < total; index += 1) {
    const original = regions.features[index];
    const repaired = repairFeature(original);
    repairedFeatures.push(repaired);
    if (repaired === original) unchangedCount += 1;
    else repairedCount += 1;

    const processed = index + 1;
    if (processed % PROGRESS_INTERVAL === 0 || processed === total) {
      console.log(`Оброблено ${processed} з ${total}`);
    }
  }

  const output = `${JSON.stringify({ ...regions, features: repairedFeatures })}\n`;
  await writeFile(OUTPUT_PATH, output);
  console.log(`Відремонтовано: ${repairedCount}; залишено оригінальними: ${unchangedCount}`);
  console.log(`Wrote ${OUTPUT_PATH.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
