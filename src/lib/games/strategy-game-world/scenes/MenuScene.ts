import Phaser from 'phaser';
import { makeButton } from './ui';
import type { FactionId } from '../core/types';

/**
 * Title screen: PLAY → choose who starts (vos / computadora / azar).
 * All objects are created once; the "start" view just toggles visibility.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Menu' });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    // Ambient orbs.
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0x1e3a8a, 0.35).fillCircle(cx * 0.55, cy * 0.7, 140);
    g.fillStyle(0x0ea5e9, 0.16).fillCircle(cx * 1.5, cy * 1.3, 180);
    g.fillStyle(0xa78bfa, 0.1).fillCircle(cx * 1.15, cy * 0.35, 110);
    this.tweens.add({ targets: g, alpha: 0.55, duration: 2600, yoyo: true, repeat: -1 });

    const text = (x: number, y: number, s: string, size: number, color: string) =>
      this.add
        .text(x, y, s, { fontFamily: 'Sora, sans-serif', fontSize: `${size}px`, color })
        .setOrigin(0.5)
        .setDepth(10);

    this.title = text(cx, cy - 120, 'CONQUISTA MUNDIAL', 34, '#e7ecf5').setStyle({ fontStyle: 'bold' });
    this.tagline = text(cx, cy - 70, 'Un imperio, un turno a la vez.', 16, '#22d3ee');

    this.playBtn = makeButton(this, cx, cy + 20, '▶  PLAY', () => this.setView('start'), {
      fontSize: '20px',
      bg: '#1d4ed8',
    });

    this.ask = text(cx, cy - 20, '¿Quién conquista primero?', 18, '#9fb3d9');
    const pick = (first: FactionId | 'random') =>
      this.scene.start('World', {
        first: first === 'random' ? (Math.random() < 0.5 ? 'player' : 'ai') : first,
      });

    this.btnVos = makeButton(this, cx - 190, cy + 40, 'TÚ', () => pick('player'), { bg: '#1d4ed8' });
    this.btnCpu = makeButton(this, cx, cy + 40, 'COMPUTADORA', () => pick('ai'), { bg: '#991b1b' });
    this.btnAzar = makeButton(this, cx + 190, cy + 40, 'AZAR', () => pick('random'), { bg: '#7c5c14' });
    this.backBtn = makeButton(this, cx, cy + 100, '← Volver', () => this.setView('title'), {
      fontSize: '13px',
      bg: '#1f2937',
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.setView('title');
  }

  private setView(view: 'title' | 'start'): void {
    const on = view === 'title';
    this.playBtn.setVisible(on);
    this.ask.setVisible(!on);
    this.btnVos.setVisible(!on);
    this.btnCpu.setVisible(!on);
    this.btnAzar.setVisible(!on);
    this.backBtn.setVisible(!on);
  }

  private handleResize(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    this.title.setPosition(cx, cy - 120);
    this.tagline.setPosition(cx, cy - 70);
    this.playBtn.setPosition(cx, cy + 20);
    this.ask.setPosition(cx, cy - 20);
    this.btnVos.setPosition(cx - 190, cy + 40);
    this.btnCpu.setPosition(cx, cy + 40);
    this.btnAzar.setPosition(cx + 190, cy + 40);
    this.backBtn.setPosition(cx, cy + 100);
  }

  shutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
  }

  private title!: Phaser.GameObjects.Text;
  private tagline!: Phaser.GameObjects.Text;
  private playBtn!: Phaser.GameObjects.Text;
  private ask!: Phaser.GameObjects.Text;
  private btnVos!: Phaser.GameObjects.Text;
  private btnCpu!: Phaser.GameObjects.Text;
  private btnAzar!: Phaser.GameObjects.Text;
  private backBtn!: Phaser.GameObjects.Text;
}
