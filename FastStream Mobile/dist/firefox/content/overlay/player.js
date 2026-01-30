/**
 * FastStream Overlay - Player Engine
 * Handles MSE, transmuxer, buffer management, and playback.
 */

const Player = (function () {
    const BUFFER_MAX_SECONDS = 60;
    const BUFFER_AHEAD_LIMIT = 30;

    let video = null;
    let mediaSource = null;
    let videoBuffer = null;
    let audioBuffer = null;
    let transmuxer = null;

    let videoQueue = [];
    let audioQueue = [];
    let isVideoAppending = false;
    let isAudioAppending = false;
    let videoInitDone = false;
    let audioInitDone = false;

    let onReady = null;
    let onError = null;
    let onBufferUpdate = null;

    // Initialize MSE and transmuxer
    function init(videoElement, callbacks = {}) {
        video = videoElement;
        onReady = callbacks.onReady || (() => { });
        onError = callbacks.onError || (() => { });
        onBufferUpdate = callbacks.onBufferUpdate || (() => { });

        return new Promise((resolve, reject) => {
            // Load mux.js from CDN
            if (typeof muxjs === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/mux.js@7.0.3/dist/mux.min.js';
                script.onload = () => {
                    setupMSE(resolve, reject);
                };
                script.onerror = () => reject(new Error('Failed to load mux.js'));
                document.head.appendChild(script);
            } else {
                setupMSE(resolve, reject);
            }
        });
    }

    function setupMSE(resolve, reject) {
        mediaSource = new MediaSource();
        video.src = URL.createObjectURL(mediaSource);

        mediaSource.addEventListener('sourceopen', () => {
            try {
                // Create video buffer
                const videoCodec = 'video/mp4; codecs="avc1.64001f"';
                if (MediaSource.isTypeSupported(videoCodec)) {
                    videoBuffer = mediaSource.addSourceBuffer(videoCodec);
                    videoBuffer.mode = 'segments';
                    videoBuffer.addEventListener('updateend', onVideoUpdateEnd);
                    videoBuffer.addEventListener('error', (e) => onError('Video buffer error'));
                }

                // Create audio buffer
                const audioCodec = 'audio/mp4; codecs="mp4a.40.2"';
                if (MediaSource.isTypeSupported(audioCodec)) {
                    audioBuffer = mediaSource.addSourceBuffer(audioCodec);
                    audioBuffer.mode = 'segments';
                    audioBuffer.addEventListener('updateend', onAudioUpdateEnd);
                    audioBuffer.addEventListener('error', (e) => onError('Audio buffer error'));
                }

                // Setup transmuxer
                transmuxer = new muxjs.mp4.Transmuxer({
                    keepOriginalTimestamps: true,
                    remux: false
                });

                transmuxer.on('data', onTransmuxData);
                transmuxer.on('done', () => { });

                resolve();
                onReady();

            } catch (e) {
                reject(e);
                onError('MSE init failed: ' + e.message);
            }
        });

        mediaSource.addEventListener('sourceended', () => { });
        mediaSource.addEventListener('sourceclose', () => { });
    }

    function onTransmuxData(segment) {
        if (segment.type === 'video') {
            if (!videoInitDone && segment.initSegment) {
                // Append init segment first time only
                videoQueue.push(new Uint8Array(segment.initSegment));
                videoInitDone = true;
            }
            if (segment.data) {
                videoQueue.push(new Uint8Array(segment.data));
            }
            processVideoQueue();
        } else if (segment.type === 'audio') {
            if (!audioInitDone && segment.initSegment) {
                audioQueue.push(new Uint8Array(segment.initSegment));
                audioInitDone = true;
            }
            if (segment.data) {
                audioQueue.push(new Uint8Array(segment.data));
            }
            processAudioQueue();
        }
    }

    function processVideoQueue() {
        if (isVideoAppending || !videoBuffer || videoBuffer.updating || videoQueue.length === 0) return;
        if (mediaSource.readyState !== 'open') return;

        const data = videoQueue.shift();
        try {
            isVideoAppending = true;
            videoBuffer.appendBuffer(data);
        } catch (e) {
            isVideoAppending = false;
            if (e.name === 'QuotaExceededError') {
                evictBuffer(videoBuffer, video);
                videoQueue.unshift(data);
                setTimeout(processVideoQueue, 100);
            }
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
            isAudioAppending = false;
            if (e.name === 'QuotaExceededError') {
                evictBuffer(audioBuffer, video);
                audioQueue.unshift(data);
                setTimeout(processAudioQueue, 100);
            }
        }
    }

    function onVideoUpdateEnd() {
        isVideoAppending = false;
        evictBuffer(videoBuffer, video);
        processVideoQueue();
        notifyBufferUpdate();
    }

    function onAudioUpdateEnd() {
        isAudioAppending = false;
        evictBuffer(audioBuffer, video);
        processAudioQueue();
        notifyBufferUpdate();
    }

    // Evict old buffer to prevent memory issues
    function evictBuffer(buffer, videoEl) {
        if (!buffer || buffer.updating) return;

        try {
            if (videoEl.buffered.length > 0) {
                const currentTime = videoEl.currentTime;
                const start = videoEl.buffered.start(0);
                const end = videoEl.buffered.end(videoEl.buffered.length - 1);

                // Keep some buffer behind current position
                const keepBehind = 10;
                if (currentTime - start > keepBehind) {
                    buffer.remove(start, currentTime - keepBehind);
                }

                // Also check total buffer size
                if (end - start > BUFFER_MAX_SECONDS) {
                    const removeEnd = Math.max(start, currentTime - keepBehind);
                    if (removeEnd > start) {
                        buffer.remove(start, removeEnd);
                    }
                }
            }
        } catch (e) {
            // Ignore eviction errors
        }
    }

    function notifyBufferUpdate() {
        if (!video || !onBufferUpdate) return;

        try {
            if (video.buffered.length > 0) {
                const buffered = video.buffered.end(video.buffered.length - 1) - video.currentTime;
                onBufferUpdate(buffered);
            }
        } catch (e) { }
    }

    // Push segment data to transmuxer
    function pushSegment(data) {
        if (!transmuxer) return;
        transmuxer.push(new Uint8Array(data));
        transmuxer.flush();
    }

    // Check if we need more data
    function needsMoreData() {
        if (!video || video.buffered.length === 0) return true;

        try {
            const bufferedAhead = video.buffered.end(video.buffered.length - 1) - video.currentTime;
            return bufferedAhead < BUFFER_AHEAD_LIMIT;
        } catch (e) {
            return true;
        }
    }

    // Get current buffer level
    function getBufferLevel() {
        if (!video || video.buffered.length === 0) return 0;

        try {
            return video.buffered.end(video.buffered.length - 1) - video.currentTime;
        } catch (e) {
            return 0;
        }
    }

    // Play
    function play() {
        if (video) video.play().catch(() => { });
    }

    // Pause
    function pause() {
        if (video) video.pause();
    }

    // End stream
    function endStream() {
        if (mediaSource && mediaSource.readyState === 'open') {
            try {
                // Wait for buffers to finish
                const waitForBuffers = () => {
                    if ((videoBuffer && videoBuffer.updating) || (audioBuffer && audioBuffer.updating)) {
                        setTimeout(waitForBuffers, 100);
                    } else {
                        try { mediaSource.endOfStream(); } catch (e) { }
                    }
                };
                waitForBuffers();
            } catch (e) { }
        }
    }

    // Full cleanup
    function destroy() {
        // Dispose transmuxer
        if (transmuxer) {
            try { transmuxer.dispose(); } catch (e) { }
            transmuxer = null;
        }

        // End media source
        if (mediaSource && mediaSource.readyState === 'open') {
            try { mediaSource.endOfStream(); } catch (e) { }
        }

        // Clear video
        if (video) {
            video.pause();
            video.src = '';
            video.load();
        }

        // Reset state
        videoBuffer = null;
        audioBuffer = null;
        mediaSource = null;
        video = null;
        videoQueue = [];
        audioQueue = [];
        isVideoAppending = false;
        isAudioAppending = false;
        videoInitDone = false;
        audioInitDone = false;
    }

    return {
        init,
        pushSegment,
        needsMoreData,
        getBufferLevel,
        play,
        pause,
        endStream,
        destroy
    };
})();

if (typeof window !== 'undefined') {
    window.FastStreamPlayer = Player;
}
