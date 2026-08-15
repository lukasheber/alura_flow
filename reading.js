'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const byId = id => document.getElementById(id);
    const ui = {
        led: byId('connectionLed'), title: byId('mainTitle'), player: byId('view-player'), content: byId('view-content'),
        text: byId('textContainer'), quiz: byId('quizContainer'), dynamic: byId('dynamicContent'), opinion: byId('opinionSection'),
        opinionContent: byId('opinionContent'), videoStatus: byId('videoStatusText'), play: byId('remotePlay'), prev: byId('remotePrev'),
        next: byId('remoteNext'), tts: byId('ttsBtn'), ttsTop: byId('ttsBtnTop'), finish: byId('finishBtn'),
        finishTop: byId('finishBtnTop'), fab: byId('ttsFab'), banner: byId('advanceBanner'), bannerMessage: byId('advanceMessage'),
        bannerAction: byId('advanceAction'), history: byId('historyList')
    };
    const synth = window.speechSynthesis;
    let currentMode = 'NONE';
    let currentData = null;
    let currentViewKey = '';
    let isSpeaking = false;
    let isPaused = false;
    let speechGeneration = 0;
    let autoReadTimer = null;
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

    function stopSpeaking() {
        speechGeneration += 1;
        clearTimeout(autoReadTimer);
        autoReadTimer = null;
        synth.cancel();
        isSpeaking = false;
        isPaused = false;
        document.querySelectorAll('.reading-active').forEach(element => element.classList.remove('reading-active'));
        [ui.tts, ui.ttsTop].forEach(button => { if (button) button.textContent = '🔊 Ouvir'; });
        updateFab();
    }

    function updateFab() {
        ui.fab.classList.toggle('visible', isSpeaking);
        ui.fab.textContent = isPaused ? '▶️' : '⏸️';
        ui.fab.setAttribute('aria-label', isPaused ? 'Retomar leitura' : 'Pausar leitura');
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

    function startSpeaking() {
        if (currentMode !== 'CONTENT' || currentData?.isQuiz || !currentData || AluraFlowCore.isLoadingState(currentData)) return;
        stopSpeaking();
        const generation = speechGeneration;
        const elements = readableElements(ui.dynamic).concat(ui.opinion.classList.contains('hidden') ? [] : readableElements(ui.opinionContent));
        if (!elements.length) return;

        chrome.storage.local.get(['ttsRate', 'ttsVoiceURI', 'autoAdvanceEnabled'], settings => {
            if (generation !== speechGeneration || currentMode !== 'CONTENT' || currentData?.isQuiz || AluraFlowCore.isLoadingState(currentData)) return;
            const voice = bestVoice(synth.getVoices(), settings.ttsVoiceURI || '', currentData.language || 'pt-BR');
            let completed = 0;
            isSpeaking = true;
            [ui.tts, ui.ttsTop].forEach(button => { if (button) button.textContent = '⏹ Parar'; });
            updateFab();

            elements.forEach(element => {
                const utterance = new SpeechSynthesisUtterance(element.innerText.trim());
                utterance.lang = currentData.language || 'pt-BR';
                utterance.rate = Number(settings.ttsRate) || 1.15;
                if (voice) utterance.voice = voice;
                utterance.onstart = () => {
                    if (generation !== speechGeneration) return;
                    document.querySelectorAll('.reading-active').forEach(active => active.classList.remove('reading-active'));
                    element.classList.add('reading-active');
                    element.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
                };
                utterance.onend = () => {
                    if (generation !== speechGeneration) return;
                    element.classList.remove('reading-active');
                    completed += 1;
                    if (completed !== elements.length) return;
                    isSpeaking = false;
                    [ui.tts, ui.ttsTop].forEach(button => { if (button) button.textContent = '🔊 Ouvir'; });
                    updateFab();
                    if (settings.autoAdvanceEnabled !== false) {
                        markLessonCompleted();
                        runtimeMessage({ type: 'AUTO_FINISH_READING' });
                    }
                };
                utterance.onerror = utterance.onend;
                synth.speak(utterance);
            });
        });
    }

    function toggleSpeech() {
        if (isSpeaking) stopSpeaking();
        else startSpeaking();
    }

    function togglePause() {
        if (!isSpeaking) return;
        if (synth.paused || isPaused) { synth.resume(); isPaused = false; }
        else { synth.pause(); isPaused = true; }
        updateFab();
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
            const item = history.find(entry => entry.lessonId === currentData.lessonId && entry.courseId === currentData.courseId);
            if (item) item.completedAt = Date.now();
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
        ui.text.classList.remove('hidden');
        ui.quiz.classList.add('hidden');
        ui.finish.closest('.reading-actions').classList.toggle('hidden', isLoading);
        [ui.tts, ui.ttsTop, ui.finish, ui.finishTop].forEach(button => button?.classList.toggle('hidden', isLoading));
        ui.title.textContent = data.title || 'Leitura';
        safeHTML(ui.dynamic, data.html || '');
        if (data.opinionHtml) { safeHTML(ui.opinionContent, data.opinionHtml); ui.opinion.classList.remove('hidden'); }
        else { ui.opinion.classList.add('hidden'); ui.opinionContent.replaceChildren(); }
        if (!isLoading) recordLesson(data);

        chrome.storage.local.get(['autoReadEnabled'], settings => {
            if (settings.autoReadEnabled !== false && currentMode === 'CONTENT' && !currentData?.isQuiz && !AluraFlowCore.isLoadingState(currentData)) {
                clearTimeout(autoReadTimer);
                autoReadTimer = setTimeout(startSpeaking, 500);
            }
        });
    }

    function renderQuiz(data) {
        stopSpeaking();
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

        (data.options || []).forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'option-btn';
            button.dataset.id = option.id;
            button.setAttribute('aria-pressed', String(Boolean(option.isSelected)));
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
    }

    function switchMode(mode, data) {
        if (!mode || mode === 'NONE') {
            ui.title.textContent = 'Abra uma aula da Alura';
            ui.led.classList.remove('led-active');
            return;
        }
        const key = viewKey(data);
        const changed = key !== currentViewKey;
        if (changed || mode !== currentMode || data?.isQuiz) stopSpeaking();
        currentMode = mode;
        currentData = data || {};
        currentViewKey = key;
        ui.led.classList.add('led-active');
        if (mode === 'PLAYER') {
            ui.player.classList.remove('hidden');
            ui.content.classList.add('hidden');
            ui.title.textContent = data?.title || 'Vídeo';
            ui.videoStatus.textContent = data?.status === 'playing' ? 'Reproduzindo…' : data?.status === 'loading' ? 'Carregando vídeo…' : 'Pausado';
            recordLesson(data, 'video');
        } else if (mode === 'CONTENT') {
            ui.player.classList.add('hidden');
            ui.content.classList.remove('hidden');
            data?.isQuiz ? renderQuiz(data) : renderText(data || {});
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
    [ui.tts, ui.ttsTop].forEach(button => button?.addEventListener('click', toggleSpeech));
    ui.fab.addEventListener('click', togglePause);
    [ui.finish, ui.finishTop].forEach(button => button?.addEventListener('click', () => {
        stopSpeaking();
        markLessonCompleted();
        runtimeMessage({ type: 'FINISH_READING' });
    }));
    ui.bannerAction.addEventListener('click', () => {
        if (bannerMode === 'undo') runtimeMessage({ type: 'COMMAND_PREV' });
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
            if (isSpeaking) togglePause(); else startSpeaking();
        } else if (message.type === 'QUIZ_FEEDBACK_ERROR') {
            const wrongIds = message.wrongIds?.length ? message.wrongIds : lastClickedOptionId !== null ? [lastClickedOptionId] : [];
            wrongIds.forEach(id => byId('quizOptions').querySelector(`[data-id="${CSS.escape(String(id))}"]`)?.classList.add('wrong'));
        } else if (message.type === 'QUIZ_FEEDBACK_SUCCESS' || message.type === 'QUIZ_REVEAL_CORRECT') {
            (message.correctIds || []).forEach(id => byId('quizOptions').querySelector(`[data-id="${CSS.escape(String(id))}"]`)?.classList.add('reveal-correct'));
            if (message.type === 'QUIZ_FEEDBACK_SUCCESS') markLessonCompleted();
        } else if (message.type === 'AUTO_ADVANCE_COUNTDOWN') showCountdown(message);
        else if (message.type === 'AUTO_ADVANCE_CANCELLED') ui.banner.classList.add('hidden');
        else if (message.type === 'AUTO_ADVANCE_EXECUTED') showUndo();
        else if (message.type === 'TRANSITION_START') {
            stopSpeaking();
            switchMode(message.predictedMode || 'CONTENT', { title: 'Carregando próxima aula…', status: 'loading', isLoading: true, html: '<p aria-live="polite">Carregando…</p>' });
        } else if (message.type === 'SELECTOR_DIAGNOSTIC') {
            ui.led.classList.remove('led-active');
            ui.title.textContent = 'Aula não reconhecida';
            ui.banner.classList.remove('hidden');
            ui.bannerMessage.textContent = message.data?.message || 'A estrutura da página mudou.';
            ui.bannerAction.textContent = 'Fechar';
            bannerMode = 'close';
        } else if (message.type === 'AUTOPLAY_BLOCKED' || message.type === 'VIDEO_PLAY_FAILED') {
            ui.videoStatus.textContent = message.error === 'video-not-found' ? 'Player ainda não carregou. Tente novamente em instantes.' : 'O Firefox bloqueou a reprodução. Libere o autoplay para a Alura ou clique no player uma vez.';
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
        if (area === 'local' && changes.progressHistory) renderHistory(changes.progressHistory.newValue || []);
    });
    runtimeMessage({ type: 'COMPANION_READY' }).then(response => switchMode(response.mode, response.data));
});
