// Beatport enrichment via Firecrawl.
//
// Two-stage lookup per track:
//   1. Search:  https://www.beatport.com/search/tracks?q=<artist>+<title>
//   2. Track:   https://www.beatport.com/track/<slug>/<id>
//
// Firecrawl (https://firecrawl.dev) executes JS + solves Cloudflare, returning
// clean markdown. We parse the markdown for Key, BPM, Genre, Label.
//
// Requires:  FIRECRAWL_API_KEY  (read from env or a .env file in this folder).

const fs = require("fs");
const path = require("path");

// --- tiny .env loader (node has --env-file, but this keeps invocation flexible) ---
(function loadDotenv() {
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const CACHE_PATH = path.join(__dirname, ".beatport-cache.json");
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
function saveCache() { fs.writeFileSync(CACHE_PATH, JSON.stringify(cache)); }

const FC_URL = "https://api.firecrawl.dev/v1/scrape";

async function firecrawl(url, { formats = ["markdown"], onlyMain = true } = {}) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY not set");
  const res = await fetch(FC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ url, formats, onlyMainContent: onlyMain }),
  });
  const j = await res.json();
  if (!res.ok || !j.success) throw new Error(`Firecrawl ${res.status}: ${j.error || JSON.stringify(j).slice(0, 200)}`);
  return j.data; // { markdown, metadata, ... }
}

// --- markdown parsers (patterns confirmed empirically; see PARSER-NOTES below) ---

function normalize(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

// Given a search-page markdown, find the best-matching Beatport track URL for (artist, title).
function pickTrackUrl(markdown, artist, title) {
  const wantA = normalize(artist), wantT = normalize(title);
  // Beatport track links look like: https://www.beatport.com/track/<slug>/<id>
  const links = [...markdown.matchAll(/https?:\/\/www\.beatport\.com\/track\/[a-z0-9-]+\/\d+/gi)];
  if (!links.length) return null;

  // Rank by proximity in the markdown to lines mentioning our artist/title.
  const lines = markdown.split("\n");
  let best = null, bestScore = -1;
  for (const m of links) {
    // Find the line index of this occurrence
    const idx = markdown.slice(0, m.index).split("\n").length - 1;
    const window = lines.slice(Math.max(0, idx - 3), idx + 4).join(" ").toLowerCase();
    const nWin = normalize(window);
    let score = 0;
    if (nWin.includes(wantT)) score += 2;
    if (nWin.includes(wantA)) score += 2;
    // Fallback token overlap
    for (const tok of wantT.split(" ").filter(t => t.length > 2)) if (nWin.includes(tok)) score += 0.3;
    for (const tok of wantA.split(" ").filter(t => t.length > 2)) if (nWin.includes(tok)) score += 0.3;
    if (score > bestScore) { bestScore = score; best = m[0]; }
  }
  return bestScore >= 2 ? best : null;
}

// Parse a Beatport track page's markdown for {label, genre, bpm, key, length, released}.
// Beatport renders each as a label line ("Label:") followed by blank line(s) then the
// value on its own line. Some fields ("Link:", "Embed:") have no textual value.
function parseTrackPage(markdown) {
  const wanted = {
    "Label:": "label", "Genre:": "genre", "BPM:": "bpm",
    "Key:": "key", "Length:": "length", "Released:": "released",
  };
  const isLabel = l => Object.prototype.hasOwnProperty.call(wanted, l);
  const stripMdLink = v => { const m = v.match(/^\[([^\]]+)\]/); return m ? m[1] : v; };

  const lines = markdown.split("\n").map(l => l.trim());
  const out = { label: null, genre: null, bpm: null, key: null, length: null, released: null, coverUrl: null };

  // Main cover art: first `[![alt](url)](release_url)` in the track page.
  const coverM = markdown.match(/\[!\[[^\]]*\]\((https:\/\/geo-media\.beatport\.com\/image_size\/[^)]+)\)\]/);
  if (coverM) {
    // Upgrade to a bigger size where possible (URLs look like ".../image_size/250x250/{uuid}.jpg").
    out.coverUrl = coverM[1].replace(/image_size\/\d+x\d+\//, "image_size/500x500/");
  }
  for (let i = 0; i < lines.length; i++) {
    if (!isLabel(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === "") continue;
      if (isLabel(lines[j])) break; // no value, next label reached
      out[wanted[lines[i]]] = stripMdLink(lines[j]);
      break;
    }
  }
  if (out.bpm != null) { const n = parseFloat(out.bpm); out.bpm = Number.isNaN(n) ? null : n; }
  return out;
}

// Convert Beatport-style key strings ("G maj", "F♯ min", "Ab Minor") to essentia-compatible {key,scale}.
function parseBpKey(bpKey) {
  if (!bpKey) return null;
  const s = bpKey.replace(/♯/g, "#").replace(/♭/g, "b").trim();
  const m = s.match(/^([A-G][b#]?)\s*(maj|min|major|minor)?/i);
  if (!m) return null;
  const key = m[1];
  const scale = /min/i.test(m[2] || "") ? "minor" : "major";
  return { key, scale };
}

async function enrichOne(track) {
  const cacheKey = `${normalize(track.artist)}::${normalize(track.title)}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const q = encodeURIComponent(`${track.artist} ${track.title}`);
  const searchUrl = `https://www.beatport.com/search/tracks?q=${q}`;
  let result = { found: false, source: "beatport", searchUrl };
  let cacheable = true;
  try {
    const search = await firecrawl(searchUrl);
    const trackUrl = pickTrackUrl(search.markdown || "", track.artist, track.title);
    if (!trackUrl) { result.reason = "no confident match"; }
    else {
      const page = await firecrawl(trackUrl);
      const md = page.markdown || "";
      const parsed = parseTrackPage(md);
      const parsedKey = parseBpKey(parsed.key);
      const similar = parseRecommendations(md);
      result = { ...result, found: true, url: trackUrl, ...parsed, parsedKey, similar };
    }
  } catch (e) {
    result.error = e.message;
    cacheable = false; // transient infra failures should NOT poison the cache
  }
  if (cacheable) { cache[cacheKey] = result; saveCache(); }
  return result;
}

async function enrichMany(tracks, concurrency = 3) {
  const out = new Array(tracks.length);
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < tracks.length) { const idx = i++; out[idx] = await enrichOne(tracks[idx]); }
  }));
  return out;
}

// Parse the "Recommendations" section (Beatport's own "You might also like").
// Each entry starts with a cover-image link containing /release/ and ends before the next
// such link (or end of section). Each entry has these lines somewhere in order:
//   [TitleMixName](https://www.beatport.com/track/<slug>/<id> "Title")
//   [Artist1](.../artist/...), [Artist2](.../artist/...)
//   [Label](.../label/... "Label")
//   [Genre](.../genre/... "Genre")
//   <BPM> BPM \- <Key> <Scale>        e.g. "122 BPM \- Db Minor"
//   <YYYY-MM-DD>
function parseRecommendations(markdown) {
  // Cut to the Recommendations section (roughly) to avoid catching unrelated /release/ links.
  const startIdx = markdown.search(/##\s+Recommendations/i);
  const scope = startIdx > -1 ? markdown.slice(startIdx) : markdown;
  // Split on cover-image release markers — the first token in every entry.
  const entryStarts = [...scope.matchAll(/\[!\[[^\]]*\]\((https:\/\/geo-media\.beatport\.com\/[^)]+)\)\]\(https:\/\/www\.beatport\.com\/release\//gi)];
  const out = [];
  for (let i = 0; i < entryStarts.length; i++) {
    const from = entryStarts[i].index;
    const to = i + 1 < entryStarts.length ? entryStarts[i + 1].index : scope.length;
    const block = scope.slice(from, to);
    const coverUrl = entryStarts[i][1] ? entryStarts[i][1].replace(/image_size\/\d+x\d+\//, "image_size/200x200/") : null;

    // Track title + URL. Link is: [TitleMixName](https://.../track/<slug>/<id> "Title")
    // We use the "Title" attribute (clean) and derive the mix from what follows.
    const trackM = block.match(/\[([^\]]+)\]\((https:\/\/www\.beatport\.com\/track\/[a-z0-9-]+\/\d+)\s*(?:"([^"]+)")?\)/i);
    if (!trackM) continue;
    // Multi-line variant: link text is "Title Mix\\\n\\\nTitle Mix" (duplicated with a space).
    // Take just the first logical line before any "\\" escape.
    const rawText = trackM[1].split(/\\\\|\n/)[0].replace(/\s+/g, " ").trim();
    const cleanTitle = trackM[3] ? trackM[3].trim() : rawText;
    let mixName = "";
    if (trackM[3] && rawText.startsWith(cleanTitle)) {
      mixName = rawText.slice(cleanTitle.length).trim();
    }
    // Artists: capture the first "artist links" line (may be multiple linked artists on one line).
    // Guard against remixer lines — pick the first line that contains artist links but no /label/ or /genre/.
    const artistLine = (block.match(/\[[^\]]+\]\(https:\/\/www\.beatport\.com\/artist\/[^)]+\)(?:\s*,\s*\[[^\]]+\]\(https:\/\/www\.beatport\.com\/artist\/[^)]+\))*/g) || [])[0];
    const artists = artistLine
      ? [...artistLine.matchAll(/\[([^\]]+)\]\(https:\/\/www\.beatport\.com\/artist\//g)].map(m => m[1])
      : [];

    const labelM = block.match(/\[([^\]]+)\]\(https:\/\/www\.beatport\.com\/label\//i);
    const genreM = block.match(/\[([^\]]+)\]\(https:\/\/www\.beatport\.com\/genre\//i);
    // BPM + Key: "122 BPM \- Db Minor" — the "\-" is a markdown-escaped hyphen.
    const bpmKeyM = block.match(/(\d{2,3}(?:\.\d+)?)\s*BPM\s*\\?[-–]\s*([A-G][b#♭♯]?)\s*(Major|Minor|maj|min)/i);
    const dateM = block.match(/\b(\d{4}-\d{2}-\d{2})\b/);

    if (!bpmKeyM || !artists.length) continue;
    const bpKey = `${bpmKeyM[2]} ${bpmKeyM[3]}`;
    const stripMultiline = s => s ? s.split(/\\\\|\n/)[0].replace(/\s+/g, " ").trim() : s;
    out.push({
      title: cleanTitle,
      mix: mixName || null,
      url: trackM[2],
      coverUrl,
      artist: artists.join(", "),
      artists,
      label: stripMultiline(labelM ? labelM[1] : null),
      genre: stripMultiline(genreM ? genreM[1] : null),
      bpm: parseFloat(bpmKeyM[1]),
      key: bpKey,
      parsedKey: parseBpKey(bpKey),
      released: dateM ? dateM[1] : null,
    });
  }
  return out;
}

module.exports = { firecrawl, enrichOne, enrichMany, parseTrackPage, pickTrackUrl, parseBpKey, parseRecommendations };

// CLI: node beatport.cjs diagnose "artist" "title"   — dumps parsed markdown for tuning
if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "diagnose") {
    const [artist, title] = rest;
    (async () => {
      const q = encodeURIComponent(`${artist} ${title}`);
      const s = await firecrawl(`https://www.beatport.com/search/tracks?q=${q}`);
      console.log("=== SEARCH MARKDOWN (first 3000 chars) ===\n" + (s.markdown || "").slice(0, 3000));
      const url = pickTrackUrl(s.markdown || "", artist, title);
      console.log("\n=== PICKED URL: " + url);
      if (url) {
        const p = await firecrawl(url);
        console.log("\n=== TRACK PAGE MARKDOWN (first 3000 chars) ===\n" + (p.markdown || "").slice(0, 3000));
        console.log("\n=== PARSED ===", parseTrackPage(p.markdown || ""));
      }
    })().catch(e => { console.error(e); process.exit(1); });
  } else if (cmd === "enrich") {
    (async () => {
      const [artist, title] = rest;
      const r = await enrichOne({ artist, title });
      console.log(JSON.stringify(r, null, 2));
    })().catch(e => { console.error(e); process.exit(1); });
  } else {
    console.error('Usage: node beatport.cjs diagnose|enrich "Artist" "Title"');
  }
}
