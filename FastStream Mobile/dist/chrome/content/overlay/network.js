/**
 * FastStream Overlay - Network Layer
 * Handles playlist parsing, segment fetching, retry logic, and live stream support.
 */

const Network = (function () {
    const RETRY_ATTEMPTS = 3;
    const RETRY_BACKOFF_MS = 1000;
    const LIVE_REFRESH_MS = 4000;

    let pendingXHRs = [];
    let liveRefreshTimer = null;
    let isLive = false;
    let mediaSequence = 0;
    let downloadedSegments = new Set();

    // Wait helper
    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // XHR fetch with abort tracking
    function xhrFetch(url, responseType = 'arraybuffer') {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            pendingXHRs.push(xhr);

            xhr.open('GET', url, true);
            xhr.responseType = responseType;
            xhr.timeout = 30000;

            xhr.onload = () => {
                pendingXHRs = pendingXHRs.filter(x => x !== xhr);
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({
                        data: responseType === 'text' ? xhr.responseText : xhr.response,
                        status: xhr.status,
                        url: xhr.responseURL || url
                    });
                } else {
                    reject({ status: xhr.status, message: `HTTP ${xhr.status}` });
                }
            };

            xhr.onerror = () => {
                pendingXHRs = pendingXHRs.filter(x => x !== xhr);
                reject({ status: 0, message: 'Network error' });
            };

            xhr.ontimeout = () => {
                pendingXHRs = pendingXHRs.filter(x => x !== xhr);
                reject({ status: 0, message: 'Timeout' });
            };

            xhr.send();
        });
    }

    // Fetch with retry and exponential backoff
    async function fetchWithRetry(url, responseType = 'arraybuffer', attempts = RETRY_ATTEMPTS) {
        let lastError;
        for (let i = 0; i < attempts; i++) {
            try {
                return await xhrFetch(url, responseType);
            } catch (e) {
                lastError = e;

                // Don't retry on auth failures
                if (e.status === 403 || e.status === 401) {
                    throw { ...e, fatal: true, message: 'Authentication expired' };
                }

                // Don't retry on gone
                if (e.status === 410) {
                    throw { ...e, fatal: true, message: 'Stream ended' };
                }

                // Skip on 404 (segment rotated)
                if (e.status === 404) {
                    throw { ...e, skip: true, message: 'Segment not found' };
                }

                if (i < attempts - 1) {
                    await wait(RETRY_BACKOFF_MS * (i + 1));
                }
            }
        }
        throw lastError;
    }

    // Parse HLS master playlist
    function parseMasterPlaylist(text, baseUrl) {
        const lines = text.split('\n');
        const variants = [];
        let currentVariant = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                currentVariant = {};
                const attrs = line.substring(18);

                // Parse BANDWIDTH
                const bwMatch = attrs.match(/BANDWIDTH=(\d+)/);
                if (bwMatch) currentVariant.bitrate = parseInt(bwMatch[1]);

                // Parse RESOLUTION
                const resMatch = attrs.match(/RESOLUTION=(\d+x\d+)/);
                if (resMatch) currentVariant.resolution = resMatch[1];

            } else if (currentVariant && line && !line.startsWith('#')) {
                currentVariant.url = resolveUrl(line, baseUrl);
                variants.push(currentVariant);
                currentVariant = null;
            }
        }

        // Sort by bitrate descending
        return variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    }

    // Parse HLS media playlist
    function parseMediaPlaylist(text, baseUrl) {
        const lines = text.split('\n');
        const segments = [];
        let duration = 0;
        let seq = 0;

        // Check if live
        isLive = !text.includes('#EXT-X-ENDLIST');

        // Get media sequence
        for (const line of lines) {
            if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                seq = parseInt(line.split(':')[1]);
                mediaSequence = seq;
                break;
            }
        }

        let segDuration = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line.startsWith('#EXTINF:')) {
                segDuration = parseFloat(line.split(':')[1].split(',')[0]);
            } else if (line && !line.startsWith('#') && segDuration > 0) {
                const url = resolveUrl(line, baseUrl);
                const segId = `${seq}_${url}`;

                if (!downloadedSegments.has(segId)) {
                    segments.push({
                        url,
                        duration: segDuration,
                        sequence: seq,
                        id: segId
                    });
                }

                duration += segDuration;
                segDuration = 0;
                seq++;
            }
        }

        return { segments, duration, isLive, mediaSequence };
    }

    // Resolve relative URLs
    function resolveUrl(url, base) {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        return new URL(url, base).href;
    }

    // Fetch and parse master playlist
    async function fetchMasterPlaylist(url) {
        const response = await fetchWithRetry(url, 'text');
        const text = response.data;
        const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

        // Check if this is master or media playlist
        if (text.includes('#EXT-X-STREAM-INF')) {
            const variants = parseMasterPlaylist(text, baseUrl);
            return { type: 'master', variants, baseUrl };
        } else {
            const media = parseMediaPlaylist(text, baseUrl);
            return { type: 'media', ...media, baseUrl };
        }
    }

    // Fetch media playlist
    async function fetchMediaPlaylist(url) {
        const response = await fetchWithRetry(url, 'text');
        const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
        return parseMediaPlaylist(response.data, baseUrl);
    }

    // Fetch segment
    async function fetchSegment(url) {
        const response = await fetchWithRetry(url, 'arraybuffer');
        return response.data;
    }

    // Mark segment as downloaded
    function markDownloaded(segmentId) {
        downloadedSegments.add(segmentId);
    }

    // Start live refresh loop
    function startLiveRefresh(playlistUrl, onNewSegments) {
        if (liveRefreshTimer) clearInterval(liveRefreshTimer);

        liveRefreshTimer = setInterval(async () => {
            try {
                const playlist = await fetchMediaPlaylist(playlistUrl);
                if (playlist.segments.length > 0) {
                    onNewSegments(playlist.segments);
                }
            } catch (e) {
                console.warn('[Network] Live refresh error:', e.message);
            }
        }, LIVE_REFRESH_MS);
    }

    // Abort all pending requests
    function abortAll() {
        pendingXHRs.forEach(xhr => {
            try { xhr.abort(); } catch (e) { }
        });
        pendingXHRs = [];

        if (liveRefreshTimer) {
            clearInterval(liveRefreshTimer);
            liveRefreshTimer = null;
        }
    }

    // Reset state
    function reset() {
        abortAll();
        downloadedSegments.clear();
        isLive = false;
        mediaSequence = 0;
    }

    return {
        fetchMasterPlaylist,
        fetchMediaPlaylist,
        fetchSegment,
        markDownloaded,
        startLiveRefresh,
        abortAll,
        reset,
        isLive: () => isLive
    };
})();

// Export for module bundling
if (typeof window !== 'undefined') {
    window.FastStreamNetwork = Network;
}
