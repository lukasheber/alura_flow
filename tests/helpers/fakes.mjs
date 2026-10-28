// Fakes shared by the page harnesses: a controllable clock and an in-memory `chrome`.

export const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve));

export class FakeClock {
    constructor(window) {
        this.now = 1_700_000_000_000;
        this.timers = new Map();
        this.nextId = 1;
        const add = (repeat) => (callback, delay = 0, ...args) => {
            const id = this.nextId++;
            const interval = Math.max(0, Number(delay) || 0);
            this.timers.set(id, { callback, args, repeat, interval, at: this.now + interval });
            return id;
        };
        window.setTimeout = add(false);
        window.setInterval = add(true);
        window.clearTimeout = window.clearInterval = id => { this.timers.delete(id); };
        window.Date.now = () => this.now;
    }

    // Advances time, firing due timers in order and letting promises and
    // MutationObserver callbacks settle between them.
    async tick(milliseconds = 0) {
        const end = this.now + milliseconds;
        for (;;) {
            await flushMicrotasks();
            let nextId = null;
            let next = null;
            for (const [id, timer] of this.timers) {
                if (timer.at <= end && (!next || timer.at < next.at)) { nextId = id; next = timer; }
            }
            if (!next) break;
            this.now = Math.max(this.now, next.at);
            if (next.repeat) next.at += Math.max(1, next.interval);
            else this.timers.delete(nextId);
            next.callback(...next.args);
        }
        this.now = end;
        await flushMicrotasks();
    }
}

// `respond` answers runtime messages, as the background script would.
export function fakeChrome(initialStorage, respond = () => ({})) {
    const local = structuredClone(initialStorage);
    const sent = [];
    const messageListeners = [];
    const storageListeners = [];
    const chrome = {
        runtime: {
            sendMessage(message, callback) {
                // Clone into this realm so assert.deepEqual can compare it.
                sent.push(structuredClone(message));
                callback?.(respond(message) ?? {});
            },
            onMessage: { addListener: listener => messageListeners.push(listener) }
        },
        storage: {
            local: {
                get(keys, callback) {
                    const result = {};
                    [].concat(keys).forEach(key => { if (key in local) result[key] = structuredClone(local[key]); });
                    callback(result);
                },
                set(values, callback) {
                    const changes = {};
                    Object.entries(values).forEach(([key, value]) => {
                        changes[key] = { oldValue: local[key], newValue: value };
                        local[key] = value;
                    });
                    storageListeners.forEach(listener => listener(changes, 'local'));
                    callback?.();
                }
            },
            session: { get: (_keys, callback) => callback?.({}), set: (_values, callback) => callback?.() },
            onChanged: { addListener: listener => storageListeners.push(listener) }
        }
    };
    return {
        chrome,
        local,
        sent,
        messages: type => sent.filter(message => message.type === type),
        // Delivers a message as the background script would and returns the response.
        dispatch(message) {
            let response;
            messageListeners.forEach(listener => listener(message, {}, value => { response = value; }));
            return response;
        }
    };
}

export function quietVirtualConsole(VirtualConsole, errors) {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => {
        if (!/not implemented/i.test(error.message)) errors.push(error);
    });
    return virtualConsole;
}
