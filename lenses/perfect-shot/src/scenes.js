import {
  ADDRESS_CLAMP_TO_EDGE,
  BLEND_ADDITIVE,
  CULLFACE_FRONT,
  Color,
  Entity,
  MeshInstance,
  StandardMaterial,
  Texture,
  Vec3,
} from 'playcanvas';
import { MeshBuilder } from './builder.js';

// --- Shared materials -------------------------------------------------------------------------
let mats = null;
function materials() {
  if (mats) return mats;
  const lit = new StandardMaterial();
  lit.diffuse = new Color(1, 1, 1);
  lit.diffuseVertexColor = true;
  lit.gloss = 0.45;
  lit.update();
  const glow = new StandardMaterial();
  glow.useLighting = false;
  glow.useFog = false;
  glow.diffuse = new Color(0, 0, 0);
  glow.emissive = new Color(1, 1, 1);
  glow.emissiveVertexColor = true;
  glow.emissiveIntensity = 3;
  glow.blendType = BLEND_ADDITIVE;
  glow.depthWrite = false;
  glow.update();
  mats = { lit, glow };
  return mats;
}

function meshEntity(parent, name, mesh, material) {
  const e = new Entity(name);
  e.addComponent('render', { meshInstances: [new MeshInstance(mesh, material)] });
  parent.addChild(e);
  return e;
}

/** Build a vertex-coloured mesh with a callback and attach it under parent. */
function make(ctx, parent, name, fn, { glow = false } = {}) {
  const b = new MeshBuilder();
  fn(b);
  return meshEntity(parent, name, b.build(ctx.device), glow ? materials().glow : materials().lit);
}

// --- Sky --------------------------------------------------------------------------------------
function skyTexture(device, stops) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const t = new Texture(device, { width: 16, height: 256, addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE });
  t.setSource(c);
  return t;
}

function addSky(ctx, stops) {
  const m = new StandardMaterial();
  m.useLighting = false;
  m.useFog = false;
  m.diffuse = new Color(0, 0, 0);
  m.emissive = new Color(1, 1, 1);
  m.emissiveMap = skyTexture(ctx.device, stops);
  m.cull = CULLFACE_FRONT;
  m.depthWrite = false;
  m.update();
  const sky = new Entity('sky');
  sky.addComponent('render', { type: 'sphere', material: m });
  sky.setLocalScale(400, 400, 400);
  ctx.root.addChild(sky);
}

// --- Particle bursts (one mesh; the burst grows by scaling the entity) -------------------------
function burstMesh(ctx, count, colors, { flat = false } = {}) {
  const b = new MeshBuilder();
  for (let i = 0; i < count; i++) {
    let x;
    let y;
    let z;
    do {
      x = ctx.rng() * 2 - 1;
      y = flat ? ctx.rng() * 0.9 + 0.1 : ctx.rng() * 2 - 1;
      z = ctx.rng() * 2 - 1;
    } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.3);
    const l = flat ? 1 : Math.hypot(x, y, z);
    const r = 0.75 + ctx.rng() * 0.25;
    const p = [(x / l) * r, (y / l) * r, (z / l) * r];
    const s = 0.035 + ctx.rng() * 0.03;
    b.box(p, [s, s, s], colors[i % colors.length]);
  }
  return b.build(ctx.device);
}

// --- Characters ------------------------------------------------------------------------------
/** Blocky person, facing +z, feet at y = 0. pose: 'stand' | 'crouch' | 'toss'. */
function person(b, c, { shirt, pants, skin = '#e8b48c', hair = '#3b2a1f', hat = null, pose = 'stand', o = [0, 0, 0] }) {
  const at = (x, y, z) => [x + o[0], y + o[1], z + o[2]];
  const crouch = pose === 'crouch';
  const legH = crouch ? 0.32 : 0.42;
  for (const s of [-1, 1]) b.box(at(s * 0.12, legH, crouch ? 0.06 : 0), [0.1, legH, 0.11], pants, 0.03);
  const hip = legH * 2;
  b.box(at(0, hip + 0.3, 0), [0.25, 0.3, 0.15], shirt, 0.05);
  const armUp = pose === 'toss';
  for (const s of [-1, 1]) {
    if (armUp) b.box(at(s * 0.32, hip + 0.75, 0.05), [0.07, 0.3, 0.07], shirt, 0.02);
    else b.box(at(s * (crouch ? 0.45 : 0.33), hip + 0.38, 0), [crouch ? 0.22 : 0.07, crouch ? 0.06 : 0.27, 0.07], shirt, 0.02);
  }
  b.box(at(0, hip + 0.82, 0.02), [0.17, 0.19, 0.17], skin, 0.05);
  b.box(at(0, hip + 0.98, -0.02), [0.18, 0.06, 0.18], hair, 0.03);
  if (hat === 'cap') b.box(at(0, hip + 1.03, 0.08), [0.19, 0.05, 0.24], '#e5483b', 0.02);
  if (hat === 'chef') {
    b.box(at(0, hip + 1.12, 0), [0.17, 0.16, 0.17], '#ffffff', 0.04);
    b.box(at(0, hip + 1.3, 0), [0.22, 0.08, 0.22], '#ffffff', 0.06);
  }
  // Eyes
  for (const s of [-1, 1]) b.box(at(s * 0.065, hip + 0.85, 0.18), [0.025, 0.03, 0.01], '#1b1b1b');
  return hip;
}

function tree(b, x, z, s = 1) {
  b.box([x, 0.9 * s, z], [0.12 * s, 0.9 * s, 0.12 * s], '#6b4a2f');
  b.box([x, 2.2 * s, z], [0.75 * s, 0.7 * s, 0.75 * s], '#4f9a52', 0.15 * s);
  b.box([x, 2.9 * s, z], [0.5 * s, 0.45 * s, 0.5 * s], '#5fae5c', 0.12 * s);
}

function whaleMesh(ctx) {
  const b = new MeshBuilder();
  b.loft(
    [
      { z: -4.5, w: 0.25, h: 0.25, y: 0 },
      { z: -3.6, w: 0.9, h: 0.8, y: 0.05 },
      { z: -1.5, w: 1.25, h: 1.1, y: 0.1 },
      { z: 1.2, w: 1.0, h: 0.9, y: 0.05 },
      { z: 3.4, w: 0.4, h: 0.38, y: 0 },
      { z: 4.4, w: 0.18, h: 0.18, y: 0 },
    ],
    '#33475e'
  );
  b.loft(
    [
      { z: -4.0, w: 0.5, h: 0.2, y: -0.55 },
      { z: -1.5, w: 0.95, h: 0.35, y: -0.78 },
      { z: 1.4, w: 0.7, h: 0.28, y: -0.62 },
    ],
    '#e9ecef'
  );
  for (const s of [-1, 1]) {
    b.box([s * 1.35, -0.4, -2.2], [0.75, 0.06, 0.32], '#2c3e52', 0.04); // pectoral fins
    b.box([s * 0.95, 0, 4.6], [0.85, 0.06, 0.38], '#2c3e52', 0.05); // tail flukes
    b.box([s * 0.42, 0.25, -3.9], [0.06, 0.08, 0.06], '#111');
  }
  return b.build(ctx.device);
}

function dolphinMesh(ctx) {
  const b = new MeshBuilder();
  b.loft(
    [
      { z: -1.5, w: 0.06, h: 0.06, y: -0.05 },
      { z: -1.2, w: 0.14, h: 0.1, y: -0.04 },
      { z: -0.9, w: 0.3, h: 0.3, y: 0.02 },
      { z: 0.2, w: 0.34, h: 0.34, y: 0 },
      { z: 1.1, w: 0.14, h: 0.14, y: 0 },
      { z: 1.45, w: 0.06, h: 0.06, y: 0 },
    ],
    '#7d93a8'
  );
  b.loft([{ z: -0.9, w: 0.22, h: 0.08, y: -0.24 }, { z: 0.5, w: 0.24, h: 0.08, y: -0.24 }], '#dfe7ee');
  b.box([0, 0.42, 0.0], [0.04, 0.22, 0.2], '#6a8097', 0.02); // dorsal fin
  for (const s of [-1, 1]) {
    b.box([s * 0.36, -0.15, -0.45], [0.22, 0.03, 0.1], '#6a8097', 0.02);
    b.box([s * 0.3, 0, 1.5], [0.3, 0.03, 0.12], '#6a8097', 0.02);
    b.box([s * 0.18, 0.08, -0.95], [0.03, 0.03, 0.03], '#111');
  }
  return b.build(ctx.device);
}

function catMesh(ctx) {
  const b = new MeshBuilder();
  const fur = '#f08a2c';
  b.box([0, 0.38, 0], [0.18, 0.15, 0.42], fur, 0.07); // body (faces +z)
  b.box([0, 0.55, 0.48], [0.17, 0.15, 0.14], fur, 0.06); // head
  for (const s of [-1, 1]) {
    b.box([s * 0.1, 0.74, 0.47], [0.05, 0.07, 0.03], fur, 0.01); // ears
    b.box([s * 0.07, 0.58, 0.62], [0.025, 0.03, 0.01], '#1d2b14'); // eyes
    for (const z of [-0.3, 0.3]) b.box([s * 0.1, 0.13, z], [0.05, 0.13, 0.05], fur, 0.02); // legs
  }
  b.box([0, 0.5, 0.63], [0.03, 0.02, 0.01], '#e86b8a'); // nose
  for (let i = 0; i < 4; i++) b.box([0, 0.45 + i * 0.09, -0.45 - i * 0.08], [0.04, 0.05, 0.06], i % 2 ? '#c9661c' : fur); // tail
  return b.build(ctx.device);
}

// --- Scenes ------------------------------------------------------------------------------------
// Each scene: prompt, caption, duration, peak (seconds), tolerance (seconds), camera, build(ctx) → state,
// update(state, t, ctx), focus(state, out) → subject point, bomb → photobomb spot (in scene space).

const parabola = (s) => 4 * s * (1 - s);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const SCENES = {
  skater: {
    prompt: 'Catch the skater at the top of the air',
    caption: 'Big air',
    light: { key: [1, 0.95, 0.85], ambient: [0.5, 0.55, 0.65], dir: [0.4, -0.8, -0.5] },
    fog: [0.75, 0.86, 0.95],
    build(ctx) {
      const offset = (ctx.rng() - 0.5) * 6;
      const launch = 1.0 + ctx.rng() * 0.7;
      addSky(ctx, [[0, '#4a90d9'], [0.45, '#9fd0f5'], [0.5, '#e9f5ff'], [0.55, '#bfe0c3'], [1, '#bfe0c3']]);
      make(ctx, ctx.root, 'ground', (b) => {
        b.box([0, -0.05, 0], [60, 0.05, 40], '#8fc47e');
        b.box([0, -0.02, 0], [14, 0.04, 6], '#cfc7ba'); // concrete pad
        for (let i = 0; i < 9; i++) tree(b, -26 + i * 6.5 + ctx.rng() * 2, -16 - ctx.rng() * 8, 1 + ctx.rng() * 0.5);
        // Kicker and landing ramp
        const ramp = (x0, x1, h, dir) => {
          const p = (x, y, z) => [x, y, z];
          for (const z of [-1.4, 1.4]) b.polygon([p(x0, 0, z), p(x1, 0, z), p(dir > 0 ? x1 : x0, h, z)], '#9aa3ad', [x0 + (x1 - x0) / 2, h / 3, 0]);
          const hx = dir > 0 ? x1 : x0;
          const lx = dir > 0 ? x0 : x1;
          b.polygon([p(lx, 0, -1.4), p(hx, h, -1.4), p(hx, h, 1.4), p(lx, 0, 1.4)], '#b9c1ca', [lx, -1, 0]);
          b.polygon([p(hx, 0, -1.4), p(hx, h, -1.4), p(hx, h, 1.4), p(hx, 0, 1.4)], '#7d858f', [hx - dir, h / 2, 0]);
        };
        ramp(offset - 6.5, offset - 4, 1.3, 1);
        ramp(offset + 4, offset + 6.5, 1.3, -1);
      });
      const rider = new Entity('rider');
      ctx.root.addChild(rider);
      make(ctx, rider, 'skater', (b) => {
        b.box([0, 0.12, 0], [0.18, 0.03, 0.5], '#2b2d33', 0.02);
        for (const z of [-0.35, 0.35]) for (const s of [-1, 1]) b.wheel([s * 0.13, 0.05, z], 0.05, 0.03, '#f2f2f2', 8);
        person(b, null, { shirt: '#ffcc33', pants: '#2f5d9e', hat: 'cap', pose: 'crouch', o: [0, 0.15, 0] });
      });
      return { rider, offset, launch, flight: 1.25, height: 2.7 };
    },
    peak: (s) => s.launch + s.flight / 2,
    duration: (s) => s.launch + s.flight + 1.2,
    tolerance: 0.14,
    camera: (s) => ({ pos: [0, 2.3, 8.6], look: [0, 2.7, 0], fov: 52 }),
    update(s, t) {
      const x0 = s.offset - 4;
      let x;
      let y;
      let flip = 0;
      if (t < s.launch) {
        x = x0 - (s.launch - t) * 6.4;
        y = x > s.offset - 6.5 ? ((x - (s.offset - 6.5)) / 2.5) * 1.3 : 0;
      } else if (t < s.launch + s.flight) {
        const u = (t - s.launch) / s.flight;
        x = x0 + u * 8;
        y = 1.3 + parabola(u) * s.height;
        flip = u * 360;
      } else {
        const u = (t - s.launch - s.flight) / 0.6;
        x = s.offset + 4 + u * 4;
        y = Math.max(0, 1.3 - u * 1.3);
      }
      s.rider.setLocalPosition(x, y, 0);
      s.rider.setLocalEulerAngles(flip * 0.15, 90, flip > 0 ? Math.sin((flip * Math.PI) / 360) * 25 : 0);
    },
    focus: (s, out) => out.copy(s.rider.getPosition()).add(new Vec3(0, 1.0, 0)),
    bomb: (s) => ({ pos: [s.offset + 7.2, 0, 1.0], appear: s.launch - 0.3 }),
  },

  whale: {
    prompt: 'Snap the whale at the peak of its breach',
    caption: 'Breach!',
    light: { key: [1, 0.92, 0.8], ambient: [0.55, 0.62, 0.72], dir: [-0.3, -0.7, -0.6] },
    fog: [0.82, 0.88, 0.94],
    build(ctx) {
      addSky(ctx, [[0, '#6aa7d8'], [0.42, '#bcdcf2'], [0.5, '#fbe9d7'], [0.505, '#2f7fa8'], [1, '#13466b']]);
      make(ctx, ctx.root, 'sea', (b) => {
        b.box([0, -0.05, -40], [120, 0.05, 80], '#2a76a3');
        b.box([-40, 1.5, -70], [12, 1.5, 6], '#5d8a5a', 2.5); // distant island
        for (let i = 0; i < 40; i++) b.box([(ctx.rng() - 0.5) * 50, 0.01, -ctx.rng() * 60], [0.6 + ctx.rng(), 0.01, 0.05], '#7fc0e3');
      });
      const whale = meshEntity(ctx.root, 'whale', whaleMesh(ctx), materials().lit);
      const splashColors = ['#ffffff', '#d8f0ff', '#bfe6ff'];
      const splashA = meshEntity(ctx.root, 'splash-a', burstMesh(ctx, 140, splashColors, { flat: true }), materials().lit);
      const splashB = meshEntity(ctx.root, 'splash-b', burstMesh(ctx, 140, splashColors, { flat: true }), materials().lit);
      const x = (ctx.rng() - 0.5) * 7;
      return { whale, splashA, splashB, x, emerge: 0.9 + ctx.rng() * 0.6, air: 2.3, sfxDone: {} };
    },
    peak: (s) => s.emerge + s.air / 2,
    duration: (s) => s.emerge + s.air + 1.0,
    tolerance: 0.18,
    camera: () => ({ pos: [0, 2.0, 12.5], look: [0, 3.4, -8], fov: 54 }),
    update(s, t, ctx) {
      const u = (t - s.emerge) / s.air;
      // Hidden below the surface, then a ballistic arc peaking ~5 m up, then back under
      const y = u < 0 ? -8 : u <= 1 ? -2.5 + parabola(u) * 7.5 : -2.5 - (u - 1) * 10;
      const pitch = 70 - clamp01(u) * 95;
      const roll = clamp01(u) * 100;
      s.whale.setLocalPosition(s.x + clamp01(u) * 2.5, y, -8);
      s.whale.setLocalEulerAngles(pitch, 15, roll); // positive pitch lifts the nose (−z)
      const splash = (e, t0) => {
        const k = t - t0;
        if (k < 0 || k > 1.1) return e.setLocalScale(0.001, 0.001, 0.001);
        const r = 0.6 + (1 - Math.exp(-k * 5)) * 3.2;
        const h = r * (1 - k * 0.6) * 1.4;
        e.setLocalScale(r, Math.max(0.001, h), r);
      };
      s.splashA.setLocalPosition(s.x, 0, -8);
      s.splashB.setLocalPosition(s.x + 2.5, 0, -8);
      splash(s.splashA, s.emerge);
      splash(s.splashB, s.emerge + s.air);
      if (t >= s.emerge && !s.sfxDone.a) (s.sfxDone.a = true), ctx.sfx.splash(1);
      if (t >= s.emerge + s.air && !s.sfxDone.b) (s.sfxDone.b = true), ctx.sfx.splash(1.3);
    },
    focus: (s, out) => out.copy(s.whale.getPosition()),
    bomb: (s) => ({ pos: [s.x - 5.5, 0, -4], appear: s.emerge + 0.2, float: true }),
  },

  fireworks: {
    prompt: 'Catch the firework at its fullest burst',
    caption: 'Night bloom',
    light: { key: [0.5, 0.5, 0.7], ambient: [0.25, 0.25, 0.4], dir: [0.2, -0.6, -0.7] },
    fog: [0.05, 0.05, 0.12],
    build(ctx) {
      addSky(ctx, [[0, '#05061a'], [0.4, '#141a45'], [0.5, '#3a2a5e'], [0.52, '#0b0c1a'], [1, '#05050c']]);
      make(ctx, ctx.root, 'skyline', (b) => {
        b.box([0, -0.05, -20], [80, 0.05, 40], '#0d1020');
        for (let i = 0; i < 26; i++) {
          const w = 1.5 + ctx.rng() * 3;
          const h = 3 + ctx.rng() * 12;
          const x = -38 + i * 3.1 + ctx.rng();
          b.box([x, h / 2, -34 - ctx.rng() * 6], [w / 2, h / 2, 1.5], '#141830');
        }
      });
      make(
        ctx,
        ctx.root,
        'windows',
        (b) => {
          for (let i = 0; i < 160; i++) b.box([-38 + ctx.rng() * 78, 1 + ctx.rng() * 12, -32.2], [0.12, 0.16, 0.02], ctx.rng() < 0.8 ? '#ffcf7a' : '#7fd0ff');
        },
        { glow: true }
      );
      const palette = [['#ff4d6d', '#ffd166', '#ffffff'], ['#5ee6ff', '#9b8cff', '#ffffff'], ['#7dff8a', '#ffe066', '#ffffff']][Math.floor(ctx.rng() * 3)];
      const burstE = meshEntity(ctx.root, 'burst', burstMesh(ctx, 220, palette), materials().glow);
      const rocket = make(ctx, ctx.root, 'rocket', (b) => b.box([0, 0, 0], [0.06, 0.4, 0.06], '#ffe1a8'), { glow: true });
      const x = (ctx.rng() - 0.5) * 16;
      return { burst: burstE, rocket, x, launch: 0.5 + ctx.rng() * 0.5, rise: 1.25, height: 15 + ctx.rng() * 4, boomed: false };
    },
    peak: (s) => s.launch + s.rise + 0.42,
    duration: (s) => s.launch + s.rise + 1.8,
    tolerance: 0.16,
    camera: () => ({ pos: [0, 4, 16], look: [0, 12, -30], fov: 56 }),
    update(s, t, ctx) {
      const bt = s.launch + s.rise;
      if (t < s.launch) {
        s.rocket.setLocalScale(0.001, 0.001, 0.001);
      } else if (t < bt) {
        const u = (t - s.launch) / s.rise;
        s.rocket.setLocalScale(1, 1, 1);
        s.rocket.setLocalPosition(s.x + u * 1.2, (1 - (1 - u) ** 2) * s.height, -30);
      } else {
        s.rocket.setLocalScale(0.001, 0.001, 0.001);
        if (!s.boomed) {
          s.boomed = true;
          ctx.sfx.boom();
        }
      }
      const k = t - bt;
      if (k < 0 || k > 1.6) {
        s.burst.setLocalScale(0.001, 0.001, 0.001);
      } else {
        const r = 6.5 * (1 - Math.exp(-k * 4.5)) * (k > 1.0 ? Math.max(0.001, 1 - (k - 1.0) / 0.6) : 1);
        s.burst.setLocalScale(r, r, r);
        s.burst.setLocalPosition(s.x + 1.2, s.height - k * k * 1.6, -30);
      }
    },
    focus: (s, out) => out.set(s.x + 1.2, s.height, -30),
    bomb: () => null,
  },

  cat: {
    prompt: 'Catch the cat mid-leap',
    caption: 'Fearless',
    light: { key: [1, 0.78, 0.55], ambient: [0.5, 0.45, 0.55], dir: [0.6, -0.5, -0.4] },
    fog: [0.95, 0.75, 0.62],
    build(ctx) {
      addSky(ctx, [[0, '#3b4f8f'], [0.35, '#b46a8a'], [0.48, '#ffb27a'], [0.52, '#ffd6a0'], [1, '#6a4a5a']]);
      const gap = 1.6 + ctx.rng() * 0.8;
      make(ctx, ctx.root, 'roofs', (b) => {
        for (const [x, w] of [[-gap / 2 - 3, 6], [gap / 2 + 3, 6]]) {
          b.box([x, -1.5, 0], [w / 2, 1.5, 3], '#8c5a4a', 0.05);
          b.box([x, 0.05, 0], [w / 2 + 0.1, 0.06, 3.1], '#5a3a34');
        }
        b.box([-gap / 2 - 4.5, 0.9, -1.5], [0.35, 0.9, 0.35], '#a56b55', 0.05); // chimney
        for (let i = 0; i < 14; i++) {
          const h = 2 + ctx.rng() * 8;
          b.box([-30 + i * 4.4, h / 2 - 6, -30], [1.8, h / 2, 2], '#4a3a52');
        }
      });
      const cat = meshEntity(ctx.root, 'cat', catMesh(ctx), materials().lit);
      return { cat, gap, leap: 1.1 + ctx.rng() * 0.8, flight: 0.85 };
    },
    peak: (s) => s.leap + s.flight / 2,
    duration: (s) => s.leap + s.flight + 1.0,
    tolerance: 0.12,
    camera: () => ({ pos: [0, 1.7, 6.6], look: [0, 1.2, 0], fov: 52 }),
    update(s, t) {
      const x0 = -s.gap / 2 - 0.5;
      const x1 = s.gap / 2 + 0.5;
      let x = x0;
      let y = 0.1;
      let pitch = 0;
      let squash = 1;
      if (t < s.leap) {
        x = x0 - Math.max(0, s.leap - 0.4 - t) * 2.2;
        squash = t > s.leap - 0.4 ? 0.8 : 1;
      } else if (t < s.leap + s.flight) {
        const u = (t - s.leap) / s.flight;
        x = x0 + (x1 - x0) * u;
        y = 0.1 + parabola(u) * 1.5;
        pitch = 25 - u * 50;
        squash = 1.15;
      } else {
        x = x1 + (t - s.leap - s.flight) * 1.5;
      }
      s.cat.setLocalPosition(x, y, 0);
      s.cat.setLocalEulerAngles(pitch, 90, 0);
      s.cat.setLocalScale(1.6 * squash, 1.6 / squash, 1.6);
    },
    focus: (s, out) => out.copy(s.cat.getPosition()).add(new Vec3(0, 0.6, 0)),
    bomb: (s) => ({ pos: [-s.gap / 2 - 4.5, 1.6, -1.5], appear: s.leap - 0.4 }),
  },

  pizza: {
    prompt: 'Snap the dough at the top of the big toss',
    caption: 'Flying pizza',
    light: { key: [1, 0.92, 0.8], ambient: [0.55, 0.5, 0.48], dir: [0.3, -0.7, -0.6] },
    fog: [0.9, 0.85, 0.78],
    build(ctx) {
      make(ctx, ctx.root, 'kitchen', (b) => {
        b.box([0, 3, -2.2], [8, 4, 0.1], '#f3e6d0'); // wall
        for (let x = -7.5; x <= 7.5; x += 0.75) for (let y = 0.2; y < 2.2; y += 0.75) b.box([x, y, -2.08], [0.35, 0.35, 0.02], (x * 4 + y * 4) % 3 < 1.5 ? '#d9eef2' : '#c3e2e8');
        b.box([0, 0.5, 0.2], [3.5, 0.5, 0.8], '#8a5a3c', 0.04); // counter
        b.box([0, 1.03, 0.2], [3.6, 0.04, 0.85], '#e8e2d6', 0.02);
        b.box([-2.6, 3.2, -1.9], [1.2, 0.05, 0.3], '#8a5a3c'); // shelf
        for (const x of [-3.3, -2.9, -2.4]) b.box([x, 3.45, -1.9], [0.12, 0.2, 0.12], ['#d14b3a', '#f2c14e', '#4a9c5d'][Math.floor(ctx.rng() * 3)], 0.03);
        b.box([2.7, 2.6, -2.0], [0.7, 0.7, 0.05], '#2b2b2b', 0.05); // oven window frame
        b.box([2.7, 2.6, -1.94], [0.55, 0.55, 0.02], '#ff9a3c');
        person(b, null, { shirt: '#ffffff', pants: '#3a3a3a', hat: 'chef', pose: 'toss', o: [0, 0, -0.8] });
      });
      const dough = make(ctx, ctx.root, 'dough', (b) => {
        b.wheel([0, 0, 0], 0.45, 0.025, '#f1d9a6', 16);
        b.wheel([0, 0, 0], 0.36, 0.03, '#d9443a', 16);
      });
      return { dough, fake: 0.5, main: 1.4 + ctx.rng() * 0.7, flight: 1.15, height: 2.6 };
    },
    peak: (s) => s.main + s.flight / 2,
    duration: (s) => s.main + s.flight + 0.9,
    tolerance: 0.13,
    camera: () => ({ pos: [0, 2.6, 5.6], look: [0, 3.0, -0.5], fov: 52 }),
    update(s, t) {
      const hands = 2.25;
      let y = hands;
      if (t >= s.fake && t < s.fake + 0.55) y = hands + parabola((t - s.fake) / 0.55) * 0.55;
      if (t >= s.main && t < s.main + s.flight) y = hands + parabola((t - s.main) / s.flight) * s.height;
      s.dough.setLocalPosition(0, y, -0.55);
      s.dough.setLocalEulerAngles(0, t * 540, 90 + Math.sin(t * 9) * 8);
    },
    focus: (s, out) => out.copy(s.dough.getPosition()),
    bomb: (s) => ({ pos: [1.4, 1.05, 0.4], appear: s.main - 0.2 }),
  },

  dolphins: {
    prompt: 'Get both dolphins in the shot, mid-jump',
    caption: 'Best friends',
    light: { key: [1, 0.96, 0.88], ambient: [0.55, 0.65, 0.75], dir: [-0.2, -0.8, -0.5] },
    fog: [0.8, 0.9, 0.96],
    build(ctx) {
      addSky(ctx, [[0, '#2d8fe0'], [0.42, '#8ccbf5'], [0.5, '#e6f6ff'], [0.505, '#1f9ac2'], [1, '#0d5f86']]);
      make(ctx, ctx.root, 'sea', (b) => {
        b.box([0, -0.05, -40], [120, 0.05, 80], '#1e93bd');
        for (let i = 0; i < 50; i++) b.box([(ctx.rng() - 0.5) * 50, 0.01, -ctx.rng() * 60], [0.5 + ctx.rng(), 0.01, 0.05], '#8fe0f2');
      });
      const mesh = dolphinMesh(ctx);
      const a = meshEntity(ctx.root, 'dolphin-a', mesh, materials().lit);
      const b = meshEntity(ctx.root, 'dolphin-b', mesh, materials().lit);
      a.setLocalScale(1.35, 1.35, 1.35);
      b.setLocalScale(1.25, 1.25, 1.25);
      const splashes = [0, 1, 2, 3].map((i) =>
        meshEntity(ctx.root, `splash-${i}`, burstMesh(ctx, 60, ['#ffffff', '#d8f0ff'], { flat: true }), materials().lit)
      );
      const x = (ctx.rng() - 0.5) * 5;
      return { a, b, splashes, x, jump: 1.0 + ctx.rng() * 0.7, flight: 1.2, lag: 0.12 + ctx.rng() * 0.08, sfxDone: {} };
    },
    peak: (s) => s.jump + s.lag / 2 + s.flight / 2,
    duration: (s) => s.jump + s.lag + s.flight + 0.9,
    tolerance: 0.15,
    camera: () => ({ pos: [0, 1.6, 4.5], look: [0, 1.9, -6.5], fov: 52 }),
    update(s, t, ctx) {
      const place = (e, t0, z, dx) => {
        const u = (t - t0) / s.flight;
        const x = s.x + dx - 3 + clamp01(u) * 6;
        const y = u < 0 ? -2 : u > 1 ? -2 : -0.4 + parabola(u) * 3.2;
        e.setLocalPosition(x, y, z);
        e.setLocalEulerAngles(0, 90, 0);
        e.rotateLocal(-(clamp01(u) - 0.5) * 110, 0, 0);
      };
      place(s.a, s.jump, -6, 0);
      place(s.b, s.jump + s.lag, -8.4, 2.4);
      const splash = (e, t0, x, z) => {
        const k = t - t0;
        e.setLocalPosition(x, 0, z);
        if (k < 0 || k > 0.9) return e.setLocalScale(0.001, 0.001, 0.001);
        const r = 0.4 + (1 - Math.exp(-k * 6)) * 1.3;
        e.setLocalScale(r, Math.max(0.001, r * (1 - k)), r);
      };
      splash(s.splashes[0], s.jump, s.x - 3, -6);
      splash(s.splashes[1], s.jump + s.lag, s.x - 0.6, -8.4);
      splash(s.splashes[2], s.jump + s.flight, s.x + 3, -6);
      splash(s.splashes[3], s.jump + s.lag + s.flight, s.x + 5.4, -8.4);
      if (t >= s.jump && !s.sfxDone.a) (s.sfxDone.a = true), ctx.sfx.splash(0.6);
      if (t >= s.jump + s.flight && !s.sfxDone.b) (s.sfxDone.b = true), ctx.sfx.splash(0.7);
    },
    focus: (s, out) => out.copy(s.a.getPosition()).add(s.b.getPosition()).mulScalar(0.5),
    extras: (s) => [s.a.getPosition(), s.b.getPosition()],
    bomb: () => null,
  },
};

export const SCENE_ORDER = Object.keys(SCENES);

/** Build a scene into a fresh root entity. Returns everything main.js needs to run and score it. */
export function createScene(app, id, rng, sfx) {
  const def = SCENES[id];
  const root = new Entity(`scene-${id}`);
  app.root.addChild(root);
  const ctx = { app, device: app.graphicsDevice, root, rng, sfx };
  const state = def.build(ctx);
  return {
    id,
    def,
    root,
    state,
    ctx,
    prompt: def.prompt,
    caption: def.caption,
    peak: def.peak(state),
    duration: def.duration(state),
    tolerance: def.tolerance,
    camera: def.camera(state),
    bomb: def.bomb(state),
    update: (t) => def.update(state, t, ctx),
    focus: (out) => def.focus(state, out),
    extras: def.extras ? () => def.extras(state) : null,
  };
}
