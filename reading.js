document.addEventListener('DOMContentLoaded', () => {
    let synth = window.speechSynthesis;
    let utterance = null;
    let isSpeaking = false;

    chrome.storage.local.get(['currentReading', 'autoReadEnabled'], (result) => {
        if (result.currentReading) {
            document.getElementById('readingTitle').textContent = result.currentReading.title;

            // Renderiza o HTML visualmente
            const contentDiv = document.getElementById('readingContent');
            contentDiv.innerHTML = result.currentReading.html;

            // Prepara o texto limpo para o TTS
            // Usamos innerText para pegar o texto visível e respeitar quebras de linha
            const cleanText = contentDiv.innerText;

            // Configura o botão TTS
            const ttsBtn = document.getElementById('ttsBtn');

            // Função de Toggle (Falar/Parar)
            const toggleSpeech = () => {
                if (synth.speaking) {
                    synth.cancel();
                    isSpeaking = false;
                    ttsBtn.textContent = "🔊 Ouvir";
                } else {
                    utterance = new SpeechSynthesisUtterance(cleanText);
                    utterance.lang = 'pt-BR'; // Força português
                    utterance.rate = 1.2; // Um pouco mais rápido que o padrão fica mais natural

                    utterance.onend = () => {
                        isSpeaking = false;
                        ttsBtn.textContent = "🔊 Ouvir";
                    };

                    synth.speak(utterance);
                    isSpeaking = true;
                    ttsBtn.textContent = "u23F9 Parar"; // Símbolo de Stop
                }
            };

            if (ttsBtn) {
                ttsBtn.addEventListener('click', toggleSpeech);
            }

            // Auto-Start se a config estiver ativa
            if (result.autoReadEnabled) {
                // Pequeno delay para garantir que a janela carregou
                setTimeout(toggleSpeech, 500);
            }

            // Render Opinion if available
            if (result.currentReading.opinionHtml) {
                const opinionSection = document.getElementById('opinionSection');
                document.getElementById('opinionContent').innerHTML = result.currentReading.opinionHtml;
                opinionSection.style.display = 'block';
            }
        }
    });

    const finish = () => {
        // PARAR o áudio se estiver falando
        if (synth.speaking) {
            synth.cancel();
        }

        chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { type: 'FINISH_READING' });
            });
        });
        window.close();
    };

    // Parar áudio se o usuário fechar a janela manualmente (no X)
    window.addEventListener('beforeunload', () => {
        if (synth.speaking) {
            synth.cancel();
        }
    });

    document.getElementById('topFinishBtn').addEventListener('click', finish);
    document.getElementById('bottomFinishBtn').addEventListener('click', finish);
});
