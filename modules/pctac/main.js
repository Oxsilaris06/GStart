import { Storage } from './storage.js';
import { UI } from './ui.js';
import { LogManager } from './logManager.js';
import { PdfExport } from './pdfExport.js';
import { Utils } from './utils.js';
import { CUSTOM_PAX_KEY, ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY } from './config.js';

/**
 * Point d'entrée principal du module PC TAC
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialisation UI
    UI.initElements();
    UI.initPaxModeAndColors();
    UI.updateTimeInput();
    setInterval(() => UI.updateTimeInput(), 60000);

    // Charger les données initiales
    const initialLogs = Storage.loadLogData();
    UI.renderLogTable(initialLogs);

    // Initialiser les écouteurs d'onglets
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view;
            UI.switchMainView(viewId);
        });
    });

    // Charger la dernière vue
    const lastView = localStorage.getItem('lastView') || 'view-main-courante';
    UI.switchMainView(lastView);

    // Initialiser le thème
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.replace('dark-mode', 'light-mode');
        if (UI.elements.darkModeIcon) UI.elements.darkModeIcon.textContent = 'clear_day';
    }

    // --- ÉVÉNEMENTS ---

    // Soumission Log
    if (UI.elements.logForm) {
        UI.elements.logForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = {
                mode: UI.elements.paxModeInput.value,
                pax: UI.elements.paxInput.value,
                paxColor: UI.elements.paxInput.dataset.customColor || UI.elements.paxCustomColorInput.value,
                heure: UI.elements.heureInput.value,
                lieu: UI.elements.lieuInput.value,
                freePax: UI.elements.freePaxInput ? UI.elements.freePaxInput.value : '',
                remarques: UI.elements.remarquesInput.value
            };
            const newEntry = LogManager.addEntry(formData);
            if (newEntry) {
                UI.renderLogTable(Storage.loadLogData());
                UI.elements.remarquesInput.value = '';
                UI.elements.remarquesInput.focus();
                UI.updateTimeInput(true);
            }
        });
    }

    // Création Intervenant Personnalisé
    const confirmCreatePaxBtn = document.getElementById('confirmCreatePaxBtn');
    if (confirmCreatePaxBtn) {
        confirmCreatePaxBtn.onclick = () => {
            const name = document.getElementById('new_pax_name').value.trim();
            const color = document.getElementById('new_pax_color_val').value;
            if (!name) return alert("Nom requis");
            const list = Storage.loadCollection(CUSTOM_PAX_KEY);
            list.push({ id: Date.now().toString(), name, color });
            Storage.saveCollection(CUSTOM_PAX_KEY, list);
            UI.renderCustomPaxOptions();
            UI.hideCreatePaxModal();
        };
    }

    // Gestion des collections génériques (Adversaires, Otages, Amis, Photos)
    const forms = [
        { 
            id: 'adversary-form', 
            key: ADVERSARIES_KEY, 
            view: 'view-adversaires', 
            fields: ['adv_nom', 'adv_prenom', 'adv_dob', 'adv_lien', 'adv_antecedents', 'adv_attitude', 'adv_substance', 'adv_arme', 'adv_photo'], 
            map: f => ({ nom: f[0], prenom: f[1], dob: f[2], lien: f[3], antecedents: f[4], attitude: f[5], substance: f[6], armes: f[7], photo: f[8] }) 
        },
        { 
            id: 'hostage-form', 
            key: HOSTAGES_KEY, 
            view: 'view-otages', 
            fields: ['hostage_nom', 'hostage_prenom', 'hostage_dob', 'hostage_lien', 'hostage_etat', 'hostage_blessure', 'hostage_photo'], 
            map: f => ({ nom: f[0], prenom: f[1], dob: f[2], lien: f[3], etat: f[4], blessures: f[5], photo: f[6] }) 
        },
        { id: 'friend-form', key: FRIENDS_KEY, view: 'view-amis', fields: ['friend_nom', 'friend_prenom', 'friend_unite', 'friend_tph', 'friend_mission'], map: f => ({ nom: f[0], prenom: f[1], unite: f[2], tph: f[3], mission: f[4] }) }
    ];

    forms.forEach(cfg => {
        const f = document.getElementById(cfg.id);
        if (f) {
            f.addEventListener('submit', (e) => {
                e.preventDefault();
                const values = cfg.fields.map(id => {
                    const el = document.getElementById(id);
                    if (el.type === 'file') return el.dataset.base64 || '';
                    return el.value;
                });
                
                if (values.some(v => v && v.trim !== '')) {
                    const list = Storage.loadCollection(cfg.key);
                    const itemId = Date.now().toString();
                    list.push({ id: itemId, ...cfg.map(values) });
                    Storage.saveCollection(cfg.key, list);
                    
                    cfg.fields.forEach(id => {
                        const el = document.getElementById(id);
                        if (el.type === 'file') { el.value = ''; delete el.dataset.base64; }
                        else el.value = '';
                    });

                    if (cfg.view === 'view-adversaires') {
                        UI.renderAdversaries();
                        // Copie automatique vers Photos pour les adversaires
                        const adversary = cfg.map(values);
                        if (adversary.photo) {
                            const photoList = Storage.loadCollection(PHOTOS_KEY);
                            const syncId = itemId + "_sync";
                            photoList.push({
                                id: syncId,
                                title: `${adversary.nom} ${adversary.prenom}`,
                                data: adversary.photo,
                                category: 'neutralized',
                                status: 'active'
                            });
                            Storage.saveCollection(PHOTOS_KEY, photoList);
                            UI.renderPhotos();
                        }
                    }
                    if (cfg.view === 'view-otages') {
                        UI.renderHostages();
                        // Copie automatique vers Photos pour les otages avec statut intelligent
                        const hostage = cfg.map(values);
                        if (hostage.photo) {
                            const photoList = Storage.loadCollection(PHOTOS_KEY);
                            
                            // Logique de statut basée sur les blessures
                            const b = (hostage.blessures || '').toLowerCase().trim();
                            // Termes considérés comme "Sain / OK"
                            const rasTerms = ['ras', '-', '/', 'rien', 'neant', 'néant', 'idemne', 'indemne', 'aucune', '0', 'ok'];
                            const isRas = rasTerms.some(term => b === term || b === term + '.');
                            
                            let status = 'ok';
                            // Si le champ est rempli et n'est pas RAS, ou s'il contient "inconnu" -> Préoccupant
                            if ((b !== '' && !isRas) || b.includes('inconnu') || b === '?') {
                                status = 'preoccupant';
                            }
                            
                            // Priorité aux états graves
                            if (b.includes('blesse') || b.includes('blessé') || b.includes('grave')) status = 'blesse';
                            if (b.includes('mort') || b.includes('dcd') || b.includes('decede') || b.includes('décédé')) status = 'dcd';

                            const syncId = itemId + "_sync";
                            photoList.push({
                                id: syncId,
                                title: `${hostage.nom} ${hostage.prenom}`,
                                data: hostage.photo,
                                category: 'hostage',
                                status: status
                            });
                            Storage.saveCollection(PHOTOS_KEY, photoList);
                            UI.renderPhotos();
                        }
                    }
                    if (cfg.view === 'view-amis') UI.renderFriends();
                }
            });
        }
    });

    // Gestion base64 pour les inputs file d'adversaire/otage + aperçu miniature
    ['adv_photo', 'hostage_photo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    try {
                        const compressedData = await Utils.compressImage(file, 800, 800, 0.7);
                        el.dataset.base64 = compressedData;
                        // Mise à jour de la miniature dans le formulaire
                        const previewId = id === 'adv_photo' ? 'adv_photo_preview' : 'hostage_photo_preview';
                        const preview = document.getElementById(previewId);
                        if (preview) {
                            preview.innerHTML = `<img src="${compressedData}" style="width: 100%; height: 100%; object-fit: cover;">`;
                        }
                    } catch (err) {
                        console.error("Erreur de compression:", err);
                    }
                }
            });
        }
    });

    // Formulaire Photo spécifique
    if (UI.elements.photoForm) {
        UI.elements.photoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('photo_title').value.trim();
            const fileInput = document.getElementById('photo_file');
            const categorySelect = document.getElementById('photo_category');
            const category = categorySelect ? categorySelect.value : 'other';
            if (!title || !fileInput.files[0]) return alert("Titre et fichier requis");

            try {
                const compressedData = await Utils.compressImage(fileInput.files[0], 1024, 1024, 0.7);
                const list = Storage.loadCollection(PHOTOS_KEY);
                list.push({ id: Date.now().toString(), title, data: compressedData, category, status: 'active' });
                Storage.saveCollection(PHOTOS_KEY, list);
                document.getElementById('photo_title').value = '';
                fileInput.value = '';
                UI.renderPhotos();
            } catch (err) {
                console.error("Erreur de compression/sauvegarde:", err);
                alert("Erreur lors de l'ajout de la photo. Il est possible que la mémoire soit pleine.");
            }
        });
    }

    // --- EXPOSITIONS GLOBALES ---
    window.deleteLogEntry = (id) => {
        LogManager.deleteEntry(id);
        UI.renderLogTable(Storage.loadLogData());
    };

    window.deleteCollectionItem = (key, id, viewId) => {
        if (!confirm('Confirmer la suppression ?')) return;
        const list = Storage.loadCollection(key).filter(item => item.id !== id);
        Storage.saveCollection(key, list);
        
        // Suppression en cascade pour les photos synchronisées
        if (viewId === 'view-adversaires' || viewId === 'view-otages') {
            const photoKey = 'pcTacPhotos';
            const photos = Storage.loadCollection(photoKey);
            const syncId = id + "_sync";
            const filteredPhotos = photos.filter(p => p.id !== syncId);
            Storage.saveCollection(photoKey, filteredPhotos);
        }

        if (viewId === 'view-adversaires') UI.renderAdversaries();
        if (viewId === 'view-otages') UI.renderHostages();
        if (viewId === 'view-amis') UI.renderFriends();
        if (viewId === 'view-photos') UI.renderPhotos();
    };

    const previewPdfBtn = document.getElementById('previewPdfDockBtn');
    if (previewPdfBtn) previewPdfBtn.onclick = () => PdfExport.buildPdf();

    const resetBtn = document.getElementById('resetDataDockBtn');
    if (resetBtn) resetBtn.onclick = () => UI.showResetModal();

    const confirmResetBtn = document.getElementById('confirmResetBtn');
    if (confirmResetBtn) {
        confirmResetBtn.onclick = () => {
            Storage.clearAllData();
            UI.renderLogTable([]);
            UI.hideResetModal();
            location.reload();
        };
    }

    const cancelCreatePaxBtn = document.getElementById('cancelCreatePaxBtn');
    if (cancelCreatePaxBtn) cancelCreatePaxBtn.onclick = () => UI.hideCreatePaxModal();

    // Édition Adversaire
    const confirmEditAdvBtn = document.getElementById('confirmEditAdvBtn');
    if (confirmEditAdvBtn) confirmEditAdvBtn.onclick = () => UI.handleAdversaryPhotoUpdate();

    const editAdvPhotoInput = document.getElementById('edit_adv_photo_input');
    if (editAdvPhotoInput) {
        editAdvPhotoInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const compressedData = await Utils.compressImage(file, 800, 800, 0.7);
                    document.getElementById('edit_adv_preview').innerHTML = `<img src="${compressedData}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    editAdvPhotoInput.dataset.compressedBase64 = compressedData;
                } catch (err) {
                    console.error("Erreur de compression:", err);
                }
            }
        };
    }

    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) darkModeToggle.onclick = () => UI.handleThemeToggle();

    const fullscreenToggle = document.getElementById('fullscreenToggle');
    if (fullscreenToggle) {
        fullscreenToggle.onclick = () => UI.toggleFullscreen();
        document.addEventListener('fullscreenchange', () => UI.updateFullscreenIcon());
    }

    const dockToggleBtn = document.getElementById('dockToggleBtn');
    if (dockToggleBtn) dockToggleBtn.onclick = () => UI.toggleDock();
});
