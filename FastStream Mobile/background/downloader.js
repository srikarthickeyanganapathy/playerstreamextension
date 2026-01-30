/**
 * FastStream Mobile - Parallel Downloader
 * Handles concurrent fetching of segments with Retry logic and Range support.
 */

export class SegmentDownloader {
    constructor(bufferManager, tabId) {
        this.bufferManager = bufferManager;
        this.tabId = tabId;
        this.queue = [];
        this.activeRequests = 0;
        this.concurrency = 3;
        this.bandwidthEstimates = [];
        this.activeControllers = new Set(); // Track for aborts
        this.isPaused = false;
    }

    /**
     * Update concurrency based on network conditions
     * @param {number} bufferLevel - Current buffer length in seconds
     * @param {number} latency - Network latency in ms
     */
    adjustConcurrency(bufferLevel, latency) {
        // Simple logic:
        // High latency (>200ms) + Low Buffer (<5s) = INCREASE concurrency (up to 8)
        // Low latency + High Buffer = DECREASE concurrency (save battery, down to 2)

        if (latency > 200 && bufferLevel < 5) {
            this.concurrency = Math.min(8, this.concurrency + 1);
        } else if (bufferLevel > 30) {
            this.concurrency = Math.max(2, this.concurrency - 1);
        }
    }

    /**
     * Abort all active downloads and clear queue.
     * Used during SEEK operations or fatal errors.
     */
    async start(streamInfo) {
        if (this.started) return;
        this.started = true;
        this.baseHeaders = streamInfo.headers || {}; // Store for segments
        console.log('[Downloader] Starting HLS resolution for:', streamInfo.url);

        try {
            // 1. Initial Fetch (Master or Media?)
            // Use Proxy Fetch to ensure cookies/referer are attached
            // Pass baseHeaders (captured from engine)
            let responseData = await this._proxyFetch(streamInfo.url, 'text', null, null, this.baseHeaders);
            let text = responseData.text;
            let baseUrl = streamInfo.url.substring(0, streamInfo.url.lastIndexOf('/') + 1);

            // 2. Check for Master Playlist (Variants)
            if (text.includes('#EXT-X-STREAM-INF')) {
                console.log('[Downloader] Master playlist detected. Resolving variant...');

                // Simple parser to find the first variant URL
                // Look for line starting with #EXT-X-STREAM-INF, then take the NEXT line
                const lines = text.split('\n');
                let variantUrl = null;

                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                        // The URL is the next non-empty, non-comment line
                        for (let j = i + 1; j < lines.length; j++) {
                            const nextLine = lines[j].trim();
                            if (nextLine && !nextLine.startsWith('#')) {
                                variantUrl = nextLine;
                                break;
                            }
                        }
                        if (variantUrl) break; // Pick first for now
                    }
                }

                if (variantUrl) {
                    // Resolve relative URL
                    if (!variantUrl.startsWith('http')) {
                        variantUrl = new URL(variantUrl, baseUrl).href;
                    }
                    console.log('[Downloader] Selected variant:', variantUrl);

                    // Fetch the Media Playlist via Proxy
                    // Pass baseHeaders here too? Or should we use captured headers for variant?
                    // Typically same headers apply.
                    responseData = await this._proxyFetch(variantUrl, 'text', null, null, this.baseHeaders);
                    text = responseData.text;

                    // Update base URL for segments
                    baseUrl = variantUrl.substring(0, variantUrl.lastIndexOf('/') + 1);
                } else {
                    console.warn('[Downloader] Master playlist found but no variants extracted.');
                }
            }

            // 3. Parse Media Playlist (Segments)
            // Look for #EXTINF: duration, title
            // Followed by the URL
            const lines = text.split('\n');

            // Parse Sequence Start
            let sequence = 0;
            const seqMatch = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
            if (seqMatch) {
                sequence = parseInt(seqMatch[1], 10);
                console.log('[Downloader] Sequence start:', sequence);
            }
            this.mediaSequence = sequence; // Store for engine to read

            let count = sequence;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                if (line.startsWith('#EXTINF:')) {
                    // The next non-empty line is the segment
                    let segmentUrl = null;
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j].trim();
                        if (nextLine && !nextLine.startsWith('#')) {
                            segmentUrl = nextLine;
                            // Advance i to skip this line in outer loop (optional but cleaner)
                            i = j;
                            break;
                        }
                    }

                    if (segmentUrl) {
                        if (!segmentUrl.startsWith('http')) {
                            segmentUrl = new URL(segmentUrl, baseUrl).href;
                        }

                        this.addSegment(segmentUrl, streamInfo.streamId || 'default', count++);
                        if (count - sequence >= 20) break; // Increased prototype limit to 20
                    }
                }
            }

            if (count === sequence) {
                console.warn('[Downloader] No segments found in media playlist');
            } else {
                console.log(`[Downloader] Queued ${count - sequence} segments (Seq: ${sequence} -> ${count}).`);
            }

        } catch (e) {
            console.error('[Downloader] Start failed:', e);
        }
    }

    reset() {
        console.log('[Downloader] Resetting pipeline...');
        this.started = false;

        // 1. Abort active fetch controllers
        // We need to track controllers to do this properly
        // For this prototype, we rely on the implementation below updating to store them.
        this.activeControllers.forEach(c => c.abort());
        this.activeControllers.clear();

        // 2. Clear queue
        this.queue = [];
        this.activeRequests = 0;
        this.isPaused = false;
    }

    pause() {
        console.log('[Downloader] Paused');
        this.isPaused = true;
    }

    resume() {
        if (this.isPaused) {
            console.log('[Downloader] Resuming');
            this.isPaused = false;
            this._processQueue();
        }
    }

    /**
     * Add segment to download queue
     */
    addSegment(url, streamId, segmentId, rangeStart = null, rangeEnd = null) {
        this.queue.push({ url, streamId, segmentId, rangeStart, rangeEnd, retries: 0 });
        this._processQueue();
    }

    async _processQueue() {
        if (this.isPaused || this.activeRequests >= this.concurrency || this.queue.length === 0) return;

        const task = this.queue.shift();
        this.activeRequests++;
        console.log(`[Downloader] Starting segment ${task.segmentId}, Active: ${this.activeRequests}`);

        // Track controller for abort capability
        const controller = new AbortController();
        this.activeControllers.add(controller);

        try {
            const start = Date.now();

            // Switch to Proxy Fetch
            // Response has { buffer: Array<number> } because we can't send ArrayBuffer directly over some channels easily, 
            // but Chromium messaging usually handles valid JSON types. 
            // We'll standardise that the content script returns a serializable format.
            const responseData = await this._proxyFetch(task.url, 'arraybuffer', task.rangeStart, task.rangeEnd);

            // If data comes back as array of numbers (safe fallback), convert. 
            // If it comes back as base64 or other, handle it.
            // Assuming content script returns { buffer: [...] } or serializes well.
            // For robustness, let's assume valid ArrayBuffer or Array.
            let arrayBuffer;
            if (responseData.buffer && Array.isArray(responseData.buffer)) {
                arrayBuffer = new Uint8Array(responseData.buffer).buffer;
            } else {
                // Might come through as object if serialised weirdly
                arrayBuffer = responseData;
            }

            const data = arrayBuffer;
            const duration = Date.now() - start;

            // Update estimates
            this.bandwidthEstimates.push(data.byteLength / (duration / 1000)); // bytes per sec
            this.adjustConcurrency(0, duration); // bufferLevel would come from engine

            // Store
            await this.bufferManager.storeSegment(task.streamId, task.segmentId, data);

            // Notification (optional, usually handled by StreamManager polling DB)

        } catch (err) {
            if (err.name === 'AbortError') {
                console.log(`[Downloader] Segment ${task.segmentId} aborted.`);
            } else {
                console.error('[Downloader] Failed segment', task.segmentId, err);
                // Handle fatal failure (notify engine)
            }
        } finally {
            this.activeControllers.delete(controller);
            this.activeRequests--;
            this._processQueue();
        }
    }

    /**
     * Proxy Fetch via Content Script
     * Routes all network requests through the original tab to inherit auth context.
     * TIMEOUT: 30s - if original tab is dead/navigated, we fail gracefully.
     */
    async _proxyFetch(url, responseType = 'text', rangeStart = null, rangeEnd = null, headers = {}) {
        const PROXY_TIMEOUT_MS = 30000;

        const fetchPromise = new Promise((resolve, reject) => {
            if (!this.tabId) {
                return reject(new Error('No tabId for proxy fetch - original tab context lost'));
            }

            // Verify tab still exists before sending
            chrome.tabs.get(this.tabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    return reject(new Error(`Original tab ${this.tabId} no longer exists - stream dead`));
                }

                chrome.tabs.sendMessage(this.tabId, {
                    action: 'FETCH_PROXY',
                    url: url,
                    responseType: responseType,
                    range: (rangeStart !== null && rangeEnd !== null) ? `${rangeStart}-${rangeEnd}` : null,
                    headers: headers
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(new Error(`Tab communication failed: ${chrome.runtime.lastError.message}`));
                    }
                    if (response && response.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error(response ? response.error : 'Unknown proxy error'));
                    }
                });
            });
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Proxy fetch timeout (${PROXY_TIMEOUT_MS}ms) - original tab may have navigated away`));
            }, PROXY_TIMEOUT_MS);
        });

        return Promise.race([fetchPromise, timeoutPromise]);
    }

    /**
     * Fetch with exponential backoff and Range support
     * DEPRECATED: Replaced by _proxyFetch, keeping for reference or direct fallback
     */
    async _fetchWithRetry(task, controller = null) {
        // ... implementation logic remains but unused/fallback ...
        const MAX_RETRIES = 3;
        const headers = {}; // Native fallback

        if (task.rangeStart !== null && task.rangeEnd !== null) {
            headers['Range'] = `bytes=${task.rangeStart}-${task.rangeEnd}`;
        }

        const signal = controller ? controller.signal : undefined;

        try {
            const response = await fetch(task.url, { headers, signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.arrayBuffer();
        } catch (e) {
            throw e;
        }
    }
}
