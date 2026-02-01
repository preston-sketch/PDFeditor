/**
 * PDF Conversion - To Word, To Images, From Images, Compress
 */

const PDFConvert = (() => {

  // ---- Convert to Word ----

  async function convertToWord() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) {
      UI.showDialog({ title: 'Convert', message: 'No document open.', icon: 'ℹ️', buttons: ['OK'] });
      return;
    }

    UI.setStatus('Converting to Word...');
    document.body.classList.add('wait-cursor');

    try {
      const textPages = [];
      for (let i = 1; i <= doc.pageCount; i++) {
        UI.setStatus(`Extracting text from page ${i} of ${doc.pageCount}...`);
        const page = await doc.pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        textPages.push(text);
      }

      UI.setStatus('Building Word document...');

      const docxBlob = generateDocx(textPages, doc.name);

      const url = URL.createObjectURL(docxBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name.replace('.pdf', '.docx');
      a.click();
      URL.revokeObjectURL(url);

      UI.setStatus('Conversion complete.');

      UI.showDialog({
        title: 'Convert to Word',
        message: `Successfully converted "${doc.name}" to Word format.\n\nNote: Complex formatting (images, tables, exact layout) may not be preserved. Text content has been extracted.`,
        icon: 'ℹ️',
        buttons: ['OK']
      });

    } catch (err) {
      console.error('Conversion error:', err);
      UI.showDialog({
        title: 'Error',
        message: 'Failed to convert to Word:\n' + err.message,
        icon: '❌',
        buttons: ['OK']
      });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Convert to Images ----

  async function convertToImages() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) {
      UI.showDialog({ title: 'Export Images', message: 'No document open.', icon: 'ℹ️', buttons: ['OK'] });
      return;
    }

    const content = `
      <p style="margin-bottom:8px">Export each page as an image file:</p>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;">
        <label style="font-size:11px;">Format:</label>
        <select class="win98-input" id="img-format" style="width:100px;">
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
        </select>
        <label style="font-size:11px;">Scale:</label>
        <select class="win98-input" id="img-scale" style="width:100px;">
          <option value="1">1x (72 DPI)</option>
          <option value="2" selected>2x (144 DPI)</option>
          <option value="3">3x (216 DPI)</option>
        </select>
      </div>
      <p style="margin-top:8px;font-size:11px;color:#808080;">
        ${doc.pageCount} page(s) will be exported.
      </p>
    `;

    UI.showCustomDialog({
      title: 'Export as Images',
      content,
      buttons: ['Export', 'Cancel'],
      onButton: async (btn, dialog) => {
        if (btn === 'Export') {
          const format = dialog.querySelector('#img-format').value;
          const scale = parseFloat(dialog.querySelector('#img-scale').value);
          await executeConvertToImages(format, scale);
        }
      }
    });
  }

  async function executeConvertToImages(format, scale) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Exporting pages as images...');
    document.body.classList.add('wait-cursor');

    try {
      for (let i = 1; i <= doc.pageCount; i++) {
        UI.setStatus(`Rendering page ${i} of ${doc.pageCount}...`);

        const page = await doc.pdfDoc.getPage(i);
        const vp = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const ext = format === 'jpeg' ? 'jpg' : 'png';
        const quality = format === 'jpeg' ? 0.92 : undefined;

        const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.name.replace('.pdf', '') + `_page${i}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);

        // Small delay to avoid browser throttling
        await new Promise(r => setTimeout(r, 100));
      }

      UI.setStatus('Export complete.');
      UI.showDialog({
        title: 'Export Images',
        message: `Exported ${doc.pageCount} page(s) as ${format.toUpperCase()} images.`,
        icon: 'ℹ️',
        buttons: ['OK']
      });
    } catch (err) {
      console.error('Export images error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to export images:\n' + err.message, icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Images to PDF ----

  function imagesToPDF() {
    const input = document.getElementById('image-file-input');

    input.onchange = async () => {
      if (input.files.length === 0) return;

      UI.setStatus('Creating PDF from images...');
      document.body.classList.add('wait-cursor');

      try {
        const { PDFDocument } = PDFLib;
        const pdfDoc = await PDFDocument.create();

        const files = Array.from(input.files);
        for (let i = 0; i < files.length; i++) {
          UI.setStatus(`Processing image ${i + 1} of ${files.length}...`);
          const file = files[i];
          const bytes = await file.arrayBuffer();

          let image;
          if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
            image = await pdfDoc.embedPng(bytes);
          } else {
            image = await pdfDoc.embedJpg(bytes);
          }

          const page = pdfDoc.addPage([image.width, image.height]);
          page.drawImage(image, {
            x: 0,
            y: 0,
            width: image.width,
            height: image.height,
          });
        }

        const pdfBytes = await pdfDoc.save();
        await PDFViewer.loadPDF(pdfBytes.buffer, 'Images.pdf');

        UI.setStatus('PDF created from images.');
      } catch (err) {
        console.error('Images to PDF error:', err);
        UI.showDialog({ title: 'Error', message: 'Failed to create PDF from images:\n' + err.message, icon: '❌', buttons: ['OK'] });
        UI.setStatus('Ready.');
      } finally {
        document.body.classList.remove('wait-cursor');
        input.value = '';
      }
    };

    input.click();
  }

  // ---- Compress PDF ----

  async function compressPDF() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) {
      UI.showDialog({ title: 'Compress', message: 'No document open.', icon: 'ℹ️', buttons: ['OK'] });
      return;
    }

    UI.setStatus('Compressing PDF...');
    document.body.classList.add('wait-cursor');

    try {
      const originalSize = doc.pdfBytes.byteLength || doc.pdfBytes.length;

      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);

      const newBytes = await pdfDoc.save({ useObjectStreams: true });
      const newSize = newBytes.byteLength;

      const savedBytes = originalSize - newSize;
      const savedPercent = ((savedBytes / originalSize) * 100).toFixed(1);

      PDFEditor.pushUndo({ type: 'compress', prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes.buffer || newBytes);

      UI.showDialog({
        title: 'Compression Results',
        message: `<b>Original size:</b> ${formatSize(originalSize)}<br>
          <b>Compressed size:</b> ${formatSize(newSize)}<br>
          <b>Saved:</b> ${formatSize(Math.abs(savedBytes))} (${Math.abs(savedPercent)}%${savedBytes < 0 ? ' larger' : ''})<br><br>
          <i>Note: pdf-lib uses object streams for compression. No image downsampling is performed.</i>`,
        icon: 'ℹ️',
        buttons: ['OK']
      });

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Compress error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to compress PDF:\n' + err.message, icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- OOXML .docx Generator ----

  function generateDocx(textPages, title) {
    const zip = new SimpleZip();

    zip.addFile('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

    zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

    zip.addFile('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

    let bodyXml = '';
    textPages.forEach((text, i) => {
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Page ${i + 1}</w:t></w:r></w:p>`;

      const paragraphs = text.split(/\n{2,}|\.\s{2,}/);
      paragraphs.forEach(para => {
        const clean = escapeXml(para.trim());
        if (clean) {
          bodyXml += `<w:p><w:r><w:t xml:space="preserve">${clean}</w:t></w:r></w:p>`;
        }
      });

      if (i < textPages.length - 1) {
        bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
      }
    });

    zip.addFile('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
  </w:body>
</w:document>`);

    return zip.generate();
  }

  // ---- Minimal ZIP Implementation ----

  class SimpleZip {
    constructor() {
      this.files = [];
    }

    addFile(name, content) {
      this.files.push({ name, content: new TextEncoder().encode(content) });
    }

    addFileBytes(name, bytes) {
      this.files.push({ name, content: new Uint8Array(bytes) });
    }

    generate() {
      const parts = [];
      const centralDir = [];
      let offset = 0;

      for (const file of this.files) {
        const nameBytes = new TextEncoder().encode(file.name);
        const data = file.content;
        const crc = crc32(data);

        const localHeader = new ArrayBuffer(30 + nameBytes.length);
        const lv = new DataView(localHeader);
        lv.setUint32(0, 0x04034B50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0, true);
        lv.setUint16(8, 0, true);
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        new Uint8Array(localHeader, 30).set(nameBytes);

        parts.push(new Uint8Array(localHeader));
        parts.push(data);

        const cdEntry = new ArrayBuffer(46 + nameBytes.length);
        const cv = new DataView(cdEntry);
        cv.setUint32(0, 0x02014B50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0x20, true);
        cv.setUint32(42, offset, true);
        new Uint8Array(cdEntry, 46).set(nameBytes);

        centralDir.push(new Uint8Array(cdEntry));

        offset += localHeader.byteLength + data.length;
      }

      const cdOffset = offset;
      let cdSize = 0;
      centralDir.forEach(cd => {
        parts.push(cd);
        cdSize += cd.length;
      });

      const eocd = new ArrayBuffer(22);
      const ev = new DataView(eocd);
      ev.setUint32(0, 0x06054B50, true);
      ev.setUint16(4, 0, true);
      ev.setUint16(6, 0, true);
      ev.setUint16(8, this.files.length, true);
      ev.setUint16(10, this.files.length, true);
      ev.setUint32(12, cdSize, true);
      ev.setUint32(16, cdOffset, true);
      ev.setUint16(20, 0, true);
      parts.push(new Uint8Array(eocd));

      const totalSize = parts.reduce((sum, p) => sum + p.length, 0);
      const result = new Uint8Array(totalSize);
      let pos = 0;
      parts.forEach(p => {
        result.set(p, pos);
        pos += p.length;
      });

      return new Blob([result], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }
  }

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return {
    convertToWord,
    convertToImages,
    imagesToPDF,
    compressPDF,
  };
})();
