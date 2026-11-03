import {
  ADJACENCY,
  AI_HOMELANDS,
  CONTINENTS,
  PLAYER_HOMELANDS,
  REGIONS,
  STARTING_ARMIES,
  regionById,
} from '../data/world';
import type { AttackPreview, FactionId, GameState } from './types';

/** Defense advantage: holding ground is harder to take (deterministic combat). */
export const DEFENSE_FACTOR = 1.25;

/** Troops the attacker loses taking a region with `defense` garrisoned. */
export function attackCost(defense: number): number {
  return Math.floor(defense * DEFENSE_FACTOR);
}

export function createGame(first: FactionId): GameState {
  const regions: GameState['regions'] = {};
  for (const r of REGIONS) {
    regions[r.id] = { owner: null, armies: r.power + 1 };
  }
  for (const id of PLAYER_HOMELANDS) regions[id] = { owner: 'player', armies: STARTING_ARMIES };
  for (const id of AI_HOMELANDS) regions[id] = { owner: 'ai', armies: STARTING_ARMIES };

  const s: GameState = { turn: 1, current: first, campaign: null, regions, winner: null };
  grantIncome(s, 'player');
  grantIncome(s, 'ai');
  return s;
}

export function ownedRegions(s: GameState, side: FactionId): string[] {
  return Object.keys(s.regions).filter((id) => s.regions[id].owner === side);
}

export function totalArmies(s: GameState, side: FactionId): number {
  return ownedRegions(s, side).reduce((sum, id) => sum + s.regions[id].armies, 0);
}

/** Income = base + territory scaling + continent bonuses. */
export function incomeFor(s: GameState, side: FactionId): number {
  const owned = ownedRegions(s, side);
  let income = 3 + Math.floor(owned.length / 3);
  for (const c of CONTINENTS) {
    if (c.regions.length > 0 && c.regions.every((id) => s.regions[id]?.owner === side)) income += c.bonus;
  }
  return Math.max(income, 1);
}

/**
 * Reinforcements are NOT a manual phase: they appear automatically at the
 * start of every side's turn, spread over the frontline regions — cheapest
 * (weakest) target first, so troops flow where conquest is imminent.
 */
export function grantIncome(s: GameState, side: FactionId): number {
  const income = incomeFor(s, side);
  const fronts = ownedRegions(s, side)
    .filter((id) => (ADJACENCY[id] ?? []).some((n) => s.regions[n].owner !== side))
    .sort((a, b) => minFrontCost(s, a, side) - minFrontCost(s, b, side));
  if (fronts.length === 0) return 0;
  let i = 0;
  for (let k = 0; k < income; k++) {
    s.regions[fronts[i % fronts.length]].armies += 1;
    i += 1;
  }
  return income;
}

function minFrontCost(s: GameState, id: string, side: FactionId): number {
  const targets = (ADJACENCY[id] ?? []).filter((n) => s.regions[n].owner !== side);
  if (targets.length === 0) return Infinity;
  return Math.min(...targets.map((t) => attackCost(s.regions[t].armies)));
}

export function isAdjacent(a: string, b: string): boolean {
  return (ADJACENCY[a] ?? []).includes(b);
}

/** One campaign per turn: after the first strike you must push from it. */
export function canAttack(s: GameState, from: string, to: string): boolean {
  const src = s.regions[from];
  const dst = s.regions[to];
  if (!src || !dst || src.owner !== s.current || dst.owner === s.current) return false;
  if (src.armies <= 1 || !isAdjacent(from, to)) return false;
  if (s.campaign === 'done') return false;
  if (typeof s.campaign === 'string' && s.campaign !== from) return false;
  return true;
}

export function previewAttack(s: GameState, from: string, to: string): AttackPreview {
  const send = Math.max(0, s.regions[from].armies - 1);
  const defense = s.regions[to].armies;
  const cost = attackCost(defense);
  const willCapture = send > cost;
  return { send, defense, cost, willCapture, survivors: willCapture ? send - cost : 0 };
}

/** Deterministic combat (Option B): no dice, pure math. */
export function performAttack(s: GameState, from: string, to: string): AttackPreview {
  const result = previewAttack(s, from, to);
  s.regions[from].armies = 1;
  if (result.willCapture) {
    s.regions[to].owner = s.current;
    s.regions[to].armies = result.survivors;
    s.campaign = to; // the campaign continues only from the conquest
  } else {
    s.campaign = 'done'; // a repelled strike burns the turn's offensive
  }
  s.winner = checkWinner(s);
  return result;
}

/** Voluntarily end the campaign (e.g. to shuffle troops instead). */
export function endCampaign(s: GameState): void {
  if (s.campaign !== 'done') s.campaign = 'done';
}

export function canMove(s: GameState, from: string, to: string): boolean {
  const src = s.regions[from];
  const dst = s.regions[to];
  return (
    !!src && !!dst &&
    src.owner === s.current && dst.owner === s.current &&
    src.armies > 1 && isAdjacent(from, to)
  );
}

export function moveArmies(s: GameState, from: string, to: string, amount: number): number {
  const moved = Math.min(amount, s.regions[from].armies - 1);
  s.regions[from].armies -= moved;
  s.regions[to].armies += moved;
  return moved;
}

/** Switch to the other faction: its income auto-deploys at the front. */
export function endTurn(s: GameState): void {
  const next: FactionId = s.current === 'player' ? 'ai' : 'player';
  s.current = next;
  s.campaign = null;
  if (next === 'player') s.turn += 1;
  grantIncome(s, next);
}

/** Victory = whole world owned, or opponent wiped off the map. */
export function checkWinner(s: GameState): FactionId | null {
  const player = ownedRegions(s, 'player').length;
  const ai = ownedRegions(s, 'ai').length;
  if (player === 0 && ai > 0) return 'ai';
  if (ai === 0 && player > 0) return 'player';
  if (player === REGIONS.length) return 'player';
  if (ai === REGIONS.length) return 'ai';
  return null;
}

export function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

export function nameOf(regionId: string): string {
  return regionById.get(regionId)?.name ?? regionId;
}
