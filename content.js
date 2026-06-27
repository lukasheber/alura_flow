// Alura Flow - Content Script
// Handles state detection (Video vs Text vs Quiz) and creates the bridge to the Companion Window.

let autoAdvanceEnabled = true;
let currentState = null; // 'PLAYER' | 'CONTENT' | null
let lastTitle = "";
let hasAutoAdvanced = false;

// --- DOM HELPERS ---
function getNextButton() {
    // 1. Check for Video Auto-Play Modal Continue button (Alura's new video player)
    const continueBtn = document.querySelector('.autoplay-continue-button');
    if (continueBtn && !continueBtn.closest('.vjs-hidden')) {
        return continueBtn;
    }

    // 2. Old selector
    let btn = document.querySelector('.task-actions-button-next');
    if (btn) return btn;

    // 3. New Data Slot selector
    const buttons = Array.from(document.querySelectorAll('button[data-slot="ds-button-root"], a[data-slot="ds-button-root"]'));
    const nextBtn = buttons.find(b => b.textContent.trim().toLowerCase().includes('avançar'));
    if (nextBtn) return nextBtn;

    // Fallback: old label span approach
    const labels = Array.from(document.querySelectorAll('span[data-slot="ds-button-label"]'));
    const labelSpan = labels.find(span => span.textContent.trim().toLowerCase() === 'avançar');
    return labelSpan ? labelSpan.closest('button, a') : null;
}

function getPrevButton() {
    let btn = document.querySelector('.task-actions-button-prev');
    if (btn) return btn;
    const buttons = Array.from(document.querySelectorAll('button[data-slot="ds-button-root"], a[data-slot="ds-button-root"]'));
    const prevBtn = buttons.find(b => {
        const text = b.textContent.trim().toLowerCase();
        return text.includes('anterior') || text.includes('voltar');
    });
    if (prevBtn) return prevBtn;

    const labels = Array.from(document.querySelectorAll('span[data-slot="ds-button-label"]'));
    const labelSpan = labels.find(span => {
        const text = span.textContent.trim().toLowerCase();
        return text === 'anterior' || text === 'voltar';
    });
    return labelSpan ? labelSpan.closest('button, a') : null;
}

// --- INITIALIZATION ---
function init() {
    console.log("Alura Flow: Content Script Initialized");

    // Load config
    chrome.storage.local.get(['playbackSpeed', 'autoAdvanceEnabled'], (res) => {
        if (res.autoAdvanceEnabled !== undefined) autoAdvanceEnabled = res.autoAdvanceEnabled;

        // Start Observers
        setupStateObserver();
        setupAutoAdvanceObserver();
    });
}

// --- STATE MANAGEMENT ---
function reportState(force = false) {
    // 1. Detect Context
    const headerTitleEl = document.querySelector('.task-body-header-title-text') ||
        document.querySelector('h2.font-encode-sans');
    const title = headerTitleEl ? headerTitleEl.textContent.trim() : "Alura Flow";

    // A. VIDEO MODE
    const video = document.querySelector('video');

    // Enhanced Video Detection: Icon OR Container OR Player ID OR New Data Attribute OR <video> tag OR Navigation Menu
    const isVideoLesson = !!document.querySelector('.task-body-header-title-svg use[href*="#VIDEO"]') ||
        !!document.querySelector('.video-container') ||
        !!document.querySelector('#video-player') ||
        !!document.querySelector('[data-vjs-player="true"]') ||
        !!video ||
        (function () {
            const allItems = Array.from(document.querySelectorAll('ul li.group a[href*="/task/"]'));
            const currentItem = allItems.find(a => a.classList.contains('bg-surface-default') || a.classList.contains('border-l-brand-default') || a.getAttribute('aria-current') === 'page');
            return currentItem && !!currentItem.querySelector('span.font-jetbrains-mono');
        })();

    if (isVideoLesson) {
        if (video) {
            if (currentState !== 'PLAYER' || title !== lastTitle || force) {
                currentState = 'PLAYER';
                lastTitle = title;
                console.log("Report State: PLAYER");

                // Attach Listeners to Video if new
                if (!video.dataset.afListener) {
                    attachVideoListeners(video);
                }

                chrome.runtime.sendMessage({
                    type: 'UPDATE_STATE',
                    mode: 'PLAYER',
                    data: {
                        title: title,
                        status: video.paused ? 'paused' : 'playing'
                    }
                });
            }
        } else {
            console.log("Video Lesson detected but <video> not ready. Waiting...");
            // Do NOT fall through to Text Content. Just wait for MutationObserver.
        }
        return; // STOP here if it is a video lesson
    }

    // B. QUIZ MODE
    const quizContainer = document.querySelector('.alternativeList') || getNewStructureQuizElements();
    if (quizContainer) {
        if (currentState !== 'CONTENT' || title !== lastTitle || force) {
            if (title !== lastTitle) hasAutoAdvanced = false;
            currentState = 'CONTENT';
            lastTitle = title;
            console.log("Report State: QUIZ");

            const quizData = extractQuizData();
            chrome.runtime.sendMessage({
                type: 'UPDATE_STATE',
                mode: 'CONTENT',
                data: {
                    title: title,
                    isQuiz: true,
                    ...quizData
                }
            });

            // Check if already solved and auto-advance
            if (quizData.isSolved && autoAdvanceEnabled && !hasAutoAdvanced) {
                console.log("Quiz already solved. Auto-advancing...");
                hasAutoAdvanced = true;
                setTimeout(() => {
                    handleTransition();
                    const nextBtn = getNextButton();
                    if (nextBtn) nextBtn.click();
                }, 1500);
            }
        }
        return;
    }

    // C. TEXT READING MODE
    // Filter out Transcriptions to prevent false positives
    const candidates = document.querySelectorAll('.hqExplanation .formattedText, #task-content .formattedText, section[aria-label="Conteúdo da aula"]');
    let textContent = null;

    for (const cand of candidates) {
        // Exclude if inside a transcription section
        if (cand.closest('.video-transcription')) continue;
        if (cand.closest('#transcription')) continue;

        textContent = cand;
        break;
    }

    if (textContent) {
        if (currentState !== 'CONTENT' || title !== lastTitle || force) {
            currentState = 'CONTENT';
            lastTitle = title;
            console.log("Report State: TEXT");

            // Clone to avoid modifying the actual page
            const cleanContent = textContent.cloneNode(true);

            // Remove "Estou com dúvida" slot and specific buttons
            const extraActionSlot = cleanContent.querySelector('#task-content-extra-action-slot');
            if (extraActionSlot) extraActionSlot.remove();

            const buttons = Array.from(cleanContent.querySelectorAll('button, a'));
            buttons.forEach(btn => {
                const text = btn.textContent.trim().toLowerCase();
                if (text.includes('estou com dúvida') || text === 'avançar') {
                    btn.remove();
                }
            });

            // Extract Opinion
            let opinionHtml = null;
            const opinionEl = document.querySelector('#task-feedback .formattedText'); // Challenge opinion
            if (opinionEl) opinionHtml = opinionEl.innerHTML;

            chrome.runtime.sendMessage({
                type: 'UPDATE_STATE',
                mode: 'CONTENT',
                data: {
                    title: title,
                    html: cleanContent.innerHTML,
                    opinionHtml: opinionHtml
                }
            });

            // Save for persistence
            chrome.storage.local.set({
                currentReading: { title: title, html: cleanContent.innerHTML, opinionHtml: opinionHtml }
            });
        }
        return;
    }
}

function attachVideoListeners(video) {
    video.dataset.afListener = "true";

    video.addEventListener('play', () => {
        chrome.runtime.sendMessage({ type: 'VIDEO_STATE_CHANGED', status: 'playing' });
    });

    video.addEventListener('pause', () => {
        chrome.runtime.sendMessage({ type: 'VIDEO_STATE_CHANGED', status: 'paused' });
    });

    video.addEventListener('ratechange', () => {
        // Prevent broadcasting the browser's automatic reset to 1.0 when video src changes in SPAs
        if (video.readyState === 0) return;
        chrome.runtime.sendMessage({ type: 'SPEED_UPDATED', speed: video.playbackRate });
    });

    // Enforce speed when new video loads
    video.addEventListener('loadedmetadata', () => {
        chrome.storage.local.get(['playbackSpeed'], (res) => {
            if (res.playbackSpeed && video.playbackRate !== res.playbackSpeed) {
                video.playbackRate = res.playbackSpeed;
            }
        });
    });

    // Apply persisted speed immediately when attaching
    chrome.storage.local.get(['playbackSpeed'], (res) => {
        if (res.playbackSpeed) {
            video.playbackRate = res.playbackSpeed;
        }
    });

    video.addEventListener('ended', () => {
        console.log("Video Ended. Auto-Advance logic...");
        // 1. Focus the window (Prepare for reading)
        chrome.runtime.sendMessage({ type: 'PREPARE_READING_MODE' });

        // 2. Click Next
        if (autoAdvanceEnabled) {
            // Optimistic switch trigger
            handleTransition();
            setTimeout(() => {
                const nextBtn = getNextButton();
                if (nextBtn) nextBtn.click();
            }, 1000);
        }
    });

    // Auto-Play Logic (Restored)
    console.log("Attempting auto-play...");
    const playButton = document.querySelector('.vjs-big-play-button') || document.querySelector('.video-js .vjs-play-control');
    if (playButton) {
        playButton.click();
    } else {
        video.play().catch((err) => console.warn("Auto-play failed:", err));
    }

    // Initial play check
    setTimeout(() => {
        if (!video.paused) chrome.runtime.sendMessage({ type: 'VIDEO_STATE_CHANGED', status: 'playing' });
    }, 500);
}

function getNewStructureQuizElements() {
    const instructionP = Array.from(document.querySelectorAll('p')).find(p => p.textContent.trim().toLowerCase().includes('selecione uma alternativa') || p.textContent.trim().toLowerCase().includes('selecione as alternativas'));

    if (instructionP) {
        const ul = instructionP.nextElementSibling;
        if (ul && ul.tagName === 'UL') {
            const options = ul.querySelectorAll('li button.group');
            if (options.length > 0) {
                return { instructionP, ul, options };
            }
        }
    }

    // Alternative: Just find the UL with the specific buttons
    const options = document.querySelectorAll('ul > li > button.group');
    if (options.length > 0 && options[0].querySelector('.text-task-alternative-content-text')) {
        const ul = options[0].closest('ul');
        let instructionP = ul.previousElementSibling;
        if (instructionP && instructionP.tagName !== 'P') instructionP = null;
        return { instructionP, ul, options };
    }

    return null;
}

function extractQuizData() {
    const newQuizData = getNewStructureQuizElements();

    if (newQuizData) {
        // New Structure
        let questionHTML = "";
        let currentElement = newQuizData.instructionP ? newQuizData.instructionP.previousElementSibling : newQuizData.ul.previousElementSibling;
        const questionElements = [];

        while (currentElement) {
            // Stop if we hit a div that looks like a header or container
            if (currentElement.tagName === 'DIV' || currentElement.tagName === 'HEADER') {
                break;
            }
            if (currentElement.tagName === 'P') {
                questionElements.unshift(currentElement.outerHTML);
            }
            currentElement = currentElement.previousElementSibling;
        }

        questionHTML = questionElements.length > 0 ? questionElements.join('') : "Questão";
        const instructionHTML = newQuizData.instructionP ? newQuizData.instructionP.innerHTML : "";

        const options = Array.from(newQuizData.options).map((btn, index) => {
            const textContainer = btn.querySelector('.text-task-alternative-content-text');
            const html = textContainer ? textContainer.innerHTML : "";

            // Make a best guess on states
            const isSelected = btn.className.includes('border-interactive-primary') || btn.className.includes('bg-surface-secondary') || btn.getAttribute('aria-selected') === 'true';
            const isCorrect = btn.className.includes('success') || btn.className.includes('correct');

            return {
                id: index.toString(),
                html: html,
                opinionHTML: "",
                isCorrect: isCorrect,
                isSelected: isSelected,
                isNewStructure: true
            };
        });

        const isMultiple = instructionHTML.toLowerCase().includes('alternativas');
        let requiredChoices = 0;
        if (isMultiple) {
            const match = instructionHTML.match(/selecione\s+(\d+)/i);
            if (match) requiredChoices = parseInt(match[1], 10);
        }

        return {
            questionHTML,
            instructionHTML,
            options,
            isSolved: options.some(o => o.isCorrect && o.isSelected),
            isMultiple,
            requiredChoices
        };
    }

    const questionEl = document.querySelector('.choiceable-title');
    const questionHTML = questionEl ? questionEl.innerHTML : "Questão";

    // Extract Instruction (e.g. "Selecione 2 alternativas")
    let instructionEl = document.querySelector('.choiceable-description');
    if (!instructionEl) {
        // Try alternate selectors based on user feedback
        instructionEl = document.querySelector('.singleChoice-count') || document.querySelector('.multipleChoice-count');
    }
    const instructionHTML = instructionEl ? instructionEl.innerHTML : "";

    const items = document.querySelectorAll('.alternativeList-item');
    const options = Array.from(items).map(item => {
        const textEl = item.querySelector('.alternativeList-item-alternative');
        const opinionEl = item.querySelector('.alternativeList-item-alternativeOpinion');

        // Rough correctness check
        let isCorrect = (item.dataset.correct === "true");
        // Fallback check in opinion text if dataset is unreliable
        if (opinionEl && opinionEl.textContent.toLowerCase().includes('correta')) isCorrect = true;

        const isSelected = item.classList.contains('alternativeList-item--checked') ||
            item.querySelector('input:checked');

        return {
            id: item.dataset.alternativeId,
            html: textEl ? textEl.innerHTML : "",
            opinionHTML: opinionEl ? opinionEl.innerHTML : "",
            isCorrect: isCorrect,
            isSelected: !!isSelected
        };
    });

    // Check if the quiz is fully solved (correct answer selected)
    // For multiple choice, we might need stricter logic, but for now checking if ANY correct answer is selected is a good start.
    // Ideally, we check if ALL loaded correct answers are selected.
    const isSolved = options.some(o => o.isCorrect && o.isSelected);

    // Detect Multiple Choice
    const isMultiple = Array.from(items).some(i => i.querySelector('input[type="checkbox"]'));

    // Extract required choices count
    let requiredChoices = 0;
    if (isMultiple) {
        // Try to parse "Selecione X alternativas"
        const match = instructionHTML.match(/selecione\s+(\d+)/i);
        if (match) requiredChoices = parseInt(match[1], 10);
    }

    return {
        questionHTML,
        instructionHTML,
        options,
        isSolved,
        isMultiple,
        requiredChoices
    };
}

// --- SMART TRANSITIONS ---
function predictNextLesson() {
    try {
        // Old structure
        const oldCurrentItem = document.querySelector('.task-menu-nav-item--selected');
        if (oldCurrentItem) {
            const nextItem = oldCurrentItem.nextElementSibling;
            if (!nextItem) return null;
            const link = nextItem.querySelector('.task-menu-nav-item-link');
            if (!link) return null;
            const isVideo = link.classList.contains('task-menu-nav-item-link-VIDEO');
            return isVideo ? 'VIDEO' : 'CONTENT';
        }

        // New structure
        const allItems = Array.from(document.querySelectorAll('ul li.group a[href*="/task/"]'));
        const currentIndex = allItems.findIndex(a => a.classList.contains('bg-surface-default') || a.classList.contains('border-l-brand-default') || a.getAttribute('aria-current') === 'page');

        if (currentIndex >= 0 && currentIndex < allItems.length - 1) {
            const nextLink = allItems[currentIndex + 1];
            // Videos have a duration span with font-jetbrains-mono (e.g. "02 min")
            const isVideo = !!nextLink.querySelector('span.font-jetbrains-mono');
            return isVideo ? 'VIDEO' : 'CONTENT';
        }

        return null;
    } catch (e) {
        console.error("Prediction failed:", e);
        return null;
    }
}

function handleTransition() {
    const predictedType = predictNextLesson();
    console.log("Predicted Next Lesson Type:", predictedType);
    if (predictedType) {
        chrome.runtime.sendMessage({
            type: 'TRANSITION_START',
            predictedMode: predictedType === 'VIDEO' ? 'PLAYER' : 'CONTENT'
        });
    }
}

// --- OBSERVERS ---
function setupStateObserver() {
    // 1. Mutation Observer for SPA changes
    const observer = new MutationObserver((mutations) => {
        // Debounce simple changes
        // Check if main content changed
        const contentChanged = mutations.some(m =>
            m.target.id === 'task-content' ||
            m.target.classList.contains('task-body') ||
            m.target.tagName === 'VIDEO'
        );

        if (contentChanged) {
            reportState();
        }

        // Listen for Next Button (if re-rendered)
        const nextBtn = getNextButton();
        if (nextBtn && !nextBtn.dataset.afTransition) {
            nextBtn.dataset.afTransition = "true";
            nextBtn.addEventListener('click', handleTransition);
        }
    });

    const target = document.querySelector('.task-body') || document.body;
    observer.observe(target, { childList: true, subtree: true });

    // 2. Interval check (Safety net for slow loads)
    setInterval(() => reportState(), 2000);

    // 3. Initial Report
    setTimeout(() => reportState(true), 1000);
}

function setupAutoAdvanceObserver() {
    // Watch for Quiz completion / feedback
    const observer = new MutationObserver((mutations) => {
        // --- OLD STRUCTURE ---
        const feedback = document.querySelector('.choiceable-aria-feedback');
        if (feedback && !feedback.dataset.afFeedbackHandled) {
            feedback.dataset.afFeedbackHandled = "true";
            const text = feedback.textContent.toLowerCase();
            if (text.includes('acertou') || text.includes('parabéns')) {
                // Success
                const correctItems = document.querySelectorAll('.alternativeList-item--correct');
                const ids = Array.from(correctItems).map(i => i.dataset.alternativeId);
                chrome.runtime.sendMessage({ type: 'QUIZ_FEEDBACK_SUCCESS', correctIds: ids });

                if (autoAdvanceEnabled) {
                    setTimeout(() => {
                        const nextBtn = getNextButton();
                        if (nextBtn) {
                            handleTransition();
                            nextBtn.click();
                        }
                    }, 1500);
                }
            } else if (text.includes('errou') || text.includes('tente novamente')) {
                // Error
                chrome.runtime.sendMessage({ type: 'QUIZ_FEEDBACK_ERROR' });

                // Find correct ones
                const correctItems = document.querySelectorAll('.alternativeList-item--correct');
            const ids = Array.from(correctItems).map(i => i.dataset.alternativeId);
                if (ids.length > 0) {
                    chrome.runtime.sendMessage({ type: 'QUIZ_REVEAL_CORRECT', correctIds: ids });
                }
            }
        }

        // --- NEW STRUCTURE ---
        const newQuizData = getNewStructureQuizElements();
        if (newQuizData && newQuizData.ul) {
            const options = Array.from(newQuizData.options);

            const hasCorrect = options.some(btn => btn.querySelector('[aria-label="Resposta correta"]') || btn.className.includes('feedback-success'));
            const hasError = options.some(btn => btn.querySelector('[aria-label="Resposta incorreta"]') || btn.className.includes('feedback-error') || btn.className.includes('incorrect'));

            let currentStateStr = "none";
            if (hasCorrect) {
                currentStateStr = "correct";
            } else if (hasError) {
                const errorIndices = [];
                options.forEach((btn, idx) => {
                    if (btn.querySelector('[aria-label="Resposta incorreta"]') || btn.className.includes('feedback-error') || btn.className.includes('incorrect')) {
                        errorIndices.push(idx);
                    }
                });
                currentStateStr = "error:" + errorIndices.join(',');
            }

            if (currentStateStr !== "none" && newQuizData.ul.dataset.afFeedbackState !== currentStateStr) {
                newQuizData.ul.dataset.afFeedbackState = currentStateStr;

                const correctIds = [];
                options.forEach((btn, index) => {
                    if (btn.querySelector('[aria-label="Resposta correta"]') || btn.className.includes('feedback-success')) {
                        correctIds.push(index.toString());
                    }
                });

                if (currentStateStr === "correct") {
                    // Success
                    chrome.runtime.sendMessage({ type: 'QUIZ_FEEDBACK_SUCCESS', correctIds: correctIds });
                    if (autoAdvanceEnabled) {
                        setTimeout(() => {
                            const nextBtn = getNextButton();
                            if (nextBtn) {
                                handleTransition();
                                nextBtn.click();
                            }
                        }, 1500);
                    }
                } else if (currentStateStr.startsWith("error")) {
                    // Error
                    chrome.runtime.sendMessage({ type: 'QUIZ_FEEDBACK_ERROR' });
                    if (correctIds.length > 0) {
                        chrome.runtime.sendMessage({ type: 'QUIZ_REVEAL_CORRECT', correctIds: correctIds });
                    }
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
}

// --- MESSAGE HANDLING ---
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'COMMAND_PLAY_PAUSE') {
        const video = document.querySelector('video');
        if (video) {
            if (video.paused) video.play(); else video.pause();
        }
    }
    if (msg.type === 'COMMAND_NEXT' || msg.type === 'FINISH_READING') {
        const nextBtn = getNextButton();
        if (nextBtn) {
            handleTransition();
            nextBtn.click();
        }
    }
    if (msg.type === 'COMMAND_PREV') {
        const prevBtn = getPrevButton();
        if (prevBtn) {
            prevBtn.click();
        } else {
            // Fallback: Try to find previous sibling in navbar
            const oldCurrentItem = document.querySelector('.task-menu-nav-item--selected');
            if (oldCurrentItem && oldCurrentItem.previousElementSibling) {
                const prevLink = oldCurrentItem.previousElementSibling.querySelector('.task-menu-nav-item-link');
                if (prevLink) prevLink.click();
            } else {
                // New structure fallback
                const allItems = Array.from(document.querySelectorAll('ul li.group a[href*="/task/"]'));
                const currentIndex = allItems.findIndex(a => a.classList.contains('bg-surface-default') || a.classList.contains('border-l-brand-default'));
                if (currentIndex > 0) {
                    allItems[currentIndex - 1].click();
                }
            }
        }
    }
    if (msg.type === 'COMMAND_CYCLE_SPEED') {
        const video = document.querySelector('video');
        if (video) {
            const speeds = [1.0, 1.25, 1.5, 2.0];
            let current = video.playbackRate;
            // Find closest
            let idx = speeds.findIndex(s => Math.abs(s - current) < 0.1);
            if (idx === -1) idx = 0; // Default to 1.0

            let nextIdx = (idx + 1) % speeds.length;
            video.playbackRate = speeds[nextIdx];

            console.log("Video Speed cycled to:", video.playbackRate);
            // ratechange event will handle the broadcast
        }
    }
    if (msg.type === 'UPDATE_SPEED') {
        const video = document.querySelector('video');
        if (video) video.playbackRate = msg.speed;
    }
    if (msg.type === 'SELECT_OPTION') {
        const item = document.querySelector(`.alternativeList-item[data-alternative-id="${msg.optionId}"]`);
        if (item) {
            const label = item.querySelector('label');
            if (label) label.click();
        } else {
            // New structure fallback
            const newQuizData = getNewStructureQuizElements();
            if (newQuizData && newQuizData.options) {
                const index = parseInt(msg.optionId, 10);
                if (!isNaN(index) && newQuizData.options[index]) {
                    newQuizData.options[index].click();
                }
            }
        }
    }
    if (msg.type === 'COMPANION_READY') {
        // Companion just opened/refreshed, force update
        reportState(true);
    }
});

// Run
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
