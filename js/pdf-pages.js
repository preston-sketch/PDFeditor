/**
 * PDF Pages - Rotate, crop, insert blank, page numbers
 */

const PDFPages = (() => {

  // ---- Rotate Pages ----

  async function rotatePage(degrees) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    const selected = PDFViewer.getSelectedPages();
    const pages = selected.length > 0 ? selected : [doc.currentPage];

    UI.setStatus('Rotating pages...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument, degrees: pdfDegrees } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const allPages = pdfDoc.getPages();

      for (const pageNum of pages) {
        const page = allPages[pageNum - 1];
        if (!page) continue;
        const current = page.getRotation().angle;
        page.setRotation(pdfDegrees((current + degrees) % 360));
      }

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'rotate', pages, degrees, prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes);

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Rotate error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to rotate pages.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Crop Pages ----

  function showCropDialog() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    const content = `
      <p style="margin-bottom:8px">Set crop box for current page (in points, 72pt = 1 inch):</p>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;">
        <label style="font-size:11px;">Left:</label>
        <input type="number" class="win98-input" id="crop-left" value="0" style="width:80px;">
        <label style="font-size:11px;">Bottom:</label>
        <input type="number" class="win98-input" id="crop-bottom" value="0" style="width:80px;">
        <label style="font-size:11px;">Right:</label>
        <input type="number" class="win98-input" id="crop-right" value="612" style="width:80px;">
        <label style="font-size:11px;">Top:</label>
        <input type="number" class="win98-input" id="crop-top" value="792" style="width:80px;">
      </div>
      <p style="margin-top:8px;font-size:11px;color:#808080;">
        Default US Letter: 612 x 792 points.
      </p>
    `;

    UI.showCustomDialog({
      title: 'Crop Page',
      content,
      buttons: ['Apply', 'Cancel'],
      onButton: async (btn) => {
        if (btn === 'Apply') {
          const left = parseFloat(document.getElementById('crop-left').value) || 0;
          const bottom = parseFloat(document.getElementById('crop-bottom').value) || 0;
          const right = parseFloat(document.getElementById('crop-right').value) || 612;
          const top = parseFloat(document.getElementById('crop-top').value) || 792;
          await applyCrop(left, bottom, right, top);
        }
      }
    });
  }

  async function applyCrop(left, bottom, right, top) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Cropping page...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const page = pdfDoc.getPages()[doc.currentPage - 1];
      if (!page) return;

      page.setCropBox(left, bottom, right, top);

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'crop', prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes);

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Crop error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to crop page.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Insert Blank Page ----

  async function insertBlankPage() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Inserting blank page...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);

      // Match current page size
      const currentPage = pdfDoc.getPages()[doc.currentPage - 1];
      const { width, height } = currentPage ? currentPage.getSize() : { width: 612, height: 792 };

      const blankPage = pdfDoc.insertPage(doc.currentPage, [width, height]);

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'insert-blank', prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes, doc.currentPage + 1);

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Insert blank error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to insert blank page.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Page Numbers ----

  function showPageNumbersDialog() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    const content = `
      <p style="margin-bottom:8px">Add page numbers to all pages:</p>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;">
        <label style="font-size:11px;">Position:</label>
        <select class="win98-input" id="pn-position" style="width:150px;">
          <option value="bottom-center">Bottom Center</option>
          <option value="bottom-left">Bottom Left</option>
          <option value="bottom-right">Bottom Right</option>
          <option value="top-center">Top Center</option>
          <option value="top-left">Top Left</option>
          <option value="top-right">Top Right</option>
        </select>
        <label style="font-size:11px;">Font Size:</label>
        <input type="number" class="win98-input" id="pn-size" value="10" style="width:80px;">
        <label style="font-size:11px;">Start At:</label>
        <input type="number" class="win98-input" id="pn-start" value="1" style="width:80px;">
        <label style="font-size:11px;">Format:</label>
        <select class="win98-input" id="pn-format" style="width:150px;">
          <option value="plain">1, 2, 3...</option>
          <option value="dash">- 1 -, - 2 -...</option>
          <option value="of">Page 1 of N</option>
        </select>
      </div>
    `;

    UI.showCustomDialog({
      title: 'Add Page Numbers',
      content,
      buttons: ['Apply', 'Cancel'],
      onButton: async (btn) => {
        if (btn === 'Apply') {
          const position = document.getElementById('pn-position').value;
          const fontSize = parseInt(document.getElementById('pn-size').value) || 10;
          const startAt = parseInt(document.getElementById('pn-start').value) || 1;
          const format = document.getElementById('pn-format').value;
          await applyPageNumbers(position, fontSize, startAt, format);
        }
      }
    });
  }

  async function applyPageNumbers(position, fontSize, startAt, format) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Adding page numbers...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument, rgb, StandardFonts } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const totalPages = pages.length;

      for (let i = 0; i < totalPages; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();
        const num = startAt + i;

        let text;
        if (format === 'dash') text = `- ${num} -`;
        else if (format === 'of') text = `Page ${num} of ${totalPages}`;
        else text = `${num}`;

        const textWidth = font.widthOfTextAtSize(text, fontSize);
        let x, y;

        if (position.includes('left')) x = 36;
        else if (position.includes('right')) x = width - 36 - textWidth;
        else x = (width - textWidth) / 2;

        if (position.includes('top')) y = height - 30;
        else y = 20;

        page.drawText(text, {
          x, y,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'page-numbers', prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes);

      UI.setStatus('Page numbers added.');
    } catch (err) {
      console.error('Page numbers error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to add page numbers.', icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  return {
    rotatePage,
    showCropDialog,
    insertBlankPage,
    showPageNumbersDialog,
  };
})();
