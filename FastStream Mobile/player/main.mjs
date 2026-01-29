/**
 * FastStream Mobile - Player Engine
 * Custom HTML5 video player with HLS/DASH/MP4 support
 */

import { GestureManager } from './GestureManager.js';

// ============================================================================
// PLAYER CLASS
// ============================================================================

export class FastStreamPlayer {
    constructor(videoElement) {
        this.video = videoElement;
        this.hls = null;
        this.dash = null;
    }

    async load(url) {
        console.log('[FastStreamPlayer] Loading:', url);

        const urlLower = url.toLowerCase();

        // 1. HLS (.m3u8)
        if (urlLower.includes('.m3u8') || urlLower.includes('application/x-mpegurl')) {
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                console.log('[FastStreamPlayer] Using Hls.js');
                this.hls = new Hls();
                this.hls.loadSource(url);
                this.hls.attachMedia(this.video);
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    this.video.play().catch(e => console.warn('Autoplay failed', e));
                });
                return;
            } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
                // Native HLS (Safari)
                console.log('[FastStreamPlayer] Using Native HLS');
                this.video.src = url;
                return;
            }
        }

        // 2. DASH (.mpd)
        if (urlLower.includes('.mpd')) {
            if (typeof dashjs !== 'undefined') {
                console.log('[FastStreamPlayer] Using Dash.js');
                this.dash = dashjs.MediaPlayer().create();
                this.dash.initialize(this.video, url, true);
                return;
            }
        }

        // 3. Native (MP4/WebM/Direct)
        console.log('[FastStreamPlayer] Using Native Player');
        this.video.src = url;
    }
}

// ============================================================================
// MAIN INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('video-player');
    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('videoUrl') || params.get('url');

    if (!videoUrl) {
        console.error('No videoUrl found in query params');
        return;
    }

    const player = new FastStreamPlayer(video);
    player.load(videoUrl);

    // Initialize Gesture Manager
    if (video) {
        // Use video parent or body as container to capture gestures effectively
        const container = document.body;

        new GestureManager(container, {
            onSeekForward: (seconds) => {
                if (video.duration) {
                    video.currentTime = Math.min(video.duration, video.currentTime + seconds);
                }
            },
            onSeekBackward: (seconds) => {
                video.currentTime = Math.max(0, video.currentTime - seconds);
            },
            onTogglePlayPause: () => {
                if (video.paused) video.play();
                else video.pause();
            },
            onVolumeChange: (delta) => {
                // delta is -1 to 1
                const newVol = Math.max(0, Math.min(1, video.volume + (delta * 0.1)));
                video.volume = newVol;
            },
            onBrightnessChange: (delta) => {
                // Optional: Implement brightness filter overlay
                const overlay = document.querySelector('.brightness-overlay');
                if (overlay) {
                    let opacity = parseFloat(overlay.style.opacity || 0);
                    opacity = Math.max(0, Math.min(0.8, opacity - (delta * 0.1)));
                    overlay.style.opacity = opacity;
                }
            }
        });
    }

    // Playback error handling
    video.addEventListener('error', (e) => {
        console.error('Video Error:', video.error);
    });
});
