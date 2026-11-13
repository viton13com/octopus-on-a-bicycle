#!/usr/bin/env node
/* Score + sound design for the octopus film, all synthesized here (nothing licensed).
 * 120 BPM in D major, bars start at 5.0 s. Plucked strings are Karplus–Strong, bells are FM.
 * Foley follows the picture: typing in the prompt, chain purr ∝ cadence, freewheel ratchet while coasting,
 * wind ∝ speed², tyre hum, sea, gulls, bell dings, a sip of tea, lamps clicking on. Output: out/sound.wav (48 kHz stereo). */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000, DUR = 34, N = DUR * SR, TAU = Math.PI * 2;
const L = new Float32Array(N), R = new Float32Array(N), VL = new Float32Array(N), VR = new Float32Array(N); // dry + reverb send
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const at = (t) => Math.round(t * SR), clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), lerp = (a, b, p) => a + (b - a) * p, smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12), lpA = (fc) => 1 - Math.exp(-TAU * Math.min(fc, 20000) / SR);
const put = (i, l, r, send = 0) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; VL[i] += l * send; VR[i] += r * send; } };
const win = (t, a, b, fi = .3, fo = .3) => smooth((t - a) / fi) * (1 - smooth((t - (b - fo)) / fo));

// ---- picture timing (mirrors js/main.js) ----
const VKEY = [[0, 5.0], [7, 5.5], [13, 5.0], [17.5, 4.4], [19.6, 4.6], [21.5, 6.8], [24, 9.4], [25.8, 9.2], [28.5, 6.6], [34, 6.0]];
const vAt = (t) => { for (let i = 1; i < VKEY.length; i++) if (t <= VKEY[i][0]) { const [t0, v0] = VKEY[i - 1], [t1, v1] = VKEY[i]; return lerp(v0, v1, smooth((t - t0) / (t1 - t0))); } return 6; };
const LETGO = (t) => win(t, 20.5, 26.1, 0.7, 0.8);
const engaged = (t) => 1 - smooth(clamp(LETGO(t) * 1.4));
const R_TYRE = 0.35, RATIO = 44 / 18, R_RING = 0.0127 / (2 * Math.sin(Math.PI / 44));

// ---------------- instruments ----------------
function pluck(t0, midi, { dur = 1.2, amp = 0.2, pan = 0, bright = 0.6, decay = 0.996, send = 0.25, vib = 0 } = {}) {
  const f = hz(midi), n = Math.max(2, Math.round(SR / f)), ratio = n * f / SR; // render at integer period, resample to exact pitch
  const buf = new Float32Array(n); let lp = 0; for (let i = 0; i < n; i++) { lp += (rnd() - lp) * (0.15 + bright * 0.85); buf[i] = lp; } { let m = 0; for (let i = 0; i < n; i++) m += buf[i]; m /= n; let pk = 1e-6; for (let i = 0; i < n; i++) { buf[i] -= m; pk = Math.max(pk, Math.abs(buf[i])); } for (let i = 0; i < n; i++) buf[i] /= pk * 2; }
  const len = Math.ceil(dur * SR * ratio) + 4, raw = new Float32Array(len); let k = 0, prev = 0;
  for (let i = 0; i < len; i++) { const a = buf[k], b = buf[(k + 1) % n]; const y = (a + b) * 0.5 * decay; raw[i] = a; buf[k] = y * (0.5 + bright * 0.5) + prev * (0.5 - bright * 0.5); prev = y; k = (k + 1) % n; }
  const s0 = at(t0), outN = Math.floor(dur * SR), gL = amp * (1 - pan) * 0.9, gR = amp * (1 + pan) * 0.9;
  for (let j = 0; j < outN; j++) { const pos = j * ratio * (1 + vib * Math.sin(j / SR * TAU * 5.5) * Math.min(1, j / SR / 0.3)), i = Math.floor(pos), fr = pos - i; if (i + 1 >= len) break;
    const env = Math.min(1, j / 40) * (j > outN - 800 ? (outN - j) / 800 : 1); const v = (raw[i] * (1 - fr) + raw[i + 1] * fr) * env; put(s0 + j, v * gL, v * gR, send); }
}
function bell(t0, f0, { amp = 0.12, dur = 2.2, pan = 0, send = 0.45, partials = [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.4], [8.93, 0.12, 0.25]], beat = 2.2 } = {}) {
  const s = at(t0), n = at(dur);
  for (let k = 0; k < n; k++) { const t = k / SR; let v = 0; for (const [m, a, d] of partials) v += Math.sin(TAU * f0 * m * t + (m > 1 ? 0.3 : 0)) * a * Math.exp(-t / (dur * 0.35 * d));
    v *= (1 + 0.25 * Math.sin(TAU * beat * t)) * Math.min(1, t / 0.0015) * amp; put(s + k, v * (1 - pan), v * (1 + pan), send); }
}
function glock(t0, midi, amp = 0.06, pan = 0) { bell(t0, hz(midi), { amp, dur: 1.4, pan, send: 0.5, partials: [[1, 1, 1], [2.0, 0.15, 0.3], [5.4, 0.06, 0.15]], beat: 0 }); }
function noiseHit(t0, { dur = 0.08, amp = 0.1, lo = 2000, hi = 9000, pan = 0, send = 0.1, decay = 0.02 } = {}) {
  const s = at(t0), n = at(dur); let a = 0, b = 0; for (let k = 0; k < n; k++) { const t = k / SR, x = rnd(); a += (x - a) * lpA(hi); b += (a - b) * lpA(lo); const v = (a - b) * Math.exp(-t / decay) * amp; put(s + k, v * (1 - pan), v * (1 + pan), send); } }
function kick(t0, amp = 0.5) { const s = at(t0); let ph = 0; for (let k = 0; k < at(0.32); k++) { const t = k / SR; ph += TAU * (48 + 110 * Math.exp(-t / 0.03)) / SR; const v = Math.tanh(Math.sin(ph) * Math.exp(-t / 0.14) * 1.3) * amp; put(s + k, v, v, 0.02); } }
function pad(t0, dur, notes, amp = 0.03, fc = 1400) {
  const s = at(t0), n = at(dur + 1.2);
  for (const m of notes) for (const det of [-0.006, 0.006]) { const f = hz(m) * (1 + det), pan = det * 60; let ph = Math.abs(rnd()), y = 0, y2 = 0;
    for (let k = 0; k < n; k++) { const t = k / SR; ph += f / SR; if (ph > 1) ph -= 1; y += (2 * ph - 1 - y) * lpA(fc); y2 += (y - y2) * lpA(fc);
      const env = smooth(t / 0.9) * (t > dur ? Math.exp(-(t - dur) / 0.4) : 1); const v = y2 * env * amp; put(s + k, v * (1 - pan), v * (1 + pan), 0.5); } }
}

// ---------------- music ----------------
const NOTE = (n) => { const m = n.match(/^([A-G])(#|b)?(\d)$/); return { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12; };
const BEAT = 0.5, BAR0 = 5.0, barT = (b) => BAR0 + b * 2;
const CH = { D: [38, [50, 54, 57, 62]], Bm: [47, [50, 54, 59, 62]], G: [43, [50, 55, 59, 62]], A: [45, [49, 52, 57, 61]], Em7: [40, [50, 55, 59, 64]], A7: [45, [49, 52, 55, 61]], Dmaj9: [38, [54, 57, 61, 64]] };
const PROG = ['D', 'Bm', 'G', 'A', 'D', 'Bm', 'Em7', 'A7', 'D', 'G', 'A', 'G', 'D', 'Dmaj9'];
const MEL = [
  [[0, 'F#5', .5], [.5, 'A5', .5], [1, 'D6', .75], [1.75, 'C#6', .25], [2, 'B5', .5], [2.5, 'A5', .5], [3, 'F#5', 1]],
  [[0, 'D5', .5], [.5, 'F#5', .5], [1, 'B5', 1], [2, 'A5', .5], [2.5, 'F#5', .5], [3, 'D5', 1]],
  [[0, 'G5', .5], [.5, 'B5', .5], [1, 'D6', .5], [1.5, 'E6', .5], [2, 'D6', .5], [2.5, 'B5', .5], [3, 'G5', 1]],
  [[0, 'A5', .5], [.5, 'C#6', .5], [1, 'E6', 1], [2, 'D6', .5], [2.5, 'C#6', .25], [2.75, 'B5', .25], [3, 'A5', 1]],
  [[0, 'F#5', .5], [.5, 'A5', .5], [1, 'D6', .75], [1.75, 'E6', .25], [2, 'F#6', .5], [2.5, 'E6', .5], [3, 'D6', 1]],
  [[0, 'D6', .5], [.5, 'C#6', .5], [1, 'B5', 1], [2, 'F#5', .5], [2.5, 'A5', .5], [3, 'B5', 1]],
  [[0, 'G5', .5], [.5, 'B5', .5], [1, 'D6', .5], [1.5, 'B5', .5], [2, 'E6', 1], [3, 'D6', .5], [3.5, 'B5', .5]],
  [[0, 'C#6', .5], [.5, 'E6', .5], [1, 'G6', 1.5]],
];
// intro: pad + a two-note pickup
pad(1.2, 3.8, [50, 57, 62, 66], 0.022, 900);
pluck(4.5, NOTE('A4'), { amp: 0.16, pan: 0.2 }); pluck(4.75, NOTE('D5'), { amp: 0.16, pan: 0.2 });
PROG.forEach((name, b) => {
  const t0 = barT(b), [bass, tones] = CH[name], drop = b >= 8 && b <= 10, last = b === 13;
  if (t0 >= DUR) return;
  // bass: oom on 1 & 3 (8ths when racing downhill)
  if (!last) { if (drop) for (let k = 0; k < 8; k++) pluck(t0 + k * BEAT / 2, bass + (k % 2 ? 12 : 0), { amp: 0.34, bright: 0.25, decay: 0.993, dur: 0.5, send: 0.08 });
    else { pluck(t0, bass, { amp: 0.38, bright: 0.25, dur: 1.0, send: 0.08 }); if (!(b === 7)) pluck(t0 + 2 * BEAT, bass + 7, { amp: 0.32, bright: 0.25, dur: 1.0, send: 0.08 }); } }
  // pah: chord plucks on 2 & 4, rolled
  if (!last && b !== 11) for (const beat of (drop ? [0.5, 1, 1.5, 2.5, 3, 3.5] : [1, 3])) { if (b === 7 && beat > 2.5) continue; tones.forEach((m, i) => pluck(t0 + beat * BEAT + i * 0.012, m, { amp: drop ? 0.07 : 0.085, pan: -0.3 + i * 0.12, bright: 0.5, dur: 0.6, decay: 0.992, send: 0.2 })); }
  // melody
  if (b < 8) for (const [bt, nm, d] of MEL[b]) pluck(t0 + bt * BEAT, NOTE(nm), { amp: 0.2, pan: 0.15, bright: 0.75, dur: d * BEAT + 0.6, decay: 0.997, vib: d >= 1 ? 0.004 : 0, send: 0.3 });
  if (drop) for (let k = 0; k < 16; k++) { const m = tones[k % 4] + 12 + (k >= 8 ? 12 * (k % 8 > 5 ? 1 : 0) : 0); pluck(t0 + k * BEAT / 2, m, { amp: 0.11, pan: Math.sin(k) * 0.4, bright: 0.85, dur: 0.4, decay: 0.994, send: 0.25 }); if (k % 4 === 0) glock(t0 + k * BEAT / 2, m + 12, 0.035, -0.3); }
  if (b === 11) { [55, 59, 62, 67, 71, 74, 79, 83].forEach((m, i) => glock(27.0 + i * 0.09, m + 12, 0.04, -0.5 + i * 0.13)); pad(t0, 2, [43, 55, 59, 62], 0.02, 800); pluck(t0, 43, { amp: 0.3, bright: 0.2, dur: 2 }); }
  if (b === 12) { [['F#5', 0], ['A5', 1], ['D6', 2]].forEach(([nm, bt]) => { pluck(t0 + bt * BEAT, NOTE(nm), { amp: 0.22, bright: 0.7, dur: 2.2, vib: 0.004, send: 0.4 }); glock(t0 + bt * BEAT, NOTE(nm) + 12, 0.05); }); pad(t0, 2.2, [50, 57, 62, 66], 0.025, 1200); }
  if (last) { tones.concat([62, 69, 74]).forEach((m, i) => pluck(t0 + i * 0.035, m, { amp: 0.11, bright: 0.55, dur: 3.2, decay: 0.9985, send: 0.5, pan: -0.4 + i * 0.1 })); pluck(t0, 38, { amp: 0.34, bright: 0.2, dur: 3.2 }); pad(t0, 2.6, [50, 57, 61, 64, 69], 0.024, 1000); glock(t0 + 0.4, NOTE('A6'), 0.04); glock(t0 + 0.8, NOTE('E7'), 0.03); }
  // rhythm
  if (b >= 1 && b < 11) for (let k = 0; k < 8; k++) { if (b === 7 && k >= 3) break; noiseHit(t0 + k * BEAT / 2 + (k % 2 ? 0.012 : 0), { dur: 0.05, amp: k % 2 ? 0.03 : 0.045, lo: 5000, hi: 12000, pan: 0.25, decay: 0.012 }); }
  if (b >= 4 && b < 11 && b !== 7) for (const k of [1, 3]) noiseHit(t0 + k * BEAT, { dur: 0.18, amp: 0.07, lo: 900, hi: 6000, decay: 0.06, send: 0.15 });
  if (b >= 2 && b < 11) { kick(t0, drop ? 0.42 : 0.3); if (b !== 7) kick(t0 + 2 * BEAT, drop ? 0.42 : 0.26); if (drop) { kick(t0 + BEAT, 0.42); kick(t0 + 3 * BEAT, 0.42); } }
});
// crest: breath and a riser into the drop at 21
{ const s = at(19.9), n = at(1.1); let a = 0, b = 0; for (let k = 0; k < n; k++) { const p = k / n; a += (rnd() - a) * lpA(300 * Math.pow(25, p)); b += (a - b) * lpA(200); const v = (a - b) * Math.pow(p, 2) * 0.22; put(s + k, v * (1 - 0.3 * p), v * (0.7 + 0.3 * p), 0.3); } }
noiseHit(21.0, { dur: 1.6, amp: 0.11, lo: 3000, hi: 14000, decay: 0.5, send: 0.4 }); kick(21.0, 0.6);

// ---------------- foley ----------------
// typing (mirrors overlay(): 'draw a ' 26 cps from .5, 'pelican' 22 cps, strike at 2.05, 'octopus' 18 cps from 2.25, tail 26 cps)
const typeAt = []; const tw = 0.5 + 7 / 26; for (let i = 1; i <= 7; i++) typeAt.push(0.5 + i / 26); for (let i = 1; i <= 7; i++) typeAt.push(tw + i / 22); for (let i = 1; i <= 7; i++) typeAt.push(2.25 + i / 18); const tt = 2.25 + 7 / 18; for (let i = 1; i <= 17; i++) typeAt.push(tt + i / 26);
typeAt.forEach((t, i) => { noiseHit(t - 0.02, { dur: 0.03, amp: 0.09 + (i % 3) * 0.015, lo: 1800, hi: 7000, decay: 0.006, pan: -0.2, send: 0.05 }); noiseHit(t - 0.012, { dur: 0.02, amp: 0.05, lo: 300, hi: 1500, decay: 0.008, pan: -0.2 }); });
{ const s = at(2.05), n = at(0.22); let ph = 0; for (let k = 0; k < n; k++) { const t = k / SR; ph += TAU * (900 * Math.exp(-t / 0.08) + 120) / SR; const v = Math.sin(ph) * Math.exp(-t / 0.07) * 0.07; put(s + k, v, v, 0.3); } } // strike "zip"
// bell dings
for (const d of [15.25, 15.5]) bell(d, 1760 * 1.0, { amp: 0.16, dur: 2.0, pan: -0.25, beat: 6.5, partials: [[1, 1, 1], [1.5, 0.5, 0.8], [2.43, 0.35, 0.5], [3.8, 0.18, 0.3], [5.1, 0.1, 0.2]] });
// a sip of tea + delighted little "puff"
{ const s = at(17.6), n = at(0.5); let a = 0, b = 0; for (let k = 0; k < n; k++) { const t = k / SR, p = t / 0.5; a += (rnd() - a) * lpA(500 + 2200 * p); b += (a - b) * lpA(300 + 900 * p); const v = (a - b) * Math.sin(Math.PI * p) * (0.6 + 0.4 * Math.sin(t * TAU * 23)) * 0.2; put(s + k, v * 1.1, v * 0.9, 0.1); }
  for (let i = 0; i < 6; i++) { const t0 = 17.7 + i * 0.05 + rnd() * 0.02; const s2 = at(t0); for (let k = 0; k < at(0.03); k++) { const t = k / SR; const v = Math.sin(TAU * (700 + i * 90) * t * (1 + t * 20)) * Math.exp(-t / 0.008) * 0.025; put(s2 + k, v, v, 0.2); } } }
// gulls
function gull(t0, pan, amp = 0.05) { for (const [o, d, f0, f1] of [[0, 0.22, 2100, 1500], [0.28, 0.32, 2300, 1250]]) { const s = at(t0 + o), n = at(d); let ph = 0; for (let k = 0; k < n; k++) { const t = k / SR, p = t / d; const f = lerp(f0, f1, p) * (1 + 0.04 * Math.sin(TAU * 31 * t)); ph += TAU * f / SR;
  const v = (Math.sin(ph) * 0.6 + Math.sin(2 * ph) * 0.3 + Math.sin(3 * ph) * 0.15) * Math.sin(Math.PI * p) ** 0.6 * amp; put(s + k, v * (1 - pan), v * (1 + pan), 0.55); } } }
gull(8.6, 0.5, 0.035); gull(12.3, -0.4, 0.03); gull(28.4, 0.3, 0.045); gull(30.9, -0.5, 0.04); gull(32.2, 0.6, 0.03);
// lamps: a soft electric click per lamp near the rider
[27.0, 27.15, 27.33, 27.52].forEach((t, i) => noiseHit(t, { dur: 0.04, amp: 0.05, lo: 1500, hi: 6000, decay: 0.006, pan: -0.4 + i * 0.25, send: 0.3 }));
// crab claw clicks while everyone panics happily
for (let t = 21.2; t < 25.6; t += 0.11 + Math.abs(rnd()) * 0.15) noiseHit(t, { dur: 0.02, amp: 0.035, lo: 2500, hi: 9000, decay: 0.004, pan: 0.35, send: 0.15 });

// continuous beds: sea, wind, tyre, chain purr, freewheel ratchet
{ let sa = [0, 0], sb = [0, 0], wa = [0, 0], wb = [0, 0], ta = 0, tb = 0, crank = 0, wheel = 0, ratchet = 0, cogA = 0, chainPh = 0;
  for (let i = 0; i < N; i++) { const t = i / SR, v = vAt(t), e = engaged(t);
    const wW = v / R_TYRE, wC = wW / RATIO * e; wheel += wW / SR; crank += wC / SR; cogA += wC * RATIO / SR;
    // sea swells (louder on the wide shots)
    const seaAmp = (0.035 + 0.05 * smooth((t - 26.5) / 3)) * (0.6 + 0.4 * Math.sin(TAU * t / 7.3) ** 2);
    for (let c = 0; c < 2; c++) { sa[c] += (rnd() - sa[c]) * lpA(650 + 250 * Math.sin(t * 0.9 + c)); sb[c] += (sa[c] - sb[c]) * lpA(90); }
    // wind ∝ v²
    const wAmp = 0.012 + 0.09 * Math.pow(v / 9.4, 2) * (1 + 0.25 * Math.sin(t * 1.7) * Math.sin(t * 0.63));
    for (let c = 0; c < 2; c++) { wa[c] += (rnd() - wa[c]) * lpA(400 + 900 * v / 9); wb[c] += (wa[c] - wb[c]) * lpA(140); }
    // tyre hum
    ta += (rnd() - ta) * lpA(220 + v * 25); tb += (ta - tb) * lpA(60);
    const tyre = (ta - tb) * (0.025 + 0.02 * v / 9) * (1 - 0.6 * smooth((t - 28.6) / 1.5));
    let l = (sa[0] - sb[0]) * seaAmp * 3 + (wa[0] - wb[0]) * wAmp * 3 + tyre, r = (sa[1] - sb[1]) * seaAmp * 3 + (wa[1] - wb[1]) * wAmp * 3 + tyre;
    // chain purr: one soft tick per link passing the ring (links/s = crank speed * R_RING / pitch)
    chainPh += wC * R_RING / 0.0127 / SR; if (chainPh >= 1) { chainPh -= 1; if (t < 28.6) noiseHit(t, { dur: 0.012, amp: 0.012 * (1 - smooth((t - 9) / 3) * 0.6), lo: 3000, hi: 11000, decay: 0.002, pan: 0.3 }); }
    // freewheel: pawls click 24× per relative revolution while the wheel overruns the stopped cog
    ratchet += (wW - wC * RATIO) * 24 / TAU / SR; if (ratchet >= 1) { ratchet -= 1; const k = clamp((wW - wC * RATIO) / 3); if (k > 0.02) noiseHit(t, { dur: 0.01, amp: 0.055 * k * (1 - smooth((t - 28) / 1.5)), lo: 2500 + Math.abs(rnd()) * 1500, hi: 9000, decay: 0.0018, pan: -0.1 }); }
    L[i] += l; R[i] += r; }
}

// ---------------- reverb (Schroeder: 4 combs + 2 allpasses per side) ----------------
function verb(inp, out, off) { const combs = [1557, 1617, 1491, 1422].map((d) => ({ b: new Float32Array(d + off), i: 0, f: 0 })), aps = [225, 556].map((d) => ({ b: new Float32Array(d + off), i: 0 }));
  for (let n = 0; n < N; n++) { let s = 0; for (const c of combs) { const y = c.b[c.i]; c.f = y * 0.75 + c.f * 0.25; c.b[c.i] = inp[n] + c.f * 0.84; c.i = (c.i + 1) % c.b.length; s += y; } s *= 0.25;
    for (const a of aps) { const y = a.b[a.i]; const x = s + y * 0.5; a.b[a.i] = x; a.i = (a.i + 1) % a.b.length; s = y - x * 0.5; } out[n] += s * 0.9; } }
verb(VL, L, 0); verb(VR, R, 23);

// fades, soft limit, write
let peak = 0; for (let i = 0; i < N; i++) { const t = i / SR, g = smooth(t / 0.25) * (1 - smooth((t - 32.6) / 1.4)); L[i] = Math.tanh(L[i] * g * 1.1); R[i] = Math.tanh(R[i] * g * 1.1); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const norm = 0.89 / peak, buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(clamp(L[i] * norm, -1, 1) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(clamp(R[i] * norm, -1, 1) * 32767), 46 + i * 4); }
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'out', 'sound-raw.wav'), buf); console.log('wrote out/sound-raw.wav, peak', peak.toFixed(2));
