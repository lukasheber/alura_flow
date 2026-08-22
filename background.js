// Alura Flow - background controller
'use strict';

const COMPANION_URL = chrome.runtime.getURL('reading.html');
const ALURA_URL_PATTERN = '*://*.alura.com.br/*';
const DEFAULT_SPEED_SHORTCUT = 'Ctrl+Alt+S';
let isCreatingWindow = false;
let lastSpeedCycleAt = 0;
const creationQueue = [];

function flushCreationQueue(win) {
    while (creationQueue.length) {
        const callback = creationQueue.shift();
        try { callback(win || null); } catch (error) { console.error('Companion callback failed:', error); }
    }
}

function findCompanionWindow(callback) {
    chrome.windows.getAll({ populate: true }, windows => {
        if (chrome.runtime.lastError) {
            callback(null);
            return;
        }
        const found = windows.find(win => win.type === 'popup' && win.tabs?.some(tab => tab.url === COMPANION_URL));
        callback(found || null);
    });
}

function getCompanionWindow(callback) {
    if (isCreatingWindow) {
        creationQueue.push(callback);
        return;
    }

    chrome.storage.session.get(['companionWindowId'], result => {
        const id = result.companionWindowId;
        if (!Number.isInteger(id)) {
            findCompanionWindow(callback);
            return;
        }

        chrome.windows.get(id, { populate: true }, win => {
            if (!chrome.runtime.lastError && win?.tabs?.some(tab => tab.url === COMPANION_URL)) {
                callback(win);
                return;
            }
            chrome.storage.session.remove('companionWindowId');
            findCompanionWindow(callback);
        });
    });
}

function companionTab(win) {
    return win?.tabs?.find(tab => tab.url === COMPANION_URL) || null;
}

function sendToCompanion(message) {
    chrome.runtime.sendMessage({ ...message, target: 'COMPANION' }, () => void chrome.runtime.lastError);
}

function createCompanionWindow(initialState, focus = true, callback = () => {}) {
    if (isCreatingWindow) {
        creationQueue.push(callback);
        return;
    }
    isCreatingWindow = true;

    chrome.windows.create({
        url: COMPANION_URL,
        type: 'popup',
        width: 520,
        height: 680,
        focused: focus
    }, win => {
        const error = chrome.runtime.lastError;
        isCreatingWindow = false;
        if (error || !win?.id) {
            console.error('Unable to create companion window:', error?.message || 'Unknown error');
            flushCreationQueue(null);
            callback(null);
            return;
        }

        chrome.storage.session.set({ companionWindowId: win.id });
        flushCreationQueue(win);
        callback(win);
        if (initialState) setTimeout(() => sendToCompanion(initialState), 150);
    });
}

function ensureCompanionWindow(message, focus = false) {
    getCompanionWindow(win => {
        if (!win) {
            createCompanionWindow(message, focus);
            return;
        }
        sendToCompanion(message);
        if (focus) chrome.windows.update(win.id, { state: 'normal', focused: true });
    });
}

function firefoxHasFocusedWindow(callback) {
    chrome.windows.getAll({}, windows => {
        if (chrome.runtime.lastError) {
            callback(false);
            return;
        }
        callback((windows || []).some(win => win.focused === true));
    });
}

function getAluraTabs(callback) {
    chrome.tabs.query({ url: ALURA_URL_PATTERN }, tabs => callback(tabs || []));
}

function getControlledTab(callback) {
    chrome.storage.session.get(['controlledTabId'], result => {
        getAluraTabs(tabs => {
            const selected = AluraFlowCore.chooseControlledTab(tabs, result.controlledTabId);
            if (!selected) {
                chrome.storage.session.remove(['controlledTabId', 'latestState']);
                callback(null);
                return;
            }
            if (selected.id !== result.controlledTabId) chrome.storage.session.set({ controlledTabId: selected.id });
            callback(selected);
        });
    });
}

function routeToControlledTab(payload, callback = () => {}) {
    getControlledTab(tab => {
        if (!tab) {
            callback({ ok: false, error: 'Nenhuma aba da Alura encontrada.' });
            return;
        }
        chrome.tabs.sendMessage(tab.id, payload, response => {
            const error = chrome.runtime.lastError;
            if (error) callback({ ok: false, error: error.message });
            else if (response?.ok === false) callback({ ...response, tabId: tab.id });
            else callback({ ok: true, tabId: tab.id, response });
        });
    });
}

function storePlaybackSpeed(rawSpeed, courseId, callback = () => {}) {
    const speed = Number(rawSpeed);
    if (!Number.isFinite(speed) || speed <= 0) {
        callback({ ok: false, error: 'Velocidade inválida.' });
        return;
    }

    chrome.storage.local.get(['perCourseSettings', 'courseProfiles'], local => {
        const update = { playbackSpeed: speed };
        if (local.perCourseSettings !== false && courseId) {
            const courseProfiles = { ...(local.courseProfiles || {}) };
            courseProfiles[courseId] = { ...(courseProfiles[courseId] || {}), playbackSpeed: speed };
            update.courseProfiles = courseProfiles;
        }
        chrome.storage.local.set(update, () => callback({ ok: true, speed }));
    });
}

function applyPlaybackSpeed(rawSpeed, callback = () => {}) {
    chrome.storage.session.get(['latestState'], session => {
        const courseId = session.latestState?.data?.courseId;
        storePlaybackSpeed(rawSpeed, courseId, stored => {
            if (!stored.ok) {
                callback(stored);
                return;
            }
            routeToControlledTab({ type: 'UPDATE_SPEED', speed: stored.speed }, routed => {
                sendToCompanion({ type: 'SPEED_UPDATED', speed: stored.speed });
                callback({ ...routed, speed: stored.speed });
            });
        });
    });
}

function cyclePlaybackSpeed(callback = () => {}) {
    const now = Date.now();
    if (now - lastSpeedCycleAt < 350) {
        callback({ ok: true, duplicate: true });
        return;
    }
    lastSpeedCycleAt = now;

    chrome.storage.local.get(['playbackSpeed', 'perCourseSettings', 'courseProfiles'], local => {
        chrome.storage.session.get(['latestState'], session => {
            const courseId = session.latestState?.data?.courseId;
            const profileSpeed = local.perCourseSettings !== false && courseId
                ? local.courseProfiles?.[courseId]?.playbackSpeed
                : null;
            const current = Number(profileSpeed ?? local.playbackSpeed ?? 1);
            applyPlaybackSpeed(AluraFlowCore.nextPlaybackSpeed(current), callback);
        });
    });
}

function ensureCycleSpeedShortcut(force = false, callback = () => {}) {
    if (!chrome.commands?.getAll || !chrome.commands?.update) {
        callback({ ok: false, error: 'Este Firefox não permite restaurar atalhos automaticamente.' });
        return;
    }

    chrome.commands.getAll(commands => {
        const command = commands?.find(item => item.name === 'cycle-speed');
        if (!command) {
            callback({ ok: false, error: 'Comando de velocidade não encontrado.' });
            return;
        }
        if (!force && command.shortcut) {
            callback({ ok: true, shortcut: command.shortcut, changed: false });
            return;
        }
        chrome.commands.update({ name: 'cycle-speed', shortcut: DEFAULT_SPEED_SHORTCUT }, () => {
            const error = chrome.runtime.lastError;
            callback(error
                ? { ok: false, error: error.message }
                : { ok: true, shortcut: DEFAULT_SPEED_SHORTCUT, changed: true });
        });
    });
}

function acceptStateFromTab(message, sender, callback) {
    const tab = sender.tab;
    if (!tab?.id || !tab.url?.includes('alura.com.br')) {
        callback(false);
        return;
    }

    chrome.storage.session.get(['controlledTabId'], session => {
        const commit = () => {
            const latestState = { ...message, sourceTabId: tab.id, sourceUrl: tab.url, receivedAt: Date.now() };
            chrome.storage.session.set({ controlledTabId: tab.id, latestState, diagnostic: null });
            callback(true);
        };
        if (message.forceBind || session.controlledTabId === tab.id) {
            commit();
            return;
        }
        if (Number.isInteger(session.controlledTabId)) {
            callback(false);
            return;
        }
        getAluraTabs(tabs => {
            const preferred = AluraFlowCore.chooseControlledTab(tabs);
            if (preferred?.id === tab.id) commit();
            else callback(false);
        });
    });
}

function handleStateUpdate(message, sender) {
    acceptStateFromTab(message, sender, accepted => {
        if (!accepted) return;

        if (message.mode === 'PLAYER') {
            chrome.storage.local.get(['autoMinimizeEnabled'], settings => {
                if (settings.autoMinimizeEnabled !== false) {
                    getCompanionWindow(win => {
                        if (win) chrome.windows.update(win.id, { state: 'minimized' });
                    });
                } else {
                    ensureCompanionWindow(message, false);
                }
            });
            return;
        }

        if (message.mode === 'CONTENT') {
            const isTranscriptReading = message.data?.isVideoTranscript === true || message.data?.loadingReason === 'video-transcription';
            if (!isTranscriptReading) {
                ensureCompanionWindow(message, true);
                return;
            }
            firefoxHasFocusedWindow(firefoxIsActive => {
                // Bring RSVP forward while the user is browsing Firefox, but
                // preserve the foreground application when Firefox is inactive.
                ensureCompanionWindow(message, firefoxIsActive);
            });
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) return false;

    if (message.type === 'UPDATE_STATE') {
        handleStateUpdate(message, sender);
        return false;
    }

    if (message.type === 'COMPANION_READY') {
        chrome.storage.session.get(['latestState'], result => {
            sendResponse(result.latestState || { mode: 'NONE' });
            routeToControlledTab({ type: 'COMPANION_READY' });
        });
        return true;
    }

    if (message.type === 'GET_SESSION_STATUS') {
        chrome.storage.session.get(['controlledTabId', 'latestState', 'diagnostic'], session => {
            getAluraTabs(tabs => sendResponse({
                controlledTabId: session.controlledTabId,
                latestState: session.latestState || null,
                diagnostic: session.diagnostic || null,
                tabs: tabs.map(tab => ({ id: tab.id, title: tab.title, url: tab.url, active: tab.active, lastAccessed: tab.lastAccessed }))
            }));
        });
        return true;
    }

    if (message.type === 'SET_CONTROLLED_TAB') {
        const tabId = Number(message.tabId);
        chrome.tabs.get(tabId, tab => {
            if (chrome.runtime.lastError || !tab?.url?.includes('alura.com.br')) {
                sendResponse({ ok: false, error: 'A aba selecionada não é uma página da Alura.' });
                return;
            }
            chrome.storage.session.set({ controlledTabId: tabId, latestState: null, diagnostic: null }, () => {
                chrome.tabs.sendMessage(tabId, { type: 'COMPANION_READY', forceBind: true });
                sendResponse({ ok: true });
            });
        });
        return true;
    }

    if (message.type === 'OPEN_COMPANION') {
        chrome.storage.session.get(['latestState'], result => ensureCompanionWindow(result.latestState || null, true));
        sendResponse({ ok: true });
        return false;
    }

    if (message.type === 'UPDATE_SPEED') {
        applyPlaybackSpeed(message.speed, sendResponse);
        return true;
    }

    if (message.type === 'CYCLE_SPEED_REQUEST') {
        chrome.storage.local.get(['shortcutsEnabled'], settings => {
            if (settings.shortcutsEnabled === false) {
                sendResponse({ ok: false, error: 'Atalhos desabilitados.' });
                return;
            }
            cyclePlaybackSpeed(sendResponse);
        });
        return true;
    }

    if (message.type === 'REPAIR_SPEED_SHORTCUT') {
        ensureCycleSpeedShortcut(true, sendResponse);
        return true;
    }

    const routedCommands = new Set([
        'COMMAND_PLAY_PAUSE', 'COMMAND_NEXT', 'COMMAND_PREV', 'COMMAND_CYCLE_SPEED',
        'UPDATE_AUTO_ADVANCE', 'SELECT_OPTION', 'FINISH_READING', 'AUTO_FINISH_READING', 'CANCEL_AUTO_ADVANCE',
        'RETRY_VIDEO_TRANSCRIPTION'
    ]);
    if (routedCommands.has(message.type)) {
        routeToControlledTab(message, sendResponse);
        return true;
    }

    if (message.type === 'SPEED_UPDATED') {
        const courseId = message.courseId || null;
        storePlaybackSpeed(message.speed, courseId, stored => {
            if (stored.ok) sendToCompanion({ type: 'SPEED_UPDATED', speed: stored.speed });
        });
        return false;
    }

    if (message.type === 'SELECTOR_DIAGNOSTIC') {
        if (sender.tab?.id) {
            chrome.storage.session.get(['controlledTabId'], session => {
                if (session.controlledTabId === sender.tab.id) chrome.storage.session.set({ diagnostic: message });
            });
        }
        return false;
    }

    if (message.type === 'PREPARE_READING_MODE') {
        // The loading state is already routed to the companion. Do not steal
        // focus from another application merely because a transcript is ready.
        return false;
    }

    if (message.type === 'VIDEO_TRANSCRIPTION_FAILED') {
        sendToCompanion(message);
        return false;
    }

    if (message.type === 'TRANSITION_START') {
        chrome.storage.local.get(['autoMinimizeEnabled'], settings => {
            if (settings.autoMinimizeEnabled !== false && message.predictedMode === 'PLAYER') {
                getCompanionWindow(win => { if (win) chrome.windows.update(win.id, { state: 'minimized' }); });
            } else {
                sendToCompanion(message);
            }
        });
        return false;
    }

    return false;
});

chrome.commands.onCommand.addListener(command => {
    chrome.storage.local.get(['shortcutsEnabled'], settings => {
        if (settings.shortcutsEnabled === false) return;
        if (command === 'cycle-speed') {
            cyclePlaybackSpeed();
            return;
        }
        const commandMap = {
            'next-lesson': 'COMMAND_NEXT',
            'play-pause': 'COMMAND_PLAY_PAUSE'
        };
        const type = commandMap[command];
        if (type) {
            routeToControlledTab({ type });
            if (type === 'COMMAND_PLAY_PAUSE') sendToCompanion({ type });
        }
    });
});

chrome.tabs.onRemoved.addListener(tabId => {
    chrome.storage.session.get(['controlledTabId'], result => {
        if (result.controlledTabId === tabId) chrome.storage.session.remove(['controlledTabId', 'latestState']);
    });
});

chrome.windows.onRemoved.addListener(windowId => {
    chrome.storage.session.get(['companionWindowId'], result => {
        if (result.companionWindowId === windowId) chrome.storage.session.remove('companionWindowId');
    });
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.autoMinimizeEnabled?.newValue === false) {
        getCompanionWindow(win => { if (win?.state === 'minimized') chrome.windows.update(win.id, { state: 'normal' }); });
    }
});

chrome.runtime.onInstalled.addListener(() => {
    const defaults = {
        autoPlayEnabled: true,
        playbackSpeed: 1,
        autoAdvanceEnabled: true,
        autoAdvanceDelay: 5,
        shortcutsEnabled: true,
        autoReadEnabled: true,
        readingMode: 'tts',
        rsvpWpm: 300,
        transcriptRsvpWpm: 300,
        rsvpAfterVideoEnabled: false,
        autoMinimizeEnabled: true,
        ttsRate: 1.15,
        ttsVoiceURI: '',
        perCourseSettings: true,
        progressHistory: []
    };
    chrome.storage.local.get(Object.keys(defaults), current => {
        const missing = {};
        Object.entries(defaults).forEach(([key, value]) => {
            if (current[key] === undefined) missing[key] = value;
        });
        if (current.transcriptRsvpWpm === undefined) missing.transcriptRsvpWpm = Number(current.rsvpWpm) || 300;
        if (Object.keys(missing).length) chrome.storage.local.set(missing);
    });
    ensureCycleSpeedShortcut(false);
});

ensureCycleSpeedShortcut(false);
