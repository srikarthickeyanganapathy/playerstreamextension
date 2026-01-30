/**
 * FastStream Mobile - Content Sniffer
 * Runs in "ISOLATED" world. Injects interceptor and relays messages to background.
 */

// 1. Inject the hook script into the MAIN world
const script = document.createElement('script');
script.src = chrome.runtime.getURL('content/interceptor.js');
script.onload = function () {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// 2. Listen for messages from the interceptor
window.addEventListener('message', (event) => {
    // Security check: only accept messages from same window
    if (event.source !== window) return;

    const message = event.data;
    if (message && message.source === 'faststream-interceptor') {

        // Relay to Background Service Worker
        chrome.runtime.sendMessage({
            action: message.type, // STREAM_FOUND or MSE_INIT
            payload: message.payload
        }).catch(err => {
            // Ignore errors if background is sleeping or not ready
            // console.warn('[FastStream] Background relay failed', err);
        });
    }
});

// 3. Simple DOM scanner for <video> tags (Fallback)
function scanVideoTags() {
    const videos = document.getElementsByTagName('video');
    for (const video of videos) {
        if (video.src && (video.src.includes('.m3u8') || video.src.includes('.mpd'))) {
            chrome.runtime.sendMessage({
                action: 'STREAM_FOUND',
                payload: { url: video.src, method: 'dom_scan', type: video.src.includes('.m3u8') ? 'hls' : 'dash' }
            });
        }
    }
}

// Scan on load and DOM mutations
scanVideoTags();
const observer = new MutationObserver(() => scanVideoTags());
observer.observe(document.documentElement, { childList: true, subtree: true });

// 4. Proxy Fetch for Authenticated Downloads (Solution 2: Main World Proxy)
// TIMEOUT: 30s - if main world doesn't respond, fail gracefully
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'FETCH_PROXY') {
        const id = crypto.randomUUID();
        const TIMEOUT_MS = 30000;
        let responded = false;
        let timeoutId = null;

        // Merge headers (base + range)
        const fetchHeaders = message.headers || {};
        if (message.range) {
            fetchHeaders['Range'] = `bytes=${message.range}`;
        }

        // Relay request to MAIN world (interceptor.js)
        window.postMessage({
            type: 'FETCH_PAGE',
            id,
            url: message.url,
            headers: fetchHeaders
        }, '*');

        // Handler for response from main world
        const handler = (event) => {
            if (responded) return;
            if (event.data?.id === id && event.data.source === 'faststream-interceptor') {
                responded = true;
                clearTimeout(timeoutId);
                window.removeEventListener('message', handler);

                if (event.data.type === 'FETCH_RESULT') {
                    if (message.responseType === 'text') {
                        const uint8 = new Uint8Array(event.data.buffer);
                        const text = new TextDecoder().decode(uint8);
                        sendResponse({ success: true, data: { text } });
                    } else {
                        sendResponse({ success: true, data: { buffer: event.data.buffer } });
                    }
                } else {
                    sendResponse({ success: false, error: event.data.error });
                }
            }
        };

        window.addEventListener('message', handler);

        // Timeout: fail if main world doesn't respond in time
        timeoutId = setTimeout(() => {
            if (!responded) {
                responded = true;
                window.removeEventListener('message', handler);
                sendResponse({
                    success: false,
                    error: `Main world fetch timeout (${TIMEOUT_MS}ms) - page may have navigated`
                });
            }
        }, TIMEOUT_MS);

        return true; // Async response
    }

    // 5. INJECT PLAYER OVERLAY INTO PAGE (inline via modular architecture)
    if (message.action === 'INJECT_PLAYER') {
        const hasVideo = document.querySelector('video') !== null;

        if (!hasVideo) {
            sendResponse({ success: true, skipped: true });
            return true;
        }

        if (window.__FASTSTREAM_PLAYER_INJECTED__) {
            sendResponse({ success: true, skipped: true });
            return true;
        }

        console.log('[FastStream] Injecting modular player');

        // Load modules in order: network -> player -> ui -> index
        const modules = [
            'content/overlay/network.js',
            'content/overlay/player.js',
            'content/overlay/ui.js',
            'content/overlay/index.js'
        ];

        async function injectModules() {
            // First inject stream info
            const infoScript = document.createElement('script');
            infoScript.textContent = `window.__FASTSTREAM_STREAM_INFO__ = ${JSON.stringify(message.streamInfo)};`;
            (document.head || document.documentElement).appendChild(infoScript);
            infoScript.remove();

            // Load and inject each module
            for (const modPath of modules) {
                const response = await fetch(chrome.runtime.getURL(modPath));
                const code = await response.text();
                const script = document.createElement('script');
                script.textContent = code;
                (document.head || document.documentElement).appendChild(script);
                script.remove();
            }
        }

        injectModules()
            .then(() => {
                console.log('[FastStream] All modules injected');
                sendResponse({ success: true });
            })
            .catch(err => {
                console.error('[FastStream] Module injection failed:', err);
                sendResponse({ success: false, error: err.message });
            });

        return true;
    }
});
