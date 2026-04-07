/**
 * Mega Hub — Popup Script
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const downloadCarouselAllToggle = document.getElementById('download-carousel-all');
    const buttonStyleSelect = document.getElementById('button-style');
    const optionsBtn = document.getElementById('open-options');

    // Determine system preference defaults
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

    // Load initial settings
    chrome.storage.sync.get({
        theme: systemTheme,
        downloadCarouselAll: true,
        buttonStyle: 'inline'
    }, (result) => {
        themeToggle.checked = result.theme === 'dark';
        downloadCarouselAllToggle.checked = result.downloadCarouselAll;
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

    buttonStyleSelect.addEventListener('change', (e) => {
        chrome.storage.sync.set({ buttonStyle: e.target.value });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.url?.includes('instagram.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'switchButtonStyle' });
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
