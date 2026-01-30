/**
 * FastStream Mobile - Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
    const list = document.getElementById('stream-list');
    const emptyState = document.getElementById('empty-state');

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Real messaging:
    chrome.runtime.sendMessage({ action: 'GET_STREAMS', tabId: tab.id }, (response) => {
        list.innerHTML = ''; // Clear loading/mock state

        if (response && response.streams && response.streams.length > 0) {
            emptyState.style.display = 'none';

            response.streams.forEach(stream => {
                const item = document.createElement('li');
                item.className = 'stream-item';
                item.innerHTML = `
                    <div class="stream-info">
                        <span class="stream-type ${stream.type}">${stream.type.toUpperCase()}</span>
                        <span class="stream-url" title="${stream.url || 'Internal'}">${stream.url || 'MediaSource Stream'}</span>
                    </div>
                    <button class="btn-launch" data-id="${stream.id}">Launch</button>
                `;

                item.querySelector('.btn-launch').addEventListener('click', async (e) => {
                    const streamId = e.target.getAttribute('data-id');
                    const btn = e.target;
                    btn.textContent = 'Injecting...';
                    btn.disabled = true;

                    // Send message to content script to inject player
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'INJECT_PLAYER',
                        streamId: streamId,
                        streamInfo: stream
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            btn.textContent = 'Error!';
                            console.error('Inject failed:', chrome.runtime.lastError);
                            return;
                        }
                        if (response && response.success) {
                            // Close popup - player is now active in page
                            window.close();
                        } else {
                            btn.textContent = 'Failed';
                            console.error('Inject failed:', response?.error);
                        }
                    });
                });

                list.appendChild(item);
            });
        } else {
            emptyState.style.display = 'block';
            emptyState.textContent = 'No streams detected. Refresh page to sniff.';
        }
    });
});
