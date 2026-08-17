// Crate Digger — client. Live SSE, Lucide icons, click-to-copy.

const $ = (sel) => document.querySelector(sel);
const refreshIcons = () => { if (window.lucide?.createIcons) window.lucide.createIcons(); };

function setConn(state, text) {
  const el = $("#conn");
  el.className = "conn " + state;
  const icon = state === "ok"  ? "wifi"
             : state === "err" ? "wifi-off"
             :                    "loader-2";
  const spinClass = state === "" ? " spin" : "";
  el.innerHTML = `<i data-lucide="${icon}" class="${spinClass}"></i><span id="conn-text">${text}</span>`;
  refreshIcons();
}

function connect() {
  setConn("", "connecting…");
  const es = new EventSource("/events");
  es.addEventListener("hello", () => setConn("ok", "connected"));
  es.addEventListener("deck", (evt) => renderDeck(JSON.parse(evt.data)));
  es.onerror = () => {
    setConn("err", "disconnected — retrying");
    setTimeout(() => { es.close(); connect(); }, 2000);
  };
}

function sourceMeta(deckId, source) {
  if (deckId === "A") {
    if (source === "djay-auto")   return { icon: "radio", text: "djay Pro · live", live: true };
    if (source === "now-playing") return { icon: "circle-play", text: "Now Playing · live", live: true };
    return { icon: "wifi-off", text: "waiting for djay", live: false };
  }
  // Deck B
  if (source === "manual") return { icon: "keyboard", text: "manual", live: false };
  return { icon: "hand", text: "manual", live: false };
}

function renderDeck({ deckId, source, status, seed, recommendations }) {
  const seedEl = $(`#seed-${deckId}`);
  const srcEl  = $(`#src-${deckId}`);
  const recsEl = $(`#recs-${deckId}`);

  // ---------- source label ----------
  const sm = sourceMeta(deckId, source);
  srcEl.className = "deck-source" + (sm.live ? " live" : "");
  srcEl.innerHTML = sm.live ? `<span>${sm.text}</span>` : `<i data-lucide="${sm.icon}"></i><span>${sm.text}</span>`;

  // ---------- seed card ----------
  if (!seed) {
    seedEl.innerHTML = emptySeedHtml(deckId);
  } else if (seed.loading || status === "loading") {
    seedEl.innerHTML = `<div class="seed-loading">
      <i data-lucide="loader-2"></i>
      <div>
        <div style="font-weight:600;color:var(--text);">${escapeHtml(seed.title || "?")}</div>
        <div style="font-size:12px;">${escapeHtml(seed.artist || "?")} · analyzing…</div>
      </div>
    </div>`;
  } else if (seed.error || status === "error") {
    seedEl.innerHTML = `<div class="seed-error">
      <strong>${escapeHtml(seed.title || "?")}</strong>
      <span>${escapeHtml(seed.artist || "?")}</span>
      <div style="margin-top:6px;">Couldn't resolve on Beatport: ${escapeHtml(seed.error || "unknown error")}</div>
    </div>${deckId === "B" ? clearBtnHtml("B") : ""}`;
  } else {
    const cam    = seed.camelot?.code || "?";
    const keyStr = seed.key ? `${seed.key} ${seed.scale}` : "";
    const cover  = seed.coverUrl
      ? `<div class="seed-cover"><img src="${escapeAttr(seed.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove();this.parentElement.innerHTML+='<i data-lucide=\\'disc\\'></i>';refreshIcons?.();" /></div>`
      : `<div class="seed-cover placeholder"><i data-lucide="disc-3"></i></div>`;

    const clearBtn = deckId === "B" ? clearBtnHtml("B") : "";
    seedEl.innerHTML = `<div class="seed-loaded">
      ${cover}
      <div class="seed-info">
        <div class="title">${escapeHtml(seed.title)}</div>
        <div class="artist">${escapeHtml(seed.artist)}</div>
        <div class="stats">
          <span class="chip camelot"><i data-lucide="key-round"></i> ${cam}${keyStr ? " · " + escapeHtml(keyStr) : ""}</span>
          <span class="chip bpm"><i data-lucide="gauge"></i> ${seed.bpm ? Math.round(seed.bpm) : "?"} BPM</span>
          ${seed.genre ? `<span class="chip genre"><i data-lucide="tag"></i>${escapeHtml(seed.genre)}</span>` : ""}
          ${seed.label ? `<span class="chip label"><i data-lucide="bookmark"></i>${escapeHtml(seed.label)}</span>` : ""}
        </div>
      </div>
      ${clearBtn}
    </div>`;
  }

  // ---------- recommendations ----------
  if (!recommendations || recommendations.length === 0) {
    recsEl.innerHTML = `<li class="rec-empty">${seed && !seed.loading && !seed.error ? "No harmonic matches from Beatport." : "—"}</li>`;
  } else {
    recsEl.innerHTML = recommendations.slice(0, 12).map(r => {
      const tier = r.total >= 0.85 ? 1 : r.total >= 0.65 ? 2 : 3;
      const cam = r.camelot?.code || "??";
      const bpm = r.bpm ? Math.round(r.bpm) : "?";
      const rel = r.h.rel;
      const cover = r.coverUrl
        ? `<div class="rec-cover"><img src="${escapeAttr(r.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove();this.parentElement.innerHTML+='<i data-lucide=\\'music\\'></i>';refreshIcons?.();" /></div>`
        : `<div class="rec-cover placeholder"><i data-lucide="music"></i></div>`;
      const clipboardText = `${r.artist} - ${r.title}`;
      return `<li><button class="rec tier-${tier}" onclick="copySong(this, ${JSON.stringify(clipboardText).replace(/"/g, '&quot;')})">
        ${cover}
        <div class="rec-camelot">${cam}</div>
        <div class="rec-bpm">${bpm}<span class="bpm-unit">BPM</span></div>
        <div class="rec-info">
          <div class="t">${escapeHtml(r.title)}</div>
          <div class="a">${escapeHtml(r.artist)}${r.genre ? " · " + escapeHtml(r.genre) : ""}</div>
        </div>
        <div class="rec-relation">${escapeHtml(rel)}</div>
      </button></li>`;
    }).join("");
  }

  refreshIcons();
}

function emptySeedHtml(deckId) {
  if (deckId === "A") {
    return `<div class="seed-empty">
      <i data-lucide="headphones" class="empty-icon"></i>
      <p class="empty-title">No track detected</p>
      <p class="empty-hint">Load a track in djay Pro. This deck auto-updates.</p>
    </div>`;
  }
  return `<div class="seed-empty">
    <i data-lucide="music-2" class="empty-icon"></i>
    <p class="empty-title">Prep the next track</p>
    <p class="empty-hint">Type a track below to preview mixes for it.</p>
  </div>`;
}

function clearBtnHtml(deckId) {
  return `<button class="clear-btn" title="Clear ${deckId}" onclick="clearDeck('${deckId}')"><i data-lucide="x"></i></button>`;
}

async function submitSeed(deckId, event) {
  event.preventDefault();
  const input = $(`#input-${deckId}`);
  const raw = input.value.trim();
  if (!raw) return;
  const parts = raw.split(/\s+[-–—]\s+|,\s+/);
  let artist, title;
  if (parts.length >= 2) { artist = parts[0].trim(); title = parts.slice(1).join(" - ").trim(); }
  else { const t = raw.split(/\s+/); artist = t.shift(); title = t.join(" ") || raw; if (!title) artist = "unknown"; }
  await fetch("/api/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deck: deckId, artist, title }),
  });
  input.value = "";
}
window.submitSeed = submitSeed;

async function clearDeck(deckId) {
  await fetch("/api/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deck: deckId }),
  });
}
window.clearDeck = clearDeck;

async function copySong(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copied "${text}"`);
    // brief highlight on the clicked row
    btn.style.borderColor = "var(--green)";
    btn.style.background = "rgba(124, 191, 46, 0.08)";
    setTimeout(() => { btn.style.borderColor = ""; btn.style.background = ""; }, 700);
  } catch (e) {
    showToast("Copy failed — check clipboard permissions", true);
  }
}
window.copySong = copySong;

let toastTimer = null;
function showToast(text, isError = false) {
  const toast = $("#toast");
  $("#toast-text").textContent = text;
  toast.style.borderColor = isError ? "var(--red)" : "var(--green)";
  toast.style.color = isError ? "var(--red)" : "var(--green)";
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
window.refreshIcons = refreshIcons;

// wait for Lucide to load, then paint initial icons + connect
function boot() {
  refreshIcons();
  connect();
}
if (window.lucide) boot();
else window.addEventListener("load", boot);
