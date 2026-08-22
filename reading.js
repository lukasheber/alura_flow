'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const byId = id => document.getElementById(id);
    const ui = {
        led: byId('connectionLed'), title: byId('mainTitle'), loading: byId('view-loading'), loadingMessage: byId('loadingMessage'),
        player: byId('view-player'), content: byId('view-content'),
        text: byId('textContainer'), quiz: byId('quizContainer'), quizProgress: byId('quizProgress'), dynamic: byId('dynamicContent'), opinion: byId('opinionSection'),
        opinionContent: byId('opinionContent'), videoStatus: byId('videoStatusText'), play: byId('remotePlay'), prev: byId('remotePrev'),
        next: byId('remoteNext'), tts: byId('ttsBtn'), ttsTop: byId('ttsBtnTop'), finish: byId('finishBtn'),
        finishTop: byId('finishBtnTop'), fab: byId('ttsFab'), banner: byId('advanceBanner'), bannerMessage: byId('advanceMessage'),
        bannerAction: byId('advanceAction'), quizNext: byId('quizNextBtn'), history: byId('historyList'),
        rsvpPanel: byId('rsvpPanel'), rsvpStage: byId('rsvpStage'), rsvpBefore: byId('rsvpBefore'), rsvpFocus: byId('rsvpFocus'), rsvpAfter: byId('rsvpAfter'),
        rsvpProgress: byId('rsvpProgress'), rsvpStatus: byId('rsvpStatus'), rsvpWpm: byId('rsvpWpmInline'), rsvpWpmValue: byId('rsvpWpmInlineValue')
    };
    const synth = window.speechSynthesis;
    let currentMode = 'NONE';
    let currentData = null;
    let currentViewKey = '';
    let isSpeaking = false;
    let isPaused = false;
    let speechGeneration = 0;
    let autoReadTimer = null;
    let autoReadAttemptedKey = '';
    let autoReadCompletedKey = '';
    let autoAdvanceRequestedKey = '';
    let readingMode = 'tts';
    let rsvpWords = [];
    let rsvpIndex = 0;
    let rsvpWpm = 300;
    let rsvpPlaying = false;
    let rsvpPaused = false;
    let rsvpFinished = false;
    let rsvpTimer = null;
    let rsvpLessonKey = '';
    let rsvpStartedAutomatically = false;
    let attentionCheckTimer = null;
    let lastClickedOptionId = null;
    let bannerMode = 'cancel';
    let undoTimer = null;

    function runtimeMessage(message) {
        return new Promise(resolve => chrome.runtime.sendMessage(message, response => resolve(response || {})));
    }

    document.addEventListener('keydown', event => {
        if (event.repeat || event.metaKey || event.shiftKey) return;
        if (event.ctrlKey && event.altKey && (event.code === 'KeyS' || event.key.toLowerCase() === 's')) {
            event.preventDefault();
            runtimeMessage({ type: 'CYCLE_SPEED_REQUEST' });
        }
    }, true);

    function safeHTML(element, html) {
        if (!element) return;
        element.replaceChildren();
        if (!html) return;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('script, iframe, object, embed, form, input, textarea, select, button, meta, base').forEach(node => node.remove());
        doc.querySelectorAll('*').forEach(node => {
            Array.from(node.attributes).forEach(attribute => {
                const name = attribute.name.toLowerCase();
                if (name.startsWith('on') || name === 'srcdoc' || name === 'style' && /url\s*\(|expression\s*\(/i.test(attribute.value)) {
                    node.removeAttribute(attribute.name);
                }
            });
            ['href', 'src', 'poster'].forEach(name => {
                if (!node.hasAttribute(name)) return;
                try {
                    const url = new URL(node.getAttribute(name));
                    if (!['http:', 'https:', 'data:'].includes(url.protocol) || (name === 'href' && url.protocol === 'data:')) node.removeAttribute(name);
                } catch (_) { node.removeAttribute(name); }
            });
            if (node.tagName === 'A') {
                node.target = '_blank';
                node.rel = 'noopener noreferrer';
            }
        });
        element.append(...Array.from(doc.body.childNodes));
    }

    function readingRunKey(mode = readingMode) {
        return `${currentViewKey}:${mode}`;
    }

    function checkCompanionAttention(callback) {
        const finish = windowFocused => callback(AluraFlowCore.canAutoStartRsvp({
            documentVisible: document.visibilityState === 'visible',
            documentFocused: document.hasFocus(),
            windowFocused
        }));
        if (!chrome.windows?.getCurrent) {
            finish(document.hasFocus());
            return;
        }
        chrome.windows.getCurrent(win => {
            const unavailable = Boolean(chrome.runtime.lastError);
            finish(!unavailable && win?.focused === true && win.state !== 'minimized');
        });
    }

    function showRsvpReadyForManualStart() {
        ui.rsvpStatus.textContent = 'Leitura pronta · clique no quadro para iniciar';
    }

    function scheduleAutomaticRsvpAttentionCheck() {
        clearTimeout(attentionCheckTimer);
        attentionCheckTimer = setTimeout(() => {
            if (!rsvpPlaying || !rsvpStartedAutomatically) return;
            checkCompanionAttention(hasAttention => {
                if (hasAttention || !rsvpPlaying || !rsvpStartedAutomatically) return;
                pauseRsvp('Leitura pausada · clique para retomar');
            });
        }, 350);
    }

    function updateReadingControls() {
        const rsvpActive = readingMode === 'rsvp' && (rsvpPlaying || rsvpPaused);
        const ttsActive = readingMode === 'tts' && isSpeaking;
        const active = rsvpActive || ttsActive;
        const paused = readingMode === 'rsvp' ? rsvpPaused : isPaused;
        let label = '▶ Ouvir';
        if (readingMode === 'rsvp') label = rsvpPlaying ? '⏸ Pausar' : rsvpPaused ? '▶ Retomar' : '▶ Iniciar';
        else if (isSpeaking) label = isPaused ? '▶ Retomar' : '⏸ Pausar';
        [ui.tts, ui.ttsTop].forEach(button => { if (button) button.textContent = label; });
        if (ui.rsvpStage) {
            const stageAction = rsvpPlaying ? 'Pausar leitura rápida' : rsvpPaused ? 'Retomar leitura rápida' : rsvpFinished ? 'Reiniciar leitura rápida' : 'Iniciar leitura rápida';
            ui.rsvpStage.setAttribute('aria-label', stageAction);
            ui.rsvpStage.setAttribute('aria-pressed', String(rsvpPlaying));
            ui.rsvpStage.title = `${stageAction} (clique, Enter ou Espaço)`;
        }
        ui.fab.classList.toggle('visible', active);
        ui.fab.textContent = paused ? '▶️' : '⏸️';
        ui.fab.setAttribute('aria-label', paused ? 'Retomar leitura' : 'Pausar leitura');
        document.querySelectorAll('[data-reading-mode]').forEach(button => {
            const selected = button.dataset.readingMode === readingMode;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
    }

    function stopSpeaking() {
        speechGeneration += 1;
        clearTimeout(autoReadTimer);
        autoReadTimer = null;
        synth.cancel();
        isSpeaking = false;
        isPaused = false;
        document.querySelectorAll('.reading-active').forEach(element => element.classList.remove('reading-active'));
        updateReadingControls();
    }

    function clearRsvpTimer() {
        if (rsvpTimer) clearTimeout(rsvpTimer);
        rsvpTimer = null;
    }

    function renderRsvpWord() {
        const word = rsvpWords[rsvpIndex] || '';
        const parts = AluraFlowCore.splitRsvpWord(word);
        ui.rsvpBefore.textContent = parts.before;
        ui.rsvpFocus.textContent = parts.focus || '•';
        ui.rsvpAfter.textContent = parts.after;
        const progress = rsvpWords.length ? ((rsvpIndex + 1) / rsvpWords.length) * 100 : 0;
        ui.rsvpProgress.value = String(progress);
        ui.rsvpStatus.textContent = rsvpWords.length
            ? `${Math.min(rsvpIndex + 1, rsvpWords.length)} de ${rsvpWords.length} palavras`
            : 'Nenhum texto disponível';
    }

    function prepareRsvpWords(resetPosition = false) {
        if (currentMode !== 'CONTENT' || !AluraFlowCore.canReadLesson(currentData)) {
            clearRsvpTimer();
            rsvpWords = [];
            rsvpIndex = 0;
            rsvpFinished = false;
            rsvpLessonKey = '';
            renderRsvpWord();
            return;
        }
        const text = currentData?.isVideoTranscript && currentData?.transcriptText
            ? currentData.transcriptText
            : readableElements(ui.dynamic).concat(ui.opinion.classList.contains('hidden') ? [] : readableElements(ui.opinionContent))
                .map(element => element.innerText.trim()).join(' ');
        const nextWords = AluraFlowCore.parseRsvpText(text);
        if (resetPosition || rsvpLessonKey !== currentViewKey) {
            rsvpIndex = 0;
            rsvpFinished = false;
        }
        rsvpLessonKey = currentViewKey;
        rsvpWords = nextWords;
        rsvpIndex = Math.min(rsvpIndex, Math.max(0, rsvpWords.length - 1));
        renderRsvpWord();
    }

    function stopRsvp(resetPosition = true) {
        clearRsvpTimer();
        rsvpPlaying = false;
        rsvpPaused = false;
        rsvpStartedAutomatically = false;
        if (resetPosition) {
            rsvpIndex = 0;
            rsvpFinished = false;
            renderRsvpWord();
        }
        updateReadingControls();
    }

    function requestTextAutoAdvance(completedViewKey, autoAdvanceEnabled) {
        if (autoAdvanceEnabled === false || completedViewKey !== currentViewKey || autoAdvanceRequestedKey === completedViewKey) return;
        const expectedTranscriptWords = Number(currentData?.transcriptWordCount) || 0;
        if (currentData?.isVideoTranscript && expectedTranscriptWords > 0 && rsvpWords.length < expectedTranscriptWords) return;
        autoAdvanceRequestedKey = completedViewKey;
        runtimeMessage({ type: 'AUTO_FINISH_READING', reason: currentData?.completionReason || 'reading' });
    }

    function completeTextReading(runKey, autoAdvanceEnabled, completedViewKey = currentViewKey) {
        autoReadCompletedKey = runKey;
        if (completedViewKey !== currentViewKey) return;
        markLessonCompleted();
        requestTextAutoAdvance(completedViewKey, autoAdvanceEnabled);
    }

    function completeRsvp() {
        const completedViewKey = currentViewKey;
        const completedRunKey = readingRunKey('rsvp');
        clearRsvpTimer();
        rsvpPlaying = false;
        rsvpPaused = false;
        rsvpFinished = true;
        rsvpStartedAutomatically = false;
        ui.rsvpStatus.textContent = `Leitura concluída · ${rsvpWords.length} palavras`;
        updateReadingControls();
        completeTextReading(completedRunKey, false, completedViewKey);
        chrome.storage.local.get(['autoAdvanceEnabled'], settings => requestTextAutoAdvance(completedViewKey, settings.autoAdvanceEnabled));
    }

    function scheduleRsvpWord() {
        clearRsvpTimer();
        if (!rsvpPlaying || !rsvpWords.length) return;
        const word = rsvpWords[rsvpIndex] || '';
        rsvpTimer = setTimeout(() => {
            if (!rsvpPlaying) return;
            if (rsvpIndex >= rsvpWords.length - 1) {
                completeRsvp();
                return;
            }
            rsvpIndex += 1;
            renderRsvpWord();
            scheduleRsvpWord();
        }, AluraFlowCore.rsvpWordDelay(word, rsvpWpm));
    }

    function startRsvp(options = {}) {
        if (currentMode !== 'CONTENT' || !AluraFlowCore.canReadLesson(currentData)) return;
        const runKey = readingRunKey('rsvp');
        if (options.expectedKey && options.expectedKey !== runKey) return;
        if (options.automatic && autoReadCompletedKey === runKey) return;
        stopSpeaking();
        if (rsvpLessonKey !== currentViewKey || !rsvpWords.length) prepareRsvpWords(true);
        if (!rsvpWords.length) return;
        if (rsvpFinished || rsvpIndex >= rsvpWords.length) {
            rsvpIndex = 0;
            rsvpFinished = false;
            renderRsvpWord();
        }
        rsvpPlaying = true;
        rsvpPaused = false;
        rsvpStartedAutomatically = options.automatic === true;
        updateReadingControls();
        scheduleRsvpWord();
    }

    function pauseRsvp(statusMessage = '') {
        if (!rsvpPlaying) return;
        clearRsvpTimer();
        rsvpPlaying = false;
        rsvpPaused = true;
        rsvpStartedAutomatically = false;
        updateReadingControls();
        if (statusMessage) ui.rsvpStatus.textContent = statusMessage;
    }

    function resumeRsvp() {
        if (!rsvpPaused || !rsvpWords.length) return;
        rsvpPlaying = true;
        rsvpPaused = false;
        rsvpStartedAutomatically = false;
        updateReadingControls();
        scheduleRsvpWord();
    }

    function toggleRsvp() {
        if (rsvpPlaying) pauseRsvp();
        else if (rsvpPaused) resumeRsvp();
        else startRsvp();
    }

    function setReadingMode(mode) {
        const nextMode = mode === 'rsvp' ? 'rsvp' : 'tts';
        if (nextMode === readingMode) return;
        stopSpeaking();
        stopRsvp(false);
        readingMode = nextMode;
        ui.text.classList.toggle('rsvp-mode', readingMode === 'rsvp');
        ui.rsvpPanel.classList.toggle('hidden', readingMode !== 'rsvp');
        if (readingMode === 'rsvp') prepareRsvpWords(false);
        updateReadingControls();
    }

    function setRsvpWpm(value) {
        rsvpWpm = Math.min(800, Math.max(100, Number(value) || 300));
        ui.rsvpWpm.value = String(rsvpWpm);
        ui.rsvpWpmValue.textContent = `${rsvpWpm} ppm`;
        if (rsvpPlaying) scheduleRsvpWord();
    }

    function stopAllReading(resetRsvp = true) {
        stopSpeaking();
        stopRsvp(resetRsvp);
    }

    function readableElements(container) {
        const all = Array.from(container.querySelectorAll('p, h1, h2, h3, li, blockquote, pre'));
        return all.filter(element => !all.some(child => child !== element && element.contains(child)) && element.innerText.trim());
    }

    function bestVoice(voices, voiceURI, language) {
        return voices.find(voice => voice.voiceURI === voiceURI) ||
            voices.find(voice => voice.lang.toLowerCase() === language.toLowerCase()) ||
            voices.find(voice => voice.lang.toLowerCase().startsWith(language.split('-')[0].toLowerCase())) || null;
    }

    function startSpeaking(options = {}) {
        if (currentMode !== 'CONTENT' || !AluraFlowCore.canReadLesson(currentData)) return;
        const speechKey = readingRunKey('tts');
        if (options.expectedKey && options.expectedKey !== speechKey) return;
        if (options.automatic && autoReadCompletedKey === speechKey) return;
        stopRsvp(false);
        stopSpeaking();
        const generation = speechGeneration;
        const elements = readableElements(ui.dynamic).concat(ui.opinion.classList.contains('hidden') ? [] : readableElements(ui.opinionContent));
        if (!elements.length) return;

        chrome.storage.local.get(['ttsRate', 'ttsVoiceURI', 'autoAdvanceEnabled'], settings => {
            if (generation !== speechGeneration || currentMode !== 'CONTENT' || !AluraFlowCore.canReadLesson(currentData)) return;
            const voice = bestVoice(synth.getVoices(), settings.ttsVoiceURI || '', currentData.language || 'pt-BR');
            let completed = 0;
            isSpeaking = true;
            updateReadingControls();

            elements.forEach(element => {
                const utterance = new SpeechSynthesisUtterance(element.innerText.trim());
                let settled = false;
                utterance.lang = currentData.language || 'pt-BR';
                utterance.rate = Number(settings.ttsRate) || 1.15;
                if (voice) utterance.voice = voice;
                utterance.onstart = () => {
                    if (generation !== speechGeneration) return;
                    document.querySelectorAll('.reading-active').forEach(active => active.classList.remove('reading-active'));
                    element.classList.add('reading-active');
                    element.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
                };
                const settleUtterance = () => {
                    if (settled) return;
                    settled = true;
                    if (generation !== speechGeneration) return;
                    element.classList.remove('reading-active');
                    completed += 1;
                    if (completed !== elements.length) return;
                    isSpeaking = false;
                    isPaused = false;
                    updateReadingControls();
                    completeTextReading(speechKey, settings.autoAdvanceEnabled);
                };
                utterance.onend = settleUtterance;
                utterance.onerror = settleUtterance;
                synth.speak(utterance);
            });
        });
    }

    function toggleSpeech() {
        if (!isSpeaking) startSpeaking();
        else togglePause();
    }

    function togglePause() {
        if (!isSpeaking) return;
        if (synth.paused || isPaused) { synth.resume(); isPaused = false; }
        else { synth.pause(); isPaused = true; }
        updateReadingControls();
    }

    function toggleCurrentReading() {
        if (readingMode === 'rsvp') toggleRsvp();
        else toggleSpeech();
    }

    function toggleCurrentPause() {
        if (readingMode === 'rsvp') toggleRsvp();
        else togglePause();
    }

    function viewKey(data) {
        return `${data?.lessonId || data?.url || ''}:${data?.isQuiz ? 'quiz' : 'text'}:${data?.html?.length || data?.options?.length || 0}`;
    }

    function recordLesson(data, type = data?.isQuiz ? 'quiz' : 'text') {
        if (!data?.lessonId) return;
        chrome.storage.local.get(['progressHistory'], result => {
            const history = Array.isArray(result.progressHistory) ? result.progressHistory : [];
            const existing = history.find(item => item.lessonId === data.lessonId && item.courseId === data.courseId);
            if (existing) {
                existing.title = data.title;
                existing.url = data.url;
                existing.lastOpenedAt = Date.now();
                existing.type = type;
            } else {
                history.unshift({ lessonId: data.lessonId, courseId: data.courseId, title: data.title, url: data.url, type, lastOpenedAt: Date.now() });
            }
            const trimmed = history.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 100);
            chrome.storage.local.set({ progressHistory: trimmed });
            renderHistory(trimmed);
        });
    }

    function markLessonCompleted() {
        if (!currentData?.lessonId) return;
        chrome.storage.local.get(['progressHistory'], result => {
            const history = Array.isArray(result.progressHistory) ? result.progressHistory : [];
            let item = history.find(entry => entry.lessonId === currentData.lessonId && entry.courseId === currentData.courseId);
            if (!item) {
                item = {
                    lessonId: currentData.lessonId,
                    courseId: currentData.courseId,
                    title: currentData.title,
                    url: currentData.url,
                    type: currentData.isQuiz ? 'quiz' : currentData.isVideoTranscript ? 'video' : 'text',
                    lastOpenedAt: Date.now()
                };
                history.unshift(item);
            }
            item.completedAt = Date.now();
            chrome.storage.local.set({ progressHistory: history });
            renderHistory(history);
        });
    }

    function renderHistory(history) {
        ui.history.replaceChildren();
        (history || []).slice(0, 8).forEach(item => {
            const li = document.createElement('li');
            li.textContent = `${item.completedAt ? '✓ ' : ''}${item.title || item.lessonId}`;
            ui.history.append(li);
        });
        if (!ui.history.children.length) {
            const li = document.createElement('li');
            li.textContent = 'Nenhuma aula registrada.';
            ui.history.append(li);
        }
    }

    function setSpeedUI(speed) {
        let matched = false;
        document.querySelectorAll('.speed-btn').forEach(button => {
            if (button.id === 'customSpeedBtn') return;
            const active = Math.abs(Number(button.dataset.speed) - Number(speed)) < 0.01;
            button.classList.toggle('active', active);
            if (active) matched = true;
        });
        const custom = byId('customSpeedBtn');
        custom.classList.toggle('hidden', matched);
        custom.classList.toggle('active', !matched);
        if (!matched) { custom.dataset.speed = speed; custom.textContent = `${Number(speed).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`; }
    }

    function renderText(data) {
        const isLoading = AluraFlowCore.isLoadingState(data);
        if (isLoading) {
            renderLoading(data);
            return;
        }
        ui.text.classList.remove('hidden');
        ui.quiz.classList.add('hidden');
        ui.finish.closest('.reading-actions').classList.toggle('hidden', isLoading);
        [ui.tts, ui.ttsTop, ui.finish, ui.finishTop].forEach(button => button?.classList.toggle('hidden', isLoading));
        ui.title.textContent = data.displayTitle || data.title || 'Leitura';
        safeHTML(ui.dynamic, data.html || '');
        if (data.opinionHtml) { safeHTML(ui.opinionContent, data.opinionHtml); ui.opinion.classList.remove('hidden'); }
        else { ui.opinion.classList.add('hidden'); ui.opinionContent.replaceChildren(); }
        if (!isLoading) recordLesson(data, data.isVideoTranscript ? 'video' : undefined);

        chrome.storage.local.get(['autoReadEnabled', 'readingMode', 'rsvpWpm', 'transcriptRsvpWpm'], settings => {
            setRsvpWpm(data.isVideoTranscript ? settings.transcriptRsvpWpm || settings.rsvpWpm || 300 : settings.rsvpWpm || 300);
            setReadingMode(data.preferredReadingMode || settings.readingMode || 'tts');
            if (readingMode === 'rsvp') prepareRsvpWords(true);
            const shouldStartAutomatically = AluraFlowCore.shouldAutoStartReading(data.autoStartReading, settings.autoReadEnabled);
            if (shouldStartAutomatically && currentMode === 'CONTENT' && AluraFlowCore.canReadLesson(currentData)) {
                const scheduledKey = readingRunKey(readingMode);
                if (autoReadAttemptedKey === scheduledKey || autoReadCompletedKey === scheduledKey) return;
                autoReadAttemptedKey = scheduledKey;
                clearTimeout(autoReadTimer);
                autoReadTimer = setTimeout(() => {
                    if (readingMode !== 'rsvp') {
                        startSpeaking({ automatic: true, expectedKey: scheduledKey });
                        return;
                    }
                    checkCompanionAttention(hasAttention => {
                        if (scheduledKey !== readingRunKey('rsvp') || currentMode !== 'CONTENT') return;
                        if (!hasAttention) {
                            showRsvpReadyForManualStart();
                            return;
                        }
                        startRsvp({ automatic: true, expectedKey: scheduledKey });
                    });
                }, 500);
            }
        });
    }

    function renderQuiz(data) {
        stopAllReading();
        ui.text.classList.add('hidden');
        ui.quiz.classList.remove('hidden');
        ui.finish.closest('.reading-actions').classList.add('hidden');
        [ui.tts, ui.ttsTop, ui.finish, ui.finishTop].forEach(button => button?.classList.add('hidden'));
        ui.title.textContent = data.title || 'Quiz';
        safeHTML(byId('quizQuestion'), data.questionHTML || 'Pergunta');
        const instruction = byId('quizInstruction');
        safeHTML(instruction, data.instructionHTML || 'Selecione a resposta.');
        instruction.classList.remove('hidden');
        const options = byId('quizOptions');
        options.replaceChildren();
        ui.quizNext.classList.toggle('hidden', !data.isSolved);
        const correctSelected = (data.options || []).filter(option => option.isSelected && option.isCorrect).length;
        const showProgress = data.isMultiple && data.requiredChoices > 0 && correctSelected > 0;
        ui.quizProgress.classList.toggle('hidden', !showProgress);
        if (showProgress) {
            ui.quizProgress.textContent = data.isSolved
                ? `${data.requiredChoices} de ${data.requiredChoices} respostas corretas.`
                : `${correctSelected} de ${data.requiredChoices} respostas corretas selecionadas.`;
        }

        (data.options || []).forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'option-btn';
            button.dataset.id = option.id;
            button.setAttribute('aria-pressed', String(Boolean(option.isSelected)));
            button.disabled = Boolean(data.isSolved);
            if (option.isSelected) button.classList.add('selected');
            if (option.isCorrect) button.classList.add('correct');
            if (option.isIncorrect) button.classList.add('wrong');

            const row = document.createElement('span');
            row.className = 'opt-main-row';
            const letter = document.createElement('span');
            letter.className = 'option-index';
            letter.textContent = String.fromCharCode(65 + index);
            const content = document.createElement('span');
            safeHTML(content, option.html);
            row.append(letter, content);
            button.append(row);
            button.addEventListener('click', () => {
                if (data.isMultiple) button.classList.toggle('selected');
                else options.querySelectorAll('.option-btn').forEach(other => other.classList.remove('selected', 'wrong'));
                if (!data.isMultiple) button.classList.add('selected');
                options.querySelectorAll('.option-btn').forEach(other => other.setAttribute('aria-pressed', String(other.classList.contains('selected'))));
                lastClickedOptionId = option.id;
                runtimeMessage({ type: 'SELECT_OPTION', optionId: option.id });
            });
            options.append(button);
        });
        recordLesson(data);
        if (data.isSolved) markLessonCompleted();
    }

    function completeQuiz(correctIds = []) {
        correctIds.forEach(id => byId('quizOptions').querySelector(`[data-id="${CSS.escape(String(id))}"]`)?.classList.add('reveal-correct'));
        byId('quizOptions').querySelectorAll('.option-btn').forEach(button => { button.disabled = true; });
        ui.quizNext.classList.remove('hidden');
        if (currentData?.isMultiple && currentData.requiredChoices > 0) {
            ui.quizProgress.classList.remove('hidden');
            ui.quizProgress.textContent = `${currentData.requiredChoices} de ${currentData.requiredChoices} respostas corretas.`;
        }
        markLessonCompleted();
    }

    function renderLoading(data = {}) {
        stopAllReading();
        rsvpWords = [];
        rsvpIndex = 0;
        rsvpFinished = false;
        rsvpLessonKey = '';
        renderRsvpWord();
        ui.player.classList.add('hidden');
        ui.content.classList.add('hidden');
        ui.loading.classList.remove('hidden');
        ui.title.textContent = data.displayTitle || data.title || 'Preparando a próxima aula…';
        ui.loadingMessage.textContent = 'Aguarde enquanto a próxima aula é preparada.';
    }

    function switchMode(mode, data) {
        if (!mode || mode === 'NONE') {
            ui.title.textContent = 'Abra uma aula da Alura';
            ui.led.classList.remove('led-active');
            ui.loading.classList.add('hidden');
            ui.player.classList.add('hidden');
            ui.content.classList.add('hidden');
            return;
        }
        const key = viewKey(data);
        const changed = key !== currentViewKey;
        const modeChanged = mode !== currentMode;
        if (changed || modeChanged || data?.isQuiz) stopAllReading();
        currentData = data || {};
        currentViewKey = key;
        ui.led.classList.add('led-active');
        if (bannerMode === 'selector-diagnostic') {
            ui.banner.classList.add('hidden');
            bannerMode = 'cancel';
        }
        if (AluraFlowCore.isLoadingState(currentData)) {
            currentMode = 'LOADING';
            renderLoading(currentData);
            return;
        }
        currentMode = mode;
        ui.loading.classList.add('hidden');
        if (mode === 'PLAYER') {
            ui.player.classList.remove('hidden');
            ui.content.classList.add('hidden');
            ui.title.textContent = data?.title || 'Vídeo';
            ui.videoStatus.textContent = data?.status === 'playing' ? 'Reproduzindo…' : data?.status === 'loading' ? 'Carregando vídeo…' : 'Pausado';
            recordLesson(data, 'video');
        } else if (mode === 'CONTENT') {
            ui.player.classList.add('hidden');
            ui.content.classList.remove('hidden');
            if (data?.isQuiz) renderQuiz(data);
            else if (changed || modeChanged) renderText(data || {});
        }
    }

    function showCountdown(message) {
        clearTimeout(undoTimer);
        bannerMode = 'cancel';
        ui.banner.classList.remove('hidden');
        const reason = message.reason === 'quiz' ? 'Quiz concluído' : message.reason === 'video' ? 'Vídeo concluído' : 'Leitura concluída';
        ui.bannerMessage.textContent = `${reason}. Avançando em ${Math.max(0, message.remaining)}s…`;
        ui.bannerAction.textContent = 'Cancelar';
    }

    function showUndo() {
        bannerMode = 'undo';
        ui.banner.classList.remove('hidden');
        ui.bannerMessage.textContent = 'Aula avançada.';
        ui.bannerAction.textContent = 'Desfazer';
        clearTimeout(undoTimer);
        undoTimer = setTimeout(() => ui.banner.classList.add('hidden'), 8000);
    }

    ui.play.addEventListener('click', () => {
        if (currentMode === 'PLAYER') ui.videoStatus.textContent = 'Tentando iniciar o vídeo…';
        runtimeMessage({ type: 'COMMAND_PLAY_PAUSE' });
    });
    ui.prev.addEventListener('click', () => runtimeMessage({ type: 'COMMAND_PREV' }));
    ui.next.addEventListener('click', () => runtimeMessage({ type: 'COMMAND_NEXT' }));
    document.querySelectorAll('.speed-btn').forEach(button => button.addEventListener('click', () => {
        const speed = Number(button.dataset.speed);
        if (Number.isFinite(speed)) runtimeMessage({ type: 'UPDATE_SPEED', speed });
    }));
    [ui.tts, ui.ttsTop].forEach(button => button?.addEventListener('click', toggleCurrentReading));
    ui.fab.addEventListener('click', toggleCurrentPause);
    document.querySelectorAll('[data-reading-mode]').forEach(button => button.addEventListener('click', () => setReadingMode(button.dataset.readingMode)));
    ui.rsvpStage.addEventListener('click', toggleRsvp);
    ui.rsvpStage.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleRsvp();
    });
    document.addEventListener('visibilitychange', scheduleAutomaticRsvpAttentionCheck);
    window.addEventListener('blur', scheduleAutomaticRsvpAttentionCheck);
    window.addEventListener('focus', () => clearTimeout(attentionCheckTimer));
    chrome.windows?.onFocusChanged?.addListener(scheduleAutomaticRsvpAttentionCheck);
    ui.rsvpProgress.addEventListener('input', () => {
        if (!rsvpWords.length) return;
        rsvpIndex = Math.min(rsvpWords.length - 1, Math.max(0, Math.round((Number(ui.rsvpProgress.value) / 100) * (rsvpWords.length - 1))));
        rsvpFinished = false;
        renderRsvpWord();
        if (rsvpPlaying) scheduleRsvpWord();
    });
    ui.rsvpWpm.addEventListener('input', () => setRsvpWpm(ui.rsvpWpm.value));
    ui.rsvpWpm.addEventListener('change', () => chrome.storage.local.set({
        [currentData?.isVideoTranscript ? 'transcriptRsvpWpm' : 'rsvpWpm']: rsvpWpm
    }));
    [ui.finish, ui.finishTop].forEach(button => button?.addEventListener('click', () => {
        stopAllReading();
        markLessonCompleted();
        runtimeMessage({ type: 'FINISH_READING' });
    }));
    ui.quizNext.addEventListener('click', () => {
        ui.quizNext.disabled = true;
        ui.banner.classList.add('hidden');
        runtimeMessage({ type: 'FINISH_READING' }).then(result => {
            if (!result.ok) {
                ui.quizNext.disabled = false;
                ui.banner.classList.remove('hidden');
                ui.bannerMessage.textContent = result.error || 'Não foi possível localizar a próxima lição.';
                ui.bannerAction.textContent = 'Fechar';
                bannerMode = 'close';
            }
        });
    });
    ui.bannerAction.addEventListener('click', () => {
        if (bannerMode === 'undo') runtimeMessage({ type: 'COMMAND_PREV' });
        else if (bannerMode === 'retry-transcription') runtimeMessage({ type: 'RETRY_VIDEO_TRANSCRIPTION' });
        else runtimeMessage({ type: 'CANCEL_AUTO_ADVANCE' });
        ui.banner.classList.add('hidden');
    });

    chrome.runtime.onMessage.addListener(message => {
        if (message.type === 'UPDATE_STATE') switchMode(message.mode, message.data);
        else if (message.type === 'VIDEO_STATE_CHANGED' && currentMode === 'PLAYER') {
            ui.videoStatus.textContent = message.status === 'playing' ? 'Reproduzindo…' : 'Pausado';
            ui.play.textContent = message.status === 'playing' ? '⏸️' : '▶️';
        } else if (message.type === 'SPEED_UPDATED') setSpeedUI(message.speed);
        else if (message.type === 'COMMAND_PLAY_PAUSE' && currentMode === 'CONTENT') {
            toggleCurrentReading();
        } else if (message.type === 'QUIZ_FEEDBACK_ERROR') {
            const wrongIds = message.wrongIds?.length ? message.wrongIds : lastClickedOptionId !== null ? [lastClickedOptionId] : [];
            wrongIds.forEach(id => byId('quizOptions').querySelector(`[data-id="${CSS.escape(String(id))}"]`)?.classList.add('wrong'));
        } else if (message.type === 'QUIZ_FEEDBACK_SUCCESS' || message.type === 'QUIZ_REVEAL_CORRECT') {
            (message.correctIds || []).forEach(id => byId('quizOptions').querySelector(`[data-id="${CSS.escape(String(id))}"]`)?.classList.add('reveal-correct'));
            if (message.type === 'QUIZ_FEEDBACK_SUCCESS') completeQuiz(message.correctIds || []);
        } else if (message.type === 'AUTO_ADVANCE_COUNTDOWN') showCountdown(message);
        else if (message.type === 'AUTO_ADVANCE_CANCELLED') ui.banner.classList.add('hidden');
        else if (message.type === 'AUTO_ADVANCE_EXECUTED') {
            if (AluraFlowCore.shouldOfferUndo(message.reason)) showUndo();
            else ui.banner.classList.add('hidden');
        }
        else if (message.type === 'TRANSITION_START') {
            stopAllReading();
            switchMode(message.predictedMode || 'CONTENT', { title: 'Carregando próxima aula…', status: 'loading', isLoading: true, html: '<p aria-live="polite">Carregando…</p>' });
        } else if (message.type === 'SELECTOR_DIAGNOSTIC') {
            if (AluraFlowCore.isLoadingState(currentData)) return;
            ui.led.classList.remove('led-active');
            ui.title.textContent = 'Aula não reconhecida';
            ui.banner.classList.remove('hidden');
            ui.bannerMessage.textContent = message.data?.message || 'A estrutura da página mudou.';
            ui.bannerAction.textContent = 'Fechar';
            bannerMode = 'selector-diagnostic';
        } else if (message.type === 'AUTOPLAY_BLOCKED' || message.type === 'VIDEO_PLAY_FAILED') {
            ui.videoStatus.textContent = message.error === 'video-not-found' ? 'Player ainda não carregou. Tente novamente em instantes.' : 'O Firefox bloqueou a reprodução. Libere o autoplay para a Alura ou clique no player uma vez.';
        } else if (message.type === 'VIDEO_TRANSCRIPTION_FAILED') {
            ui.banner.classList.remove('hidden');
            ui.bannerMessage.textContent = 'A transcrição foi encontrada, mas seu conteúdo não terminou de carregar. A aula não avançou.';
            ui.bannerAction.textContent = 'Tentar novamente';
            bannerMode = 'retry-transcription';
        }
    });

    chrome.storage.local.get(['progressHistory', 'playbackSpeed'], result => {
        renderHistory(result.progressHistory || []);
        setSpeedUI(result.playbackSpeed || 1);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.autoReadEnabled?.newValue === false) {
            clearTimeout(autoReadTimer);
            autoReadTimer = null;
        }
        if (area === 'local' && changes.rsvpWpm && !currentData?.isVideoTranscript) setRsvpWpm(changes.rsvpWpm.newValue);
        if (area === 'local' && changes.transcriptRsvpWpm && currentData?.isVideoTranscript) setRsvpWpm(changes.transcriptRsvpWpm.newValue);
        if (area === 'local' && changes.readingMode && currentMode === 'CONTENT' && !currentData?.isQuiz && !currentData?.isVideoTranscript) {
            setReadingMode(changes.readingMode.newValue);
        }
        if (area === 'local' && changes.progressHistory) renderHistory(changes.progressHistory.newValue || []);
    });
    runtimeMessage({ type: 'COMPANION_READY' }).then(response => switchMode(response.mode, response.data));
});
