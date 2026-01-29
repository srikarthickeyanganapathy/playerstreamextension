/**
 * FastStream Mobile - Content Script
 * Handles video detection, player injection, and page integration
 */

(function () {
    'use strict';

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    const STREAM_PATTERNS = [
        /\.m3u8(\?|$)/i,      // HLS streams
        /\.mpd(\?|$)/i,       // DASH streams
        /\.mp4(\?|$)/i,       // Direct MP4
        /\.webm(\?|$)/i,      // WebM format
        /manifest.*\.m3u8/i,  // HLS manifests
        /manifest.*\.mpd/i    // DASH manifests
    ];

    // State
    let injectedPlayer = null;
    let originalVideo = null;
    let originalVideoState = null;

    // ============================================================================
    // VIDEO DETECTION
    // ============================================================================

    /**
     * Check if URL matches streaming patterns
     * @param {string} url - URL to check
     * @returns {Object|null} - Stream info or null
     */
    function detectStreamUrl(url) {
        if (!url) return null;

        for (const pattern of STREAM_PATTERNS) {
            if (pattern.test(url)) {
                const type = url.includes('.m3u8') ? 'hls'
                    : url.includes('.mpd') ? 'dash'
                        : 'direct';
                return { url, type };
            }
        }
        return null;
    }

    /**
     * Find the main video element on the page
     * @returns {HTMLVideoElement|null}
     */
    function findMainVideo() {
        const videos = document.querySelectorAll('video');

        if (videos.length === 0) return null;
        if (videos.length === 1) return videos[0];

        // Find the largest visible video
        let mainVideo = null;
        let maxArea = 0;

        videos.forEach(video => {
            const rect = video.getBoundingClientRect();
            const area = rect.width * rect.height;
            const isVisible = rect.width > 0 && rect.height > 0 &&
                window.getComputedStyle(video).display !== 'none';

            if (isVisible && area > maxArea) {
                maxArea = area;
                mainVideo = video;
            }
        });

        return mainVideo;
    }

    /**
     * Get video source URL from video element
     * @param {HTMLVideoElement} video
     * @returns {string|null}
     */
    function getVideoSource(video) {
        // Check src attribute first
        if (video.src) {
            return video.src;
        }

        // Check source elements
        const sources = video.querySelectorAll('source');
        for (const source of sources) {
            if (source.src) {
                return source.src;
            }
        }

        // Check currentSrc
        if (video.currentSrc) {
            return video.currentSrc;
        }

        return null;
    }

    // ============================================================================
    // PLAYER INJECTION
    // ============================================================================

    /**
     * Inject FastStream player over original video
     * @param {string} videoUrl - The video URL to play
     * @param {HTMLVideoElement} [targetVideo] - Optional specific video to overlay
     */
    function injectPlayer(videoUrl, targetVideo = null) {
        console.log('[FastStream] Injecting player for:', videoUrl);

        // Find video element if not provided
        const video = targetVideo || findMainVideo();

        if (!video) {
            console.warn('[FastStream] No video element found to overlay');
            // Open in new tab as fallback
            openPlayerInTab(videoUrl);
            return;
        }

        // Store reference and state
        originalVideo = video;
        originalVideoState = {
            paused: video.paused,
            currentTime: video.currentTime,
            display: video.style.display,
            visibility: video.style.visibility
        };

        // Pause and hide original video (don't remove to preserve site scripts)
        video.pause();
        video.style.visibility = 'hidden';

        // Get video position and size
        const rect = video.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        // Create container for the injected player
        const container = document.createElement('div');
        container.id = 'faststream-player-container';
        container.style.cssText = `
      position: absolute;
      top: ${rect.top + scrollY}px;
      left: ${rect.left + scrollX}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      z-index: 2147483647;
      background: #000;
      border-radius: 0;
      overflow: hidden;
    `;

        // Create close button
        const closeBtn = document.createElement('button');
        closeBtn.id = 'faststream-close-btn';
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      font-size: 18px;
      cursor: pointer;
      z-index: 2147483648;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.3s;
    `;
        closeBtn.addEventListener('click', removeInjectedPlayer);

        // Create iframe for player
        const playerUrl = chrome.runtime.getURL('player/index.html');
        const encodedVideoUrl = encodeURIComponent(videoUrl);

        const iframe = document.createElement('iframe');
        iframe.id = 'faststream-player-iframe';
        iframe.src = `${playerUrl}?url=${encodedVideoUrl}`;
        iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      background: #000;
    `;
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');

        // Assemble and inject
        container.appendChild(iframe);
        container.appendChild(closeBtn);
        document.body.appendChild(container);

        // Show close button on hover
        container.addEventListener('mouseenter', () => {
            closeBtn.style.opacity = '1';
        });
        container.addEventListener('mouseleave', () => {
            closeBtn.style.opacity = '0';
        });

        // Store reference
        injectedPlayer = container;

        // Handle window resize
        window.addEventListener('resize', handleResize);

        // Notify background
        chrome.runtime.sendMessage({
            type: 'PLAYER_INJECTED',
            payload: { url: videoUrl }
        }).catch(() => { });

        console.log('[FastStream] Player injected successfully');
    }

    /**
     * Remove injected player and restore original video
     */
    function removeInjectedPlayer() {
        console.log('[FastStream] Removing injected player');

        if (injectedPlayer) {
            injectedPlayer.remove();
            injectedPlayer = null;
        }

        if (originalVideo && originalVideoState) {
            // Restore original video visibility
            originalVideo.style.visibility = originalVideoState.visibility || 'visible';
            originalVideo.style.display = originalVideoState.display || '';

            // Optionally resume playback
            // originalVideo.currentTime = originalVideoState.currentTime;
            // if (!originalVideoState.paused) {
            //   originalVideo.play();
            // }
        }

        originalVideo = null;
        originalVideoState = null;

        window.removeEventListener('resize', handleResize);

        // Notify background
        chrome.runtime.sendMessage({
            type: 'PLAYER_REMOVED'
        }).catch(() => { });
    }

    /**
     * Handle window resize - update player position
     */
    function handleResize() {
        if (!injectedPlayer || !originalVideo) return;

        const rect = originalVideo.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        injectedPlayer.style.top = `${rect.top + scrollY}px`;
        injectedPlayer.style.left = `${rect.left + scrollX}px`;
        injectedPlayer.style.width = `${rect.width}px`;
        injectedPlayer.style.height = `${rect.height}px`;
    }

    /**
     * Open player in a new tab (fallback)
     * @param {string} videoUrl
     */
    function openPlayerInTab(videoUrl) {
        const playerUrl = chrome.runtime.getURL('player/index.html');
        const encodedVideoUrl = encodeURIComponent(videoUrl);
        window.open(`${playerUrl}?url=${encodedVideoUrl}`, '_blank');
    }

    // ============================================================================
    // STREAM DETECTION (Passive monitoring)
    // ============================================================================

    /**
     * Notify background script of detected stream
     * @param {Object} streamInfo - Stream information
     */
    function notifyStreamDetected(streamInfo) {
        chrome.runtime.sendMessage({
            type: 'STREAM_DETECTED',
            payload: streamInfo
        }).catch(err => {
            // Extension context may be invalidated
        });
    }

    /**
     * Observe video elements on the page
     */
    function observeVideoElements() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeName === 'VIDEO') {
                        handleVideoElement(node);
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll('video').forEach(handleVideoElement);
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        // Check existing videos
        document.querySelectorAll('video').forEach(handleVideoElement);
    }

    /**
     * Handle discovered video elements
     * @param {HTMLVideoElement} video - The video element
     */
    function handleVideoElement(video) {
        if (video.dataset.faststreamProcessed) return;
        video.dataset.faststreamProcessed = 'true';

        // Check src attribute
        if (video.src) {
            const streamInfo = detectStreamUrl(video.src);
            if (streamInfo) {
                notifyStreamDetected(streamInfo);
            }
        }

        // Listen for source changes
        video.addEventListener('loadstart', () => {
            if (video.src) {
                const streamInfo = detectStreamUrl(video.src);
                if (streamInfo) {
                    notifyStreamDetected(streamInfo);
                }
            }
        });
    }

    // ============================================================================
    // MESSAGE HANDLING
    // ============================================================================

    /**
     * Handle messages from background script
     */
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[FastStream] Message received:', message.type);

        switch (message.type) {
            case 'OPEN_PLAYER':
                // Inject player with the provided URL
                const videoUrl = message.payload?.url;
                if (videoUrl) {
                    injectPlayer(videoUrl);
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'No URL provided' });
                }
                break;

            case 'CLOSE_PLAYER':
                removeInjectedPlayer();
                sendResponse({ success: true });
                break;

            case 'GET_VIDEO_INFO':
                // Return info about videos on the page
                const mainVideo = findMainVideo();
                if (mainVideo) {
                    sendResponse({
                        success: true,
                        data: {
                            src: getVideoSource(mainVideo),
                            duration: mainVideo.duration,
                            currentTime: mainVideo.currentTime,
                            paused: mainVideo.paused
                        }
                    });
                } else {
                    sendResponse({ success: false, error: 'No video found' });
                }
                break;

            case 'PING':
                sendResponse({ success: true, ready: true });
                break;

            default:
                sendResponse({ success: false, error: 'Unknown message type' });
        }

        return true; // Keep channel open for async response
    });

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    function init() {
        console.log('[FastStream] Content script initialized');

        // Start observing for video elements
        observeVideoElements();

        // Notify background that content script is ready
        chrome.runtime.sendMessage({
            type: 'CONTENT_SCRIPT_READY',
            payload: { url: window.location.href }
        }).catch(() => { });
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for debugging
    window.__faststream = {
        injectPlayer,
        removeInjectedPlayer,
        findMainVideo,
        getVideoSource
    };

})();
