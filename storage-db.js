// storage-db.js — IndexedDB wrapper for FileSystemDirectoryHandle persistence + temp blob transfer

const DB_NAME = 'MegaHubStorage';
const DB_VERSION = 2;
const HANDLES_STORE = 'handles';
const BLOBS_STORE = 'tempBlobs';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(HANDLES_STORE)) {
                db.createObjectStore(HANDLES_STORE);
            }
            if (!db.objectStoreNames.contains(BLOBS_STORE)) {
                db.createObjectStore(BLOBS_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// --- Directory Handle Storage ---
export async function saveDirectoryHandle(key, handle) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLES_STORE, 'readwrite');
        tx.objectStore(HANDLES_STORE).put(handle, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getDirectoryHandle(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLES_STORE, 'readonly');
        const req = tx.objectStore(HANDLES_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

// --- Temp Blob Transfer (background → offscreen) ---
export async function saveTempBlob(key, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BLOBS_STORE, 'readwrite');
        tx.objectStore(BLOBS_STORE).put(blob, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getTempBlob(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BLOBS_STORE, 'readonly');
        const req = tx.objectStore(BLOBS_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteTempBlob(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BLOBS_STORE, 'readwrite');
        tx.objectStore(BLOBS_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
