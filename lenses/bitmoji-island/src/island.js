import { ADDRESS_CLAMP_TO_EDGE, BLEND_ADDITIVE, CULLFACE_FRONT, Color, Entity, MeshInstance, StandardMaterial, Texture } from 'playcanvas';
import { MeshBuilder } from './builder.js';
import { GRID } from './economy.js';

export const SPACING = 1.9;
export const plotPos = (i) => {
  const row = Math.floor(i / GRID);
  const col = i % GRID;
  return [(col - (GRID - 1) / 2) * SPACING, 0, (row - (GRID - 1) / 2) * SPACING];
};

let mats;
function materials() {
  if (mats) return mats;
  const lit = new StandardMaterial();
  lit.diffuse = new Color(1, 1, 1);
  lit.diffuseVertexColor = true;
  lit.gloss = 0.3;
  lit.update();
  const glow = new StandardMaterial();
  glow.useLighting = false;
  glow.diffuse = new Color(0, 0, 0);
  glow.emissive = new Color(1, 1, 1);
  glow.emissiveVertexColor = true;
  glow.emissiveIntensity = 2.5;
  glow.update();
  const cloud = new StandardMaterial();
  cloud.diffuse = new Color(1, 1, 1);
  cloud.diffuseVertexColor = true;
  cloud.emissive = new Color(0.55, 0.58, 0.62); // soft, bright clouds rather than grey blocks
  cloud.gloss = 0.1;
  cloud.update();
  const additive = glow.clone();
  additive.blendType = BLEND_ADDITIVE;
  additive.depthWrite = false;
  additive.emissiveIntensity = 1.6;
  additive.update();
  mats = { lit, glow, additive, cloud };
  return mats;
}

function entity(parent, name, build, { glow = false, additive = false, material = null } = {}) {
  const b = new MeshBuilder();
  const g = new MeshBuilder();
  build(b, g);
  const e = new Entity(name);
  const instances = [];
  if (b.positions.length) instances.push(new MeshInstance(b.build(parent.__device), material ?? materials().lit));
  if (g.positions.length) instances.push(new MeshInstance(g.build(parent.__device), additive ? materials().additive : materials().glow));
  void glow;
  e.addComponent('render', { meshInstances: instances });
  e.__device = parent.__device;
  parent.addChild(e);
  return e;
}

// --- Island body: a noisy round slab with layered rock underneath ---
function islandMesh(b, rng) {
  const N = 18;
  const radius = (k, r) => r * (0.94 + rng() * 0.08 + Math.sin(k * 0.9) * 0.03);
  const layers = [
    { y: 0, r: 7.2, col: '#7cc957' },
    { y: -0.3, r: 7.25, col: '#5fae45' },
    { y: -1.1, r: 6.9, col: '#b07a52' },
    { y: -1.8, r: 5.4, col: '#9a6a47' },
    { y: -2.9, r: 3.9, col: '#83593d' },
    { y: -4.1, r: 2.2, col: '#6d4a33' },
    { y: -5.2, r: 0.5, col: '#5a3d2a' },
  ];
  const rings = layers.map((l) => Array.from({ length: N }, (_, k) => {
    const a = (k / N) * Math.PI * 2;
    const r = radius(k, l.r);
    return [Math.cos(a) * r, l.y, Math.sin(a) * r];
  }));
  b.polygon(rings[0], '#7cc957', [0, -5, 0]);
  for (let li = 0; li < rings.length - 1; li++) {
    const inside = [0, (layers[li].y + layers[li + 1].y) / 2, 0];
    for (let k = 0; k < N; k++) {
      const j = (k + 1) % N;
      b.polygon([rings[li][k], rings[li][j], rings[li + 1][j], rings[li + 1][k]], layers[li + 1].col, inside);
    }
  }
  // Grass tufts everywhere outside the garden, so the lawn has texture
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 6.6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < 4.1 && Math.abs(z) < 4.1) continue;
    for (let k = 0; k < 3; k++) b.box([x + (k - 1) * 0.07, 0.07, z + (rng() - 0.5) * 0.08], [0.025, 0.07 + rng() * 0.05, 0.025], rng() < 0.5 ? '#5aa83e' : '#6dbb4b');
  }
  // Rocks and flowers
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2;
    const r = 4.4 + rng() * 2.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (rng() < 0.4) b.box([x, 0.08, z], [0.18, 0.1, 0.15], '#b9b4a8', 0.06);
    else {
      b.box([x, 0.12, z], [0.025, 0.12, 0.025], '#4f9a3c');
      b.box([x, 0.26, z], [0.08, 0.05, 0.08], ['#ff8fb1', '#ffd34d', '#ffffff', '#b58cff'][Math.floor(rng() * 4)], 0.03);
    }
  }
}

// --- Crops (ready form; growth scales them) ---
const CROP_BUILDERS = {
  carrot(b) {
    b.box([0, 0.08, 0], [0.13, 0.1, 0.13], '#f07b22', 0.05);
    for (const [x, z] of [[0, 0], [0.08, 0.05], [-0.08, 0.04], [0.02, -0.08]]) b.box([x, 0.38, z], [0.035, 0.24, 0.035], '#3f9c3a', 0.015);
  },
  tomato(b) {
    b.box([0, 0.35, 0], [0.32, 0.32, 0.32], '#3f8f3a', 0.14);
    for (const [x, y, z] of [[0.22, 0.42, 0.18], [-0.2, 0.3, 0.22], [0.05, 0.55, -0.25], [-0.15, 0.6, 0.05], [0.25, 0.22, -0.1]]) b.box([x, y, z], [0.1, 0.1, 0.1], '#e5372d', 0.045);
  },
  sunflower(b) {
    b.box([0, 0.6, 0], [0.035, 0.6, 0.035], '#4b9e3c');
    for (const s of [-1, 1]) b.box([s * 0.14, 0.5, 0], [0.12, 0.025, 0.06], '#4b9e3c', 0.01);
    const cy = 1.22;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      b.box([Math.cos(a) * 0.2, cy + Math.sin(a) * 0.2, 0.02], [0.07, 0.07, 0.02], '#ffc928', 0.02);
    }
    b.box([0, cy, 0.05], [0.12, 0.12, 0.04], '#6b3f1f', 0.04);
  },
  pumpkin(b) {
    for (const [x, s] of [[-0.18, 0.24], [0.18, 0.24], [0, 0.3]]) b.box([x, 0.27, 0], [s, 0.26, 0.3], '#f08a22', 0.12);
    b.box([0, 0.58, 0], [0.04, 0.08, 0.04], '#4f6b2c', 0.01);
    b.box([0.12, 0.55, 0], [0.12, 0.02, 0.06], '#3f8f3a', 0.01);
  },
  strawberry(b) {
    b.box([0, 0.18, 0], [0.38, 0.16, 0.38], '#3f8f3a', 0.1);
    for (const [x, z] of [[0.25, 0.2], [-0.24, 0.18], [0.1, -0.28], [-0.2, -0.15], [0.3, -0.05]]) {
      b.box([x, 0.14, z], [0.09, 0.11, 0.09], '#e8304a', 0.04);
      b.box([x, 0.27, z], [0.06, 0.02, 0.06], '#3f8f3a');
    }
  },
};

function sprout(b) {
  for (const s of [-1, 1]) b.box([s * 0.06, 0.12, 0], [0.06, 0.02, 0.035], '#5cbf47', 0.015);
  b.box([0, 0.06, 0], [0.02, 0.07, 0.02], '#5cbf47');
}

// --- Decorations at fixed spots around the garden ---
const DECOR_BUILDERS = {
  tree(b) {
    b.box([0, 1.0, 0], [0.18, 1.0, 0.18], '#7a5233', 0.05);
    b.box([0, 2.4, 0], [0.95, 0.75, 0.95], '#5aae4a', 0.35);
    b.box([0.2, 3.1, -0.1], [0.6, 0.5, 0.6], '#6cc057', 0.25);
    for (const [x, y, z] of [[0.6, 2.3, 0.6], [-0.55, 2.6, 0.5], [0.3, 2.0, -0.75], [-0.7, 2.1, -0.3]]) b.box([x, y, z], [0.1, 0.1, 0.1], '#e63b3b', 0.04);
  },
  fence(b) {
    const z = 4.75;
    for (let x = -4.2; x <= 4.21; x += 0.7) b.box([x, 0.35, z], [0.06, 0.35, 0.06], '#f4ead7', 0.02);
    for (const y of [0.25, 0.52]) b.box([0, y, z], [4.25, 0.04, 0.03], '#f4ead7');
  },
  bench(b) {
    b.box([0, 0.42, 0], [0.75, 0.05, 0.25], '#a5683f', 0.02);
    b.box([0, 0.75, -0.22], [0.75, 0.12, 0.04], '#a5683f', 0.02);
    for (const x of [-0.6, 0.6]) b.box([x, 0.2, 0], [0.05, 0.2, 0.2], '#4a4a4a');
  },
  pond(b, g) {
    const N = 12;
    const ring = (r, y) => Array.from({ length: N }, (_, k) => [Math.cos((k / N) * Math.PI * 2) * r, y, Math.sin((k / N) * Math.PI * 2) * r * 0.75]);
    b.polygon(ring(1.25, 0.03), '#b9b4a8', [0, -1, 0]);
    b.polygon(ring(1.05, 0.05), '#4fb3d9', [0, -1, 0]);
    for (const [x, z] of [[0.4, 0.2], [-0.35, -0.25], [0.1, -0.4]]) b.box([x, 0.07, z], [0.16, 0.015, 0.16], '#5aae4a', 0.06);
    g.box([-0.35, 0.1, -0.25], [0.05, 0.03, 0.05], '#ffb3cf');
  },
  windmill(b) {
    b.box([0, 1.3, 0], [0.55, 1.3, 0.55], '#f1e6d2', 0.15);
    b.box([0, 2.8, 0], [0.65, 0.25, 0.65], '#c0504d', 0.2);
    b.box([0, 0.5, 0.56], [0.2, 0.35, 0.02], '#7a5233');
  },
  lanterns(b, g) {
    for (const [x, z] of [[-4.3, -4.3], [4.3, -4.3], [-4.3, 4.3], [4.3, 4.3]]) {
      b.box([x, 0.7, z], [0.05, 0.7, 0.05], '#3e3a36');
      b.box([x, 1.45, z], [0.14, 0.04, 0.14], '#3e3a36');
      g.box([x, 1.28, z], [0.1, 0.13, 0.1], '#ffd38a');
    }
  },
  cottage(b) {
    b.box([0, 0.75, 0], [1.3, 0.75, 1.0], '#f3e3c3', 0.05);
    for (const s of [-1, 1]) b.polygon([[-1.45, 1.5, s * 1.15], [1.45, 1.5, s * 1.15], [0, 2.5, s * 1.15]], '#c0504d', [0, 1.8, 0]);
    for (const s of [-1, 1]) b.polygon([[s * 1.45, 1.5, -1.15], [s * 1.45, 1.5, 1.15], [0, 2.5, 1.15], [0, 2.5, -1.15]], '#b0443f', [0, 1.2, 0]);
    b.box([0, 0.45, 1.01], [0.25, 0.45, 0.02], '#7a5233');
    for (const x of [-0.75, 0.75]) b.box([x, 0.9, 1.01], [0.22, 0.2, 0.02], '#8fd3f0');
    b.box([0.8, 2.3, -0.3], [0.15, 0.4, 0.15], '#8a6a55');
  },
  balloon(b) {
    b.box([0, 0, 0], [1.1, 1.2, 1.1], '#ff7a59', 0.5);
    for (let k = 0; k < 4; k++) b.box([Math.cos(k * 1.57) * 0.7, 0.1, Math.sin(k * 1.57) * 0.7], [0.12, 1.0, 0.12], '#ffd34d', 0.05);
    b.box([0, -1.9, 0], [0.35, 0.25, 0.35], '#a5683f', 0.05);
    for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.box([x, -1.4, z], [0.015, 0.4, 0.015], '#5a4632');
  },
};

export const DECOR_SPOTS = {
  tree: [-5.5, 0, -2.6],
  fence: [0, 0, 0],
  bench: [4.5, 0, 4.0],
  pond: [5.2, 0, -1.4],
  windmill: [-5.3, 0, 2.4],
  lanterns: [0, 0, 0],
  cottage: [1.2, 0, -5.4],
  balloon: [-7.5, 5.5, -5.5],
};

function skyTexture(device) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  // Blue sky all the way round: the island floats, so there's sky below it too
  grad.addColorStop(0, '#5aa8ee');
  grad.addColorStop(0.42, '#a6d6f8');
  grad.addColorStop(0.5, '#fff0dc');
  grad.addColorStop(0.58, '#bfe2f8');
  grad.addColorStop(1, '#78bdf0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const t = new Texture(device, { width: 16, height: 256, addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE });
  t.setSource(c);
  return t;
}

export function createIsland(app, rng) {
  const device = app.graphicsDevice;
  const world = new Entity('world');
  world.__device = device;
  app.root.addChild(world);

  // Sky
  const skyMat = new StandardMaterial();
  skyMat.useLighting = false;
  skyMat.useFog = false;
  skyMat.diffuse = new Color(0, 0, 0);
  skyMat.emissive = new Color(1, 1, 1);
  skyMat.emissiveMap = skyTexture(device);
  skyMat.cull = CULLFACE_FRONT;
  skyMat.depthWrite = false;
  skyMat.update();
  const sky = new Entity('sky');
  sky.addComponent('render', { type: 'sphere', material: skyMat });
  sky.setLocalScale(300, 300, 300);
  app.root.addChild(sky);

  // The island turns as one piece when you drag
  const island = new Entity('island');
  island.__device = device;
  world.addChild(island);
  entity(island, 'land', (b) => islandMesh(b, rng));

  // Plots
  const plotMesh = (() => {
    const b = new MeshBuilder();
    b.box([0, 0.07, 0], [0.8, 0.09, 0.8], '#7a5236', 0.06);
    for (const z of [-0.45, 0, 0.45]) b.box([0, 0.165, z], [0.68, 0.015, 0.07], '#6a4630', 0.01);
    return b.build(device);
  })();
  const signMesh = (() => {
    const b = new MeshBuilder();
    b.box([0, 0.35, 0], [0.04, 0.35, 0.04], '#8a6040');
    b.box([0, 0.72, 0], [0.32, 0.17, 0.03], '#c99a62', 0.03);
    b.box([0, 0.72, 0.035], [0.1, 0.1, 0.01], '#ffcf3d', 0.04);
    return b.build(device);
  })();
  const sproutMesh = (() => {
    const b = new MeshBuilder();
    sprout(b);
    return b.build(device);
  })();
  const cropMeshes = Object.fromEntries(
    Object.entries(CROP_BUILDERS).map(([id, fn]) => {
      const b = new MeshBuilder();
      fn(b);
      return [id, b.build(device)];
    })
  );

  const plots = Array.from({ length: GRID * GRID }, (_, i) => {
    const root = new Entity(`plot-${i}`);
    root.setLocalPosition(...plotPos(i));
    island.addChild(root);
    const soil = new Entity('soil');
    soil.addComponent('render', { meshInstances: [new MeshInstance(plotMesh, materials().lit)] });
    root.addChild(soil);
    const sign = new Entity('sign');
    sign.addComponent('render', { meshInstances: [new MeshInstance(signMesh, materials().lit)] });
    root.addChild(sign);
    const plant = new Entity('plant');
    plant.setLocalPosition(0, 0.16, 0);
    root.addChild(plant);
    return { root, soil, sign, plant, cropId: null, stage: null };
  });

  function setPlantMesh(p, kind) {
    if (p.stage === kind) return;
    p.stage = kind;
    if (p.plant.render) p.plant.removeComponent('render');
    if (!kind) return;
    const mesh = kind === 'sprout' ? sproutMesh : cropMeshes[kind];
    p.plant.addComponent('render', { meshInstances: [new MeshInstance(mesh, materials().lit)] });
  }

  // Decorations
  const decor = {};
  for (const [id, fn] of Object.entries(DECOR_BUILDERS)) {
    const e = entity(island, `decor-${id}`, fn, { additive: false });
    e.setLocalPosition(...DECOR_SPOTS[id]);
    e.enabled = false;
    decor[id] = e;
  }
  const blades = entity(decor.windmill, 'blades', (b) => {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      b.box([Math.cos(a) * 0.85, Math.sin(a) * 0.85, 0], [Math.abs(Math.cos(a)) * 0.75 + 0.1, Math.abs(Math.sin(a)) * 0.75 + 0.1, 0.03], '#f7f1e3', 0.02);
    }
    b.box([0, 0, 0.05], [0.12, 0.12, 0.08], '#c0504d', 0.04);
  });
  blades.setLocalPosition(0, 2.2, 0.62);

  // Clouds drifting around and below the island
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const c = entity(world, 'cloud', (b) => {
      const n = 3 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) b.box([k * 1.1 - n * 0.5, rng() * 0.4, rng() * 0.6], [0.9 + rng() * 0.5, 0.55 + rng() * 0.3, 0.7], '#ffffff', 0.45);
    }, { material: materials().cloud });
    // Behind and beside the island only, never between it and the camera
    const a = Math.PI * (1.05 + rng() * 0.9);
    const r = 15 + rng() * 9;
    c.setLocalPosition(Math.cos(a) * r, -5 + rng() * 9, Math.sin(a) * r);
    c.setLocalScale(1 + rng(), 1 + rng() * 0.5, 1 + rng());
    clouds.push({ e: c, speed: 0.15 + rng() * 0.3 });
  }

  // Sparkle shown over ready crops
  const sparkle = (() => {
    const b = new MeshBuilder();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.box([Math.cos(a) * 0.55, 0.9 + (k % 2) * 0.25, Math.sin(a) * 0.55], [0.04, 0.04, 0.04], '#fff6c2');
    }
    return b.build(device);
  })();
  for (const p of plots) {
    const s = new Entity('sparkle');
    s.addComponent('render', { meshInstances: [new MeshInstance(sparkle, materials().additive)] });
    p.root.addChild(s);
    s.enabled = false;
    p.sparkle = s;
  }

  return { world, island, sky, plots, decor, blades, clouds, setPlantMesh };
}
