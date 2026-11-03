import { createGame, endTurn, performAttack, moveArmies, ownedRegions, incomeFor } from './src/lib/games/strategy-game-world/core/rules';
import { planAiTurn } from './src/lib/games/strategy-game-world/core/ai';
import type { GameState } from './src/lib/games/strategy-game-world/core/types';

function step(state: GameState): number {
  const actions = planAiTurn(state, state.current);
  for (const a of actions) {
    if (a.type === 'attack') performAttack(state, a.from, a.to);
    else moveArmies(state, a.from, a.to, a.amount);
  }
  return actions.length;
}

// income must climb every turn
const probe: GameState = createGame('player', 3);
const i1 = incomeFor(probe, 'player');
for (let k = 0; k < 4; k++) { endTurn(probe); endTurn(probe); }
const i5 = incomeFor(probe, 'player');
console.log(`income t1=${i1} t5=${i5} growing=${i5 > i1 ? 'OK' : 'FAIL'}`);
if (i5 <= i1) throw new Error('income not growing');

for (const first of ['player', 'ai'] as const) {
  for (const count of [1, 3, 5]) {
    const s: GameState = createGame(first, count);
    let rounds = 0;
    while (!s.winner && rounds < 500) {
      step(s);
      if (!s.winner) endTurn(s);
      rounds++;
    }
    console.log(`first=${first} homelands=${count}: rounds=${rounds} winner=${s.winner} p=${ownedRegions(s, 'player').length} a=${ownedRegions(s, 'ai').length}`);
    if (!s.winner) throw new Error('STALL');
  }
}
console.log('OK: all conclude');
