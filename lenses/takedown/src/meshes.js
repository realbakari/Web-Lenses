import { Mesh, PRIMITIVE_TRIANGLES } from 'playcanvas';

// Shared meshes outlive the entities using them: hold a reference so PlayCanvas doesn't free a
// mesh when the last MeshInstance using it is destroyed.
function finish(device, positions, normals, indices, uvs) {
  const mesh = new Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  if (uvs) mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(PRIMITIVE_TRIANGLES);
  mesh.incRefCount();
  return mesh;
}

// Flat-shaded polygons from point lists, oriented away from the origin
function polygonBuilder() {
  const positions = [];
  const normals = [];
  const indices = [];
  const add = (pts) => {
    const centroid = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);
    const u = pts[1].map((v, i) => v - pts[0][i]);
    const w = pts[2].map((v, i) => v - pts[0][i]);
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (n[0] * centroid[0] + n[1] * centroid[1] + n[2] * centroid[2] < 0) {
      pts = [...pts].reverse();
      n = n.map((v) => -v);
    }
    const len = Math.hypot(...n) || 1;
    const base = positions.length / 3;
    for (const p of pts) {
      positions.push(...p);
      normals.push(n[0] / len, n[1] / len, n[2] / len);
    }
    for (let i = 1; i < pts.length - 1; i++) indices.push(base, base + i, base + i + 1);
  };
  return { add, positions, normals, indices };
}

/** Box with chamfered edges and corners; h = half extents, b = bevel. */
export function createBeveledBox(device, h, b) {
  const g = polygonBuilder();
  const inner = h.map((v) => v - b);
  const signs = [-1, 1];
  for (let a = 0; a < 3; a++) {
    const [p, q] = [0, 1, 2].filter((i) => i !== a);
    for (const s of signs) {
      g.add(
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sp, sq]) => {
          const v = [0, 0, 0];
          v[a] = s * h[a];
          v[p] = sp * inner[p];
          v[q] = sq * inner[q];
          return v;
        })
      );
    }
  }
  for (let a = 0; a < 3; a++) {
    for (let c = a + 1; c < 3; c++) {
      const t = 3 - a - c;
      for (const sa of signs) {
        for (const sc of signs) {
          const mk = (aFull, st) => {
            const v = [0, 0, 0];
            v[a] = sa * (aFull ? h[a] : inner[a]);
            v[c] = sc * (aFull ? inner[c] : h[c]);
            v[t] = st * inner[t];
            return v;
          };
          g.add([mk(true, -1), mk(true, 1), mk(false, 1), mk(false, -1)]);
        }
      }
    }
  }
  for (const sx of signs) {
    for (const sy of signs) {
      for (const sz of signs) {
        const s = [sx, sy, sz];
        g.add([0, 1, 2].map((full) => s.map((sign, i) => sign * (i === full ? h[i] : inner[i]))));
      }
    }
  }
  return finish(device, g.positions, g.normals, g.indices);
}

/** Lumpy, faceted rock: a subdivided icosahedron with seeded radial noise. */
export function createAsteroid(device, rng) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
    [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5],
    [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < 2; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!cache.has(key)) {
        const m = verts[a].map((v, i) => (v + verts[b][i]) / 2);
        const l = Math.hypot(...m);
        verts.push(m.map((x) => x / l));
        cache.set(key, verts.length - 1);
      }
      return cache.get(key);
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  // A few big dents and bumps, then fine grit
  const lumps = Array.from({ length: 7 }, () => {
    const d = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
    const l = Math.hypot(...d);
    return { dir: d.map((x) => x / l), amp: (rng() - 0.4) * 0.5 };
  });
  verts = verts.map((v) => {
    let r = 1;
    for (const { dir, amp } of lumps) {
      const dot = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
      r += amp * Math.max(0, dot) ** 3;
    }
    r += (rng() - 0.5) * 0.08;
    return v.map((x) => x * r);
  });
  const g = polygonBuilder();
  for (const [a, b, c] of faces) g.add([verts[a], verts[b], verts[c]]);
  return finish(device, g.positions, g.normals, g.indices);
}

/** Star streaks: two crossed quads per star so they read from any angle. Positions update per frame. */
export function createStreakMesh(device, count) {
  const mesh = new Mesh(device);
  const positions = new Float32Array(count * 8 * 3);
  const indices = [];
  for (let i = 0; i < count; i++) {
    const b = i * 8;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 5, b + 6, b + 4, b + 6, b + 7);
  }
  mesh.setPositions(positions);
  mesh.setIndices(indices);
  mesh.update(PRIMITIVE_TRIANGLES, false);
  mesh.incRefCount();
  return { mesh, positions };
}

/**
 * Lofted hull: octagonal cross-sections along z (each { z, w, h, y } = half width, half height,
 * centre height), joined with flat-shaded quads and capped at both ends. Gives a tapered body
 * with chined edges, like a fighter's fuselage.
 */
export function createLoft(device, sections, chamfer = 0.38) {
  const ring = ({ z, w, h, y }) => {
    const cw = w * chamfer;
    const ch = h * chamfer;
    return [
      [w - cw, y + h], [w, y + h - ch], [w, y - h + ch], [w - cw, y - h],
      [-w + cw, y - h], [-w, y - h + ch], [-w, y + h - ch], [-w + cw, y + h],
    ].map(([x, yy]) => [x, yy, z]);
  };
  const positions = [];
  const normals = [];
  const indices = [];
  const face = (pts, outward) => {
    const u = pts[1].map((v, i) => v - pts[0][i]);
    const w = pts[2].map((v, i) => v - pts[0][i]);
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) {
      pts = [...pts].reverse();
      n = n.map((v) => -v);
    }
    const len = Math.hypot(...n) || 1;
    const base = positions.length / 3;
    for (const p of pts) {
      positions.push(...p);
      normals.push(n[0] / len, n[1] / len, n[2] / len);
    }
    for (let i = 1; i < pts.length - 1; i++) indices.push(base, base + i, base + i + 1);
  };
  const rings = sections.map(ring);
  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s];
    const b = rings[s + 1];
    const cy = (sections[s].y + sections[s + 1].y) / 2;
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      const mid = [(a[i][0] + a[j][0]) / 2, (a[i][1] + a[j][1]) / 2 - cy, 0];
      face([a[i], a[j], b[j], b[i]], mid);
    }
  }
  face(rings[0], [0, 0, -1]);
  face(rings[rings.length - 1], [0, 0, 1]);
  const mesh = new Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setIndices(indices);
  mesh.update(PRIMITIVE_TRIANGLES);
  mesh.incRefCount();
  return mesh;
}

/** A flat outline in the XZ plane ([x, z] points, convex), extruded to thickness t: wings, fins. */
export function createExtrusion(device, outline, t) {
  const positions = [];
  const normals = [];
  const indices = [];
  const push = (pts, n) => {
    const base = positions.length / 3;
    for (const p of pts) {
      positions.push(...p);
      normals.push(...n);
    }
    for (let i = 1; i < pts.length - 1; i++) indices.push(base, base + i, base + i + 1);
  };
  // Make the outline counter-clockwise seen from above (+y), so the top face points up
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x1, z1] = outline[i];
    const [x2, z2] = outline[(i + 1) % outline.length];
    area += x1 * z2 - x2 * z1;
  }
  const pts = area > 0 ? [...outline].reverse() : outline;
  const cx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const cz = pts.reduce((a, [, z]) => a + z, 0) / pts.length;
  const top = pts.map(([x, z]) => [x, t / 2, z]);
  const bottom = pts.map(([x, z]) => [x, -t / 2, z]);
  push(top, [0, 1, 0]);
  push([...bottom].reverse(), [0, -1, 0]);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[j];
    let n = [z2 - z1, 0, x1 - x2];
    const l = Math.hypot(...n) || 1;
    // Point the side normal away from the outline's centre
    const mx = (x1 + x2) / 2 - cx;
    const mz = (z1 + z2) / 2 - cz;
    if (n[0] * mx + n[2] * mz < 0) n = n.map((v) => -v);
    push([top[i], bottom[i], bottom[j], top[j]], n.map((v) => v / l));
  }
  const mesh = new Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setIndices(indices);
  mesh.update(PRIMITIVE_TRIANGLES);
  mesh.incRefCount();
  return mesh;
}
