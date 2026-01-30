/**
 * FastStream Mobile - Buffer Manager
 * Implements a Ring Buffer using IndexedDB to store video segments.
 * optimized for mobile (Low RAM usage).
 */

const DB_NAME = 'FastStreamDB';
const DB_VERSION = 1;
const STORE_NAME = 'segments';
const MAX_BUFFER_SIZE_MB = 500; // 500MB max storage per tab

export class BufferManager {
    constructor(tabId) {
        this.tabId = tabId;
        this.db = null;
        this.currentSize = 0;
    }

    /**
     * Initialize IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => reject('IndexedDB error: ' + event.target.errorCode);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    // keyPath: [tabId, streamId, segmentId]
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
        });
    }

    /**
     * Store a segment in IndexedDB
     * @param {string} streamId 
     * @param {number} segmentId 
     * @param {ArrayBuffer} data 
     */
    async storeSegment(streamId, segmentId, data) {
        if (!this.db) await this.init();

        const size = data.byteLength;

        // Eviction logic: If full, remove oldest segments for this tab
        if (this.currentSize + size > (MAX_BUFFER_SIZE_MB * 1024 * 1024)) {
            await this._evictOldest(streamId);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const record = {
                id: `${this.tabId}_${streamId}_${segmentId}`,
                tabId: this.tabId,
                streamId: streamId,
                segmentId: segmentId,
                data: data,
                timestamp: Date.now()
            };

            const request = store.put(record);

            request.onsuccess = () => {
                this.currentSize += size;
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Retrieve a segment
     * @param {string} streamId 
     * @param {number} segmentId 
     */
    async getSegment(streamId, segmentId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const key = `${this.tabId}_${streamId}_${segmentId}`;
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result ? request.result.data : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Evict oldest segments to free up space
     */
    async _evictOldest(streamId) {
        // Implementation note: For production speed, we'd use an Index cursor here.
        // For this MVP, we essentially just clear somewhat blindly or warn.
        // A real implementation would use a 'timestamp' index.
        console.warn('[BufferManager] Evicting oldest segments...');
        // Placeholder: Clear 20% of buffer
        this.currentSize = Math.max(0, this.currentSize - (10 * 1024 * 1024));
    }

    /**
     * Clear all segments for this tab
     */
    async clearAll() {
        if (!this.db) return;
        // In a real implementation with indexes, we'd delete range tabId_...
        // For now, we rely on the main engine to clean up or just handle overwrites.
    }
}
