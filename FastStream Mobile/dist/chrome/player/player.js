/**
 * FastStream Mobile - Custom Player Module
 * Lightweight video player optimized for mobile streaming
 */

export class FastStreamPlayer {
    constructor(options = {}) {
        this.container = null;
        this.video = null;
        this.controls = null;
        this.settings = {
            autoplay: false,
            quality: 'auto',
            bufferSize: 30, // seconds
            ...options
        };
    }

    /**
     * Initialize the player in a container
     * @param {HTMLElement} container - The container element
     * @param {string} streamUrl - The stream URL to play
     */
    init(container, streamUrl) {
        this.container = container;
        this.createVideoElement();
        this.createControls();
        this.loadStream(streamUrl);
    }

    /**
     * Create the video element
     */
    createVideoElement() {
        this.video = document.createElement('video');
        this.video.className = 'faststream-video';
        this.video.setAttribute('playsinline', '');
        this.video.setAttribute('webkit-playsinline', '');
        this.container.appendChild(this.video);
    }

    /**
     * Create player controls
     */
    createControls() {
        this.controls = document.createElement('div');
        this.controls.className = 'faststream-controls';
        this.controls.innerHTML = `
      <button class="fs-play-btn" aria-label="Play/Pause">▶</button>
      <div class="fs-progress">
        <div class="fs-progress-bar"></div>
      </div>
      <span class="fs-time">0:00 / 0:00</span>
      <button class="fs-fullscreen-btn" aria-label="Fullscreen">⛶</button>
    `;
        this.container.appendChild(this.controls);
        this.bindControlEvents();
    }

    /**
     * Bind control event listeners
     */
    bindControlEvents() {
        const playBtn = this.controls.querySelector('.fs-play-btn');
        const fullscreenBtn = this.controls.querySelector('.fs-fullscreen-btn');
        const progress = this.controls.querySelector('.fs-progress');

        playBtn.addEventListener('click', () => this.togglePlay());
        fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        progress.addEventListener('click', (e) => this.seek(e));

        this.video.addEventListener('timeupdate', () => this.updateProgress());
        this.video.addEventListener('play', () => playBtn.textContent = '⏸');
        this.video.addEventListener('pause', () => playBtn.textContent = '▶');
    }

    /**
     * Load a stream URL
     * @param {string} url - The stream URL
     */
    async loadStream(url) {
        // Detect stream type and load appropriately
        if (url.includes('.m3u8')) {
            await this.loadHLS(url);
        } else if (url.includes('.mpd')) {
            await this.loadDASH(url);
        } else {
            this.video.src = url;
        }

        if (this.settings.autoplay) {
            this.play();
        }
    }

    /**
     * Load HLS stream (basic implementation)
     * @param {string} url - HLS manifest URL
     */
    async loadHLS(url) {
        // Native HLS support (Safari, some mobile browsers)
        if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            this.video.src = url;
        } else {
            // Would integrate hls.js for other browsers
            console.log('[FastStream] HLS.js integration needed');
            this.video.src = url;
        }
    }

    /**
     * Load DASH stream (basic implementation)
     * @param {string} url - DASH manifest URL
     */
    async loadDASH(url) {
        // Would integrate dash.js for DASH support
        console.log('[FastStream] DASH.js integration needed');
        this.video.src = url;
    }

    /**
     * Toggle play/pause
     */
    togglePlay() {
        if (this.video.paused) {
            this.play();
        } else {
            this.pause();
        }
    }

    /**
     * Play the video
     */
    play() {
        this.video.play().catch(err => {
            console.warn('[FastStream] Autoplay blocked:', err);
        });
    }

    /**
     * Pause the video
     */
    pause() {
        this.video.pause();
    }

    /**
     * Toggle fullscreen
     */
    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            this.container.requestFullscreen();
        }
    }

    /**
     * Seek to position in video
     * @param {MouseEvent} event - Click event
     */
    seek(event) {
        const progress = this.controls.querySelector('.fs-progress');
        const rect = progress.getBoundingClientRect();
        const percent = (event.clientX - rect.left) / rect.width;
        this.video.currentTime = percent * this.video.duration;
    }

    /**
     * Update progress bar and time display
     */
    updateProgress() {
        const progressBar = this.controls.querySelector('.fs-progress-bar');
        const timeDisplay = this.controls.querySelector('.fs-time');

        const percent = (this.video.currentTime / this.video.duration) * 100;
        progressBar.style.width = `${percent}%`;

        const current = this.formatTime(this.video.currentTime);
        const duration = this.formatTime(this.video.duration);
        timeDisplay.textContent = `${current} / ${duration}`;
    }

    /**
     * Format seconds to MM:SS
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time
     */
    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Destroy the player and clean up
     */
    destroy() {
        this.video.pause();
        this.video.src = '';
        this.container.innerHTML = '';
        this.video = null;
        this.controls = null;
    }
}
