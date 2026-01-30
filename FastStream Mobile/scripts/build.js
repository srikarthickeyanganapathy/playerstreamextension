
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Configuration
const SHARED_FILES = [
    'background',
    'content',
    'popup',
    'icons'
];

async function build() {
    console.log('[Build] Starting...');

    // Clean dist
    if (fs.existsSync(DIST)) {
        fs.rmSync(DIST, { recursive: true, force: true });
    }
    fs.mkdirSync(DIST);

    // Build Targets
    await buildTarget('chrome');
    await buildTarget('firefox');

    console.log('[Build] Complete!');
}

async function buildTarget(browser) {
    console.log(`[Build] Building for ${browser}...`);
    const targetDir = path.join(DIST, browser);
    fs.mkdirSync(targetDir);

    // 1. Copy Shared Files
    for (const item of SHARED_FILES) {
        const src = path.join(ROOT, item);
        const dest = path.join(targetDir, item);
        if (fs.existsSync(src)) {
            fs.cpSync(src, dest, { recursive: true });
        } else {
            console.warn(`[Build] Warning: Source ${item} not found.`);
        }
    }

    // 2. Process Manifest
    const manifestPath = path.join(ROOT, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (browser === 'firefox') {
        // Firefox specific adjustments
        manifest.browser_specific_settings = {
            gecko: {
                id: "faststream-mobile@antigravity.dev",
                strict_min_version: "109.0"
            }
        };

        // Firefox often prefers (or requires depending on config) background.scripts (Event Page)
        // instead of service_worker for MV3 currently, or allows it as an alternative.
        // User explicitly requested 'background.scripts'.
        manifest.background = {
            scripts: ["background/engine.js"],
            type: "module"
        };
    }

    fs.writeFileSync(
        path.join(targetDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
    );
}

build().catch(err => console.error(err));
