(function (root) {
    'use strict';

    function classTokens(value) {
        return String(value || '').toLowerCase().split(/\s+/).filter(Boolean);
    }

    function classIndicatesCorrect(value) {
        const tokens = new Set(classTokens(value));
        if (classIndicatesIncorrect(value)) return false;
        return Array.from(tokens).some(token =>
            token === 'correct' || token === 'success' || token === 'alternativelist-item--correct' ||
            /(^|-)feedback-success($|-)/.test(token) || /(^|-)alternative-correct($|-)/.test(token)
        );
    }

    function classIndicatesIncorrect(value) {
        return classTokens(value).some(token =>
            token === 'incorrect' || token === 'wrong' || token === 'alternativelist-item--incorrect' ||
            /(^|-)feedback-error($|-)/.test(token) || /(^|-)alternative-incorrect($|-)/.test(token)
        );
    }

    function opinionIndicatesCorrect(value) {
        const text = String(value || '').toLocaleLowerCase('pt-BR');
        if (/\bincorreta\b/u.test(text)) return false;
        return /\bcorreta\b/u.test(text);
    }

    function isQuizSolved(options, isMultiple, requiredChoices, explicitlySuccessful) {
        if (explicitlySuccessful === true) return true;
        if (!Array.isArray(options) || options.length === 0) return false;
        const selected = options.filter(option => option && option.isSelected);
        if (selected.length === 0 || selected.some(option => !option.isCorrect)) return false;
        if (!isMultiple) return selected.length === 1 && selected[0].isCorrect === true;
        const required = Number(requiredChoices) || options.filter(option => option && option.isCorrect).length;
        return required > 0 && selected.length === required && selected.every(option => option.isCorrect === true);
    }

    function quizSelectionRules(instruction) {
        const text = String(instruction || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const requiredChoices = Number(text.match(/selecione\s+(\d+)/i)?.[1] || 0);
        const isMultiple = requiredChoices > 1 || /\balternativas\b/i.test(text);
        return { isMultiple, requiredChoices };
    }

    function quizFeedbackFingerprint(optionStates, feedbackText = '', requiredChoices = 1) {
        const states = Array.isArray(optionStates) ? optionStates : [];
        const wrongIds = states.flatMap((state, index) => state?.incorrect ? [String(index)] : []);
        const correctIds = states.flatMap((state, index) => state?.correct ? [String(index)] : []);
        const text = String(feedbackText).toLocaleLowerCase('pt-BR');
        const required = Math.max(1, Number(requiredChoices) || 1);
        const success = /acertou|parabéns/.test(text) || (correctIds.length >= required && wrongIds.length === 0);
        const error = /errou|tente novamente/.test(text) || wrongIds.length > 0;
        const partial = !success && !error && correctIds.length > 0;
        const fingerprint = success ? `success:${correctIds.join(',')}` : error ? `error:${wrongIds.join(',')}:${text}` : partial ? `partial:${correctIds.join(',')}:${required}` : '';
        return { success, error, partial, wrongIds, correctIds, fingerprint };
    }

    function isLoadingState(data) {
        if (!data) return false;
        if (data.isLoading === true || data.status === 'loading') return true;
        const title = String(data.displayTitle || data.title || '').toLocaleLowerCase('pt-BR');
        return /\b(carregando|preparando)\b/.test(title);
    }

    function canReadLesson(data) {
        return Boolean(data) && data.isQuiz !== true && !isLoadingState(data);
    }

    function nextPlaybackSpeed(currentSpeed, steps = [1, 1.25, 1.5, 2]) {
        const speeds = Array.from(new Set(steps.map(Number).filter(speed => Number.isFinite(speed) && speed > 0))).sort((a, b) => a - b);
        if (!speeds.length) return 1;
        const current = Number(currentSpeed);
        if (!Number.isFinite(current)) return speeds[0];
        return speeds.find(speed => speed > current + 0.01) || speeds[0];
    }

    function effectivePlaybackSpeed(settings = {}, courseId = null) {
        const profileSpeed = settings.perCourseSettings !== false && courseId
            ? Number(settings.courseProfiles?.[courseId]?.playbackSpeed)
            : NaN;
        if (Number.isFinite(profileSpeed) && profileSpeed > 0) return profileSpeed;
        const speed = Number(settings.playbackSpeed);
        return Number.isFinite(speed) && speed > 0 ? speed : 1;
    }

    // With per-course profiles on, a speed chosen inside a course belongs to that
    // course only; the default stays as is for courses without their own speed.
    function playbackSpeedUpdate(settings = {}, courseId, speed) {
        if (settings.perCourseSettings !== false && courseId) {
            const courseProfiles = { ...(settings.courseProfiles || {}) };
            courseProfiles[courseId] = { ...(courseProfiles[courseId] || {}), playbackSpeed: speed };
            return { courseProfiles };
        }
        return { playbackSpeed: speed };
    }

    function shouldOfferUndo(autoAdvanceReason) {
        return autoAdvanceReason !== 'quiz';
    }

    function isReadableTextCandidate(text, blockCount) {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        return Number(blockCount) > 0 && normalized.length >= 20;
    }

    function textFingerprint(value) {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
        let hash = 2166136261;
        for (let index = 0; index < normalized.length; index += 1) {
            hash ^= normalized.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `${normalized.length}:${(hash >>> 0).toString(36)}`;
    }

    function parseRsvpText(value) {
        return String(value || '').trim().split(/\s+/).filter(Boolean);
    }

    function shouldAutoStartReading(autoStartOverride, globalSetting) {
        return autoStartOverride === undefined ? globalSetting !== false : autoStartOverride === true;
    }

    function canAutoStartRsvp(attention = {}) {
        return attention.documentVisible === true &&
            attention.documentFocused === true &&
            attention.windowFocused === true;
    }

    function rsvpOrpIndex(word) {
        const value = String(word || '');
        if (!value) return 0;
        const letterCount = (value.match(/\p{L}/gu) || []).length;
        let target = 0;
        if (letterCount <= 3) target = 0;
        else if (letterCount <= 5) target = 1;
        else if (letterCount <= 9) target = 2;
        else if (letterCount <= 12) target = 3;
        else target = Math.floor(Math.log2(letterCount - 1)) + 1;

        let seen = 0;
        for (let index = 0; index < value.length; index += 1) {
            if (!/\p{L}/u.test(value[index])) continue;
            if (seen === target) return index;
            seen += 1;
        }
        return Math.min(target, Math.max(0, value.length - 1));
    }

    function splitRsvpWord(word) {
        const value = String(word || '');
        if (!value) return { before: '', focus: '', after: '' };
        const index = rsvpOrpIndex(value);
        return { before: value.slice(0, index), focus: value[index] || '', after: value.slice(index + 1) };
    }

    function rsvpWordDelay(word, wordsPerMinute, options = {}) {
        const wpm = Math.min(1200, Math.max(50, Number(wordsPerMinute) || 300));
        let delay = 60000 / wpm;
        const value = String(word || '');
        const longWordPercent = Math.max(0, Number(options.longWordPercent ?? 5));
        if (value.length >= 12 && longWordPercent > 0) {
            delay *= 1 + (longWordPercent / 100) * (value.length - 12);
        }
        if (options.pauseOnPunctuation !== false) {
            if (/[.!?;:][”’"'»)\]]?$/.test(value)) delay *= Math.max(1, Number(options.punctuationMultiplier) || 2);
            else if (/,[”’"'»)\]]?$/.test(value)) delay *= 1.5;
        }
        return Math.round(delay);
    }

    function isSentenceEnd(word) {
        return /[.!?…][”’"'»)\]]*$/.test(String(word || ''));
    }

    function rsvpSentenceStart(words, index) {
        if (!Array.isArray(words) || !words.length) return 0;
        let start = Math.min(Math.max(0, Number(index) || 0), words.length - 1);
        while (start > 0 && !isSentenceEnd(words[start - 1])) start -= 1;
        return start;
    }

    // Like "previous track": back to the start of the current sentence, or to the
    // previous sentence when already at (or one word into) the start.
    function rsvpPreviousSentenceIndex(words, index) {
        const start = rsvpSentenceStart(words, index);
        if (start === 0 || index - start > 1) return start;
        return rsvpSentenceStart(words, start - 1);
    }

    // First word of the next sentence; stays put in the last sentence so skipping
    // ahead never finishes the reading (which could trigger auto-advance).
    function rsvpNextSentenceIndex(words, index) {
        if (!Array.isArray(words)) return 0;
        for (let current = Math.max(0, Number(index) || 0); current < words.length - 1; current += 1) {
            if (isSentenceEnd(words[current])) return current + 1;
        }
        return Math.max(0, Math.min(Number(index) || 0, words.length - 1));
    }

    // Pauses at punctuation make the real time a little longer; this is an estimate.
    function rsvpTimeLeftLabel(wordsLeft, wordsPerMinute) {
        const words = Math.max(0, Number(wordsLeft) || 0);
        if (!words) return 'fim';
        const minutes = words / Math.min(1200, Math.max(50, Number(wordsPerMinute) || 300));
        return minutes < 1 ? 'falta menos de 1 min' : `faltam ~${Math.round(minutes)} min`;
    }

    // Keys 1–9 or the option letters shown in the companion (A, B, C…).
    function quizOptionIndexForKey(key, optionCount) {
        const value = String(key || '');
        let index = -1;
        if (/^[1-9]$/.test(value)) index = Number(value) - 1;
        else if (/^[a-z]$/i.test(value)) index = value.toLowerCase().charCodeAt(0) - 97;
        return index >= 0 && index < Number(optionCount) ? index : null;
    }

    // Maps a key pressed in the companion to an action, or null to leave it to the browser.
    function companionKeyAction(key, context = {}) {
        if (context.view === 'quiz') {
            const index = quizOptionIndexForKey(key, context.optionCount);
            if (index !== null) return { type: 'select-option', index };
            if (key === ' ') return { type: 'toggle-speech' };
            if (key === 'Enter' && context.quizSolved) return { type: 'next-lesson' };
            return null;
        }
        if (context.view === 'text') {
            if (key === ' ') return { type: 'toggle-reading' };
            if (context.readingMode === 'rsvp' && key === 'ArrowLeft') return { type: 'previous-sentence' };
            if (context.readingMode === 'rsvp' && key === 'ArrowRight') return { type: 'next-sentence' };
        }
        return null;
    }

    function chooseControlledTab(tabs, boundTabId) {
        const list = Array.isArray(tabs) ? tabs : [];
        if (Number.isInteger(boundTabId)) {
            const bound = list.find(tab => tab.id === boundTabId);
            if (bound) return bound;
        }
        return list.slice().sort((a, b) => {
            if (Boolean(a.active) !== Boolean(b.active)) return a.active ? -1 : 1;
            return Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
        })[0] || null;
    }

    function courseIdFromUrl(rawUrl) {
        try {
            const url = new URL(rawUrl);
            const parts = url.pathname.split('/').filter(Boolean);
            const courseIndex = parts.findIndex(part => part === 'course' || part === 'cursos' || part === 'classpage');
            if (courseIndex >= 0 && parts[courseIndex + 1]) return parts[courseIndex + 1];
            const taskIndex = parts.indexOf('task');
            if (taskIndex > 0) return parts.slice(0, taskIndex).join('/');
            return parts.slice(0, 2).join('/') || url.hostname;
        } catch (_) {
            return 'alura';
        }
    }

    function lessonIdFromUrl(rawUrl) {
        try {
            const url = new URL(rawUrl);
            const taskMatch = url.pathname.match(/\/task\/(\d+)/);
            return taskMatch ? taskMatch[1] : `${url.pathname}${url.search}`;
        } catch (_) {
            return String(rawUrl || 'unknown');
        }
    }

    root.AluraFlowCore = {
        classIndicatesCorrect,
        classIndicatesIncorrect,
        opinionIndicatesCorrect,
        isQuizSolved,
        quizSelectionRules,
        quizFeedbackFingerprint,
        isLoadingState,
        canReadLesson,
        nextPlaybackSpeed,
        effectivePlaybackSpeed,
        playbackSpeedUpdate,
        shouldOfferUndo,
        isReadableTextCandidate,
        textFingerprint,
        parseRsvpText,
        shouldAutoStartReading,
        canAutoStartRsvp,
        rsvpOrpIndex,
        splitRsvpWord,
        rsvpWordDelay,
        rsvpSentenceStart,
        rsvpPreviousSentenceIndex,
        rsvpNextSentenceIndex,
        rsvpTimeLeftLabel,
        quizOptionIndexForKey,
        companionKeyAction,
        chooseControlledTab,
        courseIdFromUrl,
        lessonIdFromUrl
    };
})(globalThis);
