function isFullscreen() {
            return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        }

function toggleFullscreen() {
            const icon = document.getElementById('fullscreenIcon');
            if (!isFullscreen()) {
                if (document.documentElement.requestFullscreen) {
                    document.documentElement.requestFullscreen();
                } else if (document.documentElement.mozRequestFullScreen) { /* Firefox */
                    document.documentElement.mozRequestFullScreen();
                } else if (document.documentElement.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
                    document.documentElement.webkitRequestFullscreen();
                } else if (document.documentElement.msRequestFullscreen) { /* IE/Edge */
                    document.documentElement.msRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.mozCancelFullScreen) { /* Firefox */
                    document.mozCancelFullScreen();
                } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
                    document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) { /* IE/Edge */
                    document.msExitFullscreen();
                }
            }
        }

function updateFullscreenIcon() {
            const icon = document.getElementById('fullscreenIcon');
            if (icon) {
                if (isFullscreen()) {
                    icon.textContent = 'fullscreen_exit';
                    icon.title = 'Quitter le plein écran';
                } else {
                    icon.textContent = 'fullscreen';
                    icon.title = 'Plein écran';
                }
            }
        }

function handleThemeToggle() {
            document.body.classList.toggle('light-mode');
            document.body.classList.toggle('dark-mode');
            const isDarkMode = document.body.classList.contains('dark-mode');
            localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
            document.getElementById('darkModeIcon').textContent = isDarkMode ? 'nightlight' : 'clear_day';
        }

function toggleDock() {
            const dock = document.getElementById('dockMenu');
            const dockCollapsed = dock.classList.toggle('collapsed');
            localStorage.setItem('dockCollapsed', dockCollapsed);

            // Mise à jour de l'icône de toggle
            const icon = document.querySelector('#dockToggleBtn .material-symbols-outlined');
            if (icon) {
                // Inverser l'icône : expand_more (pointe vers le bas/ouvert) -> expand_less (pointe vers le haut/fermé)
                icon.textContent = dockCollapsed ? 'expand_less' : 'expand_more';
            }
        }

async function downloadOiPdf() {
                // CORRECTION: Assurer que PDFLib est disponible avant de continuer
                if (typeof PDFLib === 'undefined') { alert("Erreur: La bibliothèque PDF n'est pas encore chargée."); return; }
                const btn = downloadPdfBtn;
                const originalText = btn.textContent;
                btn.textContent = 'Génération en cours...'; btn.disabled = true;

                try {
                    const result = await buildPdf();
                    if (!result) {
                        alert("La génération a échoué. Vérifiez vos données.");
                        return;
                    }
                    const { pdfBytes, formData } = result;
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);

                    const getVal = (id) => formData[id] || 'RAS';

                    const link = document.createElement('a');
                    const firstAdv = formData.adversaries && formData.adversaries[0] ? formData.adversaries[0].nom_adversaire : '';
                    let fileName = `OI_${getVal('date_op').replace(/[\/\\?%*:|"<>]/g, '-')}_${(firstAdv || 'OPÉRATION').replace(/ /g, '_')}`;
                    if (formData.adversaries && formData.adversaries.length > 1) {
                        fileName += `_et_${formData.adversaries.length - 1}_autres`;
                    }
                    link.download = `${fileName}.pdf`;
                    link.href = url;

                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    URL.revokeObjectURL(url);

                    // Supprimé alert bloquant.

                } catch (error) {
                    console.error("Erreur critique lors de la génération du PDF:", error);
                    alert("Une erreur critique est survenue lors de la génération du PDF. Consultez la console (F12).");
                } finally {
                    btn.textContent = originalText; btn.disabled = false;
                }
            }

function openPresentationMode() {
                const presentationContent = document.getElementById('presentation-content');

                if (!presentationModal) {
                    console.error("Modale 'presentationModal' non trouvée.");
                    return;
                }

                if (!checkCoherence()) {
                    alert("Attention: Des incohérences ont été détectées. Veuillez les vérifier dans la section Finalisation avant de générer.");
                }

                // CORRECTION: Ajout du contrôle du curseur pendant le chargement
                document.body.style.cursor = 'wait';

                presentationContent.innerHTML = '<h2>Chargement de l\'aperçu...</h2><p style="text-align:center;">Veuillez patienter pendant la compilation des images annotées.</p>';

                if (typeof presentationModal.showModal === 'function') {
                    presentationModal.showModal();
                } else {
                    presentationModal.style.display = 'block';
                }

                buildPresentationHtml().then(html => {
                    presentationContent.innerHTML = html;
                }).catch(err => {
                    console.error("Erreur lors de la construction de l'aperçu HTML:", err);
                    const dangerColor = document.body.classList.contains('dark-mode') ? '#c0392b' : '#c0392b';
                    presentationContent.innerHTML = '<h2>Erreur d\'affichage</h2><p style="color:' + dangerColor + ';">Une erreur est survenue lors de la compilation des images annotées pour l\'aperçu. Réessayez ou vérifiez la console.</p>';
                }).finally(() => {
                    document.body.style.cursor = 'default';
                });
            }

async function buildPdf() {
            // CORRECTION: Vérification de PDFLib ici pour une erreur plus claire
            if (typeof PDFLib === 'undefined') { throw new Error("PDFLib non chargé."); }

            const { PDFDocument, StandardFonts, rgb, PageSizes } = PDFLib;
            const pdfDoc = await PDFDocument.create();
            let helveticaFont, helveticaBoldFont;
            try {
                helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
                helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
            } catch (e) {
                console.error("Erreur de chargement des polices PDF standard:", e);
                return null;
            }

            saveFormData();
            // Utilisation de la clé isolée
            const formDataString = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (!formDataString) { console.error("Aucune donnée à générer."); return null; }
            const formData = JSON.parse(formDataString);

            // --- Section de Compression Dynamique et de Chargement des Images ---
            const PDF_TARGET_SIZE_BYTES = 2.5 * 1024 * 1024;
            const TEXT_OVERHEAD_ESTIMATE = 150 * 1024;

            const allImagesMeta = [];
            if (formData.dynamic_photos) {
                for (const category in formData.dynamic_photos) {
                    formData.dynamic_photos[category].forEach(imgMeta => allImagesMeta.push(imgMeta));
                }
            }

            // Gestion du fond (Personnalisé ou Système)
            const customBgBlob = await dbManager.getItem('custom_pdf_background');
            let bgImageIdToUse = BACKGROUND_IMAGE_ID;

            if (customBgBlob) {
                bgImageIdToUse = 'custom_pdf_background';
                // On l'ajoute comme une image normale (chargée depuis la DB), pas comme système
                allImagesMeta.push({ id: 'custom_pdf_background', annotationsJson: '[]' });
            } else {
                const isDarkMode = document.body.classList.contains('dark-mode');
                const backgroundImagePath = isDarkMode ? BACKGROUND_IMAGE_DARK : BACKGROUND_IMAGE_LIGHT;
                allImagesMeta.push({ id: BACKGROUND_IMAGE_ID, path: backgroundImagePath, isSystemBackground: true, annotationsJson: '[]' });
            }


            let quality = 0.9;
            let compressedImages = {};
            let totalImageSize = 0;

            if (allImagesMeta.length > 0) {
                console.log("Début de la compression dynamique...");
                // Réduire la qualité jusqu'à 0.5 si la taille dépasse 2.5MB
                do {
                    totalImageSize = 0;
                    const compressionPromises = allImagesMeta.map(async (imgMeta) => {
                        let compressedBuffer = null;

                        if (imgMeta.isSystemBackground) {
                            // Chargement et compression de l'image de fond
                            compressedBuffer = await fetchImageAndCompress(imgMeta.path, quality);
                        } else {
                            const originalBlob = await dbManager.getItem(imgMeta.id);
                            if (!originalBlob) return { id: imgMeta.id, buffer: null };

                            let blobToCompress = originalBlob;
                            // Créer l'image annotée si des annotations existent
                            const annotations = JSON.parse(imgMeta.annotations || '[]');
                            if (annotations.length > 0) {
                                blobToCompress = await createAnnotatedImageBlob(originalBlob, annotations);
                            }

                            compressedBuffer = await compressImage(blobToCompress, quality);
                        }

                        return { id: imgMeta.id, buffer: compressedBuffer };
                    });

                    const results = await Promise.all(compressionPromises);

                    compressedImages = {};
                    for (const result of results) {
                        if (result.buffer) {
                            compressedImages[result.id] = result.buffer;
                            totalImageSize += result.buffer.byteLength;
                        }
                    }

                    console.log(`Qualité: ${quality.toFixed(1)}, Taille totale des images: ${(totalImageSize / 1024 / 1024).toFixed(2)}MB`);

                    if (totalImageSize + TEXT_OVERHEAD_ESTIMATE < PDF_TARGET_SIZE_BYTES) {
                        break;
                    }

                    quality -= 0.1;

                } while (quality >= 0.5);

                if (totalImageSize + TEXT_OVERHEAD_ESTIMATE > PDF_TARGET_SIZE_BYTES) {
                    console.warn(`Avertissement: Le PDF généré pourrait dépasser 2.5Mo. La taille des images compressées est de ${(totalImageSize / 1024 / 1024).toFixed(2)}MB.`);
                }
            }
            // --- Fin de la Section de Compression ---

            const getVal = (id) => formData[id] || '';
            const isDarkMode = document.body.classList.contains('dark-mode');
            const context = {
                pdfDoc, helveticaFont, helveticaBoldFont,
                currentPage: null, y: 0, pageWidth: 0, pageHeight: 0, margin: 40,
                pageNumber: 0,
                // CORRECTION: La couleur de fond est basée sur le thème
                colors: isDarkMode ? { background: rgb(30 / 255, 30 / 255, 30 / 255), text: rgb(1, 1, 1), accent: rgb(91 / 255, 155 / 255, 213 / 255), danger: rgb(192 / 255, 57 / 255, 43 / 255) } : { background: rgb(1, 1, 1), text: rgb(0, 0, 0), accent: rgb(0, 51 / 255, 160 / 255, 255), danger: rgb(192 / 255, 57 / 255, 43 / 255) }
            };
            let backgroundImage = null;

            // NOUVEAU: Chargement de l'image de fond compressée
            if (compressedImages[bgImageIdToUse]) {
                try {
                    const imageBytes = compressedImages[bgImageIdToUse];
                    // Tenter d'intégrer en PNG ou JPG selon le format
                    try {
                        backgroundImage = await pdfDoc.embedPng(imageBytes);
                    } catch (e) {
                        backgroundImage = await pdfDoc.embedJpg(imageBytes);
                    }
                } catch (e) {
                    console.warn("L'image de fond n'a pas pu être intégrée (même après compression).", e);
                }
            }

            const addNewPage = (isFinalPage = false) => {
                context.currentPage = context.pdfDoc.addPage([PageSizes.A4[1], PageSizes.A4[0]]);
                context.pageNumber++; // Incrémente le compteur de page
                const { width, height } = context.currentPage.getSize();
                context.pageWidth = width; context.pageHeight = height; context.y = height - context.margin;

                // CORRECTION FOND BLANC: Dessine un fond plein sur toutes les pages pour éviter les bandes blanches
                context.currentPage.drawRectangle({ x: 0, y: 0, width, height, color: context.colors.background });

                // CORRECTION IMAGE: Dessine le filigrane uniquement sur la première page et si c'est la page finale
                if (backgroundImage && (context.pageNumber === 1 || isFinalPage)) {
                    const scaled = backgroundImage.scaleToFit(width, height);
                    context.currentPage.drawImage(backgroundImage, {
                        x: (width - scaled.width) / 2,
                        y: (height - scaled.height) / 2,
                        width: scaled.width,
                        height: scaled.height,
                        // CONSIGNE: Opacité fixée à 1.0
                        opacity: 1.0
                    });
                }
            };
            const checkY = (spaceNeeded) => {
                // Vérifier si la place est suffisante. On ne déclenche pas addNewPage si c'est la page 1 (titre).
                if (context.y - spaceNeeded < context.margin && context.pageNumber > 0) {
                    addNewPage();
                    return true;
                }
                return false;
            };
            const drawTitle = (text) => { checkY(30); context.currentPage.drawText(text, { x: context.margin, y: context.y, font: helveticaBoldFont, size: 18, color: context.colors.accent }); context.y -= 30; };
            const drawSubTitle = (text) => { if (checkY(25)) { context.y -= 10; } context.currentPage.drawText(text, { x: context.margin, y: context.y, font: helveticaBoldFont, size: 14, color: context.colors.accent }); context.y -= 25; };
            const wrapText = (text, font, size, maxWidth) => {
                const words = String(text || '').replace(/\n/g, ' \n ').split(' ');
                let lines = []; let currentLine = '';
                for (const word of words) {
                    if (word === '\n') { lines.push(currentLine); currentLine = ''; continue; }
                    const lineWithWord = currentLine === '' ? word : `${currentLine} ${word}`;
                    if (font.widthOfTextAtSize(lineWithWord, size) > maxWidth && currentLine !== '') { lines.push(currentLine); currentLine = word; }
                    else { currentLine = lineWithWord; }
                }
                lines.push(currentLine); return lines;
            };
            const drawWrappedText = (text, options = {}) => {
                const { font = helveticaFont, size = 12, color = context.colors.text, x = context.margin + 15 } = options;
                const maxWidth = context.pageWidth - x - context.margin;
                const lines = wrapText(text, font, size, maxWidth);
                const totalHeight = lines.length * (size + 4);
                if (checkY(totalHeight + 10)) { context.y -= (size + 4); }
                lines.forEach((line, index) => { context.currentPage.drawText(line, { x, y: context.y - (index * (size + 4)), font, size, color }); });
                context.y -= (totalHeight + 10);
            };
            const drawTable = (headers, rows, columnWidths, startX) => {
                let currentY = context.y; const rowPadding = 5; const headerFontSize = 10; const contentFontSize = 10;
                const drawRow = (rowData, isHeader) => {
                    const font = isHeader ? helveticaBoldFont : helveticaFont; const size = isHeader ? headerFontSize : contentFontSize;
                    const cellContents = rowData.map((text, i) => wrapText(text, font, size, columnWidths[i] - 2 * rowPadding));
                    const maxLines = Math.max(...cellContents.map(lines => lines.length));
                    const rowHeight = maxLines * (size + 2) + 2 * rowPadding;
                    if (currentY - rowHeight < context.margin) { addNewPage(); currentY = context.y; drawRow(headers, true); }
                    currentY -= rowHeight; let currentX = startX;
                    rowData.forEach((_, i) => {
                        context.currentPage.drawRectangle({ x: currentX, y: currentY, width: columnWidths[i], height: rowHeight, borderColor: context.colors.accent, borderWidth: 0.5 });
                        const lines = cellContents[i];
                        lines.forEach((line, lineIndex) => { context.currentPage.drawText(line, { x: currentX + rowPadding, y: currentY + rowHeight - rowPadding - (lineIndex + 1) * (size + 4) + 2, font, size, color: context.colors.text }); });
                        currentX += columnWidths[i];
                    });
                };
                drawRow(headers, true); rows.forEach(row => drawRow(row, false)); context.y = currentY - 20;
            };

            const drawImagesFromCategory = async (previewContainerId, title) => {
                const imagesData = (formData.dynamic_photos || {})[previewContainerId] || [];
                for (let i = 0; i < imagesData.length; i++) {
                    const imgData = imagesData[i];
                    addNewPage();
                    try {
                        const imageBytes = compressedImages[imgData.id];
                        if (!imageBytes) throw new Error("Données d'image compressées non trouvées.");

                        let image;
                        try {
                            // Tente d'intégrer en PNG car toutes les images annotées sont PNG
                            if (JSON.parse(imgData.annotations || '[]').length > 0) {
                                image = await pdfDoc.embedPng(imageBytes);
                            } else { // Sinon tente JPG
                                image = await pdfDoc.embedJpg(imageBytes);
                            }
                        } catch (e) {
                            // Fallback si l'extension n'est pas fiable
                            try { image = await pdfDoc.embedPng(imageBytes); } catch (e2) { image = await pdfDoc.embedJpg(imageBytes); }
                        }

                        const { width, height } = context.currentPage.getSize();
                        const paddedW = width - context.margin * 2; const paddedH = height - context.margin * 2 - 30;
                        const scaled = image.scaleToFit(paddedW, paddedH);
                        const x = (width - scaled.width) / 2; const y = (height - scaled.height) / 2 + 15;
                        context.currentPage.drawImage(image, { x, y, width: scaled.width, height: scaled.height });
                        const finalTitle = imagesData.length > 1 ? `${title} (${i + 1})` : title;
                        const textWidth = helveticaBoldFont.widthOfTextAtSize(finalTitle, 14);
                        context.currentPage.drawText(finalTitle, { x: width / 2 - textWidth / 2, y: y - 20, font: helveticaBoldFont, size: 14, color: context.colors.text });
                    } catch (e) {
                        console.error(`Erreur d'intégration de l'image pour: ${title}`, e);
                        drawTitle("Erreur d'image"); drawWrappedText(`Impossible de charger une image.\n\nErreur: ${e.message}`);
                    }
                }
            };

            const getCompositionData = (teamPrefix) => {
                const membersByCell = {};
                const allMembers = (formData.patracdvr_rows || []).flatMap(row => row.members);

                allMembers.forEach(member => {
                    const cellule = member.cellule;
                    if (cellule && cellule.toLowerCase().startsWith(teamPrefix)) {
                        if (!membersByCell[cellule]) membersByCell[cellule] = [];
                        member.trigramme && membersByCell[cellule].push(member.trigramme);
                    }
                });

                const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                const sortedKeys = Object.keys(membersByCell).sort(naturalSort);

                return sortedKeys.map(cell => ({ cell: cell, members: membersByCell[cell] }));
            };

            const drawCompositionList = (compositionData) => {
                const fontSize = 12;
                const lineHeight = fontSize + 4;
                if (checkY(lineHeight)) { context.y -= 10; }

                let currentX = context.margin + 15;
                const cellStyle = { font: helveticaBoldFont, color: context.colors.danger, size: fontSize };
                const trigrammeStyle = { font: helveticaBoldFont, color: context.colors.text, size: fontSize };
                const separatorStyle = { font: helveticaFont, color: context.colors.text, size: fontSize };

                compositionData.forEach((group, groupIndex) => {
                    const cellShortName = group.cell.toLowerCase().replace('india ', 'I').replace('ao', 'AO').toUpperCase();

                    const groupParts = [{ text: cellShortName, style: cellStyle }, { text: ' : ', style: separatorStyle }];
                    group.members.forEach((member, memberIndex) => {
                        groupParts.push({ text: member, style: trigrammeStyle });
                        if (memberIndex < group.members.length - 1) {
                            groupParts.push({ text: ' - ', style: separatorStyle });
                        }
                    });
                    if (groupIndex < compositionData.length - 1) {
                        groupParts.push({ text: '    ', style: separatorStyle });
                    }

                    for (const part of groupParts) {
                        const partWidth = part.style.font.widthOfTextAtSize(part.text, part.style.size);
                        if (currentX + partWidth > context.pageWidth - context.margin) {
                            context.y -= lineHeight;
                            currentX = context.margin + 15;
                            if (checkY(lineHeight)) { context.y -= 10; }
                        }
                        context.currentPage.drawText(part.text, { x: currentX, y: context.y, ...part.style });
                        currentX += partWidth;
                    }
                });
                context.y -= (lineHeight + 10);
            };

            const drawAdversaryBlock = async (adv, index) => {
                const advName = adv.nom_adversaire || `Adversaire ${index + 1}`;
                
                // Nouvelle page pour chaque adversaire (selon feedback utilisateur)
                addNewPage();
                drawSubTitle(`ADVERSAIRE (OBJECTIF ${index + 1}): ${advName}`);

                // Recherche de la photo principale dans dynamic_photos via l'ID de conteneur photo_main_${adv.id}
                const mainPhotoContainerId = `photo_main_${adv.id}`;
                let mainImageMeta = null;
                if (formData.dynamic_photos && formData.dynamic_photos[mainPhotoContainerId]) {
                    mainImageMeta = formData.dynamic_photos[mainPhotoContainerId][0];
                }

                let isImagePresent = mainImageMeta !== null;
                const photoBoxWidth = 200;
                const photoBoxHeight = 220;
                const photoBoxX = context.pageWidth - context.margin - photoBoxWidth;
                const photoBoxMargin = 10;
                let topY = context.y;

                let tableStartX = context.margin;
                let tableMaxWidth = context.pageWidth - context.margin * 2;

                if (isImagePresent) {
                    tableMaxWidth = photoBoxX - tableStartX - photoBoxMargin;
                }

                const meText = (adv.me_list || []).map((me, i) => `ME${i + 1}: ${me}`).join(' | ');

                const adversaireHeaders = ["Information", "Détail"];

                const adversaireRows = [
                    ['Nom/Prénom', advName],
                    ['Domicile', adv.domicile_adversaire],
                    ['Naissance', `${adv.date_naissance || ''} à ${adv.lieu_naissance || ''}`],
                    ['Description', `${adv.stature_adversaire || ''} / ${adv.ethnie_adversaire || ''}`],
                    ['Signes particuliers', adv.signes_particuliers],
                    ['Profession', adv.profession_adversaire],
                    ['Antécédents', adv.antecedents_adversaire],
                    ['État d\'esprit', (adv.etat_esprit_list || []).join(', ')],
                    ['Attitude', adv.attitude_adversaire],
                    ['Volume (renfort)', (adv.volume_list || []).join(', ')],
                    ['Substances', adv.substances_adversaire],
                    ['Véhicules', (adv.vehicules_list || []).join(', ')],
                    ['Armes', adv.armes_connues],
                    ['Moyens Employés', meText],
                ].filter(row => row[1] && String(row[1]).trim() !== 'à' && String(row[1]).trim() !== 'N/A' && String(row[1]).trim() !== '');

                let photoBottomY = topY;
                let tableBottomY = topY;

                if (isImagePresent) {
                    const { id } = mainImageMeta;
                    const frameY = topY - photoBoxHeight;

                    try {
                        const imageBytes = compressedImages[id];
                        if (!imageBytes) throw new Error("Données d'image compressées pour l'adversaire non trouvées.");

                        let image;
                        try {
                            if (JSON.parse(mainImageMeta.annotations || '[]').length > 0) {
                                image = await pdfDoc.embedPng(imageBytes);
                            } else {
                                image = await pdfDoc.embedJpg(imageBytes);
                            }
                        } catch (e) {
                            try { image = await pdfDoc.embedPng(imageBytes); } catch (e2) { image = await pdfDoc.embedJpg(imageBytes); }
                        }

                        const scaled = image.scaleToFit(photoBoxWidth - 10, photoBoxHeight - 30);
                        const imageY = frameY + (photoBoxHeight - scaled.height) / 2;

                        if (frameY >= context.margin) {
                            context.currentPage.drawRectangle({ x: photoBoxX, y: frameY, width: photoBoxWidth, height: photoBoxHeight, borderColor: context.colors.accent, borderWidth: 1 });
                            context.currentPage.drawImage(image, { x: photoBoxX + (photoBoxWidth - scaled.width) / 2, y: imageY, width: scaled.width, height: scaled.height });
                            const photoTitle = `Photo de l'objectif ${index + 1}`;
                            const titleWidth = helveticaFont.widthOfTextAtSize(photoTitle, 10);
                            context.currentPage.drawText(photoTitle, { x: photoBoxX + (photoBoxWidth - titleWidth) / 2, y: frameY + 5, font: helveticaFont, size: 10, color: context.colors.text });
                            photoBottomY = frameY;
                        } else { isImagePresent = false; }
                    } catch (e) {
                        console.error(`Échec du traitement de la photo de l'adversaire ${index + 1}:`, e);
                        isImagePresent = false;
                    }
                }

                if (adversaireRows.length > 0) {
                    context.y = topY;
                    drawTable(adversaireHeaders, adversaireRows, [150, tableMaxWidth - 150], tableStartX);
                    tableBottomY = context.y;
                } else {
                    tableBottomY = topY;
                }

                context.y = Math.min(tableBottomY, photoBottomY) - 20;

                // Photos supplémentaires sur une nouvelle page (selon feedback utilisateur)
                const extraPhotoContainerId = `photo_extra_${adv.id}`;
                if (formData.dynamic_photos && formData.dynamic_photos[extraPhotoContainerId]) {
                    await drawImagesFromCategory(extraPhotoContainerId, `Photo Supplémentaire - Adversaire ${index + 1}`);
                }

                if (index === 0) {
                    await drawImagesFromCategory('renforts_photo_preview_container', 'Photo - Renforts Potentiels');
                }

                checkY(50);
            }

            const pdfCreationLogic = async () => {
                // Initialisation de la première page (qui doit avoir le fond)
                addNewPage();

                // CONSIGNE: Titre en haut à gauche
                const mainTitle = "OI";
                context.currentPage.drawText(mainTitle, {
                    x: context.margin,
                    y: context.pageHeight - context.margin,
                    font: helveticaBoldFont,
                    size: 24,
                    color: context.colors.accent
                });

                // CONSIGNE: Date en haut à droite
                const dateTitle = `DU ${getVal('date_op') || '(DATE)'}`;
                const dateTitleWidth = helveticaBoldFont.widthOfTextAtSize(dateTitle, 18);
                context.currentPage.drawText(dateTitle, {
                    x: context.pageWidth - context.margin - dateTitleWidth,
                    y: context.pageHeight - context.margin - (24 - 18) * 0.5, // Aligner verticalement avec le titre
                    font: helveticaBoldFont,
                    size: 18,
                    color: context.colors.text
                });

                context.y = context.pageHeight - context.margin - 40; // Démarrer le contenu sous le titre

                addNewPage(); // Page 2
                drawTitle("1. SITUATION");
                drawSubTitle("1.1 Situation Générale"); drawWrappedText(getVal('situation_generale'), { size: 14 });
                drawSubTitle("1.2 Situation Particulière"); drawWrappedText(getVal('situation_particuliere'), { size: 14 });

                addNewPage(); // Page 3
                drawTitle("2. ADVERSAIRE(S)");

                if (formData.adversaries && formData.adversaries.length > 0) {
                    for (let i = 0; i < formData.adversaries.length; i++) {
                        await drawAdversaryBlock(formData.adversaries[i], i);
                    }
                } else {
                    drawWrappedText("Aucun adversaire renseigné.", { size: 14, color: context.colors.danger });
                }


                addNewPage();
                drawTitle("3. ENVIRONNEMENT");
                drawSubTitle("Ami(e)s (soutien)"); drawWrappedText(getVal('amies'), { size: 14 });
                drawSubTitle("Terrain / Météo"); drawWrappedText(getVal('terrain_info'), { size: 14 });
                drawSubTitle("Population"); drawWrappedText(getVal('population'), { size: 14 });
                drawSubTitle("Cadre juridique"); drawWrappedText(getVal('cadre_juridique'), { size: 14 });

                await drawImagesFromCategory('photo_container_transport_pr_preview_container', 'Transport PSIG vers PR');
                await drawImagesFromCategory('photo_container_transport_domicile_preview_container', 'Transport PR vers Domicile/LE');
                await drawImagesFromCategory('photo_container_bapteme_terrain_preview_container', 'Baptême terrain');

                addNewPage();
                drawTitle("4. MISSION");
                drawWrappedText(getVal('missions_psig'), { font: helveticaBoldFont, size: 30, color: context.colors.danger, x: context.margin });

                addNewPage();
                drawTitle("5. EXÉCUTION");
                drawWrappedText(getVal('action_body_text'), { size: 16, x: context.margin });

                drawSubTitle("Chronologie des temps");
                const chronoHeaders = ["Type", "Heure", "Description"];
                const chronoRows = (formData.time_events || []).map(e => [e.type || 'N/A', e.hour || 'N/A', e.description || 'N/A']);
                drawTable(chronoHeaders, chronoRows, [80, 120, 550], context.margin);
                drawSubTitle("Hypothèses");
                if (formData.hypotheses && formData.hypotheses.length > 0) {
                    const hypothesesList = formData.hypotheses.filter(h => h.trim() !== '').map(h => `- ${h}`).join('\n');
                    if (hypothesesList) {
                        drawWrappedText(hypothesesList, { size: 14, font: helveticaBoldFont, color: context.colors.danger });
                    } else {
                        drawWrappedText("Aucune hypothèse.", { size: 14, color: context.colors.text });
                    }
                } else {
                    drawWrappedText("Aucune hypothèse.", { size: 14, color: context.colors.text });
                }

                addNewPage();
                drawTitle("6. ARTICULATION");
                drawWrappedText(`Place du Chef (Générale): ${getVal('place_chef')}`, { size: 14, x: context.margin });

                // ── PAGE DÉDIÉE : Ordres (Rame VL / Colonne / Pénétration) ──────────────────
                const hasRame = formData.rame_vl_order && formData.rame_vl_order.length > 0;
                const hasColonne = formData.colonne_progression_order && formData.colonne_progression_order.length > 0;
                const hasPenetration = formData.ordre_penetration_order && formData.ordre_penetration_order.length > 0;

                if (hasRame || hasColonne || hasPenetration) {
                    addNewPage();

                    // ── Titre de page ────────────────────────────────────────────────────────
                    drawTitle("ORDRES — Rame VL / Colonne de Progression / Pénétration");

                    // Paramètres généraux de la page
                    const pageW = context.pageWidth;
                    const pageH = context.pageHeight;
                    const margin = context.margin;

                    // Colonnes actives
                    const diagrams = [];
                    if (hasRame) diagrams.push({ label: "RAME VL", items: formData.rame_vl_order, color: context.colors.accent });
                    if (hasColonne) diagrams.push({ label: "COLONNE PROGRESSION", items: formData.colonne_progression_order, color: context.colors.accent });
                    if (hasPenetration) diagrams.push({ label: "PÉNÉTRATION", items: formData.ordre_penetration_order, color: context.colors.danger });

                    const nCols = diagrams.length;
                    const colGap = 20;

                    // Zone desenable (sous le titre, marge basse)
                    const drawZoneTop = context.y;           // y courant après le titre
                    const drawZoneBottom = margin + 10;
                    const drawZoneHeight = drawZoneTop - drawZoneBottom;

                    // Largeur de chaque colonne de diagramme
                    const totalColW = (pageW - 2 * margin - colGap * (nCols - 1)) / nCols;

                    // Style des boîtes
                    const boxH = 26;
                    const boxRadius = 4;
                    const arrowH = 14;
                    const labelFontSize = 11;
                    const itemFontSize = 10;
                    const posNumW = 20; // largeur du numéro de position

                    diagrams.forEach((diag, colIdx) => {
                        const nItems = diag.items.length;

                        // Calcul de l'espace disponible par item (boite + flèche), sauf dernière flèche
                        // totalHeight = nItems * boxH + (nItems-1) * arrowH
                        // On scale si ça dépasse
                        const naturalTotalH = nItems * boxH + Math.max(0, nItems - 1) * arrowH;
                        const scale = naturalTotalH > drawZoneHeight ? drawZoneHeight / naturalTotalH : 1;
                        const scaledBoxH = boxH * scale;
                        const scaledArrowH = arrowH * scale;
                        const scaledLabelFont = Math.floor(labelFontSize * scale);
                        const scaledItemFont = Math.floor(itemFontSize * scale);

                        // Calcul de la colonne X
                        const colX = margin + colIdx * (totalColW + colGap);

                        // En-tête de colonne (nom du diagramme)
                        const headerY = drawZoneTop;
                        const headerFontSz = 11;
                        const headerText = diag.label;
                        const headerW = helveticaBoldFont.widthOfTextAtSize(headerText, headerFontSz);
                        const headerX = colX + (totalColW - headerW) / 2;
                        context.currentPage.drawText(headerText, {
                            x: headerX, y: headerY - 14,
                            font: helveticaBoldFont, size: headerFontSz,
                            color: diag.color
                        });

                        // Trait sous l'en-tête
                        context.currentPage.drawLine({
                            start: { x: colX, y: headerY - 18 },
                            end: { x: colX + totalColW, y: headerY - 18 },
                            color: diag.color, thickness: 1
                        });

                        // Début des boîtes (sous l'en-tête)
                        let curY = headerY - 28;

                        diag.items.forEach((item, itemIdx) => {
                            const isLast = itemIdx === nItems - 1;

                            // Boite
                            const boxY = curY - scaledBoxH;
                            context.currentPage.drawRectangle({
                                x: colX, y: boxY,
                                width: totalColW, height: scaledBoxH,
                                color: context.colors.background,
                                borderColor: diag.color, borderWidth: 1
                            });

                            // Numéro de position (cercle à gauche)
                            const posNumFontSz = Math.max(6, scaledItemFont - 1);
                            const circleR = Math.min(8, scaledBoxH / 3);
                            const circleX = colX + circleR + 4;
                            const circleY = boxY + scaledBoxH / 2;
                            context.currentPage.drawCircle({
                                x: circleX, y: circleY, size: circleR,
                                color: diag.color
                            });
                            // Numéro dans le cercle
                            const posLabel = String(itemIdx + 1);
                            const posLW = helveticaBoldFont.widthOfTextAtSize(posLabel, posNumFontSz);
                            context.currentPage.drawText(posLabel, {
                                x: circleX - posLW / 2, y: circleY - posNumFontSz / 3,
                                font: helveticaBoldFont, size: posNumFontSz,
                                color: context.colors.background
                            });

                            // Texte du membre / VL (après le cercle)
                            const textX = colX + circleR * 2 + 8;
                            const maxTextW = totalColW - (circleR * 2 + 12);
                            const displayedItem = scaledItemFont >= 7
                                ? item
                                : item.length > 12 ? item.substring(0, 12) + '…' : item;
                            const itemW = helveticaBoldFont.widthOfTextAtSize(displayedItem, scaledItemFont);
                            context.currentPage.drawText(displayedItem, {
                                x: textX, y: boxY + (scaledBoxH - scaledItemFont) / 2,
                                font: helveticaBoldFont,
                                size: Math.max(6, scaledItemFont),
                                color: context.colors.text
                            });

                            curY = boxY; // descend sous la boîte

                            // Flèche vers la boîte suivante
                            if (!isLast) {
                                const arrowMidX = colX + totalColW / 2;
                                const arrowTopY = curY;
                                const arrowBotY = curY - scaledArrowH;

                                context.currentPage.drawLine({
                                    start: { x: arrowMidX, y: arrowTopY },
                                    end: { x: arrowMidX, y: arrowBotY + 4 },
                                    color: diag.color, thickness: 1.5
                                });
                                // Tête de flèche (triangle)
                                const aw = 5 * scale;
                                context.currentPage.drawLine({ start: { x: arrowMidX - aw, y: arrowBotY + 5 }, end: { x: arrowMidX, y: arrowBotY }, color: diag.color, thickness: 1.5 });
                                context.currentPage.drawLine({ start: { x: arrowMidX + aw, y: arrowBotY + 5 }, end: { x: arrowMidX, y: arrowBotY }, color: diag.color, thickness: 1.5 });

                                curY = arrowBotY;
                            }
                        });
                    });

                    // Le contexte y n'est plus utilisé sur cette page — laisser en bas
                    context.y = drawZoneBottom;
                }


                // Blocs MOICP dynamiques (page dédiée par bloc)
                const moicpBlocks = formData.moicp_blocks || [];
                for (let mi = 0; mi < moicpBlocks.length; mi++) {
                    const block = moicpBlocks[mi];
                    addNewPage();
                    drawTitle(`MOICP : ${block.title || 'MOICP ' + (mi + 1)}`);
                    
                    if (block.members && block.members.length > 0) {
                        drawSubTitle("Composition (ordre d'engagement):");
                        drawWrappedText(block.members.map((t, i) => `${i + 1}. ${t}`).join('\n'));
                    }

                    drawSubTitle("Mission (M):"); drawWrappedText(block.mission || '');
                    drawSubTitle("Objectif (O):"); drawWrappedText(block.objectif || '');
                    drawSubTitle("Itinéraire (I):"); drawWrappedText(block.itineraire || '');
                    drawSubTitle("Points Particuliers (P):"); drawWrappedText(block.points_particuliers || '');
                    drawSubTitle("Conduite à Tenir (C):"); drawWrappedText(block.cat || '');
                }

                // Blocs ZMSPCP dynamiques (page dédiée par bloc)
                const zmspcpBlocks = formData.zmspcp_blocks || [];
                for (let zi = 0; zi < zmspcpBlocks.length; zi++) {
                    const block = zmspcpBlocks[zi];
                    addNewPage();
                    drawTitle(`ZMSPCP : ${block.title || 'ZMSPCP ' + (zi + 1)}`);
                    
                    if (block.members && block.members.length > 0) {
                        drawSubTitle("Composition (ordre d'engagement):");
                        drawWrappedText(block.members.map((t, i) => `${i + 1}. ${t}`).join('\n'));
                    }

                    drawSubTitle("Zone d'installation (Z):"); drawWrappedText(block.zone || '');
                    drawSubTitle("Mission (M):"); drawWrappedText(block.mission || '');
                    drawSubTitle("Secteur de surveillance (S):"); drawWrappedText(block.secteur || '');
                    drawSubTitle("Points Particuliers (P):"); drawWrappedText(block.points_particuliers || '');
                    drawSubTitle("Conduite à Tenir (C):"); drawWrappedText(block.cat || '');
                    drawSubTitle("Place du Chef (P):"); drawWrappedText(block.place_chef || '');
                }

                await drawImagesFromCategory('photo_container_itineraire_exterieur_preview_container', 'Itinéraire Extérieur');
                await drawImagesFromCategory('photo_container_itineraire_interieur_preview_container', 'Itinéraire Intérieur');
                await drawImagesFromCategory('photo_container_cellule_effraction_preview_container', 'Cellule Effraction');
                await drawImagesFromCategory('photo_container_emplacement_ao_preview_container', 'Emplacement AO');

                addNewPage();
                drawTitle("7. PATRACDVR");
                // NOUVEAU: Ajout de colonne DIR dans le tableau
                const patracHeaders = ["Pax", "Fonction", "Cellule", "DIR", "Princ.", "Sec.", "A.F.I.", "Gren.", "Équip.", "Tenue", "GPB"];
                for (const row of (formData.patracdvr_rows || [])) {
                    if (row.vehicle && row.members && row.members.length > 0) {
                        drawSubTitle(`Véhicule: ${row.vehicle}`);
                        const patracRows = row.members.filter(m => m.trigramme).map(m => [
                            m.trigramme,
                            m.fonction,
                            m.cellule,
                            m.dir || '',
                            m.principales,
                            m.secondaires,
                            m.afis,
                            m.grenades,
                            `${m.equipement}, ${m.equipement2}`.replace('Sans, Sans', 'Sans').replace(', Sans', ''),
                            m.tenue,
                            m.gpb
                        ]);
                        if (patracRows.length > 0) {
                            drawTable(patracHeaders, patracRows, [50, 60, 50, 40, 60, 50, 50, 50, 70, 50, 50], context.margin);
                        }
                    }
                }

                addNewPage();
                drawTitle("9. Conduites à tenir");
                drawSubTitle("Générales"); drawWrappedText(getVal('cat_generales'), { x: context.margin, font: helveticaBoldFont });
                const noGoText = getVal('no_go');
                if (noGoText) {
                    drawSubTitle("NO GO");
                    drawWrappedText(noGoText, { x: context.margin, font: helveticaBoldFont, size: 14.4, color: context.colors.danger });
                }
                drawSubTitle("Liaison"); drawWrappedText(getVal('cat_liaison'), { x: context.margin, font: helveticaBoldFont });


                // Ajoute la page finale AVEC le fond
                addNewPage(true);

                // CONSIGNE: Le texte "Avez vous des questions?" est centré dans le premier quart supérieur de la diapo.
                const finalText = "Avez vous des questions?";
                const finalTextWidth = helveticaBoldFont.widthOfTextAtSize(finalText, 48);

                // Y: Le premier quart est de context.pageHeight à context.pageHeight * 0.75.
                // Centré sur le point Y = (Max Y + Min Y) / 2 = (height + (height * 0.75)) / 2 = height * 0.875
                const targetY = context.pageHeight * 0.75; // Ajustement visuel dans le premier quart

                context.currentPage.drawText(finalText, {
                    x: context.pageWidth / 2 - finalTextWidth / 2,
                    y: targetY,
                    font: helveticaBoldFont,
                    size: 48,
                    color: context.colors.accent
                });
            };

            await pdfCreationLogic();
            const pdfBytes = await pdfDoc.save();
            return { pdfBytes, formData };
        }

async function buildPresentationHtml() {
            saveFormData();
            // Utilisation de la clé isolée
            const formDataString = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (!formDataString) { return "<h2>Aucune donnée à présenter.</h2>"; }
            const formData = JSON.parse(formDataString);
            const getVal = (id) => formData[id] || '';
            const isDarkMode = document.body.classList.contains('dark-mode');

            const accentColor = isDarkMode ? '#5b9bd5' : '#0033a0';
            const primaryText = isDarkMode ? '#e0e0e0' : '#212529';
            const secondaryText = isDarkMode ? '#95a5a6' : '#6c757d';
            const dangerColor = '#c0392b';

            let htmlContent = `<div style="font-family: 'Oswald', sans-serif; color: ${primaryText};">`;

            const cleanText = (text) => String(text || '').replace(/\*\*(.*?)\*\*/g, '$1').trim();

            const wrapHtml = (text, tag = 'p', style = {}) => {
                const styleString = Object.entries(style).map(([key, value]) => `${key}:${value}`).join(';');
                const formattedText = String(text || '')
                    .replace(/\*\*/g, '')
                    .replace(/\n/g, '<br>');
                return `<${tag} style="${styleString}">${formattedText}</${tag}>`;
            };

            const drawTitleHtml = (text) => wrapHtml(cleanText(text), 'h2', { 'color': accentColor, 'font-size': '1.8em', 'margin-top': '20px', 'padding-bottom': '5px', 'border-bottom': `2px solid ${accentColor}` });
            const drawSubTitleHtml = (text) => wrapHtml(cleanText(text), 'h3', { 'color': accentColor, 'font-size': '1.3em', 'margin-top': '15px', 'margin-bottom': '10px' });
            const drawTextHtml = (text, bold = false, color = primaryText, size = '1.1em', indent = '15px') => wrapHtml(text, 'p', { 'font-weight': bold ? '500' : '400', 'color': color, 'font-size': size, 'margin-bottom': '8px', 'padding-left': indent, 'white-space': 'pre-wrap' });

            const drawTableHtml = (headers, rows) => {
                let table = `<table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 20px;">`;
                table += `<thead style="background-color: ${accentColor}; color: white;"><tr>`;
                headers.forEach(h => { table += `<th style="padding: 10px; border: 1px solid ${primaryText}; text-align: left;">${h}</th>`; });
                table += `</tr></thead><tbody>`;
                rows.forEach(row => {
                    table += `<tr style="background-color: ${isDarkMode ? '#2a2a2a' : '#f8f9fa'};">`;
                    row.forEach(cell => {
                        const cellContent = String(cell || '').replace(/\*\*/g, '').replace(/\n/g, '<br>');
                        table += `<td style="padding: 10px; border: 1px solid ${secondaryText}; vertical-align: top;">${cellContent}</td>`;
                    });
                    table += `</tr>`;
                });
                table += `</tbody></table>`;
                return table;
            };

            const drawImagesHtmlFromCategory = async (previewContainerId, title) => {
                let imageHtml = '';
                const imagesData = (formData.dynamic_photos || {})[previewContainerId] || [];

                for (let i = 0; i < imagesData.length; i++) {
                    const imgData = imagesData[i];
                    const annotations = JSON.parse(imgData.annotations || '[]');
                    const imageBlob = await dbManager.getItem(imgData.id);

                    if (!imageBlob) continue;

                    let finalImageBlob = imageBlob;
                    if (annotations.length > 0) {
                        try {
                            // On génère le Blob annoté
                            finalImageBlob = await createAnnotatedImageBlob(imageBlob, annotations).catch(e => imageBlob);
                        } catch (e) {
                            console.error(`Erreur de génération d'image annotée pour ${title} (index ${i}):`, e);
                        }
                    }

                    const objectURL = URL.createObjectURL(finalImageBlob);

                    const finalTitle = imagesData.length > 1 ? `${title} (${i + 1})` : title;
                    imageHtml += `<div style="text-align: center; margin: 20px 0; border: 1px solid ${accentColor}; padding: 10px; background-color: ${isDarkMode ? '#1e1e1e' : '#ffffff'};">`;
                    imageHtml += `<h4 style="color: ${accentColor}; margin-bottom: 10px; font-size: 1.1em;">${finalTitle}</h4>`;
                    // Utiliser onload pour révoquer l'URL après le chargement
                    imageHtml += `<img src="${objectURL}" alt="${finalTitle}" style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 4px 8px rgba(0,0,0,${isDarkMode ? 0.4 : 0.1});">`;
                    imageHtml += `</div>`;
                }
                return imageHtml;
            };

            const getCompositionHtml = (teamPrefix) => {
                const allMembers = (formData.patracdvr_rows || []).flatMap(row => row.members);
                const membersByCell = {};

                allMembers.forEach(member => {
                    const cellule = member.cellule;
                    if (cellule && cellule.toLowerCase().startsWith(teamPrefix) && member.trigramme) {
                        if (!membersByCell[cellule]) membersByCell[cellule] = [];
                        membersByCell[cellule].push(member);
                    }
                });

                const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                const sortedKeys = Object.keys(membersByCell).sort(naturalSort);

                let compositionHtml = '<div style="padding-left: 15px; margin-bottom: 15px;">';
                sortedKeys.forEach(cell => {
                    const memberList = membersByCell[cell].map(m => {
                        const func = m.fonction && m.fonction !== 'Sans' ? ` (${m.fonction})` : '';
                        return `<span style="color:${primaryText}; font-weight:600;">${m.trigramme}${func}</span>`;
                    }).join(' • ');
                    compositionHtml += `<p style="margin-bottom: 5px;"><strong style="color: ${dangerColor}; font-size: 1.1em;">${cell.toUpperCase()}</strong> : ${memberList}</p>`;
                });
                compositionHtml += '</div>';
                return sortedKeys.length > 0 ? compositionHtml : drawTextHtml('Aucun membre assigné.', false, secondaryText);
            };

            const drawAdversaryBlockHtml = async (adv, index) => {
                const advName = adv.nom_adversaire || `Adversaire ${index + 1}`;

                let blockHtml = `<div style="margin-bottom: 30px; border-bottom: 1px dashed ${secondaryText}; padding-bottom: 20px;">`;
                blockHtml += drawSubTitleHtml(`ADVERSAIRE (OBJECTIF ${index + 1}) : ${advName}`);

                const mainPhotoContainerId = `photo_main_${adv.id}`;
                const extraPhotoContainerId = `photo_extra_${adv.id}`;

                // Photo principale
                let mainImageMeta = null;
                if (formData.dynamic_photos && formData.dynamic_photos[mainPhotoContainerId]) {
                    mainImageMeta = formData.dynamic_photos[mainPhotoContainerId][0];
                }

                if (mainImageMeta) {
                    const imageBlob = await dbManager.getItem(mainImageMeta.id);
                    if (imageBlob) {
                        let finalImageBlob = imageBlob;
                        const annotations = JSON.parse(mainImageMeta.annotations || '[]');
                        if (annotations.length > 0) {
                            finalImageBlob = await createAnnotatedImageBlob(imageBlob, annotations).catch(e => imageBlob);
                        }
                        const objectURL = URL.createObjectURL(finalImageBlob);

                        blockHtml += `<div style="text-align: center; margin-bottom: 15px;">
                                                <h4 style="color:${accentColor}; margin-bottom: 5px;">Photo Principale</h4>
                                                <img src="${objectURL}" alt="Photo de l'objectif ${index + 1}" style="max-height: 250px; width: auto; border-radius: 4px;">
                                              </div>`;
                    }
                }

                const meText = (adv.me_list || []).map((me, i) => `ME${i + 1}: ${me}`).join(' | ');
                const adversaireRows = [
                    ['Nom/Prénom', advName],
                    ['Domicile', adv.domicile_adversaire],
                    ['Naissance', `${adv.date_naissance || ''} à ${adv.lieu_naissance || ''}`],
                    ['Description', `${adv.stature_adversaire || ''} / ${adv.ethnie_adversaire || ''}`],
                    ['Signes particuliers', adv.signes_particuliers],
                    ['Profession', adv.profession_adversaire],
                    ['Antécédents', adv.antecedents_adversaire],
                    ['État d\'esprit', (adv.etat_esprit_list || []).join(', ')],
                    ['Attitude (connue)', adv.attitude_adversaire],
                    ['Volume (renfort)', (adv.volume_list || []).join(', ')],
                    ['Substances', adv.substances_adversaire],
                    ['Véhicules', (adv.vehicules_list || []).join(', ')],
                    ['Armes connues', adv.armes_connues],
                    ['Moyens Employés', meText],
                ].filter(row => row[1] && String(row[1]).trim() !== 'à' && String(row[1]).trim() !== 'N/A' && String(row[1]).trim() !== '');

                if (adversaireRows.length > 0) {
                    blockHtml += drawTableHtml(["Information", "Détail"], adversaireRows);
                } else {
                    blockHtml += drawTextHtml("Aucune information détaillée sur cet adversaire.", false, secondaryText);
                }

                blockHtml += await drawImagesHtmlFromCategory(extraPhotoContainerId, `Photos Supplémentaires ${index + 1}`);

                blockHtml += `</div>`;
                return blockHtml;
            };




            htmlContent += drawTitleHtml(`Ordre Initial - ${getVal('nom_adversaire') || 'OPÉRATION'}`);
            htmlContent += drawTextHtml(`Date de l'opération : ${getVal('date_op') || 'N/A'}`, true, primaryText, '1.2em', '0');
            htmlContent += drawTitleHtml("1. SITUATION");
            htmlContent += drawSubTitleHtml("1.1 Situation Générale"); htmlContent += drawTextHtml(getVal('situation_generale'));
            htmlContent += drawSubTitleHtml("1.2 Situation Particulière"); htmlContent += drawTextHtml(getVal('situation_particuliere'));

            htmlContent += drawTitleHtml("2. ADVERSAIRE(S)");

            if (formData.adversaries && formData.adversaries.length > 0) {
                for (let i = 0; i < formData.adversaries.length; i++) {
                    htmlContent += await drawAdversaryBlockHtml(formData.adversaries[i], i);
                }
            } else {
                htmlContent += drawTextHtml("Aucun adversaire renseigné.", true, dangerColor);
            }

            htmlContent += await drawImagesHtmlFromCategory('renforts_photo_preview_container', 'Photos - Renforts Potentiels (Partagé)');

            htmlContent += drawTitleHtml("3. ENVIRONNEMENT");
            htmlContent += drawSubTitleHtml("Ami(e)s (soutien)"); htmlContent += drawTextHtml(getVal('amies'));
            htmlContent += drawSubTitleHtml("Terrain / Météo"); htmlContent += drawTextHtml(getVal('terrain_info'));
            htmlContent += drawSubTitleHtml("Population"); htmlContent += drawTextHtml(getVal('population'));
            htmlContent += drawSubTitleHtml("Cadre juridique"); htmlContent += drawTextHtml(getVal('cadre_juridique'));

            htmlContent += drawTitleHtml("4. MISSION DU PSIG");
            htmlContent += drawTextHtml(getVal('missions_psig'), true, dangerColor, '1.6em', '0');

            htmlContent += drawTitleHtml("5. EXÉCUTION");
            htmlContent += drawTextHtml(getVal('action_body_text'), true, primaryText, '1.4em', '0');

            htmlContent += drawSubTitleHtml("Chronologie des temps");
            const chronoHeaders = ["Type", "Heure", "Description"];
            const chronoRows = (formData.time_events || []).map(e => [e.type || 'N/A', e.hour || 'N/A', e.description || 'N/A']);
            htmlContent += drawTableHtml(chronoHeaders, chronoRows);

            htmlContent += drawSubTitleHtml("Hypothèses");
            if (formData.hypotheses && formData.hypotheses.length > 0) {
                const hypList = formData.hypotheses.filter(h => h.trim() !== '').map(h => `<li>${h}</li>`).join('');
                if (hypList) {
                    htmlContent += `<ul style="padding-left: 20px; font-size: 1.2em; color: ${primaryText};">${hypList}</ul>`;
                } else {
                    htmlContent += drawTextHtml("Aucune hypothèse.", false, secondaryText);
                }
            } else {
                 htmlContent += drawTextHtml("Aucune hypothèse.", false, secondaryText);
            }

            htmlContent += await drawImagesHtmlFromCategory('photo_container_transport_pr_preview_container', 'Transport PSIG vers PR');
            htmlContent += await drawImagesHtmlFromCategory('photo_container_transport_domicile_preview_container', 'Transport PR vers Domicile/LE');
            htmlContent += await drawImagesHtmlFromCategory('photo_container_bapteme_terrain_preview_container', 'Baptême terrain');

            htmlContent += drawTitleHtml("6. ARTICULATION (MOIPC/ZMSPCP)");
            htmlContent += drawTextHtml(`Place du Chef (Générale): ${getVal('place_chef')}`, true, primaryText, '1.2em', '0');

            // Ordre de la rame VL
            if (formData.rame_vl_order && formData.rame_vl_order.length > 0) {
                htmlContent += drawSubTitleHtml("Ordre de la rame VL");
                const rameList = formData.rame_vl_order.map((v, i) => `<li><strong>${i + 1}.</strong> ${v}</li>`).join('');
                htmlContent += `<ol style="padding-left: 20px; font-size: 1.1em; color: ${primaryText};">${rameList}</ol>`;
            }

            // Ordre colonne de progression
            if (formData.colonne_progression_order && formData.colonne_progression_order.length > 0) {
                htmlContent += drawSubTitleHtml("Ordre de la colonne de progression");
                const colonneList = formData.colonne_progression_order.map((t, i) => `<li><strong>${i + 1}.</strong> ${t}</li>`).join('');
                htmlContent += `<ol style="padding-left: 20px; font-size: 1.1em; color: ${primaryText};">${colonneList}</ol>`;
            }

            // Ordre de pénétration
            if (formData.ordre_penetration_order && formData.ordre_penetration_order.length > 0) {
                htmlContent += drawSubTitleHtml("Ordre de pénétration");
                const penList = formData.ordre_penetration_order.map((t, i) => `<li><strong>${i + 1}.</strong> ${t}</li>`).join('');
                htmlContent += `<ol style="padding-left: 20px; font-size: 1.1em; color: ${primaryText};">${penList}</ol>`;
            }

            // Blocs MOICP dynamiques
            const moicpBlocksHtml = formData.moicp_blocks || [];
            for (let mi = 0; mi < moicpBlocksHtml.length; mi++) {
                const block = moicpBlocksHtml[mi];
                htmlContent += drawTitleHtml(`MOICP : ${block.title || 'MOICP ' + (mi + 1)}`);
                
                if (block.members && block.members.length > 0) {
                    htmlContent += wrapHtml('<strong style="color: ' + accentColor + ';">Composition (ordre d\'engagement) :</strong>', 'h4', { 'padding-left': '15px', 'margin-top': '10px', 'font-size': '1.1em' });
                    const memberList = block.members.map((t, i) => `<span style="color:${primaryText}; font-weight:600;">${i + 1}. ${t}</span>`).join(' • ');
                    htmlContent += `<p style="padding-left: 15px; margin-bottom: 10px;">${memberList}</p>`;
                }

                const moipcText = `<p style="padding-left:15px; margin-bottom: 8px;">
                    <span style="color: ${dangerColor}; font-weight: bold;">M</span>ission : ${block.mission || ''}<br>
                    <span style="color: ${dangerColor}; font-weight: bold;">O</span>bjectif : ${block.objectif || ''}<br>
                    <span style="color: ${dangerColor}; font-weight: bold;">I</span>tinéraire : ${block.itineraire || ''}<br>
                    <span style="color: ${dangerColor}; font-weight: bold;">P</span>oints Particuliers : ${block.points_particuliers || ''}<br>
                    <span style="color: ${dangerColor}; font-weight: bold;">C</span>onduite à Tenir : ${block.cat || ''}
                </p>`;
                htmlContent += moipcText;
            }

            // Blocs ZMSPCP dynamiques
            const zmspcpBlocksHtml = formData.zmspcp_blocks || [];
            for (let zi = 0; zi < zmspcpBlocksHtml.length; zi++) {
                const block = zmspcpBlocksHtml[zi];
                htmlContent += drawTitleHtml(`ZMSPCP : ${block.title || 'ZMSPCP ' + (zi + 1)}`);
                
                if (block.members && block.members.length > 0) {
                    htmlContent += wrapHtml('<strong style="color: ' + accentColor + ';">Composition (ordre d\'engagement) :</strong>', 'h4', { 'padding-left': '15px', 'margin-top': '10px', 'font-size': '1.1em' });
                    const memberList = block.members.map((t, i) => `<span style="color:${primaryText}; font-weight:600;">${i + 1}. ${t}</span>`).join(' • ');
                    htmlContent += `<p style="padding-left: 15px; margin-bottom: 10px;">${memberList}</p>`;
                }

                const zmText = `<p style="padding-left:15px; margin-bottom: 8px;">
                    <span style="color: ${dangerColor}; font-weight: bold;">Z</span>one d'installation : ${block.zone || ''}<br>
                    <span style="color: ${dangerColor}; font-weight: bold;">M</span>ission : ${block.mission || ''}<br>
                    <span style="color: ${dangerColor}; font-weight: bold;">S</span>ecteur de surveillance : ${block.secteur || ''}<br>
                    <span style="color: ${dangerColor}; font-weight: bold;">P</span>oints Particuliers : ${block.points_particuliers || ''}<br>
                    <span style="color: ${dangerColor}; font-weight: bold;">C</span>onduite à Tenir : ${block.cat || ''}<br>
                    <span style="color: ${dangerColor}; font-weight: bold;">P</span>lace du Chef : ${block.place_chef || ''}
                </p>`;
                htmlContent += zmText;
            }

            htmlContent += await drawImagesHtmlFromCategory('photo_container_itineraire_exterieur_preview_container', 'Itinéraire Extérieur');
            htmlContent += await drawImagesHtmlFromCategory('photo_container_itineraire_interieur_preview_container', 'Itinéraire Intérieur');
            htmlContent += await drawImagesHtmlFromCategory('photo_container_cellule_effraction_preview_container', 'Cellule Effraction');
            htmlContent += await drawImagesHtmlFromCategory('photo_container_emplacement_ao_preview_container', 'Emplacement AO');

            htmlContent += drawTitleHtml("7. PATRACDVR (Détail de la Composition)");
            const patracHeaders = ["Trigramme", "Fonction", "Cellule", "DIR", "Princ.", "Sec.", "A.F.I.", "Grenades", "Équip.", "Tenue", "GPB"];
            for (const row of (formData.patracdvr_rows || [])) {
                if (row.vehicle && row.members && row.members.length > 0) {
                    htmlContent += drawSubTitleHtml(`Véhicule: ${row.vehicle}`);
                    const patracRows = row.members.filter(m => m.trigramme).map(m => [
                        m.trigramme,
                        m.fonction,
                        m.cellule,
                        m.dir || '',
                        m.principales, m.secondaires, m.afis, m.grenades,
                        `${m.equipement}, ${m.equipement2}`.replace('Sans, Sans', 'Sans').replace(', Sans', ''),
                        m.tenue, m.gpb
                    ]);
                    if (patracRows.length > 0) { htmlContent += drawTableHtml(patracHeaders, patracRows); }
                }
            }

            htmlContent += drawTitleHtml("9. CONDUITES À TENIR");
            htmlContent += drawSubTitleHtml("Générales"); htmlContent += drawTextHtml(getVal('cat_generales'), true);
            const noGoText = getVal('no_go');
            if (noGoText) {
                htmlContent += drawSubTitleHtml("NO GO");
                htmlContent += drawTextHtml(noGoText, true, dangerColor, '1.2em');
            }
            htmlContent += drawSubTitleHtml("Liaison"); htmlContent += drawTextHtml(getVal('cat_liaison'), true);

            htmlContent += `</div>`;
            return htmlContent;
        }
