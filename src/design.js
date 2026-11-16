// RPD framework components, their geometry, and the design check.
import { v3, add, sub, mul, norm, cross, dot, len, lerp, smooth, tube, gridMesh, computeNormals, mergeMeshes } from './geom.js';
import { archFrame, toothS, toothFrame, toCast, SPECS, TOOTH_S, gumAt, OCC_Y, NJ, SIDE, isMax, palateSetup, palateY, PALATE, PAL_JOIN } from './anatomy.js';
import { posInfo, fdi, ARCH_LEN, TOOTH_NAMES } from './kennedy.js';

export const CONNECTORS = {
  mandibular: [['lingual-bar', 'Lingual bar'], ['lingual-plate', 'Lingual plate']],
  maxillary: [['palatal-strap', 'Palatal strap'], ['ap-strap', 'AP strap'], ['palatal-plate', 'Palatal plate'], ['u-shaped', 'U-shaped']],
};
export const CONNECTOR_NAMES = Object.fromEntries([...CONNECTORS.mandibular, ...CONNECTORS.maxillary]);

export const TIP_DEPTH = { akers: 0.25, rpi: 0.25, ww: 0.5 };
export const CLASP_NAMES = { akers: 'Akers (circumferential) clasp', rpi: 'RPI system', ww: 'Wrought-wire combination clasp' };

// ---------- arch topology ----------
export function mesialOf(i) { return i < 7 ? i + 1 : i - 1; }
export function distalOf(i) { const d = i < 7 ? i - 1 : i + 1; return d < 0 || d >= ARCH_LEN ? null : d; }

export function topology(missing, cls) {
  const considered = cls.considered;
  const spanOf = new Array(ARCH_LEN).fill(null);
  for (const s of cls.spans) for (const t of s.teeth) spanOf[t] = s;
  const info = [];
  for (let i = 0; i < ARCH_LEN; i++) {
    const m = mesialOf(i), d = distalOf(i);
    const mSpan = !missing[i] && m !== null && considered[m] ? spanOf[m] : null;
    const dSpan = !missing[i] && d !== null && considered[d] ? spanOf[d] : null;
    const distalExt = !!(dSpan && (dSpan.distalRight || dSpan.distalLeft));
    info.push({ i, present: !missing[i], mSpan, dSpan, abutment: !!(mSpan || dSpan), distalExt });
  }
  return info;
}

export function defaultRestSide(topo, i) {
  const t = topo[i];
  if (t.distalExt) return 'mesial';
  if (t.dSpan && !t.mSpan) return 'distal';
  if (t.mSpan && !t.dSpan) return 'mesial';
  if (t.mSpan && t.dSpan) return 'distal';
  return 'mesial';
}

// ---------- geometry helpers ----------
function ellipsoid(center, ax, rad, seg = 14) {
  const rows = [];
  for (let r = 0; r <= seg / 2; r++) {
    const phi = (r / (seg / 2)) * Math.PI - Math.PI / 2;
    const row = [];
    for (let c = 0; c < seg; c++) {
      const th = (c / seg) * Math.PI * 2;
      const x = Math.cos(phi) * Math.cos(th), y = Math.sin(phi), z = Math.cos(phi) * Math.sin(th);
      row.push(add(center, add(add(mul(ax[0], x * rad[0]), mul(ax[1], y * rad[1])), mul(ax[2], z * rad[2]))));
    }
    rows.push(row);
  }
  let g = gridMesh(rows, { closeCols: true });
  const n0 = v3(g.normals[seg * 3 * 2], g.normals[seg * 3 * 2 + 1], g.normals[seg * 3 * 2 + 2]);
  const p0 = rows[2][0];
  if (dot(n0, sub(p0, center)) < 0) g = gridMesh(rows, { closeCols: true, flip: true });
  return g;
}

function colOf(theta) { return Math.round(((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * NJ) % NJ; }
const SIDE_THETA = { mesial: Math.PI, distal: 0 };

// Maxillary canine: cingulum rest (prominent, well-inclined cingulum), not an incisal rest.
const cingulumRest = (type) => type === 'canine' && isMax();

function restPoint(fr, side, type) {
  const sx = side === 'distal' ? 1 : -1;
  const a = fr.spec.md / 2, h = fr.spec.h;
  if (cingulumRest(type)) return toCast(fr, v3(sx * 0.35, fr.spec.h * 0.4, -fr.spec.bl / 2 * 0.98));
  if (type === 'canine') return toCast(fr, v3(sx * a * 0.42, h + 0.75, -0.2));
  return toCast(fr, v3(sx * a * 0.6, h + 0.55, 0));
}

function restMesh(fr, side) {
  const type = fr.spec.type;
  const c = restPoint(fr, side, type);
  const sx = side === 'distal' ? 1 : -1;
  const tx = mul(fr.t, sx);
  if (cingulumRest(type)) return ellipsoid(c, [fr.t, fr.up, fr.b], [1.8, 0.85, 0.75]);
  if (type === 'canine') return ellipsoid(c, [fr.t, fr.up, fr.b], [1.3, 0.55, 1.5]);
  const w = type === 'molar' ? 2.1 : 1.7;
  return ellipsoid(add(c, mul(tx, -0.3)), [fr.t, fr.up, fr.b], [1.5, 0.5, w]);
}

function lingualN(s) {
  const g = gumAt(s, new Array(ARCH_LEN).fill(false));
  return g;
}

// gum lingual surface offset (negative = lingual) at height y, for arch position s
export function gumLingualAt(s, y, missing) {
  const { top, W } = gumAt(s, missing);
  const pts = [[-W - 3.2, -12], [-W - 2.4, -7], [-W - 1.0, top - 2.6], [-W * 0.75, top - 0.5]];
  for (let k = 0; k < pts.length - 1; k++) {
    const [n0, y0] = pts[k], [n1, y1] = pts[k + 1];
    if (y >= y0 && y <= y1) return n0 + (n1 - n0) * ((y - y0) / (y1 - y0 || 1));
  }
  return y < -12 ? pts[0][0] : pts[3][0];
}
export function gumBuccalAt(s, y, missing) {
  const { top, W } = gumAt(s, missing);
  const pts = [[W + 3.8, -12], [W + 2.6, -7], [W + 1.0, top - 2.6], [W * 0.75, top - 0.5]];
  for (let k = 0; k < pts.length - 1; k++) {
    const [n0, y0] = pts[k], [n1, y1] = pts[k + 1];
    if (y >= y0 && y <= y1) return n0 + (n1 - n0) * ((y - y0) / (y1 - y0 || 1));
  }
  return y < -12 ? pts[0][0] : pts[3][0];
}
const archPt = (s, n, y) => { const f = archFrame(s); return add(add(f.p, mul(f.b, n)), v3(0, y, 0)); };
/** Point on the palate surface (maxillary), offset n across the arch at s, lifted off the tissue. */
const palPt = (s, n, lift = 0) => { const q = archPt(s, n, 0); return v3(q.x, palateY(q.x, q.z) + lift, q.z); };

export const BAR = { top: -4.2, bottom: -8.8 };

// ---------- build framework ----------
export function buildFramework(state, ctx) {
  const { missing, components, connector } = state;
  const { topo, surveys, cls } = ctx;
  const metal = [], wire = [], acrylic = [];
  const results = []; // per clasp: achieved tip depth etc.
  const restPts = []; // {i, side, pos}
  const minorStarts = [];
  const minorPal = []; // maxillary: where each minor connector meets the palate
  if (isMax()) palateSetup(missing);

  // rests (from rest components and clasps)
  const restSet = new Map();
  for (const c of components) {
    const side = c.side || defaultRestSide(topo, c.tooth);
    restSet.set(`${c.tooth}:${side}`, { i: c.tooth, side });
  }
  for (const { i, side } of restSet.values()) {
    if (missing[i]) continue;
    const fr = toothFrame(i);
    metal.push(restMesh(fr, side));
    const pos = restPoint(fr, side, fr.spec.type);
    restPts.push({ i, side, pos });
    // minor connector from rest down the lingual embrasure
    const sx = side === 'distal' ? 1 : -1;
    const a = fr.spec.md / 2, b = fr.spec.bl / 2, h = fr.spec.h;
    const s = toothS(i);
    const sEmb = s + (s >= 0 ? 1 : -1) * sx * (a + 0.2);
    const yb = (BAR.top + BAR.bottom) / 2 + 1;
    if (isMax()) {
      // down the palatal embrasure (or straight off a cingulum rest), across the gingiva, onto the palate
      const sC = cingulumRest(fr.spec.type) ? s : sEmb;
      const g = gumAt(sC, missing);
      const start = cingulumRest(fr.spec.type)
        ? [pos, toCast(fr, v3(0, h * 0.18, -b * 1.12))]
        : [pos, toCast(fr, v3(sx * a * 0.92, h * 0.85, -b * 0.45)), toCast(fr, v3(sx * a * 1.0, h * 0.4, -b * 0.85)), toCast(fr, v3(sx * a * 1.0, 0.2, -b * 1.05))];
      const pts = [
        ...start,
        archPt(sC, -g.W - 1.0 - 0.55, g.top - 2.6 + 0.35),
        palPt(sC, -(g.W + PAL_JOIN.n + 0.4), 0.6),
        palPt(sC, -(0.75 * g.W + 4), 0.6),
        palPt(sC, -(0.75 * g.W + MAX_MARGIN + 0.8), 0.6),
      ];
      metal.push(tube(smoothPath(pts, 2), (t) => 0.85 - 0.1 * t, { seg: 8, flatten: 0.75 }));
      minorStarts.push(sEmb);
      const end = pts[pts.length - 1];
      minorPal.push({ s: sC, x: end.x, z: end.z });
      continue;
    }
    const pts = [
      pos,
      toCast(fr, v3(sx * a * 0.92, h * 0.85, -b * 0.45)),
      toCast(fr, v3(sx * a * 1.0, h * 0.4, -b * 0.85)),
      toCast(fr, v3(sx * a * 1.0, 0.2, -b * 1.05)),
      archPt(sEmb, gumLingualAt(sEmb, -1.5, missing) - 0.5, -1.5),
      archPt(sEmb, gumLingualAt(sEmb, yb, missing) - 0.9, yb),
    ];
    metal.push(tube(pts, (t) => 0.8 - 0.1 * t, { seg: 8 }));
    minorStarts.push(sEmb);
  }

  // clasps
  for (const c of components) {
    if (!['akers', 'rpi', 'ww'].includes(c.type) || missing[c.tooth]) continue;
    const sv = surveys[c.tooth];
    if (!sv) continue;
    const fr = sv.frame;
    const side = c.side || defaultRestSide(topo, c.tooth);
    const target = TIP_DEPTH[c.type];
    const thS = SIDE_THETA[side];
    if (c.type === 'rpi') {
      // I-bar tip slightly mesial of mid-buccal
      const thTip = Math.PI / 2 + (side === 'mesial' ? 0.15 : -0.15);
      const col = colOf(thTip);
      const tip = sv.atDepth(col, target);
      const tipPos = add(tip.pos, mul(sv.outward(col), 0.45));
      const s = toothS(c.tooth);
      const dir = s >= 0 ? 1 : -1;
      const distSide = side === 'mesial' ? 1 : -1; // approach from the edentulous side
      const gTop = gumAt(s, missing).top;
      const yLow = gTop - 3.2;
      const sA = s + dir * distSide * (fr.spec.md / 2 + 5);
      const sB = s + dir * distSide * (fr.spec.md / 2 + 1.5);
      const tipS = s; // approximately
      const pts = [
        archPt(sA, gumBuccalAt(sA, yLow, missing) + 0.9, yLow),
        archPt(sB, gumBuccalAt(sB, yLow, missing) + 1.0, yLow),
        archPt(tipS, gumBuccalAt(tipS, yLow, missing) + 1.0, yLow + 0.3),
        archPt(tipS, gumBuccalAt(tipS, gTop - 0.5, missing) + 1.1, gTop + 0.3),
        tipPos,
      ];
      metal.push(tube(smoothPath(pts, 6), (t) => 0.95 - 0.45 * t, { seg: 10 }));
      // proximal plate on the guide plane next to the space
      const thP = side === 'mesial' ? 0 : Math.PI;
      const plateRows = [];
      const hoc = sv.hocPos(colOf(thP));
      for (let r = 0; r <= 4; r++) {
        const y = lerp(v3(0, OCC_Y - fr.spec.h + 0.2, 0), v3(0, hoc.y + 0.6, 0), r / 4).y;
        const row = [];
        for (let k = -3; k <= 3; k++) {
          const cc = colOf(thP + k * 0.11);
          const p = sv.hocPos(cc);
          const o = sv.outward(cc);
          row.push(add(v3(p.x, y, p.z), mul(o, 0.55)));
        }
        plateRows.push(row);
      }
      metal.push(thick(plateRows, 0.5));
      results.push({ c, tipDepth: tip.depth, ok: tip.ok, target, sideUsed: 'buccal' });
      continue;
    }
    // circumferential (Akers / wrought-wire combination)
    const sign = side === 'mesial' ? -1 : 1; // direction of theta travel from the rest side through buccal
    const thBuccTip = Math.PI / 2 - sign * 0.8 + 0; // far line angle
    const thLingTip = -Math.PI / 2 + sign * 0.8;
    const bTip = sv.atDepth(colOf(Math.PI / 2 + (thS === 0 ? 0.8 : -0.8)), target);
    const lTip = sv.atDepth(colOf(-Math.PI / 2 + (thS === 0 ? -0.8 : 0.8)), target);
    let retSide = c.armSide || (bTip.ok ? 'buccal' : lTip.ok ? 'lingual' : 'buccal');
    const arm = (sideName, retentive) => {
      const thEnd = sideName === 'buccal' ? Math.PI / 2 + (thS === 0 ? 0.8 : -0.8) : -Math.PI / 2 + (thS === 0 ? -0.8 : 0.8);
      // unwrap so we travel the short way from thS through the mid surface
      let a0 = thS, a1 = thEnd;
      const mid = sideName === 'buccal' ? Math.PI / 2 : -Math.PI / 2;
      // ensure path passes through mid
      const norm2 = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      a1 = a0 + norm2(a1 - a0);
      const pts = [];
      const N = 22;
      let tipInfo = null;
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const th = a0 + (a1 - a0) * u;
        const col = colOf(th);
        const hoc = sv.hocPos(col);
        const o = sv.outward(col);
        let p;
        if (retentive && u > 0.6) {
          const want = target * smooth(0.6, 1, u);
          const r = sv.atDepth(col, want);
          p = r.pos;
          if (k === N) tipInfo = r;
        } else {
          const lift = retentive ? 1.3 * (1 - u / 0.6) + 0.05 : 1.2 * (1 - u) + 0.35;
          p = add(hoc, v3(0, lift, 0));
        }
        pts.push(add(p, mul(o, retentive ? 0.42 : 0.5)));
      }
      // shoulder from the rest
      const rp = restPoint(fr, side, fr.spec.type);
      pts.unshift(lerp(rp, pts[0], 0.5));
      pts.unshift(rp);
      return { pts, tipInfo };
    };
    const ret = arm(retSide, true);
    const rec = arm(retSide === 'buccal' ? 'lingual' : 'buccal', false);
    const radius = c.type === 'ww' ? (t) => 0.42 : (t) => 0.85 - 0.45 * t;
    (c.type === 'ww' ? wire : metal).push(tube(smoothPath(ret.pts, 3), radius, { seg: 10, flatten: c.type === 'ww' ? 1 : 0.7 }));
    metal.push(tube(smoothPath(rec.pts, 3), () => 0.75, { seg: 10, flatten: 0.7 }));
    results.push({ c, tipDepth: ret.tipInfo ? ret.tipInfo.depth : 0, ok: ret.tipInfo ? ret.tipInfo.ok : false, target, sideUsed: retSide });
  }

  // saddles + replacement teeth
  const saddles = [];
  for (const sp of cls.spans) {
    const ss = sp.teeth.map((i) => toothS(i));
    const widths = sp.teeth.map((i) => SPECS[posInfo(i).num].md / 2);
    let sMin = Math.min(...ss.map((s, k) => s - widths[k])) - 0.6;
    let sMax = Math.max(...ss.map((s, k) => s + widths[k])) + 0.6;
    const end = TOOTH_S[7] + SPECS[7].md / 2 + 6;
    // distal extensions run back over the retromolar pad / tuberosity on their own side
    for (const [flag, sign] of [[sp.distalRight, SIDE.right], [sp.distalLeft, -SIDE.right]]) {
      if (!flag) continue;
      if (sign < 0) sMin = -end; else sMax = end;
    }
    saddles.push({ sMin, sMax, span: sp });
    acrylic.push(saddleMesh(sMin, sMax, missing));
  }

  // major connector
  let connRange = null, conn = null;
  if (isMax()) {
    if (connector && components.length) {
      conn = palatalConnector(connector, { missing, saddles, minorPal });
      if (conn) metal.push(...conn.meshes);
    }
    return { metal: mergeMeshes(metal), wire: wire.length ? mergeMeshes(wire) : null, acrylic: acrylic.length ? mergeMeshes(acrylic) : null, results, restPts, saddles, connRange, conn };
  }
  if (connector && components.length) {
    let lo = Infinity, hi = -Infinity;
    for (const s of minorStarts) { lo = Math.min(lo, s); hi = Math.max(hi, s); }
    for (const sd of saddles) {
      // distal extension: run the connector 9 mm into the saddle from its mesial end
      if (sd.span.distalRight || sd.span.distalLeft) {
        if (sd.sMin + sd.sMax < 0) lo = Math.min(lo, sd.sMax - 9);
        else hi = Math.max(hi, sd.sMin + 9);
      }
      else { lo = Math.min(lo, sd.sMin + 1); hi = Math.max(hi, sd.sMax - 1); }
    }
    for (const r of results) { const s = toothS(r.c.tooth); lo = Math.min(lo, s - 4); hi = Math.max(hi, s + 4); }
    if (lo < hi) {
      connRange = [lo, hi];
      metal.push(connector === 'lingual-plate' ? plateMesh(lo, hi, missing) : barMesh(lo, hi, missing));
    }
  }
  return { metal: mergeMeshes(metal), wire: wire.length ? mergeMeshes(wire) : null, acrylic: acrylic.length ? mergeMeshes(acrylic) : null, results, restPts, saddles, connRange };
}

function smoothPath(pts, iter = 2) {
  let p = pts;
  for (let k = 0; k < iter; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      q.push(lerp(p[i], p[i + 1], 0.25), lerp(p[i], p[i + 1], 0.75));
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

// one-sided sheet given thickness by pushing a second sheet outward along its normal
function thick(rows, t) {
  const g = gridMesh(rows);
  const R = rows.length, C = rows[0].length;
  const outer = rows.map((row, r) => row.map((p, c) => {
    const k = (r * C + c) * 3;
    return add(p, v3(g.normals[k] * t, g.normals[k + 1] * t, g.normals[k + 2] * t));
  }));
  // closed loop rows: concatenate inner + reversed outer per row
  const loop = rows.map((row, r) => [...row, ...outer[r].slice().reverse()]);
  return gridMesh(loop, { closeCols: true });
}

function saddleMesh(sMin, sMax, missing) {
  const rows = [];
  const N = Math.max(8, Math.round((sMax - sMin) / 0.6));
  for (let k = 0; k <= N; k++) {
    const s = sMin + ((sMax - sMin) * k) / N;
    const { top, W } = gumAt(s, missing);
    const yL = isMax() ? top - 4.4 : BAR.top - 1.4; // maxilla: flange stops where the palate begins
    const prof = [
      [-W - 2.3, yL], [-W - 1.5, top - 2.8], [-W * 0.85, top + 0.0], [-W * 0.3, top + 0.95], [0, top + 1.05],
      [W * 0.3, top + 0.95], [W * 0.85, top + 0.0], [W + 1.6, top - 2.8], [W + 2.5, top - 5.5],
      // inner (tissue) surface back
      [W + 1.9, top - 5.5], [W + 0.9, top - 2.6], [0, top + 0.15], [-W - 0.9, top - 2.6], [-W - 1.7, yL],
    ];
    rows.push(prof.map(([n, y]) => archPt(s, n, y)));
  }
  return gridMesh(rows, { closeCols: true });
}

function barMesh(lo, hi, missing) {
  const rows = [];
  const N = Math.max(20, Math.round((hi - lo) / 0.7));
  const yc = (BAR.top + BAR.bottom) / 2;
  for (let k = 0; k <= N; k++) {
    const s = lo + ((hi - lo) * k) / N;
    const fade = smooth(0, 2.5, Math.min(s - lo, hi - s));
    const n0 = (y) => gumLingualAt(s, y, missing) - 0.15;
    // half-pear: thin superior border, bulky inferior border
    const prof = [
      [n0(BAR.top), BAR.top], [n0(BAR.top) - 0.7, BAR.top - 0.5], [n0(yc) - 1.25 * fade - 0.3, yc - 0.3],
      [n0(BAR.bottom + 0.6) - 1.6 * fade - 0.3, BAR.bottom + 0.6], [n0(BAR.bottom) - 0.9 * fade - 0.3, BAR.bottom - 0.1], [n0(BAR.bottom), BAR.bottom],
    ];
    rows.push(prof.map(([n, y]) => archPt(s, n, y)));
  }
  return gridMesh(rows, { closeCols: true });
}

function plateMesh(lo, hi, missing) {
  const rows = [];
  const N = Math.max(30, Math.round((hi - lo) / 0.5));
  for (let k = 0; k <= N; k++) {
    const s = lo + ((hi - lo) * k) / N;
    const g = gumAt(s, missing);
    const n0 = (y) => gumLingualAt(s, y, missing) - 0.15;
    const toothN = -(g.W - 0.9) * 0.86;
    const plateTop = g.top + (g.pf > 0.3 ? 2.6 * g.pf : 0.5);
    const prof = [
      [n0(BAR.bottom) - 0.2, BAR.bottom], [n0(BAR.bottom + 0.5) - 1.9, BAR.bottom + 0.5], [n0(BAR.top) - 1.0, BAR.top],
      [n0(g.top - 2.6) - 0.6, g.top - 2.6], [Math.min(n0(g.top - 0.5), toothN) - 0.55, g.top + 0.4], [toothN - 0.35, plateTop],
      [toothN - 0.05, plateTop - 0.3], [Math.min(n0(g.top - 0.5), toothN) - 0.05, g.top + 0.3], [n0(g.top - 2.6) - 0.05, g.top - 2.6],
      [n0(BAR.top), BAR.top],
    ];
    rows.push(prof.map(([n, y]) => archPt(s, n, y)));
  }
  return gridMesh(rows, { closeCols: true });
}

// ---------- palatal major connectors (maxillary) ----------
export const MAX_MARGIN = 6; // mm: borders kept this far from the palatal gingival margins of standing teeth
export const STRAP_MIN = 8; // mm: minimum anteroposterior width of a palatal strap
const BAR_W = 7; // mm: lateral (longitudinal) parts of the AP strap and the U-shaped connector

// Border line on one side of the palate: MAX_MARGIN from the margin beside teeth, ~3 mm (tucked under
// the saddle) along edentulous ridges. `extra` moves it further towards the midline.
function borderCurve(sign, missing, sEnd, extra = 0) {
  const pts = [];
  for (let s = 0; s <= sEnd + 1e-6; s += 0.25) {
    const ss = sign * s;
    const f = archFrame(ss);
    const g = gumAt(ss, missing);
    const c = 3 + (MAX_MARGIN - 3) * g.pf;
    const p = add(f.p, mul(f.b, -(0.75 * g.W + c + extra)));
    pts.push({ x: Math.max(0, p.x * sign), z: p.z });
  }
  return pts;
}
function curveX(curve, z) {
  if (z >= curve[0].z) return 0;
  for (let k = 1; k < curve.length; k++) {
    const a = curve[k - 1], b = curve[k];
    if ((a.z - z) * (b.z - z) <= 0) return a.x + (b.x - a.x) * ((z - a.z) / (b.z - a.z || 1));
  }
  return curve[curve.length - 1].x;
}

function palSheet(zA, zB, xl, xr, lift, th) {
  const zs = [];
  const n = Math.max(3, Math.ceil((zA - zB) / 0.45));
  for (let k = 0; k <= n; k++) zs.push(zA - ((zA - zB) * k) / n);
  const NC = 26;
  const rows = zs.map((z) => {
    const L = xl(z), R = Math.max(xl(z), xr(z));
    const bot = [], top = [];
    for (let c = 0; c <= NC; c++) {
      const x = L + ((R - L) * c) / NC;
      const y = palateY(x, z) + lift;
      const edge = smooth(0, 2.2, Math.min(x - L, R - x)) * smooth(0, 1.2, Math.min(z - zB, zA - z) + 0.4);
      bot.push(v3(x, y, z));
      top.push(v3(x, y + th * (0.3 + 0.7 * edge), z));
    }
    return [...bot, ...top.reverse()];
  });
  let g = gridMesh(rows, { closeCols: true });
  const k = (Math.floor(rows.length / 2) * rows[0].length + Math.round(NC * 1.5)) * 3; // a top-surface vertex
  if (g.normals[k + 1] < 0) g = gridMesh(rows, { closeCols: true, flip: true });
  return g;
}

/**
 * Builds a palatal major connector. Returns its meshes plus the facts the check needs: the
 * anteroposterior extent of each part, the strap width and whether any part crosses a torus.
 */
export function palatalConnector(kind, { missing, saddles, minorPal }) {
  const pal = palateSetup(missing);
  const sEnd = pal.sEnd;
  const outer = { p: borderCurve(1, missing, sEnd), n: borderCurve(-1, missing, sEnd) };
  const inner = { p: borderCurve(1, missing, sEnd, BAR_W), n: borderCurve(-1, missing, sEnd, BAR_W) };
  const zTop = Math.min(outer.p[0].z, outer.n[0].z) - 0.3;
  const zPost = pal.zPost;
  const clampZ = (z) => Math.max(zPost, Math.min(zTop, z));
  const full = { xl: (z) => -curveX(outer.n, z), xr: (z) => curveX(outer.p, z) };
  const barR = { xl: (z) => -curveX(outer.n, z), xr: (z) => -curveX(inner.n, z) };
  const barL = { xl: (z) => curveX(inner.p, z), xr: (z) => curveX(outer.p, z) };

  // anteroposterior positions the connector has to reach: minor connectors and saddles
  const minorZ = minorPal.map((m) => m.z);
  const keyZ = [...minorZ];
  for (const sd of saddles) {
    const zz = [];
    for (let k = 0; k <= 8; k++) zz.push(archFrame(sd.sMin + ((sd.sMax - sd.sMin) * k) / 8).p.z);
    const ext = sd.span.distalRight || sd.span.distalLeft;
    const zMax = Math.max(...zz);
    if (ext) keyZ.push(zMax, zMax - 10); else keyZ.push(Math.min(...zz), zMax);
  }
  if (!keyZ.length) return null;
  const zHi = clampZ(Math.max(...keyZ) + 1.5), zLo = clampZ(Math.min(...keyZ) - 1.5);

  const pieces = [];
  let width = null, merged = false;
  if (kind === 'palatal-plate') {
    pieces.push({ zA: zTop, zB: zPost, ...full, lift: 0.22 });
  } else if (kind === 'palatal-strap') {
    let zA = zHi, zB = zLo;
    if (zA - zB < STRAP_MIN) { const c = (zA + zB) / 2; zA = c + STRAP_MIN / 2; zB = c - STRAP_MIN / 2; }
    if (zA > zTop) { zB -= zA - zTop; zA = zTop; }
    if (zB < zPost) { zA += zPost - zB; zB = zPost; }
    zA = Math.min(zA, zTop);
    width = zA - zB;
    pieces.push({ zA, zB, ...full, lift: 0.24 });
  } else if (kind === 'ap-strap') {
    let zAnt = clampZ(Math.max(...minorZ, zPost + 2 * STRAP_MIN) + 2);
    // a mid-palatal torus: slide the anterior strap forward (within the palate) so its back edge
    // clears the bulge and the strap rings round it instead of resting on it
    const tor = pal.torus;
    if (tor && zAnt - STRAP_MIN < tor.range[1] && zAnt > tor.range[0]) zAnt = Math.min(zTop, Math.max(zAnt, tor.range[1] + STRAP_MIN + 0.5));
    const ant = [zAnt - STRAP_MIN, zAnt], post = [zPost, zPost + STRAP_MIN];
    if (ant[0] - post[1] < 8) {
      merged = true; // too little room for an open centre: it becomes one broad strap
      pieces.push({ zA: zAnt, zB: zPost, ...full, lift: 0.24 });
    } else {
      pieces.push({ zA: ant[1], zB: ant[0], ...full, lift: 0.24 });
      pieces.push({ zA: post[1], zB: post[0], ...full, lift: 0.24 });
      pieces.push({ zA: ant[0] + 2, zB: post[1] - 2, ...barR, lift: 0.17 });
      pieces.push({ zA: ant[0] + 2, zB: post[1] - 2, ...barL, lift: 0.17 });
    }
  } else if (kind === 'u-shaped') {
    const zU = zLo;
    pieces.push({ zA: zTop, zB: zU, ...barR, lift: 0.2 });
    pieces.push({ zA: zTop, zB: zU, ...barL, lift: 0.2 });
  } else return null;

  const meshes = pieces.map((p) => palSheet(p.zA, p.zB, p.xl, p.xr, p.lift, 0.75));
  // torus overlap: does any part of the metal lie over the bony bulge?
  let torusConflict = false;
  const t = pal.torus;
  if (t) {
    for (const p of pieces) {
      for (let z = Math.min(p.zA, t.range[1]); z >= Math.max(p.zB, t.range[0]); z -= 0.5) {
        const half = t.rx * Math.sqrt(Math.max(0, 1 - ((z - t.zc) / t.rz) ** 2)) * 0.8;
        if (half > 0.5 && p.xl(z) < half && p.xr(z) > -half) { torusConflict = true; break; }
      }
      if (torusConflict) break;
    }
  }
  return { kind, meshes, pieces: pieces.map((p) => ({ zA: p.zA, zB: p.zB })), width, merged, torusConflict, zPost };
}

/**
 * Textbook choice of maxillary major connector (McCracken / Carr & Brown):
 * Class I: AP strap or palatal plate; plate when only anterior teeth remain.
 * Class II: AP strap; plate when the extension side keeps only anterior teeth.
 * Class III: palatal strap for short posterior tooth-borne spaces; AP strap for long or anterior spaces.
 * Class IV: AP strap; palatal plate for a long anterior span.
 * U-shaped: only when a torus reaches the posterior limit (or posterior coverage is impossible).
 */
export function palatalAdvice(cls, topo) {
  if (!cls.kennedy) return { best: [], why: '' };
  const ext = topo.filter((t) => t.distalExt);
  const termAnterior = ext.some((t) => posInfo(t.i).num <= 3);
  const longSpan = cls.spans.some((s) => s.teeth.length >= 3);
  const anteriorSpace = cls.spans.some((s) => s.teeth.some((i) => posInfo(i).num <= 3));
  let best, why;
  if (cls.kennedy === 'I') {
    best = termAnterior ? ['palatal-plate', 'ap-strap'] : ['ap-strap', 'palatal-plate'];
    why = termAnterior
      ? 'Class I with only anterior teeth standing: a complete palatal plate takes support from the whole hard palate for both extensions.'
      : 'Class I: an AP strap (or a palatal plate) is rigid and spreads the load of both distal extensions over the palate.';
  } else if (cls.kennedy === 'II') {
    best = termAnterior ? ['palatal-plate', 'ap-strap'] : ['ap-strap', 'palatal-plate'];
    why = termAnterior
      ? 'Class II with only anterior teeth on the extension side: a palatal plate gives the most support.'
      : 'Class II: an AP strap joins the extension to the tooth-borne side rigidly, with palatal support behind the saddle.';
  } else if (cls.kennedy === 'III') {
    best = anteriorSpace || longSpan ? ['ap-strap', 'palatal-plate'] : ['palatal-strap', 'ap-strap'];
    why = anteriorSpace || longSpan
      ? 'Class III with a long or anterior space: an AP strap reaches both ends of the arch without covering the whole palate.'
      : 'Class III with short posterior spaces is tooth-borne: a single broad palatal strap is rigid enough and covers little tissue.';
  } else {
    const n = cls.spans[0].teeth.length;
    best = n >= 6 ? ['palatal-plate', 'ap-strap'] : ['ap-strap', 'palatal-plate'];
    why = n >= 6
      ? 'Class IV with a long anterior span: a palatal plate resists the rotation of the anterior saddle best.'
      : 'Class IV: an AP strap (or a plate) gives a rigid ring with an anterior strap behind the replaced teeth.';
  }
  if (PALATE.torus === 'mid') {
    best = ['ap-strap', ...best.filter((c) => c !== 'ap-strap' && c !== 'palatal-plate')];
    why += ' With a mid-palatal torus the AP strap rings round it, leaving the torus uncovered.';
  } else if (PALATE.torus === 'posterior') {
    best = ['u-shaped'];
    why = 'The torus reaches the posterior limit, so no posterior strap can cross it: this is where a U-shaped connector is indicated. Keep it broad and well supported by rests.';
  }
  return { best, why };
}

export function suggestConnector(state, ctx) {
  if (!isMax()) return state.sulcus < 8 ? 'lingual-plate' : 'lingual-bar';
  return palatalAdvice(ctx.cls, ctx.topo).best[0] || 'ap-strap';
}

// ---------- fulcrum line + design check ----------
export function fulcrumLine(cls, topo, restPts) {
  if (!cls.kennedy || !['I', 'II'].includes(cls.kennedy)) return null;
  const termR = topo.find((t) => t.distalExt && t.i < 7);
  const termL = topo.find((t) => t.distalExt && t.i >= 7);
  const pick = (i) => restPts.filter((r) => r.i === i).sort((a, b) => a.pos.z - b.pos.z)[0];
  let A = null, B = null;
  if (cls.kennedy === 'I') {
    A = termR && pick(termR.i);
    B = termL && pick(termL.i);
  } else {
    const ext = termR || termL;
    A = ext && pick(ext.i);
    const other = restPts.filter((r) => (ext.i < 7 ? r.i >= 7 : r.i < 7)).sort((a, b) => a.pos.z - b.pos.z)[0];
    B = other;
  }
  if (!A || !B) return { A, B, ok: false };
  return { A: A.pos, B: B.pos, ok: true };
}

function distToLine2D(p, A, B) {
  const dx = B.x - A.x, dz = B.z - A.z;
  const L = Math.hypot(dx, dz) || 1;
  // signed: positive toward anterior (the side containing the incisors at z≈+21)
  const nx = -dz / L, nz = dx / L;
  const ref = archFrame(0).p;
  const sRef = (ref.x - A.x) * nx + (ref.z - A.z) * nz;
  const s = (p.x - A.x) * nx + (p.z - A.z) * nz;
  return sRef >= 0 ? s : -s;
}

export function checkDesign(state, ctx, fw) {
  const { cls, topo } = ctx;
  const out = [];
  const push = (status, title, detail) => out.push({ status, title, detail });
  if (!cls.kennedy) return { items: [{ status: 'info', title: 'No edentulous space to design for', detail: 'Extract teeth in the Case tab first.' }], fulcrum: null };
  const comps = state.components;
  const restOn = (i) => fw.restPts.filter((r) => r.i === i);
  const claspOn = (i) => comps.find((c) => c.tooth === i && ['akers', 'rpi', 'ww'].includes(c.type));
  const name = (i) => `${fdi(i)} (${TOOTH_NAMES[posInfo(i).num].toLowerCase()})`;

  // 1. support
  const abut = topo.filter((t) => t.abutment);
  const noRest = abut.filter((t) => restOn(t.i).length === 0);
  if (noRest.length) push('fail', 'Every abutment needs a rest', `No rest on ${noRest.map((t) => fdi(t.i)).join(', ')}. Rests give vertical support and stop the framework sinking into the tissue.`);
  else push('pass', 'Every abutment has a rest', `${abut.length} abutment${abut.length > 1 ? 's' : ''} supported.`);

  // 2. rest position
  const wrongSide = [];
  for (const t of abut) {
    if (t.distalExt) continue;
    const want = t.dSpan ? 'distal' : 'mesial';
    const rs = restOn(t.i);
    if (rs.length && !rs.some((r) => r.side === want || (t.mSpan && t.dSpan))) wrongSide.push(`${fdi(t.i)} (${want})`);
  }
  if (wrongSide.length) push('warn', 'Rests on tooth-borne abutments go next to the space', `Move to: ${wrongSide.join(', ')}.`);

  // 3. distal extension abutments
  const ext = topo.filter((t) => t.distalExt);
  if (ext.length) {
    for (const t of ext) {
      const rs = restOn(t.i);
      const cl = claspOn(t.i);
      if (rs.some((r) => r.side === 'distal') && !rs.some((r) => r.side === 'mesial'))
        push('warn', `${fdi(t.i)}: prefer a mesial rest`, 'On a distal-extension abutment a mesial rest moves the fulcrum forward, so the saddle loads the ridge more vertically and the abutment is tipped less (RPI concept).');
      if (!cl) push('fail', `${fdi(t.i)}: no direct retainer`, 'The distal-extension side needs a retainer on its terminal abutment.');
      else if (cl.type === 'akers') push('warn', `${fdi(t.i)}: cast circumferential clasp on a distal-extension abutment`, 'A rigid cast arm in an undercut can torque the abutment when the saddle moves. An RPI or a wrought-wire arm flexes instead.');
      else push('pass', `${fdi(t.i)}: stress-releasing retainer`, `${CLASP_NAMES[cl.type]} on the terminal abutment.`);
    }
  }

  // 4. indirect retention
  const ful = fulcrumLine(cls, topo, fw.restPts);
  if (['I', 'II'].includes(cls.kennedy)) {
    if (!ful || !ful.ok) push('fail', 'Fulcrum line can\u2019t be drawn yet', 'Add rests on the terminal abutments on both sides.');
    else {
      let best = null;
      for (const r of fw.restPts) {
        const d = distToLine2D(r.pos, ful.A, ful.B);
        if (d > 2 && (!best || d > best.d)) best = { d, r };
      }
      // furthest any usable rest seat (canine or posterior tooth) could be from the line
      let possible = 0, possibleTooth = null;
      for (const t of topo) {
        if (!t.present || posInfo(t.i).num < 3) continue;
        const fr = toothFrame(t.i);
        const d = distToLine2D(restPoint(fr, 'mesial', fr.spec.type), ful.A, ful.B);
        if (d > possible) { possible = d; possibleTooth = t.i; }
      }
      if (!best) push('fail', 'No indirect retainer', 'Distal-extension saddles lift away under sticky food. Put a rest anterior to the fulcrum line, as far from it as you can (canine or first premolar).');
      else if (best.d < possible * 0.8) push('warn', 'Indirect retainer could go further forward', `${fdi(best.r.i)} rest sits ${best.d.toFixed(1)} mm in front of the fulcrum line; ${fdi(possibleTooth)} would give ${possible.toFixed(1)} mm.`);
      else push('pass', 'Indirect retainer well placed', `${fdi(best.r.i)} rest is ${best.d.toFixed(1)} mm anterior to the fulcrum line, about as far forward as this arch allows.`);
    }
  }

  // 5. retention distribution
  const clasps = comps.filter((c) => ['akers', 'rpi', 'ww'].includes(c.type) && !state.missing[c.tooth]);
  const R = clasps.filter((c) => c.tooth < 7).length, Lf = clasps.length - R;
  if (!clasps.length) push('fail', 'No direct retainers', 'Add clasps on the abutments.');
  else if (!R || !Lf) push('fail', 'Retention on one side only', 'Cross-arch retention is needed so the denture can\u2019t rotate out on the other side.');
  else if (cls.kennedy === 'III' && cls.mods > 0 && clasps.length < 4) push('warn', 'Class III with a modification: aim for quadrilateral retention', `${clasps.length} clasps placed. Four abutments clasped give the most stable design.`);
  else if (cls.kennedy === 'II' && clasps.length < 3 && cls.mods > 0) push('warn', 'Class II: aim for tripod retention', 'One retainer on the extension side and two on the tooth-supported side.');
  else push('pass', 'Retention on both sides of the arch', `${clasps.length} direct retainer${clasps.length > 1 ? 's' : ''}.`);

  // 6. undercuts at clasp tips
  for (const r of fw.results) {
    if (r.ok) push('pass', `${fdi(r.c.tooth)}: tip in ${r.target.toFixed(2)} mm undercut`, `${CLASP_NAMES[r.c.type]}, retentive arm on the ${r.sideUsed} side.`);
    else push('fail', `${fdi(r.c.tooth)}: not enough undercut`, `Only ${r.tipDepth.toFixed(2)} mm available where the tip should sit, at this path of insertion; ${r.target.toFixed(2)} mm needed. Tilt the cast, use the other side, or plan recontouring.`);
  }

  // 7. major connector
  if (isMax()) {
    const conn = state.connector;
    const adv = palatalAdvice(cls, topo);
    const nm = (c) => CONNECTOR_NAMES[c];
    const bestTxt = adv.best.map(nm).join(' or ');
    if (!conn) push('fail', 'No major connector', 'Join both sides of the arch with a palatal connector: strap, AP strap or plate.');
    else if (fw.conn && fw.conn.torusConflict) push('fail', `${nm(conn)} crosses the torus`, `A torus is hard, thinly covered and can’t be compressed, so metal over it rocks and ulcerates the mucosa. Go round it (${bestTxt}) or plan its removal.`);
    else if (adv.best.includes(conn)) push('pass', `${nm(conn)}: textbook choice for Class ${cls.kennedy}`, adv.why);
    else if (conn === 'u-shaped') push('warn', 'U-shaped connector: avoid unless indicated', `Least rigid palatal connector: it flexes, lets distal-extension saddles move and runs close to the gingival margins of the anterior teeth. Keep it for a torus that reaches the posterior limit. Here: ${bestTxt}.`);
    else if (conn === 'palatal-strap' && ['I', 'II'].includes(cls.kennedy)) push('warn', 'A single palatal strap is weak support for a distal extension', `It gives little rigidity or palatal support for a tissue-borne saddle. ${adv.why}`);
    else if (conn === 'palatal-plate' && cls.kennedy === 'III') push('warn', 'More palate covered than this case needs', `${adv.why} A plate is not wrong, but it covers more tissue (taste, speech, comfort).`);
    else push('warn', `${nm(conn)} works, but ${bestTxt} is the textbook pick`, adv.why);
    if (conn && fw.conn) {
      const w = fw.conn.width ? ` Strap is ${fw.conn.width.toFixed(0)} mm wide (at least ${STRAP_MIN} mm).` : '';
      const m = fw.conn.merged ? ' The two straps are so close they merge into one broad strap.' : '';
      push('pass', 'Borders clear of the gingival margins', `Kept ${MAX_MARGIN} mm from the palatal gingival margins of standing teeth, posterior border just in front of the vibrating line.${w}${m}`);
    }
  } else if (!state.connector) push('fail', 'No major connector', 'Join both sides of the arch with a lingual bar or a lingual plate.');
  else if (state.connector === 'lingual-bar' && state.sulcus < 8) push('fail', 'Lingual bar needs about 8 mm of depth', `Measured ${state.sulcus} mm from gingival margin to floor of mouth. Use a lingual plate.`);
  else if (state.connector === 'lingual-bar') push('pass', 'Lingual bar fits', `${state.sulcus} mm of lingual depth, bar kept clear of the gingival margins.`);
  else push('pass', 'Lingual plate', state.sulcus < 8 ? 'Right call for a shallow lingual sulcus.' : 'Fine, though a bar would also fit at this depth. A plate earns its place for splinting or planned incisor loss.');

  return { items: out, fulcrum: ful };
}

export function suggestDesign(state, ctx) {
  const { cls, topo } = ctx;
  const comps = [];
  if (!cls.kennedy) return comps;
  const present = (i) => !state.missing[i];
  for (const t of topo) {
    if (!t.abutment) continue;
    const { num } = posInfo(t.i);
    if (num <= 2) continue;
    if (t.distalExt) comps.push({ type: 'rpi', tooth: t.i, side: 'mesial' });
    else if (num === 3) comps.push({ type: 'rest', tooth: t.i, side: t.dSpan ? 'distal' : 'mesial' });
    else comps.push({ type: 'akers', tooth: t.i, side: t.dSpan ? 'distal' : 'mesial' });
    if (t.mSpan && t.dSpan) comps.push({ type: 'rest', tooth: t.i, side: 'mesial' });
  }
  if (['I', 'II'].includes(cls.kennedy)) {
    // indirect retainers on canines (incisal rests), else first premolars
    for (const sideIdx of cls.kennedy === 'I' ? [[4, 3], [9, 10]] : [topo.find((t) => t.distalExt).i < 7 ? [9, 10] : [4, 3]]) {
      const [can, pm1] = sideIdx;
      const pick = present(can) && !comps.some((c) => c.tooth === can) ? can : present(pm1) && !comps.some((c) => c.tooth === pm1) ? pm1 : null;
      if (pick !== null) comps.push({ type: 'rest', tooth: pick, side: 'mesial' });
    }
    if (cls.kennedy === 'II') {
      const extRight = topo.find((t) => t.distalExt).i < 7;
      const otherSide = topo.filter((t) => t.present && (extRight ? t.i >= 7 : t.i < 7));
      const nOther = comps.filter((c) => otherSide.some((t) => t.i === c.tooth) && c.type !== 'rest').length;
      if (nOther < 2) {
        const m1 = extRight ? 12 : 1;
        const m2 = extRight ? 13 : 0;
        const free = (i) => present(i) && !comps.some((c) => c.tooth === i);
        const pick = free(m2) ? m2 : free(m1) ? m1 : null;
        if (pick !== null) comps.push({ type: 'akers', tooth: pick, side: 'mesial' });
      }
    }
  }
  if (cls.kennedy === 'IV') {
    for (const m of [1, 12]) if (present(m) && !comps.some((c) => c.tooth === m)) comps.push({ type: 'akers', tooth: m, side: 'mesial' });
  }
  return comps;
}
