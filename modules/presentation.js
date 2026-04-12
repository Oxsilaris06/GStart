// --- GLOBAL EXPOSURE ---
window.openPresentationMode = openPresentationMode;
window.downloadOiPdf = downloadOiPdf;

function openPresentationMode() {
    const presentationContent = document.getElementById('presentation-content');
    const presentationModal = document.getElementById('presentationModal');

    if (!presentationModal) {
        console.error("Modale 'presentationModal' non trouvée.");
        return;
    }

    if (!checkCoherence()) {
        alert("Attention: Des incohérences ont été détectées. Veuillez les vérifier dans la section Finalisation avant de générer.");
    }

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
        const dangerColor = '#c0392b';
        presentationContent.innerHTML = '<h2>Erreur d\'affichage</h2><p style="color:' + dangerColor + ';">Une erreur est survenue lors de la compilation des images annotées pour l\'aperçu. Réessayez ou vérifiez la console.</p>';
    }).finally(() => {
        document.body.style.cursor = 'default';
    });
}
async function buildPresentationHtml() {
    Store.saveToStorage();
    // Utilisation de la clé isolée
    const formDataString = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!formDataString) { return "<h2>Aucune donnée à présenter.</h2>"; }
    Store.state.formData = JSON.parse(formDataString);
    const getVal = (id) => Store.state.formData[id] || '';
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
        const imagesData = (Store.state.formData.dynamic_photos || {})[previewContainerId] || [];

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
        const allMembers = (Store.state.formData.patracdvr_rows || []).flatMap(row => row.members);
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
        if (Store.state.formData.dynamic_photos && Store.state.formData.dynamic_photos[mainPhotoContainerId]) {
            mainImageMeta = Store.state.formData.dynamic_photos[mainPhotoContainerId][0];
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

    if (Store.state.formData.adversaries && Store.state.formData.adversaries.length > 0) {
        for (let i = 0; i < Store.state.formData.adversaries.length; i++) {
            htmlContent += await drawAdversaryBlockHtml(Store.state.formData.adversaries[i], i);
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
    const chronoRows = (Store.state.formData.time_events || []).map(e => [e.type || 'N/A', e.hour || 'N/A', e.description || 'N/A']);
    htmlContent += drawTableHtml(chronoHeaders, chronoRows);

    htmlContent += drawSubTitleHtml("Hypothèses");
    if (Store.state.formData.hypotheses && Store.state.formData.hypotheses.length > 0) {
        const hypList = Store.state.formData.hypotheses.filter(h => h.trim() !== '').map(h => `<li>${h}</li>`).join('');
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
    if (Store.state.formData.rame_vl_order && Store.state.formData.rame_vl_order.length > 0) {
        htmlContent += drawSubTitleHtml("Ordre de la rame VL");
        const rameList = Store.state.formData.rame_vl_order.map((v, i) => `<li><strong>${i + 1}.</strong> ${v}</li>`).join('');
        htmlContent += `<ol style="padding-left: 20px; font-size: 1.1em; color: ${primaryText};">${rameList}</ol>`;
    }

    // Ordre colonne de progression
    if (Store.state.formData.colonne_progression_order && Store.state.formData.colonne_progression_order.length > 0) {
        htmlContent += drawSubTitleHtml("Ordre de la colonne de progression");
        const colonneList = Store.state.formData.colonne_progression_order.map((t, i) => `<li><strong>${i + 1}.</strong> ${t}</li>`).join('');
        htmlContent += `<ol style="padding-left: 20px; font-size: 1.1em; color: ${primaryText};">${colonneList}</ol>`;
    }

    // Ordre de pénétration
    if (Store.state.formData.ordre_penetration_order && Store.state.formData.ordre_penetration_order.length > 0) {
        htmlContent += drawSubTitleHtml("Ordre de pénétration");
        const penList = Store.state.formData.ordre_penetration_order.map((t, i) => `<li><strong>${i + 1}.</strong> ${t}</li>`).join('');
        htmlContent += `<ol style="padding-left: 20px; font-size: 1.1em; color: ${primaryText};">${penList}</ol>`;
    }

    // Blocs MOICP dynamiques
    const moicpBlocksHtml = Store.state.formData.moicp_blocks || [];
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
    const zmspcpBlocksHtml = Store.state.formData.zmspcp_blocks || [];
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
    htmlContent += await drawImagesHtmlFromCategory('photo_container_emplacement_ao_preview_container', 'Emplacement AO');

    // Blocs Cellule Effraction dynamiques
    const effracBlocksHtml = Store.state.formData.effraction_blocks || [];
    if (effracBlocksHtml.length > 0) {
        htmlContent += drawTitleHtml("7. CELLULE EFFRACTION");
        for (let ei = 0; ei < effracBlocksHtml.length; ei++) {
            const block = effracBlocksHtml[ei];
            htmlContent += drawSubTitleHtml(block.title || `Effraction ${ei + 1}`);

            if (block.members && block.members.length > 0) {
                htmlContent += wrapHtml('<strong style="color: ' + accentColor + ';">Composition :</strong>', 'h4', { 'padding-left': '15px', 'margin-top': '10px', 'font-size': '1.1em' });
                const memberList = block.members.map((t, i) => `<span style="color:${primaryText}; font-weight:600;">${t}</span>`).join(' - ');
                htmlContent += `<p style="padding-left: 15px; margin-bottom: 10px;">${memberList}</p>`;
            }
            if (block.mission) {
                htmlContent += wrapHtml('<strong style="color: ' + accentColor + ';">Mission :</strong>', 'h4', { 'padding-left': '15px', 'margin-top': '10px', 'font-size': '1.1em' });
                htmlContent += drawTextHtml(block.mission, true, dangerColor);
            }

            const effracPhotosRaw = ((Store.state.formData.dynamic_photos || {})[`photo_effrac_${block.id}`] || []);

            const effracHeaders = ['Champ', 'Détail'];
            const effracRows = [
                ['Type porte', block.porte],
                ['Structure & Dormant', block.structure],
                ['Serrurerie', block.serrurerie],
                ['Environnement immédiat', block.environnement],
                ['Dimensions (L / l / H)', `L: ${block.l || 0}cm | l: ${block.w || 0}cm | H: ${block.h || 0}cm`]
            ].filter(row => row[1]);

            // Container Flex pour Photo Principale + Renseignements
            htmlContent += `<div style="display: flex; flex-wrap: wrap; gap: 20px; align-items: stretch; margin-top: 15px; margin-bottom: 20px;">`;

            // Partie Texte / Tableau (2/3)
            htmlContent += `<div style="flex: 2; min-width: 300px;">`;
            if (effracRows.length > 0) {
                htmlContent += drawTableHtml(effracHeaders, effracRows);
            }
            htmlContent += `</div>`;

            // Partie Photo Principale (1/3)
            if (effracPhotosRaw.length > 0 && effracPhotosRaw[0].dataURL) {
                htmlContent += `<div style="flex: 1; min-width: 200px; display: flex; flex-direction: column; align-items: center; border: 1px solid ${accentColor}; padding: 10px; border-radius: 8px;">`;
                htmlContent += `<img src="${effracPhotosRaw[0].dataURL}" style="max-width: 100%; max-height: 300px; border-radius: 4px; object-fit: contain;">`;
                htmlContent += `<p style="font-size: 0.9em; margin-top: 8px; font-style: italic; color: ${secondaryText}; text-align: center;">Photo Principale</p>`;
                htmlContent += `</div>`;
            }
            htmlContent += `</div>`; // Fin Container Flex

            if (block.hypotheses && block.hypotheses.length > 0) {
                htmlContent += drawSubTitleHtml(`Hypothèses d'effraction`);
                for (let hIdx = 0; hIdx < block.hypotheses.length; hIdx++) {
                    const hyp = block.hypotheses[hIdx];
                    htmlContent += wrapHtml(`<strong>${hyp.title || 'Hypothèse ' + (hIdx + 1)}:</strong> ${hyp.desc || ''}`, 'p', { 'color': dangerColor, 'padding-left': '15px' });

                    htmlContent += `<div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: stretch; margin-top: 10px; margin-bottom: 20px; padding-left: 15px;">`;
                    const phases = [
                        { title: 'Effraction', text: hyp.effrac || '' },
                        { title: 'Dégagement', text: hyp.degag || '' },
                        { title: 'Assaut', text: hyp.assaut || '' }
                    ];
                    phases.forEach((ph, pIdx) => {
                        htmlContent += `<div style="flex: 1; min-width: 120px; border: 1px solid #d4af37; border-radius: 4px; background: #fafafa; padding: 10px; position: relative;">`;
                        htmlContent += `<h5 style="color: #d4af37; margin: 0 0 5px 0;">${ph.title}</h5>`;
                        htmlContent += `<p style="font-size: 0.85em; margin: 0; color: ${primaryText};">${ph.text.replace(/\n/g, '<br>')}</p>`;
                        if (pIdx < 2) {
                            htmlContent += `<div style="position: absolute; right: -15px; top: 50%; transform: translateY(-50%); color: #d4af37; z-index: 10;">&#10148;</div>`;
                        }
                        htmlContent += `</div>`;
                    });
                    htmlContent += `</div>`;
                }
            }

            const extraPhotos = effracPhotosRaw.slice(1);
            if (extraPhotos.length > 0) {
                htmlContent += drawSubTitleHtml("Photos supplémentaires");
                htmlContent += `<div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 10px;">`;
                for (const photo of extraPhotos) {
                    if (photo.dataURL) {
                        htmlContent += `<div style="text-align: center;">`;
                        htmlContent += `<img src="${photo.dataURL}" style="max-height: 250px; border-radius: 8px; border: 1px solid ${accentColor};">`;
                        htmlContent += `<p style="font-size: 0.9em; margin-top: 5px; color: ${secondaryText};">Objets préconisés : ${photo.tools ? JSON.parse(photo.tools).join(', ') : 'Aucun'}</p>`;
                        htmlContent += `</div>`;
                    }
                }
                htmlContent += `</div>`;
            }
        }
    }

    htmlContent += drawTitleHtml("7. PATRACDVR (Détail de la Composition)");
    const patracHeaders = ["Trigramme", "Fonction", "Cellule", "DIR", "Princ.", "Sec.", "A.F.I.", "Grenades", "Équip.", "Tenue", "GPB"];
    for (const row of (Store.state.formData.patracdvr_rows || [])) {
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

// ==================== PdfRenderer.js ====================







// Utilisation du dbManager global (init.js)
// const dbManager = new DBManager();

async function downloadOiPdf() {
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    if (typeof PDFLib === 'undefined') { alert("Erreur: La bibliothèque PDF n'est pas encore chargée."); return; }
    const btn = downloadPdfBtn;
    if (!btn) return;

    const originalText = btn.textContent;
    btn.textContent = 'Génération en cours...'; btn.disabled = true;

    try {
        const result = await buildPdf();
        if (!result) {
            alert("La génération a échoué. Vérifiez vos données.");
            return;
        }
        const { pdfBytes } = result;
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const getVal = (id) => Store.state.formData[id] || 'RAS';

        const link = document.createElement('a');
        const firstAdv = Store.state.formData.adversaries && Store.state.formData.adversaries[0] ? Store.state.formData.adversaries[0].nom_adversaire : '';
        let fileName = `OI_${getVal('date_op').replace(/[\/\\?%*:|"<>]/g, '-')}_${(firstAdv || 'OPÉRATION').replace(/ /g, '_')}`;
        if (Store.state.formData.adversaries && Store.state.formData.adversaries.length > 1) {
            fileName += `_et_${Store.state.formData.adversaries.length - 1}_autres`;
        }
        link.download = `${fileName}.pdf`;
        link.href = url;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Erreur critique lors de la génération du PDF:", error);
        alert("Une erreur critique est survenue lors de la génération du PDF. Consultez la console (F12).");
    } finally {
        btn.textContent = originalText; btn.disabled = false;
    }
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

    Store.saveToStorage();
    // Utilisation de la clé isolée
    const formDataString = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!formDataString) { console.error("Aucune donnée à générer."); return null; }
    Store.state.formData = JSON.parse(formDataString);

    // --- Section de Compression Dynamique et de Chargement des Images ---
    const PDF_TARGET_SIZE_BYTES = 2.5 * 1024 * 1024;
    const TEXT_OVERHEAD_ESTIMATE = 150 * 1024;

    const allImagesMeta = [];
    if (Store.state.formData.dynamic_photos) {
        for (const category in Store.state.formData.dynamic_photos) {
            Store.state.formData.dynamic_photos[category].forEach(imgMeta => allImagesMeta.push(imgMeta));
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
                    // Créer l'image annotée si des Store.state.annotations existent
                    const annotations = JSON.parse(imgMeta.annotations || '[]');
                    if (annotations.length > 0) {
                        try {
                            blobToCompress = await createAnnotatedImageBlob(originalBlob, annotations);
                        } catch (e) {
                            console.error(`Erreur annotation image ${imgMeta.id}, fallback original:`, e);
                            blobToCompress = originalBlob;
                        }
                    }

                    compressedBuffer = await compressImage(blobToCompress, quality);
                }

                return { id: imgMeta.id, buffer: compressedBuffer };
            });

            const results = await Promise.all(compressionPromises);

            Store.state.compressedImages = {};
            for (const result of results) {
                if (result.buffer) {
                    Store.state.compressedImages[result.id] = result.buffer;
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

    const getVal = (id) => Store.state.formData[id] || '';
    const dashShow = (v) => (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== 'à') ? String(v) : '—';
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
    if (Store.state.compressedImages[bgImageIdToUse]) {
        try {
            const imageBytes = Store.state.compressedImages[bgImageIdToUse];
            backgroundImage = await embedPdfImageFromBytes(pdfDoc, imageBytes);
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
    };
    
    /**
     * Nettoie le texte pour éviter l'erreur "WinAnsi cannot encode" dans pdf-lib.
     * Remplace les flèches Unicode par des équivalents standards et supprime les caractères exotiques.
     */
    const sanitizeText = (text) => {
        if (!text) return '';
        return String(text)
            .replace(/→/g, '->')
            .replace(/–/g, '-') // en dash
            .replace(/—/g, '-') // em dash
            .replace(/[\u2018\u2019]/g, "'") // smart quotes
            .replace(/[\u201C\u201D]/g, '"') // smart doubles
            // Nettoyage final pour ne garder que le WinAnsi printable (approximatif)
            .replace(/[^\x00-\x7F\xA0-\xFF]/g, '?'); 
    };

    const drawTitle = (text) => { checkY(30); context.currentPage.drawText(sanitizeText(text), { x: context.margin, y: context.y, font: helveticaBoldFont, size: 18, color: context.colors.accent }); context.y -= 30; };
    const drawSubTitle = (text) => { if (checkY(25)) { context.y -= 10; } context.currentPage.drawText(sanitizeText(text), { x: context.margin, y: context.y, font: helveticaBoldFont, size: 14, color: context.colors.accent }); context.y -= 25; };
    const wrapText = (text, font, size, maxWidth) => {
        const clean = sanitizeText(text);
        const words = String(clean || '').replace(/\n/g, ' \n ').split(' ');
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
        lines.forEach((line, index) => { context.currentPage.drawText(sanitizeText(line), { x, y: context.y - (index * (size + 4)), font, size, color }); });
        context.y -= (totalHeight + 10);
    };
    // drawTable — auto-scaling : colProportions = tableau de poids relatifs
    // maxWidth (opt.) : largeur disponible en pts ; défaut = page - 2*margin depuis startX
    const drawTable = (headers, rows, colProportions, startX, maxWidth) => {
        const availW = maxWidth !== undefined ? maxWidth : (context.pageWidth - startX - context.margin);
        const sum = colProportions.reduce((a, b) => a + b, 0);
        const columnWidths = colProportions.map(p => (p / sum) * availW);

        let currentY = context.y;
        const rowPadding = 4;
        const headerFontSize = 9;
        const contentFontSize = 9;

        const drawRow = (rowData, isHeader) => {
            const font = isHeader ? helveticaBoldFont : helveticaFont;
            const size = isHeader ? headerFontSize : contentFontSize;
            const lineHeight = size + 2; // Synchronisé pour éviter les dépassements
            const cellContents = rowData.map((text, i) =>
                wrapText(String(text ?? ''), font, size, columnWidths[i] - 2 * rowPadding));
            const maxLines = Math.max(...cellContents.map(l => l.length));
            const rowHeight = maxLines * lineHeight + 2 * rowPadding;

            if (currentY - rowHeight < context.margin) {
                addNewPage();
                currentY = context.y;
                // Ne pas appeler drawRow(headers, true) récursivement s'il l'on dessine déjà un en-tête !
                if (!isHeader) drawRow(headers, true);
            }

            currentY -= rowHeight;
            let currentX = startX;
            rowData.forEach((_, i) => {
                context.currentPage.drawRectangle({
                    x: currentX, y: currentY,
                    width: columnWidths[i], height: rowHeight,
                    borderColor: context.colors.accent, borderWidth: 0.5
                });
                cellContents[i].forEach((line, li) => {
                    context.currentPage.drawText(line, {
                        x: currentX + rowPadding,
                        // Positionnement vertical précis pour éviter le chevauchement
                        y: currentY + rowHeight - rowPadding - (li + 1) * lineHeight + 2,
                        font, size, color: context.colors.text
                    });
                });
                currentX += columnWidths[i];
            });
        };
        drawRow(headers, true);
        rows.forEach(row => drawRow(row, false));
        context.y = currentY - 15;
    };

    /**
     * Dessine des images groupées (2 par page)
     */
    const drawGroupedImages = async (photosOrId, categoryTitle, options = {}) => {
        const photos = Array.isArray(photosOrId) ? photosOrId : (Store.state.formData.dynamic_photos || {})[photosOrId];
        if (!photos || photos.length === 0) return;

        // On boucle pour traiter les photos (maximum 2 par page)
        for (let i = 0; i < photos.length;) {
            let photosOnThisPage;
            let isSingleLayout = false;
            const forceSingle = options.forceSingle || false;
            const startOnCurrentPage = options.startOnCurrentPage || false;

            // Si forceSingle est vrai, on ne prend qu'une photo
            // Sinon, si c'est la dernière photo ET qu'elle est seule sur sa ligne/page
            if (forceSingle || i === photos.length - 1) {
                photosOnThisPage = [photos[i]];
                isSingleLayout = true;
                i += 1;
            } else {
                photosOnThisPage = photos.slice(i, i + 2);
                isSingleLayout = false;
                i += 2;
            }

            // On vérifie qu'au moins une photo de ce groupe possède des données
            const hasData = photosOnThisPage.some(p => Store.state.compressedImages[p.id]);
            if (!hasData) continue;

            // On n'ajoute pas de nouvelle page si l'on souhaite commencer sur la page actuelle (pour la première itération)
            if (i > (forceSingle ? 1 : 2) || !startOnCurrentPage) {
                addNewPage();
            }

            for (let j = 0; j < photosOnThisPage.length; j++) {
                const imgData = photosOnThisPage[j];
                try {
                    const imageBytes = Store.state.compressedImages[imgData.id];
                    if (!imageBytes) continue;

                    const image = await embedPdfImageFromBytes(pdfDoc, imageBytes);

                    const { width: pageW, height: pageH } = context.currentPage.getSize();
                    const availableW = isSingleLayout ? (pageW - context.margin * 2) : (pageW - context.margin * 3.5) / 2;
                    // On vise environ 90% de la hauteur disponible
                    const availableH = (pageH - context.margin * 2 - 80) * 0.95; 

                    const scaled = image.scaleToFit(availableW, availableH);
                    const x = isSingleLayout
                        ? context.margin + (availableW - scaled.width) / 2
                        : context.margin + j * (availableW + context.margin * 1.5) + (availableW - scaled.width) / 2;
                    const y = context.margin + (availableH - scaled.height) / 2 + 50;

                    context.currentPage.drawImage(image, { x, y, width: scaled.width, height: scaled.height });

                    // Titre sous la photo
                    const currentTitle = imgData.customTitle || categoryTitle;
                    const photoIndex = i + j + 1;
                    const titleText = photos.length > 1 ? `${currentTitle} (${photoIndex}/${photos.length})` : currentTitle;
                    const titleSize = 10;
                    const titleW = helveticaBoldFont.widthOfTextAtSize(titleText, titleSize);
                    const textX = forceSingle
                        ? context.margin + (availableW - titleW) / 2
                        : context.margin + j * (availableW + context.margin * 1.5) + (availableW - titleW) / 2;

                    context.currentPage.drawText(titleText, {
                        x: textX,
                        y: y - 15,
                        font: helveticaBoldFont,
                        size: titleSize,
                        color: context.colors.text
                    });

                    // --- Dessin des outils pour l'effraction ---
                    if (imgData.isEffrac) {
                        const tools = JSON.parse(imgData.tools || '[]');
                        const other = imgData.other_tools || '';
                        if (tools.length > 0 || other) {
                            // Chip sous le titre (y-15 est pour le texte, donc y-35 et moins pour les chips)
                            await drawToolChips(tools, other,
                                isSingleLayout ? context.margin : context.margin + j * (availableW + context.margin * 1.5),
                                y - 35,
                                availableW);
                        }
                    }

                } catch (e) {
                    console.error(`Erreur d'intégration image: ${categoryTitle}`, e);
                }
            }
        }
    };

    const drawToolChips = async (tools, other, startX, startY, maxWidth) => {
        const chipH = 16;
        const chipPadding = 6;
        const fontSize = 8;
        const goldColor = rgb(212 / 255, 175 / 255, 55 / 255);

        // 1. Préparer tous les chips (texte + largeur)
        const allChips = [];
        tools.forEach(t => {
            const tw = helveticaBoldFont.widthOfTextAtSize(t, fontSize);
            allChips.push({ text: t, w: tw + chipPadding * 2, color: goldColor });
        });
        if (other) {
            other.split(',').map(s => s.trim()).filter(Boolean).forEach(t => {
                const tw = helveticaBoldFont.widthOfTextAtSize(t, fontSize);
                allChips.push({ text: t, w: tw + chipPadding * 2, color: rgb(0.3, 0.3, 0.3) });
            });
        }

        // 2. Répartir en lignes pour le centrage
        const rows = [];
        let currentRow = [];
        let currentRowW = 0;
        allChips.forEach(chip => {
            if (currentRowW + chip.w > maxWidth && currentRow.length > 0) {
                rows.push({ chips: currentRow, totalW: currentRowW - 5 }); // -5 car pas d'espace après le dernier
                currentRow = [];
                currentRowW = 0;
            }
            currentRow.push(chip);
            currentRowW += (chip.w + 5);
        });
        if (currentRow.length > 0) rows.push({ chips: currentRow, totalW: currentRowW - 5 });

        // 3. Dessiner chaque ligne centrée
        let curY = startY;
        rows.forEach(row => {
            let curX = startX + (maxWidth - row.totalW) / 2; // Centrage
            row.chips.forEach(chip => {
                context.currentPage.drawRectangle({
                    x: curX, y: curY - chipH, width: chip.w, height: chipH,
                    color: chip.color, borderRadius: 3
                });
                context.currentPage.drawText(chip.text, {
                    x: curX + chipPadding, y: curY - chipH + (chipH - fontSize) / 2 + 1,
                    font: helveticaBoldFont, size: fontSize, color: rgb(1, 1, 1)
                });
                curX += (chip.w + 5);
            });
            curY -= (chipH + 4);
        });
    };

    async function embedPdfImageFromMeta(imgMeta) {
        if (!imgMeta || !Store.state.compressedImages[imgMeta.id]) return null;
        const imageBytes = Store.state.compressedImages[imgMeta.id];
        return embedPdfImageFromBytes(pdfDoc, imageBytes);
    }

    /**
     * Tableau récapitulatif + première photo en grand (paysage A4), puces outils pour l’effraction.
     * N’appelle pas addNewPage : le parent doit positionner le curseur sur une page dédiée.
     */
    async function drawTableWithHeroPhoto({ blockTitle, compositionLine, rows, heroMeta, showEffracTools }) {
        const goldColor = rgb(212 / 255, 175 / 255, 55 / 255);
        const pageW = context.pageWidth;
        const m = context.margin;

        drawSubTitle(blockTitle);
        if (compositionLine) {
            drawWrappedText(compositionLine, { size: 10, font: helveticaBoldFont });
        }

        const contentTop = context.y;
        const embedded = heroMeta ? await embedPdfImageFromMeta(heroMeta) : null;
        const gutter = 14;
        const photoColW = embedded ? Math.floor((pageW - m * 2) * 0.54) : 0;
        const photoColX = embedded ? pageW - m - photoColW : pageW - m;
        const tableAvailW = embedded ? Math.max(170, photoColX - m - gutter) : (pageW - 2 * m);

        context.y = contentTop;
        drawTable(['Champ', 'Détail'], rows, [1.4, 2.6], m, tableAvailW);
        const tableBottomY = context.y;

        let photoBottomY = tableBottomY;
        if (embedded) {
            const maxPhotoW = photoColW - 12;
            const bandTop = contentTop;
            const bandBottom = m + 50;
            const maxPhotoH = Math.max(140, bandTop - bandBottom - (showEffracTools ? 42 : 12));
            const scaled = embedded.scaleToFit(maxPhotoW, maxPhotoH);
            const imgX = photoColX + (photoColW - scaled.width) / 2;
            const imgY = bandTop - 24 - scaled.height; // Position sous le label, lui-même sous le top

            context.currentPage.drawRectangle({
                x: photoColX + 2,
                y: bandTop - (scaled.height + (showEffracTools ? 40 : 24)), // Top aligné avec le tableau
                width: photoColW - 4,
                height: scaled.height + (showEffracTools ? 40 : 24),
                borderColor: showEffracTools ? goldColor : context.colors.accent,
                borderWidth: 1.2
            });
            const lbl = showEffracTools ? 'Photo porte (principale)' : 'Photo (vue principale)';
            const lw = helveticaFont.widthOfTextAtSize(lbl, 9);
            context.currentPage.drawText(lbl, {
                x: photoColX + (photoColW - lw) / 2,
                y: bandTop - 18, // Placé juste sous le trait haut du rectangle
                font: helveticaFont,
                size: 9,
                color: context.colors.text
            });
            context.currentPage.drawImage(embedded, {
                x: imgX,
                y: imgY,
                width: scaled.width,
                height: scaled.height
            });
            if (showEffracTools && heroMeta) {
                let tools = [];
                try { tools = JSON.parse(heroMeta.tools || '[]'); } catch (e) { tools = []; }
                const other = heroMeta.other_tools || '';
                if (tools.length > 0 || String(other).trim()) {
                    await drawToolChips(tools, other, photoColX + 6, imgY - 6, photoColW - 12);
                }
            }
            photoBottomY = Math.min(tableBottomY, imgY - 8);
        }

        context.y = Math.min(tableBottomY, photoBottomY) - 18;
    }

    const drawImagesFromCategory = async (previewContainerId, title) => {
        await drawGroupedImages(previewContainerId, title);
    };

    const getCompositionData = (teamPrefix) => {
        const membersByCell = {};
        const allMembers = (Store.state.formData.patracdvr_rows || []).flatMap(row => row.members);

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
                    groupParts.push({ text: ',  ', style: separatorStyle }); // Virgule et espace
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

        addNewPage();
        drawSubTitle(`ADVERSAIRE (OBJECTIF ${index + 1}): ${advName}`);

        // Zone utile
        const pageW = context.pageWidth;
        const margin = context.margin;
        const gutter = 14;
        const topY = context.y;

        // Photo principale
        const mainPhotoId = `photo_main_${adv.id}`;
        const mainImageMeta = (Store.state.formData.dynamic_photos || {})[mainPhotoId]?.[0] || null;
        const embeddedPhoto = mainImageMeta ? await embedPdfImageFromMeta(mainImageMeta) : null;

        const photoColW = embeddedPhoto ? Math.floor((pageW - margin * 2) * 0.40) : 0;
        const photoColX = embeddedPhoto ? pageW - margin - photoColW : pageW - margin;
        const tableAvailW = embeddedPhoto ? Math.max(200, photoColX - margin - gutter) : (pageW - margin * 2);

        // Données
        const meText = (adv.me_list || []).map((me, i) => `ME${i + 1}: ${me}`).join(' | ');
        const adversaireRows = [
            ['Nom/Prénom', advName],
            ['Domicile', dashShow(adv.domicile_adversaire)],
            ['Naissance', `${dashShow(adv.date_naissance)} à ${dashShow(adv.lieu_naissance)}`],
            ['Description', `${dashShow(adv.stature_adversaire)} / ${dashShow(adv.ethnie_adversaire)}`],
            ['Signes', dashShow(adv.signes_particuliers)],
            ['Profession', dashShow(adv.profession_adversaire)],
            ['Antécédents', dashShow(adv.antecedents_adversaire)],
            ["État d'esprit", (adv.etat_esprit_list || []).join(', ')],
            ['Attitude', dashShow(adv.attitude_adversaire)],
            ['Volume', (adv.volume_list || []).join(', ')],
            ['Substances', dashShow(adv.substances_adversaire)],
            ['Véhicules', (adv.vehicules_list || []).join(', ')],
            ['Armes', dashShow(adv.armes_connues)],
            ['Moyens Employés', dashShow(meText)],
        ].filter(row => row[1] && row[1] !== '—' && row[1] !== ' à ');

        // Dessin Tableau
        context.y = topY;
        drawTable(['Information', 'Détail'], adversaireRows, [1, 2], margin, tableAvailW);
        const tableBottomY = context.y;

        // Dessin Photo (Side-by-side)
        if (embeddedPhoto) {
            const tableUsedH = topY - tableBottomY;
            const frameH = Math.max(180, tableUsedH); // Au moins 180 pour une belle photo
            const frameY = topY - frameH;
            const scaled = embeddedPhoto.scaleToFit(photoColW - 12, frameH - 25);
            
            context.currentPage.drawRectangle({
                x: photoColX, y: frameY, width: photoColW, height: frameH,
                borderColor: context.colors.accent, borderWidth: 1.2
            });
            context.currentPage.drawImage(embeddedPhoto, {
                x: photoColX + (photoColW - scaled.width) / 2,
                y: frameY + (frameH - scaled.height) / 2 + 10,
                width: scaled.width, height: scaled.height
            });
            const lbl = `Photo objectif ${index + 1}`;
            const lblW = helveticaFont.widthOfTextAtSize(lbl, 9);
            context.currentPage.drawText(lbl, {
                x: photoColX + (photoColW - lblW) / 2, y: frameY + 5,
                font: helveticaFont, size: 9, color: context.colors.text
            });
            
            context.y = Math.min(tableBottomY, frameY) - 10;
        } else {
            context.y = tableBottomY - 10;
        }

        context.y = tableBottomY - 10;

        // Consolider les photos supplémentaires et les photos renforts
        const extraPhotos = (Store.state.formData.dynamic_photos || {})[`photo_extra_${adv.id}`] || [];
        const renfortPhotos = (Store.state.formData.dynamic_photos || {})[`photo_renforts_${adv.id}`] || [];

        const mergedAdvPhotos = [
            ...extraPhotos.map(p => ({ ...p, customTitle: `Photo Supplémentaire - ${advName}` })),
            ...renfortPhotos.map(p => ({ ...p, customTitle: `Photo Renforts - ${advName}` }))
        ];

        if (mergedAdvPhotos.length > 0) {
            await drawGroupedImages(mergedAdvPhotos, 'Photos Adversaire');
        }
        checkY(50);
    };


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

        // Section 2. Adversaires (Le titre a été supprimé précédemment, on retire maintenant le saut de page)
        if (Store.state.formData.adversaries && Store.state.formData.adversaries.length > 0) {
            for (let i = 0; i < Store.state.formData.adversaries.length; i++) {
                await drawAdversaryBlock(Store.state.formData.adversaries[i], i);
            }
        } else {
            drawWrappedText("Aucun adversaire renseigné.", { size: 14, color: context.colors.danger });
        }


        addNewPage();
        const envTitleY = context.y;
        drawTitle("3. ENVIRONNEMENT");
        drawSubTitle("Ami(e)s (soutien)"); drawWrappedText(getVal('amies'), { size: 14 });
        drawSubTitle("Terrain / Météo"); drawWrappedText(getVal('terrain_info'), { size: 14 });
        drawSubTitle("Population"); drawWrappedText(getVal('population'), { size: 14 });
        drawSubTitle("Cadre juridique"); drawWrappedText(getVal('cadre_juridique'), { size: 14 });

        // Photos Transport (Globales)
        const transportPhotos = [
            ...((Store.state.formData.dynamic_photos || {})['photo_container_transport_pr_preview_container'] || []).map(p => ({ ...p, customTitle: 'Transport PSIG vers PR' })),
            ...((Store.state.formData.dynamic_photos || {})['photo_container_transport_domicile_preview_container'] || []).map(p => ({ ...p, customTitle: 'Transport PR vers Domicile/LE' }))
        ];
        if (transportPhotos.length > 0) {
            await drawGroupedImages(transportPhotos, 'Transport');
        }


        addNewPage();
        drawTitle("4. MISSION");
        drawWrappedText(getVal('missions_psig'), { font: helveticaBoldFont, size: 30, color: context.colors.danger, x: context.margin });

        addNewPage();
        drawTitle("5. EXÉCUTION");
        drawWrappedText(getVal('action_body_text'), { size: 16, x: context.margin });

        drawSubTitle("Chronologie des temps");
        const chronoHeaders = ["Type", "Heure", "Description"];
        const chronoRows = (Store.state.formData.time_events || []).map(e => [e.type || 'N/A', e.hour || 'N/A', e.description || 'N/A']);
        drawTable(chronoHeaders, chronoRows, [1, 1.5, 7], context.margin);
        drawSubTitle("Hypothèses");
        if (Store.state.formData.hypotheses && Store.state.formData.hypotheses.length > 0) {
            const hypothesesList = Store.state.formData.hypotheses.filter(h => h.trim() !== '').map(h => `- ${h}`).join('\n');
            if (hypothesesList) {
                drawWrappedText(hypothesesList, { size: 14, font: helveticaBoldFont, color: context.colors.text });
            } else {
                drawWrappedText("Aucune hypothèse.", { size: 14, color: context.colors.text });
            }
        }

        // --- NOUVEAU: Baptême Terrain (Tous) - Entre Section 5 et 6 ---
        const baptemePhotosGroup = [];
        // 1. Ajouter la photo globale
        const globalB = (Store.state.formData.dynamic_photos || {})['photo_container_bapteme_terrain_preview_container'] || [];
        globalB.forEach(p => baptemePhotosGroup.push({ ...p, customTitle: 'Baptême terrain (Général)' }));

        // 2. Ajouter les photos des blocs ZMSPCP
        if (Store.state.formData.zmspcp_blocks) {
            Store.state.formData.zmspcp_blocks.forEach((block, idx) => {
                const title = block.title || `ZMSPCP ${idx + 1}`;
                const blockB = (Store.state.formData.dynamic_photos || {})[`photo_bapteme_${block.id}`] || [];
                blockB.forEach(p => baptemePhotosGroup.push({ ...p, customTitle: `${title} - Baptême Terrain` }));
            });
        }

        if (baptemePhotosGroup.length > 0) {
            addNewPage();
            drawTitle("BAPTÊME TERRAIN");
            await drawGroupedImages(baptemePhotosGroup, 'Baptême Terrain', {
                forceSingle: true,
                startOnCurrentPage: true
            });
        }

        addNewPage();
        drawTitle("6. ARTICULATION");
        drawWrappedText(`Place du Chef (Générale): ${getVal('place_chef')}`, { size: 14, x: context.margin });

        // --- SECTION 6: ARTICULATION (MOICP + ZMSPCP groupés) ---
        addNewPage();
        drawTitle("6. ARTICULATION");
        drawWrappedText(`Place du Chef (Générale): ${dashShow(getVal('place_chef'))}`, { size: 14, x: context.margin });

        const moicpBlocks = Store.state.formData.moicp_blocks || [];
        const zmspcpBlocks = Store.state.formData.zmspcp_blocks || [];
        const maxSteps = Math.max(moicpBlocks.length, zmspcpBlocks.length);

        for (let i = 0; i < maxSteps; i++) {
            // Pour la première paire, on essaie de rester sur la page 6 si possible.
            // Pour les paires suivantes (i > 0), on force une nouvelle page.
            if (i > 0) {
                addNewPage();
            } else {
                // Si i=0, on vérifie juste s'il reste assez de place pour AU MOINS un bloc (approx 200 units)
                if (context.y < context.margin + 200) addNewPage();
            }

            // --- MOICP (i) ---
            if (i < moicpBlocks.length) {
                const block = moicpBlocks[i];
                const title = block.title || `Inter ${i + 1}`;
                if (checkY(180)) { /* Page ajoutée si place insuffisante */ }
                
                const moicpRows = [
                    ['Mission (M)', dashShow(block.mission)],
                    ['Objectif (O)', dashShow(block.objectif)],
                    ['Itinéraire (I)', dashShow(block.itineraire)],
                    ['Points particuliers (P)', dashShow(block.points_particuliers)],
                    ['Conduite à tenir (C)', dashShow(block.cat)]
                ];
                const comp = (block.members && block.members.length)
                    ? `Composition (engagement) : ${block.members.join(',  ')}`
                    : null;
                const ext = (Store.state.formData.dynamic_photos || {})[`photo_itin_ext_${block.id}`] || [];
                const intr = (Store.state.formData.dynamic_photos || {})[`photo_itin_int_${block.id}`] || [];
                const ordered = [...ext, ...intr];
                const hero = ordered[0] || null;

                await drawTableWithHeroPhoto({
                    blockTitle: title,
                    compositionLine: comp,
                    rows: moicpRows,
                    heroMeta: hero,
                    showEffracTools: false
                });

                const rest = ordered.slice(1).map((p, idx) => ({
                    ...p, customTitle: p.customTitle || `${title} — photo ${idx + 2}`
                }));
                if (rest.length > 0) {
                    await drawGroupedImages(rest, 'MOICP — photos complémentaires', { startOnCurrentPage: true });
                }
            }

            // --- ZMSPCP (i) ---
            if (i < zmspcpBlocks.length) {
                const block = zmspcpBlocks[i];
                const title = block.title || `Appui ${i + 1}`;
                if (checkY(180)) { /* Page ajoutée */ }

                const zmspcpRows = [
                    ['Zone (Z)', dashShow(block.zone)],
                    ['Mission (M)', dashShow(block.mission)],
                    ['Secteur (S)', dashShow(block.secteur)],
                    ['Points particuliers (P)', dashShow(block.points_particuliers)],
                    ['Conduite à tenir (C)', dashShow(block.cat)],
                    ['Place du Chef (P)', dashShow(block.place_chef)]
                ];
                const comp = (block.members && block.members.length)
                    ? `Composition (engagement) : ${block.members.join(',  ')}`
                    : null;
                const bapt = (Store.state.formData.dynamic_photos || {})[`photo_bapteme_${block.id}`] || [];
                const empl = (Store.state.formData.dynamic_photos || {})[`photo_empl_ao_${block.id}`] || [];
                const ordered = [...bapt, ...empl];
                const hero = ordered[0] || null;

                await drawTableWithHeroPhoto({
                    blockTitle: title,
                    compositionLine: comp,
                    rows: zmspcpRows,
                    heroMeta: hero,
                    showEffracTools: false
                });

                const rest = ordered.slice(1).map((p, idx) => ({
                    ...p, customTitle: p.customTitle || `${title} — photo ${idx + 2}`
                }));
                if (rest.length > 0) {
                    await drawGroupedImages(rest, 'ZMSPCP — photos complémentaires', { startOnCurrentPage: true });
                }
            }
        }
        
        // --- SECTION 7: CELLULE EFFRACTION : tableau exhaustif porte + 1re photo + puces outils, puis hypothèses et autres vues ---
        if (Store.state.formData.effraction_blocks && Store.state.formData.effraction_blocks.length > 0) {
            for (let i = 0; i < Store.state.formData.effraction_blocks.length; i++) {
                const block = Store.state.formData.effraction_blocks[i];
                const title = block.title || `Effraction ${i + 1}`;
                
                // --- Page d'accueil du Bloc Effraction (Tableau + Hero Photo) ---
                addNewPage();
                if (i === 0) {
                    drawTitle("7. CELLULE EFFRACTION");
                }
                const fmtDim = (v) => (v !== undefined && v !== null && String(v).trim() !== '') ? `${String(v).trim()} cm` : '—';
                const effracRows = [
                    ['Mission', dashShow(block.mission)],
                    ['Type porte', dashShow(block.porte)],
                    ['Structure & dormant', dashShow(block.structure)],
                    ['Serrurerie', dashShow(block.serrurerie)],
                    ['Environnement immédiat', dashShow(block.environnement)],
                    ['Bâti à bâti', fmtDim(block.bati_a_bati)],
                    ['Dormant à dormant', fmtDim(block.dormant_a_dormant)],
                    ['Profondeur linteaux', fmtDim(block.prof_linteaux)],
                    ['Profondeur bâti', fmtDim(block.prof_bati)],
                    ['Hauteur porte', fmtDim(block.h_porte)],
                    ['Hauteur marche', fmtDim(block.h_marche)],
                    ['Profondeur marche', fmtDim(block.prof_marche)],
                    ['Profondeur moulure', fmtDim(block.prof_moulure)]
                ];
                const comp = (block.members && block.members.length)
                    ? `Composition : ${block.members.join(',  ')}`
                    : null;
                const effracPhotosRaw = ((Store.state.formData.dynamic_photos || {})[`photo_effrac_${block.id}`] || []);
                const heroMeta = effracPhotosRaw[0] || null;
                await drawTableWithHeroPhoto({
                    blockTitle: `${title} — synthèse porte`,
                    compositionLine: comp,
                    rows: effracRows,
                    heroMeta,
                    showEffracTools: true
                });

                // --- Page(s) pour les Vues Complémentaires (Photos 2+) ---
                const extraPhotos = effracPhotosRaw.slice(1).map((p) => {
                    let toolsStr = '';
                    try { toolsStr = p.tools ? JSON.parse(p.tools).join(', ') : ''; } catch (e) { toolsStr = ''; }
                    return { ...p, isEffrac: true, customTitle: `${title} — détail (${toolsStr || 'sans outil'})` };
                });
                if (extraPhotos.length > 0) {
                    await drawGroupedImages(extraPhotos, 'Effraction — vues complémentaires', { startOnCurrentPage: false });
                }

                // --- Page dédiée pour les Hypothèses ---
                const margin = context.margin;
                const pageW = context.pageWidth;
                const goldColor = rgb(212 / 255, 175 / 255, 55 / 255);

                if (block.hypotheses && block.hypotheses.length > 0) {
                    addNewPage();
                    drawSubTitle(`Hypothèses d'effraction`);
                    for (let hIdx = 0; hIdx < block.hypotheses.length; hIdx++) {
                        const hyp = block.hypotheses[hIdx];
                        checkY(100); // Ajoute une page si besoin (déjà géré par la fonction)

                        drawWrappedText(`${hyp.title || 'Hypothèse ' + (hIdx + 1)}: ${hyp.desc || ''}`, { size: 10, font: helveticaBoldFont, color: context.colors.danger });

                        const phases = [
                            { title: 'Effraction', text: hyp.effrac || '' },
                            { title: 'Dégagement', text: hyp.degag || '' },
                            { title: 'Assaut', text: hyp.assaut || '' }
                        ];

                        const cellW = (pageW - 2 * margin - 20) / 3;
                        const cellH = 60;

                        let currentPhaseY = context.y;

                        phases.forEach((ph, pIdx) => {
                            const cX = margin + pIdx * (cellW + 10);

                            context.currentPage.drawRectangle({
                                x: cX, y: currentPhaseY - cellH, width: cellW, height: cellH,
                                borderColor: goldColor, borderWidth: 1, color: goldColor // Fond OR
                            });
                            context.currentPage.drawText(ph.title, {
                                x: cX + 5, y: currentPhaseY - 14, font: helveticaBoldFont, size: 10, color: rgb(0, 0, 0) // Texte NOIR
                            });

                            const words = (ph.text || '').split(' ');
                            let line = '';
                            let txtY = currentPhaseY - 26;
                            for (let wi = 0; wi < words.length; wi++) {
                                const testLine = line + words[wi] + ' ';
                                const testW = helveticaFont.widthOfTextAtSize(testLine, 8);
                                if (testW > cellW - 10 && wi > 0) {
                                    if (txtY >= currentPhaseY - cellH + 5) {
                                        context.currentPage.drawText(line, { x: cX + 5, y: txtY, font: helveticaFont, size: 8, color: rgb(0, 0, 0) });
                                        txtY -= 10;
                                    }
                                    line = words[wi] + ' ';
                                } else {
                                    line = testLine;
                                }
                            }
                            if (txtY >= currentPhaseY - cellH + 5) {
                                context.currentPage.drawText(line, { x: cX + 5, y: txtY, font: helveticaFont, size: 8, color: rgb(0, 0, 0) });
                            }

                            if (pIdx < 2) {
                                const arrowX = cX + cellW;
                                const arrowY = currentPhaseY - cellH / 2;
                                context.currentPage.drawLine({
                                    start: { x: arrowX, y: arrowY }, end: { x: arrowX + 10, y: arrowY },
                                    thickness: 2, color: goldColor
                                });
                                context.currentPage.drawLine({
                                    start: { x: arrowX + 7, y: arrowY - 3 }, end: { x: arrowX + 10, y: arrowY },
                                    thickness: 2, color: goldColor
                                });
                                context.currentPage.drawLine({
                                    start: { x: arrowX + 7, y: arrowY + 3 }, end: { x: arrowX + 10, y: arrowY },
                                    thickness: 2, color: goldColor
                                });
                            }
                        });
                        context.y = currentPhaseY - cellH - 15;
                    }
                }

                // Le bloc Hypothèses est fini, on passe à la suite ou aux extraPhotos si elles existaient (déjà fait au-dessus)
            }
        }

        // ── PAGE DÉDIÉE : Ordres (Rame VL / Colonne / Pénétration) ──────────────────
        const hasRame = Store.state.formData.rame_vl_order && Store.state.formData.rame_vl_order.length > 0;
        const hasColonne = Store.state.formData.colonne_progression_order && Store.state.formData.colonne_progression_order.length > 0;
        const hasPenetration = Store.state.formData.ordre_penetration_order && Store.state.formData.ordre_penetration_order.length > 0;

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
            if (hasRame) diagrams.push({ label: "RAME VL", items: Store.state.formData.rame_vl_order, color: context.colors.accent });
            if (hasColonne) diagrams.push({ label: "COLONNE PROGRESSION", items: Store.state.formData.colonne_progression_order, color: context.colors.accent });
            if (hasPenetration) diagrams.push({ label: "PÉNÉTRATION", items: Store.state.formData.ordre_penetration_order, color: context.colors.danger });

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
                            start: { x: arrowMidX, y: arrowTopY - 4 },
                            end: { x: arrowMidX, y: arrowBotY },
                            color: diag.color, thickness: 1.5
                        });
                        // Tête de flèche (triangle) pointant vers le haut
                        const aw = 5 * scale;
                        context.currentPage.drawLine({
                            start: { x: arrowMidX - aw, y: arrowTopY - 5 },
                            end: { x: arrowMidX, y: arrowTopY },
                            color: diag.color, thickness: 1.5
                        });
                        context.currentPage.drawLine({
                            start: { x: arrowMidX + aw, y: arrowTopY - 5 },
                            end: { x: arrowMidX, y: arrowTopY },
                            color: diag.color, thickness: 1.5
                        });

                        curY = arrowBotY;
                    }
                });
            });

            // Le contexte y n'est plus utilisé sur cette page — laisser en bas
            context.y = drawZoneBottom;
        }



        addNewPage();
        drawTitle("7. PATRACDVR");
        // NOUVEAU: Ajout de colonne DIR dans le tableau
        const patracHeaders = ["Pax", "Fonction", "Cellule", "DIR", "Princ.", "Sec.", "A.F.I.", "Gren.", "Équip.", "Tenue", "GPB"];
        for (const row of (Store.state.formData.patracdvr_rows || [])) {
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
                    drawTable(patracHeaders, patracRows, [1.5, 2, 1.5, 1.2, 1.8, 1.5, 1.5, 1.5, 2, 1.5, 1.5], context.margin);
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
    return { pdfBytes, formData: Store.state.formData };
}

// ==================== app.js ====================














        // Configuration des membres par défaut (pour initialisation si localStorage vide)

// Globals are already declared in init.js or assigned in DOMContentLoaded

// displayMap is defined in MediaManager.js




// Event listeners will be initialized in DOMContentLoaded







// --- Gestion du Fond Personnalisé ---
















// NOUVEAU: Fonction pour renommer un véhicule








// ----------------------------------------------------------------------
// 1. VARIABLE GLOBALE POUR LE DRAG MOBILE
// ----------------------------------------------------------------------
let touchDragItem = null;
let touchDragClone = null;
let touchStartX = 0;
let touchStartY = 0;

// ----------------------------------------------------------------------
// 2. GESTIONNAIRES D'ÉVÉNEMENTS TACTILES (MOBILE)
// ----------------------------------------------------------------------

// quickEditMapping is already declared globally in init.js

// NOUVEAU: Liste des attributs supportant la multi-sélection
// multiSelectAttributes is already declared globally in init.js











/**
 * Logique de suppression lors du drop sur la corbeille.
 */


/**
 * Sauvegarde les métadonnées du formulaire dans localStorage.
 */


/**
 * Charge les données du formulaire depuis localStorage et les images depuis IndexedDB.
 */


// CORRECTION: Retrait de l'appel à setupQuickEditPanel ici




// Suppression de let draggedItem = null; pour utiliser l'objet DataTransfer





window.updateAnnotationRotation = updateAnnotationRotation;


// --- GLOBAL EXPOSURE (Moved to appropriate modules) ---
window.openPresentationMode = openPresentationMode;
window.downloadOiPdf = downloadOiPdf;

document.addEventListener('DOMContentLoaded', async () => {
    // ALWAYS start at Step 0 per user requirement
    Store.state.currentStep = 0;

    // Initialize global DOM references
    steps = Array.from(document.querySelectorAll(".wizard-step"));
    progressSteps = Array.from(document.querySelectorAll(".wizard-progress-step"));
    prevBtn = document.getElementById('prevBtn');
    nextBtn = document.getElementById('nextBtn');
    previewBtn = document.getElementById('previewBtn');
    
    patracdvrContainer = document.getElementById('patracdvr_container');
    unassignedContainer = document.getElementById('unassigned_members_container');
    resetPatracdvrBtn = document.getElementById('resetPatracdvrBtn');
    presentationModal = document.getElementById('presentationModal');
    downloadPdfBtn = document.getElementById('downloadPdfBtn');
    coherenceAlertsContainer = document.getElementById('coherence_alerts_container');
    recapFinalisation = document.getElementById('recap_finalisation');

    // Drawing context
    annotationModal = document.getElementById('annotationModal');
    canvas = document.getElementById('annotationCanvas');
    if (canvas) ctx = canvas.getContext('2d');
    rotationInput = document.getElementById('rotation_input');
    if (typeof initAnnotationWorkspace === 'function') {
        initAnnotationWorkspace();
    }

    // Attach Step navigation listeners
    if (prevBtn) prevBtn.addEventListener('click', () => changeStep(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => changeStep(1));
    // DB Init
    try {
        if (dbManager && typeof dbManager.init === 'function') {
            await dbManager.init();
        }
    } catch (e) {
        console.error("DB Init failed:", e);
    }
    
    await loadFormData();
    initializeDragDropListeners();
    if (typeof initDocumentDragTransfer === 'function') initDocumentDragTransfer();
    if (typeof initPatracQuickEditUi === 'function') initPatracQuickEditUi();

    // Initialisation du thème
    const isDarkMode = localStorage.getItem('theme') === 'dark' || !localStorage.getItem('theme');
    if (!isDarkMode) { document.body.classList.replace('dark-mode', 'light-mode'); }
    if (document.getElementById('darkModeIcon')) {
        document.getElementById('darkModeIcon').textContent = isDarkMode ? 'nightlight' : 'clear_day';
    }

    // Dock initialization
    const fullscreenToggleBtn = document.getElementById('fullscreenToggle');
    const darkModeToggleBtn = document.getElementById('darkModeToggle');
    const dockToggleBtn = document.getElementById('dockToggleBtn');
    const dock = document.getElementById('dockMenu');

    if (fullscreenToggleBtn) {
        fullscreenToggleBtn.addEventListener('click', toggleFullscreen);
        document.addEventListener('fullscreenchange', updateFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
        document.addEventListener('mozfullscreenchange', updateFullscreenIcon);
        document.addEventListener('msfullscreenchange', updateFullscreenIcon);
        updateFullscreenIcon();
    }
    if (darkModeToggleBtn) {
        darkModeToggleBtn.addEventListener('click', handleThemeToggle);
    }

    if (dockToggleBtn && dock) {
        dockToggleBtn.addEventListener('click', toggleDock);
        if (localStorage.getItem('dockCollapsed') === 'true') {
            dock.classList.add('collapsed');
            const icon = document.querySelector('#dockToggleBtn .material-symbols-outlined');
            if (icon) icon.textContent = 'expand_less';
        }
    }

    // Collapsibles: Default Closed
    document.querySelectorAll('.collapsible-container').forEach(c => c.classList.remove('open'));
    const cont = document.querySelector('.container');
    if (cont) {
        cont.addEventListener('click', (event) => {
            const header = event.target.closest('.collapsible-header');
            if (header) { 
                const parent = header.parentElement; 
                if (parent && parent.classList.contains('collapsible-container')) parent.classList.toggle('open'); 
            }
        });
    }

    // Event Listeners for Buttons
    const resetPatracBtn = document.getElementById('resetPatracdvrBtn');
    if (resetPatracBtn) {
        resetPatracBtn.addEventListener('click', () => {
            if (confirm("Effacer tout le PATRACDVR ?")) {
                const p = document.getElementById('patracdvr_container');
                const u = document.getElementById('unassigned_members_container');
                if (p) p.innerHTML = '';
                if (u) u.innerHTML = '';
                syncDomToStore();
                activeMemberId = null;
                const panel = document.getElementById('quickEditPanel');
                if (panel) panel.style.display = 'none';
            }
        });
    }

    const addManualVehicleBtn = document.getElementById('addManualVehicleBtn');
    if (addManualVehicleBtn) addManualVehicleBtn.addEventListener('click', addManualVehicle);
    
    const addManualMemberBtn = document.getElementById('addManualMemberBtn');
    if (addManualMemberBtn) addManualMemberBtn.addEventListener('click', addManualMember);

    const addMoicpBtn = document.getElementById('addMoicpBtn');
    if (addMoicpBtn) addMoicpBtn.addEventListener('click', () => typeof addMoicp === 'function' && addMoicp());

    const addZmspcpBtn = document.getElementById('addZmspcpBtn');
    if (addZmspcpBtn) addZmspcpBtn.addEventListener('click', () => typeof addZmspcp === 'function' && addZmspcp());

    const addEffractionBtn = document.getElementById('addEffractionBtn');
    if (addEffractionBtn) addEffractionBtn.addEventListener('click', () => typeof addEffraction === 'function' && addEffraction());

    if (previewBtn) previewBtn.addEventListener('click', openPresentationMode);
    
    const dlPdfBtn = document.getElementById('downloadPdfBtn');
    if (dlPdfBtn) dlPdfBtn.addEventListener('click', downloadOiPdf);

    const closePBtn = document.getElementById('closePresentationModalBtn');
    if (closePBtn) {
        closePBtn.addEventListener('click', () => {
            const m = document.getElementById('presentationModal');
            if (m) {
                if (typeof m.close === 'function') m.close();
                else m.style.display = 'none';
            }
        });
    }

    showStep(0);
});


    window.openPresentationMode = openPresentationMode;
    window.downloadOiPdf = downloadOiPdf;
