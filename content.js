// Default config
let autoAdvanceEnabled = true;

// Helper to find video securely (retries if not found immediately)
function waitForElement(selector, callback, timeout = 10000) {
    const el = document.querySelector(selector);
    if (el) {
        callback(el);
        return;
    }

    const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
            obs.disconnect();
            callback(el);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Optional timeout to stop looking
    if (timeout > 0) {
        setTimeout(() => { observer.disconnect(); }, timeout);
    }
}

function setupAutoNext() {
    // Load settings first (async)
    chrome.storage.local.get(['playbackSpeed', 'autoAdvanceEnabled', 'shortcutsEnabled'], (result) => {
        if (result.autoAdvanceEnabled !== undefined) {
            autoAdvanceEnabled = result.autoAdvanceEnabled;
            console.log("Auto-Advance state:", autoAdvanceEnabled);
        }

        if (result.shortcutsEnabled !== undefined) {
            shortcutsEnabled = result.shortcutsEnabled;
            console.log("Shortcuts state loaded:", shortcutsEnabled);
        }

        // 1. Text Lesson Rule: "O que aprendemos?"
        const headerTitle = document.querySelector('.task-body-header-title-text');
        if (headerTitle && headerTitle.textContent.includes('O que aprendemos?') && autoAdvanceEnabled) {
            console.log("Found 'O que aprendemos?' header. Auto-advancing in 2 seconds...");
            setTimeout(() => {
                const nextButton = document.querySelector('.task-actions-button-next');
                if (nextButton) nextButton.click();
            }, 2000);
        }

        // 2. Video Rule - Now using waitForElement to handle dynamic loading
        waitForElement('video', (video) => {
            console.log("Video element found (possibly late load). Attaching 'ended' listener.");

            // Apply saved speed
            if (result.playbackSpeed) {
                console.log("Applying saved speed:", result.playbackSpeed);
                video.playbackRate = result.playbackSpeed;
            }

            // Ensure we don't attach double listeners if setup runs twice
            if (!video.dataset.listenerAttached) {
                video.addEventListener('ended', () => {
                    console.log("Video ended.");
                    if (autoAdvanceEnabled) {
                        console.log("Auto-Advance is ON. Clicking 'Next Activity'...");
                        const nextButton = document.querySelector('.task-actions-button-next');
                        if (nextButton) {
                            nextButton.click();
                        } else {
                            console.warn("Next button not found with selector: .task-actions-button-next");
                        }
                    }
                });

                // Enforce Speed on external changes (e.g. player resetting it)
                video.addEventListener('ratechange', () => {
                    // Check if it matches our desired speed
                    chrome.storage.local.get(['playbackSpeed'], (res) => {
                        if (res.playbackSpeed && Math.abs(video.playbackRate - res.playbackSpeed) > 0.1) {
                            console.log("Speed reset detected. Re-applying:", res.playbackSpeed);
                            video.playbackRate = res.playbackSpeed;
                        }
                    });
                });

                video.dataset.listenerAttached = "true";

                // Auto-play logic
                console.log("Attempting auto-play...");
                // Try clicking the UI overlay first to sync state, if possible
                const playButton = document.querySelector('.vjs-big-play-button') || document.querySelector('.video-js .vjs-play-control');
                if (playButton) {
                    playButton.click();
                } else {
                    video.play().catch((err) => {
                        console.warn("Auto-play failed:", err);
                    });
                }
            }
        });

        // 3. Quiz Detection & Scraping (Run once per load)
        checkForQuiz();

        // 4. Reading Activity Detection
        checkForReading();
    });
}

function checkForQuiz() {
    // Also might load dynamically, but usually static on Alura. 
    // If needed we could use waitForElement here too, but let's stick to current logic.
    const alternativesContainer = document.querySelector('.alternativeList');
    if (alternativesContainer) {
        console.log("Quiz detected. Extracting data...");

        // Extract Question
        const questionTitle = document.querySelector('.choiceable-title');
        const questionHTML = questionTitle ? questionTitle.innerHTML : "Question";

        // Detect Multiple Choice Info
        const multiChoiceSpan = document.querySelector('#multipleChoice-count-number');
        let requiredChoices = 1;
        let isMultiple = false;
        if (multiChoiceSpan) {
            const num = parseInt(multiChoiceSpan.textContent.trim());
            if (!isNaN(num) && num > 1) {
                requiredChoices = num;
                isMultiple = true;
            }
        }

        // Extract Options
        const options = [];
        const items = document.querySelectorAll('.alternativeList-item');

        items.forEach(item => {
            const id = item.dataset.alternativeId;
            const textEl = item.querySelector('.alternativeList-item-alternative');
            const opinionEl = item.querySelector('.alternativeList-item-alternativeOpinion');

            // Determine correctness
            // 1. Trust explicit data-correct (rarely true pre-answer, but safe)
            let isCorrect = (item.dataset.correct === "true");

            // 2. Heuristics for EXPLICIT confirmation in hidden text
            if (opinionEl) {
                const opinionText = (opinionEl.textContent || "").toLowerCase();

                // Negative check
                if (opinionText.includes("incorreta") || opinionText.includes(" incorreto ") || opinionText.includes("falso")) {
                    isCorrect = false;
                }
                // Positive check (Restored per user request)
                else if (opinionText.includes("alternativa correta") || opinionText.includes("afirmação está correta") || opinionText.includes("correto afirma")) {
                    isCorrect = true;
                }
            }

            options.push({
                id: id,
                html: textEl ? textEl.innerHTML : "Option",
                opinionHTML: opinionEl ? (opinionEl.innerHTML || "") : "",
                isCorrect: isCorrect
            });
        });


        // Save to storage
        chrome.storage.local.set({
            currentQuiz: {
                questionHTML,
                options,
                isMultiple,
                requiredChoices
            }
        });

        // FIX: Replaced !alreadyAnswered with !alreadyCorrect
        // We want to open the popup even if answered, as long as it wasn't answered CORRECTLY.
        // This allows retrying from the popup.
        const alreadyCorrect = document.querySelector('.alternativeList-item--correct') || document.querySelector('.alternativeList-item--is-correct');

        if (!alreadyCorrect && options.length > 0) {

            // Helper to attempt opening
            const tryOpenQuiz = () => {
                // Double check specific correct status again to be safe
                const isDone = document.querySelector('.alternativeList-item--correct') || document.querySelector('.alternativeList-item--is-correct');
                if (!isDone && document.hidden) {
                    console.log("Tab hidden & Quiz pending/retry. Opening Popup.");
                    chrome.runtime.sendMessage({ type: 'OPEN_QUIZ_WINDOW' });
                }
            };

            // Delay initial check to allow visibility state to settle
            setTimeout(tryOpenQuiz, 500);

            // Also check if user switches tabs later
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    tryOpenQuiz();
                }
            });
        }

        // 4. Listen for Success OR Error
        if (autoAdvanceEnabled) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    const feedback = document.querySelector('.choiceable-aria-feedback');
                    const feedbackText = feedback ? feedback.textContent.toLowerCase() : "";

                    // Success Check
                    const isSuccess = feedbackText.includes("acertou") ||
                        feedbackText.includes("mandou bem") ||
                        feedbackText.includes("parabéns") ||
                        feedbackText.includes("correto");

                    // Error Check
                    const isError = feedbackText.includes("errou") ||
                        feedbackText.includes("tente novamente") ||
                        feedbackText.includes("incorreta");

                    if (isSuccess) {
                        console.log("Success detected! Auto-advancing...");
                        chrome.runtime.sendMessage({ type: 'CLOSE_QUIZ_WINDOW' });
                        observer.disconnect();
                        setTimeout(() => {
                            const nextButton = document.querySelector('.task-actions-button-next');
                            if (nextButton) nextButton.click();
                        }, 2000);
                    }
                    else if (isError) {
                        console.log("Error detected. Sending feedback to popup.");
                        chrome.runtime.sendMessage({ type: 'QUIZ_FEEDBACK_ERROR' });

                        // Try to find if the correct answer was revealed on screen
                        // Look for items that gained the .alternativeList-item--correct class
                        setTimeout(() => {
                            const correctItems = document.querySelectorAll('.alternativeList-item--correct, .alternativeList-item--is-correct');
                            if (correctItems.length > 0) {
                                const correctIds = [];
                                correctItems.forEach(i => correctIds.push(i.dataset.alternativeId));
                                console.log("Correct answer revealed:", correctIds);
                                chrome.runtime.sendMessage({ type: 'QUIZ_REVEAL_CORRECT', correctIds: correctIds });
                            }
                        }, 500); // Wait a bit for UI update
                    }
                });
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        }
    }
}

function checkForReading() {
    const headerTitleElement = document.querySelector('.task-body-header-title-text');
    if (!headerTitleElement) return;

    const title = headerTitleElement.textContent.trim();
    // EXCLUSION 1: Do not open for "O que aprendemos?" as that has its own auto-advance rule
    if (title.includes('O que aprendemos?')) {
        return;
    }

    // EXCLUSION 2: Do not open for VIDEO lessons. 
    // We check the header icon.
    const headerIcon = document.querySelector('.task-body-header-title-svg use');
    if (headerIcon) {
        const iconHref = headerIcon.getAttribute('xlink:href') || headerIcon.getAttribute('href');
        if (iconHref && iconHref.includes('#VIDEO')) {
            console.log("Skipping Reading Window: Detected VIDEO lesson.");
            return;
        }
    }

    // EXCLUSION 3: Do not open for QUIZ lessons.
    // Quizzes use .alternativeList, and we have a separate popup for them.
    if (document.querySelector('.alternativeList')) {
        console.log("Skipping Reading Window: Detected QUIZ lesson.");
        return;
    }

    // SCENARIO 1: Standard Reading (.hqExplanation)
    const readingSection = document.querySelector('.hqExplanation');
    if (readingSection) {
        console.log("Reading activity detected (Standard).");
        const contentEl = readingSection.querySelector('.formattedText');
        if (contentEl) {
            chrome.storage.local.set({
                currentReading: { title: title, html: contentEl.innerHTML, opinionHtml: null }
            });

            const tryOpenReading = () => {
                if (document.hidden) {
                    console.log("Tab hidden. Opening Reading Popup.");
                    chrome.runtime.sendMessage({ type: 'OPEN_READING_WINDOW' });
                }
            };

            setTimeout(tryOpenReading, 500);
            document.addEventListener('visibilitychange', tryOpenReading);
        }
        return;
    }

    // SCENARIO 2: Challenge / "Desafio" (#task-content)
    // The main text is in #task-content .formattedText
    // The instructor opinion is in #task-feedback .formattedText (might be hidden initially)
    const taskContent = document.querySelector('#task-content');
    if (taskContent) {
        // Check if it's broadly a text content (videos also have #task-content sometimes, but usually different structure)
        // We check for .formattedText inside it.
        const mainTextEl = taskContent.querySelector('.formattedText');

        if (mainTextEl) {
            console.log("Reading activity detected (Challenge/Task).");

            let opinionHtml = null;
            const feedbackSection = document.querySelector('#task-feedback');
            if (feedbackSection) {
                const opinionEl = feedbackSection.querySelector('.formattedText');
                if (opinionEl) {
                    opinionHtml = opinionEl.innerHTML;
                }
            }

            chrome.storage.local.set({
                currentReading: { title: title, html: mainTextEl.innerHTML, opinionHtml: opinionHtml }
            });

            const tryOpenChallenge = () => {
                if (document.hidden) {
                    console.log("Tab hidden. Opening Challenge Popup.");
                    chrome.runtime.sendMessage({ type: 'OPEN_READING_WINDOW' });
                }
            };

            setTimeout(tryOpenChallenge, 500);
            document.addEventListener('visibilitychange', tryOpenChallenge);
        }
    }
}

// Run setup when the page is fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAutoNext);
} else {
    setupAutoNext();
}

// Listen for messages from popup or quiz/reading window
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'UPDATE_SPEED') {
        // Here too, video might be dynamic or changed
        const video = document.querySelector('video');
        if (video) video.playbackRate = message.speed;
    }
    if (message.type === 'UPDATE_AUTO_ADVANCE') {
        autoAdvanceEnabled = message.enabled;
    }
    if (message.type === 'SELECT_OPTION') {
        const item = document.querySelector(`.alternativeList-item[data-alternative-id="${message.optionId}"]`);
        if (item) {
            const label = item.querySelector('label');
            const input = item.querySelector('input');
            if (label) label.click();
            else if (input) input.click();
        }
    }
    if (message.type === 'FINISH_READING') {
        console.log("Reading finished. advancing...");
        const nextButton = document.querySelector('.task-actions-button-next');
        if (nextButton) nextButton.click();
    }
    if (message.type === 'UPDATE_SHORTCUTS') {
        shortcutsEnabled = message.enabled;
        console.log("Shortcuts toggled:", shortcutsEnabled);
    }

    // --- Command Handling (from Background) ---
    if (!shortcutsEnabled) return; // Ignore if disabled

    if (message.type === 'COMMAND_NEXT') {
        console.log("Command: Next Lesson");
        const nextButton = document.querySelector('.task-actions-button-next');
        if (nextButton) nextButton.click();
    }

    if (message.type === 'COMMAND_PLAY_PAUSE') {
        console.log("Command: Play/Pause");
        const video = document.querySelector('video');
        if (video) {
            if (video.paused) video.play();
            else video.pause();
        }
    }

    if (message.type === 'COMMAND_CYCLE_SPEED') {
        console.log("Command: Cycle Speed");
        const video = document.querySelector('video');
        if (video) {
            let current = video.playbackRate;
            let next = 1.0;
            if (current < 1.4) next = 1.5;
            else if (current < 1.9) next = 2.0;
            else next = 1.0;

            video.playbackRate = next;
            chrome.storage.local.set({ playbackSpeed: next });
            console.log(`Speed changed to ${next}x`);
        }
    }
});

// Global Shortcuts Logic
let shortcutsEnabled = false;
// Document keydown listener removed in favor of chrome.commands for global support.
