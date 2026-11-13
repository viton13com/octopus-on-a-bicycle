// The navigator: a small shore crab riding in the front basket. Eyes on stalks, eight walking legs, two claws that open.
import * as THREE from 'three';
import { TAU, V, cyl, clamp, lerp } from './util.js';

export function buildCrab() {
  const g = new THREE.Group();
  const shell = new THREE.MeshPhysicalMaterial({ color: '#d4542a', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const pale = new THREE.MeshPhysicalMaterial({ color: '#f0a070', roughness: 0.45, clearcoat: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#141010', roughness: 0.2 });
  // carapace: squashed, wider at the front, with a few bumps
  const cg = new THREE.SphereGeometry(1, 48, 24); { const p = cg.attributes.position; for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const front = x > 0 ? 1 + 0.15 * x : 1 - 0.25 * -x; const bump = 1 + 0.04 * Math.sin(z * 9) * Math.sin(x * 7) * (y > 0 ? 1 : 0);
    p.setXYZ(i, x * 0.042 * bump, (y > 0 ? y * 0.026 : y * 0.014) * bump, z * 0.06 * front * bump); } cg.computeVertexNormals(); }
  const body = new THREE.Mesh(cg, shell); body.castShadow = true; g.add(body);
  // eye stalks
  const eyes = [];
  for (const s of [-1, 1]) { const st = new THREE.Group(); st.position.set(0.035, 0.018, 0.016 * s); g.add(st);
    st.add(cyl(V(0, 0, 0), V(0.006, 0.03, 0), 0.0035, 0.003, pale, 8)); const e = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 14, 10), dark); e.position.set(0.006, 0.033, 0); st.add(e);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' })); hl.position.set(0.011, 0.036, 0.002 * s); st.add(hl); eyes.push(st); }
  // legs
  const legs = [];
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) { const root = new THREE.Group(); root.position.set(0.015 - k * 0.017, -0.004, 0.045 * s); root.rotation.y = s * (0.15 + k * 0.35) * -1 + (s < 0 ? Math.PI : 0); g.add(root);
    const up = new THREE.Group(); root.add(up); up.add(cyl(V(0, 0, 0), V(0.045, 0.02, 0), 0.0045, 0.0035, shell, 8));
    const low = new THREE.Group(); low.position.set(0.045, 0.02, 0); up.add(low); low.add(cyl(V(0, 0, 0), V(0.035, -0.045, 0), 0.0035, 0.0015, shell, 8));
    legs.push({ root, up, low, k, s }); }
  // claws
  const claws = [];
  for (const s of [-1, 1]) { const arm = new THREE.Group(); arm.position.set(0.04, 0.0, 0.035 * s); g.add(arm);
    arm.add(cyl(V(0, 0, 0), V(0.03, 0.012, 0.022 * s), 0.006, 0.006, shell, 8));
    const fore = new THREE.Group(); fore.position.set(0.03, 0.012, 0.022 * s); arm.add(fore); fore.add(cyl(V(0, 0, 0), V(0.03, 0.02, 0.0), 0.007, 0.008, shell, 8));
    const hand = new THREE.Group(); hand.position.set(0.03, 0.02, 0); fore.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 10), shell); palm.scale.set(1.5, 1, 0.8); hand.add(palm);
    const fix = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.03, 8), dark); fix.rotation.z = -Math.PI / 2 - 0.2; fix.position.set(0.03, -0.004, 0); hand.add(fix);
    const mov = new THREE.Group(); mov.position.set(0.014, 0.006, 0); hand.add(mov); const mc = new THREE.Mesh(new THREE.ConeGeometry(0.0055, 0.028, 8), dark); mc.rotation.z = -Math.PI / 2 + 0.2; mc.position.set(0.014, 0, 0); mov.add(mc);
    claws.push({ arm, fore, hand, mov, s }); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  function update(t, P) { // P: wave 0..1, look (vec in crab local) optional
    const w = P.wave ?? 0;
    body.position.y = 0.003 * Math.sin(t * 9) * (0.3 + w);
    claws.forEach((c, i) => { const ph = t * (3 + w * 5) + i * 1.7;
      c.arm.rotation.z = lerp(0.1, 0.9 + 0.3 * Math.sin(ph), w) ; c.arm.rotation.x = c.s * lerp(0.1, 0.5, w);
      c.fore.rotation.z = lerp(0.3, 0.6 + 0.4 * Math.sin(ph * 1.3), w);
      c.mov.rotation.z = 0.25 + 0.25 * Math.sin(t * (2 + w * 10) + i); });
    eyes.forEach((e, i) => { e.rotation.y = 0.4 * Math.sin(t * 0.8 + i * 2) * (1 - w * 0.5) + (P.lookYaw ?? 0); e.rotation.z = 0.15 * Math.sin(t * 1.1 + i) - w * 0.3; });
    legs.forEach((l) => { l.up.rotation.z = 0.25 + 0.08 * Math.sin(t * 5 + l.k + l.s) * w; l.low.rotation.z = -0.2; });
  }
  return { root: g, update };
}
