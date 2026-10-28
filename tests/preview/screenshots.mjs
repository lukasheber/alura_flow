// Renders the companion and popup in every user-visible state, in light and dark,
// with a fake extension API. Output: tests/preview/output/*.png (gitignored).
//
//   npm run screenshots
import { Builder, Browser } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUT = path.join(ROOT, 'tests', 'preview', 'output');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const LESSON = { lessonId: '101', courseId: 'financas', language: 'pt-BR', url: 'https://cursos.alura.com.br/course/financas/task/101' };
const TEXT_HTML = `
<h2>Por que montar um orçamento?</h2>
<p>Um orçamento mostra para onde vai cada real que entra. Com ele, fica mais fácil separar o que é essencial do que pode esperar.</p>
<ul><li>Liste todas as receitas do mês.</li><li>Agrupe as despesas fixas e variáveis.</li><li>Defina uma meta de economia.</li></ul>
<blockquote>Pequenos ajustes, repetidos todo mês, fazem mais diferença do que grandes cortes pontuais.</blockquote>
<p>Para conferir o saldo, use <code>receitas - despesas</code>:</p>
<pre><code>const saldo = receitas - despesas;
console.log(\`Sobrou: R$ \${saldo}\`);</code></pre>
<p>Revise o orçamento ao fim de cada mês e ajuste as categorias que fugiram do planejado.</p>`;
const QUIZ = {
    ...LESSON, title: 'Estratégias de controle financeiro', isQuiz: true, isMultiple: false, requiredChoices: 0,
    questionHTML: '<p>João começou a anotar os gastos e percebeu que gasta mais do que ganha. Qual deve ser o primeiro passo?</p>',
    instructionHTML: 'Selecione uma alternativa'
};
const QUIZ_OPTIONS = [
    'Buscar um empréstimo para cobrir o déficit.',
    'Focar em aumentar suas receitas variáveis.',
    'Revisar as despesas variáveis e cortar o que não é essencial.',
    'Classificar as despesas em mais categorias.'
];
const BASE_STORAGE = { autoReadEnabled: false, readingMode: 'tts', rsvpWpm: 300, playbackSpeed: 1.5, progressHistory: [
    { lessonId: '100', title: 'Apresentação', completedAt: 1 }, { lessonId: '101', title: 'Planejamento financeiro' }
] };
const keydown = key => `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));`;

const COMPANION = [
    { name: 'empty', state: { mode: 'NONE' } },
    { name: 'loading', state: { mode: 'CONTENT', data: { ...LESSON, title: 'Carregando próxima aula…', isLoading: true, status: 'loading' } } },
    { name: 'player', state: { mode: 'PLAYER', data: { ...LESSON, title: 'Como planejar o seu mês', status: 'playing' } } },
    { name: 'text', state: { mode: 'CONTENT', data: { ...LESSON, title: 'Planejamento financeiro e orçamento pessoal', isQuiz: false, html: TEXT_HTML } } },
    {
        name: 'text-speaking', state: { mode: 'CONTENT', data: { ...LESSON, title: 'Planejamento financeiro e orçamento pessoal', isQuiz: false, html: TEXT_HTML } },
        actions: ["document.getElementById('ttsBtnTop').click();"]
    },
    {
        name: 'rsvp', storage: { readingMode: 'rsvp' },
        state: { mode: 'CONTENT', data: { ...LESSON, title: 'Planejamento financeiro e orçamento pessoal', isQuiz: false, html: TEXT_HTML } },
        actions: [keydown('ArrowRight'), keydown('ArrowRight')]
    },
    {
        name: 'quiz', state: { mode: 'CONTENT', data: { ...QUIZ, isSolved: false, options: QUIZ_OPTIONS.map((html, index) => ({ id: String(index), html, isSelected: false, isCorrect: false, isIncorrect: false })) } }
    },
    {
        name: 'quiz-answered',
        state: { mode: 'CONTENT', data: { ...QUIZ, isSolved: true, options: QUIZ_OPTIONS.map((html, index) => ({ id: String(index), html, isSelected: index === 1 || index === 2, isCorrect: index === 2, isIncorrect: index === 1 })) } },
        actions: ["window.__dispatch({ type: 'AUTO_ADVANCE_COUNTDOWN', reason: 'quiz', remaining: 4 });"]
    }
];
const SESSION = {
    controlledTabId: 7,
    tabs: [{ id: 7, title: 'Planejamento financeiro | Alura', url: LESSON.url, active: true }],
    latestState: { mode: 'CONTENT', data: { ...LESSON, title: 'Planejamento financeiro e orçamento pessoal' } }
};
const POPUP = [
    { name: 'popup', storage: { autoAdvanceEnabled: true, autoAdvanceDelay: 5, autoPlayEnabled: true, mediaKeysEnabled: true, shortcutsEnabled: true, perCourseSettings: true, autoReadEnabled: true, rsvpAfterVideoEnabled: true, transcriptRsvpWpm: 350, ttsRate: 1.15 } },
    {
        name: 'popup-all-open', storage: { autoAdvanceEnabled: true, mediaKeysEnabled: true, shortcutsEnabled: true, readingMode: 'rsvp' },
        actions: ["document.querySelectorAll('details').forEach(section => { section.open = true; });"]
    }
];

function stub(state, storage) {
    return `<script>
(() => {
    const stored = ${JSON.stringify(storage)};
    const listeners = [];
    window.__dispatch = message => listeners.forEach(listener => listener(message, {}, () => {}));
    window.chrome = {
        runtime: {
            sendMessage(message, callback) {
                const response = message.type === 'COMPANION_READY' ? ${JSON.stringify(state)}
                    : message.type === 'GET_SESSION_STATUS' ? ${JSON.stringify(SESSION)} : { ok: true, shortcut: 'Ctrl+Alt+S' };
                setTimeout(() => callback && callback(response), 0);
            },
            onMessage: { addListener: listener => listeners.push(listener) }
        },
        storage: {
            local: {
                get(keys, callback) { const result = {}; [].concat(keys).forEach(key => { if (key in stored) result[key] = stored[key]; }); callback(result); },
                set(values, callback) { Object.assign(stored, values); callback && callback(); }
            },
            onChanged: { addListener() {} }
        },
        commands: { getAll(callback) { callback([{ name: 'cycle-speed', shortcut: 'Ctrl+Alt+S' }]); } },
        windows: { getCurrent(callback) { callback({ focused: true, state: 'normal' }); }, onFocusChanged: { addListener() {} } }
    };
    // Silent speech: highlights the first block as if it were being read.
    const synth = { paused: false, queue: [], getVoices: () => [], addEventListener() {},
        speak(utterance) { this.queue.push(utterance); if (this.queue.length === 1) setTimeout(() => utterance.onstart && utterance.onstart(), 0); },
        cancel() { this.queue = []; }, pause() { this.paused = true; }, resume() { this.paused = false; } };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
})();
</script>`;
}

async function writePreview(page, scenario) {
    const source = await readFile(path.join(ROOT, page), 'utf8');
    const absolute = name => pathToFileURL(path.join(ROOT, name)).href;
    const firstScript = source.indexOf('<script src=');
    const html = `${source.slice(0, firstScript)}${stub(scenario.state || {}, { ...BASE_STORAGE, ...scenario.storage })}\n${source.slice(firstScript)}`
        .replace(/<script src="([\w.]+)"><\/script>/g, (_, name) => `<script src="${absolute(name)}"></script>`)
        // Show the whole popup instead of Firefox's 600 px popup viewport.
        .replace('</style>', page === 'popup.html' ? 'body { max-height: none; }</style>' : '</style>');
    const file = path.join(OUTPUT, `${scenario.name}.html`);
    await writeFile(file, html);
    return pathToFileURL(file).href;
}

async function capture(scheme) {
    const options = new firefox.Options().addArguments('-headless')
        .setPreference('layout.css.prefers-color-scheme.content-override', scheme === 'dark' ? 0 : 1);
    const driver = await new Builder().forBrowser(Browser.FIREFOX).setFirefoxOptions(options).build();
    try {
        const shots = [...COMPANION.map(item => ({ ...item, page: 'reading.html', size: [520, 680] })),
            ...POPUP.map(item => ({ ...item, page: 'popup.html', size: [384, item.name === 'popup' ? 760 : 1500] }))];
        for (const shot of shots) {
            await driver.manage().window().setRect({ width: shot.size[0], height: shot.size[1] });
            await driver.get(await writePreview(shot.page, shot));
            await sleep(700);
            for (const action of shot.actions || []) {
                await driver.executeScript(action);
                await sleep(250);
            }
            await sleep(300);
            const file = path.join(OUTPUT, `${scheme}-${shot.name}.png`);
            await writeFile(file, await driver.takeScreenshot(), 'base64');
            console.log(file);
        }
    } finally {
        await driver.quit();
    }
}

await mkdir(OUTPUT, { recursive: true });
for (const scheme of ['light', 'dark']) await capture(scheme);
