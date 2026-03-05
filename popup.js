/**
 * Mega Hub — Popup Script
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const showReelsBtnToggle = document.getElementById('show-reels-btn');
    const downloadCarouselAllToggle = document.getElementById('download-carousel-all');
    const buttonStyleSelect = document.getElementById('button-style');
    const optionsBtn = document.getElementById('open-options');

    // Load initial settings
    chrome.storage.sync.get({
        theme: 'light',
        showReelsBtn: true,
        downloadCarouselAll: true,
        buttonStyle: 'inline'
    }, (result) => {
        themeToggle.checked = result.theme === 'dark';
        showReelsBtnToggle.checked = result.showReelsBtn;
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

    showReelsBtnToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ showReelsBtn: e.target.checked });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.url?.includes('instagram.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleReelsButtons', show: e.target.checked });
            }
        });
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
