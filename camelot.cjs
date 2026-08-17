// Camelot wheel mapping + harmonic/BPM compatibility scoring.
// Pure functions, no I/O. Run `node camelot.cjs --selftest` to verify.

// Canonicalize enharmonic tonic spellings to a single label per pitch class.
const PITCH = {
  "C":0,"B#":0,
  "C#":1,"Db":1,
  "D":2,
  "D#":3,"Eb":3,
  "E":4,"Fb":4,
  "F":5,"E#":5,
  "F#":6,"Gb":6,
  "G":7,
  "G#":8,"Ab":8,
  "A":9,
  "A#":10,"Bb":10,
  "B":11,"Cb":11,
};

// Camelot code per (pitchClass, scale). Numbers 1..12, letter A=minor, B=major.
// Built from the standard wheel.
const MAJOR = { 11:1, 6:2, 1:3, 8:4, 3:5, 10:6, 5:7, 0:8, 7:9, 2:10, 9:11, 4:12 };
const MINOR = { 8:1, 3:2, 10:3, 5:4, 0:5, 7:6, 2:7, 9:8, 4:9, 11:10, 6:11, 1:12 };

function toCamelot(key, scale) {
  if (key == null) return null;
  const pc = PITCH[key.trim()];
  if (pc == null) return null;
  const minor = /min/i.test(scale || "");
  const num = minor ? MINOR[pc] : MAJOR[pc];
  return { num, letter: minor ? "A" : "B", code: `${num}${minor ? "A" : "B"}`, pc, minor };
}

function circDist(a, b) { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); }

// Harmonic compatibility 0..1 between two camelot objects (from toCamelot).
function harmonicScore(a, b) {
  if (!a || !b) return { score: 0, rel: "unknown" };
  if (a.num === b.num && a.letter === b.letter) return { score: 1.0, rel: "same key" };
  if (a.num === b.num) return { score: 0.9, rel: "relative maj/min" };
  const d = circDist(a.num, b.num);
  if (a.letter === b.letter && d === 1) return { score: 0.85, rel: "±1 (perfect 5th)" };
  if (a.letter === b.letter && d === 2) return { score: 0.6, rel: "+2 energy boost" };
  if (a.letter !== b.letter && d === 1) return { score: 0.5, rel: "diagonal" };
  return { score: 0.0, rel: "clash" };
}

// BPM compatibility 0..1, considering half/double-time mixing.
function bpmScore(seedBpm, candBpm) {
  if (!seedBpm || !candBpm) return { score: 0, note: "no bpm" };
  const ratios = [
    { r: candBpm / seedBpm, note: "" },
    { r: (candBpm * 2) / seedBpm, note: " (½-time)" },
    { r: candBpm / (seedBpm * 2), note: " (2×-time)" },
  ];
  let best = { score: 0, note: "too far" };
  for (const { r, note } of ratios) {
    const pct = Math.abs(r - 1) * 100;
    let s = 0;
    if (pct <= 2) s = 1.0;
    else if (pct <= 4) s = 0.85;
    else if (pct <= 6) s = 0.65;
    else if (pct <= 8) s = 0.4;
    const capped = note ? Math.min(s, 0.7) : s; // half/double is mixable but a different feel
    if (capped > best.score) best = { score: capped, note: `${pct.toFixed(1)}% off${note}` };
  }
  return best;
}

function selftest() {
  const cases = [
    ["A", "minor", "8A"], ["C", "major", "8B"], ["Ab", "minor", "1A"],
    ["G#", "minor", "1A"], ["B", "major", "1B"], ["E", "major", "12B"],
    ["Bb", "minor", "3A"], ["F#", "minor", "11A"], ["Db", "major", "3B"],
  ];
  let ok = 0;
  for (const [k, s, want] of cases) {
    const got = toCamelot(k, s)?.code;
    const pass = got === want;
    ok += pass;
    console.log(`${pass ? "✓" : "✗"} ${k} ${s} -> ${got} (want ${want})`);
  }
  // harmonic checks
  const A = toCamelot("A", "minor");   // 8A
  const rel = harmonicScore(A, toCamelot("C", "major")); // 8B relative -> 0.9
  const up = harmonicScore(A, toCamelot("E", "minor"));  // 9A ±1 -> 0.85
  const clash = harmonicScore(A, toCamelot("Bb", "major")); // 6B -> clash
  console.log("relative 8A/8B:", rel, "| ±1 8A/9A:", up, "| clash:", clash);
  // bpm checks
  console.log("124 vs 126:", bpmScore(124, 126), "| 124 vs 62:", bpmScore(124, 62), "| 124 vs 140:", bpmScore(124, 140));
  console.log(`\n${ok}/${cases.length} key mappings correct`);
}

module.exports = { toCamelot, harmonicScore, bpmScore };
if (require.main === module && process.argv.includes("--selftest")) selftest();
