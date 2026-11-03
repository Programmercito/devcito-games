export type FactionId = 'player' | 'ai';

export interface RegionState {
  /** Controlling faction, or null for neutral territories. */
  owner: FactionId | null;
  /** Troops garrisoned in the region. */
  armies: number;
}

export interface GameState {
  turn: number;
  current: FactionId;
  /** True until the first faction finishes its opening turn. */
  openingTurn: boolean;
  /** Regions that already used their one attack this turn. */
  acted: string[];
  /**
   * Snapshot of regions owned when the current side's turn BEGAN.
   * Only these may attack this turn — countries conquered mid-turn join the
   * attack pool next turn. This is what stopped the 3-homeland AI from
   * chaining 10 attacks.
   */
  strikers: string[];
  regions: Record<string, RegionState>;
  winner: FactionId | null;
  /** Chosen uniformly at game start — used for the opening log. */
  initialHomelands: Record<FactionId, string[]>;
}

export interface AttackPreview {
  /** Troops the attacker sends. */
  send: number;
  /** Target garrison. */
  defense: number;
  /** Troops the attacker will lose even if the attack succeeds. */
  cost: number;
  /** True when the deterministic combat math says the attack wins. */
  willCapture: boolean;
  /** Garrisons left in the region if captured. */
  survivors: number;
}

export type AiAction =
  | { type: 'attack'; from: string; to: string }
  | { type: 'move'; from: string; to: string; amount: number };
