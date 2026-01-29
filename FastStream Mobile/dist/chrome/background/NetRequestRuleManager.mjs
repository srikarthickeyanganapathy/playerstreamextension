/**
 * NetRequestRuleManager.mjs
 * Manages dynamic declarativeNetRequest rules for header modification
 */

const RULE_ID_START = 1000;

export class RuleEntry {
    constructor(id, url, tabId, headers) {
        this.id = id;
        this.url = url;
        this.tabId = tabId;
        this.headers = headers;
        this.createdAt = Date.now();
        this.expiresAt = Date.now() + 1000 * 60 * 60; // 1 hour expiration
    }
}

export class RuleManager {
    constructor() {
        this.rules = [];
        this.nextRuleId = RULE_ID_START;

        // Clean up expired rules periodically
        setInterval(() => this.cleanupExpiredRules(), 1000 * 60 * 5); // Every 5 minutes
    }

    /**
     * Generate a unique rule ID
     */
    getNextID() {
        return this.nextRuleId++;
    }

    /**
     * Add a header modification rule
     * @param {string} url - Target URL pattern
     * @param {number} tabId - Tab ID (optional)
     * @param {Array} headers - Array of {header, operation, value}
     * @returns {Promise<RuleEntry>}
     */
    async addHeaderRule(url, tabId, headers) {
        const ruleId = this.getNextID();

        // Normalize URL for filter (target the directory to include segments/playlists)
        let urlFilter = url;
        try {
            const urlObj = new URL(url);
            // Get directory path (remove filename)
            const pathDir = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
            // Match anything in this directory
            urlFilter = '||' + urlObj.hostname + pathDir + '*';
        } catch (e) {
            // Fallback: match broadly on the domain if URL parsing fails
            urlFilter = '||' + url.split('/')[2] + '/*';
        }

        const ruleObj = {
            id: ruleId,
            priority: 100,
            action: {
                type: 'modifyHeaders',
                requestHeaders: headers
            },
            condition: {
                urlFilter: urlFilter,
                resourceTypes: ['xmlhttprequest', 'media', 'image', 'other']
            }
        };

        if (tabId) {
            // ruleObj.condition.tabIds = [tabId]; 
            // Note: tabIds condition sometimes causes issues with background workers/player, 
            // so we might want to omit it if the player opens in a new tab/window which has a different ID.
            // For now, let's leave it open to all tabs for this specific URL pattern to ensures it works in the player.
        }

        console.log('[RuleManager] Adding rule:', ruleObj);

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [ruleObj]
        });

        const ruleEntry = new RuleEntry(ruleId, url, tabId, headers);
        this.rules.push(ruleEntry);

        return ruleEntry;
    }

    /**
     * Clean up expired rules
     */
    async cleanupExpiredRules() {
        const now = Date.now();
        const activeRules = [];
        const expiredRuleIds = [];

        for (const rule of this.rules) {
            if (rule.expiresAt > now) {
                activeRules.push(rule);
            } else {
                expiredRuleIds.push(rule.id);
            }
        }

        if (expiredRuleIds.length > 0) {
            console.log('[RuleManager] Cleaning up expired rules:', expiredRuleIds);
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: expiredRuleIds
            });
            this.rules = activeRules;
        }
    }

    /**
     * Remove all dynamic rules
     */
    async clearAllRules() {
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        const ruleIds = rules.map(r => r.id);

        if (ruleIds.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: ruleIds
            });
        }

        this.rules = [];
        this.nextRuleId = RULE_ID_START;
    }
}
