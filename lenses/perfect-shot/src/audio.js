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
      this.bus.ratio.value = 5;
      const master = this.ctx.createGain();
      master.gain.value = 0.55;
      this.bus.connect(master);
      master.connect(this.ctx.destination);
    }
    return this.bus;
  }

  noiseBuffer() {
    if (!this.noise || this.noise.sampleRate !== this.ctx.sampleRate) {
      const length = Math.floor(this.ctx.sampleRate * 1.5);
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

  tone(type, freq, peak, decay, at, endFreq = null, attack = 0.004) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + attack + decay);
    osc.connect(this.envelope(peak, attack, decay, at));
    osc.start(at);
    osc.stop(at + attack + decay + 0.05);
  }

  burst(type, freq, q, peak, decay, at, sweepTo = null, attack = 0.002) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + attack + decay);
    filter.Q.value = q;
    src.connect(filter);
    filter.connect(this.envelope(peak, attack, decay, at));
    src.start(at);
    src.stop(at + attack + decay + 0.05);
  }

  play(fn) {
    if (!this.ready) return;
    try {
      fn(this.ctx.currentTime);
    } catch {}
  }

  // Mechanical shutter: a sharp click, the curtain, a second click
  shutter() {
    this.play((t) => {
      this.burst('highpass', 4000, 0.8, 0.5, 0.025, t);
      this.burst('bandpass', 1800, 1.5, 0.25, 0.05, t + 0.012);
      this.burst('highpass', 3000, 0.8, 0.35, 0.03, t + 0.07);
      this.tone('square', 2400, 0.03, 0.02, t);
    });
  }

  // Rating sting: more notes and a higher climb for better shots
  rating(tier) {
    this.play((t) => {
      const notes = [[0], [0, 4], [0, 4, 7], [0, 4, 7, 12, 16]][tier];
      notes.forEach((n, i) => {
        this.tone('triangle', semitone(523.25, n), 0.14, 0.4, t + 0.15 + i * 0.07);
        this.tone('sine', semitone(1046.5, n), 0.04, 0.25, t + 0.15 + i * 0.07);
      });
      if (tier === 3) this.burst('highpass', 6000, 0.5, 0.06, 0.6, t + 0.4, 12000);
    });
  }

  photobomb() {
    this.play((t) => [0, 7, 12].forEach((n, i) => this.tone('square', semitone(659.25, n), 0.05, 0.12, t + 0.5 + i * 0.06)));
  }

  missed() {
    this.play((t) => this.tone('triangle', 330, 0.12, 0.35, t, 220));
  }

  splash(power = 1) {
    this.play((t) => {
      this.burst('lowpass', 1600, 0.6, 0.35 * power, 0.6, t, 300, 0.02);
      this.burst('bandpass', 3500, 1, 0.12 * power, 0.4, t + 0.05, 1500);
    });
  }

  boom() {
    this.play((t) => {
      this.tone('sine', 120, 0.55, 0.7, t, 40);
      this.burst('lowpass', 900, 0.7, 0.45, 0.9, t, 120);
      for (let i = 0; i < 6; i++) this.burst('highpass', 5000, 0.8, 0.06, 0.08, t + 0.25 + i * 0.09 + Math.random() * 0.05);
    });
  }

  whoosh() {
    this.play((t) => this.burst('bandpass', 600, 1.2, 0.15, 0.35, t, 2400, 0.08));
  }

  cue() {
    this.play((t) => {
      this.tone('sine', 880, 0.07, 0.08, t);
      this.tone('sine', 1320, 0.07, 0.12, t + 0.09);
    });
  }

  rollDone() {
    this.play((t) => [0, 4, 7, 11, 12].forEach((n, i) => this.tone('triangle', semitone(392, n), 0.13, 0.5, t + i * 0.09)));
  }
}

export const sfx = new SoundFX();
