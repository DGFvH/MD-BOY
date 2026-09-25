import 'katex/dist/katex.min.css';
import './markdown.css';
import './styles.css';

import { api, setUnauthorizedHandler } from './api.js';
import { createEditor, commands } from './editor.js';
import { createPreview, extractHeadings, documentStats, renderMarkdown } from './preview.js';
import { stripFrontMatter } from './render/front-matter.js';
import { renderDiagrams } from './render/mermaid.js';
import { createSidebar } from './sidebar.js';
import { saveDraft, loadDraft, clearDraft, clearAllDrafts, draftIds, getPrefs, setPref } from './storage.js';
import { exportMarkdown, exportHtml, pickMarkdownFiles, readMarkdownFiles } from './export.js';
import {
  h, icons, iconButton, toast, modal, promptDialog, confirmDialog, choiceDialog, showMenu, debounce, timeAgo,
} from './ui.js';
import { WELCOME_TITLE, WELCOME_CONTENT } from './welcome.js';
import { pageTitle } from './brand.js';
import { showAuth } from './app/auth.js';
import { showAccount } from './app/account.js';

const root = document.getElementById('app');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const mobileQuery = window.matchMedia('(max-width: 700px)');
const touchQuery = window.matchMedia('(pointer: coarse)'); // no keyboard shortcuts to mention
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const RETRY_DELAYS = [5000, 10000, 30000, 60000]; // after network or server errors
const DRAFT_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // drafts of documents that no longer exist
const KEEPALIVE_LIMIT = 60000; // browsers cap keepalive request bodies at 64 KB

let user = null;
let shell = null; // the mounted app, see mountApp()

// The title the server stores for a given title input.
const cleanTitle = (title) => String(title ?? '').trim().slice(0, 200) || 'Untitled';

// ---- Theme ------------------------------------------------------------------

// The colour themes. Each is a set of tokens in markdown.css (data-theme="…").
export const THEMES = [
  { id: 'auto', label: 'System', icon: 'auto' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'sepia', label: 'Sepia', icon: 'paper' },
  { id: 'contrast', label: 'High contrast', icon: 'contrast' },
];

function currentTheme() {
  const theme = getPrefs().theme;
  return THEMES.some((t) => t.id === theme) ? theme : 'auto';
}

function isDark() {
  const theme = currentTheme();
  return theme === 'dark' || theme === 'contrast' || (theme === 'auto' && darkQuery.matches);
}

function applyTheme() {
  const theme = currentTheme();
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

// ---- Boot and auth ----------------------------------------------------------

setUnauthorizedHandler(() => {
  if (!user) return;
  toAuthScreen('Your session has expired. Please sign in again.');
});

// A file loaded on demand (e.g. the diagram renderer) is gone: a new version was deployed.
let updateToastAt = 0;
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault(); // the caller treats it as a failed load and tries again next time
  if (!navigator.onLine || Date.now() - updateToastAt < 60000) return;
  updateToastAt = Date.now();
  toast('A new version is available.', { timeout: 60000, action: { label: 'Reload', onClick: () => location.reload() } });
});

async function boot() {
  try {
    ({ user } = await api.me());
    mountApp();
  } catch (err) {
    if (err.status === 401) openAuth();
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

function openAuth(opts = {}) {
  showAuth(root, {
    ...opts,
    onSignedIn: async (signedIn, { isNew }) => {
      user = signedIn;
      if (isNew) await api.createDoc({ title: WELCOME_TITLE, content: WELCOME_CONTENT }).catch(() => {});
      mountApp();
    },
  });
}

/** Tears the app down and shows the sign-in screen (after sign-out, expiry or account deletion). */
function toAuthScreen(notice = '') {
  user = null;
  shell?.destroy();
  shell = null;
  for (const dialog of document.querySelectorAll('dialog')) dialog.remove(); // they belong to the old app
  history.replaceState(null, '', '#/');
  openAuth({ mode: 'login', notice });
}

function mountApp() {
  shell?.destroy();
  setPref('hasAccount', true); // next time the sign-in form comes first
  shell = createApp();
}

// ---- The editor app ---------------------------------------------------------

function createApp() {
  const prefs = getPrefs();
  let docs = [];
  let folders = [];
  let doc = null; // the open document: { id, title, content, version, folder_id, ..., baseTitle }
  let dirty = false; // the open document has changes the server does not have yet
  let issue = null; // { kind: 'conflict' | 'trashed' | 'deleted', current }: saving waits for the user
  let issueDialogOpen = false;
  let currentSave = null;
  let queued = null;
  let retryTimer = null;
  let retryCount = 0;
  let lastError = ''; // last save error shown, so a failing save doesn't toast on every attempt
  let offlineNotified = false;
  let maybeSaved = null; // { id, content } sent without seeing the reply (keepalive, dropped connection)
  let draftTimer = null;
  let draftOk = true; // false when this browser could not store the draft
  let trashOpen = false;
  let autoTitle = null;
  let revisionsCache = null;
  let navSeq = 0; // bumped by every navigation, so a slower, older one cannot win
  let printing = false;
  let lastRefresh = 0;
  let destroyed = false;
  const cleanups = [];

  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  // ---- Layout ----
  // tabindex: the phone drawer can take focus without popping up the keyboard.
  const sidebarEl = h('aside', { class: 'sidebar', 'aria-label': 'Sidebar', tabindex: '-1' });
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
      // Show what will be stored ("Hello " is saved as "Hello", "" as "Untitled").
      if (!doc || titleInput.value === cleanTitle(titleInput.value)) return;
      titleInput.value = doc.title = cleanTitle(titleInput.value);
      markDirty();
    },
  });
  // Not a live region: it changes on every typing pause. Problems are also announced by toasts.
  const saveStatus = h('span', { class: 'save-status', 'data-state': 'saved' }, 'Saved');
  const resolveBtn = h('button', {
    type: 'button', class: 'btn', hidden: true, style: 'height:28px;padding:0 10px;font-size:12.5px',
    onClick: () => resolveIssue(),
  }, 'Resolve…');

  const viewButtons = {
    edit: iconButton('edit', `Editor only (${MOD}+/ cycles)`, () => setView('edit')),
    split: iconButton('split', 'Side by side', () => setView('split'), { class: 'icon-btn desktop-only' }),
    preview: iconButton('eye', 'Preview only', () => setView('preview')),
  };
  const outlineBtn = iconButton('list', 'Outline', () => togglePanel('outline'), { class: 'icon-btn desktop-only' });
  const historyBtn = iconButton('history', 'Version history', () => togglePanel('history'));
  const themeItems = (suffix = '') => {
    const cur = currentTheme();
    return THEMES.map((t) => ({ label: `${t.label}${suffix}`, icon: t.icon, checked: cur === t.id, onClick: () => setTheme(t.id) }));
  };
  // On phones the theme choices are in the ⋯ menu instead, to leave room for the title.
  const themeBtn = iconButton('auto', 'Theme', (e) => showMenu(e.currentTarget, themeItems()), { class: 'icon-btn desktop-only' });
  const moreBtn = iconButton('more', 'More actions', (e) => showMenu(e.currentTarget, moreMenuItems()));
  const menuBtn = iconButton('menu', 'Show sidebar', () => {
    if (mobileQuery.matches) setMobileSidebar(true);
    else setSidebar(true);
  }, { class: 'icon-btn sidebar-toggle' });

  const topbar = h('header', { class: 'topbar' },
    menuBtn, titleInput, saveStatus, resolveBtn,
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' }, viewButtons.edit, viewButtons.split, viewButtons.preview),
    h('span', { class: 'divider desktop-only' }), outlineBtn, historyBtn, themeBtn, moreBtn);

  const tb = (icon, label, cmd) => iconButton(icon, label, () => editor.run(cmd));
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tb('heading', 'Heading (cycle H1–H3)', commands.cycleHeading),
    tb('bold', `Bold (${MOD}+B)`, commands.bold),
    tb('italic', `Italic (${MOD}+I)`, commands.italic),
    tb('strike', `Strikethrough (${MOD}+Shift+X)`, commands.strike),
    h('span', { class: 'sep' }),
    tb('ul', `Bulleted list (${MOD}+Shift+8)`, commands.ul),
    tb('ol', `Numbered list (${MOD}+Shift+7)`, commands.ol),
    tb('task', `Task list (${MOD}+Shift+9)`, commands.task),
    tb('quote', 'Quote', commands.quote),
    h('span', { class: 'sep' }),
    tb('link', `Link (${MOD}+K)`, commands.link),
    tb('image', 'Image link', commands.image),
    tb('upload', 'Upload image (or paste / drop one)', commands.uploadImage),
    tb('code', `Inline code (${MOD}+E)`, commands.code),
    tb('codeBlock', `Code block (${MOD}+Shift+K)`, commands.codeBlock),
    tb('table', 'Table', commands.table),
    tb('math', 'Math', commands.math),
    tb('hr', 'Horizontal rule', commands.hr));

  // The toolbar is one Tab stop; the arrow keys, Home and End move between its buttons.
  const toolButtons = [...toolbar.querySelectorAll('.icon-btn')];
  toolButtons.forEach((b, i) => (b.tabIndex = i ? -1 : 0));
  toolbar.addEventListener('keydown', (e) => {
    const i = toolButtons.indexOf(document.activeElement);
    const n = toolButtons.length;
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (i < 0 || next === undefined) return;
    e.preventDefault();
    toolButtons[i].tabIndex = -1;
    toolButtons[next].tabIndex = 0;
    toolButtons[next].focus();
  });

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
  // A button, not a #link: a link would change the route.
  const skipLink = h('button', {
    type: 'button', class: 'skip-link',
    onClick: () => {
      setMobileSidebar(false);
      if (shownView() === 'preview') previewPane.focus();
      else editor.focus();
    },
  }, 'Skip to editor');
  const appEl = h('div', { class: 'app' }, skipLink, sidebarEl, backdrop, main);
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
    onSave: () => saveVersion(),
    onCycleView: () => cycleView(),
    uploadImage: async (file) => (await api.uploadImage(file)).url,
    onUploadError: (err) => toast(`Image not uploaded: ${err.message}`, { type: 'error' }),
    onScroll: () => {
      syncFrom('editor');
      scheduleOutlineActive();
    },
    onCursor: ({ line, col, selected }) => {
      statCursor.textContent = `Ln ${line}, Col ${col}${selected ? ` (${selected} selected)` : ''}`;
    },
  });
  editor.setLineNumbers(prefs.lineNumbers);

  const preview = createPreview({ scroller: previewPane, content: previewContent }, {
    isDark,
    onScroll: () => syncFrom('preview'),
    onToggleTask: (line, shownText) => {
      const text = editor.view.state.doc;
      if (line <= text.lines && text.line(line).text === shownText) editor.toggleTaskAtLine(line);
      else if (doc) preview.update(doc.content); // the preview was behind the editor: bring it up to date instead
    },
  });

  const sidebar = createSidebar(sidebarEl, {
    onOpenDoc: (id) => openDoc(id, { push: true }),
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
    onShowTrash: () => (trashOpen ? closeTrash() : showTrash({ push: true })),
    onImport: () => importFiles(),
    onToggleSidebar: () => (mobileQuery.matches ? setMobileSidebar(false) : setSidebar(false)),
    onLogout: () => logout(),
    onAccount: () => openAccount(),
  });

  // ---- Save status ----
  function setStatus(state, text, detail = '') {
    const labels = {
      saved: 'Saved', dirty: 'Unsaved', saving: 'Saving…', conflict: 'Conflict', error: 'Save failed',
      offline: draftOk ? 'Offline – saved locally' : 'Offline – not saved',
    };
    saveStatus.dataset.state = state;
    saveStatus.textContent = text ?? labels[state];
    saveStatus.title = detail || (state === 'offline' && !draftOk
      ? 'This browser could not keep a copy either. Keep this tab open until you are back online.' : '');
    resolveBtn.hidden = !issue || !doc;
  }

  // ---- Local drafts ----
  // The open document's unsaved text is also kept in this browser (written shortly after typing).
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, 300);
  }

  function writeDraft() {
    clearTimeout(draftTimer);
    if (!doc || !dirty) return;
    const ok = saveDraft(doc.id, { title: doc.title, content: doc.content, baseVersion: doc.version });
    if (ok !== draftOk) {
      draftOk = ok;
      if (saveStatus.dataset.state === 'offline') setStatus('offline');
    }
  }

  // Drafts of documents that are gone (deleted elsewhere, long ago) would only fill up storage.
  function pruneDrafts() {
    const known = new Set(docs.map((d) => d.id));
    for (const id of draftIds()) {
      if (known.has(id)) continue;
      const draft = loadDraft(id);
      if (!(draft?.savedAt > Date.now() - DRAFT_MAX_AGE)) clearDraft(id);
    }
  }

  // ---- Saving ----
  const scheduleSave = debounce(() => save(), 1000);

  function markDirty() {
    if (!doc) return;
    dirty = true;
    scheduleDraft();
    if (issue) return; // saving waits until the user resolves it
    if (saveStatus.dataset.state !== 'offline') setStatus('dirty');
    scheduleSave();
  }

  function save(opts = {}) {
    if (destroyed) return Promise.resolve();
    if (currentSave) {
      queued = { snapshot: queued?.snapshot || !!opts.snapshot, announce: queued?.announce || !!opts.announce };
      return currentSave;
    }
    currentSave = doSave(opts).finally(() => {
      currentSave = null;
      const next = queued;
      queued = null;
      if (next && !destroyed) save(next);
    });
    return currentSave;
  }

  /** Ctrl+S, "Save version now": save and keep this state in the history. */
  function saveVersion() {
    if (!doc) return;
    if (issue) resolveIssue();
    else save({ snapshot: true, announce: true });
  }

  async function doSave({ snapshot = false, announce = false } = {}) {
    if (destroyed || !doc || issue) return;
    if (!dirty && !snapshot) return;
    scheduleSave.cancel();
    clearTimeout(retryTimer);
    const target = doc;
    const title = cleanTitle(target.title);
    // Send the title only when it was changed here, so a stale tab can't undo a rename made elsewhere.
    const titleEdited = title !== target.baseTitle;
    const body = { content: target.content, version: target.version, snapshot };
    if (titleEdited) body.title = title;
    setStatus('saving');
    let saved;
    try {
      ({ document: saved } = await api.saveDoc(target.id, body));
    } catch (err) {
      if (destroyed || err.status === 401) return; // signed out: the draft is restored after signing in
      if (err.status === 0) maybeSaved = { id: target.id, content: body.content };
      if (doc === target) onSaveError(err, { snapshot, announce });
      return;
    }
    if (destroyed) return;
    if (maybeSaved?.id === target.id) maybeSaved = null;
    Object.assign(target, { version: saved.version, updated_at: saved.updated_at, folder_id: saved.folder_id, baseTitle: saved.title });
    // Renamed elsewhere and not here: take the new name.
    if (!titleEdited && saved.title !== title && cleanTitle(target.title) === title) {
      target.title = saved.title;
      if (doc === target) titleInput.value = saved.title;
    }
    if (target.content === body.content && cleanTitle(target.title) === saved.title) {
      if (doc === target) dirty = false;
      clearDraft(target.id);
    } else {
      saveDraft(target.id, { title: target.title, content: target.content, baseVersion: target.version });
    }
    const meta = docs.find((d) => d.id === target.id);
    if (meta) {
      const moved = meta.title !== saved.title || meta.folder_id !== saved.folder_id;
      Object.assign(meta, { title: saved.title, folder_id: saved.folder_id, updated_at: saved.updated_at, version: saved.version });
      if (moved) renderSidebar();
    }
    retryCount = 0;
    lastError = '';
    offlineNotified = false;
    if (doc === target) {
      setStatus(dirty ? 'dirty' : 'saved');
      updateMeta();
      if (dirty) scheduleSave();
    }
    notifyOtherTabs();
    if (snapshot) revisionsCache = null;
    if (announce) toast('Saved to the version history.');
    if (getPrefs().panel === 'history' && snapshot && doc === target) renderPanel();
  }

  function onSaveError(err, opts = {}) {
    const { status } = err;
    if (status === 409) return raiseIssue('conflict', err.body?.current, opts);
    if (status === 410) return raiseIssue('trashed', err.body?.current);
    if (status === 404) return raiseIssue('deleted', null);
    if (status === 0 || status >= 500) {
      // Probably temporary: try again with growing pauses (and on every edit).
      setStatus(status === 0 ? 'offline' : 'error', undefined, status === 0 ? '' : err.message);
      retryTimer = setTimeout(() => save(), RETRY_DELAYS[Math.min(retryCount++, RETRY_DELAYS.length - 1)]);
      if (status === 0 && !offlineNotified) {
        offlineNotified = true;
        toast(draftOk
          ? 'You’re offline. Your changes are kept in this browser and saved when you’re back online.'
          : 'You’re offline, and this browser could not keep a copy. Keep this tab open until you’re back online.',
        { type: draftOk ? 'info' : 'error', timeout: 6000 });
      }
      if (status !== 0) showErrorOnce(err.message);
      return;
    }
    // Other refusals (e.g. too large) won't change by retrying: wait for the next edit.
    setStatus('error', 'Not saved', err.message);
    showErrorOnce(err.message);
  }

  function showErrorOnce(message) {
    if (message === lastError) return;
    lastError = message;
    toast(message, { type: 'error', timeout: 6000 });
  }

  /** Waits for pending saves and saves unsaved changes. Never throws; check `dirty` afterwards. */
  async function flush() {
    scheduleSave.cancel();
    while (currentSave) await currentSave;
    if (dirty && !issue && !destroyed) await save();
    while (currentSave) await currentSave;
  }

  // ---- Conflicts and documents removed elsewhere ----
  function raiseIssue(kind, current, opts = {}) {
    // Nothing to resolve when the stored text is our own earlier write (a reply that never arrived),
    // or when the text here now equals it. The server never sends a 409 for the text it stores, so
    // the latter is only a cheap safeguard: text edited back to the stored version during the request.
    if (kind === 'conflict' && current && (current.content === doc.content
      || (maybeSaved?.id === doc.id && maybeSaved.content === current.content))) {
      doc.version = current.version;
      maybeSaved = null;
      save(opts); // runs after the current save
      return;
    }
    issue = { kind, current };
    const labels = { conflict: 'Conflict', trashed: 'In the trash', deleted: 'Deleted elsewhere' };
    setStatus(kind === 'conflict' ? 'conflict' : 'error', labels[kind]);
    resolveIssue(); // not awaited: saving and navigation don't wait for the dialog
  }

  function issueDialog(kind) {
    if (kind === 'conflict') {
      return choiceDialog('This document changed elsewhere',
        h('div', { class: 'stack', style: 'gap:8px' },
          h('p', {}, 'It was edited in another tab or on another device while you were writing here.'),
          h('ul', { style: 'margin:0;padding-left:20px;line-height:1.5' },
            h('li', {}, h('strong', {}, 'Keep both'), ': your text becomes a new document, and the other version opens here.'),
            h('li', {}, h('strong', {}, 'Overwrite with mine'), ': the other version is kept in the version history.'),
            h('li', {}, h('strong', {}, 'Discard mine'), ': your changes here are lost.'))),
        [
          { label: 'Discard mine', value: 'theirs', danger: true },
          { label: 'Overwrite with mine', value: 'mine' },
          { label: 'Keep both', value: 'both', primary: true, autofocus: true },
        ]);
    }
    if (kind === 'trashed') {
      return choiceDialog('This document is in the trash',
        'It was moved to the trash in another tab or on another device. Your text is still here.',
        [
          { label: 'Save as new document', value: 'copy' },
          { label: 'Restore it', value: 'restore', primary: true, autofocus: true },
        ]);
    }
    return choiceDialog('This document was deleted',
      'It was deleted permanently in another tab or on another device. Your text is still here.',
      [
        { label: 'Discard my text', value: 'discard', danger: true },
        { label: 'Save as new document', value: 'copy', primary: true, autofocus: true },
      ]);
  }

  async function resolveIssue() {
    if (!issue || issueDialogOpen) return;
    const target = doc;
    const { kind, current } = issue;
    issueDialogOpen = true;
    const choice = await issueDialog(kind).finally(() => (issueDialogOpen = false));
    if (destroyed || doc !== target || issue?.current !== current || !choice) return; // dismissed: "Resolve…" asks again
    try {
      if (choice === 'mine') {
        // Put the other version in the history first, then overwrite it.
        const { document: kept } = await api.saveDoc(target.id, { content: current.content, version: current.version, snapshot: true });
        if (doc !== target) return;
        target.version = kept.version;
        issue = null;
        dirty = true;
        save();
      } else if (choice === 'both' || choice === 'theirs') {
        if (choice === 'both') {
          const copy = await saveCopy(target, ' (my version)');
          toast(`Your version was saved as “${copy.title}”.`);
        }
        const { document: fresh } = await api.getDoc(target.id);
        if (doc !== target) return;
        dirty = false;
        clearDraft(target.id);
        setDoc(fresh, { skipDraft: true });
      } else if (choice === 'restore') {
        const { document: restored } = await api.restoreDoc(target.id);
        notifyOtherTabs();
        if (doc !== target) return;
        if (!docs.some((d) => d.id === restored.id)) docs.unshift(restored);
        renderSidebar();
        issue = null;
        dirty = true;
        save(); // a change made before it was trashed still shows up as a conflict
      } else if (choice === 'copy') {
        const copy = await saveCopy(target, '');
        if (doc !== target) return;
        dirty = false;
        clearDraft(target.id);
        docs = docs.filter((d) => d.id !== target.id);
        setDoc(copy, { skipDraft: true });
        toast('Saved as a new document.');
      } else if (choice === 'discard') {
        dirty = false;
        clearDraft(target.id);
        docs = docs.filter((d) => d.id !== target.id);
        closeDoc();
      }
    } catch (err) {
      if (destroyed || doc !== target) return;
      if ([404, 409, 410].includes(err.status) && choice !== 'both' && choice !== 'copy') {
        issue = null;
        onSaveError(err); // it changed again: ask again with the new state
      } else {
        toast(err.message, { type: 'error' });
      }
    }
  }

  async function saveCopy(src, suffix) {
    const folderId = folders.some((f) => f.id === src.folder_id) ? src.folder_id : null;
    const { document: copy } = await api.createDoc({ title: `${cleanTitle(src.title)}${suffix}`, content: src.content, folder_id: folderId });
    notifyOtherTabs();
    if (!destroyed) {
      docs.unshift(copy);
      renderSidebar();
    }
    return copy;
  }

  // ---- Documents ----
  async function refreshLists() {
    const [d, f] = await Promise.all([api.listDocs(), api.listFolders()]);
    if (destroyed) return;
    docs = d.documents;
    folders = f.folders;
    lastRefresh = Date.now();
    renderSidebar();
  }

  // Coming back to the tab: pick up documents and changes made elsewhere.
  async function refreshOnReturn() {
    if (destroyed || Date.now() - lastRefresh < 15000) return;
    lastRefresh = Date.now();
    try {
      await refreshLists();
      await syncOpenDoc();
    } catch {
      // Offline or signed out; the next save or action will say so.
    }
  }

  // Loads a newer server version of the open document when there is nothing unsaved here.
  async function syncOpenDoc() {
    const target = doc;
    const meta = target && docs.find((d) => d.id === target.id);
    if (!meta || dirty || issue) return;
    if (meta.version > target.version) {
      const { document: d } = await api.getDoc(target.id);
      if (destroyed || doc !== target || dirty || issue || d.deleted_at || d.version <= target.version) return;
      Object.assign(target, { title: d.title, baseTitle: d.title, content: d.content, version: d.version, updated_at: d.updated_at, folder_id: d.folder_id });
      titleInput.value = d.title;
      editor.replace(d.content);
      preview.update(d.content);
      revisionsCache = null;
      updateMeta();
      renderPanel();
      toast('Updated with changes made elsewhere.');
    } else if (meta.title !== target.baseTitle && document.activeElement !== titleInput) {
      target.title = target.baseTitle = titleInput.value = meta.title;
      updateMeta();
    }
  }

  function renderSidebar() {
    sidebar.update({ docs, folders, currentId: trashOpen ? null : doc?.id ?? null, trashOpen, user });
  }

  function navigate(hash, push = false) {
    if (location.hash === hash) return;
    if (push) history.pushState(null, '', hash);
    else history.replaceState(null, '', hash);
  }

  // Puts the address back in line with what is shown (after a cancelled or failed navigation).
  function syncHash() {
    navigate(doc ? `#/doc/${doc.id}` : trashOpen ? '#/trash' : '#/');
  }

  function showDocUI(show) {
    toolbar.hidden = workspace.hidden = statusbar.hidden = skipLink.hidden = !show;
    emptyState.hidden = show || trashOpen;
    trashView.hidden = !trashOpen;
    titleInput.disabled = !show;
    titleInput.placeholder = show ? 'Untitled' : '';
    for (const b of [outlineBtn, historyBtn, ...Object.values(viewButtons)]) {
      b.disabled = !show;
      b.classList.toggle('active', show && b.getAttribute('aria-pressed') === 'true'); // no highlight while disabled
    }
    saveStatus.hidden = !show;
    resolveBtn.hidden = !show || !issue;
    if (!show) titleInput.value = trashOpen ? 'Trash' : '';
  }

  /** Forgets the open document; its unsaved text stays in this browser's drafts. */
  function dropDoc() {
    if (doc && dirty) writeDraft();
    scheduleSave.cancel();
    clearTimeout(draftTimer);
    clearTimeout(retryTimer);
    doc = null;
    dirty = false;
    issue = null;
    retryCount = 0;
    lastError = '';
  }

  function setDoc(d, { skipDraft = false, push = false } = {}) {
    dropDoc();
    doc = { ...d, baseTitle: d.title };
    revisionsCache = null;
    trashOpen = false;
    const draft = skipDraft ? null : loadDraft(d.id);
    let restoredDraft = false;
    let askDraft = null;
    if (draft && (draft.content !== d.content || cleanTitle(draft.title) !== d.title)) {
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
    autoTitle = leadingH1(doc.content) === doc.title ? doc.title : null;
    titleInput.value = doc.title;
    editor.load(doc.content);
    preview.update(doc.content, { force: true });
    previewPane.scrollTop = 0;
    showDocUI(true);
    updateMeta();
    renderPanel();
    setStatus('saved');
    setPref('lastDoc', doc.id);
    navigate(`#/doc/${doc.id}`, push);
    renderSidebar();
    if (restoredDraft) {
      dirty = true;
      setStatus('dirty');
      toast('Restored changes that had not been saved yet.');
      save();
    }
    if (askDraft) {
      const target = doc;
      choiceDialog('Unsaved local changes found',
        `This browser has changes from ${timeAgo(new Date(askDraft.savedAt).toISOString())} that were never saved, but the document has changed since. Restore your local changes? The current version stays in the history.`,
        [
          { label: 'Discard them', value: false, danger: true },
          { label: 'Restore my changes', value: true, primary: true, autofocus: true },
        ]).then(async (restore) => {
        if (doc !== target) return;
        if (!restore) {
          if (restore === false) clearDraft(target.id);
          return;
        }
        // Keep the server's current text in the history before replacing it.
        await api.saveDoc(target.id, { content: d.content, version: d.version, snapshot: true }).catch(() => {});
        if (doc !== target) return;
        doc.title = titleInput.value = askDraft.title;
        editor.replace(askDraft.content);
        doc.content = askDraft.content;
        preview.update(doc.content);
        markDirty();
      });
    }
  }

  /**
   * Saves the open document before navigating away. Resolves false when the user
   * chooses to stay because the changes could not be saved.
   */
  async function leaveDoc() {
    await flush();
    if (destroyed) return false;
    if (issueDialogOpen) return false; // the save hit a conflict: resolve it first
    if (!doc || !dirty) return true;
    writeDraft();
    const where = draftOk
      ? 'They are kept in this browser and come back when you open the document here again.'
      : 'This browser could not keep a copy either, so they are lost if you leave.';
    const choice = await choiceDialog('Changes not saved yet',
      `Your latest changes to “${cleanTitle(doc.title)}” have not reached the server. ${where}`,
      [
        { label: 'Leave anyway', value: 'leave', danger: !draftOk },
        { label: 'Stay', value: 'stay', primary: true, autofocus: true },
      ]);
    return choice === 'leave' && !destroyed;
  }

  async function openDoc(id, { focus = false, push = false } = {}) {
    if (doc?.id === id && !trashOpen) {
      setMobileSidebar(false);
      return;
    }
    const seq = ++navSeq;
    if (!(await leaveDoc())) return seq === navSeq && syncHash();
    if (seq !== navSeq) return;
    try {
      const { document: d } = await api.getDoc(id);
      if (destroyed || seq !== navSeq) return;
      if (d.deleted_at) {
        toast('That document is in the trash.');
        return showTrash();
      }
      if (dirty) await flush(); // typed while it was loading
      if (destroyed || seq !== navSeq) return;
      if (issueDialogOpen) return syncHash();
      setDoc(d, { push });
      setMobileSidebar(false);
      if (focus) editor.focus();
    } catch (err) {
      if (destroyed || seq !== navSeq) return;
      if (err.status === 404) {
        toast('That document no longer exists.', { type: 'error' });
        docs = docs.filter((x) => x.id !== id);
        renderSidebar();
      } else {
        toast(err.message, { type: 'error' });
      }
      syncHash();
    }
  }

  function closeDoc() {
    dropDoc();
    document.title = pageTitle(trashOpen ? 'Trash' : undefined);
    navigate(trashOpen ? '#/trash' : '#/');
    showDocUI(false);
    sidePanel.hidden = true;
    renderSidebar();
  }

  async function newDoc(folderId, init = {}) {
    const seq = ++navSeq;
    if (!(await leaveDoc()) || seq !== navSeq) return null;
    try {
      const { document: d } = await api.createDoc({ title: 'Untitled', content: '', folder_id: folderId, ...init });
      notifyOtherTabs();
      if (destroyed) return null;
      docs.unshift(d);
      if (seq !== navSeq) {
        renderSidebar();
        return d;
      }
      if (folderId) {
        const c = { ...getPrefs().collapsed };
        delete c[folderId];
        setPref('collapsed', c);
      }
      setDoc(d, { skipDraft: true, push: true });
      setMobileSidebar(false);
      if (!init.content) {
        titleInput.focus();
        titleInput.select();
      }
      return d;
    } catch (err) {
      if (!destroyed) toast(err.message, { type: 'error' });
      return null;
    }
  }

  // Front matter aside, the text of the first heading when the document starts with an H1.
  function leadingH1(text) {
    const top = text.split('\n', 60);
    const first = extractHeadings(top.join('\n'))[0];
    if (!first || first.level !== 1 || first.text === '(untitled)') return null;
    if (stripFrontMatter(top.slice(0, first.line - 1).join('\n')).trim()) return null;
    return first.text.trim().slice(0, 200) || null;
  }

  function maybeAutoTitle(text) {
    // While a document is "Untitled", its title follows its first H1 (and goes back when the H1 is removed).
    if (doc.title !== 'Untitled' && doc.title !== autoTitle) return;
    const next = leadingH1(text);
    if (next) {
      autoTitle = next;
      if (doc.title !== next) doc.title = titleInput.value = next;
    } else if (autoTitle) {
      autoTitle = null;
      doc.title = titleInput.value = 'Untitled';
    }
  }

  async function renameDoc(d) {
    const title = await promptDialog('Rename document', { value: d.title, ok: 'Rename' });
    if (!title || destroyed) return;
    if (doc?.id === d.id) {
      doc.title = titleInput.value = title;
      autoTitle = null;
      markDirty();
      await flush();
      return;
    }
    try {
      const { document: saved } = await api.saveDoc(d.id, { title });
      notifyOtherTabs();
      Object.assign(d, { title: saved.title, version: saved.version });
      renderSidebar();
    } catch (err) {
      onListSaveError(d.id, err);
    }
  }

  async function moveDoc(id, folderId) {
    try {
      if (doc?.id === id) await flush();
      const { document: saved } = await api.saveDoc(id, { folder_id: folderId });
      notifyOtherTabs();
      if (destroyed) return;
      const meta = docs.find((d) => d.id === id);
      if (meta) Object.assign(meta, { folder_id: saved.folder_id, version: saved.version });
      // Only the folder: taking the server's version here would hide a conflicting edit.
      if (doc?.id === id) doc.folder_id = saved.folder_id;
      renderSidebar();
    } catch (err) {
      if (doc?.id === id && !issue && [404, 410].includes(err.status)) onSaveError(err);
      else onListSaveError(id, err);
    }
  }

  // A document trashed or deleted elsewhere leaves the sidebar when a change to it is refused.
  function onListSaveError(id, err) {
    if (destroyed) return;
    toast(err.message, { type: 'error' });
    if (err.status === 404 || err.status === 410) {
      docs = docs.filter((d) => d.id !== id);
      renderSidebar();
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
      // The open document is copied as shown, including changes not saved yet.
      const src = doc?.id === d.id ? { ...doc } : (await api.getDoc(d.id)).document;
      await newDoc(src.folder_id, { title: `${cleanTitle(src.title)} (copy)`, content: src.content });
    } catch (err) {
      if (!destroyed) toast(err.message, { type: 'error' });
    }
  }

  async function trashDoc(d) {
    try {
      if (doc?.id === d.id) {
        await flush();
        if (issueDialogOpen) return; // the save hit a conflict: resolve it first
      }
      await api.trashDoc(d.id);
      notifyOtherTabs();
      if (destroyed) return;
      const wasOpen = doc?.id === d.id;
      docs = docs.filter((x) => x.id !== d.id);
      // Text that could not be saved stays in this browser, in case the document is restored.
      if (!(wasOpen && dirty)) clearDraft(d.id);
      if (wasOpen) closeDoc();
      renderSidebar();
      sidebar.refreshSearch();
      toast(`Moved “${d.title}” to the trash.`, { timeout: 6000, action: { label: 'Undo', onClick: () => undoTrash(d.id, wasOpen) } });
    } catch (err) {
      if (!destroyed) toast(err.message, { type: 'error' });
    }
  }

  async function undoTrash(id, reopen) {
    try {
      const { document: restored } = await api.restoreDoc(id);
      notifyOtherTabs();
      if (destroyed) return;
      if (!docs.some((x) => x.id === id)) docs.unshift(restored);
      renderSidebar();
      sidebar.refreshSearch();
      if (trashOpen) loadTrash();
      else if (reopen && !doc) openDoc(id);
    } catch (err) {
      if (!destroyed) toast(err.message, { type: 'error' });
    }
  }

  // ---- Folders ----
  async function newFolder(parentId) {
    const name = await promptDialog(parentId ? 'New subfolder' : 'New folder', { placeholder: 'Folder name', ok: 'Create' });
    if (!name || destroyed) return;
    try {
      const { folder } = await api.createFolder(name, parentId);
      notifyOtherTabs();
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
    if (!name || destroyed) return;
    try {
      const { folder } = await api.updateFolder(f.id, { name });
      notifyOtherTabs();
      Object.assign(f, folder);
      renderSidebar();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  async function moveFolderPrompt(f) {
    const res = await pickFolder(`Move “${f.name}”`, f.parent_id ?? null, (x) => x.id === f.id || isInside(x.id, f.id));
    if (!res || destroyed) return;
    try {
      const { folder } = await api.updateFolder(f.id, { parent_id: res.id });
      notifyOtherTabs();
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
    if (!ok || destroyed) return;
    try {
      await api.deleteFolder(f.id);
      notifyOtherTabs();
      await refreshLists();
      if (doc && !folders.some((x) => x.id === doc.folder_id)) doc.folder_id = null;
    } catch (err) {
      if (!destroyed) toast(err.message, { type: 'error' });
    }
  }

  // ---- Trash ----
  async function showTrash({ push = false } = {}) {
    const seq = ++navSeq;
    if (!(await leaveDoc())) return seq === navSeq && syncHash();
    if (seq !== navSeq) return;
    dropDoc();
    trashOpen = true;
    document.title = pageTitle('Trash');
    navigate('#/trash', push);
    showDocUI(false);
    sidePanel.hidden = true;
    renderSidebar();
    setMobileSidebar(false);
    trashView.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    await loadTrash();
  }

  async function loadTrash() {
    const seq = navSeq;
    try {
      const { documents } = await api.listTrash();
      if (seq === navSeq && trashOpen && !destroyed) renderTrash(documents);
    } catch (err) {
      if (seq === navSeq && trashOpen && !destroyed) trashView.replaceChildren(h('p', {}, err.message));
    }
  }

  function closeTrash() {
    const last = getPrefs().lastDoc;
    if (last && docs.some((d) => d.id === last)) {
      openDoc(last, { push: true });
    } else {
      ++navSeq;
      trashOpen = false;
      closeDoc();
    }
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
            notifyOtherTabs();
            if (destroyed) return;
            if (!docs.some((x) => x.id === d.id)) docs.unshift(restored);
            renderTrash(items.filter((x) => x.id !== d.id));
            renderSidebar();
            toast(`Restored “${d.title}”.`, { action: { label: 'Open', onClick: () => openDoc(d.id, { push: true }) } });
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        },
        html: `${icons.restore}<span>Restore</span>`,
      }),
      h('button', {
        class: 'btn',
        title: 'Delete forever',
        'aria-label': `Delete “${d.title}” forever`,
        onClick: async () => {
          if (!(await confirmDialog('Delete forever?', `“${d.title}” and its history will be permanently deleted.`, { ok: 'Delete forever', danger: true }))) return;
          try {
            await api.deleteDoc(d.id);
            notifyOtherTabs();
            clearDraft(d.id);
            if (!destroyed) renderTrash(items.filter((x) => x.id !== d.id));
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
              notifyOtherTabs();
              for (const x of items) clearDraft(x.id);
              if (!destroyed) renderTrash([]);
            } catch (err) {
              toast(err.message, { type: 'error' });
            }
          },
        }, 'Empty trash')),
      ...(items.length ? list : [h('p', { class: 'muted', style: 'margin-top:24px' }, 'The trash is empty.')]),
    );
  }

  // ---- Import / export ----
  async function importDocs(files) {
    if (!files.length) return toast('No Markdown files found.', { type: 'error' });
    let last = null;
    for (const f of files) {
      try {
        const { document: d } = await api.createDoc({ title: f.title, content: f.content, folder_id: doc?.folder_id ?? null });
        notifyOtherTabs();
        if (destroyed) return;
        docs.unshift(d);
        last = d;
      } catch (err) {
        if (destroyed) return;
        toast(`${f.title}: ${err.message}`, { type: 'error' });
      }
    }
    renderSidebar();
    if (last) {
      toast(files.length === 1 ? `Imported “${last.title}”.` : `Imported ${files.length} documents.`);
      await openDoc(last.id, { push: true });
    }
  }

  async function importFiles() {
    importDocs(await pickMarkdownFiles());
  }

  let dragDepth = 0;
  const dropOverlay = h('div', { class: 'drop-overlay', hidden: true }, 'Drop Markdown files to import');
  document.body.append(dropOverlay);
  cleanups.push(() => dropOverlay.remove());
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  // Images dropped on the editor are uploaded by the editor itself; the overlay is for Markdown files.
  const onlyImages = (e) => {
    const items = [...(e.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file');
    return items.length > 0 && items.every((i) => IMAGE_TYPES.includes(i.type));
  };
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files') && !onlyImages(e);
  listen(window, 'dragover', (e) => {
    // Don't let the browser open an image dropped next to the editor.
    if (onlyImages(e) && !editorPane.contains(e.target)) e.preventDefault();
  });
  listen(window, 'drop', (e) => {
    if (!onlyImages(e) || editorPane.contains(e.target)) return;
    e.preventDefault();
    toast('Drop images into the editor to upload them.');
  }, { capture: true });
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
  // Capture phase: runs before the editor's own drop handler, which then sees defaultPrevented
  // and leaves the open document alone (it would otherwise paste the file's text into it).
  listen(window, 'drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    importDocs(await readMarkdownFiles([...e.dataTransfer.files]));
  }, { capture: true });

  async function downloadHtml() {
    const { title, content } = doc;
    try {
      exportHtml(cleanTitle(title), await preview.renderStandalone(content));
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  // Print in the light theme, with diagrams re-rendered for it first.
  async function printDoc() {
    if (!doc || printing) return;
    printing = true;
    document.documentElement.dataset.theme = 'light';
    preview.update(doc.content);
    preview.setVisible(true);
    try {
      await preview.setThemeOverride('light');
    } catch {
      // Print what is there.
    }
    if (destroyed) return;
    window.print();
  }

  function endPrint() {
    if (!printing) return;
    printing = false;
    applyTheme();
    preview.setThemeOverride(null)?.catch(() => {});
    preview.setVisible(shownView() !== 'edit');
  }

  // ---- Share links ----
  function shareUrl(token) {
    return `${location.origin}/s/${token}`;
  }

  function setShareToken(id, token) {
    for (const d of [docs.find((x) => x.id === id), doc?.id === id ? doc : null]) if (d) d.share_token = token;
    renderSidebar();
    notifyOtherTabs();
  }

  function openShare(target) {
    modal({
      title: 'Share a read-only link',
      render: (close) => {
        const body = h('div', { class: 'stack' });
        const draw = () => {
          const token = target.share_token;
          if (!token) {
            body.replaceChildren(
              h('p', {}, 'Anyone with the link can read this document (not edit it). Search engines are asked not to index it. You can stop sharing at any time.'),
              h('div', { class: 'modal-actions' },
                h('button', { type: 'button', class: 'btn', onClick: () => close() }, 'Cancel'),
                h('button', {
                  type: 'button', class: 'btn btn-primary', autofocus: true,
                  onClick: async (e) => {
                    e.currentTarget.disabled = true;
                    try {
                      await flush();
                      const { token: t } = await api.shareDoc(target.id);
                      setShareToken(target.id, t);
                      draw();
                    } catch (err) {
                      toast(err.message, { type: 'error' });
                      close();
                    }
                  },
                }, 'Create link')),
            );
            return;
          }
          const url = shareUrl(token);
          const input = h('input', { type: 'text', value: url, readonly: true, 'aria-label': 'Share link', onFocus: (e) => e.target.select() });
          body.replaceChildren(
            h('p', {}, 'Anyone with this link can read the latest saved version:'),
            input,
            h('div', { class: 'modal-actions' },
              h('button', {
                type: 'button', class: 'btn btn-danger',
                onClick: async () => {
                  try {
                    await api.unshareDoc(target.id);
                    setShareToken(target.id, null);
                    toast('The link no longer works.');
                    close();
                  } catch (err) {
                    toast(err.message, { type: 'error' });
                  }
                },
              }, 'Stop sharing'),
              h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Open'),
              h('button', {
                type: 'button', class: 'btn btn-primary', autofocus: true,
                onClick: async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    toast('Link copied.');
                  } catch {
                    input.focus();
                    input.select();
                  }
                },
              }, 'Copy link')),
          );
          queueMicrotask(() => body.querySelector('[autofocus]')?.focus());
        };
        draw();
        return body;
      },
    });
  }

  // ---- Other tabs in this browser ----
  // A tab that changed something tells the others, which refresh their list and
  // pick up the new text of the open document if they have nothing unsaved.
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('hashmark') : null;
  let channelTimer;
  function notifyOtherTabs() {
    try {
      channel?.postMessage({ type: 'changed', user: user?.id });
    } catch {
      // Closed channel (the app was torn down).
    }
  }
  if (channel) {
    channel.onmessage = (e) => {
      if (e.data?.type !== 'changed' || e.data.user !== user?.id) return;
      clearTimeout(channelTimer);
      channelTimer = setTimeout(() => {
        lastRefresh = 0;
        refreshOnReturn();
      }, 150);
    };
    cleanups.push(() => {
      clearTimeout(channelTimer);
      channel.close();
    });
  }

  function openAccount() {
    showAccount({
      user,
      beforeExport: () => flush(),
      onDeleted: () => {
        dirty = false;
        clearAllDrafts();
        setPref('lastDoc', null);
        setPref('hasAccount', false);
        toAuthScreen('Your account and all its documents were deleted.');
      },
    });
  }

  function moreMenuItems() {
    const p = getPrefs();
    const items = [];
    if (doc) {
      items.push(
        { label: 'Save version now', icon: 'history', onClick: saveVersion },
        'separator',
        { label: 'Download Markdown (.md)', icon: 'download', onClick: () => exportMarkdown(cleanTitle(doc.title), doc.content) },
        { label: 'Download HTML (.html)', icon: 'download', onClick: downloadHtml },
        { label: 'Print / Save as PDF', icon: 'printer', onClick: printDoc },
        'separator',
        { label: doc.share_token ? 'Shared link…' : 'Share read-only link…', icon: 'link', onClick: () => openShare(doc) },
      );
    }
    items.push({ label: 'Import Markdown files…', icon: 'upload', onClick: importFiles }, 'separator');
    if (mobileQuery.matches) items.push(...themeItems(' theme'), 'separator'); // the theme button is desktop-only
    items.push(
      { label: 'Line numbers', checked: p.lineNumbers, onClick: () => editor.setLineNumbers(setPref('lineNumbers', !p.lineNumbers).lineNumbers) },
      { label: 'Sync scrolling', checked: p.syncScroll, onClick: () => setPref('syncScroll', !p.syncScroll) },
      { label: 'Keyboard shortcuts', onClick: showShortcuts },
      { label: 'Account…', icon: 'settings', onClick: openAccount },
    );
    if (doc) {
      const current = doc;
      items.push('separator', { label: 'Move to trash', icon: 'trash', danger: true, onClick: () => trashDoc(docs.find((d) => d.id === current.id) ?? current) });
    }
    return items;
  }

  function showShortcuts() {
    const rows = [
      ['Save a version', `${MOD}+S`], ['Bold', `${MOD}+B`], ['Italic', `${MOD}+I`], ['Strikethrough', `${MOD}+Shift+X`],
      ['Inline code', `${MOD}+E`], ['Code block', `${MOD}+Shift+K`], ['Link', `${MOD}+K`],
      ['Heading 1–3', `${MOD}+Alt+1…3`], ['Numbered / bulleted / task list', `${MOD}+Shift+7 / 8 / 9`],
      ['Find / replace', `${MOD}+F`], ['Undo / redo', `${MOD}+Z / ${MOD}+Shift+Z`], ['Indent / outdent', 'Tab / Shift+Tab'],
      ['Cycle view (editor, split, preview)', `${MOD}+/`], ['Toggle sidebar', `${MOD}+\\`], ['Search documents', `${MOD}+Shift+F`],
      ['Print / Save as PDF', `${MOD}+P`],
    ];
    modal({
      title: 'Keyboard shortcuts',
      render: () => h('table', { class: 'kbd-table' }, rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, h('kbd', {}, b))))),
    });
  }

  // ---- Views, panels, sidebar ----
  // The view actually shown: split is desktop-only.
  const shownView = () => (mobileQuery.matches && getPrefs().view === 'split' ? 'edit' : getPrefs().view);

  function setView(view) {
    setPref('view', view);
    workspace.dataset.view = view;
    const shown = shownView();
    for (const [k, b] of Object.entries(viewButtons)) {
      b.classList.toggle('active', k === shown && !b.disabled);
      b.setAttribute('aria-pressed', String(k === shown));
    }
    // A hidden preview is not rendered while typing; it catches up when shown.
    if (doc) preview.update(doc.content);
    if (!printing) preview.setVisible(shown !== 'edit');
    if (shown === 'split') requestAnimationFrame(() => syncFrom('editor'));
  }

  function cycleView() {
    if (!doc) return;
    const order = mobileQuery.matches ? ['edit', 'preview'] : ['edit', 'split', 'preview'];
    const i = order.indexOf(shownView());
    setView(order[(i + 1) % order.length]);
  }

  function setSidebar(open) {
    setPref('sidebar', open);
    appEl.classList.toggle('no-sidebar', !open);
    updateMenuBtn();
  }

  function setMobileSidebar(open) {
    const on = open && mobileQuery.matches;
    const was = appEl.classList.contains('mobile-sidebar-open');
    appEl.classList.toggle('mobile-sidebar-open', on);
    main.inert = on; // Tab stays in the drawer
    if (on && !was) {
      // Not the search box: that would pop up the phone keyboard.
      sidebarEl.querySelector('[aria-current="page"]')?.focus();
      if (!sidebarEl.contains(document.activeElement)) sidebarEl.focus();
    } else if (!on && was && sidebarEl.contains(document.activeElement)) {
      menuBtn.focus(); // the closed drawer is hidden, which would lose the focus
    }
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
    for (const [name, b] of [['outline', outlineBtn], ['history', historyBtn]]) {
      b.classList.toggle('active', panel === name && !b.disabled);
      b.setAttribute('aria-pressed', String(panel === name));
    }
    sidePanel.hidden = !panel || !doc;
    if (!panel || !doc) return;
    if (panel === 'outline') renderOutline();
    else renderHistory();
  }

  // Highlights the outline entry of the section at the top of the editor.
  let outlineFrame = 0;
  function scheduleOutlineActive() {
    if (getPrefs().panel !== 'outline' || outlineFrame) return;
    outlineFrame = requestAnimationFrame(() => {
      outlineFrame = 0;
      updateOutlineActive();
    });
  }

  function updateOutlineActive() {
    const items = [...panelBody.querySelectorAll('.outline-item')];
    if (!items.length || !doc) return;
    const top = editor.topLine() + 1;
    let active = null;
    for (const item of items) if (Number(item.dataset.line) <= top) active = item;
    for (const item of items) {
      item.classList.toggle('active', item === active);
      if (item === active) item.setAttribute('aria-current', 'location');
      else item.removeAttribute('aria-current');
    }
  }

  function renderOutline() {
    panelTitle.textContent = 'Outline';
    const headings = extractHeadings(doc.content);
    panelBody.replaceChildren(
      ...(headings.length
        ? headings.map((hd) => h('button', {
            type: 'button', class: 'outline-item', 'data-level': hd.level, 'data-line': hd.line, style: `--level:${hd.level}`,
            onClick: () => {
              editor.scrollToLine(hd.line, { select: true });
              preview.scrollToId(hd.id);
            },
          }, hd.text))
        : [h('p', { class: 'muted', style: 'padding:8px' }, 'Add headings (# Title) to see an outline.')]),
    );
    updateOutlineActive();
  }

  async function renderHistory() {
    panelTitle.textContent = 'Version history';
    const current = doc;
    const saveBtn = h('button', { class: 'btn btn-block', style: 'margin-bottom:8px', onClick: saveVersion, html: `${icons.history}<span>Save version now</span>` });
    if (!revisionsCache) {
      panelBody.replaceChildren(saveBtn, h('p', { class: 'muted', style: 'padding:8px' }, 'Loading…'));
      try {
        revisionsCache = (await api.listRevisions(current.id)).revisions;
      } catch (err) {
        if (doc === current) panelBody.replaceChildren(saveBtn, h('p', { style: 'padding:8px' }, err.message));
        return;
      }
      if (doc !== current || getPrefs().panel !== 'history') return;
    }
    panelBody.replaceChildren(
      saveBtn,
      h('p', { class: 'muted', style: 'padding:0 8px 8px;margin:0;font-size:var(--fs-xs)' },
        touchQuery.matches ? 'Saved automatically.' : `Saved automatically, and on ${MOD}+S.`),
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
    const body = h('div', {
      class: 'revision-preview markdown-body',
      html: renderMarkdown(revision.content),
      // In-page links (footnotes, headings) scroll here instead of changing the route.
      onClick: (e) => {
        const link = e.target.closest('a[href^="#"]');
        if (!link) return;
        e.preventDefault();
        let id = link.getAttribute('href').slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          // keep it as written
        }
        if (id) body.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' });
      },
    });
    // Read-only: ticking a task here would change nothing.
    for (const box of body.querySelectorAll('input.task-list-item-checkbox')) box.disabled = true;
    for (const li of body.querySelectorAll('.task-list-item.enabled')) li.classList.remove('enabled');
    renderDiagrams(body, isDark() ? 'dark' : 'default'); // not awaited: the source shows until drawn
    const restore = await modal({
      title: `Version from ${new Date(revision.created_at).toLocaleString()}`,
      wide: true,
      render: (close) => h('div', { class: 'stack' },
        body,
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onClick: () => close(false) }, 'Close'),
          h('button', { class: 'btn btn-primary', onClick: () => close(true), html: `${icons.restore}<span>Restore this version</span>` }))),
    });
    if (!restore || doc !== target) return;
    try {
      if (!(await leaveDoc()) || doc !== target) return;
      const { document: restored } = await api.restoreRevision(target.id, r.id);
      notifyOtherTabs();
      if (doc !== target) return;
      setDoc(restored, { skipDraft: true }); // changes that could not be saved stay in the draft
      toast('Version restored. The previous text is kept in the history.');
    } catch (err) {
      if (destroyed) return;
      if (err.status === 410 && doc === target && !issue) onSaveError(err); // trashed elsewhere: offer to restore it
      else toast(err.message, { type: 'error' });
    }
  }

  function setTheme(theme) {
    setPref('theme', theme);
    applyTheme();
    onThemeChange();
  }

  function onThemeChange() {
    themeBtn.innerHTML = icons[THEMES.find((t) => t.id === currentTheme()).icon];
    if (!printing) preview.rerender();
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
    statWords.textContent = `${s.words.toLocaleString()} words · ${s.chars.toLocaleString()} characters${s.minutes ? ` · ${s.minutes} min read` : ''}`;
    updateSavedLabel();
    document.title = pageTitle(cleanTitle(doc.title));
  }

  function updateSavedLabel() {
    statUpdated.textContent = doc?.updated_at ? `Saved ${timeAgo(doc.updated_at)}` : '';
  }
  const clock = setInterval(updateSavedLabel, 30000); // keeps "Saved 5 min ago" current
  cleanups.push(() => clearInterval(clock));

  let scrollSource = null;
  let scrollTimer = null;
  let scrollFrame = null;
  function syncFrom(source) {
    if (!getPrefs().syncScroll || shownView() !== 'split') return;
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
    if (e.defaultPrevented) return; // e.g. the editor, a menu or the search box handled it
    // Escape closes the phone drawer (a dialog opened from it closes first).
    if (e.key === 'Escape' && appEl.classList.contains('mobile-sidebar-open') && !document.querySelector('dialog[open]')) {
      setMobileSidebar(false);
      return;
    }
    // Skip AltGr (Ctrl+Alt on Windows), which types characters like \.
    if (e.altKey || !(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      saveVersion();
    } else if (key === 'p' && !e.shiftKey && doc) {
      e.preventDefault();
      printDoc();
    } else if (e.key === '/') {
      e.preventDefault();
      cycleView();
    } else if (e.key === '\\') {
      e.preventDefault();
      if (mobileQuery.matches) setMobileSidebar(!appEl.classList.contains('mobile-sidebar-open'));
      else setSidebar(!getPrefs().sidebar);
    } else if (e.shiftKey && key === 'f') {
      e.preventDefault();
      if (!getPrefs().sidebar && !mobileQuery.matches) setSidebar(true);
      setMobileSidebar(true);
      sidebar.focusSearch();
    }
  });

  // Only asks; the last save is sent on pagehide, which fires only when the page really goes.
  listen(window, 'beforeunload', (e) => {
    writeDraft();
    if (dirty && doc) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  listen(window, 'pagehide', () => {
    writeDraft();
    if (!dirty || !doc || issue || destroyed) return;
    const target = doc;
    const body = { content: target.content, version: target.version };
    const title = cleanTitle(target.title);
    if (title !== target.baseTitle) body.title = title;
    if (new TextEncoder().encode(JSON.stringify(body)).length > KEEPALIVE_LIMIT) return; // the draft has it
    maybeSaved = { id: target.id, content: target.content };
    api.saveDoc(target.id, body, { keepalive: true }).then(({ document: saved }) => {
      // Still here (restored from the back/forward cache): take the new version.
      if (doc !== target || target.version !== body.version) return;
      Object.assign(target, { version: saved.version, updated_at: saved.updated_at, baseTitle: saved.title });
      maybeSaved = null;
      if (target.content === body.content && cleanTitle(target.title) === saved.title) {
        dirty = false;
        clearDraft(target.id);
        setStatus('saved');
      }
    }, () => {});
  });
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      writeDraft();
      flush();
    } else {
      refreshOnReturn();
    }
  });
  listen(window, 'focus', () => refreshOnReturn());
  listen(window, 'online', () => {
    if (!dirty || issue) return;
    retryCount = 0;
    save();
  });
  listen(window, 'hashchange', () => route());

  // Printing from the browser menu: at least use the light theme and the current text.
  // Light diagrams drawn before are swapped in at once; others can't be waited for here.
  listen(window, 'beforeprint', () => {
    if (printing) return;
    printing = true;
    document.documentElement.dataset.theme = 'light';
    if (doc) {
      preview.update(doc.content);
      preview.setVisible(true);
      preview.setThemeOverride('light')?.catch(() => {});
    }
  });
  listen(window, 'afterprint', () => endPrint());

  function route() {
    const m = /^#\/doc\/([\w-]+)/.exec(location.hash);
    if (m) return openDoc(m[1]);
    if (location.hash === '#/trash') return showTrash();
    syncHash(); // e.g. Back to "#/": the open document stays open
    return null;
  }

  async function logout() {
    await flush();
    if (destroyed || issueDialogOpen) return;
    // Drafts (of any document) hold text that never reached the server either.
    const drafts = draftIds();
    if (dirty || drafts.length) {
      const onlyThis = dirty && drafts.every((id) => id === doc.id);
      const what = onlyThis ? `Your latest changes to “${cleanTitle(doc.title)}” were` : 'Some changes were';
      const ok = await confirmDialog('Sign out and lose unsaved changes?',
        `${what} never saved to the server. Signing out removes them from this browser.`,
        { ok: 'Sign out anyway', danger: true });
      if (!ok || destroyed) return;
    }
    try {
      await api.logout();
    } catch (err) {
      // 401: the session had already ended, so we are signed out anyway.
      if (err.status !== 401) {
        toast(err.status === 0 ? 'Couldn’t sign out: you’re offline. Try again when you’re connected.' : err.message, { type: 'error' });
        return;
      }
    }
    if (destroyed) return;
    // Nothing of this account stays readable in this browser.
    dirty = false;
    clearAllDrafts();
    setPref('lastDoc', null);
    toAuthScreen();
  }

  function destroy() {
    if (destroyed) return;
    if (dirty) writeDraft(); // e.g. the session expired: restored after signing in again
    destroyed = true;
    doc = null;
    dirty = false;
    scheduleSave.cancel();
    schedulePreview.cancel();
    clearTimeout(retryTimer);
    clearTimeout(draftTimer);
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
      if (!destroyed) toast(err.message, { type: 'error' });
      return;
    }
    if (destroyed) return;
    pruneDrafts();
    if (route()) return;
    const last = getPrefs().lastDoc;
    const pick = docs.find((d) => d.id === last) ?? docs[0];
    if (pick) openDoc(pick.id);
  })();

  return { destroy, onThemeChange };
}

boot();
