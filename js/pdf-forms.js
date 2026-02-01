/**
 * PDF Forms - Fill form fields, add fields, flatten
 */

const PDFForms = (() => {

  // ---- Fill Fields Dialog ----

  async function showFillDialog() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) {
      UI.showDialog({ title: 'Forms', message: 'No document open.', icon: 'ℹ️', buttons: ['OK'] });
      return;
    }

    UI.setStatus('Reading form fields...');

    try {
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      let form;
      try {
        form = pdfDoc.getForm();
      } catch (e) {
        UI.showDialog({ title: 'Forms', message: 'This PDF does not contain interactive form fields.', icon: 'ℹ️', buttons: ['OK'] });
        UI.setStatus('Ready.');
        return;
      }

      const fields = form.getFields();
      if (fields.length === 0) {
        UI.showDialog({ title: 'Forms', message: 'No form fields found in this PDF.', icon: 'ℹ️', buttons: ['OK'] });
        UI.setStatus('Ready.');
        return;
      }

      let fieldsHTML = '';
      for (const field of fields) {
        const name = field.getName();
        const type = field.constructor.name;
        let inputHTML = '';

        if (type === 'PDFTextField') {
          const val = field.getText() || '';
          inputHTML = `<input type="text" class="win98-input" data-field="${esc(name)}" data-type="text" value="${esc(val)}" style="width:200px;">`;
        } else if (type === 'PDFCheckBox') {
          const checked = field.isChecked() ? 'checked' : '';
          inputHTML = `<input type="checkbox" data-field="${esc(name)}" data-type="checkbox" ${checked}>`;
        } else if (type === 'PDFDropdown') {
          const options = field.getOptions();
          const selected = field.getSelected();
          inputHTML = `<select class="win98-input" data-field="${esc(name)}" data-type="dropdown" style="width:200px;">`;
          for (const opt of options) {
            const sel = selected.includes(opt) ? 'selected' : '';
            inputHTML += `<option value="${esc(opt)}" ${sel}>${esc(opt)}</option>`;
          }
          inputHTML += '</select>';
        } else if (type === 'PDFRadioGroup') {
          const options = field.getOptions();
          const selected = field.getSelected();
          inputHTML = options.map(opt =>
            `<label><input type="radio" name="rf_${esc(name)}" data-field="${esc(name)}" data-type="radio" value="${esc(opt)}" ${opt === selected ? 'checked' : ''}> ${esc(opt)}</label>`
          ).join(' ');
        } else {
          inputHTML = `<span style="font-size:11px;color:#808080;">(${type} — not editable)</span>`;
        }

        fieldsHTML += `
          <tr>
            <td style="padding:3px 8px 3px 4px;font-size:11px;font-weight:bold;white-space:nowrap;vertical-align:top;">${esc(name)}</td>
            <td style="padding:3px 4px;font-size:11px;">${inputHTML}</td>
          </tr>`;
      }

      const content = `
        <p style="margin-bottom:8px">Fill in the form fields below:</p>
        <div style="max-height:300px;overflow-y:auto;border:2px inset;padding:4px;">
          <table style="width:100%;border-collapse:collapse;">${fieldsHTML}</table>
        </div>
        <p style="margin-top:8px;font-size:11px;color:#808080;">
          ${fields.length} field(s) found. Edit values and click Apply.
        </p>
      `;

      UI.showCustomDialog({
        title: 'Fill Form Fields',
        content,
        buttons: ['Apply', 'Cancel'],
        onButton: async (btn, dialog) => {
          if (btn === 'Apply') {
            await applyFieldValues(dialog);
          }
        }
      });

      UI.setStatus('Ready.');
    } catch (err) {
      console.error('Form read error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to read form fields:\n' + err.message, icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    }
  }

  async function applyFieldValues(dialog) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Applying form values...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const form = pdfDoc.getForm();

      // Text fields
      dialog.querySelectorAll('[data-type="text"]').forEach(input => {
        const field = form.getTextField(input.dataset.field);
        if (field) field.setText(input.value);
      });

      // Checkboxes
      dialog.querySelectorAll('[data-type="checkbox"]').forEach(input => {
        const field = form.getCheckBox(input.dataset.field);
        if (field) {
          if (input.checked) field.check();
          else field.uncheck();
        }
      });

      // Dropdowns
      dialog.querySelectorAll('[data-type="dropdown"]').forEach(input => {
        const field = form.getDropdown(input.dataset.field);
        if (field) field.select(input.value);
      });

      // Radio groups
      const radioGroups = {};
      dialog.querySelectorAll('[data-type="radio"]:checked').forEach(input => {
        radioGroups[input.dataset.field] = input.value;
      });
      for (const [name, value] of Object.entries(radioGroups)) {
        const field = form.getRadioGroup(name);
        if (field) field.select(value);
      }

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'fill-form', prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes);

      UI.setStatus('Form values applied.');
    } catch (err) {
      console.error('Form apply error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to apply form values:\n' + err.message, icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Add Fields Mode ----

  let addFieldMode = false;
  let addFieldHandler = null;

  function toggleAddFieldMode() {
    addFieldMode = !addFieldMode;

    if (addFieldMode) {
      UI.setStatus('Click on the page to add a text field. Click again to add more. Press Escape to stop.');
      const overlay = document.getElementById('text-edit-overlay');
      if (overlay) {
        addFieldHandler = (e) => {
          if (e.target !== overlay) return;
          const rect = overlay.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          placeField(x, y);
        };
        overlay.classList.add('active');
        overlay.style.cursor = 'crosshair';
        overlay.addEventListener('click', addFieldHandler);
      }
    } else {
      UI.setStatus('Ready.');
      const overlay = document.getElementById('text-edit-overlay');
      if (overlay && addFieldHandler) {
        overlay.removeEventListener('click', addFieldHandler);
        overlay.classList.remove('active');
        overlay.style.cursor = '';
        addFieldHandler = null;
      }
    }
  }

  async function placeField(x, y) {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    try {
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);
      const form = pdfDoc.getForm();
      const page = pdfDoc.getPages()[doc.currentPage - 1];
      if (!page) return;

      const { height } = page.getSize();
      const zoom = doc.zoom;
      const fieldName = 'field_' + Date.now();

      const textField = form.createTextField(fieldName);
      textField.addToPage(page, {
        x: x / zoom,
        y: height - (y / zoom) - 20,
        width: 150,
        height: 20,
      });

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'add-field', prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes);

    } catch (err) {
      console.error('Add field error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to add field.', icon: '❌', buttons: ['OK'] });
    }
  }

  // ---- Flatten Form ----

  async function flattenForm() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.showDialog({
      title: 'Flatten Form',
      message: 'This will permanently bake all form field values into the PDF. Fields will no longer be editable.\n\nContinue?',
      icon: '⚠️',
      buttons: ['Flatten', 'Cancel'],
      onButton: async (btn) => {
        if (btn === 'Flatten') {
          await executeFlatten();
        }
      }
    });
  }

  async function executeFlatten() {
    const doc = PDFViewer.getActiveDoc();
    if (!doc) return;

    UI.setStatus('Flattening form...');
    document.body.classList.add('wait-cursor');

    try {
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.load(doc.pdfBytes);

      try {
        const form = pdfDoc.getForm();
        form.flatten();
      } catch (e) {
        UI.showDialog({ title: 'Forms', message: 'No form fields to flatten.', icon: 'ℹ️', buttons: ['OK'] });
        UI.setStatus('Ready.');
        return;
      }

      const newBytes = await pdfDoc.save();
      PDFEditor.pushUndo({ type: 'flatten', prevBytes: doc.pdfBytes });
      await PDFViewer.refreshDocument(newBytes);

      UI.setStatus('Form flattened.');
    } catch (err) {
      console.error('Flatten error:', err);
      UI.showDialog({ title: 'Error', message: 'Failed to flatten form:\n' + err.message, icon: '❌', buttons: ['OK'] });
      UI.setStatus('Ready.');
    } finally {
      document.body.classList.remove('wait-cursor');
    }
  }

  // ---- Helpers ----

  function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    showFillDialog,
    toggleAddFieldMode,
    flattenForm,
  };
})();
