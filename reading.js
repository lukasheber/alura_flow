document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['currentReading'], (result) => {
        if (result.currentReading) {
            document.getElementById('readingTitle').textContent = result.currentReading.title;
            // Alura content is HTML, so we use innerHTML. 
            // Warning: Ensure source is trusted (Alura is trusted context here).
            document.getElementById('readingContent').innerHTML = result.currentReading.html;

            // Render Opinion if available
            if (result.currentReading.opinionHtml) {
                const opinionSection = document.getElementById('opinionSection');
                const opinionContent = document.getElementById('opinionContent');
                opinionContent.innerHTML = result.currentReading.opinionHtml;
                opinionSection.style.display = 'block';
            }
        } else {
            document.getElementById('readingContent').textContent = "No reading content found.";
        }
    });

    const finish = () => {
        // Broadcast finish message
        chrome.tabs.query({ url: "*://*.alura.com.br/*" }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { type: 'FINISH_READING' });
            });
        });
        // Close self
        window.close();
    };

    document.getElementById('topFinishBtn').addEventListener('click', finish);
    document.getElementById('bottomFinishBtn').addEventListener('click', finish);
});
