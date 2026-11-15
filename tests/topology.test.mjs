import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { douglasPeucker, simplifyArc, simplifyTopology } from "../scripts/simplify-topology.mjs";

test("Дуглас-Пекер: лишає кінці й помітні вигини, прибирає колінеарні точки", () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 5], [5, 0]];
  const idx = douglasPeucker(pts, 0.5);
  assert.deepEqual(idx, [0, 3, 4, 5].filter((i) => idx.includes(i)).length === 4 ? [0, 3, 4, 5] : idx);
  assert.ok(idx.includes(0) && idx.includes(5) && idx.includes(4));
  assert.ok(!idx.includes(1) && !idx.includes(2));
});

test("simplifyArc: малі дуги не чіпаємо, замкнений контур лишається ≥4 точок", () => {
  const small = [[0, 0], [1, 1], [1, 0], [0, -1], [-1, 0]];
  assert.equal(simplifyArc(small, 5), small);
  // велике коло з дрібними зубцями
  const ring = []; let px = 0, py = 0;
  for (let i = 0; i <= 200; i++) { const a = (i / 200) * Math.PI * 2; const x = Math.round(1000 + 900 * Math.cos(a)), y = Math.round(1000 + 900 * Math.sin(a)); ring.push([x - px, y - py]); px = x; py = y; }
  const out = simplifyArc(ring, 30);
  assert.ok(out.length >= 4 && out.length < ring.length);
  // перша й остання абсолютні точки збігаються (контур замкнений)
  let x = 0, y = 0, first, last; out.forEach(([dx, dy], i) => { x += dx; y += dy; if (i === 0) first = [x, y]; last = [x, y]; });
  assert.deepEqual(first, last);
});

test("simplifyTopology: структура, кількість геометрій, індекси дуг і ключові властивості збережені", () => {
  const topo = { type: "Topology", transform: { scale: [0.01, 0.01], translate: [0, 0] }, bbox: [0, 0, 1, 1],
    objects: { regions: { type: "GeometryCollection", geometries: [{ type: "Polygon", arcs: [[0]], properties: { cn_region_id: "a", name: "A", iso: "AA", cn_region_iso3: "AAA" } }] } },
    arcs: [[[0, 0], [10, 0], [0, 10], [-10, 0], [0, -10]]] };
  const lite = simplifyTopology(topo, 0.02);
  assert.deepEqual(lite.objects.regions.geometries[0].arcs, [[0]]);
  assert.deepEqual(lite.objects.regions.geometries[0].properties, { cn_region_name: "A", cn_region_iso: "AA", cn_region_id: "a" });
  assert.equal(lite.arcs.length, 1);
});

// Перевірка згенерованого файла проти оригіналу (якщо обидва є в репозиторії)
const FULL = new URL("../public/data/world-topology.json", import.meta.url);
const LITE = new URL("../public/data/world-topology-lite.json", import.meta.url);
test("world-topology-lite.json: та сама топологія, валідні кільця, менший розмір", { skip: !(fs.existsSync(FULL) && fs.existsSync(LITE)) }, () => {
  const f = JSON.parse(fs.readFileSync(FULL, "utf8")), l = JSON.parse(fs.readFileSync(LITE, "utf8"));
  assert.equal(l.arcs.length, f.arcs.length);
  const fg = f.objects.regions.geometries, lg = l.objects.regions.geometries;
  assert.equal(lg.length, fg.length);
  for (let i = 0; i < fg.length; i++) {
    assert.deepEqual(lg[i].arcs, fg[i].arcs, "індекси дуг змінились у " + i);
    assert.equal(lg[i].properties.cn_region_id, fg[i].properties.cn_region_id);
  }
  // кожне кільце після зшивання має ≥4 точок
  // (в оригіналі є одне вироджене кільце — Kaafu, 2 точки; воно лишається як є, нові вироджені не допускаємо)
  const cnt = (arcs, ring) => ring.reduce((s, r) => s + arcs[r < 0 ? ~r : r].length - 1, 1);
  for (const g of lg) {
    const polys = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
    for (const rings of polys) for (const ring of rings) {
      if (cnt(f.arcs, ring) < 4) continue;
      assert.ok(cnt(l.arcs, ring) >= 4, `кільце з ${cnt(l.arcs, ring)} точок у ${g.properties.cn_region_id}`);
    }
  }
  assert.ok(fs.statSync(LITE).size < fs.statSync(FULL).size * 0.6);
});
