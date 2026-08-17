---
name: crate-digger
description: DJ crate-digging assistant. Given a seed track, finds NEW tracks that mix well with it — harmonically (Camelot wheel) and by tempo. Use when the user wants song/track recommendations for a DJ set, "what mixes with X", key/BPM-compatible tracks, or new music similar to a track they like.
---

# Crate Digger

Point it at a track you love; it returns new tracks that **mix well** with it —
ranked by harmonic (musical-key) compatibility and tempo.

## Pipeline (no API keys needed)

1. **Deezer API** (open, no key) — resolves the seed and gathers candidates from
   related artists' top tracks, each with a free 30-second preview MP3.
2. **ffmpeg** — decodes each preview to PCM.
3. **essentia.js** — analyzes the actual audio for musical **key** (`edma` profile,
   tuned for electronic music) and **BPM**.
4. **Camelot scoring** (`camelot.cjs`) — ranks candidates by harmonic compatibility
   + tempo match, considering half/double-time mixing.

## Prerequisites

- `node` and `ffmpeg` on PATH.
- Dependencies already installed here (`npm install` in this folder installs
  `essentia.js`). Re-run `npm install` if `node_modules/` is missing.

## Usage

```bash
node dig.cjs "artist - title"                       # basic (Deezer + essentia)
node dig.cjs "CamelPhat Cola" --related 8 --per-artist 4 --limit 24
node dig.cjs "my track" --file /path/to/seed.mp3    # analyze YOUR full file as the seed
node dig.cjs "Bicep Glue" --beatport                # cross-ref top picks vs Beatport
```

Options: `--limit` max candidates (24) · `--per-artist` tracks per artist (4) ·
`--related` related artists to pull (8) · `--bpm-tol` BPM tolerance % (8) ·
`--file` local audio file for the seed · `--beatport` enrich top picks with
Beatport (needs `FIRECRAWL_API_KEY`) · `--beatport-top N` how many top picks to
enrich (8).

### Beatport enrichment

When `--beatport` is set, the top N picks (and the seed) are cross-referenced
against Beatport via Firecrawl for label-grade key + BPM + genre + label. Tracks
that Beatport confirms are re-scored with the trusted numbers and tagged `✅BP`.

Additionally, the seed's Beatport page has a "You might also like" section
(~15-20 tracks) with pre-tagged BPM + Key. Those are harvested for free during
the seed's enrichment and added to the candidate pool tagged `🎯BP`. These are
Beatport-native discoveries — no Deezer preview, but their link goes straight to
Beatport where you can audition and buy.

Requires a Firecrawl API key in **`.claude/skills/crate-digger/.env`** as:

```
FIRECRAWL_API_KEY=fc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`.env` is gitignored. Results are cached in `.beatport-cache.json` so repeat
queries don't re-spend credits. Diagnose a single track with:

```bash
node beatport.cjs diagnose "Artist" "Title"
```

Results print to the console and are saved to `last-dig.md`. Analysis is cached in
`.cache.json` keyed by Deezer track id, so re-runs are fast.

## Reading the output

Each line: `CAMELOT  BPM  SCORE  Artist – Title` with the harmonic relationship
(same key / relative / ±1 perfect-5th / +2 energy boost / clash) and the BPM
delta. `🔥 MIX INTO THESE` = strong harmonic + tempo fit; `🤔 WORTH A LISTEN` =
looser. Flags: `⚠bpm-uncertain` (the two BPM estimators disagreed — the preview
is likely a beatless intro/breakdown) and `⚠key-weak` (low key-detection
confidence).

## Honest limitations

- **Key detection is approximate.** essentia (the same engine AcousticBrainz used)
  nails the key most of the time but is occasionally off by a semitone or
  major/minor. Adjacent Camelot keys still mix, so this is a strong shortlisting
  tool, not gospel — trust your ears.
- **30s previews can misrepresent long/progressive tracks** (e.g. a 10-min track
  whose preview is an ambient intro). The dual-BPM-estimator check flags these as
  `⚠bpm-uncertain`. For seeds you own, use `--file` for full-length accuracy.
- Discovery breadth is bounded by Deezer's related-artist graph.

## Possible upgrades

- Cross-reference Beatport (needs a Firecrawl API key to pass Cloudflare) for
  label-grade key/BPM on the top picks.
- Filter out tracks already in your djay library so results are only *new* to you.
