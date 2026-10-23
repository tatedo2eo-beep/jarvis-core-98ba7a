// Jarvis · Neural Link v4 — outside view (neural dandelion), inside view, flow view.
// Every number on this page comes from data.json (derive4.py, read-only on the real sources)
// or from reporter.py heartbeats/events. Nothing is simulated; numbers only change when the real value changes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const MOBILE = matchMedia('(max-width:860px)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TZ = 'Africa/Cairo';
const $ = s => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => (n == null || isNaN(n)) ? '–' : Number(n).toLocaleString('en-US');
const hm = sec => new Date(sec * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const hms = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ });
const setText = (node, txt) => { if (node && node.textContent !== txt) node.textContent = txt; };
const setHTML = (node, h) => { if (node && node._h !== h) { node._h = h; node.innerHTML = h; } };

// ---------- clocks (capture mode runs on a virtual clock so recorded video plays at real speed) ----------
let simMs = 0;
const wall0 = Date.now();
let wallOff = 0;   // capture mode: frames render slower than real time, so the virtual clock jumps forward to each real message's timestamp
const REALCLOCK = Q.has('realclock');   // capture with real wall-clock text (time-lapse) instead of the virtual clock
const NOW = () => CAPTURE && !REALCLOCK ? wall0 + simMs + wallOff : Date.now();   // ms
const ANIM = () => CAPTURE ? wall0 + simMs : Date.now();   // animation timing only (subtitle typing, panel cycling)
const nowS = () => NOW() / 1000;
function ago(sec) {
  const d = Math.max(0, Math.floor(nowS() - sec));
  if (d < 60) return `${d} s ago`;
  if (d < 3600) return `${Math.floor(d / 60)} min ${String(d % 60).padStart(2, '0')} s ago`;
  const h = Math.floor(d / 3600); return `${h} h ${String(Math.floor(d % 3600 / 60)).padStart(2, '0')} min ago`;
}
const dur = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m}:${String(s % 60).padStart(2, '0')}`; };

// ---------- load ----------
const [CFG, AG] = await Promise.all([
  fetch('config.json', { cache: 'no-store' }).then(r => r.json()),
  fetch('agents.json', { cache: 'no-store' }).then(r => r.json()),
]);
let DATA = null;
async function loadData() { try { DATA = await fetch('data.json', { cache: 'no-store' }).then(r => r.json()); renderAll(); } catch (e) { } }
const AGENTS = AG.agents;
const IDX = Object.fromEntries(AGENTS.map((a, i) => [a.id, i]));
const S = Object.fromEntries(AGENTS.map(a => [a.id, { events: [], last: 0 }]));
const EVENTS = [];             // every real event received (12 h history + live), newest last
const SEEN = new Set();
let SNAP = null, snapAt = 0;   // reporter snapshot + local ms it arrived
let lastLiveMsg = 0, lastMsMsg = 0;
let lastReal = 0;              // epoch s of the newest real event

// ================= 3D SCENE =================
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
let DPR = MOBILE ? 1 : Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x01020e, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(MOBILE ? 50 : 40, innerWidth / innerHeight, 0.1, 400);
const HOME = { pos: new THREE.Vector3(0, 0.35, MOBILE ? 21 : 17.5), look: new THREE.Vector3(0, 0, 0) };
camera.position.copy(HOME.pos);
const camLook = HOME.look.clone();
camera.lookAt(camLook);
function viewOffset() {
  const w = innerWidth, h = innerHeight;
  if (MOBILE) camera.setViewOffset(w, h, 0, h * 0.2, w, h);              // brain in the upper part of a phone
  else camera.setViewOffset(w, h, w * 0.045, h * 0.015, w, h);           // a little left of centre, clear of the right panel
  camera.updateProjectionMatrix();
}
viewOffset();

const group = new THREE.Group(); scene.add(group);
let seed = 20261023;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const V3 = THREE.Vector3;
function randDir() { const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u); return new V3(r * Math.cos(th), u, r * Math.sin(th)); }
const SECT = AGENTS.map((a, i) => ({ i, id: a.id, col: new THREE.Color(a.color), dir: a.core ? null : new V3(...a.sector).normalize() }));
function nearest(d) { let bi = 0, bk = -2; for (const s of SECT) if (s.dir) { const k = d.dot(s.dir); if (k > bk) { bk = k; bi = s.i; } } return [bi, bk]; }

const NA = AGENTS.length;
const U = {
  uT: { value: 0 }, uMo: { value: REDUCED ? 0.25 : 1 }, uPR: { value: renderer.getPixelRatio() },
  uAct: { value: new Array(NA).fill(0.2) }, uPulse: { value: new Array(NA).fill(0) }, uAT: { value: new Array(NA).fill(0) },
  uFocus: { value: -1 }, uFocusAmt: { value: 0 }, uFib: { value: (Q.get('fib') ? +Q.get('fib') : 1) }, uM: { value: 0 }, uDeep: { value: 0 },
};
// colour waves: a smooth cyclic palette cyan → blue → violet → magenta → cyan → green (cyan weighted, like the reference)
const WPAL = /* glsl */`
vec3 wpal(float x){
  x = fract(x) * 6.;
  vec3 c0 = vec3(.0, .92, 1.), c1 = vec3(.15, .55, 1.), c2 = vec3(.58, .22, 1.), c3 = vec3(1., .16, .82), c4 = vec3(.0, .9, 1.), c5 = vec3(.2, 1., .5);
  float f = smoothstep(0., 1., fract(x));
  if (x < 1.) return mix(c0, c1, f); if (x < 2.) return mix(c1, c2, f); if (x < 3.) return mix(c2, c3, f);
  if (x < 4.) return mix(c3, c4, f); if (x < 5.) return mix(c4, c5, f); return mix(c5, c0, f);
}`;
const WSTOPS = [[0, .92, 1], [.15, .55, 1], [.58, .22, 1], [1, .16, .82], [0, .9, 1], [.2, 1, .5]].map(c => new THREE.Color(...c));
const WHITE = new THREE.Color(1, 1, 1);
function wpalJS(x, out) { x = (x % 1 + 1) % 1 * 6; const i = Math.floor(x), f = x - i, k = f * f * (3 - 2 * f); return out.copy(WSTOPS[i]).lerp(WSTOPS[(i + 1) % 6], k); }
const SHARED = WPAL + /* glsl */`
uniform float uT, uMo, uPR, uFocusAmt, uFib, uDeep; uniform float uAct[${NA}], uPulse[${NA}], uAT[${NA}]; uniform int uFocus;
vec3 fpos(vec3 d, vec3 b, float t, float len, float sd){
  vec3 s = normalize(cross(d, b));
  float r = 1.22 + t * len;
  float curl = (fract(sd * 7.31) - 0.5) * 1.7;
  float w = uMo * t * t * (0.55 + len * 0.16);
  float a1 = sin(uT * 0.47 + sd * 6.2831 + t * 2.3);
  float a2 = sin(uT * 0.29 + sd * 19.7 + t * 4.6);
  float a3 = cos(uT * 0.37 + sd * 11.3 + t * 3.1);
  return d * r + b * (t * t * len * 0.36 * curl) + (s * (a1 * 0.36 + a2 * 0.13) + b * a3 * 0.26) * w;
}
float inten(int ai){
  float I = 0.32 + uAct[ai] * 0.85 + uPulse[ai] * 1.5;
  if (uFocus >= 0 && ai != uFocus) I *= mix(1.0, 0.16, uFocusAmt);
  if (uFocus >= 0 && ai == uFocus) I *= mix(1.0, 1.35, uFocusAmt);
  return I * mix(1.0, 0.3, uDeep);
}
float backDim(vec3 p){
  vec4 mv = modelViewMatrix * vec4(p, 1.0); vec4 mc = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float d = length(mv.xy - mc.xy);
  float disc = mix(0.18, 1.0, smoothstep(1.0, 2.1, d));
  return mix(0.22, 1.0, smoothstep(-3.5, 2.5, mv.z - mc.z)) * disc;
}`;

// ---- BRAIN: the v3 particle brain (restored from commit fcd8240, "INSIDE: particle brain") seen from the side ----
// Same generator (hemispheres with folds, flat medial face, cerebellum, stem), same per-dot sizes and the same additive dot shader.
// v3 axes: x = left/right, y = up, z = front/back. Here the brain is turned so the camera sees it side-on (front to the left).
const BN = MOBILE ? 9000 : (Q.get('n') ? +Q.get('n') : 26000);
const BR = 2.75, BY = 0.15;
const bPos = new Float32Array(BN * 3), bSeed = new Float32Array(BN), bSize = new Float32Array(BN), bSh = new Float32Array(BN), bReg = new Float32Array(BN);
const bSurf = [];                          // indices of outer-surface dots (fibre roots)
const bKind = new Uint8Array(BN);          // 0 cortex, 1 cerebellum, 2 stem
{
  const v = new V3();
  for (let i = 0; i < BN; i++) {
    const r0 = rnd(); let x, y, z, fold = 0, surface = false;
    if (r0 < .085) {           // cerebellum
      v.copy(randDir()); const rr = Math.pow(rnd(), .35);
      x = v.x * .62 * rr; y = -.62 + v.y * .3 * rr; z = -.78 + v.z * .38 * rr;
      const f = 1 + .05 * Math.sin(y * 60.); x *= f; z *= f; bKind[i] = 1; surface = rr > .85;
    } else if (r0 < .1) {      // stem
      const t = rnd(); x = (rnd() - .5) * .18; y = -.55 - t * .55; z = -.35 + t * .05 + (rnd() - .5) * .16; bKind[i] = 2;
    } else {
      const s = rnd() < .5 ? -1 : 1; v.copy(randDir());
      fold = Math.sin(v.x * 9 + Math.sin(v.z * 7) * 1.5) * Math.sin(v.y * 11 + v.z * 6);
      const sr = rnd(); const surf = sr < .78 ? (0.9 + rnd() * .1) : Math.pow(rnd(), .5) * .88;
      const rr = surf * (1 + .11 * fold);
      let vx = v.x; if (vx * s < 0) vx *= .22;             // flat medial face
      x = s * .25 + vx * .5 * rr; y = v.y * .66 * rr; z = v.z * .98 * rr;
      if (y < -.3) y = -.3 + (y + .3) * .55;               // flatter base
      if (z > .2) y += .06 * (z - .2);                       // taller frontal lobe
      surface = sr < .78;
    }
    // v3 shading term: inner dots faint, outer shell bright (was computed in the v3 vertex shader from the same expression)
    bSh[i] = THREE.MathUtils.lerp(.08, 1.15, THREE.MathUtils.smoothstep(Math.hypot(x * 1.6, y * 1.45, z), .5, .9));
    // side view: v3 (x, y, z) -> scene (-z, y, x)
    bPos.set([-z * BR, y * BR + BY, x * BR], i * 3);
    bSeed[i] = rnd(); bSize[i] = (.55 + Math.pow(rnd(), 3) * 2.0) * (fold > .25 ? 1.35 : 1);
    if (surface && bKind[i] !== 2) bSurf.push(i);
  }
}
// regions: each dot belongs to the agent whose sector direction (screen-like x/y) is closest; the stem is Jarvis
const JI = AGENTS.findIndex(a => a.core);
{
  const d = new V3();
  for (let i = 0; i < BN; i++) {
    if (bKind[i] === 2) { bReg[i] = JI; continue; }
    d.set(bPos[i * 3] / (BR * .98), (bPos[i * 3 + 1] - BY) / (BR * .66), bPos[i * 3 + 2] / BR * .35).normalize();
    bReg[i] = nearest(d)[0];
  }
}
// label anchors: mean of each region's camera-facing surface dots, pushed a little outward
const ANCH = AGENTS.map(() => new V3()), ANCHN = new Array(NA).fill(0);
for (const i of bSurf) { const r = bReg[i]; if (bPos[i * 3 + 2] > 0.2) { ANCH[r].x += bPos[i * 3]; ANCH[r].y += bPos[i * 3 + 1]; ANCH[r].z += bPos[i * 3 + 2]; ANCHN[r]++; } }
ANCH.forEach((p, r) => { if (ANCHN[r]) p.divideScalar(ANCHN[r]); });
ANCH[JI].set(0.95, BY - 0.95 * BR, 0.1);            // brainstem
const brainU = {
  uT: U.uT, uMo: U.uMo, uPR: U.uPR, uAct: U.uAct, uPulse: U.uPulse, uFocus: U.uFocus, uFocusAmt: U.uFocusAmt,
  uPS: { value: MOBILE ? 21 : 21 }, uBeam: { value: 0 },
  uCol: { value: AGENTS.map(a => new THREE.Color('#38e8ff').lerp(new THREE.Color(a.color), a.core ? 0 : 0.12)) },
  uColIn: { value: AGENTS.map(a => new THREE.Color('#3fdcff').lerp(new THREE.Color(a.color), a.core ? 0 : 0.28)) },   // v6 inside colours
  uM: U.uM, uDeep: U.uDeep,
};
const brainMat = new THREE.ShaderMaterial({
  uniforms: brainU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    attribute float aSeed, aSize, aReg, aSh; uniform float uT, uMo, uPR, uPS, uBeam, uFocusAmt, uDeep; uniform int uFocus;
    uniform float uAct[${NA}], uPulse[${NA}], uM;${WPAL} uniform vec3 uCol[${NA}], uColIn[${NA}];
    varying vec3 vC; varying float vA;
    void main(){
      int r = int(aReg + .5); float fire = clamp(.1 + uAct[r] * .55 + uPulse[r] * .9, 0., 1.4);
      vec3 p = position + uMo * vec3(sin(uT * 1.3 + aSeed * 40.), cos(uT * 1.1 + aSeed * 31.), sin(uT * .9 + aSeed * 23.)) * (.018 + .05 * fire);
      float spark = pow(max(0., sin(uT * (1.5 + aSeed * 5.) * (1. + fire * 2.) + aSeed * 120.)), 14.) * (.25 + fire * 2.4);
      float dim = (uFocus >= 0 && r != uFocus) ? mix(1., .45, uFocusAmt) : 1.;
      float rr = length(position - vec3(0., .15, 0.)) / 2.75;
      float hot = (1. - smoothstep(.02, .36, rr)) * (1. - uM);   // outside only: white-cyan burst
      // outside only: slow colour waves travelling outward through the core
      vec3 wv = wpal(uT * .035 + aSeed * .08 - rr * .55 + position.x * .05);
      vec3 col = mix(mix(uCol[r], wv, .55 * (.6 + .4 * sin(uT * .7 - rr * 5. + aSeed * 3.))), uColIn[r], uM);
      vC = mix(col * (1.15 + .3 * fire + .05 * (1. - uM)), vec3(1.), clamp(spark * .35 + hot * .5, 0., 1.));
      vA = (.35 + .8 * fire + spark * .8 + uBeam * .25 + hot * .5) * dim * max(aSh, hot * .6) * mix(.78, 1., uM) * mix(1., .22, uDeep);
      vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * (1. + spark * 1.4) * uPR * (uPS / -mv.z);
    }`,
  fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; float a = smoothstep(.5, .0, d); gl_FragColor = vec4(vC * vA * a * a * 1.05, 1.); }`,
});
const brainGeo = new THREE.BufferGeometry();
brainGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
brainGeo.setAttribute('aSeed', new THREE.BufferAttribute(bSeed, 1)); brainGeo.setAttribute('aSize', new THREE.BufferAttribute(bSize, 1));
brainGeo.setAttribute('aReg', new THREE.BufferAttribute(bReg, 1)); brainGeo.setAttribute('aSh', new THREE.BufferAttribute(bSh, 1));
const PTS = new THREE.Points(brainGeo, brainMat); PTS.frustumCulled = false; PTS.renderOrder = 3; group.add(PTS);
PTS.userData.count = BN;
const core = PTS;   // the frame loop drives core.material.uniforms.uBeam

// ---- FIBRES: two precomputed sets of curved strands, each one indexed LineSegments draw.
// OUT = the outside neon burst (fewer, longer, saturated); IN = the v6 inside look (commit 5613e14), unchanged. uM cross-fades them.
const FCOL_OUT = {   // saturated neon: cyan, magenta, violet, lime, gold, blue
  'jarvis': ['#00f0ff', '#40c8ff'], 'recipe-writer': ['#00e5ff', '#00b4ff', '#ff1fd2'], 'recipe-checker': ['#8dff1f', '#2bff7a', '#00e5ff'],
  'claude-code': ['#ffd21f', '#ff9a1f', '#8dff1f'], 'research': ['#1f6bff', '#00b4ff', '#00f0ff'], 'planner': ['#8a2bff', '#c41fff', '#ff1fd2'],
  'social-media': ['#ff1fd2', '#ff1f8f', '#a21fff'], 'video-maker': ['#ff1fd2', '#ff2b6b', '#ffd21f'], 'video-editor': ['#8a2bff', '#5a2bff', '#00b4ff'],
};
const FCOL_IN = {
  'jarvis': ['#7fe9ff', '#3fdcff'], 'recipe-writer': ['#3fdcff', '#7fe9ff', '#3d8bff'], 'recipe-checker': ['#36f59b', '#7dff6a', '#3fdcff'],
  'claude-code': ['#ffc53d', '#ff9a3d', '#ffe27a'], 'research': ['#3d7bff', '#5b8cff', '#3fdcff'], 'planner': ['#9b6bff', '#c06bff', '#ff3df0'],
  'social-media': ['#ff3df0', '#ff5fb0', '#c06bff'], 'video-maker': ['#ff3db0', '#ff3df0', '#ffc53d'], 'video-editor': ['#b38bff', '#7a5bff', '#3d7bff'],
};
const FCFG = {
  out: { nf: MOBILE ? 70 : 130, seg: MOBILE ? 16 : 26, pal: FCOL_OUT, wOut: .78, wSec: .2, wRnd: .2, hero: .34, len: [6.5, 2.8, 7.5, 4.2, 1.2], br: [1.0, .55, .35],
         curl: (l) => (rnd() - .5) * 2.6 / l, bend: .04, roll: .015, gain: MOBILE ? 0.5 : 0.42, ws: 'uWo',
         vc: 'vC = mix(aCol, wpal(uT * .035 + sd * .3 - t * .5) * 1.1, .55);', va: 'vA = smoothstep(.03, .16, t) * pow(1. - t, .85) * I * uG * uFib * uWo;', head: 'head * (.4 + vI) * .75 * uWo' },
  in:  { nf: MOBILE ? 1500 : 3600, seg: MOBILE ? 14 : 22, pal: FCOL_IN, wOut: .55, wSec: .45, wRnd: .35, hero: .14, len: [4.2, 1.6, 4.5, 3.6, 1.4], br: [1.25, .6, .5],
         curl: () => (rnd() - .5) * 1.3, bend: .1, roll: .05, gain: 0.15, ws: 'uWi',
         vc: 'vC = mix(aCol * .8 + vec3(.1, .2, .3), aCol, smoothstep(.0, .25, t));', va: 'vA = smoothstep(.05, .3, t) * pow(1. - t, 1.2) * I * uG * uFib * uWi;',
         head: 'head * (.5 + vI) * uG * 3.2 * uWi' },
};
U.uWo = { value: 1 }; U.uWi = { value: 0 };
function buildFib(C) {
  const NF = C.nf, SEG = C.seg, nv = NF * (SEG + 1);
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), Cc = new Float32Array(nv * 3), A = new Float32Array(nv * 4);
  const idx = new Uint32Array(NF * SEG * 2);
  const ctr = new V3(0, BY, 0), p = new V3(), dir = new V3(), side = new V3(), tmp = new V3(), up = new V3(0, 1, 0), col = new THREE.Color();
  let v = 0, k = 0;
  for (let f = 0; f < NF; f++) {
    const i = bSurf[(rnd() * bSurf.length) | 0], ai = bReg[i];
    p.set(bPos[i * 3], bPos[i * 3 + 1], bPos[i * 3 + 2]);
    const out = tmp.copy(p).sub(ctr).normalize();
    const sd = SECT[ai].dir ? new V3(SECT[ai].dir.x, SECT[ai].dir.y, SECT[ai].dir.z * .6).normalize() : new V3(0, -1, 0);
    dir.copy(out).multiplyScalar(C.wOut).add(sd.multiplyScalar(C.wSec)).add(randDir().multiplyScalar(C.wRnd)).normalize();
    side.crossVectors(dir, Math.abs(dir.y) > .9 ? new V3(1, 0, 0) : up).normalize();
    const hero = rnd() < C.hero;
    const len = (hero ? C.len[0] : C.len[1]) + Math.pow(rnd(), C.len[4]) * (hero ? C.len[2] : C.len[3]);
    const step = len / SEG, curl = C.curl(len), wob = rnd() * 6.28, fq = 1.5 + rnd() * 2.5;
    const pal = C.pal[AGENTS[ai].id] || ['#3fdcff']; col.set(pal[(rnd() * pal.length) | 0]);
    const br = hero ? C.br[0] : C.br[1] + rnd() * C.br[2], seedF = rnd();
    const v0 = v;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      P.set([p.x, p.y, p.z], v * 3); N.set([side.x, side.y, side.z], v * 3); Cc.set([col.r * br, col.g * br, col.b * br], v * 3);
      A.set([t, seedF, ai, len], v * 4); v++;
      dir.applyAxisAngle(side, curl * step * 0.9 + Math.sin(wob + t * fq) * C.bend);
      tmp.crossVectors(dir, side).normalize(); dir.addScaledVector(tmp, Math.cos(wob * 1.7 + t * fq * 1.3) * C.roll).normalize();
      side.crossVectors(tmp, dir).normalize();
      p.addScaledVector(dir, step);
    }
    for (let s = 0; s < SEG; s++) { idx[k++] = v0 + s; idx[k++] = v0 + s + 1; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aSide', new THREE.BufferAttribute(N, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(Cc, 3)); g.setAttribute('aP', new THREE.BufferAttribute(A, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, uG: { value: C.gain } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: SHARED + `
      uniform float uG, uWo, uWi;
      attribute vec3 aSide, aCol; attribute vec4 aP; varying vec3 vC; varying float vA, vT, vPh, vOn, vI;
      void main(){
        float t = aP.x, sd = aP.y; int ai = int(aP.z + .5);
        float w = uMo * t * t * (.12 + aP.w * .035);
        vec3 p = position + aSide * sin(uT * .45 + sd * 6.2831 + t * 2.4) * w + cross(aSide, normalize(position)) * cos(uT * .33 + sd * 17. + t * 3.) * w * .6;
        float I = inten(ai);
        vI = I; vT = t;
        vPh = fract(sd * 7.31 + uAT[ai] * (.16 + fract(sd * 3.7) * .14));        // inward pulse position (1 = tip, 0 = brain)
        vOn = step(.86 - uPulse[ai] * .6 - uAct[ai] * .08, fract(sd * 13.7));
        ${C.vc}
        ${C.va}
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: `uniform float uG, uWo, uWi; varying vec3 vC; varying float vA, vT, vPh, vOn, vI;
      void main(){
        float x = (vT - (1. - vPh)) * 22.; float head = exp(-x * x) * vOn;
        gl_FragColor = vec4(mix(vC, vec3(1.), head * .5) * (vA + ${C.head} * smoothstep(.0, .08, vT)), 1.);
      }`,
  });
  const L = new THREE.LineSegments(g, m); L.frustumCulled = false; L.renderOrder = 2; group.add(L);
  L.userData = { count: idx.length, seg: SEG, nf: NF };
  return L;
}
const FIB = buildFib(FCFG.out), FIBI = buildFib(FCFG.in);
const SEG = FCFG.out.seg;

// ---- inside only: soft glowing nodes part-way along the longer v6 strands ----
const TIPS = (() => {
  const S = FIBI.userData.seg, NFI = FIBI.userData.nf, tips = [];
  const P = FIBI.geometry.attributes.position.array, C = FIBI.geometry.attributes.aCol.array, A = FIBI.geometry.attributes.aP.array;
  for (let f = 0; f < NFI; f++) { const e = f * (S + 1) + Math.round(S * (.55 + (f % 7) * .05)); if (A[f * (S + 1) * 4 + 3] > 3.2 || f % 9 === 0) tips.push(e); }
  const n = tips.length, TP = new Float32Array(n * 3), TC = new Float32Array(n * 3), TA = new Float32Array(n * 2);
  tips.forEach((e, j) => { TP.set(P.subarray(e * 3, e * 3 + 3), j * 3); TC.set(C.subarray(e * 3, e * 3 + 3), j * 3); TA.set([A[e * 4 + 2], A[e * 4 + 1]], j * 2); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(TP, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(TC, 3)); g.setAttribute('aQ', new THREE.BufferAttribute(TA, 2));
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: SHARED + `uniform float uWi; attribute vec3 aCol; attribute vec2 aQ; varying vec3 vC; varying float vA;
      void main(){ int ai = int(aQ.x + .5); vC = aCol; vA = inten(ai) * .3 * uWi; vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_PointSize = (1.6 + aQ.y * 2.2) * uPR * (1. + uPulse[ai] * .8) * 14. / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); gl_FragColor = vec4(mix(vC, vec3(1.), a * .6) * vA * a * a, 1.); }`,
  });
  const T = new THREE.Points(g, m); T.frustumCulled = false; T.renderOrder = 2; group.add(T); return T;
})();

// ---- OUTSIDE tendrils (v8): fewer, thick, curvy, tapering camera-facing ribbons. Each ribbon carries its own hot core line and
// soft halo in the fragment shader, so the glow never depends on bloom. Bright nodes ride the tips; colour waves travel outward.
const TEND = (() => {
  const NT = MOBILE ? 64 : 118, SG = MOBILE ? 22 : 30, ctr = new V3(0, BY, 0), up = new V3(0, 1, 0);
  const paths = [];
  const pickCol = d => {   // reference: cyan dominant, magenta/violet to one side, green low
    const r = rnd();
    if (d.x > .2 && r < .78) return rnd() < .5 ? '#ff2bd6' : '#a63dff';
    if (d.y < -.3 && r < .7) return '#2dff7a';
    return r < .8 ? (rnd() < .6 ? '#00f0ff' : '#5fd8ff') : '#b45cff';
  };
  function grow(p0, dir0, len, w, col, ai, parent) {
    const p = p0.clone(), dir = dir0.clone().normalize(), pts = [];
    const side = new V3().crossVectors(dir, Math.abs(dir.y) > .9 ? new V3(1, 0, 0) : up).normalize(), tmp = new V3();
    const curl = (rnd() - .5) * 2.4 / Math.sqrt(len), wob = rnd() * 6.28, fq = 1.2 + rnd() * 1.8, step = len / SG;
    for (let s = 0; s <= SG; s++) {
      pts.push(p.clone()); const t = s / SG;
      dir.applyAxisAngle(side, curl * step * .55 + Math.sin(wob + t * fq * 3.2) * .07);
      tmp.crossVectors(dir, side).normalize(); dir.addScaledVector(tmp, Math.cos(wob * 1.3 + t * fq * 2.4) * .06).normalize(); side.crossVectors(tmp, dir).normalize();
      p.addScaledVector(dir, step);
    }
    paths.push({ pts, w, col: new THREE.Color(col), sd: rnd(), ai, tip: !parent || rnd() < .7 });
    return pts;
  }
  for (let f = 0; f < NT; f++) {
    const i = bSurf[(rnd() * bSurf.length) | 0], ai = bReg[i];
    const out = new V3(bPos[i * 3], bPos[i * 3 + 1], bPos[i * 3 + 2]).sub(ctr).normalize();
    const d = out.clone().add(randDir().multiplyScalar(.4)); d.z *= .5; d.y *= .85; d.normalize();
    const hero = rnd() < .45, len = hero ? 4.4 + rnd() * 3.8 : 1.8 + rnd() * 2.4, w = hero ? .075 + rnd() * .045 : .035 + rnd() * .03;
    const col = pickCol(d);
    const pts = grow(ctr.clone().addScaledVector(out, BR * (.25 + rnd() * .25)), d, len, w, col, ai, null);
    const nb = hero ? 1 + (rnd() < .7) + (rnd() < .4) : (rnd() < .4 ? 1 : 0);
    for (let b = 0; b < nb; b++) {
      const k = Math.floor(SG * (.3 + rnd() * .45)), dd = pts[k + 1].clone().sub(pts[k]).normalize().add(randDir().multiplyScalar(.75)).normalize();
      grow(pts[k], dd, len * (.25 + rnd() * .35), w * (.45 + rnd() * .2), rnd() < .7 ? col : pickCol(dd), ai, true);
    }
  }
  const NP = paths.length, nv = NP * (SG + 1) * 2;
  const P = new Float32Array(nv * 3), Nx = new Float32Array(nv * 4), Qa = new Float32Array(nv * 4), Cc = new Float32Array(nv * 3), Ai = new Float32Array(nv);
  const idx = new Uint32Array(NP * SG * 6);
  let v = 0, k = 0;
  paths.forEach(pa => {
    const v0 = v;
    for (let s = 0; s <= SG; s++) {
      const a = pa.pts[s], b = s < SG ? pa.pts[s + 1] : a.clone().multiplyScalar(2).sub(pa.pts[s - 1]), tn = Math.min(1, (s + 1) / SG);
      for (const sd of [-1, 1]) {
        P.set([a.x, a.y, a.z], v * 3); Nx.set([b.x, b.y, b.z, tn], v * 4); Qa.set([s / SG, sd, pa.sd, pa.w], v * 4);
        Cc.set([pa.col.r, pa.col.g, pa.col.b], v * 3); Ai[v] = pa.ai; v++;
      }
    }
    for (let s = 0; s < SG; s++) { const a = v0 + s * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k); k += 6; }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aNext', new THREE.BufferAttribute(Nx, 4));
  g.setAttribute('aQ', new THREE.BufferAttribute(Qa, 4)); g.setAttribute('aCol', new THREE.BufferAttribute(Cc, 3)); g.setAttribute('aAi', new THREE.BufferAttribute(Ai, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const WOB = `vec3 wob(vec3 p, float t, float sd){ float w = uMo * t * t * .42;
    return p + vec3(sin(uT * .5 + sd * 6.28 + t * 2.6), cos(uT * .41 + sd * 9.1 + t * 3.1), sin(uT * .37 + sd * 4.7 + t * 2.2)) * w; }`;
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, uG: { value: (Q.get('tg') ? +Q.get('tg') : 0.5) } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: SHARED + WOB + `
      uniform float uG, uWo; attribute vec4 aNext, aQ; attribute vec3 aCol; attribute float aAi;
      varying vec3 vC; varying float vU, vA, vT;
      void main(){
        float t = aQ.x, sd = aQ.z; int ai = int(aAi + .5);
        vec4 a = modelViewMatrix * vec4(wob(position, t, sd), 1.), b = modelViewMatrix * vec4(wob(aNext.xyz, aNext.w, sd), 1.);
        vec2 tg = b.xy - a.xy; tg = length(tg) < 1e-5 ? vec2(1., 0.) : normalize(tg);
        float w = aQ.w * mix(1., .14, pow(t, .75));
        w = max(w, 1.1 * -a.z / (projectionMatrix[1][1] * 400. * uPR));   // never thinner than ~1 px
        a.xy += vec2(-tg.y, tg.x) * aQ.y * w * 3.2;
        gl_Position = projectionMatrix * a;
        float I = .72 + .38 * inten(ai);                                       // outside never goes dark
        float wave = .5 + .5 * sin(uT * .9 - t * 6.5 + sd * 6.2831);            // brightness wave running outward
        float x = (t - fract(uT * .16 + sd * 3.7)) * 16.; float pulse = exp(-x * x) * .9;   // a signal riding out along the strand
        vC = mix(aCol, wpal(uT * .035 + sd * .22 - t * .5), .3 * smoothstep(.05, .4, t));
        vC = max(vC - .8 * min(vC.r, min(vC.g, vC.b)), 0.) * 1.6;                 // keep the hue saturated
        vC = mix(vC, vec3(1.), (1. - smoothstep(.0, .1, t)) * .5 + pulse * .2);
        vU = aQ.y * 3.2; vT = t;
        vA = uG * uWo * uFib * I * (.62 + .55 * wave + pulse) * smoothstep(.0, .05, t) * pow(1. - t, .3);
      }`,
    fragmentShader: `varying vec3 vC; varying float vU, vA, vT;
      void main(){ float u = vU; float core = exp(-u * u * 3.2), glow = exp(-u * u * .5) * .2;
        gl_FragColor = vec4((vC * (core * .9 + glow * 1.3) + vec3(.55) * pow(core, 6.) * .5) * vA, 1.); }`,
  });
  const R = new THREE.Mesh(g, m); R.frustumCulled = false; R.renderOrder = 2; group.add(R);
  R.userData = { count: idx.length, per: SG * 6, np: NP };
  // tip nodes
  const tips = paths.filter(p => p.tip), TPp = new Float32Array(tips.length * 3), TPc = new Float32Array(tips.length * 3), TPq = new Float32Array(tips.length * 2);
  tips.forEach((p, j) => { const e = p.pts[SG]; TPp.set([e.x, e.y, e.z], j * 3); TPc.set([p.col.r, p.col.g, p.col.b], j * 3); TPq.set([p.sd, p.w * 10], j * 2); });
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(TPp, 3)); tg.setAttribute('aCol', new THREE.BufferAttribute(TPc, 3)); tg.setAttribute('aQ', new THREE.BufferAttribute(TPq, 2));
  const tm = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: SHARED + WOB + `uniform float uWo; attribute vec3 aCol; attribute vec2 aQ; varying vec3 vC; varying float vA;
      void main(){ float sd = aQ.x; vec4 mv = modelViewMatrix * vec4(wob(position, 1., sd), 1.);
        float tw = .75 + .25 * sin(uT * 1.7 + sd * 40.);
        vC = mix(aCol, wpal(uT * .035 + sd * .22 - .5), .55); vA = uWo * tw * mix(1., .45, uDeep);
        gl_PointSize = (9. + aQ.y * 9.) * uPR * (17. / -mv.z) * tw; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard;
      float core = exp(-d * d * 22.), glow = exp(-d * d * 4.) * .45; gl_FragColor = vec4(mix(vC, vec3(1.), core) * (core * 1.3 + glow) * vA, 1.); }`,
  });
  const T = new THREE.Points(tg, tm); T.frustumCulled = false; T.renderOrder = 4; group.add(T);
  R.userData.tips = T;
  return R;
})();

// ---- glow behind the brain: hot white-cyan burst outside, the v6 soft cyan glow inside ----
const mkGlow = stops => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); stops.forEach(([o, col]) => g.addColorStop(o, col)); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); };
const mkHalo = (tex, sx, sy) => { const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 }));
  h.scale.set(sx, sy, 1); h.position.y = BY; h.renderOrder = 1; scene.add(h); return h; };
const halo = mkHalo(mkGlow([[0, 'rgba(235,255,255,1)'], [0.18, 'rgba(90,225,255,.6)'], [0.45, 'rgba(0,120,255,.16)'], [1, 'rgba(0,0,0,0)']]), BR * 1.9, BR * 2.6);
// v8: a baked starburst (hot white core + fine rays) and a wide royal-blue halo. Sprites, so the glow is there at every quality level.
const burstTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); x.globalCompositeOperation = 'lighter';
  let g = x.createRadialGradient(256, 256, 0, 256, 256, 256);
  [[0, 'rgba(255,255,255,1)'], [.06, 'rgba(240,253,255,.9)'], [.16, 'rgba(150,235,255,.38)'], [.4, 'rgba(40,150,255,.1)'], [1, 'rgba(0,0,0,0)']].forEach(([o, k]) => g.addColorStop(o, k));
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 220; i++) { const a = rnd() * 6.2832, L = 60 + Math.pow(rnd(), 1.6) * 190, w = .6 + rnd() * 1.6;
    const lg = x.createLinearGradient(256, 256, 256 + Math.cos(a) * L, 256 + Math.sin(a) * L); lg.addColorStop(0, 'rgba(230,250,255,.5)'); lg.addColorStop(1, 'rgba(80,200,255,0)');
    x.strokeStyle = lg; x.lineWidth = w; x.beginPath(); x.moveTo(256, 256); x.lineTo(256 + Math.cos(a) * L, 256 + Math.sin(a) * L); x.stroke(); }
  return new THREE.CanvasTexture(c); })();
const burst = mkHalo(burstTex, BR * 3.1, BR * 3.5); burst.renderOrder = 5;
const haloWide = mkHalo(mkGlow([[0, 'rgba(40,90,255,.6)'], [0.3, 'rgba(25,40,255,.2)'], [0.65, 'rgba(15,10,190,.05)'], [1, 'rgba(0,0,0,0)']]), BR * 4.6, BR * 5);
const haloIn = mkHalo(mkGlow([[0, 'rgba(160,235,255,.9)'], [0.3, 'rgba(70,190,255,.3)'], [0.65, 'rgba(40,90,255,.07)'], [1, 'rgba(0,0,0,0)']]), BR * 3.2, BR * 2.4);

// ---- vertical beam (ignites on a "say" event) ----
const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 26), new THREE.ShaderMaterial({
  uniforms: { uT: U.uT, uBeam: { value: 0 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform float uT, uBeam; varying vec2 vU;
    void main(){
      float x = vU.x - 0.5;
      float core = exp(-x * x * 2600.0) * 1.4 + exp(-x * x * 180.0) * 0.32 + exp(-x * x * 26.0) * 0.08;
      float y = vU.y; float ends = smoothstep(0.0, 0.32, y) * smoothstep(1.0, 0.68, y);
      float flick = 0.88 + 0.12 * sin(uT * 23.0 + y * 60.0) * sin(uT * 7.0);
      gl_FragColor = vec4(mix(vec3(0.3, 0.8, 1.0), vec3(1.0), exp(-x * x * 4000.0)), core * ends * flick * uBeam);
    }`,
}));
beam.renderOrder = 10; scene.add(beam);

// ---- background lift ----
const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  depthWrite: false, depthTest: false,
  vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
  uniforms: { uM: U.uM },
  fragmentShader: `uniform float uM; varying vec2 vU; void main(){
    vec2 p = vU - vec2(0.46, ${MOBILE ? '0.7' : '0.5'}); p.x *= ${MOBILE ? '1.0' : '1.6'}; float r = length(p);
    vec3 o = mix(vec3(0.004, 0.006, 0.10), vec3(0.0010, 0.0015, 0.042), smoothstep(0.0, 0.5, r));      // deep royal blue, brighter round the core
    vec2 q = abs(vU - 0.5) * 2.0; o *= mix(1.0, 0.55, smoothstep(0.6, 1.0, max(q.x, q.y)));
    o += vec3(0.004, 0.16, 0.75) * exp(-vU.y * 70.0) + vec3(0.002, 0.03, 0.2) * exp(-vU.y * 9.0);    // bright blue bottom edge
    vec2 pi = vU - vec2(0.48, ${MOBILE ? '0.7' : '0.5'}); pi.x *= 1.5; float ri = length(pi);
    vec3 n = mix(vec3(0.010, 0.022, 0.065), vec3(0.002, 0.004, 0.016), smoothstep(0.0, 0.75, ri));
    vec2 qi = vU - 0.5; n += vec3(0.004, 0.014, 0.07) * smoothstep(0.35, 0.75, length(qi * vec2(1.0, 1.25)));
    gl_FragColor = vec4(mix(o, n, uM), 1.0); }`,
}));
bg.frustumCulled = false; bg.renderOrder = -10; scene.add(bg);

// ---- post: half-resolution bloom ----
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const BLOOM_OUT = [MOBILE ? 0.56 : 0.6, 0.28, 0.72], BLOOM_IN = [MOBILE ? 0.85 : 0.9, 0.5, 0.16];   // [strength, radius, threshold]; IN = v6
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), ...BLOOM_OUT);
let BDIV = 2;   // bloom buffer divisor: half resolution, quarter on slow devices (bloom is NEVER switched off)
const _bs = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => _bs(Math.max(2, w / BDIV), Math.max(2, h / BDIV));
composer.addPass(bloom); composer.addPass(new OutputPass());
composer.setPixelRatio(DPR); composer.setSize(innerWidth, innerHeight);
let useBloom = true;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; viewOffset(); labelSizes();
  if (view === 'flow') layoutFlow();
}
addEventListener('resize', resize);

// ================= REAL STATE → STATUS / TEXT =================
const liveFeed = () => lastLiveMsg && NOW() - lastLiveMsg < 20000;
const snapFresh = () => SNAP && NOW() - snapAt < 30000;
const workers = () => (snapFresh() && SNAP.workers) || [];
const recent = (id, sec) => S[id].last && nowS() - S[id].last < sec;
function status(a) {
  const id = a.id, w = workers();
  const run = w.some(x => x.state === 'running'), wait = w.some(x => x.state === 'limit' || x.state === 'waiting');
  switch (id) {
    case 'jarvis': return liveFeed() ? 'live' : 'idle';
    case 'recipe-writer': return run || recent(id, 600) ? 'live' : wait ? 'wait' : 'idle';
    case 'claude-code': return run ? 'live' : (snapFresh() && SNAP.limitResets) || wait ? 'wait' : recent(id, 600) ? 'live' : 'idle';
    case 'research': return (snapFresh() && SNAP.research) || recent(id, 600) ? 'live' : 'idle';
    default: return recent(id, 900) ? 'live' : a.status === 'planned' ? 'planned' : 'idle';
  }
}
const BADGE = { live: 'Live', wait: 'Waiting', idle: 'Idle', planned: 'Planned' };
const book = () => (snapFresh() && SNAP.book) || (DATA && DATA.real && DATA.real.book) || null;
const pages = () => (snapFresh() && SNAP.pages) || (DATA && DATA.real && DATA.real.pages) || null;      // recipe files in the site build (incl. not yet published)
const livePages = () => (snapFresh() && SNAP.livePages) || (DATA && DATA.real && DATA.real.livePages) || null;  // recipe pages in the PUBLIC site's sitemap
const tonightD = () => (snapFresh() && SNAP.tonight) || (DATA && DATA.real && DATA.real.tonight) || null;   // rw/manual_progress.log
const commitsL = () => (snapFresh() && SNAP.commits && SNAP.commits.length && SNAP.commits) || (DATA && DATA.real && DATA.real.commits) || [];
// one short, real line per agent (no number here is invented; each comes from the reporter or data.json)
function meta(a) {
  const s = snapFresh() ? SNAP : null, R = DATA && DATA.real;
  switch (a.id) {
    case 'jarvis': return liveFeed() ? 'link live · heartbeat every 6 s' : 'link reconnecting';
    case 'recipe-writer': { const t = tonightD(); return t && t.n ? `${fmt(t.n)} recipes written tonight · ${fmt(t.batches)} batches` : s ? `${fmt(s.draftsDone)} draft batches done · ${fmt(s.batches.left)} queued` : 'waiting for reporter'; }
    case 'recipe-checker': return livePages() != null ? `${fmt(livePages())} recipes live on the site` : '–';
    case 'claude-code': return s ? `${fmt(s.claude)} process${s.claude === 1 ? '' : 'es'}` + (s.limitResets ? ` · limit resets ${s.limitResets}` : '') : 'waiting for reporter';
    case 'research': return R ? `${fmt(R.knowledge.techniques)} techniques · ${fmt(R.knowledge.sources)} sources` : '–';
    case 'planner': { const b = book(); return b ? `${b.chapters[0]}/${b.chapters[1]} chapters complete` : '–'; }
    default: return a.status === 'planned' ? 'planned · not built yet' : '–';
  }
}

// the second line of a brain label: the same real values, shorter
function short(a) {
  const s = snapFresh() ? SNAP : null, R = DATA && DATA.real;
  switch (a.id) {
    case 'jarvis': return liveFeed() ? 'connected · live link' : 'reconnecting';
    case 'recipe-writer': { const t = tonightD(); return t && t.n ? `${fmt(t.n)} written tonight` : s ? `${fmt(s.draftsDone)} batches done` : 'waiting for reporter'; }
    case 'recipe-checker': return livePages() != null ? `${fmt(livePages())} live on the site` : '–';
    case 'claude-code': return s ? (s.limitResets ? `waiting · resets ${s.limitResets}` : `${fmt(s.claude)} process${s.claude === 1 ? '' : 'es'}`) : 'waiting for reporter';
    case 'research': return R ? `${fmt(R.knowledge.techniques)} techniques` : '–';
    case 'planner': { const b = book(); return b ? `${b.chapters[0]}/${b.chapters[1]} chapters` : '–'; }
    default: return a.status === 'planned' ? 'not built yet' : '–';
  }
}

// ================= LABELS (DOM boxes + 1px leader lines tracking 3D anchors) =================
const LBL = AGENTS.map((a, i) => {
  const d = el('div', 'lb' + (a.status === 'planned' ? ' planned' : ''));
  d.style.setProperty('--c', a.color);
  d.innerHTML = `<b><i></i>${esc(a.name)}</b><span></span>`;
  d.onclick = () => enterAgent(a.id);
  $('#labels').appendChild(d);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '1.6');
  $('#leaders').append(line, dot);
  const anchor = ANCH[i].clone();   // pinned on the agent's brain region
  return { a, i, d, sub: d.querySelector('span'), line, dot, anchor, w: 0, h: 0 };
});
function labelSizes() { for (const L of LBL) { L.w = L.d.offsetWidth; L.h = L.d.offsetHeight; } }
const _v = new V3();
let labelsOn = 1;
const _LB = [];
const _w = new THREE.Vector3(), _cd = new THREE.Vector3();
function placeLabels() {
  const W = innerWidth, H = innerHeight;
  _v.set(0, BY, 0).project(camera); const cx = (_v.x * 0.5 + 0.5) * W, cy = (-_v.y * 0.5 + 0.5) * H;   // brain centre on screen (follows orbit/zoom)
  _cd.copy(camera.position).sub(controls.target).normalize();
  const lr = leftShown && !MOBILE ? $('#left').getBoundingClientRect() : null;
  let n = 0;
  for (const L of LBL) {
    const show = labelsOn && focusId == null;
    if (!show) { if (L.vis !== 0) { L.d.style.opacity = 0; L.line.style.opacity = 0; L.dot.style.opacity = 0; L.vis = 0; } continue; }
    if (L.vis !== 1) { L.hid = false; L.d.style.opacity = 1; L.line.style.opacity = 1; L.dot.style.opacity = 1; L.vis = 1; }
    const back = !L.a.core && _w.copy(L.anchor).setY(L.anchor.y - BY).normalize().dot(_cd) < -0.15;   // anchor on the far side of the brain
    if (back !== L.back) { L.back = back; L.d.classList.toggle('far', back); L.line.style.opacity = back ? 0.3 : 1; L.dot.style.opacity = back ? 0.3 : 1; }
    _v.copy(L.anchor).applyMatrix4(group.matrixWorld).project(camera);
    const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
    let dx = x - cx, dy = y - cy; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const out = MOBILE ? 22 : 46;
    const bx = x + dx * out, by = y + dy * out;
    const right = L.a.core ? false : dx >= -0.15;
    L._x = x; L._y = y; L._r = right;
    L._l = Math.max(8, Math.min(W - L.w - 8, right ? bx : bx - L.w));
    L._t = Math.max(60, Math.min(H - L.h - 8, by - L.h / 2));
    _LB[n++] = L;
  }
  // keep every label clear of the bright core: push it out along its ray until its box is outside the core radius
  _v.set(0, BY, 0).add(_w.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(BR)).project(camera);
  const rPx = Math.hypot((_v.x * 0.5 + 0.5) * W - cx, (-_v.y * 0.5 + 0.5) * H - cy) * (U.uM.value < 0.5 ? 1.18 : 0.98);
  const clear = L => { for (let k = 0; k < 60; k++) { const qx = Math.max(L._l, Math.min(cx, L._l + L.w)), qy = Math.max(L._t, Math.min(cy, L._t + L.h));
      if (Math.hypot(qx - cx, qy - cy) >= rPx) return; let dx = L._x - cx, dy = L._y - cy; const dl = Math.hypot(dx, dy) || 1; L._l += dx / dl * 6; L._t += dy / dl * 6; } };
  for (let i = 0; i < n; i++) clear(_LB[i]);
  // keep boxes from overlapping: a few passes pushing overlapping pairs apart vertically
  const TOP = MOBILE ? 124 : 60, BOT = (MOBILE && !focusId && !leftShown ? H * 0.52 : H) - 8;
  const mc = MCARD_ON ? $('#mcard').getBoundingClientRect() : null;
  const clamp = L => { L._l = Math.max(mc && L._t < mc.bottom + 6 && L._t + L.h > mc.top - 6 ? mc.right + 12 : 8, Math.min(W - L.w - 8, L._l)); L._t = Math.max(TOP, Math.min(BOT - L.h, L._t)); };
  const sep = () => { for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = _LB[i], B = _LB[j];
    if (A._l < B._l + B.w + 4 && B._l < A._l + A.w + 4 && A._t < B._t + B.h + 3 && B._t < A._t + A.h + 3) {
      const ov = (Math.min(A._t + A.h, B._t + B.h) - Math.max(A._t, B._t) + 3) / 2, ox = (Math.min(A._l + A.w, B._l + B.w) - Math.max(A._l, B._l) + 4) / 2;
      const wall = L => L._l <= 8.5 || L._l >= W - L.w - 8.5;
      if (ox < ov * 0.8 && !wall(A) && !wall(B)) { if (A._l <= B._l) { A._l -= ox; B._l += ox; } else { A._l += ox; B._l -= ox; } }
      else if (A._t <= B._t) { A._t -= ov; B._t += ov; } else { A._t += ov; B._t -= ov; }
    }
  } };
  for (let pass = 0; pass < 6; pass++) { for (let i = 0; i < n; i++) { clear(_LB[i]); clamp(_LB[i]); } sep(); }
  for (let pass = 0; pass < 6; pass++) { for (let i = 0; i < n; i++) clamp(_LB[i]); sep(); }
  for (let i = 0; i < n; i++) clamp(_LB[i]);
  for (let i = 0; i < n; i++) {
    const L = _LB[i], left = L._l, top = L._t, x = L._x, y = L._y, right = L._r;
    L.d.style.transform = `translate3d(${left.toFixed(1)}px,${top.toFixed(1)}px,0)`;
    const hit = lr && lr.height > 0 && left < lr.right + 8 && left + L.w > lr.left && top < lr.bottom + 24 && top + L.h > lr.top - 8;
    if (hit !== !!L.hid) { L.hid = hit; const o = hit ? 0 : 1; L.d.style.opacity = o; L.line.style.opacity = o; L.dot.style.opacity = o; }
    const ex = right ? left : left + L.w, ey = top + L.h / 2;
    L.line.setAttribute('x1', x.toFixed(1)); L.line.setAttribute('y1', y.toFixed(1)); L.line.setAttribute('x2', ex.toFixed(1)); L.line.setAttribute('y2', ey.toFixed(1));
    L.dot.setAttribute('cx', x.toFixed(1)); L.dot.setAttribute('cy', y.toFixed(1));
  }
}

// ================= PANELS =================
function renderAgents() {
  const ul = $('#aglist');
  if (!ul.children.length) for (const a of AGENTS) {
    const li = el('li', '', `<i class="sw"></i><span class="nm">${esc(a.name)}</span><span class="meta"></span><span class="badge"></span>`);
    li.style.setProperty('--c', a.color); li.onclick = () => enterAgent(a.id); ul.appendChild(li);
  }
  AGENTS.forEach((a, i) => {
    const st = status(a), li = ul.children[i];
    const b = li.querySelector('.badge'); setText(b, BADGE[st]); b.className = 'badge ' + st;
    setText(li.querySelector('.meta'), '');
    li.title = meta(a);
    setText(LBL[i].sub, short(a)); LBL[i].d.classList.toggle('hot', st === 'live');
  });
  setText($('#cx-n'), `${AGENTS.filter(a => status(a) === 'live').length} / ${NA} LIVE`);
  labelSizes();
}
function workerState(w) {
  if (w.state === 'running') return `drafting · ${dur(nowS() - w.since)}`;
  if (w.state === 'limit') return w.wake ? `limit · retry ${hm(w.wake)}` : 'session limit';
  if (w.state === 'waiting') return w.wake ? `retry ${hm(w.wake)}` : 'waiting';
  return 'idle';
}
function renderWorkers() {
  const box = $('#workers');
  if (!SNAP) { setHTML(box, '<div class="empty">waiting for the reporter heartbeat</div>'); setText($('#now-sum'), 'CLAUDE CODE WORKERS'); return; }
  const stale = !snapFresh();
  const ws = SNAP.workers || [];
  const run = ws.filter(w => w.state === 'running').length, wait = ws.length - run;
  setText($('#now-sum'), stale ? 'HEARTBEAT LOST' : ws.length ? `${run} RUNNING · ${wait} WAITING` : 'NO WORKERS');
  let h = '';
  if (stale) h += `<div class="empty">last heartbeat ${hms(snapAt)} Cairo</div>`;
  for (const w of ws) {
    const pct = w.total ? Math.round(100 * w.done / w.total) : 0;
    h += `<div class="w"><div class="l1"><b>${esc(w.batch)}${w.ch ? ' · ' + esc(w.ch) : ''}</b><span class="tnum" data-w="${w.pid}">${esc(workerState(w))}</span></div>
      <div class="l2"><span>${w.n != null ? fmt(w.n) + ' dishes' : ''}</span><span class="tnum">list ${fmt(w.done)}/${fmt(w.total)}</span></div></div>`;
  }
  if (!ws.length) h += '<div class="empty">no draft workers running</div>';
  const B = SNAP.batches;
  if (B) h += `<div class="tot tnum"><span>${fmt(B.done)}/${fmt(B.tracked)} queued batches drafted</span><span>${fmt(B.left)} left</span></div>`;
  setHTML(box, h);
}
function tickWorkers() {        // only the elapsed-time text ticks each second (real clock arithmetic)
  if (!SNAP) return;
  for (const w of SNAP.workers || []) { const n = document.querySelector(`[data-w="${w.pid}"]`); if (n) setText(n, workerState(w)); }
}

// ---- left panel: titled data blocks, hidden when idle, shown on say/done ----
const BLOCKS = ['tonight', 'book', 'queue', 'days', 'hours', 'site'];
let blockIdx = 0, leftUntil = 0, leftShown = false, blockAt = 0;
function blockHTML(k) {
  const R = DATA && DATA.real, b = book(), s = snapFresh() ? SNAP : null;
  const row = (k, v, sub, small) => `<div class="row"><span class="k">${k}${sub ? `<small>${sub}</small>` : ''}</span><span class="v">${v}${small ? `<small>${small}</small>` : ''}</span></div>`;
  if (k === 'tonight') {
    const t = tonightD(); if (!t) return '';
    return `<h3><span>Tonight</span><em>Recipes written</em></h3>
      ${row('Recipes written tonight', fmt(t.n), t.first ? `${fmt(t.batches)} batches · ${esc(t.first)}–${esc(t.last)} Cairo` : 'no batch logged yet')}
      ${(t.recent || []).slice(0, 4).map(r => row(`Batch ${esc(r[1])}`, fmt(r[2]), esc(r[0]) + ' Cairo', 'recipes')).join('')}
      ${livePages() != null ? row('Recipes live on the site', fmt(livePages()), 'public sitemap.xml') : ''}
      <div class="src">rw/manual_progress.log · one line per finished batch</div>`;
  }
  if (k === 'book') {
    if (!b) return '';
    const src = s && s.book ? 'live from reporter.py (recounted when the site changes)' : `derived ${R ? hm(Date.parse(R.at) / 1000) : '–'} Cairo`;
    return `<h3><span>Summary</span><em>The book</em></h3>
      ${row('Book dishes written', fmt(b.dishes[0]), 'base recipe of each book dish', '/ ' + fmt(b.dishes[1]))}
      ${row('Book flavours written', fmt(b.flavours[0]), 'flavour variants listed in the book', '/ ' + fmt(b.flavours[1]))}
      ${row('Extra flavours', fmt(b.extra), 'beyond the book list')}
      ${livePages() != null ? row('Recipes live on the site', fmt(livePages()), 'pages in the public sitemap.xml') : ''}
      ${row('Recipe files in the build', fmt(pages()), 'content/recipes · incl. not yet published')}
      ${row('Chapters complete', fmt(b.chapters[0]), b.focus ? 'now writing: ' + esc(b.focus) : '', '/ ' + fmt(b.chapters[1]))}
      <div class="src">${src}</div>`;
  }
  if (k === 'queue') {
    if (!s) return '';
    const ws = s.workers || [];
    return `<h3><span>Queue</span><em>Drafting</em></h3>
      ${row('Queued batches drafted', fmt(s.batches.done), 'runq2 workers + queue.txt', '/ ' + fmt(s.batches.tracked))}
      ${row('Batches left', fmt(s.batches.left))}
      ${row('Draft batches done', fmt(s.draftsDone), 'all time · raw_*.done files')}
      ${row('Workers', fmt(ws.length), ws.map(w => w.batch).join(' · ') || 'none')}
      ${s.limitResets ? row('Session limit resets', esc(s.limitResets), 'from the Claude Code limit message') : ''}
      <div class="src">reporter.py heartbeat · ${hms(snapAt)} Cairo</div>`;
  }
  if (k === 'days' || k === 'hours') {
    if (!R || !R.chart) return '';
    const arr = k === 'days' ? R.chart.days : R.chart.hours;
    const mx = Math.max(1, ...arr.map(x => x.n)), tot = arr.reduce((a, x) => a + x.n, 0);
    const lab = x => k === 'days' ? new Date(x.d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2) : x.h;
    const bars = arr.map((x, i) => `<div class="c">${k === 'days' ? `<b class="tnum">${x.n || ''}</b>` : ''}<i style="height:${(100 * x.n / mx).toFixed(1)}%"></i><span>${k === 'hours' && i % 3 ? '' : lab(x)}</span></div>`).join('');
    return `<h3><span>Output</span><em>${k === 'days' ? '7 days' : 'Last 24 h'}</em></h3>
      ${row(k === 'days' ? 'Recipe pages added · 7 days' : 'Recipe pages added · 24 h', fmt(tot))}
      <div class="chart ${k === 'hours' ? 'h' : ''}">${bars}</div>
      <div class="src">first git commit that added each recipe file · derived ${hm(Date.parse(R.at) / 1000)} Cairo</div>`;
  }
  if (k === 'site') {
    if (!R) return '';
    const cs = commitsL().slice(0, 5), s2 = snapFresh() ? SNAP : null;
    return `<h3><span>Publish</span><em>Site commits</em></h3>
      ${s2 && s2.commitsToday != null ? row('Site commits today', fmt(s2.commitsToday), 'since 00:00 Cairo') : ''}
      ${cs.map(c => `<div class="row"><span class="k">${esc(c.s)}</span><span class="v" style="font-size:12px">${hm(c.t)}</span></div>`).join('')}
      <div class="src">public-site git log · ${fmt(R.commitCount)} commits at last board build</div>`;
  }
  return '';
}
function renderBlocks() {
  const box = $('#blocks');
  if (!box.children.length) for (const k of BLOCKS) { const d = el('div', 'blk'); d.dataset.k = k; box.appendChild(d); $('#bdots').appendChild(el('i')); }
  [...box.children].forEach((d, i) => { setHTML(d, blockHTML(BLOCKS[i])); d.classList.toggle('on', i === blockIdx); $('#bdots').children[i].classList.toggle('on', i === blockIdx); });
}
function showLeft(block, ms = 45000) {
  if (block != null) blockIdx = BLOCKS.indexOf(block);
  blockAt = ANIM(); leftUntil = Math.max(leftUntil, ANIM() + ms); renderBlocks();
  if (!leftShown && view === 'core' && focusId == null) {
    leftShown = true; document.body.classList.add('leftopen'); const L = $('#left');
    gsap.killTweensOf(L); gsap.set(L, { visibility: 'visible' }); gsap.to(L, { opacity: 1, x: 0, duration: 0.9, ease: 'power3.out' });
  }
}
function hideLeft() {
  if (!leftShown) return; leftShown = false; document.body.classList.remove('leftopen'); const L = $('#left');
  gsap.killTweensOf(L); gsap.to(L, { opacity: 0, x: -16, duration: 0.7, ease: 'power2.in', onComplete: () => gsap.set(L, { visibility: 'hidden' }) });
}
function tickLeft() {
  if (!leftShown) return;
  if (ANIM() > leftUntil) return hideLeft();
  if (ANIM() - blockAt > 7000) { blockIdx = (blockIdx + 1) % BLOCKS.length; blockAt = ANIM(); renderBlocks(); }
}
$('#pill').onclick = () => leftShown ? (leftUntil = 0, hideLeft()) : showLeft(null, 60000);

let MCARD_ON = false;
// compact metrics card + subtitle line (outside view, like the reference); every value is a real number from the reporter or data.json
function renderMetrics() {
  const on = !MOBILE && view === 'core' && focusId == null && depth !== 'in' && !leftShown;
  if (on !== MCARD_ON) { MCARD_ON = on; $('#mcard').classList.toggle('on', on); }
  const R = DATA && DATA.real, t = tonightD(), b = book(), lp = livePages();
  const m = [[t && t.n != null ? fmt(t.n) : '–', 'recipes written tonight'], [lp != null ? fmt(lp) : '–', 'recipes live on the site'],
    [b ? `${fmt(b.chapters[0])}<small>/${fmt(b.chapters[1])}</small>` : '–', 'chapters complete'], [R && R.knowledge ? fmt(R.knowledge.techniques) : '–', 'techniques researched'],
    [`${AGENTS.filter(a => status(a) === 'live').length}<small>/${NA}</small>`, 'agents live now']];
  setHTML($('#mc-rows'), m.map(([v, k]) => `<div class="mr"><b>${v}</b><span>${k}</span></div>`).join(''));
  const ev = EVENTS[EVENTS.length - 1];
  setHTML($('#subline'), ev ? `<i>${esc(hm(ev.t))}</i> ${esc((AGENTS[IDX[ev.agent]] || AGENTS[0]).name)} <em>·</em> ${esc(ev.text.slice(0, 120))}` : 'no real event in the last 12 h');
  $('#subline').classList.toggle('on', !MOBILE && view === 'core' && focusId == null);
}
function renderTop() {
  renderMetrics();
  const live = liveFeed(), pill = $('#pill');
  pill.classList.toggle('live', !!live);
  setText($('#pill-state'), live ? 'LIVE' : lastLiveMsg ? 'RECONNECTING' : 'CONNECTING');
  setText($('#pill-ago'), lastReal ? `${MOBILE ? 'last event' : 'last real event'} ${ago(lastReal)}` : 'no real event yet');
  $('#brand').classList.toggle('ok', !!live);
  setText($('#link span'), live ? 'CONNECTED' : lastLiveMsg ? 'RECONNECTING' : 'CONNECTING');
  const ws = workers(), run = ws.filter(w => w.state === 'running').length;
  $('#status').classList.toggle('working', run > 0);
  setText($('#st-word'), run ? 'WORKING' : 'LISTENING');
  let sub = 'Cairo · UTC+3';
  if (run) sub = `${run} draft worker${run > 1 ? 's' : ''} running · Cairo`;
  else if (ws.length && SNAP.limitResets) sub = `${ws.length} worker${ws.length > 1 ? 's' : ''} waiting · limit resets ${SNAP.limitResets}`;
  else if (ws.length) sub = `${ws.length} worker${ws.length > 1 ? 's' : ''} waiting · Cairo`;
  setText($('#st-sub'), sub);
  setText($('#clock'), hms(NOW()));
  const R = DATA && DATA.real;
  setText($('#f-data'), R ? `book data derived ${hm(Date.parse(R.at) / 1000)} Cairo` : '');
  setText($('#f-feed'), live ? `heartbeat ${Math.max(0, Math.round((NOW() - lastLiveMsg) / 1000))} s ago` : '');
}
function renderAll() { renderAgents(); renderWorkers(); if (leftShown) renderBlocks(); renderTop(); if (focusId) renderAgentView(); if (view === 'flow') renderFlowCards(); }

// ================= SUBTITLES + BEAM =================
const SUBQ = []; let sub = null;   // {who, text, t0}
const CPS = 38;
function say(ev) { SUBQ.push({ who: (AGENTS[IDX[ev.agent]] || AGENTS[0]).name, text: ev.text }); if (SUBQ.length > 4) SUBQ.shift(); }
let beamV = 0;
function tickSubs() {
  const t = ANIM();
  if (!sub && SUBQ.length) { sub = { ...SUBQ.shift(), t0: t }; setText($('#who'), sub.who.toUpperCase()); $('#subs').classList.add('on'); document.body.classList.add('saying'); }
  if (!sub) return 0;
  const typeMs = sub.text.length / CPS * 1000, hold = 5500;
  const n = Math.min(sub.text.length, Math.floor((t - sub.t0) / 1000 * CPS));
  setText($('#subtxt'), sub.text.slice(0, n));
  if (t - sub.t0 > typeMs + hold) { sub = null; setText($('#subtxt'), ''); if (!SUBQ.length) { $('#subs').classList.remove('on'); document.body.classList.remove('saying'); } return 0; }
  return t - sub.t0 < typeMs ? 1 : 0.55;          // beam: full while typing, softer while holding
}

// ================= EVENTS =================
const ACT = new Array(NA).fill(0.2), PULSE = new Array(NA).fill(0), AT = new Array(NA).fill(0);
function handle(ev, live) {
  if (!ev || !ev.agent || !ev.text) return;
  const key = ev.id || ev._nid; if (key) { if (SEEN.has(key)) return; SEEN.add(key); }
  if (IDX[ev.agent] == null) ev.agent = 'jarvis';
  ev.t = +ev.t || nowS();
  EVENTS.push(ev); EVENTS.sort((a, b) => a.t - b.t); if (EVENTS.length > 600) EVENTS.splice(0, EVENTS.length - 600);
  const s = S[ev.agent]; s.events.push(ev); s.events.sort((a, b) => a.t - b.t); if (s.events.length > 120) s.events.shift();
  s.last = Math.max(s.last, ev.t); lastReal = Math.max(lastReal, ev.t);
  const fresh = live && nowS() - ev.t < 180;
  if (fresh) {
    const i = IDX[ev.agent]; PULSE[i] = 1; PULSE[0] = Math.max(PULSE[0], 0.5);
    if (ev.type === 'say') { say(ev); showLeft('tonight'); }
    else if (ev.type === 'done') showLeft(ev.agent === 'recipe-writer' ? (/written tonight/.test(ev.text) ? 'tonight' : 'queue') : ev.agent === 'recipe-checker' ? 'site' : 'book', 30000);
    flowOnEvent(ev);
  }
  scheduleRender();
}
let renderPending = false;
function scheduleRender() { if (!renderPending) { renderPending = true; setTimeout(() => { renderPending = false; renderAll(); }, 50); } }
function applySnap(sn, at) {
  if (!sn) return;
  SNAP = sn; snapAt = at;
  if (sn.lastEv) lastReal = Math.max(lastReal, sn.lastEv);
  scheduleRender();
}

// ================= FEEDS (two public ntfy topics; see README) =================
const LIVE = CFG.live, MSV = { server: CFG.ntfyServer, topic: CFG.topic };
function parseMsg(m, live) {           // m = ntfy message JSON
  if (!m || m.event !== 'message') return;
  if (CAPTURE && m.time && m.time * 1000 > NOW()) wallOff += m.time * 1000 - NOW();
  let p; try { p = JSON.parse(m.message); } catch { p = { agent: 'jarvis', type: 'step', text: m.message }; }
  if (p.k === 'hb') {
    if (live) lastLiveMsg = NOW();
    const at = live ? NOW() : (m.time || nowS()) * 1000;
    if (!SNAP || at >= snapAt) applySnap(p.snap, at);
    for (const e of p.recent || []) handle(e, false);
    for (const e of p.ev || []) handle(e, live);
    return;
  }
  p._nid = m.id; if (!p.t) p.t = m.time;
  handle(p, live);
}
async function poll(cfg, since) {
  try {
    const r = await fetch(`${cfg.server}/${cfg.topic}/json?poll=1&since=${since}`, { cache: 'no-store' });
    const lines = (await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return lines;
  } catch { return []; }
}
const ES = {};
function openSSE(name, cfg, onAny) {
  try { ES[name] && ES[name].close(); } catch { }
  const es = new EventSource(`${cfg.server}/${cfg.topic}/sse`);
  es.onmessage = e => { onAny(); try { parseMsg(JSON.parse(e.data), true); } catch { } };
  es.addEventListener('keepalive', onAny); es.addEventListener('open', onAny);
  ES[name] = es;
}
let liveSeen = 0, msSeen = 0;
async function connectLive() {
  const ms = await poll(LIVE, '40s');
  const hbs = ms.filter(m => m.event === 'message');
  // older heartbeats only seed history; the newest one sets the snapshot (as of its own time)
  for (const m of hbs) parseMsg(m, false);
  if (hbs.length) { const last = hbs[hbs.length - 1]; if (NOW() / 1000 - last.time < 20) lastLiveMsg = last.time * 1000; }
  liveSeen = NOW(); openSSE('live', LIVE, () => liveSeen = NOW());
  scheduleRender();
}
async function connectMs() {
  for (const m of await poll(MSV, CFG.historySince || '12h')) parseMsg(m, false);
  msSeen = NOW(); openSSE('ms', MSV, () => msSeen = NOW());
  scheduleRender();
}
function watchFeeds() {
  if (CAPTURE && window.__noWatch) return;
  if (NOW() - Math.max(lastLiveMsg, liveSeen) > 20000) { liveSeen = NOW(); connectLive(); }
  if (NOW() - msSeen > 70000) { msSeen = NOW(); connectMs(); }
}

// ================= INSIDE VIEW (fly to a sector) =================
let focusId = null, view = 'core';
// ---- orbit controls (as in v3 fcd8240): drag/touch rotate in 3D, pinch/scroll zoom, damping glide, idle auto-rotate ----
const DIST = { out: HOME.pos.z, in: MOBILE ? 16 : 12.5 };
const LIM = { out: [9.5, MOBILE ? 32 : 28], in: [4.6, MOBILE ? 22 : 18] };
const AUTO = !REDUCED && (!CAPTURE || Q.has('spin'));
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.055, enablePan: false, rotateSpeed: MOBILE ? 0.8 : 0.62, zoomSpeed: 0.75,
  minDistance: LIM.out[0], maxDistance: LIM.out[1], autoRotate: AUTO, autoRotateSpeed: 0.42 });
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.target.copy(HOME.look); controls.update();
let idleTimer = 0, dragging = false;
controls.addEventListener('start', () => { dragging = true; controls.autoRotate = false; clearTimeout(idleTimer); document.body.classList.add('grabbing'); });
controls.addEventListener('end', () => { dragging = false; document.body.classList.remove('grabbing'); clearTimeout(idleTimer); idleTimer = setTimeout(() => { controls.autoRotate = AUTO; }, 3500); });
// fly the camera along a smooth arc around the target (direction slerps, distance eases) so zooms and sector visits glide
let fly = null; const FL = { p0: new V3(), l0: new V3(), p1: new V3(), l1: new V3(), n0: new V3(), n1: new V3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), r0: 1, r1: 1, k: 0 };
function flyTo(pos, look, dur, ease = 'power3.inOut') {
  if (fly) fly.kill();
  FL.l0.copy(controls.target); FL.p0.copy(camera.position); FL.p1.copy(pos); FL.l1.copy(look);
  FL.n0.copy(FL.p0).sub(FL.l0); FL.r0 = FL.n0.length(); FL.n0.normalize();
  FL.n1.copy(FL.p1).sub(FL.l1); FL.r1 = FL.n1.length(); FL.n1.normalize();
  FL.q.setFromUnitVectors(FL.n0, FL.n1); FL.k = 0; controls.enabled = false;
  fly = gsap.to(FL, { k: 1, duration: dur, ease, onComplete: () => { fly = null; controls.enabled = true; } });
}
function flyStep() {
  const k = FL.k;
  controls.target.lerpVectors(FL.l0, FL.l1, k);
  FL.qi.identity().slerp(FL.q, k);
  camera.position.copy(FL.n0).applyQuaternion(FL.qi).multiplyScalar(FL.r0 + (FL.r1 - FL.r0) * k).add(controls.target);
  camera.lookAt(controls.target);
}
const camAt = (dist, look = HOME.look) => { const d = camera.position.clone().sub(controls.target); if (d.lengthSq() < 1e-6) d.set(0, 0, 1); return d.setLength(dist).add(look); };
// ---- outside (neon burst) <-> inside (v6 dot brain), cross-faded by U.uM with a zoom ----
let depth = 'out';
function setDepth(d, instant) {
  if (d === depth && !instant) return;
  if (focusId) exitAgent(true);
  depth = d; setTimeout(renderCrumbs, 0); const inn = d === 'in', dur = instant ? 0.01 : 1.9;
  document.body.classList.toggle('inside', inn);
  controls.minDistance = Math.min(LIM[d][0], camera.position.distanceTo(controls.target)); controls.maxDistance = Math.max(LIM[d][1], camera.position.distanceTo(controls.target));
  flyTo(camAt(DIST[d]), HOME.look, dur, 'power3.inOut');
  gsap.to(U.uM, { value: inn ? 1 : 0, duration: dur * 0.9, ease: 'sine.inOut', onComplete: () => { controls.minDistance = LIM[d][0]; controls.maxDistance = LIM[d][1]; } });
  $('#depth').innerHTML = inn ? '<i>←</i> Outside' : '<i>◉</i> Enter core';
  $('#depth').classList.toggle('in', inn);
}
$('#depth').onclick = () => setDepth(depth === 'in' ? 'out' : 'in');
let downAt = null;
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
let preFocus = null;
function sectorWorld(a, r) { return a.core ? new V3(0, 0, 0) : ANCH[IDX[a.id]].clone().setLength(r).applyMatrix4(group.matrixWorld); }
function renderAgentView() {
  const a = AGENTS[IDX[focusId]]; if (!a) return;
  const st = status(a), s = snapFresh() ? SNAP : null, R = DATA && DATA.real, b = book();
  $('#agentview').style.setProperty('--c', a.color);
  setText($('#av-code'), a.code); setText($('#av-name'), a.name); setText($('#av-role'), a.role);
  const badge = $('#av-badge'); setText(badge, BADGE[st]); badge.className = 'badge ' + st;
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="v" style="font-size:15px">${v}</span></div>`;
  const ev = S[a.id].events, e30 = ev.filter(e => nowS() - e.t < 1800).length;
  let rows = '';
  switch (a.id) {
    case 'jarvis': rows = row('Live link', liveFeed() ? 'connected' : 'reconnecting') + row('Last heartbeat', lastLiveMsg ? hms(lastLiveMsg) : '–') + row('Real events · all agents · 12 h', fmt(EVENTS.length)) + row('Last real event', lastReal ? hms(lastReal * 1000) : '–'); break;
    case 'recipe-writer': rows = (tonightD() ? row('Recipes written tonight', fmt(tonightD().n)) + row('Batches logged tonight', fmt(tonightD().batches)) : '') + (s ? row('Draft batches done · all time', fmt(s.draftsDone)) + row('Queued batches drafted', `${fmt(s.batches.done)} / ${fmt(s.batches.tracked)}`) + row('Batches left', fmt(s.batches.left)) + (s.workers || []).map(w => row(`Batch ${esc(w.batch)}${w.ch ? ' · ' + esc(w.ch) : ''}`, esc(workerState(w)))).join('') : row('Reporter', 'no heartbeat')); break;
    case 'recipe-checker': rows = (b ? row('Book dishes written', `${fmt(b.dishes[0])} / ${fmt(b.dishes[1])}`) + row('Book flavours written', `${fmt(b.flavours[0])} / ${fmt(b.flavours[1])}`) : '') + row('Recipes live on the site', fmt(livePages())) + row('Recipe files in the build', fmt(pages())) + (s && s.commit ? row('Latest site commit', hm(s.commit.t)) + `<div class="src">${esc(s.commit.s)}</div>` : ''); break;
    case 'claude-code': rows = s ? row('Claude processes', fmt(s.claude)) + row('Session limit resets', s.limitResets ? esc(s.limitResets) : 'no limit') + row('Draft workers', fmt((s.workers || []).length)) : row('Reporter', 'no heartbeat'); break;
    case 'research': rows = R ? row('Knowledge files', fmt(R.knowledge.files)) + row('Techniques', fmt(R.knowledge.techniques)) + row('Unique sources', fmt(R.knowledge.sources)) + row('Research worker', s && s.research ? 'running' : 'not running') : ''; break;
    case 'planner': rows = b ? row('Chapters complete', `${fmt(b.chapters[0])} / ${fmt(b.chapters[1])}`) + row('Now writing', esc(b.focus || '–')) : ''; break;
    default: rows = row('Status', 'not built yet') + `<div class="src">${(a.regions || []).map(r => esc(r.name)).join(' · ')}</div>`;
  }
  rows += row('Real events · 30 min', fmt(e30)) + row('Real events · 12 h', fmt(ev.filter(e => nowS() - e.t < 43200).length));
  setHTML($('#av-rows'), rows);
  if (DC && DC.id === focusId) { buildDeep(a); renderDeepPanel(); }
  setHTML($('#av-feed'), ev.slice(-25).reverse().map(e => `<li><time>${hm(e.t)}</time><span>${esc(e.text)}</span></li>`).join('') || '<li><span>No real events in the last 12 h.</span></li>');
}

// ================= DEEP LEVEL (v8): each agent's own dot cloud, one cluster per REAL task, dot count = real count =================
const DCAP = 90, ITEMCAP = 14;
const prettyFile = f => f.replace(/^\d+-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
function clustersFor(a) {
  const R = DATA && DATA.real, D = R && R.deep, s = snapFresh() ? SNAP : null, L = [];
  switch (a.id) {
    case 'recipe-writer':
      for (const w of (s && s.workers) || []) L.push({ key: 'w' + w.pid, name: `${w.batch}${w.ch ? ' · ' + w.ch : ''}`, n: w.n || w.total || 1, unit: w.n ? 'dishes' : 'running', items: [], live: 1,
        note: `drafting now · ${workerState(w)} · list ${fmt(w.done)}/${fmt(w.total)}`, src: 'reporter heartbeat (runq2 worker)' });
      for (const b of ((D && D.batches) || []).slice().reverse()) L.push({ key: 'b' + b.id + b.t, name: b.id, n: b.n, unit: b.n === 1 ? 'recipe' : 'recipes', items: b.names || [],
        note: `logged ${b.t} Cairo${b.ch ? ' · ' + b.ch : ''}`, src: 'rw/manual_progress.log' + (b.names && b.names.length ? (b.ch ? ' + SPEC-PROGRESS.md' : ' + site commit') : '') });
      break;
    case 'recipe-checker':
      for (const p of ((D && D.publishes) || []).filter(p => p.n > 0)) L.push({ key: 'p' + p.h, name: p.h.slice(0, 7), n: p.n, unit: p.n === 1 ? 'recipe' : 'recipes', items: p.names || [],
        note: `published ${hm(p.t)} Cairo · ${p.s}`, src: 'public-site git log' });
      break;
    case 'research':
      for (const k of (D && D.knowledge) || []) L.push({ key: 'k' + k.file, name: prettyFile(k.file), n: k.techniques, unit: 'techniques', items: k.names || [],
        note: `${fmt(k.sources)} sources`, src: `knowledge/${k.file}.md` });
      break;
    case 'planner': {
      const ch = (D && D.chapters) || [], grp = [['Complete', c => c.total && c.done >= c.total], ['In progress', c => c.done > 0 && c.done < c.total], ['Not started', c => !c.done]];
      for (const [nm, f] of grp) { const m = ch.filter(f); if (m.length) L.push({ key: 'c' + nm, name: nm, n: m.length, unit: m.length === 1 ? 'chapter' : 'chapters', items: m.map(c => `${c.name} ${c.done}/${c.total}`),
        note: `${fmt(m.reduce((x, c) => x + c.done, 0))} of ${fmt(m.reduce((x, c) => x + c.total, 0))} dishes written`, src: 'data chapters + rw/CHAPTER-DONE.md', all: 1 }); }
      break;
    }
    case 'claude-code':
      if (s && s.claude) L.push({ key: 'cc', name: 'Claude', n: s.claude, unit: s.claude === 1 ? 'process' : 'processes', items: [], live: 1, note: s.limitResets ? `session limit resets ${s.limitResets}` : 'running', src: 'reporter heartbeat' });
      for (const w of (s && s.workers) || []) L.push({ key: 'cw' + w.pid, name: `worker ${w.batch}`, n: w.n || 1, unit: w.n ? 'dishes' : 'running', items: [], live: 1, note: workerState(w), src: 'reporter heartbeat' });
      break;
    case 'jarvis': {
      const by = {};
      for (const e of EVENTS) if (nowS() - e.t < 43200) (by[e.agent] = by[e.agent] || []).push(e);
      for (const id in by) { const ag = AGENTS[IDX[id]]; if (!ag) continue; const ev = by[id];
        L.push({ key: 'j' + id, name: ag.name, n: ev.length, unit: ev.length === 1 ? 'event' : 'events', items: ev.slice(-ITEMCAP).reverse().map(e => `${hm(e.t)} ${e.text}`), all: 1, note: 'real events · last 12 h', src: 'ntfy live feed' }); }
      break;
    }
  }
  return L;
}
const DEEP = new THREE.Group(); DEEP.visible = false; group.add(DEEP);
const dU = { uDA: { value: 0 }, uSel: { value: -1 }, uSelAmt: { value: 0 } };
const deepMat = new THREE.ShaderMaterial({
  uniforms: { ...U, ...dU }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  vertexShader: SHARED + `uniform float uDA, uSel, uSelAmt; attribute vec3 aCol; attribute vec3 aQ; varying vec3 vC; varying float vA;
    void main(){ float k = aQ.x, sd = aQ.y, it = aQ.z; float sel = step(abs(k - uSel), .5);
      vec3 p = position + vec3(sin(uT * .6 + sd * 40.), cos(uT * .5 + sd * 31.), sin(uT * .45 + sd * 23.)) * .035 * uMo;
      vec4 mv = modelViewMatrix * vec4(p, 1.);
      float tw = .78 + .22 * sin(uT * 2.1 + sd * 60.);
      float dim = mix(1., mix(.18, 1.25, sel), uSelAmt);
      vC = mix(aCol, wpal(uT * .035 + k * .09 + sd * .1), .3);
      vA = uDA * tw * dim;
      gl_PointSize = (it > .5 ? 15. : 8.) * uPR * (7. / -mv.z) * mix(1., mix(.8, 1.35, sel), uSelAmt);
      gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard;
    float core = exp(-d * d * 14.), glow = max(exp(-d * d * 4.) - .02, 0.) * .45 * (1. - d); gl_FragColor = vec4(mix(vC, vec3(1.), core * .7) * (core * 1.2 + glow) * vA, 1.); }`,
});
const deepLineMat = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 });
const deepHub = mkHalo(mkGlow([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(160,230,255,.5)'], [0.55, 'rgba(60,120,255,.1)'], [1, 'rgba(0,0,0,0)']]), 1.4, 1.4);
scene.remove(deepHub); DEEP.add(deepHub);
const CLP = $('#labels');
const CL = [];   // pooled cluster / item labels
function clLabel(i) { if (!CL[i]) { const d = el('div', 'cl'); d.innerHTML = '<b></b><span></span>'; d.onclick = () => d._k != null && enterSub(d._k); CLP.appendChild(d); CL[i] = { d, b: d.firstChild, s: d.lastChild }; } return CL[i]; }
let DC = null;   // current cloud: {id, list, sig, cen:[V3], rc:[], items:[[V3]], R}
function buildDeep(a) {
  const list = clustersFor(a), sig = a.id + '|' + list.map(c => c.key + ':' + c.n + ':' + c.items.length).join(',');
  if (DC && DC.sig === sig) return;
  const K = list.length, R = K ? 0.9 + 0.32 * Math.sqrt(K) : 0, col0 = new THREE.Color(a.color), tc = new THREE.Color();
  const cen = [], rc = [], items = [], P = [], C = [], Qa = [], LP = [];
  let s0 = 777 + K; const r2 = () => (s0 = (s0 * 16807) % 2147483647) / 2147483647;
  list.forEach((c, k) => {
    const y = K === 1 ? 0 : 1 - 2 * (k + .5) / K, rr = Math.sqrt(1 - y * y), th = k * 2.39996;
    const o = new V3(Math.cos(th) * rr, y * .8, Math.sin(th) * rr).multiplyScalar(K === 1 ? 0 : R);
    const m = Math.max(1, Math.min(DCAP, c.n | 0)), r = 0.12 + 0.07 * Math.cbrt(m); cen.push(o); rc.push(r);
    tc.copy(col0).lerp(wpalJS(k * .13, new THREE.Color()), .35);
    const ni = Math.min(m, c.items.length, ITEMCAP), its = [];
    for (let j = 0; j < m; j++) {
      let p;
      if (j < ni) { const yy = ni === 1 ? 0 : 1 - 2 * (j + .5) / ni, q = Math.sqrt(1 - yy * yy), t2 = j * 2.39996; p = new V3(Math.cos(t2) * q, yy, Math.sin(t2) * q).multiplyScalar(r * 1.05).add(o); its.push(p); }
      else { const u = r2() * 2 - 1, t2 = r2() * 6.2832, q = Math.sqrt(1 - u * u), rad = r * Math.cbrt(r2()) * .9; p = new V3(q * Math.cos(t2), u, q * Math.sin(t2)).multiplyScalar(rad).add(o); }
      P.push(p.x, p.y, p.z); C.push(tc.r, tc.g, tc.b); Qa.push(k, r2(), j < ni ? 1 : 0);
    }
    items.push(its); LP.push(0, 0, 0, o.x, o.y, o.z);
  });
  DEEP.children.filter(c => c !== deepHub).forEach(c => { DEEP.remove(c); c.geometry.dispose(); });
  if (K) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aQ', new THREE.Float32BufferAttribute(Qa, 3));
    const pts = new THREE.Points(g, deepMat); pts.frustumCulled = false; pts.renderOrder = 6; DEEP.add(pts);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(LP, 3)); deepLineMat.color.copy(col0);
    const ln = new THREE.LineSegments(lg, deepLineMat); ln.frustumCulled = false; ln.renderOrder = 5; DEEP.add(ln);
  }
  deepHub.material.color.copy(col0).lerp(WHITE, .4);
  DC = { id: a.id, list, sig, cen, rc, items, R };
  if (subK >= K) subK = -1;
  renderDeepPanel();
}
function deepCentre(a) { const d = a.core ? new V3(0, 0, 1) : ANCH[IDX[a.id]].clone().setY(ANCH[IDX[a.id]].y - BY).normalize(); return d.multiplyScalar(a.core ? BR + 2.2 : BR + 2.6).add(new V3(0, BY, 0)); }
let subK = -1, preDeep = null;
const deepDist = () => Math.max(MOBILE ? 8.5 : 6.2, (DC ? DC.R : 1) * (MOBILE ? 4.4 : 3.3));
function deepCam(c, dist) { const dir = c.clone().sub(new V3(0, BY, 0)).normalize().add(new V3(0, .18, 0)).normalize(); if (!MOBILE) { const s = new V3().crossVectors(new V3(0, 1, 0), dir).normalize(); return { pos: c.clone().addScaledVector(dir, dist).addScaledVector(s, -dist * .2), look: c.clone().addScaledVector(s, -dist * .2) }; } return { pos: c.clone().addScaledVector(dir, dist), look: c.clone().add(new V3(0, -dist * .1, 0)) }; }
function enterAgent(id) {
  const a = AGENTS[IDX[id]]; if (!a) return;
  if (view === 'flow') setView('core', true);
  if (focusId === id) { if (subK >= 0) exitSub(); return; }
  if (!focusId) preFocus = camera.position.clone().sub(controls.target).setLength(DIST.in);
  if (depth !== 'in') { depth = 'in'; document.body.classList.add('inside'); gsap.to(U.uM, { value: 1, duration: 1.6, ease: 'sine.inOut' }); $('#depth').innerHTML = '<i>←</i> Outside'; $('#depth').classList.add('in'); }
  focusId = id; subK = -1; DC = null; hideLeft();
  document.body.classList.add('deep'); document.body.classList.remove('item');
  DEEP.position.copy(deepCentre(a)); DEEP.visible = true; buildDeep(a);
  const c = DEEP.position.clone(), v = deepCam(c, deepDist());
  controls.minDistance = 1.6; controls.maxDistance = 18; controls.autoRotateSpeed = 0.22; controls.autoRotate = AUTO;
  flyTo(v.pos, v.look, 1.8);
  U.uFocus.value = IDX[id]; gsap.to(U.uFocusAmt, { value: 1, duration: 1.2 });
  gsap.to(U.uDeep, { value: 1, duration: 1.4, ease: 'sine.inOut' }); gsap.to(dU.uDA, { value: 1, duration: 1.2, delay: .5 }); gsap.to(deepLineMat, { opacity: .22, duration: 1.2, delay: .6 });
  gsap.to(dU.uSelAmt, { value: 0, duration: .5 });
  gsap.to(['#right'], { autoAlpha: 0, duration: 0.4 });
  const P = $('#agentview'); P.classList.remove('hidden'); renderAgentView();
  gsap.fromTo(P, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.8, delay: 0.5, ease: 'power3.out' });
  renderCrumbs();
}
function enterSub(k) {
  if (!DC || !DC.list[k]) return;
  subK = k; document.body.classList.add('item');
  const c = DEEP.localToWorld(DC.cen[k].clone()), v = deepCam(c, Math.max(2.1, DC.rc[k] * 7.5));
  flyTo(v.pos, v.look, 1.4); dU.uSel.value = k; gsap.to(dU.uSelAmt, { value: 1, duration: .8 });
  renderDeepPanel(); renderCrumbs();
}
function exitSub() {
  if (subK < 0) return; subK = -1; document.body.classList.remove('item');
  const v = deepCam(DEEP.position.clone(), deepDist()); flyTo(v.pos, v.look, 1.3);
  gsap.to(dU.uSelAmt, { value: 0, duration: .7 }); renderDeepPanel(); renderCrumbs();
}
function exitAgent(noFly) {
  if (!focusId) return; focusId = null; subK = -1; controls.autoRotate = AUTO; controls.autoRotateSpeed = 0.42;
  document.body.classList.remove('deep', 'item');
  controls.minDistance = LIM[depth][0]; controls.maxDistance = LIM[depth][1];
  if (!noFly) flyTo(preFocus ? preFocus.clone().setLength(DIST[depth]) : camAt(DIST[depth]), HOME.look, 1.5);
  gsap.to(U.uFocusAmt, { value: 0, duration: 1, onComplete: () => { if (!focusId) U.uFocus.value = -1; } });
  gsap.to(U.uDeep, { value: 0, duration: 1.2 }); gsap.to(deepLineMat, { opacity: 0, duration: .5 });
  gsap.to(dU.uDA, { value: 0, duration: .6, onComplete: () => { if (!focusId) DEEP.visible = false; } });
  gsap.to(['#right'], { autoAlpha: 1, duration: 0.6, delay: 0.6 });
  const P = $('#agentview'); gsap.to(P, { opacity: 0, duration: 0.35, onComplete: () => { if (!focusId) P.classList.add('hidden'); } });
  for (const L of CL) L.d.style.opacity = 0;
  renderCrumbs();
}
function goUp() { if (subK >= 0) exitSub(); else if (focusId) exitAgent(); else if (view === 'flow') setView('core'); else if (depth === 'in') setDepth('out'); }
$('#back').onclick = goUp;
addEventListener('keydown', e => { if (e.key === 'Escape') goUp(); });
function renderCrumbs() {
  const a = focusId && AGENTS[IDX[focusId]], c = a && subK >= 0 && DC && DC.list[subK];
  const parts = [['out', 'Outside'], ['in', 'Core']];
  if (a) parts.push(['agent', a.name]); if (c) parts.push(['item', c.name]);
  const lvl = c ? 'item' : a ? 'agent' : depth;
  setHTML($('#crumbs'), parts.filter((p, i) => i <= parts.findIndex(q => q[0] === lvl)).map(([k, t]) => `<button data-k="${k}" class="${k === lvl ? 'on' : ''}">${esc(t)}</button>`).join('<i>/</i>'));
  $('#crumbs').style.display = lvl === 'out' ? 'none' : '';
  $('#back').innerHTML = lvl === 'item' ? `← ${esc(a.name)}` : '← Core';
}
$('#crumbs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k;
  if (k === 'out') { if (focusId) exitAgent(true); setDepth('out'); } else if (k === 'in') { if (focusId) exitAgent(); else setDepth('in'); } else if (k === 'agent') exitSub(); renderCrumbs(); });
function renderDeepPanel() {
  const box = $('#av-deep'); if (!box || !DC) return;
  const a = AGENTS[IDX[DC.id]];
  if (!DC.list.length) { setHTML(box, `<h4 class="micro">Tasks</h4><p class="none">Nothing running</p><p class="src">${a.status === 'planned' ? 'This agent is planned and not built yet.' : 'No real task data for this agent right now.'}</p>`); return; }
  if (subK >= 0) {
    const c = DC.list[subK], its = c.all ? c.items : c.items.slice(0, 40);
    setHTML(box, `<h4 class="micro">${esc(c.name)}</h4><div class="big"><span class="num">${fmt(c.n)}</span><span>${esc(c.unit)}</span></div><p class="note">${esc(c.note)}</p>
      ${its.length ? `<ol class="names">${its.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="none">Names not recorded for this batch</p>'}<p class="src">source · ${esc(c.src)}</p>`);
    return;
  }
  const tot = DC.list.reduce((x, c) => x + (c.n || 0), 0);
  setHTML(box, `<h4 class="micro">Tasks · ${fmt(DC.list.length)}</h4><ul class="tasks">${DC.list.map((c, k) => `<li data-k="${k}"${c.live ? ' class="live"' : ''}><span class="nm">${esc(c.name)}</span><span class="num">${fmt(c.n)}</span><span class="u">${esc(c.unit)}</span></li>`).join('')}</ul>`);
}
$('#av-deep').addEventListener('click', e => { const li = e.target.closest('li[data-k]'); if (li) enterSub(+li.dataset.k); });
function placeDeep() {
  const on = focusId && DC && dU.uDA.value > .05;
  let n = 0;
  if (on) {
    const W = innerWidth, H = innerHeight, boxes = [];
    DC.list.forEach((c, k) => {
      if (subK >= 0 && k !== subK && !MOBILE) { } else if (subK >= 0 && k !== subK) return;
      _v.copy(DC.cen[k]).applyMatrix4(DEEP.matrixWorld); const z = _v.clone().applyMatrix4(camera.matrixWorldInverse).z; if (z > -0.3) return;
      _v.project(camera); const x = (_v.x * .5 + .5) * W, y = (-_v.y * .5 + .5) * H;
      const L = clLabel(n++); L.d._k = k; L.d.className = 'cl' + (k === subK ? ' sel' : '') + (c.live ? ' live' : '');
      setText(L.b, c.name); setText(L.s, `${fmt(c.n)} ${c.unit}`);
      const pr = DC.rc[k] / (-z) * H * .9;
      boxes.push({ L, x, y: y - pr - 8, o: subK >= 0 && k !== subK ? .35 : 1 });
    });
    if (subK >= 0) DC.items[subK].forEach((p, j) => {
      _v.copy(p).applyMatrix4(DEEP.matrixWorld); const z = _v.clone().applyMatrix4(camera.matrixWorldInverse).z; if (z > -0.2) return;
      _v.project(camera); const L = clLabel(n++); L.d._k = null; L.d.className = 'cl it';
      setText(L.b, DC.list[subK].items[j]); setText(L.s, '');
      boxes.push({ L, x: (_v.x * .5 + .5) * W + 10, y: (-_v.y * .5 + .5) * H - 7, o: 1, left: 1 });
    });
    for (const B of boxes) { B.w = B.L.d.offsetWidth; B.h = B.L.d.offsetHeight; B.l = B.left ? B.x : B.x - B.w / 2; B.t = B.left ? B.y : B.y - B.h; }
    for (let pass = 0; pass < 5; pass++) for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.l < B.l + B.w && B.l < A.l + A.w && A.t < B.t + B.h + 2 && B.t < A.t + A.h + 2) { const ov = (Math.min(A.t + A.h, B.t + B.h) - Math.max(A.t, B.t) + 2) / 2; if (A.t <= B.t) { A.t -= ov; B.t += ov; } else { A.t += ov; B.t -= ov; } }
    }
    for (const B of boxes) { B.L.d.style.transform = `translate3d(${Math.max(6, Math.min(W - B.w - 6, B.l)).toFixed(1)}px,${Math.max(56, Math.min(H - B.h - 6, B.t)).toFixed(1)}px,0)`; B.L.d.style.opacity = (B.o * Math.min(1, dU.uDA.value * 1.4)).toFixed(2); }
  }
  for (let i = n; i < CL.length; i++) if (CL[i].d.style.opacity !== '0') CL[i].d.style.opacity = 0;
}
// tap: outside core -> inside; inside near an agent region -> that agent; agent level near a cluster -> that task
canvas.addEventListener('pointerup', e => {
  if (!downAt || view !== 'core' || fly) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), quick = performance.now() - downAt.t < 450; downAt = null;
  if (moved > 7 || !quick) return;
  const W = innerWidth, H = innerHeight, px = e.clientX, py = e.clientY;
  const scr = p => { _v.copy(p).project(camera); return [(_v.x * .5 + .5) * W, (-_v.y * .5 + .5) * H, _v.z]; };
  if (focusId && DC) {
    let bk = -1, bd = MOBILE ? 60 : 48;
    DC.cen.forEach((c, k) => { const [x, y, z] = scr(DEEP.localToWorld(c.clone())); if (z > 1) return; const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; bk = k; } });
    if (bk >= 0 && bk !== subK) enterSub(bk); else if (bk < 0 && subK >= 0) exitSub();
    return;
  }
  if (depth === 'in') {
    let bi = -1, bd = 80;
    AGENTS.forEach((a, i) => { const [x, y] = scr(ANCH[i].clone().applyMatrix4(group.matrixWorld)); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0) enterAgent(AGENTS[bi].id);
    return;
  }
  _v.set(0, BY, 0).project(camera); const cx = (_v.x * .5 + .5) * W, cy = (-_v.y * .5 + .5) * H;
  _w.set(BR, BY, 0).project(camera); const rpx = Math.max(60, Math.abs((_w.x - _v.x) * .5 * W) * 1.25);
  if (Math.hypot(px - cx, py - cy) < rpx) setDepth('in');
});

// ================= FLOW VIEW (draggable nodes, bezier edges; values are real only) =================
const FLOW = AG.flow || { virtual: [], layout: {}, edges: [] };
const FN = {}, FE = [];
const LSKEY = 'jb4-flow-layout-v1';
let savedLayout = {}; try { savedLayout = JSON.parse(localStorage.getItem(LSKEY) || '{}'); } catch { }
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (t, at = {}) => { const e = document.createElementNS(SVGNS, t); for (const k in at) e.setAttribute(k, at[k]); return e; };
const clamp = v => Math.max(0, Math.min(1, v));
for (const m of [...FLOW.virtual.map(v => ({ ...v, virtual: true })), ...AGENTS.filter(a => FLOW.layout[a.id])]) {
  const d = el('div', 'fn' + (m.status === 'planned' ? ' planned' : '')); d.style.setProperty('--nc', m.color);
  d.innerHTML = `<div class="fh"><i></i><b>${esc(m.name)}</b><span class="badge"></span></div><div class="ft"></div><div class="fpb"><i></i></div>`;
  $('#fnodes').appendChild(d);
  const [x, y] = savedLayout[m.id] || FLOW.layout[m.id] || [0.5, 0.5];
  FN[m.id] = { m, d, x, y, E: 0, st: d.querySelector('.badge'), ft: d.querySelector('.ft'), pb: d.querySelector('.fpb i') };
  let drag = null;
  d.addEventListener('pointerdown', e => { e.preventDefault(); d.setPointerCapture(e.pointerId); drag = { ox: e.clientX, oy: e.clientY, x: FN[m.id].x, y: FN[m.id].y, r: flowRect(), moved: 0 }; d.classList.add('drag'); });
  d.addEventListener('pointermove', e => {
    if (!drag) return; const n = FN[m.id], r = drag.r;
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.ox, e.clientY - drag.oy));
    if (MOBILE) { n.y = clamp(drag.y + (e.clientX - drag.ox) / Math.max(1, r.w - r.cw)); n.x = clamp(drag.x + (e.clientY - drag.oy) / Math.max(1, r.h - r.ch)); }
    else { n.x = clamp(drag.x + (e.clientX - drag.ox) / Math.max(1, r.w - r.cw)); n.y = clamp(drag.y + (e.clientY - drag.oy) / Math.max(1, r.h - r.ch)); }
    layoutFlow();
  });
  const end = () => { if (!drag) return; d.classList.remove('drag'); if (drag.moved > 3) { savedLayout[m.id] = [+FN[m.id].x.toFixed(4), +FN[m.id].y.toFixed(4)]; try { localStorage.setItem(LSKEY, JSON.stringify(savedLayout)); } catch { } } drag = null; };
  d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
  d.addEventListener('dblclick', () => { if (IDX[m.id] != null) enterAgent(m.id); });
}
for (const [from, to, label] of FLOW.edges) {
  if (!FN[from] || !FN[to]) continue;
  const planned = FN[from].m.status === 'planned' || FN[to].m.status === 'planned', col = FN[from].m.color;
  const g = svgEl('g');
  const base = svgEl('path', { class: 'base', stroke: planned ? 'rgba(255,255,255,.14)' : col, 'stroke-opacity': planned ? 1 : 0.28, 'stroke-dasharray': planned ? '2 6' : 'none' });
  const flowL = svgEl('path', { class: 'flowl', stroke: col, 'stroke-opacity': planned ? 0.25 : 0.8 });
  const bgR = svgEl('rect', { rx: 3 }); const t = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }); t.textContent = label;
  g.append(base, flowL, bgR, t); $('#fedges').appendChild(g);
  FE.push({ from, to, label, planned, base, flowL, bgR, t, E: 0 });
}
function flowRect() {
  const W = innerWidth, H = innerHeight, cw = MOBILE ? 118 : 156, ch = MOBILE ? 46 : 92;
  return MOBILE ? { l: 10, t: 110, w: W - 20, h: H - 200, cw, ch } : { l: 60, t: 190, w: W - 120, h: H - 190 - 150, cw, ch };
}
function nodeBox(id) { const n = FN[id], r = flowRect(), nx = MOBILE ? n.y : n.x, ny = MOBILE ? n.x : n.y; return { x: r.l + r.cw / 2 + nx * (r.w - r.cw), y: r.t + r.ch / 2 + ny * (r.h - r.ch), w: r.cw, h: r.ch }; }
function layoutFlow() {
  for (const id in FN) { const b = nodeBox(id); FN[id].d.style.left = b.x + 'px'; FN[id].d.style.top = b.y + 'px'; }
  for (const e of FE) {
    const a = nodeBox(e.from), b = nodeBox(e.to), dx = b.x - a.x, dy = b.y - a.y; let d;
    if (Math.abs(dx) >= Math.abs(dy) * 0.9) { const s = Math.sign(dx) || 1, sx = a.x + s * a.w / 2, tx = b.x - s * b.w / 2, k = Math.max(40, Math.abs(tx - sx) * 0.5); d = `M${sx},${a.y} C${sx + s * k},${a.y} ${tx - s * k},${b.y} ${tx},${b.y}`; }
    else { const s = Math.sign(dy) || 1, sy = a.y + s * a.h / 2, ty = b.y - s * b.h / 2, k = Math.max(30, Math.abs(ty - sy) * 0.5); d = `M${a.x},${sy} C${a.x},${sy + s * k} ${b.x},${ty - s * k} ${b.x},${ty}`; }
    e.base.setAttribute('d', d); e.flowL.setAttribute('d', d);
    const L = e.base.getTotalLength(), mid = e.base.getPointAtLength(L / 2);
    e.t.setAttribute('x', mid.x); e.t.setAttribute('y', mid.y);
    const w = e.label.length * 6.2 + 14; e.bgR.setAttribute('x', mid.x - w / 2); e.bgR.setAttribute('y', mid.y - 8); e.bgR.setAttribute('width', w); e.bgR.setAttribute('height', 16);
  }
}
$('#freset').onclick = () => { savedLayout = {}; try { localStorage.removeItem(LSKEY); } catch { } for (const id in FN) [FN[id].x, FN[id].y] = FLOW.layout[id]; layoutFlow(); };
function flowOnEvent(ev) {
  if (FN[ev.agent]) FN[ev.agent].E = 1;
  for (const e of FE) if (e.from === ev.agent) { e.E = 1; if (ev.type === 'done' && FN[e.to]) FN[e.to].E = Math.max(FN[e.to].E, 0.7); }
}
function renderFlowCards() {
  const b = book(), s = snapFresh() ? SNAP : null;
  for (const id in FN) {
    const n = FN[id], a = AGENTS[IDX[id]];
    if (!a) {
      if (id === 'site') { setText(n.st, BADGE.live); n.st.className = 'badge live'; setText(n.ft, livePages() != null ? `${fmt(livePages())} recipes live` : n.m.role); n.pb.style.width = b ? (100 * b.dishes[0] / b.dishes[1]).toFixed(1) + '%' : '0'; n.d.title = b ? `book dishes written ${b.dishes[0]}/${b.dishes[1]}` : ''; }
      else { setText(n.st, 'OWNER'); n.st.className = 'badge'; setText(n.ft, n.m.role); n.pb.style.width = '0'; }
      continue;
    }
    const st = status(a); setText(n.st, BADGE[st]); n.st.className = 'badge ' + st;
    const last = S[id].events[S[id].events.length - 1];
    setText(n.ft, last && nowS() - last.t < 1800 ? last.text : meta(a));
    let p = 0;
    if (id === 'recipe-writer' && s && s.batches.tracked) p = s.batches.done / s.batches.tracked;
    if (id === 'planner' && b) p = b.chapters[0] / b.chapters[1];
    n.pb.style.width = (p * 100).toFixed(1) + '%'; n.pb.parentNode.style.visibility = p ? 'visible' : 'hidden';
  }
}
function tickFlow(dt, t) {
  for (const id in FN) { const n = FN[id]; n.E *= Math.exp(-dt * 0.7); const a = AGENTS[IDX[id]]; n.d.classList.toggle('hot', n.E > 0.25 || (a && status(a) === 'live')); }
  for (const e of FE) {
    e.E *= Math.exp(-dt * 0.5);
    const a = AGENTS[IDX[e.from]], E = Math.max(e.E, a && status(a) === 'live' ? 0.35 : 0);
    e.flowL.setAttribute('stroke-dashoffset', (-t * (e.planned ? 6 : 16 + E * 50) * U.uMo.value).toFixed(1));
    e.base.setAttribute('stroke-opacity', e.planned ? 1 : (0.22 + E * 0.5).toFixed(3));
  }
}
function setView(v, instant) {
  if (v === view) return;
  const d = instant ? 0.01 : 0.6;
  if (v === 'flow') {
    if (focusId) exitAgent();
    view = 'flow'; $('#flow').classList.remove('hidden'); layoutFlow(); renderFlowCards(); hideLeft();
    gsap.to(['#right', '#labels', '#leaders', '#subs', '#depth'], { autoAlpha: 0, duration: d * 0.6 });
    gsap.fromTo('#flow', { autoAlpha: 0 }, { autoAlpha: 1, duration: d });
    gsap.fromTo('.fn', { opacity: 0, y: 8 }, { opacity: (i, x) => x.classList.contains('planned') ? 0.5 : 1, y: 0, duration: d, stagger: instant ? 0 : 0.03, ease: 'power3.out', clearProps: 'transform' });
  } else {
    view = 'core';
    gsap.to('#flow', { autoAlpha: 0, duration: d, onComplete: () => $('#flow').classList.add('hidden') });
    gsap.to(['#right', '#labels', '#leaders', '#subs', '#depth'], { autoAlpha: 1, duration: d });
  }
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
}
document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.v));

// ================= FRAME LOOP =================
const perf = { level: +(Q.get('q') ?? -1), frames: [], measureFrom: 0, checks: 0 };
window.__perf = perf;
// v8: the glow is never dropped. Slow devices lose strand / dot COUNT and get a quarter-resolution bloom; bloom, halo sprites
// and the ribbons' own built-in glow always stay on.
function applyQuality(level) {
  perf.level = level;
  const f = [1, .65, .45, .3][Math.min(3, level)], ft = [1, .85, .7, .55][Math.min(3, level)];
  for (const L of [FIB, FIBI]) { const S2 = L.userData.seg * 2; L.geometry.setDrawRange(0, Math.floor(L.userData.count * f / S2) * S2); }
  TEND.geometry.setDrawRange(0, Math.floor(TEND.userData.np * ft) * TEND.userData.per);
  PTS.geometry.setDrawRange(0, Math.floor(PTS.userData.count * [1, .85, .7, .55][Math.min(3, level)]));
  useBloom = true;
  if (level >= 2 && DPR > 1) { DPR = 1; renderer.setPixelRatio(1); composer.setPixelRatio(1); U.uPR.value = 1; }
  if (level >= 2 && BDIV !== 4) BDIV = 4;
  resize();
}
if (perf.level >= 0) applyQuality(perf.level);
function adapt(now) {
  if (CAPTURE || Q.get('adaptive') === '0' || perf.level >= 3 || perf.checks >= 3) return;
  if (!perf.measureFrom) { perf.measureFrom = now + 600; return; }
  if (now < perf.measureFrom) return;
  perf.frames.push(now);
  if (now - perf.measureFrom >= 2000) {
    const fps = (perf.frames.length - 1) / ((perf.frames[perf.frames.length - 1] - perf.frames[0]) / 1000);
    perf.checks++; (perf.log = perf.log || []).push(+fps.toFixed(1));
    if (fps < 55) applyQuality(Math.max(0, perf.level) + 1);
    perf.frames = []; perf.measureFrom = now + 400;
  }
}
let secAcc = 0;
function frame(dt) {
  const t = simMs / 1000; U.uT.value = t;
  // per-agent intensity from REAL status; pulses from real events; particle speed integrated on the CPU
  AGENTS.forEach((a, i) => {
    const st = status(a), tgt = { live: 1, wait: 0.42, idle: 0.2, planned: 0.07 }[st];
    ACT[i] += (tgt - ACT[i]) * (1 - Math.exp(-dt * 1.5));
    PULSE[i] *= Math.exp(-dt * 0.9);
    AT[i] += dt * (0.55 + ACT[i] * 1.3 + PULSE[i] * 2.6) * U.uMo.value;
    U.uAct.value[i] = ACT[i]; U.uPulse.value[i] = PULSE[i]; U.uAT.value[i] = AT[i];
  });
  const bt = tickSubs();
  beamV += (bt - beamV) * (1 - Math.exp(-dt * (bt > beamV ? 6 : 1.4)));
  const pulse = bt ? 0.82 + 0.18 * Math.sin(t * 9) : 1;
  beam.material.uniforms.uBeam.value = beamV * pulse; core.material.uniforms.uBeam.value = beamV;
  const M = U.uM.value;
  const O = 1 - M, wv = 0.5 + 0.5 * Math.sin(t * 0.7);
  halo.material.opacity = (0.42 + ACT[0] * 0.08 + beamV * 0.25 + PULSE[0] * 0.15) * O;
  burst.material.opacity = (0.62 + 0.08 * wv + beamV * 0.15) * O * (1 - U.uDeep.value * 0.6); burst.material.rotation = t * 0.012;
  burst.scale.set(BR * (2.3 + 0.1 * wv), BR * (3.0 + 0.12 * wv), 1);
  haloWide.material.opacity = (0.32 + 0.08 * wv) * O * (1 - U.uDeep.value * 0.5);
  wpalJS(t * 0.035 + 0.1, haloWide.material.color); halo.material.color.copy(haloWide.material.color).lerp(WHITE, 0.35);
  haloIn.material.opacity = (0.16 + ACT[0] * 0.05 + beamV * 0.2 + PULSE[0] * 0.1) * M;
  U.uWo.value = 1 - M; U.uWi.value = M; FIB.visible = TEND.visible = TEND.userData.tips.visible = M < 0.999; FIBI.visible = TIPS.visible = M > 0.001;
  bloom.strength = BLOOM_OUT[0] + (BLOOM_IN[0] - BLOOM_OUT[0]) * M; bloom.radius = BLOOM_OUT[1] + (BLOOM_IN[1] - BLOOM_OUT[1]) * M; bloom.threshold = BLOOM_OUT[2] + (BLOOM_IN[2] - BLOOM_OUT[2]) * M;
  if (fly) flyStep(); else controls.update(dt * U.uMo.value);
  if (view === 'core') { placeLabels(); placeDeep(); } else tickFlow(dt, t);
  if (useBloom) composer.render(dt); else renderer.render(scene, camera);
  secAcc += dt;
  if (secAcc >= 1) { secAcc = 0; renderTop(); tickWorkers(); tickLeft(); watchFeeds(); renderAgents(); if (focusId) renderAgentView(); if (view === 'flow') renderFlowCards(); }
}
let lastT = performance.now(), running = !document.hidden;
function loop(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; simMs += dt * 1000;
  adapt(now); frame(dt);
  requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => {
  if (CAPTURE) return;
  if (document.hidden) running = false;
  else if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(loop); connectLive(); }
});

// ================= CAPTURE HOOKS (tools_*.py) =================
if (CAPTURE) { gsap.ticker.remove(gsap.updateRoot); gsap.updateRoot(0); }   // capture: GSAP runs on the virtual clock
window.__step = (n = 1, fps = 30) => { for (let i = 0; i < n; i++) { simMs += 1000 / fps; if (CAPTURE) gsap.updateRoot(simMs / 1000); frame(1 / fps); } };
window.__inject = ev => handle({ id: 'inj' + Math.random().toString(36).slice(2), t: nowS(), ...ev }, true);
window.__reconnect = () => { connectLive(); connectMs(); };
window.__view = v => v === 'flow' || v === 'core' ? setView(v) : enterAgent(v);
window.__exit = () => exitAgent();
window.__sub = k => k < 0 ? exitSub() : enterSub(k);
window.__up = () => goUp();
window.__deep = () => DC && ({ id: DC.id, sub: subK, list: DC.list.map(c => [c.name, c.n, c.unit, c.items.length]) });
window.__cam = () => ({ p: camera.position.toArray().map(v => +v.toFixed(2)), depth, m: +U.uM.value.toFixed(2), auto: controls.autoRotate });
window.__depth = (d, instant) => setDepth(d, instant);
window.__orbit = (az, el) => { const o = camera.position.clone().sub(controls.target); const sp = new THREE.Spherical().setFromVector3(o); sp.theta += az; sp.phi = Math.min(3.0, Math.max(0.15, sp.phi + el)); camera.position.setFromSpherical(sp).add(controls.target); controls.update(0); };
window.__left = (b, ms) => showLeft(b, ms);
window.__texts = () => [...document.querySelectorAll('#ui *, #labels *, #flow *')].filter(n => n.childNodes.length && [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()) && n.offsetParent !== null).map(n => n.textContent.trim());

// ================= START =================
renderAll(); labelSizes(); renderCrumbs();
await loadData();
connectLive(); connectMs();
setInterval(loadData, (CFG.dataRefreshSeconds || 300) * 1000);
if (!CAPTURE) requestAnimationFrame(t => { lastT = t; requestAnimationFrame(loop); });
else frame(1 / 30);
window.__ready = true;
