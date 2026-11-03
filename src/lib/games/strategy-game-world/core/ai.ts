import { ADJACENCY, CONTINENTS, regionById } from '../data/world';
import {
  attackCost,
  canAttack,
  cloneState,
  moveArmies,
  ownedRegions,
  performAttack,
  previewAttack,
} from './rules';
import type { AiAction, FactionId, GameState } from './types';

/**
 * Strategic AI for deterministic combat with one-campaign-per-turn:
 * it opens the offensive on the target with the best future value (cheap
 * kill, enemy land, continent locks, and enough survivors to KEEP pushing),
 * chains conquests through that front, then drags rear troops forward.
 */
export function planAiTurn(input: GameState): AiAction[] {
  const s = cloneState(input);
  const ai: FactionId = 'ai';
  const actions: AiAction[] = [];

  let guard = 0;
  while (guard++ < 60 && !s.winner) {
    const attack = bestAttack(s, ai);
    if (attack) {
      performAttack(s, attack.from, attack.to);
      actions.push({ type: 'attack', from: attack.from, to: attack.to });
      continue;
    }
    const mv = bestMove(s, ai);
    if (mv) {
      moveArmies(s, mv.from, mv.to, mv.amount);
      actions.push(mv);
      continue;
    }
    break;
  }
  return actions;
}

interface AttackOption {
  from: string;
  to: string;
  score: number;
}

function bestAttack(s: GameState, side: FactionId): AttackOption | null {
  let best: AttackOption | null = null;
  for (const from of ownedRegions(s, side)) {
    for (const to of ADJACENCY[from] ?? []) {
      if (!canAttack(s, from, to)) continue;
      const target = s.regions[to];
      if (!regionById.get(to)) continue;

      const p = previewAttack(s, from, to);
      if (!p.willCapture) continue; // never burn the campaign on a loss

      let score = 14 - p.cost; // cheap kills first
      if (target.owner && target.owner !== side) score += 12; // war over land
      if (completesContinent(s, side, to)) score += 15; // continent lock
      score += p.survivors * 2; // keep the offensive alive
      score += (ADJACENCY[to] ?? []).filter((n) => s.regions[n].owner !== side).length;

      if (!best || score > best.score) best = { from, to, score };
    }
  }
  return best;
}

function completesContinent(s: GameState, side: FactionId, to: string): boolean {
  const c = CONTINENTS.find((x) => x.regions.includes(to));
  if (!c || c.regions.length === 0) return false;
  return c.regions.every((id) => id === to || s.regions[id].owner === side);
}

/**
 * Move armies from a rear region toward the frontline: BFS over own regions
 * from every "front" (own region touching something foreign); step back
 * from the front and drag parked troops forward.
 */
function bestMove(s: GameState, side: FactionId): Extract<AiAction, { type: 'move' }> | null {
  const owned = ownedRegions(s, side);
  const fronts = owned.filter((id) =>
    (ADJACENCY[id] ?? []).some((n) => s.regions[n].owner !== side),
  );
  if (fronts.length === 0) return null;

  const dist = bfsToFronts(owned, fronts);

  let best: Extract<AiAction, { type: 'move' }> | null = null;
  let bestGain = 0;
  for (const a of owned) {
    if (s.regions[a].armies <= 3 || !dist.has(a) || dist.get(a) === 0) continue;
    for (const b of ADJACENCY[a] ?? []) {
      if (s.regions[b].owner !== side) continue;
      const bd = dist.get(b);
      if (bd === undefined) continue;
      if (bd < (dist.get(a) ?? Infinity)) {
        const gain = s.regions[a].armies;
        if (gain > bestGain) {
          bestGain = gain;
          best = { type: 'move', from: a, to: b, amount: s.regions[a].armies - 1 };
        }
      }
    }
  }
  return best;
}

function bfsToFronts(owned: string[], fronts: string[]): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const f of fronts) {
    dist.set(f, 0);
    queue.push(f);
  }
  const ownedSet = new Set(owned);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of ADJACENCY[cur] ?? []) {
      if (!ownedSet.has(n) || dist.has(n)) continue;
      dist.set(n, (dist.get(cur) ?? 0) + 1);
      queue.push(n);
    }
  }
  return dist;
}
