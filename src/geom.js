// Small geometry toolkit: vectors, normals, sweeps. Units are millimetres.

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const norm = (a) => {
  const l = len(a) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};
export const lerp = (a, b, t) => v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Rotation used by the surveyor table: Container3D Euler applies Z, then Y, then X about parent axes,
// so R = Rx(ap) * Rz(lat).
export function tiltRotate(p, ap, lat) {
  const cz = Math.cos(lat), sz = Math.sin(lat);
  const x1 = p.x * cz - p.y * sz;
  const y1 = p.x * sz + p.y * cz;
  const z1 = p.z;
  const cx = Math.cos(ap), sx = Math.sin(ap);
  return v3(x1, y1 * cx - z1 * sx, y1 * sx + z1 * cx);
}
export function tiltInverse(p, ap, lat) {
  const cx = Math.cos(-ap), sx = Math.sin(-ap);
  const y1 = p.y * cx - p.z * sx;
  const z1 = p.y * sx + p.z * cx;
  const cz = Math.cos(-lat), sz = Math.sin(-lat);
  return v3(p.x * cz - y1 * sz, p.x * sz + y1 * cz, z1);
}

export function computeNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] += nx; n[k + 1] += ny; n[k + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/**
 * Grid surface from rows of points (rows x cols). Faces wound so normals point to the side
 * given by `flip` (try both; normals are computed from winding).
 */
export function gridMesh(rows, { closeCols = false, flip = false } = {}) {
  const R = rows.length, C = rows[0].length;
  const positions = new Float32Array(R * C * 3);
  let k = 0;
  for (const row of rows) for (const p of row) { positions[k++] = p.x; positions[k++] = p.y; positions[k++] = p.z; }
  const idx = [];
  const cc = closeCols ? C : C - 1;
  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < cc; c++) {
      const c2 = (c + 1) % C;
      const a = r * C + c, b = r * C + c2, d = (r + 1) * C + c, e = (r + 1) * C + c2;
      if (flip) idx.push(a, b, d, b, e, d);
      else idx.push(a, d, b, b, d, e);
    }
  }
  const indices = new Uint32Array(idx);
  return { positions, indices, normals: computeNormals(positions, indices) };
}

/** Sweep a circle/ellipse along a polyline. radius(t) or {rx, ry}(t) with t in 0..1. */
export function tube(points, radiusFn, { seg = 10, flatten = 1, up = v3(0, 1, 0), caps = true } = {}) {
  const n = points.length;
  if (n < 2) return null;
  // cumulative length for t
  const L = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + len(sub(points[i], points[i - 1])));
  const total = L[n - 1] || 1;
  const rows = [];
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const t = L[i] / total;
    const tan = norm(sub(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]));
    let nrm;
    if (prevN) {
      // parallel transport
      nrm = norm(sub(prevN, mul(tan, dot(prevN, tan))));
    } else {
      let ref = Math.abs(dot(tan, up)) > 0.9 ? v3(1, 0, 0) : up;
      nrm = norm(cross(cross(tan, ref), tan));
    }
    prevN = nrm;
    const bin = cross(tan, nrm);
    const r = radiusFn(t);
    const rx = typeof r === 'number' ? r : r.rx;
    const ry = typeof r === 'number' ? r * flatten : r.ry;
    const row = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      row.push(add(points[i], add(mul(nrm, Math.cos(a) * ry), mul(bin, Math.sin(a) * rx))));
    }
    rows.push(row);
  }
  let g = gridMesh(rows, { closeCols: true });
  // make sure normals point outward
  const radial = sub(rows[0][0], points[0]);
  const n0 = v3(g.normals[0], g.normals[1], g.normals[2]);
  if (dot(radial, n0) < 0) g = gridMesh(rows, { closeCols: true, flip: true });
  if (!caps) return g;
  // add end caps as fans
  const pos = Array.from(g.positions), ind = Array.from(g.indices);
  const addCap = (rowIdx, center, flip) => {
    const ci = pos.length / 3;
    pos.push(center.x, center.y, center.z);
    for (let j = 0; j < seg; j++) {
      const a = rowIdx * seg + j, b = rowIdx * seg + ((j + 1) % seg);
      if (flip) ind.push(ci, b, a); else ind.push(ci, a, b);
    }
  };
  const flipped = dot(radial, n0) < 0;
  addCap(0, points[0], flipped);
  addCap(n - 1, points[n - 1], !flipped);
  const positions = new Float32Array(pos), indices = new Uint32Array(ind);
  return { positions, indices, normals: computeNormals(positions, indices) };
}

export function mergeMeshes(list) {
  list = list.filter(Boolean);
  let vc = 0, ic = 0;
  for (const m of list) { vc += m.positions.length; ic += m.indices.length; }
  const positions = new Float32Array(vc), normals = new Float32Array(vc), indices = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const m of list) {
    positions.set(m.positions, vo); normals.set(m.normals, vo);
    const base = vo / 3;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
    vo += m.positions.length; io += m.indices.length;
  }
  return { positions, normals, indices };
}
