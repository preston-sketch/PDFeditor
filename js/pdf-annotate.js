/**
 * PDF Annotate - Highlight, underline, sticky notes, freehand draw, stamps
 */

const PDFAnnotate = (() => {
  let activeAnnotTool = null; // 'highlight', 'underline', 'sticky', 'draw'
  let annotations = []; // { type, pageNum, x, y, w, h, ... }
  let drawPaths = []; // { pageNum, points: [{x,y}], color, width }
  let stickyNotes = []; // { pageNum, x, y, text }
  let isDrawing = false;
  let currentPath = null;

  // ---- Activate / Deactivate ----

  function activate(tool) {
    activeAnnotTool = tool;
    const banner = document.getElementById('annotate-mode-banner');
    banner.classList.add('visible');

    const overlays = PDFViewer.getOverlaysForType('annotation-overlay');
    overlays.forEach(overlay => {
      overlay.classList.add('active');
      overlay.style.cursor = getCursorForTool(tool);
    });

    if (tool === 'draw') {
      setupDrawCanvases();
    }

    if (tool === 'highlight' || tool === 'underline') {
      setupAnnotClickHandler();
    }

    if (tool === 'sticky') {
      setupStickyHandler();
    }
  }

  function deactivate() {
    activeAnnotTool = null;
    const banner = document.getElementById('annotate-mode-banner');
    banner.classList.remove('visible');

    const overlays = PDFViewer.getOverlaysForType('annotation-overlay');
    overlays.forEach(overlay => {
      overlay.classList.remove('active');
      overlay.style.cursor = '';
    });

    teardownDrawCanvases();
    teardownAnnotClickHandler();
    teardownStickyHandler();
  }

  function getCursorForTool(tool) {
    switch (tool) {
      case 'highlight': return 'text';
      case 'underline': return 'text';
      case 'sticky': return 'crosshair';
      case 'draw': return 'crosshair';
      default: return 'default';
    }
  }

  // ---- Highlight & Underline ----

  let annotClickHandler = null;

  function setupAnnotClickHandler() {
    annotClickHandler = (e) => {
      if (e.target !== e.currentTarget) return;
      const overlay = e.currentTarget;
      const rect = overlay.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pageNum = parseInt(overlay.dataset.page);
      if (!pageNum) return;

      const annot = {
        type: activeAnnotTool,
        pageNum: pageNum,
        x: x - 40,
        y: y - 4,
        w: 80,
        h: activeAnnotTool === 'highlight' ? 16 : 2,
      };

      annotations.push(annot);
      renderAnnotations();
    };

    const overlays = PDFViewer.getOverlaysForType('annotation-overlay');
    overlays.forEach(overlay => {
      overlay.addEventListener('click', annotClickHandler);
    });
  }

  function teardownAnnotClickHandler() {
    if (annotClickHandler) {
      const overlays = PDFViewer.getOverlaysForType('annotation-overlay');
      overlays.forEach(overlay => {
        overlay.removeEventListener('click', annotClickHandler);
      });
      annotClickHandler = null;
    }
  }

  function renderAnnotations() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    for (let p = 1; p <= doc.pageCount; p++) {
      const overlay = PDFViewer.getOverlayForPage('annotation-overlay', p);
      if (!overlay) continue;

      // Clear existing annotation elements
      overlay.querySelectorAll('.annotation-highlight, .annotation-underline').forEach(el => el.remove());

      const pageAnnots = annotations.filter(a => a.pageNum === p);
      for (const a of pageAnnots) {
        const el = document.createElement('div');
        el.className = a.type === 'highlight' ? 'annotation-highlight' : 'annotation-underline';
        el.style.left = a.x + 'px';
        el.style.top = a.y + 'px';
        el.style.width = a.w + 'px';
        el.style.height = a.h + 'px';

        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const idx = annotations.indexOf(a);
          if (idx !== -1) annotations.splice(idx, 1);
          renderAnnotations();
        });

        overlay.appendChild(el);
      }
    }
  }

  // ---- Sticky Notes ----

  let stickyClickHandler = null;

  function setupStickyHandler() {
    stickyClickHandler = (e) => {
      if (e.target !== e.currentTarget) return;
      const overlay = e.currentTarget;
      const rect = overlay.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pageNum = parseInt(overlay.dataset.page);
      if (!pageNum) return;

      stickyNotes.push({
        pageNum: pageNum,
        x, y,
        text: '',
      });

      renderStickyNotes();
    };

    const overlays = PDFViewer.getOverlaysForType('annotation-overlay');
    overlays.forEach(overlay => {
      overlay.addEventListener('click', stickyClickHandler);
    });
  }

  function teardownStickyHandler() {
    if (stickyClickHandler) {
      const overlays = PDFViewer.getOverlaysForType('annotation-overlay');
      overlays.forEach(overlay => {
        overlay.removeEventListener('click', stickyClickHandler);
      });
      stickyClickHandler = null;
    }
  }

  function renderStickyNotes() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    for (let p = 1; p <= doc.pageCount; p++) {
      const overlay = PDFViewer.getOverlayForPage('annotation-overlay', p);
      if (!overlay) continue;

      overlay.querySelectorAll('.sticky-note-icon, .sticky-note-popup').forEach(el => el.remove());

      const pageNotes = stickyNotes.filter(n => n.pageNum === p);
      for (const note of pageNotes) {
        const icon = document.createElement('div');
        icon.className = 'sticky-note-icon';
        icon.textContent = '📌';
        icon.style.left = note.x + 'px';
        icon.style.top = note.y + 'px';

        icon.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleStickyPopup(note, icon, overlay);
        });

        icon.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const idx = stickyNotes.indexOf(note);
          if (idx !== -1) stickyNotes.splice(idx, 1);
          renderStickyNotes();
        });

        overlay.appendChild(icon);
      }
    }
  }

  function toggleStickyPopup(note, iconEl, overlay) {
    const existing = iconEl.nextElementSibling;
    if (existing && existing.classList.contains('sticky-note-popup')) {
      existing.remove();
      return;
    }

    const popup = document.createElement('div');
    popup.className = 'sticky-note-popup';
    popup.style.left = (note.x + 28) + 'px';
    popup.style.top = note.y + 'px';

    popup.innerHTML = `
      <span class="sticky-close">✕</span>
      <textarea>${note.text}</textarea>
    `;

    popup.querySelector('.sticky-close').addEventListener('click', () => popup.remove());
    popup.querySelector('textarea').addEventListener('input', (e) => {
      note.text = e.target.value;
    });

    overlay.appendChild(popup);
    popup.querySelector('textarea').focus();
  }

  // ---- Freehand Drawing ----

  let drawCanvases = []; // { canvas, ctx, pageNum }

  function setupDrawCanvases() {
    teardownDrawCanvases();

    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    for (let p = 1; p <= doc.pageCount; p++) {
      const wrapper = document.querySelector(`.pdf-page-wrapper[data-page="${p}"]`);
      if (!wrapper) continue;

      const canvas = document.createElement('canvas');
      canvas.className = 'draw-canvas active';
      canvas.dataset.page = p;
      canvas.width = wrapper.offsetWidth;
      canvas.height = wrapper.offsetHeight;
      canvas.style.width = wrapper.offsetWidth + 'px';
      canvas.style.height = wrapper.offsetHeight + 'px';
      wrapper.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      canvas.addEventListener('mousedown', onDrawStart);
      canvas.addEventListener('mousemove', onDrawMove);
      canvas.addEventListener('mouseup', onDrawEnd);

      drawCanvases.push({ canvas, ctx, pageNum: p });

      // Render existing paths for this page
      renderDrawPathsForPage(p, ctx, canvas);
    }
  }

  function teardownDrawCanvases() {
    drawCanvases.forEach(({ canvas }) => canvas.remove());
    drawCanvases = [];
  }

  function onDrawStart(e) {
    isDrawing = true;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const pageNum = parseInt(canvas.dataset.page) || 1;
    currentPath = {
      pageNum: pageNum,
      points: [{ x: e.clientX - rect.left, y: e.clientY - rect.top }],
      color: '#FF0000',
      width: 2,
    };
  }

  function onDrawMove(e) {
    if (!isDrawing || !currentPath) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    currentPath.points.push(point);

    // Draw live on the correct canvas
    const entry = drawCanvases.find(dc => dc.canvas === canvas);
    if (entry && currentPath.points.length > 1) {
      const pts = currentPath.points;
      entry.ctx.beginPath();
      entry.ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      entry.ctx.lineTo(point.x, point.y);
      entry.ctx.stroke();
    }
  }

  function onDrawEnd() {
    if (!isDrawing || !currentPath) return;
    isDrawing = false;
    if (currentPath.points.length > 1) {
      drawPaths.push(currentPath);
    }
    currentPath = null;
  }

  function renderDrawPathsForPage(pageNum, ctx, canvas) {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pagePaths = drawPaths.filter(p => p.pageNum === pageNum);
    for (const path of pagePaths) {
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.width;
      ctx.beginPath();
      if (path.points.length > 0) {
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.stroke();
      }
    }
  }

  // ---- Stamps ----

  function showStampDialog() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) {
      UI.showDialog({ title: 'Stamp', message: 'No document open.', icon: 'ℹ️', buttons: ['OK'] });
      return;
    }

    const content = `
      <p style="margin-bottom:8px">Select a stamp to apply to the current page:</p>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label><input type="radio" name="stamp-type" value="DRAFT" checked> DRAFT</label>
        <label><input type="radio" name="stamp-type" value="CONFIDENTIAL"> CONFIDENTIAL</label>
        <label><input type="radio" name="stamp-type" value="PAST DUE"> PAST DUE</label>
        <label><input type="radio" name="stamp-type" value="APPROVED"> APPROVED</label>
        <label><input type="radio" name="stamp-type" value="REJECTED"> REJECTED</label>
      </div>
      <div style="margin-top:8px;display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;">
        <label style="font-size:11px;">Color:</label>
        <select class="win98-input" id="stamp-color" style="width:100px;">
          <option value="red">Red</option>
          <option value="blue">Blue</option>
          <option value="gray">Gray</option>
        </select>
        <label style="font-size:11px;">Apply to:</label>
        <select class="win98-input" id="stamp-scope" style="width:150px;">
          <option value="current">Current Page</option>
          <option value="all">All Pages</option>
        </select>
      </div>
    `;

    UI.showCustomDialog({
      title: 'Apply Stamp',
      content,
      buttons: ['Apply', 'Cancel'],
      onButton: async (btn, dialog) => {
        if (btn === 'Apply') {
          const stampType = dialog.querySelector('input[name="stamp-type"]:checked').value;
          const color = dialog.querySelector('#stamp-color').value;
          const scope = dialog.querySelector('#stamp-scope').value;
          await applyStamp(stampType, color, scope);
        }
      }
    });
  }

  async function applyStamp(text, colorName, scope) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Applying stamp...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const pages = pdfDoc.getPages();

      let color;
      if (colorName === 'blue') color = rgb(0, 0, 0.7);
      else if (colorName === 'gray') color = rgb(0.5, 0.5, 0.5);
      else color = rgb(0.8, 0, 0);

      const pagesToStamp = scope === 'all'
        ? pages
        : [pages[doc.currentPage - 1]].filter(Boolean);

      const fontSize = 54;

      for (const page of pagesToStamp) {
        const { width, height } = page.getSize();
        const textWidth = font.widthOfTextAtSize(text, fontSize);

        page.drawText(text, {
          x: (width - textWidth * 0.7) / 2,
          y: height / 2 - fontSize / 2,
          size: fontSize,
          font,
          color,
          opacity: 0.35,
          rotate: degrees(-30),
        });
      }

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'stamp', prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes);

      UI.setStatus('Stamp applied.');
    } catch (err) {
      console.error('Stamp error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to apply stamp.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Apply All Annotations to PDF ----

  async function applyAnnotations() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return doc ? doc.pdfBytes : null;

    const hasAnnot = annotations.length > 0 || drawPaths.length > 0 || stickyNotes.some(n => n.text.trim());
    if (!hasAnnot) return doc.pdfBytes;

    try {
      const { PDFDocument, rgb, StandardFonts } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const zoom = doc.zoom;

      // Highlights and underlines
      for (const a of annotations) {
        const page = pages[a.pageNum - 1];
        if (!page) continue;
        const { height } = page.getSize();

        if (a.type === 'highlight') {
          page.drawRectangle({
            x: a.x / zoom,
            y: height - (a.y / zoom) - (a.h / zoom),
            width: a.w / zoom,
            height: a.h / zoom,
            color: rgb(1, 1, 0),
            opacity: 0.4,
          });
        } else if (a.type === 'underline') {
          page.drawLine({
            start: { x: a.x / zoom, y: height - (a.y / zoom) },
            end: { x: (a.x + a.w) / zoom, y: height - (a.y / zoom) },
            thickness: 1,
            color: rgb(1, 0, 0),
          });
        }
      }

      // Draw paths
      for (const path of drawPaths) {
        const page = pages[path.pageNum - 1];
        if (!page) continue;
        const { height } = page.getSize();

        for (let i = 1; i < path.points.length; i++) {
          page.drawLine({
            start: { x: path.points[i - 1].x / zoom, y: height - path.points[i - 1].y / zoom },
            end: { x: path.points[i].x / zoom, y: height - path.points[i].y / zoom },
            thickness: path.width / zoom,
            color: rgb(1, 0, 0),
          });
        }
      }

      // Sticky note text
      for (const note of stickyNotes) {
        if (!note.text.trim()) continue;
        const page = pages[note.pageNum - 1];
        if (!page) continue;
        const { height } = page.getSize();

        page.drawText('📌 ' + note.text, {
          x: note.x / zoom,
          y: height - (note.y / zoom) - 12,
          size: 9,
          font,
          color: rgb(0.6, 0.3, 0),
        });
      }

      return await pdfDoc.save();
    } catch (err) {
      console.error('Apply annotations error:', err);
      return doc.pdfBytes;
    }
  }

  return {
    activate,
    deactivate,
    showStampDialog,
    applyAnnotations,
  };
})();
