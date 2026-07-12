/*
 * tuto-engine.js — Moteur de tutoriel interactif autonome (aucune dépendance).
 *
 * Utilisation :
 *   <script src="modules/tuto-engine.js"></script>
 *   <script>
 *     PocheTuto.mount({
 *       appId: 'oi',              // espace de stockage (localStorage)
 *       appName: 'OI - ADI',      // affiché dans l'en-tête
 *       accent: '#4f8dff',        // couleur d'accent (assortie à la page)
 *       buttonLabel: 'Tuto',      // libellé du bouton flottant
 *       data: { intro:{title,text}, chapters:[ {id,icon,title,summary,steps:[…]} ] }
 *     });
 *   </script>
 *
 * Un « step » : { title, body, terms:[…verbatim], selector:'#id'|null, tip:string|null }
 * Le champ `body` accepte un mini-markdown : **gras**.
 * Le champ `selector` (facultatif) permet de surligner l'élément réel sur la page.
 */
(function () {
  'use strict';
  if (window.PocheTuto) return; // idempotent

  var CSS_ID = 'ptuto-styles';
  var Z = 2147483000; // au-dessus des cartes, dialogs et FABs

  /* ---------------------------------------------------------------- utils */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // Mini-markdown : **gras** (le texte est d'abord échappé).
  function mdBold(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }
  function isVisible(node) {
    if (!node) return false;
    if (node.offsetParent === null &&
        getComputedStyle(node).position !== 'fixed') return false;
    var r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* -------------------------------------------------------------- styles  */
  function injectStyles(accent) {
    if (document.getElementById(CSS_ID)) {
      document.getElementById(CSS_ID).style.setProperty('--ptuto-accent', accent);
      return;
    }
    var css = `
:root{ --ptuto-accent:${accent}; }
.ptuto-overlay, .ptuto-overlay *{ box-sizing:border-box; }
.ptuto-fab{
  position:fixed; right:18px; bottom:18px; z-index:${Z - 2};
  display:inline-flex; align-items:center; gap:8px;
  padding:10px 16px 10px 12px; border:none; border-radius:9999px;
  background:linear-gradient(135deg,var(--ptuto-accent),#7c6ce0);
  color:#fff; font:600 14px/1 'Inter',system-ui,sans-serif; letter-spacing:.2px;
  cursor:pointer; box-shadow:0 6px 22px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.08) inset;
  transition:transform .15s ease, box-shadow .15s ease, filter .15s ease;
}
.ptuto-fab:hover{ transform:translateY(-2px); filter:brightness(1.06);
  box-shadow:0 10px 28px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.14) inset; }
.ptuto-fab .material-symbols-outlined{ font-size:20px; }
.ptuto-fab.ptuto-pulse{ animation:ptuto-pulse 2.4s ease-in-out 3; }
@keyframes ptuto-pulse{
  0%,100%{ box-shadow:0 6px 22px rgba(0,0,0,.45), 0 0 0 0 var(--ptuto-accent); }
  50%{ box-shadow:0 6px 22px rgba(0,0,0,.45), 0 0 0 10px transparent; }
}

.ptuto-overlay{
  position:fixed; inset:0; z-index:${Z};
  display:flex; align-items:center; justify-content:center;
  background:rgba(6,6,9,.62);
  -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px);
  font-family:'Inter',system-ui,sans-serif;
  opacity:0; transition:opacity .18s ease;
}
.ptuto-overlay.ptuto-show{ opacity:1; }
.ptuto-panel{
  width:min(1080px,94vw); height:min(760px,92vh);
  display:flex; flex-direction:column; overflow:hidden;
  background:#141416; color:#f6f6f7;
  border:1px solid rgba(255,255,255,.10); border-radius:18px;
  box-shadow:0 30px 90px rgba(0,0,0,.6);
  transform:translateY(10px) scale(.99); transition:transform .18s ease;
}
.ptuto-overlay.ptuto-show .ptuto-panel{ transform:none; }

.ptuto-head{
  display:flex; align-items:center; gap:12px; flex:0 0 auto;
  padding:14px 16px 12px; border-bottom:1px solid rgba(255,255,255,.06);
  background:linear-gradient(180deg,rgba(255,255,255,.03),transparent);
}
.ptuto-head .ptuto-badge{
  width:36px; height:36px; border-radius:10px; flex:0 0 auto;
  display:grid; place-items:center; color:#fff;
  background:linear-gradient(135deg,var(--ptuto-accent),#7c6ce0);
}
.ptuto-head .ptuto-htxt{ min-width:0; flex:1; }
.ptuto-head h2{ margin:0; font:700 15px/1.2 'Inter',sans-serif;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ptuto-head .ptuto-sub{ margin:2px 0 0; font-size:12px; color:#8a8a91;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ptuto-x{ flex:0 0 auto; background:none; border:none; color:#b6b6bc; cursor:pointer;
  border-radius:8px; width:40px; height:40px; display:grid; place-items:center; }
.ptuto-x:hover{ background:rgba(255,255,255,.08); color:#fff; }

/* barre d'outils : bouton Sommaire (mobile) + recherche unique */
.ptuto-tools{
  display:flex; align-items:center; gap:10px; flex:0 0 auto;
  padding:10px 16px; border-bottom:1px solid rgba(255,255,255,.08);
  background:linear-gradient(180deg,rgba(255,255,255,.02),transparent); }
.ptuto-menu-btn{
  display:none; align-items:center; gap:6px; flex:0 0 auto; cursor:pointer;
  padding:9px 13px; border-radius:10px; font:600 13px/1 'Inter',sans-serif;
  border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.05); color:#f6f6f7; }
.ptuto-menu-btn:hover{ background:rgba(255,255,255,.10); }
.ptuto-menu-btn .material-symbols-outlined{ font-size:19px; }
.ptuto-search{
  flex:1; min-width:0; min-height:44px; display:flex; align-items:center; gap:6px;
  background:rgba(0,0,0,.32); border:1px solid rgba(255,255,255,.08);
  border-radius:10px; padding:0 8px 0 12px; transition:border-color .15s ease, box-shadow .15s ease; }
.ptuto-search:focus-within{ border-color:var(--ptuto-accent);
  box-shadow:0 0 0 3px rgba(79,141,255,.18); }
.ptuto-search > .material-symbols-outlined{ font-size:19px; color:#8a8a91; flex:0 0 auto; }
.ptuto-search input{ flex:1; min-width:0; background:none; border:none; outline:none;
  color:#f6f6f7; font:400 16px/1 'Inter',sans-serif; } /* 16px : évite l'auto-zoom iOS au focus */
.ptuto-search input::placeholder{ color:#6f6f78; }
.ptuto-search-clear{ display:none; flex:0 0 auto; width:36px; align-self:stretch; padding:0;
  background:none; border:none; color:#8a8a91; cursor:pointer; border-radius:8px;
  align-items:center; justify-content:center; }
.ptuto-search-clear:hover{ color:#fff; background:rgba(255,255,255,.08); }
.ptuto-search-clear .material-symbols-outlined{ font-size:18px; display:block; }
.ptuto-search.has-text .ptuto-search-clear{ display:inline-flex; }

.ptuto-body{ flex:1; position:relative; display:grid; grid-template-columns:260px 1fr; min-height:0; }
.ptuto-toc{ border-right:1px solid rgba(255,255,255,.08); overflow:auto;
  overscroll-behavior:contain; padding:10px; background:#141416; -webkit-overflow-scrolling:touch; }
.ptuto-toc-scrim{ display:none; }
.ptuto-toc-item{
  display:flex; align-items:center; gap:10px; width:100%;
  padding:10px; border-radius:10px; border:none; background:none; cursor:pointer;
  color:#b6b6bc; text-align:left; font:500 13px/1.3 'Inter',sans-serif; }
.ptuto-toc-item:hover{ background:rgba(255,255,255,.05); color:#f6f6f7; }
.ptuto-toc-item.ptuto-active{ background:rgba(79,141,255,.14); color:#fff;
  box-shadow:inset 2px 0 0 var(--ptuto-accent); }
.ptuto-toc-item .material-symbols-outlined{ font-size:20px; color:var(--ptuto-accent); flex:0 0 auto; }
.ptuto-toc-title{ flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ptuto-toc-item .ptuto-toc-meta{ flex:0 0 auto; min-width:20px; text-align:right;
  font-size:11px; color:#8a8a91; }
.ptuto-toc-item .ptuto-done{ color:#2ecf91; font-size:16px; }

.ptuto-main{ overflow:auto; overscroll-behavior:contain; overflow-wrap:anywhere;
  padding:22px 26px; display:flex; flex-direction:column; }
.ptuto-chap-head{ display:flex; align-items:center; gap:12px; margin-bottom:4px; }
.ptuto-chap-head .material-symbols-outlined{ font-size:26px; color:var(--ptuto-accent); }
.ptuto-chap-head h3{ margin:0; font:700 18px/1.2 'Inter',sans-serif; }
.ptuto-chap-summary{ margin:0 0 18px; color:#8a8a91; font-size:13px; }

.ptuto-step-kicker{ font:600 11px/1 'Inter',sans-serif; letter-spacing:.8px;
  text-transform:uppercase; color:var(--ptuto-accent); margin-bottom:8px; }
.ptuto-step-title{ margin:0 0 12px; font:700 22px/1.25 'Inter',sans-serif; }
.ptuto-step-body{ margin:0 0 16px; font-size:15px; line-height:1.6; color:#dcdce0; }
.ptuto-step-body strong{ color:#fff; }

/* item du Tuto intégré dans le dock : hérite du style .dock-menu-item de la page ;
   on ajoute seulement un pulse d'invitation à la première visite. */
.ptuto-dock{ cursor:pointer; }
.ptuto-dock.ptuto-pulse{ animation:ptuto-dock-pulse 2.2s ease-in-out 3; }
@keyframes ptuto-dock-pulse{
  0%,100%{ box-shadow:0 0 0 0 var(--ptuto-accent); }
  50%{ box-shadow:0 0 0 7px transparent; } }

.ptuto-tip{
  display:flex; gap:10px; align-items:flex-start; margin:0 0 16px;
  padding:12px 14px; border-radius:12px;
  background:rgba(240,181,62,.08); border:1px solid rgba(240,181,62,.28); }
.ptuto-tip .material-symbols-outlined{ color:#f0b53e; font-size:20px; flex:0 0 auto; }
.ptuto-tip p{ margin:0; font-size:13.5px; line-height:1.55; color:#e7d9b8; }

.ptuto-spotbtn{
  align-self:flex-start; display:inline-flex; align-items:center; gap:7px;
  margin-top:2px; padding:9px 15px; border-radius:10px; cursor:pointer;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.16);
  color:#f6f6f7; font:600 13px/1 'Inter',sans-serif; }
.ptuto-spotbtn:hover{ background:rgba(79,141,255,.16); border-color:var(--ptuto-accent); }
.ptuto-spotbtn .material-symbols-outlined{ font-size:18px; color:var(--ptuto-accent); }
.ptuto-note{ margin-top:6px; font-size:12.5px; color:#f0b53e; }

.ptuto-foot{
  display:flex; flex-direction:column; gap:11px; flex:0 0 auto;
  padding:12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  border-top:1px solid rgba(255,255,255,.08);
  background:linear-gradient(0deg,rgba(255,255,255,.03),transparent); }
.ptuto-progress{ width:100%; height:6px; border-radius:9999px; background:rgba(255,255,255,.08); overflow:hidden; }
.ptuto-progress > i{ display:block; height:100%; width:0;
  background:linear-gradient(90deg,var(--ptuto-accent),#7c6ce0); transition:width .25s ease; }
.ptuto-foot-row{ display:flex; align-items:center; gap:12px; }
.ptuto-count{ flex:0 0 auto; font:600 12px/1 'JetBrains Mono',monospace; color:#8a8a91; }
.ptuto-nav{ display:flex; gap:8px; margin-left:auto; }
.ptuto-nav button{
  display:inline-flex; align-items:center; justify-content:center; gap:5px; cursor:pointer;
  padding:10px 16px; border-radius:10px; font:600 13px/1 'Inter',sans-serif;
  border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.05); color:#f6f6f7; }
.ptuto-nav button:hover{ background:rgba(255,255,255,.10); }
.ptuto-nav button.ptuto-primary{ background:var(--ptuto-accent); border-color:var(--ptuto-accent); color:#fff; }
.ptuto-nav button.ptuto-primary:hover{ filter:brightness(1.08); }
.ptuto-nav button:disabled{ opacity:.4; cursor:default; }
.ptuto-nav button .material-symbols-outlined{ font-size:18px; }

/* focus clavier cohérent sur tous les contrôles interactifs */
.ptuto-toc-item:focus-visible, .ptuto-nav button:focus-visible, .ptuto-x:focus-visible,
.ptuto-menu-btn:focus-visible, .ptuto-search-clear:focus-visible, .ptuto-result:focus-visible,
.ptuto-spotbtn:focus-visible, .ptuto-spot-callout button:focus-visible{
  outline:2px solid var(--ptuto-accent); outline-offset:2px; }
.ptuto-panel:focus{ outline:none; }

/* résultats de recherche */
.ptuto-results{ padding:6px; }
.ptuto-result{ display:block; width:100%; text-align:left; cursor:pointer;
  padding:10px 12px; border-radius:10px; border:none; background:none; color:#dcdce0; }
.ptuto-result:hover{ background:rgba(255,255,255,.06); }
.ptuto-result b{ color:#fff; }
.ptuto-result small{ display:block; color:#8a8a91; font-size:11.5px; margin-top:2px; }
.ptuto-empty{ padding:30px; text-align:center; color:#8a8a91; font-size:13px; }

/* spotlight sur la page */
.ptuto-spot-target{
  position:relative; z-index:${Z + 1} !important;
  outline:3px solid var(--ptuto-accent) !important; outline-offset:3px;
  border-radius:8px; animation:ptuto-ring 1.3s ease-in-out infinite; }
@keyframes ptuto-ring{ 0%,100%{ box-shadow:0 0 0 0 rgba(79,141,255,.55);}
  50%{ box-shadow:0 0 0 8px rgba(79,141,255,0);} }
.ptuto-spot-scrim{ position:fixed; inset:0; z-index:${Z}; background:rgba(6,6,9,.55); }
.ptuto-spot-callout{
  position:fixed; z-index:${Z + 2}; max-width:320px;
  background:#141416; color:#f6f6f7; border:1px solid var(--ptuto-accent);
  border-radius:12px; padding:12px 14px; box-shadow:0 16px 44px rgba(0,0,0,.6);
  font-family:'Inter',system-ui,sans-serif; }
.ptuto-spot-callout .ptuto-sc-k{ font:600 10px/1 'Inter'; letter-spacing:.7px;
  text-transform:uppercase; color:var(--ptuto-accent); }
.ptuto-spot-callout h4{ margin:5px 0 6px; font:700 15px/1.2 'Inter'; }
.ptuto-spot-callout p{ margin:0 0 10px; font-size:12.5px; line-height:1.5; color:#c3c3ca; }
.ptuto-spot-callout button{ cursor:pointer; padding:8px 13px; border-radius:9px;
  border:none; background:var(--ptuto-accent); color:#fff; font:600 12.5px/1 'Inter'; }

/* ---- Mobile / tablette étroite : plein écran, sommaire en tiroir coulissant ---- */
@media (max-width:720px){
  .ptuto-overlay{ align-items:stretch; }
  .ptuto-panel{ width:100%; height:100%; max-height:none; border:none; border-radius:0;
    padding-left:env(safe-area-inset-left, 0px); padding-right:env(safe-area-inset-right, 0px); }
  .ptuto-head{ padding:calc(12px + env(safe-area-inset-top, 0px)) 14px 10px; }
  .ptuto-tools{ padding:10px 14px; }
  .ptuto-menu-btn{ display:inline-flex; }
  .ptuto-x{ width:44px; height:44px; }
  .ptuto-body{ grid-template-columns:1fr; }
  .ptuto-main{ padding:18px 16px; }
  .ptuto-toc{
    position:absolute; z-index:5; top:0; left:0; bottom:0; width:min(300px,84%);
    transform:translateX(-100%); transition:transform .22s ease;
    box-shadow:24px 0 60px rgba(0,0,0,.55); }
  .ptuto-panel.toc-open .ptuto-toc{ transform:none; }
  .ptuto-panel.toc-open .ptuto-toc-scrim{ display:block; position:absolute; inset:0;
    z-index:4; background:rgba(0,0,0,.5); }
  /* tiroir réellement modal : en-tête et pied inertes tant qu'il est ouvert */
  .ptuto-panel.toc-open .ptuto-head,
  .ptuto-panel.toc-open .ptuto-foot{ pointer-events:none; }
  .ptuto-prev .ptuto-btn-label{ display:none; }
  .ptuto-nav button{ padding:11px 14px; }
  .ptuto-step-title{ font-size:19px; }
  .ptuto-step-body{ font-size:14.5px; }
}
@media (max-width:380px){
  .ptuto-count{ font-size:11px; }
  .ptuto-nav button{ padding:10px 12px; }
}
`;
    var st = el('style'); st.id = CSS_ID; st.textContent = css;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------- instance */
  function Tuto(cfg) {
    this.cfg = cfg;
    this.data = cfg.data || { intro: {}, chapters: [] };
    this.chapters = this.data.chapters || [];
    // liste plate de tous les steps -> { ci, si, step, chapter, gi }
    this.flat = [];
    for (var c = 0; c < this.chapters.length; c++) {
      var steps = this.chapters[c].steps || [];
      for (var s = 0; s < steps.length; s++) {
        this.flat.push({ ci: c, si: s, step: steps[s], chapter: this.chapters[c], gi: this.flat.length });
      }
    }
    this.storeKey = 'ptuto_' + (cfg.appId || 'app');
    this.pos = 0;               // index global du step courant
    this.viewed = this.loadViewed();
    this.overlay = null;
    this.searching = false;
    this.spot = null;
    this.onKey = this.onKey.bind(this);
  }

  Tuto.prototype.loadViewed = function () {
    try { return new Set(JSON.parse(localStorage.getItem(this.storeKey + '_seen') || '[]')); }
    catch (e) { return new Set(); }
  };
  Tuto.prototype.saveState = function () {
    try {
      localStorage.setItem(this.storeKey + '_seen', JSON.stringify(Array.from(this.viewed)));
      localStorage.setItem(this.storeKey + '_pos', String(this.pos));
    } catch (e) {}
  };

  /* --------- point d'entrée : item du dock (défaut) ou FAB flottant (repli) --------- */
  Tuto.prototype.mountButton = function () {
    var self = this;
    var d = this.cfg.dock;
    var dockEl = (d && d.selector) ? document.querySelector(d.selector) : null;
    var trigger;

    if (dockEl) {
      // s'intègre nativement dans le dock flottant existant de la page
      var item = el(d.itemTag || 'div', ((d.itemClass || '') + ' ptuto-dock').trim(),
        '<span class="material-symbols-outlined">' + esc(d.icon || 'menu_book') + '</span>');
      item.id = 'ptutoDockBtn';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.title = d.title || ('Tutoriel interactif — ' + (this.cfg.appName || ''));
      item.setAttribute('aria-label', 'Ouvrir le tutoriel');
      item.addEventListener('click', function () { self.open(); });
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.open(); }
      });
      var anchor = d.insertAfter ? dockEl.querySelector(d.insertAfter) : null;
      if (anchor) dockEl.insertBefore(item, anchor.nextSibling);
      else dockEl.appendChild(item);
      trigger = item;
    } else {
      // repli : bouton flottant autonome si la page n'a pas de dock
      var btn = el('button', 'ptuto-fab',
        '<span class="material-symbols-outlined">menu_book</span><span>' +
        esc(this.cfg.buttonLabel || 'Tuto') + '</span>');
      btn.type = 'button';
      btn.title = 'Tutoriel interactif — ' + esc(this.cfg.appName || '');
      btn.setAttribute('aria-label', 'Ouvrir le tutoriel');
      btn.addEventListener('click', function () { self.open(); });
      document.body.appendChild(btn);
      trigger = btn;
    }

    // pulse d'invitation à la première visite uniquement
    try {
      if (!localStorage.getItem(this.storeKey + '_greeted')) {
        trigger.classList.add('ptuto-pulse');
        localStorage.setItem(this.storeKey + '_greeted', '1');
      }
    } catch (e) {}
    this.fab = trigger;
  };

  /* --------- ouverture / fermeture --------- */
  Tuto.prototype.open = function (gi) {
    this._opener = document.activeElement; // pour restituer le focus à la fermeture
    if (typeof gi === 'number') this.pos = gi;
    else {
      // reprendre où on en était
      var saved = parseInt(localStorage.getItem(this.storeKey + '_pos') || '0', 10);
      this.pos = (saved >= 0 && saved < this.flat.length) ? saved : 0;
    }
    if (!this.overlay) this.build();
    this.overlay.style.display = 'flex';
    // reflow puis show
    void this.overlay.offsetWidth;
    this.overlay.classList.add('ptuto-show');
    this.searching = false;
    if (this.searchInput) this.searchInput.value = '';
    if (this.searchWrap) this.searchWrap.classList.remove('has-text');
    this.closeToc();
    this.render();
    document.addEventListener('keydown', this.onKey);
    if (this.fab) this.fab.classList.remove('ptuto-pulse');
    if (this.panel && this.panel.focus) { try { this.panel.focus(); } catch (e) {} }
  };
  Tuto.prototype.close = function () {
    if (!this.overlay) return;
    this.overlay.classList.remove('ptuto-show');
    var ov = this.overlay;
    setTimeout(function () { ov.style.display = 'none'; }, 180);
    document.removeEventListener('keydown', this.onKey);
    this.closeToc();
    this.saveState();
    if (this._opener && this._opener.focus) { try { this._opener.focus(); } catch (e) {} }
  };

  Tuto.prototype.onKey = function (e) {
    if (this.spot) { // en mode spotlight : Esc reprend
      if (e.key === 'Escape') { e.preventDefault(); this.endSpot(true); }
      return;
    }
    if (e.key === 'Tab') { this.trapFocus(e); return; } // piège le focus dans le dialog
    var typing = document.activeElement === this.searchInput;

    if (this.panel && this.panel.classList.contains('toc-open')) { // tiroir ouvert : Esc le ferme
      if (e.key === 'Escape') { e.preventDefault(); this.closeToc(); return; }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing && this.searchInput.value) { // 1er Esc : vider la recherche, 2e : fermer
        this.searchInput.value = ''; this.onSearch(''); this.searchInput.focus();
      } else { this.close(); }
      return;
    }
    if (typing) return; // ne pas détourner ←/→/Home/End/'/' pendant l'édition du champ

    if (e.key === 'ArrowRight') { e.preventDefault(); this.go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(-1); }
    else if (e.key === 'Home') { e.preventDefault(); this.jump(0); }
    else if (e.key === 'End') { e.preventDefault(); this.jump(this.flat.length - 1); }
    else if (e.key === '/') { e.preventDefault(); this.searchInput.focus(); }
  };
  Tuto.prototype.trapFocus = function (e) {
    if (!this.panel) return;
    var sel = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    var nodes = Array.prototype.slice.call(this.panel.querySelectorAll(sel))
      .filter(function (n) { return n.offsetParent !== null; });
    if (!nodes.length) { e.preventDefault(); this.panel.focus(); return; }
    var first = nodes[0], last = nodes[nodes.length - 1], act = document.activeElement;
    if (e.shiftKey && (act === first || !this.panel.contains(act))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (act === last || !this.panel.contains(act))) { e.preventDefault(); first.focus(); }
  };

  /* --------- construction du DOM --------- */
  Tuto.prototype.build = function () {
    var self = this;
    var ov = el('div', 'ptuto-overlay');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Tutoriel — ' + (this.cfg.appName || ''));
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) self.close(); });

    var panel = el('div', 'ptuto-panel');
    panel.setAttribute('tabindex', '-1');
    this.panel = panel;

    /* --- en-tête : badge + titre + fermer --- */
    var head = el('div', 'ptuto-head');
    head.appendChild(el('div', 'ptuto-badge', '<span class="material-symbols-outlined">school</span>'));
    var htxt = el('div', 'ptuto-htxt');
    htxt.appendChild(el('h2', null, 'Tutoriel — ' + esc(this.cfg.appName || '')));
    htxt.appendChild(el('p', 'ptuto-sub', esc((this.data.intro && this.data.intro.title) || 'Guide interactif')));
    head.appendChild(htxt);
    var x = el('button', 'ptuto-x', '<span class="material-symbols-outlined">close</span>');
    x.type = 'button'; x.title = 'Fermer'; x.setAttribute('aria-label', 'Fermer le tutoriel');
    x.addEventListener('click', function () { self.close(); });
    head.appendChild(x);
    panel.appendChild(head);

    /* --- barre d'outils : Sommaire (mobile) + recherche unique --- */
    var tools = el('div', 'ptuto-tools');
    var menuBtn = el('button', 'ptuto-menu-btn',
      '<span class="material-symbols-outlined">menu</span>Sommaire');
    menuBtn.type = 'button'; menuBtn.setAttribute('aria-label', 'Ouvrir le sommaire');
    menuBtn.addEventListener('click', function () { self.openToc(); });
    tools.appendChild(menuBtn);

    var search = el('div', 'ptuto-search',
      '<span class="material-symbols-outlined">search</span>');
    var input = el('input');
    input.type = 'text';                 // 'text' (pas 'search') : évite la déco native en doublon
    input.placeholder = 'Rechercher une fonction…';
    input.setAttribute('aria-label', 'Rechercher dans le tutoriel');
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', function () { self.onSearch(input.value); });
    search.appendChild(input);
    var clr = el('button', 'ptuto-search-clear', '<span class="material-symbols-outlined">close</span>');
    clr.type = 'button'; clr.title = 'Effacer'; clr.setAttribute('aria-label', 'Effacer la recherche');
    clr.addEventListener('click', function () { input.value = ''; input.focus(); self.onSearch(''); });
    search.appendChild(clr);
    tools.appendChild(search);
    this.searchInput = input;
    this.searchWrap = search;
    panel.appendChild(tools);

    /* --- corps : sommaire (sidebar desktop / tiroir mobile) + scrim + contenu --- */
    var body = el('div', 'ptuto-body');
    this.body = body;
    this.toc = el('nav', 'ptuto-toc');
    this.toc.setAttribute('aria-label', 'Sommaire du tutoriel');
    var scrim = el('div', 'ptuto-toc-scrim');
    scrim.addEventListener('click', function () { self.closeToc(); });
    this.main = el('div', 'ptuto-main');
    body.appendChild(this.toc);
    body.appendChild(scrim);
    body.appendChild(this.main);
    panel.appendChild(body);

    /* --- pied : progression pleine largeur, puis compteur | navigation --- */
    var foot = el('div', 'ptuto-foot');
    var prog = el('div', 'ptuto-progress'); this.progBar = el('i'); prog.appendChild(this.progBar);
    prog.setAttribute('role', 'progressbar');
    prog.setAttribute('aria-valuemin', '0'); prog.setAttribute('aria-valuemax', '100');
    prog.setAttribute('aria-label', 'Progression du tutoriel');
    this.prog = prog;
    var frow = el('div', 'ptuto-foot-row');
    this.count = el('div', 'ptuto-count');
    var nav = el('div', 'ptuto-nav');
    this.prevBtn = el('button', 'ptuto-prev',
      '<span class="material-symbols-outlined">chevron_left</span><span class="ptuto-btn-label">Précédent</span>');
    this.prevBtn.type = 'button'; this.prevBtn.setAttribute('aria-label', 'Étape précédente');
    this.prevBtn.addEventListener('click', function () { self.go(-1); });
    this.nextBtn = el('button', 'ptuto-primary', '');
    this.nextBtn.type = 'button';
    this.nextBtn.addEventListener('click', function () { self.go(1); });
    nav.appendChild(this.prevBtn); nav.appendChild(this.nextBtn);
    frow.appendChild(this.count); frow.appendChild(nav);
    foot.appendChild(prog); foot.appendChild(frow);
    panel.appendChild(foot);
    this.foot = foot;

    ov.appendChild(panel);
    document.body.appendChild(ov);
    this.overlay = ov;
    this.buildToc();
  };

  Tuto.prototype.openToc = function () { if (this.panel) this.panel.classList.add('toc-open'); };
  Tuto.prototype.closeToc = function () { if (this.panel) this.panel.classList.remove('toc-open'); };

  Tuto.prototype.buildToc = function () {
    var self = this;
    this.toc.innerHTML = '';
    // entrée "Introduction" pointant sur le premier step
    this.chapters.forEach(function (ch, ci) {
      var b = el('button', 'ptuto-toc-item');
      b.type = 'button';
      b.dataset.ci = ci;
      var n = (ch.steps || []).length;
      b.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">' + esc(ch.icon || 'chevron_right') +
        '</span><span class="ptuto-toc-title">' + esc(ch.title) + '</span>' +
        '<span class="ptuto-toc-meta">' + n + '</span>';
      b.addEventListener('click', function () {
        var gi = self.flat.findIndex(function (f) { return f.ci === ci; });
        if (gi >= 0) {
          self.searching = false; self.searchInput.value = '';
          if (self.searchWrap) self.searchWrap.classList.remove('has-text');
          self.jump(gi); self.closeToc();
        }
      });
      self.toc.appendChild(b);
    });
  };

  /* --------- navigation --------- */
  Tuto.prototype.go = function (d) {
    var np = this.pos + d;
    if (np < 0) np = 0;
    if (np >= this.flat.length) { this.close(); return; }
    this.jump(np);
  };
  Tuto.prototype.jump = function (gi) {
    this.pos = Math.max(0, Math.min(this.flat.length - 1, gi));
    this.searching = false;
    this.render();
  };

  /* --------- rendu du step courant --------- */
  Tuto.prototype.render = function () {
    if (this.searching) return; // la recherche gère son propre affichage
    var self = this;
    var f = this.flat[this.pos];
    if (!f) return;
    this.viewed.add(f.chapter.id + ':' + f.si);
    this.saveState();

    // TOC actif + coche
    Array.prototype.forEach.call(this.toc.children, function (b) {
      var ci = parseInt(b.dataset.ci, 10);
      b.classList.toggle('ptuto-active', ci === f.ci);
      var ch = self.chapters[ci];
      var allSeen = (ch.steps || []).every(function (_, si) { return self.viewed.has(ch.id + ':' + si); });
      var meta = b.querySelector('.ptuto-toc-meta');
      if (meta) meta.innerHTML = allSeen
        ? '<span class="material-symbols-outlined ptuto-done">check</span>'
        : (ch.steps || []).length;
    });
    // s'assurer que le chapitre actif est visible dans le TOC
    var active = this.toc.querySelector('.ptuto-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });

    // panneau principal
    var step = f.step;
    var m = el('div');
    var chead = el('div', 'ptuto-chap-head',
      '<span class="material-symbols-outlined">' + esc(f.chapter.icon || 'article') + '</span>' +
      '<h3>' + esc(f.chapter.title) + '</h3>');
    m.appendChild(chead);
    if (f.chapter.summary) m.appendChild(el('p', 'ptuto-chap-summary', esc(f.chapter.summary)));

    m.appendChild(el('div', 'ptuto-step-kicker',
      'Étape ' + (f.si + 1) + ' / ' + (f.chapter.steps || []).length));
    m.appendChild(el('h2', 'ptuto-step-title', esc(step.title)));
    m.appendChild(el('p', 'ptuto-step-body', mdBold(step.body)));

    // NB : step.terms n'est plus affiché (repère de cohérence interne) ;
    // il reste indexé par la recherche.
    if (step.tip) {
      m.appendChild(el('div', 'ptuto-tip',
        '<span class="material-symbols-outlined">lightbulb</span><p>' + mdBold(step.tip) + '</p>'));
    }
    if (step.selector) {
      var target = document.querySelector(step.selector);
      if (target) {
        var sb = el('button', 'ptuto-spotbtn',
          '<span class="material-symbols-outlined" aria-hidden="true">my_location</span>Montrer sur la page');
        sb.type = 'button';
        sb.addEventListener('click', function () { self.startSpot(step, target); });
        m.appendChild(sb);
      }
    }
    this.main.innerHTML = '';
    this.main.appendChild(m);
    this.main.scrollTop = 0;

    // pied
    var pct = Math.round(((this.pos + 1) / this.flat.length) * 100);
    this.progBar.style.width = pct + '%';
    if (this.prog) this.prog.setAttribute('aria-valuenow', String(pct));
    this.count.textContent = (this.pos + 1) + ' / ' + this.flat.length;
    this.prevBtn.disabled = this.pos === 0;
    var last = this.pos === this.flat.length - 1;
    this.nextBtn.innerHTML = last
      ? 'Terminer<span class="material-symbols-outlined" aria-hidden="true">check</span>'
      : 'Suivant<span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>';
    this.nextBtn.setAttribute('aria-label', last ? 'Terminer le tutoriel' : 'Étape suivante');
  };

  /* --------- recherche --------- */
  Tuto.prototype.onSearch = function (q) {
    var raw = q || '';
    if (this.searchWrap) this.searchWrap.classList.toggle('has-text', raw.length > 0);
    q = raw.trim().toLowerCase();
    if (!q) { this.searching = false; this.render(); return; }
    this.searching = true;
    var self = this;
    var hits = this.flat.filter(function (f) {
      var hay = (f.step.title + ' ' + f.step.body + ' ' + (f.step.terms || []).join(' ') +
        ' ' + f.chapter.title).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    this.main.innerHTML = '';
    if (!hits.length) {
      this.main.appendChild(el('div', 'ptuto-empty', 'Aucun résultat pour « ' + esc(q) + ' ».'));
      return;
    }
    var box = el('div', 'ptuto-results');
    hits.forEach(function (f) {
      var r = el('button', 'ptuto-result',
        '<b>' + esc(f.step.title) + '</b><small>' + esc(f.chapter.title) + '</small>');
      r.type = 'button';
      r.addEventListener('click', function () {
        self.searchInput.value = '';
        if (self.searchWrap) self.searchWrap.classList.remove('has-text');
        self.jump(f.gi);
      });
      box.appendChild(r);
    });
    this.main.appendChild(box);
    // le TOC reste, pied masqué visuellement inutile -> on garde
  };

  /* --------- spotlight sur la page réelle --------- */
  Tuto.prototype.startSpot = function (step, target) {
    if (!isVisible(target)) {
      this.showNote("Cet élément n'est pas visible actuellement — ouvrez d'abord le panneau ou le mode concerné, puis réessayez.");
      return;
    }
    var self = this;
    // masque l'overlay sans le détruire
    this.overlay.classList.remove('ptuto-show');
    this.overlay.style.display = 'none';

    var scrim = el('div', 'ptuto-spot-scrim');
    scrim.addEventListener('click', function () { self.endSpot(true); });
    document.body.appendChild(scrim);

    target.classList.add('ptuto-spot-target');
    try { target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (e) {}

    var callout = el('div', 'ptuto-spot-callout',
      '<div class="ptuto-sc-k">' + esc(step.title) + '</div>' +
      '<p>' + mdBold(step.body) + '</p>');
    var back = el('button', null, 'Reprendre le tutoriel');
    back.type = 'button'; back.addEventListener('click', function () { self.endSpot(true); });
    callout.appendChild(back);
    document.body.appendChild(callout);

    // positionne le callout près de la cible
    requestAnimationFrame(function () {
      var r = target.getBoundingClientRect();
      var cw = callout.offsetWidth, chh = callout.offsetHeight;
      var top = r.bottom + 12, left = r.left;
      if (top + chh > window.innerHeight - 8) top = Math.max(8, r.top - chh - 12);
      if (left + cw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - cw - 8);
      callout.style.top = top + 'px';
      callout.style.left = left + 'px';
    });

    this.spot = { target: target, scrim: scrim, callout: callout };
  };
  Tuto.prototype.endSpot = function (reopen) {
    if (!this.spot) return;
    this.spot.target.classList.remove('ptuto-spot-target');
    if (this.spot.scrim.parentNode) this.spot.scrim.parentNode.removeChild(this.spot.scrim);
    if (this.spot.callout.parentNode) this.spot.callout.parentNode.removeChild(this.spot.callout);
    this.spot = null;
    if (reopen) {
      this.overlay.style.display = 'flex';
      void this.overlay.offsetWidth;
      this.overlay.classList.add('ptuto-show');
    }
  };
  Tuto.prototype.showNote = function (msg) {
    // note inline temporaire sous le step courant
    var old = this.main.querySelector('.ptuto-note');
    if (old) old.remove();
    var n = el('div', 'ptuto-note', esc(msg));
    this.main.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.remove(); }, 5200);
  };

  /* ------------------------------------------------------------- mount API */
  window.PocheTuto = {
    mount: function (cfg) {
      if (!cfg || !cfg.data) { console.warn('[PocheTuto] configuration manquante'); return; }
      injectStyles(cfg.accent || '#4f8dff');
      var t = new Tuto(cfg);
      ready(function () { t.mountButton(); });
      window.PocheTuto._inst = t;
      return t;
    },
  };
})();
