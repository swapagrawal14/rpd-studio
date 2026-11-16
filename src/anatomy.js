// Procedural casts (mandibular or maxillary): arch form, teeth with real-ish crown contours (mm),
// gingiva, palate (maxillary) and stone base. The cast always sits teeth-up on the surveyor table,
// so a maxillary cast is mirrored left-right compared with the mandibular one (patient's right at +x).
import { v3, add, sub, mul, norm, cross, dot, len, clamp, smooth, computeNormals, gridMesh, mergeMeshes } from './geom.js';
import { posInfo, ARCH_LEN, ARCH } from './kennedy.js';

// Crown dimensions (mm): mesiodistal, buccolingual, crown height. Wheeler-style averages.
const MAND_SPECS = {
  1: { md: 5.0, bl: 6.0, h: 9.0, type: 'incisor' },
  2: { md: 5.5, bl: 6.4, h: 9.5, type: 'incisor' },
  3: { md: 7.0, bl: 7.5, h: 11.0, type: 'canine' },
  4: { md: 7.0, bl: 7.6, h: 8.5, type: 'premolar' },
  5: { md: 7.2, bl: 8.0, h: 8.0, type: 'premolar' },
  6: { md: 11.0, bl: 10.5, h: 7.5, type: 'molar' },
  7: { md: 10.5, bl: 10.0, h: 7.0, type: 'molar' },
};
const MAX_SPECS = {
  1: { md: 8.5, bl: 7.0, h: 10.5, type: 'incisor' },
  2: { md: 6.5, bl: 6.0, h: 9.0, type: 'incisor' },
  3: { md: 7.5, bl: 8.0, h: 10.0, type: 'canine' },
  4: { md: 7.0, bl: 9.0, h: 8.5, type: 'premolar' },
  5: { md: 6.5, bl: 9.0, h: 8.5, type: 'premolar' },
  6: { md: 10.0, bl: 11.0, h: 7.5, type: 'molar' },
  7: { md: 9.0, bl: 11.0, h: 7.0, type: 'molar' },
};
/**
 * Maxillary heights of contour as a fraction of crown height from the CEJ (Wheeler):
 * facial surfaces of all teeth in the cervical third; lingual of anteriors on the cingulum
 * (cervical third); lingual/palatal of posteriors in the middle third.
 */
export const MAX_HOC = {
  incisor: { buccal: 0.25, lingual: 0.2 },
  canine: { buccal: 0.3, lingual: 0.25 },
  premolar: { buccal: 0.3, lingual: 0.5 },
  molar: { buccal: 0.33, lingual: 0.5 },
};
// Width at the CEJ relative to the height of contour on the facial side: sets how much undercut
// lies between the HOC and the gingival third (premolar ~0.27 mm, molar ~0.29 mm at 1.4 mm above the CEJ).
const MAX_CERVICAL = { incisor: 0.82, canine: 0.82, premolar: 0.68, molar: 0.72 };
export const SPECS = { ...MAND_SPECS }; // live: refilled by setArch()
export const OCC_Y = 8.5; // occlusal plane height

// ---------- Arch curve ----------
// Half-arch Bezier control points (x, z), patient's midline at x = 0, anterior towards +z.
const ARCH_P = {
  mandibular: [v3(0, 0, 21), v3(12.5, 0, 21), v3(22.5, 0, 6), v3(24.5, 0, -32)],
  maxillary: [v3(0, 0, 23.5), v3(16, 0, 23.5), v3(26, 0, 8), v3(27.5, 0, -30)],
};
let P = ARCH_P.mandibular;
function bez(t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return v3(a * P[0].x + b * P[1].x + c * P[2].x + d * P[3].x, 0, a * P[0].z + b * P[1].z + c * P[2].z + d * P[3].z);
}
const LUT = [];
export let ARCH_S_MAX = 0;
function buildLUT() {
  LUT.length = 0;
  let prev = bez(0), s = 0;
  LUT.push({ s: 0, p: prev });
  for (let i = 1; i <= 600; i++) {
    const p = bez(i / 600);
    s += len(sub(p, prev));
    LUT.push({ s, p });
    prev = p;
  }
  ARCH_S_MAX = LUT[LUT.length - 1].s;
}
buildLUT();

function halfArch(s) {
  if (s >= ARCH_S_MAX) {
    const a = LUT[LUT.length - 2].p, b = LUT[LUT.length - 1].p;
    const t = norm(sub(b, a));
    return { p: add(b, mul(t, s - ARCH_S_MAX)), t };
  }
  let lo = 0, hi = LUT.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (LUT[m].s < s) lo = m; else hi = m;
  }
  const A = LUT[lo], B = LUT[hi];
  const f = (s - A.s) / (B.s - A.s || 1);
  return { p: add(A.p, mul(sub(B.p, A.p), f)), t: norm(sub(B.p, A.p)) };
}

/** Signed arc length: s > 0 at x > 0, s < 0 at x < 0. t points distal, b buccal. */
export function archFrame(s) {
  const left = s >= 0;
  const h = halfArch(Math.abs(s));
  let p = h.p, t = h.t;
  if (!left) { p = v3(-p.x, p.y, p.z); t = v3(-t.x, t.y, t.z); }
  // buccal = horizontal perpendicular pointing away from arch centre
  let b = norm(v3(t.z, 0, -t.x));
  if (dot(b, v3(p.x, 0, p.z - 0)) < 0 && Math.abs(s) > 0.5) b = mul(b, -1);
  if (Math.abs(s) <= 0.5) b = v3(0, 0, 1);
  return { p, t, b, up: v3(0, 1, 0) };
}

/**
 * Sign of s on the patient's right. Mandibular cast: right at x < 0. Maxillary cast, turned teeth-up
 * for the surveyor: right at x > 0.
 */
export const SIDE = { right: -1 };

// Tooth centre arc positions (live)
export const TOOTH_S = {};
function buildToothS() {
  let s = 0;
  for (let num = 1; num <= 7; num++) {
    const w = SPECS[num].md;
    TOOTH_S[num] = s + w / 2 + 0.05;
    s += w + 0.1;
  }
}
buildToothS();

export const PALATE = { torus: 'none' }; // 'none' | 'mid' | 'posterior'

/** Switch the whole cast to the other arch. Callers must rebuild every cached mesh afterwards. */
export function setArch(name) {
  ARCH.name = name;
  Object.assign(SPECS, name === 'maxillary' ? MAX_SPECS : MAND_SPECS);
  P = ARCH_P[name];
  SIDE.right = name === 'maxillary' ? 1 : -1;
  buildLUT();
  buildToothS();
  palCache = null;
}
export const isMax = () => ARCH.name === 'maxillary';

export function toothS(i) {
  const { right, num } = posInfo(i);
  return right ? SIDE.right * TOOTH_S[num] : -SIDE.right * TOOTH_S[num];
}
export function toothFrame(i) {
  const { num } = posInfo(i);
  const spec = SPECS[num];
  const f = archFrame(toothS(i));
  const cej = OCC_Y - spec.h;
  return { ...f, origin: add(f.p, v3(0, cej, 0)), spec, num, cej };
}
/** local (x distal, y up from CEJ, z buccal) -> cast space */
export function toCast(fr, l) {
  return add(fr.origin, add(add(mul(fr.t, l.x), mul(fr.up, l.y)), mul(fr.b, l.z)));
}

// ---------- Tooth shape ----------
function profile(t, base, peak, top) {
  // rises from `base` at t=0 to 1 at `peak`, then eases to `top` at t=1
  if (t <= peak) { const u = 1 - t / peak; return base + (1 - base) * (1 - u * u); }
  const u = (t - peak) / (1 - peak);
  return 1 + (top - 1) * (1 - Math.cos(u * Math.PI * 0.5));
}
function superE(theta, n) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: Math.sign(c) * Math.pow(Math.abs(c), 2 / n), z: Math.sign(s) * Math.pow(Math.abs(s), 2 / n) };
}
const MAX_CUSPS = {
  // [mesiodistal u (+distal), buccolingual w (+buccal), height]; mesiopalatal is the largest cusp
  molar: [[-0.42, 0.45, 1.5], [0.42, 0.45, 1.3], [-0.3, -0.42, 1.85], [0.5, -0.42, 1.05]],
  molar7: [[-0.42, 0.45, 1.45], [0.42, 0.45, 1.1], [-0.25, -0.42, 1.75], [0.55, -0.42, 0.7]],
  premolar4: [[0, 0.32, 2.2], [0, -0.42, 1.5]], // palatal cusp about 1 mm shorter
  premolar5: [[0, 0.32, 1.9], [0, -0.42, 1.75]], // cusps nearly equal
  canine: [[0, 0.05, 2.4]],
  incisor: [],
};
const CUSPS = {
  molar: [[-0.45, 0.48, 1.5], [0.12, 0.52, 1.35], [0.62, 0.32, 1.0], [-0.4, -0.48, 1.7], [0.35, -0.48, 1.55]],
  premolar4: [[0, 0.32, 2.3], [0, -0.5, 0.7]],
  premolar5: [[0, 0.3, 1.9], [-0.25, -0.5, 1.3], [0.3, -0.5, 1.0]],
  canine: [[0, 0.05, 2.2]],
  incisor: [],
};
export const NJ = 56;

function wallScale(spec, num, t, theta) {
  const type = spec.type;
  const buccalSide = Math.sin(theta); // >0 buccal
  let sx, szB, szL, nExp;
  if (type === 'molar') {
    sx = profile(t, 0.8, 0.72, 0.86);
    szB = profile(t, 0.8, 0.38, 0.7);
    szL = profile(t, 0.84, 0.55, 0.72);
    nExp = 3.0;
  } else if (type === 'premolar') {
    sx = profile(t, 0.74, 0.7, 0.8);
    szB = profile(t, 0.74, 0.38, 0.62);
    szL = profile(t, 0.82, 0.55, 0.66);
    nExp = 2.4;
  } else if (type === 'canine') {
    sx = profile(t, 0.7, 0.65, 0.25);
    szB = profile(t, 0.8, 0.34, 0.42);
    szL = profile(t, 0.8, 0.22, 0.42);
    nExp = 2.1;
  } else {
    sx = profile(t, 0.68, 0.75, 0.96);
    szB = profile(t, 0.88, 0.3, 0.28);
    szL = profile(t, 0.86, 0.2, 0.26);
    nExp = 2.6;
  }
  if (ARCH.name === 'maxillary') {
    const hoc = MAX_HOC[type];
    const base = MAX_CERVICAL[type];
    const topB = type === 'molar' ? 0.72 : type === 'premolar' ? 0.66 : type === 'canine' ? 0.42 : 0.3;
    const topL = type === 'molar' ? 0.74 : type === 'premolar' ? 0.68 : type === 'canine' ? 0.4 : 0.26;
    szB = profile(t, base, hoc.buccal, topB);
    szL = profile(t, Math.max(base, 0.78), hoc.lingual, topL);
  }
  const w = smooth(-0.35, 0.35, buccalSide);
  return { sx, sz: szL + (szB - szL) * w, nExp };
}

/**
 * Build a tooth mesh in cast coordinates. Returns positions and per-vertex metadata used by the surveyor.
 */
export function buildTooth(i, { scale = 1, lift = 0 } = {}) {
  const fr = toothFrame(i);
  const { spec, num } = fr;
  const a = (spec.md / 2) * scale, b = (spec.bl / 2) * scale, h = spec.h * scale;
  const rootRings = [-0.42, -0.28, -0.14, 0];
  const wallRings = [];
  for (let k = 1; k <= 22; k++) wallRings.push(k / 22);
  const capRings = [];
  for (let k = 1; k <= 9; k++) capRings.push(k / 9);
  const CU = ARCH.name === 'maxillary' ? MAX_CUSPS : CUSPS;
  const cusps = num === 4 ? CU.premolar4 : num === 5 ? CU.premolar5 : num === 7 && CU.molar7 ? CU.molar7 : CU[spec.type];

  const rows = [];
  const meta = []; // per row: { t, kind }
  const ring = (t) => {
    const row = [];
    for (let j = 0; j < NJ; j++) {
      const th = (j / NJ) * Math.PI * 2;
      if (t < 0) {
        const se = superE(th, 2.2);
        const f = 0.8 + 0.25 * t; // taper
        row.push({ x: a * 0.8 * f * se.x, y: t * h, z: b * 0.84 * f * se.z });
      } else {
        const ws = wallScale(spec, num, t, th);
        const se = superE(th, ws.nExp);
        row.push({ x: a * ws.sx * se.x, y: t * h, z: b * ws.sz * se.z });
      }
    }
    return row;
  };
  for (const t of rootRings) { rows.push(ring(t)); meta.push({ t, kind: t < 0 ? 'root' : 'wall' }); }
  for (const t of wallRings) { rows.push(ring(t)); meta.push({ t, kind: 'wall' }); }
  const top = rows[rows.length - 1];
  for (const c of capRings) {
    const rho = 1 - c;
    const row = top.map((p) => {
      const x = p.x * rho, z = p.z * rho;
      const u = x / a, w = z / b;
      let y = 0;
      for (const [cu, cw, ch] of cusps) y += ch * scale * Math.exp(-((u - cu) ** 2 + (w - cw) ** 2) / 0.12);
      if (spec.type === 'molar' || spec.type === 'premolar') y -= 1.0 * scale * Math.exp(-(u * u + w * w) / 0.08);
      const blend = smooth(0, 0.45, c);
      return { x, y: h + y * blend + (spec.type === 'incisor' ? 0.0 : 0.25 * blend), z };
    });
    rows.push(row);
    meta.push({ t: 1 + c * 0.2, kind: 'cap' });
  }
  // close the top with a centre point row (degenerate ring)
  const castRows = rows.map((row) => row.map((p) => {
    const q = toCast(fr, p);
    q.y += lift;
    return q;
  }));
  const g = gridMesh(castRows, { closeCols: true });
  // orient outward
  const c0 = toCast(fr, v3(0, h * 0.5, 0));
  let sgn = 0;
  for (let k = 0; k < g.positions.length; k += 3 * 7) {
    sgn += (g.positions[k] - c0.x) * g.normals[k] + (g.positions[k + 1] - c0.y) * g.normals[k + 1] + (g.positions[k + 2] - c0.z) * g.normals[k + 2];
  }
  let geo = g;
  if (sgn < 0) geo = gridMesh(castRows, { closeCols: true, flip: true });
  return { ...geo, rows: castRows.length, cols: NJ, meta, frame: fr, a, b, h, local: rows };
}

// ---------- Gingiva and base ----------
export function gumAt(s, missing) {
  // weight of present teeth near s
  let pf = 0, bl = 8, cej = 0;
  let wsum = 0;
  for (let i = 0; i < ARCH_LEN; i++) {
    const { num } = posInfo(i);
    const sp = SPECS[num];
    const d = Math.abs(s - toothS(i));
    const w = 1 - smooth(sp.md * 0.35, sp.md * 0.75, d);
    if (w > 0) {
      wsum += w;
      bl = bl * (1 - w) + sp.bl * w;
      cej = cej * (1 - w) + (OCC_Y - sp.h) * w;
      if (!missing[i]) pf = Math.max(pf, w);
    }
  }
  const sideEnd = TOOTH_S[7] + SPECS[7].md / 2;
  const beyond = Math.abs(s) > sideEnd ? 1 : 0;
  // retromolar pad region: low rounded
  const ridgeTop = -1.6 - beyond * smooth(sideEnd, sideEnd + 6, Math.abs(s)) * 0.8;
  const toothTop = cej + 0.7;
  const top = ridgeTop + (toothTop - ridgeTop) * pf;
  const W = 4.6 + (bl / 2 + 0.9 - 4.6) * pf;
  return { top, W, pf };
}

export function buildGingiva(missing) {
  const sEnd = TOOTH_S[7] + SPECS[7].md / 2 + 9;
  const rows = [];
  const N = 260;
  for (let k = 0; k <= N; k++) {
    const s = -sEnd + (2 * sEnd * k) / N;
    const f = archFrame(s);
    const { top, W } = gumAt(s, missing);
    // maxillary: the palatal side runs into the palate instead of down to a tongue space
    const ling = isMax()
      ? [[-W - 2.4, top - 6.8], [-W - PAL_JOIN.n, top - PAL_JOIN.dy]]
      : [[-W - 3.2, -12], [-W - 2.4, -7]];
    const prof = [
      ...ling, [-W - 1.0, top - 2.6], [-W * 0.75, top - 0.5], [-W * 0.3, top], [0, top + 0.1],
      [W * 0.3, top], [W * 0.75, top - 0.5], [W + 1.0, top - 2.6], [W + 2.6, -7], [W + 3.8, -12],
    ];
    rows.push(prof.map(([n, y]) => add(add(f.p, mul(f.b, n)), v3(0, y, 0))));
  }
  const gum = orientedGrid(rows, null, 5);
  return isMax() ? mergeMeshes([gum, buildPalate(missing)]) : gum;
}

// ---------- Palate (maxillary) ----------
// Where the palatal gingiva meets the palate: offset lingual of the ridge crest line and drop below the crest.
export const PAL_JOIN = { n: 2.0, dy: 4.6 };
const VAULT_DEPTH = 8; // mm below the palatal join at the deepest point (~19 mm from the occlusal plane at M1)
let palCache = null;

function sideCurve(sign, missing, sEnd) {
  const pts = [];
  for (let s = 0; s <= sEnd + 1e-6; s += 0.25) {
    const ss = sign * s;
    const f = archFrame(ss);
    const g = gumAt(ss, missing);
    const p = add(f.p, mul(f.b, -(g.W + PAL_JOIN.n)));
    pts.push({ s, x: Math.abs(p.x), z: p.z, y: g.top - PAL_JOIN.dy });
  }
  return pts;
}
// x (and y) of a curve at a given z: first crossing from the anterior end
function atZ(curve, z) {
  if (z >= curve[0].z) return { x: curve[0].x * 0, y: curve[0].y, s: 0 };
  for (let k = 1; k < curve.length; k++) {
    const a = curve[k - 1], b = curve[k];
    if ((a.z - z) * (b.z - z) <= 0) {
      const f = (z - a.z) / (b.z - a.z || 1);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, s: a.s + (b.s - a.s) * f };
    }
  }
  const e = curve[curve.length - 1];
  return { x: e.x, y: e.y, s: e.s };
}

/** Palate geometry for the current arch and missing teeth (cached by the caller via palateSetup). */
export function palateSetup(missing) {
  const key = missing.map((m) => (m ? 1 : 0)).join('') + PALATE.torus;
  if (palCache && palCache.key === key) return palCache;
  const sEnd = TOOTH_S[7] + SPECS[7].md / 2 + 7; // vibrating line: a little behind the tuberosities
  const none = new Array(ARCH_LEN).fill(false);
  const pos = sideCurve(1, missing, sEnd), neg = sideCurve(-1, missing, sEnd);
  const full = sideCurve(1, none, sEnd);
  const zFront = Math.min(pos[0].z, neg[0].z);
  const zEnd = Math.max(pos[pos.length - 1].z, neg[neg.length - 1].z);
  // torus palatinus: a midline bony bulge (teeth-up cast, so it rises towards the occlusal plane)
  const zContact = archFrame(TOOTH_S[5] + SPECS[5].md / 2).p.z; // PM2 / M1 contact level
  let torus = null;
  if (PALATE.torus === 'mid') torus = { zc: zContact - 4, rz: 8.5, rx: 6.5, h: 3.0 };
  if (PALATE.torus === 'posterior') torus = { zc: zEnd + 9, rz: 10.5, rx: 7, h: 3.2 };
  if (torus) torus.range = [torus.zc - torus.rz, torus.zc + torus.rz];
  const yFront = full[0].y; // palatal join behind the central incisors
  const yDeep = OCC_Y - SPECS[6].h + 0.7 - PAL_JOIN.dy - VAULT_DEPTH; // VAULT_DEPTH below the join at M1
  palCache = { key, pos, neg, full, zFront, zEnd, yFront, yDeep, zPost: zEnd + 1.5, sEnd, torus, missing: missing.slice() };
  return palCache;
}

/** Palate surface height at (x, z). */
export function palateY(x, z, pal = palCache) {
  const side = x >= 0 ? pal.pos : pal.neg;
  const e = atZ(side, z);
  const u = clamp((pal.zFront - z) / (pal.zFront - pal.zEnd), 0, 1);
  const prof = smooth(0, 0.42, u) * (1 - 0.18 * smooth(0.78, 1, u));
  // midline: from the incisive papilla level down into the vault (a smooth curve, independent of
  // the gingival scallops, so the vault has no ripples)
  const yMid = pal.yFront + (pal.yDeep - pal.yFront) * prof;
  const X = Math.max(e.x, 1e-3);
  const r = clamp(Math.abs(x) / X, 0, 1);
  const f = 0.3 * r * r + 0.7 * Math.pow(r, 5);
  let y = yMid + (e.y - yMid) * f;
  // rugae: wavy transverse ridges in the anterior third, fading at the raphe and the walls
  const ru = smooth(0.02, 0.1, u) * (1 - smooth(0.26, 0.36, u)) * smooth(0.6, 2.2, Math.abs(x)) * (1 - smooth(0.7, 0.92, r));
  if (ru > 0) y += 0.42 * ru * Math.pow(Math.max(0, Math.sin((pal.zFront - z) * 1.9 + Math.abs(x) * 0.55 + 0.6 * Math.sin(Math.abs(x) * 0.9))), 3);
  // incisive papilla
  const dz = z - (pal.zFront - 2.2);
  y += 0.75 * Math.exp(-(x * x) / 2.2 - (dz * dz) / 3.0) * smooth(0, 0.05, u + 0.05);
  if (pal.torus) {
    const t = pal.torus;
    const d = (x / t.rx) ** 2 + ((z - t.zc) / t.rz) ** 2;
    if (d < 1) y += t.h * Math.pow(1 - d, 1.4) * (1 + 0.12 * Math.sin(z * 1.3) * Math.sign(x || 1));
  }
  return y;
}
/** Half-width (positive) of the palate on one side at z. */
export function palateHalfWidth(sign, z, pal = palCache) {
  return atZ(sign >= 0 ? pal.pos : pal.neg, z).x;
}

function buildPalate(missing) {
  const pal = palateSetup(missing);
  const rows = [];
  const NC = 44;
  const zs = [];
  for (let z = pal.zFront; z > pal.zEnd; z -= 0.5) zs.push(z);
  zs.push(pal.zEnd);
  for (const z of zs) {
    const xp = palateHalfWidth(1, z, pal), xn = palateHalfWidth(-1, z, pal);
    const row = [];
    for (let c = 0; c <= NC; c++) {
      const t = (c / NC) * 2 - 1;
      const x = t < 0 ? t * xn : t * xp;
      row.push(v3(x, palateY(x, z, pal), z));
    }
    rows.push(row);
  }
  // posterior face down to the base, so the stone looks solid from behind
  const last = rows[rows.length - 1];
  rows.push(last.map((p) => v3(p.x, -22.8, p.z)));
  let g = gridMesh(rows);
  const mid = (Math.floor(rows.length / 2) * (NC + 1) + NC / 2) * 3;
  if (g.normals[mid + 1] < 0) g = gridMesh(rows, { flip: true });
  return g;
}

export function buildBase() {
  const sEnd = TOOTH_S[7] + SPECS[7].md / 2 + 12;
  const rows = [];
  const N = 120;
  for (let k = 0; k <= N; k++) {
    const s = -sEnd + (2 * sEnd * k) / N;
    const f = archFrame(s);
    const W = 6.5;
    const prof = [[-W - 2.6, -11.5], [-W - 4, -12.6], [-W - 4.2, -23], [W + 6.5, -23], [W + 6.3, -12.6], [W + 4.6, -11.5]];
    rows.push(prof.map(([n, y]) => add(add(f.p, mul(f.b, n)), v3(0, y, 0))));
  }
  rows.forEach((row) => row.push(row[0]));
  const body = orientedGrid(rows, null, 3);
  return body;
}

// Make grid; orient normals away from a reference point per row; cap the two ends.
function orientedGrid(rows, refFn, testCol) {
  // testCol is a vertex on an upward-facing part of the profile (gum crest / base bottom handled by sign)
  let g = gridMesh(rows);
  const r = Math.floor(rows.length / 2);
  const C = rows[0].length;
  const vi = (r * C + testCol) * 3;
  const up = testCol === 3 ? -1 : 1; // base: col 3 sits on the bottom face, which faces down
  if (g.normals[vi + 1] * up < 0) g = gridMesh(rows, { flip: true });
  // caps
  const pos = Array.from(g.positions), ind = Array.from(g.indices);
  const cap = (rowIdx, outward) => {
    const row = rows[rowIdx];
    const c = row.reduce((acc, q) => add(acc, q), v3()).x !== undefined ? mul(row.reduce((acc, q) => add(acc, q), v3()), 1 / row.length) : v3();
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let j = 0; j < C; j++) {
      const a = rowIdx * C + j, b = rowIdx * C + ((j + 1) % C);
      // test winding against outward
      const pa = row[j], pb = row[(j + 1) % C];
      const nn = cross(sub(pa, c), sub(pb, c));
      if (dot(nn, outward) >= 0) ind.push(ci, a, b); else ind.push(ci, b, a);
    }
  };
  const t0 = sub(rows[0][0], rows[1][0]);
  const t1 = sub(rows[rows.length - 1][0], rows[rows.length - 2][0]);
  cap(0, t0);
  cap(rows.length - 1, t1);
  const positions = new Float32Array(pos), indices = new Uint32Array(ind);
  return { positions, indices, normals: computeNormals(positions, indices) };
}
