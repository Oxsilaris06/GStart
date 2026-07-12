import { Storage } from './storage.js';
import { ImageStore } from './imageStore.js';
import {
    LOCAL_STORAGE_KEY, TP_ASSOC_KEY,
    ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY,
    FREE_MODE_COLORS
} from './config.js';

// Clé localStorage de l'Ordre Initial (générateur 4.html). L'archive .oi.zip
// contient { data.json: { 'tactical_oi_data': "<JSON>" }, images/<id>.bin, images.json }.
const OI_LOCAL_STORAGE_KEY = 'tactical_oi_data';

/** Normalise un nom/trigramme pour la déduplication (sans accents, casse, espaces). */
function _normName(s) {
    return (s || '').toString()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Archive tout-en-un (.pctac.zip) — remplace l'ancien transfert QR code.
 *
 * Contenu du zip :
 *   - manifest.json (version + horodatage)
 *   - data.json   (toutes les collections localStorage)
 *   - images/<id>.bin  (data URL bruts pour chaque image IndexedDB)
 *
 * Pourquoi : un seul fichier portable, taille indéterminée, dezippable
 * par le navigateur via JSZip. Aucun besoin de scanner plusieurs QR codes.
 */

const COLLECTION_KEYS = [
    LOCAL_STORAGE_KEY, TP_ASSOC_KEY,
    ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY,
    'pcTacPlanPins', 'pcTacPlanShapes', 'pcTacPlanView',
    // Tableau de liens (dashboard.js) : positions des nœuds + liens manuels.
    // C-KEY : clé localStorage 'pcTacDashboard' (constante DASHBOARD_KEY de config.js).
    // Littéral assumé volontairement — le board ne stocke aucune image propre, juste
    // des positions/liens — pour garder archive.js indépendant de l'ordre de mise à
    // jour de config.js (un import nommé manquant casserait tout le graphe ESM).
    'pcTacDashboard'
];

export const Archive = {
    async exportZip() {
        if (typeof JSZip === 'undefined') {
            alert('JSZip indisponible (réseau ?). Impossible de générer l\'archive.');
            return;
        }
        try {
            const zip = new JSZip();

            // 1) Données localStorage
            const data = {};
            COLLECTION_KEYS.forEach(k => {
                const raw = localStorage.getItem(k);
                if (raw !== null) data[k] = raw;
            });
            zip.file('data.json', JSON.stringify(data, null, 2));

            // 2) Images : on collecte les ids depuis les collections + sync
            const imgIds = new Set();
            [ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY].forEach(k => {
                const list = Storage.loadCollection(k);
                list.forEach(item => {
                    if (item.hasImage) imgIds.add(item.id);
                });
            });
            // Sync photos (id + "_sync")
            [ADVERSARIES_KEY, HOSTAGES_KEY].forEach(k => {
                const list = Storage.loadCollection(k);
                list.forEach(item => imgIds.add(item.id + '_sync'));
            });

            const imagesFolder = zip.folder('images');
            for (const id of imgIds) {
                try {
                    const dataUrl = await ImageStore.get(id);
                    if (dataUrl) imagesFolder.file(`${id}.txt`, dataUrl);
                } catch (e) {
                    console.warn('[Archive] image absente:', id);
                }
            }

            // 3) Manifest
            zip.file('manifest.json', JSON.stringify({
                appName: 'PC TAC',
                version: 1,
                createdAt: new Date().toISOString()
            }, null, 2));

            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `PC-TAC-${stamp}.pctac.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        } catch (e) {
            console.error('[Archive] export échec:', e);
            alert('Erreur d\'export : ' + e.message);
        }
    },

    async importFile(file) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip indisponible');
        const name = (file.name || '').toLowerCase();

        // Compat : fichier JSON legacy
        if (name.endsWith('.json')) {
            const text = await file.text();
            const obj = JSON.parse(text);
            return this._importLegacyJson(obj);
        }

        const buf = await file.arrayBuffer();
        let zip;
        try { zip = await JSZip.loadAsync(buf); }
        catch (e) { throw new Error("Archive illisible : ce n'est pas un fichier .pctac.zip valide (ou il est corrompu)."); }

        // PC1.a — VALIDATION DU MANIFEST AVANT TOUTE MODIFICATION.
        // L'export écrit manifest.json { appName: 'PC TAC', version, createdAt }.
        // On refuse proprement (sans wipe) toute archive d'une autre app : importer
        // une archive « OI » ou autre effacerait l'opérationnel sans rien restaurer.
        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) {
            throw new Error("Archive invalide : « manifest.json » manquant. Cette archive n'a pas été produite par PC TAC.");
        }
        let manifest;
        try { manifest = JSON.parse(await manifestFile.async('string')); }
        catch (e) { throw new Error('Archive corrompue : « manifest.json » illisible.'); }
        const appName = manifest && manifest.appName;
        if (appName !== 'PC TAC') {
            throw new Error(
                appName
                    ? `Cette archive provient de « ${appName} », pas de PC TAC. Import refusé (aucune donnée modifiée).`
                    : "Manifest invalide : champ « appName » absent. Import refusé (aucune donnée modifiée)."
            );
        }

        // Lire data.json
        const dataFile = zip.file('data.json');
        if (!dataFile) throw new Error('Archive invalide : data.json manquant');
        let dataJson;
        try { dataJson = JSON.parse(await dataFile.async('string')); }
        catch (e) { throw new Error('Archive corrompue : « data.json » illisible.'); }

        if (!confirm('Importer cette archive ? Les données actuelles seront remplacées.')) {
            return { ok: false, cancelled: true };
        }

        // PC1.b — Import ATOMIQUE avec rollback COMPLET (localStorage + images IndexedDB).
        // clearAllData() ne touche QUE le localStorage ; les images vivent dans IndexedDB.
        // On prend donc un double snapshot AVANT tout effacement :
        //   1) localStorage (tout ce que clearAllData efface),
        //   2) images IndexedDB (collectées par id, comme à l'export).
        // En cas d'échec à n'importe quelle étape APRÈS clearAllData, on restaure
        // intégralement les deux — l'état terrain n'est jamais laissé à moitié effacé.
        const SNAPSHOT_KEYS = COLLECTION_KEYS.concat(['pcTacLieuHistory', 'lastView', 'lastPhotoFilter']);
        const snapshot = {};
        SNAPSHOT_KEYS.forEach(k => { snapshot[k] = localStorage.getItem(k); });

        // Snapshot des images existantes (best-effort) : on collecte les ids depuis
        // les collections + leurs photos « _sync », exactement comme exportZip.
        const imgSnapshot = await this._snapshotImages();

        // Restaure intégralement l'état précédent (localStorage + images).
        const rollback = async () => {
            try { Storage.clearAllData(); } catch (_) {}
            Object.entries(snapshot).forEach(([k, v]) => {
                try { if (v !== null) localStorage.setItem(k, v); } catch (_) {}
            });
            try {
                await ImageStore.clear();
                for (const [id, dataUrl] of Object.entries(imgSnapshot)) {
                    try { await ImageStore.put(id, dataUrl); } catch (_) {}
                }
            } catch (_) {}
        };

        // 1) localStorage (rollback intégral si une écriture jette, ex. quota).
        try {
            Storage.clearAllData();
            Object.entries(dataJson).forEach(([k, v]) => {
                localStorage.setItem(k, v);
            });
        } catch (e) {
            await rollback();
            console.error('[Archive] import localStorage échec, rollback effectué:', e);
            alert("Échec de l'import (stockage insuffisant). Vos données précédentes ont été conservées.");
            return { ok: false, error: e };
        }

        // 2) Images : on efface puis on restaure depuis l'archive.
        // Un échec critique (clear ou écriture impossible) déclenche le rollback complet.
        let imgError = null;
        try {
            await ImageStore.clear();
        } catch (e) {
            await rollback();
            console.error('[Archive] clear images échec, rollback effectué:', e);
            alert("Échec de l'import (impossible de réinitialiser les photos). Vos données précédentes ont été conservées.");
            return { ok: false, error: e };
        }
        const imagesFolder = zip.folder('images');
        if (imagesFolder) {
            const tasks = [];
            imagesFolder.forEach((relPath, entry) => {
                if (entry.dir) return;
                const id = relPath.replace(/\.txt$/, '').replace(/\.bin$/, '');
                tasks.push(
                    entry.async('string')
                        .then(dataUrl => ImageStore.put(id, dataUrl))
                        .catch(err => { imgError = err; })
                );
            });
            await Promise.all(tasks);
        }
        if (imgError) {
            // Les photos sont best-effort : un échec partiel ne justifie pas de jeter
            // l'import du localStorage déjà validé. On prévient sans rollback.
            console.warn('[Archive] certaines images non restaurées:', imgError);
            alert("Import terminé, mais certaines photos n'ont pas pu être restaurées (stockage). Les fiches sont intactes.");
        }
        return { ok: true };
    },

    /**
     * Snapshot best-effort des images IndexedDB liées aux collections courantes.
     * Même logique de collecte d'ids que exportZip (fiches + photos « _sync »).
     * @returns {Promise<Object<string,string>>} map id -> data URL (uniquement celles présentes)
     */
    async _snapshotImages() {
        const out = {};
        try {
            const imgIds = new Set();
            [ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY].forEach(k => {
                Storage.loadCollection(k).forEach(item => {
                    if (item && item.hasImage && item.id) imgIds.add(item.id);
                });
            });
            [ADVERSARIES_KEY, HOSTAGES_KEY].forEach(k => {
                Storage.loadCollection(k).forEach(item => {
                    if (item && item.id) imgIds.add(item.id + '_sync');
                });
            });
            for (const id of imgIds) {
                try {
                    const dataUrl = await ImageStore.get(id);
                    if (dataUrl) out[id] = dataUrl;
                } catch (_) { /* image absente : on ignore */ }
            }
        } catch (e) {
            console.warn('[Archive] snapshot images partiel:', e);
        }
        return out;
    },

    /** Compat : ancien export PC-TAC JSON (logs uniquement). */
    async _importLegacyJson(obj) {
        if (obj && obj.metadata && obj.metadata.appName === 'PC Tac Log' && Array.isArray(obj.logEntries)) {
            const current = Storage.loadLogData();
            const ids = new Set(current.map(l => l.id));
            obj.logEntries.forEach(e => { if (!ids.has(e.id)) current.push(e); });
            Storage.saveLogData(current);
            return { ok: true };
        }
        throw new Error('Format JSON non reconnu.');
    },

    /**
     * PASSERELLE D'INTÉGRATION OI → PC TAC (Proposition 1, ROI maximal).
     *
     * Importe directement l'équipe (PATRACDVR) et les adversaires saisis dans le
     * Générateur d'Ordre Initial (4.html) à partir d'une archive « .oi.zip » (ou
     * d'une session « .json » legacy). Objectif : ZÉRO double saisie sur le terrain.
     *
     *   - Adversaires (étape 2) → pcTacAdversaries (+ photo IndexedDB + galerie Photos)
     *   - Membres PATRACDVR (trigrammes) → pcTacCustomPax (couleurs distinctes par défaut)
     *
     * On FUSIONNE sans jamais écraser : les fiches déjà saisies sur le terrain sont
     * conservées, les doublons (même nom / même trigramme) sont ignorés.
     *
     * @param {File} file  archive .oi.zip ou session .json produite par 4.html
     * @returns {Promise<{ok, advAdded, advPhotos, advSkipped, paxAdded, paxSkipped}>}
     */
    async importOiArchive(file) {
        if (!file) throw new Error('Aucun fichier sélectionné.');
        const name = (file.name || '').toLowerCase();

        let oi = null;          // objet tactical_oi_data
        let zip = null;         // archive JSZip (uniquement pour .oi.zip)
        let imageMeta = {};     // images.json : { imgId -> mimeType }

        // --- Lecture & validation de la source ---
        if (name.endsWith('.json')) {
            // Session OI legacy : champs uniquement (les photos vivent dans IndexedDB,
            // hors du .json — elles ne peuvent donc pas être transférées par ce format).
            let txt;
            try { txt = await file.text(); } catch (e) { throw new Error('Fichier illisible.'); }
            try { oi = JSON.parse(txt); } catch (e) { throw new Error('Session OI (.json) illisible : JSON invalide.'); }
            if (!oi || typeof oi !== 'object' || Array.isArray(oi)) throw new Error('Format de session OI non reconnu.');
        } else {
            if (typeof JSZip === 'undefined') throw new Error('JSZip indisponible (réseau ?). Impossible de lire l\'archive.');
            try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
            catch (e) { throw new Error('Ce n\'est pas une archive .oi.zip valide (ou elle est corrompue).'); }

            const dataFile = zip.file('data.json');
            if (!dataFile) throw new Error('Archive invalide : « data.json » introuvable.');

            let dataJson;
            try { dataJson = JSON.parse(await dataFile.async('string')); }
            catch (e) { throw new Error('Archive corrompue : « data.json » illisible.'); }

            // Garde-fou : refuser une archive d'une AUTRE app (best-effort sur le manifest).
            const manifestFile = zip.file('manifest.json');
            if (manifestFile) {
                try {
                    const man = JSON.parse(await manifestFile.async('string'));
                    if (man && man.appName && man.appName !== 'OI') {
                        throw new Error(`Cette archive provient de « ${man.appName} », pas du Générateur d'OI.`);
                    }
                } catch (e) {
                    if (e && e.message && e.message.startsWith('Cette archive')) throw e; // re-propage notre refus
                    // sinon : manifest illisible, on tolère
                }
            }

            const raw = (dataJson && dataJson[OI_LOCAL_STORAGE_KEY] != null)
                ? dataJson[OI_LOCAL_STORAGE_KEY]
                : (dataJson ? Object.values(dataJson).find(v => typeof v === 'string') : null);
            if (raw == null) throw new Error('Aucune donnée OI (tactical_oi_data) dans l\'archive.');
            try { oi = JSON.parse(raw); } catch (e) { throw new Error('Données OI illisibles dans l\'archive.'); }

            const metaFile = zip.file('images.json');
            if (metaFile) { try { imageMeta = JSON.parse(await metaFile.async('string')) || {}; } catch (e) { imageMeta = {}; } }
        }

        // --- Extraction des données OI ---
        const adversaries = Array.isArray(oi.adversaries) ? oi.adversaries : [];
        const dynPhotos = (oi && oi.dynamic_photos && typeof oi.dynamic_photos === 'object') ? oi.dynamic_photos : {};

        const paxMembers = [];
        (Array.isArray(oi.patracdvr_rows) ? oi.patracdvr_rows : []).forEach(r => {
            (r && Array.isArray(r.members) ? r.members : []).forEach(m => paxMembers.push(m));
        });
        (Array.isArray(oi.patracdvr_unassigned) ? oi.patracdvr_unassigned : []).forEach(m => paxMembers.push(m));

        if (!adversaries.length && !paxMembers.length) {
            throw new Error('Aucun adversaire ni membre PATRACDVR trouvé dans ce fichier OI.');
        }

        // Récupère le data URL de la photo principale d'un adversaire depuis l'archive.
        // OI stocke la photo dans dynamic_photos['photo_main_<advId>'][0].id (clé img_…),
        // dont les octets sont dans images/<encodeURIComponent(id)>.bin (type via images.json).
        const photoDataUrlForAdv = async (advId) => {
            if (!zip || !advId) return null;
            const entries = dynPhotos['photo_main_' + advId];
            const imgId = entries && entries[0] && entries[0].id;
            if (!imgId) return null;
            const zipEntry = zip.file('images/' + encodeURIComponent(imgId) + '.bin')
                || zip.file('images/' + imgId + '.bin');
            if (!zipEntry) return null;
            try {
                const b64 = await zipEntry.async('base64');
                const mime = imageMeta[imgId] || 'image/jpeg';
                return `data:${mime};base64,${b64}`;
            } catch (e) { console.warn('[OI→PCTAC] photo illisible:', imgId, e); return null; }
        };

        // --- 1) Adversaires → pcTacAdversaries (+ photo + galerie Photos) ---
        const advList = Storage.loadCollection(ADVERSARIES_KEY);
        const photoList = Storage.loadCollection(PHOTOS_KEY);
        const existingAdvNames = new Set(advList.map(a => _normName((a.nom || '') + ' ' + (a.prenom || ''))));
        let advAdded = 0, advPhotos = 0, advSkipped = 0;
        let seq = 0;

        for (const oa of adversaries) {
            const nom = (oa && oa.nom_adversaire || '').toString().trim();
            const key = _normName(nom);
            if (key && existingAdvNames.has(key)) { advSkipped++; continue; }
            if (key) existingAdvNames.add(key);

            const itemId = 'oi_adv_' + Date.now().toString(36) + '_' + (seq++);
            const item = {
                id: itemId,
                nom: nom,
                prenom: '',                                   // OI fusionne nom+prénom dans un seul champ
                dob: (oa.date_naissance || '').toString(),
                lien: '',
                antecedents: (oa.antecedents_adversaire || '').toString(),
                attitude: (oa.attitude_adversaire || '').toString(),
                substance: (oa.substances_adversaire || '').toString(),
                armes: (oa.armes_connues || '').toString()
            };

            const dataUrl = await photoDataUrlForAdv(oa.id);
            if (dataUrl) {
                try {
                    await ImageStore.put(itemId, dataUrl);
                    item.hasImage = true;
                    advPhotos++;
                    // Copie automatique vers la galerie Photos (catégorie « Adversaire »),
                    // exactement comme une saisie manuelle PC TAC (id + "_sync").
                    const syncId = itemId + '_sync';
                    await ImageStore.put(syncId, dataUrl);
                    photoList.push({ id: syncId, title: nom || 'Adversaire OI', category: 'neutralized', status: 'active', hasImage: true });
                } catch (e) { console.warn('[OI→PCTAC] enregistrement photo échoué:', e); }
            }
            advList.push(item);
            advAdded++;
        }
        if (advAdded) Storage.saveCollection(ADVERSARIES_KEY, advList);
        if (advPhotos) Storage.saveCollection(PHOTOS_KEY, photoList);

        // --- 2) Équipe PATRACDVR → pcTacCustomPax (couleurs distinctes) ---
        const paxList = Storage.loadCollection(CUSTOM_PAX_KEY);
        const existingPax = new Set(paxList.map(p => _normName(p.name)));
        const usedColors = new Set(paxList.map(p => (p.color || '').toLowerCase()));
        const palette = (Array.isArray(FREE_MODE_COLORS) && FREE_MODE_COLORS.length) ? FREE_MODE_COLORS : [{ hex: '#a855f7' }];
        let colorIdx = 0;
        const nextColor = () => {
            // Privilégie une couleur encore libre pour garder des intervenants visuellement distincts.
            for (let i = 0; i < palette.length; i++) {
                const c = palette[(colorIdx + i) % palette.length].hex;
                if (!usedColors.has(c.toLowerCase())) {
                    colorIdx = (colorIdx + i + 1) % palette.length;
                    usedColors.add(c.toLowerCase());
                    return c;
                }
            }
            const c = palette[colorIdx % palette.length].hex; colorIdx++; return c;
        };

        let paxAdded = 0, paxSkipped = 0;
        paxMembers.forEach((m, i) => {
            const trig = (m && m.trigramme || '').toString().trim().toUpperCase();
            if (!trig || trig === 'N/A') { paxSkipped++; return; }
            const key = _normName(trig);
            if (existingPax.has(key)) { paxSkipped++; return; }
            existingPax.add(key);
            paxList.push({ id: 'oi_pax_' + Date.now().toString(36) + '_' + i, name: trig, color: nextColor() });
            paxAdded++;
        });
        if (paxAdded) Storage.saveCollection(CUSTOM_PAX_KEY, paxList);

        return { ok: true, advAdded, advPhotos, advSkipped, paxAdded, paxSkipped };
    }
};

window.Archive = Archive;
