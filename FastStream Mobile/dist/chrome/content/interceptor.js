/**
 * FastStream Mobile - In-Page Interceptor
 * Runs in the "MAIN" world to hook native browser APIs.
 */

(function () {
    console.log('[FastStream] Interceptor injected');

    // Helper to send data to content script
    function notify(type, payload) {
        window.postMessage({
            source: 'faststream-interceptor',
            type: type,
            payload: payload
        }, '*');
    }

    // =========================================================================
    // 1. Network Hook (Fetch & XHR)
    // =========================================================================
    const originalFetch = window.fetch;
    const originalXHR = window.XMLHttpRequest.prototype.open;

    // Hook Fetch
    window.fetch = async function (...args) {
        const [resource, config] = args;
        const url = (resource instanceof Request) ? resource.url : resource;

        if (url && (typeof url === 'string')) {
            if (url.includes('.m3u8') || url.includes('.mpd')) {
                notify('STREAM_FOUND', { url, method: 'fetch', type: url.includes('.m3u8') ? 'hls' : 'dash' });
            }
        }
        return originalFetch.apply(this, args);
    };

    // Hook XHR
    window.XMLHttpRequest.prototype.open = function (method, url) {
        if (url && (typeof url === 'string')) {
            if (url.includes('.m3u8') || url.includes('.mpd')) {
                notify('STREAM_FOUND', { url, method: 'xhr', type: url.includes('.m3u8') ? 'hls' : 'dash' });
            }
        }
        return originalXHR.apply(this, arguments);
    };

    // =========================================================================
    // 2. MediaSource Hook (The "Netflix" Hook)
    // =========================================================================
    // Detects when the page is manually building a stream buffer
    if (window.MediaSource) {
        const originalAddSourceBuffer = window.MediaSource.prototype.addSourceBuffer;

        window.MediaSource.prototype.addSourceBuffer = function (mimeType) {
            console.log('[FastStream] MediaSource initialized with:', mimeType);

            // If the page is using MSE, it's definitely a stream we want to hijack/monitor
            notify('MSE_INIT', { mimeType, timestamp: Date.now() });

            // We can even trace where this buffer came from if we track SourceBuffers
            const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);

            // Hook appendBuffer to see what's being pushed (advanced debugging)
            // const originalAppend = sourceBuffer.appendBuffer;
            // sourceBuffer.appendBuffer = function(data) {
            //    return originalAppend.call(this, data);
            // }

            return sourceBuffer;
        };
    }

    // =========================================================================
    // 3. Video Element Hook
    // =========================================================================
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (descriptor && descriptor.set) {
        const originalSet = descriptor.set;
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            set: function (value) {
                if (value && (value.includes('.m3u8') || value.includes('.mpd'))) {
                    notify('STREAM_FOUND', { url: value, method: 'video.src', type: value.includes('.m3u8') ? 'hls' : 'dash' });
                }
                return originalSet.call(this, value);
            },
            get: descriptor.get
        });
    }

    // =========================================================================
    // 4. Main World Fetch Proxy (Fix for Firefox / Protected Streams)
    // This runs IN THE PAGE CONTEXT so it inherits cookies, session, TLS fingerprint.
    // IMPORTANT: Use XHR, not fetch! Original players use XHR and CDNs may fingerprint.
    // =========================================================================
    window.addEventListener('message', (event) => {
        if (event.data?.type === 'FETCH_PAGE') {
            const requestId = event.data.id;
            const url = event.data.url;
            const customHeaders = event.data.headers || {};

            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.withCredentials = true; // Include cookies

            // Set custom headers (browser will ignore protected ones like Origin/Cookie)
            const blockedHeaders = ['Host', 'Cookie', 'Origin', 'Content-Length', 'Connection'];
            for (const [name, value] of Object.entries(customHeaders)) {
                if (!blockedHeaders.includes(name)) {
                    try {
                        xhr.setRequestHeader(name, value);
                    } catch (e) {
                        // Some headers can't be set, ignore
                    }
                }
            }

            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const buf = xhr.response;
                    window.postMessage({
                        source: 'faststream-interceptor',
                        type: 'FETCH_RESULT',
                        id: requestId,
                        buffer: Array.from(new Uint8Array(buf))
                    }, '*');
                } else {
                    window.postMessage({
                        source: 'faststream-interceptor',
                        type: 'FETCH_ERROR',
                        id: requestId,
                        error: `HTTP ${xhr.status}: ${xhr.statusText}`
                    }, '*');
                }
            };

            xhr.onerror = function () {
                window.postMessage({
                    source: 'faststream-interceptor',
                    type: 'FETCH_ERROR',
                    id: requestId,
                    error: `XHR NetworkError: CDN blocked request - ${url}`
                }, '*');
            };

            xhr.ontimeout = function () {
                window.postMessage({
                    source: 'faststream-interceptor',
                    type: 'FETCH_ERROR',
                    id: requestId,
                    error: 'XHR timeout'
                }, '*');
            };

            xhr.send();
        }
    });

})();
