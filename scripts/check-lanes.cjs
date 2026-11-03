const fs = require('fs');
const s = fs.readFileSync('src/lib/games/strategy-game-world/data/world.ts', 'utf8');

const adjOf = (id) => {
  const m = s.match(new RegExp(`'${id}': \\[([^\\]]*)\\]`));
  return m ? (m[1].match(/'[^']+'/g) || []).map((x) => x.replace(/'/g, '')) : null;
};

const lanes = [
  ['826', '250', 'UK-Francia'],
  ['826', '578', 'UK-Noruega'],
  ['724', '504', 'España-Marruecos'],
  ['380', '434', 'Italia-Libia'],
  ['840', '192', 'EEUU-Cuba'],
  ['682', '818', 'Saudi-Egipto'],
  ['887', '706', 'Yemen-Somalia'],
  ['392', '156', 'Japón-China'],
  ['643', '840', 'Rusia-EEUU (Bering)'],
];
let ok = true;
for (const [a, b, name] of lanes) {
  const A = adjOf(a);
  const pass = A && (A.includes(b) || adjOf(b)?.includes(a));
  if (!pass) ok = false;
  console.log(`lane ${name}:`, pass ? 'OK' : 'MISSING');
}
const degrees = Object.fromEntries(
  [...s.matchAll(/'(\d+)': \[([^\]]*)\]/g)].map((m) => [m[1], (m[2].match(/'[^']+'/g) || []).length]),
);
const vals = Object.values(degrees);
const min = Math.min(...vals);
console.log(`regions-with-adj=${vals.length} minDeg=${min} deg<3=${vals.filter((d) => d < 3).length}`);

// connectivity
const adj = {};
for (const m of s.matchAll(/^  '([^']+)': \[([^\]]*)\],$/gm)) {
  adj[m[1]] = (m[2].match(/'[^']+'/g) || []).map((x) => x.replace(/'/g, ''));
}
const ids = Object.keys(adj);
const seen = new Set();
let comps = 0;
for (const start of ids) {
  if (seen.has(start)) continue;
  comps++;
  const q = [start];
  seen.add(start);
  while (q.length) for (const n of adj[q.shift()] ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
}
console.log(`regions-with-adj=${ids.length} components=${comps} → ${comps === 1 && ok ? 'ALL GOOD ✓' : 'PROBLEMS'}`);
