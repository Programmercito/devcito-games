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
  /** Regions that already attacked this turn (each may strike once). */
  acted: string[];
  regions: Record<string, RegionState>;
  winner: FactionId | null;
  /** Chosen at game start (random, spread apart) — used for the opening log. */
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
