import { Mesh, PRIMITIVE_TRIANGLES } from 'playcanvas';

const hexRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/**
 * Accumulates flat-shaded, vertex-coloured parts into one mesh, so a whole car (or a whole row of
 * street lamps) is a single draw call. All shapes are placed with an offset; polygons are oriented
 * away from the given "inside" point so normals face out without caring about winding.
 */
export class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
  }

  polygon(pts, color, inside) {
    const u = pts[1].map((v, i) => v - pts[0][i]);
    const w = pts[2].map((v, i) => v - pts[0][i]);
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const c = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length - inside[i]);
    if (n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0) {
      pts = [...pts].reverse();
      n = n.map((v) => -v);
    }
    const len = Math.hypot(...n) || 1;
    const rgb = hexRgb(color);
    const base = this.positions.length / 3;
    for (const p of pts) {
      this.positions.push(...p);
      this.normals.push(n[0] / len, n[1] / len, n[2] / len);
      this.colors.push(rgb[0], rgb[1], rgb[2], 255);
    }
    for (let i = 1; i < pts.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
    return this;
  }

  /** Box with chamfered edges. c = centre, h = half extents, b = bevel. */
  box(c, h, color, b = 0) {
    const inner = h.map((v) => v - b);
    const at = (v) => v.map((x, i) => x + c[i]);
    const signs = [-1, 1];
    for (let a = 0; a < 3; a++) {
      const [p, q] = [0, 1, 2].filter((i) => i !== a);
      for (const s of signs) {
        this.polygon(
          [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sp, sq]) => {
            const v = [0, 0, 0];
            v[a] = s * h[a];
            v[p] = sp * inner[p];
            v[q] = sq * inner[q];
            return at(v);
          }),
          color,
          c
        );
      }
    }
    if (b <= 0) return this;
    for (let a = 0; a < 3; a++) {
      for (let k = a + 1; k < 3; k++) {
        const t = 3 - a - k;
        for (const sa of signs) {
          for (const sk of signs) {
            const mk = (aFull, st) => {
              const v = [0, 0, 0];
              v[a] = sa * (aFull ? h[a] : inner[a]);
              v[k] = sk * (aFull ? inner[k] : h[k]);
              v[t] = st * inner[t];
              return at(v);
            };
            this.polygon([mk(true, -1), mk(true, 1), mk(false, 1), mk(false, -1)], color, c);
          }
        }
      }
    }
    for (const sx of signs) {
      for (const sy of signs) {
        for (const sz of signs) {
          const s = [sx, sy, sz];
          this.polygon([0, 1, 2].map((full) => at(s.map((sign, i) => sign * (i === full ? h[i] : inner[i])))), color, c);
        }
      }
    }
    return this;
  }

  /** Octagonal loft along z: sections { z, w, h, y } (half width/height, centre height), offset by c. */
  loft(sections, color, c = [0, 0, 0], chamfer = 0.38) {
    const ring = ({ z, w, h, y }) => {
      const cw = w * chamfer;
      const ch = h * chamfer;
      return [
        [w - cw, y + h], [w, y + h - ch], [w, y - h + ch], [w - cw, y - h],
        [-w + cw, y - h], [-w, y - h + ch], [-w, y + h - ch], [-w + cw, y + h],
      ].map(([x, yy]) => [x + c[0], yy + c[1], z + c[2]]);
    };
    const rings = sections.map(ring);
    for (let s = 0; s < rings.length - 1; s++) {
      const inside = [c[0], (sections[s].y + sections[s + 1].y) / 2 + c[1], (sections[s].z + sections[s + 1].z) / 2 + c[2]];
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        this.polygon([rings[s][i], rings[s][j], rings[s + 1][j], rings[s + 1][i]], color, inside);
      }
    }
    const first = sections[0];
    const last = sections[sections.length - 1];
    this.polygon(rings[0], color, [c[0], first.y + c[1], first.z + 1 + c[2]]);
    this.polygon(rings[rings.length - 1], color, [c[0], last.y + c[1], last.z - 1 + c[2]]);
    return this;
  }

  /** Wheel: an n-sided prism along the x axis. */
  wheel(c, radius, halfWidth, color, sides = 10) {
    const ring = (x) =>
      Array.from({ length: sides }, (_, i) => {
        const a = (i / sides) * Math.PI * 2;
        return [c[0] + x, c[1] + Math.cos(a) * radius, c[2] + Math.sin(a) * radius];
      });
    const l = ring(-halfWidth);
    const r = ring(halfWidth);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.polygon([l[i], l[j], r[j], r[i]], color, c);
    }
    this.polygon(l, color, [c[0] + 1, c[1], c[2]]);
    this.polygon(r, color, [c[0] - 1, c[1], c[2]]);
    return this;
  }

  /** Flat quad (e.g. a light pool on the road): four points, normal facing toward `towards`. */
  quad(pts, color, towards) {
    const c = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / 4);
    return this.polygon(pts, color, c.map((v, i) => v - (towards[i] - v)));
  }

  build(device) {
    const mesh = new Mesh(device);
    mesh.setPositions(this.positions);
    mesh.setNormals(this.normals);
    mesh.setColors32(this.colors);
    mesh.setIndices(this.indices);
    mesh.update(PRIMITIVE_TRIANGLES);
    mesh.incRefCount(); // shared by many entities; never free it when one is destroyed
    return mesh;
  }
}
