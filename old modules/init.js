        // Configuration des membres par défaut (pour initialisation si localStorage vide)
        let memberConfig = {
            fonctions: ["Chef inter", "Chef dispo", "Chef Oscar", "Conducteur", "Chef de bord", "DE", "Cyno", "Inter", "Effrac", "AO", "Sans"],
            cellules: ["AO1", "AO2", "AO3", "AO4", "AO5", "AO6", "AO7", "AO8", "India 1", "India 2", "India 3", "India 4", "India 5", "Effrac", "Sans"],
            principales: ["UMP9", "G36", "FAP", "Sans"],
            afis: ["PIE", "LBD40", "LBD44", "Sans"],
            secondaires: ["PSA"],
            grenades: ["GENL", "MP7", "Sans"],
            equipements: ["Sans", "BBAL", "Bouclier MO", "Belier", "Lacry", "IL", "Lot 5.11", "HDR 50", "OP71", "DoorRaider", "Cintreuse"],
            equipements2: ["Sans", "Cam pieton", "Échelle", "Stop stick", "Lacry", "Cale", "IL", "Pass"],
            tenues: ["UBAS", "4S", "Bleu", "Civile", "Ghillie", "Treillis"],
            gpbs: ["GPBL", "GPBPD", "Casque Lourd", "Casque MO", "Sans"]
        };


        // NOUVEAU: Constantes pour les images de fond
        const BACKGROUND_IMAGE_LIGHT = "J.png";
        const BACKGROUND_IMAGE_DARK = "N.png";
        const BACKGROUND_IMAGE_ID = 'pdf_background_img_system'; // ID de référence pour le cache de compression

        let activeMemberId = null;
        let currentAnnotationColor = '#c0392b'; // Couleur par défaut (rouge)

        

        let currentStep = 0;
        let visitedSteps = new Set();
        const steps = Array.from(document.querySelectorAll(".wizard-step"));
        const progressSteps = Array.from(document.querySelectorAll(".wizard-progress-step"));
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const previewBtn = document.getElementById('previewBtn');
        const patracdvrContainer = document.getElementById('patracdvr_container');
        const unassignedContainer = document.getElementById('unassigned_members_container');
        const resetPatracdvrBtn = document.getElementById('resetPatracdvrBtn');
        const presentationModal = document.getElementById('presentationModal');
        const downloadPdfBtn = document.getElementById('downloadPdfBtn');
        const coherenceAlertsContainer = document.getElementById('coherence_alerts_container');
        const recapFinalisation = document.getElementById('recap_finalisation');

        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        // --- NOUVEAU: Clés de stockage isolées ---
        const LOCAL_STORAGE_KEY = 'oiFormDataLite';
        const INDEXED_DB_NAME = 'OI_GeneratorLiteDB';

        /**
         * Gère la révocation des URLs d'objets pour éviter les fuites de mémoire.
         */
        let objectUrlsCache = {};
        

        /**
         * Gestionnaire IndexedDB pour le stockage des images.
         */
        const dbManager = {
            db: null,
            // Utilisation de la clé isolée
            dbName: INDEXED_DB_NAME,
            storeName: 'images',

            init() {
                return new Promise((resolve, reject) => {
                    if (this.db) {
                        return resolve(this.db);
                    }
                    const request = indexedDB.open(this.dbName, 1);

                    request.onerror = (event) => {
                        console.error("Erreur d'ouverture de la base de données IndexedDB", event);
                        reject("Erreur IndexedDB.");
                    };

                    request.onsuccess = (event) => {
                        this.db = event.target.result;
                        resolve(this.db);
                    };

                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains(this.storeName)) {
                            db.createObjectStore(this.storeName);
                        }
                    };
                });
            },

            putItem(key, blob) {
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.put(blob, key);
                    request.onsuccess = () => resolve();
                    request.onerror = (event) => reject(event.target.error);
                });
            },

            getItem(key) {
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readonly');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.get(key);
                    request.onsuccess = (event) => resolve(event.target.result);
                    request.onerror = (event) => reject(event.target.error);
                });
            },

            deleteItem(key) {
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.delete(key);
                    request.onsuccess = () => {
                        // Révocation de l'URL si elle existe dans le cache avant suppression
                        if (objectUrlsCache[key]) {
                            URL.revokeObjectURL(objectUrlsCache[key]);
                            delete objectUrlsCache[key];
                        }
                        resolve();
                    };
                    request.onerror = (event) => reject(event.target.error);
                });
            },

            clearAllImages() {
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.clear();
                    request.onsuccess = () => {
                        cleanupObjectUrls();
                        resolve();
                    };
                    request.onerror = (event) => reject(event.target.error);
                });
            }
        };


        const displayMap = {
            'adversary_photo_preview_container': 'adversary_photo_display',
            'adversary_extra_photos_preview_container': 'adversary_extra_photos_display',
            'renforts_photo_preview_container': 'renforts_photo_display',
            'adversary_photo_preview_container_2': 'adversary_photo_display_2',
            'adversary_extra_photos_preview_container_2': 'adversary_extra_photos_display_2',
            // CORRECTION: Remplacer les conteneurs d'affichage par les conteneurs d'upload
            'photo_container_itineraire_exterieur_preview_container': 'photo_container_itineraire_exterieur_display',
            'photo_container_itineraire_interieur_preview_container': 'photo_container_itineraire_interieur_display',
            'photo_container_bapteme_terrain_preview_container': 'photo_container_bapteme_terrain_display',
            'photo_container_emplacement_ao_preview_container': 'photo_container_emplacement_ao_display',
            'photo_container_transport_pr_preview_container': null,
            'photo_container_transport_domicile_preview_container': null,
            'photo_container_cellule_effraction_preview_container': null,
        };

        
        
        
        prevBtn.addEventListener('click', () => changeStep(-1));
        nextBtn.addEventListener('click', () => changeStep(1));

        

        

        

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
        
        const quickEditMapping = {
            'Cellule': { key: 'cellules', attribute: 'cellule' },
            'Fonction': { key: 'fonctions', attribute: 'fonction' },
            'Arme P.': { key: 'principales', attribute: 'principales' },
            'Arme S.': { key: 'secondaires', attribute: 'secondaires' },
            'A.F.I.': { key: 'afis', attribute: 'afis' },
            'Grenades': { key: 'grenades', attribute: 'grenades' },
            'Équip. 1': { key: 'equipements', attribute: 'equipement' },
            'Équip. 2': { key: 'equipements2', attribute: 'equipement2' },
            'Tenue': { key: 'tenues', attribute: 'tenue' },
            'GPB': { key: 'gpbs', attribute: 'gpb' }
        };

        // NOUVEAU: Liste des attributs supportant la multi-sélection
        const multiSelectAttributes = ['fonction', 'equipement', 'equipement2', 'afis', 'gpb'];

        

        

        

        

        

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

        

        

        

        

        

        const annotationModal = document.getElementById('annotationModal');
        const canvas = document.getElementById('annotationCanvas');
        const ctx = canvas.getContext('2d');
        let baseImage = new Image();
        let annotations = [], currentTool = 'move', isDrawing = false, isDragging = false, startX, startY;
        let currentAnnotation = null, selectedAnnotation = null, dragOffsetX, dragOffsetY;
        const rotationInput = document.getElementById('rotation_input');
        let isMovingAnnotation = false;

        

        // NOUVEAU: Fonction de redimensionnement via slider
        

        

        

        

        

        // NOUVEAU: Set Color
        

        

        

        

        

        

        

        

        

        

        

        

        

        

        

        // Nouvelle fonction pour initialiser les écouteurs de drag-and-drop sur les conteneurs statiques
        

        // --- NOUVEAU: Logique Fullscreen et Thème ---

        

        

        

        

        // Logique de bascule du dock
        

        // --- Fin Logique Fullscreen et Thème ---


        document.addEventListener('DOMContentLoaded', async () => {

            try {
                // Initialiser IndexedDB en premier
                await dbManager.init();
            } catch (e) {
                console.error(e);
                return;
            }

            await loadFormData();

            // Initialisation du thème
            const isDarkMode = localStorage.getItem('theme') === 'dark' || !localStorage.getItem('theme');
            if (!isDarkMode) { document.body.classList.replace('dark-mode', 'light-mode'); }
            document.getElementById('darkModeIcon').textContent = isDarkMode ? 'nightlight' : 'clear_day';

            // Initialisation du dock
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
                updateFullscreenIcon(); // S'assurer que l'icône initiale est correcte
            }
            if (darkModeToggleBtn) {
                darkModeToggleBtn.addEventListener('click', handleThemeToggle);
            }

            // Logique de bascule du dock
            if (dockToggleBtn) {
                dockToggleBtn.addEventListener('click', toggleDock);
                // Charger l'état enregistré du dock
                if (localStorage.getItem('dockCollapsed') === 'true') {
                    dock.classList.add('collapsed');
                    document.querySelector('#dockToggleBtn .material-symbols-outlined').textContent = 'expand_less';
                }
            }

            // Gestion du Reset via le Dock
            const resetOptionsModal = document.getElementById('resetOptionsModal');
            const resetMenuBtn = document.getElementById('resetMenuBtn');
            const cancelResetBtn = document.getElementById('cancelResetBtn');
            const resetAllBtn = document.getElementById('resetAllBtn');
            const resetPageBtn = document.getElementById('resetPageBtn');

            if (resetMenuBtn) resetMenuBtn.addEventListener('click', () => resetOptionsModal.showModal());
            if (cancelResetBtn) cancelResetBtn.addEventListener('click', () => resetOptionsModal.close());

            if (resetAllBtn) {
                resetAllBtn.addEventListener('click', async () => {
                    if (confirm("Attention: Toutes les données et photos seront définitivement effacées (Sauf le PATRACDVR).")) {
                        // Sauvegarder le PATRACDVR actuel
                        const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
                        let patracdvrData = {};
                        if (savedData) {
                            try {
                                const parsed = JSON.parse(savedData);
                                if (parsed.patracdvr_rows) patracdvrData.patracdvr_rows = parsed.patracdvr_rows;
                                if (parsed.patracdvr_unassigned) patracdvrData.patracdvr_unassigned = parsed.patracdvr_unassigned;
                            } catch (e) { console.error(e); }
                        }

                        localStorage.removeItem(LOCAL_STORAGE_KEY);
                        await dbManager.clearAllImages();

                        // Restaurer le PATRACDVR
                        if (Object.keys(patracdvrData).length > 0) {
                            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(patracdvrData));
                        }

                        location.reload();
                    }
                    resetOptionsModal.close();
                });
            }

            if (resetPageBtn) {
                resetPageBtn.addEventListener('click', async () => {
                    if (confirm("Réinitialiser uniquement les champs de la page active ?")) {
                        const activeStep = document.querySelector('.wizard-step.active');
                        if (activeStep) {
                            activeStep.querySelectorAll('input:not([type="file"]), textarea, select').forEach(el => {
                                if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
                                else el.value = '';
                            });
                            activeStep.querySelectorAll('.dynamic-list-item').forEach(el => el.remove());
                            activeStep.querySelectorAll('.chip-btn.selected').forEach(el => el.classList.remove('selected'));

                            const images = activeStep.querySelectorAll('.image-preview-item img');
                            for (const img of images) { await removeImage(img.id, img.closest('.image-preview-item')); }

                            if (activeStep.querySelector('#patracdvr_container')) {
                                document.getElementById('patracdvr_container').innerHTML = '';
                                document.getElementById('unassigned_members_container').innerHTML = '';
                                activeMemberId = null;
                                document.getElementById('quickEditPanel').style.display = 'none';
                            }
                            saveFormData();
                            refreshArticulationFromPatracdvr();
                        }
                    }
                    resetOptionsModal.close();
                });
            }

            // Gestion Import/Export Session via Fichier
            const importSessionBtn = document.getElementById('importSessionBtn');
            const exportSessionBtn = document.getElementById('exportSessionBtn');
            const sessionFileInput = document.getElementById('sessionFileInput');

            if (importSessionBtn && sessionFileInput) {
                importSessionBtn.addEventListener('click', () => sessionFileInput.click());
                sessionFileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const json = event.target.result;
                            JSON.parse(json); // Validation JSON
                            localStorage.setItem(LOCAL_STORAGE_KEY, json);
                            alert("Session importée avec succès. Rechargement...");
                            location.reload();
                        } catch (err) {
                            alert("Erreur: Fichier de session invalide.");
                            console.error(err);
                        }
                    };
                    reader.readAsText(file);
                    e.target.value = '';
                });
            }

            if (exportSessionBtn) {
                exportSessionBtn.addEventListener('click', () => {
                    saveFormData();
                    const data = localStorage.getItem(LOCAL_STORAGE_KEY);
                    if (data) {
                        const blob = new Blob([data], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `OI_Session_${new Date().toISOString().slice(0, 10)}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    } else {
                        alert("Aucune donnée à exporter.");
                    }
                });
            }

            const importJsonConfigBtn = document.getElementById('importJsonConfigBtn');
            const jsonConfigInput = document.getElementById('jsonConfigInput');

            if (importJsonConfigBtn) {
                importJsonConfigBtn.addEventListener('click', () => jsonConfigInput.click());
            }

            if (jsonConfigInput) {
                jsonConfigInput.addEventListener('change', (event) => {
                    const file = event.target.files[0];
                    if (!file) { return; }
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        try {
                            const jsonContent = e.target.result;
                            const config = JSON.parse(jsonContent);
                            if (config && (Array.isArray(config.members) || config.options)) {
                                cleanupObjectUrls();
                                loadConfigObject(config);
                            } else { alert("Fichier JSON invalide."); }
                        } catch (err) { alert("Erreur de lecture."); console.error(err); }
                    };
                    reader.readAsText(file);
                    event.target.value = null;
                });
            }

            // Réinitialisation/Chargement des chips après loadFormData
            // Réinitialisation/Chargement des chips après loadFormData (Les adversaires sont gérés dynamiquement dans loadFormData via addAdversary)
            // initChipContainer('etat_esprit_container', formData.etat_esprit_list || []);
            // initChipContainer('volume_adversaire_container', formData.volume_list || []);
            // initChipContainer('etat_esprit_container_2', formData.etat_esprit_list_2 || []);
            // initChipContainer('volume_adversaire_container_2', formData.volume_list_2 || []);

            // CORRECTION: setupQuickEditPanel est maintenant appelé dans loadFormData
            // setupQuickEditPanel(); 
            initializeDragDropListeners(); // Initialiser les écouteurs de drop statiques

            // Écouteur pour les collapsibles
            document.querySelector('.container').addEventListener('click', (event) => {
                const header = event.target.closest('.collapsible-header');
                if (header) { const container = header.parentElement; if (container && container.classList.contains('collapsible-container')) { container.classList.toggle('open'); } }
            });

            // Écouteur pour le bouton de sauvegarde du panneau d'édition rapide (desktop)
            document.getElementById('saveQuickEditBtn').addEventListener('click', saveQuickEditChanges);

            resetPatracdvrBtn.addEventListener('click', () => {
                // Utilisation d'un `confirm` natif
                if (confirm("Voulez-vous vraiment effacer TOUS les véhicules et membres du PATRACDVR et vider la sauvegarde locale des membres ?")) {
                    patracdvrContainer.innerHTML = '';
                    unassignedContainer.innerHTML = '';
                    saveFormData();
                    // Fermer le panneau d'édition si un membre est actif
                    activeMemberId = null;
                    document.getElementById('quickEditPanel').style.display = 'none';
                    alert("PATRACDVR réinitialisé.");
                }
            });



            document.getElementById('addManualVehicleBtn').addEventListener('click', addManualVehicle);
            document.getElementById('addManualMemberBtn').addEventListener('click', addManualMember);

            // Écouteurs pour les boutons d'articulation MOICP / ZMSPCP / EFFRACTION
            document.getElementById('addMoicpBtn').addEventListener('click', () => addMoicp());
            document.getElementById('addZmspcpBtn').addEventListener('click', () => addZmspcp());
            document.getElementById('addEffractionBtn').addEventListener('click', () => addEffraction());

            // NOUVEAU: Écouteur délégué pour le panneau Quick Edit avec MULTI-SELECT
            document.getElementById('quickEditPanel').addEventListener('click', (event) => {
                event.stopPropagation();
                const target = event.target;
                const quickEditButton = target.closest('.quick-edit-btn');

                if (quickEditButton && activeMemberId) {
                    const activeMember = document.getElementById(activeMemberId);
                    if (!activeMember) return;
                    const attribute = quickEditButton.dataset.attribute;
                    const value = quickEditButton.dataset.value;

                    if (multiSelectAttributes.includes(attribute)) {
                        // Logique Multi-Select
                        let currentValues = activeMember.dataset[attribute] ? activeMember.dataset[attribute].split(', ') : [];
                        // Si "Sans" est sélectionné, on vide. Si une valeur est ajoutée, on enlève "Sans".
                        if (value === 'Sans') {
                            currentValues = ['Sans'];
                        } else {
                            if (currentValues.includes('Sans')) currentValues = [];
                            if (currentValues.includes(value)) {
                                currentValues = currentValues.filter(v => v !== value);
                            } else {
                                currentValues.push(value);
                            }
                        }
                        if (currentValues.length === 0) currentValues = ['Sans'];
                        activeMember.dataset[attribute] = currentValues.join(', ');

                        // Mise à jour visuelle du bouton
                        quickEditButton.classList.toggle('selected', currentValues.includes(value));
                        // Décocher "Sans" si autre chose sélectionné
                        if (value !== 'Sans') {
                            const group = quickEditButton.parentElement;
                            const sansBtn = Array.from(group.children).find(b => b.textContent === 'Sans');
                            if (sansBtn) sansBtn.classList.remove('selected');
                        } else {
                            const group = quickEditButton.parentElement;
                            Array.from(group.children).forEach(b => { if (b !== quickEditButton) b.classList.remove('selected'); });
                        }

                    } else {
                        // Logique Single Select (ex: Tenue, Cellule)
                        activeMember.dataset[attribute] = value;

                        // Logique de cohérence de base
                        if (attribute === 'cellule' && value === 'Sans') {
                            activeMember.dataset.fonction = 'Sans';
                        }
                        if (attribute === 'fonction' && value !== 'Sans' && activeMember.dataset.cellule === 'Sans') {
                            activeMember.dataset.cellule = 'India 1';
                        }

                        // Mise à jour la sélection visuelle dans le panneau
                        const group = quickEditButton.parentElement;
                        group.querySelectorAll('.quick-edit-btn').forEach(btn => btn.classList.remove('selected'));
                        quickEditButton.classList.add('selected');
                    }

                    // Mettre à jour les visuels
                    updateMemberButtonVisuals(activeMember);

                    // CONFORMITÉ: Sauvegarde après modification du quick edit panel
                    saveFormData();
                }
            });

            // Écouteur pour la mise à jour du trigramme (dans le panneau desktop)
            document.getElementById('quickEditPanel').addEventListener('input', (e) => {
                if (activeMemberId) {
                    const member = document.getElementById(activeMemberId);
                    if (e.target.id === 'quick_edit_trigramme_input') {
                        member.dataset.trigramme = e.target.value.toUpperCase();
                        updateMemberButtonVisuals(member);
                        saveFormData();
                    } else if (e.target.id === 'quick_edit_dir_input') { // NOUVEAU: DIR
                        member.dataset.dir = e.target.value;
                        updateMemberButtonVisuals(member);
                        saveFormData();
                    }
                }
            });


            const quickEditModal = document.getElementById('quickEditModal');
            document.getElementById('quick_modal_closeBtn').addEventListener('click', () => {
                quickEditModal.close();
                // Désélectionner le membre actif si la modale est fermée
                if (activeMemberId) {
                    const oldActive = document.getElementById(activeMemberId);
                    if (oldActive) oldActive.classList.remove('member-active');
                    activeMemberId = null;
                }
            });
            // Écouteur délégué pour les clics dans la modale (mobile) - Adapté pour Multi-select
            quickEditModal.addEventListener('click', (event) => {
                const target = event.target.closest('.quick-edit-btn');
                if (!target || !activeMemberId) return;

                const activeMember = document.getElementById(activeMemberId);
                if (!activeMember) return;

                const attribute = target.dataset.attribute;
                const value = target.dataset.value;

                if (multiSelectAttributes.includes(attribute)) {
                    // Logique Multi-Select
                    let currentValues = activeMember.dataset[attribute] ? activeMember.dataset[attribute].split(', ') : [];
                    if (value === 'Sans') {
                        currentValues = ['Sans'];
                    } else {
                        if (currentValues.includes('Sans')) currentValues = [];
                        if (currentValues.includes(value)) {
                            currentValues = currentValues.filter(v => v !== value);
                        } else {
                            currentValues.push(value);
                        }
                    }
                    if (currentValues.length === 0) currentValues = ['Sans'];
                    activeMember.dataset[attribute] = currentValues.join(', ');

                    target.classList.toggle('selected', currentValues.includes(value));
                    if (value !== 'Sans') {
                        const group = target.parentElement;
                        const sansBtn = Array.from(group.children).find(b => b.textContent === 'Sans');
                        if (sansBtn) sansBtn.classList.remove('selected');
                    } else {
                        const group = target.parentElement;
                        Array.from(group.children).forEach(b => { if (b !== target) b.classList.remove('selected'); });
                    }

                } else {
                    activeMember.dataset[attribute] = value;
                    if (attribute === 'cellule' && value === 'Sans') {
                        activeMember.dataset.fonction = 'Sans';
                    }
                    if (attribute === 'fonction' && value !== 'Sans' && activeMember.dataset.cellule === 'Sans') {
                        activeMember.dataset.cellule = 'India 1';
                    }
                    const group = target.closest('.quick-edit-options');
                    if (group) {
                        group.querySelectorAll('.quick-edit-btn').forEach(btn => btn.classList.remove('selected'));
                    }
                    target.classList.add('selected');
                }

                updateMemberButtonVisuals(activeMember);
                saveFormData();
            });

            // --- Écouteurs de l'outil d'annotation ---
            canvas.addEventListener('mousedown', handleDrawStart); canvas.addEventListener('mousemove', handleDrawMove);
            canvas.addEventListener('mouseup', handleDrawEnd); canvas.addEventListener('mouseout', handleDrawEnd);
            canvas.addEventListener('touchstart', handleDrawStart, { passive: false });
            canvas.addEventListener('touchmove', handleDrawMove, { passive: false });
            canvas.addEventListener('touchend', handleDrawEnd);

            document.querySelectorAll('.toolbar-main-tools .tool-btn').forEach(btn => {
                btn.addEventListener('click', () => { const toolId = btn.id.split('_')[1]; if (['move', 'location', 'arrow', 'box', 'text'].includes(toolId)) setActiveTool(toolId); });
            });
            document.getElementById('tool_reset').addEventListener('click', () => {
                annotations = [];
                selectedAnnotation = null;
                setContextualTools(null);
                redrawCanvas();
                document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(annotations);
                saveFormData();
            });
            document.getElementById('annotation_cancel').addEventListener('click', () => annotationModal.close());
            document.getElementById('annotation_save').addEventListener('click', () => {
                const targetId = annotationModal.dataset.targetPreviewId;
                const previewImg = document.getElementById(targetId);
                if (previewImg) {
                    if (selectedAnnotation) {
                        // S'assurer de désélectionner pour enlever le cadre de sélection avant de sauver ? Non, on sauve les données brutes.
                    }
                    previewImg.dataset.annotations = JSON.stringify(annotations);

                    // NOUVEAU: Mettre à jour l'aperçu visuel immédiatement
                    if (annotations.length > 0) {
                        // Désélectionner pour le rendu propre
                        selectedAnnotation = null;
                        setContextualTools(null);
                        redrawCanvas();

                        canvas.toBlob(blob => {
                            if (blob) {
                                const newUrl = URL.createObjectURL(blob);
                                // Si l'ancienne src était un blob généré (et pas l'original), on peut le révoquer pour nettoyer
                                if (previewImg.src.startsWith('blob:') && previewImg.src !== objectUrlsCache[targetId]) {
                                    URL.revokeObjectURL(previewImg.src);
                                }
                                previewImg.src = newUrl;
                            }
                        });
                    } else {
                        // Si plus d'annotations, remettre l'image originale
                        if (objectUrlsCache[targetId]) {
                            previewImg.src = objectUrlsCache[targetId];
                        }
                    }
                }
                saveFormData();
                annotationModal.close();
            });

            rotationInput.addEventListener('change', updateAnnotationRotation);
            document.getElementById('resize_w').addEventListener('input', (e) => resizeSelected(e.target.value, null));
            document.getElementById('resize_h').addEventListener('input', (e) => resizeSelected(null, e.target.value));
            document.getElementById('stroke_width_edit').addEventListener('input', (e) => updateStrokeWidth(e.target.value));
            document.getElementById('text_size_edit').addEventListener('input', (e) => updateTextSize(e.target.value));
            document.getElementById('circle_text').addEventListener('input', (e) => updateZoneText(e.target.value));
            document.getElementById('circle_opacity').addEventListener('input', (e) => updateZoneOpacity(e.target.value));

            document.getElementById('delete_btn').addEventListener('click', () => {
                if (selectedAnnotation) {
                    annotations = annotations.filter(ann => ann !== selectedAnnotation);
                    selectedAnnotation = null;
                    setContextualTools(null);
                    redrawCanvas();
                    document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(annotations);
                    saveFormData();
                }
            });
            // Utilisation de `prompt` natif pour la saisie de texte simple
            document.getElementById('edit_text_btn').addEventListener('click', () => {
                if (selectedAnnotation && (selectedAnnotation.type === 'location' || selectedAnnotation.type === 'text')) {
                    const newText = prompt('Modifier texte:', selectedAnnotation.text);
                    if (newText !== null) {
                        selectedAnnotation.text = newText;
                        redrawCanvas();
                        document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(annotations);
                        saveFormData();
                    }
                }
            });

            // CORRECTION: Utiliser la délégation d'événement sur le document pour dragstart/dragend
            document.addEventListener('dragstart', e => {
                // On autorise le drag SI c'est un élément .draggable, MÊME si c'est un bouton
                // On empêche le drag seulement si on clique sur un bouton "interne" non draggable (ex: croix de suppression si elle existait dans le bouton)

                const target = e.target.closest('.draggable');

                if (!target) {
                    // Si ce n'est pas un élément draggable, et que c'est un bouton "classique" (ex: bouton Ajouter), on bloque le drag natif
                    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                        e.preventDefault();
                        return;
                    }
                    return;
                }

                // Si on arrive ici, c'est un élément .draggable
                e.dataTransfer.setData('text/plain', target.id);
                setTimeout(() => target.classList.add('dragging'), 0);
            });

            document.addEventListener('dragend', (e) => {
                const draggedItem = e.target.closest('.draggable');
                if (draggedItem) {
                    draggedItem.classList.remove('dragging');
                    // CONFORMITÉ: Sauvegarde après fin du glisser-déposer (l'ordre peut avoir changé)
                    saveFormData();
                }
            });

            

            

            previewBtn.addEventListener('click', openPresentationMode);
            downloadPdfBtn.addEventListener('click', downloadOiPdf);

            if (document.getElementById('closePresentationModalBtn')) {
                document.getElementById('closePresentationModalBtn').addEventListener('click', () => {
                    if (presentationModal) {
                        if (typeof presentationModal.close === 'function') {
                            presentationModal.close();
                        } else {
                            presentationModal.style.display = 'none';
                        }
                    }
                    // Désélectionner le membre actif si la modale est fermée
                    if (activeMemberId) {
                        const oldActive = document.getElementById(activeMemberId);
                        if (oldActive) oldActive.classList.remove('member-active');
                        activeMemberId = null;
                        if (window.innerWidth >= 768) {
                            document.getElementById('quickEditPanel').style.display = 'none';
                        }
                    }
                });
            }

            const savedStep = localStorage.getItem('oiWizardStep');
            if (savedStep !== null) {
                const parsedStep = parseInt(savedStep, 10);
                if (!isNaN(parsedStep) && parsedStep >= 0 && parsedStep < steps.length) {
                    currentStep = parsedStep;
                }
            }

            showStep(currentStep);

        });

        // --- PDF GENERATION LOGIC ---

        // NOUVEAU: Fonction pour charger l'image via fetch et la convertir en ArrayBuffer (pour la compression)
        

        

        

        

        // --- PRESENTATION HTML LOGIC ---

        