// Jarvis · Neural Link v4 — outside view (neural dandelion), inside view, flow view.
// Every number on this page comes from data.json (derive4.py, read-only on the real sources)
// or from reporter.py heartbeats/events. Nothing is simulated; numbers only change when the real value changes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
renderer.setClearColor(0x02040a, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(MOBILE ? 50 : 40, innerWidth / innerHeight, 0.1, 400);
const HOME = { pos: new THREE.Vector3(0, 0.35, MOBILE ? 22 : 15), look: new THREE.Vector3(0, 0, 0) };
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
  uFocus: { value: -1 }, uFocusAmt: { value: 0 }, uFib: { value: MOBILE ? 0.3 : 0.24 },
};
const SHARED = /* glsl */`
uniform float uT, uMo, uPR, uFocusAmt, uFib; uniform float uAct[${NA}], uPulse[${NA}], uAT[${NA}]; uniform int uFocus;
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
  return I;
}
float backDim(vec3 p){
  vec4 mv = modelViewMatrix * vec4(p, 1.0); vec4 mc = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float d = length(mv.xy - mc.xy);
  float disc = mix(0.18, 1.0, smoothstep(1.0, 2.1, d));
  return mix(0.22, 1.0, smoothstep(-3.5, 2.5, mv.z - mc.z)) * disc;
}`;

// ---- fibres: one merged LineSegments geometry, animated in the vertex shader ----
const NF = MOBILE ? 1150 : 2500, SEG = MOBILE ? 12 : 18;
const fibres = [];
for (let f = 0; f < NF; f++) {
  const d = randDir(); const [si, k] = nearest(d);
  const st = THREE.MathUtils.smoothstep(k, 0.35, 0.85);
  const hero = rnd() < 0.16;
  const len = (hero ? 3.2 : 1.6) + Math.pow(rnd(), 0.8) * (hero ? 2.8 : 2.6);
  let b = new V3().crossVectors(d, randDir()).normalize();
  const base = new THREE.Color(0xd8f2ff).lerp(new THREE.Color(0xb9c4ff), Math.max(0, -d.x) * 0.35);
  const col = base.clone().lerp(SECT[si].col, Math.min(1, st * 1.1)).multiplyScalar(hero ? 1.3 : 0.85);
  fibres.push({ d, b, len, sd: rnd(), ai: st > 0.25 ? si : 0, col, hero, st });
}
{
  const n = NF * SEG * 2;
  const P = new Float32Array(n * 3), B = new Float32Array(n * 3), C = new Float32Array(n * 3), A = new Float32Array(n * 4);
  let v = 0;
  for (const F of fibres) for (let s = 0; s < SEG; s++) for (const t of [s / SEG, (s + 1) / SEG]) {
    P.set([F.d.x, F.d.y, F.d.z], v * 3); B.set([F.b.x, F.b.y, F.b.z], v * 3); C.set([F.col.r, F.col.g, F.col.b], v * 3);
    A.set([t, F.len, F.sd, F.ai], v * 4); v++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aBend', new THREE.BufferAttribute(B, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(C, 3)); g.setAttribute('aP', new THREE.BufferAttribute(A, 4));
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: SHARED + `
      attribute vec3 aBend, aCol; attribute vec4 aP; varying vec3 vC; varying float vA;
      void main(){
        vec3 p = fpos(position, aBend, aP.x, aP.y, aP.z);
        float I = inten(int(aP.w + 0.5));
        float t = aP.x;
        vC = mix(vec3(0.85, 0.95, 1.0), aCol, smoothstep(0.0, 0.35, t));
        vA = (0.1 + 0.5 * smoothstep(0.0, 0.55, t)) * smoothstep(1.0, 0.86, t) * I * backDim(p) * uFib;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ gl_FragColor = vec4(vC, vA); }`,
  });
  var FIB = new THREE.LineSegments(g, m); FIB.frustumCulled = false; FIB.renderOrder = 2; group.add(FIB);
  FIB.userData.count = n;
}

// ---- particles: flow outward along fibres, fade at the tips; bright heads on the hero fibres ----
const NP = MOBILE ? 2600 : 7200;
{
  const heads = fibres.filter(f => f.hero);
  const n = NP + heads.length;
  const P = new Float32Array(n * 3), B = new Float32Array(n * 3), C = new Float32Array(n * 3), A = new Float32Array(n * 4), Qa = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const head = i >= NP; const F = head ? heads[i - NP] : fibres[(rnd() * NF) | 0];
    P.set([F.d.x, F.d.y, F.d.z], i * 3); B.set([F.b.x, F.b.y, F.b.z], i * 3); C.set([F.col.r, F.col.g, F.col.b], i * 3);
    A.set([0, F.len, F.sd, F.ai], i * 4);
    Qa.set(head ? [0.985, 0, 1.6 + rnd() * 1.2, 1] : [rnd(), 0.05 + rnd() * 0.07, 0.8 + rnd() * 1.4, 0], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aBend', new THREE.BufferAttribute(B, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(C, 3)); g.setAttribute('aP', new THREE.BufferAttribute(A, 4)); g.setAttribute('aQ', new THREE.BufferAttribute(Qa, 4));
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: SHARED + `
      attribute vec3 aBend, aCol; attribute vec4 aP, aQ; varying vec3 vC; varying float vA;
      void main(){
        int ai = int(aP.w + 0.5);
        float t = aQ.w > 0.5 ? aQ.x : fract(uAT[ai] * aQ.y + aQ.x);
        vec3 p = fpos(position, aBend, t, aP.y, aP.z);
        float I = inten(ai);
        vC = mix(vec3(1.0), aCol, 0.55 + 0.45 * smoothstep(0.0, 0.4, t));
        float fade = aQ.w > 0.5 ? 0.9 : smoothstep(0.05, 0.35, t) * smoothstep(1.0, 0.62, t);
        vA = fade * I * backDim(p) * (aQ.w > 0.5 ? 0.8 : 0.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aQ.z * uPR * (1.0 + uPulse[ai] * 0.6) * 11.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(mix(vC, vec3(1.0), a * 0.5), vA * a * a); }`,
  });
  var PTS = new THREE.Points(g, m); PTS.frustumCulled = false; PTS.renderOrder = 3; group.add(PTS);
  PTS.userData.count = n; PTS.userData.np = NP;
}

// ---- node-network webs per sector ----
{
  const NN = MOBILE ? 55 : 100;
  const nodes = [], edges = [];
  for (const s of SECT) {
    if (!s.dir) continue;
    const start = nodes.length;
    const clusters = Array.from({ length: 5 }, () => s.dir.clone().add(randDir().multiplyScalar(0.48)).normalize().multiplyScalar(2.1 + rnd() * 2.0));
    for (let k = 0; k < NN; k++) {
      const c = clusters[k % clusters.length];
      const p = c.clone().add(randDir().multiplyScalar(0.15 + rnd() * 0.75));
      if (p.length() < 1.75) p.setLength(1.75 + rnd() * 0.4);
      nodes.push({ p, ai: s.i, col: s.col, sz: 0.8 + rnd() * 1.8 });
    }
    for (let a = start; a < nodes.length; a++) {
      const ds = [];
      for (let b = start; b < nodes.length; b++) if (b !== a) ds.push([nodes[a].p.distanceTo(nodes[b].p), b]);
      ds.sort((x, y) => x[0] - y[0]);
      for (const [dd, b] of ds.slice(0, 2)) if (dd < 1.05 && a < b) edges.push([a, b]);
    }
  }
  const mk = (pos, col, ai, extra) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setAttribute('aAi', new THREE.BufferAttribute(new Float32Array(ai), 1));
    if (extra) g.setAttribute('aSz', new THREE.BufferAttribute(new Float32Array(extra), 1));
    return g;
  };
  const ep = [], ec = [], ea = [];
  for (const [a, b] of edges) for (const i of [a, b]) { const N = nodes[i]; ep.push(N.p.x, N.p.y, N.p.z); ec.push(N.col.r, N.col.g, N.col.b); ea.push(N.ai); }
  const np = [], nc = [], na = [], ns = [];
  for (const N of nodes) { np.push(N.p.x, N.p.y, N.p.z); nc.push(N.col.r, N.col.g, N.col.b); na.push(N.ai); ns.push(N.sz); }
  const vs = (pt) => SHARED + `
    attribute vec3 aCol; attribute float aAi; ${pt ? 'attribute float aSz;' : ''} varying vec3 vC; varying float vA;
    void main(){
      vec3 p = position * (1.0 + 0.012 * sin(uT * 0.6 + position.x * 3.0) * uMo);
      int ai = int(aAi + 0.5); float I = inten(ai);
      vC = aCol; vA = I * backDim(p) * ${pt ? '1.8' : '0.95'};
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      ${pt ? 'gl_PointSize = aSz * uPR * (1.0 + uPulse[ai]) * 19.0 / -mv.z;' : ''}
      gl_Position = projectionMatrix * mv;
    }`;
  const lineM = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: vs(false),
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ gl_FragColor = vec4(vC, vA); }` });
  const ptM = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: vs(true),
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(mix(vC, vec3(1.0), a * 0.6), vA * a); }` });
  const L = new THREE.LineSegments(mk(ep, ec, ea), lineM); L.frustumCulled = false; L.renderOrder = 1; group.add(L);
  const Pn = new THREE.Points(mk(np, nc, na, ns), ptM); Pn.frustumCulled = false; Pn.renderOrder = 1; group.add(Pn);
}

// ---- core: dark-blue sphere with a cyan fresnel rim, soft halo ----
const core = new THREE.Mesh(new THREE.SphereGeometry(1.3, 64, 48), new THREE.ShaderMaterial({
  uniforms: { uT: U.uT, uBeam: { value: 0 }, uAct: { value: 0.5 } },
  vertexShader: `varying vec3 vN, vV, vP; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uT, uBeam, uAct; varying vec3 vN, vV, vP;
    void main(){
      float f = 1.0 - max(dot(vN, vV), 0.0);
      float rim = pow(f, 2.6);
      float band = 0.5 + 0.5 * sin(vP.y * 9.0 + uT * 0.8) * sin(vP.x * 7.0 - uT * 0.5);
      vec3 base = mix(vec3(0.001, 0.003, 0.018), vec3(0.003, 0.012, 0.06), pow(1.0 - f, 2.0));
      base += vec3(0.002, 0.012, 0.04) * band * (0.5 + uAct);
      vec3 col = base + vec3(0.2, 0.75, 1.0) * rim * (0.9 + uAct * 0.5 + uBeam * 1.5);
      col += vec3(0.5, 0.9, 1.0) * uBeam * 0.25 * pow(1.0 - abs(vP.x), 8.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
}));
core.renderOrder = 0; group.add(core);
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(200,240,255,1)'); g.addColorStop(0.25, 'rgba(120,200,255,.35)'); g.addColorStop(0.6, 'rgba(60,110,255,.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
})();
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, opacity: 0.5 }));
halo.scale.set(5.4, 5.4, 1); halo.renderOrder = 1; scene.add(halo);

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
  fragmentShader: `varying vec2 vU; void main(){ vec2 p = vU - vec2(0.48, ${MOBILE ? '0.7' : '0.5'}); p.x *= 1.5; float r = length(p);
    vec3 c = mix(vec3(0.016, 0.03, 0.075), vec3(0.002, 0.004, 0.012), smoothstep(0.0, 0.8, r)); gl_FragColor = vec4(c, 1.0); }`,
}));
bg.frustumCulled = false; bg.renderOrder = -10; scene.add(bg);

// ---- post: half-resolution bloom ----
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), MOBILE ? 0.85 : 0.9, 0.5, 0.16);
const _bs = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => _bs(Math.max(2, w / 2), Math.max(2, h / 2));
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
const BADGE = { live: 'LIVE', wait: 'WAITING', idle: 'IDLE', planned: 'PLANNED' };
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
  const anchor = a.core ? new V3(-0.55, -0.62, 0.62) : new V3(...a.sector).normalize().multiplyScalar(MOBILE ? 3.1 : 2.75);
  return { a, i, d, sub: d.querySelector('span'), line, dot, anchor, w: 0, h: 0 };
});
function labelSizes() { for (const L of LBL) { L.w = L.d.offsetWidth; L.h = L.d.offsetHeight; } }
const _v = new V3();
let labelsOn = 1;
function placeLabels() {
  const W = innerWidth, H = innerHeight;
  const cx = W * (MOBILE ? 0.5 : 0.455), cy = H * (MOBILE ? 0.3 : 0.485);
  const lr = leftShown && !MOBILE ? $('#left').getBoundingClientRect() : null;
  for (const L of LBL) {
    const show = labelsOn && (focusId == null || focusId === L.a.id);
    if (!show) { if (L.vis !== 0) { L.d.style.opacity = 0; L.line.style.opacity = 0; L.dot.style.opacity = 0; L.vis = 0; } continue; }
    if (L.vis !== 1) { L.hid = false; L.d.style.opacity = 1; L.line.style.opacity = 1; L.dot.style.opacity = 1; L.vis = 1; }
    _v.copy(L.anchor).applyMatrix4(group.matrixWorld).project(camera);
    const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
    let dx = x - cx, dy = y - cy; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const out = MOBILE ? 22 : 46;
    let bx = x + dx * out, by = y + dy * out;
    const right = L.a.core ? false : dx >= -0.15;
    let left = right ? bx : bx - L.w;
    let top = by - L.h / 2;
    left = Math.max(10, Math.min(W - L.w - 10, left)); top = Math.max(60, Math.min(H - L.h - 10, top));
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
    setText(LBL[i].sub, meta(a)); LBL[i].d.classList.toggle('hot', st === 'live');
  });
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
    return `<h3><span>[ TONIGHT ]</span><em>RECIPES WRITTEN</em></h3>
      ${row('Recipes written tonight', fmt(t.n), t.first ? `${fmt(t.batches)} batches · ${esc(t.first)}–${esc(t.last)} Cairo` : 'no batch logged yet')}
      ${(t.recent || []).slice(0, 4).map(r => row(`Batch ${esc(r[1])}`, fmt(r[2]), esc(r[0]) + ' Cairo', 'recipes')).join('')}
      ${livePages() != null ? row('Recipes live on the site', fmt(livePages()), 'public sitemap.xml') : ''}
      <div class="src">rw/manual_progress.log · one line per finished batch</div>`;
  }
  if (k === 'book') {
    if (!b) return '';
    const src = s && s.book ? 'live from reporter.py (recounted when the site changes)' : `derived ${R ? hm(Date.parse(R.at) / 1000) : '–'} Cairo`;
    return `<h3><span>[ SUMMARY ]</span><em>THE BOOK</em></h3>
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
    return `<h3><span>[ QUEUE ]</span><em>DRAFTING</em></h3>
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
    return `<h3><span>[ OUTPUT ]</span><em>${k === 'days' ? '7 DAYS' : 'LAST 24 H'}</em></h3>
      ${row(k === 'days' ? 'Recipe pages added · 7 days' : 'Recipe pages added · 24 h', fmt(tot))}
      <div class="chart ${k === 'hours' ? 'h' : ''}">${bars}</div>
      <div class="src">first git commit that added each recipe file · derived ${hm(Date.parse(R.at) / 1000)} Cairo</div>`;
  }
  if (k === 'site') {
    if (!R) return '';
    const cs = commitsL().slice(0, 5), s2 = snapFresh() ? SNAP : null;
    return `<h3><span>[ PUBLISH ]</span><em>SITE COMMITS</em></h3>
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

function renderTop() {
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
const camTween = { p: HOME.pos.clone(), l: HOME.look.clone() };
const rot = { y: 0, t: 0, on: 1 };
function sectorWorld(a, r) { return a.core ? new V3(0, 0, 0) : new V3(...a.sector).normalize().multiplyScalar(r).applyMatrix4(group.matrixWorld); }
function enterAgent(id) {
  const a = AGENTS[IDX[id]]; if (!a) return;
  if (view === 'flow') setView('core', true);
  focusId = id; rot.on = 0; hideLeft();
  const tgt = sectorWorld(a, 2.4);
  const dir = a.core ? new V3(0, 0.15, 1) : tgt.clone().normalize().multiplyScalar(0.7).add(new V3(0, 0.1, 1)).normalize();
  const pos = a.core ? new V3(0, 0.6, MOBILE ? 10 : 7.2) : dir.multiplyScalar(MOBILE ? 13 : 9.6).add(tgt.clone().multiplyScalar(0.25));
  const look = a.core ? new V3(0, 0, 0) : tgt.clone().multiplyScalar(MOBILE ? 0.55 : 0.75);
  if (!MOBILE && !a.core) look.add(new V3(-1.6, 0, 0));   // keep the sector right of the panel
  gsap.to(camTween.p, { x: pos.x, y: pos.y, z: pos.z, duration: 1.6, ease: 'power3.inOut' });
  gsap.to(camTween.l, { x: look.x, y: look.y, z: look.z, duration: 1.6, ease: 'power3.inOut' });
  U.uFocus.value = IDX[id]; gsap.to(U.uFocusAmt, { value: 1, duration: 1.2 });
  gsap.to(['#right'], { autoAlpha: 0, duration: 0.4 });
  const P = $('#agentview'); P.classList.remove('hidden'); renderAgentView();
  gsap.fromTo(P, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.8, delay: 0.5, ease: 'power3.out' });
}
function exitAgent() {
  if (!focusId) return; focusId = null; rot.on = 1;
  gsap.to(camTween.p, { x: HOME.pos.x, y: HOME.pos.y, z: HOME.pos.z, duration: 1.4, ease: 'power3.inOut' });
  gsap.to(camTween.l, { x: 0, y: 0, z: 0, duration: 1.4, ease: 'power3.inOut' });
  gsap.to(U.uFocusAmt, { value: 0, duration: 1, onComplete: () => { if (!focusId) U.uFocus.value = -1; } });
  gsap.to(['#right'], { autoAlpha: 1, duration: 0.6, delay: 0.6 });
  const P = $('#agentview'); gsap.to(P, { opacity: 0, duration: 0.35, onComplete: () => { if (!focusId) P.classList.add('hidden'); } });
}
$('#back').onclick = exitAgent;
addEventListener('keydown', e => { if (e.key === 'Escape') { if (focusId) exitAgent(); else if (view === 'flow') setView('core'); } });
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
  setHTML($('#av-feed'), ev.slice(-25).reverse().map(e => `<li><time>${hm(e.t)}</time><span>${esc(e.text)}</span></li>`).join('') || '<li><span>No real events in the last 12 h.</span></li>');
}

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
    gsap.to(['#right', '#labels', '#leaders', '#subs'], { autoAlpha: 0, duration: d * 0.6 });
    gsap.fromTo('#flow', { autoAlpha: 0 }, { autoAlpha: 1, duration: d });
    gsap.fromTo('.fn', { opacity: 0, y: 8 }, { opacity: (i, x) => x.classList.contains('planned') ? 0.5 : 1, y: 0, duration: d, stagger: instant ? 0 : 0.03, ease: 'power3.out', clearProps: 'transform' });
  } else {
    view = 'core';
    gsap.to('#flow', { autoAlpha: 0, duration: d, onComplete: () => $('#flow').classList.add('hidden') });
    gsap.to(['#right', '#labels', '#leaders', '#subs'], { autoAlpha: 1, duration: d });
  }
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
}
document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.v));

// ================= FRAME LOOP =================
const perf = { level: +(Q.get('q') ?? -1), frames: [], measureFrom: 0, checks: 0 };
window.__perf = perf;
function applyQuality(level) {
  perf.level = level;
  const f = level >= 2 ? 0.45 : level >= 1 ? 0.65 : 1;
  FIB.geometry.setDrawRange(0, Math.floor(FIB.userData.count * f / (SEG * 2)) * SEG * 2);
  PTS.geometry.setDrawRange(0, Math.floor(PTS.userData.count * f));
  useBloom = level < 2;
  if (level >= 2 && DPR > 1) { DPR = 1; renderer.setPixelRatio(1); composer.setPixelRatio(1); resize(); U.uPR.value = 1; }
}
if (perf.level >= 0) applyQuality(perf.level);
function adapt(now) {
  if (CAPTURE || Q.get('adaptive') === '0' || perf.level >= 2 || perf.checks >= 2) return;
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
  core.material.uniforms.uAct.value = ACT[0] + PULSE[0];
  halo.material.opacity = 0.32 + ACT[0] * 0.1 + beamV * 0.3 + PULSE[0] * 0.15;
  if (rot.on) rot.t += dt * U.uMo.value;
  group.rotation.y = Math.sin(rot.t * 0.05) * 0.44;
  group.rotation.x = Math.sin(rot.t * 0.031) * 0.05;
  camera.position.copy(camTween.p); camera.lookAt(camTween.l);
  group.updateMatrixWorld();
  if (view === 'core') placeLabels(); else tickFlow(dt, t);
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
window.__left = (b, ms) => showLeft(b, ms);
window.__texts = () => [...document.querySelectorAll('#ui *, #labels *, #flow *')].filter(n => n.childNodes.length && [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()) && n.offsetParent !== null).map(n => n.textContent.trim());

// ================= START =================
renderAll(); labelSizes();
await loadData();
connectLive(); connectMs();
setInterval(loadData, (CFG.dataRefreshSeconds || 300) * 1000);
if (!CAPTURE) requestAnimationFrame(t => { lastT = t; requestAnimationFrame(loop); });
else frame(1 / 30);
window.__ready = true;
