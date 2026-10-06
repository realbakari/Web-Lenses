import { Asset, BLEND_ADDITIVE, BLEND_NORMAL, BoundingBox, CULLFACE_NONE, Color, Entity, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';
import { createBeveledBox, createExtrusion, createLoft } from './meshes.js';

const hex = (h, k = 1) =>
  new Color((parseInt(h.slice(1, 3), 16) / 255) * k, (parseInt(h.slice(3, 5), 16) / 255) * k, (parseInt(h.slice(5, 7), 16) / 255) * k);

function paint(color, { gloss = 0.6, metal = 0.2, emissive = 0 } = {}) {
  const m = new StandardMaterial();
  m.diffuse = hex(color);
  m.useMetalness = true;
  m.metalness = metal;
  m.gloss = gloss;
  m.emissive = hex(color, emissive);
  m.update();
  return m;
}

export function glow(color, intensity = 1) {
  const m = new StandardMaterial();
  m.useLighting = false;
  m.useFog = false;
  m.diffuse = new Color(0, 0, 0);
  m.emissive = hex(color);
  m.emissiveIntensity = intensity;
  m.blendType = BLEND_ADDITIVE;
  m.depthWrite = false;
  m.update();
  return m;
}

function part(parent, name, { type, mesh, material, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0] }) {
  const e = new Entity(name);
  if (mesh) e.addComponent('render', { meshInstances: [new MeshInstance(mesh, material)] });
  else e.addComponent('render', { type, material });
  e.setLocalPosition(...pos);
  e.setLocalScale(...scale);
  e.setLocalEulerAngles(...rot);
  parent.addChild(e);
  return e;
}

/**
 * A generic starfighter facing -Z (about 4.2 long): a lofted needle-nosed fuselage, swept delta
 * wings with tip cannons, twin canted tail fins, engine nacelles with glowing exhausts, and a
 * teardrop canopy set forward over the pilot.
 */
export function createShip(app) {
  const device = app.graphicsDevice;
  const root = new Entity('ship');
  app.root.addChild(root);
  const body = new Entity('ship-body'); // banks and pitches; root only translates
  root.addChild(body);

  const hull = paint('#e6ebf1', { gloss: 0.72, metal: 0.15 });
  const graphite = paint('#262b36', { gloss: 0.55, metal: 0.55 });
  const accent = paint('#ff7a2f', { gloss: 0.6, emissive: 0.3 });
  for (const m of [hull, graphite, accent]) {
    m.cull = CULLFACE_NONE;
    m.update();
  }

  // Fuselage: needle nose → cockpit swell → engine block → tail
  const fuselage = createLoft(device, [
    { z: -2.35, w: 0.02, h: 0.02, y: -0.04 },
    { z: -1.9, w: 0.14, h: 0.09, y: -0.03 },
    { z: -1.25, w: 0.27, h: 0.17, y: 0 },
    { z: -0.45, w: 0.36, h: 0.23, y: 0.02 },
    { z: 0.45, w: 0.44, h: 0.24, y: 0 },
    { z: 1.35, w: 0.42, h: 0.2, y: -0.01 },
    { z: 1.7, w: 0.34, h: 0.16, y: -0.01 },
  ]);
  part(body, 'fuselage', { mesh: fuselage, material: hull });
  // Dark nose cap and a spine stripe for contrast at small sizes
  part(body, 'nose-cap', {
    mesh: createLoft(device, [
      { z: -2.37, w: 0.02, h: 0.02, y: -0.04 },
      { z: -2.0, w: 0.125, h: 0.085, y: -0.03 },
    ]),
    material: accent,
  });

  // Swept delta wings (right-hand outline, mirrored by scale)
  const wing = createExtrusion(device, [[0.3, -0.55], [1.95, 0.75], [2.05, 1.12], [0.3, 1.45]], 0.07);
  const stripe = createExtrusion(device, [[0.75, 0.05], [1.55, 0.72], [1.6, 0.86], [0.75, 0.3]], 0.08);
  const cannons = [];
  for (const side of [-1, 1]) {
    const w = new Entity('wing');
    w.setLocalPosition(0, -0.06, 0);
    w.setLocalScale(side, 1, 1);
    w.setLocalEulerAngles(0, 0, side * -4); // slight anhedral
    body.addChild(w);
    part(w, 'wing-panel', { mesh: wing, material: graphite });
    part(w, 'wing-stripe', { mesh: stripe, material: accent });
    part(w, 'cannon', { type: 'cylinder', material: hull, pos: [2.02, 0, 0.35], scale: [0.09, 1.7, 0.09], rot: [90, 0, 0] });
    part(w, 'cannon-tip', { type: 'cylinder', material: graphite, pos: [2.02, 0, -0.55], scale: [0.06, 0.25, 0.06], rot: [90, 0, 0] });
    const muzzle = new Entity('muzzle');
    muzzle.setLocalPosition(2.02, 0, -0.7);
    w.addChild(muzzle);
    cannons.push(muzzle);

    // Tail fin, canted outward
    const fin = new Entity('fin');
    fin.setLocalPosition(side * 0.3, 0.18, 0);
    fin.setLocalEulerAngles(0, 0, side * -18);
    body.addChild(fin);
    part(fin, 'fin-panel', {
      mesh: createExtrusion(device, [[0, 0.75], [0, 1.65], [0.62, 1.7], [0.62, 1.35]], 0.06),
      material: graphite,
      rot: [0, 0, 90],
    });

    // Engine nacelle
    part(body, 'nacelle', {
      mesh: createLoft(device, [
        { z: 0.3, w: 0.12, h: 0.12, y: 0 },
        { z: 0.6, w: 0.21, h: 0.21, y: 0 },
        { z: 1.75, w: 0.21, h: 0.21, y: 0 },
        { z: 1.9, w: 0.18, h: 0.18, y: 0 },
      ]),
      material: graphite,
      pos: [side * 0.56, -0.08, 0],
    });
  }

  // Exhaust: an additive core plus a softer plume; scaled each frame with thrust
  const exhaust = [];
  for (const side of [-1, 1]) {
    const core = part(body, 'exhaust-core', { type: 'sphere', material: glow('#9be8ff', 2.2), pos: [side * 0.56, -0.08, 1.95], scale: [0.26, 0.26, 0.26] });
    const plume = part(body, 'exhaust-plume', { type: 'cone', material: glow('#3aa8ff', 0.9), pos: [side * 0.56, -0.08, 2.4], scale: [0.3, 0.9, 0.3], rot: [90, 0, 0] });
    exhaust.push({ core, plume });
  }

  // Cockpit: pilot first, then glass so the glass blends over them
  const pilotMount = new Entity('pilot-mount');
  pilotMount.setLocalPosition(0, 0.2, -0.5);
  body.addChild(pilotMount);
  const fallbackPilot = createHelmetPilot(device);
  fallbackPilot.setLocalScale(0.85, 0.85, 0.85);
  pilotMount.addChild(fallbackPilot);

  const glass = new StandardMaterial();
  glass.diffuse = new Color(0.05, 0.12, 0.2);
  glass.specular = new Color(1, 1, 1);
  glass.gloss = 0.92;
  glass.opacity = 0.32;
  glass.blendType = BLEND_NORMAL;
  glass.depthWrite = false;
  glass.update();
  part(body, 'canopy', { type: 'sphere', material: glass, pos: [0, 0.24, -0.5], scale: [0.5, 0.46, 1.25] });
  part(body, 'canopy-frame', { type: 'cylinder', material: graphite, pos: [0, 0.24, -0.5], scale: [0.04, 1.24, 0.47], rot: [90, 0, 0] });

  return { root, body, cannons, exhaust, pilotMount, fallbackPilot };
}

/** Default pilot (no Bitmoji, desktop stub, or failed load): white helmet, amber visor. */
function createHelmetPilot(device) {
  const pilot = new Entity('pilot-default');
  const suit = paint('#d9dde4', { gloss: 0.5 });
  const visor = paint('#1a1206', { gloss: 0.95, metal: 0.9 });
  visor.emissive = hex('#ff9a3a', 0.35);
  visor.update();
  part(pilot, 'shoulders', { mesh: createBeveledBox(device, [0.26, 0.1, 0.14], 0.07), material: suit, pos: [0, -0.14, 0.02] });
  part(pilot, 'helmet', { type: 'sphere', material: suit, pos: [0, 0.1, 0], scale: [0.34, 0.36, 0.36] });
  part(pilot, 'visor', { type: 'sphere', material: visor, pos: [0, 0.11, -0.07], scale: [0.27, 0.19, 0.26] });
  return pilot;
}

/**
 * Seats a loaded Bitmoji GLB in the cockpit. The rig's size and pivot aren't documented, so it is
 * measured: scaled to a fixed height, then raised so the head sits just under the canopy top and the
 * body below the shoulders is hidden inside the cockpit tub.
 */
export function seatAvatar(ship, containerAsset) {
  const avatar = containerAsset.resource.instantiateRenderEntity();
  const bounds = new BoundingBox();
  let first = true;
  for (const render of avatar.findComponents('render')) {
    for (const mi of render.meshInstances) {
      if (first) bounds.copy(mi.aabb);
      else bounds.add(mi.aabb);
      first = false;
    }
  }
  if (first) return null;

  const HEIGHT = 0.95;
  const size = bounds.halfExtents.y * 2 || 1;
  const k = HEIGHT / size;
  avatar.setLocalScale(k, k, k);
  avatar.setLocalEulerAngles(0, 180, 0); // glTF faces +Z; the ship faces -Z
  const top = bounds.center.y + bounds.halfExtents.y;
  // After the 180° turn, x and z of the measured centre flip sign, so this recentres it
  avatar.setLocalPosition(bounds.center.x * k, 0.36 - top * k, bounds.center.z * k);

  ship.fallbackPilot.enabled = false;
  ship.pilotMount.addChild(avatar);
  return avatar;
}

export function loadContainer(app, name, url) {
  return new Promise((resolve, reject) => {
    const asset = new Asset(name, 'container', { url });
    asset.ready(() => resolve(asset));
    asset.once('error', (err) => {
      app.assets.remove(asset);
      reject(err);
    });
    app.assets.add(asset);
    app.assets.load(asset);
  });
}

export const tmpVec = new Vec3();
