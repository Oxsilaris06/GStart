/**
 * Vue Plan tactique — MapLibre + Nominatim (OSM).
 *
 * Pourquoi : le PC TAC est souvent déporté du lieu réel, donc la géoloc du
 * navigateur n'a aucun intérêt. On utilise une recherche d'adresse pure
 * (Nominatim, gratuit, sans clé API) pour centrer la carte sur l'objectif.
 *
 * Pins :
 *  - liés à une entité (Adversaire/Otage/Ami) → couleur OTAN automatique
 *  - libres (catégorie OTAN choisie : hostile / civil / ami / neutre / inconnu)
 *
 * Persistance : pcTacPlanPins (localStorage), petit volume, pas besoin d'IDB.
 */

import { Storage } from './storage.js';
import { ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PIN_ICONS, suggestPinIcons } from './config.js';
import { Wheel } from './wheel.js';
import { Persist } from './persist.js';
import { formatCoordsClipboard, shortMgrs } from './coords.js';

const PINS_KEY = 'pcTacPlanPins';
const VIEW_KEY = 'pcTacPlanView';
const SHAPES_KEY = 'pcTacPlanShapes';

// Code couleur — strictement aligné sur la légende affichée
// (--danger-red, --civil-yellow, --inter-blue, --ao-green dans pctac2.html)
const ENTITY_COLORS = {
    adv: '#ef4444',    // Adv  / rouge
    host: '#eab308',   // Otage / jaune
    friend: '#3b82f6'  // Inter / bleu
};

// Style satellite ESRI World Imagery + modèle d'élévation (DEM) AWS Open Data
// Tout sans clé API, sans tracking. Le DEM ne sert qu'au relief 3D (setTerrain).
const RASTER_STYLE = {
    version: 8,
    // Polices keyless servies par OpenFreeMap (même origine que les tuiles vectorielles)
    // — requises pour le rendu texte des noms de rues. NB : fonts.openmaptiles.org
    // renvoie du text/html (cassé) ; tiles.openfreemap.org/fonts renvoie le protobuf.
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
        satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Tiles © Esri'
        },
        // Ortho HD IGN 20 cm (BD ORTHO, Géoplateforme, SANS clé, schéma XYZ vérifié).
        // PIÈGE : hors couverture (étranger/mer dans la grille) l'IGN renvoie une tuile
        // JPEG BLANCHE OPAQUE (~1.6 Ko), pas un 404 → elle masquerait Esri. Comme on ne
        // peut pas filtrer une tuile raster blanche, on n'affiche l'IGN qu'à partir du
        // z11 (cf. raster-opacity) — là la vue est dominée par du sol FR, donc pas de
        // blanc ; à plus bas zoom Esri reste seul (et le 20 cm ne se voit pas avant ~z13).
        // `bounds` évite en plus de requêter l'IGN loin hors de France.
        'ign-ortho': {
            type: 'raster',
            tiles: ['https://data.geopf.fr/tms/1.0.0/HR.ORTHOIMAGERY.ORTHOPHOTOS/{z}/{x}/{y}.jpeg'],
            tileSize: 256,
            minzoom: 11,
            maxzoom: 19,
            bounds: [-5.6, 41.1, 9.8, 51.3],
            attribution: 'BD ORTHO © IGN / Géoplateforme'
        },
        'terrain-dem': {
            type: 'raster-dem',
            tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
            attribution: 'Elevation © AWS Terrain Tiles'
        },
        // Tuiles vectorielles OpenFreeMap — sans clé API. On n'en exploite que
        // la couche "building" pour l'extrusion 3D ; le reste n'est pas rendu.
        openfreemap: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
            attribution: '© OpenFreeMap © OpenStreetMap'
        },
        // BD TOPO IGN (tuiles vectorielles, SANS clé, XYZ) — bâtiments officiels
        // français + hauteurs dérivées LiDAR HD (extrusion 3D bien plus précise que l'OSM).
        bdtopo: {
            type: 'vector',
            tiles: ['https://data.geopf.fr/tms/1.0.0/BDTOPO/{z}/{x}/{y}.pbf'],
            minzoom: 0,
            maxzoom: 16,
            attribution: 'BD TOPO © IGN / Géoplateforme'
        }
    },
    layers: [
        { id: 'satellite', type: 'raster', source: 'satellite' },
        {
            id: 'ign-ortho', type: 'raster', source: 'ign-ortho',
            paint: {
                // Fusion seamless Esri → IGN : fondu progressif au zoom sur la bande
                // z11→z13 (l'IGN monte en transparence par-dessus Esri puis devient
                // opaque). Volontairement HAUT : à <z11 (vues régionales où mer/étranger
                // sont dans le champ) on reste sur Esri → pas de tuiles blanches IGN ;
                // l'IGN HD prend le relais une fois zoomé sur une zone française.
                'raster-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 1],
                'raster-fade-duration': 500
            }
        }
    ]
};

/* =====================================================================
 * CACHE CARTOGRAPHIQUE FORCÉ & HORS-LIGNE (Proposition 3 de l'audit)
 *
 * Objectif : disposer EN PERMANENCE d'une vue satellite de la France, même sans
 * réseau (zone rurale, sous-sol). On pré-télécharge la pyramide de tuiles de la
 * métropole à bas niveaux de zoom et on la stocke via la Cache Storage API ; le
 * Service Worker (sw.js) la sert ensuite en « cache-first » en mode déconnecté.
 * ===================================================================== */
const OFFLINE_MAP_CACHE = 'pctac-map-v1';   // doit correspondre à MAP_CACHE dans sw.js
const SAT_TILE_TEMPLATE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Métropole + marge (DOM-TOM exclus du cache de base, trop dispersés).
const FRANCE_BBOX = { west: -5.6, south: 41.1, east: 9.8, north: 51.3 };
// Clé de l'index des AOI confirmées (Persist) : remplace le flag binaire.
const AOI_INDEX_KEY = 'pcTacAoiIndex';
// Garde-fou : nombre max de tuiles d'une AOI (évite d'exploser le volume / le WAF).
const AOI_MAX_TILES = 60000;

/**
 * Construit la LISTE des templates XYZ réellement actifs, lue depuis RASTER_STYLE.
 * On ne code en dur aucune URL : on extrait l'imagerie Esri (satellite), l'IGN BD
 * ORTHO (ign-ortho) et le DEM (terrain-dem) tels que déclarés dans le style. Chaque
 * template porte ses bornes de zoom (minzoom/maxzoom) et son `bounds` éventuel afin
 * de ne pas requêter une source hors de sa couverture (ex. IGN hors métropole).
 * @returns {Array<{id:string, url:string, minzoom:number, maxzoom:number, bounds:(number[]|null)}>}
 */
function _styleTileTemplates() {
    const out = [];
    const src = (RASTER_STYLE.sources) || {};
    for (const id of ['satellite', 'ign-ortho', 'terrain-dem']) {
        const s = src[id];
        if (!s || !Array.isArray(s.tiles) || !s.tiles.length) continue;
        out.push({
            id,
            url: s.tiles[0],
            minzoom: (typeof s.minzoom === 'number') ? s.minzoom : 0,
            maxzoom: (typeof s.maxzoom === 'number') ? s.maxzoom : 19,
            bounds: Array.isArray(s.bounds) ? s.bounds : null  // [west, south, east, north]
        });
    }
    return out;
}

function _lon2tile(lon, z) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z));
}
function _lat2tile(lat, z) {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
/** Remplit un template XYZ ({z}/{x}/{y}, ordre quelconque) avec z/x/y. */
function _fillTileTemplate(tpl, z, x, y) {
    return tpl.replace('{z}', z).replace('{y}', y).replace('{x}', x);
}
function _tileUrl(z, x, y) {
    return _fillTileTemplate(SAT_TILE_TEMPLATE, z, x, y);
}

/**
 * Énumère les requêtes de tuiles XYZ couvrant `bbox` sur [minZ, maxZ] pour CHAQUE
 * template fourni, en respectant les bornes de zoom et le `bounds` de chaque source.
 * @param {{west,south,east,north}} bbox
 * @param {number} minZ
 * @param {number} maxZ
 * @param {Array} templates  issus de _styleTileTemplates()
 * @returns {Array<{url:string}>}
 */
function _enumerateTiles(bbox, minZ, maxZ, templates) {
    const out = [];
    for (const tpl of templates) {
        const zMin = Math.max(minZ, tpl.minzoom);
        const zMax = Math.min(maxZ, tpl.maxzoom);
        // Intersection de l'emprise demandée avec le `bounds` de la source.
        let w = bbox.west, s = bbox.south, e = bbox.east, n = bbox.north;
        if (tpl.bounds) {
            w = Math.max(w, tpl.bounds[0]); s = Math.max(s, tpl.bounds[1]);
            e = Math.min(e, tpl.bounds[2]); n = Math.min(n, tpl.bounds[3]);
        }
        if (w > e || s > n) continue; // pas d'intersection
        for (let z = zMin; z <= zMax; z++) {
            const nbT = Math.pow(2, z);
            const clamp = (v) => Math.max(0, Math.min(nbT - 1, v));
            const x0 = clamp(_lon2tile(w, z));
            const x1 = clamp(_lon2tile(e, z));
            const y0 = clamp(_lat2tile(n, z)); // nord = y le plus petit
            const y1 = clamp(_lat2tile(s, z));
            for (let x = x0; x <= x1; x++) {
                for (let y = y0; y <= y1; y++) {
                    out.push({ url: _fillTileTemplate(tpl.url, z, x, y) });
                }
            }
        }
    }
    return out;
}

/** Estime le nombre de tuiles d'une AOI sans construire le tableau (rapide). */
function _estimateTileCount(bbox, minZ, maxZ, templates) {
    let total = 0;
    for (const tpl of templates) {
        const zMin = Math.max(minZ, tpl.minzoom);
        const zMax = Math.min(maxZ, tpl.maxzoom);
        let w = bbox.west, s = bbox.south, e = bbox.east, n = bbox.north;
        if (tpl.bounds) {
            w = Math.max(w, tpl.bounds[0]); s = Math.max(s, tpl.bounds[1]);
            e = Math.min(e, tpl.bounds[2]); n = Math.min(n, tpl.bounds[3]);
        }
        if (w > e || s > n) continue;
        for (let z = zMin; z <= zMax; z++) {
            const nbT = Math.pow(2, z);
            const clamp = (v) => Math.max(0, Math.min(nbT - 1, v));
            const x0 = clamp(_lon2tile(w, z));
            const x1 = clamp(_lon2tile(e, z));
            const y0 = clamp(_lat2tile(n, z));
            const y1 = clamp(_lat2tile(s, z));
            total += (x1 - x0 + 1) * (y1 - y0 + 1);
        }
    }
    return total;
}

/**
 * Pré-télécharge et met en cache une pyramide de tuiles XYZ pour une emprise et
 * une liste de sources réelles. Backoff exponentiel + RÉESSAI des tuiles
 * manquantes (pas de bypass WAF : on respecte un délai croissant sur échec).
 * @param {{west,south,east,north}} bbox
 * @param {number} minZ
 * @param {number} maxZ
 * @param {Array} templates  issus de _styleTileTemplates()
 * @param {function} onProgress  (done, total, ok, fail) — facultatif
 * @param {{signal?:{aborted:boolean}}} opts  signal.aborted = true → arrêt coopératif
 */
async function _prefetchTiles(bbox, minZ, maxZ, templates, onProgress, opts = {}) {
    if (typeof caches === 'undefined') throw new Error('Cache Storage indisponible.');
    const signal = opts.signal || null;
    const tiles = _enumerateTiles(bbox, minZ, maxZ, templates);
    const cache = await caches.open(OFFLINE_MAP_CACHE);
    let done = 0, ok = 0, fail = 0, cursor = 0;
    const CONCURRENCY = 6;
    const MAX_RETRY = 3;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function fetchOne(url) {
        // Backoff exponentiel normal (pas d'évasion WAF) : 400ms, 800ms, 1600ms…
        for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
            if (signal && signal.aborted) return false;
            try {
                const already = await cache.match(url);
                if (already) return true;
                const resp = await fetch(url, { mode: 'cors', cache: 'force-cache' });
                if (resp && (resp.ok || resp.type === 'opaque')) {
                    await cache.put(url, resp.clone());
                    return true;
                }
            } catch (e) { /* réseau/CORS : on réessaie après backoff */ }
            if (attempt < MAX_RETRY) await sleep(400 * Math.pow(2, attempt));
        }
        return false;
    }

    async function worker() {
        while (cursor < tiles.length) {
            if (signal && signal.aborted) return;
            const t = tiles[cursor++];
            const okTile = await fetchOne(t.url);
            if (okTile) ok++; else fail++;
            done++;
            if (onProgress) { try { onProgress(done, tiles.length, ok, fail); } catch (e) {} }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { total: tiles.length, ok, fail, aborted: !!(signal && signal.aborted) };
}

/**
 * Compat : pré-cache léger de la France (imagerie satellite uniquement, bas zoom)
 * en arrière-plan. Réutilise _prefetchTiles avec le seul template Esri.
 * @param {number} minZ
 * @param {number} maxZ
 * @param {function} onProgress  (done, total, ok, fail) — facultatif
 */
async function _prefetchFranceTiles(minZ, maxZ, onProgress) {
    const satTpl = _styleTileTemplates().filter(t => t.id === 'satellite');
    return _prefetchTiles(FRANCE_BBOX, minZ, maxZ, satTpl, onProgress);
}

export const PlanMap = {
    map: null,
    _pinMarkers: null,  // id -> entry réconcilié (pinMarker/labelMarker/pinWrap/labelEl/sig/pin)
    pendingFreePin: null, // { label, color, kind } en attente d'un clic carte
    searchMarker: null,  // pointeur précis sur l'adresse cherchée
    initialized: false,
    drawTool: null, // 'line' | 'rectangle' | 'circle' | null
    drawColor: '#ef4444',
    drawState: null, // état temporaire pendant un tracé en cours
    drawPreviewLayerIds: ['plan-draw-preview-fill', 'plan-draw-preview-line'],
    history: [],     // pile d'états {shapes} avant chaque modif
    redoStack: [],   // états annulés réutilisables via redo
    is3D: false,     // mode relief 3D actif
    _pinCancel: null, // annule l'épinglage caméra 3D en cours (anti-dérive DEM)
    streetLabelsOn: false, // overlay noms de rues (vectoriel OpenFreeMap)
    _selectedShapeId: null,  // forme actuellement sélectionnée (handles visibles)
    _handleMarkers: [],      // poignées HTML rendues pour la forme sélectionnée
    _textMarkers: [],        // labels HTML pour annotations texte
    _diameterMarkers: [],    // labels HTML pour diamètres de cercle
    _toolbarMarker: null,    // barre flottante (HTML marker) attachée à la forme
    _contextPopup: null,     // popup maplibre actuel (legacy, conservé pour compat)
    _gesture: null,          // état du geste en cours (tap/drag/resize/pinch)
    _diameterGlobal: true,   // toggle global : afficher diamètres (défaut ON)
    _drawingDiameterMarker: null,  // label live pendant le tracé d'un cercle
    _locked: false,          // verrou global : fige la position des pings ET dessins
    _measureState: null,     // état de la mesure en cours {vertices, cursor, reticle}
    _measureLabelMarkers: [],     // labels HTML live de la mesure en cours
    _committedMeasureMarkers: [], // labels HTML des mesures persistées

    /**
     * Enveloppe un handler d'événement : capture toute exception et la journalise,
     * pour qu'une erreur dans UN callback (drag, pointer, geste…) ne casse pas
     * silencieusement l'interaction ni n'interrompe les autres listeners MapLibre.
     */
    _safe(fn, label) {
        return (...args) => {
            try { return fn(...args); }
            catch (e) { console.error('[PlanMap] ' + (label || 'handler') + ' a échoué:', e); }
        };
    },

    init() {
        if (this.initialized) return;
        const mapEl = document.getElementById('plan_map');
        if (!mapEl) return;

        // Garde : si la lib MapLibre n'a pas chargé (CDN bloqué / hors-ligne),
        // on n'essaie pas d'instancier la carte (sinon ReferenceError opaque).
        if (typeof maplibregl === 'undefined') {
            console.error('[PlanMap] MapLibre indisponible (CDN ?).');
            mapEl.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; padding:24px; text-align:center; color:var(--text-muted,#9aa4b2); font-family:var(--font-ui,sans-serif);">'
                + 'Carte indisponible : la librairie cartographique n\'a pas pu être chargée (réseau ?).<br>Reconnecte-toi puis recharge la page.</div>';
            return;
        }

        // Restaure l'état de verrouillage (position des pings/dessins figée).
        try { this._locked = localStorage.getItem('pcTacPlanLocked') === '1'; } catch (_) { this._locked = false; }

        const savedView = this._loadView();
        this.map = new maplibregl.Map({
            container: 'plan_map',
            style: RASTER_STYLE,
            center: savedView.center,
            zoom: savedView.zoom,
            pitch: savedView.pitch || 0,
            bearing: savedView.bearing || 0,
            preserveDrawingBuffer: true // requis pour la capture screenshot
        });
        // NavigationControl avec boussole + bouton pitch visualisé
        this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
        this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

        this.map.on('moveend', this._safe(() => this._saveView(), 'moveend'));
        this.map.on('pitchend', this._safe(() => this._saveView(), 'pitchend'));
        this.map.on('rotateend', this._safe(() => this._saveView(), 'rotateend'));

        // Restaurer le relief 3D si la vue sauvegardée était inclinée
        if (savedView.is3D) {
            this.map.on('load', this._safe(() => this._enable3D(false), 'load:3D'));
        }
        this.map.on('click', this._safe((e) => this._onMapClick(e), 'mapClick'));
        // Double-clic : termine une mesure en cours (sinon comportement zoom natif).
        this.map.on('dblclick', this._safe((e) => {
            if (this.drawTool === 'measure' && this._measureState) {
                if (e.preventDefault) e.preventDefault();
                if (e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault();
                this._finishMeasure();
            }
        }, 'mapDblClick'));

        // Drag-to-draw (mousedown / move / up) — souris ET tactile
        this.map.on('mousedown', this._safe((e) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('mousemove', this._safe((e) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('mouseup',   this._safe((e) => this._handleDrawUp(e), 'drawUp'));
        this.map.on('touchstart',this._safe((e) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('touchmove', this._safe((e) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('touchend',  this._safe((e) => this._handleDrawUp(e), 'drawUp'));

        this._bindUi();

        this.map.on('load', () => {
            this._initDrawingLayers();
            this._bindDrawUi();
            this._bindTextModalOnce();
            this._renderShapes();
            this._renderShapeTexts();
            this._initStreetLabels();
        });

        this._renderPins();
        this.initialized = true;

        // Cache cartographique hors-ligne : pré-chargement automatique en tâche de fond.
        this._initOfflineCache();
    },

    /* ----- CACHE CARTOGRAPHIQUE HORS-LIGNE (Proposition 3) ----- */

    /**
     * Chargement cartographique hors-ligne EN TÂCHE DE FOND (aucun bouton).
     * Au premier passage en ligne, met en cache la pyramide France (zoom 0→8 :
     * vue nationale + détail régional opérationnel), silencieusement et une seule fois.
     */
    _initOfflineCache() {
        try {
            const cached = localStorage.getItem('pcTacFranceTilesCached') === '1';
            if (cached || !navigator.onLine || typeof caches === 'undefined') return;
            _prefetchFranceTiles(0, 8).then(r => {
                // Ne marquer "complet" que si AUCUNE tuile n'a échoué : sinon on
                // retentera au prochain lancement (correction de la pose
                // inconditionnelle qui figeait un cache partiel/cassé).
                if (r && r.fail === 0) {
                    try { localStorage.setItem('pcTacFranceTilesCached', '1'); } catch (e) {}
                }
                console.log('[PlanMap] Carte France pré-cache (tâche de fond) :', r);
            }).catch(e => console.warn('[PlanMap] auto-cache France échoué:', e));
        } catch (e) { /* localStorage / caches indispo : non bloquant */ }
    },

    /** Appelé à chaque switch sur la vue Plan (resize quand le conteneur devient visible) */
    refresh() {
        if (!this.initialized) {
            this.init();
            return;
        }
        // Quand la vue passe de display:none → block, maplibre a besoin d'un resize
        setTimeout(() => this.map && this.map.resize(), 50);
        this._renderPins();
    },

    _loadView() {
        try {
            const v = JSON.parse(localStorage.getItem(VIEW_KEY));
            if (v && v.center && Array.isArray(v.center)) return v;
        } catch (e) {}
        return { center: [2.3522, 48.8566], zoom: 5 }; // Paris par défaut, vue France
    },

    _saveView() {
        if (!this.map) return;
        const c = this.map.getCenter();
        localStorage.setItem(VIEW_KEY, JSON.stringify({
            center: [c.lng, c.lat],
            zoom: this.map.getZoom(),
            pitch: this.map.getPitch(),
            bearing: this.map.getBearing(),
            is3D: this.is3D
        }));
    },

    /** Bascule 2D <-> 3D relief */
    _toggle3D() {
        if (this.is3D) this._disable3D();
        else this._enable3D(true);
    },

    /** Active le relief 3D (terrain DEM + ciel + inclinaison caméra).
     *  @param {boolean} animate - true = incline à 60° si à plat, false = garde le pitch courant */
    _enable3D(animate = true) {
        if (!this.map) return;
        const map = this.map;

        // CIBLE caméra figée AVANT toute modif. C'est le contrat : la vue 3D doit
        // rester EXACTEMENT sur cette zone de focus.
        const target = {
            center:  map.getCenter(),
            zoom:    map.getZoom(),
            bearing: map.getBearing(),
            pitch:   animate ? (map.getPitch() < 20 ? 60 : map.getPitch()) : map.getPitch()
        };

        // Anti-collision : tue toute animation caméra en cours (un easeTo précédent,
        // un double-clic sur le bouton…) avant de toucher au terrain.
        try { map.stop(); } catch (_) {}

        try {
            map.setTerrain({ source: 'terrain-dem', exaggeration: 1.4 });
        } catch (e) {
            console.error('[PlanMap] setTerrain échec:', e);
            alert('Relief 3D indisponible (réseau ?). Les tuiles d\'élévation AWS sont peut-être bloquées.');
            return;
        }
        // Ciel atmosphérique (si supporté par la version MapLibre)
        try {
            if (typeof map.setSky === 'function') {
                map.setSky({
                    'sky-color': '#7ab8e6',
                    'sky-horizon-blend': 0.6,
                    'horizon-color': '#dfeefc',
                    'horizon-fog-blend': 0.6,
                    'fog-color': '#cfd8e0',
                    'fog-ground-blend': 0.4
                });
            }
        } catch (e) { /* ciel optionnel, on ignore */ }

        // Afficher les bâtiments 3D
        try {
            if (map.getLayer('buildings-3d')) {
                map.setLayoutProperty('buildings-3d', 'visibility', 'visible');
            }
        } catch (e) { /* couche absente si init échouée */ }

        this.is3D = true;
        const fab = document.getElementById('plan_btn_3d');
        if (fab) fab.classList.add('active');

        // ÉPINGLAGE : on impose la cible immédiatement (jumpTo instantané, donc rien
        // à "bousculer"), puis on la ré-impose pendant que le DEM se charge en async
        // (c'est lui qui, en arrivant, reframe/recule la vue). Annulé dès interaction.
        this._pinCamera(target);

        this._saveView();
    },

    /**
     * Maintient la caméra EXACTEMENT sur `target` (center/zoom/bearing/pitch) malgré le
     * reframe asynchrone provoqué par le chargement du terrain (DEM). On réimpose la
     * cible à plusieurs reprises (le DEM arrive surtout dans la 1ʳᵉ seconde) jusqu'à
     * stabilisation. Tout est annulé à la PREMIÈRE interaction utilisateur, et un nouvel
     * appel annule l'épinglage précédent (pas de handlers qui s'accumulent).
     */
    _pinCamera(target) {
        if (!this.map) return;
        const map = this.map;
        // Annule un épinglage en cours (toggle rapide / réactivation).
        if (this._pinCancel) { try { this._pinCancel(); } catch (_) {} }

        let cancelled = false;
        const timers = [];
        const apply = () => {
            if (cancelled || !this.is3D) return;
            const c = map.getCenter();
            const drift = Math.abs(c.lng - target.center.lng) > 1e-7
                       || Math.abs(c.lat - target.center.lat) > 1e-7
                       || Math.abs(map.getZoom()  - target.zoom)  > 0.005
                       || Math.abs(map.getPitch() - target.pitch) > 0.4
                       || Math.abs(map.getBearing() - target.bearing) > 0.4;
            if (drift) {
                map.jumpTo({
                    center: target.center, zoom: target.zoom,
                    bearing: target.bearing, pitch: target.pitch
                });
            }
        };
        // Gestes utilisateur uniquement (originalEvent présent) → on rend la main.
        const onUser = (e) => { if (e && e.originalEvent) cancel(); };
        const cancel = () => {
            if (cancelled) return;
            cancelled = true;
            try { map.off('dragstart', onUser); } catch (_) {}
            try { map.off('zoomstart', onUser); } catch (_) {}
            try { map.off('rotatestart', onUser); } catch (_) {}
            try { map.off('idle', apply); } catch (_) {}
            timers.forEach(clearTimeout);
            this._pinCancel = null;
        };
        this._pinCancel = cancel;

        map.on('dragstart', onUser);
        map.on('zoomstart', onUser);
        map.on('rotatestart', onUser);
        map.on('idle', apply);                 // corrige chaque stabilisation du DEM
        // Réimpositions précoces et rapprochées (le DEM arrive tôt), puis on relâche.
        [0, 120, 280, 500, 850, 1300, 1900].forEach(d => timers.push(setTimeout(apply, d)));
        timers.push(setTimeout(() => { try { map.off('idle', apply); } catch (_) {} }, 2400));
    },

    _disable3D() {
        if (!this.map) return;
        const map = this.map;
        // Stoppe l'épinglage 3D et toute animation en cours (anti-collision).
        if (this._pinCancel) { try { this._pinCancel(); } catch (_) {} }
        try { map.stop(); } catch (_) {}

        // CIBLE : même zone de focus, remise à plat (pitch 0, nord en haut).
        const target = { center: map.getCenter(), zoom: map.getZoom(), bearing: 0, pitch: 0 };

        try { map.setTerrain(null); } catch (e) {}
        try { if (typeof map.setSky === 'function') map.setSky(null); } catch (e) {}
        try {
            if (map.getLayer('buildings-3d')) {
                map.setLayoutProperty('buildings-3d', 'visibility', 'none');
            }
        } catch (e) {}
        this.is3D = false;
        const fab = document.getElementById('plan_btn_3d');
        if (fab) fab.classList.remove('active');
        // Retrait du terrain : la vue se ré-aplatit (élévation → 0, prévisible). On
        // impose la cible d'un coup pour éviter tout recul, sans animation à bousculer.
        map.jumpTo(target);
        this._saveView();
    },

    /* ----- OVERLAY NOMS DE RUES (vectoriel OpenFreeMap, keyless) -----
     * Réutilise la source vectorielle 'openfreemap' déjà chargée (schéma OpenMapTiles).
     * Couches ajoutées paresseusement (1er affichage) → aucune tuile vectorielle
     * téléchargée tant que l'overlay reste masqué. Couleur jaune vif + halo sombre
     * pour ressortir nettement sur l'imagerie satellite. */
    _streetLabelPaint() {
        return { 'text-color': '#ffe14d', 'text-halo-color': '#0a0c10', 'text-halo-width': 1.6 };
    },
    _ensureStreetLabelLayers() {
        if (!this.map || this.map.getLayer('street-labels')) return true;
        // NB : NE PAS gater sur isStyleLoaded() — la source vectorielle 'openfreemap'
        // n'ayant aucune couche active, son TileJSON n'est pas encore chargé, donc
        // isStyleLoaded() reste false et les couches ne seraient jamais ajoutées.
        // La source est déclarée dans le style (sync) ; si absente, on diffère.
        if (!this.map.getSource('openfreemap')) { this.map.once('idle', () => this._ensureStreetLabelLayers()); return false; }
        const vis = this.streetLabelsOn ? 'visible' : 'none';
        try {
            // Villes / quartiers
            this.map.addLayer({
                id: 'place-labels', type: 'symbol', source: 'openfreemap', 'source-layer': 'place',
                layout: {
                    visibility: vis,
                    'text-field': ['get', 'name'],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 15, 16, 18],
                    'text-max-width': 8
                },
                paint: this._streetLabelPaint()
            });
            // Noms de rues / routes (placés le long de la voie)
            this.map.addLayer({
                id: 'street-labels', type: 'symbol', source: 'openfreemap', 'source-layer': 'transportation_name',
                layout: {
                    visibility: vis,
                    'text-field': ['get', 'name'],
                    'text-font': ['Noto Sans Regular'],
                    'symbol-placement': 'line',
                    'text-rotation-alignment': 'map',
                    'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 18, 13]
                },
                paint: this._streetLabelPaint()
            });
            return true;
        } catch (e) { console.warn('[PlanMap] couches noms de rues indisponibles:', e); return false; }
    },
    _applyStreetLabelsVisibility() {
        const vis = this.streetLabelsOn ? 'visible' : 'none';
        for (const id of ['street-labels', 'place-labels']) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', vis);
        }
        this._updateStreetLabelsBtn();
    },
    _toggleStreetLabels() {
        if (!this.map) return;
        this.streetLabelsOn = !this.streetLabelsOn;
        if (this.streetLabelsOn) this._ensureStreetLabelLayers();
        this._applyStreetLabelsVisibility();
        try { localStorage.setItem('pcTacStreetLabels', this.streetLabelsOn ? '1' : '0'); } catch (_) {}
    },
    /** Restaure l'état persistant au chargement de la carte. */
    _initStreetLabels() {
        try { this.streetLabelsOn = localStorage.getItem('pcTacStreetLabels') === '1'; } catch (_) { this.streetLabelsOn = false; }
        if (this.streetLabelsOn) this._ensureStreetLabelLayers();
        this._applyStreetLabelsVisibility();
    },
    _updateStreetLabelsBtn() {
        const btn = document.getElementById('plan_btn_labels');
        if (!btn) return;
        btn.classList.toggle('active', !!this.streetLabelsOn);
        btn.title = this.streetLabelsOn ? 'Masquer les noms de rues' : 'Afficher les noms de rues';
    },

    _bindUi() {
        const searchInput = document.getElementById('plan_address_input');
        const searchBtn = document.getElementById('plan_search_btn');
        const searchClose = document.getElementById('plan_search_close');

        if (searchBtn) searchBtn.onclick = () => this._searchAddress();
        if (searchInput) searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._searchAddress(); }
        });
        if (searchClose) searchClose.onclick = () => this._toggleSearchPanel(false);

        // --- Toolbar unifiée : 6 FABs ---
        const btnSearch = document.getElementById('plan_btn_search');
        if (btnSearch) btnSearch.onclick = () => this._toggleSearchPanel();

        const btnFs = document.getElementById('plan_btn_fullscreen');
        if (btnFs) btnFs.onclick = () => this._toggleFullscreen();
        // Maintenir l'icône à jour quel que soit le déclencheur (FAB ou touche Échap)
        ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev =>
            document.addEventListener(ev, () => this._updateFullscreenIcon()));

        const btn3d = document.getElementById('plan_btn_3d');
        if (btn3d) btn3d.onclick = () => this._toggle3D();

        const captureBtn = document.getElementById('plan_btn_capture');
        if (captureBtn) captureBtn.onclick = () => this._takeScreenshot();

        const pingBtn = document.getElementById('plan_btn_ping');
        if (pingBtn) pingBtn.onclick = () => {
            // Roue centrée sur la vue actuelle
            const center = this.map.getCenter();
            this._openCreatePingWheel({ lng: center.lng, lat: center.lat });
        };

        const drawBtn = document.getElementById('plan_btn_draw');
        if (drawBtn) drawBtn.onclick = () => this._toggleDrawDock();

        const labelsBtn = document.getElementById('plan_btn_labels');
        if (labelsBtn) labelsBtn.onclick = () => this._toggleStreetLabels();

        // Téléchargement carte d'une zone d'opération (AOI) hors-ligne (CONTRAT C4).
        const aoiBtn = document.getElementById('plan_btn_aoi');
        if (aoiBtn) aoiBtn.onclick = () => this._startAoiFraming();

        // --- Modale Ping hybride ---
        const pingClose = document.getElementById('pingModalCloseBtn');
        if (pingClose) pingClose.onclick = () => this._closePingModal();
        const freePinConfirm = document.getElementById('freePinConfirmBtn');
        if (freePinConfirm) freePinConfirm.onclick = () => this._armFreePinPlacement();

        // Sélecteur de couleur OTAN dans la modale
        const colorSelect = document.getElementById('free_pin_color_select');
        if (colorSelect) {
            colorSelect.querySelectorAll('.pax-select-option').forEach(btn => {
                btn.onclick = () => {
                    colorSelect.querySelectorAll('.pax-select-option').forEach(b => {
                        b.classList.remove('selected');
                        b.style.background = '';
                        b.style.color = '';
                    });
                    btn.classList.add('selected');
                    btn.style.background = btn.dataset.color;
                    btn.style.color = ['#eab308', '#22c55e', '#94a3b8'].includes(btn.dataset.color) ? '#000' : '#fff';
                    document.getElementById('free_pin_color').value = btn.dataset.color;
                    document.getElementById('free_pin_kind').value = btn.dataset.kind;
                };
            });
            // Sélection par défaut : Inter (bleu)
            const def = colorSelect.querySelector('[data-kind="Inter"]');
            if (def) def.click();
        }
    },

    /** Passe le conteneur de carte en plein écran (ou en sort) */
    _toggleFullscreen() {
        const container = document.getElementById('plan_map').parentElement;
        if (!container) return;
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (!fsEl) {
            const req = container.requestFullscreen || container.webkitRequestFullscreen;
            if (req) req.call(container);
        } else {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) exit.call(document);
        }
    },

    _updateFullscreenIcon() {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        const active = !!fsEl;
        // Sortie de plein écran avec un modal déplacé → on le restaure à sa place.
        if (!active) this._restoreModalFromFullscreen();
        const btn = document.getElementById('plan_btn_fullscreen');
        if (btn) {
            btn.classList.toggle('active', active);
            const icon = btn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = active ? 'fullscreen_exit' : 'fullscreen';
        }
        // La taille du conteneur a changé → MapLibre doit recalculer
        if (this.map) setTimeout(() => this.map.resize(), 60);
    },

    /** Ouvre/ferme le bandeau de recherche */
    _toggleSearchPanel(force) {
        const panel = document.getElementById('plan_search_panel');
        const fab = document.getElementById('plan_btn_search');
        if (!panel) return;
        const shouldOpen = force === undefined ? !panel.classList.contains('open') : force;
        panel.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        if (shouldOpen) {
            const input = document.getElementById('plan_address_input');
            if (input) input.focus();
        }
    },

    /** Détecte une saisie de coordonnées GPS décimales "lat, lng" (sép. , ; ou espace).
     *  Retourne {lat, lng} ou null. */
    _parseGps(str) {
        const m = str.match(/^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
        if (!m) return null;
        // Gère la virgule décimale française : on remplace seulement si pas de séparateur ambigu
        const lat = parseFloat(m[1].replace(',', '.'));
        const lng = parseFloat(m[2].replace(',', '.'));
        if (isNaN(lat) || isNaN(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return { lat, lng };
    },

    async _searchAddress() {
        const input = document.getElementById('plan_address_input');
        const resultsBox = document.getElementById('plan_search_results');
        if (!input || !resultsBox) return;
        const q = input.value.trim();
        if (!q) return;

        // 1) Coordonnées GPS directes → on centre immédiatement
        const gps = this._parseGps(q);
        if (gps) {
            this.map.flyTo({ center: [gps.lng, gps.lat], zoom: 17, speed: 1.4 });
            this._placeSearchMarker(gps.lng, gps.lat, `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`);
            resultsBox.innerHTML = `
                <div class="plan-search-result" style="padding: 8px; border-bottom: 1px solid var(--border-glass); display: flex; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 16px; color: var(--ao-green);">my_location</span>
                    Point GPS centré : ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}
                </div>`;
            return;
        }

        // 2) Sinon, géocodage d'adresse via Nominatim
        resultsBox.innerHTML = '<em style="color: var(--text-muted);">Recherche…</em>';
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
            const r = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const list = await r.json();
            if (!list.length) {
                resultsBox.innerHTML = '<em style="color: var(--text-muted);">Aucun résultat.</em>';
                return;
            }
            // Centrage + pointeur sur le 1er résultat (le plus probable)
            const first = list[0];
            const flng = parseFloat(first.lon), flat = parseFloat(first.lat);
            this.map.flyTo({ center: [flng, flat], zoom: 17, speed: 1.4 });
            this._placeSearchMarker(flng, flat, first.display_name);
            resultsBox.innerHTML = list.map((item, i) => `
                <div class="plan-search-result" data-idx="${i}" style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--border-glass);">
                    ${item.display_name}
                </div>
            `).join('');
            resultsBox.querySelectorAll('.plan-search-result').forEach(div => {
                div.onclick = () => {
                    const item = list[parseInt(div.dataset.idx, 10)];
                    const lng = parseFloat(item.lon), lat = parseFloat(item.lat);
                    this.map.flyTo({ center: [lng, lat], zoom: 17, speed: 1.4 });
                    this._placeSearchMarker(lng, lat, item.display_name);
                    resultsBox.innerHTML = '';
                };
                div.onmouseover = () => { div.style.background = 'rgba(59, 130, 246, 0.15)'; };
                div.onmouseout = () => { div.style.background = ''; };
            });
        } catch (e) {
            console.error('[PlanMap] Nominatim échec:', e);
            resultsBox.innerHTML = '<em style="color: var(--danger-red);">Erreur réseau. Vérifie ta connexion.</em>';
            // On purge le pointeur précédent pour éviter une localisation périmée
            if (this.searchMarker) { this.searchMarker.remove(); this.searchMarker = null; }
        }
    },

    /** Pose (ou déplace) un pointeur précis sur l'adresse cherchée.
     *  Pulse animé pour attirer l'œil. Le marker reste jusqu'à la prochaine
     *  recherche ; on le retire si l'utilisateur clique dessus. */
    _placeSearchMarker(lng, lat, label) {
        if (!this.map) return;
        if (this.searchMarker) {
            this.searchMarker.remove();
            this.searchMarker = null;
        }
        const el = document.createElement('div');
        el.style.cssText = `
            position: relative; width: 32px; height: 32px; cursor: pointer;
        `;
        el.innerHTML = `
            <div style="
                position: absolute; inset: 0;
                border-radius: 50%;
                background: rgba(59,130,246,0.35);
                animation: pctacPulse 1.6s ease-out infinite;
            "></div>
            <div style="
                position: absolute; left: 50%; top: 50%;
                transform: translate(-50%, -50%);
                width: 14px; height: 14px;
                background: #3b82f6;
                border: 3px solid #fff;
                border-radius: 50%;
                box-shadow: 0 0 6px rgba(0,0,0,0.6);
            "></div>
        `;
        // Injecte le keyframe une seule fois
        if (!document.getElementById('pctac-pulse-style')) {
            const s = document.createElement('style');
            s.id = 'pctac-pulse-style';
            s.textContent = `@keyframes pctacPulse {
                0% { transform: scale(0.6); opacity: 0.9; }
                100% { transform: scale(2.2); opacity: 0; }
            }`;
            document.head.appendChild(s);
        }
        const popup = label
            ? new maplibregl.Popup({ offset: 18, closeButton: true }).setHTML(
                `<div style="font-family: var(--font-ui); font-size: 0.9em; max-width: 260px;">${label}</div>`)
            : null;
        const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]);
        if (popup) m.setPopup(popup);
        m.addTo(this.map);
        el.onclick = (ev) => {
            ev.stopPropagation();
            if (popup) popup.addTo(this.map);
        };
        this.searchMarker = m;
    },

    /** Ouvre/ferme le dock de dessin réductible */
    _toggleDrawDock(force) {
        const dock = document.getElementById('plan_draw_dock');
        const fab = document.getElementById('plan_btn_draw');
        if (!dock) return;
        const shouldOpen = force === undefined ? !dock.classList.contains('open') : force;
        dock.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        // Fermer le dock désactive l'outil de dessin en cours
        if (!shouldOpen && this.drawTool) this._setTool(null);
    },

    _openPingModal() {
        document.getElementById('modalBackdrop').style.display = 'block';
        document.getElementById('pingModal').style.display = 'block';
        document.getElementById('free_pin_label').value = '';
        const veh = document.getElementById('free_pin_is_vehicle');
        if (veh) veh.checked = false;
        // Réinit icône
        this._setSelectedIcon('', 'Pin par défaut');
        this._refreshIconSuggestions('');
        const cat = document.getElementById('pin_icon_catalog');
        if (cat) cat.style.display = 'none';
        this._renderPingEntities();
        this._bindIconPickerOnce();
    },

    _closePingModal() {
        document.getElementById('modalBackdrop').style.display = 'none';
        document.getElementById('pingModal').style.display = 'none';
    },

    /** Rend la liste des entités existantes (Adv/Otage/Ami) dans la modale Ping */
    _renderPingEntities() {
        const list = document.getElementById('ping_entities_list');
        if (!list) return;

        const pins = this._loadPins();
        const placedIds = new Set(pins.filter(p => p.entityRef).map(p => `${p.entityRef.kind}:${p.entityRef.id}`));

        const adversaries = Storage.loadCollection(ADVERSARIES_KEY);
        const hostages = Storage.loadCollection(HOSTAGES_KEY);
        const friends = Storage.loadCollection(FRIENDS_KEY);

        const block = (title, items, kind, color) => {
            if (!items.length) return '';
            return `
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 0.7em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">${title}</div>
                    ${items.map(it => {
                        const placed = placedIds.has(`${kind}:${it.id}`);
                        const label = `${it.nom || ''} ${it.prenom || ''}`.trim() || it.unite || '(sans nom)';
                        return `
                            <div class="plan-entity-item" data-kind="${kind}" data-id="${it.id}"
                                 style="display: flex; align-items: center; gap: 6px; padding: 8px 8px; border-radius: 4px; cursor: ${placed ? 'default' : 'pointer'}; background: ${placed ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)'}; border-left: 3px solid ${color}; opacity: ${placed ? 0.6 : 1};">
                                <span style="flex: 1; font-size: 0.9em;">${label}</span>
                                <span style="font-size: 0.7em; color: var(--text-muted);">${placed ? 'placé' : 'à placer'}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        };

        const html =
            block('Adversaires', adversaries, 'adv', ENTITY_COLORS.adv) +
            block('Otages', hostages, 'host', ENTITY_COLORS.host) +
            block('Amis / Unités', friends, 'friend', ENTITY_COLORS.friend);

        list.innerHTML = html || '<div style="color: var(--text-muted); font-size: 0.85em; padding: 6px;">Aucune entité créée. Ajoute des adversaires/otages/amis dans leurs onglets respectifs, ou crée un point libre ci-dessous.</div>';

        list.querySelectorAll('.plan-entity-item').forEach(el => {
            el.onclick = () => {
                const kind = el.dataset.kind;
                const id = el.dataset.id;
                if (placedIds.has(`${kind}:${id}`)) return;
                this.pendingFreePin = null;
                this.pendingEntityPin = { kind, id };
                this._closePingModal();
                this._showHint(`Clique sur la carte pour placer "${el.querySelector('span').textContent.trim()}"`);
            };
        });
    },

    /** Met à jour l'aperçu (glyphe + label) et le champ caché pour l'icône choisie. */
    _setSelectedIcon(iconId, iconLabel) {
        const hidden = document.getElementById('free_pin_icon');
        const glyph = document.getElementById('pin_icon_current_glyph');
        const label = document.getElementById('pin_icon_current_label');
        if (hidden) hidden.value = iconId || '';
        if (glyph) glyph.textContent = iconId || 'place';
        if (label) label.textContent = iconLabel || (iconId ? iconId : 'Pin par défaut');
    },

    /** Liste les icônes les plus pertinentes pour le libellé courant. */
    _refreshIconSuggestions(labelText) {
        const wrap = document.getElementById('pin_icon_suggestions_wrap');
        const box  = document.getElementById('pin_icon_suggestions');
        if (!wrap || !box) return;
        const list = suggestPinIcons(labelText, 6);
        if (!list.length) {
            wrap.style.display = 'none';
            box.innerHTML = '';
            return;
        }
        wrap.style.display = 'block';
        box.innerHTML = list.map(ic => `
            <button type="button" class="pin-icon-suggest"
                data-id="${ic.id}" data-label="${ic.label}"
                title="${ic.label}"
                style="display: inline-flex; align-items: center; gap: 6px;
                       padding: 6px 10px; border-radius: 6px;
                       background: rgba(59,130,246,0.12);
                       border: 1px solid rgba(59,130,246,0.4);
                       color: var(--text-main); cursor: pointer; font-size: 0.85em;">
                <span class="material-symbols-outlined" style="font-size: 20px;">${ic.id}</span>
                ${ic.label}
            </button>
        `).join('');
        box.querySelectorAll('.pin-icon-suggest').forEach(btn => {
            btn.onclick = () => this._setSelectedIcon(btn.dataset.id, btn.dataset.label);
        });
    },

    /** Construit la grille complète du catalogue (groupée par catégorie). */
    _renderIconCatalog(filterText) {
        const grid = document.getElementById('pin_icon_grid');
        if (!grid) return;
        const q = (filterText || '').toLowerCase().trim();
        const filtered = PIN_ICONS.filter(ic => {
            if (!q) return true;
            const hay = (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase();
            return hay.includes(q);
        });
        // Groupage par catégorie
        const byCat = filtered.reduce((acc, ic) => {
            (acc[ic.cat] = acc[ic.cat] || []).push(ic);
            return acc;
        }, {});
        const html = Object.entries(byCat).map(([cat, items]) => `
            <div style="margin-bottom: 10px;">
                <div style="font-size: 0.7em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">${cat}</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px;">
                    ${items.map(ic => `
                        <button type="button" class="pin-icon-cell" data-id="${ic.id}" data-label="${ic.label}"
                            title="${ic.label}"
                            style="display: flex; flex-direction: column; align-items: center; gap: 4px;
                                   padding: 8px 4px; border-radius: 6px;
                                   background: rgba(255,255,255,0.04);
                                   border: 1px solid var(--border-glass);
                                   color: var(--text-main); cursor: pointer; font-size: 0.7em;">
                            <span class="material-symbols-outlined" style="font-size: 24px;">${ic.id}</span>
                            <span style="text-align: center; line-height: 1.1;">${ic.label}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        `).join('') || '<div style="color: var(--text-muted); font-size: 0.85em;">Aucune icône.</div>';
        grid.innerHTML = html;
        grid.querySelectorAll('.pin-icon-cell').forEach(btn => {
            btn.onclick = () => {
                this._setSelectedIcon(btn.dataset.id, btn.dataset.label);
                const cat = document.getElementById('pin_icon_catalog');
                if (cat) cat.style.display = 'none';
            };
        });
    },

    /** Branche les listeners du picker (une seule fois par session). */
    _bindIconPickerOnce() {
        if (this._iconPickerBound) {
            // À chaque ouverture on rafraîchit juste le catalogue (au cas où)
            this._renderIconCatalog('');
            return;
        }
        this._iconPickerBound = true;

        const labelInput = document.getElementById('free_pin_label');
        if (labelInput) {
            labelInput.addEventListener('input', (e) => this._refreshIconSuggestions(e.target.value));
        }
        const toggle = document.getElementById('pin_icon_picker_toggle');
        const catalog = document.getElementById('pin_icon_catalog');
        if (toggle && catalog) {
            toggle.onclick = () => {
                const open = catalog.style.display !== 'none';
                catalog.style.display = open ? 'none' : 'block';
                if (!open) this._renderIconCatalog(document.getElementById('pin_icon_search')?.value || '');
            };
        }
        const search = document.getElementById('pin_icon_search');
        if (search) {
            search.addEventListener('input', (e) => this._renderIconCatalog(e.target.value));
        }
        this._renderIconCatalog('');
    },

    _armFreePinPlacement() {
        const label = document.getElementById('free_pin_label').value.trim();
        const color = document.getElementById('free_pin_color').value;
        let kind = document.getElementById('free_pin_kind').value;
        const isVehicle = document.getElementById('free_pin_is_vehicle')?.checked;
        if (isVehicle) kind = 'Vehicule';
        const icon = (document.getElementById('free_pin_icon')?.value || '').trim();
        if (!label) return alert('Libellé requis');
        this.pendingEntityPin = null;
        this.pendingFreePin = { label, color, kind, icon };
        this._closePingModal();
        this._showHint(`Clique sur la carte pour placer "${label}"`);
    },

    _onMapClick(e) {
        // Outil mesure : chaque clic/tap pose un sommet (machine d'états dédiée).
        // On le traite AVANT la garde drawTool ci-dessous.
        if (this.drawTool === 'measure') {
            if (this._measureState) this._measureAddVertex([e.lngLat.lng, e.lngLat.lat]);
            return;
        }
        // Pendant le drawing, les clics sont gérés par mousedown/up
        if (this.drawTool) return;
        if (this.pendingEntityPin) {
            const { kind, id } = this.pendingEntityPin;
            this._addPin({
                id: `${kind}_${id}_${Date.now()}`,
                entityRef: { kind, id },
                lng: e.lngLat.lng,
                lat: e.lngLat.lat
            });
            this.pendingEntityPin = null;
            this._hideHint();
            return;
        }
        if (this.pendingFreePin) {
            const { label, color, kind, icon } = this.pendingFreePin;
            this._addPin({
                id: 'free_' + Date.now(),
                label, color, kind, icon,
                lng: e.lngLat.lng,
                lat: e.lngLat.lat
            });
            this.pendingFreePin = null;
            this._hideHint();
        }
    },

    _addPin(pin) {
        const pins = this._loadPins();
        pins.push(pin);
        this._savePins(pins);
        this._renderPins();
    },

    _removePin(id) {
        const pins = this._loadPins().filter(p => p.id !== id);
        this._savePins(pins);
        this._renderPins();
    },

    _loadPins() {
        // Persist.get tolère localStorage indisponible, JSON corrompu (→ .bak) et
        // valide que c'est bien un tableau ; fallback [] dans tous les cas.
        return Persist.get(PINS_KEY, { validator: Array.isArray, fallback: [] }) || [];
    },

    _savePins(pins) {
        // Via Persist → garde QuotaExceededError (événement 'pctac:quota' non bloquant,
        // ne jette jamais). Pas d'alert ici : la persistance des pings ne doit pas
        // bloquer le déplacement tactile sur le terrain.
        Persist.set(PINS_KEY, pins);
    },

    _resolvePin(pin) {
        // Calcule label + couleur effectifs (entité ou libre)
        if (pin.entityRef) {
            const { kind, id } = pin.entityRef;
            const map = { adv: ADVERSARIES_KEY, host: HOSTAGES_KEY, friend: FRIENDS_KEY };
            const item = Storage.loadCollection(map[kind]).find(i => i.id === id);
            const label = item ? (`${item.nom || ''} ${item.prenom || ''}`.trim() || item.unite || '(sans nom)') : '[supprimé]';
            return { label, color: ENTITY_COLORS[kind], kind };
        }
        return { label: pin.label, color: pin.color, kind: pin.kind || 'libre' };
    },

    // Signature légère d'un ping : tout ce qui change le rendu visuel ou le binding.
    // Si elle est identique entre deux rendus, on ne touche pas au DOM (zéro jank).
    // La position (lng/lat) est incluse pour repositionner via setLngLat sans recréer.
    _pinSignature(pin) {
        const { label, color, kind } = this._resolvePin(pin);
        const text = (pin.text && pin.text.trim()) ? pin.text : label;
        return [
            pin.lng, pin.lat,
            color, kind,
            pin.icon || '',
            pin.kind || '',
            text,
            pin.locked ? 1 : 0,
            this._locked ? 1 : 0
        ].join('|');
    },

    // (Re)construit le contenu visuel d'un ping (pinWrap + labelEl) à partir de
    // entry.pin (toujours à jour). Renvoie le labelOffset pour le marker label.
    /**
     * Applique le style visuel d'un cadenas (verrouillé = jaune plein, sinon gris translucide).
     * @param {HTMLElement} badge
     * @param {boolean} locked
     * @param {'corner'|'marker'} variant  'corner' = coin d'un ping ; 'marker' = marqueur centré d'une forme
     */
    _applyLockBadgeStyle(badge, locked, variant) {
        badge.textContent = locked ? 'lock' : 'lock_open';
        badge.title = locked
            ? 'Verrouillé — cliquer pour déverrouiller'
            : 'Cliquer pour verrouiller (fige la position)';
        badge.setAttribute('aria-label', badge.title);
        const common = `line-height:1; cursor:pointer; pointer-events:auto; user-select:none;`
            + ` color:${locked ? '#eab308' : '#e5e7eb'};`
            + ` background:rgba(15,18,24,${locked ? '0.95' : '0.7'});`
            + ` box-shadow:0 1px 3px rgba(0,0,0,0.6); border-radius:50%;`
            + ` opacity:${locked ? '1' : '0.82'}; z-index:3;`;
        badge.style.cssText = (variant === 'corner')
            ? common + ` position:absolute; top:-7px; right:-7px; font-size:13px; padding:2px;`
            : common + ` font-size:16px; padding:4px; display:flex; align-items:center; justify-content:center;`;
    },

    /**
     * Fabrique un cadenas cliquable (élément span Material Symbols). Le clic bascule
     * le verrou via `onToggle` ; les pointerdown/mousedown/touchstart sont stoppés pour
     * ne PAS déclencher le drag natif du marker ni la sélection de la forme sous-jacente.
     */
    _makeLockBadge(locked, onToggle, variant) {
        const badge = document.createElement('span');
        badge.className = 'plan-lock-badge material-symbols-outlined';
        this._applyLockBadgeStyle(badge, locked, variant);
        const stop = (e) => { e.stopPropagation(); };
        badge.addEventListener('pointerdown', stop);
        badge.addEventListener('mousedown', stop);
        badge.addEventListener('touchstart', stop, { passive: true });
        badge.addEventListener('click', this._safe((e) => {
            e.stopPropagation();
            if (e.preventDefault) e.preventDefault();
            onToggle();
        }, 'lockBadge:click'));
        return badge;
    },

    _buildPinVisual(entry) {
        const pin = entry.pin;
        const { label, color, kind } = this._resolvePin(pin);
        const isVehicle = (pin.kind === 'Vehicule');
        const customIcon = pin.icon && pin.icon.trim();
        const pinWrap = entry.pinWrap;
        let labelOffset;

        const locked = !!pin.locked;
        const cursor = (locked || this._locked) ? 'pointer' : 'grab';
        if (customIcon || isVehicle) {
            const glyph = customIcon || 'directions_car';
            // NB : pas de `position` inline ici — l'élément du marqueur est déjà
            // `position:absolute` via la classe .maplibregl-marker. L'écraser (relative)
            // casse le positionnement carte (dérive au zoom + décalage du label).
            // Le badge cadenas (position:absolute) s'ancre donc déjà sur ce wrap.
            pinWrap.style.cssText = `width: 38px; height: 38px; cursor: ${cursor}; display: flex; align-items: center; justify-content: center;`;
            pinWrap.innerHTML = `
                <span class="material-symbols-outlined" style="
                    font-size: 36px;
                    color: ${color};
                    text-shadow:
                        0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff,
                        0 2px 4px rgba(0,0,0,0.6);
                    line-height: 1;
                    font-variation-settings: 'FILL' 1;
                ">${glyph}</span>
            `;
            labelOffset = [0, 22]; // sous l'icône
        } else {
            pinWrap.style.cssText = `width: 26px; height: 36px; cursor: ${cursor};`;
            pinWrap.innerHTML = `
                <svg width="26" height="36" viewBox="0 0 22 30" style="display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5));">
                    <path d="M11,0 C5,0 0,5 0,11 C0,18 11,30 11,30 C11,30 22,18 22,11 C22,5 17,0 11,0 Z"
                          fill="${color}" stroke="#fff" stroke-width="2"/>
                    <circle cx="11" cy="11" r="4" fill="#fff"/>
                </svg>
            `;
            labelOffset = [0, 5];
        }

        // Cadenas cliquable TOUJOURS visible : verrouille/déverrouille CE ping.
        // Verrouillé = position figée (le drag natif est désactivé côté marker).
        const pinId = pin.id;
        pinWrap.appendChild(
            this._makeLockBadge(locked, () => this._togglePinLock(pinId, false), 'corner')
        );

        // L'ancre dépend du type → si elle change, on doit la réappliquer.
        const anchor = (customIcon || isVehicle) ? 'center' : 'bottom';
        if (entry.pinMarker && entry._anchor !== anchor) {
            try { entry.pinMarker.setOffset([0, 0]); } catch (_) {}
            // maplibre n'expose pas setAnchor ; l'ancre est figée à la création.
            // Pour rester robuste sans recréer le marker (et perdre les listeners),
            // on compense via l'offset du label seulement ; le pin reste à son ancre
            // d'origine. _anchor est mémorisé pour info.
            entry._anchor = anchor;
        } else if (entry.pinMarker) {
            entry._anchor = anchor;
        }

        // Label : texte custom prioritaire sur le label kind.
        const displayLabel = pin.text && pin.text.trim() ? pin.text : label;
        entry.labelEl.textContent = displayLabel;
        entry.labelEl.style.cssText = `
            padding: 3px 8px;
            background: rgba(0,0,0,0.78);
            color: #fff;
            font-family: var(--font-ui);
            font-size: 13px;
            line-height: 1.2;
            border-left: 4px solid ${color};
            border-radius: 3px;
            white-space: nowrap;
            box-shadow: 0 1px 3px rgba(0,0,0,0.6);
            pointer-events: none;
            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            letter-spacing: 0.3px;
        `;
        return labelOffset;
    },

    // Attache UNE SEULE FOIS les listeners (tap/double-tap/drag) sur l'entry.
    // Tous lisent entry.pin (mis à jour à chaque réconciliation) → pas de closure
    // stale, pas de listeners orphelins, pas de jank tactile.
    _bindPinListeners(entry) {
        const pinWrap = entry.pinWrap;
        const pinMarker = entry.pinMarker;
        let pdStart = null;
        let originalLngLat = null;

        // Cercle de diamètre live pendant le drag (lit entry.pin courant).
        const updateLiveCircle = (ll) => {
            const pin = entry.pin;
            if (!(pin.diameterM && pin.diameterM > 0)) return;
            const src = this.map.getSource && this.map.getSource('plan-pin-circles-src');
            if (!src || !this._pinCircleFeatures) return;
            const center = [ll.lng, ll.lat];
            const radiusM = pin.diameterM / 2;
            const edge = this._geoEdgeNorth(center, radiusM);
            const coords = this._circlePolygon(center, edge);
            const idx = this._pinCircleFeatures.findIndex(f =>
                f.properties && f.properties._pinId === pin.id
            );
            if (idx === -1) return;
            this._pinCircleFeatures[idx] = {
                ...this._pinCircleFeatures[idx],
                geometry: { type: 'Polygon', coordinates: [coords] }
            };
            src.setData({ type: 'FeatureCollection', features: this._pinCircleFeatures });
        };
        entry._updateLiveCircle = updateLiveCircle;

        const onDown = (clientX, clientY, isTouch) => {
            pdStart = { x: clientX, y: clientY, t: Date.now(), isTouch };
            originalLngLat = pinMarker.getLngLat();
        };

        const onUp = (clientX, clientY, ev) => {
            if (!pdStart) return;
            const dx = clientX - pdStart.x, dy = clientY - pdStart.y;
            const moved = Math.hypot(dx, dy);
            const dt = Date.now() - pdStart.t;
            const threshold = pdStart.isTouch ? 20 : 6;
            const maxTime = pdStart.isTouch ? 350 : 500;
            const isTap = moved < threshold && dt < maxTime;
            pdStart = null;
            if (!isTap) return;

            ev.stopPropagation();
            ev.preventDefault();

            const pinId = entry.pin.id;
            if (originalLngLat) {
                pinMarker.setLngLat(originalLngLat);
                entry.labelMarker.setLngLat(originalLngLat);
                const dm = this._pinDiameterLabels && this._pinDiameterLabels[pinId];
                if (dm) dm.setLngLat(originalLngLat);
                updateLiveCircle(originalLngLat);
            }

            const now = Date.now();
            const prev = this._lastPinTap;
            if (prev && prev.id === pinId && (now - prev.t) < 350) {
                this._lastPinTap = null;
                this._openPingOptionsWheel(pinId);
            } else {
                this._lastPinTap = { id: pinId, t: now };
            }
        };

        const onLockBadge = (ev) => !!(ev.target && ev.target.closest && ev.target.closest('.plan-lock-badge'));
        pinWrap.addEventListener('pointerdown', this._safe((ev) => {
            if (onLockBadge(ev)) return;   // clic sur le cadenas : ne pas amorcer un geste de ping
            onDown(ev.clientX, ev.clientY, ev.pointerType === 'touch');
        }, 'pin:pointerdown'), { capture: true });
        pinWrap.addEventListener('pointermove', this._safe(() => {
            /* le drag natif maplibre gère le déplacement */
        }, 'pin:pointermove'), { capture: true });
        pinWrap.addEventListener('pointerup', this._safe((ev) => {
            if (onLockBadge(ev)) return;   // idem au relâchement (évite un faux tap)
            onUp(ev.clientX, ev.clientY, ev);
        }, 'pin:pointerup'), { capture: true });
        pinWrap.addEventListener('pointercancel', this._safe(() => {
            pdStart = null;
        }, 'pin:pointercancel'), { capture: true });

        pinMarker.on('dragstart', this._safe(() => {
            pinWrap.style.cursor = 'grabbing';
            pinWrap.style.opacity = '0.85';
            entry.labelEl.style.opacity = '0.5';
        }, 'pin:dragstart'));
        pinMarker.on('drag', this._safe(() => {
            const ll = pinMarker.getLngLat();
            entry.labelMarker.setLngLat(ll);
            updateLiveCircle(ll);
            const dm = this._pinDiameterLabels && this._pinDiameterLabels[entry.pin.id];
            if (dm) dm.setLngLat(ll);
        }, 'pin:drag'));
        pinMarker.on('dragend', this._safe(() => {
            pinWrap.style.cursor = 'grab';
            pinWrap.style.opacity = '1';
            entry.labelEl.style.opacity = '1';
            const ll = pinMarker.getLngLat();
            entry.labelMarker.setLngLat(ll);
            const pinId = entry.pin.id;
            const allPins = this._loadPins();
            const target = allPins.find(p => p.id === pinId);
            if (target) {
                target.lng = ll.lng;
                target.lat = ll.lat;
                this._savePins(allPins);
                // Maintient entry.pin cohérent avec la nouvelle position.
                entry.pin = target;
            }
            this._renderPinDecorations();
        }, 'pin:dragend'));
    },

    // Réconciliation par ID : on ne détruit/recrée QUE le strict nécessaire.
    //  - nouveau ping        → création + binding des listeners (une seule fois)
    //  - signature changée   → maj EN PLACE (position + contenu DOM)
    //  - id disparu          → suppression du marker
    _renderPins() {
        if (!this.map) return;
        if (!this._pinMarkers) this._pinMarkers = new Map(); // id -> entry

        const pins = this._loadPins();
        const seen = new Set();

        for (const pin of pins) {
            seen.add(pin.id);
            const sig = this._pinSignature(pin);
            let entry = this._pinMarkers.get(pin.id);

            if (!entry) {
                // --- CRÉATION ---
                const pinWrap = document.createElement('div');
                const labelEl = document.createElement('div');
                entry = { pin, pinWrap, labelEl, pinMarker: null, labelMarker: null, sig: null, _anchor: null };

                const isVehicle = (pin.kind === 'Vehicule');
                const customIcon = pin.icon && pin.icon.trim();
                const anchor = (customIcon || isVehicle) ? 'center' : 'bottom';

                const labelOffset = this._buildPinVisual(entry);
                entry._anchor = anchor;

                entry.pinMarker = new maplibregl.Marker({ element: pinWrap, anchor, draggable: !this._locked && !pin.locked })
                    .setLngLat([pin.lng, pin.lat])
                    .addTo(this.map);
                entry.labelMarker = new maplibregl.Marker({ element: labelEl, anchor: 'top', offset: labelOffset })
                    .setLngLat([pin.lng, pin.lat])
                    .addTo(this.map);

                // Listeners attachés UNE SEULE FOIS.
                this._bindPinListeners(entry);

                entry.sig = sig;
                this._pinMarkers.set(pin.id, entry);
            } else if (entry.sig !== sig) {
                // --- MAJ EN PLACE ---
                entry.pin = pin;
                // Position (toujours sûr de la resync, peu coûteux).
                entry.pinMarker.setLngLat([pin.lng, pin.lat]);
                entry.labelMarker.setLngLat([pin.lng, pin.lat]);
                // Contenu visuel + offset du label.
                const labelOffset = this._buildPinVisual(entry);
                try { entry.labelMarker.setOffset(labelOffset); } catch (_) {}
                // État draggable (verrou global OU individuel) sans recréer le marker.
                try {
                    entry.pinMarker.setDraggable(!this._locked && !pin.locked);
                } catch (_) {}
                entry.sig = sig;
            } else {
                // Signature identique : on garde entry.pin pointé sur l'objet courant
                // (les coords peuvent être référentiellement neuves après reload).
                entry.pin = pin;
            }
        }

        // --- SUPPRESSION des ids disparus uniquement ---
        for (const [id, entry] of this._pinMarkers) {
            if (seen.has(id)) continue;
            try { entry.pinMarker && entry.pinMarker.remove(); } catch (_) {}
            try { entry.labelMarker && entry.labelMarker.remove(); } catch (_) {}
            this._pinMarkers.delete(id);
        }

        // Re-render des cercles de diamètre & texte des pings.
        this._renderPinDecorations();
    },

    // ============================================================
    // ============  PINGS : décorations (diamètre + texte) =======
    // ============================================================
    _renderPinDecorations() {
        if (this._pinDecoMarkers) this._pinDecoMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        this._pinDecoMarkers = [];
        if (this._pinDiameterSrc) {
            try { this.map.getSource('plan-pin-circles-src').setData({ type: 'FeatureCollection', features: [] }); } catch (_) {}
        }
        if (!this.map) return;

        // Cercles géodésiques pour les pings avec diameterM
        // On garde une copie locale `_pinCircleFeatures` pour pouvoir mettre à jour
        // une feature individuelle live pendant le drag (par _pinId dans properties).
        // `pin.showDiameter === false` permet de masquer le cercle sans perdre la valeur.
        const circleFeatures = [];
        for (const pin of this._loadPins()) {
            if (pin.diameterM && pin.diameterM > 0 && pin.showDiameter !== false) {
                const center = [pin.lng, pin.lat];
                const radiusM = pin.diameterM / 2;
                // Arête géodésique due nord (rayon terrestre R unifié) plutôt que
                // l'approximation 111320 m/° : cercle exact = diameterM à toute latitude.
                const edge = this._geoEdgeNorth(center, radiusM);
                const coords = this._circlePolygon(center, edge);
                circleFeatures.push({
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [coords] },
                    properties: { color: pin.color || '#3b82f6', _pinId: pin.id }
                });
            }
        }
        this._pinCircleFeatures = circleFeatures;
        // Labels textuels du diamètre pour chaque ping concerné
        this._pinDiameterLabels = {};
        if (this._diameterGlobal) {
            for (const pin of this._loadPins()) {
                if (!(pin.diameterM && pin.diameterM > 0 && pin.showDiameter !== false)) continue;
                const div = document.createElement('div');
                div.className = 'plan-diameter-label';
                div.textContent = `⌀ ${this._formatDistance(pin.diameterM)}`;
                div.style.cssText = `
                    background: rgba(20,24,32,0.85);
                    color: #fff;
                    padding: 3px 9px;
                    border-radius: 10px;
                    border: 1px solid ${pin.color || '#3b82f6'};
                    font-family: var(--font-data, ui-monospace, monospace);
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                    pointer-events: none;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.5);
                `;
                const m = new maplibregl.Marker({ element: div, anchor: 'top', offset: [0, 56] })
                    .setLngLat([pin.lng, pin.lat]).addTo(this.map);
                this._pinDecoMarkers.push(m);
                this._pinDiameterLabels[pin.id] = m;
            }
        }
        // Source/layer pour les cercles de ping
        if (!this._pinDiameterSrc && this.map.getSource && circleFeatures.length) {
            try {
                this.map.addSource('plan-pin-circles-src', {
                    type: 'geojson', data: { type: 'FeatureCollection', features: circleFeatures }
                });
                this.map.addLayer({
                    id: 'plan-pin-circles-fill',
                    type: 'fill',
                    source: 'plan-pin-circles-src',
                    paint: {
                        'fill-color': ['coalesce', ['get', 'color'], '#3b82f6'],
                        'fill-opacity': 0.10
                    }
                });
                this.map.addLayer({
                    id: 'plan-pin-circles-line',
                    type: 'line',
                    source: 'plan-pin-circles-src',
                    paint: {
                        'line-color': ['coalesce', ['get', 'color'], '#3b82f6'],
                        'line-width': 2,
                        'line-dasharray': [3, 3],
                        'line-opacity': 0.8
                    }
                });
                this._pinDiameterSrc = true;
            } catch (e) {
                console.error('[PlanMap] couche cercles ping échec:', e);
            }
        } else if (this._pinDiameterSrc) {
            try { this.map.getSource('plan-pin-circles-src').setData({ type: 'FeatureCollection', features: circleFeatures }); } catch (_) {}
        }
    },

    // ============================================================
    // ===================  DESSINS (shapes)  =====================
    // ============================================================

    _initDrawingLayers() {
        // --- Bâtiments 3D (extrusion IGN BD TOPO : emprises + hauteurs LiDAR HD) ---
        // Masqués par défaut, activés avec le mode 3D. Ajoutés en premier
        // pour rester sous les dessins/annotations.
        try {
            this.map.addLayer({
                id: 'buildings-3d',
                type: 'fill-extrusion',
                source: 'bdtopo',
                'source-layer': 'batiment',
                minzoom: 13,
                filter: ['!=', ['get', 'etat_de_l_objet'], 'En projet'],
                layout: { visibility: 'none' },
                paint: {
                    'fill-extrusion-color': '#c2cad2',
                    // Hauteur : priorité au delta d'altitudes LiDAR HD (toit - sol) ;
                    // sinon champ 'hauteur' (peu rempli) ; sinon étages × 3 m ; sinon 6 m.
                    'fill-extrusion-height': [
                        'case',
                        ['all', ['has', 'altitude_maximale_toit'], ['has', 'altitude_minimale_sol']],
                            ['max', 2, ['-', ['get', 'altitude_maximale_toit'], ['get', 'altitude_minimale_sol']]],
                        ['has', 'hauteur'], ['max', 2, ['get', 'hauteur']],
                        ['has', 'nombre_d_etages'], ['*', ['get', 'nombre_d_etages'], 3],
                        6
                    ],
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': 0.85
                }
            });
        } catch (e) {
            console.error('[PlanMap] couche bâtiments 3D échec:', e);
        }

        // Source "committed" (dessins persistés)
        this.map.addSource('plan-shapes-src', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        this.map.addLayer({
            id: 'plan-shapes-fill',
            type: 'fill',
            source: 'plan-shapes-src',
            // Polygones (rect/circle) mais pas les "hit zones" des annotations texte
            filter: ['all',
                ['==', ['geometry-type'], 'Polygon'],
                ['!=', ['get', 'isText'], true]
            ],
            paint: {
                'fill-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'fill-opacity': 0.18
            }
        });
        this.map.addLayer({
            id: 'plan-shapes-line-hit',
            type: 'line',
            source: 'plan-shapes-src',
            filter: ['!=', ['get', 'isText'], true],
            paint: {
                'line-color': '#000',
                'line-width': 28,
                'line-opacity': 0
            }
        });
        this.map.addLayer({
            id: 'plan-shapes-line',
            type: 'line',
            source: 'plan-shapes-src',
            // Lignes uniquement (pas les zones hit-test des textes)
            filter: ['!=', ['get', 'isText'], true],
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                // Épaisseur pilotée par la donnée (réglable via la roue : Épaisseur -/+)
                'line-width': ['coalesce', ['get', 'strokeWidth'], 3],
                'line-opacity': 0.9
            }
        });
        // Hit-test invisible pour les annotations texte libres
        this.map.addLayer({
            id: 'plan-shapes-text-hit',
            type: 'fill',
            source: 'plan-shapes-src',
            filter: ['==', ['get', 'isText'], true],
            paint: { 'fill-color': '#000', 'fill-opacity': 0 }
        });

        // Source "preview" (dessin en cours)
        this.map.addSource('plan-draw-preview-src', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        this.map.addLayer({
            id: 'plan-draw-preview-fill',
            type: 'fill',
            source: 'plan-draw-preview-src',
            filter: ['in', ['geometry-type'], ['literal', ['Polygon']]],
            paint: {
                'fill-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'fill-opacity': 0.12
            }
        });
        this.map.addLayer({
            id: 'plan-draw-preview-line',
            type: 'line',
            source: 'plan-draw-preview-src',
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'line-width': 2,
                'line-dasharray': [2, 2],
                'line-opacity': 0.9
            }
        });

        // Gestes sur formes : pointerdown unifié → décide tap (menu) vs drag (déplacement)
        //  - Tap court & immobile → menu contextuel (Déplacer/Redim/Texte/Suppr)
        //  - Drag (mouvement > 6px) → déplacement direct, mobile + PC
        //  - Sans hit sur une forme → la carte panote normalement (maplibre natif)
        const layers = ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit'];
        layers.forEach(layerId => {
            this.map.on('mousedown',  layerId, this._safe((e) => this._shapePointerDown(e), 'shapeDown'));
            this.map.on('touchstart', layerId, this._safe((e) => this._shapePointerDown(e), 'shapeDown'));
            // Curseur indicatif au survol
            this.map.on('mouseenter', layerId, () => {
                if (!this.drawTool && !this.moveState && !this._gesture) this.map.getCanvas().style.cursor = 'grab';
            });
            this.map.on('mouseleave', layerId, () => {
                if (!this.drawTool && !this.moveState && !this._gesture) this.map.getCanvas().style.cursor = '';
            });
        });

        // Re-render des textes quand le zoom/move change (les bornes pixel évoluent)
        let textsTick = null;
        const scheduleTexts = () => {
            if (textsTick) return;
            textsTick = requestAnimationFrame(() => {
                textsTick = null;
                this._renderShapeTexts();
                this._renderDiameters();
            });
        };
        this.map.on('zoom', scheduleTexts);
        this.map.on('move', scheduleTexts);

        // Tap court sur zone vide → désélectionne uniquement.
        // Pour créer un ping : long-press (500 ms) ou FAB add_location.
        this.map.on('click', (e) => {
            if (this.drawTool || this.moveState || this._gesture) return;
            if (this._wheelJustClosed && Date.now() - this._wheelJustClosed < 250) return;
            const hits = this.map.queryRenderedFeatures(e.point, {
                layers: ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit']
            });
            if (hits.length) return;
            if (this._selectedShapeId) this._deselectShape();
        });

        // Long-press sur zone vide → ouvre la roue de création de ping (Google Maps style).
        this._wireLongPressForPing();
        // Échap → désélectionne
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._selectedShapeId && !this.moveState && !this._gesture) {
                this._deselectShape();
            }
        });
    },

    _bindDrawUi() {
        document.querySelectorAll('.plan-draw-btn').forEach(btn => {
            btn.onclick = () => this._setTool(btn.dataset.tool);
        });
        // Clic long sur l'outil MESURE → anneaux d'engagement 50/100/200 m
        // (réutilise le centre de carte). N'altère pas le clic court (= outil mesure).
        const measureBtn = document.querySelector('.plan-draw-btn[data-tool="measure"]');
        if (measureBtn) {
            measureBtn.title = 'Mesurer distance / azimut — appui long : anneaux d\'engagement 50/100/200 m';
            let lpTimer = null, lpFired = false;
            const startLp = () => {
                lpFired = false;
                lpTimer = setTimeout(() => {
                    lpFired = true;
                    // Si une mesure est active, on la quitte pour ne pas mélanger les états.
                    if (this.drawTool === 'measure') this._setTool(null);
                    this._addEngagementRings();
                }, 550);
            };
            const cancelLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
            measureBtn.addEventListener('pointerdown', this._safe(startLp, 'measureLp:down'));
            measureBtn.addEventListener('pointerup', this._safe(cancelLp, 'measureLp:up'));
            measureBtn.addEventListener('pointerleave', this._safe(cancelLp, 'measureLp:leave'));
            measureBtn.addEventListener('pointercancel', this._safe(cancelLp, 'measureLp:cancel'));
            // Le clic court ne doit pas activer l'outil si le long-press a déjà agi.
            measureBtn.addEventListener('click', (e) => {
                if (lpFired) { e.preventDefault(); e.stopImmediatePropagation(); lpFired = false; }
            }, true);
        }
        document.querySelectorAll('.plan-draw-color').forEach(btn => {
            btn.onclick = () => this._setDrawColor(btn.dataset.color);
        });
        const clearBtn = document.getElementById('plan_draw_clear');
        if (clearBtn) clearBtn.onclick = () => {
            if (!confirm('Effacer tous les dessins ?')) return;
            this._pushHistory();
            this._saveShapes([]);
            this._renderShapes();
            this._refreshUndoRedoButtons();
        };

        const undoBtn = document.getElementById('plan_draw_undo');
        if (undoBtn) undoBtn.onclick = () => this._undo();
        const redoBtn = document.getElementById('plan_draw_redo');
        if (redoBtn) redoBtn.onclick = () => this._redo();
        this._refreshUndoRedoButtons();

        const diamBtn = document.getElementById('plan_draw_diameter_toggle');
        if (diamBtn) diamBtn.onclick = () => this._toggleGlobalDiameter();

        const lockBtn = document.getElementById('plan_draw_lock');
        if (lockBtn) lockBtn.onclick = () => this._toggleLock();
        this._updateLockButton();

        // Raccordement des boutons de précision tactique (mobile)
        const pStart = document.getElementById('plan_draw_precision_start');
        const pConfirm = document.getElementById('plan_draw_precision_confirm');
        const pCancel = document.getElementById('plan_draw_precision_cancel');

        if (pStart) {
            pStart.onclick = () => {
                if (!this.drawTool) return;
                const center = this.map.getCenter();
                const lngLat = [center.lng, center.lat];

                if (this.drawTool === 'text') {
                    this._addFreeText(center);
                    this._setTool(null);
                    return;
                }

                this.drawState = { start: lngLat, current: lngLat };

                // Afficher Valider / Annuler
                pStart.style.display = 'none';
                if (pConfirm) pConfirm.style.display = 'flex';
                if (pCancel) pCancel.style.display = 'flex';

                // Générer un premier aperçu
                this._handleDrawMove({ lngLat: center });
            };
        }

        if (pConfirm) {
            pConfirm.onclick = () => {
                if (!this.drawTool || !this.drawState) return;
                const center = this.map.getCenter();
                this._handleDrawUp({ lngLat: center });

                // Réinitialiser les états des boutons
                if (pStart) pStart.style.display = 'flex';
                pConfirm.style.display = 'none';
                if (pCancel) pCancel.style.display = 'none';
            };
        }

        if (pCancel) {
            pCancel.onclick = () => {
                this.drawState = null;
                this._clearPreview();
                this._clearLiveDiameter();

                // Réinitialiser les états des boutons
                if (pStart) pStart.style.display = 'flex';
                if (pConfirm) pConfirm.style.display = 'none';
                pCancel.style.display = 'none';
            };
        }

        // Mettre à jour l'aperçu à chaque mouvement de la carte en mode précision
        if (this.map) {
            this.map.on('move', () => {
                if (this.drawPrecisionMode && this.drawState) {
                    const center = this.map.getCenter();
                    this._handleDrawMove({ lngLat: center });
                }
                // Mesure au réticule : le segment élastique suit le centre de carte
                // (qui se déplace quand on panote) tant qu'au moins un sommet existe.
                if (this._measureState && this._measureState.reticle && this._measureState.vertices.length) {
                    this._renderMeasurePreview();
                }
            });
        }

        // Échap = quitte l'outil ; Ctrl+Z / Ctrl+Y raccourcis (uniquement sur la vue Plan)
        document.addEventListener('keydown', (e) => {
            const planView = document.getElementById('view-plan');
            if (!planView || !planView.classList.contains('active')) return;
            if (e.key === 'Escape' && this.drawTool) this._setTool(null);
            else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); }
            else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); this._redo(); }
        });
    },

    _pushHistory() {
        // Snapshot avant modification — appelé par toute opération qui change les shapes
        this.history.push(JSON.stringify(this._loadShapes()));
        if (this.history.length > 50) this.history.shift();
        this.redoStack = []; // toute nouvelle action invalide le redo
    },

    _undo() {
        if (!this.history.length) return;
        const current = JSON.stringify(this._loadShapes());
        this.redoStack.push(current);
        const prev = this.history.pop();
        try { localStorage.setItem(SHAPES_KEY, prev); } catch (e) {}
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    _redo() {
        if (!this.redoStack.length) return;
        const current = JSON.stringify(this._loadShapes());
        this.history.push(current);
        const next = this.redoStack.pop();
        try { localStorage.setItem(SHAPES_KEY, next); } catch (e) {}
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    _refreshUndoRedoButtons() {
        const undoBtn = document.getElementById('plan_draw_undo');
        const redoBtn = document.getElementById('plan_draw_redo');
        if (undoBtn) {
            undoBtn.style.opacity = this.history.length ? '1' : '0.35';
            undoBtn.style.cursor = this.history.length ? 'pointer' : 'not-allowed';
        }
        if (redoBtn) {
            redoBtn.style.opacity = this.redoStack.length ? '1' : '0.35';
            redoBtn.style.cursor = this.redoStack.length ? 'pointer' : 'not-allowed';
        }
    },

    _setTool(tool) {
        // Toggle : re-cliquer sur l'outil actif le désactive
        if (tool && this.drawTool === tool) tool = null;
        // Quitter proprement une mesure en cours si on change/désactive d'outil.
        if (this._measureState && tool !== 'measure') this._clearMeasureState();
        this.drawTool = tool;
        this.drawState = null;
        this._clearPreview();
        this._clearLiveDiameter();

        // Détecter si on est sur mobile/tactile pour le mode précision.
        // Exception : l'outil TRAIT se trace au doigt (cheminement libre), sans
        // réticule ni boutons Valider/Annuler → mode précision désactivé pour lui.
        // L'outil MESURE pose des sommets successifs au clic/réticule (pas un drag)
        // → il a sa propre machine d'états, traitée plus bas.
        const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        this.drawPrecisionMode = !!(tool && isMobile && tool !== 'line' && tool !== 'measure');

        // Outil mesure : démarre/arrête sa propre machine d'états (sommets au clic).
        if (tool === 'measure') {
            this._startMeasure(isMobile);
        }

        // Style des boutons
        document.querySelectorAll('.plan-draw-btn').forEach(b => {
            const active = b.dataset.tool === tool;
            b.style.background = active ? this.drawColor : 'transparent';
            b.style.color = active ? (['#eab308', '#ffffff', '#22c55e'].includes(this.drawColor) ? '#000' : '#fff') : 'var(--text-main)';
        });

        // Contrôles du réticule et des boutons de précision mobile
        const crosshair = document.getElementById('plan_draw_crosshair');
        const precControls = document.getElementById('plan_draw_precision_controls');
        const viewPlan = document.getElementById('view-plan');

        // Le réticule est partagé : mode précision dessin OU mesure avec réticule.
        const reticleOn = !!this.drawPrecisionMode || !!(this._measureState && this._measureState.reticle);
        if (crosshair) {
            crosshair.classList.toggle('active', reticleOn);
        }
        if (precControls) {
            // Les boutons Viser/Valider/Annuler ne servent QU'au dessin précision,
            // pas à la mesure (qui a sa propre barre flottante).
            precControls.style.display = this.drawPrecisionMode ? 'flex' : 'none';
            // Réinitialiser l'état visuel des boutons de visée
            const pStart = document.getElementById('plan_draw_precision_start');
            const pConfirm = document.getElementById('plan_draw_precision_confirm');
            const pCancel = document.getElementById('plan_draw_precision_cancel');
            if (pStart) pStart.style.display = 'flex';
            if (pConfirm) pConfirm.style.display = 'none';
            if (pCancel) pCancel.style.display = 'none';
        }
        if (viewPlan) {
            viewPlan.classList.toggle('drawing-active', reticleOn);
        }

        // Curseur + désactive le pan de la carte tant qu'un outil est actif (sauf en
        // mode précision mobile, et sauf MESURE qui pose des sommets au clic : on
        // garde le pan actif pour pouvoir se déplacer entre deux sommets).
        if (this.map) {
            this.map.getCanvas().style.cursor = tool ? 'crosshair' : '';
            if (tool && !this.drawPrecisionMode && tool !== 'measure') {
                this.map.dragPan.disable();
                this.map.doubleClickZoom.disable();
                this.map.boxZoom.disable();
            } else if (tool === 'measure') {
                // Mesure : on garde le pan (déplacement entre sommets) mais on coupe
                // le zoom double-clic, réservé à la VALIDATION de la mesure.
                this.map.dragPan.enable();
                this.map.doubleClickZoom.disable();
                this.map.boxZoom.enable();
            } else {
                this.map.dragPan.enable();
                this.map.doubleClickZoom.enable();
                this.map.boxZoom.enable();
            }
        }
    },

    _setDrawColor(color) {
        this.drawColor = color;
        document.querySelectorAll('.plan-draw-color').forEach(b => {
            b.style.borderColor = b.dataset.color === color ? '#fff' : 'transparent';
        });
        // Re-style du bouton actif si un outil est sélectionné
        if (this.drawTool) this._setTool(this.drawTool);
    },

    /** Drag-to-draw : démarrage */
    _handleDrawDown(e) {
        // La mesure n'est pas un drag : elle est pilotée par _onMapClick / réticule.
        if (this.drawTool === 'measure') return;
        if (!this.drawTool || this.drawPrecisionMode) return;
        // Outil texte : un seul clic suffit (pas de drag)
        if (this.drawTool === 'text') {
            if (e.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
            this._addFreeText(e.lngLat);
            // Désactive l'outil après usage pour éviter les ajouts involontaires
            this._setTool(null);
            return;
        }
        // Bloquer le pan/zoom natif
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
        }
        if (e.preventDefault) e.preventDefault();
        const lngLat = [e.lngLat.lng, e.lngLat.lat];
        // `points` sert au tracé libre (cheminement) de l'outil trait.
        this.drawState = { start: lngLat, current: lngLat, points: [lngLat] };
    },

    /** Drag-to-draw : déplacement (live preview) */
    _handleDrawMove(e) {
        // Outil mesure : la souris/le doigt fait varier le segment "élastique"
        // entre le dernier sommet posé et le curseur (desktop & tap mobile direct).
        if (this.drawTool === 'measure') {
            if (this._measureState && e.lngLat) {
                this._measureUpdateCursor([e.lngLat.lng, e.lngLat.lat]);
            }
            return;
        }
        if (!this.drawTool || !this.drawState) return;
        // Ignorer les glissements de doigt directs sur l'écran en mode précision mobile
        if (this.drawPrecisionMode && e.originalEvent) return;

        const cursor = [e.lngLat.lng, e.lngLat.lat];
        this.drawState.current = cursor;
        if (this.drawTool === 'line') {
            // Tracé libre : on accumule les points le long du glissement (cheminement).
            const pts = this.drawState.points || (this.drawState.points = [this.drawState.start]);
            const last = pts[pts.length - 1];
            const lp = this.map.project({ lng: last[0], lat: last[1] });
            const cp = this.map.project({ lng: cursor[0], lat: cursor[1] });
            if (Math.hypot(cp.x - lp.x, cp.y - lp.y) >= 4) pts.push(cursor);
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: pts.length > 1 ? pts : [this.drawState.start, cursor] },
                properties: { color: this.drawColor }
            });
        } else if (this.drawTool === 'rectangle') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._rectPolygon(this.drawState.start, cursor)] },
                properties: { color: this.drawColor }
            });
        } else if (this.drawTool === 'circle') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._circlePolygon(this.drawState.start, cursor)] },
                properties: { color: this.drawColor }
            });
            // Label de diamètre live (si toggle global ON)
            if (this._diameterGlobal) {
                this._renderLiveDiameter(this.drawState.start, cursor);
            }
        }
    },

    /** Affiche le diamètre live pendant le tracé d'un cercle. */
    _renderLiveDiameter(center, edge) {
        const d = this._haversineMeters(center, edge) * 2;
        const label = `⌀ ${this._formatDistance(d)}`;
        if (!this._drawingDiameterMarker) {
            const div = document.createElement('div');
            div.className = 'plan-diameter-label live';
            div.style.cssText = `
                background: rgba(20,24,32,0.92);
                color: #fff;
                padding: 3px 10px;
                border-radius: 12px;
                border: 1px solid ${this.drawColor || '#fff'};
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 13px;
                font-weight: 700;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.6);
            `;
            this._drawingDiameterMarker = new maplibregl.Marker({
                element: div, anchor: 'center', offset: [0, 16]
            }).setLngLat(center).addTo(this.map);
        }
        const el = this._drawingDiameterMarker.getElement();
        if (el) el.textContent = label;
        this._drawingDiameterMarker.setLngLat(center);
    },

    _clearLiveDiameter() {
        if (this._drawingDiameterMarker) {
            try { this._drawingDiameterMarker.remove(); } catch (_) {}
            this._drawingDiameterMarker = null;
        }
    },

    /** Drag-to-draw : relâchement → commit (si le drag a été significatif) */
    _handleDrawUp(e) {
        if (!this.drawTool || !this.drawState) return;
        // Ignorer les relâchements de doigt directs sur l'écran en mode précision mobile
        if (this.drawPrecisionMode && e.originalEvent) return;

        const end = e.lngLat ? [e.lngLat.lng, e.lngLat.lat] : this.drawState.current;
        const start = this.drawState.start;
        // Distance pixel pour filtrer les "clics" non-drag
        const p1 = this.map.project({ lng: start[0], lat: start[1] });
        const p2 = this.map.project({ lng: end[0], lat: end[1] });
        const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        // Un trait libre (cheminement) peut revenir près de son départ : on le
        // commit dès qu'il compte plusieurs points, même si start≈end en pixels.
        const freehandLine = this.drawTool === 'line' && this.drawState.points && this.drawState.points.length > 2;
        if (!this.drawPrecisionMode && distPx < 4 && !freehandLine) {
            // Clic trop court, on annule la preview
            this.drawState = null;
            this._clearPreview();
            this._clearLiveDiameter();
            return;
        }

        if (this.drawTool === 'line') {
            const pts = (this.drawState.points && this.drawState.points.length > 1)
                ? this.drawState.points.slice()
                : [start, end];
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'line',
                color: this.drawColor,
                coords: pts
            });
        } else if (this.drawTool === 'rectangle') {
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'rectangle',
                color: this.drawColor,
                coords: this._rectPolygon(start, end)
            });
        } else if (this.drawTool === 'circle') {
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'circle',
                color: this.drawColor,
                center: start,
                edge: end,
                coords: this._circlePolygon(start, end)
            });
        }
    },

    _finishShape(shape) {
        this._pushHistory();
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this.drawState = null;
        this._clearPreview();
        // Désactive l'outil de dessin et repasse en mode contrôle carte
        // (le dock reste ouvert pour permettre un nouveau tracé immédiat).
        this._setTool(null);
        // Sélectionne la forme fraîchement créée → handles + toolbar immédiats
        this._selectShape(shape.id);
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    // ============================================================
    // ========================  MESURE  ==========================
    //  Outil de mesure distance / azimut : l'utilisateur pose des
    //  sommets successifs (clic/tap, ou réticule + bouton sur mobile).
    //  Une polyligne live se trace ; chaque segment porte sa distance et
    //  son azimut VRAI (relèvement initial), plus le cumul total.
    //  À la validation, on persiste un shape type:'measure' (réutilisé par
    //  l'export et le rechargement). Échap/Annuler revient à _setTool(null).
    // ============================================================

    /**
     * Azimut vrai (relèvement initial / forward azimuth) de `a` vers `b`,
     * en degrés [0,360). Même modèle sphérique que _circlePolygon (R commun,
     * trigo cohérente) → l'azimut affiché correspond au cap suivi par les arcs
     * que l'on dessine. 0° = Nord, 90° = Est.
     */
    _trueBearing(a, b) {
        const toRad = d => d * Math.PI / 180;
        const phi1 = toRad(a[1]), phi2 = toRad(b[1]);
        const dLam = toRad(b[0] - a[0]);
        const y = Math.sin(dLam) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
        const brng = Math.atan2(y, x) * 180 / Math.PI;
        return (brng + 360) % 360;
    },

    _formatBearing(deg) {
        return `${Math.round(deg).toString().padStart(3, '0')}°`;
    },

    /** Démarre une nouvelle mesure (réinitialise l'état + UI). */
    _startMeasure(isMobile) {
        this._clearMeasureState();
        this._measureState = {
            vertices: [],
            cursor: null,
            // Réticule de précision sous les gants : présent dès qu'il y a du tactile.
            reticle: !!(isMobile || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0))
        };
        // Réticule central réutilisé (le même que le mode précision dessin).
        const crosshair = document.getElementById('plan_draw_crosshair');
        if (crosshair) crosshair.classList.toggle('active', this._measureState.reticle);
        const viewPlan = document.getElementById('view-plan');
        if (viewPlan && this._measureState.reticle) viewPlan.classList.add('drawing-active');
        this._buildMeasureControls();
        this._renderMeasurePreview();
        this._showHint('Mesure : touche la carte pour poser des points. Double-clic ou « Terminer » pour finir.');
    },

    /** Ajoute un sommet à la mesure en cours. */
    _measureAddVertex(lngLat) {
        const st = this._measureState;
        if (!st) return;
        // Évite les doublons exacts (double-événement tactile).
        const last = st.vertices[st.vertices.length - 1];
        if (last && last[0] === lngLat[0] && last[1] === lngLat[1]) return;
        st.vertices.push(lngLat.slice());
        st.cursor = lngLat.slice();
        this._renderMeasurePreview();
        this._updateMeasureControls();
    },

    /** Met à jour le segment élastique vers le curseur (preview live). */
    _measureUpdateCursor(lngLat) {
        const st = this._measureState;
        if (!st || !st.vertices.length) return;
        st.cursor = lngLat.slice();
        this._renderMeasurePreview();
    },

    /** Position courante du réticule (centre de carte) pour la pose mobile. */
    _measureReticlePoint() {
        const c = this.map.getCenter();
        return [c.lng, c.lat];
    },

    /** Longueur cumulée (m) de la polyligne de mesure (sommets posés). */
    _measureTotalMeters(vertices) {
        let total = 0;
        for (let i = 1; i < vertices.length; i++) {
            total += this._haversineMeters(vertices[i - 1], vertices[i]);
        }
        return total;
    },

    /**
     * Trace la preview live de la mesure (polyligne pointillée) + étiquettes
     * par segment (distance + azimut) + cumul total à l'extrémité courante.
     * Réutilise la source GeoJSON de preview de dessin et des HTML markers.
     */
    _renderMeasurePreview() {
        const st = this._measureState;
        if (!st || !this.map) return;
        // Sommets + (éventuel) point courant (curseur desktop OU réticule mobile).
        const live = st.vertices.slice();
        let cursorPt = st.cursor;
        if (st.reticle) cursorPt = this._measureReticlePoint();
        const drawPts = cursorPt && live.length ? live.concat([cursorPt]) : live;

        if (drawPts.length >= 2) {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: drawPts },
                properties: { color: this.drawColor }
            });
        } else {
            this._clearPreview();
        }
        this._renderMeasureLabels(drawPts, false);
    },

    /**
     * Rend les étiquettes de segment (HTML markers) le long de `pts`.
     * @param {Array} pts        sommets [lng,lat]
     * @param {boolean} committed  true = mesure persistée (sinon preview live)
     */
    _renderMeasureLabels(pts, committed) {
        // Purge des labels live précédents (les labels committed sont gérés
        // séparément, voir _renderCommittedMeasureLabels).
        if (!committed) {
            if (this._measureLabelMarkers) this._measureLabelMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
            this._measureLabelMarkers = [];
        }
        if (!this.map || !pts || pts.length < 2) return;
        const sink = committed ? this._committedMeasureMarkers : this._measureLabelMarkers;
        const color = this.drawColor || '#22d3ee';

        let cumul = 0;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const dist = this._haversineMeters(a, b);
            const az = this._trueBearing(a, b);
            cumul += dist;
            const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            const isLast = i === pts.length - 1;
            const segTxt = `${this._formatDistance(dist)} · ${this._formatBearing(az)}`;
            const totTxt = (pts.length > 2 && isLast) ? `Σ ${this._formatDistance(cumul)}` : '';
            const div = document.createElement('div');
            div.className = 'plan-measure-label';
            div.style.cssText = `
                display: flex; flex-direction: column; align-items: center; gap: 1px;
                background: rgba(10,12,16,0.86);
                color: #fff;
                padding: 2px 8px;
                border-radius: 10px;
                border: 1px solid ${color};
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 12px;
                font-weight: 700;
                line-height: 1.15;
                white-space: nowrap;
                pointer-events: none;
                text-shadow: 0 1px 2px rgba(0,0,0,0.9);
                box-shadow: 0 2px 8px rgba(0,0,0,0.55);
            `;
            const seg = document.createElement('span');
            seg.textContent = segTxt;
            div.appendChild(seg);
            if (totTxt) {
                const tot = document.createElement('span');
                tot.textContent = totTxt;
                tot.style.cssText = `color:${color}; font-size: 11px;`;
                div.appendChild(tot);
            }
            const m = new maplibregl.Marker({ element: div, anchor: 'center', offset: [0, -12] })
                .setLngLat(mid).addTo(this.map);
            sink.push(m);
        }
    },

    /** Construit la barre flottante de contrôle de la mesure (créée dynamiquement). */
    _buildMeasureControls() {
        this._removeMeasureControls();
        const parent = document.getElementById('plan_map') && document.getElementById('plan_map').parentElement;
        if (!parent) return;
        const bar = document.createElement('div');
        bar.id = 'plan_measure_controls';
        bar.style.cssText = `
            position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
            display: flex; gap: 8px; z-index: 12;
            background: rgba(10,12,16,0.82);
            padding: 6px; border-radius: 14px;
            box-shadow: 0 4px 18px rgba(0,0,0,0.55);
            backdrop-filter: blur(4px);
        `;
        const mkBtn = (label, icon, bg, fg, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.style.cssText = `
                display: inline-flex; align-items: center; gap: 6px;
                min-height: 48px; padding: 0 16px;
                border: none; border-radius: 10px;
                background: ${bg}; color: ${fg};
                font-family: var(--font-ui, system-ui, sans-serif);
                font-size: 14px; font-weight: 700; cursor: pointer;
                touch-action: manipulation; -webkit-tap-highlight-color: transparent;
            `;
            b.innerHTML = `<span class="material-symbols-outlined" style="font-size:22px;">${icon}</span><span>${label}</span>`;
            b.onclick = this._safe(onClick, 'measureCtl:' + label);
            return b;
        };
        const st = this._measureState;
        // Bouton « Point » : ne s'affiche qu'avec réticule (pose sous gants).
        if (st && st.reticle) {
            this._measurePointBtn = mkBtn('Point', 'add_location_alt', '#3b82f6', '#fff',
                () => this._measureAddVertex(this._measureReticlePoint()));
            bar.appendChild(this._measurePointBtn);
        }
        this._measureUndoBtn = mkBtn('Annuler dernier', 'undo', 'rgba(120,120,120,0.95)', '#fff',
            () => this._measureUndoVertex());
        bar.appendChild(this._measureUndoBtn);
        bar.appendChild(mkBtn('Terminer', 'check', '#22c55e', '#000', () => this._finishMeasure()));
        bar.appendChild(mkBtn('Quitter', 'close', 'rgba(239,68,68,0.95)', '#fff', () => this._cancelMeasure()));
        parent.appendChild(bar);
        this._measureControls = bar;
        this._updateMeasureControls();
    },

    _updateMeasureControls() {
        const st = this._measureState;
        const n = st ? st.vertices.length : 0;
        if (this._measureUndoBtn) this._measureUndoBtn.style.display = n >= 1 ? 'inline-flex' : 'none';
    },

    _removeMeasureControls() {
        if (this._measureControls) { try { this._measureControls.remove(); } catch (_) {} this._measureControls = null; }
        this._measurePointBtn = null;
        this._measureUndoBtn = null;
    },

    /** Retire le dernier sommet posé (correction sous stress). */
    _measureUndoVertex() {
        const st = this._measureState;
        if (!st || !st.vertices.length) return;
        st.vertices.pop();
        this._renderMeasurePreview();
        this._updateMeasureControls();
    },

    /** Valide la mesure : persiste un shape type:'measure' s'il y a >= 2 sommets. */
    _finishMeasure() {
        const st = this._measureState;
        if (!st) { this._setTool(null); return; }
        const verts = st.vertices.slice();
        // En mode réticule, le centre courant compte comme dernier sommet implicite
        // s'il diffère du précédent (l'utilisateur a visé sans valider « Point »).
        if (st.reticle) {
            const ret = this._measureReticlePoint();
            const last = verts[verts.length - 1];
            if (!last || last[0] !== ret[0] || last[1] !== ret[1]) verts.push(ret);
        }
        if (verts.length < 2) { this._cancelMeasure(); return; }
        const total = this._measureTotalMeters(verts);
        const shape = {
            id: 'shape_' + Date.now(),
            type: 'measure',
            color: this.drawColor,
            coords: verts,
            totalM: total
        };
        this._clearMeasureState();
        // Persiste sans passer par _finishShape (qui sélectionne la forme et
        // déclencherait des handles ; la mesure est une annotation non sélectionnable).
        this._pushHistory();
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this._setTool(null);
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    /** Annule la mesure en cours et revient au mode contrôle carte. */
    _cancelMeasure() {
        this._clearMeasureState();
        this._setTool(null);
    },

    /** Nettoie l'état + l'UI de mesure (markers, réticule, barre, hint). */
    _clearMeasureState() {
        this._measureState = null;
        if (this._measureLabelMarkers) {
            this._measureLabelMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        }
        this._measureLabelMarkers = [];
        this._removeMeasureControls();
        this._clearPreview();
        const crosshair = document.getElementById('plan_draw_crosshair');
        if (crosshair) crosshair.classList.remove('active');
        const viewPlan = document.getElementById('view-plan');
        if (viewPlan && !this.drawPrecisionMode) viewPlan.classList.remove('drawing-active');
        this._hideHint();
    },

    // ----- ANNEAUX D'ENGAGEMENT (50/100/200 m) -----
    /**
     * Pose des cercles concentriques d'engagement autour du centre de carte
     * courant. Persisté comme un shape type:'measure-rings' (réutilise
     * _circlePolygon). Exposé via clic long sur le bouton mesure.
     * @param {Array} [center]  [lng,lat] ; défaut = centre de la vue
     */
    _addEngagementRings(center) {
        if (!this.map) return;
        const c = (center && center.length === 2) ? center.slice()
                : (() => { const ctr = this.map.getCenter(); return [ctr.lng, ctr.lat]; })();
        const radii = [50, 100, 200];
        const rings = radii.map(r => ({
            radiusM: r,
            coords: this._circlePolygon(c, this._geoEdgeNorth(c, r))
        }));
        const shape = {
            id: 'shape_' + Date.now(),
            type: 'measure-rings',
            color: this.drawColor,
            center: c,
            rings
        };
        this._pushHistory();
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this._renderShapes();
        this._refreshUndoRedoButtons();
        this._showHint('Anneaux d\'engagement posés : 50 / 100 / 200 m.');
        setTimeout(() => this._hideHint(), 2200);
    },

    _renderPreview(feature) {
        const src = this.map.getSource('plan-draw-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [feature] });
    },

    _clearPreview() {
        const src = this.map && this.map.getSource('plan-draw-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        this._clearLiveDiameter();
    },

    _renderShapes() {
        const src = this.map && this.map.getSource('plan-shapes-src');
        if (!src) return;
        const list = this._loadShapes();
        const features = [];
        for (const s of list) {
            if (s.type === 'line') {
                features.push({ type: 'Feature', id: s.id, geometry: { type: 'LineString', coordinates: s.coords }, properties: { color: s.color, shapeId: s.id, strokeWidth: s.strokeWidth || 3 } });
            } else if (s.type === 'rectangle' || s.type === 'circle') {
                features.push({ type: 'Feature', id: s.id, geometry: { type: 'Polygon', coordinates: [s.coords] }, properties: { color: s.color, shapeId: s.id, strokeWidth: s.strokeWidth || 3 } });
            } else if (s.type === 'text') {
                // Petite zone "hit" invisible autour du point pour rendre le clic possible.
                // Carré de ~14 px à l'écran, projeté en degrés.
                const c = s.coords[0];
                if (this.map && c) {
                    const p = this.map.project({ lng: c[0], lat: c[1] });
                    const pad = 14;
                    const sw = this.map.unproject([p.x - pad, p.y + pad]);
                    const ne = this.map.unproject([p.x + pad, p.y - pad]);
                    features.push({
                        type: 'Feature', id: s.id,
                        geometry: { type: 'Polygon', coordinates: [[
                            [sw.lng, sw.lat], [ne.lng, sw.lat],
                            [ne.lng, ne.lat], [sw.lng, ne.lat], [sw.lng, sw.lat]
                        ]]},
                        properties: { color: s.color, shapeId: s.id, isText: true }
                    });
                }
            } else if (s.type === 'measure') {
                // Mesure persistée : polyligne d'annotation. PAS de shapeId → non
                // sélectionnable (les étiquettes/le tracé sont en lecture seule ;
                // suppression via Effacer ou Annuler). Réutilise la même couche ligne.
                if (Array.isArray(s.coords) && s.coords.length >= 2) {
                    features.push({
                        type: 'Feature', id: s.id,
                        geometry: { type: 'LineString', coordinates: s.coords },
                        properties: { color: s.color || '#22d3ee', strokeWidth: s.strokeWidth || 3 }
                    });
                }
            } else if (s.type === 'measure-rings') {
                // Anneaux d'engagement : cercles concentriques (annotation lecture seule).
                if (Array.isArray(s.rings)) {
                    for (const ring of s.rings) {
                        if (!ring || !Array.isArray(ring.coords)) continue;
                        features.push({
                            type: 'Feature',
                            geometry: { type: 'Polygon', coordinates: [ring.coords] },
                            properties: { color: s.color || '#22d3ee', strokeWidth: s.strokeWidth || 2 }
                        });
                    }
                }
            }
        }
        src.setData({ type: 'FeatureCollection', features });
        // Toujours synchroniser texte / diamètres / handles / toolbar avec les formes
        this._renderShapeTexts();
        this._renderDiameters();
        this._renderCommittedMeasures();
        this._renderHandles();
        this._renderShapeLocks();
        this._updateFloatingToolbarPos();
    },

    /**
     * Étiquettes des mesures persistées (distance/azimut par segment + total)
     * et libellés de rayon des anneaux d'engagement. Recalculées à chaque rendu
     * et à chaque zoom/déplacement (positions le long de la ligne).
     */
    _renderCommittedMeasures() {
        if (this._committedMeasureMarkers) {
            this._committedMeasureMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        }
        this._committedMeasureMarkers = [];
        if (!this.map) return;
        const shapes = this._loadShapes();
        for (const s of shapes) {
            if (s.type === 'measure' && Array.isArray(s.coords) && s.coords.length >= 2) {
                const savedColor = this.drawColor;
                this.drawColor = s.color || '#22d3ee';
                this._renderMeasureLabels(s.coords, true);
                this.drawColor = savedColor;
            } else if (s.type === 'measure-rings' && Array.isArray(s.rings)) {
                const color = s.color || '#22d3ee';
                for (const ring of s.rings) {
                    if (!ring || !s.center) continue;
                    // Libellé du rayon placé au nord du cercle.
                    const top = this._geoEdgeNorth(s.center, ring.radiusM);
                    const div = document.createElement('div');
                    div.className = 'plan-measure-ring-label';
                    div.textContent = `${ring.radiusM} m`;
                    div.style.cssText = `
                        background: rgba(10,12,16,0.86); color: #fff;
                        padding: 1px 7px; border-radius: 9px; border: 1px solid ${color};
                        font-family: var(--font-data, ui-monospace, monospace);
                        font-size: 11px; font-weight: 700; white-space: nowrap;
                        pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.9);
                    `;
                    const m = new maplibregl.Marker({ element: div, anchor: 'center' })
                        .setLngLat(top).addTo(this.map);
                    this._committedMeasureMarkers.push(m);
                }
            }
        }
    },

    // ============================================================
    // ====================  DIAMÈTRES CERCLE  ===================
    // ============================================================
    /** Distance Haversine en mètres entre deux [lng,lat]. */
    _haversineMeters(a, b) {
        const R = 6371000;
        const toRad = d => d * Math.PI / 180;
        const dPhi = toRad(b[1] - a[1]);
        const dLam = toRad(b[0] - a[0]);
        const phi1 = toRad(a[1]); const phi2 = toRad(b[1]);
        const h = Math.sin(dPhi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(dLam/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    },

    _formatDistance(m) {
        if (!isFinite(m) || m <= 0) return '';
        if (m < 1) return `${(m * 100).toFixed(0)} cm`;
        if (m < 1000) return `${Math.round(m)} m`;
        if (m < 10000) return `${(m / 1000).toFixed(2)} km`;
        return `${(m / 1000).toFixed(1)} km`;
    },

    _circleDiameter(s) {
        const c = s.center || s.coords[0];
        const e = s.edge   || (s.coords && s.coords[Math.floor(s.coords.length / 4)]);
        if (!c || !e) return 0;
        return this._haversineMeters(c, e) * 2;
    },

    _renderDiameters() {
        if (this._diameterMarkers) this._diameterMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        this._diameterMarkers = [];
        if (!this.map) return;
        if (!this._diameterGlobal) return;
        const shapes = this._loadShapes();
        for (const s of shapes) {
            if (s.type !== 'circle') continue;
            if (s.showDiameter === false) continue;
            const d = this._circleDiameter(s);
            if (!d) continue;
            const c = s.center || s.coords[0];
            const label = `⌀ ${this._formatDistance(d)}`;
            const div = document.createElement('div');
            div.className = 'plan-diameter-label';
            div.textContent = label;
            div.style.cssText = `
                background: rgba(20,24,32,0.85);
                color: #fff;
                padding: 3px 9px;
                border-radius: 10px;
                border: 1px solid ${s.color || '#fff'};
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 12px;
                font-weight: 600;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 2px 6px rgba(0,0,0,0.5);
            `;

            // Position : strictement SOUS le texte de la forme (s'il y en a), sinon centré.
            // On mesure dynamiquement la hauteur du marker texte associé pour éviter
            // tout chevauchement quelle que soit la taille du texte ou du diamètre.
            let offsetY = 14;
            const txtMarker = this._textMarkersById && this._textMarkersById[s.id];
            if (txtMarker) {
                const txtEl = txtMarker.getElement();
                if (txtEl) {
                    // hauteur réelle du bloc texte (avec wrap éventuel + padding)
                    const txtH = txtEl.offsetHeight || txtEl.getBoundingClientRect().height || 18;
                    // Le texte est centré sur le centre du cercle ; sa moitié de hauteur
                    // est sous l'ancrage. On positionne le diamètre encore en-dessous
                    // avec un padding visuel de 6 px.
                    offsetY = Math.round(txtH / 2 + 6 + 9); // + demi-hauteur diamètre (~9)
                }
            }
            const m = new maplibregl.Marker({ element: div, anchor: 'center', offset: [0, offsetY] })
                .setLngLat([c[0], c[1]]).addTo(this.map);
            this._diameterMarkers.push(m);
        }
    },

    /** Verrouille / déverrouille la position des pings ET des dessins. */
    _toggleLock() {
        this._locked = !this._locked;
        try { localStorage.setItem('pcTacPlanLocked', this._locked ? '1' : '0'); } catch (_) {}
        this._updateLockButton();
        // En verrouillant, on retire les poignées de la forme sélectionnée.
        if (this._locked) this._clearHandles();
        else this._renderHandles();
        // Recrée les pings pour appliquer le nouveau draggable.
        this._renderPins();
        this._showHint(this._locked
            ? 'Positions verrouillées : pings et dessins figés'
            : 'Positions déverrouillées : déplacement réactivé');
        setTimeout(() => this._hideHint(), 1600);
    },

    _updateLockButton() {
        const btn = document.getElementById('plan_draw_lock');
        if (!btn) return;
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = this._locked ? 'lock' : 'lock_open';
        btn.style.color = this._locked ? '#eab308' : 'var(--text-main)';
        btn.title = this._locked
            ? 'Positions verrouillées (cliquer pour déverrouiller)'
            : 'Verrouiller la position des pings/dessins';
        btn.classList.toggle('active', this._locked);
    },

    /** Toggle global ON/OFF (depuis la toolbar dessin). */
    _toggleGlobalDiameter() {
        this._diameterGlobal = !this._diameterGlobal;
        const btn = document.getElementById('plan_draw_diameter_toggle');
        if (btn) {
            btn.style.color = this._diameterGlobal ? '#22c55e' : 'var(--text-muted)';
            btn.title = this._diameterGlobal ? 'Diamètres affichés (cliquer pour masquer)' : 'Diamètres masqués (cliquer pour afficher)';
        }
        this._renderDiameters();
        if (this._activeWheel && this._selectedShapeId) {
            this._openShapeWheel(this._selectedShapeId, this._activeWheel.lngLat);
        }
    },

    // ============================================================
    // ===========  GESTES UNIFIÉS (drag / tap / pan)  ============
    // ============================================================
    //
    // Trois interactions possibles sur la carte :
    //   1. tap court & immobile sur une forme        → menu contextuel
    //   2. drag (>6 px) commençant sur une forme    → déplacement de la forme
    //   3. drag depuis une zone vide                → pan de la carte (natif)
    //
    // Implémentation : pointerdown sur les couches `plan-shapes-*` désactive
    // le pan tant que le geste est en cours, écoute mousemove/touchmove pour
    // déterminer s'il s'agit d'un drag, et au pointerup soit applique le drag
    // (déjà rendu live), soit ouvre le menu contextuel.

    _shapePointerDown(e) {
        if (this.drawTool) return;          // outil de dessin actif : on ignore
        if (this.moveState) return;         // déjà une transformation en cours
        if (this._gesture) return;          // déjà un geste en cours
        const feat = e.features && e.features[0];
        if (!feat) return;
        const id = feat.properties.shapeId;
        if (!id) return;
        // Empêche maplibre de démarrer le pan natif sur cette pression
        if (e.preventDefault) e.preventDefault();
        if (e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault();
        this._startShapeGesture(id, e.lngLat, e.originalEvent);
    },

    /**
     * Machine d'états du geste sur une forme.
     * @param {string} shapeId
     * @param {{lng:number,lat:number}} startLngLat
     * @param {Event|null} originalEvent
     */
    _startShapeGesture(shapeId, startLngLat, originalEvent) {
        if (originalEvent && originalEvent.preventDefault) originalEvent.preventDefault();

        const DRAG_PX = 6;
        const startTime = Date.now();
        const startPt  = this.map.project(startLngLat);

        // Désactive le pan le temps du geste (réactivé au pointerup)
        try { this.map.dragPan.disable(); } catch (e) {}
        this.map.getCanvas().style.cursor = 'grabbing';

        const state = { shapeId, startLngLat, isDrag: false, original: null };
        this._gesture = state;

        // Verrou individuel : si la forme est figée, on n'autorisera pas le drag
        // (le tap → menu contextuel reste possible, pour pouvoir la déverrouiller).
        const lockedShape = (() => {
            const sh = this._loadShapes().find(s => s.id === shapeId);
            return !!(sh && sh.locked);
        })();

        // Convertit un événement DOM (clientX/Y) en lngLat carte
        const clientToLngLat = (clientX, clientY) => {
            const rect = this.map.getCanvas().getBoundingClientRect();
            return this.map.unproject([clientX - rect.left, clientY - rect.top]);
        };

        // Récupère lngLat depuis un événement maplibre OU DOM
        const extractLngLat = (ev) => {
            if (ev && ev.lngLat) return ev.lngLat;
            if (ev && ev.touches && ev.touches[0]) return clientToLngLat(ev.touches[0].clientX, ev.touches[0].clientY);
            if (ev && ev.clientX !== undefined) return clientToLngLat(ev.clientX, ev.clientY);
            return null;
        };

        const onMove = this._safe((ev) => {
            if (this._gesture !== state) return;
            const cur = extractLngLat(ev);
            if (!cur) return;
            // Détection drag : seuil franchi ? (jamais en mode verrouillé → position figée)
            if (!state.isDrag && !this._locked && !lockedShape) {
                const p = this.map.project(cur);
                if (Math.hypot(p.x - startPt.x, p.y - startPt.y) > DRAG_PX) {
                    // Bascule en mode drag : snapshot + history
                    const list = this._loadShapes();
                    const shape = list.find(s => s.id === shapeId);
                    if (!shape) return;
                    state.original = JSON.parse(JSON.stringify(shape));
                    this._pushHistory();
                    state.isDrag = true;
                }
            }
            // Drag actif : translation = curseur - point de départ
            if (state.isDrag && state.original) {
                const dLng = cur.lng - startLngLat.lng;
                const dLat = cur.lat - startLngLat.lat;
                const list = this._loadShapes();
                const target = list.find(s => s.id === shapeId);
                if (!target) return;
                target.coords = state.original.coords.map(([x, y]) => [x + dLng, y + dLat]);
                if (state.original.center) target.center = [state.original.center[0] + dLng, state.original.center[1] + dLat];
                if (state.original.edge)   target.edge   = [state.original.edge[0]   + dLng, state.original.edge[1]   + dLat];
                this._saveShapes(list);
                this._renderShapes();
            }
        }, 'shapeGesture:move');

        const onUp = this._safe((ev) => {
            if (this._gesture !== state) return;
            // Cleanup listeners
            try { this.map.off('mousemove', onMove); } catch (e) {}
            try { this.map.off('touchmove', onMove); } catch (e) {}
            try { this.map.off('mouseup', onUp); } catch (e) {}
            try { this.map.off('touchend', onUp); } catch (e) {}
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            document.removeEventListener('touchcancel', onUp);
            try { this.map.dragPan.enable(); } catch (e) {}
            this.map.getCanvas().style.cursor = '';
            this._gesture = null;

            if (state.isDrag) {
                this._refreshUndoRedoButtons();
                // Garde la forme sélectionnée pour l'édition immédiate après drag
                this._selectShape(shapeId);
            } else {
                // Pas de drag → un tap. Simple tap = sélection (poignées, déplaçable).
                // Double tap / double-clic = ouverture de la roue d'options.
                // On neutralise le zoom double-clic natif de MapLibre le temps de la fenêtre.
                this._suppressDblZoom();
                const now = Date.now();
                const prev = this._lastShapeTap;
                if (prev && prev.id === shapeId && (now - prev.t) < 350) {
                    this._lastShapeTap = null;
                    this._openShapeContextMenu(shapeId, startLngLat);
                } else {
                    this._lastShapeTap = { id: shapeId, t: now };
                    this._selectShape(shapeId);
                }
            }
        }, 'shapeGesture:up');

        // Listeners sur maplibre (couvre les events sur le canvas)
        this.map.on('mousemove', onMove);
        this.map.on('touchmove', onMove);
        this.map.on('mouseup',   onUp);
        this.map.on('touchend',  onUp);
        // ET sur le document (couvre les events qui sortent du canvas, p.ex. drag rapide)
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup',   onUp);
        document.addEventListener('pointercancel', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
    },

    /** Neutralise temporairement le zoom double-clic natif (fenêtre double-tap). */
    _suppressDblZoom() {
        if (!this.map || !this.map.doubleClickZoom) return;
        try { this.map.doubleClickZoom.disable(); } catch (_) {}
        if (this._dblZoomTimer) clearTimeout(this._dblZoomTimer);
        this._dblZoomTimer = setTimeout(() => {
            this._dblZoomTimer = null;
            // Ne pas réactiver si un outil de dessin l'a volontairement désactivé.
            if (!this.drawTool || this.drawPrecisionMode) {
                try { this.map.doubleClickZoom.enable(); } catch (_) {}
            }
        }, 450);
    },

    /**
     * Sélectionne une forme + ouvre la roue contextuelle (style Canva).
     */
    _openShapeContextMenu(shapeId, lngLat) {
        if (this.drawTool || this.moveState) return;
        this._selectShape(shapeId);
        // Ouvre la roue à proximité du tap (ou au centroïde si non fourni)
        const s = this._loadShapes().find(x => x.id === shapeId);
        if (!s) return;
        const anchor = lngLat || this._shapeAnchor(s);
        if (anchor) this._openShapeWheel(shapeId, anchor);
    },

    _selectShape(shapeId) {
        if (this._selectedShapeId === shapeId) {
            this._renderHandles();
            return;
        }
        this._selectedShapeId = shapeId;
        this._renderHandles();
        this._renderShapeLocks();   // fait apparaître le cadenas de la forme sélectionnée
        this._attachPinchListeners();
        // La barre flottante est remplacée par la roue éphémère (_openShapeWheel).
    },

    _deselectShape() {
        if (!this._selectedShapeId) return;
        this._selectedShapeId = null;
        this._clearHandles();
        this._clearFloatingToolbar();
        this._detachPinchListeners();
        this._closeWheel();
        this._renderShapeLocks();   // retire le cadenas si la forme n'est pas verrouillée
    },

    /**
     * Quand une forme est sélectionnée, 2 doigts sur la carte = pinch-resize
     * (style Canva). On désactive le pinch-zoom natif maplibre pendant le geste.
     * Hors sélection, le pinch-zoom maplibre fonctionne normalement.
     */
    _attachPinchListeners() {
        if (this._pinchListener) return;
        const onTouchStart = this._safe((e) => {
            if (!this._selectedShapeId || this.drawTool || this.moveState || this._gesture) return;
            if (this._locked) return; // verrou global : pas de redimensionnement au pinch
            const selShape = this._loadShapes().find(s => s.id === this._selectedShapeId);
            if (selShape && selShape.locked) return; // verrou individuel
            const oe = e.originalEvent || e;
            if (oe.touches && oe.touches.length === 2) {
                oe.preventDefault();
                this._startPinchGesture();
            }
        }, 'pinch:touchstart');
        this.map.on('touchstart', onTouchStart);
        this._pinchListener = onTouchStart;
    },

    _detachPinchListeners() {
        if (!this._pinchListener) return;
        try { this.map.off('touchstart', this._pinchListener); } catch (_) {}
        this._pinchListener = null;
    },

    _shapeCentroid(s) {
        if (s.type === 'line') {
            const a = s.coords[0], b = s.coords[s.coords.length - 1];
            return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        }
        if (s.type === 'rectangle') {
            const lngs = s.coords.map(c => c[0]);
            const lats = s.coords.map(c => c[1]);
            return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
        }
        if (s.type === 'circle') return (s.center || s.coords[0]).slice();
        if (s.type === 'text')   return s.coords[0].slice();
        return [0, 0];
    },

    /**
     * Marqueur cadenas cliquable par forme. Affiché pour toute forme VERROUILLÉE
     * (pour pouvoir la déverrouiller) ou actuellement SÉLECTIONNÉE (pour la verrouiller).
     * Ancré au centroïde, légèrement au-dessus pour ne pas gêner la poignée centrale.
     * Réconciliation par id (comme les pings) : pas de recréation inutile.
     */
    _renderShapeLocks() {
        if (!this.map) return;
        if (!this._shapeLockMarkers) this._shapeLockMarkers = new Map();
        const shapes = this._loadShapes();
        const seen = new Set();
        for (const s of shapes) {
            if (!s.id) continue;                       // mesures/anneaux : non verrouillables
            const show = !!s.locked || this._selectedShapeId === s.id;
            if (!show) continue;
            seen.add(s.id);
            const c = this._shapeCentroid(s);
            let entry = this._shapeLockMarkers.get(s.id);
            if (!entry) {
                const shapeId = s.id;
                const el = this._makeLockBadge(!!s.locked, () => this._toggleShapeLock(shapeId, false), 'marker');
                const m = new maplibregl.Marker({ element: el, anchor: 'center', offset: [0, -20] })
                    .setLngLat(c).addTo(this.map);
                entry = { marker: m, el, locked: !!s.locked };
                this._shapeLockMarkers.set(s.id, entry);
            } else {
                entry.marker.setLngLat(c);
                if (entry.locked !== !!s.locked) {
                    this._applyLockBadgeStyle(entry.el, !!s.locked, 'marker');
                    entry.locked = !!s.locked;
                }
            }
        }
        for (const [id, entry] of this._shapeLockMarkers) {
            if (seen.has(id)) continue;
            try { entry.marker.remove(); } catch (_) {}
            this._shapeLockMarkers.delete(id);
        }
    },

    _startPinchGesture() {
        const list = this._loadShapes();
        const shape = list.find(s => s.id === this._selectedShapeId);
        if (!shape) return;
        try { this.map.touchZoomRotate.disable(); } catch (_) {}
        try { this.map.dragPan.disable(); } catch (_) {}
        this._gesture = { type: 'pinch' };
        this._pushHistory();
        const original = JSON.parse(JSON.stringify(shape));
        const center = this._shapeCentroid(shape);
        let initDist = null;

        const getDist = (touches) =>
            Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

        const onMove = this._safe((e) => {
            const oe = e.originalEvent || e;
            if (!oe.touches || oe.touches.length < 2) return;
            oe.preventDefault();
            const dist = getDist(oe.touches);
            if (initDist === null) { initDist = dist; return; }
            if (initDist < 1) return;
            const scale = Math.max(0.1, Math.min(20, dist / initDist));
            const list2 = this._loadShapes();
            const t = list2.find(s => s.id === shape.id);
            if (!t) return;
            const scalePt = ([x, y]) => [center[0] + (x - center[0]) * scale, center[1] + (y - center[1]) * scale];
            if (t.type === 'circle') {
                t.center = original.center ? original.center.slice() : center.slice();
                t.edge = scalePt(original.edge || original.coords[0]);
                t.coords = this._circlePolygon(t.center, t.edge);
            } else {
                t.coords = original.coords.map(scalePt);
                if (original.center) t.center = scalePt(original.center);
                if (original.edge)   t.edge   = scalePt(original.edge);
            }
            if (t.type === 'text') {
                t.fontSize = Math.max(9, Math.min(72, Math.round((original.fontSize || 13) * scale)));
            }
            this._saveShapes(list2);
            this._renderShapes();
        }, 'pinch:move');

        const onEnd = this._safe((e) => {
            const oe = e.originalEvent || e;
            if (oe.touches && oe.touches.length >= 2) return;
            try { this.map.off('touchmove', onMove); } catch (_) {}
            try { this.map.off('touchend', onEnd); } catch (_) {}
            try { this.map.off('touchcancel', onEnd); } catch (_) {}
            try { this.map.touchZoomRotate.enable(); } catch (_) {}
            try { this.map.dragPan.enable(); } catch (_) {}
            this._gesture = null;
            this._refreshUndoRedoButtons();
        }, 'pinch:end');

        this.map.on('touchmove', onMove);
        this.map.on('touchend', onEnd);
        this.map.on('touchcancel', onEnd);
    },

    _clearHandles() {
        if (this._handleMarkers) this._handleMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        this._handleMarkers = [];
    },

    _clearFloatingToolbar() {
        if (this._toolbarMarker) { try { this._toolbarMarker.remove(); } catch (_) {} this._toolbarMarker = null; }
    },

    // legacy : conservé au cas où d'autres callsites l'appelleraient
    _onShapeClick(e) {
        const feat = e.features && e.features[0];
        const id = feat && feat.properties && feat.properties.shapeId;
        if (id) this._selectShape(id);
    },

    /**
     * Calcule, pour chaque type de forme, la liste des poignées à rendre.
     * Chaque poignée : { role: 'move'|'corner'|'edge'|'endpoint'|'textresize',
     *                    index, lngLat: {lng, lat}, cursor }
     */
    _shapeHandles(s) {
        const handles = [];
        if (s.type === 'line') {
            // Trait simple OU cheminement libre multi-points : poignées au 1er et au DERNIER point.
            const last = s.coords.length - 1;
            handles.push({ role: 'endpoint', index: 0, lngLat: { lng: s.coords[0][0], lat: s.coords[0][1] }, cursor: 'grab' });
            handles.push({ role: 'endpoint', index: last, lngLat: { lng: s.coords[last][0], lat: s.coords[last][1] }, cursor: 'grab' });
        } else if (s.type === 'rectangle') {
            // coords est un polygone fermé à 5 points (le 5e === le 1er)
            for (let i = 0; i < 4; i++) {
                handles.push({
                    role: 'corner', index: i,
                    lngLat: { lng: s.coords[i][0], lat: s.coords[i][1] },
                    cursor: (i === 0 || i === 2) ? 'nwse-resize' : 'nesw-resize'
                });
            }
        } else if (s.type === 'circle') {
            const c = s.center || s.coords[0];
            const e = s.edge   || s.coords[Math.floor(s.coords.length / 4)] || c;
            handles.push({ role: 'edge', index: 0, lngLat: { lng: e[0], lat: e[1] }, cursor: 'ew-resize' });
            // poignée "centre" pour visualiser, drag = move
            handles.push({ role: 'move', index: -1, lngLat: { lng: c[0], lat: c[1] }, cursor: 'move' });
        } else if (s.type === 'text') {
            // une seule poignée bottom-right pour ajuster la taille de la police
            const c = s.coords[0];
            handles.push({ role: 'textresize', index: 0, lngLat: { lng: c[0], lat: c[1] }, cursor: 'nwse-resize' });
        }
        return handles;
    },

    _renderHandles() {
        this._clearHandles();
        if (!this.map || !this._selectedShapeId) return;
        // Verrou global : pas de poignées (ni déplacement, ni redimensionnement).
        if (this._locked) return;
        const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
        if (!s) { this._deselectShape(); return; }
        if (s.locked) return; // verrou individuel : forme figée
        const handles = this._shapeHandles(s);
        for (const h of handles) {
            const el = document.createElement('div');
            const isMove = h.role === 'move';
            const size = isMove ? 14 : 16;
            el.style.cssText = `
                width: ${size}px; height: ${size}px;
                background: ${isMove ? '#3b82f6' : '#ffffff'};
                border: 2px solid ${isMove ? '#ffffff' : '#3b82f6'};
                border-radius: ${h.role === 'edge' || isMove ? '50%' : '3px'};
                box-shadow: 0 1px 4px rgba(0,0,0,0.45);
                cursor: ${h.cursor};
                pointer-events: auto;
                touch-action: none;
                user-select: none;
                -webkit-user-select: none;
            `;
            // offset bottom-right pour la poignée textresize
            const markerOpts = { element: el, anchor: 'center' };
            if (h.role === 'textresize') {
                el.title = 'Glisser pour ajuster la taille du texte';
                markerOpts.offset = [60, 30];
            }
            const m = new maplibregl.Marker(markerOpts).setLngLat([h.lngLat.lng, h.lngLat.lat]).addTo(this.map);
            const shapeId = s.id;
            const role = h.role;
            const index = h.index;
            const onDown = this._safe((ev) => {
                if (this.drawTool || this.moveState || this._gesture) return;
                ev.preventDefault();
                ev.stopPropagation();
                const rect = this.map.getCanvas().getBoundingClientRect();
                const cx = (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX) - rect.left;
                const cy = (ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY) - rect.top;
                const lngLat = this.map.unproject([cx, cy]);
                this._startHandleGesture(shapeId, role, index, lngLat, ev);
            }, 'handle:down');
            el.addEventListener('pointerdown', onDown);
            el.addEventListener('touchstart', onDown, { passive: false });
            this._handleMarkers.push(m);
        }
    },

    /**
     * Geste de manipulation d'une poignée. Le pivot dépend du rôle :
     *   - endpoint (line)  : pivot = autre endpoint
     *   - corner (rect)    : pivot = coin opposé
     *   - edge (circle)    : pivot = centre, rayon redimensionné
     *   - move (circle ctr): translation de toute la forme
     *   - textresize       : ajuste shape.fontSize selon le delta px du pointeur
     */
    _startHandleGesture(shapeId, role, index, startLngLat, originalEvent) {
        const list = this._loadShapes();
        const shape = list.find(s => s.id === shapeId);
        if (!shape) return;
        this._pushHistory();
        const original = JSON.parse(JSON.stringify(shape));
        const startPx = this.map.project(startLngLat);

        try { this.map.dragPan.disable(); } catch (_) {}
        this.map.getCanvas().style.cursor = 'grabbing';
        this._gesture = { type: 'handle', shapeId, role, index, original, startPx };

        const clientToLngLat = (cx, cy) => {
            const r = this.map.getCanvas().getBoundingClientRect();
            return this.map.unproject([cx - r.left, cy - r.top]);
        };
        const extract = (ev) => {
            if (ev && ev.lngLat) return ev.lngLat;
            if (ev && ev.touches && ev.touches[0]) return clientToLngLat(ev.touches[0].clientX, ev.touches[0].clientY);
            if (ev && ev.clientX !== undefined) return clientToLngLat(ev.clientX, ev.clientY);
            return null;
        };
        const extractPx = (ev) => {
            if (ev && ev.point) return ev.point;
            if (ev && ev.touches && ev.touches[0]) {
                const r = this.map.getCanvas().getBoundingClientRect();
                return { x: ev.touches[0].clientX - r.left, y: ev.touches[0].clientY - r.top };
            }
            if (ev && ev.clientX !== undefined) {
                const r = this.map.getCanvas().getBoundingClientRect();
                return { x: ev.clientX - r.left, y: ev.clientY - r.top };
            }
            return null;
        };

        const onMove = this._safe((ev) => {
            if (!this._gesture || this._gesture.type !== 'handle') return;
            const cur = extract(ev);
            if (!cur) return;
            const list2 = this._loadShapes();
            const t = list2.find(s => s.id === shapeId);
            if (!t) return;
            const curArr = [cur.lng, cur.lat];

            if (t.type === 'line' && role === 'endpoint') {
                t.coords = original.coords.slice();
                t.coords[index] = curArr;
            } else if (t.type === 'rectangle' && role === 'corner') {
                // pivot = coin diagonalement opposé
                const opposite = original.coords[(index + 2) % 4];
                t.coords = this._rectPolygon(opposite, curArr);
            } else if (t.type === 'circle' && role === 'edge') {
                const center = (original.center || original.coords[0]).slice();
                t.center = center;
                t.edge = curArr;
                t.coords = this._circlePolygon(center, curArr);
            } else if (t.type === 'circle' && role === 'move') {
                const dLng = cur.lng - startLngLat.lng;
                const dLat = cur.lat - startLngLat.lat;
                t.coords = original.coords.map(([x, y]) => [x + dLng, y + dLat]);
                if (original.center) t.center = [original.center[0] + dLng, original.center[1] + dLat];
                if (original.edge)   t.edge   = [original.edge[0]   + dLng, original.edge[1]   + dLat];
            } else if (t.type === 'text' && role === 'textresize') {
                const px = extractPx(ev);
                if (!px) return;
                const dy = px.y - startPx.y;
                // ~1px souris = ~0.4pt de police, plage 9-72
                const base = original.fontSize || 13;
                t.fontSize = Math.max(9, Math.min(72, Math.round(base + dy * 0.4)));
            }
            this._saveShapes(list2);
            this._renderShapes();
            this._renderHandles();          // suit la forme
            this._updateFloatingToolbarPos(); // suit aussi
        }, 'handle:move');

        const onUp = this._safe(() => {
            try { this.map.off('mousemove', onMove); } catch (_) {}
            try { this.map.off('touchmove', onMove); } catch (_) {}
            try { this.map.off('mouseup', onUp); } catch (_) {}
            try { this.map.off('touchend', onUp); } catch (_) {}
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            document.removeEventListener('touchcancel', onUp);
            try { this.map.dragPan.enable(); } catch (_) {}
            this.map.getCanvas().style.cursor = '';
            this._gesture = null;
            this._refreshUndoRedoButtons();
        }, 'handle:up');

        this.map.on('mousemove', onMove);
        this.map.on('touchmove', onMove);
        this.map.on('mouseup', onUp);
        this.map.on('touchend', onUp);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
    },

    /** Rendu de la barre flottante d'actions (Texte / Couleur / Suppr / +/-). */
    _renderFloatingToolbar() {
        this._clearFloatingToolbar();
        if (!this.map || !this._selectedShapeId) return;
        const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
        if (!s) return;
        const anchor = this._shapeAnchor(s);
        if (!anchor) return;

        const el = document.createElement('div');
        el.className = 'plan-floating-toolbar';
        el.style.cssText = `
            display: flex; gap: 4px; align-items: center;
            background: rgba(20,24,32,0.95);
            backdrop-filter: blur(8px);
            color: #fff;
            padding: 4px 6px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.15);
            box-shadow: 0 6px 18px rgba(0,0,0,0.5);
            font-family: var(--font-ui, sans-serif);
            white-space: nowrap;
            pointer-events: auto;
            touch-action: none;
            user-select: none;
            -webkit-user-select: none;
        `;
        const btn = (icon, title, color) => `
            <button type="button" data-act="${icon}" title="${title}"
                style="background: transparent; border: 0; color: ${color || '#fff'};
                       padding: 6px; min-width: 34px; min-height: 34px;
                       border-radius: 6px; cursor: pointer; display: inline-flex;
                       align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 20px;">${icon}</span>
            </button>`;

        let html = '';
        html += btn('text_fields', s.text ? 'Modifier le texte' : 'Ajouter du texte', '#eab308');
        if (s.text || s.type === 'text') {
            html += btn('text_decrease', 'Réduire la taille', '#fff');
            html += btn('text_increase', 'Agrandir la taille', '#fff');
        }
        if (s.type === 'circle') {
            const diaOn = (s.showDiameter !== false) && this._diameterGlobal;
            html += btn(diaOn ? 'straighten' : 'visibility_off', diaOn ? 'Masquer le diamètre' : 'Afficher le diamètre', diaOn ? '#22c55e' : '#94a3b8');
        }
        html += `<span style="width:1px; height: 22px; background: rgba(255,255,255,0.18); margin: 0 2px;"></span>`;
        html += btn('delete', 'Supprimer', '#ef4444');
        html += btn('close',  'Désélectionner', '#94a3b8');
        el.innerHTML = html;

        // Stoppe la propagation pour ne pas re-déclencher le geste de la forme
        const stop = (ev) => ev.stopPropagation();
        el.addEventListener('pointerdown', stop);
        el.addEventListener('mousedown',   stop);
        el.addEventListener('touchstart',  stop, { passive: false });

        el.querySelectorAll('button[data-act]').forEach(b => {
            b.onclick = (ev) => {
                ev.stopPropagation();
                const act = b.dataset.act;
                if (act === 'text_fields') this._openTextModal(s.id);
                else if (act === 'text_decrease') this._adjustFontSize(s.id, -2);
                else if (act === 'text_increase') this._adjustFontSize(s.id, +2);
                else if (act === 'straighten' || act === 'visibility_off') this._toggleShapeDiameter(s.id);
                else if (act === 'delete') {
                    this._pushHistory();
                    const list = this._loadShapes().filter(x => x.id !== s.id);
                    this._saveShapes(list);
                    this._deselectShape();
                    this._renderShapes();
                    this._refreshUndoRedoButtons();
                } else if (act === 'close') {
                    this._deselectShape();
                }
            };
        });

        this._toolbarMarker = new maplibregl.Marker({
            element: el, anchor: 'bottom', offset: [0, -28]
        }).setLngLat([anchor.lng, anchor.lat]).addTo(this.map);
    },

    /** Met à jour la position de la barre flottante (suit la forme). */
    _updateFloatingToolbarPos() {
        if (!this._toolbarMarker || !this._selectedShapeId) return;
        const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
        if (!s) return;
        const a = this._shapeAnchor(s);
        if (a) this._toolbarMarker.setLngLat([a.lng, a.lat]);
    },

    _adjustFontSize(shapeId, delta) {
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s) return;
        this._pushHistory();
        const cur = s.fontSize || 13;
        s.fontSize = Math.max(9, Math.min(72, cur + delta));
        this._saveShapes(list);
        this._renderShapes();
        this._renderHandles();
        this._refreshUndoRedoButtons();
    },

    /** Ajuste l'épaisseur du trait d'une forme (trait / cercle / rectangle). */
    _adjustStrokeWidth(shapeId, delta) {
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s) return;
        this._pushHistory();
        const cur = s.strokeWidth || 3;
        s.strokeWidth = Math.max(1, Math.min(24, cur + delta));
        this._saveShapes(list);
        this._renderShapes();
        this._renderHandles();
        this._refreshUndoRedoButtons();
    },

    _toggleShapeDiameter(shapeId) {
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s || s.type !== 'circle') return;
        s.showDiameter = !(s.showDiameter !== false); // toggle, défaut true
        this._saveShapes(list);
        this._renderDiameters();
        if (this._activeWheel) {
            // Si la roue est ouverte, on la rafraîchit pour l'icône à jour
            this._openShapeWheel(shapeId, this._activeWheel.lngLat);
        }
    },

    // ============================================================
    // =================  ROUES CONTEXTUELLES  ===================
    // ============================================================
    /** Ferme la roue active s'il y en a une. */
    _closeWheel() {
        if (this._activeWheel) { try { this._activeWheel.destroy(); } catch (_) {} this._activeWheel = null; }
        this._wheelJustClosed = Date.now();
    },

    /**
     * Copie les coordonnées d'un point dans le presse-papier (décimal + DMS + MGRS).
     * Utilisé par l'option « Copier coordonnées » des roues. Fallback execCommand si
     * l'API Clipboard est absente (contexte non sécurisé / navigateur ancien).
     */
    _copyCoords(lng, lat) {
        const text = formatCoordsClipboard(lng, lat);
        const done = () => {
            this._showHint('Coordonnées copiées — ' + shortMgrs(lng, lat));
            setTimeout(() => this._hideHint(), 2000);
        };
        const fallback = () => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                done();
            } catch (e) {
                // Dernier recours : on affiche les coordonnées pour copie manuelle.
                this._showHint('Copie impossible — ' + shortMgrs(lng, lat));
                setTimeout(() => this._hideHint(), 3500);
            }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
            fallback();
        }
    },

    /** Couleurs OTAN (référencées partout).
     *  `defaultLabel` (optionnel) force le libellé quand on pose en quick-place,
     *  même si l'icône par défaut s'appelle autrement dans PIN_ICONS. */
    _otanColors() {
        return [
            { kind: 'Adv',     color: '#ef4444', icon: 'person_alert' },
            { kind: 'Otage',   color: '#eab308', icon: 'person_off' },
            { kind: 'Inter',   color: '#3b82f6', icon: 'local_police' },
            { kind: 'Oscar',   color: '#22c55e', icon: 'military_tech', defaultLabel: 'Oscar' },
            { kind: 'Inconnu', color: '#94a3b8', icon: 'help' }
        ];
    },

    /**
     * Roue de CRÉATION d'un ping — 1 SEUL niveau, simple :
     *  - 5 segments couleur : tap = ping placé directement (icône par défaut)
     *  - 1 segment "Catalogue" : ouvre un panneau d'icônes (color + icon)
     * Après placement, ouvre la roue d'options sur le ping.
     */
    _openCreatePingWheel(lngLat) {
        this._closeWheel();
        const opts = this._otanColors().map(o => ({
            id: 'kind_' + o.kind,
            icon: o.icon,
            label: o.kind,
            color: '#fff',
            bg: o.color,
            action: () => this._quickPlacePing(lngLat, o, o.icon)
        }));
        opts.push({
            id: 'catalog',
            icon: 'apps',
            label: 'Catalogue',
            color: '#fff',
            bg: '#475569',
            action: () => this._openIconCatalogPanel(lngLat)
        });
        opts.push({
            id: 'copycoords',
            icon: 'my_location',
            label: 'Copier coords',
            color: '#fff',
            bg: '#0f766e',
            action: () => this._copyCoords(lngLat.lng, lngLat.lat)
        });

        this._activeWheel = new Wheel({
            map: this.map,
            lngLat,
            title: 'Nouveau ping',
            options: opts,
            onClose: () => { this._activeWheel = null; }
        });
        this._activeWheel.open();
    },

    /** Pose un ping rapide. Le label par défaut = label override OTAN s'il existe,
     *  sinon le nom de l'icône (PIN_ICONS), sinon le kind. */
    _quickPlacePing(lngLat, otan, iconId) {
        const id = `free_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
        const iconDef = PIN_ICONS.find(i => i.id === iconId);
        const defaultLabel = otan.defaultLabel || (iconDef ? iconDef.label : otan.kind);
        this._addPin({
            id,
            label: defaultLabel,
            color: otan.color,
            kind: otan.kind,
            icon: iconId,
            lng: lngLat.lng,
            lat: lngLat.lat
        });
        // Ouvre la roue d'édition à proximité pour ajustements rapides
        setTimeout(() => this._openPingOptionsWheel(id), 80);
    },

    /** Roue d'options pour un ping existant (texte, diamètre, icône, suppr). */
    _openPingOptionsWheel(pinId) {
        const pin = this._loadPins().find(p => p.id === pinId);
        if (!pin) return;
        const lngLat = { lng: pin.lng, lat: pin.lat };
        const otanColor = pin.color || '#3b82f6';
        const hasText = !!pin.text;
        const hasDiameter = pin.diameterM > 0;

        const opts = [
            {
                id: 'text',
                icon: 'text_fields',
                label: hasText ? 'Modifier texte' : 'Ajouter texte',
                color: '#fff',
                bg: 'rgba(234,179,8,0.95)',
                action: () => this._editPinText(pinId)
            },
            {
                id: 'diameter',
                icon: 'straighten',
                label: hasDiameter ? 'Modifier diamètre' : 'Ajouter diamètre',
                color: '#fff',
                bg: 'rgba(34,197,94,0.95)',
                action: () => this._editPinDiameter(pinId)
            },
            {
                id: 'icon',
                icon: 'palette',
                label: 'Changer icône',
                color: '#fff',
                bg: 'rgba(99,102,241,0.95)',
                action: () => this._openIconCatalogPanelForEdit(pinId)
            },
            {
                id: 'color',
                icon: 'palette',
                label: 'Couleur',
                color: '#fff',
                bg: 'rgba(168,85,247,0.95)',
                action: () => this._openPinColorPanel(pinId)
            },
            {
                id: 'lock',
                icon: pin.locked ? 'lock' : 'lock_open',
                label: pin.locked ? 'Déverrouiller' : 'Verrouiller',
                color: '#fff',
                bg: pin.locked ? 'rgba(234,179,8,0.95)' : 'rgba(100,116,139,0.95)',
                action: () => this._togglePinLock(pinId)
            },
            {
                id: 'copycoords',
                icon: 'my_location',
                label: 'Copier coords',
                color: '#fff',
                bg: 'rgba(15,118,110,0.95)',
                action: () => this._copyCoords(pin.lng, pin.lat)
            },
            {
                id: 'delete',
                icon: 'delete',
                label: 'Supprimer',
                color: '#fff',
                bg: 'rgba(239,68,68,0.95)',
                action: () => this._removePin(pinId)
            }
        ];

        this._closeWheel();
        this._activeWheel = new Wheel({
            map: this.map,
            lngLat,
            title: pin.label || pin.kind || 'Ping',
            options: opts,
            onClose: () => { this._activeWheel = null; }
        });
        this._activeWheel.open();
    },

    /** Verrouille / déverrouille la position d'UN ping (indépendamment du verrou global). */
    _togglePinLock(pinId, reopenWheel = true) {
        const list = this._loadPins();
        const pin = list.find(p => p.id === pinId);
        if (!pin) return;
        pin.locked = !pin.locked;
        this._savePins(list);
        this._renderPins();
        this._showHint(pin.locked ? 'Ping verrouillé' : 'Ping déverrouillé');
        setTimeout(() => this._hideHint(), 1400);
        // Depuis la roue : la rouvre pour refléter l'état. Depuis le cadenas direct : non.
        if (reopenWheel) this._openPingOptionsWheel(pinId);
    },

    // ============================================================
    // =======  MINI-PANELS INLINE (sans prompt natif)  ===========
    // ============================================================

    /** Ferme le mini-panel actif s'il y en a un. */
    _closeInlinePanel() {
        if (this._inlinePanel) {
            try { if (this._inlinePanel.__cleanup) this._inlinePanel.__cleanup(); } catch (_) {}
            try { this._inlinePanel.remove(); } catch (_) {}
            this._inlinePanel = null;
            this._wheelJustClosed = Date.now(); // évite la réouverture par tap juste après
        }
    },

    /**
     * Crée un mini-panel flottant ancré à une position lng/lat sur la carte.
     * Le panel suit le pan/zoom. Auto-ferme sur outside tap (capture phase).
     * @returns {HTMLElement} l'élément à remplir
     */
    _openInlinePanel(lngLat, contentHtml, { onMount, anchorOffsetY = -56, centerScreen = false, onBack = null } = {}) {
        this._closeInlinePanel();
        this._closeWheel();
        const parent = this.map.getContainer();
        const el = document.createElement('div');
        el.className = 'plan-inline-panel';
        el.style.cssText = `
            position: absolute;
            transform: translate(-50%, -50%) scale(0.92);
            opacity: 0;
            transition: transform 140ms cubic-bezier(.34,1.56,.64,1), opacity 120ms ease-out;
            background: rgba(20,24,32,0.96);
            backdrop-filter: blur(10px);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 12px;
            padding: 10px 12px;
            box-shadow: 0 10px 28px rgba(0,0,0,0.6);
            font-family: var(--font-ui, sans-serif);
            z-index: 70;
            display: flex; align-items: center; gap: 8px;
            max-width: min(94vw, 420px);
        `;
        // Bouton retour optionnel (← roue précédente) ajouté avant le contenu
        const backHtml = onBack ? `
            <button type="button" data-panel-back="1" title="Retour"
                style="min-width: 38px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2);
                       color: #fff; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;">
                <span class="material-symbols-outlined" style="font-size: 20px;">arrow_back</span>
            </button>
        ` : '';
        el.innerHTML = backHtml + contentHtml;
        // Empêche les events de la map sur ce panel
        el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        el.addEventListener('mousedown',   (ev) => ev.stopPropagation());
        el.addEventListener('touchstart',  (ev) => ev.stopPropagation(), { passive: true });
        if (onBack) {
            const backBtn = el.querySelector('[data-panel-back="1"]');
            if (backBtn) backBtn.onclick = (ev) => {
                ev.stopPropagation();
                this._closeInlinePanel();
                setTimeout(() => onBack(), 60);
            };
        }
        parent.appendChild(el);

        const clampToParent = () => {
            // Garantit que le panel reste entièrement visible dans la carte.
            if (!el || !el.isConnected) return;
            const r = el.getBoundingClientRect();
            const pr = parent.getBoundingClientRect();
            const pad = 8;
            let dx = 0, dy = 0;
            if (r.left   < pr.left   + pad) dx = pr.left   + pad - r.left;
            if (r.right  > pr.right  - pad) dx = pr.right  - pad - r.right;
            if (r.top    < pr.top    + pad) dy = pr.top    + pad - r.top;
            if (r.bottom > pr.bottom - pad) dy = pr.bottom - pad - r.bottom;
            if (dx || dy) {
                const left = parseFloat(el.style.left) || 0;
                const top  = parseFloat(el.style.top)  || 0;
                el.style.left = `${left + dx}px`;
                el.style.top  = `${top  + dy}px`;
            }
        };
        const reposition = () => {
            if (!lngLat || centerScreen) {
                const r = parent.getBoundingClientRect();
                el.style.left = `${r.width / 2}px`;
                el.style.top  = `${r.height / 2}px`;
            } else {
                const p = this.map.project(lngLat);
                el.style.left = `${p.x}px`;
                el.style.top  = `${p.y + anchorOffsetY}px`;
            }
            // Clamp immédiat puis encore après layout (au cas où contenu changé)
            requestAnimationFrame(clampToParent);
        };
        reposition();
        this.map.on('move', reposition);
        this.map.on('zoom', reposition);

        // Outside tap closes
        const mountedAt = Date.now();
        const onOutside = (ev) => {
            if (Date.now() - mountedAt < 120) return;
            if (!el.contains(ev.target)) {
                this._closeInlinePanel();
            }
        };
        document.addEventListener('pointerdown', onOutside, { capture: true });
        const onKey = (ev) => { if (ev.key === 'Escape') this._closeInlinePanel(); };
        document.addEventListener('keydown', onKey);

        this._inlinePanel = el;
        el.__cleanup = () => {
            try { this.map.off('move', reposition); } catch (_) {}
            try { this.map.off('zoom', reposition); } catch (_) {}
            document.removeEventListener('pointerdown', onOutside, { capture: true });
            document.removeEventListener('keydown', onKey);
        };
        // Hook personnalisé pour wiring après mount
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translate(-50%, -50%) scale(1)';
            if (onMount) onMount(el);
        });
        return el;
    },

    /** Édite (ou ajoute) le texte d'un ping via un mini-panel flottant. */
    _editPinText(pinId) {
        const list = this._loadPins();
        const p = list.find(x => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        const initial = (p.text || '').replace(/"/g, '&quot;');
        const html = `
            <span class="material-symbols-outlined" style="font-size: 20px; color: #eab308;">text_fields</span>
            <input type="text" value="${initial}" placeholder="Texte du ping…" autocomplete="off"
                style="flex:1; min-width: 180px; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                       border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 15px;
                       outline: none;" />
            <button type="button" data-act="save" title="Enregistrer"
                style="min-width: 40px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: #22c55e; border: 1px solid #16a34a; color: #fff; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 20px;">check</span>
            </button>
            <button type="button" data-act="clear" title="Effacer"
                style="min-width: 40px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(239,68,68,0.18); border: 1px solid #ef4444; color: #fff; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 20px;">delete</span>
            </button>
        `;
        this._openInlinePanel(ll, html, {
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                const input = root.querySelector('input');
                if (input) { input.focus(); input.select(); }
                root.querySelector('[data-act="save"]').onclick = () => {
                    const v = (root.querySelector('input').value || '').trim();
                    const list2 = this._loadPins();
                    const p2 = list2.find(x => x.id === pinId);
                    if (p2) { p2.text = v; this._savePins(list2); this._renderPins(); }
                    this._closeInlinePanel();
                };
                root.querySelector('[data-act="clear"]').onclick = () => {
                    const list2 = this._loadPins();
                    const p2 = list2.find(x => x.id === pinId);
                    if (p2) { delete p2.text; this._savePins(list2); this._renderPins(); }
                    this._closeInlinePanel();
                };
                root.querySelector('input').addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') root.querySelector('[data-act="save"]').click();
                });
            }
        });
    },

    /**
     * Mini-panel diamètre — combine MODIFIER la valeur ET TOGGLE on/off l'affichage.
     *  - Toggle visibilité : conserve la valeur, masque/affiche le cercle
     *  - Presets / custom  : changent la valeur
     *  - Bouton ✕          : retire complètement le diamètre
     */
    _editPinDiameter(pinId) {
        const list = this._loadPins();
        const p = list.find(x => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        const current = p.diameterM || 0;
        const visible = p.diameterM > 0 && p.showDiameter !== false;
        const presets = [50, 100, 250, 500, 1000];
        const preBtn = (v) => `
            <button type="button" data-preset="${v}"
                style="min-width: 56px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: ${current === v ? '#22c55e' : 'rgba(255,255,255,0.08)'};
                       border: 1px solid ${current === v ? '#16a34a' : 'rgba(255,255,255,0.18)'};
                       color: #fff; font-weight: 600; font-size: 13px; padding: 0 10px;">
                ${v < 1000 ? v + ' m' : (v/1000) + ' km'}
            </button>`;
        const toggleIcon = visible ? 'visibility' : 'visibility_off';
        const toggleColor = visible ? '#22c55e' : '#94a3b8';
        const toggleTitle = visible ? 'Cercle visible (cliquer pour masquer)' : 'Cercle masqué (cliquer pour afficher)';
        this._openInlinePanel(ll, `
            <button type="button" data-act="toggle" title="${toggleTitle}"
                style="min-width: 44px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(255,255,255,0.06); border: 1px solid ${toggleColor};
                       color: ${toggleColor}; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 22px;">${toggleIcon}</span>
            </button>
            <span class="material-symbols-outlined" style="font-size: 20px; color: #22c55e;">straighten</span>
            <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
                ${presets.map(preBtn).join('')}
                <input type="number" min="1" step="1" placeholder="custom (m)" value="${current && !presets.includes(current) ? current : ''}"
                    style="width: 100px; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                           border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 14px;
                           outline: none;" />
            </div>
            <button type="button" data-act="clear" title="Retirer complètement"
                style="min-width: 40px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(239,68,68,0.18); border: 1px solid #ef4444; color: #fff; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 20px;">close</span>
            </button>
        `, {
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                const setDiameter = (n) => {
                    const list2 = this._loadPins();
                    const p2 = list2.find(x => x.id === pinId);
                    if (!p2) return;
                    if (!isFinite(n) || n <= 0) {
                        delete p2.diameterM;
                        delete p2.showDiameter;
                    } else {
                        p2.diameterM = n;
                        p2.showDiameter = true; // forcer affichage à l'assignation d'une valeur
                    }
                    this._savePins(list2);
                    this._renderPins();
                    this._closeInlinePanel();
                };
                const toggleVisibility = () => {
                    const list2 = this._loadPins();
                    const p2 = list2.find(x => x.id === pinId);
                    if (!p2) return;
                    if (!p2.diameterM || p2.diameterM <= 0) {
                        // pas de diamètre défini → on ne peut pas toggler ; ouvre direct la saisie
                        return;
                    }
                    p2.showDiameter = !(p2.showDiameter !== false);
                    this._savePins(list2);
                    this._renderPins();
                    this._closeInlinePanel();
                };
                root.querySelector('[data-act="toggle"]').onclick = toggleVisibility;
                root.querySelectorAll('[data-preset]').forEach(b => {
                    b.onclick = () => setDiameter(parseFloat(b.dataset.preset));
                });
                root.querySelector('[data-act="clear"]').onclick = () => setDiameter(NaN);
                const input = root.querySelector('input[type="number"]');
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') setDiameter(parseFloat(input.value));
                });
                input.addEventListener('blur', () => {
                    const v = parseFloat(input.value);
                    if (isFinite(v) && v > 0) setDiameter(v);
                });
            }
        });
    },

    /**
     * Panneau flottant catalogue d'icônes (remplace l'ancien sous-menu wheel).
     * Recentre la carte sur lngLat pour garantir la visibilité complète du panel
     * (sinon il peut déborder hors écran sur petits viewports).
     */
    _openIconCatalogPanel(lngLat) {
        this._closeWheel();
        // Recentrage : easeTo immédiat pour que le panel apparaisse au centre visible
        try { this.map.easeTo({ center: [lngLat.lng, lngLat.lat], duration: 300 }); } catch (_) {}
        // Construction HTML
        const colorChips = this._otanColors().map(o => `
            <button type="button" class="cat-col" data-color="${o.color}" data-kind="${o.kind}" title="${o.kind}"
                style="min-width: 40px; min-height: 40px; border-radius: 50%;
                       background: ${o.color}; border: 3px solid ${o.color === '#94a3b8' ? '#fff' : 'transparent'};
                       cursor: pointer; flex: 0 0 auto;"></button>
        `).join('');
        const html = `
            <div style="display: flex; flex-direction: column; gap: 10px; width: min(94vw, 380px);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 20px; color: #fff;">palette</span>
                    <strong style="font-size: 13px;">Couleur</strong>
                    <div style="display: flex; gap: 6px; margin-left: auto;">${colorChips}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="text" id="cat-filter" placeholder="Filtrer (police, pompier, drogue…)" autocomplete="off"
                        style="flex: 1; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                               border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 14px; outline: none;" />
                </div>
                <div id="cat-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
                     gap: 6px; max-height: 42vh; overflow-y: auto;"></div>
            </div>
        `;
        const el = this._openInlinePanel(lngLat, html, {
            centerScreen: true,
            onBack: () => this._openCreatePingWheel(lngLat),
            onMount: (root) => {
                let selectedColor = '#3b82f6';
                let selectedKind  = 'Inter';
                // Sélection initiale
                root.querySelectorAll('.cat-col').forEach(c => {
                    c.style.borderColor = (c.dataset.color === selectedColor) ? '#fff' : 'transparent';
                });
                root.querySelectorAll('.cat-col').forEach(c => {
                    c.onclick = () => {
                        selectedColor = c.dataset.color;
                        selectedKind  = c.dataset.kind;
                        root.querySelectorAll('.cat-col').forEach(o => o.style.borderColor = 'transparent');
                        c.style.borderColor = '#fff';
                    };
                });

                const grid = root.querySelector('#cat-grid');
                const filterInput = root.querySelector('#cat-filter');
                const renderGrid = (filter = '') => {
                    const q = filter.toLowerCase().trim();
                    const filtered = PIN_ICONS.filter(ic => {
                        if (!q) return true;
                        return (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase().includes(q);
                    });
                    grid.innerHTML = filtered.map(ic => `
                        <button type="button" class="cat-ic" data-id="${ic.id}" data-label="${ic.label}" title="${ic.label}"
                            style="display: flex; flex-direction: column; align-items: center; gap: 2px;
                                   padding: 8px 4px; border-radius: 6px;
                                   background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.15);
                                   color: #fff; cursor: pointer;">
                            <span class="material-symbols-outlined" style="font-size: 22px;">${ic.id}</span>
                            <span style="font-size: 0.65em; text-align: center; line-height: 1.05;">${ic.label}</span>
                        </button>
                    `).join('');
                    grid.querySelectorAll('.cat-ic').forEach(b => {
                        b.onclick = () => {
                            const ic = { id: b.dataset.id, label: b.dataset.label };
                            const otan = { kind: selectedKind, color: selectedColor };
                            this._closeInlinePanel();
                            this._quickPlacePing(lngLat, otan, ic.id);
                        };
                    });
                };
                renderGrid('');
                filterInput.addEventListener('input', () => renderGrid(filterInput.value));
            }
        });
    },

    /** Mini-panel inline pour changer la couleur OTAN d'un ping (sans sous-wheel). */
    _openPinColorPanel(pinId) {
        const p = this._loadPins().find(x => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        const chips = this._otanColors().map(o => `
            <button type="button" data-color="${o.color}" data-kind="${o.kind}" title="${o.kind}"
                style="min-width: 44px; min-height: 44px; border-radius: 50%;
                       background: ${o.color}; cursor: pointer;
                       border: 3px solid ${p.color === o.color ? '#fff' : 'transparent'};
                       box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></button>
        `).join('');
        this._openInlinePanel(ll, `
            <span class="material-symbols-outlined" style="font-size: 20px;">palette</span>
            <strong style="font-size: 13px;">Couleur :</strong>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">${chips}</div>
        `, {
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                root.querySelectorAll('button[data-color]').forEach(b => {
                    b.onclick = () => {
                        const list = this._loadPins();
                        const p2 = list.find(x => x.id === pinId);
                        if (p2) { p2.color = b.dataset.color; p2.kind = b.dataset.kind; this._savePins(list); this._renderPins(); }
                        this._closeInlinePanel();
                    };
                });
            }
        });
    },

    /** Catalogue d'icônes pour MODIFIER un ping existant (préserve la couleur). */
    _openIconCatalogPanelForEdit(pinId) {
        const p = this._loadPins().find(x => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        try { this.map.easeTo({ center: [ll.lng, ll.lat], duration: 300 }); } catch (_) {}
        const html = `
            <div style="display: flex; flex-direction: column; gap: 10px; width: min(94vw, 380px);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 20px; color: ${p.color || '#fff'};">${p.icon || 'place'}</span>
                    <strong style="font-size: 13px;">Icône actuelle</strong>
                    <input type="text" id="cat-edit-filter" placeholder="Filtrer…" autocomplete="off"
                        style="flex: 1; margin-left: auto; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                               border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 14px; outline: none;" />
                </div>
                <div id="cat-edit-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
                     gap: 6px; max-height: 42vh; overflow-y: auto;"></div>
            </div>
        `;
        this._openInlinePanel(ll, html, {
            centerScreen: true,
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                const grid = root.querySelector('#cat-edit-grid');
                const fi = root.querySelector('#cat-edit-filter');
                const renderGrid = (filter = '') => {
                    const q = filter.toLowerCase().trim();
                    const filtered = PIN_ICONS.filter(ic =>
                        !q || (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase().includes(q)
                    );
                    grid.innerHTML = filtered.map(ic => `
                        <button type="button" class="cat-edit-ic" data-id="${ic.id}" title="${ic.label}"
                            style="display: flex; flex-direction: column; align-items: center; gap: 2px;
                                   padding: 8px 4px; border-radius: 6px;
                                   background: ${ic.id === p.icon ? p.color + '40' : 'rgba(255,255,255,0.04)'};
                                   border: 1px solid ${ic.id === p.icon ? p.color : 'rgba(255,255,255,0.15)'};
                                   color: #fff; cursor: pointer;">
                            <span class="material-symbols-outlined" style="font-size: 22px;">${ic.id}</span>
                            <span style="font-size: 0.65em; text-align: center; line-height: 1.05;">${ic.label}</span>
                        </button>
                    `).join('');
                    grid.querySelectorAll('.cat-edit-ic').forEach(b => {
                        b.onclick = () => {
                            const list = this._loadPins();
                            const tgt = list.find(x => x.id === pinId);
                            if (tgt) {
                                tgt.icon = b.dataset.id;
                                // Met à jour le label par défaut au nom de la nouvelle icône
                                const ic = PIN_ICONS.find(i => i.id === b.dataset.id);
                                if (ic) tgt.label = ic.label;
                                this._savePins(list);
                                this._renderPins();
                            }
                            this._closeInlinePanel();
                        };
                    });
                };
                renderGrid('');
                fi.addEventListener('input', () => renderGrid(fi.value));
            }
        });
    },

    /** Roue contextuelle pour modifier une FORME existante. */
    _openShapeWheel(shapeId, lngLat) {
        const s = this._loadShapes().find(x => x.id === shapeId);
        if (!s) return;
        const opts = [
            {
                id: 'text',
                icon: 'text_fields',
                label: s.text ? 'Modifier texte' : 'Ajouter texte',
                color: '#fff', bg: 'rgba(234,179,8,0.95)',
                action: () => this._openTextModal(s.id)
            }
        ];
        if (s.type === 'text') {
            // Texte libre : les boutons taille agissent sur la police.
            opts.push(
                { id: 'minus', icon: 'text_decrease', label: 'Taille -',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustFontSize(s.id, -2), keepOpen: true },
                { id: 'plus', icon: 'text_increase', label: 'Taille +',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustFontSize(s.id, +2), keepOpen: true }
            );
        } else {
            // Trait / Cercle / Rectangle : les boutons taille règlent l'épaisseur du trait.
            opts.push(
                { id: 'thin', icon: 'remove', label: 'Épaisseur -',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustStrokeWidth(s.id, -1), keepOpen: true },
                { id: 'thick', icon: 'add', label: 'Épaisseur +',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustStrokeWidth(s.id, +1), keepOpen: true }
            );
        }
        if (s.type === 'circle') {
            const diaOn = (s.showDiameter !== false) && this._diameterGlobal;
            opts.push({
                id: 'diameter',
                icon: diaOn ? 'visibility_off' : 'straighten',
                label: diaOn ? 'Masquer diamètre' : 'Afficher diamètre',
                color: '#fff', bg: 'rgba(34,197,94,0.95)',
                action: () => this._toggleShapeDiameter(s.id)
            });
        }
        opts.push({
            id: 'lock',
            icon: s.locked ? 'lock' : 'lock_open',
            label: s.locked ? 'Déverrouiller' : 'Verrouiller',
            color: '#fff',
            bg: s.locked ? 'rgba(234,179,8,0.95)' : 'rgba(100,116,139,0.95)',
            action: () => this._toggleShapeLock(s.id)
        });
        opts.push({
            id: 'delete', icon: 'delete', label: 'Supprimer',
            color: '#fff', bg: 'rgba(239,68,68,0.95)',
            action: () => {
                this._pushHistory();
                const list = this._loadShapes().filter(x => x.id !== s.id);
                this._saveShapes(list);
                this._deselectShape();
                this._renderShapes();
                this._refreshUndoRedoButtons();
            }
        });

        this._closeWheel();
        this._activeWheel = new Wheel({
            map: this.map,
            lngLat,
            title: ({ line: 'Trait', rectangle: 'Rectangle', circle: 'Cercle', text: 'Texte' })[s.type] || 'Forme',
            options: opts,
            onClose: () => { this._activeWheel = null; }
        });
        this._activeWheel.open();
    },

    /** Verrouille / déverrouille la position+taille d'UNE forme (indépendamment du verrou global). */
    _toggleShapeLock(shapeId, reopenWheel = true) {
        const anchor = this._activeWheel ? this._activeWheel.lngLat : null;
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s) return;
        s.locked = !s.locked;
        this._saveShapes(list);
        // Forme verrouillée : on retire les poignées ; sinon on les réaffiche.
        if (s.locked) this._clearHandles();
        else this._renderHandles();
        this._renderShapes();       // rafraîchit aussi les cadenas via _renderShapeLocks
        this._showHint(s.locked ? 'Dessin verrouillé' : 'Dessin déverrouillé');
        setTimeout(() => this._hideHint(), 1400);
        // Depuis la roue : la rouvre pour refléter l'état. Depuis le cadenas direct : non.
        if (reopenWheel) this._openShapeWheel(shapeId, anchor || this._shapeAnchor(s));
    },

    /** Bascule en mode déplacement : la forme suit le curseur jusqu'au prochain clic.
     *  Compatible souris ET tactile (mousemove + touchmove → click pour valider). */
    /**
     * Démarrage générique d'une transformation (déplacement / redimensionnement).
     * Au lieu d'un "clic-pour-valider" (sujet à races avec maplibre), on affiche
     * une barre flottante Valider/Annuler — déterministe, claire, mobile-friendly.
     *
     * @param {Object} opts
     *   @param {string} opts.mode      'move' | 'resize'
     *   @param {string} opts.shapeId
     *   @param {Function} opts.applyMove  (currentLngLat, original) => updatedShape
     *   @param {string} opts.cursor    valeur CSS cursor
     *   @param {string} opts.hintText  texte d'aide
     */
    _startTransform({ mode, shapeId, applyMove, cursor, hintText }) {
        // Si une transformation est déjà en cours, on l'annule proprement.
        if (this.moveState) this._cancelMoveShape();

        const list = this._loadShapes();
        const shape = list.find(s => s.id === shapeId);
        if (!shape) return;

        this._pushHistory();
        const original = JSON.parse(JSON.stringify(shape));
        this.moveState = { shapeId, mode, original, applyMove };

        const onMove = (e) => {
            if (!this.moveState) return;
            const cur = [e.lngLat.lng, e.lngLat.lat];
            const list2 = this._loadShapes();
            const target = list2.find(s => s.id === shapeId);
            if (!target) return;
            try {
                applyMove(cur, original, target);
            } catch (err) {
                console.error('[PlanMap] applyMove échec:', err);
                return;
            }
            this._saveShapes(list2);
            this._renderShapes();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') this._cancelMoveShape();
            else if (e.key === 'Enter') this._endMoveShape();
        };

        this._moveHandlers = { onMove, onKey };
        this.map.on('mousemove', onMove);
        this.map.on('touchmove', onMove);
        document.addEventListener('keydown', onKey);
        this.map.getCanvas().style.cursor = cursor || 'move';

        this._showTransformToolbar(hintText);
    },

    /**
     * Déplacement : translation par delta du curseur depuis l'ancre (point cliqué).
     */
    _startMoveShape(shapeId, anchorLngLat) {
        this._startTransform({
            mode: 'move',
            shapeId,
            cursor: 'move',
            hintText: 'Déplacement : bouge le curseur, ✓ pour valider, ✕ pour annuler',
            applyMove: (cur, original, target) => {
                const dLng = cur[0] - anchorLngLat[0];
                const dLat = cur[1] - anchorLngLat[1];
                target.coords = original.coords.map(([x, y]) => [x + dLng, y + dLat]);
                if (original.center) target.center = [original.center[0] + dLng, original.center[1] + dLat];
                if (original.edge)   target.edge   = [original.edge[0]   + dLng, original.edge[1]   + dLat];
            }
        });
    },

    /**
     * Redimensionnement : pivot fixe (start / coin / centre selon le type),
     * point mobile = curseur. Régénère la géométrie de la forme.
     */
    _startResizeShape(shapeId) {
        const list = this._loadShapes();
        const shape = list.find(s => s.id === shapeId);
        if (!shape) return;
        const orig = JSON.parse(JSON.stringify(shape));
        let pivot;
        if (shape.type === 'line')           pivot = orig.coords[0].slice();
        else if (shape.type === 'rectangle') pivot = orig.coords[0].slice();
        else if (shape.type === 'circle')    pivot = (orig.center || orig.coords[0]).slice();
        else return; // pas de resize pour text

        this._startTransform({
            mode: 'resize',
            shapeId,
            cursor: 'nwse-resize',
            hintText: 'Redimensionnement : bouge le curseur, ✓ pour valider, ✕ pour annuler',
            applyMove: (cur, original, target) => {
                if (target.type === 'line') {
                    target.coords = [pivot.slice(), cur];
                } else if (target.type === 'rectangle') {
                    target.coords = this._rectPolygon(pivot, cur);
                } else if (target.type === 'circle') {
                    target.coords = this._circlePolygon(pivot, cur);
                    target.center = pivot.slice();
                    target.edge = cur;
                }
            }
        });
    },

    _endMoveShape() {
        if (!this.moveState) return;
        this._teardownMove();
        this._refreshUndoRedoButtons();
    },

    _cancelMoveShape() {
        if (!this.moveState) return;
        // Restaure l'original
        const { shapeId, original } = this.moveState;
        const list = this._loadShapes();
        const idx = list.findIndex(s => s.id === shapeId);
        if (idx !== -1) {
            list[idx] = original;
            this._saveShapes(list);
            this._renderShapes();
        }
        // Annule le snapshot d'historique poussé au démarrage
        this.history.pop();
        this._teardownMove();
        this._refreshUndoRedoButtons();
    },

    _teardownMove() {
        if (this._moveHandlers) {
            try { this.map.off('mousemove', this._moveHandlers.onMove); } catch (e) {}
            try { this.map.off('touchmove', this._moveHandlers.onMove); } catch (e) {}
            document.removeEventListener('keydown', this._moveHandlers.onKey);
            this._moveHandlers = null;
        }
        this.moveState = null;
        if (this.map) this.map.getCanvas().style.cursor = '';
        this._hideTransformToolbar();
    },

    /** Barre flottante de validation (Valider / Annuler) pour move/resize. */
    _showTransformToolbar(message) {
        this._hideTransformToolbar();
        const parent = document.getElementById('plan_map')?.parentElement;
        if (!parent) return;
        const bar = document.createElement('div');
        bar.id = 'plan_transform_toolbar';
        bar.style.cssText = `
            position: absolute; top: 10px; left: 50%;
            transform: translateX(-50%);
            display: flex; align-items: center; gap: 10px;
            background: rgba(20,24,32,0.95);
            backdrop-filter: blur(10px);
            color: #fff;
            padding: 8px 12px;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.15);
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            font-family: var(--font-ui, sans-serif);
            font-size: 0.88em;
            z-index: 50;
            max-width: calc(100% - 20px);
            flex-wrap: wrap;
            justify-content: center;
        `;
        bar.innerHTML = `
            <span style="opacity: 0.9;">${message}</span>
            <button type="button" data-act="ok" style="
                display: inline-flex; align-items: center; gap: 4px;
                background: rgba(34,197,94,0.2); border: 1px solid #22c55e;
                color: #22c55e; padding: 6px 12px; border-radius: 6px;
                cursor: pointer; font-weight: 600; min-height: 36px;">
                <span class="material-symbols-outlined" style="font-size: 18px;">check</span>Valider
            </button>
            <button type="button" data-act="cancel" style="
                display: inline-flex; align-items: center; gap: 4px;
                background: rgba(239,68,68,0.2); border: 1px solid #ef4444;
                color: #ef4444; padding: 6px 12px; border-radius: 6px;
                cursor: pointer; font-weight: 600; min-height: 36px;">
                <span class="material-symbols-outlined" style="font-size: 18px;">close</span>Annuler
            </button>
        `;
        bar.querySelector('[data-act="ok"]').onclick = (ev) => {
            ev.stopPropagation();
            this._endMoveShape();
        };
        bar.querySelector('[data-act="cancel"]').onclick = (ev) => {
            ev.stopPropagation();
            this._cancelMoveShape();
        };
        parent.appendChild(bar);
    },

    _hideTransformToolbar() {
        const bar = document.getElementById('plan_transform_toolbar');
        if (bar) bar.remove();
    },

    // ============================================================
    // ===================  ANNOTATIONS TEXTE  ====================
    // ============================================================

    /**
     * Ouvre la modale d'édition de texte pour la forme `targetId`.
     * Si `targetId` correspond à une forme `text` existante, on l'édite.
     * Sinon, on ajoute / modifie l'annotation `text` d'une forme dessinée.
     */
    _openTextModal(targetId) {
        this._bindTextModalOnce(); // défensif : assure que les listeners sont en place
        const modal = document.getElementById('planTextModal');
        const backdrop = document.getElementById('modalBackdrop');
        if (!modal || !backdrop) return;
        const target = this._loadShapes().find(s => s.id === targetId);
        const input = document.getElementById('plan_text_input');
        const idHidden = document.getElementById('plan_text_target_id');
        const colorVal = document.getElementById('plan_text_color_val');
        const sizeVal  = document.getElementById('plan_text_size_input');
        const sizeDisp = document.getElementById('plan_text_size_val');
        const titleEl = document.getElementById('planTextModalTitle');
        if (titleEl) titleEl.textContent = target?.type === 'text' ? 'Texte libre' : 'Annoter le dessin';
        if (idHidden) idHidden.value = targetId;
        if (input) input.value = target?.text || '';
        const col = target?.textColor || target?.color || '#ffffff';
        if (colorVal) colorVal.value = col;
        const sz = Math.max(9, Math.min(72, target?.fontSize || 13));
        if (sizeVal) sizeVal.value = String(sz);
        if (sizeDisp) sizeDisp.textContent = String(sz);
        document.querySelectorAll('#plan_text_color_palette .plan-text-color').forEach(b => {
            b.style.borderColor = (b.dataset.color === col) ? '#fff' : 'transparent';
        });
        // En plein écran, le modal (enfant de <body>) n'est pas rendu : seul le
        // sous-arbre de l'élément fullscreen l'est. On le déplace donc dans cet
        // élément le temps de l'édition, puis on le restaure à la fermeture.
        this._mountModalInFullscreen(modal, backdrop);
        backdrop.style.display = 'block';
        modal.style.display = 'block';
        setTimeout(() => input && input.focus(), 50);
    },

    /**
     * Si un élément est en plein écran et que le modal n'en fait pas partie,
     * on réinsère modal + backdrop dans l'élément fullscreen (sinon invisibles).
     * Mémorise l'emplacement d'origine pour pouvoir restaurer.
     */
    _mountModalInFullscreen(modal, backdrop) {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (!fsEl || !modal) return;
        if (fsEl.contains(modal)) return; // déjà dedans
        this._modalReparent = {
            modal, backdrop,
            modalParent: modal.parentNode, modalNext: modal.nextSibling,
            bdParent: backdrop ? backdrop.parentNode : null, bdNext: backdrop ? backdrop.nextSibling : null
        };
        if (backdrop) fsEl.appendChild(backdrop);
        fsEl.appendChild(modal);
    },

    /** Restaure modal + backdrop à leur emplacement d'origine (post-plein écran). */
    _restoreModalFromFullscreen() {
        const r = this._modalReparent;
        if (!r) return;
        try {
            if (r.modalParent) r.modalParent.insertBefore(r.modal, r.modalNext);
            if (r.bdParent && r.backdrop) r.bdParent.insertBefore(r.backdrop, r.bdNext);
        } catch (_) {}
        this._modalReparent = null;
    },

    _hideTextModal() {
        // Si l'utilisateur ferme la modale d'un texte libre vide jamais validé,
        // on retire la forme fantôme du store (évite les invisibles persistants).
        const id = document.getElementById('plan_text_target_id')?.value;
        if (id) {
            const list = this._loadShapes();
            const idx = list.findIndex(s => s.id === id);
            if (idx !== -1 && list[idx].type === 'text' && !list[idx].text) {
                list.splice(idx, 1);
                this._saveShapes(list);
                if (this._selectedShapeId === id) this._deselectShape();
                this._renderShapes();
            }
        }
        const modal = document.getElementById('planTextModal');
        const backdrop = document.getElementById('modalBackdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
        this._restoreModalFromFullscreen();
    },

    /** Confirme la saisie de texte : applique sur la forme cible. */
    _confirmTextModal() {
        const id = document.getElementById('plan_text_target_id')?.value;
        const text = (document.getElementById('plan_text_input')?.value || '').trim();
        const color = document.getElementById('plan_text_color_val')?.value || '#ffffff';
        const size = parseInt(document.getElementById('plan_text_size_input')?.value, 10) || 13;
        if (!id) return this._hideTextModal();
        const list = this._loadShapes();
        const idx = list.findIndex(s => s.id === id);
        if (idx === -1) return this._hideTextModal();
        this._pushHistory();
        if (list[idx].type === 'text') {
            if (!text) {
                // Suppression d'un texte libre
                list.splice(idx, 1);
                if (this._selectedShapeId === id) this._deselectShape();
            } else {
                list[idx].text = text;
                list[idx].textColor = color;
                list[idx].color = color;
                list[idx].fontSize = Math.max(9, Math.min(72, size));
            }
        } else {
            list[idx].text = text;
            list[idx].textColor = color;
            list[idx].fontSize = Math.max(9, Math.min(72, size));
        }
        this._saveShapes(list);
        this._renderShapes();
        this._refreshUndoRedoButtons();
        // Garde la forme sélectionnée pour permettre l'édition immédiate (handles + toolbar)
        const stillExists = this._loadShapes().some(s => s.id === id);
        if (stillExists) this._selectShape(id);
        // Ferme la modale (sans retrigger le cleanup vide)
        const modal = document.getElementById('planTextModal');
        const backdrop = document.getElementById('modalBackdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
        this._restoreModalFromFullscreen();
    },

    /** Initialise (une seule fois) les listeners de la modale de texte. */
    _bindTextModalOnce() {
        if (this._textModalBound) return;
        this._textModalBound = true;
        const ok = document.getElementById('planTextConfirmBtn');
        const ko = document.getElementById('planTextCancelBtn');
        if (ok) ok.onclick = () => this._confirmTextModal();
        if (ko) ko.onclick = () => this._hideTextModal();
        document.querySelectorAll('#plan_text_color_palette .plan-text-color').forEach(b => {
            b.onclick = () => {
                document.querySelectorAll('#plan_text_color_palette .plan-text-color').forEach(o => o.style.borderColor = 'transparent');
                b.style.borderColor = '#fff';
                document.getElementById('plan_text_color_val').value = b.dataset.color;
            };
        });
        const minusBtn = document.getElementById('plan_text_size_minus');
        const plusBtn  = document.getElementById('plan_text_size_plus');
        const sizeInput= document.getElementById('plan_text_size_input');
        const sizeDisp = document.getElementById('plan_text_size_val');
        const setSize = (n) => {
            const v = Math.max(9, Math.min(72, n));
            if (sizeInput) sizeInput.value = String(v);
            if (sizeDisp)  sizeDisp.textContent = String(v);
        };
        if (minusBtn) minusBtn.onclick = () => setSize(parseInt(sizeInput.value, 10) - 2);
        if (plusBtn)  plusBtn.onclick  = () => setSize(parseInt(sizeInput.value, 10) + 2);
        // Échap / Ctrl-Entrée dans la modale
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('planTextModal');
            if (!modal || modal.style.display !== 'block') return;
            if (e.key === 'Escape') this._hideTextModal();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this._confirmTextModal();
        });
    },

    /** Place une nouvelle forme `text` libre à la position cliquée. */
    _addFreeText(lngLat) {
        const id = 'shape_' + Date.now();
        const list = this._loadShapes();
        this._pushHistory();
        list.push({
            id, type: 'text',
            color: this.drawColor || '#ffffff',
            textColor: this.drawColor || '#ffffff',
            coords: [[lngLat.lng, lngLat.lat]],
            text: ''
        });
        this._saveShapes(list);
        this._refreshUndoRedoButtons();
        // Ouvre immédiatement la modale pour saisir le texte
        this._openTextModal(id);
    },

    /** Point d'ancrage d'une forme pour positionner son texte. */
    _shapeAnchor(s) {
        if (s.type === 'line') {
            const a = s.coords[0], b = s.coords[s.coords.length - 1];
            return { lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 };
        }
        if (s.type === 'rectangle') {
            const lngs = s.coords.map(c => c[0]);
            const lats = s.coords.map(c => c[1]);
            return { lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
                     lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
        }
        if (s.type === 'circle') {
            const c = s.center || s.coords[0];
            return { lng: c[0], lat: c[1] };
        }
        if (s.type === 'text') {
            const c = s.coords[0];
            return { lng: c[0], lat: c[1] };
        }
        return null;
    },

    /** Bounding-box pixels (à zoom courant) d'une forme. */
    _shapePixelBounds(s) {
        if (!this.map) return { width: 100, height: 50 };
        if (s.type === 'text') return { width: 240, height: 80 };
        const coords = s.coords || [];
        if (!coords.length) return { width: 100, height: 50 };
        const pts = coords.map(c => this.map.project({ lng: c[0], lat: c[1] }));
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        return {
            width:  Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys)
        };
    },

    /**
     * Rendu des annotations texte des formes (HTML markers).
     *  - line  : centré sur le milieu du trait, légèrement au-dessus
     *  - rect  : centré dans le rectangle, max-width ~ largeur
     *  - circ  : centré, max-width ~ diamètre × 0.7 (carré inscrit)
     *  - text  : annotation libre, max-width fixe
     *
     * Tronqué visuellement par `overflow: hidden` + max-height pour
     * garantir qu'il ne dépasse jamais la forme.
     */
    _renderShapeTexts() {
        if (!this.map) return;
        // Purge des markers précédents
        if (this._textMarkers) this._textMarkers.forEach(m => m.remove());
        this._textMarkers = [];
        // Index par shape ID pour que les diamètres puissent se positionner sous le texte
        this._textMarkersById = {};

        const shapes = this._loadShapes();
        for (const s of shapes) {
            if (s.type !== 'text' && !s.text) continue;          // pas de texte = rien à afficher
            if (s.type === 'text' && !s.text) continue;          // text vide = caché
            const anchor = this._shapeAnchor(s);
            if (!anchor) continue;
            const bounds = this._shapePixelBounds(s);

            let maxW, maxH, offsetY = 0;
            if (s.type === 'line') {
                maxW = Math.max(60, bounds.width * 0.95);
                maxH = 48;
                offsetY = -18;
            } else if (s.type === 'rectangle') {
                maxW = Math.max(40, bounds.width  * 0.92);
                maxH = Math.max(20, bounds.height * 0.92);
            } else if (s.type === 'circle') {
                const d = Math.min(bounds.width, bounds.height);
                maxW = Math.max(36, d * 0.7);
                maxH = Math.max(20, d * 0.7);
            } else if (s.type === 'text') {
                maxW = 240; maxH = 120;
            }

            const div = document.createElement('div');
            div.className = 'plan-shape-text';
            div.textContent = s.text || '';
            const col = s.textColor || s.color || '#fff';
            const fontSize = Math.max(9, Math.min(72, s.fontSize || 13));
            div.style.cssText = `
                color: ${col};
                text-shadow:
                    0 0 3px rgba(0,0,0,0.95),
                    0 0 6px rgba(0,0,0,0.7),
                    0 1px 2px rgba(0,0,0,0.9);
                font-family: var(--font-ui, system-ui, sans-serif);
                font-weight: 700;
                font-size: ${fontSize}px;
                line-height: 1.18;
                text-align: center;
                max-width: ${Math.round(maxW)}px;
                max-height: ${Math.round(maxH)}px;
                white-space: pre-wrap;
                overflow: hidden;
                pointer-events: auto;          /* interactif : tap/drag */
                cursor: grab;
                padding: 1px 4px;
                box-sizing: border-box;
                user-select: none;
                -webkit-user-select: none;
                -webkit-touch-callout: none;
                touch-action: none;
            `;
            // Délégation au state-machine gestuelle commune : tap = menu, drag = déplacer
            const shapeId = s.id;
            const onTextPointerDown = (ev) => {
                if (this.drawTool || this.moveState || this._gesture) return;
                ev.preventDefault();
                ev.stopPropagation();
                // Convertit la position pointeur → lngLat carte
                const rect = this.map.getCanvas().getBoundingClientRect();
                const x = (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX) - rect.left;
                const y = (ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY) - rect.top;
                const lngLat = this.map.unproject([x, y]);
                this._startShapeGesture(shapeId, lngLat, ev);
            };
            div.addEventListener('pointerdown', onTextPointerDown);
            // Fallback pour vieux iOS sans Pointer Events
            div.addEventListener('touchstart', onTextPointerDown, { passive: false });

            const m = new maplibregl.Marker({
                element: div, anchor: 'center', offset: [0, offsetY]
            }).setLngLat([anchor.lng, anchor.lat]).addTo(this.map);
            this._textMarkers.push(m);
            this._textMarkersById[s.id] = m;
        }
    },

    /**
     * Long-press detector (Google Maps style) : 500 ms d'appui immobile sur zone
     * vide ouvre la roue de création de ping. Annulé dès qu'on bouge (pan), qu'on
     * relâche, ou qu'on touche une forme/ping.
     *
     * Implémente un feedback haptique-visuel : pulse à l'écran quand le timer
     * atteint la moitié, full quand validé.
     */
    _wireLongPressForPing() {
        const LP_DELAY = 480;     // ms
        const LP_TOLERANCE = 8;   // px de tolérance
        let lp = null; // { startPx, startLngLat, timer, ringEl }

        const cancel = () => {
            if (!lp) return;
            if (lp.timer) clearTimeout(lp.timer);
            if (lp.ringEl) { try { lp.ringEl.remove(); } catch (_) {} }
            lp = null;
        };
        const isOnFeature = (point) => {
            const hits = this.map.queryRenderedFeatures(point, {
                layers: ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit']
            });
            return hits.length > 0;
        };
        const showRing = (clientX, clientY) => {
            const ring = document.createElement('div');
            ring.style.cssText = `
                position: fixed; left: ${clientX}px; top: ${clientY}px;
                width: 12px; height: 12px;
                transform: translate(-50%, -50%);
                border-radius: 50%;
                border: 3px solid #3b82f6;
                box-shadow: 0 0 0 0 rgba(59,130,246,0.6);
                pointer-events: none;
                z-index: 9999;
                animation: pctacLpRing ${LP_DELAY}ms linear forwards;
            `;
            document.body.appendChild(ring);
            return ring;
        };
        // Keyframe injecté une fois
        if (!document.getElementById('pctac-lp-ring-style')) {
            const s = document.createElement('style');
            s.id = 'pctac-lp-ring-style';
            s.textContent = `@keyframes pctacLpRing {
                0%   { width: 12px; height: 12px; opacity: 0.4; }
                100% { width: 56px; height: 56px; opacity: 0.95; box-shadow: 0 0 12px 6px rgba(59,130,246,0.45); }
            }`;
            document.head.appendChild(s);
        }

        const start = (e) => {
            if (this.drawTool || this.moveState || this._gesture) return;
            if (this._activeWheel || this._inlinePanel) return;
            const oe = e.originalEvent;
            // Multi-touch (pinch zoom etc.) → on annule le long-press
            if (oe && oe.touches && oe.touches.length > 1) { cancel(); return; }
            if (lp) cancel(); // ne pas empiler
            // Si le pointerdown provient d'un marker DOM (pin, handle, label, toolbar…),
            // ne pas déclencher la création de ping — c'est le marker qui gère.
            if (oe && oe.target && typeof oe.target.closest === 'function' &&
                oe.target.closest('.maplibregl-marker, .plan-wheel, .plan-inline-panel')) return;
            if (isOnFeature(e.point)) return; // forme/ping → priorité au gestionnaire de forme
            const clientX = (oe && oe.touches && oe.touches[0]) ? oe.touches[0].clientX
                          : (oe && oe.clientX) || 0;
            const clientY = (oe && oe.touches && oe.touches[0]) ? oe.touches[0].clientY
                          : (oe && oe.clientY) || 0;
            const ringEl = showRing(clientX, clientY);
            lp = {
                startPx: { x: e.point.x, y: e.point.y },
                startLngLat: e.lngLat,
                ringEl,
                timer: setTimeout(() => {
                    if (!lp) return;
                    const ll = lp.startLngLat;
                    cancel();
                    this._openCreatePingWheel(ll);
                }, LP_DELAY)
            };
        };
        const move = (e) => {
            if (!lp) return;
            const dx = e.point.x - lp.startPx.x, dy = e.point.y - lp.startPx.y;
            if (Math.hypot(dx, dy) > LP_TOLERANCE) cancel();
        };

        this.map.on('mousedown', this._safe(start, 'longpress:start'));
        this.map.on('touchstart', this._safe(start, 'longpress:start'));
        this.map.on('mousemove', this._safe(move, 'longpress:move'));
        this.map.on('touchmove', this._safe(move, 'longpress:move'));
        this.map.on('mouseup', this._safe(cancel, 'longpress:cancel'));
        this.map.on('touchend', this._safe(cancel, 'longpress:cancel'));
        this.map.on('touchcancel', this._safe(cancel, 'longpress:cancel'));
        this.map.on('dragstart', this._safe(cancel, 'longpress:cancel'));
        this.map.on('movestart', this._safe(cancel, 'longpress:cancel'));
    },

    _loadShapes() {
        return Persist.get(SHAPES_KEY, { validator: Array.isArray, fallback: [] }) || [];
    },

    _saveShapes(list) {
        // Via Persist → la garde QuotaExceededError dispatch 'pctac:quota' sans jeter
        // ni bloquer (plus d'alert() synchrone qui figerait l'UI sur le terrain).
        Persist.set(SHAPES_KEY, list);
    },

    /** Rectangle aligné carte = polygone à 5 points (fermé) */
    _rectPolygon(a, b) {
        return [
            [a[0], a[1]],
            [b[0], a[1]],
            [b[0], b[1]],
            [a[0], b[1]],
            [a[0], a[1]]
        ];
    },

    /** Approximation polygonale d'un cercle géodésique (Haversine inverse).
     *  64 segments, calcul exact en mètres pour rester rond à toute latitude. */
    _circlePolygon(center, edge) {
        const R = 6371000; // rayon Terre en m
        const toRad = d => d * Math.PI / 180;
        const toDeg = r => r * 180 / Math.PI;

        const [lng1, lat1] = center;
        const [lng2, lat2] = edge;
        const phi1 = toRad(lat1), phi2 = toRad(lat2);
        const dPhi = toRad(lat2 - lat1);
        const dLambda = toRad(lng2 - lng1);
        const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
        const radiusMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        const N = 64;
        const coords = [];
        for (let i = 0; i <= N; i++) {
            const brg = (2 * Math.PI * i) / N;
            const sinPhi = Math.sin(phi1) * Math.cos(radiusMeters / R) +
                Math.cos(phi1) * Math.sin(radiusMeters / R) * Math.cos(brg);
            const phi = Math.asin(sinPhi);
            const lambda = toRad(lng1) + Math.atan2(
                Math.sin(brg) * Math.sin(radiusMeters / R) * Math.cos(phi1),
                Math.cos(radiusMeters / R) - Math.sin(phi1) * sinPhi
            );
            coords.push([toDeg(lambda), toDeg(phi)]);
        }
        return coords;
    },

    /**
     * Point d'arête situé à exactement `radiusM` mètres DUE NORD du centre.
     * Utilise le MÊME rayon terrestre R (6371000 m) que _circlePolygon et
     * _haversineMeters, de sorte que _circlePolygon(center, edge) mesure
     * géodésiquement radiusM. Le déplacement étant plein nord (Δlng = 0), la
     * latitude varie de radiusM/R rad ; cos(lat) n'intervient que sur la
     * composante est-ouille, ici nulle, donc le rayon est exact à toute latitude.
     */
    _geoEdgeNorth(center, radiusM) {
        const R = 6371000;
        const deltaLatDeg = (radiusM / R) * (180 / Math.PI);
        return [center[0], center[1] + deltaLatDeg];
    },

    /**
     * Résumé des pings courants pour l'export PDF (CONTRAT C2).
     * @returns {Array<{label:string, lat:number, lng:number, diameterM:(number|null)}>}
     *          [] si aucun ping. Réutilise _loadPins (même source que _renderPins)
     *          et _resolvePin pour le libellé effectif (entité ou libre).
     */
    getPinsSummary() {
        try {
            const pins = this._loadPins();
            if (!Array.isArray(pins)) return [];
            return pins.map(pin => {
                let label;
                try { label = this._resolvePin(pin).label; }
                catch (_) { label = pin.label || pin.text || ''; }
                const dia = (typeof pin.diameterM === 'number' && pin.diameterM > 0)
                    ? pin.diameterM : null;
                return {
                    label: label || '',
                    lat: pin.lat,
                    lng: pin.lng,
                    diameterM: dia
                };
            });
        } catch (e) {
            console.error('[PlanMap] getPinsSummary échec:', e);
            return [];
        }
    },

    /**
     * Compose le canvas WebGL + overlays (markers/libellés/boussole via
     * html2canvas) et RETOURNE le PNG en dataURL (CONTRAT C2).
     * @returns {Promise<string|null>} dataURL PNG, ou null si carte non initialisée
     *          ou html2canvas indisponible (dégradation propre, hors-ligne).
     */
    async captureToDataUrl() {
        if (!this.map) return null;
        if (typeof html2canvas === 'undefined') return null;

        const mapContainer = this.map.getContainer();
        if (!mapContainer) return null;

        // Masquer l'UI superposée (on garde la boussole MapLibre)
        const toHide = [
            document.getElementById('plan_unified_toolbar'),
            document.getElementById('plan_draw_dock'),
            document.getElementById('plan_search_panel'),
            document.getElementById('plan_legend'),
            document.getElementById('plan_hint')
        ].filter(Boolean);
        // Les cadenas de verrouillage (pings + dessins) ne doivent pas apparaître à l'export.
        Array.prototype.push.apply(toHide,
            Array.prototype.slice.call(document.querySelectorAll('.plan-lock-badge')));
        const memo = toHide.map(el => el.style.display);
        toHide.forEach(el => { el.style.display = 'none'; });

        // Forcer un repaint pour que le canvas WebGL contienne la frame actuelle
        this.map.triggerRepaint();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        try {
            const glCanvas = this.map.getCanvas();
            const w = glCanvas.width;   // pixels réels (déjà × devicePixelRatio)
            const h = glCanvas.height;
            const cssW = glCanvas.clientWidth;
            const cssH = glCanvas.clientHeight;

            // Garde-fou plein écran : clientWidth peut être transitoirement 0.
            let dpr = cssW > 0 ? (w / cssW) : (window.devicePixelRatio || 1);
            if (!isFinite(dpr) || dpr <= 0) dpr = window.devicePixelRatio || 1;

            const overlay = await html2canvas(mapContainer, {
                useCORS: true,
                allowTaint: false,
                backgroundColor: null,
                logging: false,
                scale: dpr,
                width: cssW,
                height: cssH,
                windowWidth: cssW,
                windowHeight: cssH,
                scrollX: 0,
                scrollY: 0,
                ignoreElements: (el) => el.tagName === 'CANVAS'
            });

            const outCanvas = document.createElement('canvas');
            outCanvas.width = w;
            outCanvas.height = h;
            const ctx = outCanvas.getContext('2d');
            ctx.drawImage(glCanvas, 0, 0, w, h);
            ctx.drawImage(overlay, 0, 0, w, h);
            return outCanvas.toDataURL('image/png');
        } catch (e) {
            console.error('[PlanMap] capture échec:', e);
            return null;
        } finally {
            toHide.forEach((el, i) => { el.style.display = memo[i] || ''; });
        }
    },

    /**
     * Capture haute qualité de la carte avec ses annotations.
     *
     * Approche robuste (plein écran 2D ET 3D, après défilement) :
     *  1. Base = canvas WebGL natif de MapLibre (tuiles, relief 3D, bâtiments,
     *     dessins) — toujours aux dimensions pixel correctes quel que soit l'état.
     *  2. Overlay = markers DOM (pins + libellés + boussole) via html2canvas sur
     *     le conteneur #plan_map (même repère que le canvas), en IGNORANT tout
     *     <canvas>, avec fenêtre/scroll figés pour ne pas dépendre du viewport.
     *  3. Composition des deux dans un canvas final w×h → PNG.
     *
     * Clés anti-régression plein écran : on capture #plan_map (pas le cadre parent
     * qui se redimensionne), on fixe windowWidth/Height + scrollX/Y, et on borne le
     * scale (DPR) contre un clientWidth transitoirement nul.
     */
    async _takeScreenshot() {
        if (typeof html2canvas === 'undefined') {
            alert('Librairie html2canvas indisponible (réseau ?)');
            return;
        }
        if (!this.map) return;

        // Composition (canvas WebGL + overlays) déléguée à la méthode publique
        // captureToDataUrl (CONTRAT C2) ; ici on ne fait que déclencher le
        // téléchargement, comportement inchangé du bouton plan_btn_capture.
        let dataUrl;
        try {
            dataUrl = await this.captureToDataUrl();
        } catch (e) {
            console.error('[PlanMap] screenshot échec:', e);
            alert('Erreur lors de la capture : ' + e.message);
            return;
        }
        if (!dataUrl) {
            alert('Capture impossible (carte non initialisée ?)');
            return;
        }

        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = dataUrl;
        a.download = `pctac-plan-${stamp}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    // ============================================================
    // ===========  ZONE D'OPÉRATION HORS-LIGNE (AOI)  ============
    //  Le bouton #plan_btn_aoi arme un cadrage rectangle one-shot sur
    //  l'objectif ; à la validation on estime tuiles + volume, on vérifie
    //  storage.estimate(), on demande confirmation, puis on télécharge dans
    //  le MAP_CACHE (mêmes templates réels que la carte) avec backoff/réessai
    //  et une barre de progression annulable injectée dynamiquement.
    //  Bornes : z13→z18 par défaut, emprise plafonnée à AOI_MAX_TILES tuiles.
    // ============================================================

    AOI_MIN_Z: 13,
    AOI_MAX_Z: 18,

    /** Arme le mode de cadrage rectangle pour définir l'AOI (one-shot). */
    _startAoiFraming() {
        if (!this.map) return;
        if (typeof caches === 'undefined') {
            alert('Cache hors-ligne indisponible sur ce navigateur (Cache Storage absent).');
            return;
        }
        if (this._aoiFraming) return; // déjà en cours
        // On quitte tout outil de dessin/mesure pour ne pas mélanger les états.
        if (this.drawTool) this._setTool(null);
        this._aoiFraming = true;
        const aoiBtn = document.getElementById('plan_btn_aoi');
        if (aoiBtn) aoiBtn.classList.add('active');

        const canvas = this.map.getCanvas();
        canvas.style.cursor = 'crosshair';
        this.map.dragPan.disable();
        this.map.boxZoom.disable();
        this.map.doubleClickZoom.disable();
        this._showHint('Trace un rectangle sur la zone à télécharger (glisser-déposer). Échap pour annuler.');

        let start = null;
        const st = {};
        st.down = this._safe((e) => {
            if (e.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
            start = [e.lngLat.lng, e.lngLat.lat];
            st._start = start;
        }, 'aoi:down');
        st.move = this._safe((e) => {
            if (!start) return;
            const cur = [e.lngLat.lng, e.lngLat.lat];
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._rectPolygon(start, cur)] },
                properties: { color: '#22c55e' }
            });
        }, 'aoi:move');
        st.up = this._safe((e) => {
            if (!start) return;
            const end = e.lngLat ? [e.lngLat.lng, e.lngLat.lat] : start;
            const p1 = this.map.project({ lng: start[0], lat: start[1] });
            const p2 = this.map.project({ lng: end[0], lat: end[1] });
            const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const s = start; start = null;
            if (distPx < 8) { return; } // simple clic : on attend un vrai rectangle
            this._endAoiFraming();
            const bbox = {
                west: Math.min(s[0], end[0]),
                east: Math.max(s[0], end[0]),
                south: Math.min(s[1], end[1]),
                north: Math.max(s[1], end[1])
            };
            this._confirmAoi(bbox);
        }, 'aoi:up');
        st.key = (ev) => { if (ev.key === 'Escape') this._endAoiFraming(); };

        this.map.on('mousedown', st.down);
        this.map.on('mousemove', st.move);
        this.map.on('mouseup', st.up);
        this.map.on('touchstart', st.down);
        this.map.on('touchmove', st.move);
        this.map.on('touchend', st.up);
        document.addEventListener('keydown', st.key);
        this._aoiFramingHandlers = st;
    },

    /** Désarme le cadrage AOI et restaure les interactions de carte. */
    _endAoiFraming() {
        if (!this._aoiFraming) return;
        this._aoiFraming = false;
        const st = this._aoiFramingHandlers;
        if (st && this.map) {
            this.map.off('mousedown', st.down);
            this.map.off('mousemove', st.move);
            this.map.off('mouseup', st.up);
            this.map.off('touchstart', st.down);
            this.map.off('touchmove', st.move);
            this.map.off('touchend', st.up);
            document.removeEventListener('keydown', st.key);
        }
        this._aoiFramingHandlers = null;
        this._clearPreview();
        if (this.map) {
            this.map.getCanvas().style.cursor = '';
            this.map.dragPan.enable();
            this.map.boxZoom.enable();
            this.map.doubleClickZoom.enable();
        }
        const aoiBtn = document.getElementById('plan_btn_aoi');
        if (aoiBtn) aoiBtn.classList.remove('active');
        this._hideHint();
    },

    /** Estime tuiles + volume, vérifie le quota, demande confirmation, lance. */
    async _confirmAoi(bbox) {
        const templates = _styleTileTemplates();
        if (!templates.length) { alert('Aucune source cartographique disponible.'); return; }
        const minZ = this.AOI_MIN_Z, maxZ = this.AOI_MAX_Z;
        const tileCount = _estimateTileCount(bbox, minZ, maxZ, templates);
        if (tileCount === 0) { alert('Zone hors couverture des sources cartographiques.'); return; }
        if (tileCount > AOI_MAX_TILES) {
            alert(`Zone trop vaste : ${tileCount.toLocaleString('fr-FR')} tuiles (max ${AOI_MAX_TILES.toLocaleString('fr-FR')}).\n`
                + 'Réduis l\'emprise ou refais un rectangle plus petit.');
            return;
        }
        // Estimation volume : ~22 Ko/tuile satellite/ortho, ~12 Ko/tuile DEM (ordre de grandeur).
        const approxBytes = tileCount * 22 * 1024;
        const mb = (approxBytes / (1024 * 1024));

        // Vérification du quota disponible (best-effort).
        let quotaWarn = '';
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                if (est && typeof est.quota === 'number' && typeof est.usage === 'number') {
                    const freeMb = (est.quota - est.usage) / (1024 * 1024);
                    if (freeMb < mb) {
                        quotaWarn = `\n\nATTENTION : espace libre estimé ${freeMb.toFixed(0)} Mo < besoin ${mb.toFixed(0)} Mo. Le téléchargement risque d'être incomplet.`;
                    }
                }
            }
        } catch (_) { /* estimate indispo : on tente quand même */ }

        const ok = confirm(
            `Télécharger la carte de cette zone pour usage hors-ligne ?\n\n`
            + `Zoom ${minZ} → ${maxZ}\n`
            + `Tuiles : ~${tileCount.toLocaleString('fr-FR')}\n`
            + `Volume estimé : ~${mb < 1 ? '<1' : mb.toFixed(0)} Mo${quotaWarn}`
        );
        if (!ok) return;
        this._runAoiDownload(bbox, minZ, maxZ, templates, tileCount);
    },

    /** Lance le téléchargement avec barre de progression annulable. */
    async _runAoiDownload(bbox, minZ, maxZ, templates, estTotal) {
        const ui = this._createAoiProgressBar(estTotal);
        const signal = { aborted: false };
        ui.cancelBtn.onclick = () => { signal.aborted = true; ui.setLabel('Annulation…'); };

        let result;
        try {
            result = await _prefetchTiles(bbox, minZ, maxZ, templates, (done, total, okC, failC) => {
                ui.update(done, total, okC, failC);
            }, { signal });
        } catch (e) {
            console.error('[PlanMap] AOI téléchargement échec:', e);
            ui.setLabel('Erreur : ' + (e && e.message ? e.message : 'cache indisponible'));
            setTimeout(() => ui.remove(), 3500);
            return;
        }

        if (result.aborted) {
            ui.setLabel('Annulé. Tuiles déjà mises en cache conservées.');
            setTimeout(() => ui.remove(), 2500);
            return;
        }

        // Persiste un INDEX des AOI confirmées (pas un flag binaire) avec son statut.
        try {
            const index = Persist.get(AOI_INDEX_KEY, { validator: Array.isArray, fallback: [] }) || [];
            index.push({
                bbox, minZ, maxZ,
                total: result.total, ok: result.ok, fail: result.fail,
                complete: result.fail === 0,
                ts: Date.now()
            });
            Persist.set(AOI_INDEX_KEY, index);
        } catch (e) { /* persistance non bloquante */ }

        if (result.fail === 0) {
            ui.setLabel(`Zone téléchargée : ${result.ok.toLocaleString('fr-FR')} tuiles en cache hors-ligne.`);
        } else {
            ui.setLabel(`Terminé avec ${result.fail.toLocaleString('fr-FR')} tuile(s) manquante(s) (réseau). Relance pour compléter.`);
        }
        setTimeout(() => ui.remove(), 3500);
    },

    /** Crée dynamiquement (PAS dans le HTML) la barre de progression AOI. */
    _createAoiProgressBar(estTotal) {
        const host = document.getElementById('plan_map')
            ? document.getElementById('plan_map').parentElement
            : document.body;
        const wrap = document.createElement('div');
        wrap.id = 'plan_aoi_progress';
        wrap.style.cssText = `
            position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
            z-index: 30; min-width: 260px; max-width: 92%;
            background: rgba(16,20,28,0.95); color: #fff;
            border: 1px solid var(--border-glass, rgba(255,255,255,0.15));
            border-radius: 10px; padding: 12px 14px;
            font-family: var(--font-ui, sans-serif); font-size: 13px;
            box-shadow: 0 6px 24px rgba(0,0,0,0.5);
        `;
        const label = document.createElement('div');
        label.style.cssText = 'margin-bottom: 8px; line-height: 1.3;';
        label.textContent = `Préparation du téléchargement (~${estTotal.toLocaleString('fr-FR')} tuiles)…`;
        const barOuter = document.createElement('div');
        barOuter.style.cssText = 'height: 8px; border-radius: 5px; background: rgba(255,255,255,0.12); overflow: hidden;';
        const barInner = document.createElement('div');
        barInner.style.cssText = 'height: 100%; width: 0%; background: #22c55e; transition: width 0.15s linear;';
        barOuter.appendChild(barInner);
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px;';
        const stat = document.createElement('span');
        stat.style.cssText = 'font-family: var(--font-data, ui-monospace, monospace); font-size: 12px; color: var(--text-muted, #9aa4b2);';
        stat.textContent = '0 %';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Annuler';
        cancelBtn.style.cssText = `
            background: rgba(239,68,68,0.18); color: #fff;
            border: 1px solid rgba(239,68,68,0.5); border-radius: 6px;
            padding: 5px 12px; cursor: pointer; font-size: 12px;
        `;
        row.appendChild(stat);
        row.appendChild(cancelBtn);
        wrap.appendChild(label);
        wrap.appendChild(barOuter);
        wrap.appendChild(row);
        host.appendChild(wrap);

        return {
            cancelBtn,
            setLabel: (txt) => { label.textContent = txt; cancelBtn.style.display = 'none'; },
            update: (done, total, okC, failC) => {
                const pct = total ? Math.round((done / total) * 100) : 0;
                barInner.style.width = pct + '%';
                const remaining = total - done;
                stat.textContent = `${pct} % · ${remaining.toLocaleString('fr-FR')} restantes`
                    + (failC ? ` · ${failC} échec(s)` : '');
                label.textContent = `Téléchargement de la zone d'opération… (${done.toLocaleString('fr-FR')}/${total.toLocaleString('fr-FR')})`;
            },
            remove: () => { try { wrap.remove(); } catch (_) {} }
        };
    },

    _showHint(msg) {
        let hint = document.getElementById('plan_hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'plan_hint';
            hint.style.cssText = `
                position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
                background: var(--accent-blue); color: white; padding: 8px 16px;
                border-radius: var(--radius-sm); font-family: var(--font-ui); font-size: 0.85em;
                z-index: 11; box-shadow: 0 4px 15px rgba(59,130,246,0.4);
                cursor: pointer;
            `;
            hint.title = 'Cliquer pour annuler';
            hint.onclick = () => {
                this.pendingEntityPin = null;
                this.pendingFreePin = null;
                this._hideHint();
            };
            document.getElementById('plan_map').parentElement.appendChild(hint);
        }
        hint.textContent = msg + ' (clic ici pour annuler)';
        hint.style.display = 'block';
    },

    _hideHint() {
        const hint = document.getElementById('plan_hint');
        if (hint) hint.style.display = 'none';
    }
};

window.PlanMap = PlanMap;
