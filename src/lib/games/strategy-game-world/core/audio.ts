/**
 * Tiny procedural sound engine (WebAudio). No audio assets to download:
 * every SFX is synthesized with oscillators + filtered noise bursts.
 * Call sfx.unlock() from the first user gesture (autoplay policies).
 */

type Osc = 'sine' | 'square' | 'sawtooth' | 'triangle';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.22;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Resume/create the context inside a user gesture handler. */
  unlock(): void {
    this.ensure();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.22;
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private tone(freq: number, dur: number, type: Osc = 'sine', vol = 1, when = 0, slideTo?: number): void {
    const c = this.ensure();
    if (!c || !this.master) return;
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.001), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol = 0.5, when = 0, cutoff = 1200): void {
    const c = this.ensure();
    if (!c || !this.master) return;
    if (!this.noiseBuf) {
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t0);
    f.frequency.exponentialRampToValueAtTime(120, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // ── the sound effects ────────────────────────────────────────────
  click(): void {
    this.tone(640, 0.06, 'triangle', 0.35);
  }
  select(): void {
    this.tone(420, 0.09, 'sine', 0.45, 0, 560);
  }
  attack(): void {
    this.noise(0.16, 0.45);
    this.tone(180, 0.22, 'sawtooth', 0.35, 0, 60);
  }
  capture(): void {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 'square', 0.25, i * 0.09));
  }
  repel(): void {
    this.tone(240, 0.28, 'sawtooth', 0.3, 0, 90);
    this.noise(0.12, 0.25, 0, 500);
  }
  move(): void {
    this.tone(330, 0.08, 'sine', 0.3, 0, 410);
  }
  turn(): void {
    this.tone(392, 0.12, 'sine', 0.3);
    this.tone(523, 0.16, 'sine', 0.3, 0.1);
  }
  aiTick(): void {
    this.tone(280, 0.05, 'triangle', 0.15);
  }
  victory(): void {
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.2, 'square', 0.22, i * 0.13));
  }
  defeat(): void {
    [392, 311, 262, 196].forEach((f, i) => this.tone(f, 0.34, 'sawtooth', 0.22, i * 0.2));
  }
}

export const sfx = new Sfx();
