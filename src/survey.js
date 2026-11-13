// Dental surveyor maths. The analyzing rod is vertical in world space; the cast is tilted on the table.
// For every lathe column of a tooth we find the height of contour (greatest horizontal convexity
// relative to the rod) and the horizontal undercut depth of every point below it.
import { v3, add, sub, mul, norm, tiltRotate, tiltInverse, lerp } from './geom.js';

export const MIN_TIP_ABOVE_CEJ = 1.4; // mm: clasp tips stay clear of the gingival margin

export function surveyTooth(tooth, ap, lat) {
  const { positions, rows, cols, meta, frame } = tooth;
  const nV = positions.length / 3;
  const world = new Float32Array(positions.length);
  for (let k = 0; k < nV; k++) {
    const w = tiltRotate(v3(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]), ap, lat);
    world[k * 3] = w.x; world[k * 3 + 1] = w.y; world[k * 3 + 2] = w.z;
  }
  // rod axis through the crown centre
  let cx = 0, cz = 0, n = 0;
  for (let r = 0; r < rows; r++) {
    if (meta[r].kind !== 'wall') continue;
    for (let c = 0; c < cols; c++) { const k = r * cols + c; cx += world[k * 3]; cz += world[k * 3 + 2]; n++; }
  }
  cx /= n; cz /= n;
  const radius = (k) => Math.hypot(world[k * 3] - cx, world[k * 3 + 2] - cz);

  const depth = new Float32Array(nV);
  const hocRing = new Int32Array(cols);
  const hocR = new Float32Array(cols);
  const wallRows = [];
  for (let r = 0; r < rows; r++) if (meta[r].kind === 'wall') wallRows.push(r);

  for (let c = 0; c < cols; c++) {
    let best = -1, bestR = -Infinity;
    for (const r of wallRows) {
      const rr = radius(r * cols + c);
      if (rr > bestR) { bestR = rr; best = r; }
    }
    hocRing[c] = best;
    hocR[c] = bestR;
    const yH = world[(best * cols + c) * 3 + 1];
    for (let r = 0; r < rows; r++) {
      const k = r * cols + c;
      if (meta[r].kind === 'cap') { depth[k] = 0; continue; }
      const y = world[k * 3 + 1];
      depth[k] = y < yH ? Math.max(0, bestR - radius(k)) : 0;
    }
  }

  const minLocalY = MIN_TIP_ABOVE_CEJ;
  const localY = (r) => meta[r].t * tooth.h;

  /** Point on column c where undercut depth reaches `target` (cast space), searching down from the HOC. */
  function atDepth(c, target) {
    c = ((c % cols) + cols) % cols;
    let prev = hocRing[c];
    let prevD = 0;
    for (let r = hocRing[c] - 1; r >= 0; r--) {
      if (meta[r].kind !== 'wall' || localY(r) < minLocalY) break;
      const d = depth[r * cols + c];
      if (d >= target) {
        const f = (target - prevD) / (d - prevD || 1);
        const p = lerp(castPos(prev, c), castPos(r, c), f);
        return { pos: p, depth: target, ok: true };
      }
      prev = r; prevD = d;
    }
    return { pos: castPos(prev, c), depth: prevD, ok: prevD >= target - 0.03 };
  }
  function maxDepth(c) { return atDepth(c, 99).depth; }
  function castPos(r, c) {
    const k = r * cols + c;
    return v3(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);
  }
  function hocPos(c) {
    c = ((c % cols) + cols) % cols;
    return castPos(hocRing[c], c);
  }
  /** Horizontal outward direction (cast space) at column c, for offsetting clasps off the surface. */
  function outward(c) {
    c = ((c % cols) + cols) % cols;
    const k = hocRing[c] * cols + c;
    const dw = norm(v3(world[k * 3] - cx, 0, world[k * 3 + 2] - cz));
    return tiltInverse(dw, ap, lat);
  }
  function worldOf(p) { return tiltRotate(p, ap, lat); }

  return { tooth, depth, hocRing, hocPos, atDepth, maxDepth, outward, castPos, worldOf, axis: { x: cx, z: cz }, frame };
}

/** Polyline (cast space) along the height of contour, nudged outward so it sits on the surface. */
export function surveyLine(sv, offset = 0.06) {
  const pts = [];
  for (let c = 0; c <= sv.tooth.cols; c++) pts.push(add(sv.hocPos(c), mul(sv.outward(c), offset)));
  return pts;
}

/** Iso-depth contour at a gauge depth; returns segments of continuous columns where reachable. */
export function gaugeLine(sv, g, offset = 0.06) {
  const segs = [];
  let cur = [];
  for (let c = 0; c <= sv.tooth.cols; c++) {
    const r = sv.atDepth(c, g);
    if (r.ok) cur.push(add(r.pos, mul(sv.outward(c), offset)));
    else { if (cur.length > 1) segs.push(cur); cur = []; }
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

// Vertex colours (linear RGB) for the undercut map
export function undercutColors(sv, { on, base, srgbToLinear }) {
  const nV = sv.depth.length;
  const col = new Float32Array(nV * 4);
  const L = (r, g, b) => [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const ivory = L(...base);
  const bands = [
    [0.02, ivory],
    [0.25, L(0.79, 0.83, 0.69)],
    [0.5, L(0.95, 0.76, 0.22)],
    [0.75, L(0.95, 0.6, 0.42)],
    [99, L(0.88, 0.31, 0.49)],
  ];
  const meta = sv.tooth.meta, cols = sv.tooth.cols;
  for (let k = 0; k < nV; k++) {
    const r = Math.floor(k / cols);
    let c = ivory;
    if (on && meta[r].kind === 'wall') {
      const d = sv.depth[k];
      for (const [lim, bc] of bands) { if (d < lim) { c = d < 0.02 ? ivory : bc; break; } }
    }
    col[k * 4] = c[0]; col[k * 4 + 1] = c[1]; col[k * 4 + 2] = c[2]; col[k * 4 + 3] = 1;
  }
  return col;
}
