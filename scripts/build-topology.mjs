import { readFile, unlink, writeFile } from "node:fs/promises";
import { topology } from "topojson-server";
import countries from "i18n-iso-countries";

const REGIONS_PATH = new URL("../public/data/world-regions.geojson", import.meta.url);
const TOPOLOGY_PATH = new URL("../public/data/world-topology.json", import.meta.url);
const COUNTRIES_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const QUANTIZATION = 1e5;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function countryIso2(iso3) {
  const normalized = String(iso3 || "").toUpperCase();
  if (normalized === "KOS" || normalized === "XKX" || normalized === "UNK") return "XK";
  return countries.alpha3ToAlpha2(normalized);
}

function regionFeature(feature) {
  const properties = feature.properties || {};
  const iso = String(properties.cn_region_iso || "").toUpperCase();
  const name = properties.cn_region_name;
  if (!feature.geometry || !iso || !name) return null;
  return {
    type: "Feature",
    properties: { name, iso },
    geometry: feature.geometry,
  };
}

function countryFeature(feature, iso) {
  const properties = feature.properties || {};
  if (!feature.geometry || !iso) return null;
  return {
    type: "Feature",
    properties: {
      name: properties.NAME || properties.NAME_EN || iso,
      iso,
    },
    geometry: feature.geometry,
  };
}

async function main() {
  const [regions, countriesGeoJson] = await Promise.all([
    readJson(REGIONS_PATH),
    fetchJson(COUNTRIES_URL),
  ]);

  if (regions.type !== "FeatureCollection") {
    throw new Error("world-regions.geojson must be a FeatureCollection");
  }

  const normalizedRegions = regions.features.map(regionFeature).filter(Boolean);
  const presentIsos = new Set(normalizedRegions.map((feature) => feature.properties.iso));
  const fallbackFeatures = [];
  const seenCountryIsos = new Set();

  for (const feature of countriesGeoJson.features || []) {
    const properties = feature.properties || {};
    const iso3 = properties.ADM0_A3;
    const iso = countryIso2(iso3);
    if (!iso || presentIsos.has(iso) || seenCountryIsos.has(iso)) continue;
    const fallback = countryFeature(feature, iso);
    if (fallback) {
      fallbackFeatures.push(fallback);
      seenCountryIsos.add(iso);
    }
  }

  const france = countryIso2("FRA");
  const norway = countryIso2("NOR");
  const kosovo = countryIso2("KOS");
  if (!france || !norway || !kosovo || new Set([france, norway, kosovo]).size !== 3 || [france, norway, kosovo].includes("-99")) {
    throw new Error(`Invalid ISO2 conversion: FRA=${france}, NOR=${norway}, KOS=${kosovo}`);
  }
  console.log(`ISO checks: FRA=${france}, NOR=${norway}, KOS=${kosovo}`);

  const features = [...normalizedRegions, ...fallbackFeatures];
  const result = topology({ regions: { type: "FeatureCollection", features } }, QUANTIZATION);
  const output = `${JSON.stringify(result)}\n`;
  await writeFile(TOPOLOGY_PATH, output);
  await unlink(REGIONS_PATH);

  console.log(`Regions: ${normalizedRegions.length}; country fallbacks: ${fallbackFeatures.length}; total: ${features.length}`);
  console.log(`Wrote ${TOPOLOGY_PATH.pathname} (${(Buffer.byteLength(output) / (1024 * 1024)).toFixed(2)} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});