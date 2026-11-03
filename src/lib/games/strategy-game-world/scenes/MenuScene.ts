import Phaser from 'phaser';
import { makeButton, type UiButton } from './ui';
import { sfx } from '../core/audio';
import type { FactionId } from '../core/types';

type View = 'title' | 'setup';

/**
 * Title screen: animated starfield + glowing logo → setup view where you
 * choose the size of your starting empire (1-5 countries) and who moves first.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Menu' });
  }

  private stars!: Phaser.GameObjects.Graphics;
  private orbs!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private tagline!: Phaser.GameObjects.Text;
  private glowLine!: Phaser.GameObjects.Graphics;
  private playBtn!: UiButton;

  private heading!: Phaser.GameObjects.Text;
  private countLabel!: Phaser.GameObjects.Text;
  private chips: UiButton[] = [];
  private whoLabel!: Phaser.GameObjects.Text;
  private btnVos!: UiButton;
  private btnCpu!: UiButton;
  private btnAzar!: UiButton;
  private goBtn!: UiButton;
  private backBtn!: UiButton;

  private pickCount = 3;
  private pickFirst: FactionId | 'random' = 'player';

  create(): void {
    const { width, height } = this.scale;

    // Deep-space backdrop: gradient-ish stacked panels + stars + drifting orbs.
    const sky = this.add.graphics().setDepth(-2);
    sky.fillGradientStyle(0x0a1230, 0x0a1230, 0x081020, 0x081020, 1, 1, 1, 1);
    sky.fillRect(0, 0, width, height);

    this.orbs = this.add.graphics().setDepth(-1);
    this.orbs.fillStyle(0x1d4ed8, 0.2).fillCircle(width * 0.16, height * 0.3, Math.min(160, height * 0.24));
    this.orbs.fillStyle(0x0ea5e9, 0.1).fillCircle(width * 0.85, height * 0.68, Math.min(220, height * 0.32));
    this.orbs.fillStyle(0xa78bfa, 0.09).fillCircle(width * 0.62, height * 0.14, Math.min(120, height * 0.2));
    this.tweens.add({ targets: this.orbs, alpha: 0.5, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.stars = this.add.graphics().setDepth(-1);
    for (let i = 0; i < 90; i++) {
      const a = 0.08 + Math.random() * 0.5;
      this.stars.fillStyle(0xdbeafe, a).fillCircle(Math.random() * width, Math.random() * height, Math.random() < 0.85 ? 1 : 2);
    }
    this.tweens.add({ targets: this.stars, alpha: { from: 0.5, to: 1 }, duration: 1900, yoyo: true, repeat: -1 });

    const cy = height / 2;
    this.title = this.add
      .text(width / 2, cy - 140, 'CONQUISTA MUNDIAL', {
        fontFamily: 'Sora, sans-serif',
        fontSize: '54px',
        fontStyle: 'bold',
        color: '#f1f5f9',
        stroke: '#1e3a8a',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#22d3ee', 28, true, true)
      .setDepth(10);
    this.tweens.add({ targets: this.title, scale: { from: 1, to: 1.03 }, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.tagline = this.add
      .text(width / 2, cy - 78, '208 países reales · un imperio · un destino', {
        fontFamily: 'Inter, sans-serif',
        fontSize: '17px',
        color: '#38bdf8',
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.glowLine = this.add.graphics().setDepth(10);
    this.tweens.add({ targets: this.glowLine, alpha: { from: 0.35, to: 1 }, duration: 1400, yoyo: true, repeat: -1 });

    this.playBtn = makeButton(this, width / 2, cy + 30, '▶  J U G A R', () => {
      sfx.select();
      this.setView('setup');
    }, { fontSize: '24px', bg: '#0ea5e9', color: '#04121f' });

    // ── setup view objects ──
    this.heading = this.add
      .text(width / 2, cy - 170, 'ARMA TU IMPERIO', {
        fontFamily: 'Sora, sans-serif',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#e2e8f0',
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.countLabel = this.add
      .text(width / 2, cy - 108, 'Países con los que empiezas', { fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#94a3b8' })
      .setOrigin(0.5)
      .setDepth(10);

    const chipX = (i: number) => width / 2 + (i - 2) * 64;
    for (let i = 0; i < 5; i++) {
      const n = i + 1;
      const chip = makeButton(this, chipX(i), cy - 64, `${n}`, () => {
        this.pickCount = n;
        this.refreshChips();
        sfx.select();
      }, { bg: '#1e3a8a', fontSize: '16px' });
      this.chips.push(chip);
    }
    this.refreshChips();

    this.whoLabel = this.add
      .text(width / 2, cy + 2, '¿Quién conquista primero?', { fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#94a3b8' })
      .setOrigin(0.5)
      .setDepth(10);

    this.btnVos = makeButton(this, width / 2 - 168, cy + 44, 'TÚ', () => this.setFirst('player'), { bg: '#1d4ed8' });
    this.btnCpu = makeButton(this, width / 2, cy + 44, 'COMPUTADORA', () => this.setFirst('ai'), { bg: '#991b1b' });
    this.btnAzar = makeButton(this, width / 2 + 172, cy + 44, 'AZAR', () => this.setFirst('random'), { bg: '#7c5c14' });

    this.goBtn = makeButton(this, width / 2, cy + 116, '⚔  ¡A CONQUISTAR!', () => {
      sfx.turn();
      const first =
        this.pickFirst === 'random' ? (Math.random() < 0.5 ? 'player' : 'ai') : this.pickFirst;
      this.scene.start('World', { first, homelands: this.pickCount });
    }, { fontSize: '19px', bg: '#059669', color: '#03150d' });

    this.backBtn = makeButton(this, width / 2, cy + 168, '← Volver', () => this.setView('title'), {
      fontSize: '13px',
      bg: '#1f2937',
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.setView('title');
  }

  shutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
  }

  private setFirst(f: FactionId | 'random'): void {
    this.pickFirst = f;
    sfx.select();
    this.btnVos.setAlpha(f === 'player' ? 1 : 0.45);
    this.btnCpu.setAlpha(f === 'ai' ? 1 : 0.45);
    this.btnAzar.setAlpha(f === 'random' ? 1 : 0.45);
  }

  private refreshChips(): void {
    this.chips.forEach((c, i) => c.setScale(i + 1 === this.pickCount ? 1.18 : 0.92));
  }

  private setView(view: View): void {
    const on = view === 'title';
    this.title.setVisible(on);
    this.tagline.setVisible(on);
    this.glowLine.setVisible(on);
    this.playBtn.setVisible(on);
    this.heading.setVisible(!on);
    this.countLabel.setVisible(!on);
    this.chips.forEach((c) => c.setVisible(!on));
    this.whoLabel.setVisible(!on);
    this.btnVos.setVisible(!on);
    this.btnCpu.setVisible(!on);
    this.btnAzar.setVisible(!on);
    this.goBtn.setVisible(!on);
    this.backBtn.setVisible(!on);
    this.refreshChips();
    this.setFirst(this.pickFirst);
    this.handleResize();
  }

  private handleResize(): void {
    const { width, height } = this.scale;
    const cy = height / 2;
    this.title.setPosition(width / 2, Math.max(cy - 140, 70));
    this.tagline.setPosition(width / 2, Math.max(cy - 140, 70) + 62);
    this.glowLine.clear();
    this.glowLine.fillStyle(0x22d3ee, 0.8).fillRoundedRect(width / 2 - 70, Math.max(cy - 140, 70) + 94, 140, 3, 2);
    this.playBtn.setPosition(width / 2, cy + 30);
    this.heading.setPosition(width / 2, cy - 170);
    this.countLabel.setPosition(width / 2, cy - 108);
    this.chips.forEach((c, i) => c.setPosition(width / 2 + (i - 2) * 64, cy - 64));
    this.whoLabel.setPosition(width / 2, cy + 2);
    this.btnVos.setPosition(width / 2 - 168, cy + 44);
    this.btnCpu.setPosition(width / 2, cy + 44);
    this.btnAzar.setPosition(width / 2 + 172, cy + 44);
    this.goBtn.setPosition(width / 2, cy + 116);
    this.backBtn.setPosition(width / 2, cy + 168);
  }
}
