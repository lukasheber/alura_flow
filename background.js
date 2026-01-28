// Background Service Worker
chrome.commands.onCommand.addListener((command) => {
    console.log(`Command received: ${command}`);

    let msgType = '';
    if (command === 'next-lesson') msgType = 'COMMAND_NEXT';
    if (command === 'play-pause') msgType = 'COMMAND_PLAY_PAUSE';
    if (command === 'cycle-speed') msgType = 'COMMAND_CYCLE_SPEED';

    if (!msgType) return;

    // 1. Try sending to Reading Window (Popup) first
    if (readingWindowId !== null) {
        chrome.windows.get(readingWindowId, (win) => {
            if (chrome.runtime.lastError || !win) {
                // Window closed/invalid
                readingWindowId = null;
                sendToActiveTab(msgType);
            } else {
                // Window exists, send to its tabs
                chrome.tabs.query({ windowId: readingWindowId }, (tabs) => {
                    if (tabs && tabs.length > 0) {
                        chrome.tabs.sendMessage(tabs[0].id, { type: msgType });
                        console.log("Command routed to Reading Popup");
                    }
                });
            }
        });
    } else {
        // 2. Fallback to Active Tab
        sendToActiveTab(msgType);
    }
});

function sendToActiveTab(msgType) {
    chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (tabs) => {
        if (tabs && tabs.length > 0) {
            let targetTab = tabs.find(t => t.active && t.lastAccessed);
            if (!targetTab) targetTab = tabs[0];

            if (targetTab) {
                chrome.tabs.sendMessage(targetTab.id, { type: msgType });
                console.log("Command routed to Alura Tab");
            }
        }
    });
}

// Listener for Window Management (Restored)
let quizWindowId = null;
let readingWindowId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // QUIZ
    if (message.type === 'OPEN_QUIZ_WINDOW') {
        if (quizWindowId !== null) {
            chrome.windows.get(quizWindowId, (win) => {
                if (win) {
                    chrome.windows.update(quizWindowId, { focused: true });
                } else {
                    createQuizWindow();
                }
            });
        } else {
            createQuizWindow();
        }
    }

    if (message.type === 'CLOSE_QUIZ_WINDOW') {
        if (quizWindowId !== null) {
            chrome.windows.remove(quizWindowId, () => {
                if (chrome.runtime.lastError) console.log("Window already closed");
                quizWindowId = null;
            });
        }
    }

    // READING
    if (message.type === 'OPEN_READING_WINDOW') {
        if (readingWindowId !== null) {
            chrome.windows.get(readingWindowId, (win) => {
                if (win) {
                    chrome.windows.update(readingWindowId, { focused: true });
                } else {
                    createReadingWindow();
                }
            });
        } else {
            createReadingWindow();
        }
    }
});

function createQuizWindow() {
    chrome.windows.create({
        url: 'quiz.html',
        type: 'popup',
        width: 500,
        height: 600,
        focused: true
    }, (win) => {
        quizWindowId = win.id;
    });
}

function createReadingWindow() {
    chrome.windows.create({
        url: 'reading.html',
        type: 'popup',
        width: 500,
        height: 600,
        focused: true
    }, (win) => {
        readingWindowId = win.id;
    });
}
