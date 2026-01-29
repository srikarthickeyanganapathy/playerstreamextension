/**
 * FastStream Mobile - Background Service Worker
 * Handles network sniffing and video detection via MIME types
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const TARGET_MIME_TYPES = [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'application/x-mpegURL', // HLS
    'application/vnd.apple.mpegurl', // HLS (alternate)
    'application/dash+xml' // DASH
];

const EXTENSION_ID = chrome.runtime.id;

// Icon paths
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
// VIDEO DETECTION
// ============================================================================

/**
 * Check if the request is initiated by the extension itself
 * @param {string} initiator - The initiator URL
 * @returns {boolean}
 */
function isOwnExtensionRequest(initiator) {
    if (!initiator) return false;
    return initiator.includes(EXTENSION_ID) ||
        initiator.startsWith('chrome-extension://') ||
        initiator.startsWith('moz-extension://');
}

/**
 * Listen for response headers to detect video MIME types
 */
if (chrome.webRequest) {
    chrome.webRequest.onHeadersReceived.addListener(
        (details) => {
            if (details.tabId < 0) return;
            if (isOwnExtensionRequest(details.initiator)) return;

            // Check content type
            const contentTypeHeader = details.responseHeaders.find(
                h => h.name.toLowerCase() === 'content-type'
            );

            if (contentTypeHeader) {
                const contentType = contentTypeHeader.value.toLowerCase().split(';')[0].trim();

                if (TARGET_MIME_TYPES.includes(contentType)) {
                    console.log('[FastStream] Video detected:', contentType, details.url);
                    handleDetectedVideo(details.tabId, details.url, contentType);
                }
            }
        },
        { urls: ["<all_urls>"] },
        ["responseHeaders"]
    );
}

/**
 * Handle a detected video stream
 * @param {number} tabId 
 * @param {string} url 
 * @param {string} type 
 */
async function handleDetectedVideo(tabId, url, type) {
    const videoInfo = {
        url,
        type,
        detectedAt: Date.now()
    };

    // 0. CORS / Header Stripping
    // Remove X-Frame-Options and CSP to allow playback
    const ruleId = parseInt(tabId + "1"); // Simple unique ID generation strategy for demo

    // We strive to not remove rules blindly to avoid quota issues, but for this simpler version we overwrite.
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
        addRules: [{
            "id": ruleId,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "responseHeaders": [
                    { "header": "x-frame-options", "operation": "remove" },
                    { "header": "content-security-policy", "operation": "remove" },
                    { "header": "access-control-allow-origin", "operation": "set", "value": "*" }
                ]
            },
            "condition": {
                "urlFilter": url,
                "resourceTypes": ["xmlhttprequest", "media", "sub_frame"]
            }
        }]
    });

    // 1. Storage
    await storeDetectedVideo(tabId, videoInfo);

    // 2. Icon
    await setIconState(tabId, 'active');

    // 3. Notify Content Script
    try {
        await chrome.tabs.sendMessage(tabId, {
            action: 'VIDEO_DETECTED',
            url: url
        });
    } catch (e) {
        // Tab might not be ready or content script not injected yet
        console.warn('[FastStream] Failed to notify tab:', e);
    }
}

// ============================================================================
// STORAGE & STATE
// ============================================================================

async function storeDetectedVideo(tabId, videoInfo) {
    try {
        const data = await chrome.storage.local.get(['detectedVideos']);
        const detectedVideos = data.detectedVideos || {};

        if (!detectedVideos[tabId]) detectedVideos[tabId] = [];

        // Avoid duplicates checking URL
        const existing = detectedVideos[tabId].find(v => v.url === videoInfo.url);
        if (!existing) {
            detectedVideos[tabId].unshift(videoInfo);
            // Limit to last 10
            if (detectedVideos[tabId].length > 10) detectedVideos[tabId].pop();

            await chrome.storage.local.set({ detectedVideos });
        }
    } catch (error) {
        console.error('[FastStream] Storage error:', error);
    }
}

async function setIconState(tabId, state) {
    try {
        const path = ICONS[state] || ICONS.inactive;
        await chrome.action.setIcon({ tabId, path });
    } catch (e) {
        // Tab might be closed
    }
}

// ============================================================================
// CLEANUP & TAB MANAGEMENT
// ============================================================================

// Clear data when tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const data = await chrome.storage.local.get('detectedVideos');
    if (data.detectedVideos?.[tabId]) {
        delete data.detectedVideos[tabId];
        await chrome.storage.local.set({ detectedVideos: data.detectedVideos });
    }
});

// Reset icon when tab is updated (navigated)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        setIconState(tabId, 'inactive');
    }
});

