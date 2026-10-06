import { Color, Entity, MeshInstance, StandardMaterial } from 'playcanvas';
import { MeshBuilder } from './builder.js';

// Collision footprints (half width, half length) per vehicle kind
export const SIZES = {
  sport: { hw: 0.95, hl: 2.2 },
  sedan: { hw: 0.95, hl: 2.3 },
  van: { hw: 1.05, hl: 2.6 },
  truck: { hw: 1.25, hl: 4.6 },
};

const GLASS = '#151b28';
const TYRE = '#14161a';
const RIM = '#8a919c';
const HEAD = '#fff4dc';
const TAIL = '#ff2a3a';
const DARK = '#22252c';

let bodyMaterial;
let lightMaterial;
function materials() {
  if (!bodyMaterial) {
    bodyMaterial = new StandardMaterial();
    bodyMaterial.diffuse = new Color(1, 1, 1);
    bodyMaterial.diffuseVertexColor = true;
    bodyMaterial.useMetalness = true;
    bodyMaterial.metalness = 0.35;
    bodyMaterial.gloss = 0.68;
    bodyMaterial.update();

    lightMaterial = new StandardMaterial();
    lightMaterial.useLighting = false;
    lightMaterial.diffuse = new Color(0, 0, 0);
    lightMaterial.emissive = new Color(1, 1, 1);
    lightMaterial.emissiveVertexColor = true;
    lightMaterial.emissiveIntensity = 3.2;
    lightMaterial.update();
  }
  return { bodyMaterial, lightMaterial };
}

function wheels(b, xOff, z1, z2, r = 0.36) {
  for (const x of [-xOff, xOff]) {
    for (const z of [z1, z2]) {
      b.wheel([x, r, z], r, 0.15, TYRE);
      b.wheel([x + Math.sign(x) * 0.02, r, z], r * 0.55, 0.15, RIM, 8);
    }
  }
}

// Every car faces -Z, sits on y = 0, and is centred on its footprint.
const BUILDERS = {
  sport(b, l, paint, stripe) {
    b.loft(
      [
        { z: -2.2, w: 0.78, h: 0.16, y: 0.46 },
        { z: -1.7, w: 0.92, h: 0.26, y: 0.52 },
        { z: -0.4, w: 0.96, h: 0.3, y: 0.56 },
        { z: 1.3, w: 0.96, h: 0.32, y: 0.58 },
        { z: 2.18, w: 0.88, h: 0.27, y: 0.58 },
      ],
      paint
    );
    b.loft(
      [
        { z: -0.75, w: 0.62, h: 0.03, y: 0.88 },
        { z: -0.25, w: 0.74, h: 0.19, y: 1.02 },
        { z: 0.75, w: 0.74, h: 0.19, y: 1.04 },
        { z: 1.25, w: 0.66, h: 0.04, y: 0.9 },
      ],
      GLASS
    );
    b.box([0, 1.24, 0.25], [0.66, 0.025, 0.5], paint, 0.02); // roof
    b.box([0, 0.875, -1.25], [0.13, 0.02, 0.9], stripe); // hood stripe
    b.box([0, 1.27, 0.25], [0.13, 0.02, 0.5], stripe); // roof stripe
    b.box([0, 1.02, 2.02], [0.92, 0.04, 0.16], paint, 0.02); // spoiler
    for (const x of [-0.6, 0.6]) b.box([x, 0.92, 2.02], [0.04, 0.1, 0.06], DARK);
    wheels(b, 0.86, -1.35, 1.4);
    for (const x of [-0.62, 0.62]) l.box([x, 0.6, -2.18], [0.22, 0.06, 0.04], HEAD);
    l.box([0, 0.72, 2.2], [0.82, 0.05, 0.03], TAIL);
  },

  sedan(b, l, paint) {
    b.loft(
      [
        { z: -2.3, w: 0.86, h: 0.22, y: 0.55 },
        { z: -1.6, w: 0.95, h: 0.3, y: 0.6 },
        { z: 1.6, w: 0.95, h: 0.3, y: 0.62 },
        { z: 2.3, w: 0.9, h: 0.26, y: 0.64 },
      ],
      paint
    );
    b.loft(
      [
        { z: -0.9, w: 0.78, h: 0.04, y: 0.94 },
        { z: -0.4, w: 0.8, h: 0.26, y: 1.16 },
        { z: 0.9, w: 0.8, h: 0.26, y: 1.16 },
        { z: 1.45, w: 0.78, h: 0.05, y: 0.96 },
      ],
      GLASS
    );
    b.box([0, 1.43, 0.25], [0.74, 0.03, 0.62], paint, 0.02);
    wheels(b, 0.86, -1.45, 1.45);
    for (const x of [-0.62, 0.62]) l.box([x, 0.66, -2.3], [0.2, 0.07, 0.04], HEAD);
    for (const x of [-0.66, 0.66]) l.box([x, 0.74, 2.3], [0.18, 0.07, 0.03], TAIL);
  },

  van(b, l, paint) {
    b.box([0, 1.12, 0.25], [1.02, 0.8, 2.3], paint, 0.12);
    b.box([0, 0.8, -2.2], [0.98, 0.42, 0.4], paint, 0.12); // nose
    b.box([0, 1.45, -1.9], [0.92, 0.3, 0.06], GLASS); // windscreen
    for (const x of [-1.03, 1.03]) b.box([x, 1.48, -1.3], [0.02, 0.22, 0.45], GLASS);
    wheels(b, 0.92, -1.7, 1.75, 0.4);
    for (const x of [-0.7, 0.7]) l.box([x, 0.82, -2.6], [0.2, 0.08, 0.04], HEAD);
    for (const x of [-0.82, 0.82]) l.box([x, 0.95, 2.56], [0.1, 0.22, 0.03], TAIL);
  },

  truck(b, l, paint, stripe) {
    b.box([0, 1.55, 1.0], [1.24, 1.15, 3.6], stripe, 0.08); // box trailer
    b.box([0, 1.15, -3.6], [1.15, 0.85, 1.0], paint, 0.14); // cab
    b.box([0, 1.6, -4.45], [1.0, 0.36, 0.08], GLASS); // windscreen
    b.box([0, 0.5, -1.2], [1.0, 0.18, 4.6], DARK); // chassis
    wheels(b, 1.0, -3.7, 3.4, 0.5);
    for (const x of [-1.0, 1.0]) b.wheel([x, 0.5, 2.3], 0.5, 0.15, TYRE);
    for (const x of [-0.8, 0.8]) l.box([x, 0.75, -4.6], [0.2, 0.08, 0.04], HEAD);
    for (const x of [-1.0, 1.0]) l.box([x, 0.8, 4.62], [0.12, 0.12, 0.03], TAIL);
    l.box([0, 2.72, -3.0], [0.6, 0.04, 0.04], '#ffb347'); // cab marker lights
  },
};

const cache = new Map();
/** One body mesh + one light mesh per (kind, paint, stripe), shared by every car of that look. */
function meshesFor(device, kind, paint, stripe) {
  const key = `${kind}:${paint}:${stripe}`;
  if (!cache.has(key)) {
    const body = new MeshBuilder();
    const lights = new MeshBuilder();
    BUILDERS[kind](body, lights, paint, stripe);
    cache.set(key, { body: body.build(device), lights: lights.build(device) });
  }
  return cache.get(key);
}

export function createCar(app, kind, paint, stripe = '#ffffff') {
  const { bodyMaterial, lightMaterial } = materials();
  const { body, lights } = meshesFor(app.graphicsDevice, kind, paint, stripe);
  const root = new Entity(kind);
  const visual = new Entity(`${kind}-visual`); // tilts and tumbles; root holds position
  visual.addComponent('render', {
    meshInstances: [new MeshInstance(body, bodyMaterial), new MeshInstance(lights, lightMaterial)],
  });
  root.addChild(visual);
  app.root.addChild(root);
  return { root, visual };
}

export const RIVAL_LOOKS = [
  { paint: '#d7263d', stripe: '#111318' },
  { paint: '#f5b700', stripe: '#111318' },
  { paint: '#2ec27e', stripe: '#f4f4f4' },
  { paint: '#9b5de5', stripe: '#f4f4f4' },
  { paint: '#ff7a1a', stripe: '#111318' },
];
export const PLAYER_LOOK = { paint: '#1f6bff', stripe: '#f4f6fb' };
export const TRAFFIC_LOOKS = {
  sedan: ['#c9ccd2', '#5a6270', '#7d2f2f', '#2f4a6b', '#e8e2d4', '#3d5a40'],
  van: ['#e9ecef', '#8a8f98', '#2c3e50'],
  truck: [['#c0392b', '#e8e8e8'], ['#2c3e50', '#dcdcdc'], ['#f39c12', '#f2f2f2']],
};
