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

    chrome.storage.sync.get({ theme: 'light', buttonStyle: 'inline' }, (res) => {
        themeSelect.value = res.theme;
        buttonStyleSelect.value = res.buttonStyle;
        document.documentElement.setAttribute('data-theme', res.theme);
    });

    themeSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        chrome.storage.sync.set({ theme });
        document.documentElement.setAttribute('data-theme', theme);
    });

    buttonStyleSelect.addEventListener('change', (e) => {
        chrome.storage.sync.set({ buttonStyle: e.target.value });
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
