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

    function quizFeedbackFingerprint(optionStates, feedbackText = '') {
        const states = Array.isArray(optionStates) ? optionStates : [];
        const wrongIds = states.flatMap((state, index) => state?.incorrect ? [String(index)] : []);
        const correctIds = states.flatMap((state, index) => state?.correct ? [String(index)] : []);
        const text = String(feedbackText).toLocaleLowerCase('pt-BR');
        const success = /acertou|parabéns/.test(text) || (correctIds.length > 0 && wrongIds.length === 0);
        const error = /errou|tente novamente/.test(text) || wrongIds.length > 0;
        const fingerprint = success ? `success:${correctIds.join(',')}` : error ? `error:${wrongIds.join(',')}:${text}` : '';
        return { success, error, wrongIds, correctIds, fingerprint };
    }

    function isLoadingState(data) {
        if (!data) return false;
        if (data.isLoading === true || data.status === 'loading') return true;
        const title = String(data.title || '').toLocaleLowerCase('pt-BR');
        return /\b(carregando|preparando)\b/.test(title);
    }

    function nextPlaybackSpeed(currentSpeed, steps = [1, 1.25, 1.5, 2]) {
        const speeds = Array.from(new Set(steps.map(Number).filter(speed => Number.isFinite(speed) && speed > 0))).sort((a, b) => a - b);
        if (!speeds.length) return 1;
        const current = Number(currentSpeed);
        if (!Number.isFinite(current)) return speeds[0];
        return speeds.find(speed => speed > current + 0.01) || speeds[0];
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
            const courseIndex = parts.findIndex(part => part === 'course' || part === 'cursos');
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
        quizFeedbackFingerprint,
        isLoadingState,
        nextPlaybackSpeed,
        chooseControlledTab,
        courseIdFromUrl,
        lessonIdFromUrl
    };
})(globalThis);
