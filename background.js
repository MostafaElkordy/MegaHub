/**
 * Mega Hub — Optimized Background Service Worker
 * Handles fallback blob fetching for media downloads efficiently.
 */
'use strict';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

    if (request.action === 'offscreen_save_blob') {
        (async () => {
            try {
                await setupOffscreenDocument('offscreen.html');
                const response = await chrome.runtime.sendMessage(request);
                sendResponse(response);
            } catch (err) {
                console.error("MegaHub Background Offscreen Error:", err);
                sendResponse({ success: false, error: err.message });
            }
        })();
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

// ============================================================
// Offscreen Document Lifecycle Management
// ============================================================
let creatingOffscreen;
async function setupOffscreenDocument(path) {
    if (await chrome.offscreen.hasDocument()) return;

    if (creatingOffscreen) {
        await creatingOffscreen;
    } else {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: path,
            reasons: ['BLOBS'],
            justification: 'Streaming video downloads to the local filesystem directly to bypass memory limits'
        });
        await creatingOffscreen;
        creatingOffscreen = null;
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
    } else {
        chrome.action.setIcon({ tabId, path: grayIcons });
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only update if the URL actually changed to prevent redundant icon flashing
    if (changeInfo.url) {
        updateIconState(tabId, changeInfo.url);
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
