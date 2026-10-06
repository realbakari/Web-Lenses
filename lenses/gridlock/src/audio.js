// Procedural Web Audio sound effects, fully offline.
// Every voice schedules from this.ctx.currentTime, so tools/record-preview.mjs can replay the same
// methods against an OfflineAudioContext to build the preview video's audio track.

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

  // A gentle compressor keeps stacked chords from clipping
  out() {
    if (!this.bus || this.bus.context !== this.ctx) {
      this.bus = this.ctx.createDynamicsCompressor();
      this.bus.threshold.value = -18;
      this.bus.ratio.value = 6;
      this.bus.attack.value = 0.002;
      // Headroom after the compressor: big combos stack several chords and must not clip
      const master = this.ctx.createGain();
      master.gain.value = 0.55;
      this.bus.connect(master);
      master.connect(this.ctx.destination);
    }
    return this.bus;
  }

  noiseBuffer() {
    if (!this.noise || this.noise.sampleRate !== this.ctx.sampleRate) {
      const length = Math.floor(this.ctx.sampleRate * 0.5);
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
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + decay);
    osc.connect(this.envelope(peak, attack, decay, at));
    osc.start(at);
    osc.stop(at + attack + decay + 0.05);
  }

  burst(filterType, freq, q, peak, decay, at, sweepTo = null) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
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

  pickup() {
    this.play((t) => this.tone('sine', 660, 0.12, 0.06, t, 880));
  }

  // Soft, woody click of a piece settling into the grid
  place(cells) {
    this.play((t) => {
      this.tone('sine', 300 - Math.min(cells, 9) * 12, 0.42, 0.12, t, 120);
      this.burst('bandpass', 2400, 1.5, 0.12, 0.04, t);
    });
  }

  invalid() {
    this.play((t) => this.tone('triangle', 150, 0.22, 0.14, t, 110));
  }

  // Major chord, a step higher for each link in the combo streak; more lines add a shimmer sweep
  clear(lines, streak) {
    this.play((t) => {
      const root = semitone(392, Math.min(streak - 1, 9) * 2); // G4 upward in whole tones
      [0, 4, 7, 12].forEach((n, i) => {
        this.tone('triangle', semitone(root, n), 0.16, 0.55, t + i * 0.035);
        this.tone('sine', semitone(root, n) * 2, 0.05, 0.3, t + i * 0.035);
      });
      this.burst('highpass', 1800, 0.7, 0.12 + lines * 0.04, 0.25 + lines * 0.08, t, 9000);
      if (lines >= 2) this.tone('sine', 110, 0.35, 0.35, t, 55); // weight under big clears
    });
  }

  allClear() {
    this.play((t) => {
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone('triangle', semitone(523.25, n), 0.14, 0.45, t + i * 0.06));
    });
  }

  deal() {
    this.play((t) => [0, 1, 2].forEach((i) => this.tone('sine', 900 + i * 180, 0.05, 0.05, t + i * 0.05)));
  }

  gameOver() {
    this.play((t) => {
      [7, 3, 0, -5].forEach((n, i) => this.tone('triangle', semitone(392, n), 0.18, 0.4, t + i * 0.16));
    });
  }

  start() {
    this.play((t) => {
      this.tone('sine', 523.25, 0.16, 0.15, t);
      this.tone('sine', 783.99, 0.16, 0.3, t + 0.08);
    });
  }
}

export const sfx = new SoundFX();
