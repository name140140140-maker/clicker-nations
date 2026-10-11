/* Легка модель адміністративних областей для карти територій.
   Бере топологію (public/data/world-topology.json) і будує:
   - GeoJSON областей (id = індекс області) та ліній кордонів (id = номер арки) — одразу ТЕКСТОМ;
   - для кожної арки — які дві області її ділять (для живих кордонів між країнами);
   - для кожної області — її арки та межі в градусах (для наближення камери).
   Без прапорів, реальних держав і важких обчислень площ. Чистий JS (без DOM/React/MapLibre). */

const round5 = (v) => Math.round(v * 1e5) / 1e5;

export async function buildRegionModel(topology, yieldFn = async () => {}) {
  const objName = Object.keys(topology.objects)[0];
  const geoms = topology.objects[objName].geometries;
  const tr = topology.transform;
  const arcCount = topology.arcs.length;

  // 1. Арки → текст координат + межі арки.
  const arcText = new Array(arcCount);
  const arcBBox = new Float64Array(arcCount * 4);
  for (let a = 0; a < arcCount; a++) {
    const raw = topology.arcs[a];
    const len = raw.length;
    const parts = new Array(len);
    let qx = 0, qy = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < len; i++) {
      if (tr) { qx += raw[i][0]; qy += raw[i][1]; } else { qx = raw[i][0]; qy = raw[i][1]; }
      const lng = round5(tr ? qx * tr.scale[0] + tr.translate[0] : qx);
      const lat = round5(tr ? qy * tr.scale[1] + tr.translate[1] : qy);
      if (lng < minX) minX = lng;
      if (lng > maxX) maxX = lng;
      if (lat < minY) minY = lat;
      if (lat > maxY) maxY = lat;
      parts[i] = "[" + lng + "," + lat + "]";
    }
    arcText[a] = parts.join(",");
    arcBBox[4 * a] = minX; arcBBox[4 * a + 1] = minY; arcBBox[4 * a + 2] = maxX; arcBBox[4 * a + 3] = maxY;
    if (a % 1500 === 1499) await yieldFn();
  }

  // 2. Області, їхні кільця та суміжність арок.
  const regions = [];
  const regionPolys = []; // для тексту GeoJSON: [ [ring, ring…], … ] (кільця — масиви посилань на арки)
  const arcRegions = new Int32Array(arcCount * 2).fill(-1);
  const regionArcs = [];
  const regionBBox = new Float64Array(geoms.length * 4);
  const indexByRid = new Map();

  for (let r = 0; r < geoms.length; r++) {
    const g = geoms[r];
    const props = g.properties || {};
    const rid = String(props.cn_region_id || "");
    regions.push({ index: r, rid, name: props.cn_region_name || props.name || "", iso: props.cn_region_iso || props.iso || "" });
    if (rid) indexByRid.set(rid, r);
    const polygons = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
    regionPolys.push(polygons);
    const arcSet = new Set();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const rings of polygons) {
      if (!rings) continue;
      for (const ring of rings) {
        for (const ref of ring) {
          const a = ref < 0 ? ~ref : ref;
          if (arcSet.has(a)) continue;
          arcSet.add(a);
          if (arcRegions[2 * a] === -1) arcRegions[2 * a] = r;
          else if (arcRegions[2 * a] !== r && arcRegions[2 * a + 1] === -1) arcRegions[2 * a + 1] = r;
          if (arcBBox[4 * a] < minX) minX = arcBBox[4 * a];
          if (arcBBox[4 * a + 1] < minY) minY = arcBBox[4 * a + 1];
          if (arcBBox[4 * a + 2] > maxX) maxX = arcBBox[4 * a + 2];
          if (arcBBox[4 * a + 3] > maxY) maxY = arcBBox[4 * a + 3];
        }
      }
    }
    regionArcs.push(Array.from(arcSet));
    regionBBox[4 * r] = minX; regionBBox[4 * r + 1] = minY; regionBBox[4 * r + 2] = maxX; regionBBox[4 * r + 3] = maxY;
    if (r % 600 === 599) await yieldFn();
  }

  const ringText = (ring) => {
    const parts = new Array(ring.length);
    for (let i = 0; i < ring.length; i++) {
      const ref = ring[i];
      if (ref >= 0) parts[i] = arcText[ref];
      else {
        const t = arcText[~ref]; // розворот пар без повторного форматування чисел
        parts[i] = "[" + t.slice(1, -1).split("],[").reverse().join("],[") + "]";
      }
    }
    return "[" + parts.join(",") + "]";
  };

  const model = {
    regions,
    indexByRid,
    regionArcs,
    arcRegions,
    arcCount,
    /* [west, south, east, north] області в градусах */
    regionBounds(r) {
      return [regionBBox[4 * r], regionBBox[4 * r + 1], regionBBox[4 * r + 2], regionBBox[4 * r + 3]];
    },

    async regionsGeoJsonChunks() {
      const chunks = ['{"type":"FeatureCollection","features":['];
      for (let r = 0; r < regions.length; r++) {
        const polys = regionPolys[r]
          .filter((rings) => rings && rings.length)
          .map((rings) => "[" + rings.map(ringText).join(",") + "]");
        if (!polys.length) continue;
        chunks.push(
          (chunks.length > 1 ? "," : "") +
            `{"type":"Feature","id":${r},"properties":{},"geometry":{"type":"MultiPolygon","coordinates":[${polys.join(",")}]}}`,
        );
        if (r % 250 === 249) await yieldFn();
      }
      chunks.push("]}");
      return chunks;
    },

    /* Кожна арка — окрема лінія. two=1 — кордон між двома областями, two=0 — зовнішній контур (узбережжя). */
    async bordersGeoJsonChunks() {
      const chunks = ['{"type":"FeatureCollection","features":['];
      for (let a = 0; a < arcCount; a++) {
        if (arcRegions[2 * a] < 0) continue;
        const two = arcRegions[2 * a + 1] >= 0 ? 1 : 0;
        chunks.push(
          (chunks.length > 1 ? "," : "") +
            `{"type":"Feature","id":${a},"properties":{"two":${two}},"geometry":{"type":"LineString","coordinates":[${arcText[a]}]}}`,
        );
        if (a % 2500 === 2499) await yieldFn();
      }
      chunks.push("]}");
      return chunks;
    },

    /* Текст арок і кільця потрібні лише для побудови GeoJSON — після цього їх можна звільнити. */
    release() {
      arcText.length = 0;
      regionPolys.length = 0;
    },
  };
  return model;
}
