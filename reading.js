document.addEventListener('DOMContentLoaded', () => {
    let synth = window.speechSynthesis;
    let isSpeaking = false;
    let isPaused = false;
    let userStopped = false; // Control flag
    let activeUtterances = []; // Keep track of utterances

    // UI Elements
    const fab = document.getElementById('ttsFab');
    const ttsBtn = document.getElementById('ttsBtn');
    const contentDiv = document.getElementById('readingContent');

    // --- Control Functions ---

    const updateFabState = () => {
        if (!fab) return;
        if (isSpeaking) {
            fab.classList.add('visible');
            fab.textContent = isPaused ? "▶️" : "⏸️";
        } else {
            fab.classList.remove('visible');
        }
    };

    const pauseResumeSpeech = () => {
        if (!isSpeaking) return;

        if (synth.paused) {
            synth.resume();
            isPaused = false;
        } else {
            synth.pause();
            isPaused = true;
        }
        updateFabState();
    };

    // Finish function
    const finish = () => {
        if (synth.speaking) {
            userStopped = true;
            synth.cancel();
        }
        // Broadcast finish message
        chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { type: 'FINISH_READING' });
            });
            window.close();
        });
    };

    chrome.storage.local.get(['currentReading', 'autoReadEnabled', 'autoAdvanceEnabled', 'playbackSpeed'], (result) => {
        if (result.currentReading) {
            document.getElementById('readingTitle').textContent = result.currentReading.title;

            // Render HTML
            contentDiv.innerHTML = result.currentReading.html;

            // Render Opinion
            const opinionSection = document.getElementById('opinionSection');
            const opinionContent = document.getElementById('opinionContent');
            if (result.currentReading.opinionHtml) {
                opinionContent.innerHTML = result.currentReading.opinionHtml;
                opinionSection.style.display = 'block';
            }

            // --- Block-based Reading Logic ---
            const speakContent = () => {
                // Clear previous
                synth.cancel();
                activeUtterances = [];
                userStopped = false;
                isPaused = false;

                // Select elements from Main Content
                let elements = Array.from(contentDiv.querySelectorAll('p, h1, h2, h3, h4, li, div.formattedText > div'));

                // Select elements from Opinion (if visible)
                if (result.currentReading.opinionHtml) {
                    // Add a "virtual" element or header for the opinion title could be nice, 
                    // but for now let's just add the opinion paragraphs.
                    const opinionElements = Array.from(opinionContent.querySelectorAll('p, h1, h2, h3, h4, li, div.formattedText > div'));
                    if (opinionElements.length > 0) {
                        elements = elements.concat(opinionElements);
                    }
                }

                const rate = result.playbackSpeed || 1.2;

                // Fallback if no structure found
                if (elements.length === 0) {
                    const allText = contentDiv.innerText + (result.currentReading.opinionHtml ? "\n" + opinionContent.innerText : "");
                    const u = new SpeechSynthesisUtterance(allText);
                    u.lang = 'pt-BR'; u.rate = rate;

                    u.onend = () => {
                        isSpeaking = false;
                        updateFabState();
                        if (ttsBtn) ttsBtn.textContent = "🔊 Ouvir";
                        if (!userStopped && result.autoAdvanceEnabled) finish();
                    };

                    synth.speak(u);
                    isSpeaking = true;
                    if (ttsBtn) ttsBtn.textContent = "u23F9 Parar";
                    updateFabState();
                    return;
                }

                // Process elements
                elements.forEach((el, index) => {
                    const text = el.innerText.trim();
                    if (!text) return; // Skip empty

                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.lang = 'pt-BR';
                    utterance.rate = rate;

                    // Event: Start reading block
                    utterance.onstart = () => {
                        // Remove highlight from all
                        // Note: We use a broad selector to ensure cleanup, 
                        // or we could just track the 'previous' one. 
                        // Broad selector is safer for async sync issues.
                        document.querySelectorAll('.reading-active').forEach(e => e.classList.remove('reading-active'));

                        // Add to current
                        el.classList.add('reading-active');
                        // Smooth Scroll
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    };

                    // Event: End reading block
                    utterance.onend = () => {
                        el.classList.remove('reading-active');

                        // If LAST element
                        if (index === elements.length - 1) {
                            isSpeaking = false;
                            updateFabState();
                            if (ttsBtn) ttsBtn.textContent = "🔊 Ouvir";

                            if (!userStopped && result.autoAdvanceEnabled) {
                                finish();
                            }
                        }
                    };

                    utterance.onerror = () => {
                        console.log("TTS Error on block", index);
                        el.classList.remove('reading-active');
                    };

                    activeUtterances.push(utterance);
                    synth.speak(utterance);
                });

                isSpeaking = true;
                if (ttsBtn) ttsBtn.textContent = "u23F9 Parar";
                updateFabState();
            };

            const stopSpeaking = () => {
                userStopped = true;
                synth.cancel();
                isSpeaking = false;
                isPaused = false;
                if (ttsBtn) ttsBtn.textContent = "🔊 Ouvir";
                updateFabState();
                // Clear highlights
                document.querySelectorAll('.reading-active').forEach(el => el.classList.remove('reading-active'));
            };

            const toggleSpeech = () => {
                if (synth.speaking || isSpeaking) {
                    stopSpeaking();
                } else {
                    speakContent();
                }
            };

            if (ttsBtn) {
                ttsBtn.addEventListener('click', toggleSpeech);
            }

            if (fab) {
                fab.addEventListener('click', pauseResumeSpeech);
            }

            // Auto-Start
            if (result.autoReadEnabled) {
                setTimeout(toggleSpeech, 500);
            }

            // Listen for Global Messages
            chrome.runtime.onMessage.addListener((message) => {
                if (message.type === 'COMMAND_PLAY_PAUSE') {
                    if (isSpeaking) {
                        pauseResumeSpeech();
                    } else {
                        speakContent();
                    }
                }
                // Ignoring cycle speed for now to avoid complexity in mid-stream updates
            });
        }
    });

    // Button Listeners
    const topBtn = document.getElementById('topFinishBtn');
    const botBtn = document.getElementById('bottomFinishBtn');

    if (topBtn) topBtn.addEventListener('click', finish);
    if (botBtn) botBtn.addEventListener('click', finish);

    // Safety
    window.addEventListener('beforeunload', () => {
        if (synth.speaking) {
            synth.cancel();
        }
    });
});
