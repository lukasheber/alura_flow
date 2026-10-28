// Loads the extension's own scripts so tests can run the real detection code
// against fixtures (jsdom) or the live Alura site (Selenium).
import { readFile } from 'node:fs/promises';

export const ROOT = new URL('../../', import.meta.url);

export function readExtensionFile(name) {
    return readFile(new URL(name, ROOT), 'utf8');
}

// A `chrome` stub whose storage never answers keeps content.js from starting
// its observers, autoplay and timers: only its helper functions get defined.
const INERT_CHROME = `
const chrome = {
    runtime: { sendMessage() {}, onMessage: { addListener() {} } },
    storage: {
        local: { get() {}, set() {} },
        session: { get() {}, set() {} },
        onChanged: { addListener() {} }
    }
};
`;

// Builds a WebDriver script body that defines core.js + content.js inside the
// page and returns `probe()` evaluated in that scope. `probe` must only read
// the DOM: it runs on the user's real lesson pages.
export async function pageProbeScript(probe) {
    const [core, content] = await Promise.all([readExtensionFile('core.js'), readExtensionFile('content.js')]);
    return `${INERT_CHROME}\n${core}\n${content}\nreturn (${probe.toString()})(...arguments);`;
}
