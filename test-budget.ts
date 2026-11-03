import { createGame, endTurn, performAttack, canAttack, ownedRegions } from './src/lib/games/strategy-game-world/core/rules';
import { planAiTurn } from './src/lib/games/strategy-game-world/core/ai';
import type { GameState } from './src/lib/games/strategy-game-world/core/types';

function tryAttackAll(s: GameState, side: 'player' | 'ai'): number {
  let attacks = 0;
  for (let iter = 0; iter < 80; iter++) {
    let fired = false;
    outer: for (const from of ownedRegions(s, side)) {
      for (const to of Object.keys(s.regions)) {
        if (canAttack(s, from, to)) {
          performAttack(s, from, to);
          attacks++;
          fired = true;
          break outer;
        }
      }
    }
    if (!fired) break;
  }
  return attacks;
}

// TEST 1: 3 countries at turn start → exactly at most 3 attacks that turn,
// and conquests do NOT let the new country attack in the same turn.
{
  const s: GameState = createGame('player', 3);
  const before = ownedRegions(s, 'player').length;
  const attacks = tryAttackAll(s, 'player');
  const after = ownedRegions(s, 'player').length;
  console.log(`TEST1: start=${before} attacks=${attacks} conquered=${after - before}`);
  if (attacks > before) throw new Error(`BUDGET BROKEN: ${attacks} attacks from ${before} countries`);
  if (attacks !== Math.min(before, attacks)) throw new Error('unreachable');
}

// TEST 2: a conquered country itself cannot launch an attack this turn.
{
  const s: GameState = createGame('player', 3);
  let conquered: string | null = null;
  outer: for (const from of ownedRegions(s, 'player')) {
    for (const to of Object.keys(s.regions)) {
      if (canAttack(s, from, to)) {
        const r = performAttack(s, from, to);
        if (r.willCapture) {
          conquered = to;
          // immediately try to attack FROM the conquered region (bypassing the
          // per-region once check by clearing its acted entry)
          s.acted = s.acted.filter((x) => x !== conquered);
          const can = Object.keys(s.regions).some((t) => canAttack(s, conquered!, t));
          console.log(`TEST2: conquered=${conquered} canStrikeSameTurn=${can}`);
          if (can) throw new Error('conquered region attacked in the same turn');
          break outer;
        }
      }
    }
  }
  if (!conquered) console.log('TEST2: skipped (no capture happened)');
}

// TEST 3: the AI with 3 homelands also obeys the budget (the user's bug).
{
  const s: GameState = createGame('ai', 3);
  const actions = planAiTurn(s, 'ai');
  const attacks = actions.filter((a) => a.type === 'attack').length;
  console.log(`TEST3: aiStart=3 aiAttacks=${attacks}`);
  if (attacks > 3) throw new Error(`AI BUDGET BROKEN: ${attacks} attacks`);
}

// TEST 4: next turn, conquered countries join the strikers snapshot.
{
  const s: GameState = createGame('player', 3);
  const before = ownedRegions(s, 'player').length;
  tryAttackAll(s, 'player');
  const mid = ownedRegions(s, 'player').length;
  endTurn(s); // ai turn
  endTurn(s); // back to player
  const strikersNow = s.strikers.length;
  console.log(`TEST4: before=${before} midConquest=${mid} strikersNextTurn=${strikersNow}`);
  if (mid > before && strikersNow !== mid) throw new Error('strikers not refreshed after turn');
}

console.log('ALL BUDGET TESTS PASSED ✓');
