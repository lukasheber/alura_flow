import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../core.js';

const core = globalThis.AluraFlowCore;

test('incorrect class tokens never count as correct', async () => {
    const fixture = await readFile(new URL('./fixtures/new-quiz.html', import.meta.url), 'utf8');
    const classes = [...fixture.matchAll(/class="([^"]+)"/g)].map(match => match[1]);
    assert.equal(core.classIndicatesCorrect(classes.find(value => value.includes('incorrect'))), false);
    assert.equal(core.classIndicatesCorrect(classes.find(value => value.includes('feedback-success'))), true);
    assert.equal(core.classIndicatesIncorrect('border-l-feedback-error-default'), true);
    assert.equal(core.classIndicatesIncorrect('bg-task-alternative-incorrect-sidebar-bg'), true);
    assert.equal(core.classIndicatesCorrect('border-l-feedback-success-default'), true);
    assert.equal(core.classIndicatesCorrect('mostly-correct-looking'), false);
});

test('Portuguese incorrect feedback never counts as correct', async () => {
    const fixture = await readFile(new URL('./fixtures/old-quiz.html', import.meta.url), 'utf8');
    assert.match(fixture, /Alternativa incorreta/);
    assert.equal(core.opinionIndicatesCorrect('Alternativa incorreta.'), false);
    assert.equal(core.opinionIndicatesCorrect('Alternativa correta.'), true);
});

test('multiple-choice completion requires the exact correct set', () => {
    const partial = [{ isSelected: true, isCorrect: true }, { isSelected: false, isCorrect: true }];
    const complete = [{ isSelected: true, isCorrect: true }, { isSelected: true, isCorrect: true }];
    const withWrong = [...complete, { isSelected: true, isCorrect: false }];
    assert.equal(core.isQuizSolved(partial, true, 2, false), false);
    assert.equal(core.isQuizSolved(complete, true, 2, false), true);
    assert.equal(core.isQuizSolved(withWrong, true, 2, false), false);
    assert.equal(core.isQuizSolved([], true, 2, true), true);
});

test('each wrong option produces a distinct feedback event', () => {
    const first = core.quizFeedbackFingerprint([{ incorrect: true }, {}, {}]);
    const second = core.quizFeedbackFingerprint([{}, { incorrect: true }, {}]);
    assert.deepEqual(first.wrongIds, ['0']);
    assert.deepEqual(second.wrongIds, ['1']);
    assert.notEqual(first.fingerprint, second.fingerprint);
});

test('controlled tab wins, otherwise the most recent active tab wins', () => {
    const tabs = [
        { id: 1, active: true, lastAccessed: 10 },
        { id: 2, active: true, lastAccessed: 30 },
        { id: 3, active: false, lastAccessed: 50 }
    ];
    assert.equal(core.chooseControlledTab(tabs, 1).id, 1);
    assert.equal(core.chooseControlledTab(tabs).id, 2);
});

test('course and lesson IDs are stable across same-title lessons', () => {
    const first = 'https://cursos.alura.com.br/course/javascript/task/101';
    const second = 'https://cursos.alura.com.br/course/javascript/task/102';
    assert.equal(core.courseIdFromUrl(first), 'javascript');
    assert.equal(core.lessonIdFromUrl(first), '101');
    assert.equal(core.lessonIdFromUrl(second), '102');
});

test('loading placeholders are never treated as readable lessons', () => {
    assert.equal(core.isLoadingState({ isLoading: true }), true);
    assert.equal(core.isLoadingState({ status: 'loading' }), true);
    assert.equal(core.isLoadingState({ title: 'Carregando próxima aula…' }), true);
    assert.equal(core.isLoadingState({ title: 'Preparando sua próxima aula' }), true);
    assert.equal(core.isLoadingState({ title: 'Estrutura da Lean Inception' }), false);
});

test('current Video.js markup exposes the preferred media and controls', async () => {
    const fixture = await readFile(new URL('./fixtures/video-js.html', import.meta.url), 'utf8');
    assert.match(fixture, /<video-js[^>]*class="[^"]*video-js[^"]*vjs-paused/);
    assert.match(fixture, /<video[^>]*class="vjs-tech"[^>]*autoplay/);
    assert.match(fixture, /class="vjs-big-play-button"/);
    assert.match(fixture, /class="vjs-play-control/);
});

test('speed shortcut always advances to the next supported speed', () => {
    assert.equal(core.nextPlaybackSpeed(undefined), 1);
    assert.equal(core.nextPlaybackSpeed(1), 1.25);
    assert.equal(core.nextPlaybackSpeed(1.3), 1.5);
    assert.equal(core.nextPlaybackSpeed(2), 1);
    assert.equal(core.nextPlaybackSpeed(4), 1);
});
