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

  const s: GameState = { turn: 1, current: first, acted: [], regions, winner: null };
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
 * Reinforcements are NOT a manual phase: they appear automatically every
 * turn, concentrated enough to break through but spread over the top
 * corridors (50/30/20) so a single interior pile can't hoard the war chest.
 */
export function grantIncome(s: GameState, side: FactionId): number {
  const income = incomeFor(s, side);
  const owned = ownedRegions(s, side);
  if (owned.length === 0) return 0;

  const corridors = topCorridors(s, side); // up to 3 distinct front regions
  const threatened = findThreatened(s, side);

  if (corridors.length === 0) {
    const dest = threatened.length ? threatened : owned;
    const richest = dest.sort((a, b) => s.regions[b].armies - s.regions[a].armies)[0];
    s.regions[richest].armies += income;
    return income;
  }

  const shares = splitIncome(income, corridors.length);
  corridors.forEach((id, i) => {
    s.regions[id].armies += shares[i] ?? 0;
  });
  return income;
}

function splitIncome(income: number, n: number): number[] {
  if (n === 1) return [income];
  if (n === 2) return [Math.ceil(income * 0.65), Math.floor(income * 0.35)];
  const a = Math.ceil(income * 0.5);
  const b = Math.round(income * 0.3);
  return [a, b, Math.max(0, income - a - b)];
}

function findThreatened(s: GameState, side: FactionId): string[] {
  return ownedRegions(s, side)
    .filter((id) =>
      (ADJACENCY[id] ?? []).some((n) => {
        const e = s.regions[n];
        return !!e.owner && e.owner !== side && e.armies - 1 > attackCost(s.regions[id].armies);
      }),
    )
    .sort((a, b) => s.regions[a].armies - s.regions[b].armies);
}

/**
 * Up to 3 distinct front regions ranked by how close they are to conquering
 * one of their targets (need = extra troops required). Interior regions
 * (all neighbours already ours) can't be corridors.
 */
function topCorridors(s: GameState, side: FactionId): string[] {
  const bestPerFrom = new Map<string, number>();
  for (const from of ownedRegions(s, side)) {
    for (const to of ADJACENCY[from] ?? []) {
      const t = s.regions[to];
      if (t.owner === side) continue;
      const need = Math.max(0, attackCost(t.armies) + 1 - s.regions[from].armies);
      if (!bestPerFrom.has(from) || need < bestPerFrom.get(from)!) bestPerFrom.set(from, need);
    }
  }
  return [...bestPerFrom.entries()]
    .sort((a, b) => a[1] - b[1] || s.regions[b[0]].armies - s.regions[a[0]].armies)
    .slice(0, 3)
    .map(([from]) => from);
}

export function isAdjacent(a: string, b: string): boolean {
  return (ADJACENCY[a] ?? []).includes(b);
}

/** Each region may strike once per turn — multiple fronts are fine. */
export function canAttack(s: GameState, from: string, to: string): boolean {
  const src = s.regions[from];
  const dst = s.regions[to];
  if (!src || !dst || src.owner !== s.current || dst.owner === s.current) return false;
  if (src.armies <= 1 || !isAdjacent(from, to)) return false;
  return !s.acted.includes(from);
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
  s.acted.push(from);
  if (result.willCapture) {
    s.regions[to].owner = s.current;
    s.regions[to].armies = result.survivors; // the conquest may strike again this turn
  }
  s.winner = checkWinner(s);
  return result;
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
  s.acted = [];
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
