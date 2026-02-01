/**
 * Google Drive Integration
 * OAuth sign-in, save/load from Drive "holding cell" folder, file browser in sidebar.
 *
 * NOTE: To use Google Drive, you must:
 * 1. Create a project at https://console.cloud.google.com
 * 2. Enable the Google Drive API
 * 3. Create OAuth 2.0 credentials (Web Application type)
 * 4. Set the redirect URI to your app's URL
 * 5. Replace CLIENT_ID below with your actual client ID
 */

const Drive = (() => {
  // ---- Configuration ----
  // Replace with your Google Cloud OAuth Client ID
  const CLIENT_ID = '34108248790-rso2p4ns7akuhgjkrv0vs8bva82ivmes.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_NAME = 'PDFeditor Holding Cell';
  const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

  let tokenClient = null;
  let accessToken = null;
  let holdingCellFolderId = null;
  let isSignedIn = false;

  // ---- Init ----

  function init() {
    if (!CLIENT_ID) {
      console.log('Google Drive: No CLIENT_ID configured. Drive features disabled.');
      return;
    }
    loadGisScript();
  }

  function loadGisScript() {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = initTokenClient;
    script.onerror = () => console.warn('Failed to load Google Identity Services');
    document.head.appendChild(script);
  }

  function initTokenClient() {
    if (typeof google === 'undefined' || !google.accounts) return;

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: onTokenResponse,
    });
  }

  // ---- Sign In / Out ----

  function signIn() {
    if (!CLIENT_ID) {
      UI.showDialog({
        title: 'Google Drive',
        message: 'Google Drive is not configured.\n\nTo enable Drive integration, you need to set up a Google Cloud project and add your OAuth Client ID to drive.js.',
        icon: 'ℹ️',
        buttons: ['OK']
      });
      return;
    }

    if (!tokenClient) {
      UI.showDialog({
        title: 'Google Drive',
        message: 'Google Identity Services failed to load. Check your internet connection.',
        icon: '⚠️',
        buttons: ['OK']
      });
      return;
    }

    tokenClient.requestAccessToken();
  }

  function signOut() {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken);
    }
    accessToken = null;
    isSignedIn = false;
    holdingCellFolderId = null;
    updateSidebarUI();
    UI.setStatus('Signed out of Google Drive.');
  }

  function onTokenResponse(response) {
    if (response.error) {
      console.error('OAuth error:', response);
      UI.showDialog({
        title: 'Google Drive',
        message: 'Failed to sign in: ' + (response.error_description || response.error),
        icon: '❌',
        buttons: ['OK']
      });
      return;
    }

    accessToken = response.access_token;
    isSignedIn = true;
    UI.setStatus('Signed in to Google Drive.');

    // Find or create holding cell folder
    findOrCreateFolder().then(() => {
      refreshHoldingCell();
    });
  }

  // ---- API Helpers ----

  async function apiRequest(url, options = {}) {
    const headers = {
      'Authorization': 'Bearer ' + accessToken,
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      if (response.status === 401) {
        isSignedIn = false;
        accessToken = null;
        throw new Error('Session expired. Please sign in again.');
      }
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    return response;
  }

  // ---- Folder Management ----

  async function findOrCreateFolder() {
    try {
      // Search for existing folder
      const query = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const resp = await apiRequest(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`);
      const data = await resp.json();

      if (data.files && data.files.length > 0) {
        holdingCellFolderId = data.files[0].id;
      } else {
        // Create folder
        const createResp = await apiRequest('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder'
          })
        });
        const folder = await createResp.json();
        holdingCellFolderId = folder.id;
      }
    } catch (err) {
      console.error('Folder error:', err);
      UI.showDialog({ title: 'Google Drive', message: 'Failed to access Drive folder:\n' + err.message, icon: '❌', buttons: ['OK'] });
    }
  }

  // ---- Save to Drive ----

  async function saveToDrive(pdfBytes, fileName) {
    if (!isSignedIn || !accessToken) {
      UI.showDialog({ title: 'Google Drive', message: 'Please sign in to Google Drive first.', icon: 'ℹ️', buttons: ['OK'] });
      return;
    }

    if (!holdingCellFolderId) {
      await findOrCreateFolder();
    }

    UI.setStatus(`Saving "${fileName}" to Drive...`);
    document.body.classList.add('wait-cursor');

    try {
      const metadata = {
        name: fileName,
        parents: [holdingCellFolderId],
        mimeType: 'application/pdf'
      };

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }));

      await apiRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        body: form
      });

      UI.setStatus(`Saved "${fileName}" to Drive.`);
      refreshHoldingCell();
    } catch (err) {
      console.error('Save error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to save to Drive:\n' + err.message, icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Load from Drive ----

  async function loadFromDrive(fileId, fileName) {
    UI.setStatus(`Loading "${fileName}" from Drive...`);
    document.body.classList.add('wait-cursor');

    try {
      const resp = await apiRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      const buffer = await resp.arrayBuffer();

      await PDFViewer.loadPDF(buffer, fileName);
      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Load error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to load from Drive:\n' + err.message, icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Refresh Holding Cell ----

  async function refreshHoldingCell() {
    if (!isSignedIn || !holdingCellFolderId) {
      updateSidebarUI();
      return;
    }

    try {
      const query = encodeURIComponent(`'${holdingCellFolderId}' in parents and trashed=false`);
      const resp = await apiRequest(
        `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc`
      );
      const data = await resp.json();

      updateSidebarUI(data.files || []);
    } catch (err) {
      console.error('Refresh error:', err);
    }
  }

  // ---- Delete from Drive ----

  async function deleteFromDrive(fileId) {
    try {
      await apiRequest(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE'
      });
      refreshHoldingCell();
    } catch (err) {
      UI.showDialog({ title: 'Error', message: 'Failed to delete file:\n' + err.message, icon: '❌', buttons: ['OK'] });
    }
  }

  // ---- Rename on Drive ----

  async function renameOnDrive(fileId, newName) {
    try {
      await apiRequest(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      refreshHoldingCell();
    } catch (err) {
      UI.showDialog({ title: 'Error', message: 'Failed to rename file:\n' + err.message, icon: '❌', buttons: ['OK'] });
    }
  }

  // ---- Download from Drive ----

  async function downloadFromDrive(fileId, fileName) {
    try {
      const resp = await apiRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      UI.showDialog({ title: 'Error', message: 'Failed to download:\n' + err.message, icon: '❌', buttons: ['OK'] });
    }
  }

  // ---- Sidebar UI ----

  let selectedDriveFile = null;

  function updateSidebarUI(files) {
    const list = document.getElementById('holding-cell-list');

    if (!isSignedIn) {
      list.innerHTML = `
        <div class="empty-panel-msg" style="cursor:pointer;" id="drive-signin-link">
          ☁️ Click here or use the GDrive button to sign in.
        </div>`;
      const link = list.querySelector('#drive-signin-link');
      if (link) link.addEventListener('click', signIn);
      return;
    }

    if (!files || files.length === 0) {
      list.innerHTML = '<div class="empty-panel-msg">Holding cell is empty.</div>';
      return;
    }

    list.innerHTML = '';
    files.forEach(f => {
      const item = document.createElement('div');
      item.className = 'sidebar-file-item';
      item.innerHTML = `<span class="sidebar-file-icon">📄</span><span>${escapeHtml(f.name)}</span>`;
      item.title = f.name;

      item.addEventListener('dblclick', () => {
        loadFromDrive(f.id, f.name);
      });

      item.addEventListener('click', () => {
        list.querySelectorAll('.sidebar-file-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedDriveFile = f;
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        list.querySelectorAll('.sidebar-file-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedDriveFile = f;
        UI.showContextMenu('file-context-menu', e.clientX, e.clientY);
      });

      list.appendChild(item);
    });
  }

  function getSelectedDriveFile() {
    return selectedDriveFile;
  }

  // ---- Helpers ----

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getIsSignedIn() {
    return isSignedIn;
  }

  return {
    init,
    signIn,
    signOut,
    saveToDrive,
    loadFromDrive,
    refreshHoldingCell,
    deleteFromDrive,
    renameOnDrive,
    downloadFromDrive,
    getSelectedDriveFile,
    getIsSignedIn,
  };
})();
