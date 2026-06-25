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
    'application/x-mpegurl', // HLS
    'application/vnd.apple.mpegurl', // HLS (alternate)
    'application/mpegurl',
    'audio/mpegurl',
    'audio/x-mpegurl',
    'application/dash+xml', // DASH
    'video/mp2t' // TS segments
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

const requestHeadersMap = new Map();

/**
 * Clean up stored headers
 */
function cleanupHeaders(details) {
    requestHeadersMap.delete(details.requestId);
}

if (chrome.webRequest) {
    chrome.webRequest.onSendHeaders.addListener(
        (details) => {
            if (details.tabId < 0) return;
            if (isOwnExtensionRequest(details.initiator)) return;

            // Extract important request headers
            const relevantHeaders = {};
            for (const h of details.requestHeaders) {
                const lower = h.name.toLowerCase();
                if (['origin', 'referer', 'sec-gpc', 'user-agent', 'cookie', 'authorization'].includes(lower)) {
                    relevantHeaders[lower] = h.value;
                }
            }
            if (Object.keys(relevantHeaders).length > 0) {
                requestHeadersMap.set(details.requestId, relevantHeaders);
            }

            const url = details.url.toLowerCase();
            const urlWithoutQuery = url.split('?')[0];
            let type = null;

            if (urlWithoutQuery.endsWith('.m3u8') || urlWithoutQuery.endsWith('.m3u')) type = 'hls';
            else if (urlWithoutQuery.endsWith('.mpd')) type = 'dash';
            else if (urlWithoutQuery.endsWith('.mp4')) type = 'mp4';
            else if (urlWithoutQuery.endsWith('.webm')) type = 'webm';
            else if (urlWithoutQuery.endsWith('.ts')) type = 'ts-segment';
            else if (url.includes('faststream-mode=accelerated_hls') || url.includes('faststream-mode=hls')) type = 'hls';
            
            if (type) {
                console.log('[FastStream] Video detected via URL:', type, details.url);
                handleDetectedVideo(details.tabId, details.url, type, details.frameId, relevantHeaders);
            }
        },
        { urls: ["<all_urls>"] },
        ["requestHeaders", "extraHeaders"]
    );

    chrome.webRequest.onHeadersReceived.addListener(
        (details) => {
            if (details.tabId < 0) return;
            if (isOwnExtensionRequest(details.initiator)) return;

            const contentTypeHeader = details.responseHeaders.find(
                h => h.name.toLowerCase() === 'content-type'
            );

            if (contentTypeHeader) {
                const contentType = contentTypeHeader.value.toLowerCase().split(';')[0].trim();

                if (TARGET_MIME_TYPES.includes(contentType)) {
                    console.log('[FastStream] Video detected via MIME:', contentType, details.url);
                    const capturedHeaders = requestHeadersMap.get(details.requestId) || {};
                    handleDetectedVideo(details.tabId, details.url, contentType, details.frameId, capturedHeaders);
                }
            }
        },
        { urls: ["<all_urls>"] },
        ["responseHeaders"]
    );

    chrome.webRequest.onCompleted.addListener(cleanupHeaders, { urls: ["<all_urls>"] });
    chrome.webRequest.onErrorOccurred.addListener(cleanupHeaders, { urls: ["<all_urls>"] });
}

let nextRuleId = 1;

/**
 * Handle a detected video stream
 * @param {number} tabId 
 * @param {string} url 
 * @param {string} type 
 * @param {number} frameId
 * @param {object} capturedHeaders - Headers captured from the original request
 */
async function handleDetectedVideo(tabId, url, type, frameId, capturedHeaders = {}) {
    const videoInfo = {
        url,
        type,
        frameId,
        detectedAt: Date.now()
    };

    let streamUrlFilter = url;
    let customRequestHeaders = [];
    
    try {
        const urlObj = new URL(url);
        streamUrlFilter = '||' + urlObj.hostname + '/*';
        
        // Parse faststream-headers from URL if present
        const faststreamHeadersStr = urlObj.searchParams.get('faststream-headers');
        if (faststreamHeadersStr) {
            try {
                const parsedHeaders = JSON.parse(decodeURIComponent(faststreamHeadersStr));
                Object.assign(capturedHeaders, parsedHeaders);
            } catch (e) {
                console.warn('[FastStream] Failed to parse faststream-headers from URL', e);
            }
        }
        
        customRequestHeaders = Object.keys(capturedHeaders).map(key => ({
            "header": key.toLowerCase(),
            "operation": "set",
            "value": capturedHeaders[key]
        }));
    } catch (e) {
        console.warn('[FastStream] URL parse failed, using exact URL', e);
    }

    // 0. CORS / Header Stripping
    const ruleId = Math.floor(Math.random() * 1000000) + 1;
    
    const ruleAction = {
        "type": "modifyHeaders",
        "responseHeaders": [
            { "header": "x-frame-options", "operation": "remove" },
            { "header": "content-security-policy", "operation": "remove" },
            { "header": "access-control-allow-origin", "operation": "set", "value": "*" },
            { "header": "access-control-allow-methods", "operation": "set", "value": "GET, POST, OPTIONS" },
            { "header": "access-control-allow-headers", "operation": "set", "value": "*" }
        ]
    };
    
    if (customRequestHeaders.length > 0) {
        ruleAction.requestHeaders = customRequestHeaders;
    }

    try {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [ruleId],
            addRules: [{
                "id": ruleId,
                "priority": 1,
                "action": ruleAction,
                "condition": {
                    "tabIds": [tabId],
                    "resourceTypes": ["xmlhttprequest", "media", "sub_frame", "other"]
                }
            }]
        });
    } catch (e) {
        console.warn('[FastStream] Failed to update rules:', e);
    }

    // 1. Storage
    await storeDetectedVideo(tabId, videoInfo);

    // 2. Icon
    await setIconState(tabId, 'active');

    // 3. Notify Content Script
    try {
        await chrome.tabs.sendMessage(tabId, {
            action: 'VIDEO_DETECTED',
            url: url,
            type: type
        }, { frameId: frameId });
    } catch (e) {
        // Tab might not be ready or content script not injected yet
        console.warn('[FastStream] Failed to notify tab:', e);
    }

    // 4. Notify Popup
    try {
        await chrome.runtime.sendMessage({
            type: 'VIDEO_DETECTED',
            payload: { tabId: tabId, url: url, type: type }
        });
    } catch (e) {
        // Popup might not be open, safe to ignore
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

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_DETECTED_VIDEOS') {
        const tabId = message.payload.tabId;
        chrome.storage.local.get(['detectedVideos']).then(data => {
            const videos = (data.detectedVideos && data.detectedVideos[tabId]) ? data.detectedVideos[tabId] : [];
            sendResponse({ success: true, data: videos });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true; // Keep message channel open for async response
    }
    if (message.type === 'CLEAR_TAB_VIDEOS') {
        const tabId = message.payload.tabId;
        chrome.storage.local.get(['detectedVideos']).then(data => {
            if (data.detectedVideos && data.detectedVideos[tabId]) {
                delete data.detectedVideos[tabId];
                chrome.storage.local.set({ detectedVideos: data.detectedVideos }).then(() => {
                    sendResponse({ success: true });
                });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    }
});

