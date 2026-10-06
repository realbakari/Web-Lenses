import {
  ADDRESS_CLAMP_TO_EDGE,
  ADDRESS_REPEAT,
  BLEND_ADDITIVE,
  CULLFACE_FRONT,
  Color,
  Entity,
  MeshInstance,
  StandardMaterial,
  Texture,
  Vec2,
} from 'playcanvas';
import { MeshBuilder } from './builder.js';

export const LANES = [-4.8, -1.6, 1.6, 4.8]; // x < 0 is oncoming traffic
export const ROAD_HALF = 6.5; // painted edge lines
export const RAIL_X = 7.3;
const TILE = 16; // metres of road per texture repeat
const ROAD_LENGTH = 720;

function canvasTexture(device, canvas, { repeat = false } = {}) {
  const t = new Texture(device, {
    width: canvas.width,
    height: canvas.height,
    addressU: repeat ? ADDRESS_REPEAT : ADDRESS_CLAMP_TO_EDGE,
    addressV: repeat ? ADDRESS_REPEAT : ADDRESS_CLAMP_TO_EDGE,
    mipmaps: true,
    anisotropy: 8,
  });
  t.setSource(canvas);
  return t;
}

function paintRoad() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const px = (m) => ((m + 9) / 18) * 512; // x in metres (−9…9) → pixels
  const py = (m) => (m / TILE) * 512;
  g.fillStyle = '#2a2c33';
  g.fillRect(0, 0, 512, 512);
  // Asphalt grain
  for (let i = 0; i < 9000; i++) {
    const v = 30 + Math.random() * 30;
    g.fillStyle = `rgba(${v},${v + 2},${v + 8},0.5)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // Shoulders
  g.fillStyle = '#1d1f25';
  g.fillRect(0, 0, px(-ROAD_HALF - 0.2), 512);
  g.fillRect(px(ROAD_HALF + 0.2), 0, 512, 512);
  // Edge lines
  g.fillStyle = '#e9e9e4';
  for (const x of [-ROAD_HALF, ROAD_HALF]) g.fillRect(px(x) - 4, 0, 8, 512);
  // Lane dashes (3 m paint, 5 m gap)
  for (const x of [-3.2, 3.2]) for (const y of [0, 8]) g.fillRect(px(x) - 4, py(y), 8, py(3));
  // Centre double yellow
  g.fillStyle = '#f2b51d';
  for (const x of [-0.18, 0.18]) g.fillRect(px(x) - 3.5, 0, 7, 512);
  return c;
}

function paintSky() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#070a1f');
  grad.addColorStop(0.32, '#1c1846');
  grad.addColorStop(0.44, '#5b2a63');
  grad.addColorStop(0.49, '#e0664a');
  grad.addColorStop(0.505, '#ffb070');
  grad.addColorStop(0.53, '#3a1f35');
  grad.addColorStop(1, '#0c0a14');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 512);
  return c;
}

export function createWorld(app) {
  const device = app.graphicsDevice;
  const scrollers = [];

  // Sky dome: vertical dusk gradient, seen from inside
  const skyMat = new StandardMaterial();
  skyMat.useLighting = false;
  skyMat.useFog = false;
  skyMat.diffuse = new Color(0, 0, 0);
  skyMat.emissiveMap = canvasTexture(device, paintSky());
  skyMat.emissive = new Color(1, 1, 1);
  skyMat.cull = CULLFACE_FRONT;
  skyMat.depthWrite = false;
  skyMat.update();
  const sky = new Entity('sky');
  sky.addComponent('render', { type: 'sphere', material: skyMat });
  sky.setLocalScale(900, 900, 900);
  app.root.addChild(sky);

  // Low sun straight ahead, sitting on the horizon
  const sunMat = new StandardMaterial();
  sunMat.useLighting = false;
  sunMat.useFog = false;
  sunMat.diffuse = new Color(0, 0, 0);
  sunMat.emissive = new Color(1, 0.62, 0.35);
  sunMat.emissiveIntensity = 2.2;
  sunMat.blendType = BLEND_ADDITIVE;
  sunMat.depthWrite = false;
  sunMat.update();
  const sun = new Entity('sun');
  sun.addComponent('render', { type: 'sphere', material: sunMat });
  sky.addChild(sun);
  // Child of the 900-unit sky, so sizes are in sky units: ~70 m wide, on the horizon ahead
  sun.setLocalScale(70 / 900, 70 / 900, 4 / 900);
  sun.setLocalPosition(0, 8 / 900, -420 / 900);

  // Road: one textured plane; the texture scrolls instead of the geometry moving
  const roadTex = canvasTexture(device, paintRoad(), { repeat: true });
  const roadMat = new StandardMaterial();
  roadMat.diffuseMap = roadTex;
  roadMat.diffuseMapTiling = new Vec2(1, ROAD_LENGTH / TILE);
  roadMat.gloss = 0.12;
  roadMat.specular = new Color(0.12, 0.12, 0.12); // matte: no sun glare washing the asphalt out
  roadMat.update();
  const road = new Entity('road');
  road.addComponent('render', { type: 'plane', material: roadMat });
  road.setLocalScale(18, 1, ROAD_LENGTH);
  road.setPosition(0, 0, -ROAD_LENGTH / 2 + 40);
  app.root.addChild(road);

  // Ground either side
  const groundMat = new StandardMaterial();
  groundMat.diffuse = new Color(0.07, 0.065, 0.08);
  groundMat.update();
  for (const side of [-1, 1]) {
    const g = new Entity('ground');
    g.addComponent('render', { type: 'plane', material: groundMat });
    g.setLocalScale(200, 1, ROAD_LENGTH);
    g.setPosition(side * 109, -0.05, -ROAD_LENGTH / 2 + 40);
    app.root.addChild(g);
  }

  const bodyMat = new StandardMaterial();
  bodyMat.diffuse = new Color(1, 1, 1);
  bodyMat.diffuseVertexColor = true;
  bodyMat.gloss = 0.4;
  bodyMat.update();
  const glowMat = new StandardMaterial();
  glowMat.useLighting = false;
  glowMat.diffuse = new Color(0, 0, 0);
  glowMat.emissive = new Color(1, 1, 1);
  glowMat.emissiveVertexColor = true;
  glowMat.emissiveIntensity = 2.6;
  glowMat.update();
  const poolMat = new StandardMaterial();
  poolMat.useLighting = false;
  poolMat.diffuse = new Color(0, 0, 0);
  poolMat.emissive = new Color(1, 1, 1);
  poolMat.emissiveVertexColor = true;
  poolMat.emissiveIntensity = 0.09;
  poolMat.blendType = BLEND_ADDITIVE;
  poolMat.depthWrite = false;
  poolMat.update();

  /** A repeating strip: geometry for `count` periods, shifted modulo one period as the world scrolls. */
  function strip(name, period, count, build) {
    const body = new MeshBuilder();
    const glow = new MeshBuilder();
    const pools = new MeshBuilder();
    for (let i = 0; i < count; i++) build({ body, glow, pools }, -i * period);
    const e = new Entity(name);
    const instances = [];
    if (body.positions.length) instances.push(new MeshInstance(body.build(device), bodyMat));
    if (glow.positions.length) instances.push(new MeshInstance(glow.build(device), glowMat));
    if (pools.positions.length) instances.push(new MeshInstance(pools.build(device), poolMat));
    for (const mi of instances) mi.cull = false; // geometry spans the whole road; bounds don't help
    e.addComponent('render', { meshInstances: instances });
    e.setPosition(0, 0, 30);
    app.root.addChild(e);
    scrollers.push({ e, period, offset: 0 });
  }

  // Guardrails: posts every 4 m (the beams are continuous, so they don't need to scroll)
  strip('rail-posts', 4, 130, ({ body }, z) => {
    for (const s of [-1, 1]) body.box([s * RAIL_X, 0.4, z], [0.08, 0.4, 0.08], '#5c616b');
  });
  const beam = new MeshBuilder();
  for (const s of [-1, 1]) {
    beam.box([s * RAIL_X, 0.62, -ROAD_LENGTH / 2 + 40], [0.06, 0.13, ROAD_LENGTH / 2], '#9aa1ab');
    beam.box([s * RAIL_X, 0.08, -ROAD_LENGTH / 2 + 40], [0.4, 0.08, ROAD_LENGTH / 2], '#3d4048');
  }
  const beams = new Entity('rail-beams');
  beams.addComponent('render', { meshInstances: [new MeshInstance(beam.build(device), bodyMat)] });
  app.root.addChild(beams);

  // Street lamps every 36 m, alternating sides, each with a warm pool of light on the road
  strip('lamps', 72, 9, ({ body, glow, pools }, z) => {
    for (const [s, dz] of [[-1, 0], [1, -36]]) {
      const x = s * (RAIL_X + 0.6);
      body.box([x, 4.5, z + dz], [0.12, 4.5, 0.12], '#3a3e47');
      body.box([x - s * 1.3, 8.9, z + dz], [1.4, 0.08, 0.1], '#3a3e47');
      glow.box([x - s * 2.5, 8.75, z + dz], [0.5, 0.08, 0.22], '#ffd9a0');
      const cx = x - s * 3.6;
      const r = 4.2;
      pools.quad([[cx - r, 0.02, z + dz - r], [cx + r, 0.02, z + dz - r], [cx + r, 0.02, z + dz + r], [cx - r, 0.02, z + dz + r]], '#ffb766', [cx, 1, z + dz]);
    }
  });

  // City blocks with lit windows, either side
  const rnd = (a, b) => a + Math.random() * (b - a);
  strip('city', 240, 3, ({ body, glow }, z0) => {
    for (const s of [-1, 1]) {
      let z = z0;
      while (z > z0 - 240) {
        const w = rnd(8, 18);
        const d = rnd(10, 22);
        const h = rnd(12, 60);
        const x = s * rnd(20, 34) + s * w / 2;
        const tone = ['#141824', '#191d2b', '#1d1a26', '#12161f'][Math.floor(Math.random() * 4)];
        body.box([x, h / 2, z - d / 2], [w / 2, h / 2, d / 2], tone);
        // Windows on the face toward the road
        const face = x - s * (w / 2 + 0.05);
        for (let y = 3; y < h - 2; y += 3.2) {
          for (let wz = z - 1.5; wz > z - d + 1; wz -= 2.6) {
            if (Math.random() < 0.38) {
              const col = Math.random() < 0.8 ? '#ffcf8a' : '#8fd3ff';
              glow.box([face, y, wz], [0.04, 0.6, 0.55], col);
            }
          }
        }
        z -= d + rnd(4, 14);
      }
    }
  });

  return {
    sky,
    update(dz, cameraPos) {
      roadMat.diffuseMapOffset = new Vec2(0, (roadMat.diffuseMapOffset.y + dz / TILE) % 1);
      roadMat.update();
      for (const s of scrollers) {
        s.offset = (s.offset + dz) % s.period;
        s.e.setPosition(0, 0, 30 + s.offset);
      }
      sky.setPosition(cameraPos);
    },
  };
}
