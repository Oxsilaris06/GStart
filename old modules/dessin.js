function setContextualTools(selection) {
            const contextualTools = document.getElementById('contextual_tools');
            if (selection) {
                contextualTools.classList.add('active');
                
                const rotationInput = document.getElementById('rotation_input');
                rotationInput.value = Math.round((selection.rotation || 0) * 180 / Math.PI) % 360;
                if (rotationInput.value < 0) rotationInput.value = 360 + parseInt(rotationInput.value);

                // Mise à jour des sliders de redimensionnement
                const wSlider = document.getElementById('resize_w');
                const hSlider = document.getElementById('resize_h');
                const strokeSlider = document.getElementById('stroke_width_edit');
                
                if (wSlider) {
                    wSlider.value = selection.type === 'location' ? (selection.radius * 2) : (selection.width || 0);
                    wSlider.parentElement.style.display = (selection.type === 'location' || selection.type === 'box') ? 'flex' : 'none';
                }
                if (hSlider) {
                    hSlider.value = selection.height || 0;
                    hSlider.parentElement.style.display = selection.type === 'box' ? 'flex' : 'none';
                }
                if (strokeSlider) {
                    strokeSlider.value = selection.thickness || 5;
                    strokeSlider.parentElement.style.display = (selection.type === 'box' || selection.type === 'arrow') ? 'flex' : 'none';
                }

                const textSizeControl = document.getElementById('text_size_control');
                if (textSizeControl) {
                    textSizeControl.style.display = selection.type === 'text' ? 'flex' : 'none';
                    if (selection.type === 'text') {
                        const textSizeSlider = document.getElementById('text_size_edit');
                        if (textSizeSlider) textSizeSlider.value = selection.size || 30;
                    }
                }

                const zoneSettings = document.getElementById('zone_settings');
                if (zoneSettings) {
                    zoneSettings.style.display = selection.type === 'location' ? 'flex' : 'none';
                    if (selection.type === 'location') {
                        document.getElementById('circle_text').value = selection.text || '';
                        document.getElementById('circle_opacity').value = selection.opacity || 0.5;
                    }
                }

            } else {
                contextualTools.classList.remove('active');
            }
        }

function resizeSelected(w, h) {
            if (!selectedAnnotation) return;
            // Pour box, width/height
            if (selectedAnnotation.type === 'box') {
                if (w) selectedAnnotation.width = parseInt(w);
                if (h) selectedAnnotation.height = parseInt(h);
            }
            // Pour location, radius
            if (selectedAnnotation.type === 'location' && w) {
                selectedAnnotation.radius = parseInt(w) / 2;
            }
            redrawCanvas();
        }

function updateStrokeWidth(val) {
            if (selectedAnnotation) {
                selectedAnnotation.thickness = parseInt(val);
                redrawCanvas();
                document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(annotations);
                saveFormData();
            }
        }

function updateTextSize(val) {
            if (selectedAnnotation && selectedAnnotation.type === 'text') {
                selectedAnnotation.size = parseInt(val);
                redrawCanvas();
                document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(annotations);
                saveFormData();
            }
        }

function updateZoneText(val) {
            if (selectedAnnotation && selectedAnnotation.type === 'location') {
                selectedAnnotation.text = val;
                redrawCanvas();
                document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(annotations);
                saveFormData();
            }
        }

function updateZoneOpacity(val) {
            if (selectedAnnotation && selectedAnnotation.type === 'location') {
                selectedAnnotation.opacity = parseFloat(val);
                redrawCanvas();
                document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(annotations);
                saveFormData();
            }
        }

function updateAnnotationRotation() {
            if (selectedAnnotation) {
                const rotationInput = document.getElementById('rotation_input');
                const degrees = parseFloat(rotationInput.value) || 0;
                selectedAnnotation.rotation = degrees * Math.PI / 180;
                redrawCanvas();
                // CONFORMITÉ: Sauvegarde après rotation
                document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(annotations);
                saveFormData();
            }
        }

function setActiveTool(toolId) {
            currentTool = toolId;
            document.querySelectorAll('.tool-btn.active, .tool-controls.active').forEach(el => el.classList.remove('active'));
            const toolButton = document.getElementById(`tool_${toolId}`);
            if (toolButton) toolButton.classList.add('active');
            const toolControls = document.getElementById(`controls_${toolId}`);
            if (toolControls) toolControls.classList.add('active');
            canvas.style.cursor = toolId === 'move' ? 'grab' : 'crosshair';
            selectedAnnotation = null;
            setContextualTools(null);

            const activeToolDisplay = document.getElementById('active_tool_display');
            if (activeToolDisplay) activeToolDisplay.innerText = "Outil: " + (toolId === 'move' ? 'Déplacer' : toolId);
        }

function setAnnotationColor(color, element) {
            currentAnnotationColor = color;
            document.querySelectorAll('.color-circle').forEach(el => el.classList.remove('active'));
            element.classList.add('active');
            if (selectedAnnotation) {
                selectedAnnotation.color = color; // Appliquer la couleur à la sélection
                redrawCanvas();
            }
        }

async function openAnnotationModal(previewImgId) {
            const previewImg = document.getElementById(previewImgId);
            if (!previewImg) return;

            let objectURL = objectUrlsCache[previewImgId];

            if (!objectURL) {
                // Fallback: Essayer de récupérer l'URL depuis l'élément img s'il s'agit d'un blob existant
                if (previewImg.src && previewImg.src.startsWith('blob:')) {
                    objectURL = previewImg.src;
                    objectUrlsCache[previewImgId] = objectURL;
                } else {
                    // Tenter de recharger le blob depuis la DB
                    try {
                        const imageBlob = await dbManager.getItem(previewImgId);
                        if (imageBlob) {
                            objectURL = URL.createObjectURL(imageBlob);
                            objectUrlsCache[previewImgId] = objectURL;
                            previewImg.src = objectURL;
                        } else {
                            alert("Impossible de charger l'image pour l'annotation. Données non trouvées.");
                            return;
                        }
                    } catch (e) {
                        console.error("Erreur DB:", e);
                        alert("Erreur lors de la récupération de l'image.");
                        return;
                    }
                }
            }

            // Reset baseImage to ensure onload fires every time
            baseImage = new Image();

            baseImage.onload = () => {
                canvas.width = baseImage.naturalWidth;
                canvas.height = baseImage.naturalHeight;
                try {
                    const rawAnnotations = previewImg.dataset.annotations;
                    annotations = rawAnnotations ? JSON.parse(rawAnnotations) : [];
                } catch (e) {
                    console.error("Erreur parsing annotations:", e);
                    annotations = [];
                }
                // Migration: ajouter couleur si manquante
                annotations.forEach(a => { if (!a.color) a.color = '#c0392b'; });

                setActiveTool('move');
                redrawCanvas();
                annotationModal.dataset.targetPreviewId = previewImgId;
                try {
                    annotationModal.showModal();
                } catch (e) {
                    if (!annotationModal.open) annotationModal.showModal();
                }
            };

            baseImage.onerror = (e) => {
                alert("Impossible de charger l'image pour l'annotation. Erreur de source.");
                console.error("Erreur de chargement de l'image:", e);
            };

            baseImage.src = objectURL;
        }

function redrawCanvas() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(baseImage, 0, 0);
            annotations.forEach(drawAnnotation);
            if (isDrawing && currentAnnotation) {
                drawAnnotation(currentAnnotation);
            }
            if (selectedAnnotation) {
                drawSelectionBorder(selectedAnnotation);
            }
        }

function drawSelectionBorder(annotation) {
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3;
            ctx.shadowColor = "black";
            ctx.shadowBlur = 5;
            let centerX, centerY;
            let x, y, width, height;

            if (annotation.type === 'location') {
                x = annotation.x - annotation.radius;
                y = annotation.y - annotation.radius;
                width = annotation.radius * 2;
                height = annotation.radius * 2;
                centerX = annotation.x;
                centerY = annotation.y;
            } else if (annotation.type === 'box') {
                x = annotation.x;
                y = annotation.y;
                width = annotation.width;
                height = annotation.height;
                centerX = annotation.x + annotation.width / 2;
                centerY = annotation.y + annotation.height / 2;
            } else if (annotation.type === 'arrow') {
                const minX = Math.min(annotation.startX, annotation.endX);
                const minY = Math.min(annotation.startY, annotation.endY);
                const maxX = Math.max(annotation.startX, annotation.endX);
                const maxY = Math.max(annotation.startY, annotation.endY);
                x = minX - 10;
                y = minY - 10;
                width = maxX - minX + 20;
                height = maxY - minY + 20;
                centerX = (annotation.startX + annotation.endX) / 2;
                centerY = (annotation.startY + annotation.endY) / 2;
            } else if (annotation.type === 'text') {
                const size = annotation.size || 30;
                ctx.font = `bold ${size}px Oswald`;
                width = ctx.measureText(annotation.text).width + 20;
                height = size + 10;
                x = annotation.x - 10;
                y = annotation.y - size; // approx ascent
                centerX = x + width / 2;
                centerY = y + height / 2;
            }

            if (annotation.rotation) {
                ctx.translate(centerX, centerY);
                ctx.rotate(annotation.rotation);
                ctx.translate(-centerX, -centerY);
            }

            ctx.strokeRect(x, y, width, height);
            ctx.restore();
        }

function drawAnnotation(annotation) {
            ctx.save();
            // Utilisation de la couleur stockée ou rouge par défaut
            const color = annotation.color || '#c0392b';

            let centerX, centerY;
            if (annotation.type === 'location' || annotation.type === 'text') {
                centerX = annotation.x;
                centerY = annotation.y;
            } else if (annotation.type === 'box') {
                centerX = annotation.x + annotation.width / 2;
                centerY = annotation.y + annotation.height / 2;
            } else if (annotation.type === 'arrow') {
                centerX = (annotation.startX + annotation.endX) / 2;
                centerY = (annotation.startY + annotation.endY) / 2;
            }

            if (annotation.rotation) {
                ctx.translate(centerX, centerY);
                ctx.rotate(annotation.rotation);
                ctx.translate(-centerX, -centerY);
            }

            switch (annotation.type) {
                case 'location': {
                    const radius = annotation.radius || 0;
                    if (radius < 2) { ctx.restore(); return; }
                    ctx.beginPath();
                    ctx.arc(annotation.x, annotation.y, radius, 0, 2 * Math.PI);
                    const rgb = hexToRgb(color) || { r: 91, g: 155, b: 213 };
                    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${annotation.opacity || 0.5})`;
                    ctx.fill();
                    ctx.strokeStyle = color; // Couleur personnalisée pour le bord
                    ctx.lineWidth = 3;
                    ctx.stroke();
                    if (annotation.text) {
                        ctx.fillStyle = 'black';
                        ctx.font = `bold ${Math.max(12, radius / 2)}px Oswald`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(annotation.text, annotation.x, annotation.y);
                    }
                    break;
                }
                case 'arrow': {
                    drawArrow(annotation.startX, annotation.startY, annotation.endX, annotation.endY, annotation.thickness || 5, color);
                    break;
                }
                case 'box': {
                    ctx.strokeStyle = color;
                    ctx.lineWidth = annotation.thickness || 5;
                    ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
                    break;
                }
                case 'text': {
                    const size = annotation.size || 30;
                    ctx.font = `bold ${size}px Oswald`;
                    ctx.fillStyle = color;
                    ctx.strokeStyle = "black";
                    ctx.lineWidth = 2;
                    ctx.strokeText(annotation.text, annotation.x, annotation.y);
                    ctx.fillText(annotation.text, annotation.x, annotation.y);
                    break;
                }
            }
            ctx.restore();
        }

function drawArrow(fromx, fromy, tox, toy, lineWidth, color) {
            if (fromx === tox && fromy === toy) return;

            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = lineWidth;

            const dx = tox - fromx;
            const dy = toy - fromy;
            const angle = Math.atan2(dy, dx);
            const headlen = Math.max(lineWidth * 3, 10);
            const arrowLength = Math.sqrt(dx * dx + dy * dy);

            const lineToX = tox - (headlen * 0.7) * Math.cos(angle);
            const lineToY = toy - (headlen * 0.7) * Math.sin(angle);

            if (arrowLength < headlen * 1.5) {
                ctx.beginPath();
                ctx.moveTo(fromx, fromy);
                ctx.lineTo(tox, toy);
                ctx.stroke();
                return;
            }

            ctx.beginPath();
            ctx.moveTo(fromx, fromy);
            ctx.lineTo(lineToX, lineToY);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(tox, toy);
            ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 7), toy - headlen * Math.sin(angle - Math.PI / 7));
            ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 7), toy - headlen * Math.sin(angle + Math.PI / 7));
            ctx.closePath();
            ctx.fill();
        }

function handleDrawStart(e) {
            e.preventDefault();
            const pos = getEventPos(canvas, e);
            startX = pos.x;
            startY = pos.y;

            if (currentTool === 'move') {
                selectedAnnotation = getAnnotationAtPosition(pos.x, pos.y);
                setContextualTools(selectedAnnotation);
                if (selectedAnnotation) {
                    isMovingAnnotation = true;
                    document.body.style.overflow = 'hidden';
                    redrawCanvas();
                }
            } else if (currentTool === 'text') {
                // NOUVEAU: Outil Texte Click
                const text = prompt("Texte à insérer :");
                if (text) {
                    const sizeInput = document.getElementById('text_size_tool');
                    const size = sizeInput ? parseInt(sizeInput.value) : 30;
                    annotations.push({
                        type: 'text',
                        x: startX,
                        y: startY,
                        text: text,
                        color: currentAnnotationColor,
                        rotation: 0,
                        size: size
                    });
                    redrawCanvas();
                }
            } else {
                isDrawing = true;
                selectedAnnotation = null;
                setContextualTools(null);
                currentAnnotation = {
                    type: currentTool,
                    startX: startX,
                    startY: startY,
                    endX: startX,
                    endY: startY,
                    rotation: 0,
                    color: currentAnnotationColor // Store color
                };
            }
        }

function handleDrawMove(e) {
            e.preventDefault();
            if (!isDrawing && !isMovingAnnotation) return;
            const pos = getEventPos(canvas, e);

            if (isMovingAnnotation && selectedAnnotation) {
                const deltaX = pos.x - startX;
                const deltaY = pos.y - startY;

                if (selectedAnnotation.type === 'arrow') {
                    selectedAnnotation.startX += deltaX;
                    selectedAnnotation.startY += deltaY;
                    selectedAnnotation.endX += deltaX;
                    selectedAnnotation.endY += deltaY;
                } else {
                    // Pour box, location et text
                    selectedAnnotation.x += deltaX;
                    selectedAnnotation.y += deltaY;
                }

                startX = pos.x;
                startY = pos.y;
                redrawCanvas();

            } else if (isDrawing && currentAnnotation) {
                currentAnnotation.endX = pos.x;
                currentAnnotation.endY = pos.y;
                redrawCanvas();
            }
        }

function handleDrawEnd(e) {
            e.preventDefault();
            document.body.style.overflow = '';
            if (isMovingAnnotation) {
                isMovingAnnotation = false;
                // CONFORMITÉ: Sauvegarde après déplacement/modification d'une annotation
                document.getElementById(annotationModal.dataset.targetPreviewId).dataset.annotations = JSON.stringify(annotations);
                saveFormData();
                redrawCanvas();
            } else if (isDrawing) {
                isDrawing = false;
                if (!currentAnnotation) return;

                const final = { ...currentAnnotation };
                const strokeWidthInput = document.getElementById('stroke_width_edit');
                const thickness = strokeWidthInput ? parseInt(strokeWidthInput.value) : 5;

                if (final.type === 'box') {
                    // Normaliser les coordonnées pour la boîte
                    final.x = Math.min(final.startX, final.endX);
                    final.y = Math.min(final.startY, final.endY);
                    final.width = Math.abs(final.startX - final.endX);
                    final.height = Math.abs(final.startY - final.endY);
                    final.thickness = thickness;
                    if (final.width < 5 || final.height < 5) return;
                } else if (final.type === 'arrow') {
                    final.thickness = thickness;
                    if (Math.abs(final.startX - final.endX) < 5 && Math.abs(final.startY - final.endY) < 5) return;
                } else if (final.type === 'location') {
                    // Utiliser le point de départ comme centre (x/y)
                    final.x = final.startX;
                    final.y = final.startY;
                    // Le rayon est la distance entre start et end
                    final.radius = Math.sqrt(Math.pow(final.endX - final.startX, 2) + Math.pow(final.endY - final.startY, 2));
                    final.text = document.getElementById('circle_text').value || 'Zone';
                    final.opacity = document.getElementById('circle_opacity').value;
                    final.color = currentAnnotationColor;
                    if (final.radius < 5) return;
                }

                // Ne pas ajouter si c'était juste un clic sans mouvement pour les formes
                if (final.type !== 'text') annotations.push(final);

                currentAnnotation = null;
                selectedAnnotation = final;
                setContextualTools(selectedAnnotation);
                redrawCanvas();
            }
        }

async function createAnnotatedImageBlob(imageBlob, annotationsData) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                const objectURL = URL.createObjectURL(imageBlob);
                img.src = objectURL;

                img.onload = () => {
                    URL.revokeObjectURL(objectURL);
                    tempCanvas.width = img.naturalWidth;
                    tempCanvas.height = img.naturalHeight;
                    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
                    tempCtx.drawImage(img, 0, 0);

                    annotationsData.forEach(annotation => drawAnnotationOnContext(tempCtx, img.naturalWidth, img.naturalHeight, annotation));

                    // CORRECTION: Utiliser PNG pour l'image annotée afin de conserver la transparence
                    tempCanvas.toBlob(blob => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('La conversion du canevas en Blob a échoué.'));
                        }
                    }, 'image/png');
                };

                img.onerror = (e) => {
                    URL.revokeObjectURL(objectURL);
                    reject(new Error(`Impossible de charger l'image depuis le Blob : ${e.message}`));
                };
            });
        }

function drawAnnotationOnContext(context, canvasWidth, canvasHeight, annotation) {
            context.save();
            const color = annotation.color || '#c0392b';
            let centerX, centerY;
            if (annotation.type === 'location' || annotation.type === 'text') {
                centerX = annotation.x;
                centerY = annotation.y;
            } else if (annotation.type === 'box') {
                centerX = annotation.x + annotation.width / 2;
                centerY = annotation.y + annotation.height / 2;
            } else if (annotation.type === 'arrow') {
                centerX = (annotation.startX + annotation.endX) / 2;
                centerY = (annotation.startY + annotation.endY) / 2;
            }

            if (annotation.rotation) {
                context.translate(centerX, centerY);
                context.rotate(annotation.rotation);
                context.translate(-centerX, -centerY);
            }

            switch (annotation.type) {
                case 'location': {
                    const radius = annotation.radius || 0;
                    if (radius < 2) { context.restore(); return; }
                    context.beginPath(); context.arc(annotation.x, annotation.y, radius, 0, 2 * Math.PI);
                    const rgb = hexToRgb(color) || { r: 91, g: 155, b: 213 };
                    context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${annotation.opacity || 0.5})`; context.fill();
                    context.strokeStyle = color; context.lineWidth = 3; context.stroke();
                    if (annotation.text) {
                        context.fillStyle = 'black'; context.font = `bold ${Math.max(12, radius / 2)}px Oswald`;
                        context.textAlign = 'center'; context.textBaseline = 'middle';
                        context.fillText(annotation.text, annotation.x, annotation.y);
                    }
                    break;
                }
                case 'arrow': {
                    const drawArrowLocal = (fromx, fromy, tox, toy, lineWidth) => {
                        if (fromx === tox && fromy === toy) return;
                        context.strokeStyle = color; context.fillStyle = color; context.lineWidth = lineWidth;
                        const headlen = Math.max(lineWidth * 3, 10);
                        const dx = tox - fromx; const dy = toy - fromy;
                        const angle = Math.atan2(dy, dx);
                        const lineToX = tox - (headlen * 0.7) * Math.cos(angle);
                        const lineToY = toy - (headlen * 0.7) * Math.sin(angle);

                        context.beginPath(); context.moveTo(fromx, fromy); context.lineTo(lineToX, lineToY); context.stroke();
                        context.beginPath(); context.moveTo(tox, toy);
                        context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 7), toy - headlen * Math.sin(angle - Math.PI / 7));
                        context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 7), toy - headlen * Math.sin(angle + Math.PI / 7));
                        context.closePath(); context.fill();
                    };
                    drawArrowLocal(annotation.startX, annotation.startY, annotation.endX, annotation.endY, annotation.thickness || 5);
                    break;
                }
                case 'box': {
                    context.strokeStyle = color; context.lineWidth = annotation.thickness || 5;
                    context.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
                    break;
                }
                case 'text': {
                    const size = annotation.size || 30;
                    context.font = `bold ${size}px Oswald`;
                    context.fillStyle = color;
                    context.strokeStyle = "black";
                    context.lineWidth = 2;
                    context.strokeText(annotation.text, annotation.x, annotation.y);
                    context.fillText(annotation.text, annotation.x, annotation.y);
                    break;
                }
            }
            context.restore();
        }