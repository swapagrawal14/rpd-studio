// Kennedy classification of a partially edentulous arch, with Applegate's rules.
// Arch positions in order from patient's right distal to left distal:
// index 0..6  = right quadrant 7..1 (FDI 47..41 mandibular, 17..11 maxillary)
// index 7..13 = left quadrant 1..7 (FDI 31..37 mandibular, 21..27 maxillary)
// Third molars are not modelled (Applegate rule 3: not considered unless used as abutments).
// The classification itself is index-based, so it works the same for both arches.

export const ARCH_LEN = 14;

/** Which cast is loaded. Mutated in place by anatomy.setArch() so every module sees the change. */
export const ARCH = { name: 'mandibular' };
export const ARCH_LABEL = { mandibular: 'Mandibular', maxillary: 'Maxillary' };

export function posInfo(i) {
  const right = i < 7;
  const num = right ? 7 - i : i - 6; // 1 = central .. 7 = second molar
  return { right, num, side: right ? 'R' : 'L' };
}

export function fdi(i, arch = ARCH.name) {
  const { right, num } = posInfo(i);
  const quad = arch === 'mandibular' ? (right ? 4 : 3) : right ? 1 : 2;
  return `${quad}${num}`;
}

export const TOOTH_NAMES = {
  1: 'Central incisor',
  2: 'Lateral incisor',
  3: 'Canine',
  4: 'First premolar',
  5: 'Second premolar',
  6: 'First molar',
  7: 'Second molar',
};

/**
 * missing: boolean[14]. replaceSecondMolars: Applegate rule 4 —
 * a missing second molar that will not be replaced is not considered.
 */
export function classify(missing, { replaceSecondMolars = false } = {}) {
  const considered = missing.map((m, i) => {
    if (!m) return false;
    const { num } = posInfo(i);
    if (num === 7 && !replaceSecondMolars) return false; // rule 4
    return true;
  });

  // Edentulous spans as contiguous runs in arch order (a run may cross the midline).
  const spans = [];
  let cur = null;
  for (let i = 0; i < ARCH_LEN; i++) {
    if (considered[i]) {
      if (!cur) cur = { start: i, end: i };
      else cur.end = i;
    } else if (cur) {
      spans.push(cur);
      cur = null;
    }
  }
  if (cur) spans.push(cur);

  const notes = [];
  if (missing.some((m, i) => m && posInfo(i).num === 7) && !replaceSecondMolars)
    notes.push('Missing second molar(s) not being replaced are not considered (Applegate rule 4).');

  if (spans.length === 0) {
    return { kennedy: null, label: 'Complete dentition', mods: 0, spans: [], notes, considered };
  }

  // Each side's distal end: the second molar, or the first molar when a missing
  // second molar is not considered.
  const rightDistalIdx = !considered[0] && missing[0] ? 1 : 0;
  const leftDistalIdx = !considered[13] && missing[13] ? 12 : 13;

  for (const s of spans) {
    s.distalRight = s.start === rightDistalIdx;
    s.distalLeft = s.end === leftDistalIdx;
    s.crossesMidline = s.start <= 6 && s.end >= 7;
    s.anterior = s.crossesMidline;
    s.teeth = [];
    for (let i = s.start; i <= s.end; i++) s.teeth.push(i);
  }

  // Any posterior distal-extension span?
  const distalR = spans.find((s) => s.distalRight);
  const distalL = spans.find((s) => s.distalLeft);

  let kennedy;
  let main = [];
  if (distalR && distalL && distalR !== distalL) {
    kennedy = 'I';
    main = [distalR, distalL];
  } else if (distalR || distalL) {
    kennedy = 'II';
    main = [distalR || distalL];
  } else {
    // Class IV: a single bilateral anterior span crossing the midline, all remaining teeth posterior to it.
    const onlyAnterior = spans.length === 1 && spans[0].crossesMidline;
    if (onlyAnterior) {
      kennedy = 'IV';
      main = [spans[0]];
    } else {
      kennedy = 'III';
      // The most posterior bounded space determines the class (Applegate rule 5).
      const dist = (s) => Math.max(...s.teeth.map((i) => posInfo(i).num));
      main = [spans.slice().sort((a, b) => dist(b) - dist(a))[0]];
    }
  }

  const mods = spans.filter((s) => !main.includes(s)).length;
  for (const s of spans) s.role = main.includes(s) ? 'main' : 'modification';

  if (kennedy === 'IV') notes.push('Class IV can have no modification spaces (Applegate rule 8).');
  if (kennedy !== 'IV' && mods > 0)
    notes.push('Extent of a modification space doesn\u2019t matter, only the number of extra spaces (rule 7).');

  const label = `Kennedy Class ${kennedy}${mods ? `, modification ${mods}` : ''}`;
  return { kennedy, label, mods, spans, notes, considered };
}

// Teaching presets (arch order index 0..13)
export const PRESETS = {
  'Class I': [0, 1, 2, 11, 12, 13],
  'Class II mod 1': [0, 1, 2, 10],
  'Class III mod 1': [2, 11, 12],
  'Class IV': [5, 6, 7, 8],
};

export function presetMissing(name) {
  const m = new Array(ARCH_LEN).fill(false);
  for (const i of PRESETS[name]) m[i] = true;
  return m;
}
