'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const byId = id => document.getElementById(id);
    const controls = {
        speed: byId('speedSlider'), speedValue: byId('speedValue'), speedLabel: byId('speedLabel'), speedScopeHint: byId('speedScopeHint'),
        perCourse: byId('perCourseToggle'), autoPlay: byId('autoPlayToggle'), autoAdvance: byId('autoAdvanceToggle'),
        autoAdvanceOptions: byId('autoAdvanceOptions'), advanceDelay: byId('advanceDelay'), minimize: byId('minimizeToggle'),
        transcriptAfterVideo: byId('transcriptAfterVideoToggle'), transcriptOptions: byId('transcriptOptions'),
        transcriptRsvpWpm: byId('transcriptRsvpWpm'), transcriptRsvpWpmValue: byId('transcriptRsvpWpmValue'),
        autoRead: byId('autoReadToggle'), readingModes: Array.from(document.querySelectorAll('input[name="readingMode"]')),
        ttsOptions: byId('ttsOptions'), rsvpOptions: byId('rsvpOptions'), rsvpWpm: byId('rsvpWpm'), rsvpWpmValue: byId('rsvpWpmValue'),
        ttsRate: byId('ttsRate'), ttsRateValue: byId('ttsRateValue'), voice: byId('voiceSelect'),
        shortcuts: byId('shortcutsToggle'), shortcutDetails: byId('shortcutDetails'), shortcutStatus: byId('shortcutStatus'), repairShortcut: byId('repairSpeedShortcut'),
        tabs: byId('controlledTab'), status: byId('sessionStatus'), progress: byId('progressSummary'),
        clearHistory: byId('clearHistory'), clearHistoryHint: byId('clearHistoryHint'), saveStatus: byId('saveStatus')
    };
    let session = null;
    let settings = {};
    let saveStatusTimer = null;
    let clearConfirmationTimer = null;
    let historyCount = 0;

    function runtimeMessage(message) {
        return new Promise(resolve => chrome.runtime.sendMessage(message, response => resolve(response || {})));
    }

    function setStatus(text, error = false) {
        controls.status.textContent = text;
        controls.status.dataset.state = error ? 'error' : 'ok';
    }

    function showSaved() {
        clearTimeout(saveStatusTimer);
        controls.saveStatus.textContent = 'Salvo';
        saveStatusTimer = setTimeout(() => { controls.saveStatus.textContent = ''; }, 1300);
    }

    function saveSettings(updates, callback) {
        Object.assign(settings, updates);
        chrome.storage.local.set(updates, () => {
            showSaved();
            callback?.();
        });
    }

    function formatRate(value) {
        return Number(value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    }

    function updateOutputs() {
        controls.speedValue.textContent = `${formatRate(controls.speed.value)}x`;
        controls.ttsRateValue.textContent = `${formatRate(controls.ttsRate.value)}x`;
        controls.rsvpWpmValue.textContent = `${Number(controls.rsvpWpm.value)} ppm`;
        controls.transcriptRsvpWpmValue.textContent = `${Number(controls.transcriptRsvpWpm.value)} ppm`;
    }

    function setGroupVisible(element, visible) {
        element.hidden = !visible;
        element.setAttribute('aria-hidden', String(!visible));
        element.querySelectorAll('input, select, button').forEach(control => { control.disabled = !visible; });
    }

    function selectedReadingMode() {
        return controls.readingModes.find(input => input.checked)?.value || 'tts';
    }

    function setReadingMode(mode) {
        controls.readingModes.forEach(input => { input.checked = input.value === (mode === 'rsvp' ? 'rsvp' : 'tts'); });
    }

    function updateConditionalSettings() {
        setGroupVisible(controls.autoAdvanceOptions, controls.autoAdvance.checked);
        controls.autoAdvance.setAttribute('aria-expanded', String(controls.autoAdvance.checked));
        setGroupVisible(controls.transcriptOptions, controls.transcriptAfterVideo.checked);
        controls.transcriptAfterVideo.setAttribute('aria-expanded', String(controls.transcriptAfterVideo.checked));
        const mode = selectedReadingMode();
        setGroupVisible(controls.ttsOptions, mode === 'tts');
        setGroupVisible(controls.rsvpOptions, mode === 'rsvp');
        setGroupVisible(controls.shortcutDetails, controls.shortcuts.checked);
        controls.shortcuts.setAttribute('aria-expanded', String(controls.shortcuts.checked));
    }

    function currentCourseId() {
        return session?.latestState?.data?.courseId || null;
    }

    function updateSpeedScope() {
        const courseId = currentCourseId();
        controls.perCourse.disabled = !courseId;
        if (!courseId) {
            controls.speedLabel.textContent = 'Velocidade padrão';
            controls.speedScopeHint.textContent = 'Abra uma aula da Alura para configurar uma velocidade por curso.';
        } else if (controls.perCourse.checked) {
            controls.speedLabel.textContent = 'Velocidade neste curso';
            controls.speedScopeHint.textContent = `Aplicada somente ao curso “${courseId}”.`;
        } else {
            controls.speedLabel.textContent = 'Velocidade padrão';
            controls.speedScopeHint.textContent = 'Aplicada a todos os cursos sem uma velocidade própria.';
        }
    }

    function saveSpeed() {
        const playbackSpeed = Number(controls.speed.value);
        const courseId = currentCourseId();
        if (controls.perCourse.checked && courseId) {
            const courseProfiles = { ...(settings.courseProfiles || {}) };
            courseProfiles[courseId] = { ...(courseProfiles[courseId] || {}), playbackSpeed };
            saveSettings({ courseProfiles });
        } else {
            saveSettings({ playbackSpeed });
        }
        runtimeMessage({ type: 'UPDATE_SPEED', speed: playbackSpeed });
        updateOutputs();
    }

    function resetClearConfirmation() {
        clearTimeout(clearConfirmationTimer);
        clearConfirmationTimer = null;
        controls.clearHistory.textContent = 'Limpar histórico…';
        controls.clearHistory.classList.remove('danger-confirm');
        controls.clearHistoryHint.textContent = '';
    }

    function renderProgress(history) {
        const entries = Array.isArray(history) ? history : [];
        const completed = entries.filter(item => item.completedAt).length;
        historyCount = entries.length;
        controls.progress.textContent = entries.length
            ? `${completed} de ${entries.length} aulas recentes concluídas neste dispositivo.`
            : 'Nenhum progresso local.';
        controls.clearHistory.disabled = entries.length === 0;
        if (!entries.length) resetClearConfirmation();
    }

    async function loadSession() {
        session = await runtimeMessage({ type: 'GET_SESSION_STATUS' });
        controls.tabs.replaceChildren();
        if (!session.tabs?.length) {
            controls.tabs.append(new Option('Nenhuma aba da Alura aberta', ''));
            setStatus('Abra uma aula da Alura para começar.', true);
            controls.speed.value = settings.playbackSpeed || 1;
            updateSpeedScope();
            updateOutputs();
            return;
        }
        session.tabs.forEach(tab => {
            const option = new Option(tab.title || tab.url, String(tab.id));
            option.selected = tab.id === session.controlledTabId;
            controls.tabs.append(option);
        });
        const diagnostic = session.diagnostic;
        if (diagnostic?.data?.message) setStatus(diagnostic.data.message, true);
        else setStatus(session.latestState?.data?.title ? `Controlando: ${session.latestState.data.title}` : 'Aba selecionada. Aguardando uma aula…');

        const courseProfile = settings.courseProfiles?.[currentCourseId()];
        controls.speed.value = controls.perCourse.checked && courseProfile?.playbackSpeed
            ? courseProfile.playbackSpeed
            : settings.playbackSpeed || 1;
        updateSpeedScope();
        updateOutputs();
    }

    function populateVoices() {
        const selected = settings.ttsVoiceURI || '';
        const voices = speechSynthesis.getVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
        controls.voice.replaceChildren(new Option('Voz automática do idioma', ''));
        voices.forEach(voice => controls.voice.append(new Option(`${voice.name} — ${voice.lang}`, voice.voiceURI)));
        controls.voice.value = selected;
    }

    function loadShortcutStatus() {
        if (!chrome.commands?.getAll) {
            controls.shortcutStatus.textContent = 'O Firefox não informou o estado dos atalhos.';
            controls.repairShortcut.hidden = false;
            return;
        }
        chrome.commands.getAll(commands => {
            const command = commands?.find(item => item.name === 'cycle-speed');
            if (command?.shortcut) {
                controls.shortcutStatus.textContent = `Atalho de velocidade ativo: ${command.shortcut}`;
                controls.repairShortcut.hidden = true;
            } else {
                controls.shortcutStatus.textContent = 'Ctrl+Alt+S está sem tecla atribuída ou em conflito.';
                controls.repairShortcut.hidden = false;
            }
        });
    }

    chrome.storage.local.get([
        'playbackSpeed', 'autoPlayEnabled', 'autoAdvanceEnabled', 'autoAdvanceDelay', 'shortcutsEnabled', 'autoReadEnabled',
        'autoMinimizeEnabled', 'ttsRate', 'ttsVoiceURI', 'readingMode', 'rsvpWpm', 'transcriptRsvpWpm',
        'rsvpAfterVideoEnabled', 'perCourseSettings', 'courseProfiles', 'progressHistory'
    ], stored => {
        settings = stored;
        controls.speed.value = stored.playbackSpeed || 1;
        controls.autoPlay.checked = stored.autoPlayEnabled !== false;
        controls.autoAdvance.checked = stored.autoAdvanceEnabled !== false;
        controls.advanceDelay.value = String(stored.autoAdvanceDelay ?? 5);
        controls.shortcuts.checked = stored.shortcutsEnabled !== false;
        controls.autoRead.checked = stored.autoReadEnabled !== false;
        controls.minimize.checked = stored.autoMinimizeEnabled !== false;
        controls.ttsRate.value = stored.ttsRate || 1.15;
        setReadingMode(stored.readingMode || 'tts');
        controls.rsvpWpm.value = stored.rsvpWpm || 300;
        controls.transcriptRsvpWpm.value = stored.transcriptRsvpWpm || stored.rsvpWpm || 300;
        controls.transcriptAfterVideo.checked = stored.rsvpAfterVideoEnabled === true;
        controls.perCourse.checked = stored.perCourseSettings !== false;
        renderProgress(stored.progressHistory);
        updateOutputs();
        updateConditionalSettings();
        populateVoices();
        loadSession();
        loadShortcutStatus();
    });
    speechSynthesis.addEventListener?.('voiceschanged', populateVoices);

    controls.speed.addEventListener('input', updateOutputs);
    controls.speed.addEventListener('change', saveSpeed);
    controls.ttsRate.addEventListener('input', updateOutputs);
    controls.ttsRate.addEventListener('change', () => saveSettings({ ttsRate: Number(controls.ttsRate.value) }));
    controls.rsvpWpm.addEventListener('input', updateOutputs);
    controls.rsvpWpm.addEventListener('change', () => saveSettings({ rsvpWpm: Number(controls.rsvpWpm.value) }));
    controls.transcriptRsvpWpm.addEventListener('input', updateOutputs);
    controls.transcriptRsvpWpm.addEventListener('change', () => saveSettings({ transcriptRsvpWpm: Number(controls.transcriptRsvpWpm.value) }));
    controls.readingModes.forEach(input => input.addEventListener('change', () => {
        if (!input.checked) return;
        updateConditionalSettings();
        saveSettings({ readingMode: input.value });
    }));
    controls.voice.addEventListener('change', () => saveSettings({ ttsVoiceURI: controls.voice.value }));
    controls.perCourse.addEventListener('change', () => {
        saveSettings({ perCourseSettings: controls.perCourse.checked });
        if (controls.perCourse.checked) {
            const profileSpeed = settings.courseProfiles?.[currentCourseId()]?.playbackSpeed;
            if (profileSpeed) {
                controls.speed.value = profileSpeed;
                runtimeMessage({ type: 'UPDATE_SPEED', speed: Number(profileSpeed) });
            }
            else saveSpeed();
        } else {
            controls.speed.value = settings.playbackSpeed || 1;
            runtimeMessage({ type: 'UPDATE_SPEED', speed: Number(controls.speed.value) });
        }
        updateSpeedScope();
        updateOutputs();
    });
    controls.autoPlay.addEventListener('change', () => saveSettings({ autoPlayEnabled: controls.autoPlay.checked }));
    controls.autoAdvance.addEventListener('change', () => {
        updateConditionalSettings();
        saveSettings({ autoAdvanceEnabled: controls.autoAdvance.checked });
        runtimeMessage({ type: 'UPDATE_AUTO_ADVANCE', enabled: controls.autoAdvance.checked });
    });
    controls.advanceDelay.addEventListener('change', () => saveSettings({ autoAdvanceDelay: Number(controls.advanceDelay.value) }));
    controls.shortcuts.addEventListener('change', () => {
        updateConditionalSettings();
        saveSettings({ shortcutsEnabled: controls.shortcuts.checked });
    });
    controls.autoRead.addEventListener('change', () => saveSettings({ autoReadEnabled: controls.autoRead.checked }));
    controls.minimize.addEventListener('change', () => saveSettings({ autoMinimizeEnabled: controls.minimize.checked }));
    controls.transcriptAfterVideo.addEventListener('change', () => {
        updateConditionalSettings();
        saveSettings({ rsvpAfterVideoEnabled: controls.transcriptAfterVideo.checked });
    });
    controls.tabs.addEventListener('change', async () => {
        if (!controls.tabs.value) return;
        const result = await runtimeMessage({ type: 'SET_CONTROLLED_TAB', tabId: Number(controls.tabs.value) });
        if (!result.ok) setStatus(result.error || 'Não foi possível selecionar a aba.', true);
        else setTimeout(loadSession, 200);
    });
    byId('refreshTabs').addEventListener('click', loadSession);
    byId('openCompanion').addEventListener('click', () => runtimeMessage({ type: 'OPEN_COMPANION' }));
    controls.repairShortcut.addEventListener('click', async () => {
        controls.shortcutStatus.textContent = 'Restaurando Ctrl+Alt+S…';
        const result = await runtimeMessage({ type: 'REPAIR_SPEED_SHORTCUT' });
        controls.shortcutStatus.textContent = result.ok
            ? `Atalho de velocidade ativo: ${result.shortcut}`
            : `Não foi possível restaurar: ${result.error || 'conflito com outro atalho'}`;
        controls.repairShortcut.hidden = Boolean(result.ok);
    });
    controls.clearHistory.addEventListener('click', () => {
        if (!clearConfirmationTimer) {
            controls.clearHistory.textContent = `Confirmar exclusão de ${historyCount} ${historyCount === 1 ? 'aula' : 'aulas'}`;
            controls.clearHistory.classList.add('danger-confirm');
            controls.clearHistoryHint.textContent = 'Clique novamente para apagar. Esta ação não pode ser desfeita.';
            clearConfirmationTimer = setTimeout(resetClearConfirmation, 6000);
            return;
        }
        chrome.storage.local.set({ progressHistory: [] }, () => {
            resetClearConfirmation();
            renderProgress([]);
            showSaved();
        });
    });
});
