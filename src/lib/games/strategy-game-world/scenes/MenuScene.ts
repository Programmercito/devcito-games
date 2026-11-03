import Phaser from 'phaser';
import { makeButton, type UiButton } from './ui';
import { REGIONS, WORLD_HEIGHT, WORLD_WIDTH } from '../data/world';
import { sfx } from '../core/audio';
import type { FactionId } from '../core/types';

type View = 'title' | 'setup';

/**
 * Title & setup screens. Design language: deep gradient sky, the world map
 * as a faint silhouette backdrop (the subject IS the map), flat letterspaced
 * typography, ghost/primary buttons from ui.ts. No emoji glyphs (font tofu).
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Menu' });
  }

  private pickCount = 3;
  private pickFirst: FactionId | 'random' = 'player';

  private bgArt!: Phaser.GameObjects.Graphics;
  private eyebrow!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private tagline!: Phaser.GameObjects.Text;
  private divider!: Phaser.GameObjects.Graphics;
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

  create(): void {
    this.bgArt = this.add.graphics().setDepth(-2);
    this.paintBackdrop();

    const { width: w, height: h } = this.scale;
    const cx = w / 2;
    const cy = h / 2;

    this.eyebrow = this.add
      .text(cx, cy - 150, 'ESTRATEGIA GLOBAL POR TURNOS', {
        fontFamily: 'Sora, sans-serif',
        fontSize: '12px',
        color: '#5b7ba6',
        letterSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.title = this.add
      .text(cx, cy - 104, 'CONQUISTA MUNDIAL', {
        fontFamily: 'Sora, sans-serif',
        fontSize: '52px',
        fontStyle: 'bold',
        color: '#f8fafc',
        letterSpacing: 3,
      })
      .setOrigin(0.5)
      .setDepth(10);
    this.tweens.add({ targets: this.title, alpha: { from: 0.82, to: 1 }, duration: 2400, yoyo: true, repeat: -1 });

    this.tagline = this.add
      .text(cx, cy - 52, `${REGIONS.length} países reales · un imperio · un destino`, {
        fontFamily: 'Inter, sans-serif',
        fontSize: '15px',
        color: '#7dd3fc',
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.divider = this.add.graphics().setDepth(10);
    this.divider.fillGradientStyle(0x38bdf8, 0x38bdf8, 0x38bdf8, 0x38bdf8, 0.9, 0, 0, 0.9);
    this.divider.fillRect(cx - 80, cy - 34, 160, 2);

    this.playBtn = makeButton(this, cx, cy + 44, 'J U G A R', () => {
      sfx.select();
      this.setView('setup');
    }, { fontSize: '22px', style: 'primary', letterSpacing: 4 });

    // ── setup view ──
    this.heading = this.add
      .text(cx, cy - 170, 'ARMA TU IMPERIO', {
        fontFamily: 'Sora, sans-serif',
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#f1f5f9',
        letterSpacing: 5,
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.countLabel = this.add
      .text(cx, cy - 118, 'PAÍSES CON LOS QUE EMPIEZAS', {
        fontFamily: 'Inter, sans-serif',
        fontSize: '12px',
        color: '#64748b',
        letterSpacing: 3,
      })
      .setOrigin(0.5)
      .setDepth(10);

    for (let i = 0; i < 5; i++) {
      const n = i + 1;
      const chip = makeButton(this, cx + (i - 2) * 66, cy - 76, `${n}`, () => {
        this.pickCount = n;
        this.refreshChips();
        sfx.select();
      }, { fontSize: '16px' });
      this.chips.push(chip);
    }

    this.whoLabel = this.add
      .text(cx, cy + 4, '¿QUIÉN CONQUISTA PRIMERO?', {
        fontFamily: 'Inter, sans-serif',
        fontSize: '12px',
        color: '#64748b',
        letterSpacing: 3,
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.btnVos = makeButton(this, cx - 180, cy + 44, 'TÚ', () => this.setFirst('player'));
    this.btnCpu = makeButton(this, cx, cy + 44, 'COMPUTADORA', () => this.setFirst('ai'));
    this.btnAzar = makeButton(this, cx + 186, cy + 44, 'AZAR', () => this.setFirst('random'));

    this.goBtn = makeButton(this, cx, cy + 118, 'A CONQUISTAR', () => {
      sfx.turn();
      const first =
        this.pickFirst === 'random' ? (Math.random() < 0.5 ? 'player' : 'ai') : this.pickFirst;
      this.scene.start('World', { first, homelands: this.pickCount });
    }, { fontSize: '18px', style: 'primary', letterSpacing: 3 });

    this.backBtn = makeButton(this, cx, cy + 172, 'VOLVER', () => this.setView('title'), {
      fontSize: '12px',
      letterSpacing: 3,
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.paintBackdrop, this);
    this.setView('title');
  }

  shutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.paintBackdrop, this);
  }

  /** Gradient sky + world silhouette + sparse stars — redrawn on resize. */
  private paintBackdrop(): void {
    const { width: w, height: h } = this.scale;
    const g = this.bgArt;
    g.clear();

    g.fillGradientStyle(0x060a16, 0x060a16, 0x0d1a33, 0x0d1a33, 1, 1, 1, 1);
    g.fillRect(0, 0, w, h);

    // two soft accent blooms
    g.fillStyle(0x0ea5e9, 0.05);
    g.fillCircle(w * 0.18, h * 0.22, Math.min(240, h * 0.34));
    g.fillStyle(0x6366f1, 0.05);
    g.fillCircle(w * 0.84, h * 0.7, Math.min(300, h * 0.42));

    // world silhouette, fitted to the screen
    const s = Math.min((w * 0.94) / WORLD_WIDTH, (h * 0.94) / WORLD_HEIGHT);
    const ox = (w - WORLD_WIDTH * s) / 2;
    const oy = (h - WORLD_HEIGHT * s) / 2;
    g.fillStyle(0x13233f, 0.6);
    for (const r of REGIONS) {
      for (const ring of r.rings) {
        const pts = ring.map(([x, y]) => new Phaser.Geom.Point(ox + x * s, oy + y * s));
        if (pts.length >= 3) g.fillPoints(pts, true);
      }
    }

    // stars
    for (let i = 0; i < 60; i++) {
      g.fillStyle(0xdbeafe, 0.05 + Math.random() * 0.3);
      g.fillCircle(Math.random() * w, Math.random() * h, Math.random() < 0.8 ? 1 : 1.6);
    }
  }

  private setFirst(f: FactionId | 'random', silent = false): void {
    this.pickFirst = f;
    if (!silent) sfx.select();
    this.btnVos.setSelected(f === 'player');
    this.btnCpu.setSelected(f === 'ai');
    this.btnAzar.setSelected(f === 'random');
  }

  private refreshChips(): void {
    this.chips.forEach((c, i) => {
      const on = i + 1 === this.pickCount;
      c.setSelected(on);
      c.setScale(on ? 1.12 : 1);
    });
  }

  private setView(view: View): void {
    const on = view === 'title';
    this.eyebrow.setVisible(on);
    this.title.setVisible(on);
    this.tagline.setVisible(on);
    this.divider.setVisible(on);
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
    this.setFirst(this.pickFirst, true);
  }
}
