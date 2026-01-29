// Alura Flow - Background Service Worker
// Manages the single persistent Companion Window.

// Note: companionWindowId variable is removed in favor of chrome.storage.session
// to survive Service Worker restarts.

// --- WINDOW MANAGEMENT ---

// --- WINDOW MANAGEMENT ---
let isCreatingWindow = false;
let creationQueue = [];

function processCreationQueue(win) {
    while (creationQueue.length > 0) {
        const cb = creationQueue.shift();
        if (cb) cb(win);
    }
}

function getCompanionWindow(callback) {
    // 1. Race Lock: If creating, wait.
    if (isCreatingWindow) {
        creationQueue.push(callback);
        return;
    }

    chrome.storage.session.get(['companionWindowId'], (result) => {
        const id = result.companionWindowId;
        if (id) {
            chrome.windows.get(id, (win) => {
                if (chrome.runtime.lastError || !win) {
                    // Window ID stale, try finding by matching URL/Type to handle reload orphans
                    findOrphanedWindow((orphan) => {
                        if (orphan) {
                            chrome.storage.session.set({ companionWindowId: orphan.id });
                            callback(orphan);
                        } else {
                            chrome.storage.session.remove('companionWindowId');
                            callback(null);
                        }
                    });
                } else {
                    callback(win);
                }
            });
        } else {
            // No ID, but maybe an orphan exists?
            findOrphanedWindow((orphan) => {
                if (orphan) {
                    chrome.storage.session.set({ companionWindowId: orphan.id });
                    callback(orphan);
                } else {
                    callback(null);
                }
            });
        }
    });
}

function findOrphanedWindow(cb) {
    // Removed specific windowTypes filter to be broader
    // NEED "tabs" permission for this to see URLs of other windows effectively? Yes.
    chrome.windows.getAll({ populate: true }, (wins) => {
        const found = wins.find(w => w.tabs && w.tabs.some(t => t.url && t.url.includes('reading.html')));
        cb(found || null);
    });
}

function createCompanionWindow(initialState = null) {
    if (isCreatingWindow) return; // Should be handled by getCompanionWindow guard, but safety check.
    isCreatingWindow = true;

    chrome.windows.create({
        url: 'reading.html',
        type: 'popup',
        width: 500,
        height: 600,
        focused: true
    }, (win) => {
        const id = win.id;
        console.log("Companion Window Created:", id);
        chrome.storage.session.set({ companionWindowId: id });

        // Unlock
        isCreatingWindow = false;
        processCreationQueue(win);

        // If we have initial state, send it after a short delay to ensure load
        if (initialState) {
            setTimeout(() => {
                chrome.tabs.query({ windowId: id }, (tabs) => {
                    if (tabs && tabs.length > 0) chrome.tabs.sendMessage(tabs[0].id, initialState);
                });
            }, 1000);
        }
    });
}

function ensureCompanionWindow(stateMsg, shouldFocus = false) {
    getCompanionWindow((win) => {
        if (win) {
            // Update Existing
            console.log("Updating Companion Window...", stateMsg);
            chrome.tabs.query({ windowId: win.id }, (tabs) => {
                if (tabs && tabs.length > 0) {
                    chrome.tabs.sendMessage(tabs[0].id, stateMsg);
                }
            });

            if (shouldFocus) {
                chrome.windows.update(win.id, { focused: true, drawAttention: true });
            }
        } else {
            // Create New
            console.log("Creating Companion Window for state...", stateMsg);
            createCompanionWindow(stateMsg);
        }
    });
}

// --- MESSAGE HANDLING ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 1. STATE UPDATES (From Content Script)
    // 1. STATE UPDATES (From Content Script)
    if (message.type === 'UPDATE_STATE') {
        if (message.mode === 'PLAYER') {
            chrome.storage.local.get(['autoMinimizeEnabled'], (result) => {
                if (result.autoMinimizeEnabled) {
                    getCompanionWindow((win) => {
                        if (win) chrome.windows.update(win.id, { state: 'minimized' });
                    });
                } else {
                    // Update content but don't force focus, ensure it's normal (not minimized)
                    getCompanionWindow((win) => {
                        if (win) {
                            if (win.state === 'minimized') {
                                chrome.windows.update(win.id, { state: 'normal', drawAttention: false });
                            }
                            // Send data
                            chrome.tabs.query({ windowId: win.id }, (tabs) => {
                                if (tabs && tabs.length > 0) chrome.tabs.sendMessage(tabs[0].id, message);
                            });
                        } else {
                            // Regression Fix: If window is missing in PLAYER mode (and we aren't minimizing), create it!
                            createCompanionWindow(message);
                        }
                    });
                }
            });
        }
        else if (message.mode === 'CONTENT') {
            // Force open/restore for Reading/Quiz
            getCompanionWindow((win) => {
                if (win) {
                    console.log("Restoring Companion Window for Content...");
                    // Force Normal State + Focus
                    chrome.windows.update(win.id, { state: 'normal', focused: true, drawAttention: true });
                    // Send Data
                    chrome.tabs.query({ windowId: win.id }, (tabs) => {
                        if (tabs && tabs.length > 0) chrome.tabs.sendMessage(tabs[0].id, message);
                    });
                } else {
                    createCompanionWindow(message);
                }
            });
        }
    }

    // 2. PREPARE READING (Video Ended)
    if (message.type === 'PREPARE_READING_MODE') {
        // Just ensure it's open and maybe focused slightly
        getCompanionWindow((win) => {
            if (win) {
                chrome.storage.session.get(['companionWindowId'], (res) => {
                    if (res.companionWindowId) chrome.windows.update(res.companionWindowId, { focused: true });
                });
            }
        });
    }

    // 3. COMPANION REQUESTS (From Companion Window)
    if (message.type === 'COMPANION_READY') {
        // The window just opened and wants state.
        // We'll ask the active tab to re-report.
        chrome.tabs.query({ active: true, currentWindow: false }, (tabs) => {
            // Find Alura tab
            const aluraTab = tabs.find(t => t.url && t.url.includes('alura.com.br'));
            if (aluraTab) {
                chrome.tabs.sendMessage(aluraTab.id, { type: 'COMPANION_READY' });
            } else {
                // Try all tabs
                chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (aluraTabs) => {
                    if (aluraTabs && aluraTabs.length > 0) {
                        chrome.tabs.sendMessage(aluraTabs[0].id, { type: 'COMPANION_READY' });
                    }
                });
            }
        });
        sendResponse({ mode: 'NONE' }); // Async response placeholder
    }

    // 4. ROUTING (Video Controls, Quiz Selection, etc)
    // These specific messages need to go TO the Content Script FROM the Companion
    const routeToContent = [
        'COMMAND_PLAY_PAUSE',
        'COMMAND_NEXT',
        'COMMAND_PREV',
        'UPDATE_SPEED',
        'SELECT_OPTION',
        'FINISH_READING'
    ];

    if (routeToContent.includes(message.type)) {
        sendToActiveAluraTab(message);
    }
});

function sendToActiveAluraTab(payload) {
    chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (tabs) => {
        // Prioritize last focused
        let target = tabs.find(t => t.active && t.lastAccessed);
        if (!target && tabs.length > 0) target = tabs[0];

        if (target) {
            chrome.tabs.sendMessage(target.id, payload);
        }
    });
}

// --- KEYBOARD SHORTCUTS ---
chrome.commands.onCommand.addListener((command) => {
    let msgType = '';
    if (command === 'next-lesson') msgType = 'COMMAND_NEXT';
    if (command === 'play-pause') msgType = 'COMMAND_PLAY_PAUSE';
    if (command === 'cycle-speed') msgType = 'COMMAND_CYCLE_SPEED';

    if (msgType) {
        // Send to BOTH (Companion might need to update UI, but mainly Content handles logic)
        sendToActiveAluraTab({ type: msgType });

        if (msgType === 'COMMAND_PLAY_PAUSE' || msgType === 'COMMAND_CYCLE_SPEED') {
            getCompanionWindow((win) => {
                if (win) {
                    chrome.tabs.query({ windowId: win.id }, (tabs) => {
                        if (tabs && tabs.length > 0) {
                            chrome.tabs.sendMessage(tabs[0].id, { type: msgType });
                        }
                    });
                }
            });
        }
    }
});

// 5. TRANSITION HANDLING
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRANSITION_START') {
        const predictedMode = message.predictedMode;

        chrome.storage.local.get(['autoMinimizeEnabled'], (res) => {
            if (res.autoMinimizeEnabled && predictedMode === 'PLAYER') {
                // Optimistic Minimize!
                getCompanionWindow((win) => {
                    if (win) {
                        console.log("Smart Transition: Optimistically Minimizing...");
                        chrome.windows.update(win.id, { state: 'minimized' });
                    }
                });
            } else {
                // Forward to Companion to show "Loading..."
                getCompanionWindow((win) => {
                    if (win) {
                        chrome.tabs.query({ windowId: win.id }, (tabs) => {
                            if (tabs && tabs.length > 0) chrome.tabs.sendMessage(tabs[0].id, message);
                        });
                    }
                });
            }
        });
    }
});

// 6. INSTALLATION / UPDATE
// 6. INSTALLATION / UPDATE
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // Only set defaults if not present (preserve settings on reload/update)
        chrome.storage.local.get(['playbackSpeed', 'autoAdvanceEnabled', 'shortcutsEnabled', 'autoReadEnabled', 'autoMinimizeEnabled'], (current) => {
            const defaults = {
                playbackSpeed: 1.0,
                autoAdvanceEnabled: true,
                shortcutsEnabled: true,
                autoReadEnabled: true,
                autoMinimizeEnabled: true
            };

            const toSet = {};
            for (const key in defaults) {
                if (current[key] === undefined) {
                    toSet[key] = defaults[key];
                }
            }

            if (Object.keys(toSet).length > 0) {
                chrome.storage.local.set(toSet);
                console.log("Alura Flow: Default settings applied (missing keys only).");
            }
        });
    }
});
