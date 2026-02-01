/**
 * File Manager - Drag & drop, file input, recent files (IndexedDB), holding cell
 */

const FileManager = (() => {
  const DB_NAME = 'pdfeditor98';
  const DB_VERSION = 1;
  const STORE_RECENT = 'recentFiles';
  const MAX_RECENT = 20;

  let db = null;
  let onFileLoaded = null; // callback: (arrayBuffer, fileName) => void

  // ---- IndexedDB ----

  async function initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_RECENT)) {
          const store = db.createObjectStore(STORE_RECENT, { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('date', 'date', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function addRecentFile(name, data) {
    if (!db) return;
    const tx = db.transaction(STORE_RECENT, 'readwrite');
    const store = tx.objectStore(STORE_RECENT);

    store.add({
      name: name,
      date: Date.now(),
      size: data.byteLength,
      data: data
    });

    // Prune old entries
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result > MAX_RECENT) {
        const cursor = store.openCursor();
        let toDelete = countReq.result - MAX_RECENT;
        cursor.onsuccess = (e) => {
          const c = e.target.result;
          if (c && toDelete > 0) {
            c.delete();
            toDelete--;
            c.continue();
          }
        };
      }
    };
  }

  async function getRecentFiles() {
    if (!db) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_RECENT, 'readonly');
      const store = tx.objectStore(STORE_RECENT);
      const idx = store.index('date');
      const req = idx.openCursor(null, 'prev');
      const results = [];
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < MAX_RECENT) {
          results.push({
            id: cursor.value.id,
            name: cursor.value.name,
            date: cursor.value.date,
            size: cursor.value.size
          });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => resolve([]);
    });
  }

  async function loadRecentFile(id) {
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_RECENT, 'readonly');
      const store = tx.objectStore(STORE_RECENT);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  // ---- Drag & Drop ----

  function initDragDrop() {
    const dropZone = document.getElementById('drop-zone');
    const viewport = document.getElementById('canvas-viewport');

    ['dragenter', 'dragover'].forEach(evt => {
      viewport.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      viewport.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
    });

    viewport.addEventListener('drop', handleDrop);

    // Click to browse on drop zone
    dropZone.addEventListener('click', () => {
      document.getElementById('file-input').click();
    });
  }

  function handleDrop(e) {
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    handleFiles(files);
  }

  // ---- File Input ----

  function initFileInput() {
    const input = document.getElementById('file-input');
    input.addEventListener('change', () => {
      if (input.files.length > 0) {
        handleFiles(input.files);
      }
      input.value = '';
    });

    // Browse button
    document.getElementById('btn-browse').addEventListener('click', () => {
      input.click();
    });
  }

  function handleFiles(fileList) {
    for (const file of fileList) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        UI.showDialog({
          title: 'Invalid File',
          message: `"${file.name}" is not a PDF file.`,
          icon: '⚠️',
          buttons: ['OK']
        });
        continue;
      }
      readFile(file);
    }
  }

  function readFile(file) {
    UI.setStatus(`Opening ${file.name}...`);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = e.target.result;
      await addRecentFile(file.name, data.slice(0));
      if (onFileLoaded) onFileLoaded(data, file.name);
      refreshRecentList();
      UI.setStatus('Ready.');
    };
    reader.onerror = () => {
      UI.showDialog({
        title: 'Error',
        message: `Failed to read "${file.name}".`,
        icon: '❌',
        buttons: ['OK']
      });
      UI.setStatus('Ready.');
    };
    reader.readAsArrayBuffer(file);
  }

  // ---- Recent Files List ----

  async function refreshRecentList() {
    const list = document.getElementById('recent-files-list');
    const files = await getRecentFiles();

    if (files.length === 0) {
      list.innerHTML = '<div class="empty-panel-msg">No recent files.</div>';
      return;
    }

    list.innerHTML = '';
    files.forEach(f => {
      const item = document.createElement('div');
      item.className = 'sidebar-file-item';
      item.innerHTML = `<span class="sidebar-file-icon">📄</span><span>${escapeHtml(f.name)}</span>`;
      item.title = `${f.name}\n${formatFileSize(f.size)}\n${new Date(f.date).toLocaleString()}`;

      item.addEventListener('dblclick', async () => {
        const record = await loadRecentFile(f.id);
        if (record && onFileLoaded) {
          onFileLoaded(record.data, record.name);
        }
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        item.classList.add('selected');
        UI.showContextMenu('file-context-menu', e.clientX, e.clientY);
      });

      list.appendChild(item);
    });
  }

  // ---- Save Local ----

  function saveLocalFile(data, fileName) {
    const blob = new Blob([data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    UI.setStatus(`Saved "${fileName}" locally.`);
  }

  // ---- Helpers ----

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ---- Open File Programmatically ----

  function openFilePicker() {
    document.getElementById('file-input').click();
  }

  // ---- Init ----

  async function init(fileCallback) {
    onFileLoaded = fileCallback;
    await initDB();
    initDragDrop();
    initFileInput();
    await refreshRecentList();
  }

  return {
    init,
    openFilePicker,
    saveLocalFile,
    refreshRecentList,
    addRecentFile,
    getRecentFiles,
    loadRecentFile,
    handleFiles,
  };
})();
