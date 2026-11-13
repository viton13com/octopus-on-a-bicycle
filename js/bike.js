// A 28" Dutch-style roadster, built part by part. Local frame: +X forward, +Y up, +Z rider's right (drive side).
// Origin = rear tyre contact patch. All kinematics (wheels, cranks, chain, freewheel, steering) are driven from update().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, V, cyl, tubeAlong, canvasTex, rng, clamp } from './util.js';

export const R_TYRE = 0.35, WB = 1.12;
export const BB = V(0.43, 0.28, 0);
export const N_RING = 44, N_COG = 18, PITCH = 0.0127, CRANK = 0.17;
export const R_RING = PITCH / (2 * Math.sin(Math.PI / N_RING)), R_COG = PITCH / (2 * Math.sin(Math.PI / N_COG));
export const RATIO = N_RING / N_COG;
const CHAIN_Z = 0.052;

// steering axis: head angle 70°, fork rake 45 mm
const HA = 70 * Math.PI / 180;
export const AXIS_DOWN = V(Math.cos(HA), -Math.sin(HA), 0).normalize(); // points down-forward
const AXIS_N = V(Math.sin(HA), Math.cos(HA), 0);                     // perpendicular, forward-up
export const F_AXLE = V(WB, R_TYRE, 0);
const AX_P = F_AXLE.clone().addScaledVector(AXIS_N, -0.045);         // point on axis level with the axle
const HT_BOT = AX_P.clone().addScaledVector(AXIS_DOWN, -0.43);
const HT_TOP = HT_BOT.clone().addScaledVector(AXIS_DOWN, -0.15);
const SEAT_DIR = V(-Math.cos(73 * Math.PI / 180), Math.sin(73 * Math.PI / 180), 0);
const ST_TOP = BB.clone().addScaledVector(SEAT_DIR, 0.54);
export const SADDLE = BB.clone().addScaledVector(SEAT_DIR, 0.70).add(V(0, 0.035, 0));

export function buildBike() {
  const root = new THREE.Group(); root.name = 'bike';
  const M = makeMaterials();
  const add = (o, parent = root) => { o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
  const rearAxle = V(0, R_TYRE, 0);

  // ---------------- frame ----------------
  const frame = new THREE.Group(); root.add(frame);
  const TT0 = ST_TOP.clone().add(V(0.015, -0.03, 0)), TT1 = HT_TOP.clone().addScaledVector(AXIS_DOWN, 0.035);
  const DT0 = BB.clone().add(V(0.02, 0.02, 0)), DT1 = HT_BOT.clone().addScaledVector(AXIS_DOWN, -0.035);
  add(cyl(TT0, TT1, 0.0145, 0.0145, M.paint, 24), frame);
  // decal-painted down tube
  { const dt = cyl(DT0, DT1, 0.0175, 0.0175, M.downTube, 32); add(dt, frame); }
  add(cyl(BB.clone().add(V(-0.006, -0.01, 0)), ST_TOP.clone().addScaledVector(SEAT_DIR, 0.02), 0.0155, 0.0155, M.paint, 24), frame);
  add(cyl(HT_BOT.clone().addScaledVector(AXIS_DOWN, 0.012), HT_TOP.clone().addScaledVector(AXIS_DOWN, -0.012), 0.019, 0.019, M.paint, 24), frame);
  // head-tube lug rings + headset cups (chrome)
  for (const p of [HT_BOT, HT_TOP]) { const r = cyl(p.clone().addScaledVector(AXIS_DOWN, -0.008), p.clone().addScaledVector(AXIS_DOWN, 0.008), 0.0215, 0.0215, M.chrome, 24); add(r, frame); }
  // stays (both sides)
  for (const s of [-1, 1]) {
    const dropout = rearAxle.clone().add(V(0.012, 0, 0.066 * s));
    add(tubeAlong([BB.clone().add(V(-0.02, 0, 0.03 * s)), V(0.25, 0.30, 0.05 * s), V(0.07, 0.34, 0.064 * s), dropout], 0.0085, M.paint, { segs: 40, radial: 12 }), frame);
    add(tubeAlong([ST_TOP.clone().add(V(-0.01, -0.035, 0.02 * s)), V(0.18, 0.66, 0.045 * s), V(0.05, 0.42, 0.062 * s), dropout.clone().add(V(0, 0.01, 0))], 0.0075, M.paint, { segs: 40, radial: 12 }), frame);
    // dropout plate
    const dp = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 20), M.chrome); dp.rotation.x = Math.PI / 2; dp.position.copy(rearAxle).setZ(0.068 * s); add(dp, frame);
  }
  // bottom bracket shell
  { const bb = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.075, 28), M.paint); bb.rotation.x = Math.PI / 2; bb.position.copy(BB); add(bb, frame);
    for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.0225, 0.0225, 0.008, 28), M.chrome); c.rotation.x = Math.PI / 2; c.position.copy(BB).setZ(0.04 * s); add(c, frame); } }
  // seat cluster lug
  { const l = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 14), M.chrome); l.position.copy(ST_TOP).add(V(0.004, -0.03, 0)); l.scale.set(1, 1.5, 1); add(l, frame); }
  // seat post + saddle
  add(cyl(ST_TOP, SADDLE.clone().add(V(0, -0.045, 0)), 0.0115, 0.0115, M.chrome, 20), frame);
  buildSaddle(frame, M, add);
  // rear rack
  { const top = [V(-0.24, 0.64, -0.065), V(0.10, 0.64, -0.065), V(0.10, 0.64, 0.065), V(-0.24, 0.64, 0.065)];
    add(tubeAlong([...top, top[0]], 0.0055, M.chrome, { segs: 60, radial: 10, tension: 0.05 }), frame);
    for (let k = 1; k < 4; k++) add(cyl(V(-0.24 + k * 0.085, 0.64, -0.065), V(-0.24 + k * 0.085, 0.64, 0.065), 0.004, 0.004, M.chrome, 8), frame);
    for (const s of [-1, 1]) { add(cyl(V(-0.20, 0.64, 0.066 * s), V(0.004, R_TYRE + 0.01, 0.07 * s), 0.0045, 0.0045, M.chrome, 10), frame);
      add(cyl(V(0.09, 0.64, 0.066 * s), ST_TOP.clone().add(V(-0.03, -0.06, 0.02 * s)), 0.004, 0.004, M.chrome, 10), frame); }
    // red reflector
    const rf = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.07), M.reflector); rf.position.set(-0.255, 0.625, 0); add(rf, frame); }
  // rear mudguard
  add(new THREE.Mesh(fenderGeo(0.372, 0.16 * Math.PI, 1.2 * Math.PI, 0.054), M.paint), frame).position.copy(rearAxle);
  for (const s of [-1, 1]) add(cyl(V(-0.012, R_TYRE, 0.07 * s), V(-0.012 - 0.37 * Math.cos(0.17 * Math.PI), R_TYRE - 0.37 * Math.sin(0.17 * Math.PI), 0.027 * s), 0.0026, 0.0026, M.chrome, 8), frame);

  // ---------------- wheels ----------------
  const tyreTex = makeTyreTexture();
  const rearWheel = buildWheel(M, tyreTex); rearWheel.position.copy(rearAxle); root.add(rearWheel);
  // rear cog (rotates with chain) and freewheel body
  const cog = new THREE.Mesh(sprocketGeo(N_COG, R_COG, 0, 0.0025), M.steel); cog.position.copy(rearAxle).setZ(CHAIN_Z - 0.00125); add(cog);

  // ---------------- drivetrain ----------------
  const crankset = new THREE.Group(); crankset.position.copy(BB); root.add(crankset);
  const ring = new THREE.Mesh(sprocketGeo(N_RING, R_RING, 5, 0.003), M.chrome); ring.position.z = CHAIN_Z - 0.0015; add(ring, crankset);
  const armGeo = stadiumGeo(CRANK, 0.016, 0.011, 0.012);
  const crankR = new THREE.Mesh(armGeo, M.chrome); crankR.position.z = 0.072; add(crankR, crankset);
  const crankL = new THREE.Mesh(armGeo, M.chrome); crankL.position.z = -0.084; crankL.rotation.z = Math.PI; add(crankL, crankset);
  add(cyl(V(0, 0, -0.085), V(0, 0, 0.085), 0.008, 0.008, M.steel, 12), crankset);
  for (const s of [-1, 1]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 16), M.chrome); cap.rotation.x = Math.PI / 2; cap.position.z = 0.086 * s; add(cap, crankset); }
  const pedalGeo = makePedalGeo();
  const pedalR = new THREE.Group(), pedalL = new THREE.Group();
  for (const [pg, s] of [[pedalR, 1], [pedalL, -1]]) { const pm = new THREE.Mesh(pedalGeo.body, M.rubber); add(pm, pg); const pc = new THREE.Mesh(pedalGeo.cage, M.chrome); add(pc, pg); pg.scale.z = s; root.add(pg); }
  const chain = buildChain(M, root, rearAxle);

  // ---------------- steering assembly ----------------
  const front = new THREE.Group(); front.position.copy(AX_P); root.add(front);
  const fl = (v) => v.clone().sub(AX_P); // world(bike) → front-local
  const fAxle = fl(F_AXLE);
  const frontWheel = buildWheel(M, tyreTex, true); frontWheel.position.copy(fAxle); front.add(frontWheel);
  // fork: crown + two raked blades
  const crown = fl(HT_BOT).addScaledVector(AXIS_DOWN, 0.02);
  { const c = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.022, 0.12), M.chrome); c.position.copy(crown); c.rotation.z = -(Math.PI / 2 - HA); add(c, front); }
  for (const s of [-1, 1]) {
    const a = crown.clone().add(V(0, -0.005, 0.052 * s)), b = fAxle.clone().add(V(0, 0, 0.052 * s));
    const mid = a.clone().lerp(b, 0.6).addScaledVector(AXIS_N, 0.012), low = a.clone().lerp(b, 0.88).addScaledVector(AXIS_N, 0.03);
    add(tubeAlong([a, mid, low, b], 0.0115, M.paint, { segs: 40, radial: 14 }), front);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 16), M.chrome); tip.rotation.x = Math.PI / 2; tip.position.copy(b).setZ(0.058 * s); add(tip, front);
    add(cyl(V(0, 0, 0.056 * s).add(fAxle), fAxle.clone().add(V(0.37 * Math.cos(0.07 * Math.PI), 0.37 * Math.sin(0.07 * Math.PI) - 0.0, 0.026 * s)), 0.0026, 0.0026, M.chrome, 8), front); // mudguard stay
  }
  // front mudguard
  { const fg = new THREE.Mesh(fenderGeo(0.372, -0.08 * Math.PI, 1.12 * Math.PI, 0.052), M.paint); fg.position.copy(fAxle); add(fg, front); }
  // steerer, stem (quill) and swept-back handlebar
  const stemTop = fl(HT_TOP).addScaledVector(AXIS_DOWN, -0.075);
  add(cyl(fl(HT_TOP).addScaledVector(AXIS_DOWN, 0.01), stemTop, 0.011, 0.011, M.chrome, 16), front);
  const clamp0 = stemTop.clone().add(V(0.055, 0.012, 0));
  add(cyl(stemTop, clamp0, 0.0105, 0.012, M.chrome, 16), front);
  { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 20), M.chrome); b.rotation.x = Math.PI / 2; b.position.copy(clamp0); add(b, front); }
  const barPts = (s) => [V(0, 0, 0.22 * s), V(0, 0.002, 0.10 * s), V(-0.035, 0.012, 0.19 * s), V(-0.115, 0.035, 0.255 * s), V(-0.20, 0.045, 0.275 * s), V(-0.27, 0.046, 0.28 * s)].map((p) => p.add(clamp0));
  const barL = barPts(-1), barR = barPts(1);
  add(tubeAlong([...barL.slice(1).reverse(), clamp0.clone(), ...barR.slice(1)], 0.0112, M.chrome, { segs: 140, radial: 16 }), front);
  // leather grips
  const grip = (s) => { const bp = s < 0 ? barL : barR; const a = bp[4].clone().lerp(bp[3], 0.25), b = bp[5].clone().add(V(-0.02, 0, 0));
    const g = cyl(a, b, 0.0165, 0.0175, M.grip, 20); add(g, front); const e = cyl(b, b.clone().add(b.clone().sub(a).normalize().multiplyScalar(0.012)), 0.019, 0.019, M.chrome, 20); add(e, front); return [a, b]; };
  const gL = grip(-1), gR = grip(1);
  // brake levers (rod-style lever stubs)
  for (const s of [-1, 1]) { const bp = s < 0 ? barL : barR; add(tubeAlong([bp[3].clone().add(V(0.01, -0.005, 0)), bp[3].clone().add(V(0.03, -0.035, 0.01 * s)), bp[4].clone().add(V(0.02, -0.045, 0.01 * s))], 0.0045, M.chrome, { segs: 16, radial: 8 }), front); }
  // bell on the left bar
  const bellPos = barL[2].clone().add(V(0.004, 0.012, 0.015));
  const bell = new THREE.Group(); bell.position.copy(bellPos); front.add(bell);
  { const dome = new THREE.Mesh(new THREE.SphereGeometry(0.029, 32, 16, 0, TAU, 0, Math.PI * 0.5), M.chrome); dome.position.y = 0.022; add(dome, bell);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.0025, 8, 40), M.chrome); rim.rotation.x = Math.PI / 2; rim.position.y = 0.022; add(rim, bell);
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), M.chrome); nub.position.y = 0.052; add(nub, bell);
    add(cyl(V(0, -0.012, 0), V(0, 0.022, 0), 0.006, 0.006, M.chrome, 10), bell); }
  const bellLever = new THREE.Group(); bellLever.position.copy(bellPos).add(V(-0.012, 0.018, 0.028)); front.add(bellLever);
  add(cyl(V(0, 0, 0), V(-0.03, 0.004, 0.018), 0.003, 0.0035, M.chrome, 8), bellLever);
  { const k = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), M.chrome); k.position.set(-0.03, 0.004, 0.018); add(k, bellLever); }
  // headlamp on the crown
  const lamp = new THREE.Group(); lamp.position.copy(crown).add(V(0.055, 0.015, 0)); front.add(lamp);
  { const body = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.06, 32, 1, true), M.chrome); body.rotation.z = Math.PI / 2; add(body, lamp);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.028, 24, 12, 0, TAU, 0, Math.PI / 2), M.chrome); back.rotation.z = Math.PI / 2; back.position.x = -0.03; add(back, lamp);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.032, 32), M.lens); lens.rotation.y = Math.PI / 2; lens.position.x = 0.0305; lamp.add(lens);
    const ringL = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.003, 8, 40), M.chrome); ringL.rotation.y = Math.PI / 2; ringL.position.x = 0.031; add(ringL, lamp);
    add(cyl(V(-0.03, -0.01, 0), V(-0.06, -0.012, 0), 0.005, 0.005, M.chrome, 8), lamp); }
  // wicker basket on the bars
  const basket = buildBasket(M); basket.position.copy(clamp0).add(V(0.17, -0.11, 0)); front.add(basket);
  add(cyl(clamp0.clone().add(V(0.01, -0.005, 0.07)), basket.position.clone().add(V(-0.09, 0.07, 0.08)), 0.003, 0.003, M.chrome, 8), front);
  add(cyl(clamp0.clone().add(V(0.01, -0.005, -0.07)), basket.position.clone().add(V(-0.09, 0.07, -0.08)), 0.003, 0.003, M.chrome, 8), front);
  add(cyl(fAxle.clone().add(V(0.0, 0.0, 0.06)), basket.position.clone().add(V(-0.02, -0.10, 0.07)), 0.0028, 0.0028, M.chrome, 8), front);
  add(cyl(fAxle.clone().add(V(0.0, 0.0, -0.06)), basket.position.clone().add(V(-0.02, -0.10, -0.07)), 0.0028, 0.0028, M.chrome, 8), front);

  // targets the octopus reaches for (front-local values, converted in update)
  const gripAxis = (g) => g[1].clone().sub(g[0]).normalize();
  const local = {
    gripL: { p: gL[0].clone().lerp(gL[1], 0.55), axis: gripAxis(gL) }, gripR: { p: gR[0].clone().lerp(gR[1], 0.55), axis: gripAxis(gR) },
    bell: { p: bellLever.position.clone().add(V(-0.03, 0.004, 0.018)) }, basket: { p: basket.position.clone() },
  };
  const targets = { gripL: { p: V(), axis: V() }, gripR: { p: V(), axis: V() }, bell: { p: V() }, basket: { p: V() }, pedalL: { p: V(), axis: V(0, 0, -1) }, pedalR: { p: V(), axis: V(0, 0, 1) }, saddle: SADDLE.clone(), seatPost: ST_TOP.clone().lerp(SADDLE, 0.4) };
  const axisQ = new THREE.Quaternion(), axisUp = AXIS_DOWN.clone().negate();

  function update(st) {
    rearWheel.userData.spin.rotation.z = -st.wheelR; frontWheel.userData.spin.rotation.z = -st.wheelF;
    cog.rotation.z = -st.chainS / R_COG; ring.rotation.z = 0;
    crankset.rotation.z = -st.crank;
    for (const [pg, s] of [[pedalR, 1], [pedalL, -1]]) { const a = -st.crank + (s < 0 ? Math.PI : 0); pg.position.set(BB.x + Math.cos(a) * CRANK, BB.y + Math.sin(a) * CRANK, 0.125 * s); pg.rotation.z = st.pedalTilt?.[s < 0 ? 1 : 0] ?? 0; }
    chain.update(st.chainS);
    axisQ.setFromAxisAngle(axisUp, st.steer); front.quaternion.copy(axisQ);
    bellLever.rotation.y = st.bellLever || 0;
    M.lens.emissiveIntensity = st.lamp || 0;
    front.updateMatrix();
    for (const k of ['gripL', 'gripR']) { targets[k].p.copy(local[k].p).applyMatrix4(front.matrix); targets[k].axis.copy(local[k].axis).applyQuaternion(axisQ); }
    targets.bell.p.copy(local.bell.p).applyMatrix4(front.matrix); targets.basket.p.copy(local.basket.p).applyMatrix4(front.matrix);
    targets.pedalR.p.copy(pedalR.position).add(V(0, 0.005, 0.045)); targets.pedalL.p.copy(pedalL.position).add(V(0, 0.005, -0.045));
  }
  return { root, front, update, targets, basket, lamp, materials: M };
}

// ---------------------------------------------------------------------------------------------------------------
function makeMaterials() {
  const paintCol = new THREE.Color('#79c9b3');
  const paint = new THREE.MeshPhysicalMaterial({ color: paintCol, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  // cylinder UV: u = around (u=0 faces +Z), v = along (1 = head-tube end). Text runs along the tube on both sides.
  const decal = canvasTex(512, 2048, (g, w, h) => {
    g.fillStyle = '#79c9b3'; g.fillRect(0, 0, w, h);
    for (const [cx, dir] of [[0, 1], [w, 1], [w * 0.5, -1]]) {
      g.save(); g.translate(cx, h * 0.5); g.rotate(-Math.PI / 2 * dir); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fbf3e0'; g.fillRect(-h * 0.36, -54, h * 0.72, 5); g.fillRect(-h * 0.36, 49, h * 0.72, 5);
      g.font = 'italic 700 92px "Didot", "Bodoni 72", Georgia, serif'; g.fillText('Octopus Cycles', 0, -6);
      g.fillStyle = '#c2412d'; g.font = '800 22px "Avenir Next", sans-serif'; g.fillText('EIGHT-ARM CERTIFIED  ·  EST. 2026', 0, 36);
      g.restore(); }
  });
  const downTube = new THREE.MeshPhysicalMaterial({ map: decal, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  return {
    paint, downTube,
    chrome: new THREE.MeshStandardMaterial({ color: '#f2f2f2', metalness: 1, roughness: 0.1 }),
    steel: new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 1, roughness: 0.32 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: '#3a3d42', metalness: 0.9, roughness: 0.42 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#1d1b1a', roughness: 0.85 }),
    grip: new THREE.MeshPhysicalMaterial({ color: '#6b3a1f', roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.4, sheen: 0.4, sheenColor: new THREE.Color('#a86a3c') }),
    leather: new THREE.MeshPhysicalMaterial({ color: '#7a4422', roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    reflector: new THREE.MeshPhysicalMaterial({ color: '#d0101a', roughness: 0.1, transmission: 0.2, emissive: '#400000' }),
    lens: new THREE.MeshPhysicalMaterial({ color: '#fff6dc', roughness: 0.05, metalness: 0, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0, clearcoat: 1 }),
    wicker: null,
  };
}

function makeTyreTexture() {
  return canvasTex(4096, 256, (g, w, h) => {
    // v: 0 = outer tread → .25 side → .5 rim-side → .75 other side → 1 tread
    const band = (a, b, col) => { g.fillStyle = col; g.fillRect(0, a * h, w, (b - a) * h); };
    band(0, 1, '#1b1918');
    band(0.16, 0.42, '#c79a63'); band(0.58, 0.84, '#c79a63');          // gumwall
    band(0.16, 0.175, '#2a2522'); band(0.825, 0.84, '#2a2522'); band(0.405, 0.42, '#2a2522'); band(0.58, 0.595, '#2a2522');
    // tread blocks (chevrons) on both tread halves (v≈0 and v≈1 wrap)
    g.fillStyle = '#2e2b29';
    for (let i = 0; i < 160; i++) { const x = i / 160 * w;
      for (const [y0, dir] of [[0.0, 1], [1.0, -1]]) { g.beginPath(); g.moveTo(x, y0 * h); g.lineTo(x + 12, y0 * h); g.lineTo(x + 22, y0 * h + dir * 30); g.lineTo(x + 10, y0 * h + dir * 30); g.closePath(); g.fill(); } }
    g.fillStyle = 'rgba(0,0,0,.35)'; for (let i = 0; i < 320; i++) g.fillRect(i / 320 * w, 0.115 * h, 3, 0.03 * h);
    // sidewall lettering
    g.fillStyle = '#5a3f22'; g.font = '700 30px "Avenir Next", "Helvetica Neue", sans-serif'; g.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) for (const v of [0.29, 0.71]) { g.save(); g.translate((k + 0.1) / 3 * w, v * h); if (v > 0.5) g.scale(-1, -1); g.fillText('OCTO ROADSTER  ·  28 × 1½  ·  INFLATE TO 3.5 BAR  ·  HAND-MADE FOR EIGHT LIMBS', 0, 0); g.restore(); }
  }, { aniso: 16 });
}

function buildWheel(M, tyreTex, isFront = false) {
  const g = new THREE.Group(); const spin = new THREE.Group(); g.add(spin); g.userData.spin = spin;
  const tyreMat = new THREE.MeshStandardMaterial({ map: tyreTex, roughness: 0.88, metalness: 0 });
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.3285, 0.0215, 28, 220), tyreMat); tyre.castShadow = tyre.receiveShadow = true; spin.add(tyre);
  // rim: lathe profile (r, z) swept around Z
  const prof = [[0.300, -0.0115], [0.305, -0.012], [0.3105, -0.0115], [0.313, -0.009], [0.312, 0.0], [0.313, 0.009], [0.3105, 0.0115], [0.305, 0.012], [0.300, 0.0115], [0.296, 0.006], [0.295, 0], [0.296, -0.006], [0.300, -0.0115]].map(([r, z]) => new THREE.Vector2(r, z));
  const rimG = new THREE.LatheGeometry(prof, 200); rimG.rotateX(Math.PI / 2);
  const rim = new THREE.Mesh(rimG, M.chrome); rim.castShadow = true; spin.add(rim);
  // hub with flanges
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.09, 24), M.chrome); hub.rotation.x = Math.PI / 2; spin.add(hub);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0145, 0.1, 24), M.steel); barrel.rotation.x = Math.PI / 2; spin.add(barrel);
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.004, 36), M.chrome); f.rotation.x = Math.PI / 2; f.position.z = 0.035 * s; spin.add(f); }
  // 36 spokes, 3-cross lacing, + nipples
  const sp = [], np = [], N = 36;
  for (let i = 0; i < N; i++) {
    const side = i % 2 ? 1 : -1, lead = Math.floor(i / 2) % 2 ? 1 : -1, br = i / N * TAU, bh = br + lead * (3 * 2 * TAU / N);
    const a = V(Math.cos(bh) * 0.028, Math.sin(bh) * 0.028, 0.035 * side), b = V(Math.cos(br) * 0.297, Math.sin(br) * 0.297, 0.003 * side);
    const d = b.clone().sub(a), L = d.length(); const c = new THREE.CylinderGeometry(0.00105, 0.00105, L, 5, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize()); c.applyQuaternion(q); c.translate(...a.clone().addScaledVector(d, 0.5).toArray()); sp.push(c);
    const n = new THREE.CylinderGeometry(0.0022, 0.0022, 0.012, 6); n.applyQuaternion(q); n.translate(...b.clone().addScaledVector(d.clone().normalize(), -0.004).toArray()); np.push(n);
    const head = new THREE.SphereGeometry(0.0022, 6, 4); head.translate(...a.toArray()); np.push(head);
  }
  const spokes = new THREE.Mesh(mergeGeometries(sp), M.steel); spokes.castShadow = true; spin.add(spokes);
  const nip = new THREE.Mesh(mergeGeometries(np), M.chrome); spin.add(nip);
  // valve stem
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 8), M.steel); valve.position.set(0, 0.297, 0); spin.add(valve);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.008, 10), M.darkSteel); cap.position.set(0, 0.285, 0); spin.add(cap);
  // axle nuts (static)
  for (const s of [-1, 1]) { const n = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 6), M.chrome); n.rotation.x = Math.PI / 2; n.position.z = (isFront ? 0.063 : 0.073) * s; g.add(n); }
  return g;
}

function sprocketGeo(N, R, spiderArms, depth) {
  const sh = new THREE.Shape(), rr = R - 0.0042, rt = R + 0.0032;
  const steps = N * 10;
  for (let i = 0; i <= steps; i++) { const th = i / steps * TAU, f = (i % 10) / 10; const prof = Math.pow(Math.max(0, Math.sin(Math.PI * clamp((f - 0.12) / 0.76))), 0.7);
    const r = rr + (rt - rr) * prof; const x = Math.cos(th) * r, y = Math.sin(th) * r; i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
  if (spiderArms) {
    for (let k = 0; k < spiderArms; k++) { const a0 = k / spiderArms * TAU + 0.16, a1 = (k + 1) / spiderArms * TAU - 0.16, r0 = 0.03, r1 = R - 0.016, h = new THREE.Path();
      h.moveTo(Math.cos(a0) * r0 * 1.15, Math.sin(a0) * r0 * 1.15);
      h.absarc(0, 0, r1, a0 + 0.07, a1 - 0.07, false); h.lineTo(Math.cos(a1) * r0 * 1.15, Math.sin(a1) * r0 * 1.15);
      h.absarc(0, 0, r0, a1 - 0.25, a0 + 0.25, true); sh.holes.push(h); }
    const c = new THREE.Path(); c.absarc(0, 0, 0.012, 0, TAU, true); sh.holes.push(c);
  } else { const c = new THREE.Path(); c.absarc(0, 0, 0.012, 0, TAU, true); sh.holes.push(c); }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 2, curveSegments: 24 });
  return g;
}

function stadiumGeo(L, r0, r1, depth) { // crank arm: rounded taper from origin to (L,0)
  const s = new THREE.Shape(); const a = Math.asin((r0 - r1) / L);
  s.absarc(0, 0, r0, Math.PI / 2 + a, -Math.PI / 2 - a, false); s.absarc(L, 0, r1, -Math.PI / 2 - a, Math.PI / 2 + a, false); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0025, bevelSegments: 3, curveSegments: 20 }); g.translate(0, 0, -depth / 2); return g;
}

function makePedalGeo() {
  const parts = [], cage = [];
  const blk = (x, y, z, w, h, d) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); return b; };
  parts.push(blk(0, 0, 0.055, 0.075, 0.022, 0.085));
  for (const y of [-0.012, 0.012]) for (let k = 0; k < 6; k++) parts.push(blk(-0.03 + k * 0.012, y, 0.055, 0.006, 0.006, 0.087));
  cage.push(blk(0.04, 0, 0.055, 0.004, 0.026, 0.095), blk(-0.04, 0, 0.055, 0.004, 0.026, 0.095));
  const sp = new THREE.CylinderGeometry(0.006, 0.006, 0.11, 10); sp.rotateX(Math.PI / 2); sp.translate(0, 0, 0.05); cage.push(sp);
  return { body: mergeGeometries(parts), cage: mergeGeometries(cage) };
}

function fenderGeo(R, a0, a1, w) {
  const nu = 120, nv = 10, pos = [], idx = [];
  for (let i = 0; i <= nu; i++) { const a = a0 + (a1 - a0) * i / nu; for (let j = 0; j <= nv; j++) { const v = j / nv * 2 - 1, r = R + (1 - v * v) * 0.014 - 0.006; pos.push(Math.cos(a) * r, Math.sin(a) * r, v * w * 0.5); } }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m2 = g.clone(); return g;
}

function buildSaddle(parent, M, add) {
  const g = new THREE.SphereGeometry(1, 64, 32); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = (x + 1) / 2; // 0 rear → 1 nose
    const wdt = 0.088 * (1 - 0.68 * Math.pow(u, 1.6)) * (u < 0.08 ? 0.92 + u : 1);
    const top = y > 0 ? y * 0.022 * (1 + 0.4 * (1 - u)) : y * 0.035;
    p.setXYZ(i, (x * 0.135), top + (u > 0.75 ? (u - 0.75) * 0.05 : 0), z * wdt * (y < 0 ? 1.04 : 1)); }
  g.computeVertexNormals();
  const s = new THREE.Mesh(g, M.leather); s.position.copy(SADDLE); s.rotation.z = 0.04; add(s, parent);
  for (let k = 0; k < 7; k++) { const a = (k / 6 - 0.5) * 2.2; const r = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 10, 6), M.chrome); r.position.copy(SADDLE).add(V(-0.128 + Math.abs(Math.sin(a)) * 0.03, 0.002, Math.sin(a) * 0.078)); add(r, parent); }
  // coil springs + rails
  for (const s2 of [-1, 1]) { const pts = []; for (let i = 0; i <= 120; i++) { const t = i / 120, a = t * TAU * 6; pts.push(V(Math.cos(a) * 0.013, -0.075 + t * 0.06, Math.sin(a) * 0.013).add(SADDLE).add(V(-0.085, 0, 0.05 * s2))); }
    add(tubeAlong(pts, 0.0026, M.chrome, { segs: 240, radial: 6 }), parent);
    add(tubeAlong([SADDLE.clone().add(V(0.11, -0.012, 0)), SADDLE.clone().add(V(0.02, -0.04, 0.03 * s2)), SADDLE.clone().add(V(-0.085, -0.075, 0.05 * s2))], 0.0035, M.chrome, { segs: 24, radial: 8 }), parent); }
  add(cyl(SADDLE.clone().add(V(-0.085, -0.076, -0.055)), SADDLE.clone().add(V(-0.085, -0.076, 0.055)), 0.004, 0.004, M.chrome, 8), parent);
  add(cyl(SADDLE.clone().add(V(-0.085, -0.076, 0)), SADDLE.clone().add(V(0.005, -0.045, 0)), 0.005, 0.005, M.chrome, 8), parent);
}

function buildBasket(M) {
  const tex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6e4a24'; g.fillRect(0, 0, w, h);
    const rows = 22, cols = 14;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = c / cols * w, y = r / rows * h, over = (r + c) % 2;
      const grd = g.createLinearGradient(0, y, 0, y + h / rows); grd.addColorStop(0, over ? '#c8955a' : '#a87843'); grd.addColorStop(.5, over ? '#e2b67a' : '#bd8a52'); grd.addColorStop(1, '#7e5530');
      g.fillStyle = grd; g.beginPath(); g.roundRect(x + 1, y + 1.5, w / cols - 2, h / rows - 3, 6); g.fill(); }
    g.fillStyle = 'rgba(70,40,15,.8)'; for (let c = 0; c < cols; c++) g.fillRect(c / cols * w - 2, 0, 4, h);
  }, { repeat: [1, 1] });
  const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2.5, roughness: 0.8, side: THREE.DoubleSide });
  M.wicker = mat;
  const g = new THREE.Group(); const W = 0.33, D = 0.26, H = 0.2;
  const face = (w, h, pos, rot) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(...pos); m.rotation.set(...rot); m.castShadow = m.receiveShadow = true; g.add(m); };
  face(W, H, [0, 0, D / 2], [0, 0, 0]); face(W, H, [0, 0, -D / 2], [0, 0, 0]); face(D, H, [W / 2, 0, 0], [0, Math.PI / 2, 0]); face(D, H, [-W / 2, 0, 0], [0, Math.PI / 2, 0]); face(W, D, [0, -H / 2, 0], [Math.PI / 2, 0, 0]);
  const rimMat = new THREE.MeshStandardMaterial({ color: '#8a5d31', roughness: 0.7 });
  const rp = [V(-W / 2, H / 2, -D / 2), V(W / 2, H / 2, -D / 2), V(W / 2, H / 2, D / 2), V(-W / 2, H / 2, D / 2)];
  const rim = tubeAlong([...rp, rp[0]], 0.009, rimMat, { segs: 80, radial: 8, tension: 0.02 }); rim.castShadow = true; g.add(rim);
  // baguette sticking out
  const bg = new THREE.CapsuleGeometry(0.024, 0.34, 8, 16); const bm = new THREE.MeshStandardMaterial({ color: '#d79a4b', roughness: 0.75 });
  const bag = new THREE.Mesh(bg, bm); bag.position.set(-0.07, 0.12, -0.08); bag.rotation.set(0.15, 0.2, -0.95); bag.castShadow = true; g.add(bag);
  for (let k = 0; k < 4; k++) { const sl = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.03, 4, 8), new THREE.MeshStandardMaterial({ color: '#f2d79e', roughness: 0.9 })); sl.position.set(-0.07 + (k - 1.5) * 0.06 * 0.8, 0.12 + (k - 1.5) * 0.06 * 0.6 + 0.02, -0.08); sl.rotation.set(0.15, 0.2, 0.5); g.add(sl); }
  // sunflowers
  const stem = new THREE.MeshStandardMaterial({ color: '#4d7a2c', roughness: 0.8 }), petal = new THREE.MeshStandardMaterial({ color: '#f5b819', roughness: 0.6 }), core = new THREE.MeshStandardMaterial({ color: '#3b2312', roughness: 0.9 });
  for (const [x, z, h, ry] of [[0.1, -0.08, 0.28, 0.4], [0.06, -0.1, 0.22, -0.3]]) {
    g.add(cyl(V(x, -0.05, z), V(x + 0.03, h, z - 0.02), 0.003, 0.003, stem, 6));
    const fl = new THREE.Group(); fl.position.set(x + 0.03, h, z - 0.02); fl.rotation.set(0.3, ry, -0.6); g.add(fl);
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 8), core); c.scale.y = 0.4; fl.add(c);
    for (let k = 0; k < 14; k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), petal); const a = k / 14 * TAU; p.position.set(Math.cos(a) * 0.026, 0, Math.sin(a) * 0.026); p.scale.set(1.6, 0.25, 0.6); p.rotation.y = -a; fl.add(p); }
  }
  g.userData.H = H; g.userData.W = W; g.userData.D = D;
  return g;
}

function buildChain(M, root, rearAxle) {
  // path: around chainring (BB) and cog (rear axle), outer tangents. Direction = travel when pedalling forward.
  const c1 = V(BB.x, BB.y, 0), c2 = V(rearAxle.x, rearAxle.y, 0), r1 = R_RING, r2 = R_COG;
  const d = c1.clone().sub(c2), D = d.length(), base = Math.atan2(d.y, d.x), phi = Math.asin((r1 - r2) / D);
  // tangent normal angles: top tangent touches both circles at angle (base + π/2 + phi)
  const aTop = base + Math.PI / 2 + phi, aBot = base - Math.PI / 2 - phi;
  const pts = [];
  // travel: top strand moves forward (+X, from cog to ring) → around ring clockwise (decreasing angle) → bottom strand backward → around cog clockwise
  const arc = (c, r, a0, a1, n) => { for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push(V(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 0)); } };
  let ringEnd = aBot; while (ringEnd > aTop) ringEnd -= TAU;
  arc(c1, r1, aTop, ringEnd, 600);                         // ring, clockwise from top to bottom (front side)
  const b1 = V(c1.x + Math.cos(aBot) * r1, c1.y + Math.sin(aBot) * r1, 0), b2 = V(c2.x + Math.cos(aBot) * r2, c2.y + Math.sin(aBot) * r2, 0);
  for (let i = 0; i < 300; i++) pts.push(b1.clone().lerp(b2, i / 300));
  let cogEnd = aTop - TAU; while (cogEnd > aBot) cogEnd -= TAU; while (cogEnd < aBot - TAU) cogEnd += TAU;
  arc(c2, r2, aBot, cogEnd, 300);
  const t1 = V(c2.x + Math.cos(aTop) * r2, c2.y + Math.sin(aTop) * r2, 0), t2 = V(c1.x + Math.cos(aTop) * r1, c1.y + Math.sin(aTop) * r1, 0);
  for (let i = 0; i < 300; i++) pts.push(t1.clone().lerp(t2, i / 300));
  const cum = [0]; for (let i = 1; i <= pts.length; i++) cum.push(cum[i - 1] + pts[i % pts.length].distanceTo(pts[i - 1]));
  const L = cum[pts.length], N = Math.round(L / PITCH), step = L / N;
  const at = (s) => { s = ((s % L) + L) % L; let lo = 0, hi = pts.length; while (hi - lo > 1) { const m = (lo + hi) >> 1; cum[m] <= s ? (lo = m) : (hi = m); } const p0 = pts[lo], p1 = pts[(lo + 1) % pts.length]; return p0.clone().lerp(p1, (s - cum[lo]) / (cum[lo + 1] - cum[lo])); };
  // link plate geometry: rounded "figure-8" plate, length = pitch between pin centres
  const plate = (len, h) => { const s = new THREE.Shape(); const r = h / 2; s.absarc(0, 0, r, Math.PI / 2, Math.PI * 1.5, false); s.quadraticCurveTo(len / 2, -r * 0.62, len, -r); s.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false); s.quadraticCurveTo(len / 2, r * 0.62, 0, r);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0009, bevelEnabled: false, curveSegments: 10 }); g.translate(0, 0, -0.00045); return g; };
  const inner = plate(step, 0.0085), outer = plate(step, 0.0095);
  const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = true; m.frustumCulled = false; root.add(m); return m; };
  const nIn = Math.ceil(N / 2), nOut = Math.floor(N / 2);
  const innerM = inst(inner, M.darkSteel, nIn * 2), outerM = inst(outer, M.steel, nOut * 2);
  const rollG = new THREE.CylinderGeometry(0.0026, 0.0026, 0.006, 10); rollG.rotateX(Math.PI / 2);
  const pinG = new THREE.CylinderGeometry(0.0014, 0.0014, 0.0122, 8); pinG.rotateX(Math.PI / 2);
  const rollM = inst(rollG, M.darkSteel, N), pinM = inst(pinG, M.chrome, N);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(1, 1, 1), zAx = V(0, 0, 1), tmp = V();
  function update(s0) {
    let ii = 0, oo = 0;
    for (let i = 0; i < N; i++) {
      const p = at(s0 + i * step), p2 = at(s0 + (i + 1) * step); const ang = Math.atan2(p2.y - p.y, p2.x - p.x);
      q.setFromAxisAngle(zAx, ang);
      const isIn = i % 2 === 0 && ii < nIn * 2;
      for (const side of [-1, 1]) { tmp.set(p.x, p.y, CHAIN_Z + side * (isIn ? 0.0036 : 0.0050)); mtx.compose(tmp, q, sc);
        if (isIn) innerM.setMatrixAt(ii++, mtx); else if (oo < nOut * 2) outerM.setMatrixAt(oo++, mtx); }
      tmp.set(p.x, p.y, CHAIN_Z); mtx.compose(tmp, q, sc); rollM.setMatrixAt(i, mtx); pinM.setMatrixAt(i, mtx);
    }
    for (const m of [innerM, outerM, rollM, pinM]) m.instanceMatrix.needsUpdate = true;
  }
  return { update, L, N };
}
