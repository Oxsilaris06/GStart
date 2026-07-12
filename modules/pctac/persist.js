/**
 * persist.js — Couche de persistance transactionnelle pour PC-Tac
 * =================================================================
 *
 * Module ESM STANDALONE : il n'importe RIEN du projet (aucun cycle possible).
 * C'est le socle "Fondations" sur lequel les autres modules s'appuient pour
 * lire/écrire localStorage de façon défensive et 100% hors-ligne.
 *
 * Principes de conception (terrain : stress, gants, mobile, batterie, offline) :
 *  - Ne JAMAIS jeter sur dépassement de quota : on dégrade proprement et on
 *    prévient l'UI via un évènement window 'pctac:quota'.
 *  - Tolérer un localStorage totalement indisponible (mode privé, stockage
 *    désactivé, sandbox) : toutes les opérations dégradent sans planter.
 *  - À la lecture, si le JSON est corrompu OU si le validateur rejette la
 *    donnée, on sauvegarde la chaîne brute dans `<key>.bak` (best-effort) afin
 *    de ne jamais perdre silencieusement des données opérationnelles, puis on
 *    retourne le fallback fourni.
 *
 * Aucune dépendance externe. Aucune donnée sensible n'est exfiltrée :
 * tout reste dans le localStorage du navigateur.
 */

/* ------------------------------------------------------------------------- *
 * Accès bas niveau au localStorage, tolérant à son indisponibilité.
 * On encapsule chaque accès dans un try/catch : selon le navigateur et le
 * contexte (mode privé, quota déjà plein, stockage bloqué par politique),
 * la simple lecture de `window.localStorage` peut lever une exception.
 * ------------------------------------------------------------------------- */

/**
 * Retourne l'objet localStorage s'il est utilisable, sinon null.
 * @returns {Storage|null}
 */
function getStore() {
    try {
        // L'accès lui-même peut jeter (SecurityError) dans certains contextes.
        const ls = (typeof window !== 'undefined' && window.localStorage)
            ? window.localStorage
            : (typeof localStorage !== 'undefined' ? localStorage : null);
        return ls || null;
    } catch (_e) {
        return null;
    }
}

/**
 * Détection robuste d'une erreur de dépassement de quota, indépendamment
 * du navigateur. Firefox utilise un name spécifique ; certains moteurs ne
 * renseignent que le code (22 pour la plupart, 1014 pour l'ancien Firefox).
 * @param {*} e
 * @returns {boolean}
 */
function isQuotaError(e) {
    if (!e) return false;
    return (
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        e.code === 22 ||
        e.code === 1014
    );
}

/**
 * Tente d'obtenir une estimation de l'occupation du stockage.
 * navigator.storage.estimate() est asynchrone : on l'utilise en best-effort
 * sans bloquer la signalisation du quota (le détail de l'évènement est
 * complété a posteriori si la promesse se résout à temps).
 * @param {object} detail  Objet de détail de l'évènement à enrichir.
 */
function fillEstimate(detail) {
    try {
        if (typeof navigator !== 'undefined'
            && navigator.storage
            && typeof navigator.storage.estimate === 'function') {
            // Best-effort : on enrichit le detail si l'estimation arrive vite.
            navigator.storage.estimate().then((est) => {
                detail.estimate = est || null;
            }).catch(() => { /* silencieux : non bloquant */ });
        }
    } catch (_e) {
        /* navigator.storage indisponible : on ignore. */
    }
}

/**
 * Émet l'évènement window 'pctac:quota' pour signaler à l'UI une saturation
 * du stockage. Ne jette jamais (best-effort).
 * @param {string} key  La clé dont l'écriture a échoué.
 * @returns {{ok:false, quota:true}}
 */
function dispatchQuota(key) {
    const detail = { key, estimate: null };
    // On lance l'estimation (asynchrone) qui complètera `detail.estimate`.
    fillEstimate(detail);
    try {
        if (typeof window !== 'undefined'
            && typeof window.dispatchEvent === 'function'
            && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('pctac:quota', { detail }));
        }
    } catch (_e) {
        /* dispatch impossible : on dégrade silencieusement. */
    }
    return { ok: false, quota: true };
}

/**
 * Sauvegarde best-effort d'une chaîne brute dans `<key>.bak`.
 * Utilisé lorsqu'une donnée lue est corrompue ou rejetée par le validateur :
 * on préserve l'original avant de retourner le fallback. Ne jette jamais.
 * @param {string} key
 * @param {string|null} raw
 */
function backupRaw(key, raw) {
    if (raw == null) return;
    const store = getStore();
    if (!store) return;
    try {
        store.setItem(key + '.bak', raw);
    } catch (_e) {
        // La sauvegarde de secours est non critique (souvent un quota plein) :
        // on n'aggrave pas la situation, on ignore.
    }
}

/* ------------------------------------------------------------------------- *
 * API publique : Persist
 * ------------------------------------------------------------------------- */

export const Persist = {
    /**
     * Lit une valeur JSON depuis le localStorage.
     *
     * Comportement :
     *  - getItem → JSON.parse.
     *  - Si JSON.parse jette OU si validator(parsed) === false : la chaîne
     *    brute est sauvegardée dans `<key>.bak` (best-effort) et `fallback`
     *    est retourné.
     *  - Sinon : retourne la valeur désérialisée.
     *  - Si la clé est absente (null) : retourne `fallback` sans backup.
     *  - Si localStorage est indisponible : retourne `fallback`.
     *
     * @param {string} key
     * @param {{validator?: ((v:*)=>boolean)|null, fallback?: *}} [opts]
     * @returns {*}
     */
    get(key, { validator = null, fallback = null } = {}) {
        const store = getStore();
        if (!store) return fallback;

        let raw = null;
        try {
            raw = store.getItem(key);
        } catch (_e) {
            // Lecture impossible : on dégrade.
            return fallback;
        }

        // Clé absente : pas de corruption, simplement rien à charger.
        if (raw == null) return fallback;

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (_e) {
            // JSON corrompu : on préserve l'original puis on dégrade.
            backupRaw(key, raw);
            return fallback;
        }

        // Validation métier optionnelle. On ne considère comme un échec que
        // le retour STRICTEMENT false (un validateur peut renvoyer undefined
        // par mégarde sans qu'on veuille jeter la donnée).
        if (typeof validator === 'function') {
            let valid;
            try {
                valid = validator(parsed);
            } catch (_e) {
                // Un validateur qui jette est traité comme un rejet.
                valid = false;
            }
            if (valid === false) {
                backupRaw(key, raw);
                return fallback;
            }
        }

        return parsed;
    },

    /**
     * Sérialise (JSON.stringify) puis écrit `value` sous `key`.
     * Ne jette JAMAIS sur dépassement de quota : émet 'pctac:quota' et
     * retourne {ok:false, quota:true}.
     *
     * @param {string} key
     * @param {*} value
     * @returns {{ok:true}|{ok:false, quota:true}|{ok:false, error:Error}}
     */
    set(key, value) {
        const store = getStore();
        if (!store) return { ok: false, error: new Error('localStorage indisponible') };

        let str;
        try {
            str = JSON.stringify(value);
        } catch (e) {
            // Valeur non sérialisable (référence circulaire, BigInt, ...).
            // Ce n'est pas un problème de quota : on remonte l'erreur.
            return { ok: false, error: e };
        }

        return this.setRaw(key, str);
    },

    /**
     * Lecture brute d'une chaîne. Tolérant à l'indisponibilité du stockage.
     * @param {string} key
     * @returns {string|null}
     */
    getRaw(key) {
        const store = getStore();
        if (!store) return null;
        try {
            return store.getItem(key);
        } catch (_e) {
            return null;
        }
    },

    /**
     * Écriture brute d'une chaîne (sans JSON.stringify).
     * Même contrat que set() vis-à-vis du quota : ne jette jamais sur quota,
     * émet 'pctac:quota' et retourne {ok:false, quota:true}.
     *
     * @param {string} key
     * @param {string} str
     * @returns {{ok:true}|{ok:false, quota:true}|{ok:false, error:Error}}
     */
    setRaw(key, str) {
        const store = getStore();
        if (!store) return { ok: false, error: new Error('localStorage indisponible') };

        try {
            store.setItem(key, str);
            return { ok: true };
        } catch (e) {
            if (isQuotaError(e)) {
                // Saturation : on signale l'UI et on dégrade sans jeter.
                return dispatchQuota(key);
            }
            // Autre erreur d'écriture (rare) : on la remonte sans jeter.
            return { ok: false, error: e };
        }
    },
};

export default Persist;
