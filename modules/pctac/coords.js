/**
 * coords.js — Conversion et formatage de coordonnées (calcul PUR, sans clé API,
 * sans réseau). Sert l'option « Copier coordonnées » des roues contextuelles.
 *
 * Formats produits :
 *   - Décimal WGS84      : "48.856614, 2.352222"  (le plus portable / SIG, hélico civil, SAMU)
 *   - DMS                : 48°51′23.8″N  2°21′07.9″E
 *   - MGRS               : 31U DQ 48251 11932     (standard interservices / gendarmerie mobile)
 *
 * Algorithme UTM : série de Snyder (USGS PP 1395), précision ~cm dans le domaine UTM,
 * ellipsoïde WGS84. MGRS : lettrage 100 km standard USNG/MGRS. Domaine couvert :
 * bandes C→X (lat −80…84) — couvre très largement la métropole et l'outre-mer.
 *
 * Vérifié : 0°,0° → "31N AA 66021 00000" (valeur canonique « null island »).
 */

const WGS84_A = 6378137.0;                 // demi-grand axe (m)
const WGS84_F = 1 / 298.257223563;         // aplatissement
const K0 = 0.9996;                          // facteur d'échelle UTM
const E2 = WGS84_F * (2 - WGS84_F);         // e²
const EP2 = E2 / (1 - E2);                  // e'²

const DEG = Math.PI / 180;

/** Normalise une longitude dans [−180, 180) : clics sur les copies du monde
 *  (MapLibre déroule le planisphère) et cas limite lon = 180. */
function normLon(lon) {
    return ((lon + 180) % 360 + 360) % 360 - 180;
}

const BAND_LETTERS = 'CDEFGHJKLMNPQRSTUVWX';          // bandes de latitude (8°, X = 72→84)
const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ']; // colonnes 100 km selon (zone-1)%3
const ROW_ODD  = 'ABCDEFGHJKLMNPQRSTUV';              // lignes 100 km, zones IMPAIRES ('A' à l'équateur)
const ROW_EVEN = 'FGHJKLMNPQRSTUVABCDE';              // lignes 100 km, zones PAIRES (décalé de 5 → 'F')

/** Numéro de fuseau UTM, avec exceptions Norvège/Svalbard (sans effet en métropole). */
function utmZone(lat, lon) {
    let zone = Math.floor((lon + 180) / 6) + 1;
    // Exception Norvège (32V élargi)
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
    // Exceptions Svalbard
    if (lat >= 72 && lat < 84) {
        if (lon >= 0  && lon < 9)  zone = 31;
        else if (lon >= 9  && lon < 21) zone = 33;
        else if (lon >= 21 && lon < 33) zone = 35;
        else if (lon >= 33 && lon < 42) zone = 37;
    }
    return zone;
}

/** Lettre de bande de latitude MGRS (C…X). */
function latBand(lat) {
    if (lat >= 72) return 'X';
    if (lat < -80) return 'C';
    const idx = Math.min(BAND_LETTERS.length - 1, Math.floor((lat + 80) / 8));
    return BAND_LETTERS[idx];
}

/**
 * WGS84 (lat,lon) → UTM. Retourne {zone, band, easting, northing, hemisphere}.
 */
export function latLngToUtm(lat, lon) {
    lon = normLon(lon);
    const zone = utmZone(lat, lon);
    const lonOrigin = (zone - 1) * 6 - 180 + 3;      // méridien central du fuseau
    const latR = lat * DEG;
    const dLon = (lon - lonOrigin) * DEG;

    const N = WGS84_A / Math.sqrt(1 - E2 * Math.sin(latR) ** 2);
    const T = Math.tan(latR) ** 2;
    const C = EP2 * Math.cos(latR) ** 2;
    const A = Math.cos(latR) * dLon;

    const M = WGS84_A * (
        (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * latR
        - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * latR)
        + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * latR)
        - (35 * E2 ** 3 / 3072) * Math.sin(6 * latR)
    );

    let easting = K0 * N * (
        A + (1 - T + C) * A ** 3 / 6
        + (5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * A ** 5 / 120
    ) + 500000;

    let northing = K0 * (
        M + N * Math.tan(latR) * (
            A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
            + (61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * A ** 6 / 720
        )
    );
    if (lat < 0) northing += 10000000;   // hémisphère sud

    return { zone, band: latBand(lat), easting, northing, hemisphere: lat < 0 ? 'S' : 'N' };
}

/**
 * WGS84 (lat,lon) → chaîne MGRS. `digits` = chiffres par axe (5 → précision 1 m).
 */
export function latLngToMgrs(lat, lon, digits = 5) {
    // Domaine MGRS/UTM : bandes C→X (lat −80…84). Hors domaine, la série de
    // Snyder diverge et produirait une chaîne FAUSSE mais plausible — on jette,
    // les appelants (formatCoordsClipboard/shortMgrs) omettent alors le MGRS.
    if (!(lat >= -80 && lat < 84)) {
        throw new RangeError('MGRS hors domaine (lat ' + lat + ')');
    }
    const { zone, band, easting, northing } = latLngToUtm(lat, lon);

    // Colonne 100 km : selon (zone-1)%3 et la centaine de km d'easting (1…8).
    const colSet = COL_SETS[(zone - 1) % 3];
    const colLetter = colSet[Math.floor(easting / 100000) - 1];

    // Ligne 100 km : alphabet pair/impair, indexé sur northing modulo 2 000 km.
    const rowAlphabet = (zone % 2 === 1) ? ROW_ODD : ROW_EVEN;
    const rowLetter = rowAlphabet[Math.floor((northing % 2000000) / 100000)];

    const div = Math.pow(10, 5 - digits);
    const e = String(Math.floor((easting % 100000) / div)).padStart(digits, '0');
    const n = String(Math.floor((northing % 100000) / div)).padStart(digits, '0');

    return `${zone}${band} ${colLetter}${rowLetter} ${e} ${n}`;
}

/** Une composante en degrés/minutes/secondes signée → "48°51′23.8″N". */
function toDms(value, isLat) {
    const hemi = value >= 0 ? (isLat ? 'N' : 'E') : (isLat ? 'S' : 'W');
    const abs = Math.abs(value);
    let d = Math.floor(abs);
    const mFull = (abs - d) * 60;
    let m = Math.floor(mFull);
    // Arrondi à 0.1″ AVANT affichage, avec retenue : sinon 48°59′59.98″
    // s'affichait « 48°59′60.0″ » (secondes = 60, invalide).
    let s = Math.round((mFull - m) * 60 * 10) / 10;
    if (s >= 60) { s -= 60; m += 1; }
    if (m >= 60) { m -= 60; d += 1; }
    return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${hemi}`;
}

/**
 * Bloc texte multi-formats prêt pour le presse-papier (3 lignes).
 * @param {number} lng
 * @param {number} lat
 */
export function formatCoordsClipboard(lng, lat) {
    lng = normLon(lng);
    const dec = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    const dms = `${toDms(lat, true)}  ${toDms(lng, false)}`;
    let mgrs;
    try { mgrs = `MGRS ${latLngToMgrs(lat, lng)}`; }
    catch (_) { mgrs = null; }   // hors domaine UTM (régions polaires) : on omet
    return [dec, dms, mgrs].filter(Boolean).join('\n');
}

/** Version courte (1 ligne) pour les toasts/labels : "MGRS 31U DQ 48251 11932". */
export function shortMgrs(lng, lat) {
    lng = normLon(lng);
    try { return latLngToMgrs(lat, lng); } catch (_) { return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
}
