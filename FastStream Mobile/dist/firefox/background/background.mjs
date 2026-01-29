/**
 * FastStream Mobile - Background Service Worker (The Brain)
 * Detects video streams and manages extension state
 * 
 * @description Video sniffer that monitors network requests for streaming URLs
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const VIDEO_EXTENSIONS = ['.m3u8', '.mpd', '.mp4', '.webm', '.ts'];
const EXTENSION_ID = chrome.runtime.id;

// Icon paths for different states
const ICONS = {
    inactive: {
        16: 'icons/icon-16.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png'
    },
    active: {
        16: 'icons/icon-active-16.png',
        48: 'icons/icon-active-48.png',
        128: 'icons/icon-active-128.png'
    }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Extension install/update handler
 */
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[FastStream] Extension installed:', details.reason);

    // Initialize default settings
    await chrome.storage.local.set({
        enabled: true,
        streamQuality: 'auto',
        bufferSize: 'medium',
        dataUsage: 0,
        streamsDetected: 0,
        detectedVideos: {} // Map of tabId -> video info
    });

    // Setup dynamic rules for video detection
    await setupDynamicRules();

    console.log('[FastStream] Initialization complete');
});

/**
 * Setup declarativeNetRequest dynamic rules for video detection
 */
async function setupDynamicRules() {
    // Remove existing dynamic rules first
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(rule => rule.id);

    if (existingRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existingRuleIds
        });
    }

    console.log('[FastStream] Dynamic rules setup complete');
}

// ============================================================================
// VIDEO DETECTION (The Sniffer)
// ============================================================================

/**
 * Check if a URL is a video stream
 * @param {string} url - URL to check
 * @returns {Object|null} - Video info or null
 */
function detectVideoUrl(url) {
    if (!url) return null;

    const urlLower = url.toLowerCase();

    // Check for video extensions
    for (const ext of VIDEO_EXTENSIONS) {
        if (urlLower.includes(ext)) {
            // Determine stream type
            let type = 'unknown';
            if (urlLower.includes('.m3u8')) type = 'hls';
            else if (urlLower.includes('.mpd')) type = 'dash';
            else if (urlLower.includes('.mp4')) type = 'mp4';
            else if (urlLower.includes('.webm')) type = 'webm';
            else if (urlLower.includes('.ts')) type = 'ts-segment';

            return {
                url: url,
                type: type,
                extension: ext,
                detectedAt: Date.now()
            };
        }
    }

    return null;
}

/**
 * Check if request is from our own extension
 * @param {string} url - Request URL
 * @param {string} initiator - Request initiator
 * @returns {boolean}
 */
function isOwnExtensionRequest(url, initiator) {
    if (!initiator) return false;

    // Check if initiator contains our extension ID
    if (initiator.includes(EXTENSION_ID)) return true;
    if (initiator.startsWith('chrome-extension://')) return true;
    if (initiator.startsWith('moz-extension://')) return true;

    return false;
}

/**
 * Store detected video for a tab
 * @param {number} tabId - Tab ID
 * @param {Object} videoInfo - Video information
 */
async function storeDetectedVideo(tabId, videoInfo) {
    try {
        const data = await chrome.storage.local.get(['detectedVideos', 'streamsDetected']);
        const detectedVideos = data.detectedVideos || {};
        const streamsDetected = (data.streamsDetected || 0) + 1;

        // Store video info for this tab (keep last 5 per tab to avoid duplicates)
        if (!detectedVideos[tabId]) {
            detectedVideos[tabId] = [];
        }

        // Check if this URL is already detected for this tab
        const existingIndex = detectedVideos[tabId].findIndex(v => v.url === videoInfo.url);
        if (existingIndex === -1) {
            // Add new video, keep max 5 per tab
            detectedVideos[tabId].unshift(videoInfo);
            if (detectedVideos[tabId].length > 5) {
                detectedVideos[tabId].pop();
            }

            await chrome.storage.local.set({
                detectedVideos,
                streamsDetected
            });

            console.log(`[FastStream] ✓ Video stored for tab ${tabId}:`, videoInfo.type, videoInfo.url.substring(0, 80));

            // Update icon to active state
            await setIconState(tabId, 'active');

            // Notify popup if open
            chrome.runtime.sendMessage({
                type: 'VIDEO_DETECTED',
                payload: { tabId, videoInfo }
            }).catch(() => {
                // Popup not open, ignore
            });
        }
    } catch (error) {
        console.error('[FastStream] Failed to store video:', error);
    }
}

/**
 * Set extension icon state for a tab
 * @param {number} tabId - Tab ID
 * @param {'active'|'inactive'} state - Icon state
 */
async function setIconState(tabId, state) {
    try {
        const iconPaths = ICONS[state] || ICONS.inactive;

        await chrome.action.setIcon({
            tabId: tabId,
            path: iconPaths
        });

        // Also set badge for active state
        if (state === 'active') {
            await chrome.action.setBadgeText({
                tabId: tabId,
                text: '●'
            });
            await chrome.action.setBadgeBackgroundColor({
                tabId: tabId,
                color: '#4CAF50'
            });
        } else {
            await chrome.action.setBadgeText({
                tabId: tabId,
                text: ''
            });
        }

        console.log(`[FastStream] Icon set to ${state} for tab ${tabId}`);
    } catch (error) {
        // Tab might be closed, ignore
        console.warn('[FastStream] Could not set icon:', error.message);
    }
}

// ============================================================================
// WEB REQUEST MONITORING (Using webRequest API as backup)
// ============================================================================

/**
 * Monitor web requests for video URLs
 * Note: declarativeNetRequest is for blocking/modifying, 
 * we use webRequest.onBeforeRequest for detection
 */
if (chrome.webRequest) {
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            // Skip if no tab (background request)
            if (details.tabId < 0) return;

            // Skip if from our extension
            if (isOwnExtensionRequest(details.url, details.initiator)) {
                return;
            }

            // Check if this is a video URL
            const videoInfo = detectVideoUrl(details.url);

            if (videoInfo) {
                console.log(`[FastStream] 🎬 Video detected (${videoInfo.type}):`, details.url.substring(0, 100));

                // Store the detected video
                storeDetectedVideo(details.tabId, {
                    ...videoInfo,
                    initiator: details.initiator,
                    requestId: details.requestId
                });
            }
        },
        {
            urls: [
                '*://*/*.m3u8*',
                '*://*/*.mpd*',
                '*://*/*.mp4*',
                '*://*/*.webm*',
                '*://*/*.ts*'
            ],
            types: ['media', 'xmlhttprequest', 'other']
        }
    );

    console.log('[FastStream] webRequest listener registered');
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[FastStream] Message received:', message.type);

    switch (message.type) {
        case 'GET_DETECTED_VIDEOS':
            handleGetDetectedVideos(message.payload?.tabId, sendResponse);
            return true; // Keep channel open for async

        case 'GET_SETTINGS':
            chrome.storage.local.get(null, (settings) => {
                sendResponse({ success: true, data: settings });
            });
            return true;

        case 'UPDATE_SETTINGS':
            chrome.storage.local.set(message.payload, () => {
                sendResponse({ success: true });
            });
            return true;

        case 'CLEAR_TAB_VIDEOS':
            handleClearTabVideos(message.payload?.tabId, sendResponse);
            return true;

        case 'CONTENT_SCRIPT_READY':
            console.log('[FastStream] Content script ready in tab:', sender.tab?.id);
            sendResponse({ success: true });
            break;

        default:
            sendResponse({ success: false, error: 'Unknown message type' });
    }
});

/**
 * Get detected videos for a tab
 * @param {number} tabId - Tab ID
 * @param {Function} sendResponse - Response callback
 */
async function handleGetDetectedVideos(tabId, sendResponse) {
    try {
        const data = await chrome.storage.local.get('detectedVideos');
        const videos = data.detectedVideos?.[tabId] || [];
        sendResponse({ success: true, data: videos });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Clear detected videos for a tab
 * @param {number} tabId - Tab ID
 * @param {Function} sendResponse - Response callback
 */
async function handleClearTabVideos(tabId, sendResponse) {
    try {
        const data = await chrome.storage.local.get('detectedVideos');
        const detectedVideos = data.detectedVideos || {};

        delete detectedVideos[tabId];

        await chrome.storage.local.set({ detectedVideos });
        await setIconState(tabId, 'inactive');

        sendResponse({ success: true });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// ============================================================================
// TAB LIFECYCLE
// ============================================================================

/**
 * Clean up when tab is closed
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
    try {
        const data = await chrome.storage.local.get('detectedVideos');
        const detectedVideos = data.detectedVideos || {};

        if (detectedVideos[tabId]) {
            delete detectedVideos[tabId];
            await chrome.storage.local.set({ detectedVideos });
            console.log(`[FastStream] Cleaned up data for closed tab ${tabId}`);
        }
    } catch (error) {
        console.error('[FastStream] Tab cleanup error:', error);
    }
});

/**
 * Reset icon when navigating to a new page
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && changeInfo.url) {
        // New navigation, reset icon (videos will be re-detected)
        await setIconState(tabId, 'inactive');
    }
});

// ============================================================================
// STARTUP
// ============================================================================

console.log('[FastStream] 🚀 Background service worker started');
console.log('[FastStream] Extension ID:', EXTENSION_ID);
