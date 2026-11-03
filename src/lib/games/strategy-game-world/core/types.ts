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
  /**
   * One campaign per turn: null = free to start one; a region id = the last
   * conquest, and the next attack may only launch from there; 'done' = the
   * turn's offensive is over (a failed attack, or voluntary stop).
   */
  campaign: string | null | 'done';
  regions: Record<string, RegionState>;
  winner: FactionId | null;
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
