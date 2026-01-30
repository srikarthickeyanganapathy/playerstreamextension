/**
 * FastStream Mobile - ABR Controller
 * Intelligent Bitrate Selection Engine
 */

export class ABRController {
    constructor() {
        this.bandwidthSamples = [];
        this.currentBitrateIndex = -1; // -1 = auto (start lowest)
        this.isLocked = false;
        this.lastSwitchTime = 0;

        // Configuration
        this.config = {
            emaAlpha: 0.15, // Smoothing factor for bandwidth EMA
            switchInterval: 10000, // Min ms between switches (stability)
            bufferSafetyParams: {
                panic: 5,   // seconds
                safe: 20,   // seconds
                rich: 60    // seconds
            }
        };

        this.currentBandwidthEstimate = 0; // bps
    }

    /**
     * Report a download completion to update stats
     * @param {number} bytes 
     * @param {number} durationMs 
     */
    reportSegmentDownload(bytes, durationMs) {
        if (durationMs <= 0) return;

        const bps = (bytes * 8) / (durationMs / 1000);

        // Calculate EMA (Exponential Moving Average)
        if (this.currentBandwidthEstimate === 0) {
            this.currentBandwidthEstimate = bps;
        } else {
            this.currentBandwidthEstimate =
                (this.config.emaAlpha * bps) +
                ((1 - this.config.emaAlpha) * this.currentBandwidthEstimate);
        }

        this.bandwidthSamples.push({ t: Date.now(), bps });
        if (this.bandwidthSamples.length > 20) this.bandwidthSamples.shift();
    }

    /**
     * Decide next quality level
     * @param {Array} profiles - List of available bitrates sorted asc
     * @param {number} bufferLevel - Current buffer length in seconds
     */
    getNextQuality(profiles, bufferLevel) {
        if (!profiles || profiles.length === 0) return 0;
        if (this.isLocked) return this.currentBitrateIndex;

        const now = Date.now();
        // Stability check: Don't switch too often unless panic
        if (now - this.lastSwitchTime < this.config.switchInterval && bufferLevel > this.config.bufferSafetyParams.panic) {
            return this.currentBitrateIndex;
        }

        // Logic:
        // 1. Calculate Safe Bandwidth (e.g., 80% of estimate)
        const safeBandwidth = this.currentBandwidthEstimate * 0.8;

        // 2. Find highest profile < safeBandwidth
        let idealIndex = 0;
        for (let i = 0; i < profiles.length; i++) {
            if (profiles[i].bitrate <= safeBandwidth) {
                idealIndex = i;
            } else {
                break;
            }
        }

        // 3. Buffer-based adjustment override
        if (bufferLevel < this.config.bufferSafetyParams.panic) {
            // Panic: drop to lowest immediately
            idealIndex = 0;
        } else if (bufferLevel > this.config.bufferSafetyParams.rich) {
            // Rich buffer: we can afford to be aggressive (step up)
            if (idealIndex < profiles.length - 1) {
                // Check if next profile is 'reasonably' close
                const nextProfile = profiles[idealIndex + 1];
                if (nextProfile.bitrate < (this.currentBandwidthEstimate * 1.1)) {
                    idealIndex++;
                }
            }
        }

        // 4. Update state
        if (idealIndex !== this.currentBitrateIndex) {
            console.log(`[ABR] Switching quality: ${this.currentBitrateIndex} -> ${idealIndex} (BW: ${(this.currentBandwidthEstimate / 1000000).toFixed(2)} Mbps)`);
            this.currentBitrateIndex = idealIndex;
            this.lastSwitchTime = now;
        }

        return idealIndex;
    }

    /**
     * Manually lock bitrate
     * @param {number} index 
     */
    lockQuality(index) {
        this.isLocked = true;
        this.currentBitrateIndex = index;
    }

    unlockQuality() {
        this.isLocked = false;
    }
}
