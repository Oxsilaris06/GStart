import { Storage } from './storage.js';
import { ImageStore } from './imageStore.js';
import { PDF_PAX_COLORS, PHOTO_CATEGORIES, FREE_MODE_COLORS } from './config.js';

/**
 * Recompresse un dataURL image (PNG plein DPR de la capture carte ≈ plusieurs Mo)
 * en JPEG sur fond blanc : divise ~par 10 le poids embarqué dans le PDF.
 * En cas d'échec, l'appelant garde le dataURL d'origine.
 */
async function dataUrlToJpeg(dataUrl, quality = 0.85) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cx = c.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', quality);
}

/**
 * Export PDF pour PC TAC utilisant pdf-lib
 * Structure multi-pages ordonnée et respect du thème (clair/sombre).
 */

/**
 * sanitizeWinAnsi(s)
 * Helvetica/Standard fonts de pdf-lib n'encodent que le jeu WinAnsi (cp1252).
 * Tout caractère hors de ce jeu (apostrophes/guillemets courbes, tirets longs,
 * points de suspension, espaces insécables exotiques, emoji, symboles, lettres
 * non-latines...) provoque une exception à drawText/widthOfTextAtSize et fait
 * planter l'export entier. On translittère vers ASCII/WinAnsi quand un équivalent
 * raisonnable existe, sinon on remplace par '?'. Ne jette jamais.
 */
function sanitizeWinAnsi(s) {
    if (s === null || s === undefined) return '';
    let str;
    try {
        str = String(s);
    } catch (_e) {
        return '';
    }

    // Translittérations ciblées (caractères fréquents en saisie utilisateur FR)
    const MAP = {
        '‘': "'", '’': "'", '‚': "'", '‛': "'",   // guillemets simples courbes
        '“': '"', '”': '"', '„': '"', '‟': '"',   // guillemets doubles courbes
        '′': "'", '″': '"',                                  // prime / double prime
        '–': '-', '—': '-', '―': '-', '−': '-',    // tirets longs / signe moins
        '‐': '-', '‑': '-',                                  // traits d'union
        '…': '...',                                              // points de suspension
        ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',    // espaces insécables / fines
        '​': '', '﻿': '',                                   // espaces de largeur nulle / BOM
        '•': '-', '‣': '-', '●': '-', '·': '.',    // puces
        '€': '€',                                            // euro (présent en WinAnsi 0x80)
        '™': 'TM', '«': '"', '»': '"'                   // (chevrons) -> gardés via WinAnsi sinon
    };

    let out = '';
    for (const ch of str) {
        if (Object.prototype.hasOwnProperty.call(MAP, ch)) {
            out += MAP[ch];
            continue;
        }
        const code = ch.codePointAt(0);
        // ASCII imprimable + retour/saut acceptés tels quels
        if (code === 0x09 || code === 0x0A || code === 0x0D || (code >= 0x20 && code <= 0x7E)) {
            out += ch;
            continue;
        }
        // Plage Latin-1 / WinAnsi haute (0xA0-0xFF) : majoritairement encodable.
        // On garde les lettres accentuées usuelles (é, è, à, ç, ô, ü, ñ...).
        if (code >= 0xA0 && code <= 0xFF) {
            out += ch;
            continue;
        }
        // Quelques caractères WinAnsi spécifiques dans la plage 0x80-0x9F
        if (ch === 'Œ') { out += 'OE'; continue; }
        if (ch === 'œ') { out += 'oe'; continue; }
        if (ch === 'Š') { out += 'S'; continue; }
        if (ch === 'š') { out += 's'; continue; }
        if (ch === 'Ÿ') { out += 'Y'; continue; }
        if (ch === 'Ž') { out += 'Z'; continue; }
        if (ch === 'ž') { out += 'z'; continue; }
        if (ch === 'ƒ') { out += 'f'; continue; }
        // Tout le reste (emoji, idéogrammes, symboles divers...) -> '?'
        out += '?';
    }
    return out;
}

export const PdfExport = {
    async buildPdf() {
        try {
            if (typeof PDFLib === 'undefined') {
                alert('Librairie pdf-lib non chargée (réseau ?). Réessaie dans quelques secondes.');
                return;
            }
            const { PDFDocument, rgb: pdfRgb, StandardFonts, PageSizes } = PDFLib;
            // PageSizes.A4 est un tuple partagé : toujours cloner avant addPage
            const A4_PORTRAIT  = PageSizes.A4.slice();
            const A4_LANDSCAPE = PageSizes.A4.slice().reverse();
            const pdfDoc = await PDFDocument.create();
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

            // Charger les données (les photos sont stockées en IndexedDB, on les hydrate)
            const logData = Storage.loadLogData();
            const adversaries = await ImageStore.hydrate(Storage.loadCollection('pcTacAdversaries'), 'photo');
            const hostages = await ImageStore.hydrate(Storage.loadCollection('pcTacHostages'), 'photo');
            const friends = Storage.loadCollection('pcTacFriends');
            const photos = await ImageStore.hydrate(Storage.loadCollection('pcTacPhotos'), 'data');

            // Détection du thème
            const isDarkMode = document.body.classList.contains('dark-mode');
            const themeColors = {
                background: isDarkMode ? pdfRgb(0.1, 0.1, 0.1) : pdfRgb(1, 1, 1),
                text: isDarkMode ? pdfRgb(0.9, 0.9, 0.9) : pdfRgb(0, 0, 0),
                line: isDarkMode ? pdfRgb(0.3, 0.3, 0.3) : pdfRgb(0.8, 0.8, 0.8),
                headerBg: isDarkMode ? pdfRgb(0.2, 0.2, 0.2) : pdfRgb(0.95, 0.95, 0.95),
                highlight: isDarkMode ? pdfRgb(0.15, 0.15, 0.15) : pdfRgb(0.98, 0.98, 0.98)
            };

            const context = {
                pdfDoc,
                helveticaFont: font,
                helveticaBoldFont: fontBold,
                fontSize: 9,
                lineHeight: 12,
                margin: 40,
                pageWidth: 0,
                pageHeight: 0,
                y: 0,
                currentPage: null,
                pageNumber: 0,
                colors: themeColors
            };

            // --- FONCTIONS UTILITAIRES ---
            const wrapText = (text, width, font, size) => {
                const words = sanitizeWinAnsi(text).split(' ');
                const lines = [];
                let currentLine = '';
                words.forEach(word => {
                    const testLine = currentLine ? currentLine + ' ' + word : word;
                    if (font.widthOfTextAtSize(testLine, size) < width) {
                        currentLine = testLine;
                    } else {
                        lines.push(currentLine);
                        currentLine = word;
                    }
                });
                if (currentLine) lines.push(currentLine);
                return lines;
            };

            const addNewPage = (title, isLandscape = false) => {
                // Cloner à chaque appel : pdf-lib peut conserver la référence
                const size = (isLandscape ? A4_LANDSCAPE : A4_PORTRAIT).slice();
                context.currentPage = pdfDoc.addPage(size);
                context.pageWidth = context.currentPage.getWidth();
                context.pageHeight = context.currentPage.getHeight();
                context.y = context.pageHeight - context.margin;
                context.pageNumber++;

                context.currentPage.drawRectangle({
                    x: 0, y: 0, width: context.pageWidth, height: context.pageHeight, color: themeColors.background
                });

                if (title) {
                    context.currentPage.drawText(sanitizeWinAnsi(title), {
                        x: context.margin, y: context.y, size: 14, font: fontBold, color: themeColors.text
                    });
                    context.y -= 30;
                }
            };

            const drawImageSafe = async (page, dataUrl, x, y, maxWidth, maxHeight) => {
                try {
                    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return y;
                    const ab = await fetch(dataUrl).then(res => res.arrayBuffer());
                    const imgBytes = new Uint8Array(ab); // pdf-lib préfère Uint8Array

                    // Validation simple du header JPEG/PNG
                    const isPng  = imgBytes[0] === 0x89 && imgBytes[1] === 0x50;
                    const isJpeg = imgBytes[0] === 0xFF && imgBytes[1] === 0xD8;

                    let img;
                    if (isPng) img = await pdfDoc.embedPng(imgBytes);
                    else if (isJpeg) img = await pdfDoc.embedJpg(imgBytes);
                    else throw new Error("Format image non supporté ou corrompu");

                    const dims = img.scale(1);
                    const ratio = Math.min(maxWidth / dims.width, maxHeight / dims.height);
                    const finalWidth = dims.width * ratio;
                    const finalHeight = dims.height * ratio;

                    page.drawImage(img, { x, y: y - finalHeight, width: finalWidth, height: finalHeight });
                    return y - finalHeight - 10;
                } catch (e) {
                    console.error("PDF Image Embed Error:", e);
                    page.drawText("[Image Erreur]", { x, y: y - 15, size: 8, font, color: pdfRgb(0.7, 0, 0) });
                    return y - 20;
                }
            };

            // --- 1. MAIN COURANTE ---
            addNewPage("MAIN COURANTE - JOURNAL D'INTERVENTION");
            const colWidths = [50, 70, 150, 245]; // Heure, Pax, Localisation, Remarques
            const headers = ["Heure", "Pax", "Localisation", "Remarques"];

            const drawTableHeader = () => {
                context.currentPage.drawRectangle({
                    x: context.margin, y: context.y - 5, width: context.pageWidth - 2 * context.margin, height: 20, color: themeColors.headerBg
                });
                let currentX = context.margin + 5;
                headers.forEach((h, i) => {
                    context.currentPage.drawText(h, { x: currentX, y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
                    currentX += colWidths[i];
                });
                context.y -= 25;
            };

            drawTableHeader();

            for (const entry of logData) {
                const remarksLines = wrapText(entry.remarques, colWidths[3] - 10, font, 9);
                const rowHeight = Math.max(1, remarksLines.length) * context.lineHeight + 10;

                if (context.y - rowHeight < context.margin) {
                    addNewPage("MAIN COURANTE (SUITE)");
                    drawTableHeader();
                }

                let currentX = context.margin + 5;
                context.currentPage.drawText(sanitizeWinAnsi(entry.heure), { x: currentX, y: context.y, size: 9, font, color: themeColors.text });
                currentX += colWidths[0];
                
                // Style Pax (Couleur)
                let pColor = pdfRgb(0.5, 0.5, 0.5);
                let pText = entry.pax || '';
                let hexColor = '#888888';
                if (entry.paxMode === 'standard') {
                    const cfg = PDF_PAX_COLORS[entry.pax] || PDF_PAX_COLORS['Autre'];
                    hexColor = cfg.color;
                } else {
                    hexColor = entry.paxColor || '#888888';
                }
                const r = parseInt(hexColor.slice(1,3), 16);
                const g = parseInt(hexColor.slice(3,5), 16);
                const b = parseInt(hexColor.slice(5,7), 16);
                pColor = pdfRgb(r/255, g/255, b/255);
                
                // Calcul du contraste YIQ pour déterminer la couleur de police (noir ou blanc)
                const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
                const textColor = (yiq >= 128) ? pdfRgb(0, 0, 0) : pdfRgb(1, 1, 1);

                context.currentPage.drawRectangle({ x: currentX - 2, y: context.y - 2, width: colWidths[1] - 5, height: 12, color: pColor });
                context.currentPage.drawText(sanitizeWinAnsi(pText).substring(0, 12), { x: currentX, y: context.y, size: 8, font: fontBold, color: textColor });
                currentX += colWidths[1];

                context.currentPage.drawText(sanitizeWinAnsi(entry.lieu).substring(0, 25), { x: currentX, y: context.y, size: 9, font, color: themeColors.text });
                currentX += colWidths[2];

                remarksLines.forEach((line, idx) => {
                    context.currentPage.drawText(line, { x: currentX, y: context.y - (idx * context.lineHeight), size: 9, font, color: themeColors.text });
                });

                context.currentPage.drawLine({
                    start: { x: context.margin, y: context.y - rowHeight + 12 },
                    end: { x: context.pageWidth - context.margin, y: context.y - rowHeight + 12 },
                    thickness: 0.5, color: themeColors.line, opacity: 0.3
                });

                context.y -= rowHeight;
            }

            // --- 2. ADVERSAIRES ---
            if (adversaries.length > 0) {
                addNewPage("FICHIER ADVERSAIRES");
                for (const adv of adversaries) {
                    if (context.y < 180) addNewPage("FICHIER ADVERSAIRES (SUITE)");
                    
                    context.currentPage.drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2*context.margin, height: 20, color: themeColors.headerBg });
                    context.currentPage.drawText(sanitizeWinAnsi(`${adv.nom || ''} ${adv.prenom || ''}`), { x: context.margin + 5, y: context.y + 2, size: 11, font: fontBold, color: themeColors.text });
                    context.y -= 25;

                    if (adv.photo) {
                        await drawImageSafe(context.currentPage, adv.photo, context.margin, context.y + 20, 120, 120);
                    }

                    let infoY = context.y;
                    const labels = [
                        `Né le: ${adv.dob || 'N/C'}`,
                        `Lien ravisseurs: ${adv.lien || 'N/C'}`,
                        `Antécédents: ${adv.antecedents || 'N/C'}`,
                        `Attitude: ${adv.attitude || 'N/C'}`,
                        `Substance: ${adv.substance || 'N/C'}`,
                        `Armement: ${adv.armes || 'N/C'}`
                    ];
                    labels.forEach(l => {
                        context.currentPage.drawText(sanitizeWinAnsi(l), { x: context.margin + 140, y: infoY, size: 9, font, color: themeColors.text });
                        infoY -= 14;
                    });
                    context.y = Math.min(context.y - 130, infoY - 20);
                }
            }

            // --- 3. OTAGES ---
            if (hostages.length > 0) {
                addNewPage("FICHIER OTAGES / VICTIMES");
                for (const host of hostages) {
                    if (context.y < 180) addNewPage("FICHIER OTAGES (SUITE)");
                    
                    context.currentPage.drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2*context.margin, height: 20, color: themeColors.headerBg });
                    context.currentPage.drawText(sanitizeWinAnsi(`${host.nom || ''} ${host.prenom || ''}`), { x: context.margin + 5, y: context.y + 2, size: 11, font: fontBold, color: themeColors.text });
                    context.y -= 25;

                    if (host.photo) {
                        await drawImageSafe(context.currentPage, host.photo, context.margin, context.y + 20, 120, 120);
                    }

                    let infoY = context.y;
                    const labels = [
                        `Né le: ${host.dob || 'N/C'}`,
                        `Lien ravisseurs: ${host.lien || 'N/C'}`,
                        `État: ${host.etat || 'N/C'}`,
                        `Blessures: ${host.blessures || 'N/C'}`
                    ];
                    labels.forEach(l => {
                        context.currentPage.drawText(sanitizeWinAnsi(l), { x: context.margin + 140, y: infoY, size: 9, font, color: themeColors.text });
                        infoY -= 14;
                    });
                    context.y = Math.min(context.y - 130, infoY - 20);
                }
            }

            // --- 4. AMIS ---
            if (friends.length > 0) {
                addNewPage("FORCES AMIES / UNITÉS");
                const fCols = [150, 150, 215];
                const fHeaders = ["Nom / Prénom", "Unité", "Mission / Contact"];
                
                const drawFHeader = () => {
                    context.currentPage.drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2*context.margin, height: 20, color: themeColors.headerBg });
                    let cx = context.margin + 5;
                    fHeaders.forEach((h, i) => {
                        context.currentPage.drawText(h, { x: cx, y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
                        cx += fCols[i];
                    });
                    context.y -= 25;
                };
                drawFHeader();

                for (const f of friends) {
                    if (context.y < 50) { addNewPage("FORCES AMIES (SUITE)"); drawFHeader(); }
                    let cx = context.margin + 5;
                    context.currentPage.drawText(sanitizeWinAnsi(`${f.nom || ''} ${f.prenom || ''}`), { x: cx, y: context.y, size: 9, font, color: themeColors.text });
                    cx += fCols[0];
                    context.currentPage.drawText(sanitizeWinAnsi(f.unite), { x: cx, y: context.y, size: 9, font, color: themeColors.text });
                    cx += fCols[1];
                    context.currentPage.drawText(sanitizeWinAnsi(`${f.mission || ''} ${f.tph ? '['+f.tph+']':''}`), { x: cx, y: context.y, size: 9, font, color: themeColors.text });
                    context.y -= 20;
                }
            }

            // --- 5. PHOTOS PAR CATÉGORIE ---
            const categories = PHOTO_CATEGORIES.filter(c => c.id !== 'all');
            for (const cat of categories) {
                const catPhotos = photos.filter(p => p.category === cat.id);
                if (catPhotos.length === 0) continue;

                addNewPage(`GALERIE : ${cat.label.toUpperCase()}`, true); // Mode PAYSAGE
                for (let i = 0; i < catPhotos.length; i += 2) {
                    // Une page paysage par paire de photos (toute la hauteur dispo).
                    if (i > 0) addNewPage(`GALERIE : ${cat.label.toUpperCase()} (SUITE)`, true);
                    
                    const photoWidth = (context.pageWidth - 3 * context.margin) / 2;
                    const photoHeightMax = context.pageHeight - 2 * context.margin - 40; // Presque toute la hauteur

                    const p1 = catPhotos[i];
                    context.currentPage.drawText(sanitizeWinAnsi(p1.title), { x: context.margin, y: context.y, size: 10, font: fontBold, color: themeColors.text });
                    const y1 = await drawImageSafe(context.currentPage, p1.data, context.margin, context.y - 10, photoWidth, photoHeightMax);

                    let y2 = context.y;
                    if (i + 1 < catPhotos.length) {
                        const p2 = catPhotos[i+1];
                        context.currentPage.drawText(sanitizeWinAnsi(p2.title), { x: context.margin + photoWidth + context.margin, y: context.y, size: 10, font: fontBold, color: themeColors.text });
                        y2 = await drawImageSafe(context.currentPage, p2.data, context.margin + photoWidth + context.margin, context.y - 10, photoWidth, photoHeightMax);
                    }
                    context.y = Math.min(y1, y2) - 30;
                }
            }

            // --- 6. PLAN TACTIQUE (carte MapLibre + liste des points) ---
            // Défensif de bout en bout : la vue Plan peut n'avoir jamais été ouverte,
            // PlanMap peut être absent, captureToDataUrl peut renvoyer null ou jeter.
            // Aucune de ces situations ne doit interrompre l'export.
            try {
                if (window.PlanMap && typeof window.PlanMap.captureToDataUrl === 'function') {
                    // La capture exige une vue Plan VISIBLE (canvas dimensionné).
                    // Export lancé depuis un autre onglet : on bascule le temps de
                    // la capture, puis on restaure la vue de départ.
                    const planView = document.getElementById('view-plan');
                    const planHidden = !planView || !planView.classList.contains('active');
                    const prevView = localStorage.getItem('lastView');
                    const canSwitch = window.UI && typeof window.UI.switchMainView === 'function';
                    if (planHidden && canSwitch) {
                        window.UI.switchMainView('view-plan');
                        try { if (window.PlanMap.map) window.PlanMap.map.resize(); } catch (_) {}
                        await new Promise(r => setTimeout(r, 450)); // laisse la carte se dimensionner
                    }
                    let mapDataUrl = null;
                    try {
                        mapDataUrl = await window.PlanMap.captureToDataUrl();
                    } catch (capErr) {
                        console.warn('PDF Plan capture échouée :', capErr);
                        mapDataUrl = null;
                    } finally {
                        if (planHidden && canSwitch && prevView) window.UI.switchMainView(prevView);
                    }

                    if (mapDataUrl && typeof mapDataUrl === 'string' && mapDataUrl.startsWith('data:image')) {
                        // PNG plein DPR → JPEG : PDF ~10× plus léger, qualité suffisante.
                        // toDataURL peut renvoyer 'data:,' SANS exception (canvas trop
                        // grand/mémoire) : on ne remplace le PNG que par un JPEG valide.
                        try {
                            const jpeg = await dataUrlToJpeg(mapDataUrl, 0.85);
                            if (jpeg && jpeg.startsWith('data:image')) mapDataUrl = jpeg;
                        } catch (_) { /* on garde le PNG */ }
                        addNewPage('PLAN TACTIQUE', true); // Paysage A4
                        const imgMaxWidth = context.pageWidth - 2 * context.margin;
                        const imgMaxHeight = context.pageHeight - 2 * context.margin - 30;
                        await drawImageSafe(context.currentPage, mapDataUrl, context.margin, context.y - 5, imgMaxWidth, imgMaxHeight);
                    } else {
                        // Plus JAMAIS d'absence silencieuse : on le dit dans le PDF.
                        addNewPage('PLAN TACTIQUE', true);
                        context.currentPage.drawText(
                            sanitizeWinAnsi('Carte non disponible au moment de l\'export. Ouvre l\'onglet Plan puis relance l\'export PDF.'),
                            { x: context.margin, y: context.y - 10, size: 12, font, color: themeColors.text }
                        );
                    }
                }

                // Liste des points (pings) — indépendante de la capture image.
                if (window.PlanMap && typeof window.PlanMap.getPinsSummary === 'function') {
                    let pins = [];
                    try {
                        const raw = window.PlanMap.getPinsSummary();
                        if (Array.isArray(raw)) pins = raw;
                    } catch (pinErr) {
                        console.warn('PDF Plan getPinsSummary échouée :', pinErr);
                        pins = [];
                    }

                    if (pins.length > 0) {
                        addNewPage('PLAN TACTIQUE - LISTE DES POINTS');
                        const pCols = [200, 110, 110, 95]; // Label, Latitude, Longitude, Diamètre
                        const pHeaders = ['Label', 'Latitude', 'Longitude', 'Diamètre (m)'];

                        const drawPinHeader = () => {
                            context.currentPage.drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2 * context.margin, height: 20, color: themeColors.headerBg });
                            let px = context.margin + 5;
                            pHeaders.forEach((h, i) => {
                                context.currentPage.drawText(h, { x: px, y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
                                px += pCols[i];
                            });
                            context.y -= 25;
                        };
                        drawPinHeader();

                        const fmtCoord = (n) => (typeof n === 'number' && isFinite(n)) ? n.toFixed(6) : 'N/C';
                        const fmtDiam = (n) => (typeof n === 'number' && isFinite(n)) ? Math.round(n).toString() : '-';

                        for (const pin of pins) {
                            if (!pin || typeof pin !== 'object') continue;
                            if (context.y < context.margin + 20) { addNewPage('PLAN TACTIQUE - LISTE DES POINTS (SUITE)'); drawPinHeader(); }
                            let px = context.margin + 5;
                            context.currentPage.drawText(sanitizeWinAnsi(pin.label).substring(0, 40), { x: px, y: context.y, size: 9, font, color: themeColors.text });
                            px += pCols[0];
                            context.currentPage.drawText(fmtCoord(pin.lat), { x: px, y: context.y, size: 9, font, color: themeColors.text });
                            px += pCols[1];
                            context.currentPage.drawText(fmtCoord(pin.lng), { x: px, y: context.y, size: 9, font, color: themeColors.text });
                            px += pCols[2];
                            context.currentPage.drawText(fmtDiam(pin.diameterM), { x: px, y: context.y, size: 9, font, color: themeColors.text });

                            context.currentPage.drawLine({
                                start: { x: context.margin, y: context.y - 5 },
                                end: { x: context.pageWidth - context.margin, y: context.y - 5 },
                                thickness: 0.5, color: themeColors.line, opacity: 0.3
                            });
                            context.y -= 18;
                        }
                    }
                }
            } catch (planErr) {
                // Section entièrement optionnelle : on log et on continue l'export.
                console.warn('PDF Plan tactique ignoré :', planErr);
            }

            // --- 7. BOARD RELATIONNEL (capture html2canvas du dashboard) ---
            // Défensif de bout en bout : Dashboard peut être absent, jamais initialisé,
            // captureToDataUrl peut renvoyer null ou jeter. Aucun échec ne doit
            // interrompre l'export : on log et on saute la section.
            try {
                if (window.Dashboard && typeof window.Dashboard.captureToDataUrl === 'function') {
                    // Même contrainte que la carte : le board doit avoir été rendu.
                    const dashView = document.getElementById('view-dashboard');
                    const dashHidden = !dashView || !dashView.classList.contains('active');
                    const prevView2 = localStorage.getItem('lastView');
                    const canSwitch2 = window.UI && typeof window.UI.switchMainView === 'function';
                    if (dashHidden && canSwitch2) {
                        window.UI.switchMainView('view-dashboard'); // init paresseuse + render
                        await new Promise(r => setTimeout(r, 650)); // laisse les nœuds se construire
                    }
                    let boardDataUrl = null;
                    try {
                        boardDataUrl = await window.Dashboard.captureToDataUrl();
                    } catch (capErr) {
                        console.warn('PDF Board relationnel capture échouée :', capErr);
                        boardDataUrl = null;
                    } finally {
                        if (dashHidden && canSwitch2 && prevView2) window.UI.switchMainView(prevView2);
                    }

                    if (boardDataUrl && typeof boardDataUrl === 'string' && boardDataUrl.startsWith('data:image')) {
                        addNewPage('BOARD RELATIONNEL', true); // Paysage A4
                        const imgMaxWidth = context.pageWidth - 2 * context.margin;
                        const imgMaxHeight = context.pageHeight - 2 * context.margin - 30;
                        await drawImageSafe(context.currentPage, boardDataUrl, context.margin, context.y - 5, imgMaxWidth, imgMaxHeight);
                    }
                }
            } catch (boardErr) {
                // Section entièrement optionnelle : on log et on continue l'export.
                console.warn('PDF Board relationnel ignoré :', boardErr);
            }

            // --- FOOTER : pagination + DIFFUSION RESTREINTE sur toutes les pages ---
            const allPages = pdfDoc.getPages();
            const totalPages = allPages.length;
            const exportStamp = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
            const footerColor = pdfRgb(0.55, 0.55, 0.55);
            const restrictColor = pdfRgb(0.7, 0.15, 0.15);

            allPages.forEach((page, idx) => {
                const w = page.getWidth();
                const pageNum = `Page ${idx + 1} / ${totalPages}`;
                const numWidth = font.widthOfTextAtSize(pageNum, 8);
                const restrict = 'DIFFUSION RESTREINTE';
                const restrictWidth = fontBold.widthOfTextAtSize(restrict, 8);

                // Ligne fine au-dessus du footer
                page.drawLine({
                    start: { x: context.margin, y: 22 },
                    end: { x: w - context.margin, y: 22 },
                    thickness: 0.3, color: themeColors.line, opacity: 0.5
                });

                // Gauche : mention DIFFUSION RESTREINTE
                page.drawText(restrict, {
                    x: context.margin, y: 10, size: 8, font: fontBold, color: restrictColor
                });
                // Centre : horodatage export
                const center = sanitizeWinAnsi(`PC TAC - Export ${exportStamp}`);
                const centerWidth = font.widthOfTextAtSize(center, 8);
                page.drawText(center, {
                    x: (w - centerWidth) / 2, y: 10, size: 8, font, color: footerColor
                });
                // Droite : pagination
                page.drawText(pageNum, {
                    x: w - context.margin - numWidth, y: 10, size: 8, font, color: footerColor
                });

                // Suppress 'restrictWidth' lint without affecting layout (réservé si bordure ajoutée plus tard)
                void restrictWidth;
            });

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `PC-TAC-EXPORT-${new Date().getTime()}.pdf`;
            link.click();
            // Libère le blob une fois le téléchargement amorcé (sinon fuite mémoire).
            setTimeout(() => { try { URL.revokeObjectURL(link.href); } catch (_) {} }, 30000);

        } catch (e) {
            console.error("PDF Export Critical Error:", e);
            alert("Erreur lors de la génération du PDF :\n\n" + (e && e.message ? e.message : e));
        }
    }
};

window.PdfExport = PdfExport;
