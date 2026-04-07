/**
 * Mega Hub — Popup Script
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const downloadCarouselAllToggle = document.getElementById('download-carousel-all');
    const videoControlsToggle = document.getElementById('video-controls-toggle');
    const gpuAccelerationToggle = document.getElementById('gpu-acceleration-toggle');
    const buttonStyleSelect = document.getElementById('button-style');
    const smartRoutingToggle = document.getElementById('smart-routing-toggle');
    const optionsBtn = document.getElementById('open-options');

    // Determine system preference defaults
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

    // Load initial settings
    chrome.storage.sync.get({
        theme: systemTheme,
        downloadCarouselAll: false,
        buttonStyle: 'inline',
        videoControlsEnabled: false,
        gpuAccelerationEnabled: false,
        smartRoutingEnabled: false
    }, (result) => {
        themeToggle.checked = result.theme === 'dark';
        downloadCarouselAllToggle.checked = result.downloadCarouselAll;
        videoControlsToggle.checked = result.videoControlsEnabled;
        gpuAccelerationToggle.checked = result.gpuAccelerationEnabled;
        smartRoutingToggle.checked = result.smartRoutingEnabled;
        buttonStyleSelect.value = result.buttonStyle;
        applyTheme(result.theme);
    });

    // Event Listeners
    themeToggle.addEventListener('change', (e) => {
        const theme = e.target.checked ? 'dark' : 'light';
        chrome.storage.sync.set({ theme });
        applyTheme(theme);
    });

    downloadCarouselAllToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ downloadCarouselAll: e.target.checked });
    });

    smartRoutingToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ smartRoutingEnabled: e.target.checked });
    });

    videoControlsToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ videoControlsEnabled: isEnabled });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.url?.includes('instagram.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleVideoControls', enabled: isEnabled }).catch(() => {});
            }
        });
    });

    gpuAccelerationToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ gpuAccelerationEnabled: isEnabled });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.url?.includes('instagram.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleGpuAcceleration', enabled: isEnabled }).catch(() => {});
            }
        });
    });

    buttonStyleSelect.addEventListener('change', (e) => {
        chrome.storage.sync.set({ buttonStyle: e.target.value });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.url?.includes('instagram.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'switchButtonStyle' }).catch(() => {});
            }
        });
    });

    optionsBtn.addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    });

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
    }
});
