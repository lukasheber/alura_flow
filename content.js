// Alura Flow - Alura page bridge
'use strict';

const settings = {
    autoPlayEnabled: true,
    autoAdvanceEnabled: true,
    autoAdvanceDelay: 5,
    playbackSpeed: 1,
    autoReadEnabled: true,
    rsvpAfterVideoEnabled: false,
    perCourseSettings: true,
    courseProfiles: {}
};
let currentViewKey = '';
let currentMode = null;
let lastSuccessfulReport = 0;
let diagnosticSentFor = '';
let transitionTimer = null;
let countdownTimer = null;
let observerDebounce = null;
let activeVideoTranscriptLessonId = null;
let transcriptLoadingPending = false;
let transcriptLoadingLessonId = null;

function getNextButton() {
    const continueButton = document.querySelector('.autoplay-continue-button');
    if (continueButton && !continueButton.closest('.vjs-hidden')) return continueButton;
    const oldButton = document.querySelector('.task-actions-button-next');
    if (oldButton) return oldButton;
    const buttons = Array.from(document.querySelectorAll('button[data-slot="ds-button-root"], a[data-slot="ds-button-root"]'));
    return buttons.find(button => /avançar|próxima/i.test(button.textContent.trim())) ||
        Array.from(document.querySelectorAll('span[data-slot="ds-button-label"]'))
            .find(label => /^(avançar|próxima)$/i.test(label.textContent.trim()))?.closest('button, a') || null;
}

function getPrevButton() {
    const oldButton = document.querySelector('.task-actions-button-prev');
    if (oldButton) return oldButton;
    const buttons = Array.from(document.querySelectorAll('button[data-slot="ds-button-root"], a[data-slot="ds-button-root"]'));
    return buttons.find(button => /anterior|voltar/i.test(button.textContent.trim())) || null;
}

function lessonContext() {
    const titleElement = document.querySelector('.task-body-header-title-text') || document.querySelector('h2.font-encode-sans');
    return {
        title: titleElement?.textContent.trim() || document.title || 'Alura Flow',
        url: location.href,
        lessonId: AluraFlowCore.lessonIdFromUrl(location.href),
        courseId: AluraFlowCore.courseIdFromUrl(location.href),
        language: document.documentElement.lang || 'pt-BR'
    };
}

function effectivePlaybackSpeed(courseId) {
    if (settings.perCourseSettings && settings.courseProfiles?.[courseId]?.playbackSpeed) {
        return Number(settings.courseProfiles[courseId].playbackSpeed);
    }
    return Number(settings.playbackSpeed) || 1;
}

function sanitizeClone(source) {
    const clone = source.cloneNode(true);
    clone.querySelectorAll('script, iframe, object, embed, form, input, textarea, select, button, meta, base').forEach(node => node.remove());
    clone.querySelectorAll('*').forEach(element => {
        Array.from(element.attributes).forEach(attribute => {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || name === 'srcdoc') element.removeAttribute(attribute.name);
        });

        ['href', 'src', 'poster'].forEach(name => {
            if (!element.hasAttribute(name)) return;
            try {
                const absolute = new URL(element.getAttribute(name), location.href);
                if (!['http:', 'https:', 'data:'].includes(absolute.protocol) || (name === 'href' && absolute.protocol === 'data:')) {
                    element.removeAttribute(name);
                } else {
                    element.setAttribute(name, absolute.href);
                }
            } catch (_) {
                element.removeAttribute(name);
            }
        });
        if (element.tagName === 'A') {
            element.setAttribute('target', '_blank');
            element.setAttribute('rel', 'noopener noreferrer');
        }
    });
    clone.querySelectorAll('#task-content-extra-action-slot').forEach(node => node.remove());
    return clone;
}

function sendState(mode, data, forceBind = false) {
    lastSuccessfulReport = Date.now();
    chrome.runtime.sendMessage({ type: 'UPDATE_STATE', mode, data, forceBind });
}

function getVideoElement() {
    return document.querySelector('video-js video.vjs-tech, video-js video, .video-js video.vjs-tech, .video-js video, video');
}

function getVideoRoot(video) {
    return video?.closest('video-js, .video-js') || document.querySelector('video-js, .video-js');
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function findTranscriptionTab() {
    return Array.from(document.querySelectorAll('aside button')).find(button =>
        /transcri[cç][aã]o/i.test(button.getAttribute('title') || button.textContent || '')
    ) || null;
}

function transcriptionPanelForTab(tab) {
    const tabList = tab?.parentElement;
    const panelHost = tabList?.nextElementSibling;
    if (!tabList || !panelHost) return null;
    const tabs = Array.from(tabList.children).filter(element => element.tagName === 'BUTTON');
    const panels = Array.from(panelHost.children).filter(element => element.nodeType === Node.ELEMENT_NODE);
    const index = tabs.indexOf(tab);
    return index >= 0 ? panels[index] || null : null;
}

async function loadVideoTranscription(timeout = 15000) {
    const openSidebar = Array.from(document.querySelectorAll('button[aria-label]')).find(button =>
        /abrir.*menu lateral/i.test(button.getAttribute('aria-label') || '')
    );
    if (openSidebar) {
        openSidebar.click();
        await wait(250);
    }

    const tabDeadline = Date.now() + Math.min(2500, timeout);
    let tab = findTranscriptionTab();
    while (!tab && Date.now() < tabDeadline) {
        await wait(100);
        tab = findTranscriptionTab();
    }
    if (!tab) return { available: false };

    tab.click();
    const startedLoadingAt = Date.now();
    const deadline = Date.now() + timeout;
    const minimumWords = 20;
    let stableFingerprint = '';
    let stableSince = 0;
    let bestWordCount = 0;
    while (Date.now() < deadline) {
        const panel = transcriptionPanelForTab(tab);
        if (panel) {
            const cleanContent = sanitizeClone(panel);
            const blockCount = cleanContent.querySelectorAll('p, h1, h2, h3, li, blockquote, pre').length;
            const text = cleanContent.textContent.replace(/\s+/g, ' ').trim();
            const wordCount = AluraFlowCore.parseRsvpText(text).length;
            bestWordCount = Math.max(bestWordCount, wordCount);
            if (AluraFlowCore.isReadableTextCandidate(text, blockCount) && wordCount >= minimumWords && !/^(carregando|loading)\b/i.test(text)) {
                const fingerprint = `${AluraFlowCore.textFingerprint(text)}:${blockCount}`;
                if (fingerprint !== stableFingerprint) {
                    stableFingerprint = fingerprint;
                    stableSince = Date.now();
                } else if (Date.now() - stableSince >= 2500 && Date.now() - startedLoadingAt >= 4000) {
                    return { available: true, text, html: cleanContent.innerHTML, blockCount, wordCount };
                }
            } else {
                stableFingerprint = '';
                stableSince = 0;
            }
        }
        await wait(150);
    }
    return { available: true, loadingFailed: true, wordCount: bestWordCount, minimumWords };
}

function cancelNativeVideoAdvance(video, timeout = 5000) {
    const root = getVideoRoot(video);
    const startedAt = Date.now();
    let clickedHiddenFallback = false;
    const attempt = () => {
        const buttons = Array.from((root || document).querySelectorAll('.autoplay-cancel-button'));
        const visible = buttons.find(button => !button.closest('.vjs-hidden') && button.getAttribute('aria-disabled') !== 'true');
        if (visible) {
            visible.click();
            return;
        }
        if (!clickedHiddenFallback && buttons.length) {
            clickedHiddenFallback = true;
            buttons.forEach(button => button.click());
        }
        if (Date.now() - startedAt < timeout && (transcriptLoadingPending || activeVideoTranscriptLessonId)) {
            setTimeout(attempt, 100);
        }
    };
    attempt();
}

function blockNativeContinueDuringTranscript(event) {
    if (!transcriptLoadingPending && !activeVideoTranscriptLessonId) return;
    const continueButton = event.target?.closest?.('.autoplay-continue-button');
    if (!continueButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelNativeVideoAdvance(getVideoElement());
}

async function handleVideoEnded(video, context) {
    if (transcriptLoadingPending) return;
    transcriptLoadingPending = true;
    transcriptLoadingLessonId = context.lessonId;
    if (settings.rsvpAfterVideoEnabled) {
        cancelNativeVideoAdvance(video);
        currentMode = 'CONTENT';
        currentViewKey = `VIDEO_TRANSCRIPT:${context.lessonId}:loading`;
        sendState('CONTENT', {
            ...context,
            displayTitle: `Preparando leitura rápida · ${context.title}`,
            status: 'loading',
            isLoading: true,
            loadingReason: 'video-transcription'
        });
    }
    chrome.runtime.sendMessage({ type: 'PREPARE_READING_MODE' });
    cancelAutoAdvance(false);
    try {
        if (settings.rsvpAfterVideoEnabled) {
            const transcript = await loadVideoTranscription();
            const currentContext = lessonContext();
            if (currentContext.lessonId !== context.lessonId) return;
            if (transcript.text) {
                activeVideoTranscriptLessonId = context.lessonId;
                currentMode = 'CONTENT';
                currentViewKey = `VIDEO_TRANSCRIPT:${context.lessonId}:${AluraFlowCore.textFingerprint(transcript.text)}`;
                sendState('CONTENT', {
                    ...context,
                    displayTitle: `Transcrição · ${context.title}`,
                    isQuiz: false,
                    isVideoTranscript: true,
                    preferredReadingMode: 'rsvp',
                    autoStartReading: settings.autoReadEnabled !== false,
                    completionReason: 'video',
                    transcriptText: transcript.text,
                    transcriptWordCount: transcript.wordCount,
                    transcriptBlockCount: transcript.blockCount,
                    html: transcript.html
                });
                return;
            }
            if (transcript.loadingFailed) {
                chrome.runtime.sendMessage({ type: 'VIDEO_TRANSCRIPTION_FAILED' });
                return;
            }
        }
        if (settings.autoAdvanceEnabled) scheduleAutoAdvance('video');
    } finally {
        transcriptLoadingPending = false;
        transcriptLoadingLessonId = null;
    }
}

function visibleVideoControl(root, selector) {
    return Array.from((root || document).querySelectorAll(selector)).find(button =>
        !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !button.closest('.vjs-hidden')
    ) || null;
}

function waitForVideoReady(video, timeout = 3000) {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
    return new Promise(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            video.removeEventListener('canplay', finish);
            video.removeEventListener('loadeddata', finish);
            resolve();
        };
        video.addEventListener('canplay', finish, { once: true });
        video.addEventListener('loadeddata', finish, { once: true });
        setTimeout(finish, timeout);
    });
}

async function playVideo(video, reason = 'command') {
    if (!video) {
        chrome.runtime.sendMessage({ type: 'VIDEO_PLAY_FAILED', reason, error: 'video-not-found' });
        return false;
    }

    if (video.dataset.afPlayPending === 'true') return false;
    video.dataset.afPlayPending = 'true';

    try {
        const root = getVideoRoot(video);
        video.autoplay = true;
        const clickPlayControl = () => {
            const button = visibleVideoControl(root, '.autoplay-not-watching-alert:not(.vjs-hidden) .vjs-big-play-button, .vjs-big-play-button, .vjs-play-control');
            if (button && (video.paused || root?.classList.contains('vjs-paused'))) button.click();
        };

        let lastError = null;
        clickPlayControl();
        try { await video.play(); } catch (error) { lastError = error; }
        if (!video.paused) return true;

        await waitForVideoReady(video);
        clickPlayControl();
        try { await video.play(); } catch (error) { lastError = error; }
        if (!video.paused) return true;

        chrome.runtime.sendMessage({
            type: 'VIDEO_PLAY_FAILED',
            reason,
            error: lastError?.name || lastError?.message || 'playback-remained-paused',
            readyState: video.readyState
        });
        return false;
    } finally {
        delete video.dataset.afPlayPending;
    }
}

function pauseVideo(video) {
    if (!video) return;
    video.pause();
    if (!video.paused) visibleVideoControl(getVideoRoot(video), '.vjs-play-control')?.click();
}

function isVideoLesson(video) {
    return Boolean(
        document.querySelector('.task-body-header-title-svg use[href*="#VIDEO"]') ||
        document.querySelector('video-js, .video-js, .video-container, #video-player, [data-vjs-player="true"]') || video
    );
}

function getTextLessonContent() {
    const candidates = document.querySelectorAll([
        '.hqExplanation .formattedText',
        '#task-content .formattedText',
        'section[aria-label="Conteúdo da aula"]',
        'section.select-text'
    ].join(', '));
    return Array.from(candidates).find(candidate => {
        if (candidate.closest('.video-transcription, #transcription')) return false;
        const blocks = candidate.querySelectorAll('p, h1, h2, h3, li, blockquote, pre').length;
        return AluraFlowCore.isReadableTextCandidate(candidate.textContent, blocks);
    }) || null;
}

function attachVideoListeners(video, context) {
    if (video.dataset.afListener === 'true') return;
    video.dataset.afListener = 'true';

    const applySpeed = () => {
        const speed = effectivePlaybackSpeed(context.courseId);
        if (Number.isFinite(speed) && video.playbackRate !== speed) video.playbackRate = speed;
    };
    applySpeed();
    video.addEventListener('loadedmetadata', applySpeed);
    video.addEventListener('play', () => {
        video.dataset.afAutoplayStarted = 'true';
        chrome.runtime.sendMessage({ type: 'VIDEO_STATE_CHANGED', status: 'playing' });
    });
    video.addEventListener('pause', () => chrome.runtime.sendMessage({ type: 'VIDEO_STATE_CHANGED', status: 'paused' }));
    video.addEventListener('ratechange', () => {
        if (video.readyState > 0) chrome.runtime.sendMessage({ type: 'SPEED_UPDATED', speed: video.playbackRate, courseId: context.courseId });
    });
    video.addEventListener('ended', () => handleVideoEnded(video, lessonContext()), true);

    const tryAutoplay = () => {
        if (settings.autoPlayEnabled !== false && video.dataset.afAutoplayStarted !== 'true' && video.paused) {
            playVideo(video, 'autoplay').then(started => {
                if (started) video.dataset.afAutoplayStarted = 'true';
            });
        }
    };
    setTimeout(tryAutoplay, 50);
    video.addEventListener('canplay', tryAutoplay, { once: true });
}

function getNewStructureQuizElements() {
    const instruction = Array.from(document.querySelectorAll('p')).find(element => /selecione (uma|as|\d+) alternativa/i.test(element.textContent.trim()));
    if (instruction?.nextElementSibling?.tagName === 'UL') {
        const options = instruction.nextElementSibling.querySelectorAll('li button.group');
        if (options.length) return { instructionP: instruction, ul: instruction.nextElementSibling, options };
    }
    const options = document.querySelectorAll('ul > li > button.group');
    if (options.length && options[0].querySelector('.text-task-alternative-content-text')) {
        const ul = options[0].closest('ul');
        return { instructionP: ul.previousElementSibling?.tagName === 'P' ? ul.previousElementSibling : null, ul, options };
    }
    return null;
}

function quizExplicitlySuccessful() {
    const feedback = document.querySelector('.choiceable-aria-feedback')?.textContent.toLocaleLowerCase('pt-BR') || '';
    if (/acertou|parabéns/.test(feedback)) return true;
    const quiz = getNewStructureQuizElements();
    if (!quiz) return false;
    const options = Array.from(quiz.options);
    const states = options.map(optionFeedback);
    if (states.some(state => state.incorrect)) return false;
    const correctCount = states.filter(state => state.correct).length;
    const rules = AluraFlowCore.quizSelectionRules(quiz.instructionP?.textContent || '');
    if (rules.requiredChoices > 0) return correctCount >= rules.requiredChoices;
    return !rules.isMultiple && correctCount >= 1;
}

function optionFeedback(button) {
    const incorrect = Boolean(
        button.querySelector('[aria-label="Resposta incorreta"], [class*="feedback-error"], [class*="alternative-incorrect"]') ||
        AluraFlowCore.classIndicatesIncorrect(button.className)
    );
    const correct = !incorrect && Boolean(
        button.querySelector('[aria-label="Resposta correta"], [class*="feedback-success"], [class*="alternative-correct"]') ||
        AluraFlowCore.classIndicatesCorrect(button.className)
    );
    return { incorrect, correct };
}

function extractQuizData() {
    const newQuiz = getNewStructureQuizElements();
    const explicitlySuccessful = quizExplicitlySuccessful();
    if (newQuiz) {
        let current = newQuiz.instructionP ? newQuiz.instructionP.previousElementSibling : newQuiz.ul.previousElementSibling;
        const questionParts = [];
        while (current && !['DIV', 'HEADER'].includes(current.tagName)) {
            if (['P', 'H1', 'H2', 'H3'].includes(current.tagName)) questionParts.unshift(sanitizeClone(current).outerHTML);
            current = current.previousElementSibling;
        }
        const instructionHTML = newQuiz.instructionP ? sanitizeClone(newQuiz.instructionP).innerHTML : '';
        const rules = AluraFlowCore.quizSelectionRules(newQuiz.instructionP?.textContent || instructionHTML);
        const rawOptions = Array.from(newQuiz.options).map((button, index) => {
            const feedback = optionFeedback(button);
            const selected = button.getAttribute('aria-selected') === 'true' || button.classList.contains('border-interactive-primary') || button.classList.contains('bg-surface-secondary') || feedback.incorrect || feedback.correct;
            return {
                id: String(index),
                html: sanitizeClone(button.querySelector('.text-task-alternative-content-text') || button).innerHTML,
                opinionHTML: '',
                isCorrect: feedback.correct,
                isIncorrect: feedback.incorrect,
                isSelected: selected,
                isNewStructure: true
            };
        });
        return {
            questionHTML: questionParts.join('') || 'Questão',
            instructionHTML,
            options: rawOptions,
            isSolved: AluraFlowCore.isQuizSolved(rawOptions, rules.isMultiple, rules.requiredChoices, explicitlySuccessful),
            isMultiple: rules.isMultiple,
            requiredChoices: rules.requiredChoices
        };
    }

    const question = document.querySelector('.choiceable-title');
    const instruction = document.querySelector('.choiceable-description, .singleChoice-count, .multipleChoice-count');
    const instructionHTML = instruction ? sanitizeClone(instruction).innerHTML : '';
    const items = Array.from(document.querySelectorAll('.alternativeList-item'));
    const rawOptions = items.map(item => {
        const opinion = item.querySelector('.alternativeList-item-alternativeOpinion');
        const incorrect = item.classList.contains('alternativeList-item--incorrect') || /\bincorreta\b/u.test(opinion?.textContent.toLocaleLowerCase('pt-BR') || '');
        const correct = !incorrect && (item.dataset.correct === 'true' || item.classList.contains('alternativeList-item--correct') || AluraFlowCore.opinionIndicatesCorrect(opinion?.textContent));
        return {
            id: item.dataset.alternativeId,
            html: sanitizeClone(item.querySelector('.alternativeList-item-alternative') || item).innerHTML,
            opinionHTML: opinion ? sanitizeClone(opinion).innerHTML : '',
            isCorrect: correct,
            isIncorrect: incorrect,
            isSelected: item.classList.contains('alternativeList-item--checked') || Boolean(item.querySelector('input:checked'))
        };
    });
    const rules = AluraFlowCore.quizSelectionRules(instruction?.textContent || instructionHTML);
    const isMultiple = rules.isMultiple || items.some(item => item.querySelector('input[type="checkbox"]'));
    return {
        questionHTML: question ? sanitizeClone(question).innerHTML : 'Questão',
        instructionHTML,
        options: rawOptions,
        isSolved: AluraFlowCore.isQuizSolved(rawOptions, isMultiple, rules.requiredChoices, explicitlySuccessful),
        isMultiple,
        requiredChoices: rules.requiredChoices
    };
}

function reportState(force = false, forceBind = false) {
    const context = lessonContext();
    const video = getVideoElement();

    if (activeVideoTranscriptLessonId && activeVideoTranscriptLessonId !== context.lessonId) {
        activeVideoTranscriptLessonId = null;
    }

    // Opening the transcription sidebar can temporarily remove the player from
    // the lesson DOM. Keep the explicit loading state instead of diagnosing the
    // same lesson as an unknown type while its transcript is still stabilizing.
    if (transcriptLoadingPending && transcriptLoadingLessonId === context.lessonId) return;

    if (isVideoLesson(video)) {
        if (activeVideoTranscriptLessonId === context.lessonId) return;
        if (!video) {
            const key = `PLAYER:${context.lessonId}:loading`;
            if (force || currentMode !== 'PLAYER' || currentViewKey !== key) {
                currentMode = 'PLAYER';
                currentViewKey = key;
                sendState('PLAYER', { ...context, status: 'loading', isLoading: true }, forceBind);
            }
            return;
        }
        attachVideoListeners(video, context);
        const key = `PLAYER:${context.lessonId}:${video.currentSrc || video.src || 'pending'}`;
        if (force || currentMode !== 'PLAYER' || currentViewKey !== key) {
            currentMode = 'PLAYER';
            currentViewKey = key;
            cancelAutoAdvance(false);
            sendState('PLAYER', { ...context, status: video.paused ? 'paused' : 'playing' }, forceBind);
        }
        return;
    }

    const quizContainer = document.querySelector('.alternativeList') || getNewStructureQuizElements();
    if (quizContainer) {
        const quizData = extractQuizData();
        const signature = JSON.stringify(quizData.options?.map(option => [option.id, option.isSelected, option.isCorrect, option.isIncorrect]));
        const key = `QUIZ:${context.lessonId}:${signature}`;
        if (force || currentMode !== 'CONTENT' || currentViewKey !== key) {
            currentMode = 'CONTENT';
            currentViewKey = key;
            sendState('CONTENT', { ...context, isQuiz: true, ...quizData }, forceBind);
            if (quizData.isSolved && settings.autoAdvanceEnabled && !transitionTimer) scheduleAutoAdvance('quiz');
        }
        return;
    }

    const textContent = getTextLessonContent();
    if (textContent) {
        const cleanContent = sanitizeClone(textContent);
        const opinionElement = document.querySelector('#task-feedback .formattedText');
        const opinionHtml = opinionElement ? sanitizeClone(opinionElement).innerHTML : null;
        const html = cleanContent.innerHTML;
        const key = `TEXT:${context.lessonId}:${AluraFlowCore.textFingerprint(cleanContent.textContent)}`;
        if (force || currentMode !== 'CONTENT' || currentViewKey !== key) {
            currentMode = 'CONTENT';
            currentViewKey = key;
            sendState('CONTENT', { ...context, isQuiz: false, html, opinionHtml }, forceBind);
            chrome.storage.session.set({ currentReading: { ...context, html, opinionHtml } });
        }
        return;
    }

    if (!transcriptLoadingPending && /\/task\//.test(location.pathname) && Date.now() - lastSuccessfulReport > 10000 && diagnosticSentFor !== context.lessonId) {
        diagnosticSentFor = context.lessonId;
        chrome.runtime.sendMessage({ type: 'SELECTOR_DIAGNOSTIC', data: { ...context, message: 'A estrutura desta aula não foi reconhecida.' } });
    }
}

function predictNextLesson() {
    const oldCurrent = document.querySelector('.task-menu-nav-item--selected');
    if (oldCurrent?.nextElementSibling) {
        const link = oldCurrent.nextElementSibling.querySelector('.task-menu-nav-item-link');
        return link?.classList.contains('task-menu-nav-item-link-VIDEO') ? 'PLAYER' : 'CONTENT';
    }
    const links = Array.from(document.querySelectorAll('ul li.group a[href*="/task/"]'));
    const index = links.findIndex(link => link.matches('.bg-surface-default, .border-l-brand-default, [aria-current="page"]'));
    if (index >= 0 && links[index + 1]) return links[index + 1].querySelector('span.font-jetbrains-mono') ? 'PLAYER' : 'CONTENT';
    return null;
}

function handleTransition() {
    const predictedMode = predictNextLesson();
    if (predictedMode) chrome.runtime.sendMessage({ type: 'TRANSITION_START', predictedMode });
}

function cancelAutoAdvance(notify = true) {
    if (transitionTimer) clearTimeout(transitionTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    transitionTimer = null;
    countdownTimer = null;
    if (notify) chrome.runtime.sendMessage({ type: 'AUTO_ADVANCE_CANCELLED' });
}

function scheduleAutoAdvance(reason) {
    cancelAutoAdvance(false);
    const delaySeconds = Math.max(0, Number(settings.autoAdvanceDelay) || 0);
    let remaining = delaySeconds;
    const announce = () => chrome.runtime.sendMessage({ type: 'AUTO_ADVANCE_COUNTDOWN', reason, remaining });
    announce();
    if (remaining > 0) {
        countdownTimer = setInterval(() => {
            remaining -= 1;
            announce();
        }, 1000);
    }
    transitionTimer = setTimeout(() => {
        cancelAutoAdvance(false);
        const nextButton = getNextButton();
        if (!nextButton) return;
        activeVideoTranscriptLessonId = null;
        handleTransition();
        chrome.runtime.sendMessage({ type: 'AUTO_ADVANCE_EXECUTED', reason });
        nextButton.click();
    }, delaySeconds * 1000);
}

function watchQuizFeedback() {
    let lastFeedback = '';
    const observer = new MutationObserver(() => {
        const quiz = getNewStructureQuizElements();
        const oldFeedback = document.querySelector('.choiceable-aria-feedback')?.textContent.toLocaleLowerCase('pt-BR') || '';
        const newOptions = quiz ? Array.from(quiz.options) : [];
        const optionStates = newOptions.map(optionFeedback);
        const rules = AluraFlowCore.quizSelectionRules(quiz?.instructionP?.textContent || '');
        const requiredForFeedback = rules.requiredChoices || (rules.isMultiple ? Number.POSITIVE_INFINITY : 1);
        const feedback = AluraFlowCore.quizFeedbackFingerprint(optionStates, oldFeedback, requiredForFeedback);
        const { success, error, wrongIds } = feedback;
        const state = feedback.fingerprint;
        if (!state || state === lastFeedback) return;
        lastFeedback = state;

        const data = extractQuizData();
        const correctIds = data.options.filter(option => option.isCorrect).map(option => option.id);
        if (success) {
            chrome.runtime.sendMessage({ type: 'QUIZ_FEEDBACK_SUCCESS', correctIds });
            if (settings.autoAdvanceEnabled) scheduleAutoAdvance('quiz');
        } else if (error) {
            cancelAutoAdvance(false);
            chrome.runtime.sendMessage({ type: 'QUIZ_FEEDBACK_ERROR', correctIds, wrongIds });
            if (correctIds.length) chrome.runtime.sendMessage({ type: 'QUIZ_REVEAL_CORRECT', correctIds });
        }
        reportState(true);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
}

function setupObservers() {
    const observer = new MutationObserver(() => {
        clearTimeout(observerDebounce);
        observerDebounce = setTimeout(() => reportState(), 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', () => setTimeout(() => reportState(true), 100));
    window.addEventListener('hashchange', () => setTimeout(() => reportState(true), 100));
    ['pushState', 'replaceState'].forEach(method => {
        const original = history[method];
        history[method] = function (...args) {
            const result = original.apply(this, args);
            setTimeout(() => reportState(true), 100);
            return result;
        };
    });
    setInterval(() => reportState(), 2000);
    watchQuizFeedback();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const video = getVideoElement();
    if (message.type === 'COMMAND_PLAY_PAUSE' && activeVideoTranscriptLessonId) {
        // The companion owns play/pause while it is presenting the post-video RSVP review.
    } else if (message.type === 'COMMAND_PLAY_PAUSE' && video) {
        if (video.paused || getVideoRoot(video)?.classList.contains('vjs-paused')) playVideo(video, 'companion');
        else pauseVideo(video);
    } else if (message.type === 'COMMAND_PLAY_PAUSE') {
        chrome.runtime.sendMessage({ type: 'VIDEO_PLAY_FAILED', reason: 'companion', error: 'video-not-found' });
        reportState(true);
    } else if (message.type === 'COMMAND_NEXT' || message.type === 'FINISH_READING') {
        cancelAutoAdvance(false);
        activeVideoTranscriptLessonId = null;
        const button = getNextButton();
        if (button) { handleTransition(); button.click(); }
        else {
            sendResponse?.({ ok: false, error: 'Botão de próxima lição não encontrado.' });
            return false;
        }
    } else if (message.type === 'AUTO_FINISH_READING') {
        if (settings.autoAdvanceEnabled) scheduleAutoAdvance(message.reason === 'video' ? 'video' : 'reading');
    } else if (message.type === 'RETRY_VIDEO_TRANSCRIPTION' && video) {
        handleVideoEnded(video, lessonContext());
    } else if (message.type === 'COMMAND_PREV') {
        cancelAutoAdvance(false);
        activeVideoTranscriptLessonId = null;
        const button = getPrevButton();
        if (button) button.click();
    } else if (message.type === 'COMMAND_CYCLE_SPEED' && video) {
        const speeds = [1, 1.25, 1.5, 2];
        const currentIndex = speeds.findIndex(speed => Math.abs(speed - video.playbackRate) < 0.05);
        video.playbackRate = speeds[(currentIndex + 1 + speeds.length) % speeds.length];
    } else if (message.type === 'UPDATE_SPEED') {
        settings.playbackSpeed = Number(message.speed) || 1;
        if (video) video.playbackRate = settings.playbackSpeed;
    } else if (message.type === 'SELECT_OPTION') {
        const item = document.querySelector(`.alternativeList-item[data-alternative-id="${CSS.escape(String(message.optionId))}"]`);
        if (item) item.querySelector('label, input')?.click();
        else {
            const quiz = getNewStructureQuizElements();
            const index = Number(message.optionId);
            if (quiz?.options?.[index]) quiz.options[index].click();
        }
    } else if (message.type === 'CANCEL_AUTO_ADVANCE') {
        cancelAutoAdvance(true);
    } else if (message.type === 'UPDATE_AUTO_ADVANCE') {
        settings.autoAdvanceEnabled = Boolean(message.enabled);
        if (!settings.autoAdvanceEnabled) cancelAutoAdvance(true);
        else {
            const hasQuiz = document.querySelector('.alternativeList') || getNewStructureQuizElements();
            if (hasQuiz && extractQuizData().isSolved && !transitionTimer) scheduleAutoAdvance('quiz');
        }
    } else if (message.type === 'COMPANION_READY') {
        reportState(true, Boolean(message.forceBind));
    }
    sendResponse?.({ ok: true });
    return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    Object.keys(settings).forEach(key => {
        if (changes[key]) settings[key] = changes[key].newValue;
    });
    if (changes.autoAdvanceEnabled?.newValue === false) cancelAutoAdvance(true);
    if (changes.rsvpAfterVideoEnabled?.newValue === false && activeVideoTranscriptLessonId) {
        activeVideoTranscriptLessonId = null;
        reportState(true);
    }
    if (changes.playbackSpeed || changes.courseProfiles || changes.perCourseSettings) {
        const video = getVideoElement();
        if (video) video.playbackRate = effectivePlaybackSpeed(lessonContext().courseId);
    }
});

function init() {
    chrome.storage.local.get(Object.keys(settings), stored => {
        Object.assign(settings, stored);
        document.addEventListener('click', blockNativeContinueDuringTranscript, true);
        setupObservers();
        setTimeout(() => reportState(true), 300);
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
