/**
 * PDF Editor - Text editing overlay, page manipulation, undo/redo
 */

const PDFEditor = (() => {
  let editMode = false;
  let textBoxes = []; // { id, pageNum, x, y, width, height, text, fontSize, fontFamily }
  let nextBoxId = 1;
  let undoStack = [];
  let redoStack = [];
  const MAX_UNDO = 50;

  // ---- Edit Mode ----

  function toggleEditMode() {
    editMode = !editMode;
    const banner = document.getElementById('edit-mode-banner');
    const btn = document.getElementById('tb-editmode');

    if (editMode) {
      banner.classList.add('visible');
      btn.classList.add('pressed');
      activateOverlay();
    } else {
      banner.classList.remove('visible');
      btn.classList.remove('pressed');
      deactivateOverlay();
    }
  }

  function isEditMode() {
    return editMode;
  }

  function activateOverlay() {
    const overlay = document.getElementById('text-edit-overlay');
    if (overlay) {
      overlay.classList.add('active');
      overlay.addEventListener('click', onOverlayClick);
    }
  }

  function deactivateOverlay() {
    const overlay = document.getElementById('text-edit-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.removeEventListener('click', onOverlayClick);
    }
  }

  function onOverlayClick(e) {
    if (e.target !== e.currentTarget) return; // clicked on a text box

    const overlay = e.currentTarget;
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    createTextBox(doc.currentPage, x, y);
  }

  // ---- Text Boxes ----

  function createTextBox(pageNum, x, y, text = '', fontSize = 14) {
    const id = nextBoxId++;
    const box = {
      id,
      pageNum,
      x,
      y,
      width: 150,
      height: 24,
      text: text,
      fontSize: fontSize,
      fontFamily: 'Helvetica',
    };
    textBoxes.push(box);

    pushUndo({ type: 'add-text', box: { ...box } });
    renderTextBoxes(pageNum);

    // Focus the new box
    setTimeout(() => {
      const el = document.querySelector(`[data-box-id="${id}"]`);
      if (el) {
        el.focus();
        el.click();
      }
    }, 50);

    return box;
  }

  function renderTextBoxes(pageNum) {
    const overlay = document.getElementById('text-edit-overlay');
    if (!overlay) return;

    // Clear existing
    overlay.querySelectorAll('.text-edit-box').forEach(el => el.remove());

    const pageBoxes = textBoxes.filter(b => b.pageNum === pageNum);
    pageBoxes.forEach(box => {
      const el = document.createElement('div');
      el.className = 'text-edit-box';
      el.dataset.boxId = box.id;
      el.contentEditable = editMode ? 'true' : 'false';
      el.style.left = box.x + 'px';
      el.style.top = box.y + 'px';
      el.style.minWidth = box.width + 'px';
      el.style.fontSize = box.fontSize + 'px';
      el.textContent = box.text;

      if (editMode) {
        // Drag to move
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        el.addEventListener('mousedown', (e) => {
          if (e.target === el && !window.getSelection().toString()) {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseFloat(el.style.left);
            startTop = parseFloat(el.style.top);
            e.preventDefault();
          }
        });

        document.addEventListener('mousemove', (e) => {
          if (!isDragging) return;
          el.style.left = (startLeft + e.clientX - startX) + 'px';
          el.style.top = (startTop + e.clientY - startY) + 'px';
        });

        document.addEventListener('mouseup', () => {
          if (isDragging) {
            isDragging = false;
            box.x = parseFloat(el.style.left);
            box.y = parseFloat(el.style.top);
          }
        });

        // Update text on input
        el.addEventListener('input', () => {
          box.text = el.textContent;
        });

        el.addEventListener('blur', () => {
          box.text = el.textContent;
        });
      }

      overlay.appendChild(el);
    });
  }

  // Called by PDFViewer when a page is rendered
  function onPageRendered(wrapper, pageNum) {
    renderTextBoxes(pageNum);
    if (editMode) activateOverlay();
  }

  // ---- Page Reordering ----

  async function reorderPage(fromPage, toPage) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Reordering pages...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const pages = pdfDoc.getPages();

      if (fromPage < 1 || fromPage > pages.length || toPage < 1 || toPage > pages.length) return;

      // Remove page from old position and insert at new
      const fromIdx = fromPage - 1;
      const toIdx = toPage - 1;

      pdfDoc.removePage(fromIdx);
      const [copiedPage] = await pdfDoc.copyPages(
        await PDFDocument.load(doc.pdfBytes),
        [fromIdx]
      );
      pdfDoc.insertPage(toIdx, copiedPage);

      const newBytes = await pdfDoc.save();
      pushUndo({ type: 'reorder', fromPage, toPage, prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes, toPage);

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Reorder error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to reorder pages.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Delete Pages ----

  async function deletePages(pageNums) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    if (pageNums.length === 0) {
      pageNums = [doc.currentPage];
    }

    if (pageNums.length >= doc.pageCount) {
      UI.showDialog({ title: 'Warning', message: 'Cannot delete all pages.', icon: '⚠️', buttons: ['OK'] });
      return;
    }

    UI.setStatus('Deleting pages...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);

      // Delete in reverse order to keep indices valid
      const sorted = [...pageNums].sort((a, b) => b - a);
      sorted.forEach(p => pdfDoc.removePage(p - 1));

      const newBytes = await pdfDoc.save();
      pushUndo({ type: 'delete', pages: pageNums, prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes);

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Delete error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to delete pages.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Apply Text Edits to PDF ----

  async function applyTextEdits() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return null;

    const pageBoxes = textBoxes.filter(b => b.text.trim() !== '');
    if (pageBoxes.length === 0) return doc.pdfBytes;

    try {
      const { PDFDocument, rgb, StandardFonts } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();

      for (const box of pageBoxes) {
        const pageIdx = box.pageNum - 1;
        if (pageIdx < 0 || pageIdx >= pages.length) continue;

        const page = pages[pageIdx];
        const { height } = page.getSize();

        // Convert screen coords to PDF coords (approximate)
        const docObj = PDFViewer.getActiveDoc();
        const zoom = docObj ? docObj.zoom : 1;

        page.drawText(box.text, {
          x: box.x / zoom,
          y: height - (box.y / zoom) - box.fontSize,
          size: box.fontSize,
          font: font,
          color: rgb(0, 0, 0),
        });
      }

      return await pdfDoc.save();
    } catch (err) {
      console.error('Apply text error:', err);
      throw err;
    }
  }

  // ---- Save (returns modified PDF bytes) ----

  async function getSaveData() {
    try {
      return await applyTextEdits();
    } catch (err) {
      UI.showDialog({ title: 'Error', message: 'Failed to apply edits.', icon: '❌', buttons: ['OK'] });
      return null;
    }
  }

  // ---- Undo/Redo ----

  function pushUndo(action) {
    undoStack.push(action);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
  }

  async function undo() {
    if (undoStack.length === 0) return;
    const action = undoStack.pop();
    redoStack.push(action);

    if (action.type === 'delete' || action.type === 'reorder') {
      if (action.prevBytes) {
        await PDFViewer.refreshDocument(action.prevBytes);
      }
    } else if (action.type === 'add-text') {
      textBoxes = textBoxes.filter(b => b.id !== action.box.id);
      const doc = PDFViewer.getActiveDoc();
      if (doc) renderTextBoxes(doc.currentPage);
    }

    updateUndoButtons();
  }

  async function redo() {
    if (redoStack.length === 0) return;
    const action = redoStack.pop();
    undoStack.push(action);

    if (action.type === 'add-text') {
      textBoxes.push({ ...action.box });
      const doc = PDFViewer.getActiveDoc();
      if (doc) renderTextBoxes(doc.currentPage);
    }
    // For delete/reorder redo would need to re-execute, simplified here

    updateUndoButtons();
  }

  function updateUndoButtons() {
    if (undoStack.length > 0) {
      UI.enableToolbarButtons(['tb-undo']);
    } else {
      UI.disableToolbarButtons(['tb-undo']);
    }
    if (redoStack.length > 0) {
      UI.enableToolbarButtons(['tb-redo']);
    } else {
      UI.disableToolbarButtons(['tb-redo']);
    }
  }

  // ---- Select All Pages ----

  function selectAllPages() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;
    for (let i = 1; i <= doc.pageCount; i++) {
      doc.selectedPages.add(i);
    }
    PDFViewer.renderThumbnails();
  }

  // ---- Init ----

  function init() {
    updateUndoButtons();
  }

  return {
    init,
    toggleEditMode,
    isEditMode,
    reorderPage,
    deletePages,
    selectAllPages,
    getSaveData,
    undo,
    redo,
    onPageRendered,
    createTextBox,
  };
})();
