// The editor on the home page: the app's editor and preview for one document, kept in this
// browser, with no account needed. Everything that doesn't need a server works here:
// formatting, split view, math, diagrams, themes, opening files and every export.
// "Save" hands the text to the app, which stores it in an account.
//
// The page ships a plain textarea and a pre-rendered preview, so it reads (and indexes)
// without JavaScript; this module swaps in the real editor in the same box.
import 'katex/dist/katex.min.css';
import './widgets.css';
import './home-editor.css';
import { undo } from '@codemirror/commands';
import { createEditor, commands } from './editor.js';
import { createPreview, documentStats } from './preview.js';
import {
  exportMarkdown, exportHtml, buildStandaloneHtml, pickMarkdownFiles, titleFromMarkdown, copyRichText, printStandalone,
} from './export.js';
import { h, iconButton, toast, showMenu, debounce } from './ui.js';
import { loadGuestDraft, saveGuestDraft } from './guest.js';
import { THEMES, currentTheme, isDark, applyTheme, setTheme, onSystemThemeChange, themeMenuItems } from './theme.js';
import { getPrefs, setPref } from './storage.js';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const mobileQuery = window.matchMedia('(max-width: 700px)');

/** Markdown passed in the link: /#text=<URL-encoded Markdown>. Read from the fragment, so it never reaches a server. */
function linkedText() {
  const m = /^#text=(.*)$/s.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search); // a reload shouldn't open it again
  try {
    return decodeURIComponent(m[1].replace(/\+/g, '%20'));
  } catch {
    return null;
  }
}

// Signed in on this browser: supabase-js keeps the session under this key (see supabase.js).
function signedIn() {
  try {
    return Boolean(localStorage.getItem('hashlite:auth'));
  } catch {
    return false;
  }
}

export function mountHomeEditor(root) {
  const staticInput = root.querySelector('textarea');
  const sample = staticInput?.defaultValue ?? '';
  const draft = loadGuestDraft();

  applyTheme();

  // ---- Layout ----
  const editorPane = h('div', { class: 'he-pane he-editor' });
  const content = h('article', { class: 'markdown-body' });
  const previewPane = h('div', { class: 'he-pane he-preview', tabindex: '-1', 'aria-label': 'Preview' }, content);
  const panes = h('div', { class: 'he-panes' }, editorPane, previewPane);

  const tb = (icon, label, cmd) => iconButton(icon, label, () => editor.run(cmd));
  const tools = h('div', { class: 'he-tools', role: 'toolbar', 'aria-label': 'Formatting' },
    tb('heading', 'Heading (cycle H1–H3)', commands.cycleHeading),
    tb('bold', `Bold (${MOD}+B)`, commands.bold),
    tb('italic', `Italic (${MOD}+I)`, commands.italic),
    h('span', { class: 'sep' }),
    tb('ul', `Bulleted list (${MOD}+Shift+8)`, commands.ul),
    tb('ol', `Numbered list (${MOD}+Shift+7)`, commands.ol),
    tb('task', `Task list (${MOD}+Shift+9)`, commands.task),
    tb('quote', 'Quote', commands.quote),
    h('span', { class: 'sep' }),
    tb('link', `Link (${MOD}+K)`, commands.link),
    tb('codeBlock', `Code block (${MOD}+Shift+K)`, commands.codeBlock),
    tb('table', 'Table', commands.table),
    tb('math', 'Math', commands.math));

  const viewButtons = {
    edit: iconButton('edit', `Editor only (${MOD}+/ cycles)`, () => setView('edit')),
    split: iconButton('split', 'Side by side', () => setView('split'), { class: 'icon-btn he-wide-only' }),
    preview: iconButton('eye', 'Preview only', () => setView('preview')),
  };
  const moreBtn = iconButton('more', 'More actions', (e) => showMenu(e.currentTarget, menuItems()));
  const saveBtn = h('button', {
    type: 'button', class: 'he-save', title: 'Save to your Hashlite account: folders, history and every device',
    onClick: () => saveToAccount(),
  }, signedIn() ? 'Save to my documents' : 'Save');
  const bar = h('div', { class: 'he-bar' },
    tools,
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' }, viewButtons.edit, viewButtons.split, viewButtons.preview),
    moreBtn, saveBtn);

  const words = h('span');
  const stored = h('span', { class: 'he-stored' }, 'Saved in this browser');
  const status = h('div', { class: 'he-status' }, words, h('span', { class: 'he-spacer' }), stored);

  // ---- Editor and preview ----
  const preview = createPreview({ scroller: previewPane, content }, {
    isDark,
    onToggleTask: (line) => editor.toggleTaskAtLine(line),
    onScroll: () => syncFrom('preview'),
  });

  const store = debounce(() => {
    stored.textContent = saveGuestDraft(editor.getValue()) ? 'Saved in this browser' : 'Not saved: this browser blocks storage';
  }, 400);

  function refreshNow() {
    const text = editor.getValue();
    preview.update(text);
    const s = documentStats(text);
    words.textContent = `${s.words.toLocaleString()} words${s.minutes ? ` · ${s.minutes} min read` : ''}`;
  }
  const refresh = debounce(refreshNow, 120);

  const editor = createEditor(editorPane, {
    onChange: () => {
      stored.textContent = 'Saving…';
      store();
      refresh();
    },
    onSave: () => {
      store.cancel();
      saveGuestDraft(editor.getValue());
      stored.textContent = 'Saved in this browser';
      toast('Saved in this browser.', { action: { label: 'Save to account', onClick: saveToAccount } });
    },
    onCycleView: () => {
      const order = mobileQuery.matches ? ['edit', 'preview'] : ['edit', 'split', 'preview'];
      setView(order[(order.indexOf(shownView()) + 1) % order.length]);
    },
    onScroll: () => syncFrom('editor'),
  });
  editor.load(draft?.content ?? sample);

  root.replaceChildren(bar, panes, status);
  root.classList.add('ready');

  // Keep the text when leaving within the pause after typing.
  addEventListener('pagehide', () => saveGuestDraft(editor.getValue(), { pending: Boolean(loadGuestDraft()?.pending) }));

  function saveToAccount() {
    saveGuestDraft(editor.getValue(), { pending: true });
    location.href = '/app';
  }

  // ---- Views ----
  const shownView = () => {
    const view = getPrefs().homeView ?? 'split';
    return mobileQuery.matches && view === 'split' ? 'edit' : view;
  };
  function setView(view) {
    if (view) setPref('homeView', view);
    const shown = shownView();
    panes.dataset.view = shown;
    for (const [k, b] of Object.entries(viewButtons)) {
      b.classList.toggle('active', k === shown);
      b.setAttribute('aria-pressed', String(k === shown));
    }
    preview.setVisible(shown !== 'edit');
  }
  mobileQuery.addEventListener('change', () => setView());
  setView();

  // ---- Scroll sync (split view) ----
  let scrollSource = null;
  let scrollTimer = 0;
  let scrollFrame = 0;
  function syncFrom(source) {
    if (shownView() !== 'split') return;
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

  // ---- Actions ----
  const text = () => editor.getValue();
  const title = () => titleFromMarkdown(text());

  /** Replaces the text; Undo (or Ctrl+Z) brings the old text back. */
  function replaceText(next, message) {
    if (next === text()) return;
    editor.replace(next); // doesn't fire onChange
    saveGuestDraft(next);
    refreshNow();
    editor.focus();
    toast(message, { timeout: 8000, action: { label: 'Undo', onClick: () => editor.run(undo) } });
  }

  async function standalone() {
    return preview.renderStandalone(text());
  }

  async function run(action) {
    try {
      await action();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  function menuItems() {
    return [
      { label: 'Open Markdown file…', icon: 'upload', onClick: () => run(async () => {
        const [file] = await pickMarkdownFiles();
        if (file) replaceText(file.content, `Opened “${file.title}”.`);
      }) },
      { label: 'New document', icon: 'plus', onClick: () => replaceText('', 'Started a new document.') },
      'separator',
      { label: 'Download Markdown (.md)', icon: 'download', onClick: () => exportMarkdown(title(), text()) },
      { label: 'Download HTML (.html)', icon: 'download', onClick: () => run(async () => exportHtml(title(), await standalone())) },
      { label: 'Print / Save as PDF', icon: 'printer', onClick: () => run(printDoc) },
      { label: 'Copy as formatted text', icon: 'copy', onClick: () => run(async () => {
        await copyRichText(await standalone(), text());
        toast('Copied. Paste it into Word, Google Docs or an email.');
      }) },
      'separator',
      { label: 'Theme…', icon: THEMES.find((t) => t.id === currentTheme()).icon, onClick: () => showMenu(moreBtn, themeMenuItems(pickTheme)) },
      { label: 'Line numbers', checked: Boolean(getPrefs().lineNumbers), onClick: () => editor.setLineNumbers(setPref('lineNumbers', !getPrefs().lineNumbers).lineNumbers) },
    ];
  }

  function pickTheme(id) {
    setTheme(id);
    preview.rerender();
  }
  onSystemThemeChange(() => {
    applyTheme();
    preview.rerender();
  });

  async function printDoc() {
    printStandalone(buildStandaloneHtml(title(), await standalone()));
  }
  // Ctrl/⌘+P prints the document, not the page around it.
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      run(printDoc);
    }
  });

  // A link with #text=… opens that Markdown, also when the page is already open.
  function openLinked() {
    const linked = linkedText();
    if (linked === null) return;
    if (text() === sample || !text().trim()) {
      editor.load(linked);
      saveGuestDraft(linked);
      refreshNow();
    } else {
      replaceText(linked, 'Opened the linked document.');
    }
  }
  addEventListener('hashchange', openLinked);
  openLinked();

  editor.setLineNumbers(getPrefs().lineNumbers);
  refreshNow();
  return editor;
}
