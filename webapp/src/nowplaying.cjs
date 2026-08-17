// Poll macOS's Now Playing (MediaRemote) via `nowplaying-cli`.
//
// Limitation: MediaRemote reports ONE globally-playing track. If djay reports
// its master mix, we can only see one deck at a time. That's fine as a
// convenience — users can still use manual entry for the other deck.

const { execFile } = require("child_process");
const { EventEmitter } = require("events");

const DJAY_BUNDLE_PREFIX = "com.algoriddim.";

function getRaw() {
  return new Promise((resolve) => {
    execFile("nowplaying-cli", ["get-raw"], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

function normalizePayload(raw) {
  if (!raw) return null;
  const title = raw.kMRMediaRemoteNowPlayingInfoTitle;
  const artist = raw.kMRMediaRemoteNowPlayingInfoArtist;
  const bundle = raw.kMRMediaRemoteNowPlayingInfoClientBundleIdentifier;
  const rate = raw.kMRMediaRemoteNowPlayingInfoPlaybackRate;
  const artwork = raw.kMRMediaRemoteNowPlayingInfoArtworkData;
  if (!title || !artist) return null;
  return {
    title: title.trim(),
    artist: artist.trim(),
    bundle,
    isDjay: !!(bundle && bundle.startsWith(DJAY_BUNDLE_PREFIX)),
    isPlaying: rate === 1,
    // Data URL: nowplaying-cli emits already-base64-encoded JPEG bytes; the raw JSON
    // string is the base64 (with occasional \/ escapes we can leave alone).
    artworkDataUrl: artwork ? `data:image/jpeg;base64,${artwork.replace(/\\\//g, "/")}` : null,
    at: Date.now(),
  };
}

// Emits: "change" with normalized track object, "cleared" when nothing plays.
class NowPlayingWatcher extends EventEmitter {
  constructor({ intervalMs = 2000, djayOnly = false } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.djayOnly = djayOnly;
    this.lastKey = null;
    this.timer = null;
  }
  start() {
    if (this.timer) return;
    const tick = async () => {
      const raw = await getRaw();
      const norm = normalizePayload(raw);
      const relevant = norm && (!this.djayOnly || norm.isDjay);
      if (!relevant) {
        if (this.lastKey !== null) {
          this.lastKey = null;
          this.emit("cleared");
        }
        return;
      }
      const key = `${norm.artist}::${norm.title}`;
      if (key !== this.lastKey) {
        this.lastKey = key;
        this.emit("change", norm);
      }
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  current() { return this.lastKey; }
}

module.exports = { NowPlayingWatcher, getRaw, normalizePayload };
