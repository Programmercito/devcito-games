import Phaser from 'phaser';
import { makeButton, type UiButton } from './ui';
import { REGIONS, WORLD_HEIGHT, WORLD_WIDTH } from '../data/world';
import { sfx } from '../core/audio';
import type { FactionId } from '../core/types';

type View = 'title' | 'setup';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Menu' });
  }

  private pickCount = 3;
  private pickFirst: FactionId | 'random' = 'player';
  private view: View = 'title';
  private bgArt!: Phaser.GameObjects.Graphics;
  private brand!: Phaser.GameObjects.Text;
  private edition!: Phaser.GameObjects.Text;
  private eyebrow!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private tagline!: Phaser.GameObjects.Text;
  private footer!: Phaser.GameObjects.Text;
  private playBtn!: UiButton;
  private heading!: Phaser.GameObjects.Text;
  private setupIntro!: Phaser.GameObjects.Text;
  private countLabel!: Phaser.GameObjects.Text;
  private chips: UiButton[] = [];
  private whoLabel!: Phaser.GameObjects.Text;
  private btnVos!: UiButton;
  private btnCpu!: UiButton;
  private btnAzar!: UiButton;
  private goBtn!: UiButton;
  private crazyBtn!: UiButton;
  private backBtn!: UiButton;

  create(): void {
    this.chips = [];
    this.bgArt = this.add.graphics().setDepth(-2);
    this.brand = this.add.text(0, 0, '◈  DEVCITO GAMES', {
      fontFamily: 'Sora, sans-serif', fontSize: '11px', fontStyle: 'bold',
      color: '#b5d3d8', letterSpacing: 2,
    }).setDepth(10);
    this.edition = this.add.text(0, 0, 'ESTRATEGIA  /  01', {
      fontFamily: 'Sora, sans-serif', fontSize: '10px', color: '#78959e', letterSpacing: 2,
    }).setOrigin(1, 0).setDepth(10);
    this.eyebrow = this.add.text(0, 0, 'ESTRATEGIA GLOBAL POR TURNOS', {
      fontFamily: 'Sora, sans-serif', fontSize: '11px', fontStyle: 'bold',
      color: '#f0be6b', letterSpacing: 2,
    }).setDepth(10);
    this.title = this.add.text(0, 0, 'CONQUISTA\nMUNDIAL', {
      fontFamily: 'Sora, sans-serif', fontSize: '58px', fontStyle: 'bold',
      color: '#f3f5ef', lineSpacing: -8,
    }).setDepth(10);
    this.tagline = this.add.text(0, 0, 'Un mundo. Dos imperios.\nCada decisión cambia el mapa.', {
      fontFamily: 'Inter, sans-serif', fontSize: '15px',
      color: '#a7c3ca', lineSpacing: 4,
    }).setDepth(10);
    this.footer = this.add.text(0, 0, `${REGIONS.length} TERRITORIOS   /   1 MUNDO   /   TU ESTRATEGIA`, {
      fontFamily: 'Sora, sans-serif', fontSize: '10px',
      color: '#78959e', letterSpacing: 1,
    }).setDepth(10);
    this.playBtn = makeButton(this, 0, 0, 'INICIAR PARTIDA  →', () => {
      sfx.select();
      this.setView('setup');
    }, { fontSize: '15px', style: 'primary', letterSpacing: 1 });

    this.heading = this.add.text(0, 0, 'PREPARA TU PARTIDA', {
      fontFamily: 'Sora, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#f3f5ef',
    }).setOrigin(0.5).setDepth(10);
    this.setupIntro = this.add.text(0, 0, 'Elige cómo comienza la conquista', {
      fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#9ab8bd',
    }).setOrigin(0.5).setDepth(10);
    this.countLabel = this.add.text(0, 0, '01   PAÍSES INICIALES POR BANDO', {
      fontFamily: 'Sora, sans-serif', fontSize: '11px', fontStyle: 'bold',
      color: '#e8c17a', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(10);
    for (let n = 1; n <= 5; n++) {
      this.chips.push(makeButton(this, 0, 0, `${n}`, () => {
        this.pickCount = n;
        this.refreshChips();
        sfx.select();
      }, { fontSize: '16px' }));
    }
    this.whoLabel = this.add.text(0, 0, '02   ¿QUIÉN JUEGA PRIMERO?', {
      fontFamily: 'Sora, sans-serif', fontSize: '11px', fontStyle: 'bold',
      color: '#e8c17a', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(10);
    this.btnVos = makeButton(this, 0, 0, 'TÚ', () => this.setFirst('player'));
    this.btnCpu = makeButton(this, 0, 0, 'COMPUTADORA', () => this.setFirst('ai'));
    this.btnAzar = makeButton(this, 0, 0, 'AZAR', () => this.setFirst('random'));
    this.goBtn = makeButton(this, 0, 0, 'COMENZAR CONQUISTA  →', () => {
      sfx.turn();
      const first = this.pickFirst === 'random' ? (Math.random() < 0.5 ? 'player' : 'ai') : this.pickFirst;
      this.scene.start('World', { first, homelands: this.pickCount });
    }, { fontSize: '15px', style: 'primary', letterSpacing: 1 });
    this.crazyBtn = makeButton(this, 0, 0, '🔥  MODO LOCO · IA vs IA', () => {
      sfx.turn();
      this.scene.start('World', {
        first: Math.random() < 0.5 ? 'player' : 'ai',
        homelands: this.pickCount,
        spectate: true,
      });
    }, { fontSize: '13px', style: 'danger', letterSpacing: 1 });
    this.backBtn = makeButton(this, 0, 0, '←  VOLVER', () => this.setView('title'), {
      fontSize: '12px', letterSpacing: 1,
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
    this.setView('title');
  }

  private layout(): void {
    const { width: w, height: h } = this.scale;
    const mobile = w < 680;
    const cx = w / 2;
    const cy = h / 2;
    const step = Math.min(1, h / 490);
    this.brand.setPosition(24, 19);
    this.edition.setPosition(w - 24, 19).setVisible(w >= 500);
    if (mobile) {
      const mid = h * 0.53;
      const scale = Math.min(1, h / 550);
      this.eyebrow.setOrigin(0.5).setPosition(cx, mid - 112 * scale);
      this.title.setOrigin(0.5).setAlign('center').setFontSize(Math.min(50, Math.max(28, w / 8.5), h / 9));
      this.title.setPosition(cx, mid - 35 * scale);
      this.tagline.setOrigin(0.5).setAlign('center').setPosition(cx, mid + 54 * scale);
      this.playBtn.setPosition(cx, mid + 124 * scale);
      this.footer.setOrigin(0.5, 1).setPosition(cx, h - 18);
    } else {
      const left = Math.max(40, w * 0.07);
      this.eyebrow.setOrigin(0, 0.5).setPosition(left, cy - 130 * step);
      this.title.setOrigin(0, 0).setAlign('left').setFontSize(Math.min(66, Math.max(38, h / 8)));
      this.title.setPosition(left, cy - 108 * step);
      this.tagline.setOrigin(0, 0).setAlign('left').setPosition(left, cy + 40 * step);
      this.playBtn.setPosition(left + 111, cy + 111 * step);
      this.footer.setOrigin(0, 1).setPosition(left, h - 18);
    }
    this.heading.setPosition(cx, cy - 170 * step).setFontSize(w < 500 ? 21 : 26);
    this.setupIntro.setPosition(cx, cy - 137 * step);
    this.countLabel.setPosition(cx, cy - 92 * step);
    this.chips.forEach((chip, i) => chip.setPosition(cx + (i - 2) * Math.min(66, w / 6), cy - 55 * step));
    this.whoLabel.setPosition(cx, cy + 5 * step);
    const buttons = [this.btnVos, this.btnCpu, this.btnAzar];
    let left = cx - (buttons.reduce((sum, button) => sum + button.width, 0) + 12) / 2;
    for (const button of buttons) {
      button.setPosition(left + button.width / 2, cy + 42 * step);
      left += button.width + 6;
    }
    this.goBtn.setPosition(cx, cy + 102 * step);
    this.crazyBtn.setPosition(cx, cy + 162 * step);
    this.backBtn.setPosition(cx, cy + 212 * step);
    for (const text of [this.eyebrow, this.title, this.tagline, this.footer, this.heading, this.setupIntro, this.countLabel, this.whoLabel]) {
      text.setScale(Math.min(1, (w - 48) / text.width));
    }
    this.paintBackdrop();
  }

  private paintBackdrop(): void {
    const { width: w, height: h } = this.scale;
    const mobile = w < 680;
    const g = this.bgArt.clear();
    g.fillGradientStyle(0x07171f, 0x102c38, 0x080f1c, 0x0b1c2b, 1, 1, 1, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(1, 0x81b9b8, 0.07);
    for (let x = 0; x < w; x += 60) g.lineBetween(x, 0, x, h);
    for (let y = 0; y < h; y += 60) g.lineBetween(0, y, w, y);

    const mapW = mobile ? w * 0.96 : w * 0.66;
    const mapH = mobile ? h * 0.34 : h * 0.82;
    const scale = Math.min(mapW / WORLD_WIDTH, mapH / WORLD_HEIGHT);
    const centerX = mobile ? w / 2 : w * 0.72;
    const centerY = mobile ? h * 0.23 : h * 0.48;
    const ox = centerX - WORLD_WIDTH * scale / 2;
    const oy = centerY - WORLD_HEIGHT * scale / 2;
    const radius = Math.min(mobile ? w * 0.42 : w * 0.3, h * (mobile ? 0.25 : 0.48));
    g.fillStyle(0x1d6267, 0.15).fillCircle(centerX, centerY, radius);
    g.lineStyle(1, 0x6ab6b0, 0.22).strokeCircle(centerX, centerY, radius);
    g.lineStyle(1, 0x6ab6b0, 0.12).strokeCircle(centerX, centerY, radius * 0.78);
    g.fillStyle(0x68a69e, 0.44);
    for (const region of REGIONS) for (const ring of region.rings) {
      const points = ring.map(([x, y]) => new Phaser.Geom.Point(ox + x * scale, oy + y * scale));
      if (points.length >= 3) g.fillPoints(points, true);
    }
    g.lineStyle(1, 0xe7be77, 0.5);
    g.lineBetween(centerX - radius * 0.65, centerY + radius * 0.32, centerX + radius * 0.55, centerY - radius * 0.24);
    for (const [x, y] of [[-0.65, 0.32], [0.05, 0.01], [0.55, -0.24]]) {
      g.fillStyle(0xf0c474, 0.9).fillCircle(centerX + radius * x, centerY + radius * y, 3);
      g.lineStyle(1, 0xf0c474, 0.3).strokeCircle(centerX + radius * x, centerY + radius * y, 7);
    }

    if (this.view === 'setup') {
      g.fillStyle(0x040d17, 0.7).fillRect(0, 0, w, h);
      const panelW = Math.min(w - 20, 600);
      const panelH = Math.min(h - 12, 480);
      const x = (w - panelW) / 2;
      const y = (h - panelH) / 2;
      g.fillStyle(0x0a1c29, 0.98).fillRoundedRect(x, y, panelW, panelH, 16);
      g.lineStyle(1, 0x67939a, 0.38).strokeRoundedRect(x, y, panelW, panelH, 16);
      g.fillStyle(0xe9b85f, 0.9).fillRect(w / 2 - 30, y, 60, 2);
      const step = Math.min(1, h / 490);
      g.lineStyle(1, 0x67939a, 0.3).lineBetween(w / 2 - 90, h / 2 + 132 * step, w / 2 + 90, h / 2 + 132 * step);
    }
  }

  private setFirst(first: FactionId | 'random', silent = false): void {
    this.pickFirst = first;
    if (!silent) sfx.select();
    this.btnVos.setSelected(first === 'player');
    this.btnCpu.setSelected(first === 'ai');
    this.btnAzar.setSelected(first === 'random');
  }

  private refreshChips(): void {
    this.chips.forEach((chip, i) => {
      chip.setSelected(i + 1 === this.pickCount);
    });
  }

  private setView(view: View): void {
    this.view = view;
    const title = view === 'title';
    this.eyebrow.setVisible(title);
    this.title.setVisible(title);
    this.tagline.setVisible(title);
    this.footer.setVisible(title);
    this.playBtn.setVisible(title);
    this.heading.setVisible(!title);
    this.setupIntro.setVisible(!title);
    this.countLabel.setVisible(!title);
    this.chips.forEach((chip) => chip.setVisible(!title));
    this.whoLabel.setVisible(!title);
    this.btnVos.setVisible(!title);
    this.btnCpu.setVisible(!title);
    this.btnAzar.setVisible(!title);
    this.goBtn.setVisible(!title);
    this.crazyBtn.setVisible(!title);
    this.backBtn.setVisible(!title);
    this.refreshChips();
    this.setFirst(this.pickFirst, true);
    this.layout();
  }
}
