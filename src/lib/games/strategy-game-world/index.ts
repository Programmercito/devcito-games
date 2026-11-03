import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene';
import { WorldScene } from './scenes/WorldScene';

/**
 * Creates and attaches the Strategy Game World Phaser instance.
 * Menu (PLAY + who starts) → World board (conquest gameplay).
 */
export function mountStrategyGameWorld(parent: HTMLElement): Phaser.Game {
  // Idempotent mount: dev hot-reload can re-run the page script without a
  // document reload — without this, canvases stack and clicks hit zombies.
  const G = globalThis as Record<string, unknown>;
  const prev = G.__devcitoStrategyGame as Phaser.Game | undefined;
  if (prev) {
    try {
      prev.destroy(true);
    } catch {
      /* already gone */
    }
  }
  parent.replaceChildren();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0a1122',
    scale: {
      mode: Phaser.Scale.RESIZE,
      // NO_CENTER: CENTER_BOTH adds margins that overflow the flex parent and
      // trigger a resize feedback loop (canvas + margins > parent → grow → grow).
      autoCenter: Phaser.Scale.NO_CENTER,
      width: parent.clientWidth,
      height: parent.clientHeight,
    },
    scene: [MenuScene, WorldScene],
  });

  G.__devcitoStrategyGame = game;
  // Debug/E2E hook: only in dev builds.
  if (import.meta.env.DEV) G.__strategyGame = game;

  return game;
}
