import { createGame, endTurn, ownedRegions } from './src/lib/games/strategy-game-world/core/rules';
import { regionById } from './src/lib/games/strategy-game-world/data/world';
import type { GameState } from './src/lib/games/strategy-game-world/core/types';

const s: GameState = createGame('player', 3);
const probe: [string, string][] = [
  ['Russia', '643'], ['China', '156'], ['Brazil', '076'], ['India', '356'],
  ['Spain', '724'], ['Bolivia', '068'], ['Italy', '380'], ['Turkey', '792'], ['France', '250'],
];
console.log('— GUARNICIÓN INICIAL (neutral, por km² reales) —');
for (const [nm, id] of probe) {
  const r = regionById.get(id);
  if (r && !s.regions[id].owner) console.log(`  ${nm.padEnd(10)} ${String(Math.round(r.area)).padStart(9)} km² → ${String(s.regions[id].armies).padStart(2)} tropas`);
}
console.log('— TUS PAÍSES INICIALES (home = guarnición + fortificación) —');
for (const id of s.initialHomelands.player) {
  const r = regionById.get(id)!;
  console.log(`  ${r.name.padEnd(24)} ${String(Math.round(r.area)).padStart(9)} km² → ${String(s.regions[id].armies).padStart(2)} tropas`);
}

console.log('— REPARTO DE REFUERZOS: 3 turnos, país por país —');
const growth: Record<string, number[]> = {};
for (let t = 0; t < 3; t++) {
  endTurn(s); endTurn(s); // player -> ai -> player (turn++)
  for (const id of ownedRegions(s, 'player')) {
    growth[id] ??= [];
    growth[id].push(s.regions[id].armies);
  }
}
for (const [id, seq] of Object.entries(growth)) {
  if (seq.length >= 2) console.log(`  ${regionById.get(id)!.name.padEnd(24)} ${seq.join(' → ')}`);
}
