#!/usr/bin/env node

/**
 * FastStream Mobile - Build Script
 * Bundles and prepares extension for distribution
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// Parse arguments
const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('--target='))?.split('=')[1] || 'chrome';
const watch = args.includes('--watch');

console.log(`[Build] Target: ${target}`);
console.log(`[Build] Watch mode: ${watch}`);

/**
 * Files to include in the build
 */
const FILES_TO_COPY = [
    'manifest.json',
    'background/background.mjs',
    'background/NetRequestRuleManager.mjs',
    'content/content.js',
    'player/index.html',
    'player/main.mjs',
    'player/GestureManager.js',
    'player/player.js',
    'player/player.css',
    'player/lib',  // Bundled HLS.js and Dash.js for MV3 CSP compliance
    'popup/popup.html',
    'popup/popup.css',
    'popup/popup.js',
    'rules/stream_rules.json',
    'icons'
];

/**
 * Clean and create dist directory
 */
function cleanDist() {
    const targetDir = path.join(DIST_DIR, target);
    if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(`[Build] Cleaned dist/${target}`);
}

/**
 * Copy file or directory
 */
function copyRecursive(src, dest) {
    const srcPath = path.join(ROOT_DIR, src);
    const destPath = path.join(DIST_DIR, target, src);

    if (!fs.existsSync(srcPath)) {
        console.warn(`[Build] Warning: ${src} not found, skipping`);
        return;
    }

    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        fs.readdirSync(srcPath).forEach(file => {
            copyRecursive(path.join(src, file), path.join(dest, file));
        });
    } else {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
    }
}

/**
 * Modify manifest for specific browser
 */
function processManifest() {
    const manifestPath = path.join(DIST_DIR, target, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (target === 'chrome') {
        // Chrome doesn't need browser_specific_settings
        delete manifest.browser_specific_settings;
        console.log('[Build] Removed Firefox-specific settings for Chrome');
    } else if (target === 'firefox') {
        // Firefox uses background.scripts instead of service_worker
        if (manifest.background?.service_worker) {
            manifest.background = {
                scripts: [manifest.background.service_worker],
                type: 'module'
            };
            console.log('[Build] Converted service_worker to scripts for Firefox');
        }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[Build] Processed manifest for ${target}`);
}

/**
 * Main build function
 */
function build() {
    console.log('\n[Build] Starting build...\n');

    cleanDist();

    // Copy all files
    FILES_TO_COPY.forEach(file => {
        copyRecursive(file, file);
        console.log(`[Build] Copied ${file}`);
    });

    // Process manifest for target browser
    processManifest();

    console.log(`\n[Build] ✓ Build complete: dist/${target}\n`);
}

// Run build
build();

// Watch mode
if (watch) {
    console.log('[Build] Watching for changes...\n');

    const watchDirs = ['background', 'content', 'player', 'popup', 'rules'];

    watchDirs.forEach(dir => {
        const dirPath = path.join(ROOT_DIR, dir);
        if (fs.existsSync(dirPath)) {
            fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
                console.log(`[Watch] ${eventType}: ${dir}/${filename}`);
                build();
            });
        }
    });

    // Watch manifest
    fs.watch(path.join(ROOT_DIR, 'manifest.json'), () => {
        console.log('[Watch] manifest.json changed');
        build();
    });
}
