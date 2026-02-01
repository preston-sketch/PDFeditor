/**
 * PDF Redact - Draw-box redaction mode, search & redact
 */

const PDFRedact = (() => {
  let redactMode = false;
  let redactRects = []; // { pageNum, x, y, w, h, color }
  let isDrawing = false;
  let drawStart = null;
  let currentColor = 'black';

  // ---- Toggle Redact Mode ----

  function toggleRedactMode() {
    redactMode = !redactMode;
    const banner = document.getElementById('redact-mode-banner');

    if (redactMode) {
      banner.classList.add('visible');
      activateOverlays();
    } else {
      banner.classList.remove('visible');
      deactivateOverlays();
    }
  }

  function isRedactMode() {
    return redactMode;
  }

  function activateOverlays() {
    const overlays = PDFViewer.getOverlaysForType('redact-overlay');
    overlays.forEach(overlay => {
      overlay.classList.add('active');
      overlay.addEventListener('mousedown', onMouseDown);
      overlay.addEventListener('mousemove', onMouseMove);
      overlay.addEventListener('mouseup', onMouseUp);
    });
    renderRedactRects();
  }

  function deactivateOverlays() {
    const overlays = PDFViewer.getOverlaysForType('redact-overlay');
    overlays.forEach(overlay => {
      overlay.classList.remove('active');
      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('mouseup', onMouseUp);
    });
  }

  // ---- Drawing Rectangles ----

  function onMouseDown(e) {
    if (e.target !== e.currentTarget && !e.target.classList.contains('redact-rect')) {
      return;
    }
    if (e.target.classList.contains('redact-rect')) return; // clicking existing rect

    const overlay = e.currentTarget;
    const rect = overlay.getBoundingClientRect();
    isDrawing = true;
    drawStart = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      overlay: overlay
    };

    // Create preview rect
    const preview = document.createElement('div');
    preview.className = 'redact-rect preview';
    preview.style.left = drawStart.x + 'px';
    preview.style.top = drawStart.y + 'px';
    preview.style.width = '0px';
    preview.style.height = '0px';
    overlay.appendChild(preview);
  }

  function onMouseMove(e) {
    if (!isDrawing || !drawStart) return;
    const overlay = drawStart.overlay;
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const preview = overlay.querySelector('.redact-rect.preview');
    if (!preview) return;

    const left = Math.min(drawStart.x, x);
    const top = Math.min(drawStart.y, y);
    const width = Math.abs(x - drawStart.x);
    const height = Math.abs(y - drawStart.y);

    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
    preview.style.width = width + 'px';
    preview.style.height = height + 'px';
  }

  function onMouseUp(e) {
    if (!isDrawing || !drawStart) return;
    isDrawing = false;

    const overlay = drawStart.overlay;
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const left = Math.min(drawStart.x, x);
    const top = Math.min(drawStart.y, y);
    const width = Math.abs(x - drawStart.x);
    const height = Math.abs(y - drawStart.y);

    // Remove preview
    const preview = overlay.querySelector('.redact-rect.preview');
    if (preview) preview.remove();

    // Minimum size check
    if (width < 5 || height < 5) {
      drawStart = null;
      return;
    }

    const pageNum = parseInt(overlay.dataset.page);
    if (!pageNum) {
      drawStart = null;
      return;
    }

    redactRects.push({
      pageNum: pageNum,
      x: left, y: top, w: width, h: height,
      color: currentColor
    });

    drawStart = null;
    renderRedactRects();
  }

  function renderRedactRects() {
    // Render rects on each page's overlay
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    for (let p = 1; p <= doc.pageCount; p++) {
      const overlay = PDFViewer.getOverlayForPage('redact-overlay', p);
      if (!overlay) continue;

      // Clear existing (except preview)
      overlay.querySelectorAll('.redact-rect:not(.preview)').forEach(el => el.remove());

      const pageRects = redactRects.filter(r => r.pageNum === p);
      pageRects.forEach((r) => {
        const el = document.createElement('div');
        el.className = 'redact-rect' + (r.color === 'white' ? ' white' : '');
        el.style.left = r.x + 'px';
        el.style.top = r.y + 'px';
        el.style.width = r.w + 'px';
        el.style.height = r.h + 'px';
        el.title = 'Right-click to remove';

        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const rIdx = redactRects.indexOf(r);
          if (rIdx !== -1) redactRects.splice(rIdx, 1);
          renderRedactRects();
        });

        overlay.appendChild(el);
      });
    }

    // Show apply button if there are rects
    if (redactRects.length > 0 && !document.getElementById('redact-apply-bar')) {
      showApplyBar();
    } else if (redactRects.length === 0) {
      const bar = document.getElementById('redact-apply-bar');
      if (bar) bar.remove();
    }
  }

  function showApplyBar() {
    const existing = document.getElementById('redact-apply-bar');
    if (existing) return;

    const bar = document.createElement('div');
    bar.id = 'redact-apply-bar';
    bar.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:var(--win98-bg);border:2px solid;border-color:var(--win98-button-highlight) var(--win98-button-dark-shadow) var(--win98-button-dark-shadow) var(--win98-button-highlight);padding:6px 12px;z-index:100;display:flex;gap:8px;align-items:center;font-size:11px;';

    bar.innerHTML = `
      <span>${redactRects.length} redaction(s)</span>
      <select class="win98-input" id="redact-color-select" style="width:80px;">
        <option value="black">Black</option>
        <option value="white">White</option>
      </select>
      <button class="win98-button" id="redact-apply-btn">Apply</button>
      <button class="win98-button" id="redact-clear-btn">Clear All</button>
    `;

    document.body.appendChild(bar);

    document.getElementById('redact-color-select').addEventListener('change', (e) => {
      currentColor = e.target.value;
    });

    document.getElementById('redact-apply-btn').addEventListener('click', () => applyRedactions());
    document.getElementById('redact-clear-btn').addEventListener('click', () => {
      redactRects = [];
      renderRedactRects();
      const b = document.getElementById('redact-apply-bar');
      if (b) b.remove();
    });
  }

  // ---- Apply Redactions ----

  async function applyRedactions() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc || redactRects.length === 0) return;

    UI.setStatus('Applying redactions...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument, rgb } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const pages = pdfDoc.getPages();
      const zoom = doc.zoom;

      for (const r of redactRects) {
        const page = pages[r.pageNum - 1];
        if (!page) continue;

        const { height } = page.getSize();
        const color = r.color === 'white' ? rgb(1, 1, 1) : rgb(0, 0, 0);

        page.drawRectangle({
          x: r.x / zoom,
          y: height - (r.y / zoom) - (r.h / zoom),
          width: r.w / zoom,
          height: r.h / zoom,
          color,
        });
      }

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'redact', prevBytes: doc.pdfBytes });

      redactRects = [];
      const bar = document.getElementById('redact-apply-bar');
      if (bar) bar.remove();

      await PDFViewer.refreshDocument(newBytes);

      UI.showDialog({
        title: 'Redaction Applied',
        message: 'Redaction rectangles have been drawn on the PDF.\n\nNote: This is a visual redaction — rectangles are drawn over the content but underlying text data in the PDF content stream is not removed.',
        icon: 'ℹ️',
        buttons: ['OK']
      });

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Redact apply error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to apply redactions.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Search & Redact ----

  function showSearchRedactDialog() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) {
      UI.showDialog({ title: 'Search & Redact', message: 'No document open.', icon: 'ℹ️', buttons: ['OK'] });
      return;
    }

    const content = `
      <p style="margin-bottom:8px">Search for text to redact across all pages:</p>
      <div style="display:flex;gap:4px;margin-bottom:8px;">
        <input type="text" class="win98-input" id="search-redact-term" placeholder="Search text..." style="flex:1;">
        <button class="win98-button" id="search-redact-find">Find</button>
      </div>
      <div id="search-redact-results" style="max-height:150px;overflow-y:auto;background:var(--win98-white);border:2px inset;padding:4px;font-size:11px;">
        Enter a search term and click Find.
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
        <label style="font-size:11px;">Color:</label>
        <select class="win98-input" id="search-redact-color" style="width:80px;">
          <option value="black">Black</option>
          <option value="white">White</option>
        </select>
      </div>
      <p style="margin-top:8px;font-size:11px;color:#808080;">
        Note: Visual redaction only — overlays rectangles over matching text positions.
      </p>
    `;

    const { overlay, dialog } = UI.showCustomDialog({
      title: 'Search & Redact',
      content,
      buttons: ['Redact All', 'Cancel'],
      onButton: async (btn) => {
        if (btn === 'Redact All') {
          const term = dialog.querySelector('#search-redact-term').value.trim();
          const color = dialog.querySelector('#search-redact-color').value;
          if (term) {
            await executeSearchRedact(term, color);
          }
        }
      }
    });

    // Find button
    dialog.querySelector('#search-redact-find').addEventListener('click', async () => {
      const term = dialog.querySelector('#search-redact-term').value.trim();
      if (!term) return;

      const resultsDiv = dialog.querySelector('#search-redact-results');
      resultsDiv.innerHTML = 'Searching...';

      const matches = await findTextPositions(term);
      if (matches.length === 0) {
        resultsDiv.innerHTML = 'No matches found.';
      } else {
        resultsDiv.innerHTML = matches.map(m =>
          `<div style="padding:2px;">Page ${m.pageNum}: "${m.text}" (${Math.round(m.x)}, ${Math.round(m.y)})</div>`
        ).join('');
      }
    });
  }

  async function findTextPositions(searchTerm) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return [];

    const matches = [];
    const lowerTerm = searchTerm.toLowerCase();

    for (let i = 1; i <= doc.pageCount; i++) {
      const page = await doc.pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });

      for (const item of textContent.items) {
        if (item.str.toLowerCase().includes(lowerTerm)) {
          const tx = item.transform;
          matches.push({
            pageNum: i,
            text: item.str,
            x: tx[4],
            y: viewport.height - tx[5],
            w: item.width || (item.str.length * 6),
            h: item.height || 12,
          });
        }
      }
    }

    return matches;
  }

  async function executeSearchRedact(term, color) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Applying search redactions...');
    document.body.classList.add('wait-cursor');

    try {
      const matches = await findTextPositions(term);
      if (matches.length === 0) {
        UI.showDialog({ title: 'Search & Redact', message: 'No matches found.', icon: 'ℹ️', buttons: ['OK'] });
        UI.setStatus('Ready.');
        return;
      }

      const { PDFDocument, rgb } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const pages = pdfDoc.getPages();
      const fillColor = color === 'white' ? rgb(1, 1, 1) : rgb(0, 0, 0);

      for (const m of matches) {
        const page = pages[m.pageNum - 1];
        if (!page) continue;

        const { height } = page.getSize();

        page.drawRectangle({
          x: m.x - 1,
          y: height - m.y - m.h,
          width: m.w + 2,
          height: m.h + 2,
          color: fillColor,
        });
      }

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'search-redact', prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes);

      UI.showDialog({
        title: 'Search & Redact',
        message: `Redacted ${matches.length} occurrence(s) of "${term}".\n\nNote: Visual redaction only.`,
        icon: 'ℹ️',
        buttons: ['OK']
      });

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Search redact error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to apply search redaction.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  return {
    toggleRedactMode,
    isRedactMode,
    showSearchRedactDialog,
  };
})();
