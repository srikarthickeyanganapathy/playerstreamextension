# FastStream Mobile 🚀

A high-performance browser extension for optimizing video streaming on mobile browsers.

## 🎯 Target Browsers

- **Firefox for Android** (v113+)
- **Kiwi Browser** (Chromium-based)

## 📁 Project Structure

```
FastStream Mobile/
├── manifest.json          # Extension manifest (V3)
├── package.json           # Node.js project config
├── background/
│   └── background.js      # Service worker / background script
├── content/
│   └── content.js         # Content script (injected into pages)
├── player/
│   ├── player.js          # Custom video player module
│   └── player.css         # Player styles
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic
├── rules/
│   └── stream_rules.json  # Declarative net request rules
├── icons/
│   └── (icon files)       # Extension icons (16, 48, 128px)
└── scripts/
    └── build.js           # Build script for bundling
```

## 🛠 Tech Stack

- **JavaScript ES6 Modules** - Modern vanilla JS
- **Manifest V3** - Latest extension API
- **HTML5 / CSS3** - Lightweight UI
- **Node.js** - Build tooling

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Build for Chrome/Kiwi
npm run build:chrome

# Build for Firefox Android
npm run build:firefox

# Watch mode (development)
npm run watch
```

### Loading the Extension

#### Kiwi Browser (Android)
1. Open Kiwi Browser
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" (or use the menu)
5. Select the `dist/chrome` folder

#### Firefox for Android
1. Use Firefox Nightly or Beta
2. Go to `about:debugging`
3. Click "This Firefox"
4. Click "Load Temporary Add-on"
5. Select any file in `dist/firefox`

## ⚙️ Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Access current tab for stream detection |
| `storage` | Store user preferences |
| `scripting` | Inject content scripts dynamically |
| `declarativeNetRequest` | Modify streaming requests for optimization |

## 📝 License

MIT License
