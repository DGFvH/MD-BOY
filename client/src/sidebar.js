// Sidebar: folder tree, document list, search and footer.
import { api } from './api.js';
import { h, icons, iconButton, showMenu, debounce, escapeHtml, toast } from './ui.js';
import { getPrefs, setPref } from './storage.js';

export function createSidebar(root, actions) {
  let state = { folders: [], docs: [], currentId: null, trashOpen: false, user: null };
  let query = '';
  let results = null;

  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Search documents…',
    'aria-label': 'Search documents',
    onInput: () => runSearch(),
    onKeydown: (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        runSearch();
      }
    },
  });

  const runSearch = debounce(async () => {
    query = searchInput.value.trim();
    if (!query) {
      results = null;
      return render();
    }
    try {
      const { documents } = await api.searchDocs(query);
      if (searchInput.value.trim() === query) {
        results = documents;
        render();
      }
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }, 200);

  const tree = h('nav', { class: 'tree', 'aria-label': 'Documents' });
  const userLabel = h('span', { class: 'user' });

  root.append(
    h('div', { class: 'sidebar-head' },
      h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), 'MD-BOY'),
      iconButton('upload', 'Import Markdown files', () => actions.onImport()),
      iconButton('menu', 'Hide sidebar', () => actions.onToggleSidebar())),
    h('div', { class: 'sidebar-search' }, h('span', { class: 'search-icon', html: icons.search }), searchInput),
    h('div', { class: 'sidebar-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onClick: () => actions.onNewDoc(null), html: `${icons.plus}<span>New doc</span>` }),
      h('button', { type: 'button', class: 'btn', onClick: () => actions.onNewFolder(null), html: `${icons.folderPlus}<span>Folder</span>` })),
    tree,
    h('div', { class: 'sidebar-foot' },
      userLabel,
      iconButton('trash', 'Trash', () => actions.onShowTrash(), { class: 'icon-btn', id: 'trash-btn' }),
      iconButton('logout', 'Sign out', () => actions.onLogout())),
  );

  // ---- Drag & drop documents onto folders ----
  function makeDropTarget(row, folderId) {
    row.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-mdboy-doc')) return;
      e.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      row.classList.remove('drop-target');
      const id = e.dataTransfer.getData('application/x-mdboy-doc');
      if (id) {
        e.preventDefault();
        actions.onMoveDoc(id, folderId);
      }
    });
  }

  function docRow(doc, depth) {
    const row = h('div', {
      class: `tree-row${doc.id === state.currentId ? ' active' : ''}`,
      role: 'link',
      tabindex: '0',
      draggable: 'true',
      style: `--depth:${depth}`,
      'aria-current': doc.id === state.currentId ? 'page' : false,
      dataset: { docId: doc.id },
      onClick: () => actions.onOpenDoc(doc.id),
      onKeydown: (e) => {
        if (e.key === 'Enter') actions.onOpenDoc(doc.id);
      },
      onDragstart: (e) => {
        e.dataTransfer.setData('application/x-mdboy-doc', doc.id);
        e.dataTransfer.effectAllowed = 'move';
      },
    },
    h('span', { class: 'tree-icon', html: icons.file }),
    h('span', { class: 'label', title: doc.title }, doc.title || 'Untitled'),
    iconButton('more', `Actions for ${doc.title}`, (e) => {
      e.stopPropagation();
      showMenu(e.currentTarget, [
        { label: 'Rename', icon: 'edit', onClick: () => actions.onRenameDoc(doc) },
        { label: 'Move to…', icon: 'folder', onClick: () => actions.onMoveDocPrompt(doc) },
        { label: 'Duplicate', icon: 'file', onClick: () => actions.onDuplicateDoc(doc) },
        'separator',
        { label: 'Move to trash', icon: 'trash', danger: true, onClick: () => actions.onDeleteDoc(doc) },
      ]);
    }));
    return row;
  }

  function folderRows(folder, depth, childrenOf, docsIn) {
    const collapsed = !!getPrefs().collapsed[folder.id];
    const toggle = () => {
      const c = { ...getPrefs().collapsed };
      if (c[folder.id]) delete c[folder.id];
      else c[folder.id] = true;
      setPref('collapsed', c);
      render();
    };
    const row = h('div', {
      class: 'tree-row folder-row',
      role: 'button',
      tabindex: '0',
      'aria-expanded': String(!collapsed),
      style: `--depth:${depth}`,
      onClick: toggle,
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      },
    },
    h('span', { class: `tree-icon chev${collapsed ? '' : ' open'}`, html: icons.chevron }),
    h('span', { class: 'tree-icon', html: icons.folder }),
    h('span', { class: 'label', title: folder.name }, folder.name),
    iconButton('plus', `New document in ${folder.name}`, (e) => {
      e.stopPropagation();
      actions.onNewDoc(folder.id);
    }),
    iconButton('more', `Actions for ${folder.name}`, (e) => {
      e.stopPropagation();
      showMenu(e.currentTarget, [
        { label: 'New document', icon: 'plus', onClick: () => actions.onNewDoc(folder.id) },
        { label: 'New subfolder', icon: 'folderPlus', onClick: () => actions.onNewFolder(folder.id) },
        { label: 'Rename', icon: 'edit', onClick: () => actions.onRenameFolder(folder) },
        { label: 'Move to…', icon: 'folder', onClick: () => actions.onMoveFolderPrompt(folder) },
        'separator',
        { label: 'Delete folder', icon: 'trash', danger: true, onClick: () => actions.onDeleteFolder(folder) },
      ]);
    }));
    makeDropTarget(row, folder.id);
    const out = [row];
    if (!collapsed) {
      for (const child of childrenOf(folder.id)) out.push(...folderRows(child, depth + 1, childrenOf, docsIn));
      for (const doc of docsIn(folder.id)) out.push(docRow(doc, depth + 1));
    }
    return out;
  }

  function render() {
    userLabel.textContent = state.user?.email ?? '';
    userLabel.title = state.user?.email ?? '';
    tree.replaceChildren();

    if (results) {
      tree.append(h('div', { class: 'tree-section' }, `Results for “${query}”`));
      if (!results.length) tree.append(h('div', { class: 'tree-empty' }, 'No matching documents.'));
      for (const doc of results) {
        const excerpt = escapeHtml(doc.excerpt ?? '').replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>');
        tree.append(h('div', { class: 'search-result', role: 'link', tabindex: '0', onClick: () => actions.onOpenDoc(doc.id), onKeydown: (e) => e.key === 'Enter' && actions.onOpenDoc(doc.id) },
          h('strong', {}, doc.title),
          h('span', { html: excerpt })));
      }
      return;
    }

    const folderIds = new Set(state.folders.map((f) => f.id));
    const childrenOf = (pid) => state.folders.filter((f) => (f.parent_id ?? null) === pid);
    const docsIn = (fid) => state.docs.filter((d) => (folderIds.has(d.folder_id) ? d.folder_id : null) === fid)
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));

    const rootHeader = h('div', { class: 'tree-section' }, 'Documents');
    makeDropTarget(rootHeader, null);
    tree.append(rootHeader);
    for (const f of childrenOf(null)) tree.append(...folderRows(f, 0, childrenOf, docsIn));
    for (const d of docsIn(null)) tree.append(docRow(d, 0));
    if (!state.docs.length && !state.folders.length) {
      tree.append(h('div', { class: 'tree-empty' }, 'No documents yet. Create one to get started.'));
    }
    document.getElementById('trash-btn')?.classList.toggle('active', state.trashOpen);
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
