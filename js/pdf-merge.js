/**
 * PDF Merge & Extract - Merge multiple PDFs, extract pages to new PDF
 */

const PDFMerge = (() => {

  // ---- Merge Dialog ----

  function showMergeDialog() {
    const docs = PDFViewer.getAllDocs();

    let fileListHTML = '';
    if (docs.length > 0) {
      docs.forEach((doc, i) => {
        fileListHTML += `
          <div class="merge-file-item" data-index="${i}">
            <span>📄</span>
            <span class="file-name">${escapeHtml(doc.name)}</span>
            <span class="file-pages">${doc.pageCount} pages</span>
          </div>`;
      });
    }

    const content = `
      <p style="margin-bottom:8px">Select files and arrange their order for merging:</p>
      <div style="display:flex;gap:8px;">
        <div style="flex:1;">
          <div class="merge-file-list" id="merge-file-list">
            ${fileListHTML || '<div class="empty-panel-msg">No files open. Open files first.</div>'}
          </div>
        </div>
        <div class="merge-order-controls">
          <button class="win98-button" id="merge-up" title="Move Up" style="min-width:30px;">▲</button>
          <button class="win98-button" id="merge-down" title="Move Down" style="min-width:30px;">▼</button>
          <hr style="border:none;margin:4px 0;">
          <button class="win98-button" id="merge-add-file" style="min-width:30px;font-size:10px;">+ Add</button>
        </div>
      </div>
      <p style="margin-top:8px;font-size:11px;color:#808080;">
        Tip: Open multiple PDF files first, then use Merge to combine them.
      </p>
    `;

    const { overlay, dialog } = UI.showCustomDialog({
      title: 'Merge PDFs',
      content,
      buttons: ['Merge', 'Cancel'],
      onButton: async (btn) => {
        if (btn === 'Merge') {
          const items = dialog.querySelectorAll('.merge-file-item');
          const indices = Array.from(items).map(el => parseInt(el.dataset.index));
          if (indices.length < 2) {
            UI.showDialog({ title: 'Merge', message: 'Need at least 2 files to merge.', icon: 'ℹ️', buttons: ['OK'] });
            return;
          }
          await executeMerge(indices);
        }
      }
    });

    // Move up/down
    dialog.querySelector('#merge-up').addEventListener('click', () => {
      const list = dialog.querySelector('#merge-file-list');
      const selected = list.querySelector('.merge-file-item.selected');
      if (selected && selected.previousElementSibling) {
        list.insertBefore(selected, selected.previousElementSibling);
      }
    });

    dialog.querySelector('#merge-down').addEventListener('click', () => {
      const list = dialog.querySelector('#merge-file-list');
      const selected = list.querySelector('.merge-file-item.selected');
      if (selected && selected.nextElementSibling) {
        list.insertBefore(selected.nextElementSibling, selected);
      }
    });

    // Add file button
    dialog.querySelector('#merge-add-file').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf';
      input.multiple = true;
      input.addEventListener('change', () => {
        if (input.files.length > 0) {
          for (const file of input.files) {
            // These will be loaded via the normal flow and appear in tabs
            const reader = new FileReader();
            reader.onload = (e) => {
              PDFViewer.loadPDF(e.target.result, file.name);
              // Refresh the dialog list (just close and reopen for simplicity)
            };
            reader.readAsArrayBuffer(file);
          }
          // Close this dialog; user can re-open merge after files load
          overlay.remove();
          UI.showDialog({
            title: 'Merge',
            message: 'Files are being loaded. Re-open Merge when ready.',
            icon: 'ℹ️',
            buttons: ['OK']
          });
        }
      });
      input.click();
    });

    // Selection
    dialog.querySelectorAll('.merge-file-item').forEach(item => {
      item.addEventListener('click', () => {
        dialog.querySelectorAll('.merge-file-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
    });
  }

  // ---- Execute Merge ----

  async function executeMerge(docIndices) {
    UI.setStatus('Merging PDFs...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument } = PDFLib;
      const mergedPdf = await PDFDocument.create();
      const docs = PDFViewer.getAllDocs();

      for (const idx of docIndices) {
        const doc = docs[idx];
        if (!doc) continue;

        const srcDoc = await PDFDocument.load(doc.pdfBytes);
        const pageIndices = Array.from({ length: srcDoc.getPageCount() }, (_, i) => i);
        const copiedPages = await mergedPdf.copyPages(srcDoc, pageIndices);
        copiedPages.forEach(page => mergedPdf.addPage(page));
      }

      const mergedBytes = await mergedPdf.save();

      // Open as new document
      await PDFViewer.loadPDF(mergedBytes.buffer, 'Merged.pdf');

      UI.setStatus('Merge complete.');
    } catch (err) {
      console.error('Merge error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to merge PDFs:\n' + err.message, icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Extract Pages Dialog ----

  function showExtractDialog() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) {
      UI.showDialog({ title: 'Extract', message: 'No document open.', icon: 'ℹ️', buttons: ['OK'] });
      return;
    }

    const selectedPages = PDFViewer.getSelectedPages();

    let gridHTML = '';
    for (let i = 1; i <= doc.pageCount; i++) {
      const isSelected = selectedPages.includes(i);
      gridHTML += `
        <div class="extract-page-item ${isSelected ? 'selected' : ''}" data-page="${i}">
          <div style="background:#eee;height:40px;display:flex;align-items:center;justify-content:center;font-size:18px;">
            ${i}
          </div>
          <div style="font-size:10px;margin-top:2px;">Page ${i}</div>
        </div>`;
    }

    const content = `
      <p style="margin-bottom:8px">Select pages to extract into a new PDF:</p>
      <div class="extract-page-grid" id="extract-page-grid">
        ${gridHTML}
      </div>
      <p style="margin-top:8px;font-size:11px;color:#808080;">
        Click to select/deselect. Ctrl+Click for multiple pages.
      </p>
    `;

    const { overlay, dialog } = UI.showCustomDialog({
      title: 'Extract Pages',
      content,
      buttons: ['Extract', 'Cancel'],
      onButton: async (btn) => {
        if (btn === 'Extract') {
          const selected = [];
          dialog.querySelectorAll('.extract-page-item.selected').forEach(el => {
            selected.push(parseInt(el.dataset.page));
          });
          if (selected.length === 0) {
            UI.showDialog({ title: 'Extract', message: 'No pages selected.', icon: 'ℹ️', buttons: ['OK'] });
            return;
          }
          await executeExtract(selected);
        }
      }
    });

    // Page selection toggle
    dialog.querySelectorAll('.extract-page-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          item.classList.toggle('selected');
        } else {
          dialog.querySelectorAll('.extract-page-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
        }
      });
    });
  }

  // ---- Execute Extract ----

  async function executeExtract(pageNums) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Extracting pages...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument } = PDFLib;
      const srcDoc = await PDFDocument.load(doc.pdfBytes);
      const newDoc = await PDFDocument.create();

      const indices = pageNums.map(p => p - 1);
      const copiedPages = await newDoc.copyPages(srcDoc, indices);
      copiedPages.forEach(page => newDoc.addPage(page));

      const newBytes = await newDoc.save();

      // Open as new document
      const name = doc.name.replace('.pdf', '') + '_extract.pdf';
      await PDFViewer.loadPDF(newBytes.buffer, name);

      UI.setStatus('Extraction complete.');
    } catch (err) {
      console.error('Extract error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to extract pages.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Move Page (context menu) ----

  async function movePageUp() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc || doc.currentPage <= 1) return;
    await PDFEditor.reorderPage(doc.currentPage, doc.currentPage - 1);
  }

  async function movePageDown() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc || doc.currentPage >= doc.pageCount) return;
    await PDFEditor.reorderPage(doc.currentPage, doc.currentPage + 1);
  }

  // ---- Helpers ----

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    showMergeDialog,
    showExtractDialog,
    movePageUp,
    movePageDown,
  };
})();
