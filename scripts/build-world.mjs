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
const RING_MIN_KM2 = 700; // rings (islands) below this are dropped
const MAX_POINTS_PER_RING = 55;

const proj = ([lon, lat]) => [
  ((lon + 180) / 360) * W,
  ((90 - lat) / 180) * H,
];

const feats = feature(topo, topo.objects.countries).features.filter(
  (f) => f.properties.name !== 'Antarctica' && f.id !== '010',
);

// ── geometry helpers (lon/lat) ─────────────────────────────────────
const kmLat = H / 180; // deg lat → px; px→km via earth circumference
const PX_TO_KM = 40030 / H; // equator length in px ≈ 40030 km

function ringAreaKm2(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = proj(ring[i]);
    const [x2, y2] = proj(ring[(i + 1) % ring.length]);
    const latK = Math.cos((ring[i][1] * Math.PI) / 180);
    s += x1 * y2 * latK - x2 * y1 * latK;
  }
  return Math.abs(s / 2) * PX_TO_KM * PX_TO_KM;
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

// ── per-country rings ──────────────────────────────────────────────
const byId = new Map();
for (const f of feats) {
  const ringsGeo = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]);
  const rings = ringsGeo.filter((r) => ringAreaKm2(r) >= RING_MIN_KM2);
  if (rings.length === 0) continue;
  const id = String(f.id);
  byId.set(id, {
    id,
    name: f.properties.name,
    geoRings: rings,
    rings: rings.map((r) => simplify(r, 60)),
    area: totalArea(rings),
    center: centroidOf(rings),
    neighbors: new Set(),
  });
}

// ── land adjacency: after feature(), each topo arc carries __data__ with
//    the geometries (1=coast, 2=land border) that share it ───────────
const topoGeomToId = new Map(topo.objects.countries.geometries.map((g) => [g, String(g.id)]));
for (const arc of topo.arcs) {
  const owners = arc && arc.__data__ ? arc.__data__.map((g) => topoGeomToId.get(g)).filter(Boolean) : [];
  const uniq = [...new Set(owners)];
  if (uniq.length === 2) {
    byId.get(uniq[0])?.neighbors.add(uniq[1]);
    byId.get(uniq[1])?.neighbors.add(uniq[0]);
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

// ── sea links: ensure every region has ≥2 neighbours (islands!) ────
for (const r of byId.values()) {
  while (r.neighbors.size < 2) {
    const cand = [...byId.values()]
      .filter((o) => o.id !== r.id && !r.neighbors.has(o.id))
      .sort((a, b) => dist(a.center, r.center) - dist(b.center, r.center))[0];
    if (!cand || dist(cand.center, r.center) > 900) break; // none plausible (exclaves)
    r.neighbors.add(cand.id);
    cand.neighbors.add(r.id);
  }
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// prune neighbour refs to existing regions + dedupe symmetric
for (const r of byId.values()) {
  r.neighbors = new Set([...r.neighbors].filter((n) => byId.has(n)));
}
for (const r of byId.values()) {
  for (const n of r.neighbors) byId.get(n).neighbors.add(r.id);
}

const regions = [...byId.values()].sort((a, b) => b.area - a.area);
const powerOf = (area) => (area > 4_000_000 ? 4 : area > 1_600_000 ? 3 : area > 500_000 ? 2 : 1);

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
  /** 1..4 — bigger nations garrison more. */
  power: number;
  /** One or more polygon rings (islands), world coords. */
  rings: [number, number][][];
  center: [number, number];
}

export const WORLD_WIDTH = ${W};
export const WORLD_HEIGHT = ${H};

export const REGIONS: RegionData[] = [`);
for (const r of regions) {
  const rings = r.rings.map((ring) => `[[${ring.map((p) => p.join(',')).join('],[')}]]`).join(',');
  lines.push(`  { id: '${r.id}', name: '${r.name.replace(/'/g, "’")}', continent: '${r.continent}', power: ${powerOf(r.area)}, center: [${r.center.map((v) => v.toFixed(0)).join(',')}], rings: [${rings}] },`);
}
lines.push(`];

/** Bidirectional adjacency graph (land borders + island sea links). */
export const ADJACENCY: Record<string, string[]> = {`);
for (const r of regions) {
  lines.push(`  ${r.id}: [${[...r.neighbors].map((n) => `'${n}'`).join(', ')}],`);
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
export const PLAYER_HOMELANDS = [${JSON.stringify(['840', '276', '076'])}]; // USA, Alemania, Brasil
export const AI_HOMELANDS = [${JSON.stringify(['643', '156', '710'])}];      // Rusia, China, Sudáfrica

/** Troops placed in each homeland at game start. */
export const STARTING_ARMIES = 8;

export const regionById = new Map(REGIONS.map((r) => [r.id, r]));
export const continentById = new Map(CONTINENTS.map((c) => [c.id, c]));
`);

const outPath = path.resolve('src/lib/games/strategy-game-world/data/world.ts');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
const pointCount = regions.reduce((s, r) => s + r.rings.reduce((n, ring) => n + ring.length, 0), 0);
console.log(`regions: ${regions.length}, total points: ${pointCount}, file KB: ${(fs.statSync(outPath).size / 1024).toFixed(0)}`);
