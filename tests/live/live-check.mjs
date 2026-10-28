// Live smoke test of Alura Flow against the real Alura site.
//
//   npm run live:login [-- <alura url>]       open the test profile and wait for you to sign in
//   npm run live:discover [-- <alura url>]    list the course and lesson links on your dashboard
//   npm run live:check -- <task-url> [...]    load the extension and probe those lessons
//       --earlier     also probe the lessons before the first one in its sidebar section
//                     (never later ones, so nothing you haven't reached gets opened)
//       --completed   also probe the lessons of sidebar sections marked fully done (e.g. "7/7")
//       --transcript  on one video of a completed section, enable "read the transcript",
//                     jump to the last seconds and check the RSVP review replaces Alura's
//                     own auto-advance
//       --limit N     probe at most N lessons in total (default 8)
//       --media-keys  on the first video lesson, press "previous track" like a hardware key
//                     would (same handler as "next track", but only lands on a lesson you
//                     have already seen)
//
// Company portals work too: pass a URL on their host (e.g. https://empresa.alura.com.br/...)
// or set ALURA_ORIGIN.
//
// A dedicated Firefox profile (ALURA_FLOW_PROFILE, default ~/.alura-flow-live-profile)
// keeps your everyday profile untouched. Auto-advance and auto-read are turned off
// inside that profile so the run never moves through a course by itself.
// Reports and page snapshots go to tests/live/output/ (gitignored: they contain
// your account's pages).
import { Builder, Browser } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageProbeScript } from '../helpers/extension-source.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUT = path.join(ROOT, 'tests', 'live', 'output');
const PROFILE = process.env.ALURA_FLOW_PROFILE || path.join(os.homedir(), '.alura-flow-live-profile');
const STAGING = path.join(os.tmpdir(), 'alura-flow-live-extension');
const ADDON_ID = 'aluraflow@aluraflow.com';
const ADDON_UUID = '6f0c1d2e-7a54-4b8e-9c3d-a1f10f1a0e01';
const EXTENSION_BASE = `moz-extension://${ADDON_UUID}`;
const COMPANION_URL = `${EXTENSION_BASE}/reading.html`;
const ORIGIN = process.env.ALURA_ORIGIN || 'https://cursos.alura.com.br';
const NOT_EXTENSION = new Set(['.git', 'node_modules', 'tests', 'web-ext-artifacts', 'package.json', 'package-lock.json', 'web-ext-config.mjs', '.gitignore']);
const TEST_SETTINGS = {
    autoAdvanceEnabled: false,
    autoReadEnabled: false,
    autoMinimizeEnabled: false,
    autoPlayEnabled: true,
    playbackSpeed: 1.5,
    perCourseSettings: false,
    rsvpAfterVideoEnabled: false
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
    const [command = 'check', ...rest] = argv;
    const options = { command, urls: [], earlier: false, completed: false, transcript: false, limit: 8, mediaKeys: false };
    for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index];
        if (arg === '--earlier') options.earlier = true;
        else if (arg === '--completed') options.completed = true;
        else if (arg === '--transcript') options.transcript = true;
        else if (arg === '--media-keys') options.mediaKeys = true;
        else if (arg === '--limit') options.limit = Number(rest[++index]) || options.limit;
        else options.urls.push(arg);
    }
    return options;
}

async function prepareProfile() {
    await mkdir(PROFILE, { recursive: true });
    const prefs = {
        'extensions.webextensions.uuids': JSON.stringify({ [ADDON_ID]: ADDON_UUID }),
        'media.autoplay.default': 0,
        // Keep runs quiet while still letting Firefox treat the video as audible.
        'media.volume_scale': '0.02',
        'browser.shell.checkDefaultBrowser': false,
        'browser.aboutwelcome.enabled': false,
        'datareporting.policy.dataSubmissionEnabled': false
    };
    const lines = Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`);
    await writeFile(path.join(PROFILE, 'user.js'), `${lines.join('\n')}\n`);
}

async function stageExtension() {
    await rm(STAGING, { recursive: true, force: true });
    await cp(ROOT, STAGING, {
        recursive: true,
        filter: source => !NOT_EXTENSION.has(path.relative(ROOT, source).split(path.sep)[0])
    });
    return STAGING;
}

async function startFirefox() {
    await prepareProfile();
    const options = new firefox.Options().addArguments('-profile', PROFILE);
    // Opening moz-extension:// pages and pressing media keys from the browser's
    // chrome both need geckodriver's system access.
    return new Builder().forBrowser(Browser.FIREFOX).setFirefoxOptions(options)
        .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access')).build();
}

// Company SSO flows leave alura.com.br while signing in, so any other host counts too.
async function onLoginPage(driver) {
    return driver.executeScript(() => !/(^|\.)alura\.com\.br$/.test(location.hostname) ||
        Boolean(document.querySelector('input[type="password"]')) ||
        /login|signin|entrar/i.test(location.pathname));
}

// The sign-in may happen in any tab, and tabs may be closed meanwhile.
async function anyTabSignedIn(driver) {
    for (const handle of await driver.getAllWindowHandles()) {
        try {
            await driver.switchTo().window(handle);
            if (!(await onLoginPage(driver))) return true;
        } catch (_) {
            // Closed or navigating; check again on the next round.
        }
    }
    return false;
}

async function ensureSignedIn(driver, targetUrl = `${ORIGIN}/dashboard`) {
    const mainHandle = await driver.getWindowHandle();
    await driver.get(targetUrl);
    if (!(await onLoginPage(driver))) return;
    console.log('\n>>> Sign in to Alura in the Firefox window that just opened (waiting up to 10 minutes)…\n');
    const deadline = Date.now() + 10 * 60_000;
    while (!(await anyTabSignedIn(driver))) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for the Alura sign-in.');
        await sleep(2000);
    }
    console.log('Signed in.');
    await sleep(2000);
    await driver.switchTo().window(mainHandle);
    await driver.get(targetUrl);
}

function taskId(url) {
    return String(url).match(/\/task\/(\d+)/)?.[1] || null;
}

async function discover(driver, url) {
    await ensureSignedIn(driver, url);
    await sleep(4000);
    const links = await driver.executeScript(() => Array.from(document.querySelectorAll('a[href*="/course/"], a[href*="/task/"]'), link => ({
        text: link.textContent.replace(/\s+/g, ' ').trim().slice(0, 70),
        href: link.href
    })));
    const seen = new Set();
    console.log(`Links on ${await driver.getCurrentUrl()}:`);
    for (const link of links) {
        if (seen.has(link.href)) continue;
        seen.add(link.href);
        console.log(`  ${link.href}  ${link.text}`);
    }
}

async function extensionCall(driver, handles, script, ...args) {
    await driver.switchTo().window(handles.probe);
    const result = await driver.executeAsyncScript(script, ...args);
    await driver.switchTo().window(handles.alura);
    return result;
}

function sendMessage(driver, handles, message) {
    return extensionCall(driver, handles, `
        const done = arguments[arguments.length - 1];
        chrome.runtime.sendMessage(arguments[0], response => done(response ?? null));
    `, message);
}

function setSettings(driver, handles, settings) {
    return extensionCall(driver, handles, `
        const done = arguments[arguments.length - 1];
        chrome.storage.local.set(arguments[0], () => done(true));
    `, settings);
}

// Runs inside the lesson page with content.js's helpers in scope. Read-only.
function probeLesson() {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const describe = element => element ? {
        tag: element.tagName.toLowerCase(),
        text: clean(element.getAttribute('aria-label') || element.textContent).slice(0, 80),
        classes: clean(element.className?.baseVal ?? element.className).slice(0, 160)
    } : null;
    const video = getVideoElement();
    const newQuiz = getNewStructureQuizElements();
    const hasQuiz = Boolean(document.querySelector('.alternativeList') || newQuiz);
    const text = getTextLessonContent();
    const kind = isVideoLesson(video) ? 'video' : hasQuiz ? 'quiz' : text ? 'text' : 'unknown';
    let quiz = null;
    if (hasQuiz) {
        const data = extractQuizData();
        quiz = {
            options: data.options.length,
            isMultiple: data.isMultiple,
            requiredChoices: data.requiredChoices,
            isSolved: data.isSolved,
            selected: data.options.filter(option => option.isSelected).length,
            question: clean(data.questionHTML.replace(/<[^>]*>/g, ' ')).slice(0, 120)
        };
    }
    return {
        url: location.href,
        documentTitle: document.title,
        context: lessonContext(),
        kind,
        video: video ? {
            paused: video.paused,
            ended: video.ended,
            playbackRate: video.playbackRate,
            readyState: video.readyState,
            currentTime: Math.round(video.currentTime),
            duration: Math.round(video.duration || 0),
            hasSource: Boolean(video.currentSrc || video.src)
        } : null,
        nextButton: describe(getNextButton()),
        prevButton: describe(getPrevButton()),
        predictedNext: predictNextLesson(),
        text: text ? { blocks: text.querySelectorAll('p, h1, h2, h3, li, blockquote, pre').length, chars: text.textContent.length, element: describe(text) } : null,
        quiz,
        transcription: { onPage: describe(findOnPageTranscriptionElement()), sidebarTab: describe(findTranscriptionTab()) },
        landmarks: {
            sections: Array.from(document.querySelectorAll('section[aria-label], main[aria-label]'), node => node.getAttribute('aria-label')).slice(0, 15),
            headings: Array.from(document.querySelectorAll('h1, h2'), node => clean(node.textContent).slice(0, 60)).slice(0, 10),
            buttons: Array.from(document.querySelectorAll('button, a[data-slot="ds-button-root"]'), node => clean(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent).slice(0, 40)).filter(Boolean).slice(0, 50),
            videoElements: document.querySelectorAll('video').length,
            iframes: Array.from(document.querySelectorAll('iframe'), node => String(node.src).slice(0, 100))
        },
        sidebarTasks: (() => {
            const sidebar = document.querySelectorAll('.task-menu-nav-item-link, ul li.group a[href*="/task/"]');
            const links = sidebar.length ? sidebar : document.querySelectorAll('a[href*="/task/"]');
            const nextHref = getNextButton()?.href;
            return Array.from(new Set(Array.from(links, link => link.href.split('#')[0]))).filter(href => href !== nextHref);
        })()
    };
}

// Expands each sidebar section whose counter shows every activity done ("7/7")
// and returns its lesson links. Only opens accordions; navigates nowhere.
function completedSectionLessons(driver) {
    return driver.executeAsyncScript(function () {
        const done = arguments[arguments.length - 1];
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        // Closed accordion triggers only get aria-controls once opened.
        const toggles = Array.from(document.querySelectorAll('button[aria-expanded]')).filter(button => {
            const match = button.textContent.replace(/\s+/g, ' ').trim().match(/^(\d+)\/(\d+)/);
            return match && match[1] === match[2] && Number(match[1]) > 0;
        });
        (async () => {
            const hrefs = [];
            for (const button of toggles) {
                if (button.getAttribute('aria-expanded') !== 'true') button.click();
                await sleep(1200);
                document.getElementById(button.getAttribute('aria-controls'))
                    ?.querySelectorAll('a[href*="/task/"]').forEach(link => hrefs.push(link.href.split('#')[0]));
            }
            done(Array.from(new Set(hrefs)));
        })();
    });
}

// Lessons listed before `url` in its sidebar, nearest first. Both the sidebar
// order and the task number must agree, so lessons not reached yet are never opened.
function earlierLessons(url, sidebarTasks) {
    const current = taskId(url);
    const index = sidebarTasks.findIndex(href => taskId(href) === current);
    if (!current || index < 0) return [];
    return sidebarTasks.slice(0, index).filter(href => Number(taskId(href)) < Number(current)).reverse();
}

async function readCompanion(driver, handles) {
    const known = new Set([handles.alura, handles.probe]);
    for (const handle of await driver.getAllWindowHandles()) {
        if (known.has(handle)) continue;
        await driver.switchTo().window(handle);
        if ((await driver.getCurrentUrl()) !== COMPANION_URL) continue;
        const state = await driver.executeScript(() => {
            const byId = id => document.getElementById(id);
            const shown = id => byId(id) && !byId(id).classList.contains('hidden');
            return {
                kind: byId('lessonKind')?.textContent.trim() || null,
                title: byId('mainTitle').textContent.trim(),
                view: ['view-loading', 'view-player', 'view-content'].find(shown) || 'none',
                text: shown('textContainer') ? byId('dynamicContent').textContent.trim().length : null,
                quizOptions: shown('quizContainer') ? byId('quizOptions').children.length : null,
                videoStatus: shown('view-player') ? byId('videoStatusText').textContent.trim() : null,
                rsvpVisible: shown('view-content') && shown('rsvpPanel'),
                rsvpStatus: byId('rsvpStatus')?.textContent.trim() || null,
                banner: shown('advanceBanner') ? byId('advanceMessage').textContent.trim() : null
            };
        });
        await driver.switchTo().window(handles.alura);
        return state;
    }
    await driver.switchTo().window(handles.alura);
    return null;
}

async function runProbe(driver, script) {
    return driver.executeScript(script);
}

async function waitFor(check, timeout, interval = 500) {
    const deadline = Date.now() + timeout;
    let value = await check();
    while (!value && Date.now() < deadline) {
        await sleep(interval);
        value = await check();
    }
    return value;
}

async function checkVideo(driver, handles, script, result) {
    const playing = await waitFor(async () => {
        const page = await runProbe(driver, script);
        return page.video && !page.video.paused ? page : null;
    }, 10_000);
    result.checks.autoplay = Boolean(playing);
    const afterAutoplay = playing || await runProbe(driver, script);
    result.checks.speedApplied = Math.abs((afterAutoplay.video?.playbackRate || 0) - TEST_SETTINGS.playbackSpeed) < 0.01;

    const before = afterAutoplay.video?.paused;
    await sendMessage(driver, handles, { type: 'COMMAND_PLAY_PAUSE' });
    const toggled = await waitFor(async () => {
        const page = await runProbe(driver, script);
        return page.video && page.video.paused !== before ? page : null;
    }, 5000);
    result.checks.playPauseCommand = Boolean(toggled);
    await driver.executeScript(() => document.querySelector('video')?.pause());
}

// Checks both ways back to an earlier (already seen) lesson: the companion's ⏮
// button and the hardware "previous track" key.
async function checkPreviousLesson(driver, handles, result) {
    const startUrl = await driver.getCurrentUrl();
    await sendMessage(driver, handles, { type: 'COMMAND_PREV' });
    result.checks.previousCommand = Boolean(await waitFor(async () => (await driver.getCurrentUrl()) !== startUrl, 10_000));

    await driver.get(startUrl);
    await sleep(6000);
    await driver.executeScript(() => document.querySelector('video')?.play());
    // Firefox only routes media keys to a tab once its media controller is active,
    // which can take a few seconds after playback (re)starts.
    const pressWhenActive = () => driver.executeScript(() => {
        for (const win of Services.wm.getEnumerator('navigator:browser')) {
            // Find the lesson tab: the most recent window may be the companion popup.
            for (const browser of win.gBrowser.browsers) {
                if (!browser.currentURI.spec.includes('/task/')) continue;
                const controller = browser.browsingContext.mediaController;
                const state = {
                    isActive: controller.isActive,
                    isPlaying: controller.isPlaying,
                    supportedKeys: Array.from(controller.supportedKeys || [])
                };
                if (state.isActive) controller.prevTrack();
                return state;
            }
        }
        return null;
    });
    await driver.setContext(firefox.Context.CHROME);
    try {
        result.checks.mediaController = await waitFor(async () => {
            const state = await pressWhenActive();
            return state?.isActive ? state : null;
        }, 15_000, 1000) || await pressWhenActive();
    } finally {
        await driver.setContext(firefox.Context.CONTENT);
    }
    const moved = await waitFor(async () => (await driver.getCurrentUrl()) !== startUrl, 15_000);
    result.checks.mediaKeyPreviousTrack = Boolean(moved);
    result.checks.mediaKeyLandedOn = await driver.getCurrentUrl();
}

async function checkTranscript(driver, handles, result) {
    const startUrl = await driver.getCurrentUrl();
    await setSettings(driver, handles, { rsvpAfterVideoEnabled: true });
    try {
        await driver.executeScript(() => {
            const video = document.querySelector('video');
            video.currentTime = Math.max(0, video.duration - 3);
            return video.play();
        });
        const companion = await waitFor(async () => {
            const state = await readCompanion(driver, handles);
            return state?.view === 'view-content' && state.kind === 'Transcrição do vídeo' ? state : null;
        }, 40_000, 1500);
        result.checks.transcriptRsvp = Boolean(companion?.rsvpVisible);
        result.checks.transcriptStatus = companion?.rsvpStatus || null;
        await sleep(6000);
        result.checks.transcriptKeptLesson = (await driver.getCurrentUrl()) === startUrl;
    } finally {
        await setSettings(driver, handles, { rsvpAfterVideoEnabled: false });
    }
}

function issuesFor(result) {
    const issues = [];
    const { page, extension, companion, checks } = result;
    if (page.kind === 'unknown') issues.push('Lesson type not recognised by content.js');
    if (!page.nextButton) issues.push('"Next" button not found');
    if (extension.diagnostic) issues.push(`Extension diagnostic: ${extension.diagnostic.data?.message}`);
    const mode = extension.latestState?.mode;
    const expectedMode = page.kind === 'video' ? 'PLAYER' : page.kind === 'unknown' ? null : 'CONTENT';
    if (expectedMode && mode !== expectedMode) issues.push(`Extension reported mode ${mode || 'none'}, expected ${expectedMode}`);
    if (page.kind === 'quiz' && !page.quiz?.options) issues.push('Quiz has no options');
    if (page.kind === 'quiz' && companion && companion.quizOptions !== page.quiz?.options) issues.push(`Companion shows ${companion.quizOptions} quiz options, page has ${page.quiz?.options}`);
    if (page.kind === 'text' && companion && !companion.text) issues.push('Companion shows no lesson text');
    if (page.kind !== 'video' && page.kind !== 'unknown' && !companion) issues.push('Companion window did not open');
    for (const [name, value] of Object.entries(checks)) if (value === false) issues.push(`Check failed: ${name}`);
    return issues;
}

async function probeUrl(driver, handles, script, url, options) {
    await driver.switchTo().window(handles.alura);
    await driver.get(url);
    if (await onLoginPage(driver)) await ensureSignedIn(driver, url);
    await sleep(6000);
    const page = await runProbe(driver, script);
    const result = { url, page, checks: {} };
    if (page.kind === 'video') {
        await checkVideo(driver, handles, script, result);
        if (options.mediaKeys && !options.mediaKeysTested) {
            options.mediaKeysTested = true;
            await checkPreviousLesson(driver, handles, result);
        } else if (options.transcript && !options.transcriptTested && options.completedUrls?.has(url) && page.transcription.onPage) {
            const index = page.sidebarTasks.findIndex(href => taskId(href) === taskId(page.url));
            if (index >= 0 && index < page.sidebarTasks.length - 1) {
                options.transcriptTested = true;
                await checkTranscript(driver, handles, result);
            }
        }
    }
    const session = await sendMessage(driver, handles, { type: 'GET_SESSION_STATUS' });
    result.extension = {
        diagnostic: session?.diagnostic || null,
        latestState: session?.latestState ? {
            mode: session.latestState.mode,
            title: session.latestState.data?.title,
            isQuiz: session.latestState.data?.isQuiz,
            options: session.latestState.data?.options?.length,
            htmlChars: session.latestState.data?.html?.length,
            status: session.latestState.data?.status
        } : null
    };
    result.companion = await readCompanion(driver, handles);
    result.issues = issuesFor(result);
    const name = `${page.context?.courseId || 'page'}-${page.context?.lessonId || Date.now()}`.replace(/[^\w.-]+/g, '_');
    await writeFile(path.join(OUTPUT, `${name}.html`), await driver.getPageSource());
    return result;
}

function printSummary(results) {
    console.log('\nLesson                                   Type     Extension  Companion     Issues');
    for (const result of results) {
        const label = `${result.page.context?.lessonId || '?'} ${result.page.context?.title || ''}`.slice(0, 40).padEnd(41);
        const mode = (result.extension.latestState?.mode || '-').padEnd(10);
        const companion = (result.companion?.view || '-').padEnd(13);
        console.log(`${label}${result.page.kind.padEnd(9)}${mode}${companion}${result.issues.length ? result.issues.join('; ') : 'ok'}`);
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === 'check' && !options.urls.length) {
        console.error('Usage: npm run live:check -- <alura task url> [--earlier] [--limit N] [--media-keys]');
        process.exitCode = 2;
        return;
    }
    await mkdir(OUTPUT, { recursive: true });
    const driver = await startFirefox();
    try {
        if (options.command === 'login') {
            await ensureSignedIn(driver, options.urls[0]);
            console.log(`Session saved in ${PROFILE}.`);
            return;
        }
        if (options.command === 'discover') {
            await discover(driver, options.urls[0] || `${ORIGIN}/dashboard`);
            return;
        }
        await driver.installAddon(await stageExtension(), true);
        const handles = { alura: await driver.getWindowHandle() };
        await driver.switchTo().newWindow('tab');
        await driver.get(`${EXTENSION_BASE}/popup.html`);
        handles.probe = await driver.getWindowHandle();
        await driver.switchTo().window(handles.alura);
        await setSettings(driver, handles, TEST_SETTINGS);
        await ensureSignedIn(driver, options.urls[0]);

        const script = await pageProbeScript(probeLesson);
        const queue = [...options.urls];
        const seen = new Set();
        const results = [];
        while (queue.length && results.length < options.limit) {
            const url = queue.shift();
            if (seen.has(url)) continue;
            seen.add(url);
            console.log(`Probing ${url}`);
            const result = await probeUrl(driver, handles, script, url, options);
            results.push(result);
            if (options.earlier && results.length === 1) {
                const earlier = earlierLessons(result.page.url, result.page.sidebarTasks);
                console.log(`Earlier lessons in this section: ${earlier.length ? earlier.join(', ') : 'none found'}`);
                queue.push(...earlier);
            }
            if (options.completed && results.length === 1) {
                const completed = (await completedSectionLessons(driver)).filter(href => !seen.has(href));
                options.completedUrls = new Set(completed);
                console.log(`Lessons in completed sections: ${completed.length ? completed.join(', ') : 'none found'}`);
                queue.push(...completed);
            }
            if (result.checks.mediaKeyLandedOn) seen.add(result.checks.mediaKeyLandedOn);
        }
        const reportPath = path.join(OUTPUT, `report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        await writeFile(reportPath, JSON.stringify(results, null, 2));
        printSummary(results);
        console.log(`\nFull report: ${reportPath}`);
        if (results.some(result => result.issues.length)) process.exitCode = 1;
    } finally {
        await driver.quit();
    }
}

if (!existsSync(path.join(ROOT, 'manifest.json'))) throw new Error(`manifest.json not found in ${ROOT}`);
await main();
