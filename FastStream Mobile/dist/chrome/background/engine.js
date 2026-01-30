/**
 * FastStream Mobile - Background Engine
 * Orchestrates Stream Detection, Processing, Playback, and Lifecycle.
 */

import { BufferManager } from './buffer-manager.js';
import { SegmentDownloader } from './downloader.js';

// State maps
// sessions: streamId -> { tabId, bufferManager, downloader, streamInfo, active }
// tabMap: tabId -> streamId (One stream per tab Rule)
const sessions = new Map();
const tabMap = new Map();
const requestHeadersMap = new Map();

// ============================================================================
// HEADER CAPTURE (Fix for 403 Forbidden)
// ============================================================================
const headerCallback = (details) => {
    if (details.type === 'xmlhttprequest' && (details.url.includes('.m3u8') || details.url.includes('.mpd'))) {
        const headers = {};
        if (details.requestHeaders) {
            details.requestHeaders.forEach(h => {
                // Filter out internal headers if needed, but for spoofing we usually want them
                if (!['Host', 'Content-Length'].includes(h.name)) {
                    headers[h.name] = h.value;
                }
            });
        }
        // Store by URL
        requestHeadersMap.set(details.url, headers);

        // Cleanup old entries periodically? For prototype, map size is negligible.
        console.log('[Engine] Captured headers for:', details.url);
    }
};

try {
    // Chrome requires 'extraHeaders' to access/modify protected headers
    chrome.webRequest.onBeforeSendHeaders.addListener(
        headerCallback,
        { urls: ["<all_urls>"] },
        ["requestHeaders", "extraHeaders"]
    );
} catch (e) {
    // Firefox doesn't support (or need) 'extraHeaders' and throws an error
    console.log('[Engine] Falling back to standard listener (Firefox detected)');
    chrome.webRequest.onBeforeSendHeaders.addListener(
        headerCallback,
        { urls: ["<all_urls>"] },
        ["requestHeaders"]
    );
}

// ============================================================================
// LIFECYCLE MANAGEMENT
// ============================================================================

/**
 * Persist critical session state to storage to survive SW restarts
 */
async function saveSessionState(streamId) {
    const session = sessions.get(streamId);
    if (!session) return;

    const state = {
        streamId,
        tabId: session.tabId,
        streamInfo: session.streamInfo,
        active: session.active,
        timestamp: Date.now()
    };
    await chrome.storage.session.set({ [`session_${streamId}`]: state });
    // Also save tab mapping
    await chrome.storage.session.set({ [`tab_${session.tabId}`]: streamId });
}

/**
 * Restore session state on SW startup or after a crash
 */
async function restoreSession(streamId) {
    if (sessions.has(streamId)) return sessions.get(streamId);

    const key = `session_${streamId}`;
    const result = await chrome.storage.session.get(key);
    const state = result[key];

    if (state) {
        console.log('[Engine] Restoring session:', streamId);
        // Re-initialize non-serializable objects
        const bufferManager = new BufferManager(state.tabId);
        const downloader = new SegmentDownloader(bufferManager, state.tabId);

        const session = {
            streamId,
            tabId: state.tabId,
            bufferManager,
            downloader,
            streamInfo: state.streamInfo,
            active: state.active
        };
        sessions.set(streamId, session);
        tabMap.set(state.tabId, streamId);
        return session;
    }
    return null;
}

// ============================================================================
// MESSAGING & CONTROL PLANE
// ============================================================================

// 1. Listen for Stream Detection & Logic
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Keep-alive for message port
    // ...

    if (message.action === 'STREAM_FOUND' || message.action === 'MSE_INIT') {
        const tabId = sender.tab.id;
        handleStreamDetection(tabId, message.payload);
    }
    else if (message.action === 'GET_STREAMS') {
        // Popup asking for streams on current tab
        const tabId = message.tabId;
        const streamId = tabMap.get(tabId);
        if (streamId) {
            // Ensure session is loaded
            const session = sessions.get(streamId);
            if (session) {
                sendResponse({ streams: [{ ...session.streamInfo, id: streamId }] });
            } else {
                // Stale tab map? Try to restore
                restoreSession(streamId).then(restoredSession => {
                    if (restoredSession) {
                        sendResponse({ streams: [{ ...restoredSession.streamInfo, id: streamId }] });
                    } else {
                        sendResponse({ streams: [] });
                    }
                });
                return true; // Keep channel open for async response
            }
        } else {
            sendResponse({ streams: [] });
        }
    }
    return true; // Keep channel open for async response
});

async function handleStreamDetection(tabId, payload) {
    // Rule 1: Dedupe - One session per tab
    if (tabMap.has(tabId)) {
        console.log(`[Engine] Ignoring duplicate stream for tab ${tabId}`);
        return;
    }

    const streamId = crypto.randomUUID();
    console.log('[Engine] New Stream Created:', streamId, payload);

    const bufferManager = new BufferManager(tabId);
    const downloader = new SegmentDownloader(bufferManager, tabId); // Pass tabId for proxy fetch

    // Attach captured headers if available
    const capturedHeaders = requestHeadersMap.get(payload.url) || {};
    // Merge? Payload might have some, but captured are better for auth.
    // If payload has headers, keep them?
    const startHeaders = { ...capturedHeaders };

    const session = {
        streamId,
        tabId,
        bufferManager,
        downloader,
        streamInfo: { ...payload, headers: startHeaders },
        active: true
    };

    sessions.set(streamId, session);
    tabMap.set(tabId, streamId);
    await saveSessionState(streamId);

    // Show Page Action
    chrome.action.setIcon({ tabId, path: "icons/icon48.png" });
    chrome.action.setBadgeText({ tabId, text: "ON" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#4CAF50" });
}

// 2. Comm Bridge for Player (MSE) - The Main Control Plane
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'faststream-player') {
        let currentStreamId = null;

        port.onMessage.addListener(async (msg) => {
            // Handshake
            if (msg.action === 'CONNECT') {
                currentStreamId = msg.streamId;
                console.log('[Engine] Player Connected to stream:', currentStreamId);

                // Restore if needed
                const session = await restoreSession(currentStreamId);
                if (!session) {
                    port.postMessage({ action: 'ERROR', message: 'Session not found' });
                } else {
                    console.log('[Engine] Session found. Starting Downloader...');
                    // START THE DOWNLOADER
                    session.downloader.start(session.streamInfo);

                    port.postMessage({
                        action: 'CONNECTED',
                        startId: session.downloader.mediaSequence || 0
                    });
                }
                return;
            }

            // Guard
            if (!currentStreamId) return;
            const session = sessions.get(currentStreamId);
            if (!session) return;

            switch (msg.action) {
                case 'GET_SEGMENT':
                    // Player asking for data
                    const data = await session.bufferManager.getSegment(session.streamId, msg.segmentId);
                    if (data) {
                        port.postMessage({
                            action: 'SEGMENT_DATA',
                            segmentId: msg.segmentId,
                            data: Array.from(new Uint8Array(data))
                        });
                    } else {
                        // Cache miss - trigger download logic?
                        // For now check if we should be downloading
                    }
                    break;

                case 'SEEK':
                    console.log('[Engine] SEEK signal received:', msg.time);
                    // 1. Pause Downloader
                    session.downloader.reset();
                    // 2. Clear future buffer (optional, depending on seek distance)
                    // 3. Determine new segment index based on time
                    // 4. Start downloading from new index
                    // ... Implementation placeholder ...

                    // Ack
                    port.postMessage({ action: 'SEEK_ACK', time: msg.time });
                    break;

                case 'PAUSE':
                    console.log('[Engine] PAUSE signal');
                    session.downloader.pause();
                    session.active = false;
                    saveSessionState(currentStreamId);
                    break;

                case 'RESUME':
                    console.log('[Engine] RESUME signal');
                    session.downloader.resume();
                    session.active = true;
                    saveSessionState(currentStreamId);
                    break;

                case 'HEARTBEAT':
                    // Just keep the port alive
                    break;
            }
        });

        // Handle disconnect
        port.onDisconnect.addListener(() => {
            console.log('[Engine] Player disconnected');
            // Don't kill session immediately, user might just be refreshing or navigating
        });
    }
});

// 3. Cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabMap.has(tabId)) {
        const streamId = tabMap.get(tabId);
        if (sessions.has(streamId)) {
            console.log('[Engine] Cleaning up stream:', streamId);
            const s = sessions.get(streamId);
            s.bufferManager.clearAll();
            sessions.delete(streamId);
            chrome.storage.session.remove(`session_${streamId}`);
        }
        tabMap.delete(tabId);
        chrome.storage.session.remove(`tab_${tabId}`);
    }
});
