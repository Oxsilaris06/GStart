async function handleFileChange(input, previewContainerId, isSingle) {
            const previewContainer = document.getElementById(previewContainerId);

            if (isSingle) {
                const existingImages = previewContainer.querySelectorAll('.image-preview');
                for (const img of existingImages) {
                    // Supprimer l'image, en passant l'élément parent pour suppression
                    await removeImage(img.id, img.closest('.image-preview-item'));
                }
                previewContainer.innerHTML = '';
            }

            if (input.files.length > 0) {
                for (const file of Array.from(input.files)) {
                    const previewImgId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

                    let objectURL = null;
                    try {
                        await dbManager.putItem(previewImgId, file);
                        objectURL = URL.createObjectURL(file);
                        objectUrlsCache[previewImgId] = objectURL;

                        const interactiveItem = document.createElement('div');
                        interactiveItem.className = 'image-preview-item draggable'; // NOUVEAU: Draggable
                        interactiveItem.draggable = true;
                        interactiveItem.id = previewImgId + "_item"; // Unique ID for drag item

                        const isEffrac = previewContainerId.includes('effrac'); // Plus robuste pour mobile

                        interactiveItem.innerHTML = `
                            <img id="${previewImgId}" class="image-preview" src="${objectURL}" style="display:block;" data-annotations="[]" data-tools="[]" data-other-tools="">
                            <div style="display: flex; gap: 5px; margin-top: 5px;">
                                <button type="button" class="add-btn" style="background-color: var(--accent-blue); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openAnnotationModal('${previewImgId}')"><span class="material-symbols-outlined" style="font-size: 1.2em;">edit</span></button>
                                ${isEffrac ? `<button type="button" class="add-btn" style="background-color: var(--effraction-gold); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openEffractionToolsModal('${previewImgId}')"><span class="material-symbols-outlined" style="font-size: 1.2em;">hardware</span></button>` : ''}
                                <button type="button" class="remove-btn" style="padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="removeImage('${previewImgId}', this.closest('.image-preview-item'))">&times;</button>
                            </div>`;
                        previewContainer.appendChild(interactiveItem);

                    } catch (error) {
                        console.error("Erreur lors du stockage de l'image:", error);
                        // Révocation de l'URL si elle a été créée avant l'erreur de stockage
                        if (objectURL && objectUrlsCache[previewImgId]) {
                            URL.revokeObjectURL(objectURL);
                            delete objectUrlsCache[previewImgId];
                        }
                        alert("Une erreur est survenue lors de l'ajout de l'image.");
                    }
                }
            }
            syncAllThumbnails();
            input.value = '';
            saveFormData();
        }

async function removeImage(imgId, itemElement) {
            try {
                // Révocation de l'URL de l'objet et suppression du cache
                if (objectUrlsCache[imgId]) {
                    URL.revokeObjectURL(objectUrlsCache[imgId]);
                    delete objectUrlsCache[imgId];
                }

                await dbManager.deleteItem(imgId);
                if (itemElement) itemElement.remove();
                syncAllThumbnails();
                saveFormData();
            } catch (error) {
                console.error("Erreur lors de la suppression de l'image:", error);
                // On n'alerte pas ici, car l'erreur pourrait être liée à IndexedDB,
                // mais on retire quand même l'élément de l'UI si possible.
                if (itemElement) itemElement.remove();
                syncAllThumbnails();
                saveFormData();
            }
        }

function syncAllThumbnails() {
            // Nettoyer UNIQUEMENT les conteneurs qui sont des cibles de synchronisation dans displayMap
            for (const previewId in displayMap) {
                const displayId = displayMap[previewId];
                if (displayId) {
                    const displayContainer = document.getElementById(displayId);
                    if (displayContainer) displayContainer.innerHTML = '';
                }
            }

            for (const previewId in displayMap) {
                const displayId = displayMap[previewId];
                if (!displayId) continue;

                const previewContainer = document.getElementById(previewId);
                const displayContainer = document.getElementById(displayId);

                if (previewContainer && displayContainer) {
                    previewContainer.querySelectorAll('.image-preview-item img').forEach(previewImg => {
                        const displayImg = document.createElement('img');
                        displayImg.className = 'image-preview';
                        // IMPORTANT: Utilisez toujours l'URL de l'objet du DOM, qui est l'URL de l'objet Blob
                        displayImg.src = previewImg.src;
                        displayImg.dataset.refId = previewImg.id;
                        displayContainer.appendChild(displayImg);
                    });
                }
            }
        }

async function handleCustomBackgroundChange(input) {
            if (input.files && input.files[0]) {
                const file = input.files[0];
                try {
                    await dbManager.putItem('custom_pdf_background', file);
                    updateCustomBgPreview();
                    alert("Fond personnalisé enregistré.");
                } catch (e) {
                    console.error(e);
                    alert("Erreur lors de l'enregistrement du fond.");
                }
            }
            input.value = '';
        }

async function removeCustomBackground() {
            try {
                await dbManager.deleteItem('custom_pdf_background');
                updateCustomBgPreview();
                alert("Fond personnalisé supprimé. Le fond par défaut sera utilisé.");
            } catch (e) {
                console.error(e);
            }
        }

async function updateCustomBgPreview() {
            const container = document.getElementById('custom_bg_preview_container');
            if (!container) return;
            container.innerHTML = '';
            try {
                const blob = await dbManager.getItem('custom_pdf_background');
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    const img = document.createElement('img');
                    img.src = url;
                    img.className = 'image-preview';
                    img.style.maxWidth = '200px';
                    img.onload = () => URL.revokeObjectURL(url);
                    container.appendChild(img);
                } else {
                    container.innerHTML = '<p style="font-style:italic; color:var(--text-secondary);">Aucun fond personnalisé. Fond par défaut actif.</p>';
                }
            } catch (e) {
                console.error(e);
            }
        }

async function fetchImageAndCompress(imagePath, quality) {
            try {
                // Utilisation de la fonction fetch standard pour charger les images
                const response = await fetch(imagePath);
                if (!response.ok) throw new Error(`Échec du chargement de l'image de fond: ${response.statusText}`);
                const blob = await response.blob();

                // Compression du Blob (qui est censé être un PNG comme demandé par l'utilisateur)
                return await compressImage(blob, quality);
            } catch (error) {
                console.error(`Erreur de chargement/compression de l'image ${imagePath}:`, error);
                return null;
            }
        }

function getAdversaryImageInfo(formData, adversaryIndex = 1) {
            const mainPhotoContainerId = adversaryIndex === 1 ? 'adversary_photo_preview_container' : 'adversary_photo_preview_container_2';
            if (formData.dynamic_photos && formData.dynamic_photos[mainPhotoContainerId]) {
                const firstImage = formData.dynamic_photos[mainPhotoContainerId][0];
                if (firstImage) {
                    return {
                        id: firstImage.id,
                        annotationsJson: firstImage.annotations || '[]'
                    };
                }
            }
            return null;
        }