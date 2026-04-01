function renameVehicle(element) {
            const currentName = element.textContent;
            const newName = prompt("Renommer le véhicule :", currentName);
            if (newName && newName.trim() !== "") {
                element.textContent = newName.trim();
                const row = element.closest('.patracdvr-vehicle-row');
                if (row) {
                    row.dataset.vehicleName = newName.trim();
                    saveFormData();
                }
            }
        }

function addPatracdvrRow(vehicleName, members = []) {
            const container = document.getElementById('patracdvr_container');
            const row = document.createElement('div');
            row.className = 'patracdvr-vehicle-row';
            row.dataset.vehicleName = vehicleName;

            row.innerHTML = `
                <div class="vehicle-header">
                    <span class="vehicle-name" onclick="renameVehicle(this)" title="Cliquer pour renommer">${vehicleName}</span>
                    <button type="button" class="remove-btn" title="Supprimer le véhicule">❌</button>
                </div>
                <div class="patracdvr-members-container"></div>`;

            container.appendChild(row);

            const membersContainer = row.querySelector('.patracdvr-members-container');
            row.querySelector('.remove-btn').addEventListener('click', () => {
                // Utilisation d'un `confirm` natif
                const confirmation = confirm(`Voulez-vous vraiment supprimer le véhicule "${vehicleName}" et désattribuer ses membres ?`);
                if (confirmation) {
                    // Désattribution des membres
                    membersContainer.querySelectorAll('.patracdvr-member-btn').forEach(memberBtn => {
                        memberBtn.dataset.cellule = 'Sans';
                        memberBtn.dataset.fonction = 'Sans';
                        updateMemberButtonVisuals(memberBtn);
                        unassignedContainer.appendChild(memberBtn);
                    });
                    // Suppression de la ligne du véhicule
                    row.remove();
                    // Réinitialisation du panneau d'édition rapide si le membre actif était dans ce véhicule
                    if (activeMemberId) {
                        const activeMember = document.getElementById(activeMemberId);
                        if (!document.contains(activeMember)) {
                            activeMemberId = null;
                            document.getElementById('quickEditPanel').style.display = 'none';
                        }
                    }
                    saveFormData();
                }
            });

            // Attacher les écouteurs de Drop uniquement au conteneur de membres du véhicule
            membersContainer.addEventListener('dragenter', handleDragEnter);
            membersContainer.addEventListener('dragleave', handleDragLeave);
            membersContainer.addEventListener('dragover', handleDragOver);
            membersContainer.addEventListener('drop', handleDrop);

            members.forEach(memberData => addPatracdvrMember(membersContainer, memberData));
            saveFormData();
        }

function addManualVehicle() {
            let vehicleName = prompt("Veuillez saisir le nom du nouveau VL (ex: KODIAQ, SHARAN, VTC...):");
            if (vehicleName) {
                vehicleName = vehicleName.trim();
                if (vehicleName.length > 0) {
                    addPatracdvrRow(vehicleName);
                }
            }
        }

function addManualMember() {
            let trigramme = prompt("Veuillez saisir le trigramme du nouveau PAX (ex: ABC):");
            if (trigramme) {
                trigramme = trigramme.trim().toUpperCase();
                const existingMember = document.querySelector(`.patracdvr-member-btn[data-trigramme="${trigramme}"]`);
                if (existingMember) {
                    alert(`Le membre avec le trigramme "${trigramme}" existe déjà. Veuillez en choisir un autre.`);
                    return;
                }

                if (trigramme.length >= 2 && trigramme.length <= 4) {
                    const initialData = {
                        trigramme: trigramme,
                        cellule: 'Sans',
                        fonction: 'Sans',
                        principales: 'Sans',
                        secondaires: 'PSA',
                        afis: 'Sans',
                        grenades: 'Sans',
                        equipement: 'Sans',
                        equipement2: 'Sans',
                        tenues: 'UBAS',
                        gpb: 'GPBL',
                        dir: '' // Initialisation DIR
                    };
                    const newMemberBtn = addPatracdvrMember(unassignedContainer, initialData);

                    if (newMemberBtn) {
                        handleMemberSelection({ target: newMemberBtn });
                    }
                    // saveFormData(); // Déjà appelé dans addPatracdvrMember
                } else {
                    alert("Le trigramme doit contenir entre 2 et 4 caractères.");
                }
            }
        }
function addPatracdvrMember(containerElement, data = {}) {
    if (!containerElement) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'patracdvr-member-btn draggable';
    btn.id = `member_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    btn.setAttribute('draggable', 'true');
    const memberData = {
        trigramme: 'N/A',
        fonction: 'Sans',
        cellule: 'India 1',
        principales: 'Sans',
        secondaires: 'PSA',
        afis: 'Sans',
        grenades: 'Sans',
        equipement: 'Sans',
        equipement2: 'Sans',
        tenue: 'UBAS',
        gpb: 'GPBL',
        dir: '', // NOUVEAU Champ DIR
        ...data
    };
    Object.keys(memberData).forEach(key => btn.dataset[key] = memberData[key]);
    updateMemberButtonVisuals(btn);

    btn.addEventListener('click', handleMemberSelection);

    // --- AJOUT CORRECTIF MOBILE ---
    // On ajoute les écouteurs tactiles directement sur l'élément créé
    btn.addEventListener('touchstart', handleTouchStart, { passive: false });
    btn.addEventListener('touchmove', handleTouchMove, { passive: false });
    btn.addEventListener('touchend', handleTouchEnd);
    // ------------------------------

    containerElement.appendChild(btn);

    saveFormData();
    return btn;
}

function updateMemberButtonVisuals(btn) {
            const trigramme = btn.dataset.trigramme || 'N/A';
            const fonction = btn.dataset.fonction || '';
            const cellule = btn.dataset.cellule || '';
            const dir = btn.dataset.dir || '';

            const cellDisplay = cellule !== 'Sans' ? cellule : '';
            // NOUVEAU: Affichage DIR
            const dirDisplay = dir ? `<br><span class="dir-info">DIR: ${dir}</span>` : '';

            // Gestion multi-fonctions pour l'affichage (troncature si trop long)
            let functionDisplay = '';
            if (fonction !== 'Sans') {
                const funcs = fonction.split(', ');
                if (funcs.length > 1) {
                    functionDisplay = ` / ${funcs[0]} +${funcs.length - 1}`;
                } else {
                    functionDisplay = ` / ${fonction}`;
                }
            }

            const separation = (cellDisplay && functionDisplay) ? '' : '';

            btn.innerHTML = `<span class="trigramme">${trigramme}</span><span class="fonction">${cellDisplay}${separation}${functionDisplay}</span>${dirDisplay}`;

            // Si le membre est dans le conteneur "Personnel à attribuer", on masque la fonction/cellule.
            if (btn.closest('#unassigned_members_container')) {
                btn.innerHTML = `<span class="trigramme">${trigramme}</span>`;
            }
        }

function updateArticulationDisplay() {
    // Compatibility wrapper — la logique a été déplacée dans articulation.js
    if (typeof refreshArticulationFromPatracdvr === 'function') {
        refreshArticulationFromPatracdvr();
    }
}

function initializePatracdvr(dataFromStorage) {
            unassignedContainer.innerHTML = '';
            patracdvrContainer.innerHTML = '';
            if (dataFromStorage && (dataFromStorage.patracdvr_rows?.length > 0 || dataFromStorage.patracdvr_unassigned?.length > 0)) {
                (dataFromStorage.patracdvr_unassigned || []).forEach(member => addPatracdvrMember(unassignedContainer, member));
                (dataFromStorage.patracdvr_rows || []).forEach(row => addPatracdvrRow(row.vehicle, row.members));
            }
        }

function loadConfigObject(config) {
            if (config.options) {
                Object.assign(memberConfig, config.options);
                setupQuickEditPanel();
            }

            if (config.members && Array.isArray(config.members)) {
                unassignedContainer.innerHTML = '';
                patracdvrContainer.innerHTML = '';
                config.members.forEach(memberData => {
                    const defaultData = {
                        cellule: memberData.cellule || 'Sans',
                        fonction: memberData.fonction || 'Sans',
                        principales: memberData.principales || 'Sans',
                        secondaires: memberData.secondaires || 'PSA',
                        afis: memberData.afis || 'Sans',
                        grenades: memberData.grenades || 'Sans',
                        equipement: memberData.equipement || 'Sans',
                        equipement2: memberData.equipement2 || 'Sans',
                        tenue: memberData.tenue || 'UBAS',
                        gpb: memberData.gpb || 'GPBL',
                        dir: '',
                        ...memberData
                    };
                    addPatracdvrMember(unassignedContainer, defaultData);
                });
            }
            saveFormData();
        }

function setupQuickEditPanel() {
            const contentContainer = document.querySelector('#quickEditPanel .quick-edit-content');
            contentContainer.innerHTML = '';

            for (const [title, config] of Object.entries(quickEditMapping)) {

                const categoryDiv = document.createElement('div');
                categoryDiv.className = 'quick-edit-category';

                const panelTitle = document.createElement('h5');
                panelTitle.textContent = title;
                categoryDiv.appendChild(panelTitle);

                const optionsContainer = document.createElement('div');
                optionsContainer.className = 'quick-edit-options';

                (memberConfig[config.key] || []).forEach(option => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'quick-edit-btn';
                    btn.textContent = option;
                    btn.dataset.attribute = config.attribute;
                    btn.dataset.value = option;
                    optionsContainer.appendChild(btn);
                });

                categoryDiv.appendChild(optionsContainer);
                contentContainer.appendChild(categoryDiv);
            }
        }

function handleMemberSelection(event) {
            // Utiliser closest pour s'assurer que l'on obtient le bouton, même si l'on clique sur un span enfant
            const clickedButton = event.target.closest('.patracdvr-member-btn');
            if (!clickedButton) return;

            // Empêcher la propagation pour ne pas déclencher d'autres écouteurs
            event.stopPropagation();

            if (activeMemberId === clickedButton.id) {
                // Désélectionner
                clickedButton.classList.remove('member-active');
                activeMemberId = null;
                document.getElementById('quickEditPanel').style.display = 'none';
                return;
            }

            // Désélectionner l'ancien membre actif
            if (activeMemberId) {
                const oldActive = document.getElementById(activeMemberId);
                if (oldActive) oldActive.classList.remove('member-active');
            }

            // Sélectionner le nouveau membre actif
            activeMemberId = clickedButton.id;
            clickedButton.classList.add('member-active');

            // Afficher le panneau d'édition approprié (modal sur mobile, panneau sur desktop)
            if (window.innerWidth < 768) {
                openQuickEditModal(activeMemberId);
            } else {
                populateQuickEditPanel(activeMemberId);
                document.getElementById('quickEditPanel').style.display = 'flex';
            }
            // CONFORMITÉ: Sauvegarde après sélection/désélection d'un membre (son état actif change)
            saveFormData();
        }

function populateQuickEditPanel(memberId) {
            const member = document.getElementById(memberId);
            if (!member) return;

            const trigrammeDisplay = member.dataset.trigramme || 'N/A';
            document.getElementById('selectedMemberTrigramme').textContent = trigrammeDisplay;
            document.getElementById('quick_edit_trigramme_input').value = trigrammeDisplay;

            // NOUVEAU: Remplir le champ DIR
            document.getElementById('quick_edit_dir_input').value = member.dataset.dir || '';

            document.querySelectorAll('#quickEditPanel .quick-edit-btn').forEach(btn => {
                const attribute = btn.dataset.attribute;
                const value = btn.dataset.value;
                const memberValue = member.dataset[attribute];

                // NOUVEAU: Logique de sélection visuelle pour multi-select vs single
                if (multiSelectAttributes.includes(attribute)) {
                    const currentValues = memberValue ? memberValue.split(', ') : [];
                    btn.classList.toggle('selected', currentValues.includes(value));
                } else {
                    btn.classList.toggle('selected', memberValue === value);
                }
            });
        }

function openQuickEditModal(memberId) {
            const modal = document.getElementById('quickEditModal');
            const title = document.getElementById('quick_modal_title');
            const content = document.getElementById('quick_modal_content');
            const member = document.getElementById(memberId);

            if (!member) return;

            title.textContent = `Édition Rapide: ${member.dataset.trigramme || 'N/A'}`;
            content.innerHTML = '';

            // --- Ajouter le champ de trigramme en haut de la modale ---
            const trigrammeDiv = document.createElement('div');
            trigrammeDiv.className = 'quick-edit-category';
            trigrammeDiv.innerHTML = `
                <h5>Trigramme</h5>
                <input type="text" id="modal_quick_edit_trigramme_input" placeholder="Nouveau trigramme" 
                       value="${member.dataset.trigramme || 'N/A'}" 
                       style="padding: 8px; margin-bottom: 0; min-height: 38px; font-size: 1em;">
            `;
            content.appendChild(trigrammeDiv);

            // NOUVEAU: Ajouter le champ DIR
            const dirDiv = document.createElement('div');
            dirDiv.className = 'quick-edit-category';
            dirDiv.innerHTML = `
                <h5>DIR (Radio)</h5>
                <input type="text" id="modal_quick_edit_dir_input" placeholder="N° Dossier Radio" 
                       value="${member.dataset.dir || ''}" 
                       style="padding: 8px; margin-bottom: 0; min-height: 38px; font-size: 1em;">
            `;
            content.appendChild(dirDiv);

            // Écouteur pour la mise à jour immédiate du trigramme (dans la modale uniquement)
            document.getElementById('modal_quick_edit_trigramme_input').addEventListener('input', (e) => {
                member.dataset.trigramme = e.target.value.toUpperCase();
                title.textContent = `Édition Rapide: ${member.dataset.trigramme || 'N/A'}`;
                saveFormData();
            });

            // Écouteur pour la mise à jour immédiate du DIR (dans la modale uniquement)
            document.getElementById('modal_quick_edit_dir_input').addEventListener('input', (e) => {
                member.dataset.dir = e.target.value;
                saveFormData();
            });

            // --- Ajouter les options d'édition ---
            setupQuickEditPanel(); // S'assurer que le panneau est mis à jour

            // Copier les boutons du panneau dans la modale
            const quickEditPanelContent = document.querySelector('#quickEditPanel .quick-edit-content');
            content.appendChild(quickEditPanelContent.cloneNode(true));

            // Mettre à jour l'état de sélection
            const modalButtons = content.querySelectorAll('.quick-edit-btn');
            modalButtons.forEach(btn => {
                const attribute = btn.dataset.attribute;
                const value = btn.dataset.value;
                const memberValue = member.dataset[attribute];

                if (multiSelectAttributes.includes(attribute)) {
                    const currentValues = memberValue ? memberValue.split(', ') : [];
                    btn.classList.toggle('selected', currentValues.includes(value));
                } else {
                    btn.classList.toggle('selected', memberValue === value);
                }
            });

            modal.showModal();
        }

function saveQuickEditChanges() {
            const member = document.getElementById(activeMemberId);
            if (!member) return;

            // Mise à jour du trigramme
            const newTrigramme = document.getElementById('quick_edit_trigramme_input').value.toUpperCase();
            member.dataset.trigramme = newTrigramme;
            document.getElementById('selectedMemberTrigramme').textContent = newTrigramme;

            // NOUVEAU: Mise à jour DIR
            member.dataset.dir = document.getElementById('quick_edit_dir_input').value;

            // Les boutons sont mis à jour dynamiquement via le click handler

            updateMemberButtonVisuals(member);
            // CONFORMITÉ: Sauvegarde après modification du panneau
            saveFormData();
            populateQuickEditPanel(activeMemberId);
        }