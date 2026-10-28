// Behaviour of the real content.js on fixture pages (see helpers/content-harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadLesson, taskUrl } from './helpers/content-harness.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const CLASSPAGE_URL = 'https://empresa.alura.com.br/classpage/javascript/task/101';

const SINGLE_CHOICE_QUIZ = `
<section aria-label="Conteúdo da aula" class="relative select-text">
  <p>Qual é a resposta?</p>
  <p>Selecione uma alternativa:</p>
  <ul>
    <li><button class="group"><span class="text-task-alternative-content-text">Primeira</span></button></li>
    <li><button class="group"><span class="text-task-alternative-content-text">Segunda</span></button></li>
  </ul>
</section>`;

function countClicks(element) {
    const counter = { count: 0 };
    element.addEventListener('click', event => {
        event.preventDefault();
        counter.count += 1;
    });
    return counter;
}

async function withLesson(html, options, body) {
    const lesson = await loadLesson(html, options);
    try {
        await body(lesson);
        assert.deepEqual(lesson.errors, []);
    } finally {
        lesson.close();
    }
}

test('a text lesson reaches the companion as sanitized readable content', async () => {
    await withLesson(await fixture('new-text-lesson.html'), {}, async lesson => {
        await lesson.settle();
        const { mode, data } = lesson.lastState();
        assert.equal(mode, 'CONTENT');
        assert.equal(data.isQuiz, false);
        assert.match(data.html, /Preparando o ambiente/);
        assert.doesNotMatch(data.html, /<button/);
    });
});

test('the old quiz layout reports each option and its feedback', async () => {
    await withLesson(await fixture('old-quiz.html'), {}, async lesson => {
        await lesson.settle();
        const { data } = lesson.lastState();
        assert.equal(data.isQuiz, true);
        assert.deepEqual(data.options.map(option => [option.id, option.isCorrect, option.isIncorrect]), [
            ['wrong', false, true],
            ['right', true, false]
        ]);
    });
});

test('a multiple-choice quiz is unsolved until every required answer is right', async () => {
    await withLesson(await fixture('new-multiple-quiz.html'), {}, async lesson => {
        await lesson.settle();
        const { data } = lesson.lastState();
        assert.equal(data.isMultiple, true);
        assert.equal(data.requiredChoices, 2);
        assert.equal(data.isSolved, false);
        assert.match(data.questionHTML, /Qual das seguintes alternativas/);
        assert.deepEqual(data.options.map(option => [option.isCorrect, option.isIncorrect]), [
            [true, false], [false, false], [false, true], [false, false]
        ]);
    });
});

test('a video lesson autoplays at the stored speed and is reported as the player', async () => {
    await withLesson(await fixture('video-js.html'), { storage: { playbackSpeed: 1.5 } }, async lesson => {
        await lesson.settle();
        await lesson.clock.tick(100); // autoplay is attempted shortly after the player is found
        const video = lesson.document.querySelector('video');
        assert.equal(lesson.lastState().mode, 'PLAYER');
        assert.equal(video.playbackRate, 1.5);
        assert.equal(video.paused, false);
    });
});

test('a speed command changes the video without replacing the stored default', async () => {
    await withLesson(await fixture('video-js.html'), { storage: { playbackSpeed: 1 } }, async lesson => {
        await lesson.settle();
        lesson.ext.dispatch({ type: 'UPDATE_SPEED', speed: 2 });
        assert.equal(lesson.document.querySelector('video').playbackRate, 2);
        assert.equal(lesson.run('settings.playbackSpeed'), 1);
    });
});

test('auto-advance clicks "next" when the countdown ends on the same lesson', async () => {
    await withLesson(await fixture('new-text-lesson.html'), { storage: { autoAdvanceEnabled: true, autoAdvanceDelay: 1 } }, async lesson => {
        await lesson.settle();
        const next = countClicks(lesson.document.querySelector('[data-slot="ds-button-root"]'));
        lesson.ext.dispatch({ type: 'AUTO_FINISH_READING', reason: 'reading' });
        await lesson.clock.tick(1500);
        assert.equal(next.count, 1);
        assert.deepEqual(lesson.ext.messages('AUTO_ADVANCE_EXECUTED'), [{ type: 'AUTO_ADVANCE_EXECUTED', reason: 'reading' }]);
    });
});

test('auto-advance never clicks "next" after the page moved to another lesson', async () => {
    await withLesson(await fixture('new-text-lesson.html'), { storage: { autoAdvanceEnabled: true, autoAdvanceDelay: 1 } }, async lesson => {
        await lesson.settle();
        const next = countClicks(lesson.document.querySelector('[data-slot="ds-button-root"]'));
        lesson.ext.dispatch({ type: 'AUTO_FINISH_READING', reason: 'reading' });
        // Alura switches lessons in-page, so the old "next" button can still be there.
        lesson.window.history.pushState({}, '', taskUrl(102));
        await lesson.clock.tick(1500);
        assert.equal(next.count, 0);
        assert.equal(lesson.ext.messages('AUTO_ADVANCE_EXECUTED').length, 0);
    });
});

test('a lesson change cancels a running countdown and tells the companion', async () => {
    await withLesson(await fixture('new-text-lesson.html'), { storage: { autoAdvanceEnabled: true, autoAdvanceDelay: 10 } }, async lesson => {
        await lesson.settle();
        const next = countClicks(lesson.document.querySelector('[data-slot="ds-button-root"]'));
        lesson.ext.dispatch({ type: 'AUTO_FINISH_READING', reason: 'reading' });
        lesson.window.history.pushState({}, '', taskUrl(102));
        await lesson.clock.tick(2500);
        assert.equal(lesson.ext.messages('AUTO_ADVANCE_CANCELLED').length, 1);
        await lesson.clock.tick(10_000);
        assert.equal(next.count, 0);
    });
});

test('the quiz watcher skips quiz parsing while a video player churns attributes', async () => {
    await withLesson(await fixture('video-js.html'), {}, async lesson => {
        await lesson.settle();
        const { document } = lesson;
        let paragraphScans = 0;
        const querySelectorAll = document.querySelectorAll;
        document.querySelectorAll = function (selector) {
            if (selector === 'p') paragraphScans += 1;
            return querySelectorAll.call(this, selector);
        };
        const player = document.querySelector('video-js');
        for (let step = 0; step < 50; step += 1) {
            player.classList.toggle('vjs-user-inactive');
            player.setAttribute('aria-valuenow', String(step));
            await lesson.clock.tick(20);
        }
        assert.equal(paragraphScans, 0);
    });
});

test('quiz feedback is still detected when the page marks the right answer', async () => {
    await withLesson(SINGLE_CHOICE_QUIZ, {}, async lesson => {
        await lesson.settle();
        lesson.document.querySelectorAll('button.group')[1].classList.add('border-l-feedback-success-default');
        await lesson.clock.tick(150);
        assert.deepEqual(lesson.ext.messages('QUIZ_FEEDBACK_SUCCESS'), [{ type: 'QUIZ_FEEDBACK_SUCCESS', correctIds: ['1'] }]);
    });
});

test('"previous" uses the sidebar on the /classpage/ layout, which has no previous button', async () => {
    const html = (await fixture('classpage-sidebar.html')) + (await fixture('video-js.html'));
    await withLesson(html, { url: CLASSPAGE_URL }, async lesson => {
        await lesson.settle();
        const previous = countClicks(lesson.document.querySelector('a[href$="/task/100"]'));
        lesson.ext.dispatch({ type: 'COMMAND_PREV' });
        assert.equal(previous.count, 1);
        assert.equal(lesson.lastState().data.courseId, 'javascript');
    });
});

test('"next" predicts the next lesson type from the /classpage/ sidebar', async () => {
    const html = (await fixture('classpage-sidebar.html')) + (await fixture('video-js.html'));
    await withLesson(html, { url: CLASSPAGE_URL }, async lesson => {
        await lesson.settle();
        const next = countClicks(lesson.document.querySelector('.autoplay-continue-button'));
        lesson.ext.dispatch({ type: 'COMMAND_NEXT' });
        assert.equal(next.count, 1);
        assert.deepEqual(lesson.ext.messages('TRANSITION_START'), [{ type: 'TRANSITION_START', predictedMode: 'CONTENT' }]);
    });
});

test('media "next track" and "previous track" keys change lessons', async () => {
    const html = (await fixture('classpage-sidebar.html')) + (await fixture('video-js.html'));
    await withLesson(html, { url: CLASSPAGE_URL }, async lesson => {
        await lesson.settle();
        const next = countClicks(lesson.document.querySelector('.autoplay-continue-button'));
        const previous = countClicks(lesson.document.querySelector('a[href$="/task/100"]'));
        lesson.mediaHandlers.nexttrack();
        lesson.mediaHandlers.previoustrack();
        assert.equal(next.count, 1);
        assert.equal(previous.count, 1);
    });
});

test('turning media keys off releases the media key handlers', async () => {
    await withLesson(await fixture('video-js.html'), {}, async lesson => {
        await lesson.settle();
        assert.equal(typeof lesson.mediaHandlers.nexttrack, 'function');
        lesson.ext.chrome.storage.local.set({ mediaKeysEnabled: false });
        assert.equal(lesson.mediaHandlers.nexttrack, null);
        assert.equal(lesson.mediaHandlers.previoustrack, null);
    });
});

test('an on-page transcription is read without its "Transcrição" heading', async () => {
    await withLesson(await fixture('video-transcription-onpage.html'), {}, async lesson => {
        const pending = lesson.run('loadVideoTranscription()');
        await lesson.clock.tick(3000);
        const transcript = await pending;
        assert.equal(transcript.available, true);
        assert.match(transcript.text, /^Encerrando o assunto/);
        assert.ok(transcript.wordCount > 100);
    });
});

test('a sidebar transcription is opened and read once its text stops changing', async () => {
    await withLesson(await fixture('video-transcription-sidebar.html'), {}, async lesson => {
        const opened = countClicks(lesson.document.querySelector('button[title="Transcrição"]'));
        const pending = lesson.run('loadVideoTranscription()');
        await lesson.clock.tick(6000);
        const transcript = await pending;
        assert.equal(opened.count, 1);
        assert.equal(transcript.available, true);
        assert.match(transcript.text, /^Esta é a transcrição completa/);
    });
});
