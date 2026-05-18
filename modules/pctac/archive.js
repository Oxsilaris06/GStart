import { Storage } from './storage.js';
import { ImageStore } from './imageStore.js';
import {
    LOCAL_STORAGE_KEY, TP_ASSOC_KEY,
    ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY
} from './config.js';

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
    'pcTacPlanPins', 'pcTacPlanShapes', 'pcTacPlanView'
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
        const zip = await JSZip.loadAsync(buf);

        // Lire data.json
        const dataFile = zip.file('data.json');
        if (!dataFile) throw new Error('Archive invalide : data.json manquant');
        const dataJson = JSON.parse(await dataFile.async('string'));

        if (!confirm('Importer cette archive ? Les données actuelles seront remplacées.')) {
            return;
        }

        // Wipe puis restaurer
        Storage.clearAllData();
        try { await ImageStore.clear(); } catch (e) {}

        Object.entries(dataJson).forEach(([k, v]) => {
            localStorage.setItem(k, v);
        });

        // Restaurer les images
        const imagesFolder = zip.folder('images');
        if (imagesFolder) {
            const tasks = [];
            imagesFolder.forEach((relPath, entry) => {
                if (entry.dir) return;
                const id = relPath.replace(/\.txt$/, '').replace(/\.bin$/, '');
                tasks.push(entry.async('string').then(dataUrl => ImageStore.put(id, dataUrl)));
            });
            await Promise.all(tasks);
        }
    },

    /** Compat : ancien export PC-TAC JSON (logs uniquement). */
    async _importLegacyJson(obj) {
        if (obj && obj.metadata && obj.metadata.appName === 'PC Tac Log' && Array.isArray(obj.logEntries)) {
            const current = Storage.loadLogData();
            const ids = new Set(current.map(l => l.id));
            obj.logEntries.forEach(e => { if (!ids.has(e.id)) current.push(e); });
            Storage.saveLogData(current);
        } else {
            throw new Error('Format JSON non reconnu.');
        }
    }
};

window.Archive = Archive;
