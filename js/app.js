/**
 * PDFeditor 98 - Main Application
 * Ties all modules together, handles keyboard shortcuts, toolbar actions, and initialization.
 */

const App = (() => {

  // ---- Initialization ----

  async function init() {
    UI.init();
    PDFViewer.init();
    PDFEditor.init();
    Drive.init();

    await FileManager.init(onFileLoaded);

    bindToolbarActions();
    bindSidebarTools();
    bindMenuActions();
    bindContextActions();
    bindKeyboardShortcuts();
    bindTitleBarButtons();

    UI.setStatus('Ready.');
    console.log('PDFeditor 98 initialized.');
  }

  // ---- File Loaded Callback ----

  function onFileLoaded(arrayBuffer, fileName) {
    PDFViewer.loadPDF(arrayBuffer, fileName);
  }

  // ---- Toolbar Actions ----

  function bindToolbarActions() {
    const actions = {
      'tb-open': () => FileManager.openFilePicker(),
      'tb-save': () => saveFile(),
      'tb-print': () => printPDF(),
      'tb-merge': () => PDFMerge.showMergeDialog(),
      'tb-extract': () => PDFMerge.showExtractDialog(),
      'tb-toword': () => PDFConvert.convertToWord(),
      'tb-undo': () => PDFEditor.undo(),
      'tb-redo': () => PDFEditor.redo(),
      'tb-zoomin': () => PDFViewer.zoomIn(),
      'tb-zoomout': () => PDFViewer.zoomOut(),
      'tb-fitpage': () => PDFViewer.setZoom('fit'),
      'tb-editmode': () => PDFEditor.toggleEditMode(),
      'tb-gdrive': () => {
        if (Drive.getIsSignedIn()) {
          Drive.refreshHoldingCell();
        } else {
          Drive.signIn();
        }
      },
    };

    Object.entries(actions).forEach(([id, handler]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handler);
    });
  }

  // ---- Sidebar Tool Buttons ----

  function bindSidebarTools() {
    const actions = {
      'side-merge': () => PDFMerge.showMergeDialog(),
      'side-extract': () => PDFMerge.showExtractDialog(),
      'side-edit': () => PDFEditor.toggleEditMode(),
      'side-toword': () => PDFConvert.convertToWord(),
      'side-print': () => printPDF(),
      'side-save': () => saveFile(),
    };

    Object.entries(actions).forEach(([id, handler]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handler);
    });
  }

  // ---- Menu Actions ----

  function bindMenuActions() {
    document.addEventListener('menu-action', (e) => {
      const action = e.detail.action;
      const handlers = {
        // File
        'open': () => FileManager.openFilePicker(),
        'save-drive': () => saveToDrive(),
        'save-local': () => saveLocal(),
        'print': () => printPDF(),

        // Edit
        'undo': () => PDFEditor.undo(),
        'redo': () => PDFEditor.redo(),
        'select-all': () => PDFEditor.selectAllPages(),
        'delete-page': () => deletePage(),

        // Tools
        'merge': () => PDFMerge.showMergeDialog(),
        'extract': () => PDFMerge.showExtractDialog(),
        'to-word': () => PDFConvert.convertToWord(),
        'edit-mode': () => PDFEditor.toggleEditMode(),

        // View
        'zoom-in': () => PDFViewer.zoomIn(),
        'zoom-out': () => PDFViewer.zoomOut(),
        'fit-page': () => PDFViewer.setZoom('fit'),
        'toggle-sidebar': () => togglePanel('sidebar'),
        'toggle-thumbnails': () => togglePanel('page-panel'),

        // Help
        'shortcuts': () => showShortcutsDialog(),
        'about': () => showAboutDialog(),
      };

      if (handlers[action]) handlers[action]();
    });
  }

  // ---- Context Menu Actions ----

  function bindContextActions() {
    document.addEventListener('context-action', (e) => {
      const action = e.detail.action;
      const handlers = {
        // Page context menu
        'ctx-extract': () => {
          const pages = PDFViewer.getSelectedPages();
          if (pages.length > 0) {
            PDFMerge.showExtractDialog();
          }
        },
        'ctx-delete': () => deletePage(),
        'ctx-move-up': () => PDFMerge.movePageUp(),
        'ctx-move-down': () => PDFMerge.movePageDown(),

        // File context menu
        'ctx-open-file': () => {
          const f = Drive.getSelectedDriveFile();
          if (f) Drive.loadFromDrive(f.id, f.name);
        },
        'ctx-download': () => {
          const f = Drive.getSelectedDriveFile();
          if (f) Drive.downloadFromDrive(f.id, f.name);
        },
        'ctx-rename': () => {
          const f = Drive.getSelectedDriveFile();
          if (f) {
            UI.showInputDialog({
              title: 'Rename',
              message: 'Enter new name:',
              defaultValue: f.name,
              onSubmit: (newName) => {
                if (newName && newName !== f.name) {
                  Drive.renameOnDrive(f.id, newName);
                }
              }
            });
          }
        },
        'ctx-delete-file': () => {
          const f = Drive.getSelectedDriveFile();
          if (f) {
            UI.showDialog({
              title: 'Confirm Delete',
              message: `Delete "${f.name}" from Google Drive?`,
              icon: '⚠️',
              buttons: ['Delete', 'Cancel'],
              onButton: (btn) => {
                if (btn === 'Delete') Drive.deleteFromDrive(f.id);
              }
            });
          }
        },
      };

      if (handlers[action]) handlers[action]();
    });
  }

  // ---- Keyboard Shortcuts ----

  function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't intercept when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') {
        if (e.key === 'Escape') {
          if (PDFEditor.isEditMode()) {
            PDFEditor.toggleEditMode();
          }
        }
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (ctrl && e.key === 'o') {
        e.preventDefault();
        FileManager.openFilePicker();
      } else if (ctrl && shift && e.key === 'S') {
        e.preventDefault();
        saveLocal();
      } else if (ctrl && e.key === 's') {
        e.preventDefault();
        saveFile();
      } else if (ctrl && e.key === 'p') {
        e.preventDefault();
        printPDF();
      } else if (ctrl && e.key === 'z') {
        e.preventDefault();
        PDFEditor.undo();
      } else if (ctrl && e.key === 'y') {
        e.preventDefault();
        PDFEditor.redo();
      } else if (ctrl && e.key === 'a') {
        e.preventDefault();
        PDFEditor.selectAllPages();
      } else if (ctrl && e.key === 'e') {
        e.preventDefault();
        PDFEditor.toggleEditMode();
      } else if (ctrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        PDFViewer.zoomIn();
      } else if (ctrl && e.key === '-') {
        e.preventDefault();
        PDFViewer.zoomOut();
      } else if (ctrl && e.key === '0') {
        e.preventDefault();
        PDFViewer.setZoom('fit');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!PDFEditor.isEditMode()) {
          e.preventDefault();
          deletePage();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        PDFViewer.prevPage();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        PDFViewer.nextPage();
      } else if (e.key === 'Home') {
        e.preventDefault();
        PDFViewer.goToPage(1);
      } else if (e.key === 'End') {
        const doc = PDFViewer.getActiveDoc();
        if (doc) {
          e.preventDefault();
          PDFViewer.goToPage(doc.pageCount);
        }
      } else if (e.key === 'Escape') {
        if (PDFEditor.isEditMode()) {
          PDFEditor.toggleEditMode();
        }
      }
    });
  }

  // ---- Title Bar Buttons ----

  function bindTitleBarButtons() {
    document.getElementById('btn-close').addEventListener('click', () => {
      UI.showDialog({
        title: 'Exit',
        message: 'Are you sure you want to close PDFeditor 98?',
        icon: '❓',
        buttons: ['OK', 'Cancel'],
        onButton: (btn) => {
          if (btn === 'OK') window.close();
        }
      });
    });

    document.getElementById('btn-minimize').addEventListener('click', () => {
      // Can't truly minimize a web page, just a visual nod
      UI.setStatus('Cannot minimize a web application.');
    });

    document.getElementById('btn-maximize').addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    });
  }

  // ---- Actions ----

  async function saveFile() {
    if (Drive.getIsSignedIn()) {
      saveToDrive();
    } else {
      saveLocal();
    }
  }

  async function saveToDrive() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    const data = await PDFEditor.getSaveData();
    if (data) {
      Drive.saveToDrive(data, doc.name);
    }
  }

  async function saveLocal() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    const data = await PDFEditor.getSaveData();
    if (data) {
      FileManager.saveLocalFile(data, doc.name);
    }
  }

  function deletePage() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    const selected = PDFViewer.getSelectedPages();
    const pages = selected.length > 0 ? selected : [doc.currentPage];

    if (pages.length >= doc.pageCount) {
      UI.showDialog({ title: 'Warning', message: 'Cannot delete all pages.', icon: '⚠️', buttons: ['OK'] });
      return;
    }

    UI.showDialog({
      title: 'Delete Pages',
      message: `Delete ${pages.length} page(s)?`,
      icon: '⚠️',
      buttons: ['Delete', 'Cancel'],
      onButton: (btn) => {
        if (btn === 'Delete') PDFEditor.deletePages(pages);
      }
    });
  }

  function printPDF() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    const blob = new Blob([doc.pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(url);
      }, 1000);
    };
  }

  function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle('collapsed');
  }

  // ---- Help Dialogs ----

  function showShortcutsDialog() {
    const shortcuts = [
      ['Ctrl+O', 'Open file'],
      ['Ctrl+S', 'Save'],
      ['Ctrl+Shift+S', 'Save local copy'],
      ['Ctrl+P', 'Print'],
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Y', 'Redo'],
      ['Ctrl+A', 'Select all pages'],
      ['Ctrl+E', 'Toggle edit mode'],
      ['Ctrl++', 'Zoom in'],
      ['Ctrl+-', 'Zoom out'],
      ['Ctrl+0', 'Fit page'],
      ['Delete', 'Delete selected pages'],
      ['←/→', 'Previous/Next page'],
      ['Home/End', 'First/Last page'],
      ['Escape', 'Exit edit mode'],
    ];

    const rows = shortcuts.map(([key, desc]) =>
      `<tr><td style="padding:2px 12px 2px 4px;font-weight:bold;white-space:nowrap;">${key}</td><td style="padding:2px 4px;">${desc}</td></tr>`
    ).join('');

    UI.showCustomDialog({
      title: 'Keyboard Shortcuts',
      content: `<table style="width:100%;border-collapse:collapse;">${rows}</table>`,
      buttons: ['OK'],
    });
  }

  function showAboutDialog() {
    UI.showDialog({
      title: 'About PDFeditor 98',
      message: `<b>PDFeditor 98</b><br><br>
        Version 1.0<br><br>
        A Windows 98-inspired PDF editor.<br>
        Open, view, edit, merge, extract, and convert PDFs.<br><br>
        Built with PDF.js, pdf-lib, and vanilla JavaScript.<br><br>
        &copy; 2025`,
      icon: '📄',
      buttons: ['OK']
    });
  }

  // ---- Start ----

  document.addEventListener('DOMContentLoaded', init);

  return { init };
})();
