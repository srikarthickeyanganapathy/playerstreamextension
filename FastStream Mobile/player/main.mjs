/**
 * FastStream Mobile - Player Engine
 * Custom HTML5 video player with HLS/DASH/MP4 support and Modern UI bindings
 */

import { GestureManager } from './GestureManager.js';
import { initUIExtensions } from './ui_extensions.js';

export class FastStreamPlayer {
    constructor(videoElement) {
        this.video = videoElement;
        this.hls = null;
        this.dash = null;
        this.setupUIBindings();
    }

    setupUIBindings() {
        const playBtn = document.getElementById('playBtn');
        const playIconPath = document.getElementById('playIconPath');
        const timeDisplay = document.getElementById('timeDisplay');
        const progressBar = document.getElementById('progressBar');
        const progressThumb = document.getElementById('progressThumb');
        const progressBuffered = document.getElementById('progressBuffered');
        const progressContainer = document.getElementById('progressContainer');
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        const pipBtn = document.getElementById('pipBtn');
        const downloadBtn = document.getElementById('downloadBtn');
        const copyUrlControlBtn = document.getElementById('copyUrlControlBtn');
        
        // Play/Pause toggle
        const togglePlay = () => {
            if (this.video.paused) {
                const p = this.video.play();
                if (p !== undefined) p.catch(e => console.log('Play interrupted or blocked', e));
            } else {
                this.video.pause();
            }
        };

        playBtn.addEventListener('click', togglePlay);
        this.video.addEventListener('click', togglePlay);

        // Update Play/Pause Icon
        this.video.addEventListener('play', () => {
            playIconPath.setAttribute('d', 'M6 4h4v16H6zm8 0h4v16h-4z'); // Pause icon
        });
        
        this.video.addEventListener('pause', () => {
            playIconPath.setAttribute('d', 'M8 5v14l11-7z'); // Play icon
        });

        // Skip buttons
        const rewindBtn = document.getElementById('rewindBtn');
        const forwardBtn = document.getElementById('forwardBtn');

        if (rewindBtn) {
            rewindBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.video.currentTime = Math.max(0, this.video.currentTime - 10);
            });
        }

        if (forwardBtn) {
            forwardBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.video.duration) {
                    this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + 10);
                }
            });
        }
        
        // Volume Controls
        const muteBtn = document.getElementById('muteBtn');
        const volumeSlider = document.getElementById('volumeSlider');
        const volumeIconLines = document.getElementById('volumeIconLines');

        if (muteBtn && volumeSlider) {
            const updateVolumeUI = () => {
                volumeSlider.value = this.video.muted ? 0 : this.video.volume;
                if (this.video.muted || this.video.volume === 0) {
                    volumeIconLines.style.display = 'none'; // Muted icon
                } else {
                    volumeIconLines.style.display = 'block'; // Unmuted icon
                }
            };

            muteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.video.muted = !this.video.muted;
                updateVolumeUI();
            });

            volumeSlider.addEventListener('input', (e) => {
                e.stopPropagation();
                this.video.volume = e.target.value;
                this.video.muted = (this.video.volume === 0);
                updateVolumeUI();
            });

            this.video.addEventListener('volumechange', updateVolumeUI);
        }

        // Fullscreen Double Click
        this.video.addEventListener('dblclick', (e) => {
            e.preventDefault();
            fullscreenBtn.click();
        });

        // Keyboard Controls
        document.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

            switch(e.key.toLowerCase()) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'f':
                    e.preventDefault();
                    fullscreenBtn.click();
                    break;
                case 'arrowleft':
                case 'j':
                    e.preventDefault();
                    this.video.currentTime = Math.max(0, this.video.currentTime - 10);
                    break;
                case 'arrowright':
                case 'l':
                    e.preventDefault();
                    if (this.video.duration) {
                        this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + 10);
                    }
                    break;
                case 'arrowup':
                    e.preventDefault();
                    this.video.volume = Math.min(1, this.video.volume + 0.05);
                    break;
                case 'arrowdown':
                    e.preventDefault();
                    this.video.volume = Math.max(0, this.video.volume - 0.05);
                    break;
                case 'm':
                    e.preventDefault();
                    this.video.muted = !this.video.muted;
                    break;
            }
        });

        // Time updates
        const formatTime = (seconds) => {
            if (isNaN(seconds)) return '0:00';
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        };

        this.video.addEventListener('timeupdate', () => {
            const current = this.video.currentTime;
            const duration = this.video.duration;
            
            if (duration) {
                timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
                const percent = (current / duration) * 100;
                progressBar.style.width = `${percent}%`;
                progressThumb.style.left = `${percent}%`;
            }
        });

        // Buffered
        this.video.addEventListener('progress', () => {
            if (this.video.buffered.length > 0 && this.video.duration) {
                const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
                const percent = (bufferedEnd / this.video.duration) * 100;
                progressBuffered.style.width = `${percent}%`;
            }
        });

        // Seek
        progressContainer.addEventListener('click', (e) => {
            const rect = progressContainer.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            if (this.video.duration) {
                this.video.currentTime = pos * this.video.duration;
            }
        });

        // Fullscreen
        fullscreenBtn.addEventListener('click', () => {
            const container = document.getElementById('playerContainer');
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                container.requestFullscreen();
            }
        });

        // PiP
        if (pipBtn) {
            pipBtn.addEventListener('click', async () => {
                try {
                    if (document.pictureInPictureElement) {
                        await document.exitPictureInPicture();
                    } else if (document.pictureInPictureEnabled) {
                        await this.video.requestPictureInPicture();
                    }
                } catch (err) {
                    console.error('PiP failed', err);
                }
            });
        }

        // Copy URL
        if (copyUrlControlBtn) {
            copyUrlControlBtn.addEventListener('click', () => {
                const params = new URLSearchParams(window.location.search);
                const videoUrl = params.get('videoUrl');
                if (videoUrl) {
                    const showToast = () => {
                        const toast = document.getElementById('copyToast');
                        toast.classList.add('visible');
                        setTimeout(() => toast.classList.remove('visible'), 2000);
                    };
                    
                    const textArea = document.createElement("textarea");
                    textArea.value = videoUrl;
                    document.body.appendChild(textArea);
                    textArea.select();
                    try {
                        const successful = document.execCommand('copy');
                        if (successful) {
                            showToast();
                        } else {
                            window.prompt("Copy URL:", videoUrl);
                        }
                    } catch (e) {
                        window.prompt("Copy URL:", videoUrl);
                    }
                    document.body.removeChild(textArea);
                }
            });
        }

        // Download
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                const params = new URLSearchParams(window.location.search);
                const videoUrl = params.get('videoUrl');
                if (videoUrl) {
                    window.open(videoUrl, '_blank');
                }
            });
        }

        // Hide controls on inactivity
        let timeout;
        const playerContainer = document.getElementById('playerContainer');
        const resetControlsTimeout = () => {
            playerContainer.classList.remove('controls-hidden');
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (!this.video.paused) {
                    playerContainer.classList.add('controls-hidden');
                }
            }, 3000);
        };

        playerContainer.addEventListener('mousemove', resetControlsTimeout);
        playerContainer.addEventListener('touchstart', resetControlsTimeout);
        this.video.addEventListener('play', resetControlsTimeout);
        this.video.addEventListener('pause', () => {
            playerContainer.classList.remove('controls-hidden');
            clearTimeout(timeout);
        });
        resetControlsTimeout();
    }

    async load(url, streamType) {
        console.log('[FastStreamPlayer] Loading:', url, 'Type:', streamType);
        const urlLower = url.toLowerCase();

        // Show loading
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.add('visible');

        const onReady = () => loadingOverlay.classList.remove('visible');
        this.video.addEventListener('playing', onReady);
        this.video.addEventListener('canplay', onReady);

        // Determine stream format
        const isHls = urlLower.includes('.m3u8') || streamType === 'hls' || streamType === 'application/x-mpegurl' || streamType === 'application/vnd.apple.mpegurl';
        const isDash = urlLower.includes('.mpd') || streamType === 'dash' || streamType === 'application/dash+xml';

        // Update Stream Info
        const streamTypeElem = document.getElementById('streamType');
        if (isHls) {
            streamTypeElem.textContent = 'HLS Stream';
        } else if (isDash) {
            streamTypeElem.textContent = 'DASH Stream';
        } else {
            streamTypeElem.textContent = 'Native Video';
        }

        // 1. HLS (.m3u8)
        if (isHls) {
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                console.log('[FastStreamPlayer] Using Hls.js');
                this.hls = new Hls({
                    capLevelToPlayerSize: true
                });
                this.hls.loadSource(url);
                this.hls.attachMedia(this.video);
                this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                    const qualitySelector = document.getElementById('qualitySelector');
                    if (qualitySelector) {
                        qualitySelector.innerHTML = '<option value="-1">Auto</option>';
                        data.levels.forEach((level, index) => {
                            const option = document.createElement('option');
                            option.value = index;
                            option.textContent = `${level.height}p`;
                            qualitySelector.appendChild(option);
                        });
                        
                        qualitySelector.addEventListener('change', (e) => {
                            this.hls.currentLevel = parseInt(e.target.value);
                        });
                    }

                    const playPromise = this.video.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(e => {
                            console.log('[FastStreamPlayer] Autoplay paused by browser. User must click play.');
                        });
                    }
                });
                
                this.hls.on(Hls.Events.ERROR, (e, data) => {
                    if (data.fatal) {
                        console.error('[FastStreamPlayer] HLS Fatal Error:', data);
                        const errorOverlay = document.getElementById('errorOverlay');
                        const errorDetails = document.getElementById('errorDetails');
                        errorOverlay.classList.add('visible');
                        errorDetails.textContent = `HLS Error: ${data.type} - ${data.details}`;
                    }
                });
                return;
            } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
                console.log('[FastStreamPlayer] Using Native HLS');
                this.video.src = url;
                this.video.play().catch(e => {});
                return;
            }
        }

        // 2. DASH (.mpd)
        if (isDash) {
            if (typeof dashjs !== 'undefined') {
                console.log('[FastStreamPlayer] Using Dash.js');
                this.dash = dashjs.MediaPlayer().create();
                this.dash.initialize(this.video, url, true);
                return;
            }
        }

        // 3. Native
        console.log('[FastStreamPlayer] Using Native Player');
        this.video.src = url;
        this.video.play().catch(e => {});
    }
}

// ============================================================================
// MAIN INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('video-player');
    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('videoUrl') || params.get('url');
    const streamType = params.get('type');

    if (!videoUrl) {
        console.error('No videoUrl found in query params');
        const errorOverlay = document.getElementById('errorOverlay');
        errorOverlay.classList.add('visible');
        return;
    }

    const player = new FastStreamPlayer(video);
    player.load(videoUrl, streamType);

    // Initialize Gesture Manager
    if (video) {
        const container = document.getElementById('tapArea') || document.body;

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
                if (video.paused) {
                    const p = video.play();
                    if (p !== undefined) p.catch(e => console.log('Gesture play blocked', e));
                } else {
                    video.pause();
                }
            },
            onToggleUI: () => {
                const controls = document.getElementById('controlsOverlay');
                if (controls) {
                    controls.classList.toggle('visible');
                }
            },
            onVolumeChange: (delta) => {
                const newVol = Math.max(0, Math.min(1, video.volume + (delta * 0.1)));
                video.volume = newVol;
            }
        });
    }

    // Init UI Extensions (Subtitles, Settings, Sources Browser)
    initUIExtensions();

    // Playback error handling
    video.addEventListener('error', () => {
        const err = video.error;
        console.error('Video Error:', err);
        const errorOverlay = document.getElementById('errorOverlay');
        const errorDetails = document.getElementById('errorDetails');
        errorOverlay.classList.add('visible');
        
        let errMsg = 'Unknown network error';
        if (err) {
            switch (err.code) {
                case 1: errMsg = 'Aborted'; break;
                case 2: errMsg = 'Network Error (CORS, missing headers, or cookies blocked)'; break;
                case 3: errMsg = 'Decode Error'; break;
                case 4: errMsg = 'Format Not Supported (404, invalid media, or auth failed)'; break;
            }
            if (err.message) errMsg += ` - ${err.message}`;
        }
        errorDetails.textContent = `Native Error [Code ${err ? err.code : '?'}] - ${errMsg}`;
    });
});
