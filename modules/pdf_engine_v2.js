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
            logging: true, // Activé pour diagnostic
            allowTaint: true
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
     * Télécharge le PDF - Version V4 (Rendu indépendant par page).
     * Cette méthode est la plus robuste : elle capture chaque page séparément dans un canvas dédié.
     */
    async downloadOiPdf() {
        console.group("🚀 [PDF ENGINE V4] - Démarrage de la génération");
        const startTime = Date.now();
        
        try {
            // Détection robuste des librairies (Umd vs Global)
            const jsPDFLib = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
            const html2canvasLib = window.html2canvas || null;

            if (!jsPDFLib) {
                console.error("❌ Librairie jsPDF non trouvée. window.jspdf:", window.jspdf, "window.jsPDF:", window.jsPDF);
                throw new Error("Librairie jsPDF manquante. Vérifiez votre connexion Internet (CDN) ou le chargement des scripts dans 1.html.");
            }
            if (!html2canvasLib) {
                console.error("❌ Librairie html2canvas non trouvée. window.html2canvas:", window.html2canvas);
                throw new Error("Librairie html2canvas manquante.");
            }

            if (typeof toast === 'function') toast("Génération du rapport multipage...", "info");
            
            // 1. Collecte & Préparation
            console.log("📍 [1/6] Collecte des données...");
            const data = await this.collectAllData();
            const htmlContent = this.generateHTML(data, false); 

            // 2. Injection DOM temporaire
            const tempContainer = document.createElement('div');
            tempContainer.id = 'pdf-render-temp-worker';
            tempContainer.style.cssText = `
                position: fixed; top: 0; left: 0; width: 297mm; background: white;
                z-index: -9999; visibility: visible !important; display: block !important;
                opacity: 0 !important; pointer-events: none;
            `;
            tempContainer.innerHTML = htmlContent;
            document.body.appendChild(tempContainer);

            // 3. Synchronisation globale (Polices)
            if (document.fonts) await document.fonts.ready;
            
            // Trouver toutes les pages
            const pageElements = Array.from(tempContainer.querySelectorAll('.pdf-page'));
            console.log(`📄 Total de pages à traiter : ${pageElements.length}`);

            if (pageElements.length === 0) throw new Error("Aucune page HTML générée.");

            // 4. Initialisation du document PDF (A4 Paysage)
            const doc = new jsPDFLib({
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4',
                compress: true
            });

            // 5. BOUCLE DE RENDU INDÉPENDANTE
            for (let i = 0; i < pageElements.length; i++) {
                const pageEl = pageElements[i];
                console.log(`📍 Capture Page ${i + 1}/${pageElements.length}...`);
                
                // Attendre le décodage des images spécifiques à cette page
                const pageImgs = Array.from(pageEl.querySelectorAll('img'));
                await Promise.all(pageImgs.map(img => {
                    if (img.complete) return Promise.resolve();
                    return img.decode().catch(e => console.warn("Page img fail", e));
                }));

                // Petit répit pour le moteur de layout
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

                // Capture de la page
                const canvas = await html2canvasLib(pageEl, {
                    scale: 2,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    logging: false,
                    width: pageEl.offsetWidth,
                    height: pageEl.offsetHeight,
                    scrollX: 0,
                    scrollY: 0
                });

                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                
                // Ajouter au PDF
                if (i > 0) doc.addPage();
                doc.addImage(imgData, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
                
                // Nettoyage mémoire immédiat du canvas
                canvas.width = 0;
                canvas.height = 0;
            }

            // 6. Sauvegarde
            const fileName = `OI_${(data.formData.date_op || 'SANS_DATE').replace(/\//g,'-')}_${data.formData.trigramme_redacteur || 'RED'}.pdf`;
            doc.save(fileName);

            console.log(`✅ [SUCCESS] PDF V4 généré en ${((Date.now() - startTime)/1000).toFixed(2)}s`);
            if (typeof toast === 'function') toast("PDF généré avec succès !", "success");

            // Nettoyage final
            document.body.removeChild(tempContainer);

        } catch (error) {
            console.error("❌ [CRITICAL V4] PDF Engine Failed:", error);
            if (typeof toast === 'function') toast("Erreur lors de la génération. (V4)", "error");
            const el = document.getElementById('pdf-render-temp-worker');
            if (el) el.remove();
        } finally {
            console.groupEnd();
        }
    },

    async collectAllData() {
        console.log("📸 Début collecte exhaustive des données et fusion des annotations...");
        const formData = JSON.parse(JSON.stringify(Store.state.formData));
        const photosBase64 = {};
        
        if (formData.dynamic_photos) {
            const promises = [];
            for (const category in formData.dynamic_photos) {
                formData.dynamic_photos[category].forEach(photoMeta => {
                    promises.push((async () => {
                        try {
                            const blob = await dbManager.getItem(photoMeta.id);
                            if (blob) {
                                let finalBlob = blob;
                                // Fusion des annotations si présentes
                                const annotations = JSON.parse(photoMeta.annotations || '[]');
                                if (annotations.length > 0 && typeof createAnnotatedImageBlob === 'function') {
                                    console.log(`🎨 Fusion annotations pour ${photoMeta.id}...`);
                                    try {
                                        finalBlob = await createAnnotatedImageBlob(blob, annotations);
                                    } catch (err) {
                                        console.warn(`Échec fusion annotations pour ${photoMeta.id}, utilisation original.`, err);
                                    }
                                }
                                photosBase64[photoMeta.id] = await this.blobToBase64(finalBlob);
                                console.log(`✓ Photo préparée: ${photoMeta.id} (${category})`);
                            } else {
                                console.warn(`⚠ Photo non trouvée dans DB: ${photoMeta.id}`);
                            }
                        } catch (e) { console.error(`✗ Erreur préparation photo ${photoMeta.id}`, e); }
                    })());
                });
            }
            await Promise.all(promises);
        }

        // --- NOUVEAU: Collecte du fond personnalisé ---
        try {
            const customBg = await dbManager.getItem('custom_pdf_background');
            if (customBg) {
                photosBase64['custom_pdf_background'] = await this.blobToBase64(customBg);
                console.log("✓ Fond personnalisé chargé (DB).");
            }
        } catch (e) { console.warn("Erreur chargement fond personnalisé (PDF Engine):", e); }
        
        console.log(`📸 Fin collecte. ${Object.keys(photosBase64).length} photos prêtes pour le rendu.`);
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
            : `width: 297mm; height: 210mm; page-break-after: always;`;

        const css = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Oswald:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap');
                
                * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
                
                .pdf-export-container { 
                    font-family: 'Inter', system-ui, sans-serif; 
                    margin: 0; padding: ${isPreview ? '20px' : '0'}; 
                    background: ${isPreview ? 'transparent' : colors.bg}; 
                    color: ${colors.text}; font-size: 11pt; line-height: 1.4; 
                    width: 100%;
                    display: block !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                }
                .pdf-page { 
                    ${pageStyle}
                    padding: 15mm; position: relative; display: flex !important; flex-direction: column; 
                    background: ${colors.bg}; border: 1px solid ${colors.border};
                    overflow: hidden;
                    box-sizing: border-box;
                }
                .pdf-page:last-child { page-break-after: auto; }
                h1, h2, h3 { font-family: 'Oswald', sans-serif; text-transform: uppercase; margin: 0; font-weight: 700; }
                h1 { font-size: 32pt; color: ${colors.accent}; }
                h2 { font-size: 20pt; border-bottom: 2px solid ${colors.accent}; padding-bottom: 5px; margin-bottom: 15px; margin-top: 20px; }
                h3 { font-size: 14pt; margin-bottom: 10px; color: ${colors.accent}; }
                .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
                .patracdvr-table th { 
                    background: ${colors.header}; 
                    color: ${colors.accent}; 
                    font-size: 8.5pt; 
                    padding: 6px 3px; 
                    text-align: center;
                    border: 1px solid ${colors.border};
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .patracdvr-table td { 
                    padding: 5px 3px; 
                    border: 1px solid ${colors.border}; 
                    font-size: 8.5pt; 
                    vertical-align: middle;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .label { font-weight: bold; color: ${colors.accent}; font-size: 9pt; text-transform: uppercase; display: block; margin-bottom: 3px; }
                .value { margin-bottom: 8px; white-space: pre-wrap; word-break: break-word; font-size: 10pt; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 15px; background: ${colors.bgCard}; table-layout: fixed; }
                th, td { border: 1px solid ${colors.border}; padding: 6px; text-align: left; word-wrap: break-word; overflow: hidden; }
                th { background: ${colors.header}; font-weight: bold; color: ${colors.accent}; font-size: 8pt; }
                tr { page-break-inside: avoid; }
                .photo-gallery-grid { display: grid; grid-template-columns: 1fr; gap: 15px; flex: 1; align-content: center; justify-items: center; }
                .photo-gallery-item { border: 2px solid ${colors.accent}; border-radius: 12px; overflow: hidden; background: #000; display: flex; flex-direction: column; width: 100%; max-width: 250mm; }
                .photo-item.landscape { height: 160mm; }
                .photo-item.portrait { height: auto; max-height: 180mm; }
                .photo-item img { width: 100%; height: 100%; object-fit: contain; }
                .photo-caption { padding: 10px; font-size: 11pt; font-weight: bold; color: #fff; background: rgba(0,0,0,0.85); text-align: center; border-top: 2px solid ${colors.accent}; }
                .photo-tools { padding: 6px; font-size: 9pt; background: #1a1a1a; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
                .tool-badge { background: ${colors.accent}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; }
                .pdf-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
                .logo-container { width: 60mm; height: 30mm; display: flex; align-items: center; justify-content: center; }
                .logo-container img { max-width: 100%; max-height: 100%; }
                .header-info { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 10pt; line-height: 1.4; }
                .bg-watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0.6; width: 80%; z-index: -1; }
                .pdf-footer { position: absolute; bottom: 10mm; left: 15mm; right: 15mm; border-top: 1px solid ${colors.border}; padding-top: 10px; text-align: center; font-size: 9pt; color: ${colors.textMuted}; font-family: 'JetBrains Mono', monospace; }
                .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 8pt; margin-right: 4px; background: ${colors.accent}; color: white; }
                .monospaced { font-family: 'JetBrains Mono', monospace; }
                .no-break { page-break-inside: avoid; }
                .cell-group { border: 1px solid ${colors.accent}; border-radius: 6px; padding: 8px; background: rgba(59, 130, 246, 0.05); margin-bottom: 8px; page-break-inside: avoid; }
                .cell-name { font-size: 0.7em; font-weight: bold; color: ${colors.accent}; text-transform: uppercase; margin-bottom: 4px; border-bottom: 1px solid rgba(59, 130, 246, 0.2); }
                .cell-members { display: flex; flex-wrap: wrap; gap: 5px; }
                .patracdvr-table { font-size: 8.5pt !important; width: 100%; height: 100%; }
            </style>
        `;

        const logoId = formData.dynamic_photos?.photo_logo_unite?.[0]?.id;
        let bgSrc = photosBase64['custom_pdf_background'] || (logoId ? photosBase64[logoId] : null);

        // --- MAPPING TRIGRAMME -> CELLULE ---
        const memberToCell = {};
        (formData.patracdvr_rows || []).forEach(row => {
            (row.members || []).forEach(m => {
                if (m.trigramme) memberToCell[m.trigramme] = m.cellule || 'NON ASSIGNÉ';
            });
        });

        // Helper regroupement par cellule
        const regroupByCell = (trigrammes) => {
            const groups = {};
            trigrammes.forEach(t => {
                const c = memberToCell[t] || 'SANS CELLULE';
                if (!groups[c]) groups[c] = [];
                groups[c].push(t);
            });
            return groups;
        };

        // Suppression du header global pour éviter le doublon d'image
        const headerHtml = ''; 

        const footerHtml = `
            <div class="pdf-footer">
                OI - ${formData.trigramme_redacteur || 'N/A'} - ${formData.unite_redacteur || 'N/A'} - <span style="color:${colors.danger}">CONFIDENTIEL</span>
            </div>
        `;
        let pages = '';

        // --- PAGE 1: GARDE ---
        pages += `
            <div class="pdf-page" style="border:none;">
                ${bgSrc ? `<img src="${bgSrc}" class="bg-watermark">` : ''}
                
                <div style="display: flex; justify-content: flex-end; font-family: 'JetBrains Mono', monospace; font-size: 14pt; color: ${colors.textMuted}; margin-bottom: 30mm;">
                    <div style="text-align: right;">
                        <div style="margin-bottom: 5px;">OP: ${formData.nom_operation || '-'}</div>
                        <div>DATE: ${formData.date_op || '-'}</div>
                    </div>
                </div>

                <div style="text-align: center; margin-bottom: 20mm;">
                    <h1 style="font-size: 38pt; color: ${colors.accent}; border:none; margin: 0;">ORDRE INITIAL</h1>
                    <div style="width: 100mm; height: 3px; background: ${colors.accent}; margin: 15px auto;"></div>
                </div>

                <div class="grid" style="margin-top: 0;">
                    <div class="card">
                        <h3 style="border-bottom: 2px solid ${colors.accent}; padding-bottom: 5px;">1. SITUATION GLOBALE</h3>
                        <div class="label" style="font-weight: bold; color: ${colors.accent}; margin-top: 10px;">SITUATION GÉNÉRALE</div>
                        <div class="value" style="margin-bottom: 10px;">${formData.situation_generale || '-'}</div>
                        <div class="label" style="font-weight: bold; color: ${colors.accent};">SITUATION PARTICULIÈRE</div>
                        <div class="value">${formData.situation_particuliere || '-'}</div>
                    </div>
                    <div class="card">
                        <h3 style="border-bottom: 2px solid ${colors.accent}; padding-bottom: 5px;">CIBLES(S)</h3>
                        ${(formData.adversaries || []).length > 0 ? formData.adversaries.map(adv => `
                            <div style="border-bottom: 1px solid ${colors.border}; margin-bottom: 10px; padding-bottom: 10px; margin-top: 10px;">
                                <strong style="color: ${colors.accent}; font-size: 1.25em;">${adv.nom_adversaire || 'Inconnu'}</strong><br>
                                <span style="font-size: 1em; color:${colors.textMuted};">${adv.stature_adversaire || ''} ${adv.ethnie_adversaire || ''}</span>
                            </div>
                        `).join('') : '<div class="value" style="margin-top: 10px;">Aucune cible renseignée.</div>'}
                    </div>
                </div>
            </div>
        `;

        // --- Helper: Galerie Photos (Une photo par page pour éviter les coupures) ---
        const renderGallery = (photoMetas, sectionTitle) => {
            if (!photoMetas || photoMetas.length === 0) return '';
            let galleryPages = '';
            
            photoMetas.forEach((p, idx) => {
                const tools = JSON.parse(p.tools || '[]');
                galleryPages += `
                    <div class="pdf-page" style="display: flex; flex-direction: column; justify-content: flex-start; padding: 15mm;">
                        <h2 style="margin-bottom: 10mm;">${sectionTitle} (Photo ${idx + 1}/${photoMetas.length})</h2>
                        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; border: 2px solid ${colors.border}; border-radius: 12px; background: ${colors.bgCard}; padding: 10px;">
                            <img src="${photosBase64[p.id] || ''}" style="max-width: 100%; max-height: 190mm; object-fit: contain; border-radius: 6px;">
                            <div class="photo-caption" style="margin-top: 15px; font-size: 16pt; font-weight: bold; color: ${colors.accent};">
                                ${p.customTitle || (sectionTitle + ' - Détail')}
                            </div>
                            ${(tools.length > 0 || p.other_tools) ? `
                                <div class="photo-tools" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
                                    ${tools.map(t => `<span class="tool-badge" style="padding: 6px 12px; font-size: 11pt;">${t}</span>`).join('')}
                                    ${p.other_tools ? `<span class="tool-badge" style="padding: 6px 12px; font-size: 11pt; border-style: dashed;">${p.other_tools}</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            });
            return galleryPages;
        };

        // --- PAGE 2: ADVERSAIRES (DÉTAILLÉS) ---
        if (formData.adversaries && formData.adversaries.length > 0) {
            formData.adversaries.forEach((adv, idx) => {
                const mainPhotoId = formData.dynamic_photos?.[`photo_main_${adv.id}`]?.[0]?.id;
                const mainPhotoSrc = mainPhotoId ? photosBase64[mainPhotoId] : null;
                
                pages += `
                    <div class="pdf-page">
                        <h2>2.${idx + 1} FICHE ADVERSAIRE : ${adv.nom_adversaire || 'Inconnu'}</h2>
                        <div style="display: flex; gap: 15px; align-items: start;">
                            ${mainPhotoSrc ? `
                                <div style="width: 70mm; border: 2px solid ${colors.accent}; border-radius: 8px; overflow: hidden; flex-shrink: 0;">
                                    <img src="${mainPhotoSrc}" style="width: 100%; display: block;">
                                </div>
                            ` : ''}
                            <div style="flex: 1;">
                                <div class="card" style="padding: 10px; margin-bottom: 8px;">
                                    <h3 style="border-bottom: 2px solid ${colors.accent}; padding-bottom: 3px; margin: 0 0 5px 0; font-size: 11pt;">IDENTITÉ</h3>
                                    <div class="grid" style="gap: 5px;">
                                        <div>
                                            <span class="label">Naissance</span>
                                            <div class="value" style="font-size: 9pt;">${adv.date_naissance || '-'} @ ${adv.lieu_naissance || '-'}</div>
                                            <span class="label">Profession</span>
                                            <div class="value" style="font-size: 9pt;">${adv.profession_adversaire || '-'}</div>
                                        </div>
                                        <div>
                                            <span class="label">Signalement</span>
                                            <div class="value" style="font-size: 9pt;">${adv.stature_adversaire || '-'} | ${adv.ethnie_adversaire || '-'}</div>
                                            <span class="label">Signes</span>
                                            <div class="value" style="font-size: 9pt;">${adv.signes_particuliers || 'Ras'}</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="card" style="padding: 10px; margin-bottom: 8px;">
                                    <h3 style="border-bottom: 2px solid ${colors.danger}; padding-bottom: 3px; margin: 0 0 5px 0; font-size: 11pt;">DANGEROSITÉ</h3>
                                    <span class="label">Armes Connues</span>
                                    <div class="value" style="color:${colors.danger}; font-weight:bold; font-size: 10pt;">${adv.armes_connues || '-'}</div>
                                    <span class="label">Dangerosité / ATCD</span>
                                    <div class="value" style="font-size: 9pt;">${adv.antecedents_adversaire || '-'}</div>
                                </div>
                            </div>
                        </div>
                        <div class="grid" style="margin-top: 5px; gap: 10px;">
                            <div class="card" style="padding: 10px;">
                                <h3 style="font-size: 10pt; margin:0 0 5px 0;">LOCALISATION</h3>
                                <div class="label">Domicile</div>
                                <div class="value" style="font-size: 9pt;">${adv.domicile_adversaire || '-'}</div>
                                <div class="label">Volume / Esprit</div>
                                <div class="value" style="font-size: 9pt;">${(adv.volume_list || []).join(', ')} | ${(adv.etat_esprit_list || []).join(', ')}</div>
                            </div>
                            <div class="card" style="padding: 10px;">
                                <h3 style="font-size: 10pt; margin:0 0 5px 0;">MOBILITÉ</h3>
                                <div class="label">Véhicules / Plaques</div>
                                <div class="value monospaced" style="font-size: 9pt;">${(adv.vehicules_list || []).join(' | ') || '-'}</div>
                                <div class="label">Attitude Attendue</div>
                                <div class="value" style="font-size: 9pt;">${adv.attitude_adversaire || '-'}</div>
                            </div>
                        </div>
                    </div>
                `;
                
                // Galerie Photos Supplémentaires (Extra + Renforts) pour cet adversaire
                const extraPhotos = [
                    ...(formData.dynamic_photos?.[`photo_extra_${adv.id}`] || []),
                    ...(formData.dynamic_photos?.[`photo_renforts_${adv.id}`] || [])
                ];
                pages += renderGallery(extraPhotos, `Adversaire : ${adv.nom_adversaire || 'Individu'}`);
            });
        }

        // --- PAGE 3: ENVIRONNEMENT & MISSION ---
        pages += `
            <div class="pdf-page">
                <h2>3. ENVIRONNEMENT ET AMIS</h2>
                <div class="grid">
                    <div class="card"><div class="label">Forces Amies / Concours</div><div class="value">${formData.amies || '-'}</div><div class="label">Terrain / Environnement</div><div class="value">${formData.terrain_info || '-'}</div></div>
                    <div class="card"><div class="label">Population / Voisinage</div><div class="value">${formData.population || '-'}</div><div class="label">Cadre Juridique</div><div class="value">${formData.cadre_juridique || '-'}</div></div>
                </div>
                <h2>4. MISSION</h2><div class="card" style="border-left: 5px solid ${colors.accent};"><div class="value" style="font-size: 1.4em; font-weight: bold; font-family: 'JetBrains Mono', monospace;">${formData.missions_psig || '-'}</div></div>
            </div>
        `;

        // --- PAGE 4: EXÉCUTION ---
        pages += `
            <div class="pdf-page">
                <h2>5. EXÉCUTION</h2><div class="label">Idée de Manœuvre / Action</div><div class="value">${formData.action_body_text || '-'}</div>
                <div class="grid">
                    <div class="card"><h3>Chronologie Prévisionnelle</h3><table><thead><tr><th style="width:80px;">Heure</th><th>Événement</th></tr></thead><tbody>
                        ${(formData.time_events || []).length > 0 ? formData.time_events.map(ev => `<tr><td class="monospaced">${ev.hour || ''}</td><td><strong>${ev.type || ''}</strong> : ${ev.description || ''}</td></tr>`).join('') : '<tr><td colspan="2">N/A</td></tr>'}
                    </tbody></table></div>
                    <div class="card"><h3>Hypothèses d'ensemble</h3>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${(formData.hypotheses || []).length > 0 ? formData.hypotheses.map((h, i) => `
                                <div style="background: ${colors.bg}; border-left: 4px solid ${colors.accent}; padding: 8px; border-radius: 4px;">
                                    <span style="font-size: 0.8em; color: ${colors.textMuted}; font-weight: bold;">H${i+1} :</span> ${h}
                                </div>
                            `).join('') : '<div class="value">-</div>'}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // --- SECTION NOUVELLE: LOGISTIQUE & TRANSPORTS (Entre 5 et 6) ---
        const log_photos = [
            ...(formData.dynamic_photos?.['photo_container_transport_pr_preview_container'] || []),
            ...(formData.dynamic_photos?.['photo_container_transport_domicile_preview_container'] || [])
        ];
        if (log_photos.length > 0) {
            pages += renderGallery(log_photos, "6. LOGISTIQUE & TRANSPORTS (Cheminement)");
        }

        // --- PAGE 5: ARTICULATION (Désormais 7) ---
        pages += `
            <div class="pdf-page">
                <h2>7. ARTICULATION & ORDRES DE MOUVEMENT</h2>
                <div class="grid">
                    <div class="card"><h3>Ordre Rame VL</h3><div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(formData.rame_vl_order || []).length > 0 ? formData.rame_vl_order.map((vl, i) => `<div style="border: 1px solid ${colors.accent}; border-radius: 4px; padding: 5px 10px; background: ${colors.bg};"><strong style="color: ${colors.accent}; margin-right: 5px;">${i+1}</strong> ${vl}</div>`).join('') : '-'}
                    </div></div>
                    <div class="card"><h3>Colonne Progression</h3><div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(formData.colonne_progression_order || []).length > 0 ? formData.colonne_progression_order.map((m, i) => `<div style="border: 1px solid ${colors.accent}; border-radius: 4px; padding: 5px 10px; background: ${colors.bg};"><strong style="color: ${colors.accent}; margin-right: 5px;">${i+1}</strong> ${m}</div>`).join('') : '-'}
                    </div></div>
                </div>
                <div class="card no-break"><h3>Ordre de Pénétration</h3><div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    ${(formData.ordre_penetration_order || []).length > 0 ? formData.ordre_penetration_order.map((m, i) => `<div style="border: 1px solid ${colors.accent}; border-radius: 4px; padding: 10px 15px; font-size: 1.2em; font-weight: bold; background: ${colors.header};"><span style="font-size: 0.8em; color: ${colors.textMuted}; display: block;">${i+1}</span> ${m}</div>`).join('') : '-'}
                </div><div style="margin-top: 15px; font-weight: bold;">PLACE DU CHEF : <span style="color:${colors.accent}">${formData.place_chef_gen || '-'}</span></div></div>
            </div>
        `;

        // BLOCS ZMSPCP
        (formData.zmspcp_blocks || []).forEach(block => {
            const cellGroups = regroupByCell(block.members || []);
            pages += `
                <div class="pdf-page"><h2>Articulation : ZMSPCP - ${block.title || '-'}</h2><div class="grid">
                    <div class="card"><h3>ZMSPCP</h3>
                        <div class="label">Z zone</div><div class="value">${block.zone || '-'}</div>
                        <div class="label">M mission</div><div class="value">${block.mission || '-'}</div>
                        <div class="label">S secteur</div><div class="value">${block.secteur || '-'}</div>
                        <div class="label">P points particuliers</div><div class="value">${block.points_particuliers || '-'}</div>
                        <div class="label">C conduite à tenir</div><div class="value">${block.cat || '-'}</div>
                    </div>
                    <div class="card"><h3>Composition par Cellule</h3>
                        ${Object.entries(cellGroups).map(([cell, items]) => `
                            <div class="cell-group">
                                <div class="cell-name">${cell}</div>
                                <div class="cell-members">${items.map(m => `<span class="badge">${m}</span>`).join('')}</div>
                            </div>
                        `).join('')}
                        <div style="margin-top: 10px;"><span class="label">Place du Chef</span> ${block.place_chef || '-'}</div>
                    </div>
                </div></div>
            `;
            const blockPhotos = [
                ...(formData.dynamic_photos?.['photo_bapteme_' + block.id] || []),
                ...(formData.dynamic_photos?.['photo_empl_ao_' + block.id] || [])
            ];
            pages += renderGallery(blockPhotos, `ZMSPCP : ${block.title || '-'}`);
        });

        // BLOCS MOICP
        (formData.moicp_blocks || []).forEach(block => {
            const cellGroups = regroupByCell(block.members || []);
            pages += `
                <div class="pdf-page"><h2>Articulation : MOICP - ${block.title || '-'}</h2><div class="grid">
                    <div class="card"><h3>MOICP</h3>
                        <div class="label">M mission</div><div class="value">${block.mission || '-'}</div>
                        <div class="label">O objectif</div><div class="value">${block.objectif || '-'}</div>
                        <div class="label">I itinéraire</div><div class="value">${block.itineraire || '-'}</div>
                        <div class="label">P points particuliers</div><div class="value">${block.points_particuliers || '-'}</div>
                        <div class="label">C conduite à tenir</div><div class="value">${block.cat || '-'}</div>
                    </div>
                    <div class="card"><h3>Composition par Cellule</h3>
                        ${Object.entries(cellGroups).map(([cell, items]) => `
                            <div class="cell-group">
                                <div class="cell-name">${cell}</div>
                                <div class="cell-members">${items.map(m => `<span class="badge">${m}</span>`).join('')}</div>
                            </div>
                        `).join('')}
                    </div>
                </div></div>
            `;
            const photoItin = formData.dynamic_photos?.['photo_itin_int_' + block.id] || [];
            const photoEmpl = formData.dynamic_photos?.['photo_itin_ext_' + block.id] || [];
            const blockPhotos = [...photoItin, ...photoEmpl];
            
            pages += renderGallery(blockPhotos, `MOICP : ${block.title || '-'}`);
        });

        // BLOCS EFFRACTION (ORDRE FINAL ARTICULATION)
        (formData.effraction_blocks || []).forEach(block => {
            const photoMeta = formData.dynamic_photos?.['photo_effrac_' + block.id]?.[0];
            const doorPhotoSrc = photoMeta ? photosBase64[photoMeta.id] : null;
            const tools = photoMeta ? JSON.parse(photoMeta.tools || '[]') : [];

            pages += `
                <div class="pdf-page">
                    <h2>Articulation : EFFRACTION - ${block.title || '-'}</h2>
                    <div style="display: flex; gap: 15px; align-items: start;">
                        ${doorPhotoSrc ? `
                            <div style="width: 75mm; border: 2px solid ${colors.accent}; border-radius: 8px; overflow: hidden; flex-shrink: 0; position:相对;">
                                <img src="${doorPhotoSrc}" style="width: 100%; display: block;">
                                <div class="photo-caption" style="display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; padding: 5px;">
                                    ${tools.length > 0 ? tools.map(t => `<span class="tool-badge">${t}</span>`).join('') : 'CARACTÉRISTIQUES PORTE'}
                                </div>
                            </div>
                        ` : ''}
                        <div style="flex: 1;">
                            <div class="card" style="padding: 10px;">
                                <h3>Caractéristiques Techniques</h3>
                                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 0.9em;">
                                    <div><span class="label">Structure</span> ${block.structure || '-'}</div>
                                    <div><span class="label">Serrurerie</span> ${block.serrurerie || '-'}</div>
                                    <div><span class="label">Environnement</span> ${block.environnement || '-'}</div>
                                    <div><span class="label">Bâti à Bâti</span> ${block.bati_a_bati || '-'} mm</div>
                                    <div><span class="label">Dormant à Dormant</span> ${block.dormant_a_dormant || '-'} mm</div>
                                    <div><span class="label">Prof. Linteaux</span> ${block.prof_linteaux || '-'} mm</div>
                                    <hr style="grid-column: span 2; border: 0; border-top: 1px dashed ${colors.border}; margin: 5px 0;">
                                    <div><span class="label">H. Porte</span> ${block.h_porte || '-'}</div>
                                    <div><span class="label">H. Marche</span> ${block.h_marche || '-'}</div>
                                    <div style="grid-column: span 2;"><span class="label">Prof. Bâti</span> ${block.prof_bati || '-'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="card" style="margin-top: 15px;">
                        <h3>Hypothèses d'Effraction</h3>
                        <table style="font-size: 0.85em; table-layout: auto;">
                            <thead>
                                <tr>
                                    <th>Hypothèse</th>
                                    <th>Technique / Moyen</th>
                                    <th>Dégagement</th>
                                    <th>Assaut</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(block.hypotheses || []).length > 0 ? block.hypotheses.map(h => `
                                    <tr>
                                        <td style="font-weight: bold; color:${colors.accent}">${h.title || h.id}</td>
                                        <td>${h.effrac || '-'}</td>
                                        <td>${h.degag || '-'}</td>
                                        <td>${h.assaut || '-'}</td>
                                    </tr>
                                `).join('') : '<tr><td colspan="4">Aucune hypothèse saisie</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            // On inclut TOUTES les photos dans la galerie, même si la première est déjà en vignette
            const blockPhotos = formData.dynamic_photos?.['photo_effrac_' + block.id] || [];
            pages += renderGallery(blockPhotos, `Effraction : ${block.title || '-'}`);
        });

        // --- SECTION DE RATTRAPAGE: PHOTOS ORPHELINES ---
        const renderedPhotoIds = new Set();
        // Marquer toutes les photos déjà traitées
        if (formData.adversaries) {
            formData.adversaries.forEach(adv => {
                (formData.dynamic_photos?.[`photo_main_${adv.id}`] || []).forEach(p => renderedPhotoIds.add(p.id));
                (formData.dynamic_photos?.[`photo_extra_${adv.id}`] || []).forEach(p => renderedPhotoIds.add(p.id));
                (formData.dynamic_photos?.[`photo_renforts_${adv.id}`] || []).forEach(p => renderedPhotoIds.add(p.id));
            });
        }
        (formData.zmspcp_blocks || []).forEach(b => {
            (formData.dynamic_photos?.['photo_bapteme_' + b.id] || []).forEach(p => renderedPhotoIds.add(p.id));
            (formData.dynamic_photos?.['photo_empl_ao_' + b.id] || []).forEach(p => renderedPhotoIds.add(p.id));
        });
        (formData.moicp_blocks || []).forEach(b => {
            (formData.dynamic_photos?.['photo_itin_int_' + b.id] || []).forEach(p => renderedPhotoIds.add(p.id));
            (formData.dynamic_photos?.['photo_itin_ext_' + b.id] || []).forEach(p => renderedPhotoIds.add(p.id));
        });
        (formData.effraction_blocks || []).forEach(b => {
            (formData.dynamic_photos?.['photo_effrac_' + b.id] || []).forEach(p => renderedPhotoIds.add(p.id));
        });
        // Marquer la logistique comme traitée
        (formData.dynamic_photos?.['photo_container_transport_pr_preview_container'] || []).forEach(p => renderedPhotoIds.add(p.id));
        (formData.dynamic_photos?.['photo_container_transport_domicile_preview_container'] || []).forEach(p => renderedPhotoIds.add(p.id));

        // Collecter les orphelines (Baptême Global, Transports, etc.)
        const orphanPhotos = [];
        for (const key in formData.dynamic_photos) {
            if (key === 'photo_logo_unite' || key === 'custom_bg_preview_container' || key === 'custom_pdf_background') continue;
            formData.dynamic_photos[key].forEach(p => {
                if (!renderedPhotoIds.has(p.id)) {
                    orphanPhotos.push(p);
                    renderedPhotoIds.add(p.id);
                }
            });
        }
        
        if (orphanPhotos.length > 0) {
            pages += renderGallery(orphanPhotos, "AUTRES PRISES DE VUE (SITUATION/LOGISTIQUE)");
        }

        // --- PAGE PATRACDVR ---
        const renderPatracdvr = () => {
            const allMembers = (formData.patracdvr_rows || []).flatMap(row => 
                row.members.map((m, idx) => ({ ...m, vehicle: idx === 0 ? row.vehicle : '', count: row.members.length, isFirst: idx === 0 }))
            );

            if (allMembers.length === 0) return '';
            
            const MAX_MEMBERS_PER_PAGE = 12;
            let patracPages = '';
            
            for (let i = 0; i < allMembers.length; i += MAX_MEMBERS_PER_PAGE) {
                const batch = allMembers.slice(i, i + MAX_MEMBERS_PER_PAGE);
                patracPages += `
                    <div class="pdf-page">
                        <h2>7. RÉCAPITULATIF PATRACDVR ${allMembers.length > MAX_MEMBERS_PER_PAGE ? `(Partie ${Math.floor(i/MAX_MEMBERS_PER_PAGE)+1})` : ''}</h2>
                        <div class="card" style="padding: 2px; height: 170mm; overflow: hidden; display: flex; flex-direction: column;">
                            <table class="patracdvr-table" style="width: 100%; table-layout: fixed;">
                                <thead>
                                    <tr>
                                        <th style="width:22mm;">VL</th>
                                        <th style="width:18mm;">PAX</th>
                                        <th style="width:20mm;">CELLULE</th>
                                        <th style="width:28mm;">FONCTION</th>
                                        <th style="width:18mm;">PPALE</th>
                                        <th style="width:18mm;">SEC.</th>
                                        <th style="width:14mm;">AFIS</th>
                                        <th style="width:35mm;">EQPT/GREN.</th>
                                        <th style="width:10mm;">DIR</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${batch.map(m => `
                                        <tr>
                                            <td style="font-weight: bold; background: ${m.vehicle ? colors.header : 'transparent'}; text-align: center; font-size: 1em;">${m.vehicle || ''}</td>
                                            <td style="font-weight: bold;">${m.trigramme || '-'}</td>
                                            <td>${m.cellule || '-'}</td>
                                            <td>${m.fonction || '-'}</td>
                                            <td>${m.principales || '-'}</td>
                                            <td>${m.secondaires || '-'}</td>
                                            <td>${m.afis || '-'}</td>
                                            <td style="font-size: 0.8em;">${[m.equipement, m.equipement2, m.grenades, m.tenue, m.gpb].filter(v => v && v !== 'Sans').join(', ') || '-'}</td>
                                            <td class="monospaced" style="font-weight: bold; text-align: center;">${m.dir || ''}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }
            return patracPages;
        };
        pages += renderPatracdvr();

        // --- DERNIÈRE PAGE: QUESTIONS ---
        pages += `
            <div class="pdf-page" style="border:none;">
                ${bgSrc ? `<img src="${bgSrc}" class="bg-watermark">` : ''}
                <div style="flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column;">
                    <h1 style="font-size: 40pt; text-align: center; margin:0;">AVEZ-VOUS DES QUESTIONS ?</h1>
                    <div style="width: 120mm; height: 4px; background: ${colors.accent}; margin-top: 25px;"></div>
                </div>
                ${footerHtml}
            </div>
        `;

        return `
            <div class="pdf-export-container">
                ${css}
                <div class="pdf-content">
                    ${pages}
                </div>
            </div>
        `;
    }
};

window.PDFEngineV2 = PDFEngineV2;
window.downloadOiPdf = function() { PDFEngineV2.downloadOiPdf(); };
