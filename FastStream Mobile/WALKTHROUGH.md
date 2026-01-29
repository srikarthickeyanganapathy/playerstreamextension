# FastStream Mobile - Walkthrough & Testing Guide

## 📱 Extension Overview

**FastStream Mobile** is a browser extension that optimizes video streaming on mobile browsers. It detects video streams on web pages and allows you to play them using a custom, mobile-optimized player with gesture controls.

![FastStream Icon](icons/icon-128.png)

---

## 🎯 Features Implemented

### ✅ Protected Streams Support (New!)
- **Dynamic Header Spoofing**: Implemented a "smart spy" system in the background service that captures valid headers (`Referer`, `Origin`) from the original page.
- **Disguised Segment Support**: Now detects and unlocks segments disguised as images (`.webp`, `.jpg`), commonly used by sites like Hianimes to evade detection.
- **Auto-Injection**: Automatically injects these captured credential headers when the player requests the stream, bypassing 403 Forbidden errors.
- **Copy URL Feature**: Added a "Copy URL" button to the player controls and error screen, allowing easy export to external players (VLC, mpv).

### 🎥 Native-Like Player Experience
- **Custom UI**: Built a beautiful, mobile-friendly video player interface.

### Core Features

| Feature | Description |
|---------|-------------|
| **Video Sniffer** | Automatically detects HLS, DASH, MP4, and WebMjs/Dash.js support |
| **Custom Player** | Mobile-optimized HTML5 player with HLS.js/Dash.js support |
| **Touch Gestures** | Double-tap seek, swipe volume/brightness controls |
| **Picture-in-Picture** | Watch videos in floating window mode |
| **Download** | Direct download for MP4/WebM, URL copy for streams |
| **Player Injection** | Overlay player on original video without breaking site |

### Gesture Controls

| Gesture | Action |
|---------|--------|
| **Single Tap** | Toggle play/pause + show/hide controls |
| **Double Tap Right** | Seek forward 10 seconds |
| **Double Tap Left** | Seek backward 10 seconds |
| **Swipe Up/Down (Right)** | Adjust volume |
| **Swipe Up/Down (Left)** | Adjust brightness |

---

## 📁 Project Structure

```
FastStream Mobile/
├── manifest.json           # Extension manifest (V3)
├── package.json            # Build dependencies
├── scripts/
│   └── build.js            # Build script for Chrome/Firefox
├── background/
│   └── background.mjs      # Service worker (video detection)
├── content/
│   └── content.js          # Content script (player injection)
├── player/
│   ├── index.html          # Custom player UI
│   ├── main.mjs            # Player engine (HLS.js/Dash.js)
│   ├── GestureManager.js   # Touch gesture handling
│   ├── player.js           # Legacy player script
│   └── player.css          # Player styles
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.js            # Popup logic
│   └── popup.css           # Popup styles
├── icons/
│   ├── icon-16.png         # 16x16 icon
│   ├── icon-48.png         # 48x48 icon
│   └── icon-128.png        # 128x128 icon
├── rules/
│   └── stream_rules.json   # Declarative net request rules
└── dist/
    ├── chrome/             # Chrome/Kiwi build output
    └── firefox/            # Firefox build output
```

---

## 🚀 Installation & Testing

### Build the Extension

```bash
# Install dependencies
npm install

# Build for Chrome/Kiwi Browser
npm run build:chrome

# Build for Firefox
npm run build:firefox
```

### Test on Kiwi Browser (Android)

1. **Transfer the extension** to your Android device:
   - Copy the `dist/chrome` folder to your phone
   - Or host the folder on a local web server

2. **Enable Developer Mode** in Kiwi:
   - Open Kiwi Browser
   - Go to `chrome://extensions`
   - Enable "Developer mode" toggle

3. **Load the extension**:
   - Tap "Load unpacked"
   - Navigate to the `dist/chrome` folder
   - Select it to install

4. **Test on a video site**:
   - Visit any site with HLS/DASH/MP4 videos
   - The extension icon will light up when videos are detected
   - Tap the icon to open popup and see detected streams
   - Tap ▶ to play in FastStream player

### Test on Firefox for Android

1. **Enable Debug Mode**:
   - In Firefox, go to `about:debugging`
   - Connect to your device via USB or network

2. **Load the extension**:
   - Click "Load Temporary Add-on"
   - Select the `manifest.json` from `dist/firefox`

3. **Grant permissions** when prompted

### Test on Desktop (Chrome/Edge)

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/chrome` folder

---

## 🎮 How to Use

### Detecting Videos

1. **Navigate** to any website with video content
2. **Play a video** - the extension monitors network requests
3. **Check the popup** - detected streams appear in the list

### Playing Videos

**Method 1: Popup Play Button**
1. Click the FastStream extension icon
2. View detected videos in the list
3. Click ▶ to inject player over original video

**Method 2: Direct URL**
Open the player directly with a URL:
```
chrome-extension://[extension-id]/player/index.html?url=https://example.com/video.m3u8
```

### Player Controls

| Button | Function |
|--------|----------|
| ▶/⏸ | Play/Pause |
| 🖼 | Picture-in-Picture mode |
| ⬇ | Download (direct) or copy URL (streams) |
| Quality Dropdown | Select quality level |
| ⛶ | Toggle fullscreen |

### Closing Injected Player

- Hover/tap the top-right corner to reveal ✕ button
- Click to close and restore original video

---

## 🧪 Test Scenarios

### HLS Stream Testing
```
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
```

### DASH Stream Testing
```
https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd
```

### MP4 Direct Testing
```
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4
```

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Extension not detecting videos | Refresh the page; some sites lazy-load manifests |
| Player shows "HLS.js not loaded" | Check internet connection for CDN scripts |
| Gestures not working | Ensure touch events are enabled in browser |
| PiP button missing | PiP not supported on this browser/device |
| Download not working | CORS may block direct downloads; use URL copy |
| **"Service worker registration failed"**: This usually means a file is missing from the build. We fixed an issue where `NetRequestRuleManager.mjs` was not being copied to the dist folder. Run `npm run build:chrome` again.
| **"No video detected"**: Ensure the video has started playing on the page. Some sites load the video only after user interaction.
| **403 Forbidden Errors**: If a stream still fails, try the new "Copy URL" button and play it in VLC, or refresh the original page and try again (tokens expire quickly).
| **Icon not appearing**: The icon only activates when a video stream (.m3u8, .mpd) is detected.

---

## 📊 Browser Compatibility

| Browser### 3. Protected Streams Support (Bypassing 403s)
- **Challenge**: Sites use "hotlink protection" (checking Referer/Origin) and obfuscation (naming video segments as `.webp` images).
- **Solution**: 
    - **Smart Sniffer**: Detecting video patterns even in files named as images.
    - **Header Cloning**: Capturing the exact headers showing "safe" usage.
    - **Wildcard Rules**: Applying these safe headers to the entire stream directory (`/_v7/*`), ensuring every part loads correctly.

### 4. Manifest V3 Compliance
tus |
|---------|----------|--------|
| Kiwi Browser (Android) | V3 | ✅ Fully Supported |
| Firefox for Android | V3 | ✅ Fully Supported |
| Chrome Desktop | V3 | ✅ Fully Supported |
| Edge Desktop | V3 | ✅ Fully Supported |
| Safari | - | ❌ Not Supported (different API) |

---

## 📝 Notes

- **HLS.js and Dash.js** are loaded from CDNs for smaller extension size
- **Gesture Manager** uses touch events optimized for mobile
- **Player injection** preserves original site scripts by hiding (not removing) video
- **Background service worker** monitors all network requests with video patterns

---

## 🔮 Future Enhancements

- [ ] Playback speed control
- [ ] Subtitle/CC support
- [ ] Video quality presets per site
- [ ] Bandwidth estimation display
- [ ] Offline video caching
- [ ] Background audio playback

---

*FastStream Mobile v1.0.0 - Built for mobile-first video streaming*
