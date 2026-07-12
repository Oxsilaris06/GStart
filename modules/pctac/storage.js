import { LOCAL_STORAGE_KEY, TP_ASSOC_KEY, ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY } from './config.js';
import { Persist } from './persist.js';

/**
 * Gestion du stockage LocalStorage pour PC TAC
 *
 * Toutes les lectures/écritures localStorage transitent désormais par la
 * couche `Persist` (persist.js) :
 *  - écriture : ne jette JAMAIS sur dépassement de quota ; un évènement window
 *    'pctac:quota' (non bloquant) est émis par Persist et l'UI peut y réagir.
 *  - lecture : si le JSON est corrompu ou rejeté par le validateur, la chaîne
 *    brute est sauvegardée dans `<key>.bak` (best-effort) et un fallback sûr
 *    ([] ou {}) est retourné — aucune donnée opérationnelle perdue en silence.
 */

const isArray = (v) => Array.isArray(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const Storage = {
    /**
     * Sauvegarde les données du journal
     * @param {Array} logData
     */
    saveLogData(logData) {
        // Tri par heure avant de sauvegarder
        logData.sort((a, b) => {
            if (a.heure === b.heure) return 0;
            return a.heure < b.heure ? -1 : 1;
        });
        // Persist ne jette jamais sur quota : il émet 'pctac:quota' (non bloquant).
        Persist.set(LOCAL_STORAGE_KEY, logData);
    },

    /**
     * Charge les données du journal
     * @returns {Array}
     */
    loadLogData() {
        return Persist.get(LOCAL_STORAGE_KEY, { validator: isArray, fallback: [] });
    },

    /**
     * Récupère les associations TP (Pax Libre)
     * @returns {Object}
     */
    getTpAssociations() {
        return Persist.get(TP_ASSOC_KEY, { validator: isObject, fallback: {} });
    },

    /**
     * Sauvegarde une association TP
     * @param {string} label
     * @param {string} color
     */
    saveTpAssociation(label, color) {
        const assoc = this.getTpAssociations();
        assoc[color] = label;
        Persist.set(TP_ASSOC_KEY, assoc);
    },

    /**
     * Sauvegarde une collection générique
     * @param {string} key
     * @param {Array} data
     */
    saveCollection(key, data) {
        // Quota géré par Persist via l'évènement 'pctac:quota' (plus d'alert bloquant).
        Persist.set(key, data);
    },

    /**
     * Charge une collection générique
     * @param {string} key
     * @returns {Array}
     */
    loadCollection(key) {
        return Persist.get(key, { validator: isArray, fallback: [] });
    },

    /**
     * Réinitialise toutes les données
     */
    clearAllData() {
        const keys = [
            LOCAL_STORAGE_KEY,
            TP_ASSOC_KEY,
            ADVERSARIES_KEY,
            HOSTAGES_KEY,
            FRIENDS_KEY,
            PHOTOS_KEY,
            CUSTOM_PAX_KEY,
            'pcTacPlanPins',
            'pcTacPlanView',
            'pcTacPlanShapes',
            'pcTacLieuHistory',
            'lastView',
            'lastPhotoFilter'
        ];
        keys.forEach(k => {
            try {
                localStorage.removeItem(k);
            } catch (e) {
                // localStorage indisponible : on dégrade proprement (offline-first).
            }
        });
    }
};

// Exposition globale pour compatibilité
window.saveLogData = Storage.saveLogData.bind(Storage);
window.loadLogData = Storage.loadLogData.bind(Storage);
window.getTpAssociations = Storage.getTpAssociations.bind(Storage);
window.saveTpAssociation = Storage.saveTpAssociation.bind(Storage);
