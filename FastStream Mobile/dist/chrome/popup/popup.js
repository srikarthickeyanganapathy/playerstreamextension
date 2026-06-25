/**
 * FastStream Mobile - Popup Script
 * Handles popup UI interactions, settings, and detected video display
 */

// DOM Elements
const masterToggle = document.getElementById('masterToggle');
const qualitySelect = document.getElementById('qualitySelect');
const bufferSelect = document.getElementById('bufferSelect');
const dataUsageEl = document.getElementById('dataUsage');
const streamsDetectedEl = document.getElementById('streamsDetected');
const videoListEl = document.getElementById('videoList');
const noVideosEl = document.getElementById('noVideos');
const clearVideosBtn = document.getElementById('clearVideos');

let currentTabId = null;

/**
 * Initialize popup
 */
async function init() {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;

    await loadSettings();
    await loadDetectedVideos();

    // Listen for new video detections
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'VIDEO_DETECTED' && message.payload.tabId === currentTabId) {
            loadDetectedVideos();
        }
    });
}

/**
 * Load saved settings from storage
 */
async function loadSettings() {
    try {
        const settings = await chrome.storage.local.get([
            'enabled',
            'streamQuality',
            'bufferSize',
            'dataUsage',
            'streamsDetected'
        ]);

        // Apply to UI
        masterToggle.checked = settings.enabled !== false;
        qualitySelect.value = settings.streamQuality || 'auto';
        bufferSelect.value = settings.bufferSize || 'medium';

        // Update stats
        updateStats(settings);
    } catch (error) {
        console.error('[FastStream] Failed to load settings:', error);
    }
}

/**
 * Load detected videos for current tab
 */
async function loadDetectedVideos() {
    if (!currentTabId) return;

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'GET_DETECTED_VIDEOS',
            payload: { tabId: currentTabId }
        });

        if (response.success && response.data.length > 0) {
            displayVideos(response.data);
        } else {
            showNoVideos();
        }
    } catch (error) {
        console.error('[FastStream] Failed to load videos:', error);
        showNoVideos();
    }
}

/**
 * Display detected videos in the list
 * @param {Array} videos - Array of video info objects
 */
function displayVideos(videos) {
    noVideosEl.style.display = 'none';

    // Clear existing video items (but keep noVideos element)
    const existingItems = videoListEl.querySelectorAll('.video-item');
    existingItems.forEach(item => item.remove());

    videos.forEach((video, index) => {
        const videoItem = createVideoItem(video, index);
        videoListEl.appendChild(videoItem);
    });
}

/**
 * Create a video item element
 * @param {Object} video - Video info
 * @param {number} index - Index in list
 * @returns {HTMLElement}
 */
function createVideoItem(video, index) {
    const item = document.createElement('div');
    item.className = 'video-item';

    // Format URL for display
    const displayUrl = formatUrl(video.url);

    // Get type badge color
    const typeColors = {
        'hls': '#e91e63',
        'dash': '#9c27b0',
        'mp4': '#2196f3',
        'webm': '#ff9800',
        'ts-segment': '#607d8b'
    };

    // Normalize type for display
    let displayType = video.type.toLowerCase();
    if (displayType.includes('mpegurl') || displayType.includes('hls')) {
        displayType = 'hls';
    } else if (displayType.includes('dash')) {
        displayType = 'dash';
    } else if (displayType.includes('mp2t') || displayType.includes('ts-segment')) {
        displayType = 'ts-segment';
    }

    const badgeColor = typeColors[displayType] || '#666';

    item.innerHTML = `
    <div class="video-info">
      <span class="video-type" style="background: ${badgeColor}">${displayType.toUpperCase()}</span>
      <span class="video-url" title="${video.url}">${displayUrl}</span>
    </div>
    <div class="video-actions">
      <button class="play-btn" data-url="${video.url}" data-type="${video.type}" data-frame="${video.frameId}" title="Play in FastStream">▶</button>
      <button class="copy-btn" data-url="${video.url}" title="Copy URL">📋</button>
    </div>
  `;

    // Add play functionality
    item.querySelector('.play-btn').addEventListener('click', async (e) => {
        const url = e.target.dataset.url;
        const type = e.target.dataset.type;
        const frameId = e.target.dataset.frame;
        await openInPlayer(url, type, frameId);
    });

    // Add copy functionality
    item.querySelector('.copy-btn').addEventListener('click', (e) => {
        const url = e.target.dataset.url;
        navigator.clipboard.writeText(url).then(() => {
            e.target.textContent = '✓';
            setTimeout(() => {
                e.target.textContent = '📋';
            }, 1500);
        });
    });

    return item;
}

/**
 * Open video URL in FastStream player
 * @param {string} url - Video URL to play
 * @param {string} type - Stream type
 * @param {string|number} frameId - Target frame ID
 */
async function openInPlayer(url, type, frameId) {
    if (!currentTabId) return;

    try {
        // Try to inject player into the page
        const messageOpts = frameId && frameId !== 'undefined' ? { frameId: parseInt(frameId) } : {};
        await chrome.tabs.sendMessage(currentTabId, {
            type: 'OPEN_PLAYER',
            payload: { url, type }
        }, messageOpts);

        // Close popup after launching player
        window.close();
    } catch (error) {
        console.log('[FastStream] Could not inject player, opening in new tab');
        // Fallback: open in new tab
        const playerUrl = chrome.runtime.getURL('player/index.html');
        const encodedUrl = encodeURIComponent(url);
        const encodedType = encodeURIComponent(type || '');
        chrome.tabs.create({ url: `${playerUrl}?url=${encodedUrl}${type ? `&type=${encodedType}` : ''}` });
        window.close();
    }
}

/**
 * Format URL for display (truncate middle)
 * @param {string} url - Full URL
 * @returns {string} - Formatted URL
 */
function formatUrl(url) {
    try {
        const urlObj = new URL(url);
        const path = urlObj.pathname;
        const filename = path.split('/').pop() || path;

        if (filename.length > 35) {
            return filename.substring(0, 15) + '...' + filename.substring(filename.length - 15);
        }
        return filename;
    } catch {
        if (url.length > 40) {
            return url.substring(0, 20) + '...' + url.substring(url.length - 15);
        }
        return url;
    }
}

/**
 * Show "no videos" message
 */
function showNoVideos() {
    noVideosEl.style.display = 'flex';

    // Remove any video items
    const existingItems = videoListEl.querySelectorAll('.video-item');
    existingItems.forEach(item => item.remove());
}

/**
 * Save a setting to storage
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 */
async function saveSetting(key, value) {
    try {
        await chrome.storage.local.set({ [key]: value });
        console.log(`[FastStream] Saved ${key}:`, value);
    } catch (error) {
        console.error('[FastStream] Failed to save setting:', error);
    }
}

/**
 * Update statistics display
 * @param {Object} settings - Settings object with stats
 */
function updateStats(settings) {
    const dataUsage = settings.dataUsage || 0;
    const streams = settings.streamsDetected || 0;

    // Format data usage
    if (dataUsage >= 1024) {
        dataUsageEl.textContent = `${(dataUsage / 1024).toFixed(1)} GB`;
    } else {
        dataUsageEl.textContent = `${dataUsage.toFixed(1)} MB`;
    }

    streamsDetectedEl.textContent = streams.toString();
}

/**
 * Toggle extension enabled state
 */
function handleMasterToggle() {
    const enabled = masterToggle.checked;
    saveSetting('enabled', enabled);

    // Notify background script
    chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: { enabled }
    });
}

/**
 * Handle quality selection change
 */
function handleQualityChange() {
    const quality = qualitySelect.value;
    saveSetting('streamQuality', quality);
}

/**
 * Handle buffer size change
 */
function handleBufferChange() {
    const buffer = bufferSelect.value;
    saveSetting('bufferSize', buffer);
}

/**
 * Clear detected videos for current tab
 */
async function handleClearVideos() {
    if (!currentTabId) return;

    try {
        await chrome.runtime.sendMessage({
            type: 'CLEAR_TAB_VIDEOS',
            payload: { tabId: currentTabId }
        });

        showNoVideos();
    } catch (error) {
        console.error('[FastStream] Failed to clear videos:', error);
    }
}

// Event Listeners
masterToggle.addEventListener('change', handleMasterToggle);
qualitySelect.addEventListener('change', handleQualityChange);
bufferSelect.addEventListener('change', handleBufferChange);
clearVideosBtn.addEventListener('click', handleClearVideos);

// Listen for storage changes to update UI
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.dataUsage || changes.streamsDetected) {
            updateStats({
                dataUsage: changes.dataUsage?.newValue || 0,
                streamsDetected: changes.streamsDetected?.newValue || 0
            });
        }
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', init);
