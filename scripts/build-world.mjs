/**
 * Build script: generates src/lib/games/strategy-game-world/data/world.ts
 * from Natural Earth 1:50m country geometry (world-atlas TopoJSON).
 *
 * Pipeline:
 *  1. decode topojson → country polygons + border adjacency (shared arcs)
 *  2. merge microstates into neighbours (Benelux, Caribbean, Pacific…)
 *  3. simplify rings, drop tiny islands, quantize coords
 *  4. emit TS data module (regions, adjacency, continents, powers)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import CONTINENT_MAP from './continents.mjs';

const require = createRequire(import.meta.url);
const topo = require('world-atlas/countries-50m.json');

const W = 4096;
const H = 2048;
const MIN_AREA_KM2 = 45_000; // countries below this merge into smallest neighbour
const RING_MIN_KM2 = 350; // rings (islands) below this are dropped
const MAX_POINTS_PER_RING = 90;

const proj = ([lon, lat]) => [
  ((lon + 180) / 360) * W,
  ((90 - lat) / 180) * H,
];

const feats = feature(topo, topo.objects.countries).features.filter(
  (f) => f.properties.name !== 'Antarctica' && f.id !== '010',
);

// ── geometry helpers (lon/lat) ─────────────────────────────────────

/**
 * TRUE spherical area of a lon/lat ring (Chamberlain–Duquette).
 * Naive projected area lies by 5x for high-latitude countries — with
 * equirectangular pixels France looked bigger than Bolivia. Never again.
 */
const R_EARTH = 6371;
function ringAreaKm2(ring) {
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    acc += ((lon2 - lon1) * Math.PI) / 180 *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs(acc) * R_EARTH * R_EARTH / 2;
}
function centroidOf(rings) {
  let x = 0, y = 0, w = 0;
  for (const r of rings) {
    const a = Math.max(ringAreaKm2(r), 1);
    let cx = 0, cy = 0;
    r.forEach(([lon, lat]) => { const [px, py] = proj([lon, lat]); cx += px; cy += py; });
    x += (cx / r.length) * a; y += (cy / r.length) * a; w += a;
  }
  return [x / w, y / w];
}
function totalArea(rings) {
  return rings.reduce((s, r) => s + ringAreaKm2(r), 0);
}
/** Decimate + Douglas–Peucker-ish removal keeping ≤ maxPoints and shape. */
function simplify(ring, maxPoints) {
  let pts = ring.slice();
  if (pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  const step = Math.ceil(pts.length / (maxPoints * 4));
  if (step > 1) pts = pts.filter((_, i) => i % step === 0);
  while (pts.length > maxPoints) {
    // remove the point closest to its neighbours (least corner-y)
    let best = 1, bestD = Infinity;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i + 1][1]) +
        Math.hypot(pts[i][0] - pts[i + 1][0], pts[i][1] - pts[i + 1][1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    pts.splice(best, 1);
  }
  return pts.map(([lon, lat]) => { const [x, y] = proj([lon, lat]); return [+x.toFixed(1), +y.toFixed(1)]; });
}

/**
 * Split a lon/lat ring at the antimeridian (±180°) so no segment spans the
 * whole map. Each piece is anchored on the seam on both ends, so closing it
 * is a short chord along the seam instead of a band across the world.
 * (Without this, Russia renders as a red ribbon from Europe to Alaska.)
 */
function splitAtSeam(ring) {
  const pts = ring.slice();
  if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  const n = pts.length;
  if (n < 4) return [pts];

  // Unroll the ring into a continuous longitude frame.
  const xs = [];
  let off = 0;
  for (let i = 0; i < n; i++) {
    xs.push([pts[i][0] + off, pts[i][1]]);
    const d = pts[(i + 1) % n][0] - pts[i][0];
    if (d > 180) off -= 360;
    else if (d < -180) off += 360;
  }

  // Every segment that crosses an odd multiple of 180 is a cut.
  const cuts = [];
  for (let i = 0; i < n; i++) {
    const a = xs[i];
    const b = xs[(i + 1) % n];
    for (const S of [-540, -180, 180, 540]) {
      if ((a[0] < S && b[0] >= S) || (a[0] > S && b[0] <= S)) {
        const t = (S - a[0]) / (b[0] - a[0]);
        cuts.push({ i, S, lat: a[1] + (b[1] - a[1]) * t });
        break;
      }
    }
  }
  if (cuts.length < 2 || cuts.length % 2 !== 0) return cuts.length ? [pts] : [pts];

  // Each pair of consecutive cuts bounds one closed piece.
  const pieces = [];
  for (let k = 0; k < cuts.length; k++) {
    const from = cuts[k];
    const to = cuts[(k + 1) % cuts.length];
    const chain = [[from.S, from.lat]];
    let i = (from.i + 1) % n;
    for (let guard = 0; guard <= n; guard++) {
      chain.push(xs[i]);
      if (i === to.i) break;
      i = (i + 1) % n;
    }
    chain.push([to.S, to.lat]);
    if (chain.length >= 4) pieces.push(chain);
  }
  return pieces.length ? pieces : [pts];
}

// ── per-country rings ──────────────────────────────────────────────
const byId = new Map();
for (const f of feats) {
  const outer = f.geometry.type === 'Polygon'
    ? [f.geometry.coordinates[0]]
    : f.geometry.coordinates.map((p) => p[0]);
  const ringsGeo = outer.flatMap(splitAtSeam).filter((r) => ringAreaKm2(r) >= RING_MIN_KM2);
  if (ringsGeo.length === 0) continue;
  const id = f.id != null ? String(f.id) : `X:${f.properties.name}`;
  const rec = {
    id,
    name: f.properties.name,
    geoRings: ringsGeo,
    rings: ringsGeo.map((r) => simplify(r, MAX_POINTS_PER_RING)),
    area: totalArea(ringsGeo),
    center: centroidOf(ringsGeo),
    neighbors: new Set(),
  };
  const prev = byId.get(id); // split geometries (e.g. Australia) merge together
  if (prev) {
    prev.geoRings = prev.geoRings.concat(rec.geoRings);
    prev.rings = prev.rings.concat(rec.rings);
    prev.area += rec.area;
    prev.center = centroidOf(prev.geoRings);
  } else {
    byId.set(id, rec);
  }
}

// ── land adjacency: countries sharing a topojson arc are neighbours ─
// TopoJSON geometry arcs live in g.arcs (negative = reversed ring pass).
const topoGeoms = topo.objects.countries.geometries;
const geoId = (g) => (g.id != null ? String(g.id) : 'X:' + g.properties.name);
const idOf = new Map(topoGeoms.map((g) => [g, geoId(g)]));
const geomsByArc = new Map();
for (const g of topoGeoms) {
  for (const arcIdx of (g.arcs ?? []).flat(2)) {
    const a = arcIdx < 0 ? ~arcIdx : arcIdx;
    let set = geomsByArc.get(a);
    if (!set) geomsByArc.set(a, (set = new Set()));
    set.add(g);
  }
}
for (const set of geomsByArc.values()) {
  if (set.size < 2) continue; // coastline arc
  const list = [...set].map((g) => idOf.get(g)).filter((id) => id && byId.has(id));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i] !== list[j]) {
        byId.get(list[i]).neighbors.add(list[j]);
        byId.get(list[j]).neighbors.add(list[i]);
      }
    }
  }
}

// ── merge microstates into their smallest neighbour ────────────────
const merged = new Set();
const small = [...byId.values()].sort((x, y) => x.area - y.area);
for (const c of small) {
  if (c.area >= MIN_AREA_KM2 || merged.has(c.id)) continue;
  const nbrs = [...c.neighbors].filter((n) => byId.has(n) && !merged.has(n));
  if (nbrs.length === 0) continue; // island microstate: keep solo, sea links later
  const host = nbrs.map((n) => byId.get(n)).sort((x, y) => x.area - y.area)[0];
  host.rings = host.rings.concat(c.rings);
  host.geoRings = host.geoRings.concat(c.geoRings);
  host.area += c.area;
  c.neighbors.forEach((n) => { if (n !== host.id) host.neighbors.add(n); });
  host.neighbors.delete(c.id);
  merged.add(c.id);
  byId.delete(c.id);
}

// after merges, drop stale neighbour refs left by deleted countries
for (const r of byId.values()) {
  r.neighbors = new Set([...r.neighbors].filter((n) => byId.has(n)));
}

// ── sea links: ensure every region has ≥3 neighbours (islands!) ────
for (const r of byId.values()) {
  while (r.neighbors.size < 3) {
    const cand = [...byId.values()]
      .filter((o) => o.id !== r.id && !r.neighbors.has(o.id))
      .sort((a, b) => dist(a.center, r.center) - dist(b.center, r.center))[0];
    if (!cand || dist(cand.center, r.center) > 1100) break; // none plausible (exclaves)
    r.neighbors.add(cand.id);
    cand.neighbors.add(r.id);
  }
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// ── curated sea lanes (strait/short-crossing attacks like classic Risk) ─
const LANE_PAIRS = [
  ['United Kingdom', 'France'],
  ['United Kingdom', 'Norway'],
  ['United Kingdom', 'Denmark'],
  ['Spain', 'Morocco'],
  ['Italy', 'Libya'],
  ['United States of America', 'Cuba'],
  ['Mexico', 'Cuba'],
  ['Saudi Arabia', 'Egypt'],
  ['Yemen', 'Somalia'],
  ['Japan', 'China'],
  ['South Korea', 'China'],
  ['Turkey', 'Turkmenistan'],
  ['Russia', 'United States of America'], // Bering
];
{
  const byName = new Map([...byId.values()].map((r) => [r.name, r]));
  for (const [na, nb] of LANE_PAIRS) {
    const a = byName.get(na);
    const b = byName.get(nb);
    if (a && b && a !== b) {
      a.neighbors.add(b.id);
      b.neighbors.add(a.id);
    }
  }
}

// ── curated sea routes: the world graph must be ONE component ──────
const SEA_ROUTES = [
  [-169, 65.5],  // Bering: Alaska ↔ Chukotka
  [-30, 48],     // North Atlantic: Canada/EEUU ↔ Britania/Francia
  [-17, -8],     // Sur Atlántico: Brasil ↔ Angola/Gabón
  [66, 13],      // Mar Arábigo: Omán ↔ India
  [-40, 17],     // Caribe ↔ África Occidental
  [150, -2],     // Indonesia ↔ Nueva Guinea (ya terrestre si topología)
];
for (const [lon, lat] of SEA_ROUTES) {
  const p = proj([lon, lat]);
  const near = [...byId.values()].map((r) => ({ r, d: dist(r.center, p) })).sort((a, b) => a.d - b.d);
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < Math.min(i + 10, near.length); j++) {
      const a = near[i].r, b = near[j].r;
      if (a.neighbors.has(b.id)) continue;
      if (near[i].d > 600 && near[j].d > 600) continue;
      a.neighbors.add(b.id);
      b.neighbors.add(a.id);
      i = near.length; break; // one route per waypoint
    }
  }
}

// ── connectivity guarantee: auto-close any remaining components ────
function components() {
  const seen = new Set();
  const comps = [];
  for (const start of byId.keys()) {
    if (seen.has(start)) continue;
    const comp = new Set([start]);
    const q = [start];
    while (q.length) {
      const cur = byId.get(q.shift());
      if (!cur) continue;
      for (const n of cur.neighbors) {
        if (!byId.has(n) || comp.has(n)) continue;
        comp.add(n);
        q.push(n);
      }
    }
    comp.forEach((x) => seen.add(x));
    comps.push(comp);
  }
  return comps;
}
for (let guard = 0; guard < 16; guard++) {
  const comps = components();
  if (comps.length <= 1) break;
  const big = comps.reduce((a, b) => (b.size > a.size ? b : a));
  const small = comps.filter((c) => c !== big).reduce((a, b) => (b.size <= a.size ? b : a));
  let best = null;
  for (const a of big) for (const b of small) {
    const d = dist(byId.get(a).center, byId.get(b).center);
    if (!best || d < best.d) best = { a, b, d };
  }
  byId.get(best.a).neighbors.add(best.b);
  byId.get(best.b).neighbors.add(best.a);
}

// prune neighbour refs to existing regions + dedupe symmetric
for (const r of byId.values()) {
  r.neighbors = new Set([...r.neighbors].filter((n) => byId.has(n)));
}
for (const r of byId.values()) {
  for (const n of r.neighbors) byId.get(n).neighbors.add(r.id);
}

const regions = [...byId.values()].sort((a, b) => b.area - a.area);
// fine 1..8 tiers by real area so size differences are always visible
const powerOf = (area) => (
  area > 10_000_000 ? 8
  : area > 5_000_000 ? 7
  : area > 2_500_000 ? 6
  : area > 1_200_000 ? 5
  : area > 600_000 ? 4
  : area > 250_000 ? 3
  : area > 80_000 ? 2
  : 1
);

// ── continent lookup for surviving regions ─────────────────────────
for (const r of regions) {
  r.continent = CONTINENT_MAP[r.name] ?? null;
}
// Inference pass: unmapped regions adopt the continent of the closest mapped neighbour.
for (let pass = 0; pass < 4; pass++) {
  let changed = false;
  for (const r of regions) {
    if (r.continent) continue;
    const cand = [...r.neighbors]
      .map((n) => byId.get(n))
      .filter((o) => o && o.continent)
      .sort((a, b) => dist(a.center, r.center) - dist(b.center, r.center))[0];
    if (cand) { r.continent = cand.continent; changed = true; console.warn('inferred continent', r.name, '→', r.continent); }
  }
  if (!changed) break;
}
for (const r of regions) {
  if (!r.continent) { console.warn('NO CONTINENT for', r.name, '→ AS'); r.continent = 'AS'; }
}

// ── emit world.ts ──────────────────────────────────────────────────
const lines = [];
lines.push(`/**
 * GENERATED by scripts/build-world.mjs — do not edit by hand.
 * Real Natural Earth country shapes (50m), microstates merged, ${regions.length} regions.
 */
export type ContinentId = ${regions.map((r) => `'${r.continent}'`).filter((v, i, a) => a.indexOf(v) === i).sort().map((v) => v.replace(/"/g, "'")).join(' | ')};

export interface RegionData {
  id: string;
  name: string;
  continent: ContinentId;
  /** 1..8 coarse tier (kept for tie-breaking). */
  power: number;
  /** REAL country area in km² — the source of truth for proportional troops. */
  area: number;
  /** One or more polygon rings (islands), world coords. */
  rings: [number, number][][];
  center: [number, number];
}

export const WORLD_WIDTH = ${W};
export const WORLD_HEIGHT = ${H};

export const REGIONS: RegionData[] = [`);
for (const r of regions) {
  const rings = r.rings.map((ring) => `[[${ring.map((p) => p.join(',')).join('],[')}]]`).join(',');
  lines.push(`  { id: '${r.id}', name: '${r.name.replace(/'/g, "’")}', continent: '${r.continent}', power: ${powerOf(r.area)}, area: ${Math.round(r.area)}, center: [${r.center.map((v) => v.toFixed(0)).join(',')}], rings: [${rings}] },`);
}
lines.push(`];

/** Bidirectional adjacency graph (land borders + island sea links). */
export const ADJACENCY: Record<string, string[]> = {`);
for (const r of regions) {
  lines.push(`  '${r.id}': [${[...r.neighbors].map((n) => `'${n}'`).join(', ')}],`);
}
lines.push(`};

export interface ContinentData {
  id: ContinentId;
  name: string;
  regions: string[];
  bonus: number;
}

const CONTINENT_NAMES: Record<string, string> = { NA: 'Norteamérica', SA: 'Suramérica', EU: 'Europa', AS: 'Asia', AF: 'África', OC: 'Oceanía' };
const CONTINENT_BONUS: Record<string, number> = { NA: 2, SA: 2, EU: 3, AS: 4, AF: 3, OC: 2 };

export const CONTINENTS: ContinentData[] = Object.entries(
  REGIONS.reduce((acc, r) => ((acc[r.continent] ??= []).push(r.id), acc), {} as Record<string, string[]>),
).map(([id, regs]) => ({ id: id as ContinentId, name: CONTINENT_NAMES[id] ?? id, regions: regs, bonus: CONTINENT_BONUS[id] ?? 2 }));

/** Starting homelands: 3 per side, positioned so fronts form early. */
export const PLAYER_HOMELANDS = ${JSON.stringify(['840', '276', '076'])}; // USA, Alemania, Brasil
export const AI_HOMELANDS = ${JSON.stringify(['643', '156', '710'])};      // Rusia, China, Sudáfrica

/** Troops placed in each homeland at game start. */
export const STARTING_ARMIES = 8;

export const regionById = new Map(REGIONS.map((r) => [r.id, r]));
export const continentById = new Map(CONTINENTS.map((c) => [c.id, c]));
`);

const outPath = path.resolve('src/lib/games/strategy-game-world/data/world.ts');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
const pointCount = regions.reduce((s, r) => s + r.rings.reduce((n, ring) => n + ring.length, 0), 0);
console.log(`regions: ${regions.length}, total points: ${pointCount}, file KB: ${(fs.statSync(outPath).size / 1024).toFixed(0)}`);

