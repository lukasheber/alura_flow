document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('speedSlider');
    const display = document.getElementById('speedValue');

    // Default speed
    let currentSpeed = 1.0;

    // Load saved settings
    chrome.storage.local.get(['playbackSpeed', 'autoAdvanceEnabled', 'shortcutsEnabled', 'autoReadEnabled'], (result) => {
        if (result.playbackSpeed) {
            currentSpeed = result.playbackSpeed;
            updateUI(currentSpeed);
        }

        // Default to true if not set
        if (result.autoAdvanceEnabled !== undefined) {
            const toggle = document.getElementById('autoAdvanceToggle');
            if (toggle) toggle.checked = result.autoAdvanceEnabled;
        }

        if (result.shortcutsEnabled !== undefined) {
            console.log("Popup: Loaded shortcuts preference:", result.shortcutsEnabled);
            const sToggle = document.getElementById('shortcutsToggle');
            if (sToggle) sToggle.checked = result.shortcutsEnabled;
        } else {
            console.log("Popup: shortcutsEnabled is undefined in storage.");
        }

        // Auto Read Toggle
        if (result.autoReadEnabled !== undefined) {
            const arToggle = document.getElementById('autoReadToggle');
            if (arToggle) arToggle.checked = result.autoReadEnabled;
        }
    });

    // Listen for slider changes
    slider.addEventListener('input', (e) => {
        currentSpeed = parseFloat(e.target.value);
        updateUI(currentSpeed);
        saveAndApplySpeed(currentSpeed);
    });

    function updateUI(speed) {
        slider.value = speed;
        display.textContent = speed + 'x';
    }

    function saveAndApplySpeed(speed) {
        // Save to storage (for future page loads)
        chrome.storage.local.set({ playbackSpeed: speed });

        // Send message to active tab to update immediately (if it's an Alura page)
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('alura.com.br')) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_SPEED', speed: speed });
            }
        });
    }

    // Listen for auto-advance toggle
    const toggle = document.getElementById('autoAdvanceToggle');
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            chrome.storage.local.set({ autoAdvanceEnabled: isEnabled });
            // Notify active tab
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('alura.com.br')) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_AUTO_ADVANCE', enabled: isEnabled });
                }
            });
        });
    }

    // Listen for Shortcuts toggle
    const sToggle = document.getElementById('shortcutsToggle');
    if (sToggle) {
        sToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            console.log("Popup: Saving shortcuts preference:", isEnabled);
            chrome.storage.local.set({ shortcutsEnabled: isEnabled }, () => {
                console.log("Popup: Saved.");
            });

            // Notify active tab
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('alura.com.br')) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_SHORTCUTS', enabled: isEnabled });
                }
            });
        });
    }

    // Listener para o novo Toggle Auto Read
    const arToggle = document.getElementById('autoReadToggle');
    if (arToggle) {
        arToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            chrome.storage.local.set({ autoReadEnabled: isEnabled });
            console.log("Auto-Read toggled:", isEnabled);
        });
    }
});
