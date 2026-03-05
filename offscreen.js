import { getDirectoryHandle } from './storage-db.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'offscreen_save_blob') {
        saveUsingHandle(request.data)
            .then(() => sendResponse({ success: true }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
});

async function saveUsingHandle({ url, filename, folderName }) {
    // 1. Get Master Handle
    let masterDirHandle = await getDirectoryHandle('master_harvest_folder');
    if (!masterDirHandle) {
        throw new Error("Master folder not configured. Please set it up in the Options page.");
    }

    // 2. Check Permission
    const options = { mode: 'readwrite' };
    if ((await masterDirHandle.queryPermission(options)) !== 'granted') {
        throw new Error("Permission lost. Please re-authorize the Master folder in the Options page.");
    }

    // 3. Resolve Subfolder
    let targetDir = masterDirHandle;
    if (folderName) {
        const safeFolder = folderName.replace(/[^a-zA-Z0-9_\-\. ]/g, '').trim() || 'Misc';
        targetDir = await masterDirHandle.getDirectoryHandle(safeFolder, { create: true });
    }

    // 4. Create File
    const safeFilename = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
    const fileHandle = await targetDir.getFileHandle(safeFilename, { create: true });

    // 5. Stream Native Network Fetch -> File System directly
    // This uses ZERO RAM locally as the stream pipes straight to disk!
    const writable = await fileHandle.createWritable();
    const response = await fetch(url, { credentials: 'omit' });

    if (!response.ok) {
        await writable.abort();
        throw new Error("Offscreen file fetch failed (Network Error).");
    }

    await response.body.pipeTo(writable);
}
