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

// Global states
let _currentButtonStyle = 'inline';
let _videoControlsEnabled = false;
let _gpuAccelerationEnabled = false;
let _videoControlsGradientHeight = 75;
let _videoControlsPersistent = false;

// ============================================================
// Main Entry: Inject download buttons on all supported pages
// ============================================================
async function injectButtons() {
    let settings = { buttonStyle: 'inline', videoControlsEnabled: false, gpuAccelerationEnabled: false, videoControlsGradientHeight: 75, videoControlsPersistent: false };
    try {
        settings = await chrome.storage.sync.get(settings);
    } catch (e) {
        // Extension context invalidated (e.g. after reload) — use defaults
    }

    _currentButtonStyle = settings.buttonStyle;
    _videoControlsEnabled = settings.videoControlsEnabled;
    _gpuAccelerationEnabled = settings.gpuAccelerationEnabled;
    _videoControlsGradientHeight = settings.videoControlsGradientHeight;
    _videoControlsPersistent = settings.videoControlsPersistent;

    // Call all — each function checks _currentButtonStyle and skips if not its mode
    injectFeedButtons();
    injectFeedInlineButtons();
    injectSinglePostButtons();
    injectReelsButtons();
    injectReelsSidebarButton();
    injectGridButtons();
    injectAvatarButton();

    // Inject custom video controls if enabled
    document.documentElement.classList.toggle('megahub-video-controls-disabled', !_videoControlsEnabled);
    if (_videoControlsEnabled) {
        injectVideoControls();
    }

    // Toggle GPU global sharpness enforcement on the root document
    document.documentElement.classList.toggle('mh-gpu-acceleration', _gpuAccelerationEnabled);

    // Toggle persistent video controls global class
    document.documentElement.classList.toggle('mh-persistent-controls', _videoControlsPersistent);
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'toggleVideoControls') {
        _videoControlsEnabled = request.enabled;
        document.documentElement.classList.toggle('megahub-video-controls-disabled', !_videoControlsEnabled);
        if (_videoControlsEnabled) injectVideoControls();
    } else if (request.action === 'toggleGpuAcceleration') {
        _gpuAccelerationEnabled = request.enabled;
        document.documentElement.classList.toggle('mh-gpu-acceleration', _gpuAccelerationEnabled);
    } else if (request.action === 'updateGradientHeight') {
        _videoControlsGradientHeight = request.height;
        document.querySelectorAll('.megahub-vc-gradient').forEach(el => {
            el.style.height = `${_videoControlsGradientHeight}px`;
        });
    } else if (request.action === 'togglePersistentControls') {
        _videoControlsPersistent = request.enabled;
        document.documentElement.classList.toggle('mh-persistent-controls', _videoControlsPersistent);
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

// ============================================================
// Custom Video Controls Engine
// ============================================================
let _videoControlsObserver = null;

function injectVideoControls() {
    if (_videoControlsObserver) return; // Already observing

    function setupVideo(video) {
        if (video.dataset.megahubControls) return;
        video.dataset.megahubControls = 'true';

        // Wait for the video to have a proper parent
        const container = video.parentElement;
        if (!container) return;

        // Find the root article or main container for CSS scoping
        let root = video.closest('article');
        if (!root) {
            let curr = video.parentElement;
            while (curr && curr !== document.body) {
                // Pinpoint the localized wrapper by checking for any standard sibling Native Control SVG
                if (curr.querySelector('svg[aria-label*="Like" i], svg[aria-label*="udio" i], svg[aria-label*="Share" i], svg[aria-label*="Comment" i]')) {
                    root = curr;
                    break;
                }
                curr = curr.parentElement;
            }
        }
        root = root || document.body;
        root.classList.add('megahub-video-root');

        // Ensure container is positioned so our absolute overlay targets it
        if (window.getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        // --- Build UI ---
        const controlsWrap = document.createElement('div');
        controlsWrap.className = 'megahub-video-controls';

        // Gradient background
        const gradient = document.createElement('div');
        gradient.className = 'megahub-vc-gradient';
        gradient.style.height = `${_videoControlsGradientHeight}px`;

        // Play/Pause Button
        const playBtn = document.createElement('button');
        playBtn.className = 'megahub-vc-btn megahub-vc-play';
        playBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;

        // Time indicator
        const timeInd = document.createElement('div');
        timeInd.className = 'megahub-vc-time';
        timeInd.innerText = '0:00 / 0:00';

        // Progress bar
        const progressWrap = document.createElement('div');
        progressWrap.className = 'megahub-vc-progress-wrap';
        const progressBar = document.createElement('div');
        progressBar.className = 'megahub-vc-progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'megahub-vc-progress-fill';
        progressBar.appendChild(progressFill);
        progressWrap.appendChild(progressBar);

        // Volume/Mute Button (Custom sleek SVG, positioned right after play)
        const muteBtn = document.createElement('button');
        muteBtn.className = 'megahub-vc-btn megahub-vc-mute';
        muteBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;

        // Fullscreen Button
        const fsBtn = document.createElement('button');
        fsBtn.className = 'megahub-vc-btn megahub-vc-fs';
        fsBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`;

        // Speed Control Group (Arrows + Dropdown Menu)
        const speedGroup = document.createElement('div');
        speedGroup.className = 'megahub-vc-speed-group';

        const speedDown = document.createElement('button');
        speedDown.className = 'megahub-vc-speed-nav';
        speedDown.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>`;

        // The circular button that shows current speed and toggles the menu
        const speedValBtn = document.createElement('button');
        speedValBtn.className = 'megahub-vc-speed-val-btn';
        speedValBtn.innerText = '1x';

        const speedUp = document.createElement('button');
        speedUp.className = 'megahub-vc-speed-nav';
        speedUp.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

        // The Dropdown Menu
        const speedMenu = document.createElement('div');
        speedMenu.className = 'megahub-vc-speed-menu';
        const speedsList = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
        speedsList.forEach(s => {
            const item = document.createElement('div');
            item.className = 'megahub-vc-speed-item';
            item.innerText = s + 'x';
            item.dataset.speed = s;
            speedMenu.appendChild(item);
        });

        speedGroup.append(speedDown, speedValBtn, speedMenu, speedUp);

        // Snapshot Button
        const snapBtn = document.createElement('button');
        snapBtn.className = 'megahub-vc-btn megahub-vc-snap';
        snapBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`;

        const row = document.createElement('div');
        row.className = 'megahub-vc-row';
        row.append(playBtn, timeInd, progressWrap, speedGroup, snapBtn, fsBtn, muteBtn);

        controlsWrap.append(gradient, row);
        container.appendChild(controlsWrap);

        // --- Global Mute State Sync ---
        // Instead of fighting IG's React state with localStorage, we will proxy clicks
        // directly to IG's native hidden audio button. This guarantees seamless native persistence.

        // Keep UI in sync with actual volume changes
        video.addEventListener('volumechange', updateUI);

        // --- Persistent Proxy Tag ---
        // Instagram native UI hides the tag icon when not hovered.
        // To keep it persistent globally, this proxy is attached to the video container.
        const proxyTag = document.createElement('button');
        proxyTag.className = 'megahub-proxy-tag';
        proxyTag.style.display = 'none'; // hidden by default until native is found
        proxyTag.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
        container.appendChild(proxyTag);

        let nativeTagNode = null;
        let nativeAudioNode = null;

        const getExactButtonWrapper = (svgNode) => {
            if (!svgNode) return null;
            let curr = svgNode.parentElement;
            let depth = 0;
            let bgNode = null;

            // Walk up to 4 levels looking for an opaque background color (the grey circle)
            while (curr && curr !== root && depth < 4) {
                const style = window.getComputedStyle(curr);
                if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
                    // Safety check to avoid hiding large overlay containers
                    const rect = curr.getBoundingClientRect();
                    if (rect.width > 0 && rect.width < 100 && rect.height > 0 && rect.height < 100) {
                        bgNode = curr;
                        break;
                    }
                }
                curr = curr.parentElement;
                depth++;
            }

            if (bgNode) return bgNode;

            // Fallback to semantic tags if no standalone background container is found
            return svgNode.closest('a, button, div[role="button"], div[role="link"]') || svgNode.parentElement;
        };

        let hasFoundTagNode = false;
        let hasFoundAudioNode = false;
        let nativeBottomOverlay = null;
        const isReelsContext = !video.closest('article'); // Reels videos are NOT inside <article>

        // --- Reels: Toggle controls-active on hover for content shift ---
        if (isReelsContext) {
            container.addEventListener('mouseenter', () => {
                root.classList.add('megahub-controls-active');
            });
            container.addEventListener('mouseleave', () => {
                if (!_videoControlsPersistent) {
                    root.classList.remove('megahub-controls-active');
                }
            });
            if (_videoControlsPersistent) {
                root.classList.add('megahub-controls-active');
            }
        }

        const checkNativeNodes = () => {
            const isDisabled = document.documentElement.classList.contains('megahub-video-controls-disabled');

            // --- Tag Proxy Node ---
            if (!hasFoundTagNode) {
                const allTagSvgs = root.querySelectorAll('svg[aria-label*="Tag" i], svg[aria-label*="tag" i], svg[aria-label*="person" i]');
                let targetTagSvg = null;
                for (let s of allTagSvgs) {
                    // Safe-guard: Reject any icon embedded in an anchor link (e.g. Profile Pictures)
                    if (!s.closest('.megahub-proxy-tag') && !s.closest('.megahub-video-controls') && !s.closest('a')) {
                        targetTagSvg = s; break;
                    }
                }
                if (targetTagSvg) {
                    nativeTagNode = getExactButtonWrapper(targetTagSvg);
                    if (nativeTagNode) hasFoundTagNode = true;
                }
            }

            if (!isDisabled && nativeTagNode) {
                proxyTag.style.display = 'flex';
                // Restored hiding logic per user request (Safely guarded by !closest('a'))
                nativeTagNode.classList.add('megahub-hidden-native');
            } else {
                proxyTag.style.display = 'none';
                if (nativeTagNode) nativeTagNode.classList.remove('megahub-hidden-native');
            }

            // --- Audio Proxy Node ---
            if (!hasFoundAudioNode) {
                const allAudioSvgs = root.querySelectorAll('svg[aria-label*="udio" i], svg[aria-label*="Audio" i], svg[aria-label*="Muted" i], svg[aria-label*="muted" i], svg[aria-label*="صوت" i]');
                let targetAudioSvg = null;
                for (let s of allAudioSvgs) {
                    // Ignore elements structurally wrapped in anchor links (e.g., Profile picture embedded audio icons)
                    if (!s.closest('.megahub-video-controls') && !s.closest('a')) {
                        targetAudioSvg = s; break;
                    }
                }
                if (targetAudioSvg) {
                    // Find strictly the precise wrapper that acts as the grey circle, ignoring huge wrappers
                    nativeAudioNode = getExactButtonWrapper(targetAudioSvg);
                    if (nativeAudioNode) hasFoundAudioNode = true;

                    // --- Reels: Find the bottom overlay container by walking up from the audio SVG ---
                    if (isReelsContext && !nativeBottomOverlay) {
                        const containerRect = container.getBoundingClientRect();
                        let el = targetAudioSvg.parentElement;
                        for (let i = 0; i < 12 && el && el !== root && el !== document.body; i++) {
                            const rect = el.getBoundingClientRect();
                            // The bottom overlay should span at least 50% of the video width
                            // and be positioned near the bottom of the container
                            if (rect.width > containerRect.width * 0.5 &&
                                rect.bottom > containerRect.bottom - 30 &&
                                rect.height > 40 && rect.height < containerRect.height * 0.6) {
                                nativeBottomOverlay = el;
                                el.classList.add('megahub-native-bottom-overlay');
                                break;
                            }
                            el = el.parentElement;
                        }
                    }
                }
            }

            if (!isDisabled && nativeAudioNode) {
                nativeAudioNode.classList.add('megahub-hidden-native');
            } else if (nativeAudioNode) {
                nativeAudioNode.classList.remove('megahub-hidden-native');
            }
        };

        const checkInterval = setInterval(() => {
            if (!video.isConnected) {
                clearInterval(checkInterval); // cleanup
                return;
            }
            // CRITICAL CPU LIMITER: Only run heavy DOM queries if the video is actively engaged
            if (video.paused && !video.classList.contains('mh-gpu-active')) return;

            checkNativeNodes();
        }, 200);

        proxyTag.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (nativeTagNode) {
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                nativeTagNode.dispatchEvent(clickEvent);
            }
        };

        // --- Logic & Event Listeners ---
        function formatTime(sec) {
            if (isNaN(sec)) return '0:00';
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        }

        let _lastPausedState = null;
        let _lastMutedState = null;
        let _lastFsState = null;

        function updateUI() {
            // Dynamic GPU Layer Management: Only forcing active playing video to save VRAM
            if (video.paused || video.ended) {
                video.classList.remove('mh-gpu-active');
            } else {
                video.classList.add('mh-gpu-active');
            }

            // Update Play/Pause SVG (Cached to prevent DOM parsing overhead 4x a second)
            if (video.paused !== _lastPausedState) {
                _lastPausedState = video.paused;
                if (video.paused) {
                    playBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                } else {
                    playBtn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
                }
            }

            // Update Mute SVG (Custom Sleek SVG)
            const currentMuted = (video.muted || video.volume === 0);
            if (currentMuted !== _lastMutedState) {
                _lastMutedState = currentMuted;
                if (currentMuted) {
                    muteBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
                } else {
                    muteBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
                }
            }

            // Update Fullscreen SVG Toggle
            const currentFs = !!document.fullscreenElement;
            if (currentFs !== _lastFsState) {
                _lastFsState = currentFs;
                if (currentFs) {
                    fsBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>`;
                } else {
                    fsBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`;
                }
            }

            // Update time & progress
            const cur = video.currentTime || 0;
            const dur = video.duration || 1; // avoid /0
            timeInd.innerText = `${formatTime(cur)} / ${formatTime(dur)}`;
            progressFill.style.width = `${(cur / dur) * 100}%`;

            // Sync speed display in case it changed externally
            speedValBtn.innerText = video.playbackRate + 'x';

            // Highlight active menu item
            Array.from(speedMenu.children).forEach(child => {
                child.classList.toggle('active', parseFloat(child.dataset.speed) === video.playbackRate);
            });
        }

        // Listeners on Video
        video.addEventListener('play', updateUI);
        video.addEventListener('pause', updateUI);
        video.addEventListener('timeupdate', updateUI);
        video.addEventListener('durationchange', updateUI);
        video.addEventListener('volumechange', updateUI);

        const fsChangeHandler = () => {
            if (!video.isConnected) {
                document.removeEventListener('fullscreenchange', fsChangeHandler);
                return;
            }
            updateUI();
        };
        document.addEventListener('fullscreenchange', fsChangeHandler);

        // Listeners on Controls (stop propagation so IG doesn't catch them)
        // Use pointerdown instead of click for instant responsiveness without waiting for hover
        playBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (video.paused) video.play(); else video.pause();
        });

        muteBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();

            // If we found Instagram's exact native audio wrapper, dispatch a real click event
            // React synthesizes events, sometimes primitive .click() fails on divs, but MouseEvent always bubbles nicely
            if (nativeAudioNode) {
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                nativeAudioNode.dispatchEvent(clickEvent);
            } else {
                // Fallback in case IG structure changes radically
                const newState = !video.muted;
                video.muted = newState;
                setTimeout(() => { video.muted = newState; }, 10);
            }
        });

        fsBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                container.requestFullscreen();
            }
        });

        function updateSpeed(deltaOrVal, isDelta = true) {
            let nextVal;
            if (isDelta) {
                let cur = video.playbackRate;
                let idx = speedsList.indexOf(cur);
                if (idx === -1) idx = 3; // default to 1x
                idx += deltaOrVal;
                idx = Math.max(0, Math.min(speedsList.length - 1, idx)); // clamp
                nextVal = speedsList[idx];
            } else {
                nextVal = deltaOrVal;
            }
            video.playbackRate = nextVal;
            speedValBtn.innerText = nextVal + 'x';
            updateUI();
        }

        speedDown.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            updateSpeed(-1, true);
        });

        speedUp.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            updateSpeed(1, true);
        });

        // Toggle the speed menu
        speedValBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            speedMenu.classList.toggle('megahub-vc-speed-menu-open');
        });

        // Handle menu item clicks
        speedMenu.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.target.classList.contains('megahub-vc-speed-item')) {
                updateSpeed(parseFloat(e.target.dataset.speed), false);
                speedMenu.classList.remove('megahub-vc-speed-menu-open');
            }
        });

        // Close menu if user clicks anywhere else
        document.addEventListener('pointerdown', (e) => {
            if (!speedGroup.contains(e.target)) {
                speedMenu.classList.remove('megahub-vc-speed-menu-open');
            }
        });

        snapBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d').drawImage(video, 0, 0);
                canvas.toBlob(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `MegaHub_Snapshot_${Date.now()}.png`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }, 'image/png');

                // Visual feedback
                snapBtn.style.opacity = '0.5';
                setTimeout(() => snapBtn.style.opacity = '', 200);
            } catch (err) {
                console.error("Mega Hub: Snapshot failed", err);
            }
        });

        // Timeline Scrubbing
        let isDragging = false;
        function setProgress(e) {
            const rect = progressBar.getBoundingClientRect();
            let pos = (e.clientX - rect.left) / rect.width;
            pos = Math.max(0, Math.min(1, pos));
            if (video.duration) video.currentTime = pos * video.duration;
        }

        progressWrap.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            isDragging = true;
            setProgress(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) setProgress(e);
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Click on the controls area itself should toggle play/pause exactly like IG does
        controlsWrap.addEventListener('click', (e) => {
            // Only if they clicked the background, not the buttons row
            if (e.target === controlsWrap) {
                e.stopPropagation(); // Stop IG's overlay from intercepting
                if (video.paused) video.play();
                else video.pause();
            }
        });

        // Initial setup
        updateUI();
    }

    // Run on existing
    document.querySelectorAll('video').forEach(setupVideo);

    // Watch for new videos (Debounced to prevent CPU screaming on continuous scroll environments like Reels)
    let _vcDebounce = null;
    _videoControlsObserver = new MutationObserver(mutations => {
        let shouldCheck = false;
        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                shouldCheck = true;
                break;
            }
        }
        if (shouldCheck) {
            if (_vcDebounce) return;
            _vcDebounce = setTimeout(() => {
                document.querySelectorAll('video:not([data-megahub-controls])').forEach(setupVideo);
                _vcDebounce = null;
            }, 500);
        }
    });

    _videoControlsObserver.observe(document.body, { childList: true, subtree: true });
}

// Global URL State Tracker
setInterval(() => {
    document.documentElement.classList.toggle('mh-is-reels', window.location.pathname.includes('/reels/'));
}, 1000);
