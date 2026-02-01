// Alura Flow - Content Script
// Handles state detection (Video vs Text vs Quiz) and creates the bridge to the Companion Window.

let autoAdvanceEnabled = true;
let currentState = null; // 'PLAYER' | 'CONTENT' | null
let lastTitle = "";

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
    const headerTitleEl = document.querySelector('.task-body-header-title-text');
    const title = headerTitleEl ? headerTitleEl.textContent.trim() : "Alura Flow";

    // A. VIDEO MODE
    const video = document.querySelector('video');

    // Enhanced Video Detection: Icon OR Container OR Player ID
    const isVideoLesson = !!document.querySelector('.task-body-header-title-svg use[href*="#VIDEO"]') ||
        !!document.querySelector('.video-container') ||
        !!document.querySelector('#video-player');

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
    const quizContainer = document.querySelector('.alternativeList');
    if (quizContainer) {
        if (currentState !== 'CONTENT' || title !== lastTitle || force) {
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
        }
        return;
    }

    // C. TEXT READING MODE
    // Filter out Transcriptions to prevent false positives
    const candidates = document.querySelectorAll('.hqExplanation .formattedText, #task-content .formattedText');
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

            // Extract Opinion
            let opinionHtml = null;
            const opinionEl = document.querySelector('#task-feedback .formattedText'); // Challenge opinion
            if (opinionEl) opinionHtml = opinionEl.innerHTML;

            chrome.runtime.sendMessage({
                type: 'UPDATE_STATE',
                mode: 'CONTENT',
                data: {
                    title: title,
                    html: textContent.innerHTML,
                    opinionHtml: opinionHtml
                }
            });

            // Save for persistence
            chrome.storage.local.set({
                currentReading: { title: title, html: textContent.innerHTML, opinionHtml: opinionHtml }
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
        chrome.runtime.sendMessage({ type: 'SPEED_UPDATED', speed: video.playbackRate });
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
                const nextBtn = document.querySelector('.task-actions-button-next');
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

function extractQuizData() {
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

        return {
            id: item.dataset.alternativeId,
            html: textEl ? textEl.innerHTML : "",
            opinionHTML: opinionEl ? opinionEl.innerHTML : "",
            isCorrect: isCorrect
        };
    });

    return {
        questionHTML,
        instructionHTML,
        options
    };
}

// --- SMART TRANSITIONS ---
function predictNextLesson() {
    try {
        const currentItem = document.querySelector('.task-menu-nav-item--selected');
        if (!currentItem) return null;

        const nextItem = currentItem.nextElementSibling;
        if (!nextItem) return null;

        const link = nextItem.querySelector('.task-menu-nav-item-link');
        if (!link) return null;

        // Check for Video Class or Icon
        const isVideo = link.classList.contains('task-menu-nav-item-link-VIDEO');
        if (isVideo) return 'VIDEO';

        return 'CONTENT'; // Default to content/text
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
        const nextBtn = document.querySelector('.task-actions-button-next');
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
        const feedback = document.querySelector('.choiceable-aria-feedback');
        if (feedback) {
            const text = feedback.textContent.toLowerCase();
            if (text.includes('acertou') || text.includes('parabéns')) {
                // Success
                if (autoAdvanceEnabled) {
                    setTimeout(() => {
                        const nextBtn = document.querySelector('.task-actions-button-next');
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
        const nextBtn = document.querySelector('.task-actions-button-next');
        if (nextBtn) {
            handleTransition();
            nextBtn.click();
        }
    }
    if (msg.type === 'COMMAND_PREV') {
        const prevBtn = document.querySelector('.task-actions-button-prev');
        if (prevBtn) {
            prevBtn.click();
        } else {
            // Fallback: Try to find previous sibling in navbar
            const currentItem = document.querySelector('.task-menu-nav-item--selected');
            if (currentItem && currentItem.previousElementSibling) {
                const prevLink = currentItem.previousElementSibling.querySelector('.task-menu-nav-item-link');
                if (prevLink) prevLink.click();
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
