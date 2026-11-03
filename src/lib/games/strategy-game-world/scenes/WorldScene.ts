import Phaser from 'phaser';
import {
  ADJACENCY,
  REGIONS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  regionById,
} from '../data/world';
import {
  canAttack,
  canMove,
  checkWinner,
  cloneState,
  endTurn,
  incomeFor,
  moveArmies,
  nameOf,
  ownedRegions,
  performAttack,
  previewAttack,
  createGame,
} from '../core/rules';
import { planAiTurn } from '../core/ai';
import { sfx } from '../core/audio';
import type { AiAction, FactionId, GameState } from '../core/types';
import { makeButton } from './ui';

const OWNER_FILL: Record<FactionId | 'neutral', number> = {
  player: 0x1767a6,
  ai: 0xa64048,
  neutral: 0x354c5c,
};

const OWNER_LABEL: Record<FactionId | 'neutral', string> = {
  player: '#bfdbfe',
  ai: '#fecaca',
  neutral: '#8fa3bf',
};

interface WorldSceneData {
  first: FactionId;
  homelands?: number;
  spectate?: boolean;
}

/**
 * The world board with real country geometry.
 *
 * Viewport model: manual world→screen transform (camX/camY + zoom) — never
 * Phaser camera zoom, which desynchronizes scrollFactor(0) HUD hit areas.
 * Clicks resolve on pointerup so drags pan instead of selecting.
 * Rendering is split in drawMap (fills+labels, on state/viewport change)
 * and drawOverlay (selection/hover/flash, cheap enough for pointermove).
 */
export class WorldScene extends Phaser.Scene {
  constructor() {
    super({ key: 'World' });
  }

  private state!: GameState;
  private firstPlayer: FactionId = 'player';
  private homelandsCount = 3;
  private labels!: Map<string, { name: Phaser.GameObjects.Text; army: Phaser.GameObjects.Text }>;
  private fills!: Phaser.GameObjects.Graphics;
  private highlights!: Phaser.GameObjects.Graphics;
  private baseS = 0.5;
  private zoom = 1;
  private camX = WORLD_WIDTH / 2;
  private camY = WORLD_HEIGHT / 2;
  private view = { w: 1280, h: 800 };

  private selected: string | null = null;
  private suicideArmed: string | null = null;
  private hoverId: string | null = null;
  private flash: {
    from: string; to: string; win: boolean; t0: number;
    n: number; tint: number[] | null; hit: boolean;
  } | null = null;
  private busy = false;
  private dragging = false;
  private dragMoved = false;
  private aimFrom: string | null = null;
  private pinching = false;
  private pinchLast = { dist: 1, x: 0, y: 0 };
  private aimPos = { x: 0, y: 0 };
  private dragLast = { x: 0, y: 0 };

  private hud!: Phaser.GameObjects.Text;
  private log!: Phaser.GameObjects.Text;
  private uiPanels!: Phaser.GameObjects.Graphics;
  private attackHint!: Phaser.GameObjects.Text;
  private mainBtn!: Phaser.GameObjects.Text;
  private muteBtn!: Phaser.GameObjects.Text;
  private zoomInBtn!: Phaser.GameObjects.Text;
  private zoomOutBtn!: Phaser.GameObjects.Text;
  private overlay = false;
  private spectate = false;
  private speed = 1;
  private speedBtn?: Phaser.GameObjects.Text;

  init(data: WorldSceneData): void {
    this.firstPlayer = data.first ?? 'player';
    this.homelandsCount = Phaser.Math.Clamp(data.homelands ?? 3, 1, 5);
    this.spectate = !!data.spectate;
    this.speed = 1;
  }

  create(): void {
    sfx.unlock();
    this.makeFxTextures();
    this.state = createGame(this.firstPlayer, this.homelandsCount);
    this.selected = null;
    this.suicideArmed = null;
    this.hoverId = null;
    this.flash = null;
    this.busy = false;
    this.dragging = false;
    this.overlay = false;

    this.camX = WORLD_WIDTH / 2;
    this.camY = WORLD_HEIGHT / 2;
    this.zoom = 1;

    this.labels = new Map();
    this.fills = this.add.graphics().setDepth(0);
    this.highlights = this.add.graphics().setDepth(1);
    this.uiPanels = this.add.graphics().setDepth(11);

    for (const r of REGIONS) {
      const name = this.add
        .text(0, 0, r.name, {
          fontFamily: 'Sora, sans-serif',
          fontSize: '12px',
          color: '#e2e8f0',
          stroke: '#0a1122',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(3);
      const army = this.add
        .text(0, 0, '', {
          fontFamily: 'Sora, sans-serif',
          fontSize: '15px',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(3);
      this.labels.set(r.id, { name, army });
    }

    this.hud = this.add
      .text(14, 10, '', {
        fontFamily: 'Sora, sans-serif',
        fontSize: '13px',
        color: '#e7ecf5',
        padding: { x: 12, y: 8 },
      })
      .setDepth(12);

    this.log = this.add
      .text(0, 0, 'Arrastra desde tu país hasta el destino para atacar o mover · arrastra el mapa para moverte', {
        fontFamily: 'Inter, sans-serif',
        fontSize: '13px',
        color: '#d8eaf0',
        padding: { x: 12, y: 7 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(12);

    this.attackHint = this.add.text(0, 0, '', {
      fontFamily: 'Sora, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#e9fbff',
      backgroundColor: '#102d3af2',
      padding: { x: 12, y: 8 },
      lineSpacing: 4,
    }).setDepth(20).setVisible(false);

    this.mainBtn = makeButton(this, 0, 0, 'TERMINAR TURNO', () => this.onMainButton(), { style: 'primary', fontSize: '12px' });
    this.muteBtn = makeButton(this, 0, 0, 'SONIDO', () => {
      this.muteBtn.setText(sfx.toggleMute() ? 'SILENCIO' : 'SONIDO');
    }, { fontSize: '13px', depth: 14 });
    this.zoomOutBtn = makeButton(this, 0, 0, '−', () => this.zoomBy(1 / 1.5), { depth: 14, paddingY: 14 });
    this.zoomInBtn = makeButton(this, 0, 0, '+', () => this.zoomBy(1.5), { depth: 14, paddingY: 14 });
    this.speedBtn = undefined;
    if (this.spectate) {
      this.speedBtn = makeButton(this, 0, 0, 'VELOCIDAD x1', () => {
        this.speed = this.speed >= 4 ? 1 : this.speed * 2;
        this.speedBtn?.setText(`VELOCIDAD x${this.speed}`);
        sfx.select();
      }, { fontSize: '12px', depth: 14 });
      this.mainBtn.setVisible(false);
    }
    // Touch screens zoom by pinching; the buttons only stay for mouse/trackpad users.
    this.input.addPointer(1);
    this.pinching = false;
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      this.zoomInBtn.setVisible(false);
      this.zoomOutBtn.setVisible(false);
    }

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
    this.handleResize();

    this.input.on('pointerdown', this.onDragStart, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('wheel', this.onWheel, this);

    this.redraw();
    this.updateHud();

    const homelands = this.state.initialHomelands.player.map(nameOf).join(' · ');
    if (this.spectate) {
      this.setLog(`MODO LOCO: IA AZUL (${homelands}) vs IA ROJA. Solo mira… pellizca o usa la rueda para acercar.`);
      this.runAiTurn();
    } else if (this.state.current === 'ai') {
      this.setLog(`Tus países: ${homelands}. Empieza la computadora…`);
      this.runAiTurn();
    } else {
      this.setLog(`Tus países: ${homelands}. Pellizca con dos dedos (o usa la rueda) para acercar el mapa. Los refuerzos llegan desde el segundo turno.`);
    }
  }

  /** Test hooks (used by the E2E harness). */
  neighborsOf(id: string): string[] {
    return ADJACENCY[id] ?? [];
  }

  regionCenter(id: string): [number, number] | null {
    const r = regionById.get(id);
    return r ? r.center : null;
  }

  /**
   * A point guaranteed (best-effort) to be inside the region's biggest ring —
   * centroids fall in the ocean for concave countries. Test hook + AI focus.
   */
  interiorPoint(id: string): [number, number] | null {
    const r = regionById.get(id);
    if (!r) return null;
    const largest = r.rings.reduce((a, b) => (a.length >= b.length ? a : b));
    const ax = largest.reduce((s, p) => s + p[0], 0) / largest.length;
    const ay = largest.reduce((s, p) => s + p[1], 0) / largest.length;
    const candidates: [number, number][] = [
      [r.center[0], r.center[1]],
      [ax, ay],
      ...largest.map((v) => [(v[0] + ax) / 2, (v[1] + ay) / 2] as [number, number]),
    ];
    for (const c of candidates) {
      if (polygonContains(largest, c[0], c[1])) return c;
    }
    return [ax, ay];
  }

  // ── fx textures ──────────────────────────────────────────────────

  private makeFxTextures(): void {
    if (!this.textures.exists('spark')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1).fillCircle(5, 5, 4);
      g.generateTexture('spark', 10, 10);
      g.destroy();
    }
    if (!this.textures.exists('confetti')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 10, 16);
      g.generateTexture('confetti', 10, 16);
      g.destroy();
    }
  }

  private captureFx(regionId: string, tint: number[]): void {
    const center = this.regionCenter(regionId);
    if (!center) return;
    const p = this.worldToScreen(center[0], center[1]);
    const burst = this.add.particles(p.x, p.y, 'spark', {
      speed: { min: 70, max: 240 },
      scale: { start: 1.2, end: 0 },
      lifespan: 600,
      tint,
      emitting: false,
    });
    burst.explode(20);
    this.cameras.main.shake(90, 0.004);
    this.time.delayedCall(900, () => burst.destroy());
  }

  // ── viewport ─────────────────────────────────────────────────────

  private get s(): number {
    return this.baseS * this.zoom;
  }

  /** Public for E2E/debug: world point → screen (canvas) point. */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.camX) * this.s + this.view.w / 2,
      y: (wy - this.camY) * this.s + this.view.h / 2,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.view.w / 2) / this.s + this.camX,
      y: (sy - this.view.h / 2) / this.s + this.camY,
    };
  }

  private clampCam(): void {
    const halfW = this.view.w / 2 / this.s;
    const halfH = this.view.h / 2 / this.s;
    this.camX = Phaser.Math.Clamp(this.camX, Math.min(halfW, WORLD_WIDTH / 2), Math.max(WORLD_WIDTH - halfW, WORLD_WIDTH / 2));
    this.camY = Phaser.Math.Clamp(this.camY, Math.min(halfH, WORLD_HEIGHT / 2), Math.max(WORLD_HEIGHT - halfH, WORLD_HEIGHT / 2));
  }

  private handleResize(): void {
    const { width, height } = this.scale;
    this.view = { w: width, h: height };
    this.baseS = Math.min(width / WORLD_WIDTH, (height - 56) / WORLD_HEIGHT);
    this.clampCam();
    this.log.setWordWrapWidth(Math.max(100, width - 32));
    this.hud.setWordWrapWidth(Math.max(100, width - 130));
    this.log.setPosition(width / 2, height - 80);
    this.mainBtn.setPosition(width - 110, height - 26);
    this.speedBtn?.setPosition(width - 110, height - 26);
    this.muteBtn.setPosition(width - 58, 28);
    this.zoomOutBtn.setPosition(36, height - 26);
    this.zoomInBtn.setPosition(90, height - 26);
    this.hud.setFontSize(width < 700 ? 11 : 13);
    if (this.fills) {
      this.redraw();
      this.updateHud();
    }
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    if (this.busy || this.overlay) return;
    const before = this.screenToWorld(pointer.x, pointer.y);
    this.zoom = Phaser.Math.Clamp(this.zoom * (dy < 0 ? 1.2 : 1 / 1.2), 1, 9);
    this.camX = before.x - (pointer.x - this.view.w / 2) / this.s;
    this.camY = before.y - (pointer.y - this.view.h / 2) / this.s;
    this.clampCam();
    this.redraw();
  }

  private zoomBy(factor: number): void {
    if (this.busy || this.overlay) return;
    this.zoom = Phaser.Math.Clamp(this.zoom * factor, 1, 9);
    this.clampCam();
    this.redraw();
  }

  private onDragStart(pointer: Phaser.Input.Pointer): void {
    if ((this.busy && !this.spectate) || this.overlay) return;
    if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
      this.startPinch();
      return;
    }
    this.dragging = true;
    this.dragMoved = false;
    this.aimFrom = null;
    // Dragging from one of your own countries aims an order; elsewhere it pans.
    if (this.state.current === 'player' && !this.spectate) {
      const id = this.regionAt(pointer.x, pointer.y);
      if (id && this.state.regions[id].owner === 'player') this.aimFrom = id;
    }
    this.dragLast = { x: pointer.x, y: pointer.y };
  }

  private pinchState(): { dist: number; x: number; y: number } {
    const a = this.input.pointer1;
    const b = this.input.pointer2;
    return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** A second finger turns whatever the first one was doing into a pinch-zoom/pan gesture. */
  private startPinch(): void {
    this.pinching = true;
    this.pinchLast = this.pinchState();
    this.aimFrom = null;
    this.dragging = false;
    this.dragMoved = true;
    this.attackHint.setVisible(false);
    this.drawOverlay();
  }

  private onPinchMove(): void {
    const cur = this.pinchState();
    const last = this.pinchLast;
    const anchor = this.screenToWorld(last.x, last.y);
    this.zoom = Phaser.Math.Clamp(this.zoom * (cur.dist / last.dist), 1, 9);
    this.camX = anchor.x - (cur.x - this.view.w / 2) / this.s;
    this.camY = anchor.y - (cur.y - this.view.h / 2) / this.s;
    this.pinchLast = cur;
    this.clampCam();
    this.redraw();
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if ((this.busy && !this.spectate) || this.overlay) return;
    if (this.pinching) {
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) this.onPinchMove();
      return;
    }
    if (this.dragging) {
      const dx = pointer.x - this.dragLast.x;
      const dy = pointer.y - this.dragLast.y;
      if (!this.dragMoved && Math.hypot(dx, dy) < 6) return;
      if (this.aimFrom) {
        if (!this.dragMoved) {
          this.selected = this.aimFrom;
          this.suicideArmed = null;
          sfx.select();
        }
        this.dragMoved = true;
        this.aimPos = { x: pointer.x, y: pointer.y };
        const id = this.regionAt(pointer.x, pointer.y);
        this.hoverId = id;
        this.updateAttackHint(id, pointer);
        this.drawOverlay();
        return;
      }
      this.attackHint.setVisible(false);
      this.dragMoved = true;
      this.camX -= dx / this.s;
      this.camY -= dy / this.s;
      this.dragLast = { x: pointer.x, y: pointer.y };
      this.clampCam();
      this.redraw();
      return;
    }
    // Hover: cheap overlay-only repaint.
    const id = this.regionAt(pointer.x, pointer.y);
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.input.setDefaultCursor(id ? 'pointer' : 'default');
      this.drawOverlay();
    }
    this.updateAttackHint(id, pointer);
  }

  private updateAttackHint(id: string | null, pointer: Phaser.Input.Pointer): void {
    if (!id || !this.selected || id === this.selected || !canAttack(this.state, this.selected, id)) {
      this.attackHint.setVisible(false);
      return;
    }
    const preview = previewAttack(this.state, this.selected, id);
    const source = this.state.regions[this.selected].armies;
    this.attackHint.setText(`${nameOf(this.selected)} ${source}  vs  ${nameOf(id)} ${preview.defense}\n${preview.willCapture ? 'VICTORIA PREVISTA' : 'FALTAN TROPAS PARA GANAR'}`);
    this.attackHint.setColor(preview.willCapture ? '#b9f5ff' : '#ffe3a3');
    const x = Phaser.Math.Clamp(pointer.x + 18, 8, Math.max(8, this.view.w - this.attackHint.width - 8));
    let y = Phaser.Math.Clamp(pointer.y + 18, 8, Math.max(8, this.view.h - this.attackHint.height - 8));
    const logBounds = this.log.getBounds();
    if (y < logBounds.bottom && y + this.attackHint.height > logBounds.top &&
      x < logBounds.right && x + this.attackHint.width > logBounds.left) {
      y = Math.max(8, pointer.y - this.attackHint.height - 18);
    }
    this.attackHint.setPosition(x, y).setVisible(true);
  }

  // ── rendering ────────────────────────────────────────────────────

  private regionColor(id: string): FactionId | 'neutral' {
    return this.state.regions[id].owner ?? 'neutral';
  }

  private transformedRings(id: string): Phaser.Geom.Point[][] {
    const r = regionById.get(id)!;
    return r.rings.map((ring) =>
      ring.map(([x, y]) => {
        const p = this.worldToScreen(x, y);
        return new Phaser.Geom.Point(p.x, p.y);
      }),
    );
  }

  private redraw(): void {
    this.drawMap();
    this.drawOverlay();
  }

  private drawMap(): void {
    const { fills, state } = this;
    fills.clear();

    // Ocean graticule for depth.
    fills.lineStyle(1, 0x1e3a8a, 0.16);
    for (let x = 0; x <= WORLD_WIDTH; x += 512) {
      const a = this.worldToScreen(x, 0);
      const b = this.worldToScreen(x, WORLD_HEIGHT);
      fills.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 512) {
      const a = this.worldToScreen(0, y);
      const b = this.worldToScreen(WORLD_WIDTH, y);
      fills.lineBetween(a.x, a.y, b.x, b.y);
    }

    for (const r of REGIONS) {
      const pts = this.transformedRings(r.id);
      fills.fillStyle(OWNER_FILL[this.regionColor(r.id)], 0.82);
      fills.lineStyle(1, 0x0a1122, 0.9);
      for (const ring of pts) {
        // Phaser fills as a triangle fan, which breaks concave coastlines; triangulate instead.
        const flat: number[] = [];
        for (const p of ring) flat.push(p.x, p.y);
        const tris = Phaser.Geom.Polygon.Earcut(flat);
        for (let i = 0; i < tris.length; i += 3) {
          const a = tris[i] * 2, b = tris[i + 1] * 2, c = tris[i + 2] * 2;
          fills.fillTriangle(flat[a], flat[a + 1], flat[b], flat[b + 1], flat[c], flat[c + 1]);
        }
        fills.strokePoints(ring, true);
      }
    }

    for (const r of REGIONS) {
      const label = this.labels.get(r.id)!;
      const rs = state.regions[r.id];
      const c = this.worldToScreen(r.center[0], r.center[1]);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const ring of r.rings) {
        for (const [x, y] of ring) {
          const p = this.worldToScreen(x, y);
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      }
      const onScreen = maxX > 0 && minX < this.view.w && maxY > 56 && minY < this.view.h;
      const area = (maxX - minX) * (maxY - minY);
      label.name.setPosition(c.x, c.y - 9).setVisible(onScreen && area > 2200);
      label.army.setPosition(c.x, c.y + 8).setVisible(onScreen && area > 320);
      label.army.setText(`${rs.armies}`);
      label.army.setColor(OWNER_LABEL[this.regionColor(r.id)]);
    }
  }

  private drawOverlay(): void {
    const { highlights, state } = this;
    highlights.clear();

    const stroke = (id: string, color: number, width: number, alpha = 0.95) => {
      highlights.lineStyle(width, color, alpha);
      for (const ring of this.transformedRings(id)) highlights.strokePoints(ring, true);
    };

    if (this.selected) {
      stroke(this.selected, 0xffffff, 3);
      for (const n of ADJACENCY[this.selected] ?? []) {
        if (canAttack(state, this.selected, n)) {
          const p = previewAttack(state, this.selected, n);
          // Amber is an available but currently losing attack, not a blocked border.
          stroke(n, p.willCapture ? 0x22d3ee : 0xfbbf24, this.suicideArmed === n ? 4 : 2.5, 0.95);
        } else if (canMove(state, this.selected, n)) stroke(n, 0x34d399, 2);
      }
    } else if (this.hoverId && !this.busy && !this.overlay && state.current === 'player') {
      stroke(this.hoverId, 0xe2e8f0, 1.6, 0.5);
    }

    if (this.aimFrom && this.dragMoved) {
      const [fx, fy] = this.anchorOf(this.aimFrom);
      const a = this.worldToScreen(fx, fy);
      let end = { x: this.aimPos.x, y: this.aimPos.y };
      let color = 0x94a3b8;
      let troops = 4;
      const tgt = this.hoverId;
      if (tgt && tgt !== this.aimFrom) {
        if (canAttack(state, this.aimFrom, tgt)) {
          const p = previewAttack(state, this.aimFrom, tgt);
          color = p.willCapture ? 0x22d3ee : 0xfbbf24;
          troops = p.send;
        } else if (canMove(state, this.aimFrom, tgt)) {
          color = 0x34d399;
          troops = state.regions[this.aimFrom].armies - 1;
        }
        if (color !== 0x94a3b8) {
          const [tx, ty] = this.anchorOf(tgt);
          end = this.worldToScreen(tx, ty);
          stroke(tgt, color, 3, 1);
        }
      }
      const now = this.time.now;
      const pulse = 1 + 0.25 * Math.sin(now / 120);
      highlights.fillStyle(color, 0.25).fillCircle(a.x, a.y, 14 * pulse);
      highlights.fillStyle(color, 0.95).fillCircle(a.x, a.y, 6);
      const n = Phaser.Math.Clamp(Math.round(troops / 2), 3, 12);
      this.drawArrow(a.x, a.y, end.x, end.y, color, {
        dots: { n, pos: (i) => (now / 1100 + i / n) % 1 },
      });
    }

    if (this.flash) {
      const f = this.flash;
      const [fx, fy] = this.anchorOf(f.from);
      const [tx, ty] = this.anchorOf(f.to);
      const pa = this.worldToScreen(fx, fy);
      const pb = this.worldToScreen(tx, ty);
      const t = this.time.now - f.t0;
      const color = f.win ? 0xfbbf24 : 0xef4444;
      const fade = t < 650 ? 1 : Phaser.Math.Clamp(1 - (t - 650) / 400, 0, 1);
      if (fade > 0) {
        this.drawArrow(pa.x, pa.y, pb.x, pb.y, color, {
          progress: Phaser.Math.Easing.Cubic.Out(Phaser.Math.Clamp(t / 260, 0, 1)),
          alpha: fade,
          width: 6,
          dots: {
            n: f.n,
            pos: (i) => Phaser.Math.Easing.Cubic.In(Phaser.Math.Clamp((t - 80 - i * 35) / 420, 0, 1)),
          },
        });
      }
      if (t >= 500 && !f.hit) {
        f.hit = true;
        this.impactFx(f.to, f.tint ?? [color, 0xffffff], f.tint !== null);
      }
      if (t > 500) {
        // Impact shockwave on the target.
        const k = Phaser.Math.Clamp((t - 500) / 550, 0, 1);
        highlights.lineStyle(4, color, 1 - k);
        highlights.strokeCircle(pb.x, pb.y, 10 + k * 56);
        highlights.lineStyle(2, 0xffffff, (1 - k) * 0.8);
        highlights.strokeCircle(pb.x, pb.y, 5 + k * 34);
        highlights.fillStyle(color, (1 - k) * 0.35).fillCircle(pb.x, pb.y, 8 + k * 24);
      }
    }
  }

  private updateHud(): void {
    const s = this.state;
    const p = ownedRegions(s, 'player');
    const a = ownedRegions(s, 'ai');
    const total = REGIONS.length;
    const phaseLabel = this.spectate
      ? `MODO LOCO · turno ${s.turn} · juega la IA ${s.current === 'player' ? 'AZUL' : 'ROJA'}`
      : s.current === 'ai'
        ? 'TURNO DE LA COMPUTADORA'
        : `Tu turno ${s.turn} — ataques: ${s.acted.length}/${s.strikers.length}`;
    const me = this.spectate ? 'AZUL' : 'TÚ';
    const them = this.spectate ? 'ROJA' : 'IA';
    this.hud.setText(this.view.w < 700 ? [
      phaseLabel,
      `${me} ${p.length} países · ${this.armiesOf('player')} tropas · +${incomeFor(s, 'player')}`,
      `${them} ${a.length} países · ${this.armiesOf('ai')} tropas · +${incomeFor(s, 'ai')}`,
    ] : [
      phaseLabel,
      `${me}  ${p.length}/${total} países · ${this.armiesOf('player')} tropas · +${incomeFor(s, 'player')}    |    ${them}  ${a.length} países · ${this.armiesOf('ai')} tropas · +${incomeFor(s, 'ai')}`,
    ]);
    this.mainBtn.setVisible(!this.spectate && s.current === 'player' && !this.busy);
    this.drawUiPanels();
  }

  private armiesOf(side: FactionId): number {
    return ownedRegions(this.state, side).reduce((n, id) => n + this.state.regions[id].armies, 0);
  }

  private setLog(msg: string): void {
    this.log.setText(msg);
    this.drawUiPanels();
  }

  private drawUiPanels(): void {
    const g = this.uiPanels.clear();
    for (const [text, accent] of [[this.hud, this.state.current === 'player' ? 0x54c5d2 : 0xe8756c], [this.log, 0xe4b65f]] as const) {
      const bounds = text.getBounds();
      g.fillStyle(0x071723, 0.94).fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 9);
      g.lineStyle(1, accent, 0.36).strokeRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 9);
      g.fillStyle(accent, 0.85).fillRoundedRect(bounds.x, bounds.y + 8, 3, Math.max(0, bounds.height - 16), 1);
    }
  }

  // ── player input ─────────────────────────────────────────────────

  private regionAt(sx: number, sy: number): string | null {
    if (this.overlay) return null;
    const w = this.screenToWorld(sx, sy);
    for (let i = REGIONS.length - 1; i >= 0; i--) {
      const r = REGIONS[i];
      for (const ring of r.rings) {
        if (polygonContains(ring, w.x, w.y)) return r.id;
      }
    }
    for (let i = REGIONS.length - 1; i >= 0; i--) {
      const r = REGIONS[i];
      const label = this.labels.get(r.id);
      if (label && ((label.name.visible && label.name.getBounds().contains(sx, sy)) ||
        (label.army.visible && label.army.getBounds().contains(sx, sy)))) return r.id;
    }
    return null;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    this.attackHint.setVisible(false);
    if (this.pinching) {
      // Stay in pinch mode until both fingers are up so the leftover finger can't click or pan.
      if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) this.pinching = false;
      this.dragging = false;
      this.aimFrom = null;
      return;
    }
    this.dragging = false;
    const aimFrom = this.aimFrom;
    this.aimFrom = null;
    if (this.dragMoved) {
      // A drag from your own country is an order; any other drag was a pan.
      if (aimFrom && !this.busy && !this.overlay && this.state.current === 'player') {
        const target = this.regionAt(pointer.x, pointer.y);
        if (target && target !== aimFrom) {
          this.selected = aimFrom;
          if (!this.tryAct(aimFrom, target)) this.explainBlocked(aimFrom, target);
        }
        this.drawOverlay();
      }
      return;
    }
    if (this.busy || this.overlay || this.spectate || this.state.current !== 'player') return;
    if ([this.mainBtn, this.muteBtn, this.zoomInBtn, this.zoomOutBtn].some(
      (button) => button.visible && button.getBounds().contains(pointer.x, pointer.y),
    )) return;

    const id = this.regionAt(pointer.x, pointer.y);
    if (!id) {
      this.selected = null;
      this.suicideArmed = null;
      this.drawOverlay();
      return;
    }

    const s = this.state;
    const rs = s.regions[id];

    if (this.selected && this.selected !== id && this.tryAct(this.selected, id)) return;

    if (rs.owner === 'player') {
      this.selected = this.selected === id ? null : id;
      this.suicideArmed = null;
      if (this.selected) {
        sfx.select();
        this.setLog(
          !s.strikers.includes(id)
            ? `${nameOf(id)} fue conquistada este turno — podrá atacar desde el próximo.`
            : s.acted.includes(id)
              ? `${nameOf(id)} ya usó su ataque este turno — elige otra región, mueve tropas o termina el turno.`
              : rs.armies <= 1
                ? `${nameOf(id)} necesita al menos 2 tropas para atacar. Espera refuerzos o mueve tropas aquí.`
              : `${nameOf(id)}: celeste = victoria · dorado = ataque posible, faltan tropas · verde = mover tropas.`,
        );
      }
      this.drawOverlay();
    } else {
      if (this.selected) {
        this.explainBlocked(this.selected, id);
        return;
      }
      this.setLog(`${nameOf(id)} no es tuyo. Selecciona un país propio para atacar.`);
      this.suicideArmed = null;
      this.drawOverlay();
    }
  }

  /** Attack or move from `from` to `id`. Returns true when the order was handled. */
  private tryAct(from: string, id: string): boolean {
    const s = this.state;
    if (canAttack(s, from, id)) {
      const p = previewAttack(s, from, id);
      if (!p.willCapture && this.suicideArmed !== id) {
        // First order on a losing target: arm the warning, don't waste troops.
        this.suicideArmed = id;
        this.drawOverlay();
        const need = p.cost + 1 - p.send;
        this.setLog(`${nameOf(id)}: envías ${p.send} contra ${p.defense}. Faltan ${need} tropas para ganar. Espera refuerzos o repite la orden para atacar igualmente.`);
        sfx.repel();
        return true;
      }
      this.suicideArmed = null;
      const result = performAttack(s, from, id);
      this.startFlash(from, id, result.willCapture, p.send, result.willCapture ? [0xfbbf24, 0xf59e0b, 0xfef3c7] : null);
      sfx.attack();
      if (result.willCapture) {
        sfx.capture();
        this.setLog(`¡${nameOf(id)} es tuyo! Enviaste ${p.send}, bajas ${p.cost}, quedan ${result.survivors}.`);
      } else {
        sfx.repel();
        this.setLog(`${nameOf(id)} resiste: perdiste ${p.send}.`);
      }
      this.selected = result.willCapture ? id : null;
      this.afterAction();
      return true;
    }
    if (canMove(s, from, id)) {
      const moved = moveArmies(s, from, id, s.regions[from].armies - 1);
      sfx.move();
      this.startFlash(from, id, true, moved);
      this.setLog(`Mueves ${moved} desde ${nameOf(from)} a ${nameOf(id)}.`);
      this.selected = null;
      this.afterAction();
      return true;
    }
    return false;
  }

  private explainBlocked(from: string, id: string): void {
    const s = this.state;
    if (!ADJACENCY[from]?.includes(id)) {
      this.setLog(`${nameOf(id)} no está conectado con ${nameOf(from)}. Elige un territorio marcado.`);
    } else if (!s.strikers.includes(from)) {
      this.setLog(`${nameOf(from)} fue conquistado este turno y podrá atacar en el siguiente.`);
    } else if (s.acted.includes(from)) {
      this.setLog(`${nameOf(from)} ya atacó este turno. Podrá volver a atacar en el siguiente.`);
    } else if (s.regions[from].armies <= 1) {
      this.setLog(`${nameOf(from)} necesita al menos 2 tropas para atacar. Espera refuerzos o mueve tropas aquí.`);
    }
  }

  // ── order arrows ─────────────────────────────────────────────────

  private anchorCache = new Map<string, [number, number]>();

  private anchorOf(id: string): [number, number] {
    let a = this.anchorCache.get(id);
    if (!a) {
      a = this.interiorPoint(id) ?? this.regionCenter(id) ?? [0, 0];
      this.anchorCache.set(id, a);
    }
    return a;
  }

  private startFlash(from: string, to: string, win: boolean, troops: number, captureTint: number[] | null = null): void {
    const t0 = this.time.now;
    this.flash = { from, to, win, t0, n: Phaser.Math.Clamp(Math.round(troops / 2), 3, 12), tint: captureTint, hit: false };
    this.time.delayedCall(1100, () => {
      if (this.flash?.t0 === t0) {
        this.flash = null;
        this.drawOverlay();
      }
    });
  }

  update(): void {
    if (this.flash || (this.aimFrom && this.dragMoved)) this.drawOverlay();
  }

  /**
   * Glowing curved arrow that widens toward the tip, with energy pulses and a pulsing head.
   * `dots` places troop orbs (position 0..1 along the curve) that run down the arrow.
   */
  private drawArrow(
    ax: number, ay: number, bx: number, by: number, color: number,
    o: { progress?: number; alpha?: number; width?: number; dots?: { n: number; pos: (i: number) => number } } = {},
  ): void {
    const { progress = 1, alpha = 1, width = 5, dots } = o;
    const g = this.highlights;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 6) return;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const bend = Math.min(len * 0.2, 100);
    const cx = (ax + bx) / 2 + nx * bend;
    const cy = (ay + by) / 2 + ny * bend;
    const at = (t: number) => {
      const u = 1 - t;
      return { x: u * u * ax + 2 * u * t * cx + t * t * bx, y: u * u * ay + 2 * u * t * cy + t * t * by };
    };
    const steps = Math.max(16, Math.min(80, Math.round(len / 6)));
    const last = Math.max(2, Math.round(steps * progress));
    const now = this.time.now;
    const pts = Array.from({ length: last + 1 }, (_, i) => at(i / steps));
    const widthAt = (i: number) => width * (0.35 + 0.9 * (i / steps));

    const passes: [number, number, number][] = [
      [3.4, 0.1, color], [1.9, 0.22, color], [1, 0.95, color], [0.32, 0.6, 0xffffff],
    ];
    for (const [m, a, c] of passes) {
      for (let i = 0; i < last; i++) {
        g.lineStyle(widthAt(i) * m, c, a * alpha);
        g.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      }
    }

    // Bright energy pulses sliding along the beam.
    for (let k = 0; k < 3; k++) {
      const t = (((now / 650) + k / 3) % 1) * progress;
      const p = at(t);
      g.fillStyle(0xffffff, 0.85 * alpha).fillCircle(p.x, p.y, 2.5 + 2 * t);
    }

    // Troop orbs with comet trails.
    if (dots) {
      for (let i = 0; i < dots.n; i++) {
        const head = dots.pos(i);
        if (head <= 0.001 || head >= 0.999) continue;
        for (let j = 4; j >= 0; j--) {
          const tt = head - j * 0.02;
          if (tt <= 0) continue;
          const p = at(Math.min(tt, progress));
          const r = 5.5 - j * 0.9;
          const a = (1 - j * 0.18) * alpha;
          g.fillStyle(color, 0.3 * a).fillCircle(p.x, p.y, r * 2);
          g.fillStyle(color, a).fillCircle(p.x, p.y, r);
          if (j === 0) g.fillStyle(0xffffff, 0.95 * alpha).fillCircle(p.x, p.y, r * 0.45);
        }
      }
    }

    // Pulsing arrowhead.
    const tip = pts[last];
    const prev = pts[Math.max(0, last - 2)];
    const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    const h = (14 + width * 1.6) * (1 + 0.18 * Math.sin(now / 80));
    const head = (size: number, c: number, a: number) => {
      g.fillStyle(c, a * alpha);
      g.fillTriangle(
        tip.x + Math.cos(ang) * size * 0.8, tip.y + Math.sin(ang) * size * 0.8,
        tip.x + Math.cos(ang + 2.45) * size, tip.y + Math.sin(ang + 2.45) * size,
        tip.x + Math.cos(ang - 2.45) * size, tip.y + Math.sin(ang - 2.45) * size,
      );
    };
    head(h * 1.7, color, 0.22);
    head(h, color, 1);
    head(h * 0.5, 0xffffff, 0.85);
  }

  private impactFx(regionId: string, tint: number[], capture: boolean): void {
    if (capture) {
      this.captureFx(regionId, tint);
      return;
    }
    const center = this.anchorOf(regionId);
    const p = this.worldToScreen(center[0], center[1]);
    const burst = this.add.particles(p.x, p.y, 'spark', {
      speed: { min: 40, max: 150 },
      scale: { start: 0.9, end: 0 },
      lifespan: 450,
      tint,
      emitting: false,
    });
    burst.explode(12);
    this.time.delayedCall(700, () => burst.destroy());
  }

  private afterAction(): void {
    this.state.winner = checkWinner(this.state);
    this.redraw();
    this.updateHud();
    if (this.state.winner) this.showGameOver();
  }

  private onMainButton(): void {
    const s = this.state;
    if (s.current !== 'player' || this.busy) return;
    this.selected = null;
    this.suicideArmed = null;
    sfx.turn();
    endTurn(s);
    this.redraw();
    this.updateHud();
    this.runAiTurn();
  }

  // ── AI turn animation ────────────────────────────────────────────

  private runAiTurn(): void {
    this.busy = true;
    this.updateHud();
    const side = this.state.current;
    const actions = planAiTurn(cloneState(this.state), side);
    this.playAiStep(actions, 0);
  }

  private playAiStep(actions: AiAction[], i: number): void {
    if (this.state.winner) {
      this.finishAiTurn();
      return;
    }
    if (i >= actions.length) {
      this.time.delayedCall(350 / this.speed, () => this.finishAiTurn());
      return;
    }
    const a = actions[i];
    this.applyAiAction(a);
    this.redraw();
    this.updateHud();
    const wait = (a.type === 'attack' ? 760 : 420) / this.speed;
    this.time.delayedCall(wait, () => this.playAiStep(actions, i + 1));
  }

  private applyAiAction(a: AiAction): void {
    const s = this.state;
    const who = this.spectate ? (s.current === 'player' ? 'IA azul' : 'IA roja') : 'IA';
    if (a.type === 'attack') {
      const send = previewAttack(s, a.from, a.to).send;
      const r = performAttack(s, a.from, a.to);
      this.startFlash(a.from, a.to, r.willCapture, send, r.willCapture ? [0xef4444, 0xf97316, 0xfecaca] : null);
      sfx.attack();
      if (r.willCapture) sfx.capture();
      this.setLog(`${who}: ${nameOf(a.from)} ataca ${nameOf(a.to)} — ${r.willCapture ? 'la conquista' : 'fracasa'}.`);
    } else {
      moveArmies(s, a.from, a.to, a.amount);
      this.startFlash(a.from, a.to, true, a.amount);
      sfx.aiTick();
      this.setLog(`${who} mueve ${a.amount} ejércitos hacia el frente (${nameOf(a.to)}).`);
    }
  }

  private finishAiTurn(): void {
    this.flash = null;
    this.busy = false;
    const s = this.state;
    s.winner = checkWinner(s);
    // Stalemate guard for spectator games: the bigger empire wins.
    if (this.spectate && !s.winner && s.turn >= 120) {
      s.winner = ownedRegions(s, 'player').length >= ownedRegions(s, 'ai').length ? 'player' : 'ai';
    }
    if (s.winner) {
      this.redraw();
      this.showGameOver();
      return;
    }
    const res = endTurn(s);
    sfx.turn();
    this.redraw();
    this.updateHud();
    if (this.spectate) {
      this.time.delayedCall(500 / this.speed, () => {
        if (!this.overlay) this.runAiTurn();
      });
      return;
    }
    const where = res.places.map(nameOf).join(', ');
    this.setLog(res.income > 0
      ? `Tu turno ${s.turn}: +${res.income} refuerzos desplegados en ${where}.`
      : 'Tu primer turno: todavía no hay refuerzos. Llegarán en tu siguiente turno.');
  }

  // ── game over ────────────────────────────────────────────────────

  private showGameOver(): void {
    this.overlay = true;
    this.busy = true;
    this.mainBtn.setVisible(false);
    this.speedBtn?.setVisible(false);
    const playerWon = this.state.winner === 'player';
    const spec = this.spectate;
    const good = spec || playerWon;
    const { width, height } = this.scale;

    const backdrop = this.add
      .rectangle(0, 0, width, height, 0x060a16, 0.9)
      .setOrigin(0)
      .setDepth(30)
      .setAlpha(0);
    this.tweens.add({ targets: backdrop, alpha: 1, duration: 500 });

    const title = this.add
      .text(width / 2, height / 2 - 90, spec ? (playerWon ? '¡GANA LA IA AZUL!' : '¡GANA LA IA ROJA!') : playerWon ? '¡VICTORIA!' : 'DERROTA', {
        fontFamily: 'Sora, sans-serif',
        fontSize: spec ? '44px' : '64px',
        fontStyle: 'bold',
        color: good ? '#fbbf24' : '#ef4444',
        stroke: good ? '#92400e' : '#7f1d1d',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setScale(2.6)
      .setAlpha(0)
      .setDepth(31)
      .setShadow(0, 0, good ? '#fbbf24' : '#ef4444', 30, true, true);
    this.tweens.add({
      targets: title,
      scale: 1,
      alpha: 1,
      duration: 650,
      ease: 'Back.easeOut',
      delay: 150,
    });

    const total = REGIONS.length;
    const stats = this.add
      .text(
        width / 2,
        height / 2 - 16,
        spec
          ? `Terminó en ${this.state.turn} turnos.\nAzul: ${ownedRegions(this.state, 'player').length} países · Roja: ${ownedRegions(this.state, 'ai').length} países.`
          : playerWon
          ? `Derrotaste a la computadora en ${this.state.turn} turnos.\nControlas ${ownedRegions(this.state, 'player').length} de ${total} países.`
          : `La computadora ganó en ${this.state.turn} turnos.\nTú controlabas ${ownedRegions(this.state, 'player').length} países.`,
        {
          fontFamily: 'Inter, sans-serif',
          fontSize: '16px',
          color: '#cbd5e1',
          align: 'center',
        },
      )
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(31);
    this.tweens.add({ targets: stats, alpha: 1, duration: 500, delay: 600 });

    if (good) {
      sfx.victory();
      const confetti = this.add.particles(0, -20, 'confetti', {
        x: { min: 0, max: width },
        lifespan: 2800,
        speedY: { min: 120, max: 300 },
        speedX: { min: -50, max: 50 },
        rotate: { min: 0, max: 360 },
        scale: { min: 0.7, max: 1.4 },
        tint: [0xfbbf24, 0x22d3ee, 0xa78bfa, 0x34d399, 0xf472b6],
        frequency: 55,
        quantity: 3,
      });
      this.time.delayedCall(5000, () => confetti.destroy());
    } else {
      sfx.defeat();
    }

    const btnY = height / 2 + 90;
    makeButton(
      this,
      width / 2 - 118,
      btnY,
      'REVANCHA',
      () => this.scene.start('World', { first: this.firstPlayer, homelands: this.homelandsCount, spectate: this.spectate }),
      { style: 'primary' },
    );
    makeButton(this, width / 2 + 118, btnY, 'MENU', () => this.scene.start('Menu'));
  }
}

/** Ray-cast point-in-polygon over [x, y] world-space vertices. */
function polygonContains(poly: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
