// Crate Digger web app server.
//
// Zero-dep HTTP + SSE. State model: two decks (A, B). Each deck has a "seed"
// (currently loaded track) and its recommendations. Decks can be sourced from
// either Now Playing auto-detect (Deck A only, since MediaRemote is global)
// or manual input (both decks).

const http = require("http");
const fs = require("fs");
const path = require("path");
const { recommendationsFor } = require("./engine.cjs");
const { NowPlayingWatcher } = require("./nowplaying.cjs");

const PORT = process.env.PORT ? +process.env.PORT : 5555;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// -------- deck state --------
const state = { A: emptyDeck(), B: emptyDeck() };
function emptyDeck() { return { source: null, seed: null, recommendations: [], status: "idle", updatedAt: 0 }; }

const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

async function loadSeed(deckId, { artist, title, source, fallbackCover }) {
  const deck = state[deckId];
  deck.status = "loading";
  deck.source = source;
  deck.updatedAt = Date.now();
  broadcast("deck", { deckId, ...deck, seed: { artist, title, loading: true, coverUrl: fallbackCover || null }, recommendations: [] });

  const result = await recommendationsFor({ artist, title });
  if (result.error) {
    deck.status = "error";
    // Even without a Beatport hit, keep the fallback cover from Now Playing so the deck isn't blank.
    deck.seed = { artist, title, error: result.error, coverUrl: fallbackCover || null };
    deck.recommendations = [];
  } else {
    deck.status = "ready";
    // Prefer Beatport's high-res cover; fall back to Now Playing artwork if Beatport lacks one.
    deck.seed = { ...result.seed, coverUrl: result.seed.coverUrl || fallbackCover || null };
    deck.recommendations = result.recommendations;
  }
  deck.updatedAt = Date.now();
  broadcast("deck", { deckId, ...deck });
}

function clearDeck(deckId) {
  state[deckId] = emptyDeck();
  broadcast("deck", { deckId, ...state[deckId] });
}

// -------- HTTP routes --------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      // Send current deck state on connect
      for (const deckId of ["A", "B"]) {
        res.write(`event: deck\ndata: ${JSON.stringify({ deckId, ...state[deckId] })}\n\n`);
      }
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (url.pathname === "/api/seed" && req.method === "POST") {
      const body = await readBody(req);
      const { deck, artist, title } = JSON.parse(body || "{}");
      if (!["A", "B"].includes(deck) || !artist || !title) {
        res.writeHead(400).end(JSON.stringify({ error: "invalid deck/artist/title" }));
        return;
      }
      loadSeed(deck, { artist, title, source: "manual" });
      res.writeHead(202).end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/clear" && req.method === "POST") {
      const body = await readBody(req);
      const { deck } = JSON.parse(body || "{}");
      if (!["A", "B"].includes(deck)) {
        res.writeHead(400).end(JSON.stringify({ error: "invalid deck" }));
        return;
      }
      clearDeck(deck);
      res.writeHead(200).end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ decks: state, sseClients: sseClients.size }));
      return;
    }

    // static files
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    filePath = path.join(PUBLIC_DIR, filePath);
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.writeHead(404).end("Not found"); return; }
    const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
                   ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error("server error:", e);
    try { res.writeHead(500).end(e.message); } catch {}
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ""; req.on("data", c => s += c); req.on("end", () => resolve(s)); req.on("error", reject);
  });
}

// -------- Now Playing watcher --------
// djay Pro reports title + artist to MediaRemote but with a null bundle identifier,
// so we can't filter by app. We accept any Now Playing source — pause other audio
// apps (Spotify, Music, Safari playback) while DJing to avoid crosstalk.
const watcher = new NowPlayingWatcher({ intervalMs: 2000, djayOnly: false });
watcher.on("change", np => {
  console.log(`[np] change: ${np.artist} - ${np.title}  (bundle: ${np.bundle || "?"})`);
  const source = np.isDjay ? "djay-auto" : "now-playing";
  loadSeed("A", { artist: np.artist, title: np.title, source, fallbackCover: np.artworkDataUrl });
});
watcher.on("cleared", () => {
  console.log("[np] cleared");
});
watcher.start();

server.listen(PORT, () => {
  console.log(`\n🎧 Crate Digger web app: http://localhost:${PORT}\n`);
  console.log(`   Watching Now Playing for com.algoriddim.* (djay). Fallback: manual input.\n`);
});
