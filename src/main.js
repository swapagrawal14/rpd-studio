import { Application, Container, Graphics, Point, Text } from 'pixi.js';
import {
  AmbientLight, Container3D, CylinderGeometry, DirectionalLight, FlatMaterial, Geometry3D, Material3D, Mesh3D, SphereGeometry, View3D, srgbToLinear,
} from '@pixi/3d';
import { OrbitCamera, ToonMaterial, OutlinePass } from '@pixi/3d/extras';
import { classify, PRESETS, presetMissing, fdi, posInfo, TOOTH_NAMES, ARCH_LEN } from './kennedy.js';
import { buildTooth, buildGingiva, buildBase, toothFrame, toCast, archFrame, SPECS, OCC_Y } from './anatomy.js';
import { surveyTooth, surveyLine, gaugeLine, undercutColors } from './survey.js';
import { topology, defaultRestSide, buildFramework, checkDesign, suggestDesign, CLASP_NAMES, TIP_DEPTH } from './design.js';
import { v3, add, sub, mul, tube, mergeMeshes, tiltRotate } from './geom.js';

// ---------------- state ----------------
const state = {
  tab: 'case',
  missing: presetMissing('Class I'),
  replaceM2: false,
  ap: 0,
  lat: 0,
  gauge: 0.25,
  showMap: true,
  showLines: true,
  tool: 'rest',
  components: [],
  connector: 'lingual-bar',
  sulcus: 9,
  showBase: true,
  measure: null, // { i, k, depth }
};
let cls, topo, surveys = {}, fw = null, check = null;

// ---------------- app ----------------
const app = new Application();
await app.init({
  resizeTo: window,
  backgroundAlpha: 0,
  antialias: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});
document.getElementById('stage').appendChild(app.canvas);

const view = new View3D({
  width: 300, height: 300,
  shadowQuality: 'medium',
  environment: { skyColor: 0xfff4e6, groundColor: 0x6b5a5e, intensity: 0.6 },
  passes: [new OutlinePass({ width: 0.16, color: 0x221d1f })],
});
app.stage.addChild(view);
const cam = view.camera;
cam.fov = 38;
cam.near = 1;
cam.far = 2000;

const sun = new DirectionalLight({ intensity: 1.25, castShadow: true, color: 0xffffff });
sun.position.set(40, 120, 70);
sun.lookAt({ x: 0, y: 0, z: 0 });
view.root.addChild(sun);
const fill = new DirectionalLight({ intensity: 0.35, color: 0xffe3f0 });
view.root.addChild(new AmbientLight({ intensity: 0.75, color: 0xffffff }));
fill.position.set(-60, 40, -50);
fill.lookAt({ x: 0, y: 0, z: 0 });
view.root.addChild(fill);

const world = new Container3D({ label: 'world', parent: view.root });
const cast = new Container3D({ label: 'cast', parent: world });

// materials
const L = (hex) => hex;
const toon = (baseColor, o = {}) => new ToonMaterial({ baseColor, bands: 2, specularSize: 0, rimIntensity: 0.12, rimPower: 5, ...o });
const mats = {
  tooth: toon(0xffffff, { vertexColors: true, specularSize: 0.06 }),
  ghost: new Material3D({ baseColor: 0xf07ab3, roughness: 0.8, alphaMode: 'blend', alpha: 0.16, passes: { outline: false } }),
  gum: toon(0xf07ab3, { rimIntensity: 0 }),
  stone: toon(0xa9b78c, { rimIntensity: 0 }),
  metal: toon(0xb8bdca, { bands: 3, specularSize: 0.12, rimIntensity: 0.3, doubleSided: true }),
  wire: toon(0xf3c138, { bands: 3, specularSize: 0.12, doubleSided: true }),
  acrylic: toon(0xc93f7f, { doubleSided: true }),
  dentureTooth: toon(0xfff4e0, { specularSize: 0.06 }),
  table: toon(0x3a3235),
  rod: toon(0xe9e6ef, { bands: 3, specularSize: 0.4 }),
  surveyLine: new FlatMaterial({ baseColor: 0x221d1f, passes: { outline: false } }),
  gaugeLine: new FlatMaterial({ baseColor: 0x7a3fd1, passes: { outline: false } }),
  fulcrum: toon(0xf3c138, { bands: 1, specularSize: 0 }),
};

const geo = (g, colors) => new Geometry3D({ positions: g.positions, normals: g.normals, indices: g.indices, ...(colors ? { colors } : {}) });
function setGeo(mesh, g, colors) {
  if (!g || !g.positions || !g.positions.length) { mesh.visible = false; return; }
  const old = mesh.geometry;
  mesh.geometry = geo(g, colors);
  mesh.visible = true;
  if (old) old.destroy();
}

// static: stone base and surveyor table
const baseMesh = new Mesh3D({ geometry: geo(buildBase()), material: mats.stone, parent: cast, receiveShadow: true });
new Mesh3D({ geometry: new CylinderGeometry({ radiusTop: 46, radiusBottom: 46, height: 3, radialSegments: 64 }), material: mats.table, position: { x: 0, y: -24.6, z: -4 }, parent: cast, receiveShadow: false });
new Mesh3D({ geometry: new SphereGeometry({ radius: 7 }), material: mats.table, position: { x: 0, y: -31, z: -4 }, parent: world });
new Mesh3D({ geometry: new CylinderGeometry({ radiusTop: 4, radiusBottom: 9, height: 40 }), material: mats.table, position: { x: 0, y: -55, z: -4 }, parent: world });

const gumMesh = new Mesh3D({ material: mats.gum, parent: cast, receiveShadow: true, castShadow: true });
const teethGroup = new Container3D({ parent: cast });
const toothMeshes = new Array(ARCH_LEN).fill(null);
const toothData = new Array(ARCH_LEN).fill(null);
const ghostMeshes = new Array(ARCH_LEN).fill(null);
const surveyLineMesh = new Mesh3D({ material: mats.surveyLine, parent: cast, castShadow: false });
const gaugeLineMesh = new Mesh3D({ material: mats.gaugeLine, parent: cast, castShadow: false });
const metalMesh = new Mesh3D({ material: mats.metal, parent: cast, castShadow: true });
const wireMesh = new Mesh3D({ material: mats.wire, parent: cast, castShadow: true });
const acrylicMesh = new Mesh3D({ material: mats.acrylic, parent: cast, castShadow: true });
const dentureTeethMesh = new Mesh3D({ material: mats.dentureTooth, parent: cast, castShadow: true });
const fulcrumMesh = new Mesh3D({ material: mats.fulcrum, parent: cast, castShadow: false });
for (const m of [surveyLineMesh, gaugeLineMesh, fulcrumMesh, metalMesh, wireMesh, acrylicMesh, dentureTeethMesh]) m.eventMode = 'none';

// analyzing rod (world space: always vertical)
const rod = new Container3D({ parent: world, visible: false });
new Mesh3D({ geometry: new CylinderGeometry({ radiusTop: 0.9, radiusBottom: 0.9, height: 36, radialSegments: 20 }), material: mats.rod, position: { x: 0, y: 18, z: 0 }, parent: rod });
new Mesh3D({ geometry: new CylinderGeometry({ radiusTop: 2.2, radiusBottom: 2.2, height: 10, radialSegments: 24 }), material: mats.table, position: { x: 0, y: 40, z: 0 }, parent: rod });

// ---------------- 2D overlay ----------------
const overlay = new Container();
app.stage.addChild(overlay);
const labelStyle = { fill: 0x221d1f, fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: '800' };
const fdiLabels = [];
for (let i = 0; i < ARCH_LEN; i++) {
  const t = new Text({ text: fdi(i), style: labelStyle, resolution: 2 });
  t.anchor.set(0.5);
  const bg = new Graphics();
  const c = new Container();
  c.addChild(bg, t);
  c._bg = bg; c._t = t;
  overlay.addChild(c);
  fdiLabels.push(c);
}
const fulcrumLabel = new Container();
{
  const t = new Text({ text: 'FULCRUM LINE', style: { ...labelStyle, fontSize: 11, letterSpacing: 0.8 }, resolution: 2 });
  t.anchor.set(0.5);
  const w = t.width + 18, h = 22;
  const g = new Graphics().roundRect(-w / 2 + 3, -h / 2 + 3, w, h, 8).fill(0x221d1f).roundRect(-w / 2, -h / 2, w, h, 8).fill(0xf3c138).stroke({ color: 0x221d1f, width: 2 });
  fulcrumLabel.addChild(g, t);
  fulcrumLabel.pivot.set(0, 22);
}
overlay.addChild(fulcrumLabel);
const callout = new Container();
const calloutG = new Graphics();
const calloutT = new Text({ text: '', style: { ...labelStyle, fontSize: 12 }, resolution: 2 });
callout.addChild(calloutG, calloutT);
overlay.addChild(callout);
callout.visible = false;

// ---------------- layout + camera ----------------
let orbit = null;
const target = { x: 0, y: 0, z: -4 };
function viewRect() {
  const W = window.innerWidth, H = window.innerHeight;
  if (W <= 820) return { x: 0, y: 0, w: W, h: Math.round(H * 0.54) };
  return { x: 0, y: 0, w: W - 380, h: H };
}
function layout() {
  const r = viewRect();
  view.setSize(r.w, r.h);
  view.position.set(r.x, r.y);
  view.hitArea = null;
}
layout();
window.addEventListener('resize', layout);

const VIEWS = {
  occlusal: { x: 0, y: 118, z: 34 },
  front: { x: 0, y: 34, z: 118 },
  right: { x: -112, y: 46, z: 10 },
  left: { x: 112, y: 46, z: 10 },
};
function makeOrbit() {
  orbit = new OrbitCamera({ view, target, enableDamping: true, minDistance: 45, maxDistance: 260, autoUpdate: false });
}
cam.position.set(VIEWS.occlusal.x, VIEWS.occlusal.y, VIEWS.occlusal.z);
cam.lookAt(target);
makeOrbit();
let camTween = null;
function goView(name) {
  const to = VIEWS[name];
  const from = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
  orbit.destroy();
  orbit = null;
  camTween = { from, to, t: 0 };
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
}

// ---------------- builders ----------------
function lin(r, g, b) { return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]; }

function rebuildCast() {
  cls = classify(state.missing, { replaceSecondMolars: state.replaceM2 });
  topo = topology(state.missing, cls);
  setGeo(gumMesh, buildGingiva(state.missing));
  for (let i = 0; i < ARCH_LEN; i++) {
    if (!toothData[i]) toothData[i] = buildTooth(i);
    if (!state.missing[i]) {
      if (!toothMeshes[i]) {
        const m = new Mesh3D({ material: mats.tooth, parent: teethGroup, castShadow: true, receiveShadow: true, eventMode: 'static', cursor: 'pointer' });
        m.hitVolume = 'geometry';
        m.on('pointertap', (e) => onTap(i, e));
        toothMeshes[i] = m;
      }
      toothMeshes[i].visible = true;
    } else if (toothMeshes[i]) toothMeshes[i].visible = false;
    if (state.missing[i]) {
      if (!ghostMeshes[i]) {
        const g = new Mesh3D({ geometry: geo(toothData[i]), material: mats.ghost, parent: teethGroup, eventMode: 'static', cursor: 'pointer', castShadow: false });
        g.hitVolume = 'geometry';
        g.on('pointertap', (e) => onTap(i, e));
        ghostMeshes[i] = g;
      }
    }
    if (ghostMeshes[i]) ghostMeshes[i].visible = state.missing[i] && state.tab === 'case';
    if (ghostMeshes[i]) ghostMeshes[i].eventMode = state.missing[i] && state.tab === 'case' ? 'static' : 'none';
  }
  state.components = state.components.filter((c) => !state.missing[c.tooth]);
  renderCaseUI();
  resurvey();
}

function resurvey() {
  surveys = {};
  const lines = [], gauges = [];
  for (let i = 0; i < ARCH_LEN; i++) {
    if (state.missing[i]) continue;
    const sv = surveyTooth(toothData[i], state.ap, state.lat);
    surveys[i] = sv;
    const showMap = state.tab === 'survey' && state.showMap;
    const colors = undercutColors(sv, { on: showMap, base: [0.98, 0.95, 0.88], srgbToLinear });
    setGeo(toothMeshes[i], toothData[i], colors);
    toothMeshes[i].hitVolume = 'geometry';
    if (state.showLines && (state.tab === 'survey' || state.tab === 'design')) {
      lines.push(tube(surveyLine(sv), () => (state.tab === 'survey' ? 0.09 : 0.06), { seg: 5, caps: false }));
      if (state.tab === 'survey') for (const seg of gaugeLine(sv, state.gauge)) gauges.push(tube(seg, () => 0.08, { seg: 5, caps: false }));
    }
  }
  setGeo(surveyLineMesh, lines.length ? mergeMeshes(lines) : null);
  setGeo(gaugeLineMesh, gauges.length ? mergeMeshes(gauges) : null);
  if (state.measure && !state.missing[state.measure.i]) measureAt(state.measure.i, state.measure.k);
  rebuildDesign();
}

function rebuildDesign() {
  const showFw = state.tab === 'design' || state.tab === 'check';
  fw = buildFramework(state, { topo, surveys, cls });
  setGeo(metalMesh, showFw && fw.metal.positions.length ? fw.metal : null);
  setGeo(wireMesh, showFw && fw.wire ? fw.wire : null);
  setGeo(acrylicMesh, showFw && state.showBase && fw.acrylic ? fw.acrylic : null);
  // replacement teeth
  if (showFw && state.showBase) {
    const list = [];
    for (let i = 0; i < ARCH_LEN; i++) if (cls.considered[i]) list.push(buildTooth(i, { lift: 0.9, scale: 0.97 }));
    setGeo(dentureTeethMesh, list.length ? mergeMeshes(list) : null);
  } else setGeo(dentureTeethMesh, null);
  check = checkDesign(state, { cls, topo }, fw);
  const f = check.fulcrum;
  if (showFw && f && f.ok) {
    const d = sub(f.B, f.A);
    const A = add(f.A, mul(d, -0.25)), B = add(f.B, mul(d, 0.25));
    setGeo(fulcrumMesh, tube([add(A, v3(0, 1.5, 0)), add(B, v3(0, 1.5, 0))], () => 0.32, { seg: 8 }));
  } else setGeo(fulcrumMesh, null);
  renderCheckUI();
}

// ---------------- interaction ----------------
let downAt = new Point();
view.on('pointerdown', (e) => downAt.copyFrom(e.global));
function onTap(i, e) {
  if (e.button !== 0) return;
  if (Math.hypot(e.global.x - downAt.x, e.global.y - downAt.y) > 7) return;
  if (state.tab === 'case') {
    state.missing[i] = !state.missing[i];
    document.querySelectorAll('#presets button').forEach((b) => b.classList.remove('on'));
    rebuildCast();
    return;
  }
  if (state.missing[i]) return;
  if (state.tab === 'survey') {
    // nearest vertex of the hit triangle
    const hit = e.hit3D;
    const td = toothData[i];
    let k = 0;
    if (hit && hit.triangleIndex >= 0) {
      let best = Infinity;
      for (let q = 0; q < 3; q++) {
        const vi = td.indices[hit.triangleIndex * 3 + q];
        const dx = td.positions[vi * 3] - hit.localPoint.x, dy = td.positions[vi * 3 + 1] - hit.localPoint.y, dz = td.positions[vi * 3 + 2] - hit.localPoint.z;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < best) { best = dd; k = vi; }
      }
    }
    state.measure = { i, k };
    measureAt(i, k);
    return;
  }
  if (state.tab === 'design') applyTool(i);
}

function measureAt(i, k) {
  const sv = surveys[i];
  if (!sv) return;
  const td = toothData[i];
  const r = Math.floor(k / td.cols), c = k % td.cols;
  const d = sv.depth[k];
  const hoc = sv.hocPos(c);
  const hocW = tiltRotate(hoc, state.ap, state.lat);
  const out = sv.outward(c);
  const outW = tiltRotate(out, state.ap, state.lat);
  rod.position.set(hocW.x + outW.x * 0.9, hocW.y, hocW.z + outW.z * 0.9);
  rod.visible = state.tab === 'survey';
  const kind = td.meta[r].kind;
  const p = v3(td.positions[k * 3], td.positions[k * 3 + 1], td.positions[k * 3 + 2]);
  state.measure = { i, k, p, depth: d };
  let verdict;
  if (kind === 'cap') verdict = 'Occlusal surface, above the height of contour.';
  else if (d < 0.02) verdict = 'Above the height of contour: no undercut here. Good for reciprocal arms and rests.';
  else if (d < 0.2) verdict = 'Shallow undercut. Too little for most retentive tips.';
  else if (d < 0.38) verdict = 'About right for a cast Co-Cr tip (0.25 mm), e.g. Akers or I-bar.';
  else if (d < 0.62) verdict = 'Suits a wrought-wire tip (0.50 mm).';
  else verdict = 'Deep undercut. Too much for a cast arm; consider blocking out or a different line.';
  document.getElementById('measureCard').innerHTML = `<h3>${fdi(i)} · ${d.toFixed(2)} mm</h3>${TOOTH_NAMES[posInfo(i).num]}. ${verdict}`;
  calloutT.text = `${d.toFixed(2)} mm`;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}

function applyTool(i) {
  const { num } = posInfo(i);
  const tool = state.tool;
  const comps = state.components;
  if (tool === 'erase') {
    state.components = comps.filter((c) => c.tooth !== i);
    rebuildDesign();
    return;
  }
  if (num <= 2) {
    toast('Mandibular incisors make poor rest seats here. Use the canine or a premolar.');
    return;
  }
  const t = topo[i];
  const def = defaultRestSide(topo, i);
  if (tool === 'rest') {
    const rests = comps.filter((c) => c.tooth === i && c.type === 'rest');
    if (!rests.length) comps.push({ type: 'rest', tooth: i, side: def });
    else if (rests.length === 1 && t.mSpan && t.dSpan) comps.push({ type: 'rest', tooth: i, side: rests[0].side === 'mesial' ? 'distal' : 'mesial' });
    else state.components = comps.filter((c) => !(c.tooth === i && c.type === 'rest'));
    if (num === 3 && !rests.length) toast('Incisal rest on the canine (cingulum is weak on mandibular canines).');
  } else {
    if (num === 3 && tool !== 'rest') toast('Clasping a canine is possible, but check the aesthetics.');
    const existing = comps.find((c) => c.tooth === i && ['akers', 'rpi', 'ww'].includes(c.type));
    state.components = comps.filter((c) => !(c.tooth === i && ['akers', 'rpi', 'ww'].includes(c.type)));
    if (!existing || existing.type !== tool) {
      const side = tool === 'rpi' ? 'mesial' : def;
      state.components.push({ type: tool, tooth: i, side });
      if (tool === 'rpi' && !t.distalExt) toast('RPI is designed for distal-extension abutments.');
    }
  }
  rebuildDesign();
}

// ---------------- UI ----------------
const $ = (s) => document.querySelector(s);
const presetsEl = $('#presets');
for (const name of Object.keys(PRESETS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => {
    state.missing = presetMissing(name);
    state.components = [];
    presetsEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    rebuildCast();
  };
  if (name === 'Class I') b.classList.add('on');
  presetsEl.appendChild(b);
}
$('#replaceM2').onchange = (e) => { state.replaceM2 = e.target.checked; rebuildCast(); };

function rangeLabel(sp) {
  const a = fdi(sp.start), b = fdi(sp.end);
  return a === b ? a : `${a}–${b}`;
}
function renderCaseUI() {
  $('#kennedyBadge').textContent = cls.kennedy ? `Class ${cls.kennedy}${cls.mods ? ` mod ${cls.mods}` : ''}` : 'No space';
  const spans = cls.spans.map((s) => {
    const kind = s.distalRight || s.distalLeft ? 'distal extension' : s.crossesMidline ? 'anterior, crosses midline' : 'tooth-bounded';
    return `<li><b>${rangeLabel(s)}</b> · ${kind}${s.role === 'modification' ? ' · modification space' : ''}</li>`;
  }).join('');
  const why = {
    I: 'Bilateral edentulous areas posterior to the remaining teeth.',
    II: 'A unilateral edentulous area posterior to the remaining teeth.',
    III: 'A unilateral edentulous area with natural teeth in front of and behind it.',
    IV: 'A single bilateral edentulous area anterior to the remaining teeth, crossing the midline.',
  };
  $('#classCard').innerHTML = cls.kennedy
    ? `<h3>${cls.label}</h3>${why[cls.kennedy]}<ul class="spans">${spans}</ul>${cls.notes.map((n) => `<div class="note">${n}</div>`).join('')}`
    : `<h3>Nothing to classify</h3>Tap teeth on the cast to extract them.${cls.notes.map((n) => `<div class="note">${n}</div>`).join('')}`;
}

function renderCheckUI() {
  const items = check.items;
  const scored = items.filter((x) => x.status !== 'info');
  const pass = scored.filter((x) => x.status === 'pass').length;
  const pct = scored.length ? Math.round((pass / scored.length) * 100) : 0;
  const col = pct >= 85 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
  $('#score').innerHTML = `<div class="ring" style="background: conic-gradient(${col} ${pct * 3.6}deg, rgba(255,255,255,.08) 0)"><span style="background:var(--bg1);width:50px;height:50px;border-radius:50%;display:grid;place-items:center">${pct}</span></div>
    <div class="txt"><b>${pass} of ${scored.length} checks pass</b>${cls.label || ''}${fw.results.length ? ` · ${fw.results.length} clasp${fw.results.length > 1 ? 's' : ''}` : ''}</div>`;
  const icon = { pass: '✓', warn: '!', fail: '✕', info: 'i' };
  $('#rules').innerHTML = items.map((x) => `<li class="${x.status}"><span class="ic">${icon[x.status]}</span><div><b>${x.title}</b><p>${x.detail}</p></div></li>`).join('');
}

const TOOL_HINTS = {
  rest: 'Tap an abutment to add a rest on the side next to the space. Tap again on a tooth between two spaces to add the second rest; once more removes it.',
  akers: 'Cast circumferential clasp with its own rest. The retentive tip goes to 0.25 mm of undercut, on whichever side has it.',
  rpi: 'Mesial rest, distal proximal plate and an I-bar in 0.25 mm of undercut. For distal-extension abutments.',
  ww: 'Cast lingual arm with a wrought-wire buccal arm in 0.50 mm of undercut. Flexes with the saddle.',
  erase: 'Tap a tooth to remove everything on it.',
};
document.querySelectorAll('#tools button').forEach((b) => (b.onclick = () => {
  state.tool = b.dataset.tool;
  document.querySelectorAll('#tools button').forEach((x) => x.classList.toggle('on', x === b));
  $('#toolHint').textContent = TOOL_HINTS[state.tool];
}));
$('#toolHint').textContent = TOOL_HINTS.rest;
document.querySelectorAll('#connectors button').forEach((b) => (b.onclick = () => {
  state.connector = b.dataset.conn || null;
  document.querySelectorAll('#connectors button').forEach((x) => x.classList.toggle('on', x === b));
  rebuildDesign();
}));
$('#sulcus').oninput = (e) => { state.sulcus = +e.target.value; $('#sulcusOut').textContent = `${state.sulcus} mm`; rebuildDesign(); };
$('#suggest').onclick = () => {
  state.components = suggestDesign(state, { cls, topo });
  state.connector = state.sulcus < 8 ? 'lingual-plate' : 'lingual-bar';
  document.querySelectorAll('#connectors button').forEach((x) => x.classList.toggle('on', x.dataset.conn === state.connector));
  rebuildDesign();
  toast('Textbook design placed. Open Check to see why each part is there.');
};
$('#clearDesign').onclick = () => { state.components = []; rebuildDesign(); };
$('#showBase').onchange = (e) => { state.showBase = e.target.checked; rebuildDesign(); };

let surveyQueued = false;
function queueSurvey() {
  if (surveyQueued) return;
  surveyQueued = true;
  requestAnimationFrame(() => { surveyQueued = false; resurvey(); });
}
function setTilt() {
  cast.rotation.set((state.ap * Math.PI) / 180 * 1, 0, (state.lat * Math.PI) / 180);
}
$('#ap').oninput = (e) => { state.ap = (+e.target.value * Math.PI) / 180; $('#apOut').textContent = `${e.target.value}°`; cast.rotation.set(state.ap, 0, state.lat); queueSurvey(); };
$('#lat').oninput = (e) => { state.lat = (+e.target.value * Math.PI) / 180; $('#latOut').textContent = `${e.target.value}°`; cast.rotation.set(state.ap, 0, state.lat); queueSurvey(); };
$('#zeroTilt').onclick = () => {
  state.ap = 0; state.lat = 0;
  $('#ap').value = 0; $('#lat').value = 0; $('#apOut').textContent = '0°'; $('#latOut').textContent = '0°';
  cast.rotation.set(0, 0, 0);
  resurvey();
};
document.querySelectorAll('#gauges button').forEach((b) => (b.onclick = () => {
  state.gauge = +b.dataset.g;
  document.querySelectorAll('#gauges button').forEach((x) => x.classList.toggle('on', x === b));
  resurvey();
}));
$('#showMap').onchange = (e) => { state.showMap = e.target.checked; resurvey(); };
$('#showLines').onchange = (e) => { state.showLines = e.target.checked; resurvey(); };

document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === tab));
  if (tab !== 'survey') { rod.visible = false; }
  else if (state.measure) rod.visible = true;
  if ((tab === 'design' || tab === 'check') && !state.components.length && cls.kennedy) {
    // start students from a blank framework but show the saddles
  }
  rebuildCast();
}
document.querySelectorAll('#views button').forEach((b) => (b.onclick = () => goView(b.dataset.view)));

// ---------------- frame loop ----------------
const tmpP = new Point();
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
app.ticker.add((ticker) => {
  if (camTween) {
    camTween.t = Math.min(1, camTween.t + ticker.deltaMS / 650);
    const k = ease(camTween.t);
    const f = camTween.from, t = camTween.to;
    cam.position.set(f.x + (t.x - f.x) * k, f.y + (t.y - f.y) * k, f.z + (t.z - f.z) * k);
    cam.lookAt(target);
    if (camTween.t >= 1) { camTween = null; makeOrbit(); }
  } else if (orbit) orbit.update(ticker);

  // FDI labels (case + design)
  const showLabels = state.tab === 'case';
  for (let i = 0; i < ARCH_LEN; i++) {
    const lab = fdiLabels[i];
    const fr = toothFrame(i);
    const p = tiltRotate(toCast(fr, v3(0, fr.spec.h + 3.2, 0)), state.ap, state.lat);
    const s = view.worldToScreen(p, tmpP);
    lab.visible = showLabels && !!s && (!state.missing[i] || state.tab === 'case');
    if (s) {
      lab.position.set(s.x + view.x, s.y + view.y);
      const missing = state.missing[i];
      const w = 28, h = 18;
      lab._bg.clear().roundRect(-w / 2 + 2, -h / 2 + 2, w, h, 7).fill(0x221d1f)
        .roundRect(-w / 2, -h / 2, w, h, 7).fill(missing ? 0xf07ab3 : 0xf8f2e9).stroke({ color: 0x221d1f, width: 1.6 });
      lab._t.style.fill = 0x221d1f;
    }
  }
  // fulcrum label
  const f = check && check.fulcrum;
  if (f && f.ok && (state.tab === 'design' || state.tab === 'check')) {
    const mid = tiltRotate(add(mul(add(f.A, f.B), 0.5), v3(0, 2, 0)), state.ap, state.lat);
    const s = view.worldToScreen(mid, tmpP);
    fulcrumLabel.visible = !!s;
    if (s) fulcrumLabel.position.set(s.x, s.y);
  } else fulcrumLabel.visible = false;
  // measurement callout
  if (state.tab === 'survey' && state.measure && state.measure.p) {
    const s = view.worldToScreen(tiltRotate(state.measure.p, state.ap, state.lat), tmpP);
    callout.visible = !!s;
    if (s) {
      const w = calloutT.width + 16;
      calloutG.clear()
        .moveTo(0, 0).lineTo(18, -22).stroke({ color: 0x221d1f, width: 2 })
        .circle(0, 0, 5).fill(0xf07ab3).stroke({ color: 0x221d1f, width: 2 })
        .roundRect(21, -31, w, 24, 8).fill(0x221d1f)
        .roundRect(18, -34, w, 24, 8).fill(0xf3c138).stroke({ color: 0x221d1f, width: 2 });
      calloutT.position.set(26, -29);
      callout.position.set(s.x, s.y);
    }
  } else callout.visible = false;
});

rebuildCast();
window.__rpd = { screenOf: (i) => { const fr = toothFrame(i); const p = view.worldToScreen(tiltRotate(toCast(fr, v3(0, fr.spec.h * 0.6, fr.spec.bl * 0.3)), state.ap, state.lat), new Point()); return p && { x: p.x, y: p.y }; }, state, get cls() { return cls; }, get check() { return check; }, setTab, goView, applyTool, rebuildDesign, suggest: () => $('#suggest').onclick() };
