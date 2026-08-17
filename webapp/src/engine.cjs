// Live-mode recommendation engine for the DJ web app.
//
// Trade-off vs the CLI's dig.cjs: we skip Deezer + essentia entirely and rely on
// Beatport enrichment. Why? For live DJing we need SPEED and GROUND-TRUTH data,
// not exhaustive discovery. Each seed = 2 Firecrawl calls (search + track page)
// and produces ~15-19 harvested "You might also like" tracks pre-tagged with
// label-grade key + BPM. Perfect for the "what next?" question.

const path = require("path");
const skillRoot = path.resolve(__dirname, "../../"); // .claude/skills/crate-digger
const beatport = require(path.join(skillRoot, "beatport.cjs"));
const { toCamelot, harmonicScore, bpmScore } = require(path.join(skillRoot, "camelot.cjs"));

// In-memory cache of (normalized artist|title) → recommendation payload.
// Persistent cache lives in beatport.cjs's .beatport-cache.json.
const memo = new Map();
const inFlight = new Map();
const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function scoreTrack(seed, cand) {
  if (!seed?.camelot || !cand?.camelot) return null;
  const h = harmonicScore(seed.camelot, cand.camelot);
  const b = bpmScore(seed.bpm, cand.bpm);
  const total = 0.5 * h.score + 0.35 * b.score + 0.15;
  return { ...cand, h, b, total };
}

// Given { artist, title }, resolve on Beatport, return {seed, recommendations, error?}.
// Recommendations are already sorted by score and filtered to reasonable picks.
async function recommendationsFor({ artist, title }) {
  if (!artist || !title) return { error: "missing artist or title" };
  const key = `${norm(artist)}|${norm(title)}`;

  if (memo.has(key)) return memo.get(key);
  if (inFlight.has(key)) return inFlight.get(key); // dedupe concurrent requests

  const promise = (async () => {
    let seedEnrich;
    try {
      seedEnrich = await beatport.enrichOne({ artist, title });
    } catch (e) {
      return { error: `beatport lookup failed: ${e.message}` };
    }
    if (!seedEnrich?.found) {
      return { error: seedEnrich?.reason || seedEnrich?.error || "not found on Beatport", seedEnrich };
    }
    const seedCamelot = seedEnrich.parsedKey
      ? toCamelot(seedEnrich.parsedKey.key, seedEnrich.parsedKey.scale)
      : null;
    const seed = {
      artist, title,
      key: seedEnrich.parsedKey?.key || null,
      scale: seedEnrich.parsedKey?.scale || null,
      camelot: seedCamelot,
      bpm: seedEnrich.bpm,
      genre: seedEnrich.genre,
      label: seedEnrich.label,
      url: seedEnrich.url,
      coverUrl: seedEnrich.coverUrl || null,
    };
    const raw = (seedEnrich.similar || []).map(s => {
      const camelot = s.parsedKey ? toCamelot(s.parsedKey.key, s.parsedKey.scale) : null;
      return {
        artist: s.artist,
        title: s.mix ? `${s.title} (${s.mix})` : s.title,
        rawTitle: s.title,
        key: s.parsedKey?.key || null,
        scale: s.parsedKey?.scale || null,
        camelot,
        bpm: s.bpm,
        genre: s.genre,
        label: s.label,
        url: s.url,
        coverUrl: s.coverUrl || null,
      };
    });
    const scored = raw
      .map(c => scoreTrack(seed, c))
      .filter(Boolean)
      .sort((a, b) => b.total - a.total);
    return { seed, recommendations: scored };
  })();

  inFlight.set(key, promise);
  const result = await promise;
  inFlight.delete(key);
  if (!result.error) memo.set(key, result);
  return result;
}

module.exports = { recommendationsFor, norm };
