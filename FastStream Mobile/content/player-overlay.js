/**
 * FastStream Mobile - In-Page Player Overlay
 * Self-contained player that runs in the page's MAIN world.
 * Includes mux.js integration for TS → fMP4 transmuxing.
 */

(function () {
    // Prevent double injection
    if (window.__FASTSTREAM_PLAYER_INJECTED__) {
        console.log('[FastStream] Player already injected');
        return;
    }
    window.__FASTSTREAM_PLAYER_INJECTED__ = true;

    console.log('[FastStream] Injecting player overlay...');

    // =========================================================================
    // 1. STYLES
    // =========================================================================
    const styles = `
        #faststream-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: 2147483647;
            background: #000;
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #faststream-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent);
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            z-index: 10;
        }
        #faststream-header .title {
            color: #fff;
            font-weight: 600;
            font-size: 14px;
        }
        #faststream-header .status {
            padding: 4px 8px;
            border-radius: 4px;
            background: #333;
            color: #4CAF50;
            font-size: 11px;
        }
        #faststream-close {
            background: rgba(255,255,255,0.2);
            border: none;
            color: #fff;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #faststream-close:hover {
            background: rgba(255,255,255,0.3);
        }
        #faststream-video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #000;
        }
        #faststream-controls {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 16px;
            background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
            display: flex;
            align-items: center;
            gap: 12px;
        }
        #faststream-playbtn {
            background: rgba(255,255,255,0.2);
            border: none;
            color: #fff;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        }
        #faststream-timeline {
            flex: 1;
            height: 4px;
            background: rgba(255,255,255,0.2);
            border-radius: 2px;
            position: relative;
        }
        #faststream-progress {
            height: 100%;
            background: #4CAF50;
            width: 0%;
            border-radius: 2px;
        }
        #faststream-buffer {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background: rgba(255,255,255,0.3);
            width: 0%;
            border-radius: 2px;
        }
        #faststream-stats {
            position: absolute;
            top: 60px;
            left: 16px;
            background: rgba(0,0,0,0.7);
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 11px;
            color: #aaa;
        }
        #faststream-stats .stat-row {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 4px;
        }
        #faststream-stats .stat-value {
            color: #fff;
            font-family: monospace;
        }
        #faststream-error {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255,0,0,0.2);
            border: 1px solid #f44;
            padding: 16px 24px;
            border-radius: 8px;
            color: #fff;
            text-align: center;
            display: none;
        }
        #faststream-loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #fff;
            font-size: 16px;
        }
    `;

    // =========================================================================
    // 2. HTML
    // =========================================================================
    const html = `
        <div id="faststream-overlay">
            <div id="faststream-header">
                <span class="title">FastStream Player</span>
                <span class="status" id="faststream-status">Loading mux.js...</span>
                <button id="faststream-close">✕</button>
            </div>
            <video id="faststream-video" playsinline></video>
            <div id="faststream-stats">
                <div class="stat-row"><span>Buffer:</span><span class="stat-value" id="fs-stat-buffer">0s</span></div>
                <div class="stat-row"><span>Segments:</span><span class="stat-value" id="fs-stat-segments">0</span></div>
                <div class="stat-row"><span>Downloaded:</span><span class="stat-value" id="fs-stat-dl">0 KB</span></div>
            </div>
            <div id="faststream-controls">
                <button id="faststream-playbtn">▶</button>
                <div id="faststream-timeline">
                    <div id="faststream-buffer"></div>
                    <div id="faststream-progress"></div>
                </div>
            </div>
            <div id="faststream-error"></div>
            <div id="faststream-loading">Loading transmuxer...</div>
        </div>
    `;

    // =========================================================================
    // 3. INJECT INTO DOM & PAUSE ORIGINAL VIDEO
    // =========================================================================
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);

    // Pause the original video in this frame
    document.querySelectorAll('video').forEach(v => {
        if (v.id !== 'faststream-video' && !v.paused) {
            v.pause();
            console.log('[FastStream] Paused original video');
        }
    });

    // =========================================================================
    // 4. PLAYER ELEMENTS
    // =========================================================================
    const video = document.getElementById('faststream-video');
    const statusEl = document.getElementById('faststream-status');
    const errorEl = document.getElementById('faststream-error');
    const loadingEl = document.getElementById('faststream-loading');
    const playBtn = document.getElementById('faststream-playbtn');
    const progressEl = document.getElementById('faststream-progress');
    const bufferEl = document.getElementById('faststream-buffer');
    const statBuffer = document.getElementById('fs-stat-buffer');
    const statSegments = document.getElementById('fs-stat-segments');
    const statDl = document.getElementById('fs-stat-dl');

    // Close button - FULL CLEANUP
    document.getElementById('faststream-close').addEventListener('click', () => {
        console.log('[FastStream] Closing player...');

        // Stop our video completely
        video.pause();
        video.src = '';
        video.load();

        // Remove overlay and styles
        const overlay = document.getElementById('faststream-overlay');
        if (overlay) overlay.remove();
        styleEl.remove();

        // Reset injection flag
        window.__FASTSTREAM_PLAYER_INJECTED__ = false;
    });

    // Play/Pause
    playBtn.addEventListener('click', () => {
        if (video.paused) {
            video.play();
            playBtn.textContent = '⏸';
        } else {
            video.pause();
            playBtn.textContent = '▶';
        }
    });

    // Progress update
    video.addEventListener('timeupdate', () => {
        if (video.duration && isFinite(video.duration)) {
            progressEl.style.width = (video.currentTime / video.duration * 100) + '%';
        }
    });

    // Get stream info
    const streamInfo = window.__FASTSTREAM_STREAM_INFO__;
    if (!streamInfo) {
        showError('No stream info found');
        return;
    }

    console.log('[FastStream] Stream info:', streamInfo);

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
        loadingEl.style.display = 'none';
        statusEl.textContent = 'Error';
        statusEl.style.color = '#f44';
    }

    // =========================================================================
    // 5. LOAD MUX.JS FROM CDN
    // =========================================================================
    const muxScript = document.createElement('script');
    muxScript.src = 'https://cdn.jsdelivr.net/npm/mux.js@7.0.3/dist/mux.min.js';
    muxScript.onload = () => {
        console.log('[FastStream] mux.js loaded');
        loadingEl.style.display = 'none';
        initPlayer();
    };
    muxScript.onerror = () => {
        showError('Failed to load mux.js transmuxer');
    };
    document.head.appendChild(muxScript);

    function initPlayer() {
        // =====================================================================
        // 6. MSE + TRANSMUXER SETUP
        // =====================================================================
        let mediaSource = null;
        let videoBuffer = null;
        let audioBuffer = null;
        let transmuxer = null;
        let totalDownloaded = 0;
        let segmentCount = 0;
        let segments = [];
        let currentSegment = 0;
        let baseUrl = '';
        let videoInitDone = false;
        let audioInitDone = false;
        let videoQueue = [];
        let audioQueue = [];
        let isVideoAppending = false;
        let isAudioAppending = false;

        function updateStats() {
            try {
                if (video.buffered.length > 0) {
                    const buffered = video.buffered.end(0) - video.currentTime;
                    statBuffer.textContent = buffered.toFixed(1) + 's';
                    if (video.duration && isFinite(video.duration)) {
                        bufferEl.style.width = (video.buffered.end(0) / video.duration * 100) + '%';
                    }
                }
            } catch (e) { /* ignore */ }
            statSegments.textContent = segmentCount;
            statDl.textContent = (totalDownloaded / 1024).toFixed(0) + ' KB';
        }

        setInterval(updateStats, 500);

        // Create transmuxer
        transmuxer = new muxjs.mp4.Transmuxer({
            keepOriginalTimestamps: true,
            remux: false
        });

        // Handle transmuxed data
        transmuxer.on('data', (segment) => {
            console.log('[FastStream] Transmuxed segment:', segment.type);

            // Create init segment + data
            const initSegment = new Uint8Array(segment.initSegment.byteLength + segment.data.byteLength);
            initSegment.set(segment.initSegment, 0);
            initSegment.set(segment.data, segment.initSegment.byteLength);

            if (segment.type === 'video') {
                videoQueue.push(initSegment);
                processVideoQueue();
            } else if (segment.type === 'audio') {
                audioQueue.push(initSegment);
                processAudioQueue();
            }
        });

        transmuxer.on('done', () => {
            console.log('[FastStream] Transmux done');
        });

        function processVideoQueue() {
            if (isVideoAppending || !videoBuffer || videoBuffer.updating || videoQueue.length === 0) return;
            if (mediaSource.readyState !== 'open') return;

            const data = videoQueue.shift();
            try {
                isVideoAppending = true;
                videoBuffer.appendBuffer(data);
            } catch (e) {
                console.error('[FastStream] Video append error:', e.message);
                isVideoAppending = false;
            }
        }

        function processAudioQueue() {
            if (isAudioAppending || !audioBuffer || audioBuffer.updating || audioQueue.length === 0) return;
            if (mediaSource.readyState !== 'open') return;

            const data = audioQueue.shift();
            try {
                isAudioAppending = true;
                audioBuffer.appendBuffer(data);
            } catch (e) {
                console.error('[FastStream] Audio append error:', e.message);
                isAudioAppending = false;
            }
        }

        // Initialize MSE
        mediaSource = new MediaSource();
        video.src = URL.createObjectURL(mediaSource);

        mediaSource.addEventListener('sourceopen', () => {
            console.log('[FastStream] MSE Source Open');
            statusEl.textContent = 'Fetching playlist...';

            try {
                // Create SEPARATE buffers for video and audio
                const videoCodec = 'video/mp4; codecs="avc1.64001f"';
                const audioCodec = 'audio/mp4; codecs="mp4a.40.2"';

                if (MediaSource.isTypeSupported(videoCodec)) {
                    videoBuffer = mediaSource.addSourceBuffer(videoCodec);
                    videoBuffer.mode = 'segments';
                    videoBuffer.addEventListener('updateend', () => {
                        isVideoAppending = false;
                        processVideoQueue();
                    });
                    console.log('[FastStream] Video buffer created');
                }

                if (MediaSource.isTypeSupported(audioCodec)) {
                    audioBuffer = mediaSource.addSourceBuffer(audioCodec);
                    audioBuffer.mode = 'segments';
                    audioBuffer.addEventListener('updateend', () => {
                        isAudioAppending = false;
                        processAudioQueue();
                    });
                    console.log('[FastStream] Audio buffer created');
                }

                startDownload();

            } catch (e) {
                showError('MSE init failed: ' + e.message);
            }
        });

        // XHR helpers
        function xhrFetch(url) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'arraybuffer';
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(xhr.response);
                    } else {
                        reject(new Error(`HTTP ${xhr.status}`));
                    }
                };
                xhr.onerror = () => reject(new Error('Network error'));
                xhr.ontimeout = () => reject(new Error('Timeout'));
                xhr.send();
            });
        }

        function xhrFetchText(url) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'text';
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(xhr.responseText);
                    } else {
                        reject(new Error(`HTTP ${xhr.status}`));
                    }
                };
                xhr.onerror = () => reject(new Error('Network error'));
                xhr.ontimeout = () => reject(new Error('Timeout'));
                xhr.send();
            });
        }

        async function startDownload() {
            try {
                const masterUrl = streamInfo.url;
                baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);

                let playlistText = await xhrFetchText(masterUrl);
                console.log('[FastStream] Master playlist fetched');

                // Parse master playlist for variants
                if (playlistText.includes('#EXT-X-STREAM-INF')) {
                    const lines = playlistText.split('\n');
                    let variantUrl = null;
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                            for (let j = i + 1; j < lines.length; j++) {
                                const line = lines[j].trim();
                                if (line && !line.startsWith('#')) {
                                    variantUrl = line;
                                    break;
                                }
                            }
                            break;
                        }
                    }

                    if (variantUrl) {
                        if (!variantUrl.startsWith('http')) {
                            variantUrl = new URL(variantUrl, baseUrl).href;
                        }
                        console.log('[FastStream] Selected variant:', variantUrl);
                        baseUrl = variantUrl.substring(0, variantUrl.lastIndexOf('/') + 1);
                        playlistText = await xhrFetchText(variantUrl);
                    }
                }

                // Parse media segments
                const lines = playlistText.split('\n');
                segments = [];
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('#EXTINF:')) {
                        for (let j = i + 1; j < lines.length; j++) {
                            const segLine = lines[j].trim();
                            if (segLine && !segLine.startsWith('#')) {
                                let segUrl = segLine;
                                if (!segUrl.startsWith('http')) {
                                    segUrl = new URL(segUrl, baseUrl).href;
                                }
                                segments.push(segUrl);
                                i = j;
                                break;
                            }
                        }
                    }
                }

                console.log('[FastStream] Found', segments.length, 'segments');
                statusEl.textContent = 'Playing';
                statusEl.style.color = '#4CAF50';

                downloadNextSegment();

            } catch (e) {
                console.error('[FastStream] Download error:', e);
                showError('Failed to load stream: ' + e.message);
            }
        }

        async function downloadNextSegment() {
            if (currentSegment >= segments.length) {
                console.log('[FastStream] All segments downloaded');
                // Flush transmuxer
                transmuxer.flush();
                setTimeout(() => {
                    if (mediaSource.readyState === 'open') {
                        try {
                            mediaSource.endOfStream();
                        } catch (e) { /* ignore */ }
                    }
                }, 2000);
                return;
            }

            // Buffer limit
            try {
                if (video.buffered.length > 0) {
                    const bufferedAhead = video.buffered.end(video.buffered.length - 1) - video.currentTime;
                    if (bufferedAhead > 30) {
                        setTimeout(downloadNextSegment, 1000);
                        return;
                    }
                }
            } catch (e) { /* ignore */ }

            try {
                const url = segments[currentSegment];
                console.log('[FastStream] Downloading segment', currentSegment);

                const data = await xhrFetch(url);
                totalDownloaded += data.byteLength;
                segmentCount++;

                // Push to transmuxer (TS → fMP4)
                transmuxer.push(new Uint8Array(data));
                transmuxer.flush();

                currentSegment++;

                // Auto-play
                if (currentSegment === 1 && video.paused) {
                    setTimeout(() => {
                        video.play().catch(() => { });
                        playBtn.textContent = '⏸';
                    }, 500);
                }

                // Continue
                setTimeout(downloadNextSegment, 50);

            } catch (e) {
                console.error('[FastStream] Segment error:', e);
                // Retry once
                setTimeout(downloadNextSegment, 2000);
            }
        }
    }

})();
