/**
 * Mega Hub — MAIN World Inject Script
 * Runs in the page's MAIN world (not isolated) to access Instagram's internal APIs and cookies.
 *
 * Responsibilities:
 * 1. Intercept fetch/XHR responses to capture media URLs from Instagram's API
 * 2. Cache media metadata (video URL, image URL, pk, username, etc.)
 * 3. Tag DOM elements with shortcodes via React Fiber introspection
 * 4. Respond to requests from content.js for post data
 */
(function () {
    'use strict';

    // Media cache: Map to preserve order for LRU memory management
    window.__megahub_cache = window.__megahub_cache || new Map();
    const MAX_CACHE_SIZE = 200; // Limit to prevent memory leaks in continuous scroll

    // ============================================================
    // 1. Intercept window.fetch
    // ============================================================
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);

        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            if (isInstagramApiUrl(url)) {
                const clone = response.clone();
                clone.json().then(extractAndCacheMedia).catch(() => { });
            }
        } catch (e) { }

        return response;
    };

    // ============================================================
    // 2. Intercept XMLHttpRequest
    // ============================================================
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__megahub_url = url;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', function () {
            try {
                const url = this.__megahub_url || '';
                if (isInstagramApiUrl(url)) {
                    extractAndCacheMedia(JSON.parse(this.responseText));
                }
            } catch (e) { }
        });
        return originalXHRSend.apply(this, args);
    };

    /** Check if a URL is an Instagram API endpoint worth intercepting. */
    function isInstagramApiUrl(url) {
        return url.includes('/graphql/query') ||
            url.includes('/api/v1/') ||
            url.includes('__a=1');
    }

    // ============================================================
    // 3. Extract and cache media data from API responses
    // ============================================================

    /** Parse various Instagram response formats and cache media items. */
    function extractAndCacheMedia(data) {
        if (!data || typeof data !== 'object') return;

        try {
            // GraphQL response
            const graphqlMedia = data?.data?.xdt_shortcode_media ||
                data?.data?.shortcode_media ||
                data?.graphql?.shortcode_media;
            if (graphqlMedia) {
                cacheMediaItem(graphqlMedia);
                return;
            }

            // REST API (items array)
            if (data.items && Array.isArray(data.items)) {
                data.items.forEach(item => cacheMediaItem(item));
                return;
            }

            // Feed response
            if (data.feed_items || data.media_or_ad) {
                const items = data.feed_items || [data.media_or_ad];
                items.forEach(item => cacheMediaItem(item.media_or_ad || item));
                return;
            }

            // Deep search fallback
            deepSearchMedia(data, 0);
        } catch (e) { }
    }

    /** Cache a single media item (post, reel, etc.) with all relevant metadata. */
    function cacheMediaItem(media) {
        if (!media) return;

        const shortcode = media.code || media.shortcode;
        if (!shortcode) return;

        const entry = { shortcode };

        // Metadata for smart filename
        entry.mediaPk = media.pk || media.id || '';
        entry.takenAt = media.taken_at || media.taken_at_timestamp || '';

        if (media.user) {
            entry.username = media.user.username || '';
            entry.userPk = media.user.pk || media.user.id || '';
        } else if (media.owner) {
            entry.username = media.owner.username || '';
            entry.userPk = media.owner.id || '';
        }

        // Video URL
        if (media.video_url) {
            entry.videoUrl = media.video_url;
            entry.mediaType = 'video';
        } else if (media.video_versions && media.video_versions.length > 0) {
            entry.videoUrl = media.video_versions[0].url;
            entry.mediaType = 'video';
        }

        // Image URL
        if (media.display_url) {
            entry.imageUrl = media.display_url;
        } else if (media.image_versions2 && media.image_versions2.candidates) {
            entry.imageUrl = media.image_versions2.candidates[0].url;
        }

        // Carousel items
        const carouselItems = media.carousel_media ||
            (media.edge_sidecar_to_children && media.edge_sidecar_to_children.edges.map(e => e.node));
        if (carouselItems) {
            entry.allMedia = [];
            carouselItems.forEach(item => {
                const childPk = item.pk || item.id || '';
                if (item.video_url || (item.video_versions && item.video_versions.length > 0)) {
                    entry.allMedia.push({
                        url: item.video_url || item.video_versions[0].url,
                        type: 'video',
                        childPk: childPk
                    });
                } else if (item.display_url) {
                    entry.allMedia.push({ url: item.display_url, type: 'image', childPk: childPk });
                } else if (item.image_versions2) {
                    entry.allMedia.push({ url: item.image_versions2.candidates[0].url, type: 'image', childPk: childPk });
                }
            });
        }

        if (entry.videoUrl || entry.imageUrl) {
            // Enforce LRU cache limits to prevent memory leaks
            if (window.__megahub_cache.size >= MAX_CACHE_SIZE) {
                const firstKey = window.__megahub_cache.keys().next().value;
                window.__megahub_cache.delete(firstKey);
            }
            window.__megahub_cache.set(shortcode, entry);
        }
    }

    /** Recursively search an object tree for media items (max depth 5). */
    function deepSearchMedia(obj, depth) {
        if (depth > 5 || !obj || typeof obj !== 'object') return;

        if ((obj.code || obj.shortcode) &&
            (obj.video_url || obj.video_versions || obj.image_versions2 || obj.display_url)) {
            cacheMediaItem(obj);
            return;
        }

        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                deepSearchMedia(obj[key], depth + 1);
            }
        }
    }

    // ============================================================
    // 4. Tag DOM elements with shortcodes via React Fiber
    // ============================================================

    /** Walk React Fiber tree to extract the shortcode associated with a DOM element. */
    function getShortcodeFromFiber(element) {
        if (!element) return null;
        for (const key of Object.keys(element)) {
            if (!key.startsWith('__reactFiber$')) continue;
            let fiber = element[key];
            for (let i = 0; i < 25 && fiber; i++) {
                try {
                    const p = fiber.memoizedProps;
                    if (p?.post?.code) return p.post.code;
                    if (p?.media?.code) return p.media.code;
                    if (p?.shortcode) return p.shortcode;
                } catch (e) { }
                fiber = fiber.return;
            }
        }
        return null;
    }

    /** Tag all <article> elements with their shortcode data attribute. */
    function tagElements(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('article').forEach(el => {
            if (el.getAttribute('data-megahub-shortcode')) return;
            const sc = getShortcodeFromFiber(el);
            if (sc) el.setAttribute('data-megahub-shortcode', sc);
        });
    }

    // ============================================================
    // 5. Message handler — respond to content.js requests
    // ============================================================
    window.addEventListener('message', async (event) => {
        if (event.origin !== 'https://www.instagram.com') return;
        if (!event.data || event.data.source !== 'megahub-content') return;

        const { action, shortcode, requestId, username } = event.data;

        if (action === 'getAvatar' && username) {
            try {
                const appId = getAppId();
                const resp = await originalFetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
                    headers: { 'X-IG-App-ID': appId, 'X-Requested-With': 'XMLHttpRequest' },
                    credentials: 'include'
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data?.data?.user?.hd_profile_pic_url_info?.url) {
                        window.postMessage({
                            source: 'megahub-inject',
                            requestId,
                            imageUrl: data.data.user.hd_profile_pic_url_info.url,
                            success: true
                        }, '*');
                        return;
                    }
                }
            } catch (e) { }
            window.postMessage({ source: 'megahub-inject', requestId, success: false }, '*');
            return;
        }

        if (action !== 'getPostData' || !shortcode) return;

        // Check cache first — only fast-return if video data is complete
        let result = window.__megahub_cache.get(shortcode);

        if (result && result.videoUrl) {
            sendResult(requestId, result);
            return;
        }

        // Cache may have incomplete data (thumbnail-only from grid API preload).
        // Save it as fallback for image downloads, then let Relay fetch full video data.
        const cachedFallback = result;
        result = undefined;

        // Primary Method: Instagram Relay/GraphQL via window.require
        // Uses Instagram's internal module system — fastest and most reliable
        if (!result) {
            try {
                if (typeof window.require === 'function') {
                    const relay = window.require("CometRelay");
                    const env = window.require("PolarisRelayEnvironment");
                    const query = window.require("PolarisPostActionLoadPostQuery");
                    if (relay && env && query) {
                        const r = await relay.fetchQuery(env, query.POST_QUERY, {
                            shortcode,
                            child_comment_count: 3,
                            fetch_comment_count: 40,
                            has_threaded_comments: true,
                            parent_comment_count: 24
                        }).toPromise();
                        if (r?.xdt_shortcode_media) {
                            cacheMediaItem(r.xdt_shortcode_media);
                            result = window.__megahub_cache.get(shortcode);
                        }
                    }
                }
            } catch (e) { /* silent fail */ }
        }

        // If Relay failed, use original cached data as fallback (for image downloads)
        if (!result) result = cachedFallback;
        sendResult(requestId, result);
    });

    /** Send result back to content.js via postMessage. */
    function sendResult(requestId, result) {
        window.postMessage({
            source: 'megahub-inject',
            requestId,
            videoUrl: result?.videoUrl || null,
            imageUrl: result?.imageUrl || null,
            mediaType: result?.mediaType || 'image',
            allMedia: result?.allMedia || [],
            username: result?.username || '',
            mediaPk: result?.mediaPk || '',
            takenAt: result?.takenAt || '',
            userPk: result?.userPk || '',
            success: !!(result && (result.videoUrl || result.imageUrl))
        }, '*');
    }

    /** Get Instagram App ID from internal config or use fallback. */
    function getAppId() {
        try { return window.require("PolarisConfig").getIGAppID(); }
        catch (e) { return "936619743"; }
    }

    // ============================================================
    // 6. DOM Observer — Debounced tagging to save CPU cycles
    // ============================================================
    let _tagTimeout = null;
    const observer = new MutationObserver(mutations => {
        let needsTagging = false;
        for (const m of mutations) {
            if (m.addedNodes.length > 0 || m.type === 'attributes') {
                needsTagging = true;
                break;
            }
        }

        if (needsTagging) {
            // Debounce the heavy React Fiber traversal
            clearTimeout(_tagTimeout);
            _tagTimeout = setTimeout(() => {
                tagElements(document.body);
            }, 800);
        }
    });

    function start() {
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
            tagElements(document.body);
        } else {
            // Use requestAnimationFrame instead of generic setTimeout for initialization
            requestAnimationFrame(start);
        }
    }
    start();

})();
