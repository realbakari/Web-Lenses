import {
  ADDRESS_CLAMP_TO_EDGE,
  ADDRESS_REPEAT,
  BLEND_ADDITIVE,
  CULLFACE_FRONT,
  CULLFACE_NONE,
  Color,
  Entity,
  MeshInstance,
  StandardMaterial,
  Texture,
} from 'playcanvas';
import { createStreakMesh } from './meshes.js';

// Each sector of the galaxy gets its own nebula. Names are invented for this game.
export const SECTORS = [
  { name: 'Halcyon Drift', colors: ['#3b2a8f', '#1d6fb8', '#7a2c8f'], rock: '#7d7a86' },
  { name: 'Ember Reach', colors: ['#8f2a3a', '#c2582a', '#4a1f6e'], rock: '#8a6f62' },
  { name: 'Verdant Veil', colors: ['#1d7a6a', '#2c4f9e', '#5aa85a'], rock: '#6f8077' },
  { name: 'Aurelian Gate', colors: ['#a8742a', '#7a2a6e', '#2a4f8f'], rock: '#8a7f6a' },
  { name: 'Hollow Crown', colors: ['#5a2a9e', '#9e2a6e', '#1d3f7a'], rock: '#7a6f8a' },
];

/** Paints an equirectangular nebula with stars. Blobs wrap horizontally so there's no seam. */
function paintNebula(ctx, w, h, colors, rng) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#04050c';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const x = rng() * w;
    const y = h * (0.25 + rng() * 0.5);
    const r = 40 + rng() ** 2 * 260;
    const color = colors[Math.floor(rng() * colors.length)];
    const alpha = 0.05 + rng() * 0.12;
    for (const dx of [-w, 0, w]) {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      g.addColorStop(0, color + Math.round(alpha * 255).toString(16).padStart(2, '0'));
      g.addColorStop(1, color + '00');
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  }
}

/** Distant stars as tiny crosses on a far shell: crisp at any field of view, unlike texture stars. */
export function createDistantStars(app, count, rng) {
  const { mesh, positions } = createStreakMesh(app.graphicsDevice, count);
  for (let i = 0; i < count; i++) {
    const u = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const r = 480;
    const x = Math.sqrt(1 - u * u) * Math.cos(a) * r;
    const y = u * r;
    const z = Math.sqrt(1 - u * u) * Math.sin(a) * r;
    const s = 0.35 + rng() ** 4 * 1.4;
    const o = i * 24;
    // A small square facing the centre (tangent basis from the radial direction), drawn twice
    const n = [x / r, y / r, z / r];
    const up = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t1 = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
    const l1 = Math.hypot(...t1);
    const tu = t1.map((v) => (v / l1) * s);
    const tv = [n[1] * tu[2] - n[2] * tu[1], n[2] * tu[0] - n[0] * tu[2], n[0] * tu[1] - n[1] * tu[0]];
    const corner = (a, b) => [x + tu[0] * a + tv[0] * b, y + tu[1] * a + tv[1] * b, z + tu[2] * a + tv[2] * b];
    const face = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const quad = [...face, ...face];
    quad.forEach((p, j) => {
      positions[o + j * 3] = p[0];
      positions[o + j * 3 + 1] = p[1];
      positions[o + j * 3 + 2] = p[2];
    });
  }
  mesh.setPositions(positions);
  mesh.update(undefined, false);
  const material = new StandardMaterial();
  material.useLighting = false;
  material.useFog = false;
  material.diffuse = new Color(0, 0, 0);
  material.emissive = new Color(0.9, 0.95, 1);
  material.emissiveIntensity = 1.4;
  material.blendType = BLEND_ADDITIVE;
  material.depthWrite = false;
  material.cull = CULLFACE_NONE;
  material.update();
  const entity = new Entity('distant-stars');
  const instance = new MeshInstance(mesh, material);
  instance.cull = false;
  entity.addComponent('render', { meshInstances: [instance] });
  app.root.addChild(entity);
  return entity;
}

export function createSky(app) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const softCanvas = document.createElement('canvas');
  softCanvas.width = canvas.width;
  softCanvas.height = canvas.height;
  const soft = softCanvas.getContext('2d');
  const texture = new Texture(app.graphicsDevice, {
    width: 1024,
    height: 512,
    addressU: ADDRESS_REPEAT,
    addressV: ADDRESS_CLAMP_TO_EDGE,
    mipmaps: true,
  });

  const material = new StandardMaterial();
  material.useLighting = false;
  material.useFog = false;
  material.diffuse = new Color(0, 0, 0);
  material.emissive = new Color(0.62, 0.62, 0.66); // keep space deep; the nebula is a backdrop
  material.emissiveMap = texture;
  material.cull = CULLFACE_FRONT; // seen from inside
  material.depthWrite = false;
  material.update();

  const sky = new Entity('sky');
  sky.addComponent('render', { type: 'sphere', material, castShadows: false });
  sky.setLocalScale(600, 600, 600);
  app.root.addChild(sky);

  return {
    entity: sky,
    paint(sector, rng) {
      paintNebula(ctx, canvas.width, canvas.height, sector.colors, rng);
      // Soften: the texture is magnified ~6× on screen, so it must hold no hard detail
      soft.filter = 'blur(6px)';
      soft.drawImage(canvas, 0, 0);
      texture.setSource(softCanvas);
    },
  };
}

/** Stars rushing past. stretch = streak length per unit of speed (big during hyperspace). */
export function createStarfield(app, count, rng) {
  const { mesh, positions } = createStreakMesh(app.graphicsDevice, count);
  const material = new StandardMaterial();
  material.useLighting = false;
  material.useFog = false;
  material.diffuse = new Color(0, 0, 0);
  material.emissive = new Color(0.85, 0.92, 1);
  material.blendType = BLEND_ADDITIVE;
  material.depthWrite = false;
  material.cull = CULLFACE_NONE;
  material.update();
  const entity = new Entity('stars');
  const instance = new MeshInstance(mesh, material);
  instance.cull = false; // vertices move every frame; the creation-time bounds are meaningless
  entity.addComponent('render', { meshInstances: [instance] });
  app.root.addChild(entity);

  const stars = Array.from({ length: count }, () => ({
    x: (rng() - 0.5) * 70,
    y: (rng() - 0.5) * 50,
    z: -rng() * 160,
  }));

  return {
    material,
    update(dt, speed, stretch, originX, originY) {
      const w = 0.02;
      for (let i = 0; i < count; i++) {
        const s = stars[i];
        s.z += speed * dt;
        if (s.z > 12) {
          s.z -= 172;
          s.x = originX + (rng() - 0.5) * 70;
          s.y = originY + (rng() - 0.5) * 50;
        }
        // Keep a clear tunnel around the ship so streaks don't cross the camera
        const len = 0.4 + speed * stretch;
        const z0 = s.z;
        const z1 = s.z - len;
        const o = i * 24;
        const quad = [
          [s.x - w, s.y, z0], [s.x + w, s.y, z0], [s.x + w, s.y, z1], [s.x - w, s.y, z1],
          [s.x, s.y - w, z0], [s.x, s.y + w, z0], [s.x, s.y + w, z1], [s.x, s.y - w, z1],
        ];
        quad.forEach((p, j) => {
          positions[o + j * 3] = p[0];
          positions[o + j * 3 + 1] = p[1];
          positions[o + j * 3 + 2] = p[2];
        });
      }
      mesh.setPositions(positions);
      mesh.update(undefined, false);
    },
  };
}
