import { Color, Mesh, PRIMITIVE_TRIANGLES, StandardMaterial } from 'playcanvas';

// Jewel tones that stay distinct from each other and readable on the navy board
export const PALETTE = ['#ff4d5e', '#ff9f1c', '#ffd23f', '#3ddc84', '#22c7d6', '#3a86ff', '#8b5cf6', '#ff5fa2'];
// Emoji closest to each palette colour, for the shareable result grid
export const PALETTE_EMOJI = ['🟥', '🟧', '🟨', '🟩', '🟦', '🟦', '🟪', '🟪'];

const hexToColor = (hex, scale = 1) =>
  new Color(
    (parseInt(hex.slice(1, 3), 16) / 255) * scale,
    (parseInt(hex.slice(3, 5), 16) / 255) * scale,
    (parseInt(hex.slice(5, 7), 16) / 255) * scale
  );

/**
 * A box with chamfered edges and corners and flat shading, so every block catches a highlight
 * along its bevels. h = half extents [x, y, z], b = bevel size.
 */
export function createBeveledBox(device, h, b) {
  const positions = [];
  const normals = [];
  const indices = [];
  const inner = h.map((v) => v - b);

  const point = (axisValues) => axisValues;
  const addPolygon = (pts) => {
    // Orient outward: the shape is centred on the origin, so the polygon's centroid points out
    const centroid = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);
    const u = pts[1].map((v, i) => v - pts[0][i]);
    const w = pts[2].map((v, i) => v - pts[0][i]);
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (n[0] * centroid[0] + n[1] * centroid[1] + n[2] * centroid[2] < 0) {
      pts = [...pts].reverse();
      n = n.map((v) => -v);
    }
    const len = Math.hypot(...n);
    const base = positions.length / 3;
    for (const p of pts) {
      positions.push(...p);
      normals.push(n[0] / len, n[1] / len, n[2] / len);
    }
    for (let i = 1; i < pts.length - 1; i++) indices.push(base, base + i, base + i + 1);
  };

  const signs = [-1, 1];
  // 6 faces
  for (let a = 0; a < 3; a++) {
    const [p, q] = [0, 1, 2].filter((i) => i !== a);
    for (const s of signs) {
      const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sp, sq]) => {
        const v = [0, 0, 0];
        v[a] = s * h[a];
        v[p] = sp * inner[p];
        v[q] = sq * inner[q];
        return point(v);
      });
      addPolygon(quad);
    }
  }
  // 12 edge bevels
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
          addPolygon([mk(true, -1), mk(true, 1), mk(false, 1), mk(false, -1)]);
        }
      }
    }
  }
  // 8 corner triangles
  for (const sx of signs) {
    for (const sy of signs) {
      for (const sz of signs) {
        const s = [sx, sy, sz];
        addPolygon(
          [0, 1, 2].map((full) => s.map((sign, i) => sign * (i === full ? h[i] : inner[i])))
        );
      }
    }
  }

  const mesh = new Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setIndices(indices);
  mesh.update(PRIMITIVE_TRIANGLES);
  // Shared by many short-lived entities: hold a reference so the mesh isn't freed whenever the
  // last MeshInstance using it is destroyed (e.g. between clearing the board and dealing)
  mesh.incRefCount();
  return mesh;
}

export function createBlockMaterials() {
  return PALETTE.map((hex) => {
    const mat = new StandardMaterial();
    mat.diffuse = hexToColor(hex);
    mat.emissive = hexToColor(hex, 0.12);
    mat.specular = new Color(0.35, 0.35, 0.35);
    mat.gloss = 0.72;
    mat.update();
    return mat;
  });
}

export function createFlatMaterial(hex, { emissive = 0, opacity = 1, brightness = 1 } = {}) {
  const mat = new StandardMaterial();
  mat.diffuse = hexToColor(hex, brightness);
  mat.emissive = hexToColor(hex, emissive);
  mat.specular = new Color(0.08, 0.08, 0.08);
  mat.gloss = 0.4;
  mat.opacity = opacity;
  mat.update();
  return mat;
}
