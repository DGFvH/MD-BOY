// Sidebar: folder tree, document list, search and footer.
import { api } from './api.js';
import { APP_NAME } from './brand.js';
import { h, icon, icons, iconButton, showMenu, debounce, toast } from './ui.js';
import { getPrefs, setPref } from './storage.js';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const byTitle = (a, b) => collator.compare(a.title || 'Untitled', b.title || 'Untitled');
const byName = (a, b) => collator.compare(a.name ?? '', b.name ?? '');

// Ctrl/Cmd/Shift-click on a document link is left to the browser (new tab or window).
const plainClick = (e) => !(e.ctrlKey || e.metaKey || e.shiftKey);

/** Search excerpts mark matches with \u0002 … \u0003, which never occur in normal text. */
function excerptNodes(text) {
  return String(text ?? '').split(/(\u0002[^\u0002\u0003]*\u0003)/).map((part) =>
    part.startsWith('\u0002') ? h('mark', {}, part.slice(1, -1)) : part.replace(/[\u0002\u0003]/g, ''));
}

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (map.has(key)) map.get(key).push(item);
    else map.set(key, [item]);
  }
  return map;
}

// Row ⋯ buttons open a menu; showMenu keeps aria-expanded up to date.
const MENU_BUTTON = { 'aria-haspopup': 'menu', 'aria-expanded': 'false' };

function setLabel(button, label) {
  button.title = label;
  button.setAttribute('aria-label', label);
}

export function createSidebar(root, actions) {
  let state = { folders: [], docs: [], currentId: null, trashOpen: false, user: null };
  let query = ''; // the query the shown results are for
  let results = null; // search result elements, or null when not searching
  let shown = ''; // 'tree' | 'results'
  let treeKey = ''; // what the tree was last laid out from

  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Search documents…',
    'aria-label': 'Search documents',
    onInput: () => runSearch(),
    onKeydown: (e) => {
      if (e.key === 'Escape' && searchInput.value) {
        e.preventDefault();
        e.stopPropagation();
        searchInput.value = '';
        search();
      } else if (e.key === 'ArrowDown' && results?.length) {
        e.preventDefault();
        results[0].focus();
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        openFirstResult();
      }
    },
  });

  async function search() {
    runSearch.cancel();
    const q = searchInput.value.trim();
    if (!q) return setResults(null, '');
    try {
      const { documents } = await api.searchDocs(q);
      if (searchInput.value.trim() === q) setResults(documents, q);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }
  const runSearch = debounce(search, 200);

  async function openFirstResult() {
    if (searchInput.value.trim() !== query) await search();
    if (results?.length && searchInput.value.trim() === query) actions.onOpenDoc(results[0].doc.id);
  }

  function setResults(docs, q) {
    query = q;
    results = docs && docs.map(resultRow);
    render();
  }

  const tree = h('nav', {
    class: 'tree',
    'aria-label': 'Documents',
    // Arrow keys move through search results; Escape goes back to the search box.
    onKeydown: (e) => {
      const i = results ? results.indexOf(document.activeElement) : -1;
      if (i < 0) return;
      let next;
      if (e.key === 'ArrowDown') next = results[i + 1];
      else if (e.key === 'ArrowUp') next = results[i - 1] ?? searchInput;
      else if (e.key === 'Escape') next = searchInput;
      else return;
      e.preventDefault();
      e.stopPropagation();
      next?.focus();
    },
  });
  const userLabel = actions.onAccount
    ? h('button', { type: 'button', class: 'user', onClick: () => actions.onAccount() })
    : h('span', { class: 'user' });
  const trashBtn = iconButton('trash', 'Trash', () => actions.onShowTrash(), { id: 'trash-btn' });

  root.append(
    h('div', { class: 'sidebar-head' },
      h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), APP_NAME),
      iconButton('upload', 'Import Markdown files', () => actions.onImport()),
      iconButton('menu', 'Hide sidebar', () => actions.onToggleSidebar())),
    h('div', { class: 'sidebar-search' }, h('span', { class: 'search-icon', html: icons.search }), searchInput),
    h('div', { class: 'sidebar-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onClick: () => actions.onNewDoc(null), html: `${icons.plus}<span>New doc</span>` }),
      h('button', { type: 'button', class: 'btn', onClick: () => actions.onNewFolder(null), html: `${icons.folderPlus}<span>Folder</span>` })),
    tree,
    h('div', { class: 'sidebar-foot' }, userLabel, trashBtn, iconButton('logout', 'Sign out', () => actions.onLogout())),
  );

  // ---- Drag & drop documents onto folders ----
  function makeDropTarget(row, folderId) {
    row.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-hashmark-doc')) return;
      e.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      row.classList.remove('drop-target');
      const id = e.dataTransfer.getData('application/x-hashmark-doc');
      if (id) {
        e.preventDefault();
        actions.onMoveDoc(id, folderId);
      }
    });
  }

  // ---- Rows ----
  // Rows are kept per document and folder and reused between renders: large trees stay
  // fast, and keyboard focus and the button of an open menu survive a re-render.
  // The main part of a row (link or button) and its action buttons are siblings, so each
  // works on its own from the keyboard.
  const rows = new Map(); // 'd:<id>' | 'f:<id>' -> { el, item, name, depth, ...parts }
  let activeRow = null;

  function rowFor(key, build) {
    let r = rows.get(key);
    if (!r) rows.set(key, (r = build()));
    return r;
  }

  function setDepth(r, depth) {
    if (r.depth === depth) return;
    r.depth = depth;
    r.el.style.setProperty('--depth', depth);
  }

  function buildDocRow(id) {
    const r = {};
    r.label = h('span', { class: 'label' });
    r.link = h('a', { class: 'tree-main', href: `#/doc/${id}`, draggable: 'false' },
      h('span', { class: 'tree-icon' }, icon('file')), r.label);
    r.more = iconButton('more', 'Actions', (e) => {
      e.stopPropagation();
      // The current object: the app updates the one it is given.
      const doc = state.docs.find((d) => d.id === id) ?? r.item;
      showMenu(e.currentTarget, [
        { label: 'Rename', icon: 'edit', onClick: () => actions.onRenameDoc(doc) },
        { label: 'Move to…', icon: 'folder', onClick: () => actions.onMoveDocPrompt(doc) },
        { label: 'Duplicate', icon: 'file', onClick: () => actions.onDuplicateDoc(doc) },
        'separator',
        { label: 'Move to trash', icon: 'trash', danger: true, onClick: () => actions.onDeleteDoc(doc) },
      ]);
    }, MENU_BUTTON);
    r.el = h('div', {
      class: 'tree-row',
      draggable: 'true',
      dataset: { docId: id },
      onClick: (e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        actions.onOpenDoc(id);
      },
      onDragstart: (e) => {
        e.dataTransfer.setData('application/x-hashmark-doc', id);
        e.dataTransfer.effectAllowed = 'move';
      },
    }, r.link, r.more);
    return r;
  }

  function docRow(doc, depth) {
    const r = rowFor(`d:${doc.id}`, () => buildDocRow(doc.id));
    r.item = doc;
    const title = doc.title || 'Untitled';
    if (r.name !== title) {
      r.name = title;
      r.label.textContent = r.label.title = title;
      setLabel(r.more, `Actions for ${title}`);
    }
    setDepth(r, depth);
    return r.el;
  }

  function toggleFolder(id) {
    const c = { ...getPrefs().collapsed };
    if (c[id]) delete c[id];
    else c[id] = true;
    setPref('collapsed', c);
    render();
  }

  function buildFolderRow(id) {
    const r = {};
    r.chev = h('span', { class: 'tree-icon chev' }, icon('chevron'));
    r.label = h('span', { class: 'label' });
    r.toggle = h('button', { type: 'button', class: 'tree-main' }, r.chev, h('span', { class: 'tree-icon' }, icon('folder')), r.label);
    r.add = iconButton('plus', 'New document', (e) => {
      e.stopPropagation();
      actions.onNewDoc(id);
    }, { class: 'icon-btn row-add' });
    r.more = iconButton('more', 'Actions', (e) => {
      e.stopPropagation();
      const folder = state.folders.find((f) => f.id === id) ?? r.item;
      showMenu(e.currentTarget, [
        { label: 'New document', icon: 'plus', onClick: () => actions.onNewDoc(folder.id) },
        { label: 'New subfolder', icon: 'folderPlus', onClick: () => actions.onNewFolder(folder.id) },
        { label: 'Rename', icon: 'edit', onClick: () => actions.onRenameFolder(folder) },
        { label: 'Move to…', icon: 'folder', onClick: () => actions.onMoveFolderPrompt(folder) },
        'separator',
        { label: 'Delete folder', icon: 'trash', danger: true, onClick: () => actions.onDeleteFolder(folder) },
      ]);
    }, MENU_BUTTON);
    r.el = h('div', { class: 'tree-row folder-row', dataset: { folderId: id }, onClick: () => toggleFolder(id) },
      r.toggle, r.add, r.more);
    makeDropTarget(r.el, id);
    return r;
  }

  function folderRow(folder, depth, open) {
    const r = rowFor(`f:${folder.id}`, () => buildFolderRow(folder.id));
    r.item = folder;
    if (r.name !== folder.name) {
      r.name = folder.name;
      r.label.textContent = r.label.title = folder.name;
      setLabel(r.add, `New document in ${folder.name}`);
      setLabel(r.more, `Actions for ${folder.name}`);
    }
    r.toggle.setAttribute('aria-expanded', String(open));
    r.chev.classList.toggle('open', open);
    setDepth(r, depth);
    return r.el;
  }

  function resultRow(doc) {
    const title = h('strong', {}, doc.title || 'Untitled');
    const el = h('a', {
      class: 'search-result',
      href: `#/doc/${doc.id}`,
      onClick: (e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        actions.onOpenDoc(doc.id);
      },
    }, title, h('span', {}, excerptNodes(doc.excerpt)));
    el.doc = doc;
    el.titleEl = title;
    return el;
  }

  // ---- Rendering ----
  const rootHeader = h('div', { class: 'tree-section' }, 'Documents');
  makeDropTarget(rootHeader, null);
  const emptyTree = h('div', { class: 'tree-empty' }, 'No documents yet. Create one to get started.');
  const resultsHeader = h('div', { class: 'tree-section' });
  const noResults = h('div', { class: 'tree-empty' }, 'No matching documents.');

  /** Makes the list show `nodes`, moving only what changed, and keeps keyboard focus in place. */
  function place(nodes) {
    const active = document.activeElement;
    const index = tree.contains(active) ? [...tree.children].findIndex((el) => el.contains(active)) : -1;
    const keep = new Set(nodes);
    for (const el of [...tree.children]) if (!keep.has(el)) el.remove();
    let cur = tree.firstElementChild;
    for (const el of nodes) {
      if (el === cur) cur = cur.nextElementSibling;
      else tree.insertBefore(el, cur);
    }
    if (index < 0 || document.activeElement === active) return;
    if (active.isConnected) return active.focus({ preventScroll: true });
    // Its row went away (e.g. moved to the trash): continue from the row now in its place.
    const row = tree.children[Math.min(index, tree.children.length - 1)];
    (row?.matches('a') ? row : row?.querySelector('.tree-main'))?.focus();
  }

  function renderTree(force) {
    const collapsed = getPrefs().collapsed;
    const key = JSON.stringify([
      collapsed,
      state.folders.map((f) => [f.id, f.parent_id, f.name]),
      state.docs.map((d) => [d.id, d.folder_id, d.title]),
    ]);
    // Nothing shown changed (e.g. only the open document did): keep the tree as it is.
    if (key === treeKey && !force) return;
    treeKey = key;

    const folderIds = new Set(state.folders.map((f) => f.id));
    const parentOf = (id) => (folderIds.has(id) ? id : null);
    const subfolders = groupBy(state.folders, (f) => parentOf(f.parent_id));
    const docsIn = groupBy(state.docs, (d) => parentOf(d.folder_id));
    const list = [rootHeader];
    const walk = (folderId, depth) => {
      for (const f of (subfolders.get(folderId) ?? []).sort(byName)) {
        const open = !collapsed[f.id];
        list.push(folderRow(f, depth, open));
        if (open) walk(f.id, depth + 1);
      }
      for (const d of (docsIn.get(folderId) ?? []).sort(byTitle)) list.push(docRow(d, depth));
    };
    walk(null, 0);
    if (!state.docs.length && !state.folders.length) list.push(emptyTree);

    const live = new Set([...state.folders.map((f) => `f:${f.id}`), ...state.docs.map((d) => `d:${d.id}`)]);
    for (const k of rows.keys()) if (!live.has(k)) rows.delete(k);
    place(list);
  }

  function markActive() {
    const r = rows.get(`d:${state.currentId}`) ?? null;
    if (r === activeRow) return;
    if (activeRow) {
      activeRow.el.classList.remove('active');
      activeRow.link.removeAttribute('aria-current');
    }
    if (r) {
      r.el.classList.add('active');
      r.link.setAttribute('aria-current', 'page');
    }
    activeRow = r;
  }

  function renderResults() {
    const titles = new Map(state.docs.map((d) => [d.id, d.title]));
    for (const el of results) {
      // Titles follow renames made since the search.
      const title = (titles.get(el.doc.id) ?? el.doc.title) || 'Untitled';
      if (el.titleEl.textContent !== title) el.titleEl.textContent = title;
      const active = el.doc.id === state.currentId;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
    resultsHeader.textContent = `Results for “${query}”`;
    place([resultsHeader, ...(results.length ? results : [noResults])]);
  }

  function render() {
    const email = state.user?.email ?? '';
    userLabel.textContent = email;
    userLabel.title = actions.onAccount ? `${email} – Account settings` : email;
    if (actions.onAccount) userLabel.setAttribute('aria-label', email ? `Account settings (${email})` : 'Account settings');
    trashBtn.classList.toggle('active', !!state.trashOpen);
    trashBtn.setAttribute('aria-pressed', String(!!state.trashOpen));

    if (results) {
      renderResults();
      shown = 'results';
    } else {
      renderTree(shown !== 'tree');
      shown = 'tree';
      markActive();
    }
  }

  return {
    update(patch) {
      state = { ...state, ...patch };
      render();
    },
    focusSearch() {
      searchInput.focus();
      searchInput.select();
    },
    refreshSearch() {
      if (query) runSearch();
    },
  };
}
