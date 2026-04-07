// offscreen.js — Writes pre-fetched media data to user's custom folder via File System Access API
// NOTE: This file does NOT fetch media. It reads blob data from shared IndexedDB (put there by background.js).
import { getDirectoryHandle, getTempBlob, deleteTempBlob } from './storage-db.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.target !== 'offscreen') return;

    if (request.action === 'offscreen_write_file') {
        handleWriteFile(request.data)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === 'offscreen_ping') {
        sendResponse({ ready: true });
        return;
    }
});

async function handleWriteFile({ blobKey, filename, folderName }) {
    try {
        // 1. Get the master directory handle from IndexedDB
        const masterHandle = await getDirectoryHandle('master_harvest_folder');
        if (!masterHandle) {
            throw new Error('No folder selected. Open Mega Hub Options to pick a folder.');
        }

        // 2. Read the blob from shared IndexedDB
        const blob = await getTempBlob(blobKey);
        if (!blob) {
            throw new Error('Media data not found in storage.');
        }

        // 3. Try to use the handle directly — skip queryPermission/requestPermission
        //    (offscreen docs can't request permissions — no user gesture)
        //    If the handle works → proceed. If not → error tells user to re-select.
        const safeFolderName = (folderName || 'Misc').replace(/[<>:"/\\|?*]/g, '').trim() || 'Misc';
        let userFolder;
        try {
            userFolder = await masterHandle.getDirectoryHandle(safeFolderName, { create: true });
        } catch (dirErr) {
            // Handle is invalid (folder deleted, permission expired, etc.)
            throw new Error(
                'Cannot access the selected folder "' + masterHandle.name + '". ' +
                'The folder may have been deleted or permission expired. ' +
                'Please open Mega Hub Options → Smart Storage → Browse Folder to re-select.'
            );
        }

        // 4. Create the file — uniquify if locked
        let safeFilename = filename.replace(/[<>:"/\\|?*]/g, '').trim() || 'download';
        let fileHandle;
        try {
            fileHandle = await userFolder.getFileHandle(safeFilename, { create: true });
        } catch (e) {
            const dot = safeFilename.lastIndexOf('.');
            const name = dot > 0 ? safeFilename.substring(0, dot) : safeFilename;
            const ext = dot > 0 ? safeFilename.substring(dot) : '';
            safeFilename = `${name}_${Date.now()}${ext}`;
            fileHandle = await userFolder.getFileHandle(safeFilename, { create: true });
        }

        // 5. Write blob to disk
        const writable = await fileHandle.createWritable();
        try {
            await writable.write(blob);
            await writable.close();
        } catch (writeErr) {
            try { await writable.abort(); } catch (_) {}
            throw new Error('File write failed: ' + writeErr.message);
        }

        // 6. Clean up temp blob from IndexedDB
        await deleteTempBlob(blobKey).catch(() => {});

        return { success: true };
    } finally {
        if (blobKey) await deleteTempBlob(blobKey).catch(() => {});
    }
}
