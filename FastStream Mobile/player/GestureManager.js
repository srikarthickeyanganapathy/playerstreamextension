/**
 * FastStream Mobile - Gesture Manager
 * Touch gesture controls optimized for mobile video playback
 * 
 * Gestures:
 * - Double tap right: Seek forward 10s
 * - Double tap left: Seek backward 10s
 * - Single tap: Toggle play/pause & show/hide UI
 * - Swipe up/down left half: Adjust brightness
 * - Swipe up/down right half: Adjust volume
 */

/**
 * Throttle utility - limits function execution to once per interval
 * @param {Function} fn - Function to throttle
 * @param {number} delay - Minimum time between executions (ms)
 * @returns {Function} - Throttled function
 */
function throttle(fn, delay) {
    let lastCall = 0;
    let timeoutId = null;

    return function throttled(...args) {
        const now = Date.now();
        const timeSinceLastCall = now - lastCall;

        if (timeSinceLastCall >= delay) {
            lastCall = now;
            fn.apply(this, args);
        } else {
            // Schedule trailing call
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                lastCall = Date.now();
                fn.apply(this, args);
            }, delay - timeSinceLastCall);
        }
    };
}

export class GestureManager {
    /**
     * Create a new GestureManager
     * @param {HTMLElement} container - The gesture capture container
     * @param {Object} callbacks - Gesture callbacks
     */
    constructor(container, callbacks = {}) {
        this.container = container;

        // Configuration
        this.config = {
            seekSeconds: 10,
            doubleTapWindow: 300,     // ms to detect double tap
            swipeThreshold: 30,       // min pixels for swipe detection
            swipeSensitivity: 200,    // pixels for full 0-1 range
            debounceInterval: 16,     // ~60fps throttle for swipe events
        };

        // Store original callbacks
        this._rawCallbacks = {
            onSeekForward: null,      // (seconds) => void
            onSeekBackward: null,     // (seconds) => void
            onTogglePlayPause: null,  // () => void
            onToggleUI: null,         // () => void
            onVolumeChange: null,     // (delta: -1 to 1) => void
            onBrightnessChange: null, // (delta: -1 to 1) => void
            onGestureStart: null,     // (type: string) => void
            onGestureEnd: null,       // () => void
            ...callbacks
        };

        // Create throttled versions of swipe callbacks for performance
        this.callbacks = {
            ...this._rawCallbacks,
            onVolumeChange: this._rawCallbacks.onVolumeChange
                ? throttle(this._rawCallbacks.onVolumeChange, this.config.debounceInterval)
                : null,
            onBrightnessChange: this._rawCallbacks.onBrightnessChange
                ? throttle(this._rawCallbacks.onBrightnessChange, this.config.debounceInterval)
                : null,
        };

        // State
        this.state = {
            isTracking: false,
            startX: 0,
            startY: 0,
            startTime: 0,
            lastTapTime: 0,
            lastTapX: 0,
            tapTimeout: null,
            currentGesture: null,     // 'volume', 'brightness', null
            initialValue: 0,
            accumulatedDelta: 0,
            lastDelta: 0,             // Track last delta for debounce comparison
        };

        // Overlays for visual feedback
        this._createOverlays();
        this._bindEvents();
    }

    /**
     * Create visual feedback overlays
     */
    _createOverlays() {
        // Brightness overlay (darkens screen)
        this.brightnessOverlay = document.createElement('div');
        this.brightnessOverlay.className = 'gesture-brightness-overlay';
        this.brightnessOverlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: #000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.1s;
      z-index: 5;
    `;
        this.container.appendChild(this.brightnessOverlay);

        // Seek indicator (left)
        this.seekLeftIndicator = this._createSeekIndicator('left');
        this.container.appendChild(this.seekLeftIndicator);

        // Seek indicator (right)
        this.seekRightIndicator = this._createSeekIndicator('right');
        this.container.appendChild(this.seekRightIndicator);

        // Volume/Brightness indicator
        this.adjustIndicator = document.createElement('div');
        this.adjustIndicator.className = 'gesture-adjust-indicator';
        this.adjustIndicator.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 16px 24px;
      background: rgba(0, 0, 0, 0.8);
      border-radius: 12px;
      z-index: 100;
    `;
        this.adjustIndicator.innerHTML = `
      <span class="adjust-icon" style="font-size: 28px;">🔊</span>
      <div class="adjust-bar-container" style="
        width: 6px;
        height: 80px;
        background: rgba(255,255,255,0.3);
        border-radius: 3px;
        overflow: hidden;
        position: relative;
      ">
        <div class="adjust-bar-fill" style="
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 50%;
          background: #4CAF50;
          border-radius: 3px;
          transition: height 0.1s;
        "></div>
      </div>
      <span class="adjust-value" style="font-size: 14px; color: #fff;">50%</span>
    `;
        this.container.appendChild(this.adjustIndicator);
    }

    /**
     * Create a seek indicator element
     * @param {'left'|'right'} side
     */
    _createSeekIndicator(side) {
        const indicator = document.createElement('div');
        indicator.className = `gesture-seek-indicator seek-${side}`;
        indicator.style.cssText = `
      position: absolute;
      top: 50%;
      ${side}: 15%;
      transform: translateY(-50%);
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 16px;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 50%;
      z-index: 100;
    `;

        const arrow = side === 'right' ? '▶▶' : '◀◀';
        const text = side === 'right' ? '+10s' : '-10s';

        indicator.innerHTML = `
      <span style="font-size: 24px; color: #fff;">${arrow}</span>
      <span style="font-size: 12px; color: #fff; font-weight: 600;">${text}</span>
    `;

        return indicator;
    }

    /**
     * Bind touch events
     */
    _bindEvents() {
        // Use passive: false for touchmove to allow preventDefault
        this.container.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: true });
        this.container.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        this.container.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: true });
        this.container.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: true });
    }

    /**
     * Handle touch start
     * @param {TouchEvent} e
     */
    _onTouchStart(e) {
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];

        this.state.isTracking = true;
        this.state.startX = touch.clientX;
        this.state.startY = touch.clientY;
        this.state.startTime = Date.now();
        this.state.currentGesture = null;
        this.state.accumulatedDelta = 0;
    }

    /**
     * Handle touch move
     * @param {TouchEvent} e
     */
    _onTouchMove(e) {
        if (!this.state.isTracking || e.touches.length !== 1) return;

        const touch = e.touches[0];
        const deltaX = touch.clientX - this.state.startX;
        const deltaY = touch.clientY - this.state.startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // Determine gesture type if not already set
        if (!this.state.currentGesture && absY > this.config.swipeThreshold) {
            const containerWidth = this.container.clientWidth;
            const isLeftHalf = this.state.startX < containerWidth / 2;

            this.state.currentGesture = isLeftHalf ? 'brightness' : 'volume';

            if (this.callbacks.onGestureStart) {
                this.callbacks.onGestureStart(this.state.currentGesture);
            }

            // Prevent scrolling
            e.preventDefault();
        }

        // Handle vertical swipe gestures
        if (this.state.currentGesture) {
            e.preventDefault();

            // Calculate delta (-1 to 1, inverted because swipe up = increase)
            const delta = -deltaY / this.config.swipeSensitivity;
            const clampedDelta = Math.max(-1, Math.min(1, delta));

            if (this.state.currentGesture === 'volume') {
                this._showAdjustIndicator('volume', clampedDelta);
                if (this.callbacks.onVolumeChange) {
                    this.callbacks.onVolumeChange(clampedDelta);
                }
            } else if (this.state.currentGesture === 'brightness') {
                this._showAdjustIndicator('brightness', clampedDelta);
                if (this.callbacks.onBrightnessChange) {
                    this.callbacks.onBrightnessChange(clampedDelta);
                }
            }
        }
    }

    /**
     * Handle touch end
     * @param {TouchEvent} e
     */
    _onTouchEnd(e) {
        if (!this.state.isTracking) return;

        const touchDuration = Date.now() - this.state.startTime;

        // Hide adjust indicator
        this.adjustIndicator.style.display = 'none';

        if (this.callbacks.onGestureEnd) {
            this.callbacks.onGestureEnd();
        }

        // If it was a swipe gesture, don't process as tap
        if (this.state.currentGesture) {
            this.state.isTracking = false;
            this.state.currentGesture = null;
            return;
        }

        // Check for tap (short duration, minimal movement)
        if (touchDuration < 300) {
            const now = Date.now();
            const timeSinceLastTap = now - this.state.lastTapTime;
            const containerWidth = this.container.clientWidth;
            const tapX = this.state.startX;

            // Check for double tap
            if (timeSinceLastTap < this.config.doubleTapWindow) {
                // Clear single tap timeout
                if (this.state.tapTimeout) {
                    clearTimeout(this.state.tapTimeout);
                    this.state.tapTimeout = null;
                }

                // Determine which side was double-tapped
                if (tapX > containerWidth * 0.6) {
                    // Right side - seek forward
                    this._showSeekIndicator('right');
                    if (this.callbacks.onSeekForward) {
                        this.callbacks.onSeekForward(this.config.seekSeconds);
                    }
                } else if (tapX < containerWidth * 0.4) {
                    // Left side - seek backward
                    this._showSeekIndicator('left');
                    if (this.callbacks.onSeekBackward) {
                        this.callbacks.onSeekBackward(this.config.seekSeconds);
                    }
                }

                this.state.lastTapTime = 0;
            } else {
                // First tap - wait for potential second tap
                this.state.lastTapTime = now;
                this.state.lastTapX = tapX;

                // Set timeout for single tap action
                this.state.tapTimeout = setTimeout(() => {
                    // Single tap - toggle play/pause and UI
                    if (this.callbacks.onTogglePlayPause) {
                        this.callbacks.onTogglePlayPause();
                    }
                    if (this.callbacks.onToggleUI) {
                        this.callbacks.onToggleUI();
                    }
                    this.state.tapTimeout = null;
                }, this.config.doubleTapWindow);
            }
        }

        this.state.isTracking = false;
        this.state.currentGesture = null;
    }

    /**
     * Show seek indicator with animation
     * @param {'left'|'right'} side
     */
    _showSeekIndicator(side) {
        const indicator = side === 'left' ? this.seekLeftIndicator : this.seekRightIndicator;

        indicator.style.display = 'flex';
        indicator.style.animation = 'none';
        indicator.offsetHeight; // Trigger reflow
        indicator.style.animation = 'seekPulse 0.5s ease-out';

        setTimeout(() => {
            indicator.style.display = 'none';
        }, 500);
    }

    /**
     * Show volume/brightness adjust indicator
     * @param {'volume'|'brightness'} type
     * @param {number} delta - Value from -1 to 1
     */
    _showAdjustIndicator(type, delta) {
        this.adjustIndicator.style.display = 'flex';

        const icon = this.adjustIndicator.querySelector('.adjust-icon');
        const fill = this.adjustIndicator.querySelector('.adjust-bar-fill');
        const value = this.adjustIndicator.querySelector('.adjust-value');

        // Calculate percentage (0-100)
        const percentage = Math.round((delta + 1) / 2 * 100);

        if (type === 'volume') {
            icon.textContent = percentage > 50 ? '🔊' : percentage > 0 ? '🔉' : '🔇';
        } else {
            icon.textContent = percentage > 50 ? '☀️' : '🌙';
        }

        fill.style.height = `${percentage}%`;
        value.textContent = `${percentage}%`;
    }

    /**
     * Set brightness level (0-1, where 1 is full brightness/no overlay)
     * @param {number} level
     */
    setBrightness(level) {
        // Invert: 0 = darkest (opacity 0.8), 1 = brightest (opacity 0)
        const opacity = Math.max(0, Math.min(0.8, (1 - level) * 0.8));
        this.brightnessOverlay.style.opacity = opacity.toString();
    }

    /**
     * Update configuration
     * @param {Object} config
     */
    configure(config) {
        this.config = { ...this.config, ...config };
    }

    /**
     * Destroy and cleanup
     */
    destroy() {
        this.brightnessOverlay.remove();
        this.seekLeftIndicator.remove();
        this.seekRightIndicator.remove();
        this.adjustIndicator.remove();

        if (this.state.tapTimeout) {
            clearTimeout(this.state.tapTimeout);
        }
    }
}

// Add CSS animation for seek indicator
const style = document.createElement('style');
style.textContent = `
  @keyframes seekPulse {
    0% {
      transform: translateY(-50%) scale(0.8);
      opacity: 0;
    }
    30% {
      transform: translateY(-50%) scale(1.1);
      opacity: 1;
    }
    100% {
      transform: translateY(-50%) scale(1);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

export default GestureManager;
