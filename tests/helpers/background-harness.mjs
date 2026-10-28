// Runs the real core.js + background.js in a VM with an in-memory `chrome` API.
import vm from 'node:vm';
import { readExtensionFile } from './extension-source.mjs';
import { taskUrl } from './content-harness.mjs';

export async function loadBackground({ local = {}, session = {}, tabs = [{ id: 7, url: taskUrl(101), title: 'Aula', active: true }] } = {}) {
    const stores = { local: structuredClone(local), session: structuredClone(session) };
    const listeners = {};
    const tabMessages = [];
    const event = name => ({ addListener: listener => { listeners[name] = listener; } });
    const area = name => ({
        get(keys, callback) {
            const result = {};
            [].concat(keys ?? Object.keys(stores[name])).forEach(key => { if (key in stores[name]) result[key] = structuredClone(stores[name][key]); });
            callback?.(result);
        },
        set(values, callback) { Object.assign(stores[name], structuredClone(values)); callback?.(); },
        remove(keys, callback) { [].concat(keys).forEach(key => delete stores[name][key]); callback?.(); }
    });
    const chrome = {
        runtime: {
            getURL: file => `moz-extension://test/${file}`,
            sendMessage: (_message, callback) => callback?.(),
            onMessage: event('message'),
            onInstalled: event('installed')
        },
        storage: { local: area('local'), session: area('session'), onChanged: event('storage') },
        tabs: {
            query: (_query, callback) => callback(tabs),
            get: (id, callback) => callback(tabs.find(tab => tab.id === id)),
            sendMessage: (tabId, message, callback) => { tabMessages.push({ tabId, message: structuredClone(message) }); callback?.({ ok: true }); },
            onRemoved: event('tabRemoved')
        },
        windows: {
            getAll: (_options, callback) => callback([]),
            get: (_id, _options, callback) => callback(null),
            create: (_options, callback) => callback({ id: 1, tabs: [] }),
            update: () => {},
            onRemoved: event('windowRemoved')
        },
        commands: {
            getAll: callback => callback([{ name: 'cycle-speed', shortcut: 'Ctrl+Alt+S' }]),
            update: (_details, callback) => callback?.(),
            onCommand: event('command')
        }
    };
    const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, URL });
    for (const name of ['core.js', 'background.js']) {
        new vm.Script(await readExtensionFile(name), { filename: name }).runInContext(context);
    }
    return {
        stores,
        tabMessages,
        // Sends a runtime message and resolves with the response, if any.
        send(message, sender = {}) {
            return new Promise(resolve => {
                const keepsChannelOpen = listeners.message(message, sender, resolve);
                if (keepsChannelOpen !== true) setImmediate(() => resolve(undefined));
            });
        }
    };
}
