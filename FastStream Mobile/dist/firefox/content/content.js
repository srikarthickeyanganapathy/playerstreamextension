/**
 * FastStream Mobile - Content Script
 * Handles player injection upon video detection
 */

(function () {
    'use strict';

    let injectedPlayer = null;
    let originalVideo = null;

    // ============================================================================
    // MESSAGE HANDLING
    // ============================================================================

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'VIDEO_DETECTED') {
            console.log('[FastStream] Video detected by background:', message.url);
            injectPlayer(message.url);
        }
    });

    // ============================================================================
    // DOM HELPERS
    // ============================================================================

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
            const style = window.getComputedStyle(video);
            const isVisible = rect.width > 0 && rect.height > 0 &&
                style.display !== 'none' && style.visibility !== 'hidden';

            if (isVisible && area > maxArea) {
                maxArea = area;
                mainVideo = video;
            }
        });

        return mainVideo;
    }

    // ============================================================================
    // PLAYER INJECTION
    // ============================================================================

    function injectPlayer(videoUrl) {
        if (injectedPlayer) {
            console.log('[FastStream] Player already injected, updating URL');
            // Optionally update the existing iframe's URL?
            // For now, let's just log it. If user wants to switch streams, they might need to reload or we assume the first stream is the main one.
            return;
        }

        const video = findMainVideo();
        if (!video) {
            console.warn('[FastStream] No video element found to overlay');
            return;
        }

        console.log('[FastStream] Injecting player overlay');

        // Pause native video
        video.pause();
        originalVideo = video;

        // Get position
        const rect = video.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        // Create container
        const container = document.createElement('div');
        container.id = 'faststream-overlay';
        container.style.cssText = `
            position: absolute;
            top: ${rect.top + scrollY}px;
            left: ${rect.left + scrollX}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            z-index: 999999;
            background: #000;
        `;

        // Create iframe
        const iframe = document.createElement('iframe');
        iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
        `;
        iframe.allow = "autoplay; fullscreen; picture-in-picture";
        iframe.allowFullscreen = true;

        const playerUrl = chrome.runtime.getURL("player/index.html");
        iframe.src = `${playerUrl}?videoUrl=${encodeURIComponent(videoUrl)}`;

        // Close button
        const closeBtn = document.createElement('div');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            width: 30px;
            height: 30px;
            background: rgba(0,0,0,0.5);
            color: #fff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 1000000;
            font-family: sans-serif;
        `;
        closeBtn.onclick = removePlayer;

        container.appendChild(iframe);
        container.appendChild(closeBtn);
        document.body.appendChild(container);

        injectedPlayer = container;

        // monitor resize
        window.addEventListener('resize', updatePosition);
    }

    function removePlayer() {
        if (injectedPlayer) {
            injectedPlayer.remove();
            injectedPlayer = null;
        }
        window.removeEventListener('resize', updatePosition);
        if (originalVideo) {
            // We don't necessarily play it, just leave it paused? 
            // Valid use case is user closed overlay to interact with site.
            originalVideo = null;
        }
    }

    function updatePosition() {
        if (!injectedPlayer || !originalVideo) return;
        const rect = originalVideo.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        injectedPlayer.style.top = (rect.top + scrollY) + 'px';
        injectedPlayer.style.left = (rect.left + scrollX) + 'px';
        injectedPlayer.style.width = rect.width + 'px';
        injectedPlayer.style.height = rect.height + 'px';
    }

})();
