// Minimal page-level fallback for Firefox shortcuts intercepted by websites.
'use strict';

let shortcutsEnabled = false;
chrome.storage.local.get(['shortcutsEnabled'], settings => {
    shortcutsEnabled = settings.shortcutsEnabled !== false;
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shortcutsEnabled) {
        shortcutsEnabled = changes.shortcutsEnabled.newValue !== false;
    }
});

window.addEventListener('keydown', event => {
    if (!shortcutsEnabled || event.repeat || event.metaKey || event.shiftKey) return;
    const isSpeedShortcut = event.ctrlKey && event.altKey &&
        (event.code === 'KeyS' || String(event.key).toLowerCase() === 's');
    if (!isSpeedShortcut) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    chrome.runtime.sendMessage({ type: 'CYCLE_SPEED_REQUEST' });
}, true);
