// Shared helpers: seeded random, noise, easing. Everything deterministic so any frame can be rendered alone.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, p) => a + (b - a) * p;
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const ramp = (t, a, b) => smooth((t - a) / (b - a));
export const win = (t, a, b, fi = .3, fo = .3) => ramp(t, a, a + fi) * (1 - ramp(t, b - fo, b));
export const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
export const easeInOut = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 2D/3D value-gradient noise (simple, fast, deterministic)
const P = new Uint8Array(512);
{ const r = rng(1337), p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const grad3 = (h, x, y, z) => { const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
export function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(lerp(lerp(grad3(P[AA] & 15, x, y, z), grad3(P[BA] & 15, x - 1, y, z), u), lerp(grad3(P[AB] & 15, x, y - 1, z), grad3(P[BB] & 15, x - 1, y - 1, z), u), v),
    lerp(lerp(grad3(P[AA + 1] & 15, x, y, z - 1), grad3(P[BA + 1] & 15, x - 1, y, z - 1), u), lerp(grad3(P[AB + 1] & 15, x, y - 1, z - 1), grad3(P[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
}
export const noise2 = (x, y) => noise3(x, y, 0.5);
export function fbm2(x, y, oct = 5) { let a = .5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2.03; a *= .5; } return s; }

// GLSL noise used by several shaders
export const GLSL_NOISE = /* glsl */`
vec3 hash33(vec3 p){ p = fract(p * vec3(.1031,.1030,.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx) * 2. - 1.; }
float gnoise(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*f*(f*(f*6.-15.)+10.);
  return mix(mix(mix(dot(hash33(i), f), dot(hash33(i+vec3(1,0,0)), f-vec3(1,0,0)), u.x), mix(dot(hash33(i+vec3(0,1,0)), f-vec3(0,1,0)), dot(hash33(i+vec3(1,1,0)), f-vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(hash33(i+vec3(0,0,1)), f-vec3(0,0,1)), dot(hash33(i+vec3(1,0,1)), f-vec3(1,0,1)), u.x), mix(dot(hash33(i+vec3(0,1,1)), f-vec3(0,1,1)), dot(hash33(i+vec3(1,1,1)), f-vec3(1,1,1)), u.x), u.y), u.z); }
float fbm3(vec3 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * gnoise(p); p = p * 2.02 + 17.3; a *= .5; } return s; }
float worley(vec3 p){ vec3 i = floor(p), f = fract(p); float d = 1.; for (int x=-1;x<=1;x++) for (int y=-1;y<=1;y++) for (int z=-1;z<=1;z++){ vec3 g = vec3(x,y,z); vec3 o = hash33(i+g)*.5+.5; d = min(d, length(g + o - f)); } return d; }
vec3 bumpNormal(vec3 pos, vec3 n, float h, float k){ vec3 dx = dFdx(pos), dy = dFdy(pos); vec3 r1 = cross(dy, n), r2 = cross(n, dx); float det = dot(dx, r1);
  vec2 dh = vec2(dFdx(h), dFdy(h)) * k; vec3 g = sign(det) * (dh.x * r1 + dh.y * r2); return normalize(abs(det) * n - g); }
`;

// Canvas texture helper
export function canvasTex(w, h, draw, { repeat = null, srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.needsUpdate = true; return t;
}

// Build a tube along explicit points/frames into an existing geometry (fast per-frame update)
export class DynTube {
  constructor(segs, radial, material, { caps = true } = {}) {
    this.segs = segs; this.radial = radial;
    const vc = (segs + 1) * (radial + 1) + (caps ? 1 : 0);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(vc * 3); this.nor = new Float32Array(vc * 3); this.uv = new Float32Array(vc * 2); this.under = new Float32Array(vc);
    const idx = [];
    for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    if (caps) { const tip = vc - 1, last = segs * (radial + 1); for (let j = 0; j < radial; j++) idx.push(last + j, tip, last + j + 1); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('aUnder', new THREE.BufferAttribute(this.under, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = g; this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.caps = caps;
  }
  // pts: array of Vector3 (segs+1), N: underside unit vectors, B: binormals, rad: radii
  update(pts, N, B, rad, flat = 0.18) {
    const { segs, radial, pos, nor, uv, under } = this; let k = 0;
    for (let i = 0; i <= segs; i++) {
      const p = pts[i], n = N[i], b = B[i], r = rad[i];
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
        // ca = 1 → underside (n direction). Flatten the sucker side slightly.
        const rr = r * (ca > 0 ? 1 - flat * ca * ca : 1);
        const nx = ca * n.x + sa * b.x, ny = ca * n.y + sa * b.y, nz = ca * n.z + sa * b.z;
        pos[k * 3] = p.x + nx * rr; pos[k * 3 + 1] = p.y + ny * rr; pos[k * 3 + 2] = p.z + nz * rr;
        nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
        uv[k * 2] = i / segs; uv[k * 2 + 1] = j / radial; under[k] = Math.max(0, ca);
        k++;
      }
    }
    if (this.caps) { const p = pts[segs], q = pts[segs - 1]; const d = new THREE.Vector3().subVectors(p, q).normalize(); pos[k * 3] = p.x + d.x * rad[segs] * .8; pos[k * 3 + 1] = p.y + d.y * rad[segs] * .8; pos[k * 3 + 2] = p.z + d.z * rad[segs] * .8; nor[k * 3] = d.x; nor[k * 3 + 1] = d.y; nor[k * 3 + 2] = d.z; under[k] = .5; }
    const g = this.geometry; g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.aUnder.needsUpdate = true;
  }
}

// Static tube between points with constant radius (bike tubes)
export function tubeAlong(points, radius, material, { segs = 32, radial = 16, closed = false, tension = .5 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), closed, 'catmullrom', tension);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, radial, closed), material);
}
export function cyl(a, b, r1, r2, material, radial = 16) {
  a = a.isVector3 ? a : new THREE.Vector3(...a); b = b.isVector3 ? b : new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, L, radial, 1), material);
  m.position.copy(a).addScaledVector(d, .5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
