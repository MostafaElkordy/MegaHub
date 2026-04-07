// options.js — Mega Hub Settings

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Tab Switching
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-tab');

            navItems.forEach(n => n.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            item.classList.add('active');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // 2. Load General Settings
    const themeSelect = document.getElementById('opt-theme');
    const buttonStyleSelect = document.getElementById('opt-button-style');
    const videoControlsToggle = document.getElementById('opt-video-controls-toggle');
    const hoverAutoplayToggle = document.getElementById('opt-hover-autoplay-toggle');
    const gradientSliderRow = document.getElementById('gradient-slider-row');
    const optGradientSlider = document.getElementById('opt-gradient-slider');
    const gradientValDisplay = document.getElementById('gradient-val-display');

    const persistentControlsToggle = document.getElementById('opt-persistent-controls');
    const persistentControlsRow = document.getElementById('persistent-controls-row');
    const fullscreenNavSelect = document.getElementById('opt-fullscreen-nav');
    const fullscreenNavRow = document.getElementById('fullscreen-nav-row');
    const fullscreenToolbarToggle = document.getElementById('opt-show-fullscreen-toolbar');
    const fullscreenToolbarRow = document.getElementById('fullscreen-toolbar-row');

    const gpuAccelerationToggle = document.getElementById('opt-gpu-acceleration-toggle');
    const carouselNamingSelect = document.getElementById('opt-carousel-naming');
    const customSuffixInput = document.getElementById('opt-custom-suffix');
    const customSuffixRow = document.getElementById('custom-suffix-row');

    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

    chrome.storage.sync.get({
        theme: systemTheme,
        buttonStyle: 'inline',
        videoControlsEnabled: false,
        videoControlsGradientHeight: 75,
        videoControlsPersistent: false,
        fullscreenNavStyle: 'vertical',
        showFullscreenToolbar: true,
        gpuAccelerationEnabled: false,
        hoverAutoplayEnabled: false,
        carouselNamingFormat: 'real_id',
        customCarouselSuffix: 'slide'
    }, (res) => {
        themeSelect.value = res.theme;
        buttonStyleSelect.value = res.buttonStyle;
        videoControlsToggle.checked = res.videoControlsEnabled;
        hoverAutoplayToggle.checked = res.hoverAutoplayEnabled;
        persistentControlsToggle.checked = res.videoControlsPersistent;
        fullscreenNavSelect.value = res.fullscreenNavStyle;
        fullscreenToolbarToggle.checked = res.showFullscreenToolbar;
        optGradientSlider.value = res.videoControlsGradientHeight;
        gradientValDisplay.textContent = res.videoControlsGradientHeight;
        
        const initialVal = res.videoControlsGradientHeight;
        const initialPercent = (initialVal - 1) / 149 * 100;
        document.getElementById('slider-tooltip').textContent = initialVal;
        document.getElementById('slider-tooltip').style.left = `calc(${initialPercent}% + (${8 - initialPercent * 0.16}px))`;

        gpuAccelerationToggle.checked = res.gpuAccelerationEnabled;
        carouselNamingSelect.value = res.carouselNamingFormat;
        customSuffixInput.value = res.customCarouselSuffix;
        document.documentElement.setAttribute('data-theme', res.theme);

        if (res.videoControlsEnabled) {
            gradientSliderRow.style.display = 'flex';
            persistentControlsRow.style.display = 'flex';
            fullscreenNavRow.style.display = 'flex';
            fullscreenToolbarRow.style.display = 'flex';
        }

        if (res.carouselNamingFormat === 'custom') {
            customSuffixRow.style.display = 'flex';
        }
    });

    themeSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        chrome.storage.sync.set({ theme });
        document.documentElement.setAttribute('data-theme', theme);
    });

    buttonStyleSelect.addEventListener('change', (e) => {
        chrome.storage.sync.set({ buttonStyle: e.target.value });
    });

    videoControlsToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ videoControlsEnabled: isEnabled });
        
        gradientSliderRow.style.display = isEnabled ? 'flex' : 'none';
        persistentControlsRow.style.display = isEnabled ? 'flex' : 'none';
        fullscreenNavRow.style.display = isEnabled ? 'flex' : 'none';
        fullscreenToolbarRow.style.display = isEnabled ? 'flex' : 'none';

        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'toggleVideoControls', enabled: isEnabled }).catch(() => {});
            });
        });
    });

    hoverAutoplayToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ hoverAutoplayEnabled: isEnabled });
        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'toggleHoverAutoplay', enabled: isEnabled }).catch(() => {});
            });
        });
    });

    optGradientSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        gradientValDisplay.textContent = val;
        
        const tooltip = document.getElementById('slider-tooltip');
        tooltip.textContent = val;
        const percent = (val - 1) / 149 * 100;
        tooltip.style.left = `calc(${percent}% + (${8 - percent * 0.16}px))`;

        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'updateGradientHeight', height: parseInt(val, 10) }).catch(() => {});
            });
        });
    });

    optGradientSlider.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        chrome.storage.sync.set({ videoControlsGradientHeight: val });
    });

    document.querySelectorAll('.slider-scale span').forEach(span => {
        span.addEventListener('click', (e) => {
            const val = e.target.getAttribute('data-val');
            optGradientSlider.value = val;
            optGradientSlider.dispatchEvent(new Event('input'));
            optGradientSlider.dispatchEvent(new Event('change'));
        });
    });

    persistentControlsToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ videoControlsPersistent: isEnabled });
        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'togglePersistentControls', enabled: isEnabled }).catch(() => {});
            });
        });
    });

    fullscreenNavSelect.addEventListener('change', (e) => {
        const style = e.target.value;
        chrome.storage.sync.set({ fullscreenNavStyle: style });
        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'updateFullscreenNavStyle', style: style }).catch(() => {});
            });
        });
    });

    fullscreenToolbarToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ showFullscreenToolbar: isEnabled });
        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'updateFullscreenToolbar', enabled: isEnabled }).catch(() => {});
            });
        });
    });

    gpuAccelerationToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ gpuAccelerationEnabled: isEnabled });
        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'toggleGpuAcceleration', enabled: isEnabled }).catch(() => {});
            });
        });
    });

    carouselNamingSelect.addEventListener('change', (e) => {
        const format = e.target.value;
        chrome.storage.sync.set({ carouselNamingFormat: format });
        if (format === 'custom') {
            customSuffixRow.style.display = 'flex';
            customSuffixInput.focus();
        } else {
            customSuffixRow.style.display = 'none';
        }
    });

    customSuffixInput.addEventListener('input', (e) => {
        chrome.storage.sync.set({ customCarouselSuffix: e.target.value.trim() });
    });

    // 3. Smart Storage Logic
    const smartRoutingToggle = document.getElementById('smart-routing-toggle');
    const folderStatusIcon = document.getElementById('folder-status-icon');
    const folderStatusText = document.getElementById('folder-status-text');
    const folderPreview = document.getElementById('folder-preview');
    const folderNameDisplay = document.getElementById('folder-name-display');
    const btnChangeFolder = document.getElementById('btn-change-folder');

    function showFolderStatus(name) {
        if (name) {
            folderStatusIcon.className = 'status-dot linked';
            folderStatusText.textContent = name;
            folderPreview.style.display = 'block';
            folderNameDisplay.textContent = '📁 ' + name;
        } else {
            folderStatusIcon.className = 'status-dot no-folder';
            folderStatusText.textContent = 'No folder selected yet';
            folderPreview.style.display = 'none';
        }
    }

    const folderDetailsSection = document.getElementById('folder-details-section');
    // --- Load stored state ---
    chrome.storage.sync.get({
        smartRoutingEnabled: false,
        smartFolderName: ''
    }, (res) => {
        smartRoutingToggle.checked = res.smartRoutingEnabled;
        folderDetailsSection.style.display = res.smartRoutingEnabled ? 'block' : 'none';
        showFolderStatus(res.smartFolderName);
    });

    // --- Toggle ---
    smartRoutingToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ smartRoutingEnabled: isEnabled });
        folderDetailsSection.style.display = isEnabled ? 'block' : 'none';
    });

    // --- Change Folder: Clear the stored handle so next download re-prompts ---
    btnChangeFolder.addEventListener('click', () => {
        // Tell all Instagram tabs to clear their smart handle
        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'clear_smart_handle' }).catch(() => {});
            });
        });
        // Clear the folder name from storage
        chrome.storage.sync.remove('smartFolderName');
        showFolderStatus('');
        
        // UX Feedback
        btnChangeFolder.innerHTML = '✅ Reset! Pick new on next download';
        btnChangeFolder.disabled = true;
        setTimeout(() => {
            btnChangeFolder.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                    <path d="M3 3v5h5"></path>
                </svg>
                Reset
            `;
            btnChangeFolder.disabled = false;
        }, 3000);
    });

    // --- Listen for folder name changes (updated by content script on first download) ---
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.smartFolderName) {
            showFolderStatus(changes.smartFolderName.newValue || '');
        }
    });

});
