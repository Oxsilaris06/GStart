function showStep(n) {
            steps.forEach((step, index) => step.classList.toggle('active', index === n));
            progressSteps.forEach((pStep, index) => {
                pStep.classList.toggle('active', index === n);
                if (visitedSteps.has(index) && index !== n) pStep.classList.add('completed');
                else pStep.classList.remove('completed');
            });
            prevBtn.style.display = n === 0 ? "none" : "inline-block";
            // Mise à jour: 9 étapes au total (0 à 8). La dernière étape est l'index 8.
            const isLastStep = n === (steps.length - 1);
            nextBtn.style.display = isLastStep ? "none" : "inline-block";

            if (isLastStep) {
                previewBtn.style.display = "inline-block";
                checkCoherence();
            } else {
                previewBtn.style.display = "none";
            }
        }

function goToStep(n) {
            if (n >= 0 && n < steps.length) {
                visitedSteps.add(currentStep);
                currentStep = n;
                localStorage.setItem('oiWizardStep', currentStep);
                showStep(n);
            }
        }

function changeStep(n) { goToStep(currentStep + n); }