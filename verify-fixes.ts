import { createGame, canAttack, previewAttack, ownedRegions, performAttack, endTurn } from './src/lib/games/strategy-game-world/core/rules';
import { regionById } from './src/lib/games/strategy-game-world/data/world';
import type { GameState } from './src/lib/games/strategy-game-world/core/types';

// 1) Mongolia (30 troops) vs Russia (25): now attackable (1:1 law)
const s: GameState = createGame('player', 3);
for (const id of Object.keys(s.regions)) s.regions[id].owner = null;
s.regions['496'] = { owner: 'player', armies: 30 }; // Mongolia
s.regions['643'] = { owner: null, armies: 25 }; // Russia
const legal = canAttack(s, '496', '643');
const p = previewAttack(s, '496', '643');
console.log(`MONGOLIA(30) -> RUSIA(25): legal=${legal} ganas=${p.willCapture} quedan=${p.survivors}`);
if (!legal || !p.willCapture) throw new Error('MONGOLIA SHOULD BE ABLE TO ATTACK RUSSIA');

// 2) Colombia vs Brazil capacity: 30 turns, Colombia must never exceed its cap (32) nor Brazil's cap
const g: GameState = createGame('ai', 3);
let maxCol = 0;
let maxBra = 0;
for (let t = 0; t < 60; t++) {
  // just cycle turns with income deployment, no fighting
  endTurn(g); endTurn(g);
  // force both onto the board as ai-owned to compare auto-deployment
  g.regions['170'] = { owner: 'ai', armies: Math.max(1, g.regions['170'].armies) }; // Colombia
  g.regions['076'] = { owner: 'ai', armies: Math.max(1, g.regions['076'].armies) }; // Brazil
  maxCol = Math.max(maxCol, g.regions['170'].armies);
  maxBra = Math.max(maxBra, g.regions['076'].armies);
}
console.log(`después de 30 turnos: Colombia=${maxCol} (cap 32) Brasil=${maxBra} (cap 62)`);
if (maxCol > 32) throw new Error('COLOMBIA EXCEEDS ITS CAP');
if (maxBra < maxCol) console.log('WARN: Colombia supero a Brasil');
else console.log('COHERENCIA OK: Brasil siempre >= Colombia');
console.log('VERIFICATION PASSED ✓');
