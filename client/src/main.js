import 'katex/dist/katex.min.css';
import './markdown.css';
import './styles.css';

import { api, setUnauthorizedHandler } from './api.js';
import { createEditor, commands } from './editor.js';
import { createPreview, extractHeadings, documentStats, renderMarkdown } from './preview.js';
import { createSidebar } from './sidebar.js';
import { saveDraft, loadDraft, clearDraft, getPrefs, setPref } from './storage.js';
import { exportMarkdown, exportHtml, printDocument, pickMarkdownFiles, readMarkdownFiles } from './export.js';
import {
  h, icons, iconButton, toast, modal, promptDialog, confirmDialog, choiceDialog, showMenu, debounce, timeAgo,
} from './ui.js';
import { WELCOME_TITLE, WELCOME_CONTENT } from './welcome.js';

const root = document.getElementById('app');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const mobileQuery = window.matchMedia('(max-width: 820px)');

let user = null;
let shell = null; // the mounted app, see mountApp()

// ---- Theme ------------------------------------------------------------------

function isDark() {
  const theme = getPrefs().theme;
  return theme === 'dark' || (theme === 'auto' && darkQuery.matches);
}

function applyTheme() {
  const theme = getPrefs().theme;
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  // Keep data-theme accurate for CSS that only needs light/dark.
  if (theme === 'auto' && darkQuery.matches) document.documentElement.dataset.theme = 'dark';
}
darkQuery.addEventListener('change', () => {
  applyTheme();
  shell?.onThemeChange();
});
applyTheme();

// ---- Boot -------------------------------------------------------------------

setUnauthorizedHandler(() => {
  if (!user) return;
  user = null;
  shell?.destroy();
  shell = null;
  showAuth('login', 'Your session has expired. Please sign in again.');
});

async function boot() {
  try {
    ({ user } = await api.me());
    mountApp();
  } catch (err) {
    if (err.status === 401) showAuth('login');
    else {
      root.replaceChildren(
        h('div', { class: 'boot' },
          h('div', { class: 'stack', style: 'align-items:center' },
            h('p', {}, `Could not reach the server: ${err.message}`),
            h('button', { class: 'btn', onClick: boot }, 'Try again'))),
      );
    }
  }
}

// ---- Auth screen ------------------------------------------------------------

function showAuth(mode = 'login', notice = '') {
  const isLogin = mode === 'login';
  const error = h('div', { class: 'auth-error', role: 'alert' }, notice);
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, autofocus: true, id: 'auth-email' });
  const password = h('input', {
    type: 'password', name: 'password', required: true, minlength: '8', id: 'auth-password',
    autocomplete: isLogin ? 'current-password' : 'new-password',
  });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, isLogin ? 'Sign in' : 'Create account');

  const form = h('form', {
    class: 'stack',
    onSubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        const res = isLogin ? await api.login(email.value, password.value) : await api.register(email.value, password.value);
        user = res.user;
        if (!isLogin) {
          await api.createDoc({ title: WELCOME_TITLE, content: WELCOME_CONTENT }).catch(() => {});
        }
        mountApp();
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    },
  },
  h('div', { class: 'stack', style: 'gap:6px' }, h('label', { for: 'auth-email' }, 'Email'), email),
  h('div', { class: 'stack', style: 'gap:6px' }, h('label', { for: 'auth-password' }, 'Password'), password),
  error,
  submit);

  root.replaceChildren(
    h('div', { class: 'auth' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), 'MD-BOY'),
        h('h1', {}, isLogin ? 'Welcome back' : 'Create your account'),
        h('p', { class: 'muted' }, isLogin ? 'Sign in to open your documents.' : 'Free, simple, and your documents are saved in the cloud.'),
        form,
        h('div', { class: 'auth-switch' },
          isLogin ? 'New here? ' : 'Already have an account? ',
          h('button', { type: 'button', class: 'link-btn', onClick: () => showAuth(isLogin ? 'register' : 'login') }, isLogin ? 'Create an account' : 'Sign in')))),
  );
  email.focus();
}

// ---- The editor app ---------------------------------------------------------

function mountApp() {
  shell?.destroy();
  shell = createApp();
}

function createApp() {
  const prefs = getPrefs();
  let docs = [];
  let folders = [];
  let doc = null; // the open document: { id, title, content, version, folder_id, ... }
  let dirty = false;
  let conflict = false;
  let currentSave = null;
  let queued = null;
  let offlineTimer = null;
  let trashOpen = false;
  let autoTitle = null;
  let revisionsCache = null;
  const cleanups = [];

  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  // ---- Layout ----
  const sidebarEl = h('aside', { class: 'sidebar', 'aria-label': 'Sidebar' });
  const backdrop = h('div', { class: 'sidebar-backdrop', onClick: () => setMobileSidebar(false) });
  const titleInput = h('input', {
    type: 'text', class: 'title-input', 'aria-label': 'Document title', placeholder: 'Untitled', maxlength: '200',
    onInput: () => {
      if (!doc) return;
      doc.title = titleInput.value;
      autoTitle = null;
      markDirty();
    },
    onKeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        editor.focus();
      }
    },
    onBlur: () => {
      if (doc && !titleInput.value.trim()) {
        titleInput.value = doc.title = 'Untitled';
        markDirty();
      }
    },
  });
  const saveStatus = h('span', { class: 'save-status', 'data-state': 'saved', role: 'status' }, 'Saved');

  const viewButtons = {
    edit: iconButton('edit', 'Editor only (Ctrl+/ cycles)', () => setView('edit')),
    split: iconButton('split', 'Side by side', () => setView('split'), { class: 'icon-btn desktop-only' }),
    preview: iconButton('eye', 'Preview only', () => setView('preview')),
  };
  const outlineBtn = iconButton('list', 'Outline', () => togglePanel('outline'), { class: 'icon-btn desktop-only' });
  const historyBtn = iconButton('history', 'Version history', () => togglePanel('history'));
  const themeBtn = iconButton('auto', 'Theme', (e) => {
    const cur = getPrefs().theme;
    showMenu(e.currentTarget, [
      { label: 'System', icon: 'auto', checked: cur === 'auto', onClick: () => setTheme('auto') },
      { label: 'Light', icon: 'sun', checked: cur === 'light', onClick: () => setTheme('light') },
      { label: 'Dark', icon: 'moon', checked: cur === 'dark', onClick: () => setTheme('dark') },
    ]);
  });
  const moreBtn = iconButton('more', 'More actions', (e) => showMenu(e.currentTarget, moreMenuItems()));
  const menuBtn = iconButton('menu', 'Show sidebar', () => {
    if (mobileQuery.matches) setMobileSidebar(true);
    else setSidebar(true);
  }, { class: 'icon-btn sidebar-toggle' });

  const topbar = h('header', { class: 'topbar' },
    menuBtn, titleInput, saveStatus,
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' }, viewButtons.edit, viewButtons.split, viewButtons.preview),
    h('span', { class: 'divider desktop-only' }), outlineBtn, historyBtn, themeBtn, moreBtn);

  const tb = (icon, label, cmd) => iconButton(icon, label, () => editor.run(cmd));
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tb('heading', 'Heading (cycle H1–H3)', commands.cycleHeading),
    tb('bold', 'Bold (Ctrl+B)', commands.bold),
    tb('italic', 'Italic (Ctrl+I)', commands.italic),
    tb('strike', 'Strikethrough (Ctrl+Shift+X)', commands.strike),
    h('span', { class: 'sep' }),
    tb('ul', 'Bulleted list (Ctrl+Shift+8)', commands.ul),
    tb('ol', 'Numbered list (Ctrl+Shift+7)', commands.ol),
    tb('task', 'Task list (Ctrl+Shift+9)', commands.task),
    tb('quote', 'Quote', commands.quote),
    h('span', { class: 'sep' }),
    tb('link', 'Link (Ctrl+K)', commands.link),
    tb('image', 'Image', commands.image),
    tb('code', 'Inline code (Ctrl+E)', commands.code),
    tb('codeBlock', 'Code block (Ctrl+Shift+K)', commands.codeBlock),
    tb('table', 'Table', commands.table),
    tb('math', 'Math', commands.math),
    tb('hr', 'Horizontal rule', commands.hr));

  const editorPane = h('div', { class: 'pane pane-editor' });
  const previewContent = h('article', { class: 'markdown-body' });
  const previewPane = h('div', { class: 'pane pane-preview', tabindex: '-1', 'aria-label': 'Preview' }, previewContent);
  const panelTitle = h('span');
  const panelBody = h('div', { class: 'side-panel-body' });
  const sidePanel = h('aside', { class: 'side-panel', hidden: true },
    h('div', { class: 'side-panel-head' }, panelTitle, iconButton('close', 'Close panel', () => togglePanel(null))),
    panelBody);
  const workspace = h('div', { class: 'workspace', 'data-view': prefs.view }, editorPane, previewPane, sidePanel);

  const statWords = h('span');
  const statCursor = h('span', { class: 'hide-sm' });
  const statUpdated = h('span', { class: 'hide-sm' });
  const statusbar = h('footer', { class: 'statusbar' }, statWords, h('span', { class: 'spacer' }), statUpdated, statCursor);

  const emptyState = h('div', { class: 'empty-state' },
    h('div', {},
      h('h2', {}, 'No document open'),
      h('p', {}, 'Pick a document from the sidebar, or start a new one.'),
      h('button', { class: 'btn btn-primary', onClick: () => newDoc(null), html: `${icons.plus}<span>New document</span>` })));
  const trashView = h('section', { class: 'trash-view', hidden: true });

  const main = h('main', { class: 'main' }, topbar, toolbar, workspace, statusbar, emptyState, trashView);
  const appEl = h('div', { class: 'app' }, sidebarEl, backdrop, main);
  root.replaceChildren(appEl);

  // ---- Components ----
  const editor = createEditor(editorPane, {
    onChange: (text) => {
      if (!doc) return;
      doc.content = text;
      maybeAutoTitle(text);
      markDirty();
      schedulePreview();
    },
    onSave: () => save({ snapshot: true, announce: true }),
    onScroll: () => syncFrom('editor'),
    onCursor: ({ line, col, selected }) => {
      statCursor.textContent = `Ln ${line}, Col ${col}${selected ? ` (${selected} selected)` : ''}`;
    },
  });
  editor.setLineNumbers(prefs.lineNumbers);

  const preview = createPreview({ scroller: previewPane, content: previewContent }, {
    isDark,
    onScroll: () => syncFrom('preview'),
    onToggleTask: (line) => editor.toggleTaskAtLine(line),
  });

  const sidebar = createSidebar(sidebarEl, {
    onOpenDoc: (id) => openDoc(id),
    onNewDoc: (folderId) => newDoc(folderId),
    onNewFolder: (parentId) => newFolder(parentId),
    onRenameDoc: (d) => renameDoc(d),
    onMoveDoc: (id, folderId) => moveDoc(id, folderId),
    onMoveDocPrompt: (d) => moveDocPrompt(d),
    onDuplicateDoc: (d) => duplicateDoc(d),
    onDeleteDoc: (d) => trashDoc(d),
    onRenameFolder: (f) => renameFolder(f),
    onMoveFolderPrompt: (f) => moveFolderPrompt(f),
    onDeleteFolder: (f) => deleteFolder(f),
    onShowTrash: () => (trashOpen ? closeTrash() : showTrash()),
    onImport: () => importFiles(),
    onToggleSidebar: () => (mobileQuery.matches ? setMobileSidebar(false) : setSidebar(false)),
    onLogout: () => logout(),
  });

  // ---- Save status ----
  function setStatus(state, text) {
    const labels = { saved: 'Saved', dirty: 'Unsaved', saving: 'Saving…', offline: 'Offline – saved locally', conflict: 'Conflict', error: 'Save failed' };
    saveStatus.dataset.state = state;
    saveStatus.textContent = text ?? labels[state];
  }

  // ---- Saving ----
  const scheduleSave = debounce(() => save(), 1000);

  function markDirty() {
    if (!doc) return;
    dirty = true;
    saveDraft(doc.id, { title: doc.title, content: doc.content, baseVersion: doc.version });
    if (!conflict && saveStatus.dataset.state !== 'offline') setStatus('dirty');
    scheduleSave();
  }

  function save(opts = {}) {
    if (currentSave) {
      queued = { snapshot: queued?.snapshot || !!opts.snapshot, announce: queued?.announce || !!opts.announce };
      return currentSave;
    }
    currentSave = doSave(opts).finally(() => {
      currentSave = null;
      const next = queued;
      queued = null;
      if (next) save(next);
    });
    return currentSave;
  }

  async function doSave({ snapshot = false, announce = false } = {}) {
    if (!doc || conflict) return;
    if (!dirty && !snapshot) return;
    scheduleSave.cancel();
    clearTimeout(offlineTimer);
    const target = doc;
    const sent = { title: target.title.trim() || 'Untitled', content: target.content, version: target.version };
    setStatus('saving');
    try {
      const { document: saved } = await api.saveDoc(target.id, { ...sent, snapshot });
      target.version = saved.version;
      target.updated_at = saved.updated_at;
      if (target.content === sent.content && target.title === sent.title) {
        if (doc === target) dirty = false;
        clearDraft(target.id);
      } else {
        saveDraft(target.id, { title: target.title, content: target.content, baseVersion: target.version });
      }
      const meta = docs.find((d) => d.id === target.id);
      if (meta && (meta.title !== saved.title || meta.updated_at !== saved.updated_at)) {
        const titleChanged = meta.title !== saved.title;
        Object.assign(meta, { title: saved.title, updated_at: saved.updated_at, version: saved.version });
        if (titleChanged) renderSidebar();
      }
      if (doc === target) {
        setStatus(dirty ? 'dirty' : 'saved');
        updateMeta();
        if (dirty) scheduleSave();
      }
      if (snapshot) revisionsCache = null;
      if (announce) toast('Saved. A version was added to the history.');
      if (getPrefs().panel === 'history' && snapshot) renderPanel();
    } catch (err) {
      if (doc !== target) return;
      if (err.status === 409) return handleConflict(err.body.current);
      if (err.status === 0) {
        setStatus('offline');
        offlineTimer = setTimeout(() => save(), 5000);
      } else if (err.status === 404) {
        setStatus('error', 'Deleted elsewhere');
        toast('This document was deleted in another window. Your text is kept locally.', { type: 'error', timeout: 6000 });
      } else {
        setStatus('error');
        toast(err.message, { type: 'error' });
        offlineTimer = setTimeout(() => save(), 10000);
      }
    }
  }

  async function flush() {
    scheduleSave.cancel();
    if (currentSave) await currentSave;
    if (dirty && !conflict) await save();
  }

  async function handleConflict(current) {
    conflict = true;
    setStatus('conflict');
    const choice = await choiceDialog(
      'This document changed elsewhere',
      'It was edited in another tab or on another device since you opened it. What would you like to do?',
      [
        { label: 'Keep a copy of mine', value: 'copy' },
        { label: 'Load the other version', value: 'theirs' },
        { label: 'Overwrite with mine', value: 'mine', primary: true },
      ],
    );
    if (!doc || doc.id !== current.id) return;
    conflict = false;
    if (choice === 'theirs' || choice === 'copy') {
      if (choice === 'copy') {
        const { document: copy } = await api.createDoc({ title: `${doc.title} (my version)`, content: doc.content, folder_id: doc.folder_id });
        docs.unshift(copy);
        toast(`Your version was saved as “${copy.title}”.`);
      }
      clearDraft(doc.id);
      setDoc(current, { skipDraft: true });
      renderSidebar();
    } else if (choice === 'mine') {
      doc.version = current.version;
      dirty = true;
      save();
    } else {
      // Dismissed: keep the local text; the next save will run into the conflict and ask again.
      setStatus('conflict');
    }
  }

  // ---- Documents ----
  async function refreshLists() {
    const [d, f] = await Promise.all([api.listDocs(), api.listFolders()]);
    docs = d.documents;
    folders = f.folders;
    renderSidebar();
  }

  function renderSidebar() {
    sidebar.update({ docs, folders, currentId: trashOpen ? null : doc?.id ?? null, trashOpen, user });
  }

  function showDocUI(show) {
    toolbar.hidden = workspace.hidden = statusbar.hidden = !show;
    emptyState.hidden = show || trashOpen;
    trashView.hidden = !trashOpen;
    titleInput.disabled = !show;
    for (const b of [outlineBtn, historyBtn, ...Object.values(viewButtons)]) b.disabled = !show;
    saveStatus.hidden = !show;
    if (!show) titleInput.value = trashOpen ? 'Trash' : '';
  }

  function setDoc(d, { skipDraft = false } = {}) {
    doc = { ...d };
    dirty = false;
    conflict = false;
    revisionsCache = null;
    autoTitle = null;
    trashOpen = false;
    const draft = skipDraft ? null : loadDraft(d.id);
    let restoredDraft = false;
    let askDraft = null;
    if (draft && (draft.content !== d.content || draft.title !== d.title)) {
      if (draft.baseVersion === d.version) {
        doc.content = draft.content;
        doc.title = draft.title;
        restoredDraft = true;
      } else {
        askDraft = draft;
      }
    } else if (draft) {
      clearDraft(d.id);
    }
    titleInput.value = doc.title;
    editor.load(doc.content);
    preview.update(doc.content, { force: true });
    previewPane.scrollTop = 0;
    showDocUI(true);
    updateMeta();
    renderPanel();
    setStatus('saved');
    setPref('lastDoc', doc.id);
    if (location.hash !== `#/doc/${doc.id}`) history.replaceState(null, '', `#/doc/${doc.id}`);
    document.title = `${doc.title} · MD-BOY`;
    renderSidebar();
    if (restoredDraft) {
      dirty = true;
      setStatus('dirty');
      toast('Restored changes that had not been saved yet.');
      save();
    }
    if (askDraft) {
      const draftDocId = d.id;
      choiceDialog('Unsaved local changes found',
        `This browser has changes from ${timeAgo(new Date(askDraft.savedAt).toISOString())} that were never saved, but the document has changed since. Restore your local changes?`,
        [
          { label: 'Discard them', value: false },
          { label: 'Restore my changes', value: true, primary: true },
        ]).then((restore) => {
        if (!doc || doc.id !== draftDocId) return;
        if (restore) {
          doc.title = titleInput.value = askDraft.title;
          editor.replace(askDraft.content);
          doc.content = askDraft.content;
          preview.update(doc.content);
          markDirty();
        } else {
          clearDraft(draftDocId);
        }
      });
    }
  }

  async function openDoc(id, { focus = false } = {}) {
    if (doc?.id === id && !trashOpen) {
      setMobileSidebar(false);
      return;
    }
    await flush();
    try {
      const { document: d } = await api.getDoc(id);
      if (d.deleted_at) {
        toast('That document is in the trash.');
        return showTrash();
      }
      trashOpen = false;
      setDoc(d);
      setMobileSidebar(false);
      if (focus) editor.focus();
    } catch (err) {
      if (err.status === 404) {
        toast('That document no longer exists.', { type: 'error' });
        docs = docs.filter((x) => x.id !== id);
        if (doc?.id === id) closeDoc();
        renderSidebar();
      } else {
        toast(err.message, { type: 'error' });
      }
    }
  }

  function closeDoc() {
    doc = null;
    dirty = false;
    document.title = 'MD-BOY';
    history.replaceState(null, '', trashOpen ? '#/trash' : '#/');
    showDocUI(false);
    sidePanel.hidden = true;
    renderSidebar();
  }

  async function newDoc(folderId, init = {}) {
    try {
      await flush();
      const { document: d } = await api.createDoc({ title: 'Untitled', content: '', folder_id: folderId, ...init });
      docs.unshift(d);
      if (folderId) {
        const c = { ...getPrefs().collapsed };
        delete c[folderId];
        setPref('collapsed', c);
      }
      trashOpen = false;
      setDoc(d, { skipDraft: true });
      setMobileSidebar(false);
      if (!init.content) {
        titleInput.focus();
        titleInput.select();
      }
      return d;
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  function maybeAutoTitle(text) {
    // While a document is still "Untitled", use its first H1 as the title.
    if (doc.title !== 'Untitled' && doc.title !== autoTitle) return;
    const m = /^#\s+(.+?)\s*#*\s*$/m.exec(text.split('\n', 20).join('\n'));
    const next = m ? m[1].replace(/[*_`~]/g, '').slice(0, 200) : null;
    if (next && next !== doc.title) {
      doc.title = next;
      autoTitle = next;
      titleInput.value = next;
    }
  }

  async function renameDoc(d) {
    const title = await promptDialog('Rename document', { value: d.title, ok: 'Rename' });
    if (!title) return;
    if (doc?.id === d.id) {
      doc.title = titleInput.value = title;
      markDirty();
      await flush();
      return;
    }
    try {
      const { document: saved } = await api.saveDoc(d.id, { title });
      Object.assign(d, { title: saved.title, version: saved.version });
      renderSidebar();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  async function moveDoc(id, folderId) {
    try {
      if (doc?.id === id) await flush();
      const { document: saved } = await api.saveDoc(id, { folder_id: folderId });
      const meta = docs.find((d) => d.id === id);
      if (meta) Object.assign(meta, { folder_id: saved.folder_id, version: saved.version });
      if (doc?.id === id) {
        doc.folder_id = saved.folder_id;
        doc.version = saved.version;
      }
      renderSidebar();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  function folderPath(f) {
    const byId = new Map(folders.map((x) => [x.id, x]));
    const parts = [];
    for (let cur = f; cur; cur = byId.get(cur.parent_id)) parts.unshift(cur.name);
    return parts.join(' / ');
  }

  function isInside(folderId, ancestorId) {
    const byId = new Map(folders.map((x) => [x.id, x]));
    for (let cur = byId.get(folderId); cur; cur = byId.get(cur.parent_id)) if (cur.id === ancestorId) return true;
    return false;
  }

  function pickFolder(title, current, exclude = () => false) {
    const options = [{ id: null, label: 'Top level' }, ...folders.filter((f) => !exclude(f)).map((f) => ({ id: f.id, label: folderPath(f) }))]
      .sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.label.localeCompare(b.label)));
    return modal({
      title,
      render: (close) => {
        const select = h('select', { 'aria-label': 'Folder', autofocus: true },
          options.map((o) => h('option', { value: String(o.id), selected: o.id === current }, o.label)));
        return h('form', {
          class: 'stack',
          onSubmit: (e) => {
            e.preventDefault();
            close({ id: select.value === 'null' ? null : Number(select.value) });
          },
        }, select, h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn', onClick: () => close(undefined) }, 'Cancel'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, 'Move')));
      },
    });
  }

  async function moveDocPrompt(d) {
    const res = await pickFolder(`Move “${d.title}”`, d.folder_id ?? null);
    if (res) moveDoc(d.id, res.id);
  }

  async function duplicateDoc(d) {
    try {
      if (doc?.id === d.id) await flush();
      const { document: full } = await api.getDoc(d.id);
      await newDoc(full.folder_id, { title: `${full.title} (copy)`, content: full.content });
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  async function trashDoc(d) {
    try {
      if (doc?.id === d.id) await flush();
      await api.trashDoc(d.id);
      docs = docs.filter((x) => x.id !== d.id);
      clearDraft(d.id);
      if (doc?.id === d.id) closeDoc();
      renderSidebar();
      sidebar.refreshSearch();
      toast(`Moved “${d.title}” to the trash.`);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  // ---- Folders ----
  async function newFolder(parentId) {
    const name = await promptDialog(parentId ? 'New subfolder' : 'New folder', { placeholder: 'Folder name', ok: 'Create' });
    if (!name) return;
    try {
      const { folder } = await api.createFolder(name, parentId);
      folders.push(folder);
      if (parentId) {
        const c = { ...getPrefs().collapsed };
        delete c[parentId];
        setPref('collapsed', c);
      }
      renderSidebar();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  async function renameFolder(f) {
    const name = await promptDialog('Rename folder', { value: f.name, ok: 'Rename' });
    if (!name) return;
    try {
      const { folder } = await api.updateFolder(f.id, { name });
      Object.assign(f, folder);
      renderSidebar();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  async function moveFolderPrompt(f) {
    const res = await pickFolder(`Move “${f.name}”`, f.parent_id ?? null, (x) => x.id === f.id || isInside(x.id, f.id));
    if (!res) return;
    try {
      const { folder } = await api.updateFolder(f.id, { parent_id: res.id });
      Object.assign(f, folder);
      renderSidebar();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  async function deleteFolder(f) {
    const ok = await confirmDialog('Delete folder?',
      `“${f.name}” and its subfolders will be deleted. Documents inside are kept and moved to the top level.`,
      { ok: 'Delete folder', danger: true });
    if (!ok) return;
    try {
      await api.deleteFolder(f.id);
      await refreshLists();
      if (doc && !folders.some((x) => x.id === doc.folder_id)) doc.folder_id = null;
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  // ---- Trash ----
  async function showTrash() {
    await flush();
    trashOpen = true;
    doc = null;
    dirty = false;
    document.title = 'Trash · MD-BOY';
    history.replaceState(null, '', '#/trash');
    showDocUI(false);
    sidePanel.hidden = true;
    renderSidebar();
    setMobileSidebar(false);
    trashView.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    try {
      const { documents } = await api.listTrash();
      renderTrash(documents);
    } catch (err) {
      trashView.replaceChildren(h('p', {}, err.message));
    }
  }

  function closeTrash() {
    trashOpen = false;
    const last = getPrefs().lastDoc;
    if (last && docs.some((d) => d.id === last)) openDoc(last);
    else closeDoc();
  }

  function renderTrash(items) {
    const list = items.map((d) => h('div', { class: 'trash-item' },
      h('span', { class: 'tree-icon', html: icons.file }),
      h('div', { class: 'grow' }, h('strong', {}, d.title), h('small', {}, `Deleted ${timeAgo(d.deleted_at)}`)),
      h('button', {
        class: 'btn',
        onClick: async () => {
          try {
            const { document: restored } = await api.restoreDoc(d.id);
            docs.unshift(restored);
            renderTrash(items.filter((x) => x.id !== d.id));
            renderSidebar();
            toast(`Restored “${d.title}”.`);
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        },
        html: `${icons.restore}<span>Restore</span>`,
      }),
      h('button', {
        class: 'btn',
        title: 'Delete forever',
        onClick: async () => {
          if (!(await confirmDialog('Delete forever?', `“${d.title}” and its history will be permanently deleted.`, { ok: 'Delete forever', danger: true }))) return;
          try {
            await api.deleteDoc(d.id);
            renderTrash(items.filter((x) => x.id !== d.id));
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        },
        html: icons.trash,
      })));
    trashView.replaceChildren(
      h('div', { style: 'display:flex;align-items:center;gap:12px' },
        h('div', { style: 'flex:1' }, h('h2', {}, 'Trash'), h('p', { class: 'muted', style: 'margin:0' }, 'Deleted documents stay here until you remove them.')),
        items.length > 0 && h('button', {
          class: 'btn btn-danger',
          onClick: async () => {
            if (!(await confirmDialog('Empty trash?', `${items.length} document(s) will be permanently deleted.`, { ok: 'Empty trash', danger: true }))) return;
            try {
              await api.emptyTrash();
              renderTrash([]);
            } catch (err) {
              toast(err.message, { type: 'error' });
            }
          },
        }, 'Empty trash')),
      items.length ? list : h('p', { class: 'muted', style: 'margin-top:24px' }, 'The trash is empty.'),
    );
  }

  // ---- Import / export ----
  async function importDocs(files) {
    if (!files.length) return toast('No Markdown files found.', { type: 'error' });
    let last = null;
    for (const f of files) {
      try {
        const { document: d } = await api.createDoc({ title: f.title, content: f.content, folder_id: doc?.folder_id ?? null });
        docs.unshift(d);
        last = d;
      } catch (err) {
        toast(`${f.title}: ${err.message}`, { type: 'error' });
      }
    }
    if (last) {
      toast(files.length === 1 ? `Imported “${last.title}”.` : `Imported ${files.length} documents.`);
      await openDoc(last.id);
    }
    renderSidebar();
  }

  async function importFiles() {
    importDocs(await pickMarkdownFiles());
  }

  let dragDepth = 0;
  const dropOverlay = h('div', { class: 'drop-overlay', hidden: true }, 'Drop Markdown files to import');
  document.body.append(dropOverlay);
  cleanups.push(() => dropOverlay.remove());
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  listen(window, 'dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    dropOverlay.hidden = false;
  });
  listen(window, 'dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.hidden = true;
  });
  listen(window, 'dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  listen(window, 'drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    importDocs(await readMarkdownFiles([...e.dataTransfer.files]));
  });

  function moreMenuItems() {
    const p = getPrefs();
    const items = [];
    if (doc) {
      items.push(
        { label: 'Save version now', icon: 'history', onClick: () => save({ snapshot: true, announce: true }) },
        'separator',
        { label: 'Download Markdown (.md)', icon: 'download', onClick: () => exportMarkdown(doc.title, doc.content) },
        { label: 'Download HTML (.html)', icon: 'download', onClick: () => {
          preview.update(doc.content);
          exportHtml(doc.title, preview.html());
        } },
        { label: 'Print / Save as PDF', icon: 'printer', onClick: () => printDocument() },
      );
    }
    items.push(
      { label: 'Import Markdown files…', icon: 'upload', onClick: importFiles },
      'separator',
      { label: 'Line numbers', checked: p.lineNumbers, onClick: () => editor.setLineNumbers(setPref('lineNumbers', !p.lineNumbers).lineNumbers) },
      { label: 'Sync scrolling', checked: p.syncScroll, onClick: () => setPref('syncScroll', !p.syncScroll) },
      { label: 'Keyboard shortcuts', icon: 'settings', onClick: showShortcuts },
    );
    if (doc) {
      const current = doc;
      items.push('separator', { label: 'Move to trash', icon: 'trash', danger: true, onClick: () => trashDoc(docs.find((d) => d.id === current.id) ?? current) });
    }
    return items;
  }

  function showShortcuts() {
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
    const rows = [
      ['Save a version', `${mod}+S`], ['Bold', `${mod}+B`], ['Italic', `${mod}+I`], ['Strikethrough', `${mod}+Shift+X`],
      ['Inline code', `${mod}+E`], ['Code block', `${mod}+Shift+K`], ['Link', `${mod}+K`],
      ['Heading 1–3', `${mod}+Alt+1…3`], ['Numbered / bulleted / task list', `${mod}+Shift+7 / 8 / 9`],
      ['Find / replace', `${mod}+F`], ['Undo / redo', `${mod}+Z / ${mod}+Shift+Z`], ['Indent / outdent', 'Tab / Shift+Tab'],
      ['Cycle view (editor, split, preview)', `${mod}+/`], ['Toggle sidebar', `${mod}+\\`], ['Search documents', `${mod}+Shift+F`],
    ];
    modal({
      title: 'Keyboard shortcuts',
      render: () => h('table', { class: 'kbd-table' }, rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, h('kbd', {}, b))))),
    });
  }

  // ---- Views, panels, sidebar ----
  function setView(view) {
    setPref('view', view);
    workspace.dataset.view = view;
    const shown = mobileQuery.matches && view === 'split' ? 'edit' : view; // split is desktop-only
    for (const [k, b] of Object.entries(viewButtons)) b.classList.toggle('active', k === shown);
    if (view !== 'edit') preview.update(doc?.content ?? '');
    if (view === 'split') requestAnimationFrame(() => syncFrom('editor'));
  }

  function cycleView() {
    const order = mobileQuery.matches ? ['edit', 'preview'] : ['edit', 'split', 'preview'];
    const i = order.indexOf(getPrefs().view);
    setView(order[(i + 1) % order.length]);
  }

  function setSidebar(open) {
    setPref('sidebar', open);
    appEl.classList.toggle('no-sidebar', !open);
    updateMenuBtn();
  }

  function setMobileSidebar(open) {
    appEl.classList.toggle('mobile-sidebar-open', open && mobileQuery.matches);
  }

  function updateMenuBtn() {
    menuBtn.hidden = !mobileQuery.matches && getPrefs().sidebar;
  }
  listen(mobileQuery, 'change', () => {
    updateMenuBtn();
    setView(getPrefs().view);
    setMobileSidebar(false);
  });

  function togglePanel(name) {
    const next = getPrefs().panel === name ? null : name;
    setPref('panel', next);
    renderPanel();
  }

  function renderPanel() {
    const panel = getPrefs().panel;
    outlineBtn.classList.toggle('active', panel === 'outline');
    historyBtn.classList.toggle('active', panel === 'history');
    sidePanel.hidden = !panel || !doc;
    if (!panel || !doc) return;
    if (panel === 'outline') renderOutline();
    else renderHistory();
  }

  function renderOutline() {
    panelTitle.textContent = 'Outline';
    const headings = extractHeadings(doc.content);
    panelBody.replaceChildren(
      ...(headings.length
        ? headings.map((hd) => h('button', {
            type: 'button', class: 'outline-item', 'data-level': hd.level, style: `--level:${hd.level}`,
            onClick: () => {
              editor.scrollToLine(hd.line, { select: true });
              preview.scrollToId(hd.id);
            },
          }, hd.text))
        : [h('p', { class: 'muted', style: 'padding:8px' }, 'Add headings (# Title) to see an outline.')]),
    );
  }

  async function renderHistory() {
    panelTitle.textContent = 'Version history';
    const current = doc;
    const saveBtn = h('button', { class: 'btn btn-block', style: 'margin-bottom:8px', onClick: () => save({ snapshot: true, announce: true }), html: `${icons.history}<span>Save version now</span>` });
    if (!revisionsCache) {
      panelBody.replaceChildren(saveBtn, h('p', { class: 'muted', style: 'padding:8px' }, 'Loading…'));
      try {
        revisionsCache = (await api.listRevisions(current.id)).revisions;
      } catch (err) {
        panelBody.replaceChildren(saveBtn, h('p', { style: 'padding:8px' }, err.message));
        return;
      }
      if (doc !== current || getPrefs().panel !== 'history') return;
    }
    panelBody.replaceChildren(
      saveBtn,
      h('p', { class: 'muted', style: 'padding:0 8px 8px;margin:0;font-size:12px' }, 'Versions are saved automatically every few minutes while you write, and whenever you press Ctrl+S.'),
      ...(revisionsCache.length
        ? revisionsCache.map((r) => h('button', { type: 'button', class: 'revision', onClick: () => showRevision(r) },
            h('span', {}, new Date(r.created_at).toLocaleString()),
            h('small', {}, `${timeAgo(r.created_at)} · ${r.title} · ${r.size.toLocaleString()} chars`)))
        : [h('p', { class: 'muted', style: 'padding:8px' }, 'No versions yet.')]),
    );
  }

  async function showRevision(r) {
    const target = doc;
    let revision;
    try {
      ({ revision } = await api.getRevision(target.id, r.id));
    } catch (err) {
      return toast(err.message, { type: 'error' });
    }
    const restore = await modal({
      title: `Version from ${new Date(revision.created_at).toLocaleString()}`,
      wide: true,
      render: (close) => h('div', { class: 'stack' },
        h('div', { class: 'revision-preview markdown-body', html: renderMarkdown(revision.content) }),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onClick: () => close(false) }, 'Close'),
          h('button', { class: 'btn btn-primary', onClick: () => close(true), html: `${icons.restore}<span>Restore this version</span>` }))),
    });
    if (!restore || doc !== target) return;
    try {
      await flush();
      const { document: restored } = await api.restoreRevision(target.id, r.id);
      clearDraft(target.id);
      setDoc(restored, { skipDraft: true });
      toast('Version restored. The previous text is kept in the history.');
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  function setTheme(theme) {
    setPref('theme', theme);
    applyTheme();
    onThemeChange();
  }

  function onThemeChange() {
    themeBtn.innerHTML = icons[{ auto: 'auto', light: 'sun', dark: 'moon' }[getPrefs().theme]];
    preview.rerender();
  }

  // ---- Preview, stats and scroll sync ----
  const schedulePreview = debounce(() => {
    if (!doc) return;
    preview.update(doc.content);
    updateMeta();
    if (getPrefs().panel === 'outline') renderOutline();
  }, 150);

  function updateMeta() {
    if (!doc) return;
    const s = documentStats(doc.content);
    statWords.textContent = `${s.words.toLocaleString()} words · ${s.chars.toLocaleString()} characters · ${s.minutes} min read`;
    statUpdated.textContent = doc.updated_at ? `Saved ${timeAgo(doc.updated_at)}` : '';
    document.title = `${doc.title || 'Untitled'} · MD-BOY`;
  }

  let scrollSource = null;
  let scrollTimer = null;
  let scrollFrame = null;
  function syncFrom(source) {
    if (!getPrefs().syncScroll || getPrefs().view !== 'split' || mobileQuery.matches) return;
    if (scrollSource && scrollSource !== source) return;
    scrollSource = source;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => (scrollSource = null), 150);
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (source === 'editor') preview.scrollToLine(editor.topLine());
      else editor.scrollToLine(preview.topLine());
    });
  }

  // ---- Global events ----
  listen(document, 'keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (doc) save({ snapshot: true, announce: true });
    } else if (e.key === '/') {
      e.preventDefault();
      if (doc) cycleView();
    } else if (e.key === '\\') {
      e.preventDefault();
      if (mobileQuery.matches) setMobileSidebar(!appEl.classList.contains('mobile-sidebar-open'));
      else setSidebar(!getPrefs().sidebar);
    } else if (e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      if (!getPrefs().sidebar && !mobileQuery.matches) setSidebar(true);
      setMobileSidebar(true);
      sidebar.focusSearch();
    }
  });

  listen(window, 'beforeunload', (e) => {
    if (dirty && doc) {
      // The draft is already in localStorage; also try a last save.
      api.saveDoc(doc.id, { title: doc.title, content: doc.content, version: doc.version }, { keepalive: true }).catch(() => {});
      e.preventDefault();
      e.returnValue = '';
    }
  });
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  listen(window, 'online', () => {
    if (dirty) save();
  });
  listen(window, 'hashchange', () => route());

  // Always print in the light theme.
  listen(window, 'beforeprint', () => {
    if (doc) preview.update(doc.content);
    document.documentElement.dataset.theme = 'light';
  });
  listen(window, 'afterprint', () => applyTheme());

  function route() {
    const m = /^#\/doc\/([\w-]+)/.exec(location.hash);
    if (m) return openDoc(m[1]);
    if (location.hash === '#/trash') return showTrash();
    return null;
  }

  async function logout() {
    await flush().catch(() => {});
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    user = null;
    destroy();
    shell = null;
    history.replaceState(null, '', '#/');
    showAuth('login');
  }

  function destroy() {
    scheduleSave.cancel();
    schedulePreview.cancel();
    clearTimeout(offlineTimer);
    for (const fn of cleanups) fn();
    editor.view.destroy();
  }

  // ---- Start ----
  if (mobileQuery.matches) setPref('panel', null); // panels cover the editor on phones
  setView(prefs.view);
  setSidebar(prefs.sidebar);
  onThemeChange();
  showDocUI(false);
  renderSidebar();

  (async () => {
    try {
      await refreshLists();
    } catch (err) {
      toast(err.message, { type: 'error' });
      return;
    }
    if (route()) return;
    const last = getPrefs().lastDoc;
    const pick = docs.find((d) => d.id === last) ?? docs[0];
    if (pick) openDoc(pick.id);
  })();

  return { destroy, onThemeChange };
}

boot();
