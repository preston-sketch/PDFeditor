/**
 * PDF Viewer - PDF.js rendering, navigation, zoom, thumbnails, multi-file tabs
 * Renders all pages in a continuous scrollable view.
 */

const PDFViewer = (() => {
  // PDF.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // State
  const openDocs = []; // { id, name, pdfDoc, pdfBytes, pageCount, currentPage, zoom, thumbnails[] }
  let activeDocIndex = -1;
  let scrollTracking = true; // pause scroll tracking during programmatic scrolls

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
      await renderAllPages();
      await generateThumbnails(doc);
      updateUI();

      const PDF_OPEN_BUTTONS = [
        'tb-save', 'tb-print', 'tb-merge', 'tb-extract', 'tb-toword',
        'tb-zoomin', 'tb-zoomout', 'tb-fitpage', 'tb-editmode', 'tb-rotate',
        'side-merge', 'side-extract', 'side-toword',
        'side-print', 'side-save',
        'side-redact-draw', 'side-redact-search',
        'side-highlight', 'side-underline', 'side-sticky', 'side-draw', 'side-stamp',
        'side-rotate', 'side-crop', 'side-insert-blank', 'side-split', 'side-page-numbers',
        'side-fill-fields', 'side-add-fields', 'side-flatten',
        'side-to-images', 'side-compress'
      ];
      UI.enableToolbarButtons(PDF_OPEN_BUTTONS);

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

    renderAllPages();
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
      const PDF_CLOSE_BUTTONS = [
        'tb-save', 'tb-print', 'tb-merge', 'tb-extract', 'tb-toword',
        'tb-zoomin', 'tb-zoomout', 'tb-fitpage', 'tb-editmode', 'tb-rotate',
        'tb-undo', 'tb-redo',
        'side-merge', 'side-extract', 'side-toword',
        'side-print', 'side-save',
        'side-redact-draw', 'side-redact-search',
        'side-highlight', 'side-underline', 'side-sticky', 'side-draw', 'side-stamp',
        'side-rotate', 'side-crop', 'side-insert-blank', 'side-split', 'side-page-numbers',
        'side-fill-fields', 'side-add-fields', 'side-flatten',
        'side-to-images', 'side-compress'
      ];
      UI.disableToolbarButtons(PDF_CLOSE_BUTTONS);
    } else {
      activeDocIndex = Math.min(idx, openDocs.length - 1);
      switchToDocument(openDocs[activeDocIndex].id);
    }
  }

  // ---- Rendering (all pages) ----

  async function renderAllPages() {
    const doc = getActiveDoc();
    if (!doc) return;

    showRenderArea();
    renderArea.innerHTML = '';

    const scale = doc.zoom;
    const dpr = window.devicePixelRatio || 1;

    for (let i = 1; i <= doc.pageCount; i++) {
      try {
        const page = await doc.pdfDoc.getPage(i);
        const vp = page.getViewport({ scale });

        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.page = i;
        wrapper.style.width = vp.width + 'px';
        wrapper.style.height = vp.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.width = vp.width * dpr;
        canvas.height = vp.height * dpr;
        canvas.style.width = vp.width + 'px';
        canvas.style.height = vp.height + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        wrapper.appendChild(canvas);

        // Annotation overlay
        const annotOverlay = document.createElement('div');
        annotOverlay.className = 'annotation-overlay';
        annotOverlay.dataset.page = i;
        wrapper.appendChild(annotOverlay);

        // Redact overlay
        const redactOverlay = document.createElement('div');
        redactOverlay.className = 'redact-overlay';
        redactOverlay.dataset.page = i;
        wrapper.appendChild(redactOverlay);

        // Text edit overlay
        const textOverlay = document.createElement('div');
        textOverlay.className = 'text-edit-overlay';
        textOverlay.dataset.page = i;
        wrapper.appendChild(textOverlay);

        renderArea.appendChild(wrapper);

        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        // Notify editor about this page
        if (typeof PDFEditor !== 'undefined' && PDFEditor.onPageRendered) {
          PDFEditor.onPageRendered(wrapper, i);
        }
      } catch (err) {
        if (err.name !== 'RenderingCancelled') {
          console.error('Render error page ' + i + ':', err);
        }
      }
    }
  }

  // Keep backward compat — old code calls renderCurrentPage, now renders all
  async function renderCurrentPage() {
    return renderAllPages();
  }

  // ---- Scroll-based page tracking ----

  function initScrollTracking() {
    viewport.addEventListener('scroll', () => {
      if (!scrollTracking) return;
      const doc = getActiveDoc();
      if (!doc) return;

      const wrappers = renderArea.querySelectorAll('.pdf-page-wrapper');
      if (wrappers.length === 0) return;

      const viewportRect = viewport.getBoundingClientRect();
      const viewportMid = viewportRect.top + viewportRect.height / 2;

      let closestPage = 1;
      let closestDist = Infinity;

      wrappers.forEach(w => {
        const r = w.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const dist = Math.abs(mid - viewportMid);
        if (dist < closestDist) {
          closestDist = dist;
          closestPage = parseInt(w.dataset.page);
        }
      });

      if (closestPage !== doc.currentPage) {
        doc.currentPage = closestPage;
        updateUI();
        renderThumbnails();
      }
    });
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

      thumb.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
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

      thumb.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!doc.selectedPages.has(pageNum)) {
          doc.selectedPages.clear();
          doc.selectedPages.add(pageNum);
        }
        goToPage(pageNum);
        UI.showContextMenu('page-context-menu', e.clientX, e.clientY);
      });

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

  // ---- Navigation (scroll-to-page) ----

  function goToPage(pageNum) {
    const doc = getActiveDoc();
    if (!doc) return;
    pageNum = Math.max(1, Math.min(doc.pageCount, pageNum));
    doc.currentPage = pageNum;

    // Scroll to the page wrapper
    const wrapper = renderArea.querySelector(`.pdf-page-wrapper[data-page="${pageNum}"]`);
    if (wrapper) {
      scrollTracking = false;
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { scrollTracking = true; }, 500);
    }

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
      doc.pdfDoc.getPage(doc.currentPage).then(page => {
        const vp = page.getViewport({ scale: 1 });
        const scaleX = (viewport.clientWidth - 40) / vp.width;
        const scaleY = (viewport.clientHeight - 40) / vp.height;
        doc.zoom = Math.min(scaleX, scaleY);
        renderAllPages().then(() => goToPage(doc.currentPage));
        updateUI();
      });
      return;
    }

    doc.zoom = parseFloat(zoom);
    const currentPage = doc.currentPage;
    renderAllPages().then(() => goToPage(currentPage));
    updateUI();
  }

  function zoomIn() {
    const doc = getActiveDoc();
    if (!doc) return;
    doc.zoom = Math.min(4, doc.zoom + 0.25);
    const currentPage = doc.currentPage;
    renderAllPages().then(() => goToPage(currentPage));
    updateUI();
  }

  function zoomOut() {
    const doc = getActiveDoc();
    if (!doc) return;
    doc.zoom = Math.max(0.25, doc.zoom - 0.25);
    const currentPage = doc.currentPage;
    renderAllPages().then(() => goToPage(currentPage));
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

      const zoomVal = doc.zoom.toString();
      const opt = navZoom.querySelector(`option[value="${zoomVal}"]`);
      if (opt) {
        navZoom.value = zoomVal;
      } else {
        navZoom.value = '';
      }

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

    initScrollTracking();
  }

  // ---- Overlay Helpers (for other modules) ----

  function getOverlaysForType(type) {
    return renderArea.querySelectorAll(`.${type}[data-page]`);
  }

  function getOverlayForPage(type, pageNum) {
    return renderArea.querySelector(`.${type}[data-page="${pageNum}"]`);
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

    await renderAllPages();
    await generateThumbnails(doc);
    updateUI();

    // Scroll back to the page we were on
    goToPage(doc.currentPage);
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
    renderAllPages,
    renderThumbnails,
    generateThumbnails,
    updateUI,
    getOverlaysForType,
    getOverlayForPage,
  };
})();
