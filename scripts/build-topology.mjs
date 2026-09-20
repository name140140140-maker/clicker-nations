import { readFile, writeFile } from "node:fs/promises";
import { buffer } from "@turf/turf";
import { topology } from "topojson-server";

const REGIONS_PATH = new URL("../public/data/world-regions.geojson", import.meta.url);
const TOPOLOGY_PATH = new URL("../public/data/world-topology.json", import.meta.url);
const QUANTIZATION = 1e5;
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
  } catch (error) {
    return feature;
  }
}

async function main() {
  const regions = await readJson(REGIONS_PATH);

  if (regions.type !== "FeatureCollection" || !Array.isArray(regions.features)) {
    throw new Error("world-regions.geojson must be a FeatureCollection");
  }

  const total = regions.features.length;
  let repairedCount = 0;
  let failedCount = 0;
  const repairedFeatures = regions.features.map((feature, index) => {
    const repaired = repairFeature(feature);
    if (repaired !== feature) repairedCount += 1;
    else failedCount += 1;

    const processed = index + 1;
    if (processed % PROGRESS_INTERVAL === 0 || processed === total) {
      console.log(`Оброблено ${processed} з ${total}`);
    }
    return repaired;
  });

  const repairedRegions = { ...regions, features: repairedFeatures };
  await writeFile(REGIONS_PATH, `${JSON.stringify(repairedRegions)}\n`);

  const result = topology({ regions: repairedRegions }, QUANTIZATION);
  const output = `${JSON.stringify(result)}\n`;
  await writeFile(TOPOLOGY_PATH, output);

  console.log(`Відремонтовано: ${repairedCount}; залишено оригінальними: ${failedCount}`);
  console.log(`Wrote ${REGIONS_PATH.pathname}`);
  console.log(`Wrote ${TOPOLOGY_PATH.pathname} (${(Buffer.byteLength(output) / (1024 * 1024)).toFixed(2)} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
