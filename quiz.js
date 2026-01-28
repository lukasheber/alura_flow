document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['currentQuiz'], (result) => {
        if (result.currentQuiz) {
            document.getElementById('question').innerHTML = result.currentQuiz.questionHTML;

            // 1. Hint Text Logic
            const hasSuggestions = result.currentQuiz.options.some(o => o.isCorrect);
            const hintSpan = document.getElementById('options-hint');

            let hintText = "";
            if (result.currentQuiz.isMultiple) {
                // Always show how many to select if multiple
                hintText = ` (selecione ${result.currentQuiz.requiredChoices})`;
            } else {
                hintText = " (selecione 1)";
            }

            if (hasSuggestions) {
                if (hintText) hintText += " | opiniões sugeridas destacadas";
                else hintText = " (opinião sugerida destacada)";
            }

            hintSpan.textContent = hintText;
            hintSpan.style.display = hintText ? 'inline' : 'none';

            // 2. Options Rendering
            const optionsContainer = document.getElementById('options');
            result.currentQuiz.options.forEach((opt, index) => {
                const button = document.createElement('button');
                button.className = 'option-btn';
                button.dataset.id = opt.id; // Store ID for easy access

                if (opt.isCorrect) {
                    button.classList.add('correct');
                }

                // Add numbering (A, B, C...)
                const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                const prefix = (index < letters.length ? letters[index] : index + 1) + ")";

                // Create inner structure for alignment
                const indexSpan = document.createElement('span');
                indexSpan.className = 'option-index';
                indexSpan.textContent = prefix;

                const contentWrapper = document.createElement('div');
                contentWrapper.style.display = "flex";
                contentWrapper.style.flexDirection = "column";

                const textSpan = document.createElement('span');
                textSpan.innerHTML = opt.html;

                contentWrapper.appendChild(textSpan);

                // Add Hidden Hint (Opinion)
                if (opt.opinionHTML) {
                    const opinionSpan = document.createElement('span');
                    opinionSpan.className = 'opinion-text';
                    // Strip heavy paragraphs if needed, or just insert
                    opinionSpan.innerHTML = `(${opt.opinionHTML})`; // Parentheses as requested
                    contentWrapper.appendChild(opinionSpan);
                }

                button.appendChild(indexSpan);
                button.appendChild(contentWrapper);

                button.addEventListener('click', () => {
                    // Visual Toggle
                    if (result.currentQuiz.isMultiple) {
                        button.classList.toggle('selected');
                    } else {
                        // Clear others
                        document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                        button.classList.add('selected');
                    }

                    // Clear previous error states
                    document.querySelectorAll('.option-btn.wrong').forEach(b => b.classList.remove('wrong'));

                    lastClickedOptionId = opt.id;
                    selectOption(opt.id);
                });

                optionsContainer.appendChild(button);
            });
        }
    });
});

let lastClickedOptionId = null;

function selectOption(optionId) {
    chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
                type: 'SELECT_OPTION',
                optionId: optionId
            });
        });
    });
}

// Listen for Messages
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CLOSE_QUIZ_WINDOW') {
        window.close();
    }

    if (message.type === 'QUIZ_FEEDBACK_ERROR') {
        // Mark the last selected option as wrong (Red)
        if (lastClickedOptionId) {
            const btn = document.querySelector(`.option-btn[data-id="${lastClickedOptionId}"]`);
            if (btn) btn.classList.add('wrong');
        }
    }

    if (message.type === 'QUIZ_REVEAL_CORRECT') {
        // Highlight the correct answer IDs (Pulsing Green)
        const correctIds = message.correctIds || []; // Array of strings
        correctIds.forEach(id => {
            const btn = document.querySelector(`.option-btn[data-id="${id}"]`);
            if (btn) btn.classList.add('reveal-correct');
        });
    }
});
