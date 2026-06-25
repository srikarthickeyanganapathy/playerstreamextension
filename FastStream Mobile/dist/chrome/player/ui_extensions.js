// FastStream Mobile - UI Extensions Logic
// Handles Settings, Subtitles, and Sources Browser securely without breaking existing code.

export function initUIExtensions() {
    // Inject Menus into DOM
    injectMenuDOM();

    // Bind Event Listeners
    bindMenuEvents();
}

function injectMenuDOM() {
    const container = document.getElementById('playerContainer');
    if (!container) return;

    const html = `
        <!-- Sources Browser Overlay -->
        <div class="sources-overlay" id="sourcesOverlay">
            <div class="sources-modal">
                <div class="sources-header">
                    <button class="sources-btn" id="addSourceBtn">Add Source</button>
                    <div class="sources-title" id="sourcesCountTitle">0 Sources Listed</div>
                    <button class="sources-btn danger" id="clearSourcesBtn">Clear Sources</button>
                </div>
                <div class="sources-list" id="sourcesList">
                    <!-- Source Items injected here -->
                </div>
            </div>
        </div>

        <!-- Settings Popover -->
        <div class="menu-popover" id="settingsPopover">
            <div class="menu-item">
                <div class="menu-item-left">
                    <div class="menu-item-icon">🎙️</div>
                    <span>Dub</span>
                </div>
                <div class="toggle-switch" id="dubToggle"></div>
            </div>
            <div class="menu-item">
                <div class="menu-item-left">
                    <div class="menu-item-icon">🎵</div>
                    <span>Audio</span>
                </div>
                <div class="menu-item-value">Original</div>
            </div>
            <div class="menu-item">
                <div class="menu-item-left">
                    <div class="menu-item-icon">⏱️</div>
                    <span>Playback speed</span>
                </div>
                <div class="menu-item-value">1x</div>
            </div>
            <div class="menu-item">
                <div class="menu-item-left">
                    <div class="menu-item-icon">📝</div>
                    <span>Subtitles/CC</span>
                </div>
                <div class="menu-item-value">English</div>
            </div>
            <div class="menu-item">
                <div class="menu-item-left">
                    <div class="menu-item-icon">📺</div>
                    <span>Quality</span>
                </div>
                <div class="menu-item-value">Auto(360p)</div>
            </div>
            <div class="menu-item">
                <div class="menu-item-left">
                    <div class="menu-item-icon">🖥️</div>
                    <span>Server</span>
                </div>
                <div class="menu-item-value">Default</div>
            </div>
            <div class="menu-item">
                <div class="menu-item-left">
                    <div class="menu-item-icon">⚙️</div>
                    <span>More</span>
                </div>
                <div class="menu-item-value">></div>
            </div>
        </div>

        <!-- Subtitles Popover -->
        <div class="menu-popover" id="subtitlesPopover">
            <div class="menu-item">
                <span>Upload File</span>
            </div>
            <div class="menu-item">
                <span>From URL</span>
            </div>
            <div class="menu-item">
                <span>Search OpenSubtitles</span>
            </div>
            <div class="menu-item">
                <span>Clear Subtitles</span>
            </div>
            <div class="menu-item">
                <span>Subtitle Settings</span>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', html);
}

function bindMenuEvents() {
    const settingsBtn = document.getElementById('settingsBtn');
    const ccBtn = document.getElementById('ccBtn');
    const sourcesBtn = document.getElementById('sourcesBtn');

    const settingsPopover = document.getElementById('settingsPopover');
    const subtitlesPopover = document.getElementById('subtitlesPopover');
    const sourcesOverlay = document.getElementById('sourcesOverlay');
    
    // Toggle Logic
    const closeAll = () => {
        settingsPopover?.classList.remove('visible');
        subtitlesPopover?.classList.remove('visible');
    };

    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = settingsPopover.classList.contains('visible');
            closeAll();
            if (!isVisible) settingsPopover.classList.add('visible');
        });
    }

    if (ccBtn) {
        ccBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = subtitlesPopover.classList.contains('visible');
            closeAll();
            if (!isVisible) subtitlesPopover.classList.add('visible');
        });
    }

    if (sourcesBtn) {
        sourcesBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAll();
            openSourcesBrowser();
        });
    }

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.menu-popover')) {
            closeAll();
        }
        if (sourcesOverlay && e.target === sourcesOverlay) {
            sourcesOverlay.classList.remove('visible');
        }
    });

    // Dub Toggle inside Settings
    const dubToggle = document.getElementById('dubToggle');
    if (dubToggle) {
        dubToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            dubToggle.classList.toggle('active');
        });
    }

    // Bind Close Sources explicitly if we add a close button, or just click outside (handled above).
}

function openSourcesBrowser() {
    const overlay = document.getElementById('sourcesOverlay');
    const list = document.getElementById('sourcesList');
    const title = document.getElementById('sourcesCountTitle');
    
    if (!overlay || !list) return;

    // Fetch from chrome.storage
    if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['detectedVideos'], (result) => {
            const videos = result.detectedVideos || [];
            
            title.textContent = `${videos.length} Source${videos.length === 1 ? '' : 's'} Listed`;
            
            if (videos.length === 0) {
                list.innerHTML = '<div style="color: #fff; text-align: center; padding: 20px;">No sources detected.</div>';
            } else {
                list.innerHTML = videos.map((v, i) => `
                    <div class="source-item">
                        <div class="source-url">${escapeHTML(v.url)}</div>
                        <div class="source-actions">
                            <select class="source-select">
                                <option>Mode: ${v.type === 'hls' ? 'Accelerated HLS' : (v.type === 'dash' ? 'Accelerated DASH' : 'Auto Detect')}</option>
                                <option>Mode: Accelerated MP4</option>
                            </select>
                            <button class="sources-btn">Header Override (0)</button>
                            <button class="sources-btn">Copy</button>
                            <button class="sources-btn primary">${i === 0 ? 'Playing' : 'Play'}</button>
                            <button class="sources-btn danger">Delete</button>
                        </div>
                    </div>
                `).join('');
            }
            
            overlay.classList.add('visible');
        });
    } else {
        // Fallback for non-extension environment
        title.textContent = '1 Source Listed';
        list.innerHTML = `
            <div class="source-item">
                <div class="source-url">https://example.com/stream/manifest.m3u8</div>
                <div class="source-actions">
                    <select class="source-select">
                        <option>Mode: Accelerated HLS</option>
                    </select>
                    <button class="sources-btn">Header Override (0)</button>
                    <button class="sources-btn">Copy</button>
                    <button class="sources-btn primary">Playing</button>
                    <button class="sources-btn danger">Delete</button>
                </div>
            </div>
        `;
        overlay.classList.add('visible');
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
