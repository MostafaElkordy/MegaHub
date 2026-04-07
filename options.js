import { saveDirectoryHandle, getDirectoryHandle } from './storage-db.js';

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
    const gradientSliderRow = document.getElementById('gradient-slider-row');
    const optGradientSlider = document.getElementById('opt-gradient-slider');
    const gradientValDisplay = document.getElementById('gradient-val-display');

    const persistentControlsToggle = document.getElementById('opt-persistent-controls');
    const persistentControlsRow = document.getElementById('persistent-controls-row');

    const gpuAccelerationToggle = document.getElementById('opt-gpu-acceleration-toggle');
    const carouselNamingSelect = document.getElementById('opt-carousel-naming');
    const customSuffixInput = document.getElementById('opt-custom-suffix');
    const customSuffixRow = document.getElementById('custom-suffix-row');

    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

    chrome.storage.sync.get({
        theme: systemTheme,
        buttonStyle: 'inline',
        videoControlsEnabled: false,
        videoControlsGradientHeight: 75, /* Default requested by user */
        videoControlsPersistent: false,
        gpuAccelerationEnabled: false,
        carouselNamingFormat: 'real_id',
        customCarouselSuffix: 'slide'
    }, (res) => {
        themeSelect.value = res.theme;
        buttonStyleSelect.value = res.buttonStyle;
        videoControlsToggle.checked = res.videoControlsEnabled;
        persistentControlsToggle.checked = res.videoControlsPersistent;
        optGradientSlider.value = res.videoControlsGradientHeight;
        gradientValDisplay.textContent = res.videoControlsGradientHeight;
        
        // Set initial tooltip position without triggering input event
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
        
        // Toggle the sub-setting rows
        gradientSliderRow.style.display = isEnabled ? 'flex' : 'none';
        persistentControlsRow.style.display = isEnabled ? 'flex' : 'none';

        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'toggleVideoControls', enabled: isEnabled }).catch(() => {});
            });
        });
    });

    optGradientSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        gradientValDisplay.textContent = val;
        
        // Update slider tooltip
        const tooltip = document.getElementById('slider-tooltip');
        tooltip.textContent = val;
        const percent = (val - 1) / 149 * 100;
        tooltip.style.left = `calc(${percent}% + (${8 - percent * 0.16}px))`;

        // Realtime Chrome sync to Instagram tabs while sliding
        chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'updateGradientHeight', height: parseInt(val, 10) }).catch(() => {});
            });
        });
    });

    optGradientSlider.addEventListener('change', (e) => {
        // Save to storage ONLY on change to avoid hitting write limits
        const val = parseInt(e.target.value, 10);
        chrome.storage.sync.set({ videoControlsGradientHeight: val });
    });

    // Make scale numbers clickable
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
    const btnSelectFolder = document.getElementById('btn-select-folder');
    const folderStatus = document.getElementById('folder-status');
    const folderPath = document.getElementById('folder-path');
    const permissionWarning = document.getElementById('permission-warning');

    chrome.storage.sync.get({ smartRoutingEnabled: false }, (res) => {
        smartRoutingToggle.checked = res.smartRoutingEnabled;
    });

    smartRoutingToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ smartRoutingEnabled: e.target.checked });
    });

    async function checkExistingHandle() {
        try {
            const handle = await getDirectoryHandle('master_harvest_folder');
            if (handle) {
                folderStatus.textContent = 'Linked to Folder:';
                folderStatus.className = 'status linked';
                folderPath.textContent = handle.name;
                btnSelectFolder.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Change Master Folder`;

                // Verify permissions
                const permission = await handle.queryPermission({ mode: 'readwrite' });
                if (permission !== 'granted') {
                    permissionWarning.style.display = 'block';
                    folderStatus.className = 'status warning';
                } else {
                    permissionWarning.style.display = 'none';
                }
            } else {
                folderStatus.textContent = 'No folder selected';
                folderStatus.className = 'status no-folder';
                folderPath.textContent = '';
            }
        } catch (e) {
            console.error("Error reading handle:", e);
        }
    }

    await checkExistingHandle();

    // 4. File System Access API Prompt
    btnSelectFolder.addEventListener('click', async () => {
        try {
            // Browsers enforce that showDirectoryPicker must be bounded to a transient activation (click)
            const handle = await window.showDirectoryPicker({
                id: 'megahub_master',
                mode: 'readwrite'
            });

            await saveDirectoryHandle('master_harvest_folder', handle);
            chrome.storage.sync.set({ smartRoutingEnabled: true });
            smartRoutingToggle.checked = true;

            await checkExistingHandle();
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Directory Picker Error:', err);
                alert("Failed to access folder: " + err.message);
            }
        }
    });

});
