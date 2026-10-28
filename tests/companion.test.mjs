// Behaviour of the real companion window (see helpers/companion-harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCompanion } from './helpers/companion-harness.mjs';

const LESSON = { lessonId: '101', courseId: 'javascript', title: 'Aula de texto', language: 'pt-BR' };
const TEXT = { mode: 'CONTENT', data: { ...LESSON, isQuiz: false, html: '<p>Primeira frase curta. Segunda frase aqui! Terceira frase final.</p>' } };

function quiz(overrides = {}) {
    return {
        mode: 'CONTENT',
        data: {
            ...LESSON, lessonId: '102', title: 'Quiz', isQuiz: true, isMultiple: false, isSolved: false,
            questionHTML: '<p>Qual é a resposta?</p>', instructionHTML: 'Selecione uma alternativa',
            options: ['Primeira', 'Segunda', 'Terceira'].map((html, index) => ({ id: `a${index + 1}`, html, isSelected: false, isCorrect: false, isIncorrect: false })),
            ...overrides
        }
    };
}

async function withCompanion(options, body) {
    const companion = await loadCompanion(options);
    try {
        await body(companion);
        assert.deepEqual(companion.errors, []);
    } finally {
        companion.close();
    }
}

test('arrow keys move through speed reading by sentence', async () => {
    await withCompanion({ state: TEXT, storage: { readingMode: 'rsvp' } }, async companion => {
        const position = () => companion.byId('rsvpStatus').textContent.split(' palavras')[0];
        assert.equal(position(), '1 de 9');
        await companion.press('ArrowRight');
        assert.equal(position(), '4 de 9');
        await companion.press('ArrowRight');
        assert.equal(position(), '7 de 9');
        await companion.press('ArrowRight'); // already in the last sentence: stays put
        assert.equal(position(), '7 de 9');
        await companion.press('ArrowLeft'); // at a sentence start: previous sentence
        assert.equal(position(), '4 de 9');
        await companion.press('ArrowLeft');
        assert.equal(position(), '1 de 9');
    });
});

test('Space starts and pauses speed reading', async () => {
    await withCompanion({ state: TEXT, storage: { readingMode: 'rsvp', rsvpWpm: 300 } }, async companion => {
        const playButton = companion.byId('ttsBtnTop');
        await companion.press(' ');
        assert.equal(playButton.dataset.state, 'playing');
        await companion.clock.tick(250);
        assert.match(companion.byId('rsvpStatus').textContent, /^2 de 9 palavras/);
        await companion.press(' ');
        assert.equal(playButton.dataset.state, 'paused');
        assert.equal(playButton.textContent.trim(), 'Retomar');
    });
});

test('Space on a focused button keeps its normal job', async () => {
    await withCompanion({ state: TEXT, storage: { readingMode: 'rsvp' } }, async companion => {
        await companion.press(' ', companion.byId('finishBtnTop'));
        assert.equal(companion.byId('ttsBtnTop').dataset.state, 'idle');
    });
});

test('Space reads a text lesson aloud in voice mode', async () => {
    await withCompanion({ state: TEXT }, async companion => {
        await companion.press(' ');
        assert.deepEqual(companion.speech.spoken, ['Primeira frase curta. Segunda frase aqui! Terceira frase final.']);
        assert.equal(companion.byId('ttsBtnTop').dataset.state, 'playing');
    });
});

test('number and letter keys choose quiz options', async () => {
    await withCompanion({ state: quiz() }, async companion => {
        await companion.press('2');
        await companion.press('c');
        await companion.press('9'); // there is no ninth option
        assert.deepEqual(companion.ext.messages('SELECT_OPTION').map(message => message.optionId), ['a2', 'a3']);
    });
});

test('Space reads the quiz question and every option aloud', async () => {
    await withCompanion({ state: quiz() }, async companion => {
        await companion.press(' ');
        assert.deepEqual(companion.speech.spoken, [
            'Qual é a resposta?',
            'Selecione uma alternativa',
            'Alternativa A. Primeira',
            'Alternativa B. Segunda',
            'Alternativa C. Terceira'
        ]);
    });
});

test('a new quiz is read automatically only in voice mode with automatic reading on', async () => {
    await withCompanion({ state: quiz(), storage: { autoReadEnabled: true, readingMode: 'tts' } }, async companion => {
        await companion.clock.tick(600);
        assert.equal(companion.speech.spoken.length, 5);
    });
    await withCompanion({ state: quiz(), storage: { autoReadEnabled: true, readingMode: 'rsvp' } }, async companion => {
        await companion.clock.tick(600);
        assert.equal(companion.speech.spoken.length, 0);
    });
});

test('a repeated quiz report does not interrupt the question being read', async () => {
    await withCompanion({ state: quiz() }, async companion => {
        await companion.press(' ');
        const cancels = companion.speech.cancels;
        await companion.show('CONTENT', quiz().data);
        assert.equal(companion.speech.cancels, cancels);
        assert.equal(companion.speech.spoken.length, 5);
    });
});

test('Enter moves on once the quiz is solved', async () => {
    await withCompanion({ state: quiz({ isSolved: true }) }, async companion => {
        await companion.press('Enter');
        assert.equal(companion.ext.messages('FINISH_READING').length, 1);
    });
});

test('the next-lesson button works again on the following quiz', async () => {
    await withCompanion({ state: quiz({ isSolved: true }) }, async companion => {
        const next = companion.byId('quizNextBtn');
        next.click();
        assert.equal(next.disabled, true);
        await companion.show('CONTENT', quiz({ lessonId: '103', isSolved: true }).data);
        assert.equal(next.disabled, false);
        assert.equal(next.classList.contains('hidden'), false);
    });
});

test('the header names the lesson type and the empty state shows without a lesson', async () => {
    await withCompanion({ state: { mode: 'NONE' } }, async companion => {
        assert.equal(companion.byId('view-empty').classList.contains('hidden'), false);
        await companion.show('PLAYER', { ...LESSON, status: 'playing' });
        assert.equal(companion.byId('lessonKind').textContent, 'Vídeo');
        assert.equal(companion.byId('remotePlay').dataset.state, 'playing');
        assert.equal(companion.byId('view-empty').classList.contains('hidden'), true);
        await companion.show('CONTENT', quiz().data);
        assert.equal(companion.byId('lessonKind').textContent, 'Quiz');
    });
});
