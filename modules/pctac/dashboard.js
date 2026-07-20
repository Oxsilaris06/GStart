/**
 * dashboard.js — Board relationnel "tableau de chasseur de prime" pour PC-TAC.
 *
 * Module ESM autonome qui construit, dans #view-dashboard, un plan de liens
 * entre les acteurs de la crise (Lieu = hub, Adversaire / Otage / Véhicule /
 * Piégeage = satellites). Les nœuds proviennent de pcTacPhotos (joints aux
 * entités pcTacAdversaries / pcTacHostages pour le champ 'lien' et un statut
 * riche), plus des placeholders pour les entités sans photo.
 *
 * Contrats respectés :
 *  - C-DASHBOARD-API : window.Dashboard = { show, init, render, refresh,
 *    captureToDataUrl, destroy }.
 *  - C-KEY : persistance dans DASHBOARD_KEY { positions, links, locked, layout }.
 *  - C-MATCH : auto-liens via matchPhotosByLabel (config.js).
 *  - C-DOM : tout est construit dynamiquement dans #view-dashboard, <style>
 *    injecté comme wheel.js.
 *  - C-PDF : captureToDataUrl() défensif via html2canvas.
 *
 * Esthétique : réutilise les variables CSS dark-glass du site + le langage
 * visuel des statuts photo (rouge actif / vert neutralisé / palette otage /
 * croix DCD).
 */

import {
    DASHBOARD_KEY,
    BOARD_NODE_TYPES,
    PHOTO_CATEGORIES,
    matchPhotosByLabel
} from './config.js';
import { Storage } from './storage.js';
import { Persist } from './persist.js';
import { ImageStore } from './imageStore.js';

// ---------------------------------------------------------------------------
// Constantes de layout
// ---------------------------------------------------------------------------
const PHOTOS_KEY = 'pcTacPhotos';
const ADVERSARIES_KEY = 'pcTacAdversaries';
const HOSTAGES_KEY = 'pcTacHostages';

const NODE_W = 150;          // largeur logique d'une carte (px monde)
const NODE_H = 168;          // hauteur logique d'une carte
const HUB_GAP = 360;         // espacement horizontal entre clusters
const SAT_RADIUS = 230;      // rayon d'orbite des satellites autour du hub
const ISLAND_GAP = 200;      // espacement des nœuds isolés (sans cluster)

const isArray = (v) => Array.isArray(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Helpers DOM
// ---------------------------------------------------------------------------
function el(tag, attrs = {}, children = []) {
    const node = document.createElementNS(
        tag === 'svg' || tag === 'g' || tag === 'path' || tag === 'line' ||
        tag === 'text' || tag === 'circle' || tag === 'defs' || tag === 'marker' ||
        tag === 'polygon'
            ? 'http://www.w3.org/2000/svg'
            : 'http://www.w3.org/1999/xhtml',
        tag
    );
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === 'class') node.setAttribute('class', v);
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'html') node.innerHTML = v;
        else node.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
}

function icon(name) {
    return el('span', { class: 'material-symbols-outlined', text: name });
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function uid(prefix = 'lnk') {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------------------
// Module principal
// ---------------------------------------------------------------------------
export const Dashboard = {
    _container: null,
    _board: null,        // calque world (transformé : pan/zoom)
    _svg: null,          // svg des fils (dans le calque world)
    _nodesLayer: null,   // div des cartes (dans le calque world)
    _toolbar: null,
    _initialized: false,

    _nodes: [],          // [{id, type, category, title, status, lien, data, x, y, placeholder}]
    _nodeIndex: {},      // id -> node
    _links: [],          // liens manuels persistés
    _autoLinks: [],      // liens auto (recalculés à chaque render)

    _view: { scale: 1, tx: 0, ty: 0 },
    _state: null,        // { positions, links, locked, layout }
    _linkMode: false,
    _linkPick: null,     // premier nœud sélectionné en mode lien

    // -- gestion du drag/pan --
    _drag: null,
    _pan: null,
    _pinch: null,

    // -----------------------------------------------------------------------
    // API publique (C-DASHBOARD-API)
    // -----------------------------------------------------------------------
    show() {
        const host = document.getElementById('view-dashboard');
        if (!host) return;
        if (!this._initialized) this.init(host);
        this.render();
    },

    init(containerEl) {
        if (this._initialized && this._container === containerEl) return;
        this._container = containerEl || document.getElementById('view-dashboard');
        if (!this._container) return;

        this._injectStyle();
        this._state = this._loadState();
        this._view = { scale: 1, tx: 0, ty: 0 };

        this._container.classList.add('dashboard-root');
        this._container.innerHTML = '';
        this._buildToolbar();
        this._buildStage();
        this._bindStageGestures();

        this._initialized = true;
    },

    render() {
        if (!this._initialized) {
            const host = document.getElementById('view-dashboard');
            if (host) this.init(host);
            if (!this._initialized) return;
        }
        // (Re)charger état + données
        this._state = this._loadState();
        this._links = Array.isArray(this._state.links) ? this._state.links.slice() : [];
        this._syncToolbarState();

        this._buildNodes().then(() => {
            this._computeAutoLinks();
            this._applyLayout();
            this._renderNodes();
            this._renderLinks();
            this._applyViewTransform();
        });
    },

    refresh() {
        if (!this._initialized) { this.show(); return; }
        this.render();
    },

    async captureToDataUrl() {
        if (typeof window.html2canvas !== 'function') return null;
        if (!this._board || !this._nodes.length) return null;

        // Calcule la bbox monde de tous les nœuds.
        const bbox = this._worldBBox();
        if (!bbox) return null;
        const pad = 80;
        const w = bbox.maxX - bbox.minX + pad * 2;
        const h = bbox.maxY - bbox.minY + pad * 2;

        // Sauvegarde la transform courante, fige le board à sa taille naturelle.
        const prev = { ...this._view };
        const prevBoardStyle = this._board.style.cssText;
        const prevStageStyle = this._stage.style.cssText;

        try {
            this._stage.style.width = w + 'px';
            this._stage.style.height = h + 'px';
            this._board.style.transform =
                `translate(${-bbox.minX + pad}px, ${-bbox.minY + pad}px) scale(1)`;

            // Laisse le navigateur peindre.
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

            const bg = getComputedStyle(document.body).getPropertyValue('--bg-glass-heavy') || '#101013';
            const canvas = await window.html2canvas(this._stage, {
                backgroundColor: bg.trim() || '#101013',
                width: w,
                height: h,
                scale: Math.min(2, window.devicePixelRatio || 1),
                useCORS: true,
                logging: false
            });

            return canvas.toDataURL('image/png');
        } catch (e) {
            console.error('[Dashboard] captureToDataUrl échec:', e);
            return null;
        } finally {
            // Restauration GARANTIE même si html2canvas jette : sinon le board
            // reste figé à sa taille de capture.
            this._stage.style.cssText = prevStageStyle;
            this._board.style.cssText = prevBoardStyle;
            this._view = prev;
            this._applyViewTransform();
        }
    },

    destroy() {
        try {
            window.removeEventListener('pointermove', this._onPointerMove);
            window.removeEventListener('pointerup', this._onPointerUp);
        } catch (e) { /* noop */ }
        if (this._container) {
            this._container.classList.remove('dashboard-root');
            this._container.innerHTML = '';
        }
        this._board = this._svg = this._nodesLayer = this._toolbar = null;
        this._stage = null;
        this._nodes = [];
        this._nodeIndex = {};
        this._linkMode = false;
        this._linkPick = null;
        this._initialized = false;
    },

    // -----------------------------------------------------------------------
    // État persistant (C-KEY)
    // -----------------------------------------------------------------------
    _loadState() {
        const raw = Persist.get(DASHBOARD_KEY, { validator: isObject, fallback: {} }) || {};
        return {
            positions: isObject(raw.positions) ? raw.positions : {},
            links: isArray(raw.links) ? raw.links : [],
            locked: !!raw.locked,
            layout: raw.layout === 'manual' ? 'manual' : 'auto'
        };
    },

    _saveState() {
        Persist.set(DASHBOARD_KEY, {
            positions: this._state.positions || {},
            links: this._state.links || [],
            locked: !!this._state.locked,
            layout: this._state.layout || 'auto'
        });
    },

    // -----------------------------------------------------------------------
    // Construction des nœuds (DONNÉES)
    // -----------------------------------------------------------------------
    async _buildNodes() {
        let photos = Storage.loadCollection(PHOTOS_KEY) || [];
        const advs = Storage.loadCollection(ADVERSARIES_KEY) || [];
        const hosts = Storage.loadCollection(HOSTAGES_KEY) || [];

        // Hydrate les vignettes (dataURL dans .data) depuis IndexedDB.
        try {
            photos = await ImageStore.hydrate(photos, 'data');
        } catch (e) {
            console.error('[Dashboard] hydrate échec:', e);
        }

        const advById = {};
        advs.forEach(a => { if (a && a.id != null) advById[String(a.id)] = a; });
        const hostById = {};
        hosts.forEach(h => { if (h && h.id != null) hostById[String(h.id)] = h; });

        const nodes = [];
        const seenEntity = new Set(); // ids d'entités déjà couvertes par une photo _sync

        for (const p of photos) {
            if (!p || !p.category) continue;
            if (p.category === 'all') continue;                 // DÉCISION 1
            if (!BOARD_NODE_TYPES[p.category]) continue;        // catégorie hors board
            const meta = BOARD_NODE_TYPES[p.category];

            // Jointure entité via id '<entId>_sync'
            let lien = null, entId = null, ent = null;
            const sid = String(p.id);
            if (sid.endsWith('_sync')) {
                entId = sid.slice(0, -'_sync'.length);
                if (p.category === 'neutralized' && advById[entId]) {
                    ent = advById[entId];
                } else if (p.category === 'hostage' && hostById[entId]) {
                    ent = hostById[entId];
                }
            }
            if (ent) {
                lien = ent.lien || null;
                seenEntity.add(entId);
            }

            nodes.push({
                id: sid,
                entId: entId,
                type: meta.type,
                role: meta.role,
                category: p.category,
                icon: meta.icon,
                title: p.title || meta.label,
                status: p.status || null,
                lien,
                data: p.data || null,
                placeholder: !p.data
            });
        }

        // Placeholders : adversaires/otages SANS photo _sync présente.
        for (const a of advs) {
            if (!a || a.id == null) continue;
            const id = String(a.id);
            if (seenEntity.has(id)) continue;
            const name = [a.nom, a.prenom].filter(Boolean).join(' ').trim();
            nodes.push({
                id: 'ent:adv:' + id,
                entId: id,
                type: 'adversary',
                role: 'satellite',
                category: 'neutralized',
                icon: BOARD_NODE_TYPES.neutralized.icon,
                title: name || 'Adversaire',
                // « attitude » est un champ TEXTE LIBRE. On exige le participe passé
                // (« neutralisé(e)(s) ») et on EXCLUT négation/futur (« non neutralisé »,
                // « à neutraliser », « neutralisation en cours ») : afficher neutralisé
                // un adversaire actif serait une désinformation — en cas de doute,
                // l'état d'échec sûr est 'active'.
                status: (() => {
                    const att = String(a.attitude || '');
                    const positive = /neutralis[ée]e?s?\b/i.test(att);
                    const negated = /(\b(non|pas|jamais)\b[\s-]*(encore\s+)?|\bà\s+|en\s+cours\s+de\s+)neutralis/i.test(att);
                    return (positive && !negated) ? 'neutralized' : 'active';
                })(),
                lien: a.lien || null,
                data: null,
                placeholder: true
            });
        }
        for (const h of hosts) {
            if (!h || h.id == null) continue;
            const id = String(h.id);
            if (seenEntity.has(id)) continue;
            const name = [h.nom, h.prenom].filter(Boolean).join(' ').trim();
            nodes.push({
                id: 'ent:host:' + id,
                entId: id,
                type: 'hostage',
                role: 'satellite',
                category: 'hostage',
                icon: BOARD_NODE_TYPES.hostage.icon,
                title: name || 'Otage',
                status: this._hostageStatus(h.etat),
                lien: h.lien || null,
                data: null,
                placeholder: true
            });
        }

        this._nodes = nodes;
        this._nodeIndex = {};
        nodes.forEach(n => { this._nodeIndex[n.id] = n; });
        return nodes;
    },

    _hostageStatus(etat) {
        const e = (etat || '').toString().toLowerCase();
        if (['ok', 'preoccupant', 'blesse', 'dcd'].includes(e)) return e;
        if (e.includes('dcd') || e.includes('mort')) return 'dcd';
        if (e.includes('bless')) return 'blesse';
        if (e.includes('preocc')) return 'preoccupant';
        return 'ok';
    },

    // -----------------------------------------------------------------------
    // Auto-liens (LIENS — C-MATCH)
    // -----------------------------------------------------------------------
    _computeAutoLinks() {
        const links = [];
        const seen = new Set();
        const hubs = this._nodes.filter(n => n.role === 'hub');

        // 1) Lieu (hub) attire les nœuds dont le titre matche ses lettres de façade.
        for (const hub of hubs) {
            // Les "labels" du hub = ses tokens de façade A-F présents dans son titre.
            const labels = this._facadeLabels(hub.title);
            for (const label of labels) {
                const matched = matchPhotosByLabel(label, this._nodes);
                for (const m of matched) {
                    if (m.id === hub.id) continue;
                    if (m.role === 'hub') continue; // hub↔hub non auto-lié ici
                    const key = this._linkKey(hub.id, m.id);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    links.push({ from: hub.id, to: m.id, auto: true, label: null });
                }
            }
        }

        // 2) Token commun (toutes catégories) entre satellites non encore reliés
        //    à un hub — relie les acteurs partageant un token de titre identique.
        const sats = this._nodes.filter(n => n.role !== 'hub');
        for (let i = 0; i < sats.length; i++) {
            for (let j = i + 1; j < sats.length; j++) {
                const a = sats[i], b = sats[j];
                const key = this._linkKey(a.id, b.id);
                if (seen.has(key)) continue;
                if (this._shareToken(a.title, b.title)) {
                    seen.add(key);
                    links.push({ from: a.id, to: b.id, auto: true, label: null });
                }
            }
        }

        this._autoLinks = links;
    },

    _facadeLabels(title) {
        // Extrait les lettres de façade A-F individuelles présentes dans le titre.
        const norm = (title || '').toString()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toUpperCase().replace(/[^A-F]/g, '');
        return Array.from(new Set(norm.split(''))).filter(Boolean);
    },

    _shareToken(t1, t2) {
        const tok = (s) => new Set(
            (s || '').toString()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .toUpperCase()
                .split(/[^A-Z0-9]+/)
                .filter(x => x && x.length >= 3) // évite faux positifs sur lettres isolées
        );
        const a = tok(t1), b = tok(t2);
        for (const x of a) if (b.has(x)) return true;
        return false;
    },

    _linkKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; },

    // -----------------------------------------------------------------------
    // Layout (auto-layout par clusters)
    // -----------------------------------------------------------------------
    _applyLayout() {
        const pos = this._state.positions || {};
        const manual = this._state.layout === 'manual';

        // Si manuel : on respecte les positions enregistrées, on auto-place
        // uniquement les nœuds inconnus.
        if (manual) {
            let auto = 0;
            this._nodes.forEach(n => {
                if (pos[n.id]) { n.x = pos[n.id].x; n.y = pos[n.id].y; }
                else { n.x = 40 + (auto % 5) * ISLAND_GAP; n.y = 40 + Math.floor(auto / 5) * ISLAND_GAP; auto++; }
            });
            return;
        }

        // Auto-layout : un cluster par hub (Lieu au centre), satellites en orbite.
        const hubs = this._nodes.filter(n => n.role === 'hub');
        const sats = this._nodes.filter(n => n.role !== 'hub');

        // Map satellite -> hub via auto-liens (premier hub trouvé).
        const satHub = {};
        for (const l of this._autoLinks) {
            const f = this._nodeIndex[l.from], t = this._nodeIndex[l.to];
            if (f && t) {
                if (f.role === 'hub' && t.role !== 'hub' && !satHub[t.id]) satHub[t.id] = f.id;
                if (t.role === 'hub' && f.role !== 'hub' && !satHub[f.id]) satHub[f.id] = t.id;
            }
        }

        const clusters = {};
        hubs.forEach(h => { clusters[h.id] = []; });
        const orphans = [];
        sats.forEach(s => {
            if (satHub[s.id] && clusters[satHub[s.id]]) clusters[satHub[s.id]].push(s);
            else orphans.push(s);
        });

        // Place les clusters côte à côte horizontalement.
        let cx = 80, cy = 80;
        const colMax = 3; // clusters par "rangée"
        let col = 0;
        hubs.forEach((hub) => {
            const cluster = clusters[hub.id] || [];
            const baseX = cx + col * (HUB_GAP + SAT_RADIUS * 2);
            const baseY = cy + Math.floor(col / 1) * 0; // simple ligne, wrap géré ci-dessous
            const centerX = baseX + SAT_RADIUS;
            const centerY = cy + SAT_RADIUS + 40;
            hub.x = centerX; hub.y = centerY;
            const n = cluster.length;
            cluster.forEach((s, i) => {
                const ang = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
                s.x = centerX + Math.cos(ang) * SAT_RADIUS;
                s.y = centerY + Math.sin(ang) * SAT_RADIUS;
            });
            col++;
            if (col >= colMax) { col = 0; cy += SAT_RADIUS * 2 + HUB_GAP; }
        });

        // Bande des orphelins sous les clusters.
        const orphanY = cy + (col > 0 ? SAT_RADIUS * 2 + HUB_GAP : 0) + 40;
        orphans.forEach((o, i) => {
            o.x = 80 + (i % 6) * ISLAND_GAP;
            o.y = orphanY + Math.floor(i / 6) * ISLAND_GAP;
        });

        // Mémorise comme positions de référence (sans changer le mode auto).
        const newPos = {};
        this._nodes.forEach(n => { newPos[n.id] = { x: n.x, y: n.y }; });
        this._state.positions = newPos;
        this._saveState();
    },

    // -----------------------------------------------------------------------
    // Rendu des nœuds
    // -----------------------------------------------------------------------
    _renderNodes() {
        if (!this._nodesLayer) return;
        this._nodesLayer.innerHTML = '';

        const cats = {};
        PHOTO_CATEGORIES.forEach(c => { cats[c.id] = c.label; });

        this._nodes.forEach(n => {
            const card = el('div', {
                class: 'db-node' + (n.placeholder ? ' is-placeholder' : '') +
                    (n.role === 'hub' ? ' is-hub' : ''),
                'data-id': n.id,
                'data-category': n.category,
                'data-status': n.status || '',
                style: `left:${n.x - NODE_W / 2}px; top:${n.y - NODE_H / 2}px;`
            });

            // Vignette ou placeholder iconique
            let thumb;
            if (n.data) {
                thumb = el('div', { class: 'db-thumb' }, [
                    el('img', {
                        src: n.data, alt: esc(n.title),
                        draggable: 'false',
                        onClick: (e) => {
                            e.stopPropagation();
                            // Fin de drag par la photo : le click qui suit le pointerup
                            // ne doit pas ouvrir le lightbox.
                            if (this._dragEndedAt && Date.now() - this._dragEndedAt < 250) return;
                            this._openLightbox(n.data, n.title);
                        }
                    })
                ]);
            } else {
                thumb = el('div', { class: 'db-thumb db-thumb-ph' }, [icon(n.icon)]);
            }

            const badge = el('div', { class: 'db-badge', text: cats[n.category] || n.category });
            const title = el('div', { class: 'db-title', text: n.title });
            const sub = n.lien
                ? el('div', { class: 'db-sub', text: 'lien: ' + n.lien })
                : null;

            card.appendChild(thumb);
            card.appendChild(badge);
            card.appendChild(title);
            if (sub) card.appendChild(sub);

            // Interactions : drag (déverrouillé) / sélection (mode lien)
            card.addEventListener('pointerdown', (e) => this._onNodePointerDown(e, n, card));
            card.addEventListener('click', (e) => {
                if (this._linkMode) {
                    e.stopPropagation();
                    this._onLinkPick(n, card);
                }
            });

            this._nodesLayer.appendChild(card);
        });
    },

    // -----------------------------------------------------------------------
    // Rendu des fils (SVG sous les cartes)
    // -----------------------------------------------------------------------
    _renderLinks() {
        if (!this._svg) return;
        while (this._svg.firstChild) this._svg.removeChild(this._svg.firstChild);

        const bbox = this._worldBBox();
        const pad = 400;
        const minX = bbox ? bbox.minX - pad : 0;
        const minY = bbox ? bbox.minY - pad : 0;
        const w = bbox ? (bbox.maxX - bbox.minX) + pad * 2 : 1000;
        const h = bbox ? (bbox.maxY - bbox.minY) + pad * 2 : 1000;
        this._svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
        this._svg.setAttribute('width', w);
        this._svg.setAttribute('height', h);
        this._svg.style.left = minX + 'px';
        this._svg.style.top = minY + 'px';
        this._svg.style.width = w + 'px';
        this._svg.style.height = h + 'px';

        const all = [
            ...this._autoLinks.map(l => ({ ...l, auto: true })),
            ...this._links.map(l => ({ ...l, auto: false }))
        ];

        for (const l of all) {
            const a = this._nodeIndex[l.from];
            const b = this._nodeIndex[l.to];
            if (!a || !b) continue;

            const style = this._linkStyle(a, b);
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            // Courbe légère (quadratique) pour lisibilité.
            const cx = mx, cy = my - 30;
            const d = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;

            const path = el('path', {
                d,
                class: 'db-link' + (style.cut ? ' db-link-cut' : ''),
                stroke: style.color,
                'stroke-width': style.width,
                'stroke-dasharray': style.dash || null,
                fill: 'none'
            });
            this._svg.appendChild(path);

            // Croix sur fil "coupé" (piégeage neutralisé)
            if (style.cut) {
                const r = 9;
                this._svg.appendChild(el('line', {
                    x1: mx - r, y1: my - r, x2: mx + r, y2: my + r,
                    stroke: style.color, 'stroke-width': 3, class: 'db-cut-mark'
                }));
                this._svg.appendChild(el('line', {
                    x1: mx - r, y1: my + r, x2: mx + r, y2: my - r,
                    stroke: style.color, 'stroke-width': 3, class: 'db-cut-mark'
                }));
            }

            // Étiquette de fil (commentaire / champ lien) centrée.
            const label = this._linkLabel(l, a, b);
            if (label) {
                const tg = el('g', { class: 'db-link-label' });
                // Styles posés en ATTRIBUTS (pas seulement en CSS injecté) : lors de la
                // capture html2canvas, le SVG est sérialisé hors du document et perd les
                // feuilles de style → sans ces attributs, texte noir 16px sans halo.
                const txt = el('text', {
                    x: mx, y: cy - 6, 'text-anchor': 'middle', text: label,
                    fill: '#f0f0f1', 'font-size': '13', 'font-weight': '600',
                    'paint-order': 'stroke', stroke: 'rgba(0,0,0,0.55)', 'stroke-width': '3'
                });
                tg.appendChild(txt);
                tg.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!l.auto) this._editLink(l);
                });
                this._svg.appendChild(tg);
            }
        }
    },

    _linkStyle(a, b) {
        // Fil VERS un piégeage : rouge si actif, vert "coupé" si neutralisé.
        const trap = a.category === 'trap' ? a : (b.category === 'trap' ? b : null);
        if (trap) {
            if (trap.status === 'neutralized') {
                return { color: '#22c55e', width: 2.5, dash: '8 6', cut: true };
            }
            return { color: '#ef4444', width: 3, dash: null, cut: false };
        }
        // Fil impliquant un adversaire actif → teinte rouge discrète.
        const advActive = [a, b].some(n => n.category === 'neutralized' && n.status === 'active');
        if (advActive) {
            return { color: 'rgba(239,68,68,0.7)', width: 2, dash: null, cut: false };
        }
        // Neutre (blanc/verre)
        return { color: 'rgba(255,255,255,0.45)', width: 2, dash: null, cut: false };
    },

    _linkLabel(l, a, b) {
        if (l.comment) return l.comment;
        // Fil adversaire↔otage : afficher le champ 'lien' de l'adversaire.
        const adv = a.category === 'neutralized' ? a : (b.category === 'neutralized' ? b : null);
        const host = a.category === 'hostage' ? a : (b.category === 'hostage' ? b : null);
        if (adv && host && adv.lien) return adv.lien;
        return '';
    },

    // -----------------------------------------------------------------------
    // Toolbar
    // -----------------------------------------------------------------------
    _buildToolbar() {
        const tb = el('div', { class: 'db-toolbar' });

        this._btnAuto = this._toolBtn('auto_awesome_motion', 'Auto', () => {
            this._state.layout = 'auto';
            this._saveState();
            this.render();
        });
        this._btnLock = this._toolBtn('lock_open', 'Verrou', () => {
            this._state.locked = !this._state.locked;
            this._saveState();
            this._syncToolbarState();
        });
        this._btnAdd = this._toolBtn('add_a_photo', 'Ajouter', () => this._openAddForm());
        this._btnLink = this._toolBtn('timeline', 'Lien', () => this._toggleLinkMode());
        this._btnZoom = this._toolBtn('zoom_out_map', 'Zoom reset', () => this._resetView());

        tb.appendChild(this._btnAuto);
        tb.appendChild(this._btnLock);
        tb.appendChild(this._btnAdd);
        tb.appendChild(this._btnLink);
        tb.appendChild(this._btnZoom);

        this._toolbar = tb;
        this._container.appendChild(tb);
    },

    _toolBtn(ic, label, onClick) {
        const b = el('button', { class: 'db-tool-btn', type: 'button', title: label, 'aria-label': label });
        b.appendChild(icon(ic));
        b.appendChild(el('span', { class: 'db-tool-label', text: label }));
        b.addEventListener('click', onClick);
        return b;
    },

    _syncToolbarState() {
        if (!this._toolbar) return;
        if (this._btnLock) {
            const ic = this._btnLock.querySelector('.material-symbols-outlined');
            if (ic) ic.textContent = this._state.locked ? 'lock' : 'lock_open';
            this._btnLock.classList.toggle('active', !!this._state.locked);
        }
        if (this._btnLink) this._btnLink.classList.toggle('active', this._linkMode);
        if (this._board) this._board.classList.toggle('link-mode', this._linkMode);
    },

    // -----------------------------------------------------------------------
    // Stage (calque pan/zoom + svg + nodes)
    // -----------------------------------------------------------------------
    _buildStage() {
        const stage = el('div', { class: 'db-stage' });
        const board = el('div', { class: 'db-board' });
        const svg = el('svg', { class: 'db-links', xmlns: 'http://www.w3.org/2000/svg' });
        const nodesLayer = el('div', { class: 'db-nodes' });

        board.appendChild(svg);
        board.appendChild(nodesLayer);
        stage.appendChild(board);

        // Empty state
        const empty = el('div', { class: 'db-empty', text: 'Aucun acteur à afficher. Ajoutez une photo (Lieu, Adversaire, Otage, Piégeage…) pour construire le tableau.' });
        stage.appendChild(empty);
        this._empty = empty;

        this._stage = stage;
        this._board = board;
        this._svg = svg;
        this._nodesLayer = nodesLayer;
        this._container.appendChild(stage);
    },

    // -----------------------------------------------------------------------
    // Gestes : pan (fond), zoom (molette/pincement), drag nœud
    // -----------------------------------------------------------------------
    _bindStageGestures() {
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        // Pan au pointeur sur le fond
        this._stage.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.db-node')) return; // géré par le nœud
            if (this._linkMode) return;
            this._pan = { startX: e.clientX, startY: e.clientY, tx: this._view.tx, ty: this._view.ty };
            this._stage.setPointerCapture?.(e.pointerId);
        });

        window.addEventListener('pointermove', this._onPointerMove);
        window.addEventListener('pointerup', this._onPointerUp);

        // Zoom molette
        this._stage.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this._stage.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            this._zoomAt(px, py, factor);
        }, { passive: false });

        // Pincement tactile (2 doigts)
        this._touchPts = new Map();
        this._stage.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                this._pinch = this._pinchInfo(e.touches);
            }
        }, { passive: true });
        this._stage.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && this._pinch) {
                e.preventDefault();
                const cur = this._pinchInfo(e.touches);
                const factor = cur.dist / (this._pinch.dist || 1);
                const rect = this._stage.getBoundingClientRect();
                this._zoomAt(cur.cx - rect.left, cur.cy - rect.top, factor);
                this._pinch = cur;
            }
        }, { passive: false });
        this._stage.addEventListener('touchend', () => { this._pinch = null; });

        // Clic fond en mode lien : annule la sélection
        this._stage.addEventListener('click', (e) => {
            if (this._linkMode && !e.target.closest('.db-node') && !e.target.closest('.db-link-label')) {
                this._clearLinkPick();
            }
        });
    },

    _pinchInfo(touches) {
        const a = touches[0], b = touches[1];
        const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
        return {
            dist: Math.hypot(dx, dy),
            cx: (a.clientX + b.clientX) / 2,
            cy: (a.clientY + b.clientY) / 2
        };
    },

    _onNodePointerDown(e, node, card) {
        if (this._linkMode) return;          // clic gère la sélection
        if (this._state.locked) return;      // déplacement interdit si verrouillé
        if (e.target.closest('img')) {
            // laisser le clic image ouvrir le lightbox (pas de drag)
        }
        e.stopPropagation();
        const rect = this._stage.getBoundingClientRect();
        this._drag = {
            node, card,
            pointerId: e.pointerId,
            offX: (e.clientX - rect.left - this._view.tx) / this._view.scale - node.x,
            offY: (e.clientY - rect.top - this._view.ty) / this._view.scale - node.y,
            moved: false
        };
        card.setPointerCapture?.(e.pointerId);
        card.classList.add('dragging');
    },

    _onPointerMove(e) {
        if (this._drag) {
            // Seuil de 5 px avant de considérer le geste comme un VRAI drag : sur
            // tactile, un simple tap génère 1-2 pointermove de jitter — sans seuil,
            // il basculait le layout en manuel, persistait la position ET avalait le
            // click suivant (lightbox jamais ouvert au tap sur la photo).
            if (!this._drag.moved) {
                if (this._drag.startCX == null) { this._drag.startCX = e.clientX; this._drag.startCY = e.clientY; }
                if (Math.hypot(e.clientX - this._drag.startCX, e.clientY - this._drag.startCY) <= 5) return;
            }
            const rect = this._stage.getBoundingClientRect();
            const wx = (e.clientX - rect.left - this._view.tx) / this._view.scale;
            const wy = (e.clientY - rect.top - this._view.ty) / this._view.scale;
            this._drag.node.x = wx - this._drag.offX;
            this._drag.node.y = wy - this._drag.offY;
            this._drag.moved = true;
            this._drag.card.style.left = (this._drag.node.x - NODE_W / 2) + 'px';
            this._drag.card.style.top = (this._drag.node.y - NODE_H / 2) + 'px';
            this._renderLinks();
            return;
        }
        if (this._pan) {
            this._view.tx = this._pan.tx + (e.clientX - this._pan.startX);
            this._view.ty = this._pan.ty + (e.clientY - this._pan.startY);
            this._applyViewTransform();
        }
    },

    _onPointerUp() {
        if (this._drag) {
            if (this._drag.moved) {
                // Passe en layout manuel et persiste la position.
                this._state.layout = 'manual';
                this._state.positions = this._state.positions || {};
                this._state.positions[this._drag.node.id] = {
                    x: this._drag.node.x, y: this._drag.node.y
                };
                this._saveState();
                this._dragEndedAt = Date.now(); // neutralise le click résiduel (lightbox)
            }
            this._drag.card.classList.remove('dragging');
            this._drag = null;
        }
        this._pan = null;
    },

    _zoomAt(px, py, factor) {
        const newScale = Math.min(3, Math.max(0.2, this._view.scale * factor));
        const k = newScale / this._view.scale;
        // garde le point (px,py) écran fixe
        this._view.tx = px - (px - this._view.tx) * k;
        this._view.ty = py - (py - this._view.ty) * k;
        this._view.scale = newScale;
        this._applyViewTransform();
    },

    _resetView() {
        // Centre la bbox dans le stage.
        const bbox = this._worldBBox();
        const rect = this._stage.getBoundingClientRect();
        if (!bbox) { this._view = { scale: 1, tx: 0, ty: 0 }; this._applyViewTransform(); return; }
        const w = bbox.maxX - bbox.minX, h = bbox.maxY - bbox.minY;
        const scale = Math.min(1, (rect.width - 80) / Math.max(1, w), (rect.height - 80) / Math.max(1, h));
        this._view.scale = Math.max(0.2, scale);
        this._view.tx = (rect.width - w * this._view.scale) / 2 - bbox.minX * this._view.scale;
        this._view.ty = (rect.height - h * this._view.scale) / 2 - bbox.minY * this._view.scale;
        this._applyViewTransform();
    },

    _applyViewTransform() {
        if (!this._board) return;
        this._board.style.transform =
            `translate(${this._view.tx}px, ${this._view.ty}px) scale(${this._view.scale})`;
        if (this._empty) this._empty.style.display = this._nodes.length ? 'none' : 'flex';
    },

    _worldBBox() {
        if (!this._nodes.length) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this._nodes.forEach(n => {
            minX = Math.min(minX, n.x - NODE_W / 2);
            minY = Math.min(minY, n.y - NODE_H / 2);
            maxX = Math.max(maxX, n.x + NODE_W / 2);
            maxY = Math.max(maxY, n.y + NODE_H / 2);
        });
        return { minX, minY, maxX, maxY };
    },

    // -----------------------------------------------------------------------
    // Mode lien
    // -----------------------------------------------------------------------
    _toggleLinkMode() {
        this._linkMode = !this._linkMode;
        this._clearLinkPick();
        this._syncToolbarState();
    },

    _onLinkPick(node, card) {
        if (!this._linkPick) {
            this._linkPick = { node, card };
            card.classList.add('link-picked');
            return;
        }
        if (this._linkPick.node.id === node.id) {
            this._clearLinkPick();
            return;
        }
        // Crée le lien manuel
        const from = this._linkPick.node.id;
        const to = node.id;
        const comment = (prompt('Commentaire du lien (optionnel) :', '') || '').trim();
        this._links.push({ id: uid('lnk'), from, to, comment });
        this._state.links = this._links.slice();
        this._saveState();
        this._clearLinkPick();
        this._renderLinks();
    },

    _clearLinkPick() {
        if (this._linkPick && this._linkPick.card) {
            this._linkPick.card.classList.remove('link-picked');
        }
        this._linkPick = null;
    },

    _editLink(link) {
        const cur = link.comment || '';
        const next = prompt('Modifier le commentaire (vide = supprimer le lien) :', cur);
        if (next === null) return;
        if (next.trim() === '') {
            this._links = this._links.filter(l => l.id !== link.id);
        } else {
            const target = this._links.find(l => l.id === link.id);
            if (target) target.comment = next.trim();
        }
        this._state.links = this._links.slice();
        this._saveState();
        this._renderLinks();
    },

    // -----------------------------------------------------------------------
    // Formulaire d'ajout de photo (DÉCISION 6)
    // -----------------------------------------------------------------------
    _openAddForm() {
        if (this._modal) this._modal.remove();
        const overlay = el('div', { class: 'db-modal-overlay' });
        const modal = el('div', { class: 'db-modal' });

        const titleIn = el('input', { type: 'text', class: 'db-input', placeholder: 'Titre (ex: A, Renault, Otage 1…)' });
        const catSel = el('select', { class: 'db-input' });
        PHOTO_CATEGORIES.filter(c => c.id !== 'all').forEach(c => {
            catSel.appendChild(el('option', { value: c.id, text: c.label }));
        });
        const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'db-input' });

        const err = el('div', { class: 'db-modal-err' });

        const submit = el('button', { class: 'db-tool-btn db-primary', type: 'button', text: 'Ajouter' });
        const cancel = el('button', { class: 'db-tool-btn', type: 'button', text: 'Annuler' });

        cancel.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        submit.addEventListener('click', async () => {
            const title = titleIn.value.trim();
            const category = catSel.value;
            if (!title) { err.textContent = 'Titre requis.'; return; }
            const file = fileIn.files && fileIn.files[0];

            try {
                const id = uid('photo');
                let hasImage = false;
                if (file) {
                    const dataUrl = await this._readFile(file);
                    if (dataUrl) {
                        await ImageStore.put(id, dataUrl);
                        hasImage = true;
                    }
                }
                const list = Storage.loadCollection(PHOTOS_KEY) || [];
                const item = { id, title, category, hasImage };
                // Statut par défaut selon la catégorie (langage visuel du site).
                if (category === 'neutralized' || category === 'trap') item.status = 'active';
                else if (category === 'hostage') item.status = 'ok';
                list.push(item);
                Storage.saveCollection(PHOTOS_KEY, list);

                overlay.remove();
                this.refresh();
            } catch (e) {
                console.error('[Dashboard] ajout photo échec:', e);
                err.textContent = 'Échec de l\'ajout.';
            }
        });

        modal.appendChild(el('div', { class: 'db-modal-title', text: 'Ajouter un nœud (photo)' }));
        modal.appendChild(this._field('Titre', titleIn));
        modal.appendChild(this._field('Catégorie', catSel));
        modal.appendChild(this._field('Image (optionnelle)', fileIn));
        modal.appendChild(err);
        const actions = el('div', { class: 'db-modal-actions' });
        actions.appendChild(cancel);
        actions.appendChild(submit);
        modal.appendChild(actions);
        overlay.appendChild(modal);
        this._container.appendChild(overlay);
        this._modal = overlay;
        titleIn.focus();
    },

    _field(label, input) {
        return el('label', { class: 'db-field' }, [
            el('span', { class: 'db-field-label', text: label }),
            input
        ]);
    },

    _readFile(file) {
        return new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => resolve(null);
            r.readAsDataURL(file);
        });
    },

    // -----------------------------------------------------------------------
    // Lightbox (réutilise ui.js)
    // -----------------------------------------------------------------------
    _openLightbox(src, title) {
        if (window.UI && typeof window.UI.openLightbox === 'function') {
            window.UI.openLightbox(src, title);
        }
    },

    // -----------------------------------------------------------------------
    // Style (injecté comme wheel.js)
    // -----------------------------------------------------------------------
    _injectStyle() {
        if (document.getElementById('dashboard-style')) return;
        const style = document.createElement('style');
        style.id = 'dashboard-style';
        style.textContent = `
.dashboard-root { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 60vh; }

.db-toolbar {
    display: flex; gap: 8px; flex-wrap: wrap; padding: 10px 12px;
    background: var(--bg-glass-heavy); border-bottom: 1px solid var(--border-glass);
    position: sticky; top: 0; z-index: 20;
}
.db-tool-btn {
    display: inline-flex; align-items: center; gap: 6px;
    min-height: 44px; padding: 0 14px;
    background: rgba(255,255,255,0.05); color: var(--text-main);
    border: 1px solid var(--border-glass); border-radius: var(--radius-md, 12px);
    cursor: pointer; font-size: 0.85rem; transition: background .15s, border-color .15s;
    user-select: none;
}
.db-tool-btn:hover { background: rgba(255,255,255,0.1); }
.db-tool-btn.active { border-color: var(--accent-blue, #4f8dff); color: var(--accent-blue, #4f8dff); box-shadow: 0 0 12px var(--accent-glow, rgba(79,141,255,.28)); }
.db-tool-btn.db-primary { background: var(--accent-blue, #4f8dff); color: #fff; border-color: var(--accent-blue, #4f8dff); }
.db-tool-btn .material-symbols-outlined { font-size: 20px; }

.db-stage {
    position: relative; flex: 1; overflow: hidden;
    background:
        radial-gradient(circle at 20% 20%, rgba(255,255,255,0.03), transparent 60%),
        var(--bg-glass-heavy);
    background-size: 26px 26px, auto;
    touch-action: none; cursor: grab;
}
.db-stage:active { cursor: grabbing; }
.db-board { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.db-links { position: absolute; overflow: visible; pointer-events: none; }
.db-link { transition: stroke .2s; }
.db-link-label text {
    fill: var(--text-main); font-size: 13px; font-weight: 600;
    paint-order: stroke; stroke: rgba(0,0,0,0.55); stroke-width: 3px;
    pointer-events: auto; cursor: pointer;
}
.db-cut-mark { pointer-events: none; }

.db-nodes { position: absolute; left: 0; top: 0; }
.db-node {
    position: absolute; width: ${NODE_W}px; min-height: ${NODE_H}px;
    background: var(--bg-glass-heavy); border: 1px solid var(--border-glass);
    border-radius: var(--radius-md, 12px); overflow: hidden;
    box-shadow: 0 6px 18px rgba(0,0,0,0.4);
    cursor: grab; user-select: none; touch-action: none;
    display: flex; flex-direction: column;
}
.db-node.dragging { cursor: grabbing; z-index: 50; box-shadow: 0 12px 30px rgba(0,0,0,0.6); }
.db-node.is-hub { border-color: var(--accent-blue, #4f8dff); box-shadow: 0 0 18px var(--accent-glow, rgba(79,141,255,.28)); }
.db-node.link-picked { outline: 2px solid var(--accent-blue, #4f8dff); outline-offset: 2px; }
.db-board.link-mode .db-node { cursor: pointer; }

.db-thumb { width: 100%; height: 96px; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; border-bottom: 1px solid var(--border-glass); }
.db-thumb img { width: 100%; height: 100%; object-fit: cover; cursor: zoom-in; }
.db-thumb-ph .material-symbols-outlined { font-size: 46px; color: var(--text-muted); }
.db-node.is-placeholder { border-style: dashed; }

.db-badge {
    align-self: flex-start; margin: 6px 0 0 6px; padding: 2px 8px;
    font-size: 0.65rem; letter-spacing: .5px; text-transform: uppercase;
    background: rgba(255,255,255,0.08); color: var(--text-muted);
    border-radius: 6px;
}
.db-title { padding: 4px 8px 0; font-size: 0.82rem; font-weight: 600; color: var(--text-main); line-height: 1.2; }
.db-sub { padding: 2px 8px 8px; font-size: 0.68rem; color: var(--text-muted); }

/* Langage visuel des statuts (calqué sur .photo-card de pctac2.html) */
.db-node[data-category="neutralized"][data-status="active"],
.db-node[data-category="trap"][data-status="active"] {
    border-color: rgba(239,68,68,0.8);
    box-shadow: inset 0 0 15px rgba(239,68,68,0.3), 0 0 22px rgba(239,68,68,0.22);
}
.db-node[data-category="neutralized"][data-status="neutralized"],
.db-node[data-category="trap"][data-status="neutralized"] {
    border-color: rgba(34,197,94,0.8);
    box-shadow: inset 0 0 15px rgba(34,197,94,0.3), 0 0 22px rgba(34,197,94,0.22);
}
.db-node[data-category="neutralized"][data-status="neutralized"]::after,
.db-node[data-category="trap"][data-status="neutralized"]::after {
    content: "X"; position: absolute; top: 40px; left: 50%; transform: translateX(-50%);
    color: #22c55e; font-size: 64px; font-weight: bold; opacity: 0.45; pointer-events: none;
}
.db-node[data-category="hostage"][data-status="ok"] { border-color: #22c55e; box-shadow: 0 0 14px rgba(34,197,94,0.4); }
.db-node[data-category="hostage"][data-status="preoccupant"] { border-color: #f97316; box-shadow: 0 0 14px rgba(249,115,22,0.4); }
.db-node[data-category="hostage"][data-status="blesse"] { border-color: #ef4444; box-shadow: 0 0 14px rgba(239,68,68,0.4); }
.db-node[data-category="hostage"][data-status="dcd"] { border-color: #666; filter: grayscale(1); opacity: 0.82; }
.db-node[data-category="hostage"][data-status="dcd"]::after {
    content: "X"; position: absolute; top: 40px; left: 50%; transform: translateX(-50%);
    color: #ef4444; font-size: 64px; font-weight: bold; opacity: 0.55; pointer-events: none;
}

.db-empty {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.95rem;
    pointer-events: none;
}

/* Modale d'ajout */
.db-modal-overlay {
    position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); padding: 16px;
}
.db-modal {
    width: min(420px, 100%); background: var(--bg-glass-heavy);
    border: 1px solid var(--border-glass); border-radius: var(--radius-md, 12px);
    padding: 18px; box-shadow: 0 16px 50px rgba(0,0,0,0.6); color: var(--text-main);
}
.db-modal-title { font-size: 1.05rem; font-weight: 700; margin-bottom: 14px; }
.db-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.db-field-label { font-size: 0.75rem; color: var(--text-muted); }
.db-input {
    width: 100%; padding: 10px; border-radius: 8px; box-sizing: border-box;
    background: rgba(255,255,255,0.05); color: var(--text-main); border: 1px solid var(--border-glass);
    font-size: 0.9rem;
}
.db-modal-err { color: var(--danger-red, #f0556a); font-size: 0.8rem; min-height: 1em; margin-bottom: 8px; }
.db-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }

@media (max-width: 720px) {
    .db-tool-label { display: none; }
    .db-tool-btn { padding: 0 12px; min-width: 44px; justify-content: center; }
    .db-node { width: ${Math.round(NODE_W * 0.86)}px; }
}
`;
        document.head.appendChild(style);
    }
};

// Exposition globale (C-DASHBOARD-API)
window.Dashboard = Dashboard;

export default Dashboard;
