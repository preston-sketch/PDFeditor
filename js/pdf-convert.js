/**
 * PDF-to-Word Conversion
 * Extracts text from PDF pages and generates a downloadable .docx file.
 * Uses a lightweight OOXML builder (no external docx library needed).
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
      // Extract text from all pages using PDF.js
      const textPages = [];
      for (let i = 1; i <= doc.pageCount; i++) {
        UI.setStatus(`Extracting text from page ${i} of ${doc.pageCount}...`);
        const page = await doc.pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        textPages.push(text);
      }

      UI.setStatus('Building Word document...');

      // Generate .docx using OOXML
      const docxBlob = generateDocx(textPages, doc.name);

      // Download
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

  // ---- OOXML .docx Generator ----
  // Generates a minimal valid .docx (ZIP of XML files)

  function generateDocx(textPages, title) {
    // Use JSZip-like approach with raw ZIP construction
    const zip = new SimpleZip();

    // [Content_Types].xml
    zip.addFile('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

    // _rels/.rels
    zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

    // word/_rels/document.xml.rels
    zip.addFile('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

    // word/document.xml
    let bodyXml = '';
    textPages.forEach((text, i) => {
      // Page header
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Page ${i + 1}</w:t></w:r></w:p>`;

      // Split text into paragraphs (by double newline or long gaps)
      const paragraphs = text.split(/\n{2,}|\.\s{2,}/);
      paragraphs.forEach(para => {
        const clean = escapeXml(para.trim());
        if (clean) {
          bodyXml += `<w:p><w:r><w:t xml:space="preserve">${clean}</w:t></w:r></w:p>`;
        }
      });

      // Page break (except last page)
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

    generate() {
      const parts = [];
      const centralDir = [];
      let offset = 0;

      for (const file of this.files) {
        const nameBytes = new TextEncoder().encode(file.name);
        const data = file.content;
        const crc = crc32(data);

        // Local file header
        const localHeader = new ArrayBuffer(30 + nameBytes.length);
        const lv = new DataView(localHeader);
        lv.setUint32(0, 0x04034B50, true); // signature
        lv.setUint16(4, 20, true);         // version needed
        lv.setUint16(6, 0, true);          // flags
        lv.setUint16(8, 0, true);          // compression (store)
        lv.setUint16(10, 0, true);         // mod time
        lv.setUint16(12, 0, true);         // mod date
        lv.setUint32(14, crc, true);       // crc32
        lv.setUint32(18, data.length, true); // compressed size
        lv.setUint32(22, data.length, true); // uncompressed size
        lv.setUint16(26, nameBytes.length, true); // name length
        lv.setUint16(28, 0, true);         // extra length
        new Uint8Array(localHeader, 30).set(nameBytes);

        parts.push(new Uint8Array(localHeader));
        parts.push(data);

        // Central directory entry
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

      // End of central directory
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

      // Combine
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

  // CRC32 implementation
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

  return {
    convertToWord,
  };
})();
