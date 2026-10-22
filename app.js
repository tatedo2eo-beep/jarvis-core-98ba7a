// Jarvis Board v3 · live AI command centre. three.js + UnrealBloom + GSAP, events from ntfy.sh SSE.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const MOBILE = matchMedia('(max-width:860px)').matches || /Mobi|Android|iPhone/i.test(navigator.userAgent);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches || Q.has('reduced');
const MOTION = REDUCED ? 0 : 1;
const DUR = REDUCED ? 0.05 : 1;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const fmt = n => Number(n).toLocaleString('en-US');
const hhmm = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });

// ---------- sim clock (real time, or stepped frame by frame for ?capture recordings) ----------
let simMs = 0;
const T = () => simMs / 1000;
if (CAPTURE) { gsap.ticker.remove(gsap.updateRoot); }
gsap.ticker.lagSmoothing(0);

// ---------- load config ----------
const [CFG, AG] = await Promise.all([fetch('config.json').then(r => r.json()), fetch('agents.json').then(r => r.json())]);
let DATA = null;
const AGENTS = AG.agents;
const BYID = Object.fromEntries(AGENTS.map(a => [a.id, a]));
const CORE = AGENTS.find(a => a.core) || AGENTS[0];
const SATS = AGENTS.filter(a => a !== CORE);
$('#agcount').textContent = AGENTS.length;
$('#topicshort').textContent = CFG.topic.slice(0, 18) + '…';

// per-agent live state
const S = {};
for (const a of AGENTS) S[a.id] = { task: null, progress: null, lastAt: 0, lastType: null, feed: [], results: [], metrics: {}, events: [], E: 0,
  fire: a.regions.map(() => 0.1), boost: a.regions.map(() => 0), activeRegion: -1 };

// ---------- renderer ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const PR = Math.min(devicePixelRatio || 1, MOBILE ? 1.25 : 1.5);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 500);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.0, 0.7, 0.08);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.06; controls.enablePan = false;
controls.minDistance = 4.5; controls.maxDistance = 18; controls.autoRotate = !REDUCED; controls.autoRotateSpeed = 0.55;
controls.enabled = false;

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,.75)'); gr.addColorStop(0.45, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); return t;
}
const GLOW = glowTex();
const sprite = (color, size, opacity = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(size); return s; };
const COL = { cy: new THREE.Color('#3df2ff'), mg: new THREE.Color('#ff3df0'), yl: new THREE.Color('#ffe93d'), bl: new THREE.Color('#3d7bff') };
const U = { uT: { value: 0 } };   // shared time uniform

// =====================================================================================
// OUTSIDE: core + orbital network
// =====================================================================================
const outer = new THREE.Group(); scene.add(outer);
const net = new THREE.Group(); outer.add(net);
let globalE = 0.15;

// starfield
{
  const n = MOBILE ? 1200 : 2600, p = new Float32Array(n * 3), s = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 110); p.set([v.x, v.y, v.z], i * 3); s[i] = Math.random(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  const m = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aS; uniform float uT; varying float vA; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; vA=.25+.75*pow(.5+.5*sin(uT*(.5+aS*2.)+aS*90.),3.); gl_PointSize=(1.+aS*1.8); }`,
    fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vec3(.55,.75,1.)*vA*smoothstep(.5,.0,d)*.8,1.); }` });
  scene.add(new THREE.Points(g, m));
}

// radar floor
const radar = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), new THREE.ShaderMaterial({
  uniforms: { uT: U.uT, uE: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vU; void main(){ vU=uv*2.-1.; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec2 vU; uniform float uT,uE;
  void main(){ float r=length(vU)*22.; float a=atan(vU.y,vU.x);
    float ring=smoothstep(.06,.0,abs(fract(r/2.2)-.5)*2.2-0.)*0.; 
    float rr=abs(fract(r/2.2+.5)-.5); float rings=smoothstep(.035,0.,rr)*.55;
    float spokes=smoothstep(.012,0.,abs(fract(a/6.2832*24.)-.5)/24.*r*.9)*.18*step(3.,r);
    float sw=fract((a/6.2832)+uT*.07); float sweep=(pow(sw,60.)*.9+pow(sw,8.)*.12)*smoothstep(17.,2.5,r)*step(2.4,r);
    float fade=smoothstep(21.,3.,r)*smoothstep(1.2,3.,r);
    vec3 c=vec3(.15,.75,1.)*(rings+spokes)+vec3(.2,1.,.85)*sweep;
    gl_FragColor=vec4(c*fade*(.28+.45*uE),1.); }` }));
radar.rotation.x = -Math.PI / 2; radar.position.y = -3.1; outer.add(radar);

// core sphere
const coreMat = new THREE.ShaderMaterial({
  uniforms: { uT: U.uT, uE: { value: 0 }, uA: { value: COL.cy.clone() }, uB: { value: COL.mg.clone() } },
  vertexShader: `varying vec3 vN,vV,vP; void main(){ vP=position; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vN,vV,vP; uniform float uT,uE; uniform vec3 uA,uB;
  void main(){ float f=pow(1.-max(dot(vN,vV),0.),2.2);
    float b=sin(vP.y*10.+uT*1.6+sin(vP.x*6.+uT*.8)*1.8)*.5+.5;
    float n=sin(vP.x*8.+uT*2.1)*sin(vP.z*7.-uT*1.4)*sin(vP.y*9.+uT*.9);
    vec3 c=mix(uA,uB,clamp(b*.55+n*.6+.2,0.,1.));
    float core=.06+.22*b*(.3+uE)+max(n,0.)*.55*uE;
    float lat=smoothstep(.93,1.,abs(sin(vP.y*14.+uT*.6)))*.35+smoothstep(.95,1.,abs(sin(atan(vP.z,vP.x)*9.-uT*.4)))*.25;
    gl_FragColor=vec4(c*(core+lat*(.4+uE)+f*(.6+2.2*uE))+vec3(1.)*pow(f,6.)*uE*.8,1.); }` });
const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 24), coreMat); net.add(coreMesh);
const coreGlow = sprite(0x9ff6ff, 6.5, 0.5); outer.add(coreGlow);
const coreHot = sprite(0xffffff, 2.0, 0.85); outer.add(coreHot);
const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.55, 1)),
  new THREE.LineBasicMaterial({ color: 0x3df2ff, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false }));
net.add(wire);
const wire2 = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.OctahedronGeometry(1.9, 0)),
  new THREE.LineBasicMaterial({ color: 0xff3df0, transparent: true, opacity: .25, blending: THREE.AdditiveBlending, depthWrite: false }));
net.add(wire2);

// dashed HUD rings around the core
function dashRing(r, color, dashes, speed, duty = .5, op = .8) {
  const n = 360, p = new Float32Array(n * 3), a = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; p.set([Math.cos(t) * r, 0, Math.sin(t) * r], i * 3); a[i] = i / n; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aA', new THREE.BufferAttribute(a, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { uT: U.uT, uC: { value: new THREE.Color(color) }, uE: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aA; varying float vA; void main(){ vA=aA; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying float vA; uniform float uT,uE; uniform vec3 uC; void main(){ float d=step(fract(vA*${dashes.toFixed(1)}+uT*${speed.toFixed(3)}),${duty.toFixed(2)}); gl_FragColor=vec4(uC*d*(${op.toFixed(2)})*(.45+uE*.9),1.); }` });
  return new THREE.LineLoop(g, m);
}
const rings = [
  [2.35, '#3df2ff', 90, .02, .55, .9, [1.2, 0, .2]], [2.75, '#ff3df0', 24, -.015, .7, .7, [1.35, .4, 0]],
  [3.25, '#ffe93d', 160, .01, .25, .6, [1.05, -.3, .3]], [4.2, '#3d7bff', 60, -.006, .5, .45, [Math.PI / 2, 0, 0]]
].map(([r, c, d, s, du, op, rot]) => { const l = dashRing(r, c, d, s, du, op); l.rotation.set(...rot); outer.add(l); return l; });

// halo particle shell
const halo = (() => {
  const n = MOBILE ? 1500 : 4200, p = new Float32Array(n * 3), s = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(1.7 + Math.pow(Math.random(), 2) * 2.6); p.set([v.x, v.y * .8, v.z], i * 3); s[i] = Math.random(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { uT: U.uT, uE: { value: 0 }, uPR: { value: PR } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aS; uniform float uT,uE,uPR; varying float vA; varying vec3 vC;
    void main(){ float r=length(position.xz); float a=uT*(.25/(r*.5+.3))*(1.+uE*2.)+aS*.0; float c=cos(a),s=sin(a);
      vec3 p=vec3(position.x*c-position.z*s, position.y+sin(uT+aS*30.)*.05, position.x*s+position.z*c);
      p*=1.+uE*.25*sin(uT*3.+aS*20.);
      vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
      vA=(.25+.6*pow(.5+.5*sin(uT*2.+aS*60.),4.))*(.5+uE*1.2); vC=mix(vec3(.24,.95,1.),vec3(1.,.24,.94),step(.82,aS));
      gl_PointSize=(1.2+aS*2.4)*uPR*(14./-mv.z); }`,
    fragmentShader: `varying float vA; varying vec3 vC; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vC*vA*smoothstep(.5,0.,d),1.); }` });
  const pts = new THREE.Points(g, m); net.add(pts); return pts;
})();

// orbital dust ring (the agents ride on it)
const ORBIT_R = MOBILE ? 5.2 : 5.5;
const dust = (() => {
  const n = MOBILE ? 1600 : 4000, p = new Float32Array(n * 3), s = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = ORBIT_R + (Math.random() - .5) * (Math.random() < .2 ? 2.2 : .5); p.set([Math.cos(a) * r, (Math.random() - .5) * .25, Math.sin(a) * r], i * 3); s[i] = Math.random(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { uT: U.uT, uE: { value: 0 }, uPR: { value: PR } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aS; uniform float uT,uE,uPR; varying float vA; varying float vS;
    void main(){ float a=uT*(.03+aS*.03)*(1.+uE*3.); float c=cos(a),s=sin(a); vec3 p=vec3(position.x*c-position.z*s,position.y,position.x*s+position.z*c);
      vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; vS=aS; vA=(.18+.5*pow(.5+.5*sin(uT*1.5+aS*80.),6.))*(.6+uE);
      gl_PointSize=(1.+aS*1.6)*uPR*(16./-mv.z); }`,
    fragmentShader: `varying float vA; varying float vS; void main(){ float d=length(gl_PointCoord-.5); vec3 c=mix(vec3(.24,.48,1.),vec3(.24,.95,1.),vS); gl_FragColor=vec4(c*vA*smoothstep(.5,0.,d),1.); }` });
  const pts = new THREE.Points(g, m); pts.rotation.z = .08; net.add(pts); return pts;
})();

// beams: core -> agent, multi-strand glowing curves with travelling pulses
const beamMat = (color, off) => new THREE.ShaderMaterial({
  uniforms: { uT: U.uT, uE: { value: 0 }, uB: { value: 1 }, uC: { value: new THREE.Color(color) }, uO: { value: off } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute float aT; varying float vT; void main(){ vT=aT; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying float vT; uniform float uT,uE,uB,uO; uniform vec3 uC;
  void main(){ float p=fract(vT*1.5-uT*(.22+uE*1.1)+uO); float head=smoothstep(.0,.04,p)*smoothstep(.2,.04,p);
    float shimmer=.6+.4*sin(vT*60.-uT*8.+uO*10.);
    vec3 base=mix(vec3(.24,.95,1.),uC,smoothstep(.0,.7,vT));
    float a=uB*(.07+.16*uE)*shimmer + head*(.18*uB+1.6*uE);
    gl_FragColor=vec4(base*a,1.); }` });
const NODES = {};
const tmpV = new THREE.Vector3();
SATS.forEach((a, i) => {
  const ang = i / SATS.length * Math.PI * 2 + .3;
  const r = ORBIT_R + (i % 2 ? .45 : -.3);
  const pos = new THREE.Vector3(Math.cos(ang) * r, Math.sin(i * 2.1) * 1.0, Math.sin(ang) * r);
  const planned = a.status === 'planned';
  const col = new THREE.Color(a.color);
  const g = new THREE.Group(); g.position.copy(pos); net.add(g);
  const mat = new THREE.MeshBasicMaterial({ color: col.clone() });
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(.2, 3), mat); g.add(ball);
  const glow = sprite(col, 1.9, .5); g.add(glow);
  const ringN = dashRing(.42, a.color, 12, .06, .55, .9); ringN.rotation.x = Math.PI / 2; g.add(ringN);
  const ringN2 = dashRing(.58, a.color, 40, -.03, .3, .6); ringN2.rotation.set(1.1, .3, 0); g.add(ringN2);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.75, 8, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
  hit.userData.id = a.id; g.add(hit);
  // satellites = the agent's regions (tasks / skills)
  const satG = new THREE.Group(); satG.rotation.set(Math.random() * 1.2, 0, Math.random() * .8); g.add(satG);
  const lp = [];
  const sats = a.regions.map((rg, k) => {
    const t = k / a.regions.length * Math.PI * 2, rr = .85 + (k % 2) * .18;
    const sp = new THREE.Vector3(Math.cos(t) * rr, (k % 2 ? .12 : -.12), Math.sin(t) * rr);
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(.05, 1), new THREE.MeshBasicMaterial({ color: col })); s.position.copy(sp); satG.add(s);
    const sg = sprite(col, .45, .5); sg.position.copy(sp); satG.add(sg);
    lp.push(0, 0, 0, sp.x, sp.y, sp.z); return { s, sg };
  });
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
  const satLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false }));
  satG.add(satLines);
  // beam strands
  const start = pos.clone().normalize().multiplyScalar(1.2);
  const strands = [];
  for (let k = 0; k < 3; k++) {
    const mid = start.clone().add(pos).multiplyScalar(.5);
    mid.y += 1.2 + k * .35; mid.add(new THREE.Vector3(-pos.z, 0, pos.x).normalize().multiplyScalar((k - 1) * .55));
    const curve = new THREE.QuadraticBezierCurve3(start, mid, pos.clone());
    const pts = curve.getPoints(90); const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(pts.map((_, j) => j / 90)), 1));
    const m = beamMat(a.color, k * .33); const line = new THREE.Line(geo, m); net.add(line);
    strands.push({ curve, m });
  }
  NODES[a.id] = { a, g, ball, mat, glow, ringN, ringN2, hit, satG, sats, satLines, strands, col, planned, pos };
});
const HITS = Object.values(NODES).map(n => n.hit);

// packets travelling along beams + spark bursts + shockwaves
const packets = [];
function sendPackets(id, n = 6, inbound = false) {
  const N = NODES[id]; if (!N) return;
  for (let i = 0; i < n; i++) {
    const sp = sprite(N.col, .55, 1); net.add(sp);
    packets.push({ sp, curve: N.strands[i % 3].curve, t0: T() + i * .09, dur: .95 + Math.random() * .3, inbound });
  }
}
const SPARKS = MOBILE ? 1200 : 3000;
const sparkGeo = new THREE.BufferGeometry();
const spPos = new Float32Array(SPARKS * 3), spVel = new Float32Array(SPARKS * 3), spBirth = new Float32Array(SPARKS).fill(-99), spCol = new Float32Array(SPARKS * 3);
sparkGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3)); sparkGeo.setAttribute('aV', new THREE.BufferAttribute(spVel, 3));
sparkGeo.setAttribute('aB', new THREE.BufferAttribute(spBirth, 1)); sparkGeo.setAttribute('aC', new THREE.BufferAttribute(spCol, 3));
const sparkMat = new THREE.ShaderMaterial({ uniforms: { uT: U.uT, uPR: { value: PR } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute vec3 aV,aC; attribute float aB; uniform float uT,uPR; varying float vA; varying vec3 vC;
  void main(){ float age=uT-aB; float life=1.8; vA=age<0.||age>life?0.:pow(1.-age/life,1.6); vec3 p=position+aV*(1.-exp(-age*1.6))*2.2;
    vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; vC=aC; gl_PointSize=vA>0.?(2.+3.*vA)*uPR*(14./-mv.z):0.; }`,
  fragmentShader: `varying float vA; varying vec3 vC; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vC*vA*.9*smoothstep(.5,0.,d),1.); }` });
const sparkPts = new THREE.Points(sparkGeo, sparkMat); sparkPts.frustumCulled = false; outer.add(sparkPts);
let spIdx = 0;
function burst(color, n = 260, origin = new THREE.Vector3(), spread = 1) {
  const c = new THREE.Color(color), w = new THREE.Color('#ffffff');
  for (let i = 0; i < n; i++) {
    const k = spIdx++ % SPARKS; const v = new THREE.Vector3().randomDirection().multiplyScalar((1.5 + Math.random() * 4.5) * spread);
    spPos.set([origin.x, origin.y, origin.z], k * 3); spVel.set([v.x, v.y * .7, v.z], k * 3); spBirth[k] = T() + Math.random() * .12;
    const cc = Math.random() < .2 ? w : c; spCol.set([cc.r, cc.g, cc.b], k * 3);
  }
  for (const at of ['position', 'aV', 'aB', 'aC']) sparkGeo.attributes[at].needsUpdate = true;
}
const waves = [];
function shockwave(color, scale = 9) {
  const m = new THREE.Mesh(new THREE.RingGeometry(.988, 1, 128), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  outer.add(m); waves.push({ m, t0: T(), scale });
}

// =====================================================================================
// INSIDE: particle brain
// =====================================================================================
const inner = new THREE.Group(); inner.visible = false; scene.add(inner);
const BN = MOBILE ? 9000 : (Q.get('n') ? +Q.get('n') : 26000);
const BR = 3.0;
const brainBase = new Float32Array(BN * 3), brainSeed = new Float32Array(BN), brainReg = new Float32Array(BN), brainStart = new Float32Array(BN * 3), brainSize = new Float32Array(BN);
let brainFold = 0;
(() => {
  const v = new THREE.Vector3();
  for (let i = 0; i < BN; i++) {
    const r0 = Math.random(); let x, y, z; brainFold = 0;
    if (r0 < .085) {           // cerebellum
      v.randomDirection(); const rr = Math.pow(Math.random(), .35);
      x = v.x * .62 * rr; y = -.62 + v.y * .3 * rr; z = -.78 + v.z * .38 * rr;
      const f = 1 + .05 * Math.sin(y * 60.); x *= f; z *= f;
    } else if (r0 < .1) {      // stem
      const t = Math.random(); x = (Math.random() - .5) * .18; y = -.55 - t * .55; z = -.35 + t * .05 + (Math.random() - .5) * .16;
    } else {
      const s = Math.random() < .5 ? -1 : 1; v.randomDirection();
      const fold = Math.sin(v.x * 9 + Math.sin(v.z * 7) * 1.5) * Math.sin(v.y * 11 + v.z * 6) ;
      const surf = Math.random() < .78 ? (0.9 + Math.random() * .1) : Math.pow(Math.random(), .5) * .88;
      const rr = surf * (1 + .11 * fold);
      let vx = v.x; if (vx * s < 0) vx *= .22;             // flat medial face
      x = s * .25 + vx * .5 * rr; y = v.y * .66 * rr; z = v.z * .98 * rr;
      brainFold = fold;
      if (y < -.3) y = -.3 + (y + .3) * .55;               // flatter base
      if (z > .2) y += .06 * (z - .2);                       // taller frontal lobe
    }
    brainBase.set([x * BR, y * BR + .35, z * BR], i * 3);
    brainSeed[i] = Math.random(); brainSize[i] = (.55 + Math.pow(Math.random(), 3) * 2.0) * (brainFold > .25 ? 1.35 : 1);
    v.randomDirection().multiplyScalar(18 + Math.random() * 30); brainStart.set([v.x, v.y, v.z], i * 3);
  }
})();
const REGION_DIRS = [[.45, .35, .95], [.95, -.25, .15], [.4, .95, -.15], [.35, .25, -1], [.5, .8, .5], [.3, -.75, -.8]];
const brainGeo = new THREE.BufferGeometry();
brainGeo.setAttribute('position', new THREE.BufferAttribute(brainBase, 3));
brainGeo.setAttribute('aStart', new THREE.BufferAttribute(brainStart, 3));
brainGeo.setAttribute('aSeed', new THREE.BufferAttribute(brainSeed, 1));
brainGeo.setAttribute('aSize', new THREE.BufferAttribute(brainSize, 1));
brainGeo.setAttribute('aReg', new THREE.BufferAttribute(brainReg, 1));
const BU = { uT: U.uT, uAsm: { value: 1 }, uPR: { value: PR }, uSel: { value: -1 }, uE: { value: 0 }, uMo: { value: MOTION },
  uFire: { value: new Array(6).fill(.1) }, uCol: { value: new Array(6).fill(0).map(() => new THREE.Color()) } };
const brainMat = new THREE.ShaderMaterial({ uniforms: BU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute vec3 aStart; attribute float aSeed,aSize,aReg; uniform float uT,uAsm,uPR,uSel,uE,uMo; uniform float uFire[6]; uniform vec3 uCol[6];
  varying vec3 vC; varying float vA;
  void main(){ int r=int(aReg+.5); float fire=uFire[r];
    float k=clamp((uAsm*1.25-aSeed*.25),0.,1.); k=1.-pow(1.-k,3.);
    vec3 p=mix(aStart,position,k);
    p+=uMo*vec3(sin(uT*1.3+aSeed*40.),cos(uT*1.1+aSeed*31.),sin(uT*.9+aSeed*23.))*(.018+.05*fire);
    float spark=pow(max(0.,sin(uT*(1.5+aSeed*5.)*(1.+fire*2.)+aSeed*120.)),14.)*(.25+fire*2.4);
    float sel=(uSel>-.5&&abs(aReg-uSel)<.5)?1.:0.; float dim=(uSel>-.5&&sel<.5)?.45:1.;
    vC=mix(uCol[r]*(1.15+.3*fire),vec3(1.),spark*.35); float sh=mix(.08,1.15,smoothstep(.5,.9,length(position*vec3(1.6,1.45,1.))/${BR.toFixed(2)}));
    vA=(.2+.55*fire+spark*.8+sel*.3)*dim*(.35+.65*k)*sh;
    vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
    gl_PointSize=aSize*(1.+spark*1.4+sel*.4)*uPR*(9./-mv.z); }`,
  fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-.5); if(d>.5)discard; float a=smoothstep(.5,.0,d); gl_FragColor=vec4(vC*vA*a*a*1.05,1.); }` });
const brain = new THREE.Points(brainGeo, brainMat); brain.frustumCulled = false; inner.add(brain);
const brainGlow = sprite(0x88aaff, 9, .025); brainGlow.position.y = .4; inner.add(brainGlow);
let synapse = null, arcs = null, regionAnchors = [], regionCounts = [];
const innerRings = [[5.2, '#3df2ff', 120, .01, .4, .5, [Math.PI / 2, 0, 0]], [5.8, '#ff3df0', 30, -.01, .6, .35, [Math.PI / 2 + .25, .2, 0]]]
  .map(([r, c, d, s, du, op, rot]) => { const l = dashRing(r, c, d, s, du, op); l.rotation.set(...rot); inner.add(l); return l; });

function buildBrain(agent) {
  const K = agent.regions.length;
  const dirs = REGION_DIRS.slice(0, K).map(d => new THREE.Vector3(...d).normalize());
  regionCounts = new Array(K).fill(0);
  const sums = dirs.map(() => new THREE.Vector3()), sn = new Array(K).fill(0);
  const v = new THREE.Vector3();
  for (let i = 0; i < BN; i++) {
    v.set(Math.abs(brainBase[i * 3]) / (BR * .9), (brainBase[i * 3 + 1] - .35) / (BR * .66), brainBase[i * 3 + 2] / BR).normalize();
    let best = 0, bd = 1e9; for (let k = 0; k < K; k++) { const d = v.distanceToSquared(dirs[k]); if (d < bd) { bd = d; best = k; } }
    brainReg[i] = best; regionCounts[best]++;
    const side = best % 2 ? -1 : 1;
    if (brainBase[i * 3] * side > 0) { sums[best].add(v.set(brainBase[i * 3], brainBase[i * 3 + 1], brainBase[i * 3 + 2])); sn[best]++; }
  }
  brainGeo.attributes.aReg.needsUpdate = true;
  regionAnchors = sums.map((s, k) => { const c = s.divideScalar(Math.max(1, sn[k])); const o = c.clone().sub(new THREE.Vector3(0, .35, 0)); return c.add(o.normalize().multiplyScalar(.9)); });
  const pal = agentPalette(agent);
  pal.forEach((c, k) => BU.uCol.value[k].set(c));
  // synapse segments within regions
  if (synapse) { inner.remove(synapse); synapse.geometry.dispose(); }
  const per = MOBILE ? 50 : 140, segP = [], segR = [], segS = [], segT = [];
  const byReg = Array.from({ length: K }, () => []);
  for (let i = 0; i < BN; i += 3) byReg[brainReg[i]].push(i);
  for (let k = 0; k < K; k++) for (let j = 0; j < per; j++) {
    const L = byReg[k]; if (L.length < 2) break; const a = L[(Math.random() * L.length) | 0];
    let b = a, tries = 0; while (tries++ < 30) { const c = L[(Math.random() * L.length) | 0]; const dx = brainBase[a * 3] - brainBase[c * 3], dy = brainBase[a * 3 + 1] - brainBase[c * 3 + 1], dz = brainBase[a * 3 + 2] - brainBase[c * 3 + 2]; if (dx * dx + dy * dy + dz * dz < .9) { b = c; break; } }
    if (b === a) continue; const s = Math.random();
    for (const [idx, t] of [[a, 0], [b, 1]]) { segP.push(brainBase[idx * 3], brainBase[idx * 3 + 1], brainBase[idx * 3 + 2]); segR.push(k); segS.push(s); segT.push(t); }
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(segP, 3));
  sg.setAttribute('aReg', new THREE.Float32BufferAttribute(segR, 1)); sg.setAttribute('aSeed', new THREE.Float32BufferAttribute(segS, 1)); sg.setAttribute('aT', new THREE.Float32BufferAttribute(segT, 1));
  synapse = new THREE.LineSegments(sg, new THREE.ShaderMaterial({ uniforms: BU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aReg,aSeed,aT; uniform float uT,uAsm; uniform float uFire[6]; uniform vec3 uCol[6]; varying vec3 vC; varying float vA,vT,vS,vF;
    void main(){ int r=int(aReg+.5); vF=uFire[r]; vC=uCol[r]; vT=aT; vS=aSeed; vA=smoothstep(.85,1.,uAsm); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uT; varying vec3 vC; varying float vA,vT,vS,vF;
    void main(){ float cyc=fract(uT*(.25+vS*.6)*(1.+vF*2.)+vS*7.); float head=smoothstep(.12,0.,abs(vT-cyc*1.4+.2));
      float on=step(.55-vF*.5,fract(vS*13.7)); gl_FragColor=vec4(mix(vC,vec3(1.),head*.5)*(.05+head*1.3*on)*(.4+vF)*vA,1.); }` }));
  synapse.frustumCulled = false; inner.add(synapse);
  // arcs between region anchors
  if (arcs) { arcs.forEach(a => { inner.remove(a.line); a.line.geometry.dispose(); }); }
  arcs = [];
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
    const a = regionAnchors[i].clone().multiplyScalar(.82), b = regionAnchors[j].clone().multiplyScalar(.82);
    const mid = a.clone().add(b).multiplyScalar(.5); mid.add(mid.clone().sub(new THREE.Vector3(0, .35, 0)).normalize().multiplyScalar(1.4));
    const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(60); const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(pts.map((_, q) => q / 60)), 1));
    const m = beamMat(pal[j], Math.random()); m.uniforms.uB.value = .5; const line = new THREE.Line(geo, m); inner.add(line); arcs.push({ line, m, i, j });
  }
  buildRegionLabels(agent);
}
function agentPalette(agent) {
  const base = new THREE.Color(agent.color);
  const neon = ['#3df2ff', '#ff3df0', '#ffe93d', '#3d7bff', '#7dff3d', '#ff8a3d'];
  const out = [agent.color]; for (const n of neon) if (out.length < agent.regions.length && n.toLowerCase() !== agent.color.toLowerCase()) out.push(n);
  if (agent.status === 'planned') return out.map(c => '#' + new THREE.Color(c).lerp(new THREE.Color('#8090a8'), .55).getHexString());
  return out;
}

// =====================================================================================
// HUD: labels, cards, panels
// =====================================================================================
const labelsEl = $('#labels'), rlabelsEl = $('#rlabels');
const LBL = {};
for (const a of AGENTS) {
  const d = document.createElement('div'); d.className = 'nl' + (a.status === 'planned' ? ' sb' : '');
  d.innerHTML = `<b>${esc(a.name)}</b><span class="s">${esc(a.code)}</span>`; labelsEl.appendChild(d); LBL[a.id] = d;
}
const CARDS = [
  { id: 'focus', sx: .325, sy: .80, c: '#ffe93d' },
  { id: 'site', sx: .675, sy: .80, c: '#3dff8a' },
  { id: 'know', sx: .66, sy: .195, c: '#3d7bff' }
].map(c => { const d = document.createElement('div'); d.className = 'fcard'; d.style.setProperty('--cc', c.c); $('#cards').appendChild(d); return { ...c, d }; });
function renderCards() {
  if (!DATA) return;
  const ch = (DATA.chapters || []).find(c => c.name === DATA.focus);
  const set = (id, html) => { const c = CARDS.find(x => x.id === id); if (c) c.d.innerHTML = html; };
  if (ch) set('focus', `<div class="k"><span>Writing next</span><span style="color:#ffe93d">CH ${ch.no}</span></div><div class="v">${esc(ch.name)}</div><div class="mono" style="font-size:10px;color:#9fb0cc">${ch.done}/${ch.total} dishes · ${ch.flavours.done}/${ch.flavours.total} flavours</div><div class="bar"><i style="width:${(ch.done / Math.max(1, ch.total) * 100).toFixed(1)}%;background:#ffe93d"></i></div>`);
  set('site', `<div class="k"><span>Test site</span><span style="color:#3dff8a">● ${esc(DATA.site?.status || '')}</span></div><div class="v">${fmt(DATA.recipeFiles ?? DATA.derived?.recipesOnSite ?? 0)} <small>recipes</small></div><div class="mono" style="font-size:10px;color:#9fb0cc">${esc((DATA.site?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div>`);
  const k = DATA.knowledge?.stats || {};
  set('know', `<div class="k"><span>Chef knowledge</span><span style="color:#3d7bff">KB</span></div><div class="v">${k.techniques ?? '–'} <small>techniques</small></div><div class="mono" style="font-size:10px;color:#9fb0cc">${k.sources ?? '–'} sources · ${k.files ?? '–'} files</div>`);
}

// ---------- left panel ----------
let chartRange = '7d', chartManual = false;
function renderLeft() {
  if (!DATA) return;
  const h = DATA.headline, f = DATA.flavours;
  const pd = h.done / h.total * 100, pf = f.done / f.total * 100;
  $('#m-d').innerHTML = `${fmt(h.done)}<small>/${fmt(h.total)}</small>`; $('#m-dp').textContent = pd.toFixed(1) + '%'; $('#m-db').style.width = pd + '%';
  $('#m-f').innerHTML = `${fmt(f.done)}<small>/${fmt(f.total)}</small>`; $('#m-fp').textContent = pf.toFixed(1) + '%'; $('#m-fb').style.width = pf + '%';
  $('#m-live').textContent = fmt(DATA.recipeFiles ?? DATA.derived?.recipesOnSite ?? 0);
  $('#m-x').textContent = DATA.extraFlavours?.done ?? 0;
  $('#m-ch').textContent = `${DATA.derived?.chaptersComplete ?? 0}/${(DATA.chapters || []).length}`;
  $('#m-src').textContent = DATA.knowledge?.stats?.sources ?? '–';
  $('#stages').innerHTML = (DATA.stages || []).map(s => `<div class="stage"><span>${esc(s.name)}</span><span class="t"><i style="width:${s.pct}%"></i></span><em>${s.pct}%</em></div>`).join('');
  const ch = (DATA.chapters || []).find(c => c.name === DATA.focus);
  if (ch) { $('#focusn').textContent = ch.name; $('#focusv').textContent = `${ch.done}/${ch.total}`; $('#focusb').style.width = (ch.done / ch.total * 100) + '%'; }
  const st = new Date(DATA.updatedAt); $('#dstamp').textContent = hhmm(st); $('#dsrc').textContent = 'updated ' + hhmm(st) + ' CAI';
  drawChart();
}
function cairoDay(ms) { return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); }
function drawChart() {
  const cv = $('#chart'), r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  cv.width = r.width * dpr; cv.height = r.height * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const W = r.width, H = r.height; g.clearRect(0, 0, W, H);
  const hist = (DATA?.history || []).map(p => ({ t: Date.parse(p.t), v: p.recipes })).filter(p => !isNaN(p.t)).sort((a, b) => a.t - b.t);
  $('#chartlbl').textContent = chartRange === '7d' ? '7 DAYS' : '24 HOURS';
  document.querySelectorAll('.tabs span').forEach(s => s.classList.toggle('on', s.dataset.r === chartRange));
  g.font = '9px JBM, monospace'; g.textBaseline = 'alphabetic';
  // grid
  g.strokeStyle = 'rgba(120,200,255,.08)'; g.lineWidth = 1;
  for (let i = 0; i <= 3; i++) { const y = 8 + (H - 26) * i / 3; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const now = Date.now();
  if (chartRange === '7d') {
    const days = []; for (let i = 6; i >= 0; i--) days.push(cairoDay(now - i * 864e5));
    let carry = 0; const vals = days.map(d => { const pts = hist.filter(p => cairoDay(p.t) === d); if (pts.length) carry = pts[pts.length - 1].v; else if (hist.length && hist[0].t > Date.parse(d + 'T23:59:59+03:00')) carry = 0; return carry; });
    const max = Math.max(10, ...vals) * 1.15, bw = (W - 12) / 7;
    vals.forEach((v, i) => {
      const x = 6 + i * bw + bw * .2, w = bw * .6, hh = (H - 26) * v / max, y = H - 18 - hh;
      const today = i === 6; const gr = g.createLinearGradient(0, y, 0, H - 18);
      gr.addColorStop(0, today ? '#ff3df0' : '#3df2ff'); gr.addColorStop(1, 'rgba(61,123,255,.08)');
      g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(x, 8, w, H - 26);
      g.fillStyle = gr; g.shadowColor = today ? '#ff3df0' : '#3df2ff'; g.shadowBlur = 12; g.fillRect(x, y, w, Math.max(1, hh)); g.shadowBlur = 0;
      g.fillStyle = today ? '#fff' : '#7c8aa3'; g.textAlign = 'center';
      if (v) g.fillText(v, x + w / 2, y - 4);
      g.fillStyle = '#4a5670'; g.fillText(new Date(Date.parse(days[i] + 'T12:00:00+03:00')).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Africa/Cairo' }).toUpperCase(), x + w / 2, H - 5);
    });
  } else {
    const t0 = now - 864e5, pts = hist.filter(p => p.t >= t0); const max = Math.max(10, ...pts.map(p => p.v)) * 1.15;
    const X = t => 4 + (W - 8) * (t - t0) / 864e5, Y = v => H - 18 - (H - 26) * v / max;
    if (pts.length) {
      g.beginPath(); g.moveTo(X(pts[0].t), H - 18); pts.forEach(p => g.lineTo(X(p.t), Y(p.v))); g.lineTo(X(now), Y(pts[pts.length - 1].v)); g.lineTo(X(now), H - 18); g.closePath();
      const gr = g.createLinearGradient(0, 8, 0, H - 18); gr.addColorStop(0, 'rgba(255,61,240,.45)'); gr.addColorStop(1, 'rgba(61,123,255,0)'); g.fillStyle = gr; g.fill();
      g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p.t), Y(p.v)) : g.moveTo(X(p.t), Y(p.v))); g.lineTo(X(now), Y(pts[pts.length - 1].v));
      g.strokeStyle = '#ff3df0'; g.lineWidth = 2; g.shadowColor = '#ff3df0'; g.shadowBlur = 10; g.stroke(); g.shadowBlur = 0;
      pts.forEach(p => { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(p.t), Y(p.v), 1.8, 0, 7); g.fill(); });
      const lp = pts[pts.length - 1]; g.fillStyle = '#fff'; g.textAlign = 'right'; g.fillText(lp.v + ' dishes', W - 4, Y(lp.v) - 6);
    }
    g.fillStyle = '#4a5670'; g.textAlign = 'center';
    for (let i = 0; i <= 4; i++) { const t = t0 + i * 6 * 36e5; g.fillText(hhmm(t), Math.min(W - 14, Math.max(14, X(t))), H - 5); }
  }
}
document.querySelectorAll('.tabs span').forEach(s => s.onclick = () => { chartRange = s.dataset.r; chartManual = true; drawChart(); });
setInterval(() => { if (!chartManual && !CAPTURE) { chartRange = chartRange === '7d' ? '24h' : '7d'; drawChart(); } }, 12000);

// ---------- right panel ----------
function agentStatus(id) {
  const a = BYID[id], s = S[id], age = Date.now() - s.lastAt;
  if (s.lastAt && age < 180000) return s.lastType === 'done' ? 'done' : 'live';
  if (a.status === 'planned') return s.lastAt ? 'idle' : 'sb';
  return a.status === 'active' ? 'on' : 'idle';
}
const ST_LABEL = { live: 'LIVE', done: 'DONE', on: 'ONLINE', idle: 'IDLE', sb: 'STANDBY' };
function realRatio(id) {
  if (!DATA) return null;
  if (id === 'recipe-writer') return DATA.headline.done / DATA.headline.total;
  if (id === 'recipe-checker') return (DATA.derived?.chaptersComplete || 0) / Math.max(1, (DATA.chapters || []).length);
  if (id === 'planner') { const m = DATA.milestones || []; return m.filter(x => x.done).length / Math.max(1, m.length); }
  if (id === 'jarvis') { const s = DATA.stages || []; return s.reduce((a, b) => a + b.pct, 0) / Math.max(1, s.length) / 100; }
  if (id === 'research') { const k = DATA.knowledge?.items || []; return k.filter(x => x.done).length / Math.max(1, k.length); }
  return null;
}
function ringSVG(p, color) {
  const r = 11, c = 2 * Math.PI * r, v = p == null ? 0 : clamp(p);
  return `<svg class="ring" viewBox="0 0 28 28"><circle cx="14" cy="14" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2.5"/>
  <circle cx="14" cy="14" r="${r}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 14 14)" style="filter:drop-shadow(0 0 3px ${color})"/>
  <text x="14" y="16.5" text-anchor="middle" font-size="7" fill="#cfe0f5" font-family="JBM,monospace">${p == null ? '–' : Math.round(v * 100)}</text></svg>`;
}
function renderAgents() {
  $('#aglist').innerHTML = AGENTS.map(a => {
    const st = agentStatus(a.id), s = S[a.id];
    const p = (s.progress != null && st === 'live') ? s.progress : (realRatio(a.id) ?? s.progress);
    const sub = s.task && (st === 'live' || st === 'done') ? s.task : a.role;
    return `<div class="ag" data-id="${a.id}"><span class="dot ${st}"></span><span class="n">${esc(a.name)}<small>${esc(sub)}</small></span><span class="st ${st}">${ST_LABEL[st]}</span>${ringSVG(a.status === 'planned' && !s.lastAt ? null : p, a.color)}</div>`;
  }).join('');
  document.querySelectorAll('.ag').forEach(r => { r.onclick = () => enterAgent(r.dataset.id); r.onmouseenter = () => hoverId = r.dataset.id; r.onmouseleave = () => hoverId = null; });
  for (const a of AGENTS) { const st = agentStatus(a.id); const s = LBL[a.id].querySelector('.s'); s.textContent = `${a.code} · ${ST_LABEL[st]}`; s.className = 's' + (st === 'live' ? ' live' : ''); }
}
function renderHeat() {
  const now = Date.now(), B = 24, span = 12 * 36e5, rows = [];
  let total = 0, max = 1; const counts = AGENTS.map(a => { const c = new Array(B).fill(0); for (const t of S[a.id].events) { const k = Math.floor((t - (now - span)) / (span / B)); if (k >= 0 && k < B) { c[k]++; total++; } } max = Math.max(max, ...c); return c; });
  AGENTS.forEach((a, i) => { rows.push(`<span class="lb">${esc(a.name.split(' ')[0])}</span>`); counts[i].forEach(v => rows.push(`<span class="c" style="${v ? `background:${a.color};opacity:${(.25 + .75 * v / max).toFixed(2)};box-shadow:0 0 6px ${a.color}` : ''}"></span>`)); });
  $('#heatgrid').innerHTML = rows.join(''); $('#heatsum').textContent = total + ' events';
}
const logEl = $('#log');
function logLine(ev, prepend = true) {
  const a = BYID[ev.agent]; const d = document.createElement('div');
  d.innerHTML = `<time>${hhmm(ev.time)}</time><span style="color:${a.color}">${esc(a.name)}</span> <span style="color:#4a5670">${esc(ev.type)}</span> ${esc(ev.text)}`;
  prepend ? logEl.prepend(d) : logEl.appendChild(d); while (logEl.children.length > 40) logEl.lastChild.remove();
}

// ---------- kinetic numbers ----------
const popsEl = $('#pops'); let popSide = 1; const coreScr = new THREE.Vector3();
function pop(numText, label, color, numeric = null) {
  while (popsEl.children.length > 1) popsEl.firstChild.remove();
  if (inner.visible) [...popsEl.children].forEach(o => { gsap.killTweensOf(o); gsap.to(o, { opacity: 0, scale: .9, filter: 'blur(8px)', duration: .25, onComplete: () => o.remove() }); });
  coreScr.set(0, 0, 0).project(camera);
  const cx = (coreScr.x * .5 + .5) * innerWidth, cy = (-coreScr.y * .5 + .5) * innerHeight;
  popSide *= -1; const dx = MOBILE ? 0 : popSide * (200 + Math.random() * 40), dy = MOBILE ? -innerHeight * .18 : (-130 + Math.random() * 90);
  const IN = inner.visible; const d = document.createElement('div'); d.className = 'pop' + (IN ? ' inpop' : ''); d.style.setProperty('--pc', color);
  d.style.left = (IN ? innerWidth * .5 + popSide * 30 : MOBILE ? cx : Math.max(470, Math.min(innerWidth - 470, cx + dx))) + 'px'; d.style.top = (IN ? innerHeight * (MOBILE ? .2 : .14) : cy + dy) + 'px';
  d.innerHTML = `<div class="num">${esc(numText)}</div><div class="lab">${label}</div>`; popsEl.appendChild(d);
  const num = d.querySelector('.num');
  const tl = gsap.timeline({ onComplete: () => d.remove() });
  tl.fromTo(d, { opacity: 0, scale: .35, filter: 'blur(18px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: .5 * DUR + .01, ease: 'back.out(2.2)' });
  if (numeric && MOTION) { const o = { v: 0 }; const [pre, suf] = numeric; tl.to(o, { v: numeric[2], duration: .9, ease: 'power3.out', onUpdate: () => num.textContent = pre + Math.round(o.v) + suf }, '<'); }
  tl.to(d, { y: '-=' + (14 * MOTION), duration: 2.2, ease: 'none' }, '>-0.4');
  tl.to(d, { opacity: 0, scale: 1.12, filter: 'blur(10px)', y: '-=30', duration: .7, ease: 'power2.in' });
}

// ---------- subtitles (word by word, driven by the sim clock) ----------
const subQ = []; let subCur = null;
function say(who, color, text) { subQ.push({ who, color, text: String(text).slice(0, 220) }); if (subQ.length > 4) subQ.shift(); }
function tickSubs() {
  const t = T();
  if (subCur && subCur.done && subQ.length && t - subCur.doneAt > (subQ.length > 1 ? .7 : 1.6)) subCur = null;
  if (!subCur && subQ.length) {
    subCur = subQ.shift(); subCur.t0 = t; subCur.shown = 0; subCur.done = false;
    const words = subCur.text.split(/\s+/).filter(Boolean);
    $('#who').innerHTML = `<i></i>${esc(subCur.who)}<i></i>`; $('#who').style.color = subCur.color;
    $('#subtxt').innerHTML = words.map(w => `<span class="w${/\d/.test(w) ? ' hot' : ''}">${esc(w)}</span>`).join('') + '<span class="cur"></span>';
    subCur.els = [...document.querySelectorAll('#subtxt .w')]; subCur.n = words.length;
    gsap.fromTo('#subs', { opacity: .4 }, { opacity: 1, duration: .3 });
  }
  if (subCur && !subCur.done) {
    const k = REDUCED ? subCur.n : Math.min(subCur.n, Math.floor((t - subCur.t0) / (subQ.length ? .085 : .14)) + 1);
    while (subCur.shown < k) subCur.els[subCur.shown++].classList.add('in');
    if (k >= subCur.n) { subCur.done = true; subCur.doneAt = t; }
  }
  if (subCur && subCur.done && !subQ.length && t - subCur.doneAt > 14) $('#subs').style.opacity = .35;
  else if (subCur) $('#subs').style.opacity = 1;
}

// =====================================================================================
// EVENTS
// =====================================================================================
const TYPE_COL = { start: '#3df2ff', step: '#3d7bff', done: '#3dff8a', metric: '#ffe93d', say: '#ff3df0' };
let evCount = 0;
function regionIndex(a, ev) {
  if (ev.region) { const i = a.regions.findIndex(r => r.id === ev.region || r.name.toLowerCase() === String(ev.region).toLowerCase()); if (i >= 0) return i; }
  const txt = (ev.text || '').toLowerCase();
  const i = a.regions.findIndex(r => txt.includes(r.id) || txt.includes(r.name.toLowerCase()) || txt.includes(r.name.toLowerCase().replace(/e?s$/, '').replace(/ing$/, '')));
  if (i >= 0) return i;
  if (ev.type === 'done') return a.regions.length - 1;
  if (ev.type === 'start') return 0;
  if (ev.progress != null) return Math.min(a.regions.length - 1, Math.floor(ev.progress * a.regions.length));
  return S[a.id].activeRegion >= 0 ? S[a.id].activeRegion : 0;
}
function handle(ev, live) {
  const a = BYID[ev.agent]; if (!a) return; const s = S[a.id];
  evCount++; $('#evcount').textContent = evCount;
  s.lastAt = Math.max(s.lastAt, ev.time); s.lastType = ev.type; s.events.push(ev.time);
  const r = regionIndex(a, ev); s.activeRegion = r; ev.r = r;
  if (ev.type === 'start') { s.task = ev.text; s.progress = ev.progress ?? 0; }
  if (ev.type === 'step') { if (!s.task) s.task = ev.text; if (ev.progress != null) s.progress = ev.progress; }
  if (ev.type === 'done') { s.progress = 1; if (!s.task) s.task = ev.text; s.results.unshift({ text: ev.text, link: safeUrl(ev.link), value: ev.value, label: ev.label, time: ev.time }); }
  if (ev.type === 'metric') s.metrics[ev.label || ev.text] = ev.value;
  s.feed.unshift(ev); if (s.feed.length > 80) s.feed.pop();
  s.boost[r] = Math.max(s.boost[r], live ? .8 : .3);
  logLine(ev);
  if (live) {
    react(a, ev);
    $('#lastev').textContent = hhmm(ev.time);
  }
  flowOnEvent(a, ev, live);
  if (curAgent === a.id) renderInner(live ? ev : null);
}
function react(a, ev) {
  const s = S[a.id]; s.E = 1; globalE = Math.min(1.0, globalE + (ev.type === 'done' ? .6 : .35));
  const col = a.color;
  if (mode === 'outer' || mode === 'flow') {
    if (!a.core) sendPackets(a.id, ev.type === 'done' ? 10 : 6, ev.type === 'done');
    burst(col, ev.type === 'done' ? 380 : 160, new THREE.Vector3(), ev.type === 'done' ? 1.2 : .9); shockwave(col, ev.type === 'done' ? 12 : 8);
    if (ev.type === 'done') { setTimeout(() => shockwave('#ffffff', 16), 140); }
  } else if (mode === 'inner' && curAgent === a.id) { BU.uE.value = 1; }
  const who = a.name.toUpperCase() + (ev.type === 'say' ? '' : ' · ' + ev.type.toUpperCase());
  say(who, col, ev.text);
  // kinetic number
  if (mode === 'outer' || mode === 'flow' || curAgent === a.id) {
    if (ev.value != null && ev.value !== '') {
      const v = Number(ev.value); const isN = Number.isFinite(v);
      const pre = ev.type === 'done' && isN && v > 0 ? '+' : '';
      pop(pre + (isN ? fmt(v) : String(ev.value)), `<b>${esc(a.name)}</b> · ${esc(ev.label || ev.type)}`, col, isN && Number.isInteger(v) && v < 100000 ? [pre, '', v] : null);
    } else if (ev.progress != null && ev.type !== 'say') {
      const p = Math.round(ev.progress * 100);
      pop(p + '%', `<b>${esc(a.name)}</b> · ${esc(ev.type === 'start' ? 'started' : 'progress')}`, col, [ '', '%', p ]);
    }
  }
  renderAgents(); renderHeat();
}
// ntfy.sh SSE + history
const SRV = CFG.ntfyServer.replace(/\/$/, ''), TOPIC = CFG.topic;
let es = null, lastId = null, lastBeat = Date.now(), seen = new Set(), retry = 1500;
function ingest(m, live) {
  if (!m || m.event !== 'message' || seen.has(m.id)) return; seen.add(m.id); lastId = m.id;
  let ev; try { ev = JSON.parse(m.message); } catch { return; }
  if (!ev || typeof ev !== 'object' || !BYID[ev.agent] || !TYPE_COL[ev.type]) return;
  ev.text = String(ev.text ?? '').slice(0, 300); ev.time = (m.time || Date.now() / 1000) * 1000; ev.id = m.id;
  if (ev.progress != null) ev.progress = clamp(Number(ev.progress) || 0);
  handle(ev, live); window.__evCount = (window.__evCount || 0) + 1; window.__lastEv = ev;
}
function setLive(state) {
  const el = $('#live'); el.className = state === 'on' ? 'on' : state === 'err' ? 'err' : '';
  el.querySelector('span').textContent = state === 'on' ? 'LIVE' : state === 'err' ? 'RECONNECTING' : 'CONNECTING';
}
async function connect(first = false) {
  setLive('conn');
  try {
    const since = lastId || CFG.historySince || '12h';
    const txt = await fetch(`${SRV}/${TOPIC}/json?poll=1&since=${encodeURIComponent(since)}`).then(r => r.text());
    const msgs = txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    msgs.forEach(m => ingest(m, !first));
    if (first) {
      const last = msgs.map(m => { try { return JSON.parse(m.message); } catch { return null; } }).filter(e => e && BYID[e.agent]).pop();
      if (last) say(BYID[last.agent].name.toUpperCase() + ' · ' + hhmm(msgs[msgs.length - 1].time * 1000), BYID[last.agent].color, last.text);
      renderAgents(); renderHeat();
    }
  } catch (e) { console.warn('history', e); }
  try { es?.close(); } catch { }
  const sinceQ = lastId ? `?since=${lastId}` : `?since=${Math.floor(Date.now() / 1000) - 5}`;
  es = new EventSource(`${SRV}/${TOPIC}/sse${sinceQ}`);
  es.onopen = () => { setLive('on'); retry = 1500; lastBeat = Date.now(); };
  es.onmessage = e => { lastBeat = Date.now(); try { ingest(JSON.parse(e.data), true); } catch { } };
  es.addEventListener('keepalive', () => lastBeat = Date.now());
  es.addEventListener('open', () => { lastBeat = Date.now(); setLive('on'); });
  es.onerror = () => { setLive('err'); es.close(); setTimeout(() => connect(false), retry); retry = Math.min(30000, retry * 2); };
}
// watchdog: ntfy sends a keepalive every ~45 s; if the stream goes quiet, re-poll and reconnect (dedupe by id)
setInterval(() => { if (es && Date.now() - lastBeat > 62000) { try { es.close(); } catch { } lastBeat = Date.now(); connect(false); } }, 10000);
window.__reconnect = () => { lastBeat = Date.now(); connect(false); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && (!es || es.readyState === 2)) connect(false); });
setInterval(() => { renderAgents(); renderHeat(); }, 30000);

// data.json totals: on load + every 5 minutes
async function loadData() {
  try { DATA = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()); renderLeft(); renderCards(); renderAgents(); if (curAgent) renderInner(); }
  catch (e) { console.warn('data.json', e); }
}

// =====================================================================================
// INSIDE: HUD
// =====================================================================================
let curAgent = null, selRegion = -1, feedFilter = '';
const RL = [];
function buildRegionLabels(a) {
  rlabelsEl.innerHTML = ''; RL.length = 0;
  const pal = agentPalette(a);
  a.regions.forEach((rg, k) => {
    const d = document.createElement('div'); d.className = 'rl'; d.style.setProperty('--rc', pal[k]);
    d.innerHTML = `<b>${esc(rg.name)}</b>${fmt(regionCounts[k])} nodes · firing <em>0%</em>`;
    d.onclick = () => selectRegion(k); rlabelsEl.appendChild(d); RL.push({ d, em: d.querySelector('em') });
  });
}
function selectRegion(k) { selRegion = selRegion === k ? -1 : k; BU.uSel.value = selRegion; renderInner(); }
function vitalsHTML(a) {
  const m = (k, v, c, sub = '') => `<div class="metric"><div class="k">${k}</div><div class="v" style="color:${c || '#fff'}">${v}</div>${sub ? `<div class="mono" style="font-size:9px;color:var(--dim);margin-top:3px">${sub}</div>` : ''}</div>`;
  const s = S[a.id]; const today = s.events.filter(t => Date.now() - t < 12 * 36e5).length;
  let real = '', tag = 'REAL';
  if (DATA) {
    if (a.id === 'recipe-writer') {
      const top = (DATA.chapters || []).filter(c => c.done > 0 && c.done < c.total || c.name === DATA.focus).slice(0, 4);
      real = m('Dishes', `${fmt(DATA.headline.done)}<small>/${fmt(DATA.headline.total)}</small>`, a.color) + m('Flavours', `${DATA.flavours.done}<small>/${DATA.flavours.total}</small>`)
        + m('Extra', DATA.extraFlavours?.done ?? 0) + m('Focus', `<span style="font-size:15px">${esc(DATA.focus || '–')}</span>`)
        + `<div style="grid-column:1/-1">${top.map(c => `<div class="stage"><span>${esc(c.name)}</span><span class="t"><i style="width:${c.done / c.total * 100}%;background:${a.color}"></i></span><em>${c.done}/${c.total}</em></div>`).join('')}</div>`;
    } else if (a.id === 'recipe-checker') {
      real = m('Recipes live', fmt(DATA.recipeFiles ?? DATA.derived?.recipesOnSite), a.color, 'on the test site') + m('Chapters', `${DATA.derived?.chaptersComplete}<small>/${DATA.chapters.length}</small>`, '', 'fully complete');
    } else if (a.id === 'research') {
      const k = DATA.knowledge?.stats || {}; real = m('Techniques', k.techniques, a.color) + m('Sources', k.sources) + m('Files', k.files) + m('Status', `<span style="font-size:15px">${esc(DATA.knowledge?.status || '–')}</span>`);
    } else if (a.id === 'planner') {
      const ms = DATA.milestones || []; real = m('Milestones', `${ms.filter(x => x.done).length}<small>/${ms.length}</small>`, a.color) + m('Waiting', (DATA.waiting || []).length, '', 'decisions')
        + `<div style="grid-column:1/-1;font-size:11px;color:#b8c7de">${(DATA.waiting || []).map(w => `<div style="display:flex;justify-content:space-between;padding:3px 0"><span>${esc(w.name)}</span><span class="mono" style="color:var(--dim);font-size:9px">${esc(w.owner)}</span></div>`).join('')}</div>`;
    } else if (a.id === 'jarvis') {
      real = `<div style="grid-column:1/-1">${(DATA.stages || []).map(x => `<div class="stage"><span>${esc(x.name)}</span><span class="t"><i style="width:${x.pct}%"></i></span><em>${x.pct}%</em></div>`).join('')}</div>`;
    }
  }
  if (!real) { tag = a.status === 'planned' ? 'STANDBY' : 'LIVE'; real = a.status === 'planned' ? `<div class="empty" style="grid-column:1/-1">Planned agent. Wakes up at launch; regions are its future skills.</div>` : ''; }
  const lm = Object.entries(s.metrics).slice(-4).map(([k, v]) => m(esc(k), esc(v), '#ffe93d', 'live metric')).join('');
  return { html: `<div class="vit">${real}${m('Events 12h', today, '#ff3df0')}${m('Results', s.results.length)}${lm}</div>`, tag };
}
function renderInner(newEv = null) {
  const a = BYID[curAgent]; if (!a) return; const s = S[a.id], st = agentStatus(a.id), pal = agentPalette(a);
  document.documentElement.style.setProperty('--ac', a.color);
  $('#i-code').textContent = `${a.code} // AGENT BRAIN · ${BN.toLocaleString()} PARTICLES`;
  $('#i-name').textContent = a.name; $('#i-role').textContent = a.role;
  const sl = $('#i-st'); sl.textContent = '● ' + ST_LABEL[st]; sl.style.color = st === 'live' ? 'var(--gr)' : st === 'sb' ? 'var(--dim)' : '#cfe0f5'; sl.style.borderColor = 'currentColor';
  const v = vitalsHTML(a); $('#i-vitals').innerHTML = v.html; $('#i-vtag').textContent = v.tag; $('#i-vtag').className = 'tag ' + (v.tag === 'REAL' ? 'real' : 'lv');
  $('#i-task').textContent = s.task || (a.status === 'planned' ? 'Standby · no task until launch' : 'Waiting for the next task');
  const p = s.progress ?? 0; $('#i-pb').style.width = (p * 100) + '%'; $('#i-pp').textContent = Math.round(p * 100) + '%';
  $('#i-pt').textContent = s.lastAt ? `last update ${hhmm(s.lastAt)} CAI` : 'no live task yet';
  $('#i-rc').textContent = a.regions.length;
  $('#i-regions').innerHTML = a.regions.map((rg, k) => `<div class="rg${k === selRegion ? ' sel' : ''}" data-k="${k}"><span class="d" style="background:${pal[k]};box-shadow:0 0 8px ${pal[k]}"></span><span>${esc(rg.name)}<div class="bb"><i data-fb="${k}" style="width:${s.fire[k] * 100}%;background:${pal[k]}"></i></div></span><em data-fe="${k}" style="color:${pal[k]}">${Math.round(s.fire[k] * 100)}%</em></div>`).join('');
  document.querySelectorAll('.rg').forEach(r => r.onclick = () => selectRegion(+r.dataset.k));
  const k = selRegion >= 0 ? selRegion : Math.max(0, s.activeRegion); const rg = a.regions[k];
  const inR = s.feed.filter(e => e.r === k);
  $('#detail').innerHTML = `<b style="color:${pal[k]}">${esc(rg.name)}</b> · ${esc(rg.desc)}<div class="kv"><span>${fmt(regionCounts[k] || 0)} nodes</span><span>${inR.length} events</span><span>${selRegion >= 0 ? 'selected' : 'most recent'}</span></div>${inR[0] ? `<div style="margin-top:6px;color:#fff">› ${esc(inR[0].text)}</div>` : ''}`;
  const f = feedFilter.toLowerCase(); const items = s.feed.filter(e => !f || e.text.toLowerCase().includes(f) || e.type.includes(f) || (a.regions[e.r]?.name || '').toLowerCase().includes(f));
  $('#i-fc').textContent = f ? `${items.length} match "${feedFilter}"` : `${s.feed.length} events`;
  $('#feed').innerHTML = items.length ? items.slice(0, 50).map(e => `<div class="fi${newEv && e === newEv ? ' new' : ''}"><time>${hhmm(e.time)}</time><div><span class="ty" style="color:${TYPE_COL[e.type]}">${e.type}</span><span style="color:${pal[e.r] || '#fff'};font-family:var(--mono);font-size:9px">${esc(a.regions[e.r]?.name || '')}</span><div>${esc(e.text)}${e.progress != null ? ` <span class="mono" style="color:var(--dim);font-size:9.5px">${Math.round(e.progress * 100)}%</span>` : ''}</div></div></div>`).join('')
    : `<div class="empty">${f ? 'No events match the filter.' : 'No events in the last 12 h. Post one with post.sh and it appears here instantly.'}</div>`;
  let res = s.results.map(r => ({ ...r, live: true }));
  let rtag = 'LIVE';
  if (a.id === 'recipe-writer' && DATA?.recent) { res = res.concat(DATA.recent.map(r => ({ text: r.title, link: r.url, time: Date.parse(r.t) }))); rtag = 'LIVE + REAL'; }
  if (a.id === 'planner' && DATA?.milestones) { res = res.concat(DATA.milestones.map(m => ({ text: (m.done ? '✓ ' : '○ ') + m.name, time: null, date: m.date }))); rtag = 'LIVE + REAL'; }
  $('#i-rtag').textContent = rtag; $('#i-rtag').className = 'tag ' + (rtag === 'LIVE' ? 'lv' : 'real');
  $('#results').innerHTML = res.length ? res.slice(0, 30).map(r => {
    const right = `${r.value != null ? esc(r.value) + ' ' + esc(r.label || '') + ' · ' : ''}${r.time ? hhmm(r.time) : esc(r.date || '')}`;
    return r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener"><span>${r.live ? '<span style="color:var(--gr)">● </span>' : ''}${esc(r.text)} ↗</span><span>${right}</span></a>` : `<div class="r"><span>${r.live ? '<span style="color:var(--gr)">● </span>' : ''}${esc(r.text)}</span><span>${right}</span></div>`;
  }).join('') : `<div class="empty">No results yet. They appear when this agent posts a "done" event.</div>`;
}
$('#feedbar').onsubmit = e => {
  e.preventDefault(); const v = $('#fbin').value.trim(); const msg = $('#fbmsg');
  const a = BYID[curAgent];
  if (v === '/back') { $('#fbin').value = ''; exitAgent(); return; }
  if (v === '/clear' || v === '') { feedFilter = ''; selRegion = -1; BU.uSel.value = -1; msg.textContent = 'filter cleared'; renderInner(); return; }
  if (v === '/flow') { $('#fbin').value = ''; exitAgent(() => setView('flow')); return; }
  const m = v.match(/^\/region\s+(.+)/i);
  if (m && a) { const k = a.regions.findIndex(r => r.name.toLowerCase().startsWith(m[1].toLowerCase()) || r.id === m[1].toLowerCase()); if (k >= 0) { selRegion = -1; selectRegion(k); msg.textContent = `region → ${a.regions[k].name}`; } else msg.textContent = 'no such region'; return; }
  if (v.startsWith('/')) { msg.textContent = 'commands: /region <name> · /clear · /flow · /back (local only, nothing is sent)'; return; }
  feedFilter = v; if (a) { S[a.id].boost.forEach((_, k) => S[a.id].boost[k] = Math.max(S[a.id].boost[k], .35)); BU.uE.value = .6; }
  msg.textContent = `filtering the feed by "${v}" · local only, nothing is sent`; renderInner();
};

// =====================================================================================
// CAMERA + TRANSITIONS
// =====================================================================================
let mode = 'outer';   // outer | toIn | inner | toOut | flow
const HOME = MOBILE ? { x: 0, y: 5.6, z: 30, fov: 55, ty: -4.2 } : { x: 0, y: 3.9, z: 16.2, fov: 50, ty: -.25 };
const cam = { x: HOME.x, y: HOME.y + 6, z: HOME.z + 10, tx: 0, ty: HOME.ty, tz: 0, fov: HOME.fov, boost: 0 };
const flashEl = $('#flash');
let mouse = { x: 0, y: 0 }, hoverId = null;
const outerUI = ['#outer', '#labels'];
function fadeUI(sel, on, d = .45) { sel.forEach(s => gsap.to(s, { autoAlpha: on ? 1 : 0, duration: d * DUR + .01 })); }
function enterAgent(id) {
  if (!BYID[id]) return;
  if (mode === 'flow') { setView('core', true); }
  if (mode !== 'outer') return;
  mode = 'toIn'; curAgent = id; selRegion = -1; BU.uSel.value = -1; feedFilter = ''; $('#fbin').value = '';
  const a = BYID[id];
  const target = a.core ? new THREE.Vector3(0, 0, 0) : NODES[id].g.getWorldPosition(new THREE.Vector3());
  const from = new THREE.Vector3(cam.x, cam.y, cam.z); const dir = from.clone().sub(target).normalize();
  const end = target.clone().add(dir.multiplyScalar(a.core ? 1.6 : .9));
  if (!a.core) S[id].E = 1;
  flashEl.style.setProperty('--fc', a.color);
  fadeUI(outerUI, false, .35); gsap.to('#subs', { autoAlpha: 0, duration: .3 });
  const tl = gsap.timeline();
  tl.to(cam, { x: end.x, y: end.y, z: end.z, tx: target.x, ty: target.y, tz: target.z, fov: 24, duration: 1.45 * DUR + .01, ease: 'power3.inOut' }, 0);
  tl.to(cam, { boost: 2.2, duration: 1.2 * DUR + .01, ease: 'power2.in' }, 0);
  tl.to(flashEl, { opacity: 1, duration: .32 * DUR + .01, ease: 'power2.in' }, 1.15 * DUR);
  tl.add(() => {
    outer.visible = false; inner.visible = true; buildBrain(a); renderInner(); inner.rotation.y = -1.55;
    BU.uAsm.value = 0; Object.assign(cam, { x: 0, y: .5, z: 2.2, tx: 0, ty: .2, tz: 0, fov: 80 });
    $('#inner').classList.remove('hidden'); gsap.set('#inner', { autoAlpha: 0 }); gsap.set('#rlabels', { autoAlpha: 0 });
  }, 1.5 * DUR);
  tl.to(flashEl, { opacity: 0, duration: .8 * DUR + .01, ease: 'power2.out' }, 1.52 * DUR);
  tl.to(cam, { x: 0, y: 2.6, z: MOBILE ? 14 : 9.2, fov: 45, boost: 0, duration: 2.1 * DUR + .01, ease: 'power3.out' }, 1.52 * DUR);
  tl.to(BU.uAsm, { value: 1, duration: 2.2 * DUR + .01, ease: 'power2.out' }, 1.5 * DUR);
  tl.to('#inner', { autoAlpha: 1, duration: .6 * DUR + .01 }, 2.3 * DUR);
  tl.fromTo('#iright', { x: 40 }, { x: 0, duration: .7 * DUR + .01, ease: 'power3.out' }, 2.3 * DUR);
  tl.fromTo('#ileft', { x: -40 }, { x: 0, duration: .7 * DUR + .01, ease: 'power3.out' }, 2.35 * DUR);
  tl.to('#rlabels', { autoAlpha: 1, duration: .6 * DUR + .01 }, 3.0 * DUR);
  tl.to('#subs', { autoAlpha: 1, duration: .4 }, 3.0 * DUR);
  tl.add(() => { mode = 'inner'; camera.position.set(cam.x, cam.y, cam.z); controls.target.set(0, .2, 0); controls.enabled = true; controls.update(); });
}
function exitAgent(after) {
  if (mode !== 'inner') return;
  mode = 'toOut'; controls.enabled = false;
  Object.assign(cam, { x: camera.position.x, y: camera.position.y, z: camera.position.z, tx: controls.target.x, ty: controls.target.y, tz: controls.target.z, fov: camera.fov });
  const a = BYID[curAgent];
  const nodePos = a.core ? new THREE.Vector3() : NODES[a.id].g.getWorldPosition(new THREE.Vector3());
  flashEl.style.setProperty('--fc', a.color);
  const tl = gsap.timeline();
  tl.to(['#inner', '#rlabels'], { autoAlpha: 0, duration: .35 * DUR + .01 }, 0);
  tl.to('#subs', { autoAlpha: 0, duration: .3 }, 0);
  tl.to(BU.uAsm, { value: 0, duration: 1.15 * DUR + .01, ease: 'power2.in' }, 0);
  tl.to(cam, { x: cam.x * .12, y: cam.y * .12, z: cam.z * .12, fov: 85, boost: 1.6, duration: 1.15 * DUR + .01, ease: 'power3.in' }, 0);
  tl.to(flashEl, { opacity: 1, duration: .3 * DUR + .01 }, .85 * DUR);
  tl.add(() => {
    inner.visible = false; outer.visible = true; $('#inner').classList.add('hidden'); rlabelsEl.innerHTML = '';
    const back = nodePos.clone().add(new THREE.Vector3(HOME.x, HOME.y, HOME.z).sub(nodePos).normalize().multiplyScalar(a.core ? 2 : 1));
    Object.assign(cam, { x: back.x, y: back.y, z: back.z, tx: nodePos.x, ty: nodePos.y, tz: nodePos.z, fov: 28 });
    curAgent = null;
  }, 1.18 * DUR);
  tl.to(flashEl, { opacity: 0, duration: .8 * DUR + .01 }, 1.2 * DUR);
  tl.to(cam, { x: HOME.x, y: HOME.y, z: HOME.z, tx: 0, ty: HOME.ty, tz: 0, fov: HOME.fov, boost: 0, duration: 2.0 * DUR + .01, ease: 'power3.inOut' }, 1.2 * DUR);
  tl.add(() => fadeUI(outerUI, true, .6), 2.2 * DUR);
  tl.to('#subs', { autoAlpha: 1, duration: .4 }, 2.4 * DUR);
  tl.add(() => { mode = 'outer'; after && after(); });
}
$('#back').onclick = () => exitAgent();
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape') { if (mode === 'inner') exitAgent(); else if (mode === 'flow') setView('core'); }
  if (e.key === 'f' || e.key === 'F') setView(mode === 'flow' ? 'core' : 'flow');
});
// picking
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(cx, cy) {
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(HITS, false)[0]; if (h) return h.object.userData.id;
  coreScr.set(0, 0, 0).project(camera); const dx = (coreScr.x - ndc.x) * innerWidth / 2, dy = (coreScr.y - ndc.y) * innerHeight / 2;
  return Math.hypot(dx, dy) < 60 ? CORE.id : null;
}
let downAt = null;
canvas.addEventListener('pointerdown', e => downAt = { x: e.clientX, y: e.clientY });
canvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; downAt = null;
  ripple(e.clientX, e.clientY);
  if (mode === 'outer') { const id = pick(e.clientX, e.clientY); if (id) enterAgent(id); }
});
canvas.addEventListener('pointermove', e => {
  mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1;
  if (mode === 'outer') { hoverId = pick(e.clientX, e.clientY); canvas.classList.toggle('pointer', !!hoverId); }
});
function ripple(x, y) { const d = document.createElement('div'); d.className = 'ripple'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); gsap.fromTo(d, { scale: .4, opacity: 1 }, { scale: 3.2, opacity: 0, duration: .7, ease: 'power2.out', onComplete: () => d.remove() }); }
window.__ripple = ripple;

// =====================================================================================
// FLOW VIEW: draggable agent nodes + animated edges (how work moves)
// =====================================================================================
const FLOW = AG.flow || { virtual: [], layout: {}, edges: [] };
const FN = {};   // id -> {meta, d, x, y, E}
const FE = [];   // edges
const flowEl = $('#flow'), fnodesEl = $('#fnodes'), fedgesEl = $('#fedges');
const LSKEY = 'jb3-flow-layout-v1';
let savedLayout = {}; try { savedLayout = JSON.parse(localStorage.getItem(LSKEY) || '{}'); } catch { }
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (t, attrs = {}) => { const e = document.createElementNS(SVGNS, t); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const flowMetas = [...FLOW.virtual.map(v => ({ ...v, virtual: true })), ...AGENTS.filter(a => FLOW.layout[a.id])];
for (const m of flowMetas) {
  const d = document.createElement('div'); d.className = 'fn' + (m.status === 'planned' ? ' sb' : ''); d.style.setProperty('--nc', m.color);
  d.innerHTML = `<i class="hd l"></i><i class="hd r"></i><i class="hd t"></i><i class="hd b"></i><div class="fh"><span class="dot"></span><b>${esc(m.name)}</b><span class="st"></span></div><div class="ft"></div><div class="fpb"><i></i></div><div class="fm"><span>${esc(m.code)}</span><span class="fe"></span></div>`;
  fnodesEl.appendChild(d);
  const [x, y] = savedLayout[m.id] || FLOW.layout[m.id] || [.5, .5];
  FN[m.id] = { meta: m, d, x, y, E: 0, st: d.querySelector('.st'), ft: d.querySelector('.ft'), pb: d.querySelector('.fpb i'), fe: d.querySelector('.fe') };
  // drag
  let drag = null;
  d.addEventListener('pointerdown', e => { e.preventDefault(); d.setPointerCapture(e.pointerId); const r = flowRect(); drag = { ox: e.clientX, oy: e.clientY, x: FN[m.id].x, y: FN[m.id].y, r, moved: 0 }; d.classList.add('drag'); });
  d.addEventListener('pointermove', e => {
    if (!drag) return; const n = FN[m.id], r = drag.r;
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.ox, e.clientY - drag.oy));
    if (MOBILE) { n.y = clamp(drag.y + (e.clientX - drag.ox) / Math.max(1, r.w - r.cw)); n.x = clamp(drag.x + (e.clientY - drag.oy) / Math.max(1, r.h - r.ch)); }
    else { n.x = clamp(drag.x + (e.clientX - drag.ox) / Math.max(1, r.w - r.cw)); n.y = clamp(drag.y + (e.clientY - drag.oy) / Math.max(1, r.h - r.ch)); }
    layoutFlow();
  });
  const end = () => { if (!drag) return; d.classList.remove('drag'); if (drag.moved > 3) { savedLayout[m.id] = [+FN[m.id].x.toFixed(4), +FN[m.id].y.toFixed(4)]; try { localStorage.setItem(LSKEY, JSON.stringify(savedLayout)); } catch { } } drag = null; };
  d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
  d.addEventListener('dblclick', () => { if (BYID[m.id]) enterAgent(m.id); });
}
for (const [from, to, label] of FLOW.edges) {
  if (!FN[from] || !FN[to]) continue;
  const planned = FN[from].meta.status === 'planned' || FN[to].meta.status === 'planned';
  const col = FN[from].meta.color;
  const g = svgEl('g');
  const glow = svgEl('path', { fill: 'none', stroke: col, 'stroke-width': 6, opacity: 0, filter: 'url(#fglow)' });
  const base = svgEl('path', { fill: 'none', stroke: planned ? '#4a5670' : col, 'stroke-width': planned ? 1.2 : 1.6, opacity: planned ? .55 : .45, 'stroke-dasharray': planned ? '3 6' : 'none' });
  const flowL = svgEl('path', { fill: 'none', stroke: planned ? '#6b7a96' : col, 'stroke-width': 2, 'stroke-dasharray': '2 14', 'stroke-linecap': 'round', opacity: planned ? .35 : .9 });
  const arrow = svgEl('path', { d: 'M-5,-4 L3,0 L-5,4', fill: 'none', stroke: planned ? '#6b7a96' : col, 'stroke-width': 1.6 });
  const dots = [0, 1, 2].map(() => svgEl('circle', { r: 2.6, fill: '#fff', opacity: 0 }));
  const lblBg = svgEl('rect', { class: 'elbg', rx: 4, fill: 'rgba(4,8,18,.85)', stroke: planned ? '#2a3348' : col, 'stroke-opacity': .5 });
  const lbl = svgEl('text', { class: 'elab', fill: planned ? '#6b7a96' : '#cfe0f5', 'text-anchor': 'middle', 'dominant-baseline': 'central' }); lbl.textContent = label;
  g.append(glow, base, flowL, arrow, ...dots, lblBg, lbl); fedgesEl.appendChild(g);
  FE.push({ from, to, label, planned, col, glow, base, flowL, arrow, dots, lblBg, lbl, E: 0, len: 1, pkt: [] });
}
function flowRect() {
  const m = MOBILE, W = innerWidth, H = innerHeight;
  const cw = m ? 104 : 150, ch = m ? 50 : 86;
  return m ? { l: 8, t: 78, w: W - 16, h: H - 210, cw, ch } : { l: 70, t: 170, w: W - 140, h: H - 170 - 190, cw, ch };
}
function nodeBox(id) { const n = FN[id], r = flowRect(), nx = MOBILE ? n.y : n.x, ny = MOBILE ? n.x : n.y; return { x: r.l + r.cw / 2 + nx * (r.w - r.cw), y: r.t + r.ch / 2 + ny * (r.h - r.ch), w: r.cw, h: r.ch }; }  // mobile: flow runs top → bottom
function layoutFlow() {
  for (const id in FN) { const b = nodeBox(id); FN[id].d.style.left = b.x + 'px'; FN[id].d.style.top = b.y + 'px'; }
  for (const e of FE) {
    const a = nodeBox(e.from), b = nodeBox(e.to); const dx = b.x - a.x, dy = b.y - a.y; let d, ex, ey, ang;
    if (Math.abs(dx) >= Math.abs(dy) * .9) {
      const s = Math.sign(dx) || 1, sx = a.x + s * a.w / 2, tx = b.x - s * b.w / 2 - s * 4, k = Math.max(40, Math.abs(tx - sx) * .5);
      d = `M${sx},${a.y} C${sx + s * k},${a.y} ${tx - s * k},${b.y} ${tx},${b.y}`; ex = tx; ey = b.y; ang = s > 0 ? 0 : 180;
    } else {
      const s = Math.sign(dy) || 1, sy = a.y + s * a.h / 2, ty = b.y - s * b.h / 2 - s * 4, k = Math.max(30, Math.abs(ty - sy) * .5);
      d = `M${a.x},${sy} C${a.x},${sy + s * k} ${b.x},${ty - s * k} ${b.x},${ty}`; ex = b.x; ey = ty; ang = s > 0 ? 90 : -90;
    }
    for (const p of [e.glow, e.base, e.flowL]) p.setAttribute('d', d);
    e.arrow.setAttribute('transform', `translate(${ex},${ey}) rotate(${ang})`);
    e.len = e.base.getTotalLength();
    const mid = e.base.getPointAtLength(e.len / 2); e.lbl.setAttribute('x', mid.x); e.lbl.setAttribute('y', mid.y);
    const w = e.label.length * 6 + 14; e.lblBg.setAttribute('x', mid.x - w / 2); e.lblBg.setAttribute('y', mid.y - 8); e.lblBg.setAttribute('width', w); e.lblBg.setAttribute('height', 16);
  }
}
$('#freset').onclick = () => { savedLayout = {}; try { localStorage.removeItem(LSKEY); } catch { } for (const id in FN) [FN[id].x, FN[id].y] = FLOW.layout[id]; layoutFlow(); };
function flowOnEvent(a, ev, live) {
  if (!live) return;
  if (FN[a.id]) FN[a.id].E = 1;
  for (const e of FE) {
    if (e.from === a.id && ev.type !== 'start') { e.E = 1; e.pkt.push(T()); if (ev.type === 'done') { e.pkt.push(T() + .18, T() + .36); if (FN[e.to]) FN[e.to].E = Math.max(FN[e.to].E, .7); } }
    if (e.to === a.id && ev.type === 'start') { e.E = Math.max(e.E, .8); e.pkt.push(T()); if (FN[e.from]) FN[e.from].E = Math.max(FN[e.from].E, .5); }
  }
  // the site node lights up when the checker publishes
  if (ev.type === 'done' && a.id === 'recipe-checker' && FN.site) FN.site.E = 1;
}
function renderFlowCards() {
  for (const id in FN) {
    const n = FN[id], a = BYID[id];
    if (!a) {
      if (id === 'site') { n.st.textContent = '● LIVE'; n.st.className = 'st live'; n.ft.textContent = DATA ? `${fmt(DATA.recipeFiles ?? 0)} recipes live on the test site` : n.meta.role; n.pb.style.width = DATA ? (DATA.headline.done / DATA.headline.total * 100) + '%' : '0'; n.fe.textContent = 'REAL'; }
      else { n.st.textContent = 'OWNER'; n.ft.textContent = n.meta.role; n.pb.style.width = '100%'; n.fe.textContent = ''; }
      continue;
    }
    const st = agentStatus(id), s = S[id];
    n.st.textContent = ST_LABEL[st]; n.st.className = 'st' + (st === 'live' ? ' live' : '');
    n.ft.textContent = (st === 'live' || st === 'done') && s.task ? s.task : a.role;
    const p = (s.progress != null && (st === 'live' || st === 'done')) ? s.progress : (realRatio(id) ?? 0);
    n.pb.style.width = (p * 100) + '%'; n.fe.textContent = `${s.events.length} ev`;
  }
}
function tickFlow(dt) {
  const t = T();
  for (const id in FN) { const n = FN[id]; n.E *= Math.exp(-dt * .7); const live = BYID[id] && agentStatus(id) === 'live'; n.d.classList.toggle('hot', n.E > .25 || live); }
  for (const e of FE) {
    e.E *= Math.exp(-dt * .5);
    const liveSrc = BYID[e.from] && agentStatus(e.from) === 'live';
    const E = Math.max(e.E, liveSrc ? .35 : 0);
    e.flowL.setAttribute('stroke-dashoffset', (-t * (e.planned ? 10 : 26 + E * 70) * MOTION).toFixed(1));
    e.glow.setAttribute('opacity', (E * .9).toFixed(3)); e.base.setAttribute('opacity', e.planned ? .55 : (.4 + E * .6).toFixed(3));
    e.flowL.setAttribute('stroke-width', (2 + E * 1.5).toFixed(2));
    // travelling dots: steady trickle + bright packets after events
    e.pkt = e.pkt.filter(p => t - p < 1.4);
    e.dots.forEach((c, i) => {
      let u, op, r;
      if (e.pkt[i] != null && t >= e.pkt[i]) { u = (t - e.pkt[i]) / 1.4; op = 1; r = 4.2; c.setAttribute('fill', '#fff'); c.style.filter = `drop-shadow(0 0 6px ${e.col})`; }
      else if (!e.planned && MOTION) { u = ((t * (.18 + E * .5)) + i / 3 + (e.from.length * .13)) % 1; op = .25 + E * .6; r = 2.2; c.setAttribute('fill', e.col); c.style.filter = ''; }
      else { c.setAttribute('opacity', 0); return; }
      const pt = e.base.getPointAtLength(u * e.len); c.setAttribute('cx', pt.x.toFixed(1)); c.setAttribute('cy', pt.y.toFixed(1)); c.setAttribute('r', r); c.setAttribute('opacity', (op * Math.sin(Math.PI * Math.min(1, u)) ** .3).toFixed(2));
    });
  }
}
function setView(v, instant = false) {
  if (v === 'flow' && mode === 'outer') {
    mode = 'flow'; flowEl.classList.remove('hidden'); layoutFlow(); renderFlowCards();
    const d = instant ? .01 : .6 * DUR + .01;
    gsap.to(['#left', '#right', '#cards', '#labels', '#hint', '#pops'], { autoAlpha: 0, duration: d * .6 });
    gsap.fromTo('#flow', { autoAlpha: 0 }, { autoAlpha: 1, duration: d });
    gsap.fromTo('.fn', { scale: .85, opacity: 0 }, { scale: 1, opacity: (i, el) => el.classList.contains('sb') ? .5 : 1, duration: d, stagger: instant ? 0 : .04, ease: 'back.out(1.6)', clearProps: 'transform' });
    gsap.to(cam, { y: 9.5, z: 23, ty: 1.2, duration: instant ? .01 : 1.2 * DUR + .01, ease: 'power3.inOut' });
  } else if (v === 'core' && mode === 'flow') {
    mode = 'outer'; const d = instant ? .01 : .5 * DUR + .01;
    gsap.to('#flow', { autoAlpha: 0, duration: d, onComplete: () => flowEl.classList.add('hidden') });
    gsap.to(['#left', '#right', '#cards', '#labels', '#hint', '#pops'], { autoAlpha: 1, duration: d });
    gsap.to(cam, { x: HOME.x, y: HOME.y, z: HOME.z, ty: HOME.ty, duration: instant ? .01 : 1.1 * DUR + .01, ease: 'power3.inOut' });
    if (instant) { mode = 'outer'; flowEl.classList.add('hidden'); }
  }
  document.querySelectorAll('#viewsw span').forEach(s => s.classList.toggle('on', s.dataset.v === (mode === 'flow' ? 'flow' : 'core')));
}
document.querySelectorAll('#viewsw span').forEach(s => s.onclick = () => setView(s.dataset.v));

// =====================================================================================
// FRAME LOOP
// =====================================================================================
const wp = new THREE.Vector3(), par = { x: 0, y: 0 };
let uiAcc = 0;
$('#pcount').textContent = fmt(BN);
function project(v) { wp.copy(v).project(camera); return { x: (wp.x * .5 + .5) * innerWidth, y: (-wp.y * .5 + .5) * innerHeight, vis: wp.z < 1 }; }
function frame(dt, render = true) {
  const t = T(); U.uT.value = t; uiAcc += dt;
  if (document.body.dataset.mode !== mode) document.body.dataset.mode = mode;
  const anyLive = AGENTS.some(a => S[a.id].lastAt && Date.now() - S[a.id].lastAt < 180000 && S[a.id].lastType !== 'done');
  globalE = Math.max(anyLive ? .32 : .12, globalE * Math.exp(-dt * .5));
  const ge = Math.min(1, globalE);
  for (const a of AGENTS) {
    const s = S[a.id], st = agentStatus(a.id);
    const floor = st === 'live' ? .38 : st === 'sb' ? 0 : st === 'done' ? .2 : .07;
    s.E = Math.max(floor, s.E * Math.exp(-dt * .55));
    for (let k = 0; k < s.fire.length; k++) {
      s.boost[k] *= Math.exp(-dt * .22);
      const base = st === 'sb' ? .04 : (st === 'live' ? .14 : .08) + (k === s.activeRegion && st === 'live' ? .22 : 0);
      const target = Math.min(1, base + s.boost[k] + .04 * Math.sin(t * (1.1 + k * .37) + k) * MOTION);
      s.fire[k] += (target - s.fire[k]) * Math.min(1, dt * 2.5);
    }
  }
  if (outer.visible) {
    const spin = (mode === 'outer' || mode === 'flow') ? 1 : .15;
    net.rotation.y += dt * (.03 + ge * .1) * MOTION * spin;
    coreMat.uniforms.uE.value = Math.min(1, ge * (S[CORE.id].E > .5 ? 1.15 : 1));
    const pulse = 1 + .035 * Math.sin(t * 2.2) * MOTION;
    coreMesh.scale.setScalar(pulse + ge * .14);
    wire.rotation.y -= dt * (.1 + ge * .5) * MOTION; wire.rotation.x += dt * .05 * MOTION; wire.material.opacity = .18 + ge * .4;
    wire2.rotation.y += dt * (.07 + ge * .3) * MOTION; wire2.rotation.z -= dt * .04 * MOTION; wire2.material.opacity = .12 + ge * .3;
    coreGlow.material.opacity = .14 + ge * .3; coreGlow.scale.setScalar(5 + ge * 4.5 + Math.sin(t * 2.2) * .3);
    coreHot.material.opacity = .18 + ge * .4; coreHot.scale.setScalar(1.5 + ge * 1.8);
    rings.forEach((r, i) => { r.rotation.z += dt * (i % 2 ? -1 : 1) * (.05 + ge * .3) * MOTION; r.material.uniforms.uE.value = ge; });
    halo.material.uniforms.uE.value = ge; dust.material.uniforms.uE.value = ge; radar.material.uniforms.uE.value = ge;
    for (const id in NODES) {
      const N = NODES[id], s = S[id], st = agentStatus(id), E = s.E, hov = hoverId === id ? 1 : 0;
      const sb = st === 'sb';
      N.mat.color.copy(N.col).multiplyScalar(sb ? .25 : .45 + E * 1.6);
      N.glow.material.opacity = sb ? .12 + hov * .3 : .22 + E * .75 + hov * .25;
      N.glow.scale.setScalar((sb ? 1.1 : 1.5 + E * 2.2) + hov * .8 + .08 * Math.sin(t * 3 + N.pos.x) * MOTION);
      N.ball.scale.setScalar(1 + E * .55 + hov * .3);
      N.ringN.rotation.z += dt * (.4 + E * 2.5) * MOTION; N.ringN2.rotation.y += dt * (.25 + E * 1.5) * MOTION;
      N.ringN.material.uniforms.uE.value = sb ? 0 : E + hov; N.ringN2.material.uniforms.uE.value = sb ? 0 : E * .8 + hov;
      N.satG.rotation.y += dt * (.25 + E * 1.6) * MOTION;
      N.sats.forEach((q, k) => { const f = s.fire[k] || 0; q.sg.material.opacity = sb ? .12 : .25 + f * 1.1; q.sg.scale.setScalar(.35 + f * .9); });
      N.satLines.material.opacity = sb ? .1 : .2 + E * .5;
      N.strands.forEach(st2 => { st2.m.uniforms.uE.value = sb ? 0 : E; st2.m.uniforms.uB.value = sb ? .3 : 1; });
    }
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i], u = (t - p.t0) / p.dur;
      if (u > 1) { net.remove(p.sp); p.sp.material.dispose(); packets.splice(i, 1); continue; }
      if (u < 0) { p.sp.visible = false; continue; }
      p.sp.visible = true; p.curve.getPoint(p.inbound ? 1 - u : u, p.sp.position); p.sp.material.opacity = Math.sin(Math.PI * u); p.sp.scale.setScalar(.35 + .4 * Math.sin(Math.PI * u));
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i], u = (t - w.t0) / 1.6; if (u > 1) { outer.remove(w.m); w.m.geometry.dispose(); w.m.material.dispose(); waves.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - u, 3); w.m.scale.setScalar(.5 + e * w.scale); w.m.material.opacity = (1 - u) * (1 - u) * .45; w.m.quaternion.copy(camera.quaternion);
    }
  }
  if (inner.visible && curAgent) {
    const s = S[curAgent]; for (let k = 0; k < 6; k++) BU.uFire.value[k] = s.fire[k] ?? 0;
    BU.uE.value *= Math.exp(-dt * 1.2);
    inner.rotation.y += dt * (mode === 'inner' ? .05 : .22) * MOTION; 
    brainGlow.material.opacity = .14 + BU.uE.value * .2 + Math.max(...s.fire) * .12;
    innerRings.forEach((r, i) => r.rotation.z += dt * (i ? -.08 : .06) * MOTION);
    if (arcs) arcs.forEach(a => a.m.uniforms.uE.value = ((s.fire[a.i] || 0) + (s.fire[a.j] || 0)) * .5);
  }
  // camera
  if (mode === 'inner') { controls.update(); }
  else {
    const pk = (mode === 'outer' || mode === 'flow') ? 1 : 0;
    par.x += (mouse.x * .9 * pk * MOTION - par.x) * Math.min(1, dt * 1.5); par.y += (mouse.y * .5 * pk * MOTION - par.y) * Math.min(1, dt * 1.5);
    camera.position.set(cam.x + par.x, cam.y - par.y, cam.z); camera.lookAt(cam.tx, cam.ty, cam.tz);
    if (Math.abs(camera.fov - cam.fov) > .01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  }
  if (mode === 'inner' && Math.abs(camera.fov - 45) > .01) { camera.fov = 45; camera.updateProjectionMatrix(); }
  bloom.strength = (inner.visible ? .5 + BU.uE.value * .35 : .6 + ge * .42) + cam.boost;
  // HTML overlays
  if (outer.visible && mode !== 'toIn') {
    for (const a of AGENTS) {
      const el = LBL[a.id];
      const p = a.core ? project(wp.set(0, -1.75, 0)) : project(NODES[a.id].g.getWorldPosition(wp).add(new THREE.Vector3(0, -.62, 0)));
      el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,0)`;
      el.style.opacity = p.vis ? '' : 0;
      el.classList.toggle('hov', hoverId === a.id); el.classList.toggle('hot', S[a.id].E > .45);
    }
    for (const c of CARDS) {
      const x = c.sx * innerWidth - par.x * 26, y = c.sy * innerHeight + par.y * 14 + Math.sin(t * .6 + c.sx * 9) * 5 * MOTION;
      c.d.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
    }
  }
  if (inner.visible && RL.length) {
    const s = S[curAgent];
    const P = regionAnchors.map(v => project(wp.copy(v).applyMatrix4(inner.matrixWorld)));
    const order = P.map((p, k) => k).sort((a, b) => P[a].y - P[b].y);
    for (let it = 0; it < 3; it++) for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
      const A = P[order[i]], B = P[order[j]]; if (Math.abs(A.x - B.x) < 150 && Math.abs(A.y - B.y) < 46) { const push = (46 - Math.abs(A.y - B.y)) / 2; if (A.y <= B.y) { A.y -= push; B.y += push; } else { A.y += push; B.y -= push; } }
    }
    regionAnchors.forEach((v, k) => {
      const p = P[k];
      RL[k].d.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-100%)`;
      RL[k].d.classList.toggle('sel', k === selRegion); RL[k].d.classList.toggle('hot', s.fire[k] > .4);
    });
  }
  if (uiAcc > .25) {
    uiAcc = 0;
    if (inner.visible && curAgent) {
      const s = S[curAgent];
      RL.forEach((r, k) => r.em.textContent = Math.round(s.fire[k] * 100) + '%');
      document.querySelectorAll('[data-fe]').forEach(e => e.textContent = Math.round(s.fire[+e.dataset.fe] * 100) + '%');
      document.querySelectorAll('[data-fb]').forEach(e => e.style.width = (s.fire[+e.dataset.fb] * 100) + '%');
    }
    if (mode === 'flow') renderFlowCards();
    const d = new Date(); $('#clock').textContent = d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' });
    $('#coords').textContent = `${(net.rotation.y % 6.2832).toFixed(3).padStart(6, '0')} / ${ge.toFixed(3)}`;
  }
  if (mode === 'flow') tickFlow(dt);
  tickSubs();
  if (render) composer.render();
}
// fps meter
let fpsN = 0, fpsT = performance.now();
function fpsTick() { fpsN++; const n = performance.now(); if (n - fpsT > 1000) { $('#fps').textContent = Math.round(fpsN * 1000 / (n - fpsT)); fpsN = 0; fpsT = n; } }
// resize
function onResize() {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.resolution.set(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); drawChart(); if (mode === 'flow') layoutFlow();
}
addEventListener('resize', onResize);

// boot
let last = performance.now();
if (!CAPTURE) {
  renderer.setAnimationLoop(() => { const n = performance.now(); const dt = Math.min(.05, (n - last) / 1000); last = n; simMs += dt * 1000; frame(dt); fpsTick(); });
}
// capture API: deterministic frame stepping for recordings
window.__step = (frames = 1, ms = 1000 / 30) => {
  for (let i = 0; i < frames; i++) { simMs += ms; gsap.updateRoot(simMs / 1000); frame(ms / 1000, i === frames - 1); }
  return { mode, ev: window.__evCount || 0 };
};
window.__nodeScreen = id => { const p = BYID[id]?.core ? project(wp.set(0, 0, 0)) : project(NODES[id].g.getWorldPosition(wp)); return { x: p.x, y: p.y }; };
window.__enter = enterAgent; window.__exit = exitAgent; window.__view = setView; window.__mode = () => mode;
window.__flowNode = id => nodeBox(id);
// intro: fly in from deep space
gsap.to(cam, { x: HOME.x, y: HOME.y, z: HOME.z, duration: 2.6 * DUR + .01, ease: 'power3.out' });
gsap.from('#left', { x: -30, autoAlpha: 0, duration: .9 * DUR + .01, delay: .6 * DUR, ease: 'power3.out' });
gsap.from('#right', { x: 30, autoAlpha: 0, duration: .9 * DUR + .01, delay: .75 * DUR, ease: 'power3.out' });
camera.position.set(cam.x, cam.y, cam.z); camera.lookAt(0, 0, 0);
await loadData();
setInterval(loadData, (CFG.dataRefreshSeconds || 300) * 1000);
renderAgents(); renderHeat(); renderFlowCards();
say('JARVIS', CORE.color, 'Core online. Listening for agent events on the live stream.');
connect(true);
window.__ready = true;
window.__inject = (ev) => ingest({ id: 'local' + Math.random(), event: 'message', time: Date.now() / 1000, message: JSON.stringify(ev) }, true);
