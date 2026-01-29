/**
 * FastStream Mobile - Background Service Worker (The Brain)
 * Detects video streams, captures headers, and manages extension state
 */

import { RuleManager } from './NetRequestRuleManager.mjs';

// ============================================================================
// CONSTANTS
// ============================================================================

const VIDEO_EXTENSIONS = ['.m3u8', '.mpd', '.mp4', '.webm', '.ts', '.m4s', '.webp', '.jpg', '.png', '.jpeg'];
const EXTENSION_ID = chrome.runtime.id;
const ruleManager = new RuleManager();

// Cache for captured headers: requestId -> headers
const headerCache = new Map();

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
// INITIALIZATION
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[FastStream] Extension installed:', details.reason);
    await ruleManager.clearAllRules();
    console.log('[FastStream] Rules cleared');
});

// ============================================================================
// VIDEO DETECTION & HEADER CAPTURE
// ============================================================================

function detectVideoUrl(url) {
    if (!url) return null;
    const urlLower = url.toLowerCase();

    // EXCLUSIONS: Skip obvious non-video assets
    if (urlLower.includes('thumbnail') ||
        urlLower.includes('poster') ||
        urlLower.includes('preview') ||
        urlLower.includes('cover') ||
        urlLower.includes('avatars') ||
        urlLower.includes('icons')) {
        return null;
    }

    // LIST 1: Unambiguous Video Extensions (Always capture)
    const CORE_EXTENSIONS = ['.m3u8', '.mpd', '.mp4', '.webm', '.m4s'];
    for (const ext of CORE_EXTENSIONS) {
        if (urlLower.includes(ext)) {
            let type = 'unknown';
            if (urlLower.includes('.m3u8')) type = 'hls';
            else if (urlLower.includes('.mpd')) type = 'dash';
            else if (urlLower.includes('.mp4')) type = 'mp4';
            else if (urlLower.includes('.webm')) type = 'webm';
            else if (urlLower.includes('.m4s')) type = 'segment';

            return { url, type, extension: ext, detectedAt: Date.now() };
        }
    }

    // LIST 2: Ambiguous Extensions (Segments masquerading as other files)
    // Only capture if they look like segments (contain 'seg', 'frag', or numeric sequences)
    const AMBIGUOUS_EXTENSIONS = ['.ts', '.webp', '.jpg', '.png', '.jpeg'];

    for (const ext of AMBIGUOUS_EXTENSIONS) {
        if (urlLower.includes(ext)) {
            // Check for segment-like patterns
            const filename = url.split('/').pop().toLowerCase();
            const isSegment =
                filename.includes('seg') ||
                filename.includes('frag') ||
                filename.includes('part') ||
                filename.includes('chunk') ||
                /-\d+/.test(filename) || // e.g., -001
                /^\d+/.test(filename);   // e.g., 001.ts

            if (isSegment) {
                return { url, type: 'segment', extension: ext, detectedAt: Date.now() };
            }
        }
    }

    return null;
}

function isOwnExtensionRequest(initiator) {
    if (!initiator) return false;
    return initiator.includes(EXTENSION_ID) ||
        initiator.startsWith('chrome-extension://') ||
        initiator.startsWith('moz-extension://');
}

/**
 * Capture headers from detected streams
 */
if (chrome.webRequest) {
    // 1. Listen for headers relative to video extensions
    // Note: We listen to a broad set to ensure we miss nothing, filtered inside
    chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            if (details.tabId < 0) return;
            if (isOwnExtensionRequest(details.initiator)) return;

            const videoInfo = detectVideoUrl(details.url);
            if (videoInfo) {
                // Store relevant headers
                const capturedHeaders = {};
                if (details.requestHeaders) {
                    for (const h of details.requestHeaders) {
                        const name = h.name.toLowerCase();
                        if (['referer', 'origin', 'user-agent', 'cookie', 'authorization'].includes(name)) {
                            capturedHeaders[h.name] = h.value; // Store with original casing
                        }
                    }
                }

                // Store in cache
                headerCache.set(details.url, capturedHeaders);

                // Also trigger detection right here as we have the headers now
                processDetectedVideo(details.tabId, videoInfo, capturedHeaders);
            }
        },
        { urls: ["<all_urls>"] },
        ["requestHeaders", "extraHeaders"]
    );
}

/**
 * Process a detected video: create rules and notify UI
 */
async function processDetectedVideo(tabId, videoInfo, headers) {
    console.log(`[FastStream] 🎬 Detected (${videoInfo.type}):`, videoInfo.url);

    // Create dynamic rule to inject these headers for this URL
    const ruleHeaders = [];

    if (headers) {
        // Prepare headers for declarativeNetRequest
        for (const [key, value] of Object.entries(headers)) {
            // Skip Cookie for now as it's often HttpOnly and sensitive, 
            // but for many streams Referer/Origin is the key content protection.
            // Authorization header is critical if present.
            if (key.toLowerCase() !== 'cookie') {
                ruleHeaders.push({
                    header: key,
                    operation: 'set',
                    value: value
                });
            }
        }
    }

    // Always ensure Origin matches if not present (spoof based on Referer if available)
    // Some servers check Origin for CORS

    if (ruleHeaders.length > 0) {
        try {
            await ruleManager.addHeaderRule(videoInfo.url, tabId, ruleHeaders);
            console.log('[FastStream] 🛡️ Spoofing rules added for:', videoInfo.url);
        } catch (e) {
            console.error('[FastStream] Failed to add rules:', e);
        }
    }

    // Store and notify
    await storeDetectedVideo(tabId, { ...videoInfo, headers });
}


// ============================================================================
// STORAGE & STATE
// ============================================================================

async function storeDetectedVideo(tabId, videoInfo) {
    try {
        const data = await chrome.storage.local.get(['detectedVideos', 'streamsDetected']);
        const detectedVideos = data.detectedVideos || {};
        const streamsDetected = (data.streamsDetected || 0) + 1;

        if (!detectedVideos[tabId]) detectedVideos[tabId] = [];

        // Avoid duplicates
        const existingIndex = detectedVideos[tabId].findIndex(v => v.url === videoInfo.url);
        if (existingIndex === -1) {
            detectedVideos[tabId].unshift(videoInfo);
            if (detectedVideos[tabId].length > 10) detectedVideos[tabId].pop();

            await chrome.storage.local.set({ detectedVideos, streamsDetected });
            await setIconState(tabId, 'active');

            // Notify Popup
            chrome.runtime.sendMessage({
                type: 'VIDEO_DETECTED',
                payload: { tabId, videoInfo }
            }).catch(() => { });
        }
    } catch (error) {
        console.error('[FastStream] Storage error:', error);
    }
}

async function setIconState(tabId, state) {
    try {
        const path = ICONS[state] || ICONS.inactive;
        await chrome.action.setIcon({ tabId, path });

        if (state === 'active') {
            await chrome.action.setBadgeText({ tabId, text: '●' });
            await chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });
        } else {
            await chrome.action.setBadgeText({ tabId, text: '' });
        }
    } catch (e) { /* Tab closed */ }
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'GET_DETECTED_VIDEOS':
            handleGetDetectedVideos(message.payload?.tabId, sendResponse);
            return true;

        case 'CLEAR_TAB_VIDEOS':
            handleClearTabVideos(message.payload?.tabId, sendResponse);
            return true;

        case 'GET_SETTINGS':
            chrome.storage.local.get(null, (s) => sendResponse({ success: true, data: s }));
            return true;
    }
});

async function handleGetDetectedVideos(tabId, sendResponse) {
    const data = await chrome.storage.local.get('detectedVideos');
    sendResponse({ success: true, data: data.detectedVideos?.[tabId] || [] });
}

async function handleClearTabVideos(tabId, sendResponse) {
    const data = await chrome.storage.local.get('detectedVideos');
    const detectedVideos = data.detectedVideos || {};
    delete detectedVideos[tabId];
    await chrome.storage.local.set({ detectedVideos });
    await setIconState(tabId, 'inactive');
    sendResponse({ success: true });
}

// ============================================================================
// CLEANUP
// ============================================================================

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' && changeInfo.url) {
        setIconState(tabId, 'inactive');
    }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    const data = await chrome.storage.local.get('detectedVideos');
    if (data.detectedVideos?.[tabId]) {
        delete data.detectedVideos[tabId];
        await chrome.storage.local.set({ detectedVideos: data.detectedVideos });
    }
});
