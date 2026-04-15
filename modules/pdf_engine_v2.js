/**
 * ============================================================
 * PDF ENGINE V2 - GSTART PROJECT
 * ============================================================
 * Moteur de rendu PDF et Aperçu basé sur HTML.
 */

const PDFEngineV2 = {
    // --- CONFIGURATION ---
    options: {
        margin: 0,
        filename: 'Ordre_Initial.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2, 
            useCORS: true, 
            letterRendering: true,
            logging: false
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    },

    /**
     * Lance l'aperçu dans la modale de présentation.
     */
    async openPreview() {
        const presentationContent = document.getElementById('presentation-content');
        if (!presentationContent) return;

        try {
            presentationContent.innerHTML = '<div style="text-align:center; padding: 40px;"><h3>Génération de l\'aperçu...</h3><p>Veuillez patienter.</p></div>';
            
            // 1. Collecter les données
            const data = await this.collectAllData();

            // 2. Générer le HTML
            const htmlContent = this.generateHTML(data, true); // true = mode preview

            // 3. Injecter
            presentationContent.innerHTML = htmlContent;
        } catch (error) {
            console.error("Preview Error:", error);
            presentationContent.innerHTML = '<div style="color:red; padding: 20px;">Erreur lors de la génération de l\'aperçu.</div>';
        }
    },

    /**
     * Télécharge le PDF.
     */
    async downloadOiPdf() {
        try {
            if (typeof toast === 'function') toast("Préparation du PDF...", "info");
            const data = await this.collectAllData();
            const htmlContent = this.generateHTML(data, false); // false = mode download

            const worker = document.createElement('div');
            worker.innerHTML = htmlContent;
            worker.style.position = 'absolute'; worker.style.left = '-9999px'; worker.style.width = '297mm';
            document.body.appendChild(worker);

            const opt = {
                ...this.options,
                filename: `OI_${(data.formData.date_op || 'SANS_DATE').replace(/\//g,'-')}_${data.formData.trigramme_redacteur || 'RED'}.pdf`
            };

            await html2pdf().from(worker).set(opt).save();
            document.body.removeChild(worker);
            if (typeof toast === 'function') toast("PDF généré avec succès !", "success");
        } catch (error) {
            console.error("PDF Engine Error:", error);
            if (typeof toast === 'function') toast("Erreur lors de la génération PDF", "error");
        }
    },

    async collectAllData() {
        const formData = JSON.parse(JSON.stringify(Store.state.formData));
        const photosBase64 = {};
        if (formData.dynamic_photos) {
            const promises = [];
            for (const category in formData.dynamic_photos) {
                formData.dynamic_photos[category].forEach(photoMeta => {
                    promises.push((async () => {
                        try {
                            const blob = await dbManager.getItem(photoMeta.id);
                            if (blob) photosBase64[photoMeta.id] = await this.blobToBase64(blob);
                        } catch (e) { console.warn(`Photo ${photoMeta.id} fail`, e); }
                    })());
                });
            }
            await Promise.all(promises);
        }
        return {
            formData, photosBase64,
            isDark: formData.pdf_theme === 'dark' || (formData.pdf_theme !== 'light' && document.body.classList.contains('dark-mode'))
        };
    },

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },

    /**
     * @param {Boolean} isPreview Si true, adapte le CSS pour un affichage web sans marges mm strictes.
     */
    generateHTML(data, isPreview = false) {
        const { formData, photosBase64, isDark } = data;
        const colors = isDark ? {
            bg: '#121212', bgCard: '#1e1e1e', text: '#ffffff', textMuted: '#a1a1aa',
            accent: '#3b82f6', border: '#3f3f46', danger: '#ef4444', header: '#1a1a1a'
        } : {
            bg: '#ffffff', bgCard: '#f4f4f5', text: '#000000', textMuted: '#71717a',
            accent: '#2563eb', border: '#e4e4e7', danger: '#dc2626', header: '#f8fafc'
        };

        const pageStyle = isPreview 
            ? `width: 100%; max-width: 1000px; margin: 0 auto 40px auto; min-height: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border-radius: 12px;`
            : `width: 297mm; min-height: 210mm; page-break-after: always;`;

        const css = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Oswald:wght@700&family=JetBrains+Mono&display=swap');
                * { box-sizing: border-box; }
                body { 
                    font-family: 'Inter', sans-serif; margin: 0; padding: ${isPreview ? '20px' : '0'}; 
                    background: ${isPreview ? 'transparent' : colors.bg}; 
                    color: ${colors.text}; font-size: 11pt; line-height: 1.4; 
                }
                .pdf-page { 
                    ${pageStyle}
                    padding: 15mm; position: relative; display: flex; flex-direction: column; 
                    background: ${colors.bg}; border: 1px solid ${colors.border};
                }
                .pdf-page:last-child { page-break-after: auto; }
                h1, h2, h3 { font-family: 'Oswald', sans-serif; text-transform: uppercase; margin: 0; }
                h1 { font-size: 32pt; color: ${colors.accent}; }
                h2 { font-size: 20pt; border-bottom: 2px solid ${colors.accent}; padding-bottom: 5px; margin-bottom: 15px; margin-top: 20px; }
                h3 { font-size: 14pt; margin-bottom: 10px; color: ${colors.accent}; }
                .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
                .card { background: ${colors.bgCard}; border: 1px solid ${colors.border}; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
                .label { font-weight: bold; color: ${colors.accent}; font-size: 10pt; text-transform: uppercase; display: block; margin-bottom: 5px; }
                .value { margin-bottom: 15px; white-space: pre-wrap; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 15px; background: ${colors.bgCard}; }
                th, td { border: 1px solid ${colors.border}; padding: 8px; text-align: left; }
                th { background: ${colors.header}; font-weight: bold; color: ${colors.accent}; font-size: 9pt; }
                .photo-full-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; flex: 1; align-content: center; }
                .photo-item { border: 1px solid ${colors.border}; border-radius: 8px; overflow: hidden; background: #000; display: flex; flex-direction: column; height: ${isPreview ? 'auto' : '160mm'}; min-height: ${isPreview ? '400px' : '0'}; }
                .photo-item img { width: 100%; height: 100%; object-fit: contain; }
                .photo-caption { padding: 10px; font-size: 11pt; font-weight: bold; color: #fff; background: rgba(0,0,0,0.8); text-align: center; }
                .pdf-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; }
                .logo-container { width: 60mm; height: 30mm; display: flex; align-items: center; justify-content: center; }
                .logo-container img { max-width: 100%; max-height: 100%; }
                .header-info { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 10pt; }
                .bg-watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0.1; width: 80%; z-index: -1; }
                .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 9pt; margin-right: 5px; }
                .monospaced { font-family: 'JetBrains Mono', monospace; }
                .no-break { page-break-inside: avoid; }
            </style>
        `;

        const logoId = formData.dynamic_photos?.photo_logo_unite?.[0]?.id;
        const logoSrc = logoId ? photosBase64[logoId] : null;
        let pages = '';

        // --- PAGE 1: GARDE ---
        pages += `
            <div class="pdf-page">
                ${(formData.logo_mode === 'background' && logoSrc) ? `<img src="${logoSrc}" class="bg-watermark">` : ''}
                <div class="pdf-header">
                    <div class="logo-container">${(formData.logo_mode !== 'background' && logoSrc) ? `<img src="${logoSrc}">` : ''}</div>
                    <div class="header-info">
                        <div>OPÉRATION DU : <strong>${formData.date_op || 'N/A'}</strong></div>
                        <div>RÉDACTEUR : <strong>${formData.trigramme_redacteur || 'N/A'}</strong></div>
                        <div>UNITÉ : <strong>${formData.unite_redacteur || 'N/A'}</strong></div>
                    </div>
                </div>
                <div style="text-align: center; margin: 40px 0;">
                    <h1>ORDRE INITIAL</h1>
                    <div style="font-size: 1.5em; color: ${colors.textMuted}; margin-top: 10px;">${formData.unite_redacteur || ''}</div>
                </div>
                <div class="grid">
                    <div class="card">
                        <h3>1. SITUATION GLOBALE</h3>
                        <div class="label">Situation Générale</div><div class="value">${formData.situation_generale || 'Aucune donnée.'}</div>
                        <div class="label">Situation Particulière</div><div class="value">${formData.situation_particuliere || 'Aucune donnée.'}</div>
                    </div>
                    <div class="card">
                        <h3>CIBLES(S)</h3>
                        ${(formData.adversaries || []).map(adv => `
                            <div style="border-bottom: 1px solid ${colors.border}; margin-bottom: 10px; padding-bottom: 10px;">
                                <strong style="color: ${colors.accent}; font-size: 1.2em;">${adv.nom_adversaire || 'Inconnu'}</strong><br>
                                <span style="font-size: 0.9em; color:${colors.textMuted};">${adv.stature_adversaire || ''} - ${adv.ethnie_adversaire || ''}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        // --- PAGE 2: ADVERSAIRES ---
        if (formData.adversaries && formData.adversaries.length > 0) {
            pages += `
                <div class="pdf-page">
                    <h2>2. ADVERSAIRES & SIGNALEMENT</h2>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        ${formData.adversaries.map((adv, idx) => {
                            const advPhotoId = formData.dynamic_photos?.[`photo_main_${adv.id}`]?.[0]?.id;
                            const advPhotoSrc = advPhotoId ? photosBase64[advPhotoId] : null;
                            return `
                                <div class="card no-break" style="margin-bottom: 5px; padding: 10px;">
                                    <div style="display: flex; gap: 15px;">
                                        ${advPhotoSrc ? `<div style="width: 120px; height: 160px; border-radius: 8px; overflow: hidden; border: 2px solid ${colors.accent}; flex-shrink: 0;"><img src="${advPhotoSrc}" style="width:100%; height:100%; object-fit: cover;"></div>` : ''}
                                        <div style="flex: 1;">
                                            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid ${colors.border}; padding-bottom: 5px; margin-bottom: 10px;">
                                                <h3 style="margin:0;">${adv.nom_adversaire || 'Individu ' + (idx + 1)}</h3>
                                                <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.8em; color: ${colors.accent};">#${adv.id.substring(adv.id.length-4)}</div>
                                            </div>
                                            
                                            <div style="display: grid; grid-template-columns: 1fr 1.5fr; gap: 15px; font-size: 0.85em;">
                                                <div>
                                                    <span class="label">Identité / État Civil</span>
                                                    <div>Born: ${adv.date_naissance || 'N/A'} @ ${adv.lieu_naissance || 'N/A'}</div>
                                                    <div>Job: ${adv.profession_adversaire || 'N/A'}</div>
                                                    <div>Famille: ${adv.situation_familiale || 'N/A'}</div>
                                                    <div style="margin-top:5px;"><span class="label">Esprit</span> ${(adv.etat_esprit_list || []).join(', ') || 'N/A'}</div>
                                                </div>
                                                <div>
                                                    <span class="label">Localisation & Moyens</span>
                                                    <div><strong>Domicile:</strong> ${adv.domicile_adversaire || 'N/A'}</div>
                                                    <div style="margin-top:5px;"><strong>Véhicules:</strong> ${(adv.vehicules_list || []).join(' | ') || 'Aucun connu'}</div>
                                                    <div style="margin-top:5px;"><strong>Moyens (ME):</strong> ${(adv.me_list || []).join(', ') || 'N/A'}</div>
                                                </div>
                                            </div>
                                            
                                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed ${colors.border}; font-size: 0.85em;">
                                                <div>
                                                    <span class="label">Signalement</span>
                                                    <div>${adv.stature_adversaire || ''} - ${adv.ethnie_adversaire || ''}</div>
                                                    <div style="font-style: italic;">Obs: ${adv.signes_particuliers || 'RAS'}</div>
                                                </div>
                                                <div>
                                                    <span class="label" style="color:${colors.danger}">Dangerosité / Armement</span>
                                                    <div><strong>Armes:</strong> ${adv.armes_connues || 'Inconnu'}</div>
                                                    <div><strong>ATCD / TAJ:</strong> ${adv.antecedents_adversaire || 'N/A'}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        // --- PAGE 3: ENVIRONNEMENT & MISSION ---
        pages += `
            <div class="pdf-page">
                <h2>3. ENVIRONNEMENT ET AMIS</h2>
                <div class="grid">
                    <div class="card"><div class="label">Forces Amies / Concours</div><div class="value">${formData.amies || 'N/A'}</div><div class="label">Terrain / Environnement</div><div class="value">${formData.terrain_info || 'N/A'}</div></div>
                    <div class="card"><div class="label">Population / Voisinage</div><div class="value">${formData.population || 'N/A'}</div><div class="label">Cadre Juridique</div><div class="value">${formData.cadre_juridique || 'N/A'}</div></div>
                </div>
                <h2>4. MISSION</h2><div class="card" style="border-left: 5px solid ${colors.accent};"><div class="value" style="font-size: 1.4em; font-weight: bold; font-family: 'JetBrains Mono', monospace;">${formData.missions_psig || 'RECONNAÎTRE LE DOMICILE EN VUE D\'APPRÉHENDER L\'OBJECTIF'}</div></div>
            </div>
        `;

        // --- PAGE 4: EXÉCUTION ---
        pages += `
            <div class="pdf-page">
                <h2>5. EXÉCUTION</h2><div class="label">Idée de Manœuvre / Action</div><div class="value">${formData.action_body_text || 'Non spécifié.'}</div>
                <div class="grid">
                    <div class="card"><h3>Chronologie Prévisionnelle</h3><table><thead><tr><th>Heure (H)</th><th>Événement</th></tr></thead><tbody>
                        ${(formData.time_events || []).map(ev => `<tr><td class="monospaced">${ev.hour}</td><td>${ev.type}${ev.description ? ' : ' + ev.description : ''}</td></tr>`).join('')}
                    </tbody></table></div>
                    <div class="card"><h3>Hypothèses d'ensemble</h3>
                        <div class="label">H1 (Succès)</div><div class="value">${(formData.hypotheses && formData.hypotheses[0]) || 'N/A'}</div>
                        <div class="label">H2 (Résistance)</div><div class="value">${(formData.hypotheses && formData.hypotheses[1]) || 'N/A'}</div>
                        <div class="label">H3 (Fuite)</div><div class="value">${(formData.hypotheses && formData.hypotheses[2]) || 'N/A'}</div>
                    </div>
                </div>
            </div>
        `;

        // --- PAGE DÉDIÉE BAPTÊME TERRAIN ---
        const collectBaptemePhotos = () => {
            const list = [];
            (formData.zmspcp_blocks || []).forEach(b => {
                const cat = 'photo_bapteme_' + b.id;
                if (formData.dynamic_photos?.[cat]) formData.dynamic_photos[cat].forEach(p => list.push({ ...p, context: `ZMSPCP : ${b.title}` }));
            });
            return list;
        };
        const bList = collectBaptemePhotos();
        if (bList.length > 0) {
            for (let i = 0; i < bList.length; i += 2) {
                const pks = bList.slice(i, i + 2);
                pages += `<div class="pdf-page"><h2>Baptême Terrain</h2><div class="photo-full-grid">
                    ${pks.map(p => `<div class="photo-item"><img src="${photosBase64[p.id]}"><div class="photo-caption">${p.customTitle || 'Baptême Terrain'} (${p.context})</div></div>`).join('')}
                </div></div>`;
            }
        }

        // --- PAGE 5: ARTICULATION ---
        pages += `
            <div class="pdf-page">
                <h2>6. ARTICULATION & ORDRES DE MOUVEMENT</h2>
                <div class="grid">
                    <div class="card"><h3>Ordre Rame VL</h3><div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(formData.rame_vl_order || []).map((vl, i) => `<div style="border: 1px solid ${colors.accent}; border-radius: 4px; padding: 5px 10px; background: ${colors.bg};"><strong style="color: ${colors.accent}; margin-right: 5px;">${i+1}</strong> ${vl}</div>`).join('')}
                    </div></div>
                    <div class="card"><h3>Colonne Progression</h3><div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(formData.colonne_progression_order || []).map((m, i) => `<div style="border: 1px solid ${colors.accent}; border-radius: 4px; padding: 5px 10px; background: ${colors.bg};"><strong style="color: ${colors.accent}; margin-right: 5px;">${i+1}</strong> ${m}</div>`).join('')}
                    </div></div>
                </div>
                <div class="card no-break"><h3>Ordre de Pénétration</h3><div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    ${(formData.ordre_penetration_order || []).map((m, i) => `<div style="border: 1px solid ${colors.accent}; border-radius: 4px; padding: 10px 15px; font-size: 1.2em; font-weight: bold; background: ${colors.header};"><span style="font-size: 0.8em; color: ${colors.textMuted}; display: block;">${i+1}</span> ${m}</div>`).join('') || 'Identique à la colonne'}
                </div><div style="margin-top: 15px; font-weight: bold;">PLACE DU CHEF : <span style="color:${colors.accent}">${formData.place_chef_gen || 'India 1'}</span></div></div>
            </div>
        `;

        // --- BLOCS MOICP / ZMSPCP ---
        const allBlocks = [
            ...(formData.moicp_blocks || []).map(b => ({ ...b, type: 'MOICP' })),
            ...(formData.zmspcp_blocks || []).map(b => ({ ...b, type: 'ZMSPCP' }))
        ];

        allBlocks.forEach(block => {
            pages += `
                <div class="pdf-page"><h2>Articulation : ${block.type} - ${block.title}</h2><div class="grid">
                    <div class="card"><h3>${block.type}</h3>
                        ${block.type === 'MOICP' ? `
                            <div class="label">M mission</div><div class="value">${block.mission}</div>
                            <div class="label">O objectif</div><div class="value">${block.objectif}</div>
                            <div class="label">I itinéraire</div><div class="value">${block.itineraire}</div>
                            <div class="label">P points particuliers</div><div class="value">${block.points_particuliers}</div>
                            <div class="label">C conduite à tenir</div><div class="value">${block.cat}</div>
                        ` : `
                            <div class="label">Z zone</div><div class="value">${block.zone}</div>
                            <div class="label">M mission</div><div class="value">${block.mission}</div>
                            <div class="label">S secteur</div><div class="value">${block.secteur}</div>
                            <div class="label">P points particuliers</div><div class="value">${block.points_particuliers}</div>
                            <div class="label">C conduite à tenir</div><div class="value">${block.cat}</div>
                        `}
                    </div>
                    <div class="card"><h3>Composition</h3><div style="display: flex; gap: 5px; flex-wrap: wrap;">
                        ${(block.members || []).map(m => `<span class="badge" style="background:#3b82f6; color:#fff;">${m}</span>`).join('')}
                    </div><div style="margin-top: 15px;"><span class="label">Place du Chef</span> ${block.place_chef || 'N/A'}</div></div>
                </div></div>
            `;
            const bPhotos = [];
            if (block.type === 'MOICP') {
                ['photo_itin_ext_', 'photo_itin_int_'].forEach(px => {
                    const c = px + block.id;
                    if (formData.dynamic_photos?.[c]) formData.dynamic_photos[c].forEach(p => bPhotos.push({ ...p, defT: px.includes('ext')?'Itinéraire Ext.':'Itinéraire Int.' }));
                });
            } else {
                const c = 'photo_empl_ao_' + block.id;
                if (formData.dynamic_photos?.[c]) formData.dynamic_photos[c].forEach(p => bPhotos.push({ ...p, defT: 'Emplacement AO' }));
            }
            if (bPhotos.length > 0) {
                for (let i = 0; i < bPhotos.length; i += 2) {
                    const ck = bPhotos.slice(i, i + 2);
                    pages += `<div class="pdf-page"><h2>Photos : ${block.type} - ${block.title}</h2><div class="photo-full-grid">${ck.map(p => `<div class="photo-item"><img src="${photosBase64[p.id]}"><div class="photo-caption">${p.customTitle || p.defT}</div></div>`).join('')}</div></div>`;
                }
            }
        });

        // --- SECTION EFFRACTION ---
        if (formData.effraction_blocks && formData.effraction_blocks.length > 0) {
            formData.effraction_blocks.forEach(block => {
                pages += `
                    <div class="pdf-page"><h2>Effraction : ${block.title}</h2><div class="card"><div class="label">Mission</div><div class="value" style="font-weight: bold;">${block.mission}</div></div>
                        <div class="grid">
                            <div class="card"><h3>Technique</h3><table style="font-size: 0.85em;">
                                <tr><td><strong>Porte</strong></td><td>${block.porte}</td></tr><tr><td><strong>Structure</strong></td><td>${block.structure}</td></tr>
                                <tr><td><strong>Serrurerie</strong></td><td>${block.serrurerie}</td></tr><tr><td><strong>Environnement</strong></td><td>${block.environnement}</td></tr>
                            </table></div>
                            <div class="card"><h3>Mesures techniques</h3><div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85em;">
                                <div><span class="label" style="font-size: 0.7em;">Bâti/Bâti</span> ${block.bati_a_bati || '-'} cm</div><div><span class="label" style="font-size: 0.7em;">Dormant/Dormant</span> ${block.dormant_a_dormant || '-'} cm</div>
                                <div><span class="label" style="font-size: 0.7em;">Prof. Linteaux</span> ${block.prof_linteaux || '-'} cm</div><div><span class="label" style="font-size: 0.7em;">Prof. Bâti</span> ${block.prof_bati || '-'} cm</div>
                                <div><span class="label" style="font-size: 0.7em;">Hauteur Porte</span> ${block.h_porte || '-'} cm</div><div><span class="label" style="font-size: 0.7em;">H. Marche</span> ${block.h_marche || '-'} cm</div>
                                <div><span class="label" style="font-size: 0.7em;">Prof. Marche</span> ${block.prof_marche || '-'} cm</div><div><span class="label" style="font-size: 0.7em;">Prof. Moulure</span> ${block.prof_moulure || '-'} cm</div>
                            </div></div>
                        </div>
                        <div class="grid"><div class="card"><h3>Composition</h3><div style="display: flex; gap: 5px; flex-wrap: wrap;">
                            ${(block.members || []).map(m => `<span class="badge" style="background:#d4af37; color:#000;">${m}</span>`).join('')}
                        </div></div><div class="card"><h3>Hypothèses d'effraction</h3>
                            ${(block.hypotheses || []).map((h, i) => `
                                <div style="margin-bottom: 12px; border-left: 3px solid ${colors.accent}; padding-left: 10px;">
                                    <strong style="color:${colors.accent}; display:block; margin-bottom:5px;">${h.title || 'H'+(i+1)}</strong>
                                    <div style="font-size:0.9em; margin-bottom:5px;">${h.desc || ''}</div>
                                    <div style="font-size:0.8em; color:${colors.textMuted}; font-style:italic;">
                                        Effrac: ${h.effrac || '/'} | Dégag: ${h.degag || '/'} | Assaut: ${h.assaut || '/'}
                                    </div>
                                </div>
                            `).join('')}
                        </div></div>
                    </div>
                `;
                const efPs = formData.dynamic_photos?.['photo_effrac_' + block.id] || [];
                if (efPs.length > 0) {
                    for (let i = 0; i < efPs.length; i += 2) {
                        const ck = efPs.slice(i, i + 2);
                        pages += `<div class="pdf-page"><h2>Photos Effraction : ${block.title}</h2><div class="photo-full-grid">${ck.map(p => `<div class="photo-item"><img src="${photosBase64[p.id]}"><div class="photo-caption">${p.customTitle || 'Détail Technique'}</div></div>`).join('')}</div></div>`;
                    }
                }
            });
        }

        // --- PAGE PATRACDVR ---
        pages += `
            <div class="pdf-page"><h2>7. RÉCAPITULATIF PATRACDVR</h2><div class="card"><table style="font-size: 0.8em;"><thead><tr><th>VL</th><th>PAX</th><th>CELLULE</th><th>FONCTION</th><th>PPALE</th><th>AFIS</th><th>ÉQUIPEMENT</th><th>DIR</th></tr></thead><tbody>
                ${(formData.patracdvr_rows || []).flatMap(row => (row.members.map((m, idx) => `<tr>
                    ${idx === 0 ? `<td rowspan="${row.members.length}" style="font-weight: bold; background: ${colors.header};">${row.vehicle}</td>` : ''}
                    <td style="font-weight: bold;">${m.trigramme}</td><td>${m.cellule}</td><td>${m.fonction}</td><td>${m.principales}</td><td>${m.afis}</td>
                    <td>${[m.equipement, m.equipement2].filter(v => v && v !== 'Sans').join(', ')}</td><td class="monospaced">${m.dir || ''}</td>
                </tr>`))).join('')}
            </tbody></table></div>
            <h3>Pool (Non affecté)</h3><div style="display: flex; gap: 5px; flex-wrap: wrap;">
                ${(formData.patracdvr_unassigned || []).map(m => `<span class="badge" style="background:${colors.border}; color:${colors.text};">${m.trigramme}</span>`).join('')}
            </div></div>
        `;

        // --- DERNIÈRE PAGE: CAT ---
        pages += `<div class="pdf-page"><h2>8. CONDUITES À TENIR & LIAISON</h2><div class="grid">
            <div class="card"><h3>CAT GÉNÉRALES</h3><div class="value">${formData.cat_generales || ''}</div></div>
            <div class="card"><h3>NO GO / DÉSOBSTRUCTION</h3><div class="value" style="color: ${colors.danger}; font-weight: bold;">${formData.no_go || 'N/A'}</div></div>
        </div><div class="card"><h3>LIAISON & GESTUELLE</h3><div class="value">${formData.cat_liaison || 'N/A'}</div></div>
        <div style="margin-top: auto; text-align: center; font-size: 0.8em; color: ${colors.textMuted}; border-top: 1px solid ${colors.border}; padding-top: 10px;">GSTART - Système de Génération d'Ordre Initial Tactique - Document Confidentiel</div></div>`;

        if (isPreview) {
            return `<div>${css}${pages}</div>`;
        } else {
            return `<html><head>${css}</head><body>${pages}</body></html>`;
        }
    }
};

window.PDFEngineV2 = PDFEngineV2;
window.downloadOiPdf = function() { PDFEngineV2.downloadOiPdf(); };
