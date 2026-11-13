// RPD framework components, their geometry, and the design check.
import { v3, add, sub, mul, norm, cross, dot, len, lerp, smooth, tube, gridMesh, computeNormals, mergeMeshes } from './geom.js';
import { archFrame, toothS, toothFrame, toCast, SPECS, TOOTH_S, gumAt, OCC_Y, NJ } from './anatomy.js';
import { posInfo, fdi, ARCH_LEN, TOOTH_NAMES } from './kennedy.js';

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

function restPoint(fr, side, type) {
  const sx = side === 'distal' ? 1 : -1;
  const a = fr.spec.md / 2, h = fr.spec.h;
  if (type === 'canine') return toCast(fr, v3(sx * a * 0.42, h + 0.75, -0.2));
  return toCast(fr, v3(sx * a * 0.6, h + 0.55, 0));
}

function restMesh(fr, side) {
  const type = fr.spec.type;
  const c = restPoint(fr, side, type);
  const sx = side === 'distal' ? 1 : -1;
  const tx = mul(fr.t, sx);
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

export const BAR = { top: -4.2, bottom: -8.8 };

// ---------- build framework ----------
export function buildFramework(state, ctx) {
  const { missing, components, connector } = state;
  const { topo, surveys, cls } = ctx;
  const metal = [], wire = [], acrylic = [];
  const results = []; // per clasp: achieved tip depth etc.
  const restPts = []; // {i, side, pos}
  const minorStarts = [];

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
    if (sp.distalRight) sMin = -end;
    if (sp.distalLeft) sMax = end;
    saddles.push({ sMin, sMax, span: sp });
    acrylic.push(saddleMesh(sMin, sMax, missing));
  }

  // major connector
  let connRange = null;
  if (connector && components.length) {
    let lo = Infinity, hi = -Infinity;
    for (const s of minorStarts) { lo = Math.min(lo, s); hi = Math.max(hi, s); }
    for (const sd of saddles) {
      if (sd.span.distalRight) lo = Math.min(lo, sd.sMax - 9);
      else if (sd.span.distalLeft) hi = Math.max(hi, sd.sMin + 9);
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
    const prof = [
      [-W - 2.3, BAR.top - 1.4], [-W - 1.5, top - 2.8], [-W * 0.85, top + 0.0], [-W * 0.3, top + 0.95], [0, top + 1.05],
      [W * 0.3, top + 0.95], [W * 0.85, top + 0.0], [W + 1.6, top - 2.8], [W + 2.5, top - 5.5],
      // inner (tissue) surface back
      [W + 1.9, top - 5.5], [W + 0.9, top - 2.6], [0, top + 0.15], [-W - 0.9, top - 2.6], [-W - 1.7, BAR.top - 1.4],
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
  if (!state.connector) push('fail', 'No major connector', 'Join both sides of the arch with a lingual bar or a lingual plate.');
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
