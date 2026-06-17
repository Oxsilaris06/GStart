/*
 * tchapLive.js — Suivi géoloc équipe en temps réel depuis un salon Tchap (Matrix).
 *
 * Voie "salon NON chiffré (Forum)" : /sync HTTP direct (pas de SDK/crypto/clés).
 * Un seul token (le tien, membre du salon) reçoit TOUTES les positions du salon.
 *
 * Fonctions :
 *  - 1 marqueur/opérateur sur window.PlanMap.map, animation fluide de déplacement.
 *  - Anti-chevauchement : marqueurs co-localisés écartés en éventail (jamais fusionnés).
 *  - Couleur = ÉTAT : bleu=nouveau · vert(animé)=déplacement · gris=actif immobile ·
 *                     rouge=déconnexion imminente. Basé sur le beacon (live+timeout),
 *                     donc actif tant que le beacon vit, même immobile.
 *  - Icône = FONCTION (PATRACDVR/members_config), libellé "[FONCTION] Nom".
 *  - Liste des opérateurs groupée par ÉQUIPE (cellule) + bouton "Suivre" (centrage live).
 *  - Trace/historique activable via bouton carte.
 * Config + affectations persistées en localStorage.
 */

const LS_KEY = "pcTacTchapLive";
const DEFAULT_HS = "https://matrix.agent.interieur.tchap.gouv.fr";

const NEW_MS = 30 * 1000;          // "nouveau connecté" (bleu)
const MOVE_WINDOW_MS = 12 * 1000;  // considéré "en déplacement" si bougé récemment
const MOVE_MIN_M = 8;              // seuil de mouvement (mètres)
const RED_LEAD_MS = 60 * 1000;     // rouge si le beacon expire dans moins de 60 s
const FB_EXPIRING_MS = 120 * 1000; // sans beacon_info : position vieille → imminent
const FB_LOST_MS = 360 * 1000;     // sans beacon_info : position très vieille → retiré
const ANIM_MS = 900;
const DECLUTTER_PX = 30;
const TRAIL_MAX = 80;

const STATE_COLORS = {
  new: "var(--inter-blue, #4f8dff)",
  moving: "var(--ao-green, #2ecf91)",
  idle: "var(--text-muted, #8a8a91)",
  expiring: "var(--danger-red, #f0556a)",
};
const DEFAULT_ICON = "person_pin_circle";
const FUNCTION_ICONS = {
  "Chef inter": "military_tech", "Chef dispo": "stars", "Chef Oscar": "shield_person",
  "Conducteur": "directions_car", "Chef de bord": "airline_seat_recline_normal",
  "DE": "bomb", "Cyno": "pets", "Inter": "local_police", "Effrac": "hardware",
  "AO": "visibility", "Sans": "person_pin_circle",
};
let FONCTIONS = ["Chef inter", "Chef dispo", "Chef Oscar", "Conducteur", "Chef de bord", "DE", "Cyno", "Inter", "Effrac", "AO", "Sans"];
let CELLULES = ["AO1", "AO2", "AO3", "AO4", "AO5", "AO6", "AO7", "AO8", "India 1", "India 2", "India 3", "India 4", "India 5", "Effrac", "Sans"];

let cfg = loadCfg();
let running = false;
let aborter = null;
let followed = null;        // sender suivi (centrage auto)
let centered = false;
let trailsOn = false;
const members = new Map();  // sender -> {marker, root, iconEl, glyphEl, labelEl, lng, lat, dispLng, dispLat, ts, firstSeen, lastMove, beacon, trail, anim, state}
const names = new Map();    // sender -> displayname
const beacons = new Map();  // owner(MXID) -> {live, startTs, expiry}  (séparé : jamais dans members)

function loadCfg() { try { const c = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); c.assign = c.assign || {}; return c; } catch (_) { return { assign: {} }; } }
function saveCfg() {
  cfg.hs = (val("tl_hs") || DEFAULT_HS).trim(); cfg.token = val("tl_token").trim(); cfg.room = val("tl_room").trim();
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id) ? $(id).value : "");

// ─── journal ────────────────────────────────────────────────────────────────
function jlog(msg, color) {
  const box = $("tl_log"); if (!box) return;
  const l = document.createElement("div"); if (color) l.style.color = color;
  l.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  box.appendChild(l); box.scrollTop = box.scrollHeight;
  while (box.childNodes.length > 60) box.removeChild(box.firstChild);
}
function setDot(c) { const d = $("tl_dot"); if (d) d.style.background = c; }
function status(msg, c) { const el = $("tl_status"); if (el) { el.textContent = msg; if (c) el.style.color = c; } }

// ─── styles marqueurs / liste ───────────────────────────────────────────────
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
    .tl-team { font-size:.72em; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-muted);
      margin:8px 0 3px; border-bottom:1px solid var(--border-glass); padding-bottom:2px; }
    .tl-op { display:flex; align-items:center; gap:6px; padding:4px 0; font-size:.82em; }
    .tl-op-dot { width:10px; height:10px; border-radius:50%; flex:0 0 auto; }
    .tl-op-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tl-op select { font-size:.92em; background:var(--bg-input); color:var(--text-main); border:1px solid var(--border-glass);
      border-radius:4px; padding:2px; max-width:88px; }
    .tl-op-follow { cursor:pointer; background:var(--bg-input); border:1px solid var(--border-glass); color:var(--text-main);
      border-radius:4px; padding:2px 7px; font-weight:700; }
    .tl-op-follow.on { background:var(--inter-blue,#4f8dff); color:#fff; border-color:var(--inter-blue,#4f8dff); }
  `;
  document.head.appendChild(s);
}

// ─── carte ──────────────────────────────────────────────────────────────────
function getMap() {
  const PM = window.PlanMap;
  if (!PM) return null;
  if (!PM.initialized) { try { PM.init(); } catch (e) { console.warn("[TchapLive]", e); } }
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
  const cands = [c.geo_uri, c.uri, c["m.location"]?.uri, c["org.matrix.msc3488.location"]?.uri,
    b.uri, b["m.location"]?.uri, b["org.matrix.msc3488.location"]?.uri];
  for (const u of cands) { const g = geoFromUri(u); if (g) return g; }
  return null;
}
function metersBetween(aLat, aLon, bLat, bLon) {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (bLat - aLat) * t, dLon = (bLon - aLon) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// ─── état (machine à couleurs) ──────────────────────────────────────────────
function computeState(m, now) {
  const b = m.beacon;
  const age = now - (m.ts || 0);                  // âge de la dernière position
  const validExpiry = b && b.expiry > b.startTs;  // timeout exploitable (>0)
  if (b && !b.live) return age > 30000 ? "lost" : "expiring";   // partage arrêté → rouge puis retrait
  if (validExpiry) {
    if (now > b.expiry) return "lost";
    if (b.expiry - now < RED_LEAD_MS) return "expiring";
  } else {
    // pas de timeout fiable → on se fie à l'âge de la dernière position reçue
    if (age > FB_LOST_MS) return "lost";
    if (age > FB_EXPIRING_MS) return "expiring";
  }
  if (now - (m.firstSeen || 0) < NEW_MS) return "new";
  if (now - (m.lastMove || 0) < MOVE_WINDOW_MS) return "moving";
  return "idle";
}
function fnIcon(fonction) { return FUNCTION_ICONS[fonction] || DEFAULT_ICON; }

function applyVisual(sender, m) {
  if (!m || !m.iconEl) return;                 // garde : jamais sur un non-marqueur
  const st = computeState(m, Date.now());
  m.state = st;                                 // 'lost' inclus ; le retrait se fait dans le balayage périodique
  const color = STATE_COLORS[st] || STATE_COLORS.expiring;
  const a = cfg.assign?.[sender] || {};
  const name = names.get(sender) || sender.replace(/^@/, "").split(":")[0];
  const tag = a.fonction && a.fonction !== "Sans" ? `[${a.fonction.toUpperCase()}] ` : "";
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
  if (!map || typeof maplibregl === "undefined") { jlog("⚠ carte indisponible (ouvre la vue Plan tactique)", "var(--civil-yellow)"); return; }
  let m = members.get(sender);
  const now = Date.now();
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
    const moved = metersBetween(m.lat, m.lng, lat, lon);
    if (moved > MOVE_MIN_M) {
      m.lastMove = now;
      m.trail.push([lon, lat]); if (m.trail.length > TRAIL_MAX) m.trail.shift();
    }
    // animation fluide depuis la position affichée vers la nouvelle
    m.anim = { fromLng: m.dispLng, fromLat: m.dispLat, toLng: lon, toLat: lat, t0: now };
    m.lng = lon; m.lat = lat; m.ts = Math.max(m.ts || 0, ts);
    if (beacons.get(sender)) m.beacon = beacons.get(sender);
  }
  applyVisual(sender, m);
  if (!centered && !followed) { centered = true; try { map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13) }); } catch (_) {} }
  if (followed === sender) { try { map.easeTo({ center: [lon, lat], duration: 700 }); } catch (_) {} }
  if (trailsOn) updateTrails();
  scheduleDeclutter();
  scheduleRenderOps();
}

function removeMember(sender) {
  const m = members.get(sender); if (!m) return;
  try { m.marker.remove(); } catch (_) {}
  members.delete(sender);
  if (followed === sender) followed = null;
  if (trailsOn) updateTrails();
  scheduleRenderOps();
}

// animation fluide (une seule boucle rAF)
function animTick() {
  const now = Date.now();
  for (const m of members.values()) {
    if (!m.anim) continue;
    const k = Math.min(1, (now - m.anim.t0) / ANIM_MS);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // easeInOutQuad
    m.dispLng = m.anim.fromLng + (m.anim.toLng - m.anim.fromLng) * e;
    m.dispLat = m.anim.fromLat + (m.anim.toLat - m.anim.fromLat) * e;
    m.marker.setLngLat([m.dispLng, m.dispLat]);
    if (k >= 1) { m.dispLng = m.anim.toLng; m.dispLat = m.anim.toLat; m.anim = null; }
  }
  requestAnimationFrame(animTick);
}
requestAnimationFrame(animTick);

// anti-chevauchement : écarte en éventail les marqueurs proches (jamais fusionnés)
let declutterTimer = null;
function scheduleDeclutter() { if (declutterTimer) return; declutterTimer = setTimeout(() => { declutterTimer = null; declutter(); }, 350); }
function declutter() {
  const map = getMap(); if (!map) return;
  const arr = [...members.values()].filter((m) => m.marker);
  const pts = arr.map((m) => ({ m, p: map.project([m.lng, m.lat]) }));
  const used = new Array(pts.length).fill(false);
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    const group = [pts[i]]; used[i] = true;
    for (let j = i + 1; j < pts.length; j++) {
      if (used[j]) continue;
      const dx = pts[i].p.x - pts[j].p.x, dy = pts[i].p.y - pts[j].p.y;
      if (Math.hypot(dx, dy) < DECLUTTER_PX) { group.push(pts[j]); used[j] = true; }
    }
    if (group.length === 1) { try { group[0].m.marker.setOffset([0, 0]); } catch (_) {} }
    else {
      const R = Math.max(DECLUTTER_PX, 9 * group.length);
      group.forEach((g, k) => { const a = (2 * Math.PI * k) / group.length; try { g.m.marker.setOffset([Math.cos(a) * R, Math.sin(a) * R]); } catch (_) {} });
    }
  }
}

// ─── trace / historique ─────────────────────────────────────────────────────
function ensureTrailLayer() {
  const map = getMap(); if (!map) return false;
  if (!map.isStyleLoaded()) { map.once("idle", () => { ensureTrailLayer(); updateTrails(); }); return false; }
  if (!map.getSource("tl-trails")) {
    map.addSource("tl-trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "tl-trails-line", type: "line", source: "tl-trails",
      layout: { "line-cap": "round", "line-join": "round", visibility: trailsOn ? "visible" : "none" },
      paint: { "line-color": ["coalesce", ["get", "color"], "#4f8dff"], "line-width": 3, "line-opacity": 0.65 } });
  }
  return true;
}
function updateTrails() {
  const map = getMap(); if (!map || !ensureTrailLayer()) return;
  const features = [];
  for (const m of members.values()) {
    if (m.trail && m.trail.length > 1) features.push({ type: "Feature", properties: { color: STATE_COLORS[m.state]?.includes("ao-green") ? "#2ecf91" : "#4f8dff" }, geometry: { type: "LineString", coordinates: m.trail } });
  }
  const src = map.getSource("tl-trails"); if (src) src.setData({ type: "FeatureCollection", features });
}
function toggleTrails() {
  trailsOn = !trailsOn;
  const fab = $("tl_btn_trail"); if (fab) { fab.classList.toggle("active", trailsOn); fab.style.background = trailsOn ? "var(--inter-blue,#4f8dff)" : ""; fab.style.color = trailsOn ? "#fff" : ""; }
  const map = getMap();
  if (map && ensureTrailLayer()) { map.setLayoutProperty("tl-trails-line", "visibility", trailsOn ? "visible" : "none"); if (trailsOn) updateTrails(); }
  jlog(trailsOn ? "trace activée" : "trace désactivée", "var(--text-muted)");
}

// ─── liste opérateurs (groupée par équipe) ──────────────────────────────────
let renderTimer = null;
function scheduleRenderOps() { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = null; renderOps(); }, 400); }
function optionTags(list, sel) {
  return `<option value=""${sel ? "" : " selected"}>—</option>` + list.map((v) => `<option value="${v}"${v === sel ? " selected" : ""}>${v}</option>`).join("");
}
function renderOps() {
  const box = $("tl_ops"); if (!box) return;
  const cnt = $("tl_count"); if (cnt) cnt.textContent = members.size ? `${members.size} opérateur(s)` : "—";
  if (!members.size) { box.innerHTML = '<div style="color:var(--text-muted);font-size:.8em;padding:6px 0;">Aucun opérateur connecté.</div>'; return; }
  const groups = new Map();
  for (const [s, m] of members) {
    const a = cfg.assign[s] || {};
    const team = a.cellule || "Non assigné";
    if (!groups.has(team)) groups.set(team, []);
    groups.get(team).push([s, m, a]);
  }
  let html = "";
  for (const [team, list] of groups) {
    html += `<div class="tl-team">${team} · ${list.length}</div>`;
    for (const [s, m, a] of list) {
      const name = names.get(s) || s.replace(/^@/, "").split(":")[0];
      const color = STATE_COLORS[m.state] || "var(--text-muted)";
      const tag = a.fonction && a.fonction !== "Sans" ? `[${a.fonction.toUpperCase()}] ` : "";
      html += `<div class="tl-op" data-s="${encodeURIComponent(s)}">
        <span class="tl-op-dot" style="background:${color}"></span>
        <span class="tl-op-name" title="${name}">${tag}${name}</span>
        <select class="tl-op-fn" title="Fonction">${optionTags(FONCTIONS, a.fonction)}</select>
        <select class="tl-op-cell" title="Équipe">${optionTags(CELLULES, a.cellule)}</select>
        <button type="button" class="tl-op-follow ${followed === s ? "on" : ""}" title="Suivre">${followed === s ? "◉" : "◎"}</button>
      </div>`;
    }
  }
  box.innerHTML = html;
}
function onOpsChange(e) {
  const row = e.target.closest(".tl-op"); if (!row) return;
  const s = decodeURIComponent(row.dataset.s);
  const a = cfg.assign[s] = cfg.assign[s] || {};
  if (e.target.classList.contains("tl-op-fn")) a.fonction = e.target.value || null;
  if (e.target.classList.contains("tl-op-cell")) a.cellule = e.target.value || null;
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  const m = members.get(s); if (m) applyVisual(s, m);
  renderOps();
}
function onOpsClick(e) {
  const btn = e.target.closest(".tl-op-follow"); if (!btn) return;
  const row = btn.closest(".tl-op"); const s = decodeURIComponent(row.dataset.s);
  followed = followed === s ? null : s;
  if (followed) { const m = members.get(followed), map = getMap(); if (m && map) map.flyTo({ center: [m.lng, m.lat], zoom: Math.max(map.getZoom(), 14) }); jlog(`suivi : ${names.get(s) || s}`, "var(--inter-blue)"); }
  else jlog("suivi désactivé", "var(--text-muted)");
  renderOps();
}

// ─── traitement /sync ─────────────────────────────────────────────────────--
function handleEvent(ev) {
  const type = ev.type, sender = ev.sender || "?", ts = ev.origin_server_ts || Date.now();
  if (type === "m.room.member" && ev.content?.displayname) { names.set(ev.state_key || sender, ev.content.displayname); return; }
  if (type === "m.room.encrypted") { status("⚠ salon chiffré : il faut un Forum non chiffré", "var(--civil-yellow)"); return; }
  if (/beacon_info/.test(type)) {
    const owner = ev.state_key || sender;
    const c = ev.content || {};
    const info = c["org.matrix.msc3672.beacon_info"] || c["m.beacon_info"] || c;
    const startTs = info["org.matrix.msc3488.ts"] || info["m.ts"] || ts;
    const timeout = info.timeout || 0;
    beacons.set(owner, { live: !!info.live, startTs, expiry: startTs + timeout });
    const m = members.get(owner);
    if (m && m.iconEl) { m.beacon = beacons.get(owner); applyVisual(owner, m); }
    return;
  }
  const g = extractLoc(type, ev.content);
  if (g) upsert(sender, g.lat, g.lon, ts);
  else if (/beacon/.test(type)) jlog(`⚠ beacon sans position lisible — clés: ${Object.keys(ev.content || {}).join(", ")}`, "var(--civil-yellow)");
}
function processSync(data, initial) {
  const room = cfg.room;
  const j = data.rooms?.join?.[room];
  if (!j) { if (initial) { status("⚠ salon introuvable dans le sync", "var(--danger-red)"); jlog(`⚠ salon ${room} absent — membre ? Room ID exact ?`, "var(--danger-red)"); } return; }
  const st = j.state?.events || [], tl = j.timeline?.events || [];
  if (initial) jlog(`salon trouvé : ${st.length} state + ${tl.length} timeline`, "var(--text-muted)");
  for (const ev of st) handleEvent(ev);
  for (const ev of tl) handleEvent(ev);
  // après le rejeu initial : retirer les positions historiques déjà périmées (sans churn)
  if (initial) { const now = Date.now(); for (const [s, m] of [...members]) if (m.marker && computeState(m, now) === "lost") removeMember(s); }
}

async function api(path) {
  const res = await fetch(cfg.hs.replace(/\/$/, "") + path, { headers: { Authorization: "Bearer " + cfg.token }, signal: aborter?.signal });
  if (!res.ok) { const b = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status} ${b.slice(0, 120)}`); }
  return res.json();
}

async function start() {
  saveCfg();
  if (!cfg.hs || !cfg.token || !cfg.room) { status("Renseigne homeserver + token + room.", "var(--danger-red)"); return; }
  cfg.connected = true; localStorage.setItem(LS_KEY, JSON.stringify(cfg)); // reprise auto au refresh
  injectStyle();
  centered = false;
  if (!getMap()) jlog("⚠ carte pas prête (ouvre la vue Plan tactique)", "var(--civil-yellow)");
  aborter = new AbortController(); running = true;
  $("tl_connect").disabled = true; $("tl_stop").disabled = false;
  setDot("var(--civil-yellow)"); status("Connexion…");
  try {
    const who = await api("/_matrix/client/v3/account/whoami");
    setDot("var(--ao-green)"); status(`Connecté : ${who.user_id}`, "var(--text-muted)"); jlog(`connecté : ${who.user_id}`, "var(--ao-green)");
    const filter = encodeURIComponent(JSON.stringify({ room: { rooms: [cfg.room], timeline: { limit: 50 }, state: { lazy_load_members: false } }, presence: { types: [] } }));
    let sync = await api(`/_matrix/client/v3/sync?timeout=0&filter=${filter}`);
    processSync(sync, true); renderOps();
    let since = sync.next_batch;
    while (running) {
      try {
        sync = await api(`/_matrix/client/v3/sync?since=${encodeURIComponent(since)}&timeout=30000&filter=${filter}`);
        processSync(sync, false); since = sync.next_batch;
        status(`À jour — ${new Date().toLocaleTimeString()} · ${members.size} opérateur(s)`, "var(--text-muted)");
      } catch (e) {
        if (!running) break;
        setDot("var(--danger-red)"); status("Erreur sync, reprise… " + e.message, "var(--civil-yellow)");
        await new Promise((r) => setTimeout(r, 3000)); setDot("var(--ao-green)");
      }
    }
  } catch (e) {
    setDot("var(--danger-red)");
    if (/401|403/.test(e.message)) { status("Token invalide/expiré — recopie-le dans Tchap.", "var(--danger-red)"); jlog("✖ 401/403 token expiré", "var(--danger-red)"); }
    else if (/Failed to fetch|CORS|NetworkError/i.test(e.message)) { status("Réseau/CORS — vérifie le homeserver.", "var(--danger-red)"); jlog("✖ réseau/CORS", "var(--danger-red)"); }
    else { status("Échec : " + e.message, "var(--danger-red)"); jlog("✖ " + e.message, "var(--danger-red)"); }
    stop();
  }
}

function stop(userInitiated) {
  running = false; if (aborter) aborter.abort();
  $("tl_connect").disabled = false; $("tl_stop").disabled = true;
  setDot("var(--text-muted)"); status("Arrêté.", "var(--text-muted)");
  if (userInitiated) { cfg.connected = false; localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } // arrêt explicite → pas de reprise auto
}

// recalcul périodique des états (gris/rouge/retrait selon le beacon) + déclic carte
setInterval(() => {
  const now = Date.now();
  for (const [s, m] of [...members]) {
    if (!m.marker) continue;
    if (computeState(m, now) === "lost") removeMember(s);
    else applyVisual(s, m);
  }
  scheduleRenderOps();
}, 5000);

// ─── câblage UI ───────────────────────────────────────────────────────────--
async function loadLists() {
  try {
    const r = await fetch("members_config.json", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.options?.fonctions)) FONCTIONS = j.options.fonctions; if (Array.isArray(j.options?.cellules)) CELLULES = j.options.cellules; }
  } catch (_) {}
}
function wireUI() {
  if (!$("tl_toggle")) return;
  if ($("tl_hs")) $("tl_hs").value = cfg.hs || DEFAULT_HS;
  if ($("tl_token")) $("tl_token").value = cfg.token || "";
  if ($("tl_room")) $("tl_room").value = cfg.room || "";
  $("tl_toggle").addEventListener("click", () => { const p = $("tl_panel"); p.style.display = p.style.display === "none" ? "block" : "none"; });
  $("tl_connect").addEventListener("click", start);
  $("tl_stop").addEventListener("click", () => stop(true));
  const cen = $("tl_center"); if (cen) cen.addEventListener("click", () => { const map = getMap(); if (!map || !members.size) return; if (members.size === 1) { const m = [...members.values()][0]; map.flyTo({ center: [m.lng, m.lat], zoom: 14 }); } else { const b = new maplibregl.LngLatBounds(); for (const m of members.values()) b.extend([m.lng, m.lat]); map.fitBounds(b, { padding: 80, maxZoom: 15 }); } });
  const fab = $("tl_btn_trail"); if (fab) fab.addEventListener("click", toggleTrails);
  for (const id of ["tl_hs", "tl_token", "tl_room"]) { const el = $(id); if (el) el.addEventListener("change", saveCfg); }
  const ops = $("tl_ops"); if (ops) { ops.addEventListener("change", onOpsChange); ops.addEventListener("click", onOpsClick); }
  const map = getMap(); if (map) { map.on("moveend", scheduleDeclutter); map.on("zoomend", scheduleDeclutter); map.on("styledata", () => { if (trailsOn) { ensureTrailLayer(); updateTrails(); } }); }
  loadLists().then(renderOps);
  renderOps();
  // reprise automatique après un simple rafraîchissement (sauf si arrêt explicite via Stop)
  if (cfg.connected && cfg.hs && cfg.token && cfg.room) { jlog("reprise auto après rafraîchissement…", "var(--text-muted)"); start(); }
}

export const TchapLive = { start, stop, wireUI, toggleTrails };

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireUI);
else wireUI();
