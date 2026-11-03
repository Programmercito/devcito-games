import type Phaser from 'phaser';
import { mountStrategyGameWorld } from './strategy-game-world';

/**
 * Registry mapping a game slug to its Phaser mount function.
 * To add a new game: create src/lib/games/<slug>/ and register it here.
 */
export const gameMounts: Record<string, (parent: HTMLElement) => Phaser.Game> = {
  'strategy-game-world': mountStrategyGameWorld,
};
