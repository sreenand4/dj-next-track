#!/usr/bin/env node
// Crate Digger — given a seed track, find NEW tracks that mix well with it.
// Pipeline: Deezer (discovery + previews) -> ffmpeg decode -> essentia.js (key + BPM)
//           -> Camelot harmonic + BPM scoring -> ranked "mix into these" list.
//
// Usage:
//   node dig.cjs "artist - title" [--limit 24] [--per-artist 4] [--related 8]
//                                 [--bpm-tol 8] [--file /path/to/seed.mp3]
//
// No API keys required. Needs: node, ffmpeg on PATH.

const { execFileSync } = require("child_process");
const { readFileSync, writeFileSync, existsSync, mkdtempSync } = require("fs");
const os = require("os");
const path = require("path");
const { Essentia, EssentiaWASM } = require("essentia.js");
const { toCamelot, harmonicScore, bpmScore } = require("./camelot.cjs");
const beatport = require("./beatport.cjs");

const essentia = new Essentia(EssentiaWASM);
const CACHE_PATH = path.join(__dirname, ".cache.json");
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
const tmp = mkdtempSync(path.join(os.tmpdir(), "crate-"));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}
const OPTS = {
  limit: +arg("limit", 24),
  perArtist: +arg("per-artist", 4),
  related: +arg("related", 8),
  bpmTol: +arg("bpm-tol", 8),
  file: arg("file", null),
  beatport: process.argv.includes("--beatport"),
  beatportTop: +arg("beatport-top", 8),
};
const seedQuery = process.argv.slice(2).find(a => !a.startsWith("--") &&
  process.argv[process.argv.indexOf(a) - 1]?.startsWith("--") !== true);

async function dz(pathq) {
  const res = await fetch(`https://api.deezer.com/${pathq}`);
  if (!res.ok) throw new Error(`Deezer ${pathq} -> ${res.status}`);
  return res.json();
}

// --- audio analysis: url|file -> {key, scale, camelot, bpm, bpmConfident, strength} ---
async function analyzeSource({ url, file }) {
  const raw = path.join(tmp, `a-${Math.random().toString(36).slice(2)}.raw`);
  let input = file;
  if (!input) {
    const mp3 = raw + ".mp3";
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    writeFileSync(mp3, buf);
    input = mp3;
  }
  execFileSync("ffmpeg", ["-y", "-i", input, "-ac", "1", "-ar", "44100", "-f", "f32le", raw],
    { stdio: "ignore" });
  return analyzeRaw(raw);
}

function analyzeRaw(rawPath) {
  const buf = readFileSync(rawPath);
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const vec = essentia.arrayToVector(f32);
  const k = essentia.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, "edma", 44100, 0.0001, 440, "cosine", "hann");
  const percival = essentia.PercivalBpmEstimator(vec, 1024, 2048, 128, 128, 210, 50, 44100).bpm;
  let rhythm = null;
  try { rhythm = essentia.RhythmExtractor2013(vec, 208, "multifeature", 40).bpm; } catch {}
  // dual-estimator confidence: trust BPM only when the two agree (within 6%).
  let bpm = percival, bpmConfident = false;
  if (rhythm) {
    const diff = Math.abs(percival - rhythm) / Math.min(percival, rhythm);
    if (diff <= 0.06) { bpm = (percival + rhythm) / 2; bpmConfident = true; }
  }
  return {
    key: k.key, scale: k.scale, strength: +k.strength.toFixed(3),
    camelot: toCamelot(k.key, k.scale),
    bpm: Math.round(bpm * 10) / 10, percival: +percival.toFixed(1),
    rhythm: rhythm ? +rhythm.toFixed(1) : null, bpmConfident,
  };
}

async function analyzeTrack(t) {
  if (cache[t.id]) return { ...t, ...cache[t.id] };
  try {
    const a = await analyzeSource({ url: t.preview });
    cache[t.id] = a;
    writeFileSync(CACHE_PATH, JSON.stringify(cache));
    return { ...t, ...a };
  } catch (e) {
    return { ...t, error: e.message };
  }
}

// simple concurrency pool
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function main() {
  if (!seedQuery && !OPTS.file) {
    console.error('Usage: node dig.cjs "artist - title" [options]'); process.exit(1);
  }
  // 1) resolve seed via Deezer
  console.error(`\n🔎 Resolving seed: ${seedQuery}`);
  const found = (await dz(`search?q=${encodeURIComponent(seedQuery)}&limit=1`)).data?.[0];
  if (!found) { console.error("No Deezer match for seed."); process.exit(1); }
  const seedArtistId = found.artist.id;
  console.error(`   ${found.artist.name} - ${found.title}`);

  // analyze seed (own full file if provided, else preview)
  console.error(`🎚️  Analyzing seed (${OPTS.file ? "your file" : "30s preview"})…`);
  const seedA = await analyzeSource(OPTS.file ? { file: OPTS.file } : { url: found.preview });
  const seed = { ...found, ...seedA };
  console.error(`   key ${seed.camelot?.code || "?"} (${seed.key} ${seed.scale}) · ${seed.bpm} BPM ${seed.bpmConfident ? "" : "⚠"}`);

  // 2) discovery: related artists -> their top tracks (+ seed artist's own)
  console.error(`🧭 Gathering candidates from ${OPTS.related} related artists…`);
  const related = (await dz(`artist/${seedArtistId}/related?limit=${OPTS.related}`)).data || [];
  const artists = [{ id: seedArtistId, name: found.artist.name }, ...related];
  let cands = [];
  for (const ar of artists) {
    const top = (await dz(`artist/${ar.id}/top?limit=${OPTS.perArtist}`)).data || [];
    for (const t of top) {
      if (t.id === found.id) continue;
      if (!t.preview) continue;
      cands.push({ id: t.id, title: t.title, artist: t.artist.name, link: t.link, preview: t.preview });
    }
  }
  // dedupe + cap
  const seen = new Set();
  cands = cands.filter(c => { const k = `${c.artist}|${c.title}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, OPTS.limit);
  console.error(`   ${cands.length} candidates. Analyzing audio…`);

  // 3) analyze candidates (download+decode+essentia)
  let done = 0;
  const analyzed = await pool(cands, 4, async c => {
    const r = await analyzeTrack(c);
    process.stderr.write(`\r   analyzed ${++done}/${cands.length}`);
    return r;
  });
  process.stderr.write("\n");

  // 4) score
  const scored = analyzed.filter(c => !c.error).map(c => {
    const h = harmonicScore(seed.camelot, c.camelot);
    const b = bpmScore(seed.bpm, c.bpm);
    const conf = ((Math.min(c.strength, 1)) + (c.bpmConfident ? 1 : 0)) / 2;
    const total = 0.5 * h.score + 0.35 * b.score + 0.15 * conf;
    return { ...c, h, b, conf, total };
  }).sort((a, b) => b.total - a.total);

  // 4b) optional: enrich the top picks with Beatport (label-grade key/BPM)
  if (OPTS.beatport) {
    // Seed too — an accurate seed key rescues everything downstream.
    console.error(`🎯 Enriching seed + top ${OPTS.beatportTop} picks via Beatport…`);
    const seedEnrich = await beatport.enrichOne({ artist: seed.artist.name, title: seed.title });
    if (seedEnrich.found && seedEnrich.parsedKey) {
      seed.camelot = toCamelot(seedEnrich.parsedKey.key, seedEnrich.parsedKey.scale) || seed.camelot;
      seed.key = seedEnrich.parsedKey.key;
      seed.scale = seedEnrich.parsedKey.scale;
      if (seedEnrich.bpm) seed.bpm = seedEnrich.bpm;
      seed.beatport = seedEnrich;
    }

    // Harvest "You might also like" tracks from the seed's Beatport page — these come
    // pre-tagged with label-grade BPM + Key, so no essentia call needed.
    if (seedEnrich.similar?.length) {
      const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const seenKeys = new Set(scored.map(c => `${norm(c.artist)}|${norm(c.title)}`));
      const harvested = [];
      for (const s of seedEnrich.similar) {
        const key = `${norm(s.artist)}|${norm(s.title)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const camelot = s.parsedKey ? toCamelot(s.parsedKey.key, s.parsedKey.scale) : null;
        if (!camelot) continue;
        const h = harmonicScore(seed.camelot, camelot);
        const b = bpmScore(seed.bpm, s.bpm);
        harvested.push({
          artist: s.artist,
          title: s.mix ? `${s.title} (${s.mix})` : s.title,
          link: s.url,           // Beatport link (no Deezer preview for these)
          camelot,
          bpm: s.bpm,
          bpmConfident: true,
          strength: 1.0,
          harvested: true,       // marks a Beatport-native discovery
          beatport: { found: true, url: s.url, label: s.label, genre: s.genre, released: s.released, source: "beatport-harvested" },
          h, b, conf: 1.0,
          total: 0.5 * h.score + 0.35 * b.score + 0.15 * 1.0,
        });
      }
      scored.push(...harvested);
      scored.sort((a, b) => b.total - a.total);
      console.error(`   +${harvested.length} harvested from Beatport "You might also like"`);
    }

    const targets = scored.slice(0, OPTS.beatportTop).filter(c => !c.harvested);
    const enriched = await beatport.enrichMany(targets, 3);
    for (let i = 0; i < targets.length; i++) {
      const e = enriched[i]; if (!e?.found) { targets[i].beatport = e; continue; }
      const c = targets[i];
      c.beatport = e;
      if (e.parsedKey) c.camelot = toCamelot(e.parsedKey.key, e.parsedKey.scale) || c.camelot;
      if (e.bpm) { c.bpm = e.bpm; c.bpmConfident = true; }
      // re-score with the trusted numbers
      c.h = harmonicScore(seed.camelot, c.camelot);
      c.b = bpmScore(seed.bpm, c.bpm);
      c.conf = 1.0;
      c.total = 0.5 * c.h.score + 0.35 * c.b.score + 0.15 * c.conf;
    }
    scored.sort((a, b) => b.total - a.total);
  }

  // 5) output
  const line = c => {
    const bpTag = c.harvested ? " 🎯BP" : (c.beatport?.found ? " ✅BP" : "");
    const bpMeta = c.beatport?.found
      ? `\n        Beatport: ${c.beatport.genre || "?"}${c.beatport.label ? " · " + c.beatport.label : ""}`
      : "";
    return `${c.camelot?.code || "??"}  ${String(c.bpm).padStart(5)}bpm  ${(c.total).toFixed(2)}  ${c.artist} – ${c.title}${bpTag}` +
      `\n        ${c.h.rel}, ${c.b.note}${c.bpmConfident ? "" : "  ⚠bpm-uncertain"}${c.strength < 0.6 && !c.beatport?.found ? "  ⚠key-weak" : ""}${bpMeta}\n        ${c.link}`;
  };

  const strong = scored.filter(c => c.h.score >= 0.6 && c.b.score >= 0.4);
  const weak = scored.filter(c => !(c.h.score >= 0.6 && c.b.score >= 0.4)).slice(0, 6);

  let out = `\n════════════════════════════════════════════════════════\n`;
  out += `SEED: ${seed.artist.name} – ${seed.title}${seed.beatport?.found ? " ✅BP" : ""}\n`;
  out += `      ${seed.camelot?.code} (${seed.key} ${seed.scale}) · ${seed.bpm} BPM\n`;
  out += `════════════════════════════════════════════════════════\n\n`;
  out += `🔥 MIX INTO THESE (${strong.length}):\n\n` + (strong.map(line).join("\n\n") || "  (none)") + "\n";
  if (weak.length) out += `\n🤔 WORTH A LISTEN (looser fit):\n\n` + weak.map(line).join("\n\n") + "\n";

  console.log(out);
  const md = path.join(__dirname, "last-dig.md");
  writeFileSync(md, out);
  console.error(`\n💾 Saved: ${md}`);
}

main().catch(e => { console.error(e); process.exit(1); });
