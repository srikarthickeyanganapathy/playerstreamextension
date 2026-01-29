/**
 * FastStream Mobile - Player Engine
 * Custom HTML5 video player with HLS/DASH/MP4 support
 */

import { GestureManager } from './GestureManager.js';

// ============================================================================
// PLAYER CLASS
// ============================================================================

export class FastStreamPlayer {
    /**
     * Create a new FastStreamPlayer
     * @param {HTMLVideoElement} videoElement - The video element to use
     * @param {Object} options - Player options
     */
    constructor(videoElement, options = {}) {
        this.video = videoElement;
        this.options = {
            autoplay: false,
            muted: false,
            debug: false,
            ...options
        };

        // Player state
        this.state = {
            url: null,
            type: null,        // 'hls', 'dash', 'native'
            isPlaying: false,
            isLoading: false,
            duration: 0,
            currentTime: 0,
            buffered: 0,
            qualities: [],
            currentQuality: 'auto',
            error: null,
            volume: 1,
            brightness: 1
        };

        // Library instances
        this.hls = null;
        this.dashPlayer = null;

        // Event callbacks
        this.callbacks = {
            onStateChange: null,
            onQualitiesAvailable: null,
            onError: null,
            onTimeUpdate: null
        };

        this._bindVideoEvents();
        this._log('Player initialized');
    }

    /**
     * Load and play a video URL
     * @param {string} url - The video URL to play
     * @returns {Promise<void>}
     */
    async load(url) {
        if (!url) {
            throw new Error('URL is required');
        }

        this._log('Loading URL:', url);
        this.state.url = url;
        this.state.isLoading = true;
        this.state.error = null;
        this._emitStateChange();

        // Clean up any existing players
        this._cleanup();

        // Determine stream type
        const type = this._detectStreamType(url);
        this.state.type = type;
        this._log('Detected stream type:', type);

        try {
            switch (type) {
                case 'hls':
                    await this._loadHLS(url);
                    break;
                case 'dash':
                    await this._loadDASH(url);
                    break;
                case 'native':
                default:
                    await this._loadNative(url);
                    break;
            }

            this.state.isLoading = false;
            this._emitStateChange();

            if (this.options.autoplay) {
                await this.play();
            }
        } catch (error) {
            this._handleError(error);
        }
    }

    /**
     * Detect stream type from URL
     * @param {string} url - Stream URL
     * @returns {'hls'|'dash'|'native'}
     */
    _detectStreamType(url) {
        const urlLower = url.toLowerCase();

        if (urlLower.includes('.m3u8') || urlLower.includes('format=m3u8')) {
            return 'hls';
        }
        if (urlLower.includes('.mpd') || urlLower.includes('format=mpd')) {
            return 'dash';
        }
        return 'native';
    }

    /**
     * Load HLS stream using HLS.js
     * @param {string} url - HLS manifest URL
     */
    async _loadHLS(url) {
        // Check for native HLS support first (Safari, iOS)
        if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            this._log('Using native HLS support');
            return this._loadNative(url);
        }

        // Check if HLS.js is available
        if (typeof Hls === 'undefined') {
            this._log('HLS.js not loaded, attempting native fallback');
            // Try native as fallback (some browsers support HLS natively)
            try {
                return await this._loadNative(url);
            } catch (e) {
                throw new Error('HLS.js library not loaded and native HLS not supported');
            }
        }

        if (!Hls.isSupported()) {
            this._log('HLS.js not supported, attempting native fallback');
            try {
                return await this._loadNative(url);
            } catch (e) {
                throw new Error('HLS.js is not supported and native HLS not available');
            }
        }

        this._log('Initializing HLS.js');

        return new Promise((resolve, reject) => {
            let resolved = false;
            let retryCount = 0;
            const maxRetries = 2;

            this.hls = new Hls({
                debug: this.options.debug,
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90,
                maxBufferLength: 30,
                maxMaxBufferLength: 600,
                maxBufferSize: 60 * 1000 * 1000, // 60MB
                // Mobile-optimized settings
                startLevel: -1, // Auto
                abrEwmaDefaultEstimate: 500000, // 500kbps initial estimate
                // CORS handling
                xhrSetup: (xhr, url) => {
                    xhr.withCredentials = false; // Avoid CORS preflight issues
                }
            });

            // Timeout for manifest loading
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.hls.destroy();
                    reject(new Error('HLS manifest load timeout - stream may be unavailable'));
                }
            }, 15000);

            this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);

                this._log('HLS manifest parsed, levels:', data.levels.length);

                // Extract quality levels
                this.state.qualities = data.levels.map((level, index) => ({
                    index,
                    height: level.height,
                    width: level.width,
                    bitrate: level.bitrate,
                    label: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)}kbps`
                }));

                this._emitQualitiesAvailable();
                resolve();
            });

            this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
                const level = this.hls.levels[data.level];
                this._log('Quality switched to:', level?.height || 'unknown');
                this.state.currentQuality = level?.height ? `${level.height}p` : 'auto';
                this._emitStateChange();
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                this._log('HLS error:', data.type, data.details, data.fatal);

                if (data.fatal) {
                    clearTimeout(timeout);

                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            this._log('Fatal network error');

                            // Check for CORS issues
                            if (data.details === 'manifestLoadError' || data.response?.code === 0) {
                                if (!resolved) {
                                    resolved = true;
                                    reject(new Error('CORS error: Stream blocked by cross-origin policy. Try opening the URL directly.'));
                                }
                                return;
                            }

                            // Retry network errors
                            if (retryCount < maxRetries) {
                                retryCount++;
                                this._log(`Retrying... (${retryCount}/${maxRetries})`);
                                this.hls.startLoad();
                            } else if (!resolved) {
                                resolved = true;
                                reject(new Error(`Network error: ${data.details}`));
                            }
                            break;

                        case Hls.ErrorTypes.MEDIA_ERROR:
                            this._log('Fatal media error, trying to recover...');
                            // Try media error recovery
                            if (retryCount < maxRetries) {
                                retryCount++;
                                this.hls.recoverMediaError();
                            } else if (!resolved) {
                                resolved = true;
                                reject(new Error(`Media error: ${data.details} - Video format may not be supported`));
                            }
                            break;

                        default:
                            if (!resolved) {
                                resolved = true;
                                reject(new Error(`HLS error: ${data.details}`));
                            }
                            break;
                    }
                }
            });

            this.hls.loadSource(url);
            this.hls.attachMedia(this.video);
        });
    }

    /**
     * Load DASH stream using dash.js
     * @param {string} url - DASH manifest URL
     */
    async _loadDASH(url) {
        if (typeof dashjs === 'undefined') {
            throw new Error('dash.js library not loaded');
        }

        this._log('Initializing dash.js');

        return new Promise((resolve, reject) => {
            this.dashPlayer = dashjs.MediaPlayer().create();

            this.dashPlayer.updateSettings({
                debug: {
                    logLevel: this.options.debug ? dashjs.Debug.LOG_LEVEL_DEBUG : dashjs.Debug.LOG_LEVEL_NONE
                },
                streaming: {
                    abr: {
                        autoSwitchBitrate: { video: true, audio: true }
                    },
                    buffer: {
                        bufferTimeAtTopQuality: 30,
                        bufferTimeAtTopQualityLongForm: 60
                    }
                }
            });

            this.dashPlayer.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
                this._log('DASH stream initialized');

                // Get quality levels
                const bitrates = this.dashPlayer.getBitrateInfoListFor('video');
                this.state.qualities = bitrates.map((info, index) => ({
                    index,
                    height: info.height,
                    width: info.width,
                    bitrate: info.bitrate,
                    label: info.height ? `${info.height}p` : `${Math.round(info.bitrate / 1000)}kbps`
                }));

                this._emitQualitiesAvailable();
                resolve();
            });

            this.dashPlayer.on(dashjs.MediaPlayer.events.ERROR, (e) => {
                this._log('DASH error:', e);
                reject(new Error(`DASH error: ${e.error?.message || 'Unknown'}`));
            });

            this.dashPlayer.initialize(this.video, url, this.options.autoplay);
        });
    }

    /**
     * Load native video (MP4, WebM, etc.)
     * @param {string} url - Video URL
     */
    async _loadNative(url) {
        this._log('Loading native video:', url);

        return new Promise((resolve, reject) => {
            // Timeout for loading
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Video load timeout - stream may be unavailable or blocked'));
            }, 20000);

            const cleanup = () => {
                clearTimeout(timeout);
                this.video.removeEventListener('canplay', onCanPlay);
                this.video.removeEventListener('loadedmetadata', onLoadedMetadata);
                this.video.removeEventListener('error', onError);
            };

            const onCanPlay = () => {
                cleanup();
                this._log('Native video can play');
                resolve();
            };

            const onLoadedMetadata = () => {
                this._log('Video metadata loaded, duration:', this.video.duration);
            };

            const onError = (e) => {
                cleanup();

                // Get detailed error information
                const error = this.video.error;
                let errorMessage = 'Unknown error';
                let errorDetails = '';

                if (error) {
                    // MediaError codes
                    switch (error.code) {
                        case MediaError.MEDIA_ERR_ABORTED:
                            errorMessage = 'Video loading aborted';
                            errorDetails = 'The video playback was aborted by the user or browser.';
                            break;
                        case MediaError.MEDIA_ERR_NETWORK:
                            errorMessage = 'Network error';
                            errorDetails = 'A network error occurred while fetching the video. This could be a CORS issue or the URL is inaccessible.';
                            break;
                        case MediaError.MEDIA_ERR_DECODE:
                            errorMessage = 'Decode error';
                            errorDetails = 'The video could not be decoded. The format may not be supported by this browser.';
                            break;
                        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                            errorMessage = 'Format not supported';
                            errorDetails = 'The video format is not supported. For HLS streams (.m3u8), ensure HLS.js is loaded.';
                            break;
                        default:
                            errorMessage = error.message || 'Playback error';
                    }
                }

                this._log('Native video error:', errorMessage, errorDetails);
                reject(new Error(`${errorMessage}: ${errorDetails}`));
            };

            this.video.addEventListener('canplay', onCanPlay);
            this.video.addEventListener('loadedmetadata', onLoadedMetadata);
            this.video.addEventListener('error', onError);

            // Set source and start loading
            this.video.src = url;
            this.video.load();
        });
    }

    /**
     * Play the video
     */
    async play() {
        try {
            await this.video.play();
            this.state.isPlaying = true;
            this._emitStateChange();
        } catch (error) {
            this._log('Play failed:', error.message);
            // Common on mobile without user interaction
            if (error.name === 'NotAllowedError') {
                this._log('Autoplay blocked, waiting for user interaction');
            } else {
                throw error;
            }
        }
    }

    /**
     * Pause the video
     */
    pause() {
        this.video.pause();
        this.state.isPlaying = false;
        this._emitStateChange();
    }

    /**
     * Toggle play/pause
     */
    togglePlay() {
        if (this.state.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    /**
     * Seek to a specific time
     * @param {number} time - Time in seconds
     */
    seek(time) {
        this.video.currentTime = Math.max(0, Math.min(time, this.state.duration));
    }

    /**
     * Seek by a relative amount
     * @param {number} delta - Seconds to seek (positive or negative)
     */
    seekRelative(delta) {
        this.seek(this.video.currentTime + delta);
    }

    /**
     * Set quality level
     * @param {number|'auto'} level - Quality index or 'auto'
     */
    setQuality(level) {
        if (level === 'auto') {
            if (this.hls) {
                this.hls.currentLevel = -1;
            }
            if (this.dashPlayer) {
                this.dashPlayer.updateSettings({
                    streaming: { abr: { autoSwitchBitrate: { video: true } } }
                });
            }
            this.state.currentQuality = 'auto';
        } else {
            const levelIndex = parseInt(level, 10);
            if (this.hls) {
                this.hls.currentLevel = levelIndex;
            }
            if (this.dashPlayer) {
                this.dashPlayer.updateSettings({
                    streaming: { abr: { autoSwitchBitrate: { video: false } } }
                });
                this.dashPlayer.setQualityFor('video', levelIndex);
            }

            const quality = this.state.qualities[levelIndex];
            this.state.currentQuality = quality?.label || levelIndex.toString();
        }

        this._emitStateChange();
    }

    /**
     * Set volume
     * @param {number} volume - Volume 0-1
     */
    setVolume(volume) {
        this.state.volume = Math.max(0, Math.min(1, volume));
        this.video.volume = this.state.volume;
        this._emitStateChange();
    }

    /**
     * Get current volume
     * @returns {number}
     */
    getVolume() {
        return this.state.volume;
    }

    /**
     * Toggle mute
     */
    toggleMute() {
        this.video.muted = !this.video.muted;
    }

    /**
     * Toggle fullscreen
     */
    async toggleFullscreen() {
        const container = this.video.closest('.player-container') || this.video;

        if (document.fullscreenElement) {
            await document.exitFullscreen();
        } else {
            await container.requestFullscreen();
        }
    }

    /**
     * Toggle Picture-in-Picture mode
     */
    async togglePiP() {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                this._log('Exited PiP mode');
            } else if (document.pictureInPictureEnabled) {
                await this.video.requestPictureInPicture();
                this._log('Entered PiP mode');
            } else {
                this._log('PiP not supported');
            }
        } catch (error) {
            this._log('PiP error:', error.message);
        }
    }

    /**
     * Check if PiP is supported
     * @returns {boolean}
     */
    isPiPSupported() {
        return document.pictureInPictureEnabled && !this.video.disablePictureInPicture;
    }

    /**
     * Download the current video
     */
    async downloadVideo() {
        const url = this.state.url;
        if (!url) {
            this._log('No URL to download');
            return;
        }

        this._log('Initiating download for:', url);

        // For direct video files (MP4, WebM), we can download directly
        if (this.state.type === 'native') {
            this._downloadDirect(url);
            return;
        }

        // For HLS/DASH, we need to provide instructions or use current segment
        // Show download options dialog
        this._showDownloadOptions(url);
    }

    /**
     * Direct download for native video files
     * @param {string} url
     */
    _downloadDirect(url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = this._extractFilename(url);
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        this._log('Download started');
    }

    /**
     * Show download options for streaming formats
     * @param {string} url
     */
    _showDownloadOptions(url) {
        // Copy URL to clipboard as fallback
        navigator.clipboard.writeText(url).then(() => {
            alert(`Stream URL copied to clipboard!\n\nFor HLS/DASH streams, use a tool like:\n• yt-dlp\n• FFmpeg\n\nCommand:\nyt-dlp "${url}"`);
        }).catch(() => {
            // Fallback: prompt with URL
            prompt('Copy this stream URL to download with yt-dlp or FFmpeg:', url);
        });
    }

    /**
     * Extract filename from URL
     * @param {string} url
     * @returns {string}
     */
    _extractFilename(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname;
            const filename = path.split('/').pop();
            return filename || 'video';
        } catch {
            return 'video';
        }
    }

    /**
     * Destroy the player and cleanup
     */
    destroy() {
        this._cleanup();
        this.video.src = '';
        this._log('Player destroyed');
    }

    // ===========================================================================
    // PRIVATE METHODS
    // ===========================================================================

    /**
     * Bind video element events
     */
    _bindVideoEvents() {
        this.video.addEventListener('play', () => {
            this.state.isPlaying = true;
            this._emitStateChange();
        });

        this.video.addEventListener('pause', () => {
            this.state.isPlaying = false;
            this._emitStateChange();
        });

        this.video.addEventListener('timeupdate', () => {
            this.state.currentTime = this.video.currentTime;
            this.state.duration = this.video.duration || 0;

            if (this.callbacks.onTimeUpdate) {
                this.callbacks.onTimeUpdate(this.state);
            }
        });

        this.video.addEventListener('progress', () => {
            if (this.video.buffered.length > 0) {
                const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
                this.state.buffered = bufferedEnd;
            }
        });

        this.video.addEventListener('waiting', () => {
            this.state.isLoading = true;
            this._emitStateChange();
        });

        this.video.addEventListener('playing', () => {
            this.state.isLoading = false;
            this._emitStateChange();
        });

        this.video.addEventListener('ended', () => {
            this.state.isPlaying = false;
            this._emitStateChange();
        });

        this.video.addEventListener('error', (e) => {
            this._handleError(this.video.error);
        });

        this.video.addEventListener('volumechange', () => {
            this.state.volume = this.video.volume;
        });
    }

    /**
     * Cleanup HLS/DASH instances
     */
    _cleanup() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.dashPlayer) {
            this.dashPlayer.reset();
            this.dashPlayer = null;
        }
    }

    /**
     * Handle errors
     * @param {Error} error
     */
    _handleError(error) {
        this.state.error = error?.message || 'Unknown error';
        this.state.isLoading = false;
        this._log('Error:', this.state.error);

        if (this.callbacks.onError) {
            this.callbacks.onError(error);
        }

        this._emitStateChange();
    }

    /**
     * Emit state change callback
     */
    _emitStateChange() {
        if (this.callbacks.onStateChange) {
            this.callbacks.onStateChange({ ...this.state });
        }
    }

    /**
     * Emit qualities available callback
     */
    _emitQualitiesAvailable() {
        if (this.callbacks.onQualitiesAvailable) {
            this.callbacks.onQualitiesAvailable([...this.state.qualities]);
        }
    }

    /**
     * Log message if debug enabled
     */
    _log(...args) {
        if (this.options.debug) {
            console.log('[FastStreamPlayer]', ...args);
        }
    }
}

// ============================================================================
// PAGE CONTROLLER (for player/index.html)
// ============================================================================

class PlayerPageController {
    constructor() {
        this.player = null;
        this.gestureManager = null;
        this.controlsTimeout = null;
        this.brightness = 1; // 0-1 (1 = full brightness)
        this.init();
    }

    async init() {
        // Get DOM elements
        this.elements = {
            container: document.getElementById('playerContainer'),
            video: document.getElementById('video-player'),
            playBtn: document.getElementById('playBtn'),
            timeDisplay: document.getElementById('timeDisplay'),
            progressContainer: document.getElementById('progressContainer'),
            progressBar: document.getElementById('progressBar'),
            progressBuffered: document.getElementById('progressBuffered'),
            qualitySelector: document.getElementById('qualitySelector'),
            fullscreenBtn: document.getElementById('fullscreenBtn'),
            pipBtn: document.getElementById('pipBtn'),
            downloadBtn: document.getElementById('downloadBtn'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            errorOverlay: document.getElementById('errorOverlay'),
            errorMessage: document.getElementById('errorMessage'),
            errorDetails: document.getElementById('errorDetails'),
            streamType: document.getElementById('streamType'),
            streamQuality: document.getElementById('streamQuality'),
            tapArea: document.getElementById('tapArea')
        };

        // Initialize player
        this.player = new FastStreamPlayer(this.elements.video, {
            autoplay: true,
            debug: true
        });

        // Initialize gesture manager
        this._initGestureManager();

        this._setupCallbacks();
        this._bindUIEvents();

        // Get URL from query params or hash
        const url = this._getVideoUrl();
        if (url) {
            this._showLoading(true);
            try {
                await this.player.load(url);
            } catch (error) {
                this._showError(error.message);
            }
        } else {
            this._showError('No video URL provided', 'Pass URL via ?url= parameter');
        }
    }

    /**
     * Initialize gesture manager with callbacks
     */
    _initGestureManager() {
        // Use the tap area for gestures (covers most of the screen)
        this.gestureManager = new GestureManager(this.elements.container, {
            onSeekForward: (seconds) => {
                console.log(`[Gesture] Seek forward ${seconds}s`);
                this.player.seekRelative(seconds);
            },

            onSeekBackward: (seconds) => {
                console.log(`[Gesture] Seek backward ${seconds}s`);
                this.player.seekRelative(-seconds);
            },

            onTogglePlayPause: () => {
                console.log('[Gesture] Toggle play/pause');
                this.player.togglePlay();
            },

            onToggleUI: () => {
                console.log('[Gesture] Toggle UI');
                this._toggleControls();
            },

            onVolumeChange: (delta) => {
                // delta is -1 to 1, representing swipe from bottom to top
                const currentVolume = this.player.getVolume();
                const newVolume = Math.max(0, Math.min(1, currentVolume + delta * 0.5));
                this.player.setVolume(newVolume);
                console.log(`[Gesture] Volume: ${Math.round(newVolume * 100)}%`);
            },

            onBrightnessChange: (delta) => {
                // delta is -1 to 1, representing swipe from bottom to top
                this.brightness = Math.max(0, Math.min(1, this.brightness + delta * 0.5));
                this.gestureManager.setBrightness(this.brightness);
                console.log(`[Gesture] Brightness: ${Math.round(this.brightness * 100)}%`);
            },

            onGestureStart: (type) => {
                console.log(`[Gesture] Started: ${type}`);
                // Keep controls visible during gesture
                this.elements.container.classList.remove('controls-hidden');
                clearTimeout(this.controlsTimeout);
            },

            onGestureEnd: () => {
                console.log('[Gesture] Ended');
                // Resume auto-hide
                this._showControls();
            }
        });
    }

    _getVideoUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('url') || decodeURIComponent(window.location.hash.slice(1)) || null;
    }

    _setupCallbacks() {
        this.player.callbacks.onStateChange = (state) => {
            this._updateUI(state);
        };

        this.player.callbacks.onTimeUpdate = (state) => {
            this._updateProgress(state);
        };

        this.player.callbacks.onQualitiesAvailable = (qualities) => {
            this._populateQualitySelector(qualities);
        };

        this.player.callbacks.onError = (error) => {
            this._showError(error.message);
        };
    }

    _bindUIEvents() {
        // Play button
        this.elements.playBtn.addEventListener('click', () => {
            this.player.togglePlay();
        });

        // Tap area for controls
        this.elements.tapArea.addEventListener('click', () => {
            this._toggleControls();
        });

        // Progress bar seek
        this.elements.progressContainer.addEventListener('click', (e) => {
            const rect = this.elements.progressContainer.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            this.player.seek(percent * this.player.state.duration);
        });

        // Quality selector
        this.elements.qualitySelector.addEventListener('change', (e) => {
            this.player.setQuality(e.target.value);
        });

        // Fullscreen
        this.elements.fullscreenBtn.addEventListener('click', () => {
            this.player.toggleFullscreen();
        });

        // Picture-in-Picture
        if (this.elements.pipBtn) {
            this.elements.pipBtn.addEventListener('click', () => {
                this.player.togglePiP();
            });
            // Hide if not supported
            if (!this.player.isPiPSupported()) {
                this.elements.pipBtn.style.display = 'none';
            }
        }

        // Download
        if (this.elements.downloadBtn) {
            this.elements.downloadBtn.addEventListener('click', () => {
                this.player.downloadVideo();
            });
        }

        // Auto-hide controls
        this.elements.container.addEventListener('mousemove', () => {
            this._showControls();
        });

        this.elements.container.addEventListener('touchstart', () => {
            this._showControls();
        });
    }

    _updateUI(state) {
        // Play button
        this.elements.playBtn.textContent = state.isPlaying ? '⏸' : '▶';

        // Loading
        this._showLoading(state.isLoading);

        // Stream info
        this.elements.streamType.textContent = state.type?.toUpperCase() || '--';
        this.elements.streamQuality.textContent = state.currentQuality || '--';

        // Error
        if (state.error) {
            this._showError(state.error);
        }
    }

    _updateProgress(state) {
        const percent = (state.currentTime / state.duration) * 100 || 0;
        const bufferedPercent = (state.buffered / state.duration) * 100 || 0;

        this.elements.progressBar.style.width = `${percent}%`;
        this.elements.progressBuffered.style.width = `${bufferedPercent}%`;

        this.elements.timeDisplay.textContent =
            `${this._formatTime(state.currentTime)} / ${this._formatTime(state.duration)}`;
    }

    _populateQualitySelector(qualities) {
        this.elements.qualitySelector.innerHTML = '<option value="auto">Auto</option>';

        qualities.forEach((q, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = q.label;
            this.elements.qualitySelector.appendChild(option);
        });
    }

    _showLoading(show) {
        this.elements.loadingOverlay.classList.toggle('visible', show);
    }

    _showError(message, details = '') {
        this.elements.errorOverlay.classList.add('visible');
        this.elements.errorMessage.textContent = message;
        this.elements.errorDetails.textContent = details;
        this._showLoading(false);
    }

    _toggleControls() {
        const isHidden = this.elements.container.classList.contains('controls-hidden');
        if (isHidden) {
            this._showControls();
        } else {
            this.elements.container.classList.add('controls-hidden');
        }
    }

    _showControls() {
        this.elements.container.classList.remove('controls-hidden');

        clearTimeout(this.controlsTimeout);
        this.controlsTimeout = setTimeout(() => {
            if (this.player.state.isPlaying) {
                this.elements.container.classList.add('controls-hidden');
            }
        }, 3000);
    }

    _formatTime(seconds) {
        if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new PlayerPageController());
} else {
    new PlayerPageController();
}
