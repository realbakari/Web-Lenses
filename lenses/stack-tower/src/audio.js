// Procedural Web Audio sound effects, fully offline.
// Every voice schedules from this.ctx.currentTime, so tools/record-preview.mjs can replay the same
// methods against an OfflineAudioContext to build the preview video's audio track.

// Major pentatonic, two octaves up from C5: consecutive perfect drops climb this like a melody
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];

class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.noise = null;
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

  noiseBuffer() {
    if (!this.noise || this.noise.sampleRate !== this.ctx.sampleRate) {
      const length = Math.floor(this.ctx.sampleRate * 0.4);
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
    gain.connect(this.ctx.destination);
    return gain;
  }

  tone(type, freq, peak, decay, at = this.ctx.currentTime, endFreq = null) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + decay);
    osc.connect(this.envelope(peak, 0.004, decay, at));
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }

  burst(filterType, freq, q, peak, decay, at = this.ctx.currentTime) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    src.connect(filter);
    filter.connect(this.envelope(peak, 0.003, decay, at));
    src.start(at);
    src.stop(at + decay + 0.05);
  }

  // Wooden "tock" of a block landing
  place() {
    if (!this.ready) return;
    try {
      this.tone('sine', 210, 0.5, 0.11, undefined, 95);
      this.burst('bandpass', 1800, 1.2, 0.18, 0.05);
    } catch {}
  }

  // The overhang being sheared off
  slice() {
    if (!this.ready) return;
    try {
      this.burst('highpass', 3200, 0.7, 0.16, 0.13);
    } catch {}
  }

  // Bell that climbs the scale with each consecutive perfect drop
  perfect(combo) {
    if (!this.ready) return;
    try {
      const freq = PENTATONIC[Math.min(combo - 1, PENTATONIC.length - 1)];
      const now = this.ctx.currentTime;
      this.tone('sine', freq, 0.32, 0.7, now);
      this.tone('triangle', freq * 2, 0.08, 0.35, now);
      this.tone('sine', freq * 3.01, 0.04, 0.2, now);
    } catch {}
  }

  // Sparkle when a streak grows the block back
  grow() {
    if (!this.ready) return;
    try {
      const now = this.ctx.currentTime;
      [1568, 2093, 2637].forEach((f, i) => this.tone('sine', f, 0.12, 0.25, now + 0.07 + i * 0.05));
    } catch {}
  }

  miss() {
    if (!this.ready) return;
    try {
      this.tone('triangle', 260, 0.35, 0.55, undefined, 70);
      this.burst('lowpass', 500, 0.8, 0.3, 0.3);
    } catch {}
  }

  start() {
    if (!this.ready) return;
    try {
      const now = this.ctx.currentTime;
      this.tone('sine', 523.25, 0.2, 0.18, now);
      this.tone('sine', 783.99, 0.2, 0.3, now + 0.08);
    } catch {}
  }
}

export const sfx = new SoundFX();
