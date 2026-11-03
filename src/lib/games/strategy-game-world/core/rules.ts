import {
  ADJACENCY,
  CONTINENTS,
  REGIONS,
  regionById,
} from '../data/world';
import type { AttackPreview, FactionId, GameState } from './types';


/**
 * Size drives everything (coherence): every number comes from the country's
 * REAL area (km²), continuous — Russia 17M km² can never look like a
 * median-sized Spain. √area keeps ratios sane (a 100× country gets ~10× troops).
 */
const areaOf = (id: string): number => regionById.get(id)?.area ?? 100_000;
/** Peacetime garrison of a neutral: Spain ~6, Bolivia ~8, Brazil ~18, Russia ~25. */
export const garrisonForArea = (area: number): number =>
  Math.min(30, Math.max(2, Math.round(2 + Math.sqrt(area) / 180)));
/** Initial garrisons vary each game without changing their size-based baseline. */
export const initialGarrisonForArea = (area: number): number =>
  Math.max(2, Math.round(garrisonForArea(area) * (0.85 + Math.random() * 0.3)));
/** Production per country per turn: Brazil 6, Bolivia 3, Spain 1, Russia 9. */
export const productionForArea = (area: number): number =>
  Math.max(1, Math.round(Math.sqrt(area) / 500));
/** Max troops the territory can hold. */
export const capForArea = (area: number): number =>
  garrisonForArea(area) * 3 + 8;

export interface IncomeResult {
  income: number;
  /** Regions where the troops were auto-deployed (for the HUD log). */
  places: string[];
}

/**
 * A country wins when its total army exceeds the defender's. One troop
 * remains behind and at least one must occupy a captured country.
 */
export function attackCost(defense: number): number {
  return Math.max(0, defense - 1);
}

export function createGame(first: FactionId, homelandsPerSide = 3): GameState {
  const regions: GameState['regions'] = {};
  for (const r of REGIONS) {
    regions[r.id] = { owner: null, armies: initialGarrisonForArea(r.area) };
  }
  const initialHomelands = pickHomelands(homelandsPerSide);
  for (const id of initialHomelands.player) regions[id].owner = 'player';
  for (const id of initialHomelands.ai) regions[id].owner = 'ai';

  const s: GameState = {
    turn: 1,
    current: first,
    openingTurn: true,
    acted: [],
    strikers: [...initialHomelands[first]],
    regions,
    winner: null,
    initialHomelands,
  };
  return s;
}

/** Draw uniformly without replacement, regardless of location or country size. */
export function pickHomelands(n: number): Record<FactionId, string[]> {
  if (!Number.isInteger(n) || n < 1 || n * 2 > REGIONS.length) {
    throw new RangeError('Invalid number of starting countries per side');
  }
  const pool = REGIONS.map((r) => r.id);
  const draw = (): string => {
    const index = Math.floor(Math.random() * pool.length);
    [pool[index], pool[pool.length - 1]] = [pool[pool.length - 1], pool[index]];
    return pool.pop()!;
  };
  return {
    player: Array.from({ length: n }, draw),
    ai: Array.from({ length: n }, draw),
  };
}

export function ownedRegions(s: GameState, side: FactionId): string[] {
  return Object.keys(s.regions).filter((id) => s.regions[id].owner === side);
}

export function totalArmies(s: GameState, side: FactionId): number {
  return ownedRegions(s, side).reduce((sum, id) => sum + s.regions[id].armies, 0);
}

/**
 * Production = each country contributes ITS OWN SIZE + war mobilization that
 * grows EVERY turn (+2 per turn) + continent bonuses. Conquering big
 * countries pays for itself immediately.
 */
export function incomeFor(s: GameState, side: FactionId): number {
  const owned = ownedRegions(s, side);
  let income = owned.reduce((sum, id) => sum + productionForArea(areaOf(id)), 0);
  income += 2 * (s.turn - 1);
  for (const c of CONTINENTS) {
    if (c.regions.length > 0 && c.regions.every((id) => s.regions[id]?.owner === side)) income += c.bonus;
  }
  return Math.max(income, 2);
}

/**
 * Reinforcements are NOT a manual phase: they appear automatically every
 * turn, concentrated enough to break through but spread over the top
 * corridors (50/30/20) so a single interior pile can't hoard the war chest.
 */
export function grantIncome(s: GameState, side: FactionId): IncomeResult {
  const income = incomeFor(s, side);
  const owned = ownedRegions(s, side);
  if (owned.length === 0) return { income: 0, places: [] };

  const places: string[] = [];
  /** Place up to n troops into id, respecting its capacity; returns unplaced. */
  const add = (id: string, n: number): number => {
    const room = Math.max(0, capForArea(areaOf(id)) - s.regions[id].armies);
    const got = Math.min(n, room);
    if (got > 0) {
      s.regions[id].armies += got;
      if (!places.includes(id)) places.push(id);
    }
    return n - got;
  };

  // 30% massed at the best offensive corridor (breakthroughs need weight)...
  const corridor = topCorridors(s, side)[0];
  let rest = income;
  if (corridor) {
    const unplaced = add(corridor, Math.round(income * 0.3));
    rest = income - Math.round(income * 0.3) + unplaced;
  }

  // 70% split across EVERY country proportional to its own size — Brazil
  // grows faster than Bolivia, visibly, every single turn.
  const weights = owned.map((id) => ({ id, w: productionForArea(areaOf(id)) }));
  const sumW = weights.reduce((t, x) => t + x.w, 0) || 1;
  const shares = weights.map(({ id, w }) => {
    const raw = (rest * w) / sumW;
    return { id, base: Math.floor(raw), frac: raw - Math.floor(raw) };
  });
  let assigned = shares.reduce((t, x) => t + x.base, 0);
  shares.sort((a, b) => b.frac - a.frac); // largest-remainder rounding
  let unplaced = 0;
  for (const sh of shares) {
    const give = sh.base + (assigned < rest ? 1 : 0);
    assigned += give - sh.base;
    unplaced += add(sh.id, give);
  }
  // If countries filled their caps, redistribute to those with ROOM — still
  // honoring each cap. A small corridor can never outgrow a giant's capacity.
  let leftover = unplaced;
  if (leftover > 0) {
    const withRoom = owned
      .map((id) => ({ id, room: capForArea(areaOf(id)) - s.regions[id].armies }))
      .filter((x) => x.room > 0)
      .sort((a, b) => b.room - a.room);
    for (const r of withRoom) {
      if (leftover <= 0) break;
      const put = Math.min(leftover, r.room);
      s.regions[r.id].armies += put;
      leftover -= put;
      if (!places.includes(r.id)) places.push(r.id);
    }
  }
  return { income, places: places.slice(0, 3) };
}

/**
 * Front regions ranked by how close they are to conquering one of their
 * targets — tie-broken toward BIGGER countries (power), so a large conquest
 * pays for itself next turn. Regions at their force cap are skipped.
 */
function topCorridors(s: GameState, side: FactionId): string[] {
  const bestPerFrom = new Map<string, number>();
  for (const from of ownedRegions(s, side)) {
    if (s.regions[from].armies >= capForArea(areaOf(from))) continue; // no room
    for (const to of ADJACENCY[from] ?? []) {
      const t = s.regions[to];
      if (t.owner === side) continue;
      const need =
        Math.max(0, attackCost(t.armies) + 2 - s.regions[from].armies) -
        productionForArea(areaOf(to));
      if (!bestPerFrom.has(from) || need < bestPerFrom.get(from)!) bestPerFrom.set(from, need);
    }
  }
  return [...bestPerFrom.entries()]
    .sort((a, b) => a[1] - b[1] || areaOf(b[0]) - areaOf(a[0]))
    .slice(0, 4)
    .map(([from]) => from);
}

export function isAdjacent(a: string, b: string): boolean {
  return (ADJACENCY[a] ?? []).includes(b);
}

/** Only countries owned at turn start may attack, each exactly once. */
export function canAttack(s: GameState, from: string, to: string): boolean {
  const src = s.regions[from];
  const dst = s.regions[to];
  if (!src || !dst || src.owner !== s.current || dst.owner === s.current) return false;
  if (src.armies <= 1 || !isAdjacent(from, to)) return false;
  if (!s.strikers.includes(from)) return false; // conquered this turn: waits its turn
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
  s.acted.push(from); // that region's one strike is used (hit or miss)
  if (result.willCapture) {
    s.regions[to].owner = s.current;
    s.regions[to].armies = result.survivors;
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

/** Switch sides; reinforcements begin on each side's second turn. */
export function endTurn(s: GameState): IncomeResult {
  const next: FactionId = s.current === 'player' ? 'ai' : 'player';
  const firstTurnForNext = s.openingTurn;
  s.openingTurn = false;
  s.current = next;
  s.acted = [];
  s.strikers = ownedRegions(s, next);
  if (next === 'player' && !firstTurnForNext) s.turn += 1;
  if (firstTurnForNext) return { income: 0, places: [] };
  return grantIncome(s, next);
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
