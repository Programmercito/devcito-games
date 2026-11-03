import Phaser from 'phaser';
import { sfx } from '../core/audio';

export interface UiButton extends Phaser.GameObjects.Text {
  setDisabled: (v: boolean) => void;
  isDisabled: () => boolean;
  /** "Selected" visual state (Text.setActive is Phaser's input flag — don't clash). */
  setSelected: (v: boolean) => void;
}

export type ButtonStyle = 'ghost' | 'primary' | 'danger';

export interface ButtonOpts {
  fontSize?: string;
  style?: ButtonStyle;
  letterSpacing?: number;
  depth?: number;
}

const PALETTE = {
  ghost: { bg: 0x0e1a2e, border: 0x2a4066, text: '#cbd5e1' },
  primary: { bg: 0xf59e0b, border: 0xfbbf24, text: '#1a1204' },
  danger: { bg: 0x7f1d1d, border: 0xb91c1c, text: '#fee2e2' },
  active: { bg: 0x123a5c, border: 0x38bdf8, text: '#e0f2fe' },
} as const;

/**
 * Flat design buttons: no outer glow boxes, just a rounded fill, a crisp
 * 1.5px border and a subtle hover lift. "Selected" = brighter fill + accent
 * border. All visuals come from one palette so the UI stays coherent.
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
  const style = opts?.style ?? 'ghost';
  const theme = PALETTE[style];

  const btn = scene.add
    .text(x, y, label, {
      fontFamily: 'Sora, sans-serif',
      fontSize: opts?.fontSize ?? '14px',
      fontStyle: 'bold',
      color: theme.text,
      letterSpacing: opts?.letterSpacing ?? 0,
      padding: { x: 18, y: 10 },
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(depth)
    .setInteractive({ useHandCursor: true }) as UiButton;

  const bg = scene.add.graphics().setScrollFactor(0).setDepth(depth - 1);

  let disabled = false;
  let active = false;
  let hovered = false;

  const drawBg = (): void => {
    const w = btn.width * btn.scaleX;
    const h = btn.height * btn.scaleY;
    const left = btn.x - w / 2;
    const top = btn.y - h / 2;
    const t = active ? PALETTE.active : theme;
    const alpha = disabled ? 0.35 : 1;
    bg.clear();
    bg.fillStyle(t.bg, (style === 'ghost' ? 0.92 : 1) * alpha);
    bg.fillRoundedRect(left, top, w, h, 10);
    bg.lineStyle(1.5, t.border, (hovered && !disabled ? 0.95 : 0.55) * alpha);
    bg.strokeRoundedRect(left, top, w, h, 10);
  };

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
  btn.setSelected = (v: boolean) => {
    active = v;
    drawBg();
  };

  btn.on('pointerover', () => {
    if (disabled) return;
    hovered = true;
    btn.setScale(1.04);
  });
  btn.on('pointerout', () => {
    hovered = false;
    btn.setScale(1);
  });
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
