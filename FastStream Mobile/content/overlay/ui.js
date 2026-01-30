/**
 * FastStream Overlay - UI Layer
 * Handles DOM, controls, stats display, and user interactions.
 */

const UI = (function () {
    let elements = {};
    let styleEl = null;
    let statsInterval = null;
    let onClose = null;
    let onPlayPause = null;
    let onSeek = null;

    const STYLES = `
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
        .fs-title { color: #fff; font-weight: 600; font-size: 14px; }
        .fs-status {
            padding: 4px 8px;
            border-radius: 4px;
            background: #333;
            color: #4CAF50;
            font-size: 11px;
        }
        .fs-quality {
            padding: 4px 8px;
            border-radius: 4px;
            background: #1a1a2e;
            color: #0ff;
            font-size: 11px;
            margin-left: 8px;
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
        }
        #faststream-close:hover { background: rgba(255,255,255,0.3); }
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
        .fs-btn {
            background: rgba(255,255,255,0.2);
            border: none;
            color: #fff;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        }
        .fs-btn:hover { background: rgba(255,255,255,0.3); }
        #faststream-timeline {
            flex: 1;
            height: 4px;
            background: rgba(255,255,255,0.2);
            border-radius: 2px;
            position: relative;
            cursor: pointer;
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
        #faststream-progress {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background: #4CAF50;
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
        .fs-stat-row {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 4px;
        }
        .fs-stat-value { color: #fff; font-family: monospace; }
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
        .fs-time { color: #fff; font-size: 12px; font-family: monospace; }
    `;

    const HTML = `
        <div id="faststream-overlay">
            <div id="faststream-header">
                <span class="fs-title">FastStream Player</span>
                <div style="display:flex;align-items:center">
                    <span class="fs-status" id="fs-status">Loading</span>
                    <span class="fs-quality" id="fs-quality">--</span>
                </div>
                <button id="faststream-close">✕</button>
            </div>
            <video id="faststream-video" playsinline></video>
            <div id="faststream-stats">
                <div class="fs-stat-row"><span>Buffer:</span><span class="fs-stat-value" id="fs-buffer">0s</span></div>
                <div class="fs-stat-row"><span>Segments:</span><span class="fs-stat-value" id="fs-segments">0</span></div>
                <div class="fs-stat-row"><span>Downloaded:</span><span class="fs-stat-value" id="fs-downloaded">0 KB</span></div>
                <div class="fs-stat-row"><span>Speed:</span><span class="fs-stat-value" id="fs-speed">-- KB/s</span></div>
            </div>
            <div id="faststream-controls">
                <button class="fs-btn" id="fs-playbtn">▶</button>
                <span class="fs-time" id="fs-time">0:00 / 0:00</span>
                <div id="faststream-timeline">
                    <div id="faststream-buffer"></div>
                    <div id="faststream-progress"></div>
                </div>
            </div>
            <div id="faststream-error"></div>
            <div id="faststream-loading">Loading...</div>
        </div>
    `;

    function formatTime(seconds) {
        if (!isFinite(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function create(callbacks = {}) {
        onClose = callbacks.onClose || (() => { });
        onPlayPause = callbacks.onPlayPause || (() => { });
        onSeek = callbacks.onSeek || (() => { });

        // Inject styles
        styleEl = document.createElement('style');
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);

        // Inject HTML
        const container = document.createElement('div');
        container.innerHTML = HTML;
        document.body.appendChild(container.firstElementChild);

        // Get elements
        elements = {
            overlay: document.getElementById('faststream-overlay'),
            video: document.getElementById('faststream-video'),
            status: document.getElementById('fs-status'),
            quality: document.getElementById('fs-quality'),
            buffer: document.getElementById('fs-buffer'),
            segments: document.getElementById('fs-segments'),
            downloaded: document.getElementById('fs-downloaded'),
            speed: document.getElementById('fs-speed'),
            time: document.getElementById('fs-time'),
            playBtn: document.getElementById('fs-playbtn'),
            timeline: document.getElementById('faststream-timeline'),
            progress: document.getElementById('faststream-progress'),
            bufferBar: document.getElementById('faststream-buffer'),
            error: document.getElementById('faststream-error'),
            loading: document.getElementById('faststream-loading')
        };

        // Event listeners
        document.getElementById('faststream-close').addEventListener('click', () => {
            onClose();
        });

        elements.playBtn.addEventListener('click', () => {
            onPlayPause();
        });

        elements.timeline.addEventListener('click', (e) => {
            const rect = elements.timeline.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            onSeek(percent);
        });

        elements.video.addEventListener('timeupdate', updateProgress);
        elements.video.addEventListener('play', () => elements.playBtn.textContent = '⏸');
        elements.video.addEventListener('pause', () => elements.playBtn.textContent = '▶');

        // Stats update interval
        statsInterval = setInterval(updateStats, 500);

        return elements.video;
    }

    function updateProgress() {
        const video = elements.video;
        if (!video || !video.duration) return;

        const percent = (video.currentTime / video.duration) * 100;
        elements.progress.style.width = percent + '%';
        elements.time.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;

        if (video.buffered.length > 0) {
            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            elements.bufferBar.style.width = (bufferEnd / video.duration * 100) + '%';
        }
    }

    function updateStats() {
        const video = elements.video;
        if (!video) return;

        if (video.buffered.length > 0) {
            const buffered = video.buffered.end(video.buffered.length - 1) - video.currentTime;
            elements.buffer.textContent = buffered.toFixed(1) + 's';
        }
    }

    function setStatus(text, color = '#4CAF50') {
        if (elements.status) {
            elements.status.textContent = text;
            elements.status.style.color = color;
        }
    }

    function setQuality(text) {
        if (elements.quality) {
            elements.quality.textContent = text;
        }
    }

    function setSegments(count) {
        if (elements.segments) elements.segments.textContent = count;
    }

    function setDownloaded(bytes) {
        if (elements.downloaded) {
            const kb = (bytes / 1024).toFixed(0);
            elements.downloaded.textContent = kb + ' KB';
        }
    }

    function setSpeed(kbps) {
        if (elements.speed) {
            elements.speed.textContent = kbps.toFixed(0) + ' KB/s';
        }
    }

    function showError(message) {
        if (elements.error) {
            elements.error.textContent = message;
            elements.error.style.display = 'block';
        }
        if (elements.loading) elements.loading.style.display = 'none';
        setStatus('Error', '#f44');
    }

    function hideLoading() {
        if (elements.loading) elements.loading.style.display = 'none';
    }

    function destroy() {
        if (statsInterval) {
            clearInterval(statsInterval);
            statsInterval = null;
        }
        if (elements.overlay) elements.overlay.remove();
        if (styleEl) styleEl.remove();
        elements = {};
    }

    return {
        create,
        setStatus,
        setQuality,
        setSegments,
        setDownloaded,
        setSpeed,
        showError,
        hideLoading,
        destroy
    };
})();

if (typeof window !== 'undefined') {
    window.FastStreamUI = UI;
}
