import Phaser from 'phaser';
import { sfx } from '../core/audio';

export interface UiButton extends Phaser.GameObjects.Text {
  setDisabled: (v: boolean) => void;
  isDisabled: () => boolean;
}

export interface ButtonOpts {
  fontSize?: string;
  bg?: string;
  color?: string;
  depth?: number;
}

/**
 * Button with a rounded, glowing background drawn by a companion Graphics
 * (native text backgroundColor is a hard square — the look we're avoiding).
 * The bg re-syncs whenever position/scale/text change.
 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onTap: () => void,
  opts?: ButtonOpts,
): UiButton {
  const depth = opts?.depth ?? 40;
  const baseColor = Phaser.Display.Color.HexStringToColor(opts?.bg ?? '#123066');

  const btn = scene.add
    .text(x, y, label, {
      fontFamily: 'Sora, sans-serif',
      fontSize: opts?.fontSize ?? '14px',
      fontStyle: 'bold',
      color: opts?.color ?? '#e7ecf5',
      padding: { x: 16, y: 9 },
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(depth)
    .setInteractive({ useHandCursor: true }) as UiButton;

  const bg = scene.add
    .graphics()
    .setScrollFactor(0)
    .setDepth(depth - 1);

  let disabled = false;

  const drawBg = (): void => {
    const w = btn.width * btn.scaleX + 8;
    const h = btn.height * btn.scaleY + 6;
    const alpha = disabled ? 0.3 : 1;
    bg.clear();
    // soft outer glow
    bg.fillStyle(baseColor.color, 0.22 * alpha);
    bg.fillRoundedRect(btn.x - (w + 14) / 2, btn.y - (h + 12) / 2, w + 14, h + 12, 14);
    // body
    bg.fillStyle(Phaser.Display.Color.Interpolate.ColorWithColor(baseColor, Phaser.Display.Color.ValueToColor(0x000000), 100, 25).color, 0.95 * alpha);
    bg.fillRoundedRect(btn.x - w / 2, btn.y - h / 2, w, h, 10);
    // top highlight
    bg.lineStyle(1, 0xffffff, 0.18 * alpha);
    bg.strokeRoundedRect(btn.x - w / 2, btn.y - h / 2, w, h, 10);
  };

  // keep the bg glued to the text on every mutation
  const orig = {
    setPosition: btn.setPosition.bind(btn),
    setScale: btn.setScale.bind(btn),
    setText: btn.setText.bind(btn),
    setVisible: btn.setVisible.bind(btn),
  };
  btn.setPosition = ((x2: number, y2?: number) => {
    orig.setPosition(x2, y2);
    drawBg();
    return btn;
  }) as typeof btn.setPosition;
  btn.setScale = ((...a: [number] | [number, number]) => {
    orig.setScale(...a);
    drawBg();
    return btn;
  }) as typeof btn.setScale;
  btn.setText = ((t: Parameters<UiButton['setText']>[0]) => {
    orig.setText(t);
    drawBg();
    return btn;
  }) as typeof btn.setText;
  btn.setVisible = ((v: boolean) => {
    orig.setVisible(v);
    bg.setVisible(v);
    return btn;
  }) as typeof btn.setVisible;

  btn.setDisabled = (v: boolean) => {
    disabled = v;
    btn.setAlpha(v ? 0.45 : 1);
    drawBg();
  };
  btn.isDisabled = () => disabled;

  btn.on('pointerover', () => {
    if (!disabled) btn.setScale(1.06);
  });
  btn.on('pointerout', () => btn.setScale(1));
  btn.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, evt?: { stopPropagation: () => void }) => {
    evt?.stopPropagation();
    if (disabled) return;
    sfx.unlock();
    sfx.click();
    onTap();
  });

  drawBg();
  return btn;
}
