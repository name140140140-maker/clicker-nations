import { mkdir, writeFile } from "node:fs/promises";
import { simplify } from "@turf/turf";

const API_URL = "https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/";
const COUNTRIES_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const DATA_DIR = new URL("../public/data/", import.meta.url);
const OUTPUT_PATH = new URL("../public/data/world-regions.geojson", import.meta.url);
const CONCURRENCY = 6;
const SIMPLIFY_TOLERANCE = 0.05;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function roundCoord(value) {
  return Number(value.toFixed(4));
}

function normalizeGeometry(geometry) {
  if (!geometry) return geometry;

  const walk = (coords) => {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === "number") {
      return [roundCoord(coords[0]), roundCoord(coords[1])];
    }
    return coords.map(walk);
  };

  if (geometry.type === "Polygon") {
    return { ...geometry, coordinates: geometry.coordinates.map((ring) => walk(ring)) };
  }

  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => walk(ring))),
    };
  }

  return geometry;
}

function simplifyFeature(feature) {
  if (!feature || !feature.geometry) return feature;

  let simplified = simplify(feature, {
    tolerance: SIMPLIFY_TOLERANCE,
    highQuality: false,
    mutate: false,
  });

  simplified = simplify(simplified, {
    tolerance: SIMPLIFY_TOLERANCE * 1.5,
    highQuality: false,
    mutate: false,
  });

  const normalized = normalizeGeometry(simplified.geometry);
  return { ...simplified, geometry: normalized };
}

async function main() {
  const [catalog, countries] = await Promise.all([fetchJson(API_URL), fetchJson(COUNTRIES_URL)]);
  const iso2ByIso3 = new Map();
  for (const feature of countries.features || []) {
    const properties = feature.properties || {};
    const iso3 = properties.ADM0_A3 || properties.ISO_A3 || properties.iso_a3;
    const iso2 = properties.ISO_A2 || properties.iso_a2 || properties.ISO_A2_EH;
    if (iso3 && iso2 && iso2 !== "-99") iso2ByIso3.set(iso3, iso2);
  }

  const features = [];
  let next = 0;

  async function worker() {
    while (next < catalog.length) {
      const metadata = catalog[next++];
      try {
        const url = metadata.simplifiedGeometryGeoJSON || metadata.geometryGeoJSON;
        if (!url || !/simplified/i.test(url)) {
          console.warn(`Skipping ${metadata.boundaryISO}: not a simplified geometry URL`);
          continue;
        }
        const geo = await fetchJson(url);
        const iso3 = metadata.boundaryISO;
        const iso2 = iso2ByIso3.get(iso3);
        if (!iso2) {
          console.warn(`Skipping ${iso3}: no ISO2 mapping`);
          continue;
        }

        for (const feature of geo.features || []) {
          const properties = feature.properties || {};
          if (!feature.geometry || !properties.shapeName) continue;
          const cleaned = simplifyFeature(feature);
          cleaned.properties = {
            cn_region_name: properties.shapeName,
            cn_region_iso: iso2,
            cn_region_iso3: properties.shapeGroup || iso3,
            cn_region_id: properties.shapeID || "",
          };
          features.push(cleaned);
        }
        console.log(`${iso3}: ${geo.features?.length || 0} regions -> simplified`);
      } catch (error) {
        console.warn(`Skipping ${metadata.boundaryISO}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  features.sort((a, b) => `${a.properties.cn_region_iso}|${a.properties.cn_region_name}`.localeCompare(`${b.properties.cn_region_iso}|${b.properties.cn_region_name}`));

  await mkdir(DATA_DIR, { recursive: true });
  const compact = JSON.stringify({ type: "FeatureCollection", features });
  await writeFile(OUTPUT_PATH, `${compact}\n`);
  console.log(`Wrote ${features.length} simplified ADM1 features to ${OUTPUT_PATH.pathname} (${(Buffer.byteLength(compact) / (1024 * 1024)).toFixed(2)} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
