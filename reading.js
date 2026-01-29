document.addEventListener('DOMContentLoaded', () => {
    // --- STATE & VARS ---
    let currentMode = 'NONE'; // 'PLAYER' | 'CONTENT'
    let synth = window.speechSynthesis;
    let isSpeaking = false;
    let isPaused = false;
    let userStopped = false;
    let activeUtterances = [];
    let lastClickedOptionId = null;
    let autoReadTimer = null;

    // --- UI ELEMENTS ---
    const connectionLed = document.getElementById('connectionLed');
    const mainTitle = document.getElementById('mainTitle');

    // Views
    const viewPlayer = document.getElementById('view-player');
    const viewContent = document.getElementById('view-content');

    // Content Containers
    const textContainer = document.getElementById('textContainer');
    const quizContainer = document.getElementById('quizContainer');
    const dynamicContent = document.getElementById('dynamicContent');
    const opinionSection = document.getElementById('opinionSection');
    const opinionContent = document.getElementById('opinionContent');

    // Player Controls
    const videoStatusText = document.getElementById('videoStatusText');
    const remotePrev = document.getElementById('remotePrev');
    const remotePlay = document.getElementById('remotePlay');
    const remoteNext = document.getElementById('remoteNext');
    const speedBtns = document.querySelectorAll('.speed-btn');

    // Reading Controls
    const ttsBtn = document.getElementById('ttsBtn');
    const ttsBtnTop = document.getElementById('ttsBtnTop');
    const finishBtn = document.getElementById('finishBtn');
    const finishBtnTop = document.getElementById('finishBtnTop');
    const fab = document.getElementById('ttsFab');

    // --- MODE SWITCHING ---
    window.switchMode = (mode, data) => {
        console.log(`Switching execution mode to: ${mode}`, data);
        currentMode = mode;

        // Reset States
        if (mode !== 'CONTENT') stopSpeaking(); // Auto-stop TTS

        // UI Toggles
        if (mode === 'PLAYER') {
            viewPlayer.classList.remove('hidden');
            viewContent.classList.add('hidden');
            fab.classList.remove('visible'); // Hide FAB in video mode

            // Update Data
            if (data && data.title) mainTitle.textContent = data.title;
            if (data && data.status) videoStatusText.textContent = data.status === 'playing' ? "Reproduzindo..." : "Pausado";

        } else if (mode === 'CONTENT') {
            viewPlayer.classList.add('hidden');
            viewContent.classList.remove('hidden');

            // Render specific content type
            if (data.isQuiz) {
                renderQuiz(data);
            } else {
                renderText(data);
            }
        }
    };

    // --- RENDER FUNCTIONS ---
    function renderText(data) {
        textContainer.classList.remove('hidden');
        quizContainer.classList.add('hidden');
        textContainer.classList.remove('hidden');
        quizContainer.classList.add('hidden');
        const isLoading = data.title && data.title.includes("Carregando");

        if (isLoading) {
            if (ttsBtn) ttsBtn.classList.add('hidden');
            if (ttsBtnTop) ttsBtnTop.classList.add('hidden');
            if (finishBtnTop) finishBtnTop.classList.add('hidden');
            // Also hide bottom finish button if possible or rely on CSS/Logic?
            // Since finishBtn is not toggled in renderText usually, we adding logic:
            if (finishBtn) finishBtn.classList.add('hidden');
        } else {
            if (ttsBtn) ttsBtn.classList.remove('hidden');
            if (ttsBtnTop) ttsBtnTop.classList.remove('hidden');
            if (finishBtnTop) finishBtnTop.classList.remove('hidden');
            if (finishBtn) finishBtn.classList.remove('hidden');
        }

        mainTitle.textContent = data.title || "Leitura";

        let contentChanged = false;

        // Prevent scroll reset if content is identical
        const newHtml = data.html || "";
        if (dynamicContent.innerHTML !== newHtml) {
            dynamicContent.innerHTML = newHtml;
            contentChanged = true;
        }

        // Opinion
        if (data.opinionHtml) {
            if (opinionContent.innerHTML !== data.opinionHtml) {
                opinionContent.innerHTML = data.opinionHtml;
                contentChanged = true;
            }
            opinionSection.classList.remove('hidden');
        } else {
            if (!opinionSection.classList.contains('hidden')) {
                // Was visible, now hidden -> changed
                contentChanged = true;
            }
            opinionSection.classList.add('hidden');
        }

        if (contentChanged) {
            // New Lesson detected! Reset state so Auto-Read can trigger
            console.log("New content detected, resetting TTS state.");
            userStopped = false;

            // Cancel any pending auto-read
            if (autoReadTimer) clearTimeout(autoReadTimer);

            synth.cancel(); // Stop any previous audio
            isSpeaking = false;
            isPaused = false;
            updateFabState();
            updateFabState();
            if (ttsBtn) ttsBtn.textContent = "🔊 Ouvir";
            if (ttsBtnTop) ttsBtnTop.textContent = "🔊 Ouvir";

            // Auto-read check
            chrome.storage.local.get(['autoReadEnabled'], (res) => {
                if (res.autoReadEnabled) {
                    // Debounce start 
                    autoReadTimer = setTimeout(() => {
                        console.log("Auto-Read Timer Frying...");
                        startSpeaking();
                    }, 500);
                }
            });
        }
    }

    function renderQuiz(data) {
        textContainer.classList.add('hidden');
        quizContainer.classList.remove('hidden');
        textContainer.classList.add('hidden');
        quizContainer.classList.remove('hidden');
        if (ttsBtn) ttsBtn.classList.add('hidden');
        if (ttsBtnTop) ttsBtnTop.classList.add('hidden');
        // Hide top finish button in quiz, as quiz has its own flow or reuse bottom?
        // Usually quiz has options, no "finish" button until done. 
        if (finishBtnTop) finishBtnTop.classList.add('hidden');
        mainTitle.textContent = "Quiz"; // Or keep lesson title if available

        document.getElementById('quizQuestion').innerHTML = data.questionHTML || "Pergunta";

        // Render Instruction (e.g. "Select 1 option")
        const instructionEl = document.getElementById('quizInstruction');
        if (instructionEl) {
            instructionEl.innerHTML = data.instructionHTML || "";
            if (data.instructionHTML) instructionEl.classList.remove('hidden');
            else instructionEl.classList.add('hidden');
        }

        const optionsList = document.getElementById('quizOptions');
        optionsList.innerHTML = '';

        if (!data.options) return;

        data.options.forEach((opt, index) => {
            const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            const letter = (index < letters.length ? letters[index] : index + 1);

            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.dataset.id = opt.id;

            if (opt.isCorrect) btn.classList.add('correct');

            // HTML Structure similar to quiz.js
            let html = `
                <div class="opt-main-row">
                    <span class="option-index">${letter}</span>
                    <span>${opt.html}</span>
                </div>
            `;

            // Hint Logic
            let hintHtml = '';
            if (opt.opinionHTML) {
                let cleanHint = opt.opinionHTML.trim();
                // Remove outer parens if present just in case
                if (cleanHint.startsWith('(') && cleanHint.endsWith(')')) {
                    cleanHint = cleanHint.substring(1, cleanHint.length - 1);
                }

                hintHtml = `
                    <div class="opt-hint-row">
                        <span class="hint-toggle"><span style="font-size: 1.1em">🗨️</span> Ver dica</span>
                        <div class="hint-content hidden">${cleanHint}</div>
                    </div>
                `;
            }

            btn.innerHTML = html + hintHtml;
            optionsList.appendChild(btn);

            // Bind Events
            // Hint Toggle
            const toggle = btn.querySelector('.hint-toggle');
            if (toggle) {
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const content = btn.querySelector('.hint-content');
                    const row = btn.querySelector('.opt-hint-row');
                    const isHidden = content.classList.toggle('hidden');

                    if (isHidden) {
                        toggle.innerHTML = '<span style="font-size: 1.1em">🗨️</span> Ver dica';
                        row.classList.remove('active');
                    } else {
                        toggle.innerHTML = '❌ Esconder dica';
                        row.classList.add('active');
                    }
                });
            }

            // Selection
            btn.addEventListener('click', () => {
                // Single select logic for now (simplify)
                document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected', 'wrong'));
                btn.classList.add('selected');
                lastClickedOptionId = opt.id;

                // Send to main tab
                chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (tabs) => {
                    tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'SELECT_OPTION', optionId: opt.id }));
                });
            });
        });
    }

    // --- PLAYER CONTROLS ---
    if (remotePlay) {
        remotePlay.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'COMMAND_PLAY_PAUSE' });
        });
    }
    if (remotePrev) {
        remotePrev.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'COMMAND_PREV' });
        });
    }
    if (remoteNext) {
        remoteNext.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'COMMAND_NEXT' });
        });
    }

    speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = parseFloat(btn.dataset.speed);
            // Visual update
            speedBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Send
            chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (tabs) => {
                tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'UPDATE_SPEED', speed: speed }));
            });
            // Also save
            chrome.storage.local.set({ playbackSpeed: speed });
        });
    });

    // --- TTS LOGIC (Simplified from previous reading.js) ---
    function updateFabState() {
        if (!fab) return;
        if (isSpeaking) {
            fab.classList.add('visible');
            fab.textContent = isPaused ? "▶️" : "⏸️";
        } else {
            fab.classList.remove('visible');
        }
    }

    function getReadableElements(container) {
        const selector = 'p, h1, h2, h3, li';
        const all = Array.from(container.querySelectorAll(selector));
        return all.filter(el => {
            // Filter out elements that contain other selected elements
            // This prevents double reading of <li><p>Text</p></li>
            // We favor the "leaf" nodes (e.g. the p inside the li)
            return !all.some(child => child !== el && el.contains(child));
        });
    }

    function startSpeaking() {
        synth.cancel();
        activeUtterances = [];
        userStopped = false;
        isPaused = false;


        // Gather text
        let elements = getReadableElements(dynamicContent);
        // Include opinion if visible
        if (!opinionSection.classList.contains('hidden')) {
            elements = elements.concat(getReadableElements(opinionContent));
        }

        // Guard: Do not read if Loading or Quiz (unless specific accessibility mode, but simplifying for now)
        if (mainTitle.textContent.includes("Carregando") || mainTitle.textContent === "Quiz") {
            console.log("Skipping TTS for Loading/Quiz state");
            return;
        }

        // Get configured speed
        chrome.storage.local.get(['playbackSpeed', 'autoAdvanceEnabled'], (result) => {
            const rate = result.playbackSpeed || 1.2;
            const autoAdvance = result.autoAdvanceEnabled !== false; // Default true

            if (elements.length === 0) {
                // Fallback
                const u = new SpeechSynthesisUtterance(dynamicContent.innerText + " " + opinionContent.innerText);
                u.lang = 'pt-BR'; u.rate = rate;
                u.onend = () => {
                    // Natural finish
                    document.querySelectorAll('.reading-active').forEach(e => e.classList.remove('reading-active'));
                    isSpeaking = false;
                    updateFabState();
                    updateFabState();
                    if (ttsBtn) ttsBtn.textContent = "🔊 Ouvir";
                    if (ttsBtnTop) ttsBtnTop.textContent = "🔊 Ouvir";

                    if (!userStopped && autoAdvance) finish();
                };
                synth.speak(u);
                isSpeaking = true;
            } else {
                elements.forEach((el, index) => {
                    const text = el.innerText.trim();
                    if (!text) return;
                    const u = new SpeechSynthesisUtterance(text);
                    u.lang = 'pt-BR'; u.rate = rate;

                    u.onstart = () => {
                        // Only scroll if we are actually speaking and haven't been stopped
                        if (userStopped) return;
                        document.querySelectorAll('.reading-active').forEach(e => e.classList.remove('reading-active'));
                        el.classList.add('reading-active');
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    };
                    u.onend = () => {
                        el.classList.remove('reading-active');
                        if (index === elements.length - 1) {
                            // Natural Finish
                            isSpeaking = false;
                            updateFabState();
                            updateFabState();
                            if (ttsBtn) ttsBtn.textContent = "🔊 Ouvir";
                            if (ttsBtnTop) ttsBtnTop.textContent = "🔊 Ouvir";

                            // Only advance if NOT stopped by user
                            if (!userStopped && autoAdvance) finish();
                        }
                    };
                    activeUtterances.push(u);
                    synth.speak(u);
                });
                isSpeaking = true;
            }

            if (ttsBtn) ttsBtn.textContent = "⏹ Parar";
            if (ttsBtnTop) ttsBtnTop.textContent = "⏹ Parar";
            updateFabState();
        });
    }

    // Helper for finish
    function finish() {
        console.log("Auto-Advancing via Runtime...");
        chrome.runtime.sendMessage({ type: 'FINISH_READING' });
    }

    function stopSpeaking() {
        userStopped = true;
        synth.cancel();
        isSpeaking = false;
        isPaused = false;
        if (ttsBtn) ttsBtn.textContent = "🔊 Ouvir";
        if (ttsBtnTop) ttsBtnTop.textContent = "🔊 Ouvir";
        document.querySelectorAll('.reading-active').forEach(e => e.classList.remove('reading-active'));
        updateFabState();
    }

    function toggleSpeech() {
        if (isSpeaking) {
            if (isPaused) {
                synth.resume();
                isPaused = false;
            } else {
                // Determine if we should Pause or Stop?
                // Usually Toggle means Start/Stop for main button, but Pause/Resume for FAB
                stopSpeaking();
            }
        }
        else startSpeaking();
        updateFabState();
    }

    // FAB Logic - Pause/Resume ONLY
    function togglePause() {
        if (!isSpeaking) return;

        if (synth.paused || isPaused) {
            synth.resume();
            isPaused = false;
        } else {
            synth.pause();
            isPaused = true;
        }
        updateFabState();
    }

    if (ttsBtn) ttsBtn.addEventListener('click', toggleSpeech);
    if (ttsBtnTop) ttsBtnTop.addEventListener('click', toggleSpeech);
    if (fab) fab.addEventListener('click', togglePause);

    if (finishBtn) {
        finishBtn.addEventListener('click', () => {
            stopSpeaking();
            finish();
        });
    }
    if (finishBtnTop) {
        finishBtnTop.addEventListener('click', () => {
            stopSpeaking();
            finish();
        });
    }

    // --- MESSAGING ---
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'UPDATE_STATE') {
            // Core Update from Background
            if (msg.mode) switchMode(msg.mode, msg.data);
        }

        // Shortcut Handler
        if (msg.type === 'COMMAND_PLAY_PAUSE') {
            console.log("Shortcut PLAY_PAUSE received. Mode:", currentMode, "isSpeaking:", isSpeaking);
            if (currentMode === 'CONTENT') {
                if (isSpeaking) togglePause();
                else startSpeaking();
            }
        }

        if (msg.type === 'COMMAND_CYCLE_SPEED') {
            chrome.storage.local.get(['playbackSpeed'], (res) => {
                const speeds = [1.0, 1.25, 1.5, 2.0];
                let current = res.playbackSpeed || 1.2; // Fallback default

                // Find next speed
                // Using imprecise matching finding closest
                let idx = speeds.findIndex(s => Math.abs(s - current) < 0.1);
                if (idx === -1) idx = 1; // Default to 1.25 if weird

                let nextIdx = (idx + 1) % speeds.length;
                let nextSpeed = speeds[nextIdx];

                console.log(`Cycling speed: ${current} -> ${nextSpeed}`);

                // Update Storage
                chrome.storage.local.set({ playbackSpeed: nextSpeed });

                // Update UI Buttons
                speedBtns.forEach(btn => {
                    const btnSpeed = parseFloat(btn.dataset.speed);
                    if (Math.abs(btnSpeed - nextSpeed) < 0.1) {
                        btn.classList.add('active');
                        // Trigger visual update event if needed, but handled by button click usually
                    } else {
                        btn.classList.remove('active');
                    }
                });

                // Restart TTS if speaking to apply new speed?
                // Usually SpeechSynthesis doesn't update on the fly easily without restart.
                // For now, next utterance picks it up.

                // If we also want to sync Video from here?
                // The background sends to BOTH, so content.js will handle video.
            });
        }

        // Player Updates
        if (msg.type === 'VIDEO_STATE_CHANGED') {
            if (currentMode === 'PLAYER') {
                if (msg.status === 'playing') {
                    videoStatusText.textContent = "Reproduzindo...";
                    remotePlay.textContent = "⏸️";
                } else {
                    videoStatusText.textContent = "Pausado";
                    remotePlay.textContent = "▶️";
                }
            }
        }

        // Quiz Updates
        if (msg.type === 'QUIZ_FEEDBACK_ERROR') {
            if (currentMode === 'CONTENT' && lastClickedOptionId) {
                const btn = document.querySelector(`.option-btn[data-id="${lastClickedOptionId}"]`);
                if (btn) btn.classList.add('wrong');
            }
        }
        if (msg.type === 'QUIZ_REVEAL_CORRECT') {
            if (msg.correctIds) {
                msg.correctIds.forEach(id => {
                    const btn = document.querySelector(`.option-btn[data-id="${id}"]`);
                    if (btn) btn.classList.add('reveal-correct');
                });
            }
        }

        // Transition Handling (Smart Transitions)
        if (msg.type === 'TRANSITION_START') {
            console.log("Transition Started:", msg.predictedMode);
            stopSpeaking(); // Immediate stop

            if (msg.predictedMode === 'PLAYER') {
                // If not minimized (auto-min is off), show loading in player
                switchMode('PLAYER', { title: "Carregando vídeo...", status: "loading" });
            } else {
                // Show loading state in Content
                switchMode('CONTENT', {
                    title: "Carregando...",
                    html: "<div style='display:flex; justify-content:center; align-items:center; height:100%; color:#888;'><h2>⏳ Carregando próxima lição...</h2></div>",
                    opinionHtml: null
                });
            }
        }
    });

    // --- INITIAL LOAD ---
    // Ask background for current state
    chrome.runtime.sendMessage({ type: 'COMPANION_READY' }, (response) => {
        if (response && response.mode) {
            switchMode(response.mode, response.data);
        } else {
            // Fallback: Check local storage
            chrome.storage.local.get(['currentReading', 'currentQuiz'], (res) => {
                if (res.currentReading) {
                    switchMode('CONTENT', res.currentReading);
                } else {
                    switchMode('PLAYER', { title: "Aguardando conteúdo...", status: "ready" });
                }
            });
        }
    });
});
