/**
 * Mega Hub — Content Script
 * Injects download buttons on Instagram pages (feed, reels, profile grid, single posts).
 * Communicates with inject.js (MAIN world) for media metadata.
 * Downloads media via Blob + <a download> technique with progress tracking.
 */

console.log("Mega Hub: Content script loaded");

// ============================================================
// Constants & Templates
// ============================================================
const SELECTORS = {
    links: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]',
    media: 'img[srcset], img[style*="object-fit"], video, canvas',
    bookmark: 'svg[aria-label="Save"], svg[aria-label="حفظ"], svg[aria-label="Remove"]',
    buttons: '.ig-dl-btn, .megahub-inline-dl, .megahub-reel-sidebar-btn, .megahub-grid-dl-btn'
};

const REGEX = {
    shortcode: /\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/
};

// Use a Template element for vastly faster DOM insertion than innerHTML string parsing
const SVG_TEMPLATES = {
    downloadText: (() => {
        const t = document.createElement('template');
        t.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" class="megahub-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download`;
        return t;
    })(),
    downloadSmall: (() => {
        const t = document.createElement('template');
        t.innerHTML = `<svg viewBox="0 0 24 24" class="megahub-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
        return t;
    })(),
    doneSmall: (() => {
        const t = document.createElement('template');
        t.innerHTML = `<svg viewBox="0 0 24 24" class="megahub-icon"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        return t;
    })()
};

// ============================================================
// Communication with inject.js (MAIN world)
// ============================================================
const pendingRequests = {};
let requestCounter = 0;

window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'megahub-inject' && event.data.requestId) {
        const resolver = pendingRequests[event.data.requestId];
        if (resolver) {
            resolver(event.data);
            delete pendingRequests[event.data.requestId];
        }
    }
});

/**
 * Request post data from inject.js by shortcode.
 * Returns a promise with { success, videoUrl, imageUrl, mediaPk, takenAt, userPk, username }.
 */
function requestPostData(shortcode) {
    return new Promise((resolve) => {
        const requestId = 'megahub_' + (++requestCounter) + '_' + Date.now();
        pendingRequests[requestId] = resolve;

        window.postMessage({
            source: 'megahub-content',
            action: 'getPostData',
            shortcode: shortcode,
            requestId: requestId
        }, '*');

        setTimeout(() => {
            if (pendingRequests[requestId]) {
                delete pendingRequests[requestId];
                resolve({ success: false, error: 'timeout' });
            }
        }, 10000);
    });
}

/**
 * Request HD Avatar data from inject.js
 */
function requestAvatarData(username) {
    return new Promise((resolve) => {
        const requestId = 'megahub_avatar_' + (++requestCounter) + '_' + Date.now();
        pendingRequests[requestId] = resolve;

        window.postMessage({
            source: 'megahub-content',
            action: 'getAvatar',
            username: username,
            requestId: requestId
        }, '*');

        setTimeout(() => {
            if (pendingRequests[requestId]) {
                delete pendingRequests[requestId];
                resolve({ success: false });
            }
        }, 8000); // 8 second timeout for API
    });
}

// Global button style — each injection function checks this
let _currentButtonStyle = 'inline';

// ============================================================
// Main Entry: Inject download buttons on all supported pages
// ============================================================
async function injectButtons() {
    let settings = { buttonStyle: 'inline' };
    try {
        settings = await chrome.storage.sync.get(settings);
    } catch (e) {
        // Extension context invalidated (e.g. after reload) — use defaults
    }

    _currentButtonStyle = settings.buttonStyle;

    // Call all — each function checks _currentButtonStyle and skips if not its mode
    injectFeedButtons();
    injectFeedInlineButtons();
    injectSinglePostButtons();
    injectReelsButtons();
    injectReelsSidebarButton();
    injectGridButtons();
    injectAvatarButton();
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'toggleCarouselDownload') {
        _carouselDownloadEnabled = request.enabled;
    } else if (request.action === 'switchButtonStyle') {
        // Remove ALL injected download buttons across the page
        document.querySelectorAll('.ig-dl-btn.single-dl').forEach(el => el.remove());
        document.querySelectorAll('.ig-dl-btn').forEach(el => {
            // Only remove non-grid overlay buttons
            if (!el.closest('.megahub-grid-overlay')) el.remove();
        });
        document.querySelectorAll('.megahub-inline-dl').forEach(el => el.remove());
        document.querySelectorAll('.megahub-reel-sidebar-btn').forEach(el => el.remove());
        document.querySelectorAll('[data-megahub-injected]').forEach(el => {
            delete el.dataset.megahubInjected;
        });

        // Re-inject with the new style
        injectButtons().catch(() => { });
    }
});

// ============================================================
// 1. Feed posts (articles in the home feed)
// ============================================================
function injectFeedButtons() {
    if (_currentButtonStyle !== 'overlay') return;
    if (window.location.pathname.includes('/saved/')) return;

    const container = document.querySelector('div[role="dialog"]') || document.querySelector('main') || document;
    const articles = container.querySelectorAll('article');
    articles.forEach(article => {
        // Find ALL media elements in the post (handles carousels naturally)
        const mediaNodes = article.querySelectorAll('video, img[srcset]:not([alt*="profile"]:not([alt*="صورة"])), img[style*="object-fit"]:not([alt*="profile"]):not([alt*="صورة"])');

        mediaNodes.forEach(media => {
            // Check if wrapper already has a button
            const wrapper = media.parentElement;
            if (!wrapper || wrapper.querySelector('.ig-dl-btn')) return;

            // Only inject if it's a structural wrapper (ignore tiny icons)
            if (wrapper.offsetWidth > 150 && wrapper.offsetHeight > 150) {
                // Ensure wrapper is relative so absolute button anchors properly to the slide
                const style = window.getComputedStyle(wrapper);
                if (style.position === 'static') wrapper.style.position = 'relative';

                addDownloadButton(wrapper, article);
            }
        });
    });
}

// ============================================================
// 1b. Feed posts — Inline arrow in action bar (next to bookmark)
// ============================================================
function injectFeedInlineButtons() {
    if (_currentButtonStyle !== 'inline') return;
    if (window.location.pathname.includes('/saved/')) return;

    const container = document.querySelector('div[role="dialog"]') || document.querySelector('main') || document;
    const articles = container.querySelectorAll('article');
    articles.forEach(article => {
        if (article.querySelector('.megahub-inline-dl')) return;

        const mediaSection = findMediaSection(article);
        if (!mediaSection) return;

        const hasVideo = !!mediaSection.querySelector('video');
        const hasImage = !!mediaSection.querySelector('img[srcset], img[style*="object-fit"]');
        if (!hasVideo && !hasImage) return;

        // Find the bookmark (Save) button inside this article
        const bookmarkSvg = article.querySelector('svg[aria-label="Save"], svg[aria-label="حفظ"], svg[aria-label="Remove"]');
        if (!bookmarkSvg) return;

        const bookmarkBtn = bookmarkSvg.closest('button') || bookmarkSvg.closest('div[role="button"]');
        if (!bookmarkBtn) return;

        const bookmarkWrapper = bookmarkBtn.parentElement;
        if (!bookmarkWrapper) return;

        // Create the inline download arrow
        const dlBtn = document.createElement('button');
        dlBtn.className = 'megahub-inline-dl';
        dlBtn.title = 'Download';
        dlBtn.appendChild(SVG_TEMPLATES.downloadSmall.content.cloneNode(true));

        // Place to the left of the bookmark icon with spacing
        bookmarkWrapper.style.display = 'flex';
        bookmarkWrapper.style.alignItems = 'center';
        bookmarkWrapper.style.gap = '8px';
        bookmarkWrapper.prepend(dlBtn);
    });
}

// ============================================================
// DOM Helpers
// ============================================================

/** Find the main media container within an article. */
function findMediaSection(article) {
    const media = article.querySelector('video') ||
        article.querySelector('img[srcset]:not([alt*="profile"]):not([alt*="صورة"]), img[style*="object-fit"]:not([alt*="profile"]):not([alt*="صورة"])');
    if (!media) return null;

    // Default Feed Post Logic
    let parent = media.parentElement;
    for (let i = 0; i < 8; i++) {
        if (!parent || parent === article) break;
        if (parent.offsetWidth > 200 && parent.offsetHeight > 200) return parent;
        parent = parent.parentElement;
    }
    return media.parentElement;
}

/** Extract shortcode from article links or page URL. */
function getShortcode(element) {
    const sc = element.getAttribute('data-megahub-shortcode');
    if (sc) return sc;

    const links = element.querySelectorAll(SELECTORS.links);
    for (const link of links) {
        const match = link.href.match(REGEX.shortcode);
        if (match) return match[2];
    }

    const pageMatch = window.location.pathname.match(REGEX.shortcode);
    if (pageMatch) return pageMatch[2];

    return null;
}

/** Get direct video URL from data attributes set by inject.js. */
function getDirectVideoUrl(container) {
    const video = container.querySelector('video[data-megahub-video-url]');
    if (video) return video.getAttribute('data-megahub-video-url');

    const article = container.closest('article');
    if (article) {
        const url = article.getAttribute('data-megahub-video-url');
        if (url) return url;
    }
    return null;
}

/** Get the post author's username from the article header. */
function getUsername(article) {
    const header = article.querySelector('header');
    if (header) {
        const link = header.querySelector('a');
        if (link && link.textContent) return link.textContent.trim();
    }
    return 'instagram_user';
}

/** Get the best (highest resolution) image URL from srcset. */
function getBestImageUrl(img) {
    let best = img.src;
    if (img.srcset) {
        const entries = img.srcset.split(',');
        const largest = entries.reduce((prev, curr) => {
            const pw = parseInt(prev.trim().split(' ')[1] || '0');
            const cw = parseInt(curr.trim().split(' ')[1] || '0');
            return cw > pw ? curr : prev;
        }, entries[0]);
        best = largest.trim().split(' ')[0];
    }
    return best;
}

// ============================================================
// Feed Post Download Button
// ============================================================
// ============================================================
// Core Download Logic: Get media URL and trigger download
// ============================================================
async function getMediaAndDownload(mediaSection, article, username) {
    const shortcode = getShortcode(article);

    // Strategy 1: Direct video URL from inject.js data attributes
    const directUrl = getDirectVideoUrl(mediaSection);
    if (directUrl) {
        await downloadViaBlob(directUrl, username, 'video', {});
        return true;
    }

    // Strategy 2: Request post data from inject.js
    if (shortcode) {
        const postData = await requestPostData(shortcode);
        if (postData && postData.success) {
            const meta = {
                mediaPk: postData.mediaPk || '',
                takenAt: postData.takenAt || '',
                userPk: postData.userPk || '',
                realUsername: postData.username || ''
            };
            if (postData.videoUrl) {
                await downloadViaBlob(postData.videoUrl, meta.realUsername || username, 'video', meta);
                return true;
            } else if (postData.imageUrl) {
                await downloadViaBlob(postData.imageUrl, meta.realUsername || username, 'image', meta);
                return true;
            }
        }
    }

    // Strategy 3: Fallback — parse the post page HTML
    if (shortcode) {
        const apiUrl = await fetchFromPublicApi(shortcode);
        if (apiUrl) {
            const isVideo = apiUrl.includes('.mp4') || apiUrl.includes('video');
            await downloadViaBlob(apiUrl, username, isVideo ? 'video' : 'image', {});
            return true;
        }
    }

    // Strategy 4: Last resort — download the currently visible image or video directly
    const allMedia = Array.from(mediaSection.querySelectorAll('img[srcset], img[style*="object-fit"], video'));

    // Find the media element that is currently visible in the viewport (useful for carousels)
    let visibleMedia = null;
    let maxVisibleWidth = 0;

    for (const mediaEl of allMedia) {
        // Skip tiny icons or profile pictures
        if (mediaEl.alt && (mediaEl.alt.includes('profile') || mediaEl.alt.includes('صورة'))) continue;

        const rect = mediaEl.getBoundingClientRect();
        // Check if the element has actual layout dimensions and is roughly within the viewport
        if (rect.width > 100 && rect.height > 100 && rect.left >= -50 && rect.right <= (window.innerWidth + 50)) {
            if (rect.width > maxVisibleWidth) {
                maxVisibleWidth = rect.width;
                visibleMedia = mediaEl;
            }
        }
    }

    if (visibleMedia) {
        if (visibleMedia.tagName.toLowerCase() === 'video') {
            const vidUrl = visibleMedia.src || visibleMedia.currentSrc || getDirectVideoUrl(visibleMedia.parentElement);
            if (vidUrl) {
                await downloadViaBlob(vidUrl, username, 'video', {});
                return true;
            }
        } else {
            const imgUrl = getBestImageUrl(visibleMedia);
            if (imgUrl) {
                await downloadViaBlob(imgUrl, username, 'image', {});
                return true;
            }
        }
    }

    // Ultimate fallback if geometric calculaton fails
    const img = mediaSection.querySelector('img[srcset], img[style*="object-fit"]');
    if (img) {
        const imgUrl = getBestImageUrl(img);
        if (imgUrl) {
            await downloadViaBlob(imgUrl, username, 'image', {});
            return true;
        }
    }

    return false;
}

// ============================================================
// Fallback: Parse post page HTML for video_url
// ============================================================
async function fetchFromPublicApi(shortcode) {
    try {
        const response = await fetch(`https://www.instagram.com/p/${shortcode}/`, {
            credentials: 'include'
        });
        if (!response.ok) return null;
        const html = await response.text();

        // Look for video_url in embedded JSON
        const videoMatch = html.match(/"video_url"\s*:\s*"(https?:[^"]+)"/);
        if (videoMatch) {
            return videoMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        }

        // Look for video_versions
        const versionsMatch = html.match(/"video_versions"\s*:\s*\[\s*\{[^}]*"url"\s*:\s*"(https?:[^"]+)"/);
        if (versionsMatch) {
            return versionsMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        }

        // Look for display_url (image)
        const imgMatch = html.match(/"display_url"\s*:\s*"(https?:[^"]+)"/);
        if (imgMatch) {
            return imgMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        }
    } catch (e) {
        // silent fail
    }
    return null;
}

// ============================================================
// Add Download Button
// ============================================================
function addDownloadButton(mediaSection, article) {
    if (mediaSection.querySelector('.ig-dl-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'ig-dl-btn single-dl';
    btn.title = 'Download Media';

    // Overlap the sliding image correctly
    btn.style.zIndex = '99';

    btn.appendChild(SVG_TEMPLATES.downloadSmall.content.cloneNode(true));
    btn.append(' Download');

    mediaSection.appendChild(btn);
}

/** Format bytes into human-readable string (e.g. "2.4 MB"). */
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

// ============================================================
// Progress Toast UI
// ============================================================
let _toastContainer = null;

function getOrCreateToastContainer() {
    if (_toastContainer && _toastContainer.isConnected) return _toastContainer;

    _toastContainer = document.querySelector('.megahub-toast-container');
    if (!_toastContainer) {
        _toastContainer = document.createElement('div');
        _toastContainer.className = 'megahub-toast-container';
        document.body.appendChild(_toastContainer);
    }
    return _toastContainer;
}

function createProgressToast(filename) {
    const container = getOrCreateToastContainer();
    const toast = document.createElement('div');
    toast.className = 'megahub-progress-toast';
    toast.innerHTML = `
        <div class="megahub-progress-header">
            <span class="megahub-progress-filename" title="${filename}">${filename}</span>
            <button class="megahub-progress-cancel" title="Cancel">✕</button>
        </div>
        <div class="megahub-progress-track">
            <div class="megahub-progress-fill"></div>
        </div>
        <div class="megahub-progress-stats">
            <span class="megahub-progress-size">Connecting...</span>
            <span class="megahub-progress-percent">0%</span>
        </div>
    `;
    container.appendChild(toast);

    const fill = toast.querySelector('.megahub-progress-fill');
    const sizeEl = toast.querySelector('.megahub-progress-size');
    const percentEl = toast.querySelector('.megahub-progress-percent');
    const cancelBtn = toast.querySelector('.megahub-progress-cancel');

    return {
        el: toast,
        update(loaded, total) {
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
            fill.style.width = pct + '%';
            percentEl.textContent = pct + '%';
            sizeEl.textContent = `${formatBytes(loaded)} / ${formatBytes(total)}`;
        },
        setIndeterminate(msg) {
            fill.style.width = '60%';
            sizeEl.textContent = msg || 'Downloading...';
            percentEl.textContent = '—';
        },
        setError(msg) {
            toast.classList.add('error');
            sizeEl.textContent = msg || 'Download failed';
            percentEl.textContent = '✕';
        },
        setDone(totalSize) {
            toast.classList.add('done');
            sizeEl.textContent = formatBytes(totalSize);
            percentEl.textContent = '✓ Done';
        },
        onCancel(cb) { cancelBtn.addEventListener('click', cb); },
        remove() {
            toast.classList.add('removing');
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
                if (container.children.length === 0 && container.parentElement) {
                    container.remove();
                    _toastContainer = null;
                }
            }, 300);
        }
    };
}

// ============================================================
// Smart Download Queue Manager
// ============================================================
class DownloadQueueManager {
    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
        this.activeCount = 0;
        this.queue = [];
        this.pendingIndicator = null;
    }

    enqueue(url, username, type, meta = {}) {
        return new Promise((resolve) => {
            const item = { url, username, type, meta, resolve };
            this.queue.push(item);
            this.updatePendingUI();
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        const item = this.queue.shift();
        this.activeCount++;
        this.updatePendingUI();

        try {
            const success = await _downloadViaBlobTarget(item.url, item.username, item.type, item.meta);
            item.resolve(success);
        } catch (e) {
            item.resolve(false);
        } finally {
            this.activeCount--;
            this.updatePendingUI(); // Update UI immediately when a download finishes
            this.processQueue();
        }
    }

    updatePendingUI() {
        const container = getOrCreateToastContainer();

        if (this.queue.length > 0) {
            if (!this.pendingIndicator) {
                this.pendingIndicator = document.createElement('div');
                this.pendingIndicator.className = 'megahub-pending-indicator';
            }
            this.pendingIndicator.textContent = `⏳ ${this.queue.length} pending...`;

            // In column-reverse, appendChild puts it at the visual top
            if (this.pendingIndicator.parentElement !== container || container.lastChild !== this.pendingIndicator) {
                container.appendChild(this.pendingIndicator);
            }
        } else if (this.pendingIndicator) {
            this.pendingIndicator.remove();
            this.pendingIndicator = null;
        }

        // Notify background to update the extension icon badge
        try {
            chrome.runtime.sendMessage({
                action: 'update_badge',
                count: this.queue.length + this.activeCount
            }).catch(() => { });
        } catch (e) { }
    }
}

const queueManager = new DownloadQueueManager(3);

async function downloadViaBlob(url, username, type, meta = {}) {
    return queueManager.enqueue(url, username, type, meta);
}

// ============================================================
// Core Download: Fetch with progress → Blob → <a>.click()
// ============================================================
async function _downloadViaBlobTarget(url, username, type, meta = {}) {
    if (!url || url === 'undefined' || url === 'null') {
        console.error("Mega Hub: Invalid URL:", url);
        return false;
    }

    // Clean encoded characters
    url = url.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');

    const ext = type === 'video' ? '.mp4' : '.jpg';
    const safeUser = (meta.realUsername || username || 'user').replace(/[^a-zA-Z0-9_\.]/g, '');
    const takenAt = String(meta.takenAt || '');
    const userPk = String(meta.userPk || '');

    // Initialize formatting preferences
    const { carouselNamingFormat = 'real_id', customCarouselSuffix = 'slide' } = await chrome.storage.sync.get(['carouselNamingFormat', 'customCarouselSuffix']);

    let targetMediaId = String(meta.mediaPk || '');
    let idxStr = '';

    // If this is a child slide in a carousel, apply the naming format rules
    if (meta.mediaIndex) {
        if (carouselNamingFormat === 'real_id' && meta.childPk) {
            targetMediaId = String(meta.childPk);
            idxStr = ''; // Do not append _part when using absolute real IDs
        } else if (carouselNamingFormat === 'custom') {
            idxStr = `_${customCarouselSuffix}${meta.mediaIndex}`;
        } else {
            // Default "part" mode
            idxStr = `_part${meta.mediaIndex}`;
        }
    }

    let filename;
    if (targetMediaId && takenAt && userPk) {
        filename = `${safeUser}_${takenAt}_${targetMediaId}_${userPk}${idxStr}${ext}`;
    } else if (targetMediaId && takenAt) {
        filename = `${safeUser}_${takenAt}_${targetMediaId}${idxStr}${ext}`;
    } else if (targetMediaId) {
        filename = `${safeUser}_${targetMediaId}${idxStr}${ext}`;
    } else {
        filename = `${safeUser}_${extractIdFromUrl(url)}${idxStr}${ext}`;
    }

    // Create progress toast and abort controller
    const progress = createProgressToast(filename);
    const abortController = new AbortController();
    let cancelled = false;

    progress.onCancel(() => {
        cancelled = true;
        abortController.abort();
        progress.setError('Cancelled');
        setTimeout(() => progress.remove(), 1500);
    });

    try {
        const { smartRoutingEnabled } = await chrome.storage.sync.get({ smartRoutingEnabled: false });

        // Phase 1: Smart Harvester File System Bypass
        if (smartRoutingEnabled) {
            progress.setIndeterminate('Streaming to Master Folder...');

            // Extract the username/collection name to use as subfolder
            const folderName = username || 'Misc';

            return new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    action: 'offscreen_save_blob',
                    data: { url, filename, folderName, username }
                }, (response) => {
                    if (cancelled) return resolve(false);

                    if (chrome.runtime.lastError || !response || !response.success) {
                        const errMsg = response?.error || chrome.runtime.lastError?.message || "Smart Routing Error";
                        progress.setError(errMsg.length > 30 ? "Check Options for Master Folder" : errMsg);
                        console.error("MegaHub Smart Routing Error:", errMsg);
                        setTimeout(() => progress.remove(), 4000);

                        // Fail silently for mass downloads, or return false to retry locally?
                        // If Master Folder broke, returning false stops the item from 'succeeding', which is correct.
                        resolve(false);
                    } else {
                        progress.setDone(0);
                        progress.el.querySelector('.megahub-progress-size').textContent = 'Saved Natively';
                        setTimeout(() => progress.remove(), 2500);
                        resolve(true);
                    }
                });
            });
        }

        // Phase 1 (Original): Fallback to Local Blob Memory Fetch
        const isCDN = url.includes('cdninstagram.com') || url.includes('fbcdn.net') || url.includes('cdninstagram.net');
        let blob = null;

        // Attempt 1: Standard fetch (CDN without credentials, Instagram with credentials)
        try {
            const opts = isCDN
                ? { signal: abortController.signal }
                : { credentials: 'include', signal: abortController.signal };
            const response = await fetch(url, opts);
            if (response.ok) blob = await readResponseWithProgress(response, progress);
        } catch (e) {
            if (cancelled) return false;
        }

        // Attempt 2: Retry without credentials
        if (!blob && !cancelled) {
            try {
                progress.setIndeterminate('Retrying...');
                const response = await fetch(url, { signal: abortController.signal });
                if (response.ok) blob = await readResponseWithProgress(response, progress);
            } catch (e) {
                if (cancelled) return false;
            }
        }

        // Attempt 3: Background script fetch (has host_permissions)
        if (!blob && !cancelled) {
            progress.setIndeterminate('Trying alternate method...');
            blob = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'fetch_blob', url }, (response) => {
                    if (response && response.success && response.blobUrl) {
                        triggerDownload(response.blobUrl, filename, true);
                        progress.setDone(0);
                        setTimeout(() => progress.remove(), 2000);
                        resolve(null);
                    } else {
                        resolve(null);
                    }
                });
                setTimeout(() => resolve(null), 15000);
            });
            if (blob === null) return true;
        }

        if (cancelled) return false;

        // Validate blob
        if (!blob || blob.size < 1000) {
            progress.setError('Download failed — empty response');
            setTimeout(() => progress.remove(), 3000);
            return false;
        }
        if (type === 'video' && (blob.type || '').includes('text/')) {
            progress.setError('Download failed — invalid file');
            setTimeout(() => progress.remove(), 3000);
            return false;
        }

        // Success
        progress.setDone(blob.size);
        triggerDownload(URL.createObjectURL(blob), filename, false);
        setTimeout(() => progress.remove(), 2500);
        return true;

    } catch (err) {
        if (!cancelled) {
            progress.setError('Download failed');
            setTimeout(() => progress.remove(), 3000);
        }
        console.error("Mega Hub: Download failed:", err);
        return false;
    }
}

/** Read a fetch Response body with progress tracking via ReadableStream. */
async function readResponseWithProgress(response, progress) {
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    const contentType = response.headers.get('content-type') || '';

    if (!response.body || !window.ReadableStream) {
        progress.setIndeterminate('Downloading...');
        return await response.blob();
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;

    contentLength > 0 ? progress.update(0, contentLength) : progress.setIndeterminate('Downloading...');

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;

        if (contentLength > 0) {
            progress.update(loaded, contentLength);
        } else {
            progress.setIndeterminate(`Downloaded ${formatBytes(loaded)}`);
        }
    }

    return new Blob(chunks, { type: contentType });
}

/** Create a hidden <a> element and click it to trigger the browser download. */
function triggerDownload(blobUrl, filename, isBgUrl) {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        if (!isBgUrl) URL.revokeObjectURL(blobUrl);
    }, 10000);
}

// ============================================================
// 2. Reels — full-screen feed and profile reels tab
// ============================================================
function injectReelsButtons() {
    if (_currentButtonStyle !== 'overlay') return;
    // Strategy 1: Pressable containers (Instagram's interactive elements)
    document.querySelectorAll('div[data-pressable-container="true"]').forEach(container => {
        // Skip feed posts — only inject in Reels
        if (container.closest('article')) return;
        injectReelButton(container);
    });

    // Strategy 2: Full-screen reels feed — find large containers with video
    document.querySelectorAll('video').forEach(video => {
        // Skip feed posts — only inject in Reels
        if (video.closest('article')) return;
        let el = video.parentElement;
        for (let i = 0; i < 8 && el; i++) {
            const rect = el.getBoundingClientRect();
            if (rect.height > window.innerHeight * 0.6 && rect.width > 200) {
                injectReelButton(el);
                break;
            }
            el = el.parentElement;
        }
    });

    // Strategy 3: Sidebar download button (next to like/comment/share/bookmark)
    injectReelsSidebarButton();
}

function injectReelButton(container) {
    if (container.dataset.megahubInjected) return;
    if (!container.querySelector('video')) return;
    if (container.querySelector('.ig-dl-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'ig-dl-btn single-dl';
    btn.appendChild(SVG_TEMPLATES.downloadText.content.cloneNode(true));
    btn.style.zIndex = '99999';

    const userLink = container.querySelector('a[href^="/"]');
    const username = userLink?.textContent?.trim() || 'ig_reel';

    container.style.position = 'relative';
    container.appendChild(btn);
    container.dataset.megahubInjected = 'true';
}

/** Add a download icon in the reels action sidebar (beside like/comment/share/bookmark). */
function injectReelsSidebarButton() {
    if (_currentButtonStyle !== 'inline') return;

    // Target the Bookmark/Save button
    const bookmarkButtons = document.querySelectorAll('svg[aria-label="Save"], svg[aria-label="حفظ"], svg[aria-label="Remove"]');

    bookmarkButtons.forEach(svgEl => {
        const actionBtn = svgEl.closest('button') || svgEl.closest('div[role="button"]');
        if (!actionBtn) return;

        // Skip feed posts — only inject in Reels full-screen view
        if (actionBtn.closest('article')) return;

        const actionColumn = actionBtn.parentElement;
        if (!actionColumn) return;

        const columnParent = actionColumn.parentElement;
        if (!columnParent || columnParent.querySelector('.megahub-reel-sidebar-btn')) return;

        // Find shortcode and username from context
        let shortcode = null;
        const urlMatch = window.location.pathname.match(/\/(reel|reels)\/([A-Za-z0-9_-]+)/);
        if (urlMatch) shortcode = urlMatch[2];

        let username = 'ig_reel';
        const nearestSection = actionColumn.closest('section') || actionColumn.closest('div[style]');
        if (nearestSection) {
            const reelLink = nearestSection.querySelector('a[href*="/reel/"], a[href*="/p/"]');
            if (reelLink) {
                const linkMatch = reelLink.href.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
                if (linkMatch) shortcode = linkMatch[2];
            }
            const userLink = nearestSection.querySelector('a[href^="/"]:not([href*="/explore"])');
            if (userLink) {
                const uMatch = userLink.href.match(/instagram\.com\/([^/?]+)/);
                if (uMatch && !['reels', 'reel', 'p', 'explore', 'accounts'].includes(uMatch[1])) {
                    username = uMatch[1];
                }
            }
        }

        // Create the sidebar download button
        const dlBtn = document.createElement('div');
        dlBtn.className = 'megahub-reel-sidebar-btn';
        dlBtn.setAttribute('role', 'button');
        dlBtn.setAttribute('tabindex', '0');
        dlBtn.title = 'Download';
        dlBtn.appendChild(SVG_TEMPLATES.downloadSmall.content.cloneNode(true));

        // Insert at the bottom, outside the Instagram hover bounding box
        const targetParent = actionColumn.parentElement;
        if (targetParent) {
            targetParent.appendChild(dlBtn);
        }
    });
}

// ============================================================
// 3. Single post page (/p/xxx, /reel/xxx)
// ============================================================
function injectSinglePostButtons() {
    if (_currentButtonStyle !== 'overlay') return;
    const path = window.location.pathname;
    if (!path.startsWith('/p/') && !path.startsWith('/reel/')) return;

    const container = document.querySelector('div[role="dialog"]') || document.querySelector('main');
    if (!container) return;

    const article = container.querySelector('article') || container;
    const mediaNodes = article.querySelectorAll('video, img[srcset]:not([alt*="profile"]:not([alt*="صورة"])), img[style*="object-fit"]:not([alt*="profile"]):not([alt*="صورة"])');

    mediaNodes.forEach(media => {
        const wrapper = media.parentElement;
        if (!wrapper || wrapper.querySelector('.ig-dl-btn')) return;

        if (wrapper.offsetWidth > 150 && wrapper.offsetHeight > 150) {
            const style = window.getComputedStyle(wrapper);
            if (style.position === 'static') wrapper.style.position = 'relative';

            addDownloadButton(wrapper, article);
        }
    });
}

// ============================================================
// 4. Profile grid (hover overlay with download arrow)
// ============================================================
function injectGridButtons() {
    initGridSelectUI();
    const gridLinks = document.querySelectorAll(SELECTORS.links);
    let hasGridItems = false;

    gridLinks.forEach(link => {
        // Must contain visual content (img, video, canvas, div)
        if (!link.querySelector('img, video, canvas, div')) return;

        // Must be a visible thumbnail (not a tiny link or avatar)
        const rect = link.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 80) return;
        if (!link.parentElement) return;

        hasGridItems = true;

        if (link.dataset.megahubGrid) return;

        link.style.position = 'relative';
        link.classList.add('megahub-grid-wrapper');

        // Create hover overlay
        const overlay = document.createElement('div');
        overlay.className = 'megahub-grid-overlay';

        // Download arrow button
        const dlBtn = document.createElement('button');
        dlBtn.className = 'megahub-grid-dl-btn';
        dlBtn.appendChild(SVG_TEMPLATES.downloadSmall.content.cloneNode(true));
        dlBtn.title = 'Download';

        // Extract shortcode from link
        const match = link.href.match(REGEX.shortcode);
        const shortcode = match ? match[2] : null;

        // Get username from page URL
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        const pageUsername = (pathParts.length > 0 && !['p', 'reel', 'explore', 'reels'].includes(pathParts[0]))
            ? pathParts[0]
            : 'instagram_user';

        dlBtn.dataset.shortcode = shortcode || '';
        dlBtn.dataset.username = pageUsername;

        overlay.appendChild(dlBtn);
        link.appendChild(overlay);
        link.dataset.megahubGrid = 'true';
    });

    const fabBtn = document.getElementById('megahub-fab-btn');
    if (fabBtn && !isGridSelectMode) {
        if (hasGridItems) fabBtn.classList.remove('hidden');
        else fabBtn.classList.add('hidden');
    }
}

// ============================================================
// 6. HD Profile Picture Downloader
// ============================================================
function injectAvatarButton() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length !== 1 || ['explore', 'reels', 'direct', 'stories'].includes(pathParts[0])) return;

    const username = pathParts[0];
    const header = document.querySelector('header');
    if (!header) return;

    // Look for the large avatar image in the header
    const avatarImg = header.querySelector('img[alt*="profile picture"], img[alt*="صورة ملف شخصي"]');
    if (!avatarImg || avatarImg.dataset.megahubAvatar) return;

    // Get the clickable wrapper
    const wrapper = avatarImg.closest('div[role="button"], span[role="link"]') || avatarImg.parentElement;
    if (wrapper.dataset.megahubAvatarWrapper) return;

    wrapper.style.position = 'relative';
    wrapper.dataset.megahubAvatarWrapper = 'true';

    const overlay = document.createElement('div');
    overlay.className = 'megahub-avatar-overlay';

    const dlBtn = document.createElement('button');
    dlBtn.className = 'megahub-avatar-dl-btn';
    dlBtn.appendChild(SVG_TEMPLATES.downloadSmall.content.cloneNode(true));
    dlBtn.title = 'Download HD Avatar';

    dlBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dlBtn.classList.add('loading');

        const avatarData = await requestAvatarData(username);
        let success = false;

        if (avatarData?.success && avatarData.imageUrl) {
            success = await downloadViaBlob(avatarData.imageUrl, username, 'image', { takenAt: 'HD_Avatar' });
        } else {
            // Fallback to the visible image format
            success = await downloadViaBlob(avatarImg.src, username, 'image', { takenAt: 'Avatar' });
        }

        dlBtn.classList.remove('loading');
        if (success) {
            dlBtn.classList.add('success');
            dlBtn.innerHTML = '';
            dlBtn.appendChild(SVG_TEMPLATES.doneSmall.content.cloneNode(true));
            setTimeout(() => {
                if (dlBtn.isConnected) {
                    dlBtn.classList.remove('success');
                    dlBtn.innerHTML = '';
                    dlBtn.appendChild(SVG_TEMPLATES.downloadSmall.content.cloneNode(true));
                }
            }, 2000);
        }
    });

    overlay.appendChild(dlBtn);
    wrapper.appendChild(overlay);
    avatarImg.dataset.megahubAvatar = 'true';
}

// ============================================================
// Grid Multi-Select State & UI
// ============================================================
let isGridSelectMode = false;
const selectedGridItems = new Set();

function initGridSelectUI() {
    if (document.getElementById('megahub-fab-container')) return;

    const container = document.createElement('div');
    container.id = 'megahub-fab-container';
    container.innerHTML = `
        <button id="megahub-fab-btn" class="megahub-fab-btn hidden">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
            Batch Select
        </button>
        <div id="megahub-select-toolbar" class="hidden">
            <span id="megahub-select-count">0 Selected</span>
            <button class="megahub-toolbar-dl" id="megahub-toolbar-dl">Download</button>
            <button class="megahub-toolbar-cancel" id="megahub-toolbar-cancel">Cancel</button>
        </div>
    `;
    document.body.appendChild(container);

    const fabBtn = document.getElementById('megahub-fab-btn');
    const toolbar = document.getElementById('megahub-select-toolbar');
    const dlBtn = document.getElementById('megahub-toolbar-dl');
    const cancelBtn = document.getElementById('megahub-toolbar-cancel');

    fabBtn.addEventListener('click', () => {
        isGridSelectMode = true;
        document.body.classList.add('megahub-select-mode');
        fabBtn.classList.add('hidden');
        toolbar.classList.remove('hidden');
        updateGridSelectCount();
    });

    cancelBtn.addEventListener('click', exitGridSelectMode);

    dlBtn.addEventListener('click', async () => {
        if (selectedGridItems.size === 0) return;
        dlBtn.textContent = 'Queueing...';
        dlBtn.style.opacity = '0.7';
        dlBtn.style.pointerEvents = 'none';

        const items = Array.from(selectedGridItems);
        for (const shortcode of items) {
            const btn = document.querySelector(`.megahub-grid-dl-btn[data-shortcode="${shortcode}"]`);
            const username = btn ? btn.dataset.username : 'instagram_user';

            const postData = await requestPostData(shortcode);
            await handlePostDataDownload(postData, username);
        }

        exitGridSelectMode();
        dlBtn.textContent = 'Download';
        dlBtn.style.opacity = '1';
        dlBtn.style.pointerEvents = 'auto';
    });
}

function exitGridSelectMode() {
    isGridSelectMode = false;
    document.body.classList.remove('megahub-select-mode');
    document.getElementById('megahub-select-toolbar').classList.add('hidden');
    document.getElementById('megahub-fab-btn').classList.remove('hidden'); // It will be properly hidden on next DOM observe if no grid items

    document.querySelectorAll('.megahub-grid-wrapper.megahub-selected').forEach(el => {
        el.classList.remove('megahub-selected');
    });
    selectedGridItems.clear();
}

function updateGridSelectCount() {
    const countEl = document.getElementById('megahub-select-count');
    if (countEl) countEl.textContent = `${selectedGridItems.size} Selected`;
}

function toggleGridSelection(wrapper) {
    const btn = wrapper.querySelector('.megahub-grid-dl-btn');
    if (!btn) return;
    const shortcode = btn.dataset.shortcode;
    if (!shortcode) return;

    if (selectedGridItems.has(shortcode)) {
        selectedGridItems.delete(shortcode);
        wrapper.classList.remove('megahub-selected');
    } else {
        selectedGridItems.add(shortcode);
        wrapper.classList.add('megahub-selected');
    }
    updateGridSelectCount();
}

// ============================================================
// High Performance UI Sync Observer
// ============================================================
let _rafId = null;
const observer = new MutationObserver(() => {
    // Stop if extension context was invalidated (e.g. after reload)
    if (!chrome.runtime?.id) {
        observer.disconnect();
        return;
    }

    // Use requestAnimationFrame for hardware-synced DOM updates instead of generic timeouts
    clearTimeout(window._megahubTimeout);
    window._megahubTimeout = setTimeout(() => {
        cancelAnimationFrame(_rafId);
        _rafId = requestAnimationFrame(() => {
            injectButtons().catch(() => { });
        });
    }, 400); // Wait 400ms after DOM settles to inject
});

// Run strictly on subtree changes
observer.observe(document.body, { childList: true, subtree: true });

// Initial kicks
requestAnimationFrame(() => injectButtons().catch(() => { }));
setTimeout(() => requestAnimationFrame(() => injectButtons().catch(() => { })), 2000);

// ============================================================
// Event Delegation: One listener to rule them all (Eliminates memory leaks)
// ============================================================
async function handlePostDataDownload(postData, defaultUsername, targetIndex = 0) {
    if (!postData?.success) return false;

    const meta = {
        mediaPk: postData.mediaPk || '',
        takenAt: postData.takenAt || '',
        userPk: postData.userPk || '',
        realUsername: postData.username || ''
    };

    const targetUser = meta.realUsername || defaultUsername;
    const { downloadCarouselAll } = await chrome.storage.sync.get({ downloadCarouselAll: true });

    if (downloadCarouselAll && postData.allMedia && postData.allMedia.length > 1) {
        let queuedCount = 0;
        postData.allMedia.forEach((mediaItem, index) => {
            if (mediaItem.url) {
                const itemMeta = { ...meta, mediaIndex: index + 1, childPk: mediaItem.childPk || '' };
                // Enqueue instantly to hit the QueueManager pool
                downloadViaBlob(mediaItem.url, targetUser, mediaItem.type, itemMeta);
                queuedCount++;
            }
        });
        return queuedCount > 0;
    } else {
        // Find the specific slide index if provided (solves the first-image carousel loop bug)
        // Check >= 0 because targetIndex could be 0 for the very first slide of a carousel
        if (targetIndex >= 0 && postData.allMedia && postData.allMedia.length > targetIndex) {
            const item = postData.allMedia[targetIndex];
            if (item.url) return await downloadViaBlob(item.url, targetUser, item.type, { ...meta, mediaIndex: targetIndex + 1, childPk: item.childPk || '' });
        }

        const url = postData.videoUrl || postData.imageUrl;
        const type = postData.videoUrl ? 'video' : 'image';
        if (url) {
            return await downloadViaBlob(url, targetUser, type, meta);
        }
    }
    return false;
}

document.body.addEventListener('click', async (e) => {
    // 0. Grid Selection Mode Intercept
    if (isGridSelectMode) {
        const gridWrapper = e.target.closest('.megahub-grid-wrapper');
        const isClickingInsideToolbar = e.target.closest('#megahub-fab-container');
        if (gridWrapper) {
            e.preventDefault();
            e.stopPropagation();
            toggleGridSelection(gridWrapper);
            return;
        } else if (!isClickingInsideToolbar) {
            // Optional UX: click outside grid while selecting? Ignore.
        }
    }

    // Traverse up to find if a MegaHub button was clicked
    let btn = e.target.closest(SELECTORS.buttons);
    if (!btn || btn.classList.contains('loading')) return;

    e.preventDefault();
    e.stopPropagation();
    btn.classList.add('loading');

    // 1. Grid Button Handling
    if (btn.classList.contains('megahub-grid-dl-btn')) {
        const shortcode = btn.dataset.shortcode;
        const username = btn.dataset.username || 'instagram_user';
        let success = false;

        if (shortcode) {
            const postData = await requestPostData(shortcode);
            success = await handlePostDataDownload(postData, username);

            if (!success) {
                const apiUrl = await fetchFromPublicApi(shortcode);
                if (apiUrl) {
                    const isVideo = apiUrl.includes('.mp4') || apiUrl.includes('video');
                    success = await downloadViaBlob(apiUrl, username, isVideo ? 'video' : 'image', {});
                }
            }
        }

        btn.classList.remove('loading');
        if (success) {
            btn.classList.add('success');
            btn.innerHTML = '';
            btn.appendChild(SVG_TEMPLATES.doneSmall.content.cloneNode(true));
            setTimeout(() => {
                btn.classList.remove('success');
                btn.innerHTML = '';
                btn.appendChild(SVG_TEMPLATES.downloadSmall.content.cloneNode(true));
            }, 2000);
        }
        return;
    }

    // 2. Sidebar/Inline/Overlay Feed/Reel Button Handling
    const container = btn.closest('article') || btn.closest('div[data-pressable-container="true"]') || btn.closest('section') || btn.closest('div[style]');
    const isSingleTextBtn = btn.classList.contains('single-dl');
    let success = false;
    let visibleMedia = null;

    if (isSingleTextBtn) {
        btn.innerHTML = 'Fetching...';
    }

    if (container) {
        // Find username context
        let username = 'instagram_user';
        if (container.tagName === 'ARTICLE') {
            username = getUsername(container);
        } else {
            const userLink = container.querySelector('a[href^="/"]:not([href*="/explore"])');
            if (userLink) {
                const uMatch = userLink.href.match(/instagram\.com\/([^/?]+)/);
                if (uMatch && !['reels', 'reel', 'p', 'explore', 'accounts'].includes(uMatch[1])) {
                    username = uMatch[1];
                } else if (userLink.textContent) {
                    username = userLink.textContent.trim();
                }
            }
        }

        // Detect shortcode or Video strategy
        const mediaSection = container.tagName === 'ARTICLE' ? findMediaSection(container) : container;
        const currentUrlMatch = window.location.pathname.match(REGEX.shortcode);
        const shortcode = currentUrlMatch ? currentUrlMatch[2] : getShortcode(container);

        const directUrl = mediaSection ? getDirectVideoUrl(mediaSection) : null;

        // Check user settings for Auto-Download Carousel
        const { downloadCarouselAll } = await chrome.storage.sync.get({ downloadCarouselAll: true });

        // 1. Direct Video Injection
        if (directUrl) {
            success = await downloadViaBlob(directUrl, username, 'video', {});
        }
        // 2. If it's a Carousel and "Download All" is enabled, use the API
        else if (shortcode && downloadCarouselAll) {
            const postData = await requestPostData(shortcode);
            // Check if it's actually a carousel, otherwise fall through
            if (postData && postData.allMedia && postData.allMedia.length > 1) {
                success = await handlePostDataDownload(postData, username);
            } else {
                // Not a carousel or empty, prioritize geometric scan below
                success = false;
            }
        }

        // 3. Structural & Geometric Viewport Scan (Single Download Priority)
        if (!success && mediaSection) {

            // Strategy 3: Target visually active Media by Geometric Proximity
            // We only care about finding the local DOM element so we can extract its visual properties.
            // DO NOT try to calculate absolute indices from `li` elements, as React dynamically unloads them from the DOM!
            const allUls = Array.from(container.querySelectorAll('ul'));
            const carouselUl = allUls.find(ul => ul.querySelector('li img[srcset], li img[style*="object-fit"], li video'));
            if (carouselUl) {
                const lis = Array.from(carouselUl.querySelectorAll('li'));
                if (lis.length > 0) {
                    // Find the exact physical clipping mask enclosing the carousel
                    let viewportNode = carouselUl.parentElement;
                    while (viewportNode && viewportNode !== document.body) {
                        const style = window.getComputedStyle(viewportNode);
                        if (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowX === 'clip' || style.overflowX === 'auto') {
                            break;
                        }
                        viewportNode = viewportNode.parentElement;
                    }
                    if (!viewportNode) viewportNode = carouselUl.parentElement;

                    const viewportRect = viewportNode.getBoundingClientRect();
                    const viewportLeft = viewportRect.left;
                    const viewportRight = viewportRect.right;

                    let maxIntersection = 0;
                    let activeLi = null;

                    lis.forEach((li) => {
                        if (!li.querySelector('img[srcset], img[style*="object-fit"], video')) return;

                        const liRect = li.getBoundingClientRect();
                        if (liRect.width === 0 || liRect.height === 0) return;

                        // Calculate exact pixel intersection with the clipping viewport
                        const intersectLeft = Math.max(viewportLeft, liRect.left);
                        const intersectRight = Math.min(viewportRight, liRect.right);
                        const intersectWidth = Math.max(0, intersectRight - intersectLeft);

                        if (intersectWidth > maxIntersection) {
                            maxIntersection = intersectWidth;
                            activeLi = li;
                        }
                    });

                    if (activeLi) {
                        visibleMedia = activeLi.querySelector('video, img[srcset], img[style*="object-fit"]');
                    }
                }
            }

            // Fallback for non-carousels (single image/video post)
            if (!visibleMedia) {
                const allMedia = Array.from(container.querySelectorAll('img[srcset], img[style*="object-fit"], video'));
                for (const mediaEl of allMedia) {
                    if (mediaEl.alt && (mediaEl.alt.includes('profile') || mediaEl.alt.includes('صورة'))) continue;
                    visibleMedia = mediaEl;
                    break;
                }
            }

            if (visibleMedia) {
                if (visibleMedia.tagName.toLowerCase() === 'video') {
                    const vidUrl = visibleMedia.src || visibleMedia.currentSrc || getDirectVideoUrl(visibleMedia.parentElement);
                    if (vidUrl) success = await downloadViaBlob(vidUrl, username, 'video', {});
                } else {
                    const imgUrl = getBestImageUrl(visibleMedia);
                    if (imgUrl) success = await downloadViaBlob(imgUrl, username, 'image', {});
                }
            }
        }

        // 4. API Fallback (If geometric/Blob fails and it's a single post)
        if (!success && shortcode) {
            const postData = await requestPostData(shortcode);
            let targetIndex = 0;
            let foundAbsolute = false;

            // SYNC INDEX METHOD A: Media Visual Fingerprinting
            // The local DOM image element's URL contains a unique ID hash. 
            // We extract it and find the matching hash in the API's media array.
            if (visibleMedia && postData && postData.allMedia) {
                const rawSrc = visibleMedia.currentSrc || visibleMedia.src || (visibleMedia.srcset ? visibleMedia.srcset.split(' ')[0] : '');
                if (rawSrc && !rawSrc.startsWith('blob:')) {
                    const hashExtractor = /\/([^\/\?]+)\.(webp|jpg|jpeg|heic|mp4)/i.exec(rawSrc);
                    const localBase = hashExtractor ? hashExtractor[1] : null;

                    if (localBase) {
                        for (let i = 0; i < postData.allMedia.length; i++) {
                            const apiMedia = postData.allMedia[i];
                            const apiUrl = apiMedia.videoUrl || apiMedia.imageUrl || apiMedia.url || '';
                            if (apiUrl.includes(localBase)) {
                                targetIndex = i;
                                foundAbsolute = true;
                                break;
                            }
                        }
                    }
                }
            }

            // SYNC INDEX METHOD B: Pagination Dots Fallback (crucial for Blob videos)
            // If it's a video block without a raw hashed URL, we visually count the Pagination Dots UI at the bottom of the post.
            if (!foundAbsolute && container && postData && postData.allMedia && postData.allMedia.length > 1) {
                const expectedLength = postData.allMedia.length;
                const dotContainers = Array.from(container.querySelectorAll('div')).filter(div => {
                    return div.childElementCount === expectedLength &&
                        Array.from(div.children).every(c => c.clientWidth > 0 && c.clientWidth < 35 && c.clientHeight < 35);
                });

                if (dotContainers.length > 0) {
                    const dots = Array.from(dotContainers[dotContainers.length - 1].children);
                    const classCounts = {};
                    dots.forEach(d => classCounts[d.className] = (classCounts[d.className] || 0) + 1);
                    const activeDot = dots.find(d => classCounts[d.className] === 1);
                    if (activeDot) {
                        const dotIndex = dots.indexOf(activeDot);
                        if (dotIndex !== -1) targetIndex = dotIndex;
                    }
                }
            }

            // Execute the heavily optimized download with the verified global index!
            success = await handlePostDataDownload(postData, username, targetIndex);

            if (!success) {
                const apiUrl = await fetchFromPublicApi(shortcode);
                if (apiUrl) {
                    const isVideo = apiUrl.includes('.mp4') || apiUrl.includes('video');
                    success = await downloadViaBlob(apiUrl, username, isVideo ? 'video' : 'image', {});
                }
            }
        }
    }

    btn.classList.remove('loading');

    // UI Feedback Reversion
    if (isSingleTextBtn) {
        btn.innerHTML = '';
        if (success) {
            btn.appendChild(SVG_TEMPLATES.doneSmall.content.cloneNode(true));
            btn.append(' Done!');
        } else {
            btn.innerHTML = '✕ Failed';
        }
        setTimeout(() => {
            if (!btn.isConnected) return; // Prevent detached DOM writes
            btn.innerHTML = '';
            btn.appendChild(SVG_TEMPLATES.downloadText.content.cloneNode(true));
        }, 2500);
    } else {
        if (success) {
            btn.classList.add('success');
            setTimeout(() => btn.isConnected && btn.classList.remove('success'), 2000);
        }
    }
});
