import Phaser from 'phaser';

/**
 * Placeholder scene for Strategy Game World.
 * Renders an animated hex-grid "world map" teaser until the real game lands.
 * When development starts, replace the contents of create() with the real
 * gameplay setup and split into Boot/Main scenes as needed.
 */
export class MainScene extends Phaser.Scene {
  constructor() {
    super({ key: 'StrategyGameWorldMain' });
  }

  create(): void {
    const redraw = () => this.drawHexGrid();
    redraw();
    this.scale.on(Phaser.Scale.Events.RESIZE, redraw, this);

    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    const title = this.add
      .text(cx, cy - 28, 'STRATEGY GAME WORLD', {
        fontFamily: 'Sora, sans-serif',
        fontSize: '32px',
        fontStyle: 'bold',
        color: '#e7ecf5',
      })
      .setOrigin(0.5)
      .setDepth(2);

    const soon = this.add
      .text(cx, cy + 22, 'Próximamente…', {
        fontFamily: 'Inter, sans-serif',
        fontSize: '18px',
        color: '#22d3ee',
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.tweens.add({
      targets: title,
      scale: 1.04,
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.tweens.add({
      targets: soon,
      alpha: 0.25,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private drawHexGrid(): void {
    const { width, height } = this.scale;
    this.graphics?.destroy();

    const size = 36;
    const horiz = size * 1.5;
    const vert = Math.sqrt(3) * size;

    const g = this.add.graphics();
    g.lineStyle(1, 0x38bdf8, 0.14);

    for (let col = 0; col * horiz < width + horiz; col++) {
      for (let row = 0; row * vert < height + vert; row++) {
        const x = col * horiz;
        const y = row * vert + (col % 2 === 1 ? vert / 2 : 0);
        this.strokeHex(g, x, y, size);
      }
    }

    g.setDepth(0);
    this.graphics = g;

    this.tweens.add({
      targets: g,
      alpha: 0.4,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private strokeHex(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    size: number,
  ): void {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = cx + size * Math.cos(angle);
      const py = cy + size * Math.sin(angle);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.strokePath();
  }

  // Kept on the scene so the resize handler can clean up the old grid.
  private graphics?: Phaser.GameObjects.Graphics;
}
