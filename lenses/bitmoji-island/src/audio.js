// Procedural Web Audio, fully offline. One-shot effects schedule from this.ctx.currentTime, so
// tools/record-preview.mjs can replay them into an OfflineAudioContext for the preview video.

const semitone = (base, n) => base * 2 ** (n / 12);

class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.noise = null;
    this.bus = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() {
    return this.ctx && !this.muted;
  }

  out() {
    if (!this.bus || this.bus.context !== this.ctx) {
      this.bus = this.ctx.createDynamicsCompressor();
      this.bus.threshold.value = -18;
      this.bus.ratio.value = 4;
      const master = this.ctx.createGain();
      master.gain.value = 0.85; // cozy sounds are soft; keep them audible
      this.bus.connect(master);
      master.connect(this.ctx.destination);
    }
    return this.bus;
  }

  noiseBuffer() {
    if (!this.noise || this.noise.sampleRate !== this.ctx.sampleRate) {
      const length = Math.floor(this.ctx.sampleRate * 1);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  envelope(peak, attack, decay, at) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    gain.connect(this.out());
    return gain;
  }

  tone(type, freq, peak, decay, at, endFreq = null, attack = 0.005) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + attack + decay);
    osc.connect(this.envelope(peak, attack, decay, at));
    osc.start(at);
    osc.stop(at + attack + decay + 0.05);
  }

  burst(type, freq, q, peak, decay, at, sweepTo = null) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + decay);
    filter.Q.value = q;
    src.connect(filter);
    filter.connect(this.envelope(peak, 0.004, decay, at));
    src.start(at);
    src.stop(at + decay + 0.05);
  }

  play(fn) {
    if (!this.ready) return;
    try {
      fn(this.ctx.currentTime);
    } catch {}
  }

  plant() {
    this.play((t) => {
      this.tone('sine', 180, 0.3, 0.12, t, 90);
      this.burst('lowpass', 900, 0.7, 0.12, 0.08, t);
    });
  }

  water() {
    this.play((t) => {
      for (let i = 0; i < 3; i++) this.tone('sine', 520 + i * 140, 0.08, 0.09, t + i * 0.05, 900 + i * 160);
      this.burst('bandpass', 2400, 1.5, 0.06, 0.25, t, 900);
    });
  }

  harvest(step = 0) {
    this.play((t) => {
      this.tone('triangle', semitone(440, step), 0.2, 0.12, t, semitone(880, step));
      [0, 4, 7].forEach((n, i) => this.tone('sine', semitone(1318.5, n + step), 0.06, 0.18, t + 0.06 + i * 0.045));
    });
  }

  buy() {
    this.play((t) => {
      this.tone('triangle', 784, 0.12, 0.1, t);
      this.tone('triangle', 1175, 0.12, 0.25, t + 0.08);
    });
  }

  nope() {
    this.play((t) => this.tone('sine', 220, 0.1, 0.12, t, 180));
  }

  levelUp() {
    this.play((t) => [0, 4, 7, 12, 7, 12, 16].forEach((n, i) => this.tone('triangle', semitone(523.25, n), 0.12, 0.3, t + i * 0.08)));
  }

  order() {
    this.play((t) => [0, 7, 12, 16].forEach((n, i) => this.tone('sine', semitone(659.25, n), 0.1, 0.35, t + i * 0.07)));
  }

  gift() {
    this.play((t) => {
      for (let i = 0; i < 8; i++) this.tone('sine', 1200 + Math.random() * 1600, 0.05, 0.25, t + i * 0.05);
    });
  }

  chirp() {
    this.play((t) => {
      const f = 2400 + Math.random() * 1400;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone('sine', f, 0.025, 0.06, t + i * 0.11, f * 1.35);
    });
  }
}

export const sfx = new SoundFX();
