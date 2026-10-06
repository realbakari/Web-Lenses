// Procedural Web Audio, fully offline. One-shot effects schedule from this.ctx.currentTime, so
// tools/record-preview.mjs can replay them into an OfflineAudioContext for the preview video.

class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.noise = null;
    this.bus = null;
    this.engineNodes = null;
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
      this.bus.ratio.value = 6;
      this.bus.attack.value = 0.002;
      const master = this.ctx.createGain();
      master.gain.value = 0.5;
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

  envelope(peak, attack, decay, at, pan = 0) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(p);
      p.connect(this.out());
    } else {
      gain.connect(this.out());
    }
    return gain;
  }

  tone(type, freq, peak, decay, at, endFreq = null, attack = 0.004, pan = 0) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + attack + decay);
    osc.connect(this.envelope(peak, attack, decay, at, pan));
    osc.start(at);
    osc.stop(at + attack + decay + 0.05);
  }

  burst(type, freq, q, peak, decay, at, sweepTo = null, attack = 0.003, pan = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + attack + decay);
    filter.Q.value = q;
    src.connect(filter);
    filter.connect(this.envelope(peak, attack, decay, at, pan));
    src.start(at);
    src.stop(at + attack + decay + 0.05);
  }

  play(fn) {
    if (!this.ready) return;
    try {
      fn(this.ctx.currentTime);
    } catch {}
  }

  // Doppler-ish whoosh of a car flashing past
  whoosh(pan) {
    this.play((t) => this.burst('bandpass', 1400, 1.4, 0.3, 0.35, t, 380, 0.06, pan));
  }

  // Metal on metal: side slams and scrapes
  slam(power = 1, pan = 0) {
    this.play((t) => {
      this.burst('bandpass', 2600, 2.5, 0.25 * power, 0.18, t, 900, 0.002, pan);
      this.tone('square', 180, 0.12 * power, 0.12, t, 90, 0.002, pan);
      this.tone('triangle', 1250, 0.05 * power, 0.25, t, 1100, 0.002, pan);
    });
  }

  scrape(pan = 0) {
    this.play((t) => this.burst('highpass', 3500, 1.2, 0.16, 0.22, t, 2000, 0.01, pan));
  }

  takedown() {
    this.play((t) => {
      this.burst('lowpass', 1800, 0.6, 0.7, 1.1, t, 90);
      this.tone('sine', 95, 0.6, 0.7, t, 32);
      this.burst('bandpass', 3200, 3, 0.22, 0.6, t + 0.05, 1400);
      // Victory sting
      [0, 7, 12].forEach((n, i) => this.tone('sawtooth', 220 * 2 ** (n / 12), 0.06, 0.35, t + 0.18 + i * 0.07));
    });
  }

  wreck() {
    this.play((t) => {
      this.burst('lowpass', 1200, 0.6, 0.8, 1.4, t, 60);
      this.tone('sine', 70, 0.7, 0.9, t, 28);
      this.burst('bandpass', 2400, 2.5, 0.25, 0.8, t + 0.12, 700);
    });
  }

  boostStart() {
    this.play((t) => {
      this.burst('bandpass', 500, 1.1, 0.3, 0.6, t, 4200, 0.12);
      this.tone('sawtooth', 110, 0.08, 0.5, t, 330, 0.1);
    });
  }

  nearMiss(pan) {
    this.play((t) => {
      this.burst('bandpass', 2200, 2, 0.3, 0.25, t, 600, 0.02, pan);
      this.tone('sine', 1320, 0.05, 0.12, t + 0.04);
    });
  }

  countdown(final) {
    this.play((t) => this.tone('square', final ? 880 : 440, 0.1, final ? 0.5 : 0.18, t));
  }

  totaled() {
    this.play((t) => [7, 3, 0, -5].forEach((n, i) => this.tone('triangle', 392 * 2 ** (n / 12), 0.15, 0.45, t + 0.4 + i * 0.17)));
  }

  // Continuous engine. Ignored by the preview recorder (it changes every frame), which uses engineBed().
  engine(on, rpm = 0, boosting = false) {
    if (!this.ready) return;
    try {
      if (on && !this.engineNodes) {
        const a = this.ctx.createOscillator();
        const b = this.ctx.createOscillator();
        a.type = 'sawtooth';
        b.type = 'square';
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 3;
        const gain = this.ctx.createGain();
        gain.gain.value = 0.0001;
        gain.gain.exponentialRampToValueAtTime(0.07, this.ctx.currentTime + 0.4);
        a.connect(filter);
        b.connect(filter);
        filter.connect(gain);
        gain.connect(this.out());
        a.start();
        b.start();
        this.engineNodes = { a, b, filter, gain };
      }
      if (!on && this.engineNodes) {
        const { a, b, gain } = this.engineNodes;
        gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.12);
        a.stop(this.ctx.currentTime + 0.6);
        b.stop(this.ctx.currentTime + 0.6);
        this.engineNodes = null;
      }
      if (on && this.engineNodes) {
        const t = this.ctx.currentTime;
        const f = 48 + rpm * 70;
        this.engineNodes.a.frequency.setTargetAtTime(f, t, 0.08);
        this.engineNodes.b.frequency.setTargetAtTime(f * 0.5, t, 0.08);
        this.engineNodes.filter.frequency.setTargetAtTime(boosting ? 1600 : 500 + rpm * 500, t, 0.1);
      }
    } catch {}
  }

  engineBed(seconds) {
    this.play((t) => {
      const a = this.ctx.createOscillator();
      const b = this.ctx.createOscillator();
      a.type = 'sawtooth';
      b.type = 'square';
      a.frequency.value = 96;
      b.frequency.value = 48;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      filter.Q.value = 3;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.06;
      a.connect(filter);
      b.connect(filter);
      filter.connect(gain);
      gain.connect(this.out());
      a.start(t);
      b.start(t);
      a.stop(t + seconds);
      b.stop(t + seconds);
    });
  }
}

export const sfx = new SoundFX();
