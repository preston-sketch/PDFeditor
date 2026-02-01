/**
 * Win98 UI Components - Menus, Dialogs, Panels, Tooltips
 */

const UI = (() => {
  let activeMenu = null;
  let menuBarActive = false;
  let tooltipEl = null;
  let tooltipTimeout = null;
  let contextMenuEl = null;

  // ---- Menu System ----

  function initMenus() {
    const menubar = document.getElementById('menubar');
    const menuItems = menubar.querySelectorAll('.win98-menu-item');

    menuItems.forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const menuId = item.dataset.menu;
        if (activeMenu === menuId) {
          closeMenus();
        } else {
          openMenu(menuId, item);
        }
      });

      item.addEventListener('mouseenter', () => {
        if (menuBarActive && item.dataset.menu !== activeMenu) {
          openMenu(item.dataset.menu, item);
        }
      });
    });

    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.win98-menubar') && !e.target.closest('.win98-dropdown')) {
        closeMenus();
      }
      if (!e.target.closest('.win98-context-menu')) {
        closeContextMenus();
      }
    });

    // Dropdown item clicks
    document.querySelectorAll('.win98-dropdown .win98-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (item.classList.contains('disabled')) return;
        const action = item.dataset.action;
        closeMenus();
        if (action) {
          document.dispatchEvent(new CustomEvent('menu-action', { detail: { action } }));
        }
      });
    });
  }

  function openMenu(menuId, anchorEl) {
    closeMenus();
    const dropdown = document.getElementById('menu-' + menuId);
    if (!dropdown) return;

    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = rect.bottom + 'px';
    dropdown.classList.add('show');
    anchorEl.classList.add('active');

    activeMenu = menuId;
    menuBarActive = true;
  }

  function closeMenus() {
    document.querySelectorAll('.win98-dropdown.show').forEach(d => d.classList.remove('show'));
    document.querySelectorAll('.win98-menu-item.active').forEach(m => m.classList.remove('active'));
    activeMenu = null;
    menuBarActive = false;
  }

  // ---- Context Menus ----

  function showContextMenu(menuId, x, y) {
    closeContextMenus();
    const menu = document.getElementById(menuId);
    if (!menu) return;

    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Keep in viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    }

    contextMenuEl = menu;

    // Item click handlers
    menu.querySelectorAll('.win98-dropdown-item').forEach(item => {
      item.onclick = () => {
        const action = item.dataset.action;
        closeContextMenus();
        if (action) {
          document.dispatchEvent(new CustomEvent('context-action', { detail: { action } }));
        }
      };
    });
  }

  function closeContextMenus() {
    document.querySelectorAll('.win98-context-menu').forEach(m => m.style.display = 'none');
    contextMenuEl = null;
  }

  // ---- Tooltips ----

  function initTooltips() {
    document.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('[title]');
      if (btn && (btn.classList.contains('win98-toolbar-btn') || btn.classList.contains('win98-titlebar-btn'))) {
        const title = btn.getAttribute('title');
        if (!title) return;
        clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => showTooltip(title, e.clientX, e.clientY + 20), 500);
      }
    });

    document.addEventListener('mouseout', (e) => {
      const btn = e.target.closest('[title]');
      if (btn) {
        clearTimeout(tooltipTimeout);
        hideTooltip();
      }
    });

    document.addEventListener('mousedown', () => {
      clearTimeout(tooltipTimeout);
      hideTooltip();
    });
  }

  function showTooltip(text, x, y) {
    hideTooltip();
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'win98-tooltip';
    tooltipEl.textContent = text;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
    document.body.appendChild(tooltipEl);
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  }

  // ---- Resizable Panels ----

  function initResizablePanels() {
    initResize('resize-left', 'sidebar', 'left');
    initResize('resize-right', 'page-panel', 'right');
  }

  function initResize(handleId, panelId, side) {
    const handle = document.getElementById(handleId);
    const panel = document.getElementById(panelId);
    if (!handle || !panel) return;

    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    function onMouseMove(e) {
      let diff = e.clientX - startX;
      if (side === 'right') diff = -diff;
      const newWidth = Math.max(80, Math.min(400, startWidth + diff));
      panel.style.width = newWidth + 'px';
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }

  // ---- Section Collapse ----

  function initCollapsibleSections() {
    document.querySelectorAll('.win98-section-header').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.parentElement;
        section.classList.toggle('collapsed');
        const icon = header.querySelector('.collapse-icon');
        if (icon) {
          icon.textContent = section.classList.contains('collapsed') ? '▸' : '▾';
        }
      });
    });
  }

  // ---- Dialogs ----

  function showDialog({ title = 'PDFeditor 98', message, icon = 'ℹ️', buttons = ['OK'], onButton }) {
    const overlay = document.createElement('div');
    overlay.className = 'win98-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'win98-dialog';

    dialog.innerHTML = `
      <div class="win98-titlebar">
        <span class="win98-titlebar-icon">${icon}</span>
        <span class="win98-titlebar-title">${title}</span>
        <div class="win98-titlebar-buttons">
          <button class="win98-titlebar-btn dialog-close"><span>✕</span></button>
        </div>
      </div>
      <div class="win98-dialog-body">
        <div class="win98-dialog-icon">${icon}</div>
        <div class="win98-dialog-text">${message}</div>
      </div>
      <div class="win98-dialog-buttons">
        ${buttons.map((b, i) =>
          `<button class="win98-button ${i === 0 ? 'default' : ''}" data-btn="${b}">${b}</button>`
        ).join('')}
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Make dialog draggable
    makeDraggable(dialog, dialog.querySelector('.win98-titlebar'));

    // Button handlers
    dialog.querySelectorAll('.win98-button').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.remove();
        if (onButton) onButton(btn.dataset.btn);
      });
    });

    dialog.querySelector('.dialog-close').addEventListener('click', () => {
      overlay.remove();
      if (onButton) onButton(null);
    });

    // Focus first button
    const firstBtn = dialog.querySelector('.win98-button');
    if (firstBtn) firstBtn.focus();

    return overlay;
  }

  function showInputDialog({ title = 'Input', message, defaultValue = '', onSubmit }) {
    const overlay = document.createElement('div');
    overlay.className = 'win98-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'win98-dialog';

    dialog.innerHTML = `
      <div class="win98-titlebar">
        <span class="win98-titlebar-title">${title}</span>
        <div class="win98-titlebar-buttons">
          <button class="win98-titlebar-btn dialog-close"><span>✕</span></button>
        </div>
      </div>
      <div class="win98-dialog-body">
        <div class="win98-dialog-text">
          <p style="margin-bottom:8px">${message}</p>
          <input type="text" class="win98-input" style="width:100%" value="${defaultValue}" id="dialog-input">
        </div>
      </div>
      <div class="win98-dialog-buttons">
        <button class="win98-button default" data-btn="OK">OK</button>
        <button class="win98-button" data-btn="Cancel">Cancel</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    makeDraggable(dialog, dialog.querySelector('.win98-titlebar'));

    const input = dialog.querySelector('#dialog-input');
    input.focus();
    input.select();

    const close = (val) => {
      overlay.remove();
      if (onSubmit) onSubmit(val);
    };

    dialog.querySelector('[data-btn="OK"]').addEventListener('click', () => close(input.value));
    dialog.querySelector('[data-btn="Cancel"]').addEventListener('click', () => close(null));
    dialog.querySelector('.dialog-close').addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value);
      if (e.key === 'Escape') close(null);
    });

    return overlay;
  }

  function showCustomDialog({ title = 'PDFeditor 98', content, buttons = ['OK', 'Cancel'], onButton }) {
    const overlay = document.createElement('div');
    overlay.className = 'win98-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'win98-dialog';
    dialog.style.maxWidth = '600px';
    dialog.style.minWidth = '400px';

    dialog.innerHTML = `
      <div class="win98-titlebar">
        <span class="win98-titlebar-title">${title}</span>
        <div class="win98-titlebar-buttons">
          <button class="win98-titlebar-btn dialog-close"><span>✕</span></button>
        </div>
      </div>
      <div class="win98-dialog-body" style="display:block;padding:12px;">
        ${content}
      </div>
      <div class="win98-dialog-buttons">
        ${buttons.map((b, i) =>
          `<button class="win98-button ${i === 0 ? 'default' : ''}" data-btn="${b}">${b}</button>`
        ).join('')}
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    makeDraggable(dialog, dialog.querySelector('.win98-titlebar'));

    const close = (val) => {
      overlay.remove();
      if (onButton) onButton(val, dialog);
    };

    dialog.querySelectorAll('.win98-button').forEach(btn => {
      btn.addEventListener('click', () => close(btn.dataset.btn));
    });
    dialog.querySelector('.dialog-close').addEventListener('click', () => close(null));

    return { overlay, dialog };
  }

  // ---- Draggable ----

  function makeDraggable(el, handle) {
    let offsetX, offsetY;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.win98-titlebar-btn')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      el.style.position = 'fixed';
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.margin = '0';

      const onMove = (ev) => {
        el.style.left = (ev.clientX - offsetX) + 'px';
        el.style.top = (ev.clientY - offsetY) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ---- Status Bar ----

  function setStatus(msg) {
    document.getElementById('status-message').textContent = msg;
  }

  function setPageStatus(current, total) {
    document.getElementById('status-page').textContent = total > 0 ? `Page ${current} of ${total}` : '—';
  }

  function setZoomStatus(zoom) {
    document.getElementById('status-zoom').textContent = Math.round(zoom * 100) + '%';
  }

  // ---- Toolbar State ----

  function enableToolbarButtons(ids) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
  }

  function disableToolbarButtons(ids) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
  }

  function setMenuItemEnabled(menuId, action, enabled) {
    const menu = document.getElementById('menu-' + menuId);
    if (!menu) return;
    const item = menu.querySelector(`[data-action="${action}"]`);
    if (item) {
      item.classList.toggle('disabled', !enabled);
    }
  }

  // ---- Init ----

  function init() {
    initMenus();
    initTooltips();
    initResizablePanels();
    initCollapsibleSections();
  }

  return {
    init,
    showDialog,
    showInputDialog,
    showCustomDialog,
    showContextMenu,
    closeContextMenus,
    closeMenus,
    setStatus,
    setPageStatus,
    setZoomStatus,
    enableToolbarButtons,
    disableToolbarButtons,
    setMenuItemEnabled,
    makeDraggable,
  };
})();
