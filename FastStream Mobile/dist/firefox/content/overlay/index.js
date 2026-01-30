/**
 * FastStream Overlay - Main Orchestrator
 * Coordinates Network, Player, and UI modules with ABR support.
 */

(function () {
    // Prevent double injection
    if (window.__FASTSTREAM_PLAYER_INJECTED__) return;
    window.__FASTSTREAM_PLAYER_INJECTED__ = true;

    const streamInfo = window.__FASTSTREAM_STREAM_INFO__;
    if (!streamInfo) {
        console.error('[FastStream] No stream info');
        return;
    }

    // State
    let currentVariantIndex = 0;
    let variants = [];
    let segments = [];
    let currentSegment = 0;
    let totalDownloaded = 0;
    let segmentCount = 0;
    let downloadStartTime = 0;
    let isDownloading = false;
    let destroyed = false;

    // Load modules inline (they're already in the page context)
    const Network = window.FastStreamNetwork;
    const Player = window.FastStreamPlayer;
    const UI = window.FastStreamUI;

    // ABR Controller
    const ABR = {
        samples: [],
        maxSamples: 5,

        reportDownload(bytes, durationMs) {
            const bps = (bytes * 8000) / durationMs;
            this.samples.push(bps);
            if (this.samples.length > this.maxSamples) {
                this.samples.shift();
            }
        },

        getEstimatedBandwidth() {
            if (this.samples.length === 0) return Infinity;
            const sorted = [...this.samples].sort((a, b) => a - b);
            // Use 70th percentile for safety
            const idx = Math.floor(sorted.length * 0.7);
            return sorted[idx];
        },

        selectVariant(variants, bufferLevel) {
            const bandwidth = this.getEstimatedBandwidth();
            const safetyFactor = bufferLevel < 10 ? 0.5 : 0.8;
            const safeBandwidth = bandwidth * safetyFactor;

            // Find highest quality that fits
            for (let i = 0; i < variants.length; i++) {
                if (variants[i].bitrate <= safeBandwidth) {
                    return i;
                }
            }
            return variants.length - 1; // Lowest quality
        }
    };

    // Pause original videos
    document.querySelectorAll('video').forEach(v => {
        if (v.id !== 'faststream-video' && !v.paused) {
            v.pause();
        }
    });

    // Create UI
    const videoElement = UI.create({
        onClose: destroy,
        onPlayPause: () => {
            if (videoElement.paused) {
                Player.play();
            } else {
                Player.pause();
            }
        },
        onSeek: (percent) => {
            if (videoElement.duration) {
                videoElement.currentTime = videoElement.duration * percent;
            }
        }
    });

    // Initialize
    async function init() {
        try {
            UI.setStatus('Initializing...');

            // Init player
            await Player.init(videoElement, {
                onReady: () => UI.setStatus('Ready'),
                onError: (msg) => UI.showError(msg),
                onBufferUpdate: (level) => {
                    // Check for ABR switch
                    if (variants.length > 1) {
                        const newIdx = ABR.selectVariant(variants, level);
                        if (newIdx !== currentVariantIndex) {
                            switchVariant(newIdx);
                        }
                    }
                }
            });

            UI.hideLoading();
            UI.setStatus('Fetching playlist...');

            // Fetch master playlist
            const master = await Network.fetchMasterPlaylist(streamInfo.url);

            if (master.type === 'master') {
                variants = master.variants;
                // Start with middle quality
                currentVariantIndex = Math.floor(variants.length / 2);
                updateQualityDisplay();

                // Fetch media playlist
                const media = await Network.fetchMediaPlaylist(variants[currentVariantIndex].url);
                segments = media.segments;

                if (media.isLive) {
                    UI.setStatus('Live', '#ff5722');
                    Network.startLiveRefresh(variants[currentVariantIndex].url, onNewSegments);
                }
            } else {
                // Direct media playlist
                segments = master.segments;
                if (master.isLive) {
                    UI.setStatus('Live', '#ff5722');
                    Network.startLiveRefresh(streamInfo.url, onNewSegments);
                }
            }

            console.log('[FastStream] Found', segments.length, 'segments');
            UI.setStatus('Playing', '#4CAF50');

            // Start downloading
            downloadSegments();

        } catch (e) {
            console.error('[FastStream] Init error:', e);
            UI.showError(e.fatal ? e.message : 'Failed to load: ' + e.message);
        }
    }

    function updateQualityDisplay() {
        if (variants.length > 0 && variants[currentVariantIndex]) {
            const v = variants[currentVariantIndex];
            const label = v.resolution || `${Math.round(v.bitrate / 1000)}k`;
            UI.setQuality(label);
        }
    }

    async function switchVariant(newIndex) {
        if (newIndex === currentVariantIndex) return;
        if (!variants[newIndex]) return;

        console.log('[FastStream] Switching to variant', newIndex, variants[newIndex].resolution);
        currentVariantIndex = newIndex;
        updateQualityDisplay();

        try {
            const media = await Network.fetchMediaPlaylist(variants[newIndex].url);
            // Find where we left off by sequence
            const currentSeq = segments[currentSegment]?.sequence || 0;
            const newStart = media.segments.findIndex(s => s.sequence >= currentSeq);

            segments = media.segments;
            currentSegment = Math.max(0, newStart);
        } catch (e) {
            console.warn('[FastStream] Variant switch failed:', e);
        }
    }

    function onNewSegments(newSegments) {
        // Add only truly new segments
        for (const seg of newSegments) {
            if (!segments.find(s => s.id === seg.id)) {
                segments.push(seg);
            }
        }

        // Trigger download if idle
        if (!isDownloading && !destroyed) {
            downloadSegments();
        }
    }

    async function downloadSegments() {
        if (destroyed || isDownloading) return;
        isDownloading = true;

        while (!destroyed && currentSegment < segments.length) {
            // Buffer check
            if (!Player.needsMoreData()) {
                isDownloading = false;
                setTimeout(downloadSegments, 1000);
                return;
            }

            const segment = segments[currentSegment];
            downloadStartTime = Date.now();

            try {
                const data = await Network.fetchSegment(segment.url);
                const duration = Date.now() - downloadStartTime;

                // Report to ABR
                ABR.reportDownload(data.byteLength, duration);
                UI.setSpeed((data.byteLength / duration));

                // Mark downloaded
                Network.markDownloaded(segment.id);

                // Push to player
                Player.pushSegment(data);

                // Update stats
                totalDownloaded += data.byteLength;
                segmentCount++;
                UI.setSegments(segmentCount);
                UI.setDownloaded(totalDownloaded);

                // Auto-play
                if (currentSegment === 0) {
                    setTimeout(() => Player.play(), 500);
                }

                currentSegment++;

            } catch (e) {
                console.warn('[FastStream] Segment error:', e.message);

                if (e.fatal) {
                    UI.showError(e.message);
                    isDownloading = false;
                    return;
                }

                if (e.skip) {
                    // Skip this segment (404)
                    currentSegment++;
                    continue;
                }

                // Retry after delay
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        isDownloading = false;

        // If VOD and done, end stream
        if (!Network.isLive() && currentSegment >= segments.length) {
            Player.endStream();
        }
    }

    function destroy() {
        destroyed = true;
        Network.reset();
        Player.destroy();
        UI.destroy();
        window.__FASTSTREAM_PLAYER_INJECTED__ = false;
    }

    // Start!
    init();

})();
