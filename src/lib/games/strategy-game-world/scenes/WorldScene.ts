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
  player: 0x1d4ed8,
  ai: 0xb91c1c,
  neutral: 0x2b3a52,
};

const OWNER_LABEL: Record<FactionId | 'neutral', string> = {
  player: '#bfdbfe',
  ai: '#fecaca',
  neutral: '#8fa3bf',
};

interface WorldSceneData {
  first: FactionId;
  homelands?: number;
}

/**
 * The world board with REAL country geometry (208 Natural Earth regions).
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
  private flash: { from: string; to: string; win: boolean } | null = null;
  private busy = false;
  private dragging = false;
  private dragMoved = false;
  private dragLast = { x: 0, y: 0 };

  private hud!: Phaser.GameObjects.Text;
  private log!: Phaser.GameObjects.Text;
  private mainBtn!: Phaser.GameObjects.Text;
  private muteBtn!: Phaser.GameObjects.Text;
  private overlay = false;

  init(data: WorldSceneData): void {
    this.firstPlayer = data.first ?? 'player';
    this.homelandsCount = Phaser.Math.Clamp(data.homelands ?? 3, 1, 5);
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

    // Open the view centered on the player's first homeland, moderately zoomed.
    const homeId = this.state.initialHomelands.player[0] ?? this.state.initialHomelands.ai[0];
    const home = homeId ? regionById.get(homeId) : undefined;
    this.camX = home ? home.center[0] : WORLD_WIDTH / 2;
    this.camY = home ? home.center[1] : WORLD_HEIGHT / 2;
    this.zoom = 2.2;

    this.labels = new Map();
    this.fills = this.add.graphics().setDepth(0);
    this.highlights = this.add.graphics().setDepth(1);

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
        backgroundColor: '#0b1224d9',
        padding: { x: 12, y: 8 },
      })
      .setDepth(12);

    this.log = this.add
      .text(0, 0, 'Arrastra para moverte · rueda para zoom', {
        fontFamily: 'Inter, sans-serif',
        fontSize: '13px',
        color: '#9fb3d9',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(12);

    this.mainBtn = makeButton(this, 0, 0, 'Terminar turno', () => this.onMainButton());
    this.muteBtn = makeButton(this, 0, 0, '🔊', () => {
      this.muteBtn.setText(sfx.toggleMute() ? '🔇' : '🔊');
    }, { fontSize: '13px', depth: 14 });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.handleResize();

    this.input.on('pointerdown', this.onDragStart, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('wheel', this.onWheel, this);

    this.redraw();
    this.updateHud();

    const homelands = this.state.initialHomelands.player.map(nameOf).join(' · ');
    if (this.state.current === 'ai') {
      this.setLog(`Tus países: ${homelands}. Empieza la computadora…`);
      this.runAiTurn();
    } else {
      this.setLog(`Tus países: ${homelands}. Elige uno y ataca: los refuerzos llegan solos cada turno.`);
    }
  }

  shutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
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
    this.log.setPosition(width / 2, height - 26);
    this.mainBtn.setPosition(width - 120, height - 26);
    this.muteBtn.setPosition(width - 34, 30);
    if (this.fills) this.redraw();
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

  private onDragStart(pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.overlay) return;
    this.dragging = true;
    this.dragMoved = false;
    this.dragLast = { x: pointer.x, y: pointer.y };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.overlay) return;
    if (this.dragging) {
      const dx = pointer.x - this.dragLast.x;
      const dy = pointer.y - this.dragLast.y;
      if (!this.dragMoved && Math.hypot(dx, dy) < 6) return;
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
        fills.fillPoints(ring, true);
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
      stroke(this.selected, 0xfbbf24, 3);
      for (const n of ADJACENCY[this.selected] ?? []) {
        if (canAttack(state, this.selected, n)) {
          const p = previewAttack(state, this.selected, n);
          // cyan = sure conquest, red = you'd lose — warn before wasting troops
          stroke(n, p.willCapture ? 0x22d3ee : 0xef4444, this.suicideArmed === n ? 4 : 2.5, 0.95);
        } else if (canMove(state, this.selected, n)) stroke(n, 0x34d399, 2);
      }
    } else if (this.hoverId && !this.busy && !this.overlay && state.current === 'player') {
      stroke(this.hoverId, 0xe2e8f0, 1.6, 0.5);
    }

    if (this.flash) {
      const a = regionById.get(this.flash.from)!;
      const b = regionById.get(this.flash.to)!;
      highlights.lineStyle(4, this.flash.win ? 0xfbbf24 : 0xef4444, 0.9);
      const pa = this.worldToScreen(a.center[0], a.center[1]);
      const pb = this.worldToScreen(b.center[0], b.center[1]);
      highlights.lineBetween(pa.x, pa.y, pb.x, pb.y);
    }
  }

  private updateHud(): void {
    const s = this.state;
    const p = ownedRegions(s, 'player');
    const a = ownedRegions(s, 'ai');
    const total = REGIONS.length;
    const phaseLabel =
      s.current === 'ai'
        ? 'TURNO DE LA COMPUTADORA'
        : `Tu turno ${s.turn} — ataques: ${s.acted.length}/${s.strikers.length}`;
    this.hud.setText([
      phaseLabel,
      `Tú: ${p.length}/${total} · ${this.armiesOf('player')} ejércitos   |   IA: ${a.length} · ${this.armiesOf('ai')}   |   Producción — Tú: ${incomeFor(s, 'player')} · IA: ${incomeFor(s, 'ai')}`,
    ]);
    this.mainBtn.setVisible(s.current === 'player' && !this.busy);
  }

  private armiesOf(side: FactionId): number {
    return ownedRegions(this.state, side).reduce((n, id) => n + this.state.regions[id].armies, 0);
  }

  private setLog(msg: string): void {
    this.log.setText(msg);
  }

  // ── player input ─────────────────────────────────────────────────

  private regionAt(sx: number, sy: number): string | null {
    if (this.overlay) return null;
    const w = this.screenToWorld(sx, sy);
    for (const r of REGIONS) {
      for (const ring of r.rings) {
        if (polygonContains(ring, w.x, w.y)) return r.id;
      }
    }
    return null;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    this.dragging = false;
    if (this.dragMoved) return; // that was a pan, not a click
    if (this.busy || this.overlay || this.state.current !== 'player') return;

    const id = this.regionAt(pointer.x, pointer.y);
    if (!id) {
      this.selected = null;
      this.suicideArmed = null;
      this.drawOverlay();
      return;
    }

    const s = this.state;
    const rs = s.regions[id];

    if (this.selected && this.selected !== id) {
      if (canAttack(s, this.selected, id)) {
        const from = this.selected;
        const p = previewAttack(s, from, id);
        if (!p.willCapture && this.suicideArmed !== id) {
          // First click on a losing target: arm the warning, don't waste troops.
          this.suicideArmed = id;
          this.drawOverlay();
          const need = p.cost + 1 - p.send;
          this.setLog(`⚠ ${nameOf(id)} te aplasta: envías ${p.send}, su defensa cuesta ${p.cost}. Te faltan ${need} ejércitos — toca de nuevo para atacar igual.`);
          sfx.repel();
          return;
        }
        this.suicideArmed = null;
        const result = performAttack(s, from, id);
        this.flash = { from, to: id, win: result.willCapture };
        sfx.attack();
        if (result.willCapture) {
          sfx.capture();
          this.captureFx(id, [0xfbbf24, 0xf59e0b, 0xfef3c7]);
          this.setLog(`¡${nameOf(id)} es tuyo! Enviaste ${p.send}, bajas ${p.cost}, quedan ${result.survivors}.`);
        } else {
          sfx.repel();
          this.setLog(`${nameOf(id)} resiste: perdiste ${p.send}.`);
        }
        this.selected = result.willCapture ? id : null;
        this.afterAction();
        return;
      }
      if (canMove(s, this.selected, id)) {
        const moved = moveArmies(s, this.selected, id, s.regions[this.selected].armies - 1);
        sfx.move();
        this.setLog(`Mueves ${moved} desde ${nameOf(this.selected)} a ${nameOf(id)}.`);
        this.selected = null;
        this.afterAction();
        return;
      }
    }

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
              : `${nameOf(id)}: celeste = atacar y ganar · rojo = te falta gente · verde = mover tropas.`,
        );
      }
      this.drawOverlay();
    } else {
      this.selected = null;
      this.suicideArmed = null;
      this.drawOverlay();
    }
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
    endTurn(s); // now current === 'ai', its income auto-deploys
    this.redraw();
    this.updateHud();
    this.runAiTurn();
  }

  // ── AI turn animation ────────────────────────────────────────────

  private runAiTurn(): void {
    this.busy = true;
    this.updateHud();
    const actions = planAiTurn(cloneState(this.state));
    this.playAiStep(actions, 0);
  }

  private playAiStep(actions: AiAction[], i: number): void {
    if (this.state.winner) {
      this.finishAiTurn();
      return;
    }
    if (i >= actions.length) {
      this.time.delayedCall(350, () => this.finishAiTurn());
      return;
    }
    const a = actions[i];
    this.applyAiAction(a);
    this.redraw();
    this.updateHud();
    const wait = a.type === 'attack' ? 520 : 300;
    this.time.delayedCall(wait, () => this.playAiStep(actions, i + 1));
  }

  private applyAiAction(a: AiAction): void {
    const s = this.state;
    if (a.type === 'attack') {
      const r = performAttack(s, a.from, a.to);
      this.flash = { from: a.from, to: a.to, win: r.willCapture };
      sfx.attack();
      if (r.willCapture) {
        sfx.capture();
        this.captureFx(a.to, [0xef4444, 0xf97316, 0xfecaca]);
      }
      this.setLog(`IA: ${nameOf(a.from)} ataca ${nameOf(a.to)} — ${r.willCapture ? 'la conquista' : 'fracasa'}.`);
    } else {
      moveArmies(s, a.from, a.to, a.amount);
      this.flash = { from: a.from, to: a.to, win: true };
      sfx.aiTick();
      this.setLog(`IA mueve ${a.amount} ejércitos hacia el frente (${nameOf(a.to)}).`);
    }
    if (this.flash) this.time.delayedCall(400, () => { this.flash = null; this.drawOverlay(); });
  }

  private finishAiTurn(): void {
    this.flash = null;
    this.busy = false;
    const s = this.state;
    s.winner = checkWinner(s);
    if (s.winner) {
      this.redraw();
      this.showGameOver();
      return;
    }
    const res = endTurn(s); // back to player, income auto-deploys
    sfx.turn();
    this.redraw();
    this.updateHud();
    const where = res.places.map(nameOf).join(', ');
    this.setLog(`Tu turno ${s.turn}: +${res.income} refuerzos desplegados en ${where}.`);
  }

  // ── game over ────────────────────────────────────────────────────

  private showGameOver(): void {
    this.overlay = true;
    this.busy = true;
    this.mainBtn.setVisible(false);
    const playerWon = this.state.winner === 'player';
    const { width, height } = this.scale;

    const backdrop = this.add
      .rectangle(0, 0, width, height, 0x060a16, 0.9)
      .setOrigin(0)
      .setDepth(30)
      .setAlpha(0);
    this.tweens.add({ targets: backdrop, alpha: 1, duration: 500 });

    const title = this.add
      .text(width / 2, height / 2 - 90, playerWon ? '¡VICTORIA!' : 'DERROTA', {
        fontFamily: 'Sora, sans-serif',
        fontSize: '64px',
        fontStyle: 'bold',
        color: playerWon ? '#fbbf24' : '#ef4444',
        stroke: playerWon ? '#92400e' : '#7f1d1d',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setScale(2.6)
      .setAlpha(0)
      .setDepth(31)
      .setShadow(0, 0, playerWon ? '#fbbf24' : '#ef4444', 30, true, true);
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
        playerWon
          ? `Conquistaste los ${total} países en ${this.state.turn} turnos.`
          : `La IA dominó el mundo en ${this.state.turn} turnos.\nTú controlabas ${ownedRegions(this.state, 'player').length} países.`,
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

    if (playerWon) {
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
      () => this.scene.start('World', { first: this.firstPlayer, homelands: this.homelandsCount }),
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
