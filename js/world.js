// The world: a Mediterranean cliff road at golden hour. Road path, terrain, sea, sky, vegetation, lamps, lighthouse, gulls, boats.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, V, clamp, lerp, smooth, rng, fbm2, noise2, canvasTex, GLSL_NOISE, cyl } from './util.js';

// ---------------- road path ----------------
export function makePath() {
  const pts = [];
  for (let x = -60; x <= 380; x += 20) {
    const z = 7 * Math.sin(x / 48) + 3 * Math.sin(x / 21 + 1) - (x > 250 ? (x - 250) * 0.18 : 0);
    const y = 12 + 3.2 * smooth((x - 10) / 95) - 8.5 * smooth((x - 112) / 78);
    pts.push(V(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const N = 8000, P = curve.getSpacedPoints(N), cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
  const L = cum[N];
  const idx = (s) => { s = clamp(s, 0, L - 1e-6); let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; cum[m] <= s ? (lo = m) : (hi = m); } return [lo, (s - cum[lo]) / (cum[lo + 1] - cum[lo])]; };
  const at = (s, out = V()) => { const [i, f] = idx(s); return out.copy(P[i]).lerp(P[i + 1], f); };
  const tan = (s, out = V()) => { const a = at(s - 0.6), b = at(s + 0.6); return out.subVectors(b, a).normalize(); };
  // horizontal right-hand normal (+Z when heading +X)
  const right = (s, out = V()) => { const t = tan(s); return out.set(-t.z, 0, t.x).normalize(); };
  const curvature = (s) => { const a = tan(s - 2), b = tan(s + 2); const ha = Math.atan2(a.z, a.x), hb = Math.atan2(b.z, b.x); let d = hb - ha; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d / 4; }; // +: turning right
  return { at, tan, right, curvature, L, P, cum, N };
}

// signed lateral distance + arc length for a world xz point (approximate, using a coarse table)
function makeProjector(path) {
  const step = 1, S = [], Q = []; for (let s = 0; s <= path.L; s += step) { S.push(s); Q.push(path.at(s).clone()); }
  return (x, z, hint = 0) => {
    let best = 1e18, bi = 0; for (let i = 0; i < Q.length; i += 4) { const dx = x - Q[i].x, dz = z - Q[i].z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    for (let i = Math.max(0, bi - 5); i < Math.min(Q.length, bi + 6); i++) { const dx = x - Q[i].x, dz = z - Q[i].z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    const s = S[bi], p = Q[bi], r = path.right(s); const lat = (x - p.x) * r.x + (z - p.z) * r.z; return { s, lat, y: p.y, d: Math.sqrt(best) };
  };
}

export const LIGHTHOUSE = V(415, 0, -95);

export function buildWorld(renderer, scene, path) {
  const W = { group: new THREE.Group(), update: [] }; scene.add(W.group);
  const R = rng(2026);
  const proj = makeProjector(path);

  // ---------------- sky ----------------
  const sky = new Sky(); sky.scale.setScalar(9000); scene.add(sky); W.sky = sky;
  const su = sky.material.uniforms; su.turbidity.value = 3.2; su.rayleigh.value = 2.2; su.mieCoefficient.value = 0.0011; su.mieDirectionalG.value = 0.94;
  const skyScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(9000); skyScene.add(sky2); sky2.material.uniforms = su;
  for (const sk of [sky, sky2]) { sk.material.fragmentShader = sk.material.fragmentShader.replace('( 760.0 * sundisc ) * min( vSunE * Fex, 80.0 )', '( 26.0 * sundisc ) * min( vSunE * Fex, 60.0 )').replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min(texColor, vec3(24.0)), 1.0 );'); sk.material.needsUpdate = true; }
  su.cloudCoverage.value = 0.3; su.cloudDensity.value = 0.5;
  const pmrem = new THREE.PMREMGenerator(renderer); let envRT = null;

  // ---------------- terrain ----------------
  const X0 = -140, X1 = 520, Z0 = -260, Z1 = 220, NX = 560, NZ = 400;
  const H = new Float32Array((NX + 1) * (NZ + 1));
  const headland = (x, z) => { const dx = (x - LIGHTHOUSE.x) / 70, dz = (z - LIGHTHOUSE.z) / 48; return 18 * Math.exp(-(dx * dx + dz * dz) * 1.2) + 6 * Math.exp(-(((x - 380) / 60) ** 2) - ((z + 40) / 60) ** 2) - 2; };
  const height = (x, z) => {
    const p = proj(x, z); const lat = p.lat, yr = p.y; let h;
    const n = fbm2(x * 0.018, z * 0.018, 5), n2 = fbm2(x * 0.08 + 9, z * 0.08, 3);
    if (Math.abs(lat) < 4.6) h = yr - 0.12;
    else if (lat > 0) { const d = lat - 4.6; h = yr - 0.1 + d * 0.16 + smooth(d / 30) * (6 + n * 14) + smooth(d / 90) * (18 + n * 30) + n2 * 0.6 * smooth(d / 4); }
    else { const d = -lat - 4.6; const drop = smooth((d - 1.2) / 10); h = lerp(yr - 0.1 + n2 * 0.5, -3.5 + n * 4, drop) + (d > 1 ? Math.max(0, n2) * 2.2 * (1 - drop * 0.5) : 0); h -= smooth((d - 30) / 60) * 6; }
    const hl = headland(x, z); if (hl > h && lat < -4) h = lerp(h, hl, smooth((hl - h) / 3));
    return h;
  };
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) H[j * (NX + 1) + i] = height(lerp(X0, X1, i / NX), lerp(Z0, Z1, j / NZ));
  W.heightAt = (x, z) => { const fi = (x - X0) / (X1 - X0) * NX, fj = (z - Z0) / (Z1 - Z0) * NZ; const i = clamp(Math.floor(fi), 0, NX - 1), j = clamp(Math.floor(fj), 0, NZ - 1), a = fi - i, b = fj - j;
    const h00 = H[j * (NX + 1) + i], h10 = H[j * (NX + 1) + i + 1], h01 = H[(j + 1) * (NX + 1) + i], h11 = H[(j + 1) * (NX + 1) + i + 1]; return lerp(lerp(h00, h10, a), lerp(h01, h11, a), b); };
  W.proj = proj;
  {
    const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, NX, NZ); g.rotateX(-Math.PI / 2); g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    // PlaneGeometry rotated: vertex order rows along -z→... map each vertex to our H by coordinates
    for (let k = 0; k < p.count; k++) { const x = p.getX(k), z = p.getZ(k); p.setY(k, W.heightAt(x, z)); }
    g.computeVertexNormals();
    const nrm = g.attributes.normal; const c = new THREE.Color();
    for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k), slope = 1 - nrm.getY(k); const n = fbm2(x * 0.05, z * 0.05, 4), n3 = noise2(x * 0.3, z * 0.3);
      const grass = new THREE.Color().setRGB(lerp(0.33, 0.52, n * 0.5 + 0.5), lerp(0.36, 0.44, n * 0.5 + 0.5), lerp(0.12, 0.16, n3 * 0.5 + 0.5));
      const dry = new THREE.Color(0.62, 0.52, 0.30), rock = new THREE.Color().setRGB(0.47 + n3 * 0.06, 0.41 + n3 * 0.05, 0.35 + n3 * 0.04), sand = new THREE.Color(0.80, 0.70, 0.52), wet = new THREE.Color(0.25, 0.25, 0.22);
      c.copy(grass).lerp(dry, clamp(n * 0.9 + 0.35)); c.lerp(rock, smooth((slope - 0.18) / 0.22)); if (y < 1.6) c.lerp(sand, smooth((1.6 - y) / 1.2) * (1 - smooth((slope - 0.3) / 0.2))); if (y < 0.1) c.lerp(wet, smooth((0.1 - y) / 1.5));
      const pr = proj(x, z); if (Math.abs(pr.lat) < 5.6 && pr.d < 8) c.lerp(new THREE.Color(0.45, 0.40, 0.32), 0.6 * (1 - smooth((Math.abs(pr.lat) - 4.6) / 1)));
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;\n' + GLSL_NOISE).replace('#include <color_fragment>', '#include <color_fragment>\n float dn = fbm3(vW * 0.9) * 0.5 + fbm3(vW * 4.0) * 0.3; diffuseColor.rgb *= 0.86 + dn * 0.45;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n float hh = fbm3(vW * 1.7) + 0.4 * fbm3(vW * 7.0); normal = bumpNormal(-vViewPosition, normal, hh, 0.07);'); };
    const t = new THREE.Mesh(g, m); t.receiveShadow = true; t.castShadow = true; W.group.add(t); W.terrain = t;
  }

  // ---------------- road ----------------
  const asphalt = canvasTex(1024, 2048, (g, w, h) => {
    g.fillStyle = '#4a4744'; g.fillRect(0, 0, w, h); const r = rng(5);
    for (let i = 0; i < 90000; i++) { const v = 50 + r() * 70; g.fillStyle = `rgba(${v},${v * 0.97},${v * 0.93},${0.25 + r() * 0.5})`; g.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5); }
    for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(25,24,22,.5)'; g.lineWidth = 1 + r() * 2; g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 12; k++) { x += (r() - 0.5) * 60; y += r() * 40; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(30,29,28,${0.15 + r() * 0.2})`; g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 90, 20 + r() * 60, r() * 3, 0, TAU); g.fill(); }
    // edge lines + dashed centre line (the texture covers 8 m of road length)
    g.fillStyle = 'rgba(240,236,224,.92)'; g.fillRect(w * 0.035, 0, w * 0.02, h); g.fillRect(w * 0.945, 0, w * 0.02, h);
    g.fillRect(w * 0.492, 0, w * 0.016, h * 0.38); g.fillRect(w * 0.492, h * 0.5, w * 0.016, h * 0.38);
    for (let i = 0; i < 2500; i++) { g.fillStyle = 'rgba(60,58,55,.6)'; const xs = [0.045, 0.955, 0.5][i % 3]; g.fillRect(w * xs + (r() - 0.5) * 22, r() * h, 2, 2); }
  }, { aniso: 16 });
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  {
    const HW = 4.6, NS = Math.ceil(path.L / 0.5), NW = 8, pos = [], uv = [], idx = [];
    for (let i = 0; i <= NS; i++) { const s = i / NS * path.L, p = path.at(s), r = path.right(s);
      for (let j = 0; j <= NW; j++) { const f = j / NW, l = lerp(-HW, HW, f), crown = 0.06 * (1 - (2 * f - 1) ** 2); pos.push(p.x + r.x * l, p.y + crown, p.z + r.z * l); uv.push(f, s / 8); } }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NW; j++) { const a = i * (NW + 1) + j, b = a + NW + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.82, bumpMap: asphalt, bumpScale: 0.6 });
    const road = new THREE.Mesh(g, m); road.receiveShadow = true; W.group.add(road); W.road = road;
  }
  W.roadY = (s) => path.at(s).y + 0.06; // crown height at centre

  // ---------------- stone wall on the sea side ----------------
  {
    const stones = []; const r = rng(7);
    for (let s = 0; s < path.L; s += 0.55 + r() * 0.15) for (let row = 0; row < 2; row++) {
      const p = path.at(s), rt = path.right(s), t = path.tan(s); const w = 0.78 + r() * 0.2, h = 0.26 + r() * 0.08, d = 0.38 + r() * 0.08;
      stones.push({ p: p.clone().addScaledVector(rt, -4.85).add(V(0, row * 0.29 + h / 2 - 0.05, 0)).addScaledVector(t, row * 0.25), yaw: Math.atan2(t.z, t.x), w, h, d, c: 0.75 + r() * 0.25, j: r() });
    }
    const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2); { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const v = V(p.getX(i), p.getY(i), p.getZ(i)); v.multiplyScalar(1 - 0.12 * (Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) - 0.5)); p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); }
    const m = new THREE.MeshStandardMaterial({ color: '#d8c7a8', roughness: 0.92 });
    m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * instanceMatrix * vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;\n' + GLSL_NOISE).replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 0.8 + 0.35 * fbm3(vW * 6.0) + 0.15*fbm3(vW*25.);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = bumpNormal(-vViewPosition, normal, fbm3(vW*9.0) + 0.3*fbm3(vW*30.), 0.03);'); };
    const im = new THREE.InstancedMesh(g, m, stones.length); const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    stones.forEach((st, i) => { q.setFromEuler(new THREE.Euler((st.j - 0.5) * 0.08, -st.yaw + (st.j - 0.5) * 0.1, (st.j - 0.5) * 0.06)); mt.compose(st.p, q, V(st.w, st.h, st.d)); im.setMatrixAt(i, mt); im.setColorAt(i, c.setRGB(st.c, st.c * (0.95 + st.j * 0.05), st.c * 0.9)); });
    im.castShadow = im.receiveShadow = true; W.group.add(im);
    // cap slabs
    const caps = []; for (let s = 0; s < path.L; s += 1.1) { const p = path.at(s), rt = path.right(s), t = path.tan(s); caps.push({ p: p.clone().addScaledVector(rt, -4.85).add(V(0, 0.62, 0)), yaw: Math.atan2(t.z, t.x) }); }
    const cm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.12, 0.09, 0.5), m, caps.length); caps.forEach((cp, i) => { q.setFromEuler(new THREE.Euler(0, -cp.yaw, 0)); mt.compose(cp.p, q, V(1, 1, 1)); cm.setMatrixAt(i, mt); cm.setColorAt(i, c.setRGB(0.95, 0.92, 0.85)); });
    cm.castShadow = cm.receiveShadow = true; W.group.add(cm);
  }

  // ---------------- lamps (land side) ----------------
  W.lamps = [];
  {
    const iron = new THREE.MeshStandardMaterial({ color: '#1f3a34', metalness: 0.6, roughness: 0.45 });
    const glassM = new THREE.MeshStandardMaterial({ color: '#ffe8b0', emissive: new THREE.Color('#ffb85c'), emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.85 });
    for (let s = 14, k = 0; s < path.L - 10; s += 26, k++) {
      const p = path.at(s), rt = path.right(s), t = path.tan(s); const g = new THREE.Group(); g.position.copy(p).addScaledVector(rt, 5.0); g.position.y = W.heightAt(g.position.x, g.position.z) - 0.05; g.rotation.y = -Math.atan2(t.z, t.x);
      g.add(cyl(V(0, 0, 0), V(0, 0.35, 0), 0.13, 0.1, iron, 16)); g.add(cyl(V(0, 0.35, 0), V(0, 3.6, 0), 0.06, 0.045, iron, 12));
      const arm = []; for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 0.85; arm.push(V(0, 3.6 + Math.sin(a) * 0.32, -Math.sin(a * 0.5) * 0.0 - (1 - Math.cos(a)) * 0.45)); }
      const am = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arm), 24, 0.03, 8), iron); g.add(am);
      const lan = new THREE.Group(); lan.position.set(0, 3.45, -0.86); g.add(lan);
      const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.11, 0.34, 6), glassM.clone()); lan.add(gl);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.18, 6), iron); roof.position.y = 0.26; lan.add(roof);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), iron); fin.position.y = 0.38; lan.add(fin);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      W.group.add(g); W.lamps.push({ g, s, glass: gl.material, k });
    }
  }
  // bollards
  {
    const r = rng(11), list = []; for (let s = 6; s < path.L; s += 13) list.push(s);
    const g = new THREE.CylinderGeometry(0.07, 0.08, 0.9, 12); g.translate(0, 0.45, 0); const m = new THREE.MeshStandardMaterial({ color: '#f1ede4', roughness: 0.6 });
    const band = new THREE.CylinderGeometry(0.073, 0.073, 0.12, 12); band.translate(0, 0.75, 0); const bm = new THREE.MeshStandardMaterial({ color: '#d02a20', roughness: 0.3, emissive: '#200000' });
    const a = new THREE.InstancedMesh(g, m, list.length), b = new THREE.InstancedMesh(band, bm, list.length); const mt = new THREE.Matrix4();
    list.forEach((s, i) => { const p = path.at(s), rt = path.right(s); const q = p.clone().addScaledVector(rt, 4.35); q.y = W.heightAt(q.x, q.z) - 0.02; mt.makeTranslation(q.x, q.y, q.z); a.setMatrixAt(i, mt); b.setMatrixAt(i, mt); });
    a.castShadow = b.castShadow = true; W.group.add(a, b);
  }

  // ---------------- vegetation ----------------
  const windU = { value: 0 }; W.windU = windU;
  const scatter = (n, fn) => { const out = []; let tries = 0; while (out.length < n && tries++ < n * 30) { const v = fn(); if (v) out.push(v); } return out; };
  // grass clumps (curved blades), swaying
  {
    const blades = []; const r = rng(3);
    for (let k = 0; k < 14; k++) { const a = r() * TAU, rr = r() * 0.12, h = 0.25 + r() * 0.45, lean = (r() - 0.5) * 0.6, w = 0.018 + r() * 0.012; const pos = [], idx = [], col = [];
      const N = 5; for (let i = 0; i <= N; i++) { const f = i / N, y = f * h, off = lean * f * f * h, ww = w * (1 - f * 0.9); const cx = Math.cos(a) * rr + Math.cos(a + 1.6) * off, cz = Math.sin(a) * rr + Math.sin(a + 1.6) * off;
        pos.push(cx - Math.sin(a) * ww, y, cz + Math.cos(a) * ww, cx + Math.sin(a) * ww, y, cz - Math.cos(a) * ww); col.push(f, f); if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aH', new THREE.Float32BufferAttribute(col, 1)); g.setIndex(idx); blades.push(g); }
    const clump = mergeGeometries(blades); clump.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: '#b9a85c', roughness: 0.8, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => { sh.uniforms.uWind = windU; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aH; uniform float uWind; varying float vH;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vH = aH; vec4 wp = instanceMatrix * vec4(0.,0.,0.,1.); float sw = sin(uWind * 2.2 + wp.x * 0.35 + wp.z * 0.2) * 0.6 + sin(uWind * 3.7 + wp.x) * 0.3; transformed.x += sw * aH * aH * 0.12; transformed.z += sw * aH * aH * 0.05;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(vec3(0.35,0.42,0.18)*1.6, vec3(1.05,0.95,0.62), vH);'); };
    const r2 = rng(13);
    const pts = scatter(16000, () => { const s = r2() * path.L, side = r2() < 0.72 ? 1 : -1, lat = side > 0 ? 4.7 + Math.pow(r2(), 1.8) * 45 : -(4.7 + r2() * 1.6); const p = path.at(s), rt = path.right(s); const x = p.x + rt.x * lat, z = p.z + rt.z * lat; const y = W.heightAt(x, z); if (y < 1) return null; return { x, y, z, s: 0.7 + r2() * 0.9, a: r2() * TAU }; });
    const im = new THREE.InstancedMesh(clump, m, pts.length); const mt = new THREE.Matrix4(), q = new THREE.Quaternion();
    pts.forEach((p, i) => { q.setFromAxisAngle(V(0, 1, 0), p.a); mt.compose(V(p.x, p.y - 0.02, p.z), q, V(p.s, p.s, p.s)); im.setMatrixAt(i, mt); });
    im.castShadow = true; im.receiveShadow = true; W.group.add(im);
  }
  // wildflowers
  {
    const r = rng(17); const pts = scatter(5000, () => { const s = r() * path.L, lat = 4.8 + Math.pow(r(), 2.2) * 30; const p = path.at(s), rt = path.right(s); const x = p.x + rt.x * lat, z = p.z + rt.z * lat; const y = W.heightAt(x, z); return { x, y, z, c: r(), s: 0.6 + r() * 0.8 }; });
    const g = new THREE.IcosahedronGeometry(0.035, 1); g.translate(0, 0.32, 0); const st = new THREE.CylinderGeometry(0.004, 0.004, 0.32, 4); st.translate(0, 0.16, 0);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.55 }), sm = new THREE.MeshStandardMaterial({ color: '#5c7a33', roughness: 0.8 });
    const a = new THREE.InstancedMesh(g, m, pts.length), b = new THREE.InstancedMesh(st, sm, pts.length); const mt = new THREE.Matrix4(), c = new THREE.Color(); const pal = ['#f6d32d', '#ffffff', '#b56ad8', '#ff8a3d', '#f6d32d', '#ff4f6d'];
    pts.forEach((p, i) => { mt.makeScale(p.s, p.s, p.s).setPosition(p.x, p.y, p.z); a.setMatrixAt(i, mt); b.setMatrixAt(i, mt); a.setColorAt(i, c.set(pal[Math.floor(p.c * pal.length)])); });
    W.group.add(a, b);
  }
  // bushes, umbrella pines, cypresses, houses
  const leafMat = (col) => { const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, flatShading: false });
    m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vO;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vO = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vO;\n' + GLSL_NOISE).replace('#include <color_fragment>', '#include <color_fragment>\n float lv = fbm3(vO * 7.0); diffuseColor.rgb *= 0.65 + 0.7 * smoothstep(-0.4, 0.5, lv);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = bumpNormal(-vViewPosition, normal, fbm3(vO*9.), 0.25);'); }; return m; };
  const blob = (r0, seed, detail = 3) => { const g = new THREE.IcosahedronGeometry(r0, detail); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const v = V(p.getX(i), p.getY(i), p.getZ(i)); const n = fbm2(v.x * 2 + seed, v.z * 2 + v.y * 1.3, 3); v.multiplyScalar(1 + n * 0.45); p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; };
  const clumpGeo = [0, 1, 2, 3].map((k) => blob(0.9, 50 + k * 7, 2));
  const bushM = leafMat('#56662f'), pineM = leafMat('#465f2a'), cypM = leafMat('#2f4a25'), bark = new THREE.MeshStandardMaterial({ color: '#6a4a33', roughness: 0.9 });
  W.trees = [];
  {
    const r = rng(23);
    for (let k = 0; k < 220; k++) { const s = r() * path.L, lat = 9 + Math.pow(r(), 1.6) * 60 * (r() < 0.85 ? 1 : -0.08); const p = path.at(s), rt = path.right(s); const x = p.x + rt.x * lat, z = p.z + rt.z * lat; const y = W.heightAt(x, z); if (y < 1.5) continue;
      const m = new THREE.Mesh(blob(0.5 + r() * 0.7, k), bushM); m.position.set(x, y + 0.2, z); m.scale.y = 0.7; m.castShadow = m.receiveShadow = true; W.group.add(m); }
    const pine = (x, z, sc) => { const y = W.heightAt(x, z); const g = new THREE.Group(); g.position.set(x, y - 0.1, z); g.scale.setScalar(sc); const lean = (r() - 0.5) * 0.4;
      const trunk = []; for (let i = 0; i <= 10; i++) { const f = i / 10; trunk.push(V(Math.sin(f * 2 + k) * 0.25 + lean * f * 3, f * 7.5, Math.cos(f * 1.7) * 0.15)); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunk), 20, 0.22, 8), bark));
      const top = trunk[10]; const crown = [];
      for (let b = 0; b < 5; b++) { const a2 = b / 5 * TAU + r(); const br = V(top.x + Math.cos(a2) * (1.6 + r()), 7.2 + r() * 0.6, top.z + Math.sin(a2) * (1.6 + r())); g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(trunk[8].x, 6.0, trunk[8].z), br.clone().lerp(V(trunk[8].x, 6.0, trunk[8].z), 0.5).add(V(0, 0.5, 0)), br]), 8, 0.09, 6), bark)); crown.push(br); }
      for (let b = 0; b < 26; b++) { const a2 = r() * TAU, rr = Math.sqrt(r()) * 3.1; const c = new THREE.Mesh(clumpGeo[b % clumpGeo.length], pineM);
        c.position.set(top.x + Math.cos(a2) * rr, 7.9 + (1 - (rr / 3.1) ** 2) * 0.9 + r() * 0.3, top.z + Math.sin(a2) * rr); const sz = 0.75 + r() * 0.5; c.scale.set(sz * 1.3, sz * 0.62, sz * 1.3); c.rotation.y = r() * TAU; c.castShadow = true; c.receiveShadow = true; g.add(c); }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); W.group.add(g); W.trees.push(g); return g; };
    const cypress = (x, z, sc) => { const y = W.heightAt(x, z); const g = new THREE.Group(); g.position.set(x, y - 0.1, z); g.scale.setScalar(sc);
      const c = new THREE.Mesh(blob(1, x, 3), cypM); c.scale.set(0.9, 5.2, 0.9); c.position.y = 5.2; c.castShadow = true; c.receiveShadow = true; g.add(c); g.add(cyl(V(0, 0, 0), V(0, 1, 0), 0.18, 0.15, bark, 8)); W.group.add(g); return g; };
    var k = 0;
    for (k = 0; k < 46; k++) { const s = 8 + r() * (path.L - 20), lat = 9 + r() * 55; const p = path.at(s), rt = path.right(s); pine(p.x + rt.x * lat, p.z + rt.z * lat, 0.8 + r() * 0.6); }
    for (k = 0; k < 40; k++) { const s = r() * path.L, lat = 7 + r() * 50; const p = path.at(s), rt = path.right(s); cypress(p.x + rt.x * lat, p.z + rt.z * lat, 0.7 + r() * 0.6); }
    // a few hero pines close to the road for parallax
    for (const [s, lat] of [[38, 8.5], [74, 10], [128, 9], [182, 8.2], [236, 11]]) { const p = path.at(s), rt = path.right(s); pine(p.x + rt.x * lat, p.z + rt.z * lat, 1.15); }
    // white houses with terracotta roofs
    const wall = new THREE.MeshStandardMaterial({ color: '#f3eee4', roughness: 0.9 }), roof = new THREE.MeshStandardMaterial({ color: '#b5553a', roughness: 0.8 }), shut = new THREE.MeshStandardMaterial({ color: '#2f6f8f', roughness: 0.6 });
    for (k = 0; k < 16; k++) { const s = 20 + r() * (path.L - 30), lat = 24 + r() * 60; const p = path.at(s), rt = path.right(s); const x = p.x + rt.x * lat, z = p.z + rt.z * lat, y = W.heightAt(x, z);
      const g = new THREE.Group(); g.position.set(x, y - 0.3, z); g.rotation.y = r() * TAU; const w = 5 + r() * 4, d = 4 + r() * 3, h = 3 + r() * 3;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall); b.position.y = h / 2; g.add(b);
      const rg = new THREE.CylinderGeometry(0.01, d * 0.62, w + 0.4, 4, 1); rg.rotateZ(Math.PI / 2); rg.rotateX(Math.PI / 4); const rm = new THREE.Mesh(rg, roof); rm.scale.set(1, 0.5, 1); rm.position.y = h + d * 0.18; g.add(rm);
      for (let wnd = 0; wnd < 3; wnd++) { const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.05), shut); s2.position.set(-w / 3 + wnd * w / 3, h * 0.6, d / 2 + 0.03); g.add(s2); }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); W.group.add(g); }
  }

  // ---------------- lighthouse ----------------
  {
    const g = new THREE.Group(); const y0 = W.heightAt(LIGHTHOUSE.x, LIGHTHOUSE.z); g.position.set(LIGHTHOUSE.x, y0 - 0.5, LIGHTHOUSE.z); W.group.add(g); W.lighthouse = g;
    const stripes = canvasTex(256, 1024, (c, w, h) => { for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#c8322a' : '#f6f1e6'; c.fillRect(0, i * h / 6, w, h / 6); } });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 3.0, 20, 40), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 })); tower.position.y = 10; g.add(tower);
    const gal = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.35, 40), new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.5, metalness: 0.5 })); gal.position.y = 20.2; g.add(gal);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.4, 24), new THREE.MeshStandardMaterial({ color: '#fff1c2', emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0.4, roughness: 0.1, transparent: true, opacity: 0.9 })); lantern.position.y = 21.6; g.add(lantern); W.lantern = lantern;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 12, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c8322a', roughness: 0.5 })); cap.position.y = 22.8; g.add(cap);
    const house = new THREE.Mesh(new THREE.BoxGeometry(7, 3.5, 5), new THREE.MeshStandardMaterial({ color: '#f3eee4', roughness: 0.9 })); house.position.set(5, 1.75, 2); g.add(house);
    const beamM = new THREE.ShaderMaterial({ uniforms: { uOp: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vX; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vX = position.x; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uOp; varying vec3 vN; varying vec3 vV; varying float vX; void main(){ float f = pow(abs(dot(vN, vV)), 2.5); float l = smoothstep(-140., -2., vX) * (1. - smoothstep(-6., 0., vX) * 0.3); gl_FragColor = vec4(vec3(1., .88, .62) * f * l * uOp, 1.); }' });
    Object.defineProperty(beamM, 'opacity', { set(v) { beamM.uniforms.uOp.value = v * 6; }, get() { return beamM.uniforms.uOp.value / 6; } });
    const bg = new THREE.ConeGeometry(5, 140, 32, 1, true); bg.translate(0, -70, 0); bg.rotateZ(Math.PI / 2);
    const beam = new THREE.Group(); beam.position.y = 21.6; g.add(beam); const b1 = new THREE.Mesh(bg, beamM), b2 = new THREE.Mesh(bg, beamM); b2.rotation.y = Math.PI; b1.userData.noDepth = b2.userData.noDepth = true; beam.add(b1, b2); W.beam = beam; W.beamM = beamM;
    g.traverse((o) => { if (o.isMesh && o.material !== beamM) { o.castShadow = true; o.receiveShadow = true; } });
  }
  // distant islands / far mountains across the sea
  {
    const m = new THREE.MeshStandardMaterial({ color: '#7d8a8a', roughness: 1 });
    for (const [x, z, sx, sy, sz] of [[260, -900, 420, 70, 120], [-200, -1100, 520, 110, 160], [700, -1300, 600, 140, 200], [520, -650, 140, 30, 60]]) {
      const g = new THREE.SphereGeometry(1, 64, 24, 0, TAU, 0, Math.PI / 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const n = fbm2(p.getX(i) * 3 + x, p.getZ(i) * 3, 4); const y0 = p.getY(i); p.setY(i, y0 * Math.max(0.05, 0.25 + n * 1.7 + Math.pow(y0, 3) * 0.6)); } g.computeVertexNormals();
      const mm = new THREE.Mesh(g, m); mm.position.set(x, -2, z); mm.scale.set(sx, sy, sz); W.group.add(mm); }
  }

  // ---------------- sea ----------------
  {
    // heightmap texture for shore foam/depth
    const ht = new Float32Array((NX + 1) * (NZ + 1)); for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) ht[j * (NX + 1) + i] = H[j * (NX + 1) + i];
    const htTex = new THREE.DataTexture(ht, NX + 1, NZ + 1, THREE.RedFormat, THREE.FloatType); htTex.magFilter = htTex.minFilter = THREE.LinearFilter; htTex.needsUpdate = true;
    const g = new THREE.PlaneGeometry(9000, 9000, 600, 600); g.rotateX(-Math.PI / 2);
    // concentrate vertices near the coast
    { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const f = (v) => Math.sign(v) * Math.pow(Math.abs(v) / 4500, 2.2) * 4500; p.setX(i, f(x) + 200); p.setZ(i, f(z) - 60); } }
    const m = new THREE.MeshPhysicalMaterial({ color: '#0b4f63', roughness: 0.07, metalness: 0, clearcoat: 0, ior: 1.33, specularIntensity: 1, envMapIntensity: 0.8 });
    const SU = { uTime: { value: 0 }, uHt: { value: htTex }, uBox: { value: new THREE.Vector4(X0, Z0, X1 - X0, Z1 - Z0) } }; W.seaU = SU;
    m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, SU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime; varying vec3 vW;\n vec3 gerst(vec2 p, vec2 d, float a, float k, float sp){ float f = k * dot(d, p) - uTime * sp; return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f)); }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec2 pw = (modelMatrix * vec4(position,1.)).xz; float fade = 1.0 - smoothstep(300., 1800., length(pw - vec2(200., -60.)));
          vec3 off = gerst(pw, normalize(vec2(0.3, 1.)), 0.32, 0.12, 1.1) + gerst(pw, normalize(vec2(-0.5, 1.)), 0.18, 0.21, 1.5) + gerst(pw, normalize(vec2(0.8, 0.6)), 0.09, 0.45, 2.3) + gerst(pw, normalize(vec2(-0.2, 1.)), 0.05, 0.9, 3.1);
          transformed += off * fade;`)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vW = (modelMatrix * vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform sampler2D uHt; uniform vec4 uBox; varying vec3 vW; float gDepth;\n' + GLSL_NOISE)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 huv = (vW.xz - uBox.xy) / uBox.zw; float th = (huv.x > 0. && huv.x < 1. && huv.y > 0. && huv.y < 1.) ? texture2D(uHt, huv).r : -20.;
          float depth = max(0., vW.y - th); gDepth = depth;
          vec3 deep = vec3(0.02, 0.17, 0.24), shallow = vec3(0.08, 0.46, 0.45);
          diffuseColor.rgb = mix(shallow, deep, smoothstep(0.2, 7., depth));
          float fn = fbm3(vec3(vW.xz * 0.6, uTime * 0.4)); float foam = smoothstep(1.4, 0.0, depth + fn * 0.8 - 0.15 * sin(uTime * 1.7 + vW.x * 0.2));
          foam += smoothstep(0.62, 0.95, fbm3(vec3(vW.xz * 0.12, uTime * 0.1)) + 0.25) * 0.15;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.9), clamp(foam, 0., 1.) * 0.9);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          float dist = length(vViewPosition);
          float hh = fbm3(vec3(vW.xz * 0.35 + vec2(uTime * 0.25, uTime * 0.1), uTime * 0.2)) + 0.5 * fbm3(vec3(vW.xz * 1.6 - uTime * 0.4, uTime * 0.5)) + 0.25 * gnoise(vec3(vW.xz * 6.0, uTime));
          normal = bumpNormal(-vViewPosition, normal, hh, 0.55 * (1.0 - smoothstep(60., 900., dist)) + 0.1);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.05, 0.11, smoothstep(40., 1500., length(vViewPosition)));');
    };
    const sea = new THREE.Mesh(g, m); sea.receiveShadow = true; W.group.add(sea); W.sea = sea;
  }

  // ---------------- sailboats ----------------
  W.boats = [];
  {
    const hullM = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.4 }), sailM = new THREE.MeshStandardMaterial({ color: '#fffaf0', roughness: 0.7, side: THREE.DoubleSide, emissive: '#3a2a10' });
    for (const [x, z, sc, h] of [[90, -150, 1.2, 0.3], [180, -260, 1.6, 1.4], [40, -340, 1.4, 2.1], [300, -200, 1.1, 3.3], [230, -480, 2, 4.4]]) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = h; g.scale.setScalar(sc);
      const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, TAU, Math.PI / 2, Math.PI / 2), hullM); hull.scale.set(4, 0.9, 1.2); g.add(hull);
      g.add(cyl(V(0, 0, 0), V(0, 9, 0), 0.06, 0.05, hullM, 6));
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute([0.1, 0.6, 0, 0.1, 8.8, 0, -3.4, 0.7, 0, 0.1, 0.6, 0, 0.1, 7.5, 0, 3.0, 0.7, 0.1], 3)); sg.computeVertexNormals(); g.add(new THREE.Mesh(sg, sailM));
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); W.group.add(g); W.boats.push({ g, h });
    }
  }

  // ---------------- gulls ----------------
  W.gulls = [];
  {
    const white = new THREE.MeshStandardMaterial({ color: '#f5f3ee', roughness: 0.6, side: THREE.DoubleSide }), grey = new THREE.MeshStandardMaterial({ color: '#9aa3a8', roughness: 0.6, side: THREE.DoubleSide }), beakM = new THREE.MeshStandardMaterial({ color: '#f0b429' });
    const wingG = (s) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12 * s, 0.18, 0, 0.1 * s, 0.05, 0, 0.55 * s, 0, 0, 0.12 * s, 0.05, 0, 0.55 * s, -0.22, 0, 0.75 * s, -0.12, 0, 0.1 * s, 0, 0, 0.12 * s, -0.22, 0, 0.75 * s], 3)); g.computeVertexNormals(); return g; };
    const r = rng(31);
    for (let k = 0; k < 14; k++) {
      const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), white); body.scale.set(2.6, 0.9, 0.9); g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), white); head.position.set(0.3, 0.05, 0); g.add(head);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 6), beakM); beak.rotation.z = -Math.PI / 2; beak.position.set(0.41, 0.04, 0); g.add(beak);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 4), white); tail.rotation.z = Math.PI / 2; tail.scale.z = 0.3; tail.position.set(-0.36, 0, 0); g.add(tail);
      const wl = new THREE.Group(), wr = new THREE.Group(); wl.add(new THREE.Mesh(wingG(-1), grey)); wr.add(new THREE.Mesh(wingG(1), grey)); const tipL = new THREE.Group(), tipR = new THREE.Group(); g.add(wl, wr);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.scale.setScalar(1.4);
      W.group.add(g); W.gulls.push({ g, wl, wr, ph: r() * TAU, rad: 6 + r() * 14, cx: r(), cy: r(), sp: 0.25 + r() * 0.2, h: 4 + r() * 10, off: r() * 60 });
    }
  }

  // ---------------- clouds ----------------
  W.clouds = [];
  {
    const tex = canvasTex(512, 256, (g, w, h) => { const img = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = x / w - 0.5, v = y / h - 0.5; const fall = Math.max(0, 1 - Math.sqrt(u * u * 4 + v * v * 14) * 1.15); const n = fbm2(x / 70, y / 50, 6); const a = clamp((n + 0.15) * 2.2 * fall - 0.1) * 255; const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a; } g.putImageData(img, 0, 0); });
    const r = rng(41);
    // (the sky shader draws the clouds; sprite clouds removed)
  }

  // ---------------- per-frame update ----------------
  W.setSun = (elevDeg, azDeg) => { const phi = THREE.MathUtils.degToRad(90 - elevDeg), th = THREE.MathUtils.degToRad(azDeg); const v = new THREE.Vector3().setFromSphericalCoords(1, phi, th); su.sunPosition.value.copy(v); W.sunDir = v.clone(); return v; };
  W.updateEnv = () => { if (envRT) envRT.dispose(); envRT = pmrem.fromScene(skyScene, 0, 0.1, 10000); scene.environment = envRT.texture; };
  W.tick = (t, ctx) => {
    windU.value = t; W.seaU.uTime.value = t;
    W.boats.forEach((b, i) => { b.g.position.y = Math.sin(t * 0.9 + i) * 0.12; b.g.rotation.z = Math.sin(t * 0.7 + i * 2) * 0.04; b.g.rotation.x = Math.sin(t * 0.6 + i) * 0.03; });
    for (const gl of W.gulls) { const a = t * gl.sp + gl.ph; const base = ctx.gullCenter; const p = base.clone().add(V(Math.cos(a) * gl.rad + (gl.cx - 0.5) * 30 + gl.off * 0.5, gl.h + Math.sin(a * 2) * 1.2, Math.sin(a) * gl.rad * 0.6 - 10 - gl.cy * 25));
      const dirx = -Math.sin(a), dirz = Math.cos(a) * 0.6; gl.g.position.copy(p); gl.g.rotation.set(0, -Math.atan2(dirz, dirx), Math.sin(a) * 0.35);
      const fl = Math.sin(t * 7 + gl.ph * 5) * (0.5 + 0.5 * Math.sin(t * 0.5 + gl.ph)) ; gl.wl.rotation.x = fl * 0.7; gl.wr.rotation.x = -fl * 0.7; }
  };
  return W;
}
