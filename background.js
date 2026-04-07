/**
 * Mega Hub — Optimized Background Service Worker
 * Handles fallback blob fetching for media downloads efficiently.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // CRITICAL: Ignore messages targeted at the offscreen document.
    // sendMessage broadcasts to ALL extension pages. Without this guard,
    // background intercepts offscreen messages and closes the channel before offscreen responds.
    if (request.target === 'offscreen') return false;

    if (request.action === 'update_badge' && sender.tab) {
        const count = request.count;
        if (count > 0) {
            chrome.action.setBadgeText({ text: count.toString(), tabId: sender.tab.id });
            chrome.action.setBadgeBackgroundColor({ color: "#6366f1", tabId: sender.tab.id });
        } else {
            chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
        }
        return false;
    }

    if (request.action === 'fetch_blob') {
        handleFetchBlob(request.url)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));

        return true; // Keep message channel open for async response
    }

    if (request.action === 'smart_download') {
        handleSmartDownload(request.data)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
});

/**
 * Fetch a media URL in the background context.
 * Bypasses CORS restrictions that content scripts face.
 * 
 * @param {string} url - The media URL to fetch
 * @returns {Promise<Object>} - Success state and downloadId or error message
 */
async function handleFetchBlob(url) {
    try {
        // Fetch raw media blob without strict Origin headers to avoid CDN HTTP 400 errors
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();

        // Validate: reject tiny blobs or error pages (HTML/JSON instead of media)
        if (blob.size < 1000) {
            throw new Error('Response too small');
        }
        if (blob.type?.includes('text/')) {
            throw new Error('Got text instead of media');
        }

        // Retrieve user preferences for saving
        const { saveBehavior } = await chrome.storage.sync.get({ saveBehavior: 'auto' });
        const ext = blob.type.includes('video') ? '.mp4' : '.jpg';
        const filename = `Mega Hub/download_${Date.now()}${ext}`;

        // Convert blob to Data URL efficiently using Promise wrapper
        const dataUrl = await blobToDataURL(blob);

        return new Promise((resolve) => {
            chrome.downloads.download({
                url: dataUrl,
                filename: filename,
                saveAs: saveBehavior === 'ask',
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve({ success: true, downloadId });
                }
            });
        });

    } catch (err) {
        console.error("MegaHub Background Fetch Error:", err);
        return { success: false, error: err.message };
    }
}

/**
 * Helper: Converts a Blob to a Base64 Data URL wrapped in a Promise
 * @param {Blob} blob 
 * @returns {Promise<string>}
 */
function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Smart Download: Save media to organized Downloads subfolders.
 * Uses chrome.downloads.download() with organized subfolder paths.
 * Folders are auto-created by Chrome if they don't exist.
 * saveAs is ALWAYS false → truly automatic, no dialogs.
 */
async function handleSmartDownload({ url, filename, folderName }) {
    try {
        const settings = await chrome.storage.sync.get({
            smartRoutingBasePath: 'Mega Hub'
        });

        const basePath = settings.smartRoutingBasePath.trim() || 'Mega Hub';
        const safeFolder = (folderName || 'Misc').replace(/[^a-zA-Z0-9_\-\. ]/g, '').trim() || 'Misc';
        const savePath = `${basePath}/${safeFolder}/${filename}`;

        return new Promise((resolve) => {
            chrome.downloads.download({
                url: url,
                filename: savePath,
                saveAs: false,  // ALWAYS false → automatic saving, no dialog
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve({ success: true, downloadId });
                }
            });
        });
    } catch (err) {
        console.error("MegaHub Smart Download Error:", err);
        return { success: false, error: err.message };
    }
}

// ============================================================
// Dynamic Icon State (Tab activation)
// ============================================================
const coloredIcons = {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
};

const grayIcons = {
    "16": "icons/icon16_gray.png",
    "48": "icons/icon48_gray.png",
    "128": "icons/icon128_gray.png"
};

function updateIconState(tabId, url) {
    if (!url) return;

    if (url.includes('instagram.com')) {
        chrome.action.setIcon({ tabId, path: coloredIcons });
        chrome.action.setPopup({ tabId, popup: 'popup.html' });
        chrome.action.setTitle({ tabId, title: '' });
        chrome.action.enable(tabId);
    } else {
        chrome.action.setIcon({ tabId, path: grayIcons });
        chrome.action.setPopup({ tabId, popup: '' });
        chrome.action.setTitle({ tabId, title: 'No access to this site' });
        chrome.action.disable(tabId);
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Update if the URL changes OR if the page literally finished loading/refreshing
    if (changeInfo.url || changeInfo.status === 'complete') {
        if (tab.url) {
            updateIconState(tabId, tab.url);
        }
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        updateIconState(tab.id, tab.url);
    } catch (e) { }
});

// Run a sweep when the Service Worker wakes up or installs
chrome.runtime.onInstalled.addListener(() => sweepTabs());
chrome.runtime.onStartup.addListener(() => sweepTabs());

function sweepTabs() {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            if (tab.id && tab.url) {
                updateIconState(tab.id, tab.url);
            }
        }
    });
}
sweepTabs();
