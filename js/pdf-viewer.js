/**
 * PDF Viewer - PDF.js rendering, navigation, zoom, thumbnails, multi-file tabs
 */

const PDFViewer = (() => {
  // PDF.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // State
  const openDocs = []; // { id, name, pdfDoc, pdfBytes, pageCount, currentPage, zoom, thumbnails[] }
  let activeDocIndex = -1;
  let renderTask = null;

  // Elements
  const canvasTabs = document.getElementById('canvas-tabs');
  const viewport = document.getElementById('canvas-viewport');
  const dropZone = document.getElementById('drop-zone');
  const renderArea = document.getElementById('pdf-render-area');
  const canvasNav = document.getElementById('canvas-nav');
  const navPage = document.getElementById('nav-page');
  const navTotal = document.getElementById('nav-total');
  const navZoom = document.getElementById('nav-zoom');
  const thumbnailContainer = document.getElementById('page-thumbnails');

  let nextDocId = 1;

  // ---- Load PDF ----

  async function loadPDF(arrayBuffer, fileName) {
    UI.setStatus(`Loading ${fileName}...`);
    document.body.classList.add('wait-cursor');

    try {
      const pdfBytes = new Uint8Array(arrayBuffer);
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
      const pdfDoc = await loadingTask.promise;

      const doc = {
        id: nextDocId++,
        name: fileName,
        pdfDoc: pdfDoc,
        pdfBytes: arrayBuffer,
        pageCount: pdfDoc.numPages,
        currentPage: 1,
        zoom: 1,
        thumbnails: [],
        selectedPages: new Set(),
      };

      openDocs.push(doc);
      activeDocIndex = openDocs.length - 1;

      createTab(doc);
      await renderCurrentPage();
      await generateThumbnails(doc);
      updateUI();

      UI.enableToolbarButtons([
        'tb-save', 'tb-print', 'tb-merge', 'tb-extract', 'tb-toword',
        'tb-zoomin', 'tb-zoomout', 'tb-fitpage', 'tb-editmode',
        'side-merge', 'side-extract', 'side-edit', 'side-toword',
        'side-print', 'side-save'
      ]);

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Failed to load PDF:', err);
      UI.showDialog({
        title: 'Error',
        message: `Failed to load "${fileName}".\n\n${err.message}`,
        icon: '❌',
        buttons: ['OK']
      });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Tabs ----

  function createTab(doc) {
    const tab = document.createElement('div');
    tab.className = 'canvas-tab active';
    tab.dataset.docId = doc.id;
    tab.innerHTML = `
      <span class="canvas-tab-title">${escapeHtml(doc.name)}</span>
      <span class="canvas-tab-close" title="Close">✕</span>
    `;

    // Deactivate other tabs
    canvasTabs.querySelectorAll('.canvas-tab').forEach(t => t.classList.remove('active'));

    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('canvas-tab-close')) {
        closeDocument(doc.id);
        return;
      }
      switchToDocument(doc.id);
    });

    canvasTabs.appendChild(tab);
  }

  function switchToDocument(docId) {
    const idx = openDocs.findIndex(d => d.id === docId);
    if (idx === -1) return;
    activeDocIndex = idx;

    canvasTabs.querySelectorAll('.canvas-tab').forEach(t => {
      t.classList.toggle('active', parseInt(t.dataset.docId) === docId);
    });

    renderCurrentPage();
    renderThumbnails();
    updateUI();
  }

  function closeDocument(docId) {
    const idx = openDocs.findIndex(d => d.id === docId);
    if (idx === -1) return;

    openDocs.splice(idx, 1);
    const tab = canvasTabs.querySelector(`[data-doc-id="${docId}"]`);
    if (tab) tab.remove();

    if (openDocs.length === 0) {
      activeDocIndex = -1;
      showDropZone();
      updateUI();
      UI.disableToolbarButtons([
        'tb-save', 'tb-print', 'tb-merge', 'tb-extract', 'tb-toword',
        'tb-zoomin', 'tb-zoomout', 'tb-fitpage', 'tb-editmode',
        'tb-undo', 'tb-redo',
        'side-merge', 'side-extract', 'side-edit', 'side-toword',
        'side-print', 'side-save'
      ]);
    } else {
      activeDocIndex = Math.min(idx, openDocs.length - 1);
      switchToDocument(openDocs[activeDocIndex].id);
    }
  }

  // ---- Rendering ----

  async function renderCurrentPage() {
    const doc = getActiveDoc();
    if (!doc) return;

    showRenderArea();

    try {
      const page = await doc.pdfDoc.getPage(doc.currentPage);
      const scale = doc.zoom;
      const vp = page.getViewport({ scale });

      renderArea.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page-wrapper';
      wrapper.style.width = vp.width + 'px';
      wrapper.style.height = vp.height + 'px';

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.width = vp.width * (window.devicePixelRatio || 1);
      canvas.height = vp.height * (window.devicePixelRatio || 1);
      canvas.style.width = vp.width + 'px';
      canvas.style.height = vp.height + 'px';

      const ctx = canvas.getContext('2d');
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

      wrapper.appendChild(canvas);

      // Text edit overlay
      const overlay = document.createElement('div');
      overlay.className = 'text-edit-overlay';
      overlay.id = 'text-edit-overlay';
      wrapper.appendChild(overlay);

      renderArea.appendChild(wrapper);

      if (renderTask) {
        try { renderTask.cancel(); } catch (e) {}
      }

      renderTask = page.render({ canvasContext: ctx, viewport: vp });
      await renderTask.promise;
      renderTask = null;

      // Notify editor about page render
      if (typeof PDFEditor !== 'undefined' && PDFEditor.onPageRendered) {
        PDFEditor.onPageRendered(wrapper, doc.currentPage);
      }

    } catch (err) {
      if (err.name !== 'RenderingCancelled') {
        console.error('Render error:', err);
      }
    }
  }

  // ---- Thumbnails ----

  async function generateThumbnails(doc) {
    doc.thumbnails = [];
    const thumbWidth = 100;

    for (let i = 1; i <= doc.pageCount; i++) {
      try {
        const page = await doc.pdfDoc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const scale = thumbWidth / vp.width;
        const scaledVp = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = scaledVp.width;
        canvas.height = scaledVp.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: scaledVp }).promise;
        doc.thumbnails.push(canvas);
      } catch (e) {
        // placeholder
        const canvas = document.createElement('canvas');
        canvas.width = thumbWidth;
        canvas.height = 140;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, thumbWidth, 140);
        ctx.fillStyle = '#ccc';
        ctx.fillText('Page ' + i, 10, 70);
        doc.thumbnails.push(canvas);
      }
    }

    renderThumbnails();
  }

  function renderThumbnails() {
    const doc = getActiveDoc();
    if (!doc) {
      thumbnailContainer.innerHTML = '<div class="empty-panel-msg">No pages to display.</div>';
      return;
    }

    thumbnailContainer.innerHTML = '';
    doc.thumbnails.forEach((canvas, i) => {
      const pageNum = i + 1;
      const thumb = document.createElement('div');
      thumb.className = 'page-thumbnail';
      thumb.dataset.page = pageNum;

      if (pageNum === doc.currentPage) thumb.classList.add('active');
      if (doc.selectedPages.has(pageNum)) thumb.classList.add('selected');

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = canvas.width;
      thumbCanvas.height = canvas.height;
      thumbCanvas.getContext('2d').drawImage(canvas, 0, 0);

      const label = document.createElement('div');
      label.className = 'page-thumbnail-label';
      label.textContent = pageNum;

      thumb.appendChild(thumbCanvas);
      thumb.appendChild(label);

      // Click to navigate
      thumb.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          // Multi-select
          if (doc.selectedPages.has(pageNum)) {
            doc.selectedPages.delete(pageNum);
          } else {
            doc.selectedPages.add(pageNum);
          }
          renderThumbnails();
          updateSelectionInfo();
        } else {
          doc.selectedPages.clear();
          goToPage(pageNum);
        }
      });

      // Right-click context menu
      thumb.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!doc.selectedPages.has(pageNum)) {
          doc.selectedPages.clear();
          doc.selectedPages.add(pageNum);
        }
        goToPage(pageNum);
        UI.showContextMenu('page-context-menu', e.clientX, e.clientY);
      });

      // Drag for reorder
      thumb.draggable = true;
      thumb.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', pageNum.toString());
        e.dataTransfer.effectAllowed = 'move';
        thumb.style.opacity = '0.5';
      });
      thumb.addEventListener('dragend', () => {
        thumb.style.opacity = '1';
        thumbnailContainer.querySelectorAll('.page-thumbnail').forEach(t => t.classList.remove('drag-over'));
      });
      thumb.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        thumb.classList.add('drag-over');
      });
      thumb.addEventListener('dragleave', () => {
        thumb.classList.remove('drag-over');
      });
      thumb.addEventListener('drop', (e) => {
        e.preventDefault();
        thumb.classList.remove('drag-over');
        const fromPage = parseInt(e.dataTransfer.getData('text/plain'));
        const toPage = pageNum;
        if (fromPage !== toPage && typeof PDFEditor !== 'undefined') {
          PDFEditor.reorderPage(fromPage, toPage);
        }
      });

      thumbnailContainer.appendChild(thumb);
    });
  }

  function updateSelectionInfo() {
    const doc = getActiveDoc();
    const bar = document.getElementById('selection-info');
    const count = document.getElementById('selection-count');
    if (!doc || doc.selectedPages.size === 0) {
      bar.classList.remove('visible');
    } else {
      bar.classList.add('visible');
      count.textContent = doc.selectedPages.size;
    }
  }

  // ---- Navigation ----

  function goToPage(pageNum) {
    const doc = getActiveDoc();
    if (!doc) return;
    pageNum = Math.max(1, Math.min(doc.pageCount, pageNum));
    doc.currentPage = pageNum;
    renderCurrentPage();
    renderThumbnails();
    updateUI();
  }

  function nextPage() {
    const doc = getActiveDoc();
    if (doc && doc.currentPage < doc.pageCount) goToPage(doc.currentPage + 1);
  }

  function prevPage() {
    const doc = getActiveDoc();
    if (doc && doc.currentPage > 1) goToPage(doc.currentPage - 1);
  }

  function firstPage() {
    goToPage(1);
  }

  function lastPage() {
    const doc = getActiveDoc();
    if (doc) goToPage(doc.pageCount);
  }

  // ---- Zoom ----

  function setZoom(zoom) {
    const doc = getActiveDoc();
    if (!doc) return;

    if (zoom === 'fit') {
      const viewportEl = document.getElementById('canvas-viewport');
      doc.pdfDoc.getPage(doc.currentPage).then(page => {
        const vp = page.getViewport({ scale: 1 });
        const scaleX = (viewportEl.clientWidth - 40) / vp.width;
        const scaleY = (viewportEl.clientHeight - 40) / vp.height;
        doc.zoom = Math.min(scaleX, scaleY);
        renderCurrentPage();
        updateUI();
      });
      return;
    }

    doc.zoom = parseFloat(zoom);
    renderCurrentPage();
    updateUI();
  }

  function zoomIn() {
    const doc = getActiveDoc();
    if (!doc) return;
    doc.zoom = Math.min(4, doc.zoom + 0.25);
    renderCurrentPage();
    updateUI();
  }

  function zoomOut() {
    const doc = getActiveDoc();
    if (!doc) return;
    doc.zoom = Math.max(0.25, doc.zoom - 0.25);
    renderCurrentPage();
    updateUI();
  }

  // ---- UI Updates ----

  function showDropZone() {
    dropZone.classList.remove('drop-zone-hidden');
    renderArea.classList.remove('visible');
    canvasNav.classList.remove('visible');
  }

  function showRenderArea() {
    dropZone.classList.add('drop-zone-hidden');
    renderArea.classList.add('visible');
    canvasNav.classList.add('visible');
  }

  function updateUI() {
    const doc = getActiveDoc();
    if (doc) {
      navPage.value = doc.currentPage;
      navTotal.textContent = doc.pageCount;
      UI.setPageStatus(doc.currentPage, doc.pageCount);
      UI.setZoomStatus(doc.zoom);

      // Update zoom select
      const zoomVal = doc.zoom.toString();
      const opt = navZoom.querySelector(`option[value="${zoomVal}"]`);
      if (opt) {
        navZoom.value = zoomVal;
      } else {
        navZoom.value = '';
      }

      // Update title
      document.getElementById('titlebar-text').textContent = `${doc.name} - PDFeditor 98`;
    } else {
      navPage.value = '';
      navTotal.textContent = '0';
      UI.setPageStatus(0, 0);
      UI.setZoomStatus(1);
      document.getElementById('titlebar-text').textContent = 'PDFeditor 98';
    }

    updateSelectionInfo();
  }

  // ---- Init Navigation Events ----

  function initNavigation() {
    document.getElementById('nav-first').addEventListener('click', firstPage);
    document.getElementById('nav-prev').addEventListener('click', prevPage);
    document.getElementById('nav-next').addEventListener('click', nextPage);
    document.getElementById('nav-last').addEventListener('click', lastPage);

    navPage.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const page = parseInt(navPage.value);
        if (!isNaN(page)) goToPage(page);
      }
    });

    navZoom.addEventListener('change', () => {
      setZoom(navZoom.value);
    });
  }

  // ---- Getters ----

  function getActiveDoc() {
    if (activeDocIndex < 0 || activeDocIndex >= openDocs.length) return null;
    return openDocs[activeDocIndex];
  }

  function getAllDocs() {
    return openDocs;
  }

  function getSelectedPages() {
    const doc = getActiveDoc();
    if (!doc) return [];
    return Array.from(doc.selectedPages).sort((a, b) => a - b);
  }

  // ---- Refresh after edit ----

  async function refreshDocument(pdfBytes, keepPage) {
    const doc = getActiveDoc();
    if (!doc) return;

    const currentPage = keepPage || doc.currentPage;

    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise;
    doc.pdfDoc = pdfDoc;
    doc.pdfBytes = pdfBytes;
    doc.pageCount = pdfDoc.numPages;
    doc.currentPage = Math.min(currentPage, doc.pageCount);
    doc.selectedPages.clear();

    await renderCurrentPage();
    await generateThumbnails(doc);
    updateUI();
  }

  // ---- Helpers ----

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Init ----

  function init() {
    initNavigation();
  }

  return {
    init,
    loadPDF,
    getActiveDoc,
    getAllDocs,
    getSelectedPages,
    goToPage,
    nextPage,
    prevPage,
    zoomIn,
    zoomOut,
    setZoom,
    closeDocument,
    refreshDocument,
    renderCurrentPage,
    renderThumbnails,
    generateThumbnails,
    updateUI,
  };
})();
