// Runs the real core.js + content.js inside a jsdom page with a fake `chrome`
// API and a controllable clock, so tests can drive lessons deterministically.
import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { readExtensionFile } from './extension-source.mjs';
import { FakeClock, fakeChrome, quietVirtualConsole } from './fakes.mjs';

export const taskUrl = (id, course = 'javascript') => `https://cursos.alura.com.br/course/${course}/task/${id}`;

// jsdom has no media playback: model just enough of it for content.js.
function fakeMediaPlayback(window) {
    const proto = window.HTMLMediaElement.prototype;
    Object.defineProperty(proto, 'paused', { configurable: true, get() { return this._testPaused !== false; } });
    proto.play = function () {
        this._testPaused = false;
        this.dispatchEvent(new window.Event('play'));
        return Promise.resolve();
    };
    proto.pause = function () {
        this._testPaused = true;
        this.dispatchEvent(new window.Event('pause'));
    };
}

export async function loadLesson(bodyHtml, { url = taskUrl(101), storage = {} } = {}) {
    const errors = [];
    const dom = new JSDOM(`<!DOCTYPE html><html lang="pt-BR"><head><title>Aula</title></head><body>${bodyHtml}</body></html>`, {
        url,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole: quietVirtualConsole(VirtualConsole, errors)
    });
    const { window } = dom;
    const clock = new FakeClock(window);
    const ext = fakeChrome({ autoAdvanceEnabled: false, autoAdvanceDelay: 0, ...storage });
    const mediaHandlers = {};
    Object.defineProperty(window.navigator, 'mediaSession', {
        configurable: true,
        value: { setActionHandler(action, handler) { mediaHandlers[action] = handler; } }
    });
    window.CSS ??= {};
    window.CSS.escape ??= value => String(value).replace(/["\\]/g, '\\$&');
    window.chrome = ext.chrome;
    fakeMediaPlayback(window);

    const context = dom.getInternalVMContext();
    for (const name of ['core.js', 'content.js']) {
        new vm.Script(await readExtensionFile(name), { filename: name }).runInContext(context);
    }
    await clock.tick(0);

    return {
        window,
        document: window.document,
        clock,
        ext,
        errors,
        mediaHandlers,
        // Evaluates an expression inside the page, where content.js's functions live.
        run: code => new vm.Script(code).runInContext(context),
        // Advances past content.js's initial 300 ms report.
        settle: () => clock.tick(300),
        lastState: () => ext.messages('UPDATE_STATE').at(-1),
        close: () => window.close()
    };
}
