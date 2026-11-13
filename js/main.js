// Director: kinematics, rider performance, camera, light, post. Everything is a pure function of time t → seek(t).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { V, clamp, lerp, smooth, smoother, ramp, win, easeInOut, TAU } from './util.js';
import { buildBike, R_TYRE, RATIO, R_RING, WB } from './bike.js';
import { buildOctopus } from './octopus.js';
import { buildCrab } from './crab.js';
import { buildWorld, makePath, LIGHTHOUSE } from './world.js';

const Q = new URLSearchParams(location.search);
const DURATION = 34, PR = Number(Q.get('pr') || 1.5);
const W = innerWidth, H = innerHeight;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(PR); renderer.setSize(W, H); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(new THREE.Color('#e3a982'), 0.00105);
const camera = new THREE.PerspectiveCamera(32, W / H, 0.02, 12000);

const path = makePath();
const world = buildWorld(renderer, scene, path);
const bike = buildBike(); scene.add(bike.root);
const octo = buildOctopus(bike); bike.root.add(octo.root);
const crab = buildCrab(); crab.root.position.set(0.075, 0.098, 0.05); crab.root.rotation.y = 0.25; bike.basket.add(crab.root);

// lights
const sun = new THREE.DirectionalLight(new THREE.Color('#ffd2a1'), 3.4); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.00012; sun.shadow.normalBias = 0.012;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(new THREE.Color('#bcd3ee'), new THREE.Color('#6d5a3c'), 0.35); scene.add(hemi);
const lampLight = new THREE.PointLight(new THREE.Color('#ffc27a'), 0, 9, 1.6); scene.add(lampLight);
const headLight = new THREE.SpotLight(new THREE.Color('#ffe2b0'), 0, 18, 0.45, 0.6, 1.4); scene.add(headLight, headLight.target);

// post
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W * PR, H * PR, { type: THREE.HalfFloatType, samples: 4 }));
composer.setPixelRatio(PR); composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bokeh = new BokehPass(scene, camera, { focus: 3, aperture: 0.002, maxblur: 0.008 }); composer.addPass(bokeh);
{ const r0 = bokeh.render.bind(bokeh); const hidden = []; bokeh.render = (...a) => { hidden.length = 0; scene.traverse((o) => { if ((o.isSprite || o.userData.noDepth) && o.visible) { o.visible = false; hidden.push(o); } }); r0(...a); hidden.forEach((o) => (o.visible = true)); }; }
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.26, 0.5, 1.08); composer.addPass(bloom);
{ const m = bloom.materialHighPassFilter; m.fragmentShader = m.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = texel.rgb / (1.0 + max(max(texel.r, texel.g), texel.b) / 6.0);'); m.needsUpdate = true; }
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 1 }, uRes: { value: new THREE.Vector2(W, H) }, uVig: { value: 0.32 }, uCA: { value: 0.0016 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: /* glsl */`uniform sampler2D tDiffuse; uniform float uTime, uFade, uVig, uCA; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453); }
    void main(){ vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 off = c * uCA * (1. + r2 * 4.);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col = mix(col, col * vec3(1.03, 1.0, 0.95), 0.6);                 // warm print
      col = col * (1. - uVig * smoothstep(0.08, 0.62, r2 * 1.6));       // vignette
      float l = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(l), col, 1.06); // gentle saturation
      col += (h(vUv * uRes) - 0.5) * 0.028;                              // grain
      gl_FragColor = vec4(col * uFade, 1.); }`,
}); composer.addPass(grade);

// ---------------- kinematics ----------------
const VKEY = [[0, 5.0], [7, 5.5], [13, 5.0], [17.5, 4.4], [19.6, 4.6], [21.5, 6.8], [24, 9.4], [25.8, 9.2], [28.5, 6.6], [34, 6.0]];
const vAt = (t) => { for (let i = 1; i < VKEY.length; i++) if (t <= VKEY[i][0]) { const [t0, v0] = VKEY[i - 1], [t1, v1] = VKEY[i]; return lerp(v0, v1, smooth((t - t0) / (t1 - t0))); } return VKEY[VKEY.length - 1][1]; };
const LETGO = (t) => win(t, 20.5, 26.1, 0.7, 0.8);
const S0 = 22, DT = 1 / 480, NT = Math.ceil(DURATION / DT) + 2;
const sT = new Float64Array(NT), crT = new Float64Array(NT);
{ let s = S0, c = 0.4; for (let i = 0; i < NT; i++) { sT[i] = s; crT[i] = c; const t = i * DT, v = vAt(t), engaged = 1 - smooth(clamp(LETGO(t) * 1.4)); s += v * DT; c += v / R_TYRE / RATIO * engaged * DT; } }
const tab = (arr, t) => { const f = clamp(t / DT, 0, NT - 2), i = Math.floor(f); return lerp(arr[i], arr[i + 1], f - i); };

// bike pose in the world for time t
const qY = new THREE.Quaternion(), qP = new THREE.Quaternion(), qL = new THREE.Quaternion(), X = V(1, 0, 0), Yax = V(0, 1, 0), Z = V(0, 0, 1);
function bikePose(t) {
  const s = tab(sT, t), v = vAt(t);
  const pr = path.at(s), pf = path.at(s + WB); pr.y = world.roadY(s); pf.y = world.roadY(s + WB);
  const h = pf.clone().sub(pr); const yaw = Math.atan2(-h.z, h.x), pitch = Math.atan2(h.y, Math.hypot(h.x, h.z));
  const k = path.curvature(s + 0.5);
  const lean = Math.atan(v * v * k / 9.81) + 0.006 * Math.sin(t * 1.9) + 0.004 * Math.sin(t * 5.3 + 1);
  const steer = -(Math.atan(WB * k) + 0.012 * Math.sin(t * 1.9 - 0.5));
  const vib = 0.0012 * Math.sin(t * 61) + 0.0008 * Math.sin(t * 97 + 2);
  qY.setFromAxisAngle(Yax, yaw); qP.setFromAxisAngle(Z, pitch); qL.setFromAxisAngle(X, lean);
  const q = qY.clone().multiply(qP).multiply(qL);
  return { s, v, pos: pr.clone().add(V(0, vib, 0)), q, yaw, pitch, lean, steer, k, crank: tab(crT, t) };
}

// ---------------- camera shots (follow frame: bike position, yaw only) ----------------
const SHOTS = [
  // t0, t1 (hold), pos, target, fov, focus(m) , aperture
  { t: [0, 3.4], p: (t) => V(1.72 - t * 0.035, 0.13, 0.62 + t * 0.01), g: () => V(1.08, 0.27, 0.0), fov: 30, ap: 0.006 },
  { t: [4.6, 8.0], p: (t) => V(lerp(0.95, 0.12, smooth((t - 4.2) / 4.6)), 0.36, 0.58), g: (t) => V(lerp(0.5, 0.32, smooth((t - 4.2) / 4.6)), 0.38, 0.06), fov: 34, ap: 0.005 },
  { t: [10.0, 12.6], p: (t) => V(0.7 + (t - 10) * 0.05, 1.0, 4.5), g: () => V(0.52, 0.85, 0), fov: 33, ap: 0.0008 },
  { t: [14.4, 18.6], p: (t) => V(2.9 - (t - 14.4) * 0.05, 1.28, 1.55 - (t - 14.4) * 0.06), g: () => V(0.42, 1.1, 0.02), fov: 30, ap: 0.0012 },
  { t: [20.0, 20.6], p: () => V(-3.4, 2.5, 1.4), g: () => V(2.0, 0.9, -0.3), fov: 38, ap: 0.0004 },
  { t: [22.2, 25.6], p: (t) => V(2.35 + 0.1 * Math.sin(t * 1.3), 1.32, 1.7 - (t - 22.2) * 0.08), g: () => V(0.3, 1.15, -0.05), fov: 40, ap: 0.0009 },
  { t: [28.6, 34], world: true, p: (t, B) => B.pos.clone().add(V(-12 - (t - 28.6) * 1.6, 7 + (t - 28.6) * 2.6, -11 - (t - 28.6) * 1.2)), g: (t, B) => B.pos.clone().lerp(V(LIGHTHOUSE.x, 8, LIGHTHOUSE.z), 0.3 + (t - 28.6) * 0.035), fov: 36, ap: 0 },
];
function shotState(sh, t, B, F) { // returns world pos/target
  const tt = clamp(t, sh.t[0] - 2.5, sh.t[1] + 2.5);
  if (sh.world) return { p: sh.p(tt, B), g: sh.g(tt, B), fov: sh.fov, ap: sh.ap };
  return { p: sh.p(tt).applyMatrix4(F), g: sh.g(tt).applyMatrix4(F), fov: sh.fov, ap: sh.ap };
}
function cameraAt(t, B) {
  // follow frame: smoothed yaw, no roll
  const s = B.s; const a = path.tan(s - 1.5), b = path.tan(s + 3); const hd = a.add(b).normalize();
  const F = new THREE.Matrix4().compose(B.pos.clone(), new THREE.Quaternion().setFromAxisAngle(Yax, Math.atan2(-hd.z, hd.x)), V(1, 1, 1));
  let i = SHOTS.findIndex((sh) => t <= sh.t[1]); if (i < 0) i = SHOTS.length - 1;
  const cur = SHOTS[i]; let st = shotState(cur, t, B, F);
  if (i > 0 && t < cur.t[0]) { const prev = SHOTS[i - 1]; const w = smoother((t - prev.t[1]) / (cur.t[0] - prev.t[1])); const ps = shotState(prev, t, B, F);
    // move on a cylinder around the rider so the camera never cuts through him
    let mid; const g = ps.g.clone().lerp(st.g, w);
    if (!prev.world && !cur.world) { const Fi = F.clone().invert(); const a = ps.p.clone().applyMatrix4(Fi), b = st.p.clone().applyMatrix4(Fi), C = V(0.5, 0, 0);
      const ra = Math.hypot(a.x - C.x, a.z), rb = Math.hypot(b.x - C.x, b.z); let aa = Math.atan2(a.z, a.x - C.x), ab = Math.atan2(b.z, b.x - C.x); if (ab - aa > Math.PI) ab -= TAU; if (aa - ab > Math.PI) ab += TAU;
      const an = lerp(aa, ab, w), rr = Math.max(lerp(ra, rb, w), 1.6 * Math.sin(w * Math.PI) + lerp(ra, rb, w) * (1 - Math.sin(w * Math.PI)));
      mid = V(C.x + Math.cos(an) * rr, lerp(a.y, b.y, w) + Math.sin(w * Math.PI) * 0.25, Math.sin(an) * rr).applyMatrix4(F); }
    else mid = ps.p.clone().lerp(st.p, w);
    st = { p: mid, g, fov: lerp(ps.fov, st.fov, w), ap: lerp(ps.ap, st.ap, w) }; }
  return { ...st, F };
}

// ---------------- performance (what the octopus does) ----------------
const BLINKS = [1.6, 5.9, 9.4, 12.2, 14.9, 19.3, 27.4, 30.2, 32.6];
const DINGS = [15.25, 15.5];
window.EVENTS = { dings: DINGS, letGo: [20.5, 26.1], sip: [17.2, 18.7], wave: [16.0, 17.6], title: 29.6 };
function perform(t, B, camLocal) {
  const S = { t, speed: B.v };
  const dv = (vAt(t + 0.05) - vAt(t - 0.05)) / 0.1;
  const wild = win(t, 20.9, 25.9, 0.8, 1.0), letGo = LETGO(t);
  S.letGo = letGo; S.wild = wild;
  S.flash = win(t, 21.4, 25.6, 0.7, 1.2) * 0.9; S.cloud = win(t, 9.5, 12.5, 0.8, 0.8) * 0.85 + win(t, 27.5, 29.5, 0.5, 0.8) * 0.5;
  S.blink = BLINKS.reduce((m, b) => Math.max(m, 1 - Math.abs(t - b) / 0.09), 0); S.blink = clamp(S.blink * 1.4);
  const sip = win(t, 17.2, 18.7, 0.45, 0.5); S.squint = Math.max(sip * 0.85, wild * 0.6); S.blush = sip * 0.8;
  S.look = win(t, 13.6, 18.9, 0.5, 0.5) > 0.01 || win(t, 22.3, 25.5, 0.4, 0.4) > 0.01 ? camLocal.clone().lerp(V(4, 1.2, 0), 1 - Math.max(win(t, 13.6, 18.9, 0.5, 0.5), win(t, 22.3, 25.5, 0.4, 0.4))) : null;
  S.bellReach = win(t, 14.9, 16.0, 0.35, 0.4);
  S.wave = win(t, 16.0, 17.7, 0.35, 0.45);
  const pedalPhase = B.crank * 2; S.sway = V(-dv * 0.012 + 0.006 * Math.sin(pedalPhase), 0.006 * Math.cos(pedalPhase) * (1 - letGo) + 0.01 * Math.sin(t * 2.6), 0.012 * Math.sin(pedalPhase * 0.5) * (1 - letGo)).add(V(0.02 * Math.sin(t * 11), 0.02 * Math.sin(t * 7.3), 0.035 * Math.sin(t * 9)).multiplyScalar(wild));
  // tea cup path
  const cupRest = V(0.5 + 0.01 * Math.sin(t * 3), 1.1 + 0.008 * Math.sin(B.crank * 2), 0.31), cupSip = V(0.395, 1.06, 0.13), cupUp = V(0.36, 1.62, 0.42);
  S.cupPos = cupRest.clone().lerp(cupSip, smooth(sip * 1.3)).lerp(cupUp, wild);
  S.cupUp = V(0, 1, 0).lerp(V(-0.6, 0.8, -0.3).normalize(), smooth(clamp((sip - 0.5) * 2))).normalize();
  // world up & apparent gravity in bike-local
  const qi = B.q.clone().invert(); S.worldUp = V(0, 1, 0).applyQuaternion(qi);
  const fwd = V(1, 0, 0).applyQuaternion(B.q), rt = V(0, 0, 1).applyQuaternion(B.q);
  S.gravity = V(0, 9.81, 0).addScaledVector(fwd, dv).addScaledVector(rt, B.v * B.v * B.k).applyQuaternion(qi).normalize();
  S.steam = 1 - wild * 0.7;
  S.puff = win(t, 21, 22, 0.2, 0.6);
  return S;
}

// ---------------- overlay text ----------------
const ov = { prompt: document.getElementById('prompt'), title: document.getElementById('title'), sub: document.getElementById('sub'), credit: document.getElementById('credit') };
function overlay(t) {
  const full1 = 'draw a ', word0 = 'pelican', word1 = 'octopus', tail = ' riding a bicycle';
  const typed = (str, t0, cps) => str.slice(0, Math.max(0, Math.floor((t - t0) * cps)));
  let html = '<span class="caret-ps">&gt;</span> ' + typed(full1, 0.5, 26);
  if (t > 0.5 + full1.length / 26) {
    const tw = 0.5 + full1.length / 26; const w0 = typed(word0, tw, 22);
    const strike = t > 2.05; const w1 = typed(word1, 2.25, 18);
    html += `<span class="${strike ? 'strike' : ''}">${w0}</span>` + (strike ? ` <span class="new">${w1}</span>` : '');
    if (t > 2.25 + word1.length / 18) html += typed(tail, 2.25 + word1.length / 18, 26);
  }
  const caret = Math.floor(t * 2.2) % 2 ? '<span class="caret">▍</span>' : '<span class="caret off">▍</span>';
  ov.prompt.innerHTML = html + caret; ov.prompt.style.opacity = String(win(t, 0.3, 4.6, 0.25, 0.6));
  const a = win(t, 29.6, 34.5, 1.0, 0.5); ov.title.style.opacity = String(a); ov.title.style.transform = `translateY(${(1 - smooth((t - 29.6) / 1.4)) * 18}px)`; ov.title.style.letterSpacing = `${lerp(0.12, 0.04, smooth((t - 29.6) / 3))}em`;
  ov.sub.style.opacity = String(win(t, 30.6, 34.5, 0.9, 0.5)); ov.credit.style.opacity = String(win(t, 31.4, 34.5, 0.9, 0.5));
}

// ---------------- seek ----------------
const tmpM = new THREE.Matrix4();
function seek(t) {
  t = clamp(t, 0, DURATION);
  const B = bikePose(t);
  bike.root.position.copy(B.pos); bike.root.quaternion.copy(B.q);
  const bellLever = DINGS.reduce((m, d) => m + Math.max(0, Math.sin(clamp((t - d) / 0.12) * Math.PI)) * -0.9, 0);
  const lamp = ramp(t, 27.2, 28.2);
  bike.update({ wheelR: B.s / R_TYRE, wheelF: (B.s + WB) / R_TYRE, crank: B.crank, chainS: B.crank * R_RING, steer: B.steer, bellLever, lamp: lamp * 3 });
  const cam = cameraAt(t, B);
  camera.position.copy(cam.p); camera.lookAt(cam.g);
  if (win(t, 21.2, 25.9, 0.6, 0.6) > 0) { const sh = win(t, 21.2, 25.9, 0.6, 0.6); camera.rotateZ(0.004 * Math.sin(t * 23) * sh); camera.position.y += 0.006 * Math.sin(t * 31) * sh; }
  camera.fov = cam.fov; camera.updateProjectionMatrix();
  bike.root.updateMatrixWorld(true);
  const cl = camera.position.clone().applyMatrix4(tmpM.copy(bike.root.matrixWorld).invert());
  const S = perform(t, B, cl);
  octo.update(S);
  crab.update(t, { wave: Math.max(S.wild, win(t, 15.2, 16.4, 0.3, 0.4) * 0.6), lookYaw: 0 });

  // sun & sky
  const elev = lerp(8.5, 2.6, t / DURATION), sd = world.setSun(elev, 124);
  sun.position.copy(B.pos).addScaledVector(sd, 60); sun.target.position.copy(B.pos); sun.color.setRGB(1, lerp(0.84, 0.72, t / DURATION), lerp(0.66, 0.5, t / DURATION)); sun.intensity = lerp(3.6, 2.6, t / DURATION);
  const wide = cam.p.distanceTo(B.pos); const ext = clamp(wide * 0.9, 2.2, 26);
  const sc = sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 140; sc.updateProjectionMatrix();
  scene.fog.color.setRGB(lerp(0.89, 0.9, t / DURATION), lerp(0.66, 0.56, t / DURATION), lerp(0.5, 0.45, t / DURATION));
  const envKey = Math.round(t * 2); if (envKey !== world._envKey) { world._envKey = envKey; world.updateEnv(); } scene.environmentIntensity = lerp(1.0, 0.8, t / DURATION);
  hemi.intensity = lerp(0.35, 0.25, t / DURATION);
  // lamps switch on one after another, nearest first
  world.lamps.forEach((L) => { const on = ramp(t, 27.0 + Math.abs(L.s - B.s) * 0.012, 27.5 + Math.abs(L.s - B.s) * 0.012); L.glass.emissiveIntensity = on * 4 * (0.97 + 0.03 * Math.sin(t * 40 + L.k)); });
  const nearL = world.lamps.reduce((a, b) => (Math.abs(b.s - B.s - 6) < Math.abs(a.s - B.s - 6) ? b : a)); lampLight.position.copy(nearL.g.localToWorld(V(0, 3.45, -0.86))); lampLight.intensity = ramp(t, 27, 27.6) * 6;
  headLight.intensity = lamp * 25; headLight.position.copy(bike.lamp.getWorldPosition(V())); headLight.target.position.copy(B.pos).addScaledVector(V(1, 0, 0).applyQuaternion(B.q), 8);
  world.lantern.material.emissiveIntensity = lerp(0.4, 3, ramp(t, 26, 29)); world.beamM.opacity = ramp(t, 27, 29.5) * 0.05; world.beam.rotation.y = t * 1.2;
  world.tick(t, { gullCenter: B.pos.clone().add(V(10, 8, -6)) });

  // post
  const fd = cam.p.distanceTo(cam.g); bokeh.uniforms.focus.value = fd; bokeh.uniforms.aperture.value = cam.ap; bokeh.uniforms.maxblur.value = 0.012; bokeh.enabled = cam.ap > 0.0002;
  grade.uniforms.uTime.value = t; grade.uniforms.uFade.value = ramp(t, 0, 0.6) * (1 - ramp(t, DURATION - 0.5, DURATION));
  overlay(t);
  composer.render();
}

// keep the frame filled when the window changes size (the film itself is time-driven, so nothing else needs it)
addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight; if (!w || !h) return;
  renderer.setSize(w, h); composer.setSize(w, h); grade.uniforms.uRes.value.set(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
});

window.DURATION = DURATION; window.seek = seek; window.__dbg = { bloom, bokeh, scene, grade, world, sun, camera, renderer, octo, bike };
window.debugState = (t) => { const B = bikePose(t); return { s: B.s, v: B.v, lean: B.lean, steer: B.steer, crank: B.crank, pos: B.pos.toArray() }; };
seek(Number(Q.get('t') || 0));
window.ready = true;
// in a normal browser the film plays in a loop; ?t=<sec> holds one frame, and the headless renderer drives seek() itself
if (!navigator.webdriver && !Q.has('t') && Q.get('play') !== '0') { const s0 = performance.now(); const loop = () => { seek(((performance.now() - s0) / 1000) % DURATION); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
