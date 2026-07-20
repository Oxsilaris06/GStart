import { Storage } from './storage.js';
import { Persist } from './persist.js';
import { FREE_MODE_COLORS, PDF_PAX_COLORS } from './config.js';

/**
 * Gestionnaire de la logique métier des logs
 */

export const LogManager = {
    /**
     * Ajoute une nouvelle entrée au journal
     * @param {Object} data Données du formulaire
     * @returns {Object|null} La nouvelle entrée ou null si invalide
     */
    addEntry(data) {
        const { mode, pax, freePax, paxColor, heure, lieu, remarques } = data;
        
        let paxName, paxColorHex;

        if (mode === 'standard') {
            paxName = pax;
            paxColorHex = ''; 
            if (!paxName) {
                alert("Veuillez sélectionner un type de PAX.");
                return null;
            }
        } else {
            // Si c'est un mode free (intervenant personnalisé ou saisie libre)
            paxName = pax || (freePax || '').trim() || 'Pax Libre';
            paxColorHex = paxColor;
            if (!paxName) {
                alert("Veuillez donner un nom à l'intervenant.");
                return null;
            }
        }

        if (!heure) {
            alert("Veuillez renseigner l'heure.");
            return null;
        }

        const newEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            heure: heure,
            pax: paxName, 
            paxMode: mode,
            paxColor: paxColorHex,
            lieu: (lieu || '').trim(),
            remarques: (remarques || '').trim(),
        };

        const logData = Storage.loadLogData();
        logData.push(newEntry);
        Storage.saveLogData(logData);

        if (newEntry.lieu) this.addLieuToHistory(newEntry.lieu);

        return newEntry;
    },

    /**
     * Mémorise une localisation dans l'historique de suggestions (LRU, max 30)
     */
    addLieuToHistory(lieu) {
        const trimmed = (lieu || '').trim();
        if (!trimmed) return;
        // Via Persist (contrat projet) : ne jette JAMAIS sur quota plein — l'ancien
        // localStorage.setItem brut cassait la soumission du log en cas de saturation.
        let hist = Persist.get('pcTacLieuHistory', { validator: Array.isArray, fallback: [] }) || [];
        hist = hist.filter(l => String(l).toLowerCase() !== trimmed.toLowerCase());
        hist.unshift(trimmed);
        if (hist.length > 30) hist = hist.slice(0, 30);
        Persist.set('pcTacLieuHistory', hist);
    },

    getLieuHistory() {
        return Persist.get('pcTacLieuHistory', { validator: Array.isArray, fallback: [] }) || [];
    },

    /**
     * Supprime une entrée par son ID
     */
    deleteEntry(id) {
        const logData = Storage.loadLogData().filter(entry => entry.id !== id);
        Storage.saveLogData(logData);
        return logData;
    },

    /**
     * Met à jour une entrée existante
     */
    updateEntry(id, updatedData) {
        const logData = Storage.loadLogData();
        const index = logData.findIndex(e => e.id === id);
        if (index !== -1) {
            logData[index] = { ...logData[index], ...updatedData };
            Storage.saveLogData(logData);
        }
        return logData;
    },

    /**
     * Valide et importe des données JSON
     */
    importJson(jsonContent) {
        if (jsonContent.metadata && jsonContent.metadata.appName === "PC Tac Log" && Array.isArray(jsonContent.logEntries)) {
            const validatedEntries = jsonContent.logEntries.map(entry => {
                // paxMode d'abord recalculé, puis utilisé pour le fallback couleur :
                // l'ancien code testait entry.paxMode (souvent absent) → entrées
                // libres importées sans couleur.
                const paxMode = entry.paxMode || (PDF_PAX_COLORS[entry.pax] ? 'standard' : 'free');
                return {
                    id: entry.id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                    heure: entry.heure || '00:00',
                    pax: entry.pax,
                    paxMode,
                    paxColor: entry.paxColor || (paxMode === 'free' ? FREE_MODE_COLORS[0].hex : undefined),
                    lieu: entry.lieu || '',
                    remarques: entry.remarques || '',
                };
            });
            const currentLogs = Storage.loadLogData();
            // Déduplication par id (aligné sur le flux QR) : réimporter le même
            // fichier ne double plus toutes les lignes.
            const knownIds = new Set(currentLogs.map(l => l.id));
            const newEntries = validatedEntries.filter(e => !knownIds.has(e.id));
            const mergedLogs = [...currentLogs, ...newEntries];
            Storage.saveLogData(mergedLogs);
            return { success: true, count: newEntries.length, logs: mergedLogs };
        } else {
            throw new Error("Fichier JSON invalide.");
        }
    }
};

// NB : window.deleteLogEntry est défini dans main.js (delete + re-render de la table).
// L'ancienne définition ici (bind sans re-render) était systématiquement écrasée
// au DOMContentLoaded et donc morte — retirée pour lever l'ambiguïté (PC6).
window.LogManager = LogManager;
