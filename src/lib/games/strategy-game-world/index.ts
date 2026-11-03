import Phaser from 'phaser';
import { MainScene } from './scenes/MainScene';

/**
 * Creates and attaches the Strategy Game World Phaser instance.
 * Replace the placeholder scene(s) with the real game scenes when
 * development starts; the mount contract stays the same.
 */
export function mountStrategyGameWorld(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0a1122',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: parent.clientWidth,
      height: parent.clientHeight,
    },
    scene: [MainScene],
  });
}
