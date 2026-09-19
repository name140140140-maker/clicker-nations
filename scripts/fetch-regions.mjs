import { mkdir, writeFile } from "node:fs/promises";

const API_URL = "https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/";
const COUNTRIES_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const OUTPUT = new URL("../public/data/world-regions.geojson", import.meta.url);
const CONCURRENCY = 6;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
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
        const geo = await fetchJson(metadata.simplifiedGeometryGeoJSON);
        const iso3 = metadata.boundaryISO;
        const iso2 = iso2ByIso3.get(iso3);
        if (!iso2) {
          console.warn(`Skipping ${iso3}: no ISO2 mapping`);
          continue;
        }
        for (const feature of geo.features || []) {
          const properties = feature.properties || {};
          if (!feature.geometry || !properties.shapeName) continue;
          feature.properties = {
            cn_region_name: properties.shapeName,
            cn_region_iso: iso2,
            cn_region_iso3: properties.shapeGroup || iso3,
            cn_region_id: properties.shapeID || "",
          };
          features.push(feature);
        }
        console.log(`${iso3}: ${geo.features?.length || 0} regions`);
      } catch (error) {
        console.warn(`Skipping ${metadata.boundaryISO}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  features.sort((a, b) => `${a.properties.cn_region_iso}|${a.properties.cn_region_name}`.localeCompare(`${b.properties.cn_region_iso}|${b.properties.cn_region_name}`));
  await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify({ type: "FeatureCollection", features })}\n`);
  console.log(`Wrote ${features.length} ADM1 features to ${OUTPUT.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
