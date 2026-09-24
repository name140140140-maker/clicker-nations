import { readFile, writeFile } from "node:fs/promises";
import { buffer, rewind } from "@turf/turf";
import { topology } from "topojson-server";

const REGIONS_PATH = new URL("../public/data/world-regions.geojson", import.meta.url);
const REGIONS_DIR = new URL("../public/data/world-regions/", import.meta.url);
const INDEX_PATH = new URL("../public/data/world-regions-index.json", import.meta.url);
const TOPOLOGY_PATH = new URL("../public/data/world-topology.json", import.meta.url);
const QUANTIZATION = 1e5;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readRegions() {
  try {
    return await readJson(REGIONS_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const index = await readJson(INDEX_PATH);
  const chunks = await Promise.all(index.files.map(({ fileName }) => readJson(new URL(fileName, REGIONS_DIR))));
  return {
    type: "FeatureCollection",
    features: chunks.flatMap((chunk) => chunk.features || []),
  };
}

function hasValidGeometry(feature) {
  return Boolean(feature?.geometry?.type && Array.isArray(feature.geometry.coordinates));
}

function coordinateCount(geometry) {
  if (!geometry?.coordinates) return 0;
  const count = (coordinates) => {
    if (typeof coordinates[0] === "number") return 1;
    return coordinates.reduce((total, value) => total + count(value), 0);
  };
  return count(geometry.coordinates);
}

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return area / 2;
}

function isPolarRing(ring) {
  const latitudes = ring.map((coordinate) => coordinate[1]);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  return minLatitude <= -89 && maxLatitude <= -84;
}

function normalizePolygonRingWinding(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return polygon;
  const rewound = rewind({ type: "Polygon", coordinates: polygon }, { reverse: false });
  return rewound.coordinates;
}

function splitAntarcticaPolarRing(feature) {
  const isAntarctica = feature.properties?.iso === "AQ" || feature.properties?.cn_region_iso === "AQ";
  if (!isAntarctica || !feature.geometry) return feature;

  const polygons = feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates]
    : feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates
      : null;
  if (!polygons) return feature;

  const splitPolygons = [];
  for (const polygon of polygons) {
    const ringsWithArea = polygon.map((ring) => ({ ring, area: signedArea(ring) }));
    const exterior = ringsWithArea.reduce((largest, current) => Math.abs(current.area) > Math.abs(largest.area) ? current : largest, ringsWithArea[0]);
    const sameSignPolarRing = ringsWithArea.find(
      ({ ring, area }) => ring !== exterior.ring && isPolarRing(ring) && Math.sign(area) === Math.sign(exterior.area),
    );

    if (!sameSignPolarRing) {
      splitPolygons.push(normalizePolygonRingWinding(polygon));
      continue;
    }

    const remainingRings = polygon.filter((ring) => ring !== sameSignPolarRing.ring);
    if (remainingRings.length > 0) {
      splitPolygons.push(normalizePolygonRingWinding(remainingRings));
    }
    splitPolygons.push(normalizePolygonRingWinding([sameSignPolarRing.ring]));
  }

  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      type: "MultiPolygon",
      coordinates: splitPolygons,
    },
  };
}

function repairFeature(feature) {
  // ВАЖЛИВО: тут раніше був ще один simplify() з tolerance 0.02 ПІСЛЯ
  // ремонту геометрії. Він спрощував кожну область окремо, незалежно від
  // сусідніх — і саме це ламало спільні кордони, які CGAZ + mapshaper
  // (у fetch-regions.mjs) вже акуратно узгодили. Вхідні дані тепер і так
  // легкі (стиснуті на етапі fetch:regions), тому тут лишаємо тільки
  // "ремонт" биті форм, без повторного спрощення.
  try {
    const isAntarctica = feature.properties?.iso === "AQ" || feature.properties?.cn_region_iso === "AQ";
    const rewound = rewind(feature, { reverse: false });
    const normalizedBeforeBuffer = splitAntarcticaPolarRing(rewound);
    const buffered = buffer(rewind(normalizedBeforeBuffer, { reverse: false }), 0);
    const afterBuffer = rewind(buffered, { reverse: false });
    const normalizedAfterBuffer = splitAntarcticaPolarRing(afterBuffer);
    const repaired = isAntarctica ? normalizedAfterBuffer : rewind(normalizedAfterBuffer, { reverse: false });
    return hasValidGeometry(repaired) ? { ...feature, geometry: repaired.geometry } : feature;
  } catch {
    return feature;
  }
}

async function main() {
  const regions = await readRegions();
  if (regions.type !== "FeatureCollection") {
    throw new Error("world-regions.geojson must be a FeatureCollection");
  }

  const total = regions.features.length;
  const pointsBefore = regions.features.reduce((totalPoints, feature) => totalPoints + coordinateCount(feature.geometry), 0);
  const repairedFeatures = regions.features.map((feature, index) => {
    const repaired = repairFeature(feature);
    const processed = index + 1;
    if (processed % 200 === 0 || processed === total) {
      console.log(`Оброблено ${processed} з ${total}`);
    }
    return repaired;
  });
  const pointsAfter = repairedFeatures.reduce((totalPoints, feature) => totalPoints + coordinateCount(feature.geometry), 0);
  const repairedRegions = { ...regions, features: repairedFeatures };

  if (regions.features.length > 0 && !(await fileExists(REGIONS_PATH))) {
    const index = await readJson(INDEX_PATH);
    let offset = 0;
    for (const { fileName, count } of index.files) {
      const chunk = { type: "FeatureCollection", features: repairedFeatures.slice(offset, offset + count) };
      await writeFile(new URL(fileName, REGIONS_DIR), `${JSON.stringify(chunk)}\n`);
      offset += count;
    }
  } else {
    await writeFile(REGIONS_PATH, `${JSON.stringify(repairedRegions)}\n`);
  }

  const topologyFeatures = repairedFeatures.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      name: feature.properties?.name || feature.properties?.cn_region_name,
      iso: feature.properties?.iso || feature.properties?.cn_region_iso,
    },
  }));
  const result = topology({ regions: { ...repairedRegions, features: topologyFeatures } }, QUANTIZATION);
  const output = `${JSON.stringify(result)}\n`;
  await writeFile(TOPOLOGY_PATH, output);
  console.log(`Координатних точок до ремонту: ${pointsBefore}`);
  console.log(`Координатних точок після ремонту і спрощення: ${pointsAfter}`);
  console.log(`Всього оброблено: ${total}`);
  console.log(`Wrote ${TOPOLOGY_PATH.pathname} (${(Buffer.byteLength(output) / (1024 * 1024)).toFixed(2)} MB)`);
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});