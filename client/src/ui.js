// Tiny DOM helpers, icons, dialogs, menus and toasts. No framework needed.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const P = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icons = {
  menu: P('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  folderPlus: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  file: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  chevron: P('<path d="m9 6 6 6-6 6"/>'),
  trash: P('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  more: P('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: P('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  auto: P('<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>'),
  edit: P('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  split: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
  eye: P('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  list: P('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  history: P('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>'),
  download: P('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  upload: P('<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>'),
  printer: P('<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>'),
  logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  close: P('<path d="M18 6 6 18M6 6l12 12"/>'),
  restore: P('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  bold: P('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  italic: P('<path d="M19 4h-9M14 20H5M15 4 9 20"/>'),
  strike: P('<path d="M16 6a4 4 0 0 0-4-2c-2.5 0-4 1.5-4 3.5 0 4 8 3 8 7.5 0 2-1.8 3-4 3a5 5 0 0 1-4.5-2.5M4 12h16"/>'),
  heading: P('<path d="M6 4v16M18 4v16M6 12h12"/>'),
  quote: P('<path d="M7 7h4v6a4 4 0 0 1-4 4M14 7h4v6a4 4 0 0 1-4 4"/>'),
  code: P('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
  codeBlock: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 10-2 2 2 2M14 10l2 2-2 2"/>'),
  link: P('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  image: P('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
  ul: P('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>'),
  ol: P('<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
  task: P('<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4M13 6h8M13 12h8M13 18h8"/>'),
  table: P('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
  hr: P('<path d="M3 12h18"/>'),
  math: P('<path d="M18 4H6l6 8-6 8h12"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};

const iconNodes = {};

/** A new SVG element for an icon (each icon is parsed once, then cloned). */
export function icon(name) {
  if (!iconNodes[name]) {
    const t = document.createElement('template');
    t.innerHTML = icons[name] ?? '';
    iconNodes[name] = t.content.firstElementChild;
  }
  return iconNodes[name]?.cloneNode(true) ?? null;
}

export function iconButton(name, label, onClick, extra = {}) {
  return h('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, onClick, ...extra },
    'html' in extra ? null : icon(name));
}

// ---- Toasts -------------------------------------------------------------

// Toasts go into the top open dialog, if any: outside it they would sit under the
// backdrop, unreadable by screen readers and unclickable.
function toastHost() {
  const dialogs = document.querySelectorAll('dialog[open]');
  const parent = dialogs[dialogs.length - 1] ?? document.body;
  let host = parent.querySelector(':scope > .toasts');
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status' });
    parent.append(host);
  }
  return host;
}
// The page's live region exists from the start: one added together with its first message is often not announced.
if (document.body) toastHost();

/**
 * Shows a short message. `action: { label, onClick }` adds a button (e.g. Undo); the toast
 * stays while the pointer or focus is on it. Returns a function that dismisses it.
 */
export function toast(message, { type = 'info', timeout = 3500, action } = {}) {
  const el = h('div', { class: `toast toast-${type}${action ? ' has-action' : ''}` }, h('span', {}, message));
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    if (el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  const start = () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, timeout);
  };
  if (action) {
    el.append(h('button', {
      type: 'button',
      class: 'toast-action',
      onMousedown: (e) => e.preventDefault(), // keep focus where it is (e.g. in the editor)
      onClick: () => {
        dismiss();
        action.onClick();
      },
    }, action.label));
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', start);
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('focusout', start);
  }
  toastHost().append(el);
  start();
  return dismiss;
}

// ---- Modal dialogs ------------------------------------------------------

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Opens a modal. `render(close)` returns the body content.
 * Resolves with the value passed to close(), or undefined on dismiss.
 * Tab stays inside the dialog; focus goes back to where it was when it closes.
 */
export function modal({ title, render, wide = false }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const dialog = h('dialog', { class: `modal${wide ? ' modal-wide' : ''}`, 'aria-label': title });
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      // Toasts still showing in the dialog move to the page (or the dialog below), so they don't vanish with it.
      const left = dialog.querySelectorAll(':scope > .toasts > .toast:not(.leaving)');
      dialog.close();
      dialog.remove();
      if (left.length) toastHost().append(...left);
      previous?.focus?.();
      resolve(value);
    };
    dialog.append(
      h('header', { class: 'modal-head' }, h('h2', {}, title), iconButton('close', 'Close', () => close(undefined))),
      h('div', { class: 'modal-body' }, render(close)),
      // Present from the start, so the first toast shown in the dialog is announced.
      h('div', { class: 'toasts', role: 'status' }),
    );
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(undefined);
    });
    // Close on a click on the backdrop, but not when a text selection started inside ends there.
    let downOnBackdrop = false;
    dialog.addEventListener('pointerdown', (e) => {
      downOnBackdrop = e.target === dialog;
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog && downOnBackdrop) close(undefined);
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('[autofocus]')?.focus();
  });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', ok = 'OK' } = {}) {
  return modal({
    title,
    render: (close) => {
      const input = h('input', { type: 'text', value, placeholder, autofocus: true, 'aria-label': label || title });
      const form = h(
        'form',
        {
          class: 'stack',
          onSubmit: (e) => {
            e.preventDefault();
            const v = input.value.trim();
            if (v) close(v);
          },
        },
        label && h('label', {}, label),
        input,
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn', onClick: () => close(undefined) }, 'Cancel'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, ok)),
      );
      queueMicrotask(() => input.select());
      return form;
    },
  });
}

/** Asks OK/Cancel. With `danger`, focus starts on Cancel so Enter does not destroy anything. */
export function confirmDialog(title, message, { ok = 'OK', danger = false } = {}) {
  return modal({
    title,
    render: (close) =>
      h('div', { class: 'stack' },
        h('p', {}, message),
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn', autofocus: danger, onClick: () => close(false) }, 'Cancel'),
          h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, autofocus: !danger, onClick: () => close(true) }, ok))),
  }).then(Boolean);
}

/**
 * Shows a message with several labelled choices; resolves with the chosen value (undefined when dismissed).
 * choices: [{ label, value, primary?, danger?, autofocus? }]. Focus starts on the `autofocus`
 * choice, else on the first choice that is not `danger`.
 */
export function choiceDialog(title, message, choices) {
  let focus = choices.findIndex((c) => c.autofocus);
  if (focus < 0) focus = choices.findIndex((c) => !c.danger);
  return modal({
    title,
    render: (close) =>
      h('div', { class: 'stack' },
        typeof message === 'string' ? h('p', {}, message) : message,
        h('div', { class: 'modal-actions' },
          choices.map((c, i) =>
            h('button', {
              type: 'button',
              class: `btn${c.danger ? ' btn-danger' : c.primary ? ' btn-primary' : ''}`,
              autofocus: i === focus,
              onClick: () => close(c.value),
            }, c.label)))),
  });
}

// ---- Dropdown menus -----------------------------------------------------

let openMenu = null;

/** Closes the open menu; `refocus` puts focus back on the button that opened it. */
function closeMenu(refocus = false) {
  if (!openMenu) return;
  const { anchor } = openMenu;
  openMenu.remove();
  openMenu = null;
  anchor.setAttribute('aria-expanded', 'false');
  if (refocus && anchor.isConnected) anchor.focus();
}
document.addEventListener('click', (e) => {
  // A click on the menu's own button is left to showMenu, which then closes the menu.
  if (openMenu && !openMenu.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});

function menuKeydown(e) {
  const items = [...e.currentTarget.querySelectorAll('[role^="menuitem"]')];
  const i = items.indexOf(document.activeElement);
  let next;
  if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
  else if (e.key === 'ArrowUp') next = items[i <= 0 ? items.length - 1 : i - 1];
  else if (e.key === 'Home') next = items[0];
  else if (e.key === 'End') next = items[items.length - 1];
  else if (e.key === 'Escape' || e.key === 'Tab') {
    // Handled here, so a page-level Escape (e.g. closing the sidebar) does not also run.
    e.preventDefault();
    e.stopPropagation();
    closeMenu(true);
    return;
  } else return;
  e.preventDefault();
  next?.focus();
}

/**
 * Opens a menu under `anchor`; calling it again for the same anchor closes it.
 * items: [{ label, icon?, onClick, danger?, checked? } | 'separator']
 */
export function showMenu(anchor, items) {
  const wasSame = openMenu?.anchor === anchor;
  closeMenu(wasSame);
  if (wasSame) return;
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': anchor.getAttribute('aria-label'), onKeydown: menuKeydown },
    items.map((item) =>
      item === 'separator'
        ? h('div', { class: 'menu-sep', role: 'separator' })
        : h('button', {
            type: 'button',
            // Items with a check mark are toggles, so screen readers announce their state.
            role: item.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
            'aria-checked': item.checked === undefined ? null : String(Boolean(item.checked)),
            tabindex: '-1',
            class: `menu-item${item.danger ? ' danger' : ''}`,
            onClick: () => {
              closeMenu(true);
              item.onClick();
            },
          },
          h('span', { class: 'menu-icon' }, item.icon ? icon(item.icon) : null),
          h('span', {}, item.label),
          item.checked !== undefined && h('span', { class: 'menu-check', 'aria-hidden': 'true' }, item.checked ? '✓' : ''))));
  menu.anchor = anchor;
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const left = Math.min(r.left, window.innerWidth - mw - 8);
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  openMenu = menu;
  menu.querySelector('[role^="menuitem"]')?.focus();
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timeAgo(iso) {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
