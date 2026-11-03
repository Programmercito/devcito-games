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
import type { AiAction, FactionId, GameState } from '../core/types';
import { makeButton } from './ui';

const OWNER_FILL: Record<FactionId | 'neutral', number> = {
  player: 0x1d4ed8,
  ai: 0xb91c1c,
  neutral: 0x334155,
};

const OWNER_LABEL: Record<FactionId | 'neutral', string> = {
  player: '#bfdbfe',
  ai: '#fecaca',
  neutral: '#94a3b8',
};

interface WorldSceneData {
  first: FactionId;
}

/**
 * The world board with REAL country geometry (203 Natural Earth regions).
 *
 * Viewport model: manual world→screen transform (camX/camY + zoom). The map
 * is panned by dragging and zoomed with the wheel — never by Phaser camera
 * zoom, which desynchronizes scrollFactor(0) HUD hit areas (learned the
 * hard way). Clicks are processed on pointerup so drags don't select.
 */
export class WorldScene extends Phaser.Scene {
  constructor() {
    super({ key: 'World' });
  }

  private state!: GameState;
  private firstPlayer: FactionId = 'player';
  private labels!: Map<string, { name: Phaser.GameObjects.Text; army: Phaser.GameObjects.Text }>;
  private fills!: Phaser.GameObjects.Graphics;
  private highlights!: Phaser.GameObjects.Graphics;
  private baseS = 0.5;
  private zoom = 1;
  private camX = WORLD_WIDTH / 2;
  private camY = WORLD_HEIGHT / 2;
  private view = { w: 1280, h: 800 };

  private selected: string | null = null;
  private flash: { from: string; to: string; win: boolean } | null = null;
  private busy = false;
  private dragging = false;
  private dragMoved = false;
  private dragLast = { x: 0, y: 0 };

  private hud!: Phaser.GameObjects.Text;
  private log!: Phaser.GameObjects.Text;
  private mainBtn!: Phaser.GameObjects.Text;
  private overlay = false;

  init(data: WorldSceneData): void {
    this.firstPlayer = data.first ?? 'player';
  }

  create(): void {
    this.state = createGame(this.firstPlayer);
    this.selected = null;
    this.flash = null;
    this.busy = false;
    this.dragging = false;
    this.overlay = false;

    // Open the view near the player's first homeland, moderately zoomed.
    const home = regionById.get(this.firstPlayer === 'player' ? '840' : '643');
    this.camX = home ? home.center[0] : WORLD_WIDTH / 2;
    this.camY = home ? home.center[1] : WORLD_HEIGHT / 2;
    this.zoom = 1.6;

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
        backgroundColor: '#0a1122cc',
        padding: { x: 10, y: 8 },
      })
      .setDepth(12);

    this.log = this.add
      .text(0, 0, 'Arrastrá para moverte, rueda para hacer zoom.', {
        fontFamily: 'Inter, sans-serif',
        fontSize: '13px',
        color: '#9fb3d9',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(12);

    this.mainBtn = makeButton(this, 0, 0, 'Terminar turno', () => this.onMainButton());

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.handleResize();

    this.input.on('pointerdown', this.onDragStart, this);
    this.input.on('pointermove', this.onDragMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('wheel', this.onWheel, this);

    this.redraw();
    this.updateHud();

    if (this.state.current === 'ai') {
      this.setLog('Empieza la computadora…');
      this.runAiTurn();
    } else {
      this.setLog('Tu turno: elegí una región y atacá. Refuerzos: automáticos por turno.');
    }
  }

  shutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
  }

  // ── viewport ─────────────────────────────────────────────────────

  /** Scale factor: base (world→screen at zoom 1) × user zoom. */
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
    this.log.setPosition(width / 2, height - 24);
    this.mainBtn.setPosition(width - 110, height - 24);
    if (this.fills) this.redraw();
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    if (this.busy || this.overlay) return;
    const before = this.screenToWorld(pointer.x, pointer.y);
    this.zoom = Phaser.Math.Clamp(this.zoom * (dy < 0 ? 1.2 : 1 / 1.2), 1, 9);
    // Keep the world point under the cursor anchored.
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

  private onDragMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragging || this.busy || this.overlay) return;
    const dx = pointer.x - this.dragLast.x;
    const dy = pointer.y - this.dragLast.y;
    if (!this.dragMoved && Math.hypot(pointer.x - this.dragLast.x, pointer.y - this.dragLast.y) < 6) return;
    this.dragMoved = true;
    this.camX -= dx / this.s;
    this.camY -= dy / this.s;
    this.dragLast = { x: pointer.x, y: pointer.y };
    this.clampCam();
    this.redraw();
  }

  // ── rendering ────────────────────────────────────────────────────

  private regionColor(id: string): FactionId | 'neutral' {
    return this.state.regions[id].owner ?? 'neutral';
  }

  private transformedRings(id: string): Phaser.Geom.Point[][] {
    const r = regionById.get(id)!;
    return r.rings.map((ring) => ring.map(([x, y]) => {
      const p = this.worldToScreen(x, y);
      return new Phaser.Geom.Point(p.x, p.y);
    }));
  }

  private redraw(): void {
    const { fills, highlights, state } = this;
    fills.clear();
    highlights.clear();

    for (const r of REGIONS) {
      const pts = this.transformedRings(r.id);
      fills.fillStyle(OWNER_FILL[this.regionColor(r.id)], 0.8);
      fills.lineStyle(1, 0x0a1122, 0.9);
      for (const ring of pts) {
        fills.fillPoints(ring, true);
        fills.strokePoints(ring, true);
      }
    }

    // Labels: name only when the region is big on screen (anti-clutter).
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

    // Selection + valid targets.
    if (this.selected) {
      const stroke = (id: string, color: number, width: number) => {
        highlights.lineStyle(width, color, 0.95);
        for (const ring of this.transformedRings(id)) highlights.strokePoints(ring, true);
      };
      stroke(this.selected, 0xfbbf24, 3);
      for (const n of ADJACENCY[this.selected] ?? []) {
        if (canAttack(state, this.selected, n)) stroke(n, 0x22d3ee, 2.5);
        else if (canMove(state, this.selected, n)) stroke(n, 0x34d399, 2);
      }
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
        : s.campaign === 'done'
          ? `Tu turno ${s.turn} — ofensiva terminada (mové o pasá)`
          : typeof s.campaign === 'string'
            ? `Tu turno ${s.turn} — campaña activa: seguí desde ${nameOf(s.campaign)}`
            : `Tu turno ${s.turn} — una ofensiva por turno`;
    this.hud.setText([
      phaseLabel,
      `Tú: ${p.length}/${total} regiones · IA: ${a.length}   |   Ingreso — Tú: ${incomeFor(s, 'player')} · IA: ${incomeFor(s, 'ai')}`,
    ]);
    this.mainBtn.setVisible(s.current === 'player' && !this.busy);
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
      this.redraw();
      return;
    }

    const s = this.state;
    const rs = s.regions[id];

    if (this.selected && this.selected !== id) {
      if (canAttack(s, this.selected, id)) {
        const from = this.selected;
        const p = previewAttack(s, from, id);
        const result = performAttack(s, from, id);
        this.flash = { from, to: id, win: result.willCapture };
        this.setLog(
          result.willCapture
            ? `¡${nameOf(id)} es tuyo! Enviaste ${p.send}, bajas ${p.cost}, quedan ${result.survivors}.`
            : `${nameOf(id)} resiste: perdiste ${p.send}. La ofensiva terminó.`,
        );
        this.selected = result.willCapture ? id : null;
        this.afterAction();
        return;
      }
      if (canMove(s, this.selected, id)) {
        const moved = moveArmies(s, this.selected, id, s.regions[this.selected].armies - 1);
        this.setLog(`Movés ${moved} desde ${nameOf(this.selected)} a ${nameOf(id)}.`);
        this.selected = null;
        this.afterAction();
        return;
      }
    }

    if (rs.owner === 'player') {
      this.selected = this.selected === id ? null : id;
      if (this.selected) {
        this.setLog(
          typeof s.campaign === 'string'
            ? `La campaña de este turno sigue desde ${nameOf(s.campaign)} — tocá un vecino celeste.`
            : `${nameOf(id)}: tocá un vecino celeste para atacar, verde para mover.`,
        );
      }
      this.redraw();
    } else {
      this.selected = null;
      this.redraw();
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
    endTurn(s); // now current === 'ai', its income auto-deploys
    this.redraw();
    this.updateHud();
    this.runAiTurn();
  }

  // ── AI turn animation ────────────────────────────────────────────

  private runAiTurn(): void {
    this.busy = true;
    this.updateHud();
    // Plan on a clone; replay the same deterministic actions on the live state.
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
      this.setLog(`IA: ${nameOf(a.from)} ataca ${nameOf(a.to)} — ${r.willCapture ? 'la conquista' : 'fracasa'}.`);
    } else {
      moveArmies(s, a.from, a.to, a.amount);
      this.flash = { from: a.from, to: a.to, win: true };
      this.setLog(`IA mueve ${a.amount} ejércitos hacia el frente (${nameOf(a.to)}).`);
    }
    if (this.flash) this.time.delayedCall(400, () => { this.flash = null; this.redraw(); });
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
    endTurn(s); // back to player, income auto-deploys
    this.redraw();
    this.updateHud();
    this.setLog('Tu turno: los refuerzos ya están en el frente. Atacá.');
  }

  // ── game over ────────────────────────────────────────────────────

  private showGameOver(): void {
    this.overlay = true;
    this.busy = true;
    const playerWon = this.state.winner === 'player';
    const { width, height } = this.scale;

    this.add
      .rectangle(0, 0, width, height, 0x0a1122, 0.86)
      .setOrigin(0)
      .setDepth(30);

    this.add
      .text(width / 2, height / 2 - 60, playerWon ? '¡DOMINAS EL MUNDO!' : 'FIN DEL IMPERIO', {
        fontFamily: 'Sora, sans-serif',
        fontSize: '34px',
        fontStyle: 'bold',
        color: playerWon ? '#fbbf24' : '#ef4444',
      })
      .setOrigin(0.5)
      .setDepth(31);

    this.add
      .text(width / 2, height / 2 - 10, playerWon ? `Conquistaste las ${REGIONS.length} regiones en ${this.state.turn} turnos.` : 'La IA conquistó el mundo. ¿Otra vez?', {
        fontFamily: 'Inter, sans-serif',
        fontSize: '15px',
        color: '#9fb3d9',
      })
      .setOrigin(0.5)
      .setDepth(31);

    makeButton(this, width / 2 - 110, height / 2 + 60, 'Volver a jugar', () =>
      this.scene.start('World', { first: this.firstPlayer }),
    );
    makeButton(this, width / 2 + 110, height / 2 + 60, 'Menú', () => this.scene.start('Menu'), { bg: '#1f2937' });
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
