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

test('multi-choice feedback remains partial until all required answers are correct', () => {
    const partial = core.quizFeedbackFingerprint([{ correct: true }, {}, {}, {}], '', 2);
    const complete = core.quizFeedbackFingerprint([{ correct: true }, {}, {}, { correct: true }], '', 2);
    assert.equal(partial.partial, true);
    assert.equal(partial.success, false);
    assert.equal(complete.partial, false);
    assert.equal(complete.success, true);
    assert.deepEqual(complete.correctIds, ['0', '3']);
});

test('quiz instructions determine multiple selection and required count', () => {
    assert.deepEqual(core.quizSelectionRules('Selecione 2 alternativas:'), { isMultiple: true, requiredChoices: 2 });
    assert.deepEqual(core.quizSelectionRules('Selecione uma alternativa:'), { isMultiple: false, requiredChoices: 0 });
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

test('the /classpage/ lesson URLs keep the same course ID as /course/ URLs', () => {
    const classpage = 'https://empresa.alura.com.br/classpage/educacao-financeira/task/201579';
    assert.equal(core.courseIdFromUrl(classpage), 'educacao-financeira');
    assert.equal(core.courseIdFromUrl('https://empresa.alura.com.br/course/educacao-financeira/continue'), 'educacao-financeira');
    assert.equal(core.lessonIdFromUrl(classpage), '201579');
});

test('a course speed applies only to its course, the default to every other course', () => {
    const settings = { playbackSpeed: 1.25, perCourseSettings: true, courseProfiles: { javascript: { playbackSpeed: 2 } } };
    assert.equal(core.effectivePlaybackSpeed(settings, 'javascript'), 2);
    assert.equal(core.effectivePlaybackSpeed(settings, 'python'), 1.25);
    assert.equal(core.effectivePlaybackSpeed({ ...settings, perCourseSettings: false }, 'javascript'), 1.25);
    assert.equal(core.effectivePlaybackSpeed({}, 'javascript'), 1);
});

test('saving a speed inside a course never rewrites the default speed', () => {
    const settings = { playbackSpeed: 1, perCourseSettings: true, courseProfiles: { python: { playbackSpeed: 1.5 } } };
    assert.deepEqual(core.playbackSpeedUpdate(settings, 'javascript', 2), {
        courseProfiles: { python: { playbackSpeed: 1.5 }, javascript: { playbackSpeed: 2 } }
    });
    assert.deepEqual(core.playbackSpeedUpdate({ ...settings, perCourseSettings: false }, 'javascript', 2), { playbackSpeed: 2 });
    assert.deepEqual(core.playbackSpeedUpdate(settings, null, 2), { playbackSpeed: 2 });
});

test('loading placeholders are never treated as readable lessons', () => {
    assert.equal(core.isLoadingState({ isLoading: true }), true);
    assert.equal(core.isLoadingState({ status: 'loading' }), true);
    assert.equal(core.isLoadingState({ title: 'Carregando próxima aula…' }), true);
    assert.equal(core.isLoadingState({ title: 'Preparando sua próxima aula' }), true);
    assert.equal(core.isLoadingState({ title: 'Estrutura da Lean Inception' }), false);
    assert.equal(core.canReadLesson({ isLoading: true }), false);
    assert.equal(core.canReadLesson({ displayTitle: 'Carregando conteúdo…' }), false);
    assert.equal(core.canReadLesson({ isQuiz: true, title: 'Questionário' }), false);
    assert.equal(core.canReadLesson({ title: 'Estrutura da Lean Inception' }), true);
});

test('companion renders transitions outside the RSVP and TTS content view', async () => {
    const [companion, companionScript] = await Promise.all([
        readFile(new URL('../reading.html', import.meta.url), 'utf8'),
        readFile(new URL('../reading.js', import.meta.url), 'utf8')
    ]);
    assert.match(companion, /id="view-loading"/);
    assert.match(companionScript, /currentMode = 'LOADING'/);
    assert.match(companionScript, /if \(currentMode !== 'CONTENT' \|\| !AluraFlowCore\.canReadLesson\(currentData\)\)/);
});

test('speed shortcut always advances to the next supported speed', () => {
    assert.equal(core.nextPlaybackSpeed(undefined), 1);
    assert.equal(core.nextPlaybackSpeed(1), 1.25);
    assert.equal(core.nextPlaybackSpeed(1.3), 1.5);
    assert.equal(core.nextPlaybackSpeed(2), 1);
    assert.equal(core.nextPlaybackSpeed(4), 1);
});

test('quiz auto-advance never offers undo after navigation', () => {
    assert.equal(core.shouldOfferUndo('quiz'), false);
    assert.equal(core.shouldOfferUndo('video'), true);
    assert.equal(core.shouldOfferUndo('reading'), true);
});

test('companion provides manual navigation after a completed quiz', async () => {
    const companion = await readFile(new URL('../reading.html', import.meta.url), 'utf8');
    assert.match(companion, /id="quizNextBtn"/);
    assert.match(companion, /Avançar para a próxima lição/);
});

test('text fingerprint ignores harmless whitespace changes', () => {
    assert.equal(core.textFingerprint('Uma aula\n com texto.'), core.textFingerprint('Uma aula com   texto.'));
    assert.notEqual(core.textFingerprint('Primeira aula'), core.textFingerprint('Segunda aula'));
});

test('RSVP parser and ORP keep a stable focal character', () => {
    assert.deepEqual(core.parseRsvpText('  leitura\n rápida   agora '), ['leitura', 'rápida', 'agora']);
    assert.deepEqual(core.splitRsvpWord('leitura'), { before: 'le', focus: 'i', after: 'tura' });
    assert.deepEqual(core.splitRsvpWord('“leitura”'), { before: '“le', focus: 'i', after: 'tura”' });
});

test('RSVP delay respects speed, punctuation, and long words', () => {
    assert.equal(core.rsvpWordDelay('texto', 300), 200);
    assert.equal(core.rsvpWordDelay('fim.', 300), 400);
    assert.equal(core.rsvpWordDelay('fim.”', 300), 400);
    assert.equal(core.rsvpWordDelay('pausa,', 300), 300);
    assert.ok(core.rsvpWordDelay('extraordinariamente', 300) > 200);
});

test('speed reading moves by sentence like a track player', () => {
    // 0 Uma · 1 frase. · 2 “Outra · 3 frase · 4 bem · 5 longa!” · 6 Fim…
    const words = core.parseRsvpText('Uma frase. “Outra frase bem longa!” Fim…');
    assert.equal(core.rsvpNextSentenceIndex(words, 0), 2);
    assert.equal(core.rsvpNextSentenceIndex(words, 3), 6);
    assert.equal(core.rsvpNextSentenceIndex(words, 6), 6, 'stays in the last sentence');
    assert.equal(core.rsvpPreviousSentenceIndex(words, 5), 2, 'deep in a sentence: back to its start');
    assert.equal(core.rsvpPreviousSentenceIndex(words, 3), 0, 'one word in: previous sentence');
    assert.equal(core.rsvpPreviousSentenceIndex(words, 2), 0);
    assert.equal(core.rsvpPreviousSentenceIndex(words, 0), 0);
    assert.equal(core.rsvpNextSentenceIndex([], 0), 0);
});

test('speed reading estimates the time left', () => {
    assert.equal(core.rsvpTimeLeftLabel(0, 300), 'fim');
    assert.equal(core.rsvpTimeLeftLabel(150, 300), 'falta menos de 1 min');
    assert.equal(core.rsvpTimeLeftLabel(900, 300), 'faltam ~3 min');
});

test('companion keys map to actions only where they make sense', () => {
    assert.deepEqual(core.companionKeyAction('3', { view: 'quiz', optionCount: 4 }), { type: 'select-option', index: 2 });
    assert.deepEqual(core.companionKeyAction('B', { view: 'quiz', optionCount: 4 }), { type: 'select-option', index: 1 });
    assert.equal(core.companionKeyAction('e', { view: 'quiz', optionCount: 4 }), null);
    assert.equal(core.companionKeyAction('Enter', { view: 'quiz', quizSolved: false }), null);
    assert.deepEqual(core.companionKeyAction('Enter', { view: 'quiz', quizSolved: true }), { type: 'next-lesson' });
    assert.deepEqual(core.companionKeyAction(' ', { view: 'text' }), { type: 'toggle-reading' });
    assert.equal(core.companionKeyAction('ArrowLeft', { view: 'text', readingMode: 'tts' }), null);
    assert.deepEqual(core.companionKeyAction('ArrowLeft', { view: 'text', readingMode: 'rsvp' }), { type: 'previous-sentence' });
    assert.equal(core.companionKeyAction(' ', { view: null }), null);
});

test('automatic reading override applies equally to text lessons and video transcriptions', () => {
    assert.equal(core.shouldAutoStartReading(undefined, true), true);
    assert.equal(core.shouldAutoStartReading(undefined, false), false);
    assert.equal(core.shouldAutoStartReading(true, false), true);
    assert.equal(core.shouldAutoStartReading(false, true), false);
});

test('automatic RSVP requires visible and focused companion attention', () => {
    assert.equal(core.canAutoStartRsvp({ documentVisible: true, documentFocused: true, windowFocused: true }), true);
    assert.equal(core.canAutoStartRsvp({ documentVisible: false, documentFocused: true, windowFocused: true }), false);
    assert.equal(core.canAutoStartRsvp({ documentVisible: true, documentFocused: false, windowFocused: true }), false);
    assert.equal(core.canAutoStartRsvp({ documentVisible: true, documentFocused: true, windowFocused: false }), false);
});

// The companion and background still lack a page-level harness, so these check
// their source for the transcript focus rules.
test('companion and background keep the transcript RSVP focus rules', async () => {
    const [companionScript, background] = await Promise.all([
        readFile(new URL('../reading.js', import.meta.url), 'utf8'),
        readFile(new URL('../background.js', import.meta.url), 'utf8')
    ]);
    assert.match(companionScript, /currentData\?\.transcriptText/);
    assert.match(companionScript, /shouldAutoStartReading\(data\.autoStartReading, settings\.autoReadEnabled\)/);
    assert.match(companionScript, /checkCompanionAttention\(hasAttention/);
    assert.match(companionScript, /Leitura pronta · clique no quadro para iniciar/);
    assert.match(background, /isTranscriptReading/);
    assert.match(background, /function firefoxHasFocusedWindow/);
    assert.match(background, /ensureCompanionWindow\(message, firefoxIsActive\)/);
    assert.doesNotMatch(background, /PREPARE_READING_MODE'[\s\S]{0,180}focused:\s*true/);
});

test('popup and companion expose RSVP settings and mode controls', async () => {
    const [popup, popupScript, companion, companionScript, background, notices] = await Promise.all([
        readFile(new URL('../popup.html', import.meta.url), 'utf8'),
        readFile(new URL('../popup.js', import.meta.url), 'utf8'),
        readFile(new URL('../reading.html', import.meta.url), 'utf8'),
        readFile(new URL('../reading.js', import.meta.url), 'utf8'),
        readFile(new URL('../background.js', import.meta.url), 'utf8'),
        readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8')
    ]);
    assert.match(popup, /id="readingModeTts"/);
    assert.match(popup, /id="readingModeRsvp"/);
    assert.match(popup, /id="ttsOptions"/);
    assert.match(popup, /id="rsvpOptions"/);
    assert.match(popup, /id="rsvpWpm"/);
    assert.match(popup, /id="transcriptAfterVideoToggle"/);
    assert.match(popup, /id="transcriptRsvpWpm"/);
    assert.match(popup, /Velocidade de leitura/);
    assert.doesNotMatch(popup, /Velocidade da transcrição/);
    assert.match(popup, /id="shortcutsHeading"/);
    assert.match(popup, /id="historyHeading"/);
    assert.match(popup, /id="mediaKeysToggle"/);
    assert.match(popupScript, /mediaKeysEnabled/);
    assert.match(popupScript, /function updateConditionalSettings/);
    assert.match(popupScript, /Confirmar exclusão/);
    assert.match(companion, /data-reading-mode="rsvp"/);
    assert.match(companion, /id="rsvpPanel"/);
    assert.match(companion, /id="rsvpStage"[^>]*role="button"[^>]*tabindex="0"/);
    assert.match(companionScript, /ui\.rsvpStage\.addEventListener\('click', toggleRsvp\)/);
    assert.match(companionScript, /event\.key !== 'Enter' && event\.key !== ' '/);
    // The play button sits in the middle column and keeps one width as its label changes.
    assert.match(companion, /\.reading-dock\s*\{[^}]*grid-template-columns:\s*1fr auto 1fr/s);
    assert.match(companion, /#ttsBtnTop\s*\{[^}]*min-width:/);
    assert.match(companionScript, /transcriptRsvpWpm/);
    assert.match(background, /transcriptRsvpWpm: 300/);
    assert.match(notices, /MIT License/);
});
