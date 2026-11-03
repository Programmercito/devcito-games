import Phaser from 'phaser';

export interface UiButton extends Phaser.GameObjects.Text {
  setDisabled: (v: boolean) => void;
  isDisabled: () => boolean;
}

/**
 * Minimal button: text with background, screen-space (scrollFactor 0),
 * click stops propagation so the world map doesn't receive it too.
 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onTap: () => void,
  opts?: { fontSize?: string; bg?: string },
): UiButton {
  const btn = scene.add
    .text(x, y, label, {
      fontFamily: 'Sora, sans-serif',
      fontSize: opts?.fontSize ?? '14px',
      fontStyle: 'bold',
      color: '#e7ecf5',
      backgroundColor: opts?.bg ?? '#123066',
      padding: { x: 14, y: 9 },
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(40)
    .setInteractive({ useHandCursor: true }) as UiButton;

  let disabled = false;
  btn.setDisabled = (v: boolean) => {
    disabled = v;
    btn.setAlpha(v ? 0.4 : 1);
  };
  btn.isDisabled = () => disabled;

  btn.on('pointerover', () => {
    if (!disabled) btn.setScale(1.06);
  });
  btn.on('pointerout', () => btn.setScale(1));
  btn.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, evt?: { stopPropagation: () => void }) => {
    evt?.stopPropagation();
    if (disabled) return;
    onTap();
  });

  return btn;
}
