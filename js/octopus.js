// The rider: a common octopus with a living skin shader, eight procedural arms (rebuilt every frame), ~1000 suckers,
// eyes with horizontal pupils that stay level with the horizon, goggles, knitted scarf and a cup of tea.
// Everything lives in bike-local coordinates (+X forward, +Y up, +Z right).
import * as THREE from 'three';
import { TAU, V, clamp, lerp, smooth, DynTube, GLSL_NOISE, canvasTex, rng, cyl } from './util.js';

const SEGS = 110, RAD = 16;
export const ARM_ROLES = ['gripL', 'gripR', 'bell', 'tea', 'pedalL', 'pedalR', 'seat', 'free'];
const ARM_ANG = [-28, 28, -70, 70, -116, 116, -156, 156].map((d) => d * Math.PI / 180);

// ---------- skin ----------
export function makeSkin({ base = 1 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.42, metalness: 0, clearcoat: 0.28, clearcoatRoughness: 0.38, sheen: 0.22, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ff9a7a') });
  const U = { uTime: { value: 0 }, uFlash: { value: 0 }, uCloud: { value: 0 }, uBlush: { value: 0 } };
  m.userData.U = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aPat; attribute float aUnder; varying vec3 vPat; varying float vUnder;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = aPat; vUnder = aUnder;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime, uFlash, uCloud, uBlush; varying vec3 vPat; varying float vUnder;\n' + GLSL_NOISE + '\nvec3 gSkin; float gU; float gRing;')
      .replace('#include <color_fragment>', /* glsl */`
        vec3 P = vPat;
        float n = fbm3(P * 0.55);
        float wo = worley(P * 1.05 + n * 0.7);
        float blot = 1.0 - smoothstep(0.16, 0.44, wo);
        float speck = 1.0 - smoothstep(0.04, 0.15, worley(P * 3.3 + 7.0));
        vec3 top = mix(vec3(0.42, 0.055, 0.035), vec3(0.78, 0.2, 0.075), smoothstep(-0.35, 0.45, n));
        top = mix(top, vec3(0.22, 0.025, 0.02), blot * 0.65);
        top = mix(top, vec3(1.0, 0.74, 0.58), speck * 0.42);
        vec3 under = mix(vec3(0.9, 0.66, 0.56), vec3(0.84, 0.5, 0.44), smoothstep(0.0, 0.6, n + 0.3));
        float u = smoothstep(0.45, 0.95, vUnder);
        vec3 col = mix(top, under, u * 0.88);
        float band = smoothstep(0.35, 1.0, sin(P.x * 1.3 + P.z * 0.5 + n * 1.5 - uTime * 7.0));
        col = mix(col, col * vec3(0.25, 0.18, 0.2), band * uCloud * (1.0 - u * 0.7));
        // excitement display: skin flushes deep red↔pale in travelling waves and electric blue rings light up
        float wave = 0.5 + 0.5 * sin(P.x * 0.9 + P.y * 0.35 - uTime * 9.0 + n * 3.0);
        col = mix(col, mix(vec3(0.95, 0.83, 0.74), vec3(0.32, 0.03, 0.03), wave), uFlash * 0.55 * (1.0 - u * 0.6));
        float wr = worley(P * 0.9 + 3.1); float ring = smoothstep(0.05, 0.0, abs(wr - 0.3)) ; float pulse = 0.55 + 0.45 * sin(uTime * 14.0 + wr * 9.0);
        gRing = ring * uFlash * pulse * (1.0 - u * 0.8);
        col = mix(col, vec3(0.1, 0.55, 1.0), gRing * 0.8);
        col = mix(col, vec3(1.0, 0.45, 0.5), uBlush * 0.25);
        gSkin = col; gU = u;
        diffuseColor.rgb = col;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        float hb = (1.0 - smoothstep(0.0, 0.32, worley(P * 2.4))) * (1.0 - gU * 0.8) + fbm3(P * 6.0) * 0.35;
        normal = bumpNormal(-vViewPosition, normal, hb, 0.012);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.48, 0.3, gU) - 0.08 * blot;')
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5);
        totalEmissiveRadiance += gSkin * 0.03 + vec3(0.9, 0.22, 0.12) * fr * 0.035 + vec3(0.15, 0.6, 1.4) * gRing * 2.2;`);
  };
  m.customProgramCacheKey = () => 'octoskin';
  return m;
}

function makeEyeTexture() {
  const w = 1024, h = 512; const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); const img = g.createImageData(w, h); const R = rng(9);
  const streak = Array.from({ length: 720 }, () => R());
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const th = y / h * Math.PI, ph = x / w * TAU; const px = th * Math.cos(ph), py = th * Math.sin(ph); // tangent-plane coords around the pole
    let col;
    const pr = Math.pow(Math.pow(Math.abs(px) / 0.30, 4) + Math.pow(Math.abs(py) / 0.105, 4), 0.25); // rounded-rectangle pupil, wide along px
    const ir = th / 0.62;
    if (pr < 1) col = [8, 6, 6];
    else if (ir < 1) { const s = streak[Math.floor(ph / TAU * 720) % 720]; const k = 0.75 + 0.35 * s; const ring = ir > 0.88 ? 0.55 : 1;
      const gold = [225 * k * ring, 160 * k * ring, 45 * k * ring]; const inner = clamp((pr - 1) / 0.6); col = gold.map((v, i) => v * (0.7 + 0.3 * inner) + [40, 20, 0][i] * (1 - inner)); }
    else { const t = clamp((th - 0.62) / 1.2); col = [lerp(235, 205, t), lerp(225, 185, t), lerp(190, 160, t)]; const vein = Math.sin(ph * 9 + th * 14) > 0.97 ? 0.85 : 1; col = col.map((v) => v * vein); }
    const i = (y * w + x) * 4; img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------- geometry helpers ----------
const _a = V(), _b = V(), _c = V();
function orthoN(n, t) { return n.addScaledVector(t, -n.dot(t)).normalize(); }
function catmull(pts, out, n) { // centripetal Catmull-Rom through pts → n samples
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); return curve.getSpacedPoints(n - 1);
}
function resample(dense, denseN, count) { // arc-length resample points & normals
  const cum = [0]; for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dense[i].distanceTo(dense[i - 1]));
  const L = cum[cum.length - 1], P = [], N = []; let k = 0;
  for (let i = 0; i < count; i++) { const s = L * i / (count - 1); while (k < dense.length - 2 && cum[k + 1] < s) k++; const f = (s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
    P.push(dense[k].clone().lerp(dense[k + 1], f)); N.push(denseN[k].clone().lerp(denseN[k + 1], f)); }
  return { P, N, L };
}
// wrap around a cylinder: centre c, axis a, radius r. Arrives from 'from'. Returns {pts, nrm}
function coil(c, a, r, turns, pitch, from, n = 60, ell = null) {
  const tb = from.clone().sub(c); tb.addScaledVector(a, -tb.dot(a)); if (tb.lengthSq() < 1e-8) tb.set(0, 1, 0).addScaledVector(a, -a.y); tb.normalize();
  let e1 = new THREE.Vector3().crossVectors(a, tb).normalize(), e2 = new THREE.Vector3().crossVectors(a, e1);
  let ph0 = 0, rx = r, ry = r;
  if (ell) { const X = ell.x.clone(), Y = new THREE.Vector3().crossVectors(a, X).normalize(); const pa = Math.atan2(e1.dot(Y), e1.dot(X)); e1 = X; e2 = Y; ph0 = pa; rx = ell.rx; ry = ell.ry; }
  const pts = [], nrm = [];
  for (let i = 0; i <= n; i++) { const f = i / n, ph = ph0 + f * turns * TAU; const k = 1 - 0.12 * f;
    const d = e1.clone().multiplyScalar(Math.cos(ph) * rx * k).addScaledVector(e2, Math.sin(ph) * ry * k);
    pts.push(c.clone().addScaledVector(a, pitch * (f - 0.5) * turns).add(d)); nrm.push(e1.clone().multiplyScalar(-Math.cos(ph) / rx).addScaledVector(e2, -Math.sin(ph) / ry).normalize()); }
  return { pts, nrm, approach: pts[0].clone().addScaledVector(tb, 0.09).addScaledVector(e1, 0.01) };
}

export function buildOctopus(bike) {
  const root = new THREE.Group(); root.name = 'octopus';
  const skin = makeSkin(); const U = skin.userData.U;
  const R = rng(42);

  // ---------------- body (head + mantle) on a bending spine ----------------
  const NU = 140, NV = 96;
  const bodyG = new THREE.BufferGeometry();
  const bp = new Float32Array((NU + 1) * (NV + 1) * 3), bpat = new Float32Array((NU + 1) * (NV + 1) * 3), bund = new Float32Array((NU + 1) * (NV + 1));
  const bidx = []; for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; bidx.push(a, a + 1, b, b, a + 1, b + 1); }
  bodyG.setIndex(bidx); bodyG.setAttribute('position', new THREE.BufferAttribute(bp, 3).setUsage(THREE.DynamicDrawUsage));
  bodyG.setAttribute('aPat', new THREE.BufferAttribute(bpat, 3)); bodyG.setAttribute('aUnder', new THREE.BufferAttribute(bund, 1));
  const uvs = new Float32Array((NU + 1) * (NV + 1) * 2); for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) { uvs[(i * (NV + 1) + j) * 2] = j / NV; uvs[(i * (NV + 1) + j) * 2 + 1] = i / NU; }
  bodyG.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const body = new THREE.Mesh(bodyG, skin); body.castShadow = body.receiveShadow = true; body.frustumCulled = false; root.add(body);

  const PROF = [[0, 0], [0.025, 0.05], [0.07, 0.083], [0.15, 0.104], [0.27, 0.122], [0.38, 0.116], [0.5, 0.138], [0.64, 0.166], [0.78, 0.16], [0.88, 0.132], [0.95, 0.088], [0.985, 0.045], [1, 0]];
  const prof = (u) => { for (let i = 1; i < PROF.length; i++) if (u <= PROF[i][0]) { const [u0, r0] = PROF[i - 1], [u1, r1] = PROF[i]; const f = smooth((u - u0) / (u1 - u0)); return lerp(r0, r1, f); } return 0; };
  const endF = (u) => Math.sqrt(clamp(u / 0.025)) * Math.sqrt(clamp((1 - u) / 0.04));
  const SP0 = [V(0.245, 0.985, 0), V(0.248, 1.07, 0), V(0.252, 1.16, 0), V(0.238, 1.25, 0), V(0.195, 1.34, 0), V(0.125, 1.425, 0), V(0.05, 1.49, 0), V(-0.015, 1.535, 0)];
  const spine = new THREE.CatmullRomCurve3(SP0.map((p) => p.clone()), false, 'centripetal');
  const EYE_U = 0.3, EYE_PH = 0.82;
  const angDist = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
  const bulge = (u, ph) => { let s = 0; for (const e of [-EYE_PH, EYE_PH]) s += Math.exp(-((u - EYE_U) ** 2) / 0.0035 - angDist(ph, e) ** 2 / 0.16); // eye turrets
    s += 0.25 * Math.exp(-((u - 0.43) ** 2) / 0.002 - ph ** 2 / 0.6); // brow ridge
    return s * 0.03; };
  // width/depth ratio: heads are wider than deep
  const wz = (u) => lerp(1.0, 1.18, Math.exp(-((u - 0.3) ** 2) / 0.03)) * lerp(1, 0.94, smooth((u - 0.55) / 0.3));
  const lump = new Float32Array((NU + 1) * (NV + 1)); for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) { const u = i / NU, ph = j / NV * TAU; lump[i * (NV + 1) + j] = (Math.sin(u * 23 + Math.cos(ph * 3) * 2) * Math.sin(ph * 5 + u * 7) * 0.5 + Math.sin(u * 41 + ph * 9) * 0.3) * 0.0022; }
  const frameAt = (u, T, N, Z) => { spine.getTangentAt(clamp(u, 0, 1), T); Z.set(0, 0, 1); N.crossVectors(T, Z).normalize(); Z.crossVectors(N, T).normalize(); };
  const surfPoint = (u, ph, out, breathe = 1) => { const T = V(), N = V(), Z = V(); const c = spine.getPointAt(clamp(u, 0, 1)); frameAt(u, T, N, Z);
    const r = (prof(u) * (u > 0.45 ? breathe : 1) + bulge(u, ph)) * endF(u); const d = N.clone().multiplyScalar(Math.cos(ph)).addScaledVector(Z, Math.sin(ph) * wz(u));
    return out.copy(c).addScaledVector(d, r); };
  let restDone = false;
  function updateBody(sway, breathe) {
    for (let k = 0; k < SP0.length; k++) { const w = Math.pow(k / (SP0.length - 1), 2); spine.points[k].copy(SP0[k]).addScaledVector(sway, w); }
    spine.updateArcLengths();
    const T = V(), N = V(), Z = V(), c = V(), d = V();
    for (let i = 0; i <= NU; i++) {
      const u = i / NU; spine.getPointAt(u, c); frameAt(u, T, N, Z);
      const br = u > 0.45 ? lerp(1, breathe, smooth((u - 0.45) / 0.2)) : 1;
      for (let j = 0; j <= NV; j++) { const ph = j / NV * TAU, k = i * (NV + 1) + j;
        const r = (prof(u) * br + bulge(u, ph) + lump[k]) * endF(u);
        d.copy(N).multiplyScalar(Math.cos(ph)).addScaledVector(Z, Math.sin(ph) * wz(u));
        bp[k * 3] = c.x + d.x * r; bp[k * 3 + 1] = c.y + d.y * r; bp[k * 3 + 2] = c.z + d.z * r;
        if (!restDone) { bpat[k * 3] = bp[k * 3] * 9; bpat[k * 3 + 1] = bp[k * 3 + 1] * 9; bpat[k * 3 + 2] = bp[k * 3 + 2] * 9 + 3; bund[k] = clamp(1 - u / 0.12) * 0.7; } }
    }
    restDone = true; bodyG.attributes.position.needsUpdate = true; bodyG.computeVertexNormals();
  }

  // ---------------- eyes ----------------
  const eyeTex = makeEyeTexture();
  const eyeMat = new THREE.MeshPhysicalMaterial({ map: eyeTex, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.02 });
  const eyes = [-1, 1].map((s) => {
    const g = new THREE.Group(); root.add(g);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.047, 48, 32), eyeMat); ball.castShadow = true; g.add(ball);
    const lidGeoU = new THREE.SphereGeometry(0.0505, 40, 16, 0, TAU, 0, Math.PI * 0.52), lidGeoD = new THREE.SphereGeometry(0.0502, 40, 12, 0, TAU, Math.PI * 0.6, Math.PI * 0.4);
    for (const lg of [lidGeoU, lidGeoD]) { const n = lg.attributes.position.count; const pat = new Float32Array(n * 3), un = new Float32Array(n); for (let i = 0; i < n; i++) { pat[i * 3] = lg.attributes.position.getX(i) * 30 + s * 5; pat[i * 3 + 1] = lg.attributes.position.getY(i) * 30; pat[i * 3 + 2] = lg.attributes.position.getZ(i) * 30; un[i] = 0; } lg.setAttribute('aPat', new THREE.BufferAttribute(pat, 3)); lg.setAttribute('aUnder', new THREE.BufferAttribute(un, 1)); }
    const lidU = new THREE.Mesh(lidGeoU, skin), lidD = new THREE.Mesh(lidGeoD, skin); lidU.castShadow = true; g.add(lidU); g.add(lidD);
    // little horn papillae above the eye ("eyebrows")
    const horns = [];
    for (const k of [0, 1]) { const hg = new THREE.ConeGeometry(0.0065 - k * 0.0015, 0.022 - k * 0.006, 12); hg.translate(0, (0.022 - k * 0.006) / 2, 0); const n = hg.attributes.position.count; hg.setAttribute('aPat', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => hg.attributes.position.array[i] * 40), 3)); hg.setAttribute('aUnder', new THREE.BufferAttribute(new Float32Array(n), 1));
      const hm = new THREE.Mesh(hg, skin); hm.castShadow = true; root.add(hm); horns.push(hm); }
    return { s, g, ball, lidU, lidD, horns };
  });

  // ---------------- goggles ----------------
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a25a', metalness: 1, roughness: 0.22 });
  const strapM = new THREE.MeshStandardMaterial({ color: '#3d2416', roughness: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#9fd8ff', metalness: 0, roughness: 0.02, transmission: 0.6, thickness: 0.004, transparent: true, opacity: 0.55, clearcoat: 1, ior: 1.5, iridescence: 0.6, iridescenceIOR: 1.6 });
  const goggles = new THREE.Group(); root.add(goggles);
  const lenses = [-1, 1].map((s) => { const g = new THREE.Group(); goggles.add(g);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.024, 40, 1, true), brass); rim.rotation.x = Math.PI / 2; rim.castShadow = true; g.add(rim);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0305, 0.004, 10, 40), brass); ring.position.z = 0.012; g.add(ring);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.03, 32, 12, 0, TAU, 0, Math.PI * 0.32), glass); lens.rotation.x = Math.PI / 2; lens.position.z = -0.016; g.add(lens);
    return g; });
  const strapT = new DynTube(96, 8, strapM, { caps: false }); strapT.mesh.castShadow = true; root.add(strapT.mesh);
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 24, Math.PI), brass); goggles.add(bridge);

  // ---------------- scarf ----------------
  const knit = canvasTex(512, 128, (g, w, h) => {
    const cols = ['#f1b43c', '#f1b43c', '#fff1d6', '#2f6f8f', '#fff1d6']; const bw = w / 10;
    for (let i = 0; i < 10; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(i * bw, 0, bw + 1, h); }
    g.globalAlpha = 0.25; for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { g.fillStyle = '#000'; g.beginPath(); g.ellipse(x + 4, y + 4, 3.5, 2, (x / 8 + y / 8) % 2 ? 0.6 : -0.6, 0, TAU); g.fill(); }
  }, { repeat: [1, 1] });
  knit.wrapS = knit.wrapT = THREE.RepeatWrapping;
  const scarfM = new THREE.MeshStandardMaterial({ map: knit, bumpMap: knit, bumpScale: 1.5, roughness: 0.95, side: THREE.DoubleSide });
  const knit2 = knit.clone(); knit2.repeat.set(9, 1); knit2.needsUpdate = true; const collarM = new THREE.MeshStandardMaterial({ map: knit2, bumpMap: knit2, bumpScale: 1.5, roughness: 0.95 });
  const collarT = new DynTube(120, 18, collarM, { caps: false }); collarT.mesh.castShadow = true; collarT.mesh.receiveShadow = true; root.add(collarT.mesh); const collar = { material: collarM };
  const TAILN = 34;
  const tails = [0, 1].map((k) => { const g = new THREE.BufferGeometry(); const pos = new Float32Array((TAILN + 1) * 2 * 3), uv = []; const idx = [];
    for (let i = 0; i <= TAILN; i++) { uv.push(i / TAILN * 3, 0, i / TAILN * 3, 1); if (i < TAILN) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, scarfM); m.castShadow = true; m.frustumCulled = false; root.add(m); return { g, pos, m, len: k ? 0.46 : 0.56, w: 0.075 }; });
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12), collar.material); knot.castShadow = true; root.add(knot);

  // ---------------- teacup ----------------
  const porcelain = new THREE.MeshPhysicalMaterial({ color: '#fbfaf6', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0.2 });
  const gold = new THREE.MeshStandardMaterial({ color: '#e2b65a', metalness: 1, roughness: 0.2 });
  const cup = new THREE.Group(); root.add(cup);
  { const pr = [[0, 0], [0.022, 0], [0.024, 0.004], [0.028, 0.012], [0.036, 0.04], [0.041, 0.062], [0.0395, 0.064], [0.0345, 0.042], [0.027, 0.016], [0.02, 0.008], [0, 0.008]].map(([x, y]) => new THREE.Vector2(x, y));
    const body = new THREE.Mesh(new THREE.LatheGeometry(pr, 48), porcelain); body.castShadow = true; cup.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0402, 0.0017, 8, 60), gold); rim.rotation.x = Math.PI / 2; rim.position.y = 0.063; cup.add(rim);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0305, 0.006, 48, 1, true), new THREE.MeshPhysicalMaterial({ color: '#2f6f8f', roughness: 0.2, clearcoat: 1 })); band.position.y = 0.035; band.scale.setScalar(1.035); cup.add(band);
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 10, 30, Math.PI * 1.25), porcelain); h.position.set(0.041, 0.036, 0); h.rotation.z = -Math.PI * 0.62; cup.add(h);
    const tea = new THREE.Mesh(new THREE.CircleGeometry(0.0375, 40), new THREE.MeshPhysicalMaterial({ color: '#7a3a10', roughness: 0.05, clearcoat: 1, transmission: 0 })); tea.rotation.x = -Math.PI / 2; tea.position.y = 0.05; cup.add(tea); cup.userData.tea = tea; }
  // steam wisps
  const steamTex = canvasTex(128, 128, (g, w) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }, { srgb: true });
  const steam = Array.from({ length: 14 }, (_, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 })); s.userData.ph = i / 14; root.add(s); return s; });

  // ---------------- siphon ----------------
  const siphonG = new THREE.CylinderGeometry(0.012, 0.024, 0.07, 20, 4, true); siphonG.translate(0, 0.035, 0);
  { const n = siphonG.attributes.position.count; siphonG.setAttribute('aPat', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => siphonG.attributes.position.array[i] * 30), 3)); siphonG.setAttribute('aUnder', new THREE.BufferAttribute(new Float32Array(n).fill(0.5), 1)); }
  const siphon = new THREE.Mesh(siphonG, skin); siphon.castShadow = true; root.add(siphon);

  // ---------------- arms ----------------
  const radAt = (s) => 0.0035 + 0.031 * Math.pow(1 - s, 1.25) + 0.024 * Math.pow(clamp(1 - s / 0.09), 2);
  const suckerMat = new THREE.MeshPhysicalMaterial({ color: '#dca192', roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4, sheen: 0.6, sheenColor: new THREE.Color('#ffd6c8') });
  const suckerGeo = (() => { const pr = [[0, -0.2], [0.75, -0.2], [1.0, 0.05], [1.0, 0.25], [0.86, 0.42], [0.62, 0.38], [0.42, 0.18], [0.2, 0.12], [0, 0.13]].map(([x, y]) => new THREE.Vector2(x, y)); return new THREE.LatheGeometry(pr, 18); })();
  const suckerS = []; { let s = 0.06; let k = 0; while (s < 0.985) { suckerS.push({ s, side: k % 2 ? 1 : -1 }); s += Math.max(0.0055, radAt(s) * 0.78); k++; } }
  const arms = ARM_ANG.map((ang, i) => {
    const tube = new DynTube(SEGS, RAD, skin);
    const pat = new Float32Array((SEGS + 1) * (RAD + 1) * 3 + 3);
    for (let a = 0; a <= SEGS; a++) for (let b = 0; b <= RAD; b++) { const k = a * (RAD + 1) + b, th = b / RAD * TAU, r = radAt(a / SEGS) * 9; pat[k * 3] = a / SEGS * 9.5 + i * 13.7; pat[k * 3 + 1] = Math.cos(th) * r; pat[k * 3 + 2] = Math.sin(th) * r + i * 3.1; }
    tube.geometry.setAttribute('aPat', new THREE.BufferAttribute(pat, 3));
    tube.mesh.castShadow = tube.mesh.receiveShadow = true; root.add(tube.mesh);
    const sk = new THREE.InstancedMesh(suckerGeo, suckerMat, suckerS.length); sk.castShadow = true; sk.frustumCulled = false; root.add(sk);
    const rads = Array.from({ length: SEGS + 1 }, (_, a) => radAt(a / SEGS));
    return { i, ang, role: ARM_ROLES[i], tube, sk, rads, side: Math.sign(Math.sin(ang)) || 1, seed: R() * 10 };
  });

  // ---------------- per-frame pose ----------------
  const crownC = V(0.245, 1.0, 0);
  function armBase(arm, sway) { const a = arm.ang; const out = V(Math.cos(a), 0, Math.sin(a));
    const B = crownC.clone().addScaledVector(out, 0.068).add(V(0, 0.005, 0)).addScaledVector(sway, 0.02);
    const D = out.clone().multiplyScalar(0.9).add(V(0, -0.45, 0)).normalize(); const N0 = out.clone().negate().add(V(0, -0.8, 0)).normalize(); return { B, D, N0, out }; }

  // curve that ends wrapped around something
  function wrapPose(arm, base, ctrl, target) {
    const { B, D, N0 } = base;
    const cw = coil(target.c, target.a, target.r, target.turns, target.pitch ?? 0.03, ctrl[ctrl.length - 1] ?? B, 48, target.ell);
    const pts = [B, B.clone().addScaledVector(D, 0.07), ...ctrl, cw.approach, ...cw.pts];
    const dense = new THREE.CatmullRomCurve3(pts, false, 'centripetal').getSpacedPoints(360);
    // underside: blend from base normal to the coil's inward normal; coil part uses the exact inward normal
    const cStart = dense.findIndex((p) => p.distanceTo(cw.pts[0]) < 0.004) ; const cs = cStart > 0 ? cStart : Math.floor(dense.length * 0.7);
    const nEnd = cw.nrm[0];
    const denseN = dense.map((p, k) => { if (k >= cs) { const f = (k - cs) / Math.max(1, dense.length - 1 - cs); return cw.nrm[Math.min(cw.nrm.length - 1, Math.round(f * (cw.nrm.length - 1)))].clone(); } const f = smooth(k / cs); return N0.clone().lerp(nEnd, f).normalize(); });
    return resample(dense, denseN, SEGS + 1);
  }
  // free arm by integrating curvature (a "turtle"): goal direction, waves, curled tip
  function freePose(arm, base, P) {
    const { B, D, N0 } = base; const L = P.len ?? 0.95, n = SEGS + 1, ds = L / (n - 1);
    const pts = [B.clone()], nrm = [], dir = D.clone(), nv = orthoN(N0.clone(), dir); const side = V();
    for (let k = 1; k < n; k++) {
      const s = k / (n - 1);
      dir.lerp(P.goal, (P.pull ?? 0.05) * (1 - s * 0.6)).normalize(); if (P.wind) dir.addScaledVector(P.wind, ds * 2.2 * s).normalize();
      side.crossVectors(dir, nv).normalize();
      const w = (P.amp ?? 0.4) * Math.sin((P.t ?? 0) * (P.freq ?? 4) - s * (P.k ?? 7) + arm.seed) * (0.3 + s);
      const w2 = (P.amp2 ?? 0.25) * Math.sin((P.t ?? 0) * (P.freq ?? 4) * 0.73 - s * 5 + arm.seed * 2) * s;
      const curl = (P.curl ?? 9) * Math.pow(s, 3);
      dir.applyAxisAngle(side, (w + curl) * ds * 6 * -1).normalize(); dir.applyAxisAngle(nv, w2 * ds * 6).normalize();
      orthoN(nv, dir);
      pts.push(pts[k - 1].clone().addScaledVector(dir, ds));
    }
    for (let k = 0; k < n; k++) nrm.push(k ? null : orthoN(N0.clone(), D));
    // recompute normals as the inside of the curve, smoothed, falling back to N0
    const N = []; let prev = nrm[0];
    for (let k = 0; k < n; k++) { const a = pts[Math.max(0, k - 1)], b = pts[k], c = pts[Math.min(n - 1, k + 1)]; const t = c.clone().sub(a).normalize(); const kv = a.clone().add(c).multiplyScalar(0.5).sub(b);
      let nn = kv.lengthSq() > 1e-10 ? kv.normalize() : prev.clone(); nn = prev.clone().lerp(nn, 0.25); orthoN(nn, t); N.push(nn); prev = nn; }
    return { P: pts, N, L };
  }
  const blendPose = (A, Bp, w) => (w <= 0 ? A : w >= 1 ? Bp : { P: A.P.map((p, k) => p.clone().lerp(Bp.P[k], w)), N: A.N.map((p, k) => p.clone().lerp(Bp.N[k], w)) });
  const Bt = Array.from({ length: SEGS + 1 }, () => V()), Nt = Array.from({ length: SEGS + 1 }, () => V());
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), yAx = V(0, 1, 0), sc = V();
  function applyArm(arm, pose) {
    const { P, N } = pose; const n = P.length;
    for (let k = 0; k < n; k++) { const t = P[Math.min(n - 1, k + 1)].clone().sub(P[Math.max(0, k - 1)]).normalize(); const nn = Nt[k].copy(N[k]); orthoN(nn, t); Bt[k].crossVectors(t, nn).normalize(); }
    // light smoothing of normals to avoid twisting
    for (let pass = 0; pass < 2; pass++) for (let k = 1; k < n - 1; k++) { Nt[k].add(Nt[k - 1]).add(Nt[k + 1]).multiplyScalar(1 / 3); const t = P[k + 1].clone().sub(P[k - 1]).normalize(); orthoN(Nt[k], t); Bt[k].crossVectors(t, Nt[k]).normalize(); }
    arm.tube.update(P, Nt, Bt, arm.rads, 0.22);
    // suckers: two staggered rows on the underside
    suckerS.forEach((sv, idx) => { const f = sv.s * (n - 1), k0 = Math.floor(f), k1 = Math.min(n - 1, k0 + 1), fr = f - k0;
      const c = _a.copy(P[k0]).lerp(P[k1], fr), nn = _b.copy(Nt[k0]).lerp(Nt[k1], fr).normalize(), bb = _c.copy(Bt[k0]).lerp(Bt[k1], fr).normalize();
      const r = lerp(arm.rads[k0], arm.rads[k1], fr), ang = sv.side * 0.42 * (sv.s < 0.9 ? 1 : (1 - (sv.s - 0.9) / 0.1 * 0.7));
      const d = nn.clone().multiplyScalar(Math.cos(ang)).addScaledVector(bb, Math.sin(ang)).normalize();
      const pos = c.clone().addScaledVector(d, r * (1 - 0.22 * Math.cos(ang) ** 2) * 0.93);
      q.setFromUnitVectors(yAx, d); const ss = r * 0.5; sc.set(ss, ss * 0.8, ss); mtx.compose(pos, q, sc); arm.sk.setMatrixAt(idx, mtx); });
    arm.sk.instanceMatrix.needsUpdate = true;
  }

  const T_ = V(), N_ = V(), Z_ = V();
  function placeOnSurface(obj, u, ph, lift = 0, upAlongT = true) {
    const c = spine.getPointAt(u); frameAt(u, T_, N_, Z_);
    const r = prof(u) * endF(u) + bulge(u, ph); const d = N_.clone().multiplyScalar(Math.cos(ph)).addScaledVector(Z_, Math.sin(ph) * wz(u)).normalize();
    obj.position.copy(c).addScaledVector(d, r + lift); return { d, T: T_.clone(), N: N_.clone(), Z: Z_.clone(), c };
  }

  const ringP = Array.from({ length: 121 }, () => V()), ringN = Array.from({ length: 121 }, () => V()), ringB = Array.from({ length: 121 }, () => V()), ringR = new Array(121).fill(0);
  function ringTube(tube, u, lift, rad, lumpy) {
    const n = tube.segs; frameAt(u, T_, N_, Z_); const T0 = T_.clone();
    for (let i = 0; i <= n; i++) { const ph = i / n * TAU; surfPoint(u + (lumpy ? Math.sin(ph * 3) * 0.008 : 0), ph, ringP[i]); const c = spine.getPointAt(u); const out = ringP[i].clone().sub(c); out.addScaledVector(T0, -out.dot(T0)).normalize();
      const rr = rad * (lumpy ? 1 + 0.18 * Math.sin(ph * 7 + 1) + 0.1 * Math.sin(ph * 13) : 1); ringP[i].addScaledVector(out, lift + rr * 0.55); ringN[i].copy(out); ringB[i].copy(T0); ringR[i] = rr; }
    tube.update(ringP, ringN, ringB, ringR, lumpy ? 0 : 0.6); }
  function update(S) {
    const t = S.t;
    U.uTime.value = t; U.uFlash.value = S.flash ?? 0; U.uCloud.value = S.cloud ?? 0; U.uBlush.value = S.blush ?? 0;
    const sway = S.sway ?? V();
    updateBody(sway, 1 + 0.035 * Math.sin(t * 2.6) + (S.breath ?? 0));

    // eyes
    for (const e of eyes) {
      const info = placeOnSurface(e.g, EYE_U, e.s * EYE_PH, -0.016);
      const outward = info.d;
      let gaze = S.look ? S.look.clone().sub(e.g.position).normalize() : outward.clone().add(V(0.6, 0, 0)).normalize();
      // clamp gaze to a cone around the socket
      const dot = gaze.dot(outward); if (dot < 0.55) { gaze.lerp(outward, (0.55 - dot) / 1.2).normalize(); }
      const up = (S.worldUp ?? V(0, 1, 0)).clone(); // pupils stay level with the horizon (statocyst reflex)
      const Yax = gaze, Xax = new THREE.Vector3().crossVectors(up, Yax).normalize(), Zax = new THREE.Vector3().crossVectors(Xax, Yax);
      e.ball.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xax, Yax, Zax));
      // lids: rotate in a frame whose +Z = outward, +Y = up-ish
      const lz = outward.clone(), lx = new THREE.Vector3().crossVectors(up, lz).normalize(), ly = new THREE.Vector3().crossVectors(lz, lx);
      const lidQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lx, ly, lz));
      const blink = S.blink ?? 0, squint = S.squint ?? 0;
      e.lidU.quaternion.copy(lidQ).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), lerp(-0.95, 1.45, Math.max(blink, squint * 0.5 + (S.lidU ?? 0)))));
      e.lidD.quaternion.copy(lidQ).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), lerp(0.42, -0.45, Math.max(blink, squint * 0.45))));
      e.horns.forEach((h, k) => { const inf = placeOnSurface(h, EYE_U + 0.07 + k * 0.012, e.s * (EYE_PH - 0.25 + k * 0.25), -0.004); h.quaternion.setFromUnitVectors(yAx, inf.d.clone().lerp(inf.T, 0.5).normalize()); });
    }
    // goggles on the forehead
    { const u = 0.47; const info = placeOnSurface(goggles, u, 0, 0.0); frameAt(u, T_, N_, Z_);
      goggles.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Z_.clone().negate(), T_.clone(), N_.clone()));
      lenses.forEach((l, k) => { const s = k ? 1 : -1; const inf = placeOnSurface(l, u, s * 0.5, 0.012); l.position.sub(goggles.position).applyQuaternion(goggles.quaternion.clone().invert());
        const dd = inf.d.clone().applyQuaternion(goggles.quaternion.clone().invert()); l.quaternion.setFromUnitVectors(V(0, 0, 1), dd); });
      bridge.position.set(0, 0.0, 0.028); bridge.rotation.set(0, 0, 0);
      ringTube(strapT, u, 0.006, 0.0055, 0.0); }
    // scarf collar + knot + tails
    { const u = 0.115; ringTube(collarT, u, 0.018, 0.026, 1);
      const kp = placeOnSurface(knot, u, Math.PI - 0.5, 0.03); knot.scale.set(1, 0.8, 1);
      const wind = V(-1, 0.04, 0).multiplyScalar(clamp((S.speed ?? 5) / 7, 0.05, 1.6));
      tails.forEach((tl, k) => { const p0 = knot.position.clone(), w = tl.w;
        let p = p0.clone(); const across = V(0, 1, 0);
        for (let i = 0; i <= TAILN; i++) { const s = i / TAILN, sp = S.speed ?? 5;
          const flap = Math.sin(t * (9 + k * 2.3) * (0.4 + sp / 8) - s * 7 + k) * s * (0.04 + sp * 0.012), flap2 = Math.cos(t * 6.1 - s * 5 + k * 2) * s * 0.03;
          const dir = V(-1, -0.9 * clamp(1 - sp / 6) - 0.15 + 0.06 * k, 0.12 * (k ? 1 : -0.4)).normalize().lerp(wind.clone().normalize(), clamp(sp / 6)).normalize();
          if (i) p.addScaledVector(dir, tl.len / TAILN);
          const q2 = p.clone().add(V(0, flap, flap2 + (k ? 0.03 : -0.01)));
          const ac = V(0, 0.25, 1).normalize().applyAxisAngle(V(1, 0, 0), Math.sin(t * 7 - s * 4 + k) * 0.6 * s);
          const hw = w * (1 - s * 0.25) * 0.5;
          tl.pos.set([q2.x - ac.x * hw, q2.y - ac.y * hw, q2.z - ac.z * hw, q2.x + ac.x * hw, q2.y + ac.y * hw, q2.z + ac.z * hw], i * 6); }
        tl.g.attributes.position.needsUpdate = true; tl.g.computeVertexNormals(); }); }
    // siphon on the right side, below the eye
    { const inf = placeOnSurface(siphon, 0.2, 2.0, -0.012); siphon.quaternion.setFromUnitVectors(yAx, inf.d.clone().lerp(V(-1, -0.4, 0), 0.6).normalize()); const p = 1 + 0.12 * Math.sin(t * 2.6 + 1) + (S.puff ?? 0) * 0.4; siphon.scale.set(p, 1, p); }

    // arms
    const tg = bike.targets;
    for (const arm of arms) {
      const base = armBase(arm, sway); let pose;
      const mid = (a, b, f, off) => a.clone().lerp(b, f).add(off);
      if (arm.role === 'gripL' || arm.role === 'gripR') {
        const g = arm.role === 'gripL' ? tg.gripL : tg.gripR, s = arm.role === 'gripL' ? -1 : 1;
        const tgt = { c: g.p, a: g.axis.clone().multiplyScalar(-1), r: 0.034, turns: 1.55, pitch: 0.03 };
        pose = wrapPose(arm, base, [mid(base.B, g.p, 0.35, V(0.02, 0.06, 0.07 * s)), mid(base.B, g.p, 0.72, V(0.0, 0.07, 0.02 * s))], tgt);
      } else if (arm.role === 'pedalL' || arm.role === 'pedalR') {
        const pd = arm.role === 'pedalL' ? tg.pedalL : tg.pedalR, s = arm.role === 'pedalL' ? -1 : 1;
        const tgt = { c: pd.p.clone().add(V(0, 0, 0.006 * s)), a: V(0, 0, s), r: 0.04, turns: 2.3, pitch: 0.024, ell: { x: V(1, 0, 0), rx: 0.05, ry: 0.024 } };
        const knee = mid(base.B, pd.p, 0.42, V(0.12, 0.03, 0.12 * s)), shin = mid(base.B, pd.p, 0.75, V(0.06, 0, 0.06 * s));
        const wp = wrapPose(arm, base, [knee, shin], tgt);
        const fp = freePose(arm, base, { t, len: 0.95, goal: V(0.25, 1, 0.75 * s).normalize(), pull: 0.06, amp: 0.55, freq: 5.5, curl: 8, wind: V(-0.5, 0, 0) });
        pose = blendPose(wp, fp, S.letGo ?? 0);
      } else if (arm.role === 'bell') {
        const bar = tg.gripL.p.clone().lerp(tg.bell.p, 0.55).add(V(0.01, -0.035, 0.03));
        const rest = wrapPose(arm, base, [mid(base.B, bar, 0.5, V(0.03, 0.1, -0.08))], { c: bar, a: tg.gripL.axis.clone().multiplyScalar(-1), r: 0.03, turns: 1.1, pitch: 0.025 });
        const ring = wrapPose(arm, base, [mid(base.B, tg.bell.p, 0.5, V(0.03, 0.14, -0.06))], { c: tg.bell.p.clone().add(V(0.0, 0.01, 0)), a: V(0, 1, 0), r: 0.016, turns: 0.9, pitch: 0.01 });
        const fp = freePose(arm, base, { t, len: 0.9, goal: V(0.35, 1, -0.6).normalize(), pull: 0.07, amp: 0.6, freq: 6, curl: 9, wind: V(-0.4, 0, 0) });
        pose = blendPose(blendPose(rest, ring, S.bellReach ?? 0), fp, S.wild ?? 0);
      } else if (arm.role === 'tea') {
        const cupP = S.cupPos; const tgt = { c: cupP.clone().add(V(0, 0.034, 0)), a: (S.cupUp ?? V(0, 1, 0)).clone(), r: 0.047, turns: 1.25, pitch: 0.02 };
        pose = wrapPose(arm, base, [mid(base.B, cupP, 0.5, V(0.05, -0.06, 0.08))], tgt);
      } else if (arm.role === 'seat') {
        const sp = tg.seatPost; const a = V(0.292, -0.956, 0);
        const rest = wrapPose(arm, base, [mid(base.B, sp, 0.5, V(-0.08, -0.02, -0.08))], { c: sp.clone().add(V(0, -0.03, 0)), a, r: 0.03, turns: 1.8, pitch: 0.03 });
        const fp = freePose(arm, base, { t, len: 0.9, goal: V(-0.4, 1, -0.7).normalize(), pull: 0.07, amp: 0.6, freq: 5, curl: 10, wind: V(-0.6, 0, 0) });
        pose = blendPose(rest, fp, S.wild ?? 0);
      } else {
        const trail = freePose(arm, base, { t, len: 0.92, goal: V(-0.85, -0.15, 0.5).normalize(), pull: 0.05, amp: 0.32, freq: 3.5, curl: 7, wind: V(-0.6 * clamp((S.speed ?? 5) / 6), 0, 0) });
        const wave = freePose(arm, base, { t, len: 0.95, goal: V(0.25, 1, 0.55).normalize(), pull: 0.09, amp: 0.9, freq: 7, k: 5, curl: 6 });
        pose = blendPose(trail, wave, Math.max(S.wave ?? 0, S.wild ?? 0));
      }
      applyArm(arm, pose);
    }
    // cup + tea surface stays level with gravity + acceleration
    cup.position.copy(S.cupPos); cup.quaternion.setFromUnitVectors(yAx, S.cupUp ?? yAx);
    { const tea = cup.userData.tea; const g = (S.gravity ?? V(0, 1, 0)).clone().applyQuaternion(cup.quaternion.clone().invert()); tea.quaternion.setFromUnitVectors(V(0, 0, 1), g.normalize()); }
    steam.forEach((s) => { const ph = (s.userData.ph + t * 0.45) % 1; s.position.copy(S.cupPos).add(V(-ph * 0.22 * clamp((S.speed ?? 5) / 5, 0.2, 1.5), 0.07 + ph * 0.16, Math.sin(ph * 9 + s.userData.ph * 20) * 0.02)); const sz = 0.03 + ph * 0.09; s.scale.set(sz, sz, 1); s.material.opacity = Math.sin(ph * Math.PI) * 0.35 * (S.steam ?? 1); });
  }
  return { root, update, skin, arms, eyes, cup, spine: () => spine };
}
