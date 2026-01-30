/**
 * FastStream Mobile - In-Page Interceptor
 * Minimal hooks for stream detection. Runs in MAIN world.
 */
(function () {
    // Guard against double-hooking
    if (window.__FASTSTREAM_HOOKED__) return;
    window.__FASTSTREAM_HOOKED__ = true;

    const originalFetch = window.fetch;
    const originalXHROpen = window.XMLHttpRequest.prototype.open;

    function notify(type, payload) {
        window.postMessage({ source: 'faststream-interceptor', type, payload }, '*');
    }

    // Hook Fetch for stream detection
    window.fetch = async function (...args) {
        const url = (args[0] instanceof Request) ? args[0].url : String(args[0]);
        if (url.includes('.m3u8') || url.includes('.mpd')) {
            notify('STREAM_FOUND', { url, method: 'fetch', type: url.includes('.m3u8') ? 'hls' : 'dash' });
        }
        return originalFetch.apply(this, args);
    };

    // Hook XHR for stream detection
    window.XMLHttpRequest.prototype.open = function (method, url) {
        if (typeof url === 'string' && (url.includes('.m3u8') || url.includes('.mpd'))) {
            notify('STREAM_FOUND', { url, method: 'xhr', type: url.includes('.m3u8') ? 'hls' : 'dash' });
        }
        return originalXHROpen.apply(this, arguments);
    };

    // Hook video.src
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (srcDescriptor?.set) {
        const originalSet = srcDescriptor.set;
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            set(value) {
                if (value && (value.includes('.m3u8') || value.includes('.mpd'))) {
                    notify('STREAM_FOUND', { url: value, method: 'video.src', type: value.includes('.m3u8') ? 'hls' : 'dash' });
                }
                return originalSet.call(this, value);
            },
            get: srcDescriptor.get
        });
    }

    // Main world fetch proxy for authenticated downloads
    window.addEventListener('message', (event) => {
        if (event.data?.type !== 'FETCH_PAGE') return;

        const { id, url, headers = {} } = event.data;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.withCredentials = true;

        const blockedHeaders = ['Host', 'Cookie', 'Origin', 'Content-Length', 'Connection'];
        Object.entries(headers).forEach(([name, value]) => {
            if (!blockedHeaders.includes(name)) {
                try { xhr.setRequestHeader(name, value); } catch (e) { }
            }
        });

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                window.postMessage({
                    source: 'faststream-interceptor',
                    type: 'FETCH_RESULT',
                    id,
                    buffer: Array.from(new Uint8Array(xhr.response))
                }, '*');
            } else {
                window.postMessage({
                    source: 'faststream-interceptor',
                    type: 'FETCH_ERROR',
                    id,
                    error: `HTTP ${xhr.status}`
                }, '*');
            }
        };

        xhr.onerror = () => window.postMessage({
            source: 'faststream-interceptor', type: 'FETCH_ERROR', id, error: 'Network error'
        }, '*');

        xhr.ontimeout = () => window.postMessage({
            source: 'faststream-interceptor', type: 'FETCH_ERROR', id, error: 'Timeout'
        }, '*');

        xhr.send();
    });
})();
