function hexToRgb(hex) {
            var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : null;
        }

function cleanupObjectUrls() {
            for (const urlId in objectUrlsCache) {
                if (objectUrlsCache[urlId]) {
                    URL.revokeObjectURL(objectUrlsCache[urlId]);
                }
            }
            objectUrlsCache = {};
        }

function getEventPos(canvas, evt) {
            const rect = canvas.getBoundingClientRect();
            // Utiliser une vérification plus robuste pour l'événement tactile
            const clientX = evt.touches && evt.touches.length > 0 ? evt.touches[0].clientX : evt.clientX;
            const clientY = evt.touches && evt.touches.length > 0 ? evt.touches[0].clientY : evt.clientY;
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        }

function getRotatedPoint(x, y, centerX, centerY, angle) {
            const cos = Math.cos(-angle);
            const sin = Math.sin(-angle);
            const translatedX = x - centerX;
            const translatedY = y - centerY;
            return {
                x: translatedX * cos - translatedY * sin + centerX,
                y: translatedX * sin + translatedY * cos + centerY
            };
        }

function getAnnotationAtPosition(x, y) {
            for (let i = annotations.length - 1; i >= 0; i--) {
                const annotation = annotations[i];
                const angle = annotation.rotation || 0;
                let centerX, centerY;

                if (annotation.type === 'location' || annotation.type === 'text') { centerX = annotation.x; centerY = annotation.y; }
                else if (annotation.type === 'box') { centerX = annotation.x + annotation.width / 2; centerY = annotation.y + annotation.height / 2; }
                else if (annotation.type === 'arrow') { centerX = (annotation.startX + annotation.endX) / 2; centerY = (annotation.startY + annotation.endY) / 2; }

                // Pour des annotations simples, le centre de rotation est le centre de l'objet
                const rotatedPos = getRotatedPoint(x, y, centerX, centerY, angle);
                const testX = rotatedPos.x;
                const testY = rotatedPos.y;

                const tolerance = 15;
                let isInside = false;

                switch (annotation.type) {
                    case 'location':
                        isInside = Math.sqrt(Math.pow(testX - annotation.x, 2) + Math.pow(testY - annotation.y, 2)) <= annotation.radius + tolerance / 2;
                        break;
                    case 'box':
                        isInside = testX >= annotation.x - tolerance && testX <= annotation.x + annotation.width + tolerance &&
                            testY >= annotation.y - tolerance && testY <= annotation.y + annotation.height + tolerance;
                        break;
                    case 'text':
                        // Simple bounding box approx
                        const size = annotation.size || 30;
                        ctx.font = `bold ${size}px Oswald`;
                        const w = ctx.measureText(annotation.text).width;
                        const h = size;
                        isInside = testX >= annotation.x && testX <= annotation.x + w && testY >= annotation.y - h && testY <= annotation.y;
                        break;
                    case 'arrow':
                        const dx = annotation.endX - annotation.startX;
                        const dy = annotation.endY - annotation.startY;
                        const lenSq = dx * dx + dy * dy;
                        if (lenSq === 0) break;
                        const t = ((testX - annotation.startX) * dx + (testY - annotation.startY) * dy) / lenSq;
                        const projX = annotation.startX + t * dx;
                        const projY = annotation.startY + t * dy;
                        if (t >= 0 && t <= 1) {
                            // Vérification de la distance au carré de la position du clic à la ligne projetée
                            const distSq = Math.pow(testX - projX, 2) + Math.pow(testY - projY, 2);
                            isInside = distSq <= Math.pow(annotation.thickness + tolerance, 2);
                        } else {
                            // Vérification si l'on est proche des extrémités (pour les flèches courtes)
                            const distStartSq = Math.pow(testX - annotation.startX, 2) + Math.pow(testY - annotation.startY, 2);
                            const distEndSq = Math.pow(testX - annotation.endX, 2) + Math.pow(testY - annotation.endY, 2);
                            const maxDistSq = Math.pow(annotation.thickness + tolerance, 2);
                            isInside = distStartSq <= maxDistSq || distEndSq <= maxDistSq;
                        }
                        break;
                }

                if (isInside) return annotation;
            }
            return null;
        }

function getDragAfterElement(container, y) {
            // S'assurer de ne considérer que les éléments qui peuvent être déplacés
            const draggableElements = [...container.querySelectorAll('.draggable:not(.dragging):not(.time-item)')];
            return draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                }
                else {
                    return closest;
                }
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        }

async function compressImage(imageBlob, quality) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                const objectURL = URL.createObjectURL(imageBlob);
                img.src = objectURL;

                img.onload = () => {
                    URL.revokeObjectURL(objectURL);
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    const MAX_DIMENSION = 1920;
                    let { naturalWidth: width, naturalHeight: height } = img;
                    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                        if (width > height) {
                            height = (MAX_DIMENSION / width) * height;
                            width = MAX_DIMENSION;
                        } else {
                            width = (MAX_DIMENSION / height) * width;
                            height = MAX_DIMENSION;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;

                    // CORRECTION: Pour les PNG (image de fond ou annotée), ne pas forcer le fond blanc
                    if (imageBlob.type !== 'image/png') {
                        ctx.fillStyle = 'white';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }

                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob(
                        (blob) => {
                            if (blob) {
                                resolve(blob.arrayBuffer());
                            } else {
                                reject(new Error('La conversion du canevas en Blob a échoué.'));
                            }
                        },
                        // Utiliser PNG si le Blob original était PNG (y compris les images annotées), JPEG sinon
                        (imageBlob.type === 'image/png' ? 'image/png' : 'image/jpeg'),
                        quality
                    );
                };
                img.onerror = () => {
                    URL.revokeObjectURL(objectURL);
                    reject(new Error("Échec du chargement du Blob de l'image dans l'élément Image."));
                };
            });
        }