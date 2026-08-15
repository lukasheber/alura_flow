'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const byId = id => document.getElementById(id);
    const controls = {
        speed: byId('speedSlider'), speedValue: byId('speedValue'), perCourse: byId('perCourseToggle'),
        autoPlay: byId('autoPlayToggle'),
        autoAdvance: byId('autoAdvanceToggle'), advanceDelay: byId('advanceDelay'), minimize: byId('minimizeToggle'),
        autoRead: byId('autoReadToggle'), shortcuts: byId('shortcutsToggle'), ttsRate: byId('ttsRate'),
        ttsRateValue: byId('ttsRateValue'), voice: byId('voiceSelect'), tabs: byId('controlledTab'),
        status: byId('sessionStatus'), shortcutStatus: byId('shortcutStatus'), progress: byId('progressSummary')
    };
    let session = null;
    let settings = {};

    function runtimeMessage(message) {
        return new Promise(resolve => chrome.runtime.sendMessage(message, response => resolve(response || {})));
    }

    function setStatus(text, error = false) {
        controls.status.textContent = text;
        controls.status.dataset.state = error ? 'error' : 'ok';
    }

    function updateOutputs() {
        controls.speedValue.textContent = `${Number(controls.speed.value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
        controls.ttsRateValue.textContent = `${Number(controls.ttsRate.value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
    }

    function loadShortcutStatus() {
        if (!chrome.commands?.getAll) {
            controls.shortcutStatus.textContent = 'O Firefox não informou o estado do atalho.';
            return;
        }
        chrome.commands.getAll(commands => {
            const command = commands?.find(item => item.name === 'cycle-speed');
            controls.shortcutStatus.textContent = command?.shortcut
                ? `Atalho de velocidade ativo: ${command.shortcut}`
                : 'O atalho de velocidade está sem tecla atribuída.';
        });
    }

    function currentCourseId() {
        return session?.latestState?.data?.courseId || null;
    }

    function saveSpeed() {
        const playbackSpeed = Number(controls.speed.value);
        const updates = { playbackSpeed };
        if (controls.perCourse.checked && currentCourseId()) {
            const courseProfiles = { ...(settings.courseProfiles || {}) };
            courseProfiles[currentCourseId()] = { ...(courseProfiles[currentCourseId()] || {}), playbackSpeed };
            updates.courseProfiles = courseProfiles;
            settings.courseProfiles = courseProfiles;
        }
        chrome.storage.local.set(updates);
        runtimeMessage({ type: 'UPDATE_SPEED', speed: playbackSpeed });
        updateOutputs();
    }

    function renderProgress(history) {
        const entries = Array.isArray(history) ? history : [];
        const completed = entries.filter(item => item.completedAt).length;
        controls.progress.textContent = entries.length ? `${completed} de ${entries.length} aulas recentes concluídas neste dispositivo.` : 'Nenhum progresso local.';
    }

    async function loadSession() {
        session = await runtimeMessage({ type: 'GET_SESSION_STATUS' });
        controls.tabs.innerHTML = '';
        if (!session.tabs?.length) {
            controls.tabs.append(new Option('Nenhuma aba da Alura aberta', ''));
            setStatus('Abra uma aula da Alura para começar.', true);
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
        if (controls.perCourse.checked && courseProfile?.playbackSpeed) controls.speed.value = courseProfile.playbackSpeed;
        updateOutputs();
    }

    function populateVoices() {
        const selected = settings.ttsVoiceURI || '';
        const voices = speechSynthesis.getVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
        controls.voice.innerHTML = '';
        controls.voice.append(new Option('Voz automática do idioma', ''));
        voices.forEach(voice => controls.voice.append(new Option(`${voice.name} — ${voice.lang}`, voice.voiceURI)));
        controls.voice.value = selected;
    }

    chrome.storage.local.get([
        'playbackSpeed', 'autoPlayEnabled', 'autoAdvanceEnabled', 'autoAdvanceDelay', 'shortcutsEnabled', 'autoReadEnabled',
        'autoMinimizeEnabled', 'ttsRate', 'ttsVoiceURI', 'perCourseSettings', 'courseProfiles', 'progressHistory'
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
        controls.perCourse.checked = stored.perCourseSettings !== false;
        renderProgress(stored.progressHistory);
        updateOutputs();
        populateVoices();
        loadSession();
        loadShortcutStatus();
    });
    speechSynthesis.addEventListener?.('voiceschanged', populateVoices);

    controls.speed.addEventListener('input', updateOutputs);
    controls.speed.addEventListener('change', saveSpeed);
    controls.ttsRate.addEventListener('input', updateOutputs);
    controls.ttsRate.addEventListener('change', () => chrome.storage.local.set({ ttsRate: Number(controls.ttsRate.value) }));
    controls.voice.addEventListener('change', () => chrome.storage.local.set({ ttsVoiceURI: controls.voice.value }));
    controls.perCourse.addEventListener('change', () => chrome.storage.local.set({ perCourseSettings: controls.perCourse.checked }));
    controls.autoPlay.addEventListener('change', () => chrome.storage.local.set({ autoPlayEnabled: controls.autoPlay.checked }));
    controls.autoAdvance.addEventListener('change', () => {
        chrome.storage.local.set({ autoAdvanceEnabled: controls.autoAdvance.checked });
        runtimeMessage({ type: 'UPDATE_AUTO_ADVANCE', enabled: controls.autoAdvance.checked });
    });
    controls.advanceDelay.addEventListener('change', () => chrome.storage.local.set({ autoAdvanceDelay: Number(controls.advanceDelay.value) }));
    controls.shortcuts.addEventListener('change', () => chrome.storage.local.set({ shortcutsEnabled: controls.shortcuts.checked }));
    controls.autoRead.addEventListener('change', () => chrome.storage.local.set({ autoReadEnabled: controls.autoRead.checked }));
    controls.minimize.addEventListener('change', () => chrome.storage.local.set({ autoMinimizeEnabled: controls.minimize.checked }));
    controls.tabs.addEventListener('change', async () => {
        if (!controls.tabs.value) return;
        const result = await runtimeMessage({ type: 'SET_CONTROLLED_TAB', tabId: Number(controls.tabs.value) });
        if (!result.ok) setStatus(result.error || 'Não foi possível selecionar a aba.', true);
        else setTimeout(loadSession, 200);
    });
    byId('refreshTabs').addEventListener('click', loadSession);
    byId('openCompanion').addEventListener('click', () => runtimeMessage({ type: 'OPEN_COMPANION' }));
    byId('repairSpeedShortcut').addEventListener('click', async () => {
        controls.shortcutStatus.textContent = 'Restaurando Ctrl+Alt+S…';
        const result = await runtimeMessage({ type: 'REPAIR_SPEED_SHORTCUT' });
        controls.shortcutStatus.textContent = result.ok
            ? `Atalho de velocidade ativo: ${result.shortcut}`
            : `Não foi possível restaurar: ${result.error || 'conflito com outro atalho'}`;
        if (result.ok) loadShortcutStatus();
    });
    byId('clearHistory').addEventListener('click', () => chrome.storage.local.set({ progressHistory: [] }, () => renderProgress([])));
});
