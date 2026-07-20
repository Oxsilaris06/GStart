/*
 * tchapLive.js — Suivi géoloc équipe en temps réel depuis un salon Tchap (Matrix).
 *
 * Voie "salon NON chiffré (Forum)" : /sync HTTP direct (pas de SDK/crypto/clés).
 * Un seul token (le tien, membre du salon) reçoit TOUTES les positions du salon.
 *
 * AUTH (2 modes) :
 *  - ProConnect (device-code OAuth, RFC 8628) → access + refresh token : session
 *    AUTO-RENOUVELÉE (survit aux 5 min ET aux rafraîchissements). Sans mot de passe,
 *    sans URL de redirection (n'est pas bloqué par la règle WAF anti-redirect).
 *  - Repli : token manuel copié depuis Tchap Web (non renouvelable, ~5 min).
 *
 * Affichage : 1 marqueur/opérateur, animation fluide, anti-chevauchement (jamais
 * fusionnés), couleur=état (bleu nouveau / vert déplacement / gris immobile actif /
 * rouge déco imminente), icône=fonction, libellé "[FONCTION] Nom", liste groupée par
 * équipe + suivi, trace togglable. Tout est isolé sous les ids #tl_* et la map PlanMap.
 */

import { Persist } from "./persist.js";

const LS_KEY = "pcTacTchapLive";
const LS_SINCE_KEY = "pcTacTchapLiveSince";  // curseur next_batch persisté (reprise long-poll)
const DEFAULT_HS = "https://matrix.agent.interieur.tchap.gouv.fr";
const DEFAULT_ISSUER = "https://auth.agent.interieur.tchap.gouv.fr";
const CLIENT_URI = "https://pc-tac.app"; // métadonnée DCR (https + suffixe public valides)

const NEW_MS = 30 * 1000, MOVE_WINDOW_MS = 12 * 1000, MOVE_MIN_M = 8;
const RED_LEAD_MS = 60 * 1000, FB_EXPIRING_MS = 120 * 1000, FB_LOST_MS = 360 * 1000;
const ANIM_MS = 900, DECLUTTER_PX = 30, TRAIL_MAX = 80;

const STATE_COLORS = {
  new: "var(--inter-blue, #4f8dff)", moving: "var(--ao-green, #2ecf91)",
  idle: "var(--text-muted, #8a8a91)", expiring: "var(--danger-red, #f0556a)",
  stale: "var(--text-muted, #6b6b72)",   // réhydraté du disque, pas encore confirmé live
};
const DEFAULT_ICON = "person_pin_circle";
const FUNCTION_ICONS = {
  "Chef inter": "military_tech", "Chef dispo": "stars", "Chef Oscar": "shield_person",
  "Négociateur": "record_voice_over", "PC": "dvr", "Cyno": "pets",
  "Inter": "local_police", "Effrac": "hardware", "AO": "visibility",
  "Medic": "medical_services", "Pompier": "local_fire_department", "Sans": "person_pin_circle",
};
let FONCTIONS = ["Chef inter", "Chef dispo", "Chef Oscar", "Négociateur", "PC", "Cyno", "Inter", "Effrac", "AO", "Medic", "Pompier", "Sans"];
let CELLULES = ["AO1", "AO2", "AO3", "AO4", "AO5", "AO6", "AO7", "AO8", "India 1", "India 2", "India 3", "India 4", "India 5", "Effrac", "Sans"];

let cfg = loadCfg();
let running = false, aborter = null, followed = null, centered = false, trailsOn = false;
// auth
let authMode = null, accessToken = null, refreshToken = null, expiresAt = 0, clientId = null, oidc = null, deviceAbort = false;
const members = new Map(), names = new Map(), beacons = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sleep interruptible par l'AbortController courant : un stop() (aborter.abort())
// réveille immédiatement la boucle de backoff au lieu d'attendre la fin du délai.
function sleepAbortable(ms) {
  return new Promise((resolve) => {
    const sig = aborter?.signal;
    if (sig?.aborted) return resolve();
    const t = setTimeout(() => { if (sig) sig.removeEventListener("abort", onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(t); resolve(); }
    if (sig) sig.addEventListener("abort", onAbort, { once: true });
  });
}
function loadCfg() {
  const c = Persist.get(LS_KEY, { validator: (v) => v && typeof v === "object", fallback: null });
  if (c && typeof c === "object") { c.assign = c.assign || {}; return c; }
  return { assign: {} };
}
function persist() { Persist.set(LS_KEY, cfg); }

// ─── résilience : état last-known persisté (IndexedDB) ───────────────────────
// Store dédié, helper IndexedDB interne (NE PAS toucher imageStore.js). On y
// écrit à chaque upsert l'état last-known par sender pour réhydrater au boot,
// AVANT tout réseau, en mode 'stale' (gris + âge). Lecture seule côté Tchap :
// rien n'est exfiltré, tout reste dans le navigateur. Purgé au stop().
const TL_DB_NAME = "pcTacTchapLive";
const TL_STORE = "tchapLiveState";
const TL_DB_VERSION = 1;
let tlDbPromise = null;
function tlSupportsIdb() { try { return typeof indexedDB !== "undefined"; } catch (_) { return false; } }
function tlOpenDb() {
  if (!tlSupportsIdb()) return Promise.resolve(null);
  if (!tlDbPromise) {
    tlDbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(TL_DB_NAME, TL_DB_VERSION);
        req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(TL_STORE)) db.createObjectStore(TL_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  return tlDbPromise;
}
function tlWithStore(mode, fn) {
  return tlOpenDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(TL_STORE, mode);
        const store = tx.objectStore(TL_STORE);
        let result;
        try { result = fn(store); } catch (_) { resolve(null); return; }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }).catch(() => null);
}
// Écrit (best-effort, fire-and-forget) l'état last-known d'un sender.
function persistState(sender, m) {
  if (!sender || !m) return;
  const rec = {
    lat: m.lat, lon: m.lng, ts: m.ts || Date.now(),
    trail: Array.isArray(m.trail) ? m.trail.slice(-TRAIL_MAX) : undefined,
    fonction: (cfg.assign?.[sender] || {}).fonction || null,
    name: names.get(sender) || null,
    room: cfg.room || null,
    savedAt: Date.now(),
  };
  tlWithStore("readwrite", (store) => store.put(rec, sender)).catch(() => {});
}
function loadAllState() {
  return tlWithStore("readonly", (store) => {
    return new Promise((resolve) => {
      const out = [];
      let req;
      try { req = store.openCursor(); } catch (_) { resolve(out); return; }
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { out.push({ sender: cur.key, rec: cur.value }); cur.continue(); }
        else resolve(out);
      };
      req.onerror = () => resolve(out);
    });
  }).then((r) => (Array.isArray(r) ? r : r || [])).catch(() => []);
}
function purgeState() { tlWithStore("readwrite", (store) => store.clear()).catch(() => {}); }

// ─── résilience : buffer mémoire des positions reçues hors-carte ──────────────
// Si une position arrive alors que la carte n'est pas disponible, on la met en
// tampon (par sender, dernière connue) au lieu de la jeter, et on la rejoue au
// premier getMap() réussi.
const pendingPositions = new Map();   // sender -> {lat, lon, ts}
let bufferDrainScheduled = false;
let rehydratePending = false;          // réhydratation différée si carte absente au boot
function bufferPosition(sender, lat, lon, ts) { pendingPositions.set(sender, { lat, lon, ts }); }
function drainBuffer() {
  if (bufferDrainScheduled || !pendingPositions.size) return;
  const map = getMap();
  if (!map || typeof maplibregl === "undefined") return; // toujours pas de carte : on garde le tampon
  bufferDrainScheduled = true;
  const queued = [...pendingPositions.entries()];
  pendingPositions.clear();
  bufferDrainScheduled = false;
  for (const [sender, p] of queued) upsert(sender, p.lat, p.lon, p.ts);
  if (pendingPositions.size) jlog(`⚠ ${pendingPositions.size} position(s) toujours en attente (carte)`, "var(--civil-yellow)");
}

// ─── résilience : indicateur 'hors-réseau depuis Xs' ─────────────────────────
let offlineSince = 0;            // ts du début de coupure réseau, 0 = en ligne
let offlineTimer = null;         // tick d'affichage de l'âge de coupure
function startOfflineTicker() {
  if (offlineTimer) return;
  offlineTimer = setInterval(() => {
    if (!offlineSince) return;
    const age = Date.now() - offlineSince;
    setDot("var(--danger-red)");
    status(`Hors-réseau depuis ${fmtAge(age)} — reprise auto…`, "var(--danger-red)");
  }, 1000);
}
function stopOfflineTicker() { if (offlineTimer) { clearInterval(offlineTimer); offlineTimer = null; } }
function markOffline() { if (!offlineSince) offlineSince = Date.now(); startOfflineTicker(); }
function markOnline() { offlineSince = 0; stopOfflineTicker(); }
function saveCfg() { cfg.hs = (val("tl_hs") || DEFAULT_HS).trim(); cfg.token = val("tl_token").trim(); cfg.room = val("tl_room").trim(); cfg.clientId = (val("tl_clientid") || cfg.clientId || "").trim() || undefined; persist(); }
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id) ? $(id).value : "");

// ─── journal / statut ───────────────────────────────────────────────────────
function jlog(msg, color) {
  const box = $("tl_log"); if (!box) return;
  const l = document.createElement("div"); if (color) l.style.color = color;
  l.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  box.appendChild(l); box.scrollTop = box.scrollHeight;
  while (box.childNodes.length > 80) box.removeChild(box.firstChild);
}
function setDot(c) { const d = $("tl_dot"); if (d) d.style.background = c; }
function status(msg, c) { const el = $("tl_status"); if (el) { el.textContent = msg; if (c) el.style.color = c; } }

// ─── styles ───────────────────────────────────────────────────────────────--
function injectStyle() {
  if ($("tl_style")) return;
  const s = document.createElement("style"); s.id = "tl_style";
  s.textContent = `
    .tl-marker { display:flex; flex-direction:column; align-items:center; transform:translate(-50%,-50%); }
    .tl-icon { position:relative; display:inline-flex; color:var(--inter-blue,#4f8dff); }
    .tl-glyph { font-family:'Material Symbols Outlined'; font-size:30px; line-height:1; color:inherit;
      font-variation-settings:'FILL' 1; text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 2px #fff,0 2px 4px rgba(0,0,0,.6); }
    .tl-icon.pulse::after { content:''; position:absolute; left:50%; top:50%; width:8px; height:8px; margin:-4px;
      border-radius:50%; box-shadow:0 0 0 0 currentColor; animation:tlPulse 1.6s ease-out infinite; }
    @keyframes tlPulse { 0%{box-shadow:0 0 0 0 currentColor;} 70%{box-shadow:0 0 0 16px transparent;} 100%{box-shadow:0 0 0 0 transparent;} }
    .tl-label { margin-top:1px; font-family:var(--font-ui,system-ui); font-size:12px; font-weight:600; color:#fff;
      white-space:nowrap; background:rgba(0,0,0,.78); padding:2px 7px; border-radius:4px; border-left:4px solid currentColor;
      text-shadow:0 1px 2px rgba(0,0,0,.8); box-shadow:0 1px 3px rgba(0,0,0,.6); }
  `;
  // NB : les styles de la LISTE opérateurs (.tl-ops-bar/.tl-grp/.tl-op…) sont définis
  // statiquement dans pctac2.html (#tl-orbat-style). On ne garde ici que le marqueur carte.
  document.head.appendChild(s);
}

// ─── carte ──────────────────────────────────────────────────────────────────
let mapWired = false;
function wireMapListeners(map) {
  if (mapWired || !map) return; mapWired = true;
  map.on("moveend", scheduleDeclutter);
  map.on("zoomend", scheduleDeclutter);
  map.on("styledata", () => { if (trailsOn) { ensureTrailLayer(); updateTrails(); } });
}
// N.B. getMap() initialise PlanMap si besoin — n'est appelé QUE depuis des chemins
// déclenchés par l'utilisateur (upsert sur position reçue, centrer, trace), jamais au boot.
function getMap() {
  const PM = window.PlanMap;
  if (!PM) return null;
  if (!PM.initialized) { try { PM.init(); } catch (e) { console.warn("[TchapLive]", e); } }
  if (PM.map && typeof maplibregl !== "undefined") {
    wireMapListeners(PM.map);
    if (pendingPositions.size) Promise.resolve().then(drainBuffer);
    if (rehydratePending) { rehydratePending = false; Promise.resolve().then(rehydrateFromDisk); }
  }
  return PM.map || null;
}

// ─── parsing position ─────────────────────────────────────────────────────--
function geoFromUri(uri) {
  if (!uri) return null;
  const p = String(uri).replace(/^geo:/i, "").split(";")[0].split(",");
  const lat = parseFloat(p[0]), lon = parseFloat(p[1]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}
function extractLoc(type, c) {
  if (!c) return null;
  const b = c["org.matrix.msc3672.beacon"] || {};
  const cands = [c.geo_uri, c.uri, c["m.location"]?.uri, c["org.matrix.msc3488.location"]?.uri, b.uri, b["m.location"]?.uri, b["org.matrix.msc3488.location"]?.uri];
  for (const u of cands) { const g = geoFromUri(u); if (g) return g; }
  return null;
}
function metersBetween(aLat, aLon, bLat, bLon) {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (bLat - aLat) * t, dLon = (bLon - aLon) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// ─── état (couleurs) ────────────────────────────────────────────────────────
function computeState(m, now) {
  const b = m.beacon, age = now - (m.ts || 0), validExpiry = b && b.expiry > b.startTs;
  if (b && !b.live) return age > 30000 ? "lost" : "expiring";
  if (validExpiry) { if (now > b.expiry) return "lost"; if (b.expiry - now < RED_LEAD_MS) return "expiring"; }
  else { if (age > FB_LOST_MS) return "lost"; if (age > FB_EXPIRING_MS) return "expiring"; }
  if (now - (m.firstSeen || 0) < NEW_MS) return "new";
  if (now - (m.lastMove || 0) < MOVE_WINDOW_MS) return "moving";
  return "idle";
}
function fnIcon(fonction) { return FUNCTION_ICONS[fonction] || DEFAULT_ICON; }
function applyVisual(sender, m) {
  if (!m || !m.iconEl) return;
  const a = cfg.assign?.[sender] || {};
  const name = names.get(sender) || sender.replace(/^@/, "").split(":")[0];
  const tag = a.fonction && a.fonction !== "Sans" ? `[${a.fonction.toUpperCase()}] ` : "";
  // État 'stale' : marqueur réhydraté du disque (avant 1ère trame live).
  // Gris + âge depuis la dernière position connue ; jamais pulsé.
  if (m.stale) {
    m.state = "stale";
    const color = STATE_COLORS.stale;
    const age = Date.now() - (m.ts || Date.now());
    m.iconEl.style.color = color; m.iconEl.style.opacity = "0.6";
    m.glyphEl.textContent = fnIcon(a.fonction);
    m.iconEl.classList.remove("pulse");
    m.labelEl.textContent = `${tag}${name} · ${fmtAge(age)}`;
    m.labelEl.style.borderLeftColor = color;
    return;
  }
  m.iconEl.style.opacity = "";
  const st = computeState(m, Date.now()); m.state = st;
  const color = STATE_COLORS[st] || STATE_COLORS.expiring;
  m.iconEl.style.color = color;
  m.glyphEl.textContent = fnIcon(a.fonction);
  m.iconEl.classList.toggle("pulse", st === "moving" || st === "expiring");
  m.labelEl.textContent = tag + name;
  m.labelEl.style.borderLeftColor = color;
}

// ─── marqueurs ──────────────────────────────────────────────────────────────
function upsert(sender, lat, lon, ts) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const map = getMap();
  if (!map || typeof maplibregl === "undefined") {
    // Carte indisponible : ne PAS jeter la position. On la met en tampon et on
    // persiste l'état last-known pour réhydratation/reprise ultérieure.
    bufferPosition(sender, lat, lon, ts);
    persistState(sender, { lat, lng: lon, ts, trail: [[lon, lat]] });
    jlog("⚠ carte indisponible — position mise en tampon (ouvre la vue Plan tactique)", "var(--civil-yellow)");
    return;
  }
  let m = members.get(sender); const now = Date.now();
  if (!m) {
    const root = document.createElement("div"); root.className = "tl-marker";
    const icon = document.createElement("div"); icon.className = "tl-icon";
    const glyph = document.createElement("span"); glyph.className = "material-symbols-outlined tl-glyph"; glyph.textContent = DEFAULT_ICON;
    const label = document.createElement("div"); label.className = "tl-label";
    icon.appendChild(glyph); root.appendChild(icon); root.appendChild(label);
    const marker = new maplibregl.Marker({ element: root, anchor: "center" }).setLngLat([lon, lat]).addTo(map);
    m = { marker, root, iconEl: icon, glyphEl: glyph, labelEl: label, lng: lon, lat, dispLng: lon, dispLat: lat, ts, firstSeen: now, lastMove: now, trail: [[lon, lat]], beacon: beacons.get(sender) || null };
    members.set(sender, m);
    jlog(`👤 ${names.get(sender) || sender} connecté`, "var(--inter-blue)");
  } else {
    // 1ère trame live d'un marqueur réhydraté : on sort de l'état 'stale'.
    if (m.stale) { m.stale = false; m.firstSeen = now; m.lastMove = now; }
    const moved = metersBetween(m.lat, m.lng, lat, lon);
    if (moved > MOVE_MIN_M) { m.lastMove = now; m.trail.push([lon, lat]); if (m.trail.length > TRAIL_MAX) m.trail.shift(); }
    m.anim = { fromLng: m.dispLng, fromLat: m.dispLat, toLng: lon, toLat: lat, t0: now };
    m.lng = lon; m.lat = lat; m.ts = Math.max(m.ts || 0, ts);
    if (beacons.get(sender)) m.beacon = beacons.get(sender);
  }
  applyVisual(sender, m);
  ensureAnim();
  if (!centered && !followed) { centered = true; try { map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13) }); } catch (_) {} }
  if (followed === sender) { try { map.easeTo({ center: [lon, lat], duration: 700 }); } catch (_) {} }
  if (trailsOn) updateTrails();
  scheduleDeclutter(); scheduleRenderOps();
  persistState(sender, m);
}
function removeMember(sender) {
  const m = members.get(sender); if (!m) return;
  try { m.marker.remove(); } catch (_) {}
  members.delete(sender);
  if (followed === sender) followed = null;
  if (trailsOn) updateTrails();
  scheduleRenderOps();
}

// Pose un marqueur en état 'stale' (gris + âge) à partir d'un enregistrement
// persisté. N'effectue AUCUN recadrage carte (pas de flyTo) : c'est de la
// dernière position connue, pas du live. Devient live au 1er upsert reçu.
function rehydrateMarker(sender, rec) {
  if (!rec || !Number.isFinite(rec.lat) || !Number.isFinite(rec.lon)) return false;
  const map = getMap();
  if (!map || typeof maplibregl === "undefined") return false;
  if (members.has(sender)) return false;
  const lon = rec.lon, lat = rec.lat, ts = rec.ts || rec.savedAt || Date.now();
  const root = document.createElement("div"); root.className = "tl-marker";
  const icon = document.createElement("div"); icon.className = "tl-icon";
  const glyph = document.createElement("span"); glyph.className = "material-symbols-outlined tl-glyph"; glyph.textContent = DEFAULT_ICON;
  const label = document.createElement("div"); label.className = "tl-label";
  icon.appendChild(glyph); root.appendChild(icon); root.appendChild(label);
  const marker = new maplibregl.Marker({ element: root, anchor: "center" }).setLngLat([lon, lat]).addTo(map);
  const trail = Array.isArray(rec.trail) && rec.trail.length ? rec.trail.slice(-TRAIL_MAX) : [[lon, lat]];
  const m = { marker, root, iconEl: icon, glyphEl: glyph, labelEl: label, lng: lon, lat, dispLng: lon, dispLat: lat, ts, firstSeen: ts, lastMove: ts, trail, beacon: null, stale: true };
  members.set(sender, m);
  if (rec.name) names.set(sender, rec.name);
  if (rec.fonction) { cfg.assign = cfg.assign || {}; cfg.assign[sender] = cfg.assign[sender] || {}; if (!cfg.assign[sender].fonction) cfg.assign[sender].fonction = rec.fonction; }
  applyVisual(sender, m);
  return true;
}

// Réhydrate immédiatement tous les marqueurs persistés (état 'stale'), AVANT
// tout réseau. Filtré sur le salon courant. Best-effort.
async function rehydrateFromDisk() {
  let records;
  try { records = await loadAllState(); } catch (_) { return; }
  if (!records || !records.length) return;
  const map = getMap();
  if (!map || typeof maplibregl === "undefined") return; // pas de carte : on réessaiera au prochain wireUI/drain
  let n = 0;
  for (const { sender, rec } of records) {
    if (cfg.room && rec && rec.room && rec.room !== cfg.room) continue;
    if (rehydrateMarker(sender, rec)) n++;
  }
  if (n) { jlog(`↻ ${n} position(s) réhydratée(s) (dernière connue, hors-ligne)`, "var(--text-muted)"); applyVisualAll(); scheduleRenderOps(); }
}
function applyVisualAll() { for (const [s, m] of members) applyVisual(s, m); }

// animation gatée : ne tourne QUE s'il y a des opérateurs (aucun coût à vide)
let animRunning = false;
function ensureAnim() { if (!animRunning) { animRunning = true; requestAnimationFrame(animTick); } }
function animTick() {
  const now = Date.now();
  for (const m of members.values()) {
    if (!m.anim) continue;
    const k = Math.min(1, (now - m.anim.t0) / ANIM_MS);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    m.dispLng = m.anim.fromLng + (m.anim.toLng - m.anim.fromLng) * e;
    m.dispLat = m.anim.fromLat + (m.anim.toLat - m.anim.fromLat) * e;
    try { m.marker.setLngLat([m.dispLng, m.dispLat]); } catch (_) {}
    if (k >= 1) { m.dispLng = m.anim.toLng; m.dispLat = m.anim.toLat; m.anim = null; }
  }
  if (members.size > 0) requestAnimationFrame(animTick); else animRunning = false;
}

// anti-chevauchement : éventail des marqueurs proches (jamais fusionnés)
let declutterTimer = null;
function scheduleDeclutter() { if (declutterTimer) return; declutterTimer = setTimeout(() => { declutterTimer = null; declutter(); }, 350); }
function declutter() {
  const map = getMap(); if (!map) return;
  const pts = [...members.values()].filter((m) => m.marker).map((m) => ({ m, p: map.project([m.lng, m.lat]) }));
  const used = new Array(pts.length).fill(false);
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    const group = [pts[i]]; used[i] = true;
    for (let j = i + 1; j < pts.length; j++) {
      if (used[j]) continue;
      if (Math.hypot(pts[i].p.x - pts[j].p.x, pts[i].p.y - pts[j].p.y) < DECLUTTER_PX) { group.push(pts[j]); used[j] = true; }
    }
    if (group.length === 1) { try { group[0].m.marker.setOffset([0, 0]); } catch (_) {} }
    else { const R = Math.max(DECLUTTER_PX, 9 * group.length); group.forEach((g, k) => { const a = (2 * Math.PI * k) / group.length; try { g.m.marker.setOffset([Math.cos(a) * R, Math.sin(a) * R]); } catch (_) {} }); }
  }
}

// ─── trace ──────────────────────────────────────────────────────────────────
let trailPending = false;
function ensureTrailLayer() {
  const map = getMap(); if (!map) return false;
  if (!map.isStyleLoaded()) { if (!trailPending) { trailPending = true; map.once("idle", () => { trailPending = false; ensureTrailLayer(); updateTrails(); }); } return false; }
  if (!map.getSource("tl-trails")) {
    map.addSource("tl-trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "tl-trails-line", type: "line", source: "tl-trails", layout: { "line-cap": "round", "line-join": "round", visibility: trailsOn ? "visible" : "none" }, paint: { "line-color": ["coalesce", ["get", "color"], "#4f8dff"], "line-width": 3, "line-opacity": 0.65 } });
  }
  return true;
}
function updateTrails() {
  const map = getMap(); if (!map || !ensureTrailLayer()) return;
  const features = [];
  for (const m of members.values()) if (m.trail && m.trail.length > 1) features.push({ type: "Feature", properties: { color: m.state === "moving" ? "#2ecf91" : "#4f8dff" }, geometry: { type: "LineString", coordinates: m.trail } });
  const src = map.getSource("tl-trails"); if (src) src.setData({ type: "FeatureCollection", features });
}
function toggleTrails() {
  trailsOn = !trailsOn;
  const fab = $("tl_btn_trail"); if (fab) { fab.classList.toggle("active", trailsOn); fab.style.background = trailsOn ? "var(--inter-blue,#4f8dff)" : ""; fab.style.color = trailsOn ? "#fff" : ""; }
  const map = getMap();
  if (map && ensureTrailLayer()) { map.setLayoutProperty("tl-trails-line", "visibility", trailsOn ? "visible" : "none"); if (trailsOn) updateTrails(); }
  jlog(trailsOn ? "trace activée" : "trace désactivée", "var(--text-muted)");
}

// ─── liste opérateurs (par équipe) ──────────────────────────────────────────
let renderTimer = null;
function scheduleRenderOps() { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = null; renderOps(); }, 400); }
function optionTags(list, sel) { return `<option value=""${sel ? "" : " selected"}>—</option>` + list.map((v) => `<option value="${v}"${v === sel ? " selected" : ""}>${v}</option>`).join(""); }
// ─── liste opérateurs : tableau d'ordre de bataille (accordéon) ───────────────
// Regroupement par fonction (défaut) ou cellule, sections repliables, jauge d'état.
let collapsed = new Set();                       // sections repliées : clé "groupe"
let batchMode = false;                            // mode lot (affectation multiple)
let batchSel = new Set();                         // opérateurs sélectionnés en mode lot
const FONCTION_RANK = { "Chef inter": 0, "Chef dispo": 1, "Chef Oscar": 2, "Négociateur": 3, "PC": 4, "Inter": 5, "AO": 6, "Effrac": 7, "Cyno": 8, "Medic": 9, "Pompier": 10, "Sans": 98 };
const GAUGE_ORDER = ["moving", "new", "idle", "expiring"];

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function fmtAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  const mn = Math.floor(s / 60);
  return mn < 60 ? mn + "m" : Math.floor(mn / 60) + "h";
}
function stateCounts(list) { const c = {}; for (const [, m] of list) { const st = m.state || "idle"; c[st] = (c[st] || 0) + 1; } return c; }
function gaugeHtml(counts) {
  let seg = "";
  for (const st of GAUGE_ORDER) { const n = counts[st]; if (n) seg += `<i style="flex-grow:${n};background:${STATE_COLORS[st] || "var(--text-muted)"}"></i>`; }
  return `<span class="tl-grp-gauge">${seg}</span>`;
}
function renderOps(force) {
  const box = $("tl_ops"); if (!box) return;
  // Ne pas reconstruire la liste tant qu'un menu déroulant (select) est ouvert/focalisé :
  // sinon le <select> est détruit et le menu se referme aussitôt. On reporte le rendu.
  // Les rendus explicites (après un choix, un repli…) passent force=true.
  if (!force) {
    const ae = document.activeElement;
    if (ae && ae.tagName === "SELECT" && box.contains(ae)) { scheduleRenderOps(); return; }
  }
  const cnt = $("tl_count"); if (cnt) cnt.textContent = members.size ? `${members.size} opérateur(s)` : "—";
  if (!members.size) { box.innerHTML = '<div class="tl-empty">Aucun opérateur connecté.</div>'; return; }

  const now = Date.now();

  // Regroupement par FONCTION
  const groups = new Map();
  for (const [s, m] of members) {
    const key = (cfg.assign[s] || {}).fonction || "Sans";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([s, m]);
  }
  // Tri par priorité tactique
  const keys = [...groups.keys()].sort((x, y) => ((FONCTION_RANK[x] ?? 50) - (FONCTION_RANK[y] ?? 50)) || x.localeCompare(y, "fr"));

  // Bandeau : compteurs d'état globaux
  const glob = stateCounts([...members]);
  const pill = (st, label) => glob[st] ? `<span title="${label}"><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${STATE_COLORS[st]};vertical-align:middle"></i> <b>${glob[st]}</b></span>` : "";
  let html = `<div class="tl-ops-bar">`
    + `<button type="button" class="tl-batch-toggle${batchMode ? " active" : ""}" title="Mode lot : affecter une fonction à plusieurs opérateurs">Lot</button>`
    + `<span class="tl-ops-states">${pill("new", "Nouveau")}${pill("moving", "En mouvement")}${pill("idle", "Immobile")}${pill("expiring", "Déco imminente")}</span></div>`;
  if (batchMode) {
    html += `<div class="tl-batch-bar">`
      + `<button type="button" class="tl-batch-all" title="Tout sélectionner / désélectionner">Tout</button>`
      + `<select class="tl-batch-fn" title="Fonction à affecter aux sélectionnés">${optionTags(FONCTIONS, null)}</select>`
      + `<button type="button" class="tl-batch-apply">Affecter (<span class="tl-batch-n">${batchSel.size}</span>)</button>`
      + `</div>`;
  }

  for (const key of keys) {
    const list = groups.get(key);
    const isCol = collapsed.has(key);
    html += `<div class="tl-grp ${isCol ? "collapsed" : ""}">`
      + `<div class="tl-grp-head" data-g="${encodeURIComponent(key)}">`
      + `<span class="tl-grp-caret">${isCol ? "▶" : "▼"}</span>`
      + `<span class="material-symbols-outlined tl-grp-icon">${fnIcon(key)}</span>`
      + `<span class="tl-grp-name">${escapeHtml(key)}</span>`
      + `<span class="tl-grp-count">${list.length}</span>`
      + gaugeHtml(stateCounts(list))
      + `<button type="button" class="tl-grp-follow" title="Centrer ce groupe">⊙</button>`
      + `</div><div class="tl-grp-body">`;
    for (const [s, m] of list) {
      const a = cfg.assign[s] || {};
      const name = names.get(s) || s.replace(/^@/, "").split(":")[0];
      const color = STATE_COLORS[m.state] || "var(--text-muted)";
      const tag = a.fonction && a.fonction !== "Sans" ? `[${a.fonction.toUpperCase()}] ` : "";
      const checked = batchSel.has(s);
      const lead = batchMode ? `<input type="checkbox" class="tl-op-check"${checked ? " checked" : ""}>` : "";
      const fnCtrl = batchMode ? "" : `<select class="tl-op-fn" title="Fonction">${optionTags(FONCTIONS, a.fonction)}</select>`;
      html += `<div class="tl-op${batchMode && checked ? " selected" : ""}" data-s="${encodeURIComponent(s)}">`
        + lead
        + `<span class="tl-op-dot${m.state === "moving" ? " moving" : ""}" style="background:${color}"></span>`
        + `<span class="tl-op-name" title="${escapeHtml(name)}">${escapeHtml(tag + name)}</span>`
        + `<span class="tl-op-age">${fmtAge(now - (m.ts || now))}</span>`
        + fnCtrl
        + `<button type="button" class="tl-op-follow ${followed === s ? "on" : ""}" title="Suivre (centrage live)">${followed === s ? "◉" : "◎"}</button>`
        + `</div>`;
    }
    html += `</div></div>`;
  }
  box.innerHTML = html;
}
function onOpsChange(e) {
  // Mode lot : (dé)sélection d'un opérateur — mise à jour en place (pas de re-render)
  if (e.target.classList.contains("tl-op-check")) {
    const row = e.target.closest(".tl-op"); if (!row) return;
    const s = decodeURIComponent(row.dataset.s);
    if (e.target.checked) batchSel.add(s); else batchSel.delete(s);
    row.classList.toggle("selected", e.target.checked);
    const n = document.querySelector(".tl-batch-n"); if (n) n.textContent = batchSel.size;
    return;
  }
  // Affectation individuelle de fonction
  const row = e.target.closest(".tl-op"); if (!row) return;
  if (!e.target.classList.contains("tl-op-fn")) return;
  const s = decodeURIComponent(row.dataset.s); const a = cfg.assign[s] = cfg.assign[s] || {};
  a.fonction = e.target.value || null;
  persist();
  const m = members.get(s); if (m) applyVisual(s, m);
  renderOps(true);
}
function fitGroup(key) {
  const map = getMap(); if (!map) return;
  const pts = [];
  for (const [s, m] of members) {
    if ((((cfg.assign[s] || {}).fonction) || "Sans") === key && Number.isFinite(m.lng) && Number.isFinite(m.lat)) pts.push([m.lng, m.lat]);
  }
  if (!pts.length) return;
  if (pts.length === 1) map.flyTo({ center: pts[0], zoom: Math.max(map.getZoom(), 14) });
  else { const b = new maplibregl.LngLatBounds(); for (const p of pts) b.extend(p); map.fitBounds(b, { padding: 80, maxZoom: 15 }); }
  jlog(`centré sur « ${key} » (${pts.length})`, "var(--inter-blue)");
}
function onOpsClick(e) {
  // Mode lot : activer / désactiver
  if (e.target.closest(".tl-batch-toggle")) {
    batchMode = !batchMode; if (!batchMode) batchSel.clear();
    renderOps(true); return;
  }
  // Lot : tout (dé)sélectionner
  if (e.target.closest(".tl-batch-all")) {
    if (batchSel.size === members.size) batchSel.clear();
    else { batchSel.clear(); for (const s of members.keys()) batchSel.add(s); }
    renderOps(true); return;
  }
  // Lot : affecter la fonction choisie à tous les sélectionnés
  if (e.target.closest(".tl-batch-apply")) {
    if (!batchSel.size) { jlog("aucun opérateur sélectionné", "var(--text-muted)"); return; }
    const sel = document.querySelector(".tl-batch-fn");
    const val = sel ? (sel.value || null) : null;
    for (const s of batchSel) { const a = cfg.assign[s] = cfg.assign[s] || {}; a.fonction = val; const m = members.get(s); if (m) applyVisual(s, m); }
    persist();
    jlog(`fonction « ${val || "—"} » affectée à ${batchSel.size} opérateur(s)`, "var(--inter-blue)");
    batchSel.clear();
    renderOps(true); return;
  }
  // Centrer un groupe (fitBounds one-shot sur ses membres)
  const gf = e.target.closest(".tl-grp-follow");
  if (gf) { const h = gf.closest(".tl-grp-head"); if (h) fitGroup(decodeURIComponent(h.dataset.g)); return; }
  // Replier / déplier une section
  const head = e.target.closest(".tl-grp-head");
  if (head) {
    const k = decodeURIComponent(head.dataset.g);
    if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
    renderOps(true);
    return;
  }
  // Suivre un opérateur (centrage live)
  const btn = e.target.closest(".tl-op-follow"); if (!btn) return;
  const s = decodeURIComponent(btn.closest(".tl-op").dataset.s);
  followed = followed === s ? null : s;
  if (followed) { const m = members.get(followed), map = getMap(); if (m && map) map.flyTo({ center: [m.lng, m.lat], zoom: Math.max(map.getZoom(), 14) }); jlog(`suivi : ${names.get(s) || s}`, "var(--inter-blue)"); }
  else jlog("suivi désactivé", "var(--text-muted)");
  renderOps(true);
}

// ─── /sync ──────────────────────────────────────────────────────────────────
function handleEvent(ev) {
  const type = ev.type, sender = ev.sender || "?", ts = ev.origin_server_ts || Date.now();
  if (type === "m.room.member" && ev.content?.displayname) { names.set(ev.state_key || sender, ev.content.displayname); return; }
  if (type === "m.room.encrypted") { status("⚠ salon chiffré : il faut un Forum non chiffré", "var(--civil-yellow)"); return; }
  if (/beacon_info/.test(type)) {
    const owner = ev.state_key || sender, c = ev.content || {};
    const info = c["org.matrix.msc3672.beacon_info"] || c["m.beacon_info"] || c;
    const startTs = info["org.matrix.msc3488.ts"] || info["m.ts"] || ts;
    beacons.set(owner, { live: !!info.live, startTs, expiry: startTs + (info.timeout || 0) });
    const m = members.get(owner); if (m && m.iconEl) { m.beacon = beacons.get(owner); applyVisual(owner, m); }
    return;
  }
  const g = extractLoc(type, ev.content);
  if (g) upsert(sender, g.lat, g.lon, ts);
  else if (/beacon/.test(type)) jlog(`⚠ beacon sans position lisible — clés: ${Object.keys(ev.content || {}).join(", ")}`, "var(--civil-yellow)");
}
function processSync(data, initial) {
  const j = data.rooms?.join?.[cfg.room];
  if (!j) { if (initial) { status("⚠ salon introuvable dans le sync", "var(--danger-red)"); jlog(`⚠ salon ${cfg.room} absent — membre ? Room ID exact ?`, "var(--danger-red)"); } return; }
  const st = j.state?.events || [], tl = j.timeline?.events || [];
  if (initial) jlog(`salon trouvé : ${st.length} state + ${tl.length} timeline`, "var(--text-muted)");
  for (const ev of st) handleEvent(ev);
  for (const ev of tl) handleEvent(ev);
  if (initial) { const now = Date.now(); for (const [s, m] of [...members]) if (m.marker && computeState(m, now) === "lost") removeMember(s); }
}

// ─── AUTH : OIDC device-code (RFC 8628) + refresh + repli token manuel ───────
async function discoverOidc(hs) {
  let issuer = DEFAULT_ISSUER;
  try { const wk = await fetch(hs.replace(/\/$/, "") + "/.well-known/matrix/client").then((r) => r.json()); issuer = wk["org.matrix.msc2965.authentication"]?.issuer || wk["m.authentication"]?.issuer || issuer; } catch (_) {}
  let meta = null;
  try { meta = await fetch(issuer.replace(/\/$/, "") + "/.well-known/openid-configuration").then((r) => r.json()); } catch (_) {}
  return {
    issuer,
    deviceEndpoint: meta?.device_authorization_endpoint || issuer + "/oauth2/device",
    tokenEndpoint: meta?.token_endpoint || issuer + "/oauth2/token",
    registrationEndpoint: meta?.registration_endpoint || issuer + "/oauth2/registration",
  };
}
async function registerClient(o) {
  const body = { client_name: "PC-Tac géoloc", application_type: "native", token_endpoint_auth_method: "none", grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"], response_types: [], client_uri: CLIENT_URI };
  const r = await fetch(o.registrationEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: aborter?.signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.client_id) throw new Error(`enregistrement client ${r.status} ${j.error || j.error_description || ""}`.trim());
  return j.client_id;
}
function genDeviceId() {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; let s = "";
  const arr = crypto.getRandomValues(new Uint8Array(16)); for (const x of arr) s += a[x % a.length];
  return s.slice(0, 16);
}
function oidcScope(deviceId) { return `openid urn:matrix:org.matrix.msc2967.client:api:* urn:matrix:org.matrix.msc2967.client:device:${deviceId}`; }
async function deviceAuth(o, cid, deviceId) {
  const r = await fetch(o.deviceEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cid, scope: oidcScope(deviceId) }), signal: aborter?.signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.device_code) throw new Error(`device_auth ${r.status} ${j.error || j.error_description || ""}`.trim());
  return j;
}
async function pollToken(o, cid, deviceCode, interval, expiresIn) {
  deviceAbort = false;
  const deadline = Date.now() + (expiresIn || 300) * 1000;
  let intv = interval || 5;
  while (!deviceAbort && Date.now() < deadline) {
    await sleep(intv * 1000);
    if (deviceAbort) throw new Error("autorisation annulée");
    const r = await fetch(o.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode, client_id: cid }), signal: aborter?.signal });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) return j;
    if (j.error === "authorization_pending") continue;
    if (j.error === "slow_down") { intv += 5; continue; }
    throw new Error(j.error_description || j.error || `token ${r.status}`);
  }
  throw new Error("délai d'autorisation dépassé");
}
async function doRefresh() {
  const r = await fetch(oidc.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`refresh ${r.status} ${j.error || ""}`.trim());
  accessToken = j.access_token;
  if (j.refresh_token) refreshToken = j.refresh_token; // rotation
  expiresAt = Date.now() + (j.expires_in || 300) * 1000;
  cfg.oidc = { clientId, refreshToken, deviceId: cfg.oidc?.deviceId }; persist();
  jlog("token renouvelé automatiquement", "var(--text-muted)");
}
async function ensureToken() {
  if (authMode === "oidc" && refreshToken && Date.now() > expiresAt - 60000) await doRefresh();
}

// ─── requêtes /sync (token courant + refresh transparent) ───────────────────
async function api(path, retried) {
  await ensureToken();
  const res = await fetch(cfg.hs.replace(/\/$/, "") + path, { headers: { Authorization: "Bearer " + accessToken }, signal: aborter?.signal });
  if (res.status === 401 && authMode === "oidc" && refreshToken && !retried) { await doRefresh(); return api(path, true); }
  if (!res.ok) { const b = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status} ${b.slice(0, 120)}`); }
  return res.json();
}

function uiBusy(b) { ["tl_connect", "tl_oidc"].forEach((id) => { const el = $(id); if (el) el.disabled = b; }); const st = $("tl_stop"); if (st) st.disabled = !b; }

// Backoff exponentiel borné + jitter (anti-thundering-herd, respectueux du WAF :
// on RALENTIT en cas d'erreur, on ne contourne rien). delay = min(cap, base*2^n) ± jitter.
const BACKOFF_BASE = 3000, BACKOFF_CAP = 45000;
function backoffDelay(n) {
  const raw = Math.min(BACKOFF_CAP, BACKOFF_BASE * Math.pow(2, n));
  const jitter = raw * 0.25 * (Math.random() * 2 - 1); // ±25%
  return Math.max(BACKOFF_BASE, Math.round(raw + jitter));
}

// Page Visibility : suspend la boucle quand l'onglet est masqué (économie
// batterie/data terrain) et reprend au retour. Garde-fou de support.
let visHandlerWired = false;
let resumeFromHidden = null; // resolver pour réveiller une boucle en pause
function waitVisible() {
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve();
  markOffline(); status("En pause (onglet masqué) — reprise au retour…", "var(--text-muted)"); setDot("var(--civil-yellow)");
  return new Promise((resolve) => { resumeFromHidden = resolve; });
}
function wireVisibility() {
  if (visHandlerWired || typeof document === "undefined") return; visHandlerWired = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && resumeFromHidden) { const r = resumeFromHidden; resumeFromHidden = null; markOnline(); r(); }
  });
}

async function runSync() {
  uiBusy(true); startSweep(); wireVisibility();
  const myAborter = aborter; // jeton de génération : si remplacé (stop+start), cette boucle s'arrête
  setDot("var(--civil-yellow)"); status("Connexion…");
  try {
    const who = await api("/_matrix/client/v3/account/whoami");
    setDot("var(--ao-green)"); markOnline(); status(`Connecté : ${who.user_id}`, "var(--text-muted)"); jlog(`connecté : ${who.user_id}`, "var(--ao-green)");
    const filter = encodeURIComponent(JSON.stringify({ room: { rooms: [cfg.room], timeline: { limit: 50 }, state: { lazy_load_members: false } }, presence: { types: [] } }));
    // Reprise du long-poll incrémental après refresh via le curseur persisté.
    // Fallback propre : si /sync rejette un next_batch expiré, on repart sur un
    // /sync initial (comportement déjà géré par le catch ci-dessous).
    let since = Persist.getRaw(LS_SINCE_KEY) || null;
    let initialDone = false;
    if (since) {
      try {
        jlog("reprise du long-poll (curseur persisté)…", "var(--text-muted)");
        let sync = await api(`/_matrix/client/v3/sync?since=${encodeURIComponent(since)}&timeout=0&filter=${filter}`);
        processSync(sync, false); renderOps(); since = sync.next_batch; Persist.setRaw(LS_SINCE_KEY, since);
        initialDone = true;
      } catch (e) {
        if (/abort/i.test(e.name || "")) throw e;
        jlog("curseur expiré → /sync initial", "var(--civil-yellow)"); since = null;
      }
    }
    if (!initialDone) {
      let sync = await api(`/_matrix/client/v3/sync?timeout=0&filter=${filter}`);
      processSync(sync, true); renderOps();
      since = sync.next_batch; Persist.setRaw(LS_SINCE_KEY, since);
    }
    let backoffN = 0;
    while (running && aborter === myAborter) {
      await waitVisible(); if (!running || aborter !== myAborter) break;
      try {
        const sync = await api(`/_matrix/client/v3/sync?since=${encodeURIComponent(since)}&timeout=30000&filter=${filter}`);
        processSync(sync, false); since = sync.next_batch; Persist.setRaw(LS_SINCE_KEY, since);
        backoffN = 0; markOnline(); setDot("var(--ao-green)"); // trame réussie : reset du backoff
        status(`À jour — ${new Date().toLocaleTimeString()} · ${members.size} opérateur(s)`, "var(--text-muted)");
      } catch (e) {
        if (!running || aborter !== myAborter) break;
        if (/abort/i.test(e.name || "")) break;
        // Un curseur expiré (souvent 4xx M_UNKNOWN) → reprise propre sur /sync initial.
        if (/400|410|M_UNKNOWN_TOKEN|unknown.*since|invalid.*since/i.test(e.message || "") && since) {
          jlog("curseur rejeté → /sync initial", "var(--civil-yellow)");
          try { const s2 = await api(`/_matrix/client/v3/sync?timeout=0&filter=${filter}`); processSync(s2, false); since = s2.next_batch; Persist.setRaw(LS_SINCE_KEY, since); backoffN = 0; markOnline(); setDot("var(--ao-green)"); continue; }
          catch (_) { /* on tombe dans le backoff ci-dessous */ }
        }
        markOffline();
        const d = backoffDelay(backoffN); backoffN++;
        status(`Hors-réseau — reprise dans ${Math.round(d / 1000)}s (${e.message})`, "var(--civil-yellow)");
        await sleepAbortable(d);
        if (running && aborter === myAborter && !offlineSince) setDot("var(--ao-green)");
      }
    }
  } catch (e) {
    if (/abort/i.test(e.name || "") || /aborted|annul/i.test(e.message || "")) return; // arrêt volontaire
    setDot("var(--danger-red)");
    if (/401|403/.test(e.message)) status(authMode === "manual" ? "Token invalide/expiré — recopie-le." : "Auth refusée — relance ProConnect.", "var(--danger-red)");
    else if (/Failed to fetch|CORS|NetworkError/i.test(e.message)) status("Réseau/CORS — vérifie le homeserver.", "var(--danger-red)");
    else status("Échec : " + e.message, "var(--danger-red)");
    jlog("✖ " + e.message, "var(--danger-red)");
    stop(false);
  }
}

async function startManual() {
  if (running) return;
  saveCfg();
  if (!cfg.hs || !cfg.token || !cfg.room) { status("Renseigne homeserver + token + room.", "var(--danger-red)"); return; }
  running = true; aborter = new AbortController();
  authMode = "manual"; accessToken = cfg.token; refreshToken = null;
  cfg.mode = "manual"; cfg.connected = true; persist();
  injectStyle(); centered = false;
  jlog("connexion (token manuel)…", "var(--text-muted)");
  await runSync();
}

async function startOidc() {
  if (running) return;
  saveCfg();
  if (!cfg.hs || !cfg.room) { status("Renseigne homeserver + room.", "var(--danger-red)"); return; }
  running = true; aborter = new AbortController();
  authMode = "oidc"; cfg.mode = "oidc"; cfg.connected = true; persist();
  injectStyle(); centered = false; uiBusy(true);
  setDot("var(--civil-yellow)"); status("Authentification ProConnect…");
  try {
    oidc = await discoverOidc(cfg.hs);
    clientId = cfg.oidc?.clientId || cfg.clientId || (val("tl_clientid") || "").trim() || null;
    // reprise via refresh token
    if (cfg.oidc?.refreshToken && clientId) {
      refreshToken = cfg.oidc.refreshToken;
      try { await doRefresh(); jlog("session ProConnect reprise", "var(--ao-green)"); hideDevice(); await runSync(); return; }
      catch (e) { jlog("refresh expiré → nouvelle autorisation", "var(--civil-yellow)"); refreshToken = null; }
    }
    if (!clientId) { jlog("enregistrement du client…", "var(--text-muted)"); clientId = await registerClient(oidc); jlog("client enregistré", "var(--text-muted)"); }
    const deviceId = genDeviceId();
    const da = await deviceAuth(oidc, clientId, deviceId);
    showDevice(da);
    jlog("en attente d'autorisation ProConnect…", "var(--civil-yellow)");
    const tok = await pollToken(oidc, clientId, da.device_code, da.interval, da.expires_in);
    hideDevice();
    accessToken = tok.access_token; refreshToken = tok.refresh_token; expiresAt = Date.now() + (tok.expires_in || 300) * 1000;
    cfg.oidc = { clientId, refreshToken, deviceId }; cfg.clientId = clientId; persist();
    jlog("autorisation ProConnect OK", "var(--ao-green)");
    await runSync();
  } catch (e) {
    hideDevice();
    if (/abort/i.test(e.name || "") || /aborted|annul/i.test(e.message || "")) return; // arrêt volontaire (Stop)
    setDot("var(--danger-red)");
    status("ProConnect échoué : " + e.message + " — repli token manuel possible.", "var(--danger-red)");
    jlog("✖ ProConnect: " + e.message, "var(--danger-red)");
    stop(false);
  }
}

function showDevice(da) {
  const el = $("tl_device"); if (!el) return;
  // Données issues du serveur OIDC : échappées avant innerHTML, et seul un lien
  // https:// est cliquable (pas de javascript: / data: injectable).
  const escT = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const rawUri = da.verification_uri_complete || da.verification_uri || "";
  const uri = /^https:\/\//i.test(rawUri) ? rawUri : "";
  const vu = da.verification_uri || rawUri;
  el.style.display = "block";
  const linkHtml = uri
    ? `<a href="${escT(uri)}" target="_blank" rel="noopener" style="color:var(--inter-blue,#4f8dff);font-weight:600;">${escT(vu)}</a>`
    : `<b>${escT(vu)}</b>`;
  el.innerHTML = `Autorise PC-Tac via ProConnect : ouvre ${linkHtml}` + (da.user_code ? ` et saisis le code <b style="font-size:1.15em;letter-spacing:2px;">${escT(da.user_code)}</b>` : "");
}
function hideDevice() { const el = $("tl_device"); if (el) { el.style.display = "none"; el.innerHTML = ""; } }

function stop(userInitiated) {
  running = false; deviceAbort = true;
  if (resumeFromHidden) { const r = resumeFromHidden; resumeFromHidden = null; r(); } // réveille une boucle en pause
  if (aborter) { aborter.abort(); aborter = null; } // remis à null → un nouveau start crée un signal frais
  stopSweep(); stopOfflineTicker(); markOnline();
  for (const s of [...members.keys()]) removeMember(s); // purge l'affichage (pas de marqueurs périmés au re-start)
  // État de session (beacons/names) : purgé pour qu'un beacon_info live:false d'une
  // session précédente n'empoisonne pas le même opérateur à la session suivante.
  beacons.clear(); names.clear();
  accessToken = null; expiresAt = 0; followed = null; centered = false;
  if (userInitiated) {
    // Arrêt VOLONTAIRE : on oublie tout (tampon, last-known IndexedDB, curseur sync).
    pendingPositions.clear();
    purgeState();
    try { Persist.setRaw(LS_SINCE_KEY, ""); } catch (_) {}
  }
  // Arrêt sur ERREUR (réseau/token) : on CONSERVE l'état persisté — c'est lui qui
  // permet de réafficher les dernières positions connues au redémarrage hors-ligne.
  uiBusy(false); hideDevice();
  if (userInitiated) {
    setDot("var(--text-muted)"); status("Arrêté.", "var(--text-muted)");
    cfg.connected = false; persist();
  }
  // Arrêt sur erreur : on NE réécrit PAS le statut — le message d'erreur posé par
  // l'appelant (« Token invalide », « Hors-réseau »…) doit rester lisible.
}

// balayage états (gris/rouge) + retrait des "lost" — actif UNIQUEMENT pendant une session
let sweepTimer = null;
function sweepStates() {
  const now = Date.now();
  for (const [s, m] of [...members]) { if (!m.marker) continue; if (computeState(m, now) === "lost") removeMember(s); else applyVisual(s, m); }
  if (members.size) scheduleRenderOps();
}
function startSweep() { if (!sweepTimer) sweepTimer = setInterval(sweepStates, 5000); }
function stopSweep() { if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; } }

// ─── câblage UI ───────────────────────────────────────────────────────────--
async function loadLists() {
  try { const r = await fetch("members_config.json", { cache: "no-store" }); if (r.ok) { const j = await r.json(); if (Array.isArray(j.options?.fonctions)) FONCTIONS = j.options.fonctions; if (Array.isArray(j.options?.cellules)) CELLULES = j.options.cellules; } } catch (_) {}
}
function wireUI() {
  if (!$("tl_toggle")) return;
  if ($("tl_hs")) $("tl_hs").value = cfg.hs || DEFAULT_HS;
  if ($("tl_token")) $("tl_token").value = cfg.token || "";
  if ($("tl_room")) $("tl_room").value = cfg.room || "";
  if ($("tl_clientid")) $("tl_clientid").value = cfg.clientId || "";
  $("tl_toggle").addEventListener("click", () => { const p = $("tl_panel"); p.style.display = p.style.display === "none" ? "block" : "none"; });
  const oidcBtn = $("tl_oidc"); if (oidcBtn) oidcBtn.addEventListener("click", startOidc);
  $("tl_connect").addEventListener("click", startManual);
  $("tl_stop").addEventListener("click", () => stop(true));
  const cen = $("tl_center"); if (cen) cen.addEventListener("click", () => { const map = getMap(); if (!map || !members.size) return; if (members.size === 1) { const m = [...members.values()][0]; map.flyTo({ center: [m.lng, m.lat], zoom: 14 }); } else { const b = new maplibregl.LngLatBounds(); for (const m of members.values()) b.extend([m.lng, m.lat]); map.fitBounds(b, { padding: 80, maxZoom: 15 }); } });
  for (const id of ["tl_hs", "tl_token", "tl_room", "tl_clientid"]) { const el = $(id); if (el) el.addEventListener("change", saveCfg); }
  const ops = $("tl_ops"); if (ops) { ops.addEventListener("change", onOpsChange); ops.addEventListener("click", onOpsClick); }
  // listeners carte attachés paresseusement (wireMapListeners via getMap) — pas d'init carte au boot
  loadLists().then(renderOps);
  injectStyle();
  // RÉHYDRATATION immédiate de l'état last-known (gris/stale + âge) AVANT tout
  // réseau : la dernière position connue de chaque opérateur est visible dès le
  // boot, même hors-ligne. La carte n'est posée que si la vue Plan est dispo ;
  // sinon on retentera quand elle le devient (rehydratePending).
  if (cfg.connected && cfg.room) {
    rehydratePending = true;
    rehydrateFromDisk().then(() => { if (members.size) rehydratePending = false; scheduleRenderOps(); });
  }
  renderOps();
  // reprise automatique après un simple rafraîchissement (sauf arrêt explicite)
  if (cfg.connected && cfg.hs && cfg.room) {
    if (cfg.mode === "oidc" && cfg.oidc?.refreshToken) { jlog("reprise ProConnect après rafraîchissement…", "var(--text-muted)"); startOidc(); }
    else if (cfg.token) { jlog("reprise (token manuel) après rafraîchissement…", "var(--text-muted)"); startManual(); }
  }
}

export const TchapLive = { startManual, startOidc, stop, wireUI };

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireUI);
else wireUI();
