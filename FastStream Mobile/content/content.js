/**
 * FastStream Mobile - Content Script
 * Handles IDM-style floating detection button and player injection
 */

(function () {
    'use strict';

    let injectedPlayer = null;
    let originalVideo = null;
    const detectedUrls = new Set();
    let floatingButtonContainer = null;

    // ============================================================================
    // STYLES
    // ============================================================================
    
    function injectStyles() {
        if (document.getElementById('faststream-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'faststream-styles';
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
            
            #faststream-floating-btn {
                position: absolute;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                background: rgba(20, 20, 25, 0.7);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 20px;
                color: #fff;
                font-family: 'Inter', sans-serif;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                overflow: hidden;
            }
            
            #faststream-floating-btn::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: linear-gradient(135deg, rgba(76, 175, 80, 0.2), rgba(0, 0, 0, 0));
                z-index: -1;
            }

            #faststream-floating-btn:hover {
                transform: translateY(-2px) scale(1.02);
                background: rgba(30, 30, 40, 0.85);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), 0 0 20px rgba(76, 175, 80, 0.2);
                border-color: rgba(76, 175, 80, 0.4);
            }
            
            #faststream-floating-btn .fs-icon {
                font-size: 16px;
                background: linear-gradient(135deg, #4CAF50, #8BC34A);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                filter: drop-shadow(0 2px 4px rgba(76, 175, 80, 0.3));
            }

            .fs-actions {
                display: none;
                gap: 8px;
                margin-left: 8px;
                padding-left: 8px;
                border-left: 1px solid rgba(255, 255, 255, 0.1);
            }

            #faststream-floating-btn:hover .fs-actions {
                display: flex;
            }

            .fs-action-btn {
                background: rgba(255, 255, 255, 0.1);
                border: none;
                border-radius: 12px;
                padding: 4px 10px;
                color: #fff;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }

            .fs-action-btn:hover {
                background: rgba(76, 175, 80, 0.8);
            }
            
            #faststream-overlay {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                z-index: 2147483647 !important;
                background: #000;
                animation: fs-fade-in 0.3s ease;
            }
            
            @keyframes fs-fade-in {
                from { opacity: 0; transform: scale(0.98); }
                to { opacity: 1; transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }

    // ============================================================================
    // MESSAGE HANDLING
    // ============================================================================

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'VIDEO_DETECTED') {
            console.log('[FastStream] Video detected by background:', message.url);
            if (!detectedUrls.has(message.url)) {
                detectedUrls.add(message.url);
                showFloatingButton(message.url, message.type);
            }
        } else if (message.type === 'OPEN_PLAYER') {
            console.log('[FastStream] Opening player from popup:', message.payload.url);
            injectPlayer(message.payload.url, message.payload.type);
        }
    });

    // ============================================================================
    // DOM HELPERS
    // ============================================================================

    function findMainVideo() {
        const videos = document.querySelectorAll('video');
        if (videos.length === 0) return null;
        if (videos.length === 1) return videos[0];

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
    // FLOATING BUTTON UI (IDM-style)
    // ============================================================================

    function showFloatingButton(videoUrl, streamType) {
        injectStyles();
        
        if (!floatingButtonContainer) {
            floatingButtonContainer = document.createElement('div');
            floatingButtonContainer.id = 'faststream-floating-btn';
            
            floatingButtonContainer.innerHTML = `
                <span class="fs-icon">⚡</span>
                <span>Video Detected</span>
                <div class="fs-actions">
                    <button class="fs-action-btn fs-play">Play</button>
                    <button class="fs-action-btn fs-copy">Copy URL</button>
                </div>
            `;
            
            // Positioning logic
            const video = findMainVideo();
            if (video) {
                // Position relative to video element
                const rect = video.getBoundingClientRect();
                floatingButtonContainer.style.top = `${rect.top + window.scrollY + 10}px`;
                floatingButtonContainer.style.right = `${window.innerWidth - (rect.right + window.scrollX) + 10}px`;
                // Keep it within screen bounds
                if (parseFloat(floatingButtonContainer.style.right) < 10) floatingButtonContainer.style.right = '10px';
                if (parseFloat(floatingButtonContainer.style.top) < 10) floatingButtonContainer.style.top = '10px';
            } else {
                // Fixed positioning if no video element is found but request detected
                floatingButtonContainer.style.position = 'fixed';
                floatingButtonContainer.style.top = '20px';
                floatingButtonContainer.style.right = '20px';
            }
            
            document.body.appendChild(floatingButtonContainer);
            
            // Event listeners
            floatingButtonContainer.querySelector('.fs-play').addEventListener('click', (e) => {
                e.stopPropagation();
                injectPlayer(videoUrl, streamType);
                floatingButtonContainer.style.display = 'none';
            });
            
            floatingButtonContainer.querySelector('.fs-copy').addEventListener('click', (e) => {
                e.stopPropagation();
                const btn = e.target;
                const originalText = btn.textContent;
                
                const showSuccess = () => {
                    btn.textContent = 'Copied!';
                    setTimeout(() => btn.textContent = originalText, 2000);
                };
                
                const fallbackCopy = () => {
                    const textArea = document.createElement("textarea");
                    textArea.value = videoUrl;
                    document.body.appendChild(textArea);
                    textArea.select();
                    try {
                        const successful = document.execCommand('copy');
                        if (successful) {
                            showSuccess();
                        } else {
                            window.prompt("Copy URL:", videoUrl);
                        }
                    } catch (err) {
                        window.prompt("Copy URL:", videoUrl);
                    }
                    document.body.removeChild(textArea);
                };

                fallbackCopy();
            });
        } else {
            // Update the URL if a new one is detected and button exists
            floatingButtonContainer.style.display = 'flex';
            floatingButtonContainer.querySelector('.fs-play').onclick = (e) => {
                e.stopPropagation();
                injectPlayer(videoUrl, streamType);
                floatingButtonContainer.style.display = 'none';
            };
        }
    }

    // ============================================================================
    // PLAYER INJECTION
    // ============================================================================

    function injectPlayer(videoUrl, streamType) {
        if (injectedPlayer) return;

        const video = findMainVideo();
        if (video) {
            video.pause();
            originalVideo = video;
        }

        console.log('[FastStream] Injecting full-screen player overlay');

        // Create container
        const container = document.createElement('div');
        container.id = 'faststream-overlay';

        // Create iframe
        const iframe = document.createElement('iframe');
        iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
            background: #000;
        `;
        iframe.allow = "autoplay; fullscreen; picture-in-picture; clipboard-write";

        let playerUrl;
        try {
            playerUrl = chrome.runtime.getURL("player/index.html");
        } catch (e) {
            console.warn('[FastStream] Extension context invalidated. Please refresh the page.');
            alert('FastStream Extension was updated. Please refresh the page to continue.');
            return;
        }

        iframe.src = `${playerUrl}?videoUrl=${encodeURIComponent(videoUrl)}${streamType ? `&type=${encodeURIComponent(streamType)}` : ''}`;

        // Close button (sleek and modern)
        const closeBtn = document.createElement('div');
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        closeBtn.style.cssText = `
            position: absolute;
            top: 24px;
            right: 24px;
            width: 44px;
            height: 44px;
            background: rgba(20, 20, 25, 0.4);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #fff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 1000000;
            transition: all 0.3s;
        `;
        
        closeBtn.onmouseover = () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.15)';
            closeBtn.style.transform = 'scale(1.05)';
        };
        closeBtn.onmouseout = () => {
            closeBtn.style.background = 'rgba(20, 20, 25, 0.4)';
            closeBtn.style.transform = 'scale(1)';
        };
        
        closeBtn.onclick = removePlayer;

        container.appendChild(iframe);
        container.appendChild(closeBtn);
        document.body.appendChild(container);

        if (video) {
            // Hide the original video visually but keep it in DOM for layout
            video.style.opacity = '0';
            
            const updatePosition = () => {
                const rect = video.getBoundingClientRect();
                container.style.setProperty('position', 'fixed', 'important');
                container.style.setProperty('top', `${rect.top}px`, 'important');
                container.style.setProperty('left', `${rect.left}px`, 'important');
                container.style.setProperty('width', `${rect.width}px`, 'important');
                container.style.setProperty('height', `${rect.height}px`, 'important');
            };
            
            updatePosition();
            
            window.addEventListener('resize', updatePosition);
            window.addEventListener('scroll', updatePosition, true);
            
            const ro = new ResizeObserver(updatePosition);
            ro.observe(video);
            
            container._cleanup = () => {
                window.removeEventListener('resize', updatePosition);
                window.removeEventListener('scroll', updatePosition, true);
                ro.disconnect();
                if (video) video.style.opacity = '1';
            };
        } else {
            // Prevent scrolling on body when full-page player is active
            document.body.style.overflow = 'hidden';
        }

        injectedPlayer = container;
    }

    function removePlayer() {
        if (injectedPlayer) {
            if (injectedPlayer._cleanup) injectedPlayer._cleanup();
            injectedPlayer.remove();
            injectedPlayer = null;
            document.body.style.overflow = '';
        }
        
        if (floatingButtonContainer) {
            floatingButtonContainer.style.display = 'flex';
        }
        
        if (originalVideo) {
            originalVideo = null;
        }
    }

})();
