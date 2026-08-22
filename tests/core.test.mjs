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

test('current multi-choice markup exposes individual option feedback', async () => {
    const fixture = await readFile(new URL('./fixtures/new-multiple-quiz.html', import.meta.url), 'utf8');
    const instruction = fixture.match(/Selecione\s+\d+\s+alternativas:/i)?.[0];
    const rules = core.quizSelectionRules(instruction);
    assert.deepEqual(rules, { isMultiple: true, requiredChoices: 2 });
    assert.match(fixture, /aria-label="Resposta correta"/);
    assert.match(fixture, /aria-label="Resposta incorreta"/);
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

test('current Video.js markup exposes the preferred media and controls', async () => {
    const fixture = await readFile(new URL('./fixtures/video-js.html', import.meta.url), 'utf8');
    assert.match(fixture, /<video-js[^>]*class="[^"]*video-js[^"]*vjs-paused/);
    assert.match(fixture, /<video[^>]*class="vjs-tech"[^>]*autoplay/);
    assert.match(fixture, /class="vjs-big-play-button"/);
    assert.match(fixture, /class="vjs-play-control/);
    assert.match(fixture, /class="autoplay-cancel-button"/);
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

test('new text lesson structure contains enough readable content', async () => {
    const fixture = await readFile(new URL('./fixtures/new-text-lesson.html', import.meta.url), 'utf8');
    assert.match(fixture, /<section aria-label="Conteúdo da aula" class="relative select-text">/);
    const blockCount = [...fixture.matchAll(/<(?:p|h[1-3]|li|blockquote|pre)\b/g)].length;
    const text = fixture.replace(/<[^>]+>/g, ' ');
    assert.equal(core.isReadableTextCandidate(text, blockCount), true);
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

test('automatic reading override applies equally to text lessons and video transcriptions', () => {
    assert.equal(core.shouldAutoStartReading(undefined, true), true);
    assert.equal(core.shouldAutoStartReading(undefined, false), false);
    assert.equal(core.shouldAutoStartReading(true, false), true);
    assert.equal(core.shouldAutoStartReading(false, true), false);
});

test('current video sidebar exposes a stable transcription source for RSVP', async () => {
    const [fixture, contentScript, companionScript] = await Promise.all([
        readFile(new URL('./fixtures/video-transcription-sidebar.html', import.meta.url), 'utf8'),
        readFile(new URL('../content.js', import.meta.url), 'utf8'),
        readFile(new URL('../reading.js', import.meta.url), 'utf8')
    ]);
    assert.match(fixture, /title="Transcrição">Transcrição/);
    assert.match(fixture, /Esta é a transcrição completa/);
    assert.match(contentScript, /function loadVideoTranscription/);
    assert.match(contentScript, /stableSince/);
    assert.match(contentScript, /transcriptWordCount/);
    assert.match(contentScript, /autoStartReading: settings\.autoReadEnabled !== false/);
    assert.match(contentScript, /function cancelNativeVideoAdvance/);
    assert.match(contentScript, /blockNativeContinueDuringTranscript/);
    assert.match(contentScript, /transcriptLoadingLessonId = context\.lessonId/);
    assert.match(contentScript, /loadingReason: 'video-transcription'/);
    assert.match(contentScript, /transcriptLoadingPending && transcriptLoadingLessonId === context\.lessonId/);
    assert.doesNotMatch(contentScript, /loadVideoTranscription\(video\?\.duration\)/);
    assert.match(companionScript, /currentData\?\.transcriptText/);
    assert.match(companionScript, /shouldAutoStartReading\(data\.autoStartReading, settings\.autoReadEnabled\)/);
    assert.doesNotMatch(contentScript, /textTracks|vjs-subtitles|vjs-captions/);
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
    assert.match(popupScript, /function updateConditionalSettings/);
    assert.match(popupScript, /Confirmar exclusão/);
    assert.match(companion, /data-reading-mode="rsvp"/);
    assert.match(companion, /id="rsvpPanel"/);
    assert.match(companion, /id="rsvpStage"[^>]*role="button"[^>]*tabindex="0"/);
    assert.match(companionScript, /ui\.rsvpStage\.addEventListener\('click', toggleRsvp\)/);
    assert.match(companionScript, /event\.key !== 'Enter' && event\.key !== ' '/);
    assert.match(companionScript, /transcriptRsvpWpm/);
    assert.match(background, /transcriptRsvpWpm: 300/);
    assert.match(notices, /MIT License/);
});
