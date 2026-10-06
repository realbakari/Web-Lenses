// Procedural Web Audio, fully offline. One-shot effects schedule from this.ctx.currentTime, so
// tools/record-preview.mjs can replay them into an OfflineAudioContext for the preview video.

const semitone = (base, n) => base * 2 ** (n / 12);
const RING_SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

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
      p.pan.value = pan;
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

  burst(type, freq, q, peak, decay, at, sweepTo = null, attack = 0.003) {
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

  laser(side) {
    this.play((t) => {
      this.tone('square', 1500, 0.05, 0.09, t, 260, 0.002, side * 0.5);
      this.tone('sine', 900, 0.06, 0.07, t, 200, 0.002, side * 0.5);
    });
  }

  explosion(big = false) {
    this.play((t) => {
      this.burst('lowpass', big ? 1400 : 2200, 0.7, big ? 0.6 : 0.4, big ? 0.9 : 0.5, t, 120);
      this.tone('sine', big ? 90 : 140, big ? 0.5 : 0.3, big ? 0.6 : 0.3, t, 35);
    });
  }

  ring(chain) {
    this.play((t) => {
      const f = semitone(523.25, RING_SCALE[Math.min(chain - 1, RING_SCALE.length - 1)]);
      this.tone('sine', f, 0.22, 0.5, t);
      this.tone('triangle', f * 1.5, 0.08, 0.35, t + 0.04);
      this.burst('highpass', 5000, 0.5, 0.05, 0.25, t, 12000);
    });
  }

  shieldHit() {
    this.play((t) => {
      this.burst('bandpass', 900, 0.9, 0.5, 0.35, t, 300);
      this.tone('sawtooth', 220, 0.18, 0.3, t, 70);
    });
  }

  pickup() {
    this.play((t) => [0, 4, 7, 12].forEach((n, i) => this.tone('sine', semitone(659.25, n), 0.12, 0.2, t + i * 0.05)));
  }

  warp() {
    this.play((t) => {
      this.burst('bandpass', 300, 1.2, 0.3, 1.6, t, 6000, 0.6);
      this.tone('sawtooth', 80, 0.12, 1.4, t, 640, 0.5);
      this.tone('sine', 1200, 0.1, 0.9, t + 1.5, 300); // arrival
    });
  }

  gameOver() {
    this.play((t) => [7, 3, 0, -5].forEach((n, i) => this.tone('triangle', semitone(392, n), 0.16, 0.45, t + 0.3 + i * 0.17)));
  }

  launch() {
    this.play((t) => {
      this.burst('lowpass', 400, 0.8, 0.35, 0.9, t, 3000, 0.25);
      this.tone('sine', 220, 0.15, 0.4, t + 0.1, 440);
    });
  }

  // Continuous engine hum. Ignored by the preview recorder (its pitch changes every frame), so the
  // video's engine bed comes from engineBed() instead.
  engine(on, thrust = 0) {
    if (!this.ready) return;
    try {
      if (on && !this.engineNodes) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 55;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 300;
        const gain = this.ctx.createGain();
        gain.gain.value = 0.0001;
        gain.gain.exponentialRampToValueAtTime(0.08, this.ctx.currentTime + 0.4);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.out());
        osc.start();
        this.engineNodes = { osc, filter, gain };
      }
      if (!on && this.engineNodes) {
        const { osc, gain } = this.engineNodes;
        gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.15);
        osc.stop(this.ctx.currentTime + 0.8);
        this.engineNodes = null;
      }
      if (on && this.engineNodes) {
        const t = this.ctx.currentTime;
        this.engineNodes.osc.frequency.setTargetAtTime(50 + thrust * 40, t, 0.1);
        this.engineNodes.filter.frequency.setTargetAtTime(260 + thrust * 500, t, 0.1);
      }
    } catch {}
  }

  // A steady engine drone for the length of the preview video
  engineBed(seconds) {
    this.play((t) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 72;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 480;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.07;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.out());
      osc.start(t);
      osc.stop(t + seconds);
    });
  }
}

export const sfx = new SoundFX();
