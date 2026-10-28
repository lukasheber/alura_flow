// Runs the real reading.html + core.js + reading.js in jsdom with a fake `chrome`,
// a silent speech engine and a controllable clock.
import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { readExtensionFile } from './extension-source.mjs';
import { FakeClock, fakeChrome, quietVirtualConsole } from './fakes.mjs';

function fakeSpeech(window) {
    const synth = {
        spoken: [],
        cancels: 0,
        paused: false,
        speak(utterance) { this.spoken.push(utterance.text); },
        cancel() { this.cancels += 1; this.spoken = []; },
        pause() { this.paused = true; },
        resume() { this.paused = false; },
        getVoices: () => []
    };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    return synth;
}

export async function loadCompanion({ state = { mode: 'NONE' }, storage = {} } = {}) {
    const [html, core, reading] = await Promise.all(['reading.html', 'core.js', 'reading.js'].map(readExtensionFile));
    const errors = [];
    const dom = new JSDOM(html, {
        url: 'https://extension.test/reading.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole: quietVirtualConsole(VirtualConsole, errors)
    });
    const { window } = dom;
    const clock = new FakeClock(window);
    const ext = fakeChrome({ autoReadEnabled: false, autoAdvanceEnabled: false, readingMode: 'tts', ...storage },
        message => message.type === 'COMPANION_READY' ? structuredClone(state) : { ok: true });
    ext.chrome.windows = { getCurrent: callback => callback({ focused: true, state: 'normal' }), onFocusChanged: { addListener() {} } };
    window.chrome = ext.chrome;
    const speech = fakeSpeech(window);
    // jsdom has no layout: innerText falls back to textContent.
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.matchMedia = () => ({ matches: false });
    window.CSS ??= {};
    window.CSS.escape ??= value => String(value).replace(/["\\]/g, '\\$&');

    const context = dom.getInternalVMContext();
    new vm.Script(core, { filename: 'core.js' }).runInContext(context);
    new vm.Script(reading, { filename: 'reading.js' }).runInContext(context);
    await clock.tick(0);
    // reading.js starts on DOMContentLoaded; fire it if jsdom already did before the scripts ran.
    if (!ext.messages('COMPANION_READY').length) window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await clock.tick(0);

    const byId = id => window.document.getElementById(id);
    return {
        window,
        document: window.document,
        byId,
        clock,
        ext,
        speech,
        errors,
        // Presses a key with focus on `target` (the page by default).
        async press(key, target = window.document.body) {
            target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            await clock.tick(0);
        },
        async show(mode, data) {
            ext.dispatch({ type: 'UPDATE_STATE', mode, data });
            await clock.tick(0);
        },
        close: () => window.close()
    };
}
