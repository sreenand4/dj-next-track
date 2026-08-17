# 🎧 Next Track Finder

Point it at a track you love; it returns **new tracks that mix well with it** — ranked by
harmonic (musical-key) compatibility and tempo. Built for DJs who want to answer *"what do
I play next?"* with more than a hunch.

It comes in two flavors:

- **CLI** (`dig.cjs`) — deep discovery. Analyzes real audio to find compatible tracks.
- **Live web app** (`webapp/`) — a two-deck browser view that auto-detects what's playing in
  your DJ software and suggests the next track in real time.

---

## How it works

### The core idea: harmonic + tempo mixing

Two tracks blend smoothly when their **musical keys** are compatible and their **tempos**
are close. Crate Digger scores every candidate on both axes using the **Camelot wheel** (the
DJ-friendly key notation, `1A`–`12B`) and BPM proximity, then ranks the best matches.

Scoring lives in [`camelot.cjs`](camelot.cjs) — pure, dependency-free functions:

| Harmonic relationship        | Score | Meaning                                        |
|------------------------------|-------|------------------------------------------------|
| Same key (e.g. `8A` → `8A`)  | 1.00  | Perfect blend                                  |
| Relative major/minor         | 0.90  | Same number, swap A↔B                          |
| ±1 on the wheel (perfect 5th)| 0.85  | The classic "energy stays" mix                 |
| +2 (energy boost)            | 0.60  | Lifts the room                                 |
| Diagonal                     | 0.50  | Usable                                         |
| Anything else                | 0.00  | Clash                                          |

BPM scoring is tolerance-banded (≤2% = perfect, out to ~8%) and understands **half-time /
double-time** mixing, so a 124 BPM track and a 62 BPM track register as compatible.

Final rank = `0.5 × harmonic + 0.35 × bpm + 0.15 × confidence`.

### CLI pipeline (`dig.cjs`) — no API keys required

1. **Deezer API** (open, no key) — resolves your seed track, then gathers candidates from
   related artists' top tracks. Each comes with a free 30-second preview MP3.
2. **ffmpeg** — decodes each preview to raw PCM audio.
3. **essentia.js** — analyzes the actual audio for musical **key** (using the `edma` profile,
   tuned for electronic music) and **BPM**. BPM uses **two independent estimators** and only
   trusts the result when they agree within 6% — otherwise the track is flagged
   `⚠bpm-uncertain` (usually a beatless intro/breakdown in the preview).
4. **Camelot scoring** — ranks everything and prints your shortlist.

Analysis is cached in `.cache.json` (keyed by Deezer track id), so re-runs are fast.

### Optional Beatport enrichment (`--beatport`)

essentia's key detection is good but occasionally off by a semitone. For ground-truth data,
`--beatport` cross-references the **seed + top picks** against [Beatport](https://beatport.com)
via [Firecrawl](https://firecrawl.dev) (which executes JS and clears Cloudflare), pulling
**label-grade key, BPM, genre, and label**. Confirmed tracks are re-scored with the trusted
numbers and tagged `✅BP`.

As a bonus, the seed's Beatport page has a **"You might also like"** section (~15–20 tracks,
already tagged with key + BPM). Those are harvested for free during enrichment and folded into
the candidate pool tagged `🎯BP` — Beatport-native discoveries the Deezer graph would miss.

Beatport results are cached in `.beatport-cache.json` so repeat queries don't re-spend credits.

### Live web app (`webapp/`)

A **zero-dependency** Node HTTP + Server-Sent-Events server ([`webapp/src/server.cjs`](webapp/src/server.cjs))
serving a two-deck view at **http://localhost:5555**:

- **Deck A auto-updates** from whatever your Mac is playing. It polls macOS's Now Playing
  (MediaRemote) via [`nowplaying-cli`](https://github.com/kirtan-shah/nowplaying-cli) every 2s
  ([`webapp/src/nowplaying.cjs`](webapp/src/nowplaying.cjs)), grabs the artist/title/artwork,
  and instantly shows compatible next tracks.
- **Deck B is manual entry** — type any track to preview what mixes into it.

The live engine ([`webapp/src/engine.cjs`](webapp/src/engine.cjs)) **skips Deezer + essentia
entirely** and goes straight to Beatport. The trade-off is deliberate: live DJing needs *speed
and ground-truth data*, not exhaustive discovery. One seed = two Firecrawl calls and ~15–19
pre-tagged recommendations — perfect for the "what next?" moment.

> **djay Pro note:** MediaRemote only reports *one* globally-audible track, and djay's UI is a
> Metal surface no third-party tool can read per-deck. So Deck A follows whatever is *audible*.
> Pause other audio apps (Spotify, Music, Safari) while DJing to avoid crosstalk.

---

## Reading the output

Each result line:

```
CAMELOT  BPM  SCORE  Artist – Title  [tag]
         <harmonic relationship>, <BPM delta>  [flags]
         <link>
```

- **`🔥 MIX INTO THESE`** — strong harmonic + tempo fit.
- **`🤔 WORTH A LISTEN`** — looser fit, worth an ear.
- **Tags:** `✅BP` = Deezer-found, Beatport-confirmed · `🎯BP` = Beatport-native discovery.
- **Flags:** `⚠bpm-uncertain` (the two BPM estimators disagreed) · `⚠key-weak` (low
  key-detection confidence).

Console output is also saved to `last-dig.md`.

---

## Setup

### Prerequisites

- **Node.js** and **ffmpeg** on your `PATH`
  ```bash
  brew install ffmpeg
  ```
- **nowplaying-cli** — only for the live web app's auto-detect
  ```bash
  brew install nowplaying-cli
  ```

### Install

```bash
npm install          # installs essentia.js (for the CLI's audio analysis)
```

### API key (for Beatport enrichment + the live web app)

Create a **`.env`** file in the repo root:

```
FIRECRAWL_API_KEY=fc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Get a key at [firecrawl.dev](https://firecrawl.dev). `.env` is gitignored. The CLI works
**without** it — you only need it for `--beatport` and the live app.

---

## Usage

### CLI

```bash
node dig.cjs "artist - title"                    # basic: Deezer + essentia
node dig.cjs "CamelPhat Cola" --related 8 --per-artist 4 --limit 24
node dig.cjs "my track" --file /path/to/seed.mp3 # analyze YOUR full file as the seed
node dig.cjs "Bicep Glue" --beatport             # cross-ref top picks against Beatport
```

**Options:**

| Flag             | Default | Meaning                                             |
|------------------|---------|-----------------------------------------------------|
| `--limit`        | 24      | Max candidates to analyze                           |
| `--per-artist`   | 4       | Tracks pulled per artist                            |
| `--related`      | 8       | Related artists to gather from                      |
| `--bpm-tol`      | 8       | BPM tolerance (%)                                   |
| `--file`         | —       | Local audio file to use as the seed (full-length)   |
| `--beatport`     | off     | Enrich top picks with Beatport (needs Firecrawl key)|
| `--beatport-top` | 8       | How many top picks to enrich                        |

Diagnose a single track's Beatport lookup:

```bash
node beatport.cjs diagnose "Artist" "Title"
```

### Live web app

```bash
cd webapp
npm start            # → http://localhost:5555
```

Open the URL, start playing a track in your DJ software, and Deck A populates itself.

---

## Project structure

```
.
├── dig.cjs              # CLI entry point — full discovery pipeline
├── camelot.cjs          # Camelot-wheel + harmonic/BPM scoring (pure functions)
├── beatport.cjs         # Beatport enrichment via Firecrawl (+ CLI: diagnose)
├── SKILL.md             # Claude Code skill definition
├── last-dig.md          # Latest CLI run output (auto-written)
├── .env                 # FIRECRAWL_API_KEY (gitignored, create yourself)
└── webapp/
    ├── src/
    │   ├── server.cjs     # zero-dep HTTP + SSE, two-deck state
    │   ├── engine.cjs     # live (Beatport-only) recommendation engine
    │   └── nowplaying.cjs # macOS Now Playing poller
    └── public/            # browser UI (index.html, app.js, style.css)
```

---

## Honest limitations

- **Key detection is approximate.** essentia nails the key most of the time but is
  occasionally off by a semitone or major/minor. Adjacent Camelot keys still mix, so treat the
  shortlist as a strong starting point — then trust your ears. (Use `--beatport` for
  ground-truth key/BPM on the picks that matter.)
- **30-second previews can misrepresent long/progressive tracks** — a 10-minute track whose
  preview is an ambient intro. The dual-BPM check flags these; use `--file` for tracks you own.
- **Discovery breadth is bounded** by Deezer's related-artist graph.
- **The live app sees one deck.** macOS Now Playing reports a single globally-audible track,
  and djay's per-deck state isn't readable by any third-party tool — hence Deck A auto,
  Deck B manual.

---

*Track data from Deezer, Beatport, and macOS MediaRemote. This is a personal DJ tool.*
