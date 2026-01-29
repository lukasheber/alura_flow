document.addEventListener('DOMContentLoaded', () => {
    function setSafeHTML(element, html) {
        if (!element) return;
        element.innerHTML = '';
        if (!html) return;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        Array.from(doc.body.childNodes).forEach(node => element.appendChild(node));
    }

    chrome.storage.local.get(['currentQuiz'], (result) => {
        if (result.currentQuiz) {
            setSafeHTML(document.getElementById('question'), result.currentQuiz.questionHTML);

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
            // Clear previous options (safety)
            optionsContainer.innerHTML = '';

            result.currentQuiz.options.forEach((opt, index) => {
                const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                const letter = (index < letters.length ? letters[index] : index + 1);

                // 1. Main Button (Option Container)
                const btn = document.createElement('button');
                btn.className = 'option-btn';
                btn.dataset.id = opt.id; // Store ID for easy access

                if (opt.isCorrect) {
                    btn.classList.add('correct');
                }

                // 2. Main Row (Index + HTML Content)
                const mainRow = document.createElement('div');
                mainRow.className = 'opt-main-row';

                const indexSpan = document.createElement('span');
                indexSpan.className = 'option-index';
                indexSpan.textContent = letter;

                const textSpan = document.createElement('span');
                setSafeHTML(textSpan, opt.html);

                mainRow.appendChild(indexSpan);
                mainRow.appendChild(textSpan);
                btn.appendChild(mainRow);

                // 3. Spoiler Logic (Hint), if exists
                if (opt.opinionHTML) {
                    const hintRow = document.createElement('div');
                    hintRow.className = 'opt-hint-row';

                    // The "link" to toggle hint
                    const toggleTrigger = document.createElement('span');
                    toggleTrigger.className = 'hint-toggle';
                    toggleTrigger.innerHTML = '<span style="font-size: 1.1em">🗨️</span> Ver dica';

                    // The hint content container (hidden by default)
                    const hintContent = document.createElement('div');
                    hintContent.className = 'hint-content hidden';

                    // Remove parentheses manually if present
                    let cleanHint = opt.opinionHTML;
                    if (cleanHint.trim().startsWith('(') && cleanHint.trim().endsWith(')')) {
                        cleanHint = cleanHint.trim().substring(1, cleanHint.trim().length - 1);
                    }
                    setSafeHTML(hintContent, cleanHint);

                    // Click event ONLY on the trigger
                    toggleTrigger.onclick = (e) => {
                        // IMPORTANT: Prevent clicking hint from selecting the answer
                        e.stopPropagation();

                        const isHidden = hintContent.classList.toggle('hidden');
                        if (isHidden) {
                            setSafeHTML(toggleTrigger, '<span style="font-size: 1.1em">🗨️</span> Ver dica');
                            hintRow.classList.remove('active');
                        } else {
                            toggleTrigger.textContent = '❌ Esconder dica';
                            hintRow.classList.add('active');
                        }
                    };

                    hintRow.appendChild(toggleTrigger);
                    hintRow.appendChild(hintContent);
                    btn.appendChild(hintRow);
                }

                // 4. Click Event on Main Button (Select Answer)
                btn.onclick = () => {
                    // Visual Toggle
                    if (result.currentQuiz.isMultiple) {
                        btn.classList.toggle('selected');
                    } else {
                        // Clear others
                        document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                        btn.classList.add('selected');
                    }

                    // Clear previous error states
                    document.querySelectorAll('.option-btn.wrong').forEach(b => b.classList.remove('wrong'));

                    lastClickedOptionId = opt.id;
                    selectOption(opt.id);
                };

                optionsContainer.appendChild(btn);
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
