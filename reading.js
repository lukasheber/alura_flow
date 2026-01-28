document.addEventListener('DOMContentLoaded', () => {
    let synth = window.speechSynthesis;
    let utterance = null;
    let isSpeaking = false;
    let userStopped = false; // Control flag to distinguish natural end vs manual stop

    // Finish function defined early to be accessible
    const finish = () => {
        // STOP audio if speaking when closing
        if (synth.speaking) {
            userStopped = true; // Mark as forced stop
            synth.cancel();
        }

        // Broadcast finish message to main tab
        // Crucial fix: window.close() must happen AFTER we find the tabs and send the message
        chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { type: 'FINISH_READING' });
            });
            // Close after sending loop
            window.close();
        });
    };

    // Now also fetching 'autoAdvanceEnabled'
    chrome.storage.local.get(['currentReading', 'autoReadEnabled', 'autoAdvanceEnabled'], (result) => {
        if (result.currentReading) {
            document.getElementById('readingTitle').textContent = result.currentReading.title;

            // Render HTML (Main Content)
            const contentDiv = document.getElementById('readingContent');
            contentDiv.innerHTML = result.currentReading.html;

            // Render Opinion if available (BEFORE text extraction)
            let opinionText = "";
            if (result.currentReading.opinionHtml) {
                const opinionSection = document.getElementById('opinionSection');
                const opinionContent = document.getElementById('opinionContent');
                opinionContent.innerHTML = result.currentReading.opinionHtml;
                opinionSection.style.display = 'block';
                // Extract opinion text
                opinionText = "\n\nOpinião do instrutor:\n" + opinionContent.innerText;
            }

            // Prepare clean text (Main Content + Opinion)
            // Using innerText to respect line breaks from HTML
            const cleanText = contentDiv.innerText + opinionText;

            const ttsBtn = document.getElementById('ttsBtn');

            const toggleSpeech = () => {
                if (synth.speaking) {
                    // IF USER CLICKS STOP:
                    userStopped = true; // Set flag
                    synth.cancel();
                    isSpeaking = false;
                    ttsBtn.textContent = "🔊 Ouvir";
                } else {
                    // IF USER CLICKS LISTEN:
                    userStopped = false; // Reset flag
                    utterance = new SpeechSynthesisUtterance(cleanText);
                    utterance.lang = 'pt-BR';
                    utterance.rate = 1.2;

                    // WHEN AUDIO ENDS:
                    utterance.onend = () => {
                        isSpeaking = false;
                        ttsBtn.textContent = "🔊 Ouvir";

                        // Auto-Advance Logic (Only if NOT manually stopped)
                        if (!userStopped && result.autoAdvanceEnabled) {
                            console.log("Reading finished. Auto-advancing...");
                            finish();
                        }
                    };

                    synth.speak(utterance);
                    isSpeaking = true;
                    ttsBtn.textContent = "u23F9 Parar"; // Stop symbol
                }
            };

            if (ttsBtn) {
                ttsBtn.addEventListener('click', toggleSpeech);
            }

            // Auto-Start (if configured)
            if (result.autoReadEnabled) {
                setTimeout(toggleSpeech, 500);
            }
        }
    });

    // Action button listeners
    const topBtn = document.getElementById('topFinishBtn');
    const botBtn = document.getElementById('bottomFinishBtn');

    if (topBtn) topBtn.addEventListener('click', finish);
    if (botBtn) botBtn.addEventListener('click', finish);

    // Safety on manual window close
    window.addEventListener('beforeunload', () => {
        if (synth.speaking) {
            userStopped = true;
            synth.cancel();
        }
    });
});
