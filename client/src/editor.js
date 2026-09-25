// CodeMirror 6 setup plus Markdown formatting commands.
import { EditorState, EditorSelection, Compartment, Annotation } from '@codemirror/state';
import {
  EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars,
  lineNumbers, highlightActiveLineGutter, rectangularSelection, crosshairCursor, placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';

const externalLoad = Annotation.define();

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '600', color: 'var(--md-heading)' },
  { tag: t.heading2, fontWeight: '600', color: 'var(--md-heading)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '600', color: 'var(--md-heading)' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--md-link)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--md-code)' },
  { tag: t.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--md-mark)' },
  { tag: [t.keyword, t.operatorKeyword], color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--hl-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--hl-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: 'var(--hl-function)' },
  { tag: [t.typeName, t.className], color: 'var(--hl-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--hl-attr)' },
  { tag: [t.tagName], color: 'var(--hl-tag)' },
]);

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size)', backgroundColor: 'var(--bg)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--font-editor)', lineHeight: '1.65', overflow: 'auto' },
  '.cm-content': { padding: '24px 0 40vh', maxWidth: '860px', margin: '0 auto', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 24px' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--text-faint)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--match)', outline: '1px solid var(--accent-soft)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-panel input, .cm-panel button': { font: 'inherit', fontSize: 'var(--fs-sm)' },
  '.cm-placeholder': { color: 'var(--text-faint)' },
});

// ---- Formatting commands ------------------------------------------------

/** Applies changes and moves collapsed cursors after inserted text (so a cursor at the start of a line ends up after a new "- "). */
function applyChanges(view, spec) {
  const changes = view.state.changes(spec);
  view.dispatch({ changes, selection: view.state.selection.map(changes, 1), scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

/** Number of `ch` characters at the start (or end) of `s`. */
function runOf(s, ch, atEnd = false) {
  let n = 0;
  while (n < s.length && s[atEnd ? s.length - 1 - n : n] === ch) n++;
  return n;
}

/** Wraps each selection in an inline marker such as "**", or removes it when already wrapped. */
function wrap(view, marker, placeholderText) {
  const { state } = view;
  const ch = marker[0];
  const n = marker.length;
  // Is a run of `m` marker characters this marker? "*" and "**" share a character:
  // italic owns odd runs ("*a*", "***a***"), bold owns runs of two or more.
  const isMarker = (m) => (ch === '*' && n === 1 ? m % 2 === 1 : m >= n);
  // Text that contains the marker itself is left alone when unwrapping ("*a* and *b*").
  const runs = new RegExp(`[${ch}]+`, 'g');
  const clean = (s) => !(s.match(runs) ?? []).some((run) => isMarker(run.length));

  const changes = state.changeByRange((range) => {
    let { from, to } = range;
    const raw = state.sliceDoc(from, to);
    if (raw.trim()) {
      // Wrap the trimmed text: "**word **" would not render.
      from += raw.length - raw.trimStart().length;
      to -= raw.length - raw.trimEnd().length;
    } else {
      // A cursor inside a word wraps that word.
      from = to;
      const word = state.wordAt(to);
      if (word && word.from < to && to < word.to) ({ from, to } = word);
    }
    const text = state.sliceDoc(from, to);
    // Toggle off when the markers sit just outside the text...
    const outer = Math.min(runOf(state.sliceDoc(Math.max(0, from - 3), from), ch, true), runOf(state.sliceDoc(to, to + 3), ch));
    if (isMarker(outer) && clean(text)) {
      return {
        changes: [{ from: from - n, to: from }, { from: to, to: to + n }],
        range: EditorSelection.range(from - n, to - n),
      };
    }
    // ...or when the selected text includes them.
    const inner = text.length > 2 * n ? text.slice(n, -n) : '';
    if (inner.split(ch).join('') && isMarker(Math.min(runOf(text, ch), runOf(text, ch, true))) && clean(inner)) {
      return {
        changes: [{ from, to: from + n }, { from: to - n, to }],
        range: EditorSelection.range(from, to - 2 * n),
      };
    }
    const body = text || placeholderText;
    return {
      changes: { from, to, insert: marker + body + marker },
      range: EditorSelection.range(from + n, from + n + body.length),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
  view.focus();
  return true;
}

/** Last line a range covers: one ending at the start of a line (e.g. a triple-click) leaves that line out. */
function lastLine(doc, r) {
  const line = doc.lineAt(r.to);
  return r.to > r.from && line.from === r.to ? doc.lineAt(r.to - 1) : line;
}

function selectedLines(state) {
  const lines = new Set();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= lastLine(state.doc, r).number; n++) lines.add(n);
  }
  return [...lines].sort((a, b) => a - b).map((n) => state.doc.line(n));
}

const isBlank = (line) => !line.text.trim();

const LINE_PREFIX_RE = /^(\s*)(#{1,6}\s|>\s?|[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s)?/;

/** Sets (or toggles off) a block prefix such as "## ", "> ", "- " on every selected line. */
function setLinePrefix(view, makePrefix, { quote = false } = {}) {
  const all = selectedLines(view.state);
  // Across several lines, blank lines get no prefix (no empty list items);
  // quotes mark them with ">" so the paragraphs stay in one blockquote.
  const multi = all.length > 1 && !all.every(isBlank);
  const lines = multi ? all.filter((l) => !isBlank(l)) : all;
  const first = makePrefix(0);
  const prefixOf = (line) => LINE_PREFIX_RE.exec(line.text)[2] ?? '';
  const allHave = lines.every((l) => prefixOf(l) && sameKind(prefixOf(l), first));
  const changes = lines.map((line, i) => {
    const m = LINE_PREFIX_RE.exec(line.text);
    const from = line.from + m[1].length;
    return { from, to: from + (m[2] ?? '').length, insert: allHave ? '' : makePrefix(i) };
  });
  if (quote && multi && !allHave) {
    for (const line of all) if (isBlank(line)) changes.push({ from: line.from, to: line.to, insert: '>' });
  }
  return applyChanges(view, changes);
}

function sameKind(a, b) {
  const kind = (p) => (/^\d/.test(p) ? 'ol' : p.includes('[') ? 'task' : p.trim());
  return kind(a) === kind(b);
}

/** Inserts a block (table, rule, code) on its own lines, with blank lines around it. */
function insertBlock(view, text, selectOffset = null, selectLength = 0) {
  const { doc } = view.state;
  let line = lastLine(doc, view.state.selection.main);
  // Never split the block the cursor is in: go past a code block's closing fence,
  // then to the last line of a paragraph, table or list.
  const opener = fenceOpener(doc, line.number) || (/^\s*```/.test(line.text) ? line.number : 0);
  if (opener) line = fenceCloser(doc, opener);
  const onBlank = isBlank(line);
  while (!onBlank && line.number < doc.lines && !isBlank(doc.line(line.number + 1))) {
    line = doc.line(line.number + 1);
    if (/^\s*```/.test(line.text)) line = fenceCloser(doc, line.number); // a code block right under the text
  }
  const prev = line.number > 1 ? doc.line(line.number - 1) : null;
  const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
  // Fill a blank line, else go after the block with a blank line between: a block
  // right under a paragraph would join it ("---" there turns the paragraph into a heading).
  const from = onBlank ? line.from : line.to;
  const before = onBlank ? (prev && !isBlank(prev) ? '\n' : '') : '\n\n';
  // Keep a blank line after the block; at the end, add a line to type on.
  const after = next ? (isBlank(next) ? '' : '\n') : '\n\n';
  const start = from + before.length;
  const anchor = start + (selectOffset ?? text.length + (next ? 1 : 2));
  view.dispatch({
    changes: { from, to: onBlank ? line.to : from, insert: before + text + after },
    selection: EditorSelection.range(anchor, anchor + selectLength),
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
}

/** The number of the ``` line that opens the code block line `n` is in, or 0 outside code blocks. */
function fenceOpener(doc, n) {
  let opener = 0;
  for (let i = 1; i < n; i++) {
    const text = doc.line(i).text;
    if (!opener) {
      if (/^\s*```/.test(text)) opener = i;
    } else if (/^\s*```\s*$/.test(text)) opener = 0;
  }
  return opener;
}

/** The ``` line that closes the code block opened at line `n` (the last line if it is never closed). */
function fenceCloser(doc, n) {
  for (let i = n + 1; i <= doc.lines; i++) if (/^\s*```\s*$/.test(doc.line(i).text)) return doc.line(i);
  return doc.line(doc.lines);
}

/** Fences the selected lines as a code block, or removes the fences around them. */
function fenceLines(view) {
  const { state } = view;
  const { doc } = state;
  const r = state.selection.main;
  const first = doc.lineAt(r.from);
  const last = lastLine(doc, r);
  const prev = first.number > 1 ? doc.line(first.number - 1) : null;
  const next = last.number < doc.lines ? doc.line(last.number + 1) : null;
  // Unfence only when the lines are exactly the inside of one block: `prev` opens it and
  // `next` closes it (not the end of one block above and the start of another below).
  if (prev && next && /^\s*```\s*$/.test(next.text) && fenceOpener(doc, next.number) === prev.number) {
    const removed = first.from - prev.from;
    view.dispatch({
      changes: [{ from: prev.from, to: first.from }, { from: last.to, to: next.to }],
      selection: EditorSelection.range(prev.from, last.to - removed),
      scrollIntoView: true,
      userEvent: 'input',
    });
  } else {
    // Fences go on their own lines (with the line's indent, so list items keep their code).
    const indent = /^\s*/.exec(first.text)[0];
    const body = state.sliceDoc(first.from, last.to);
    const start = first.from + indent.length + 4;
    view.dispatch({
      changes: { from: first.from, to: last.to, insert: `${indent}\`\`\`\n${body}\n${indent}\`\`\`` },
      selection: EditorSelection.range(start, start + body.length),
      scrollIntoView: true,
      userEvent: 'input',
    });
  }
  view.focus();
  return true;
}

/** Is the selection the "https://" a link or image command just inserted? Then running it again keeps it. */
function onUrlPlaceholder(view) {
  const { state } = view;
  const r = state.selection.main;
  return state.sliceDoc(r.from, r.to) === 'https://' && state.sliceDoc(r.from - 2, r.from) === '](' && state.sliceDoc(r.to, r.to + 1) === ')';
}

// ---- Image uploads ------------------------------------------------------

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const imageFiles = (list) => [...(list ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));
const uploaders = new WeakMap(); // view → pickImage(), for commands.uploadImage
let uploadCount = 0;

/** Inserts a placeholder per image over from..to, uploads each and swaps in the final Markdown. */
function insertImages(view, files, from, to, { uploadImage, onUploadError }, userEvent) {
  // Unique placeholders, found again by their text wherever later edits have moved them.
  const tags = files.map(() => `![Uploading image-${Date.now().toString(36)}${++uploadCount}…]()`);
  const insert = tags.join('\n');
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent });
  view.focus();
  const swap = (tag, text) => {
    if (!view.dom.isConnected) return; // the editor was closed meanwhile
    const pos = view.state.doc.toString().indexOf(tag);
    if (pos >= 0) view.dispatch({ changes: { from: pos, to: pos + tag.length, insert: text }, userEvent: 'input' });
  };
  files.forEach((file, i) => {
    Promise.resolve()
      .then(() => uploadImage(file))
      .then((url) => {
        const alt = file.name.replace(/\.[^.]*$/, '').replace(/[[\]\\]/g, '') || 'image';
        const safeUrl = String(url).replace(/[ ()]/g, (c) => ({ ' ': '%20', '(': '%28', ')': '%29' })[c]);
        swap(tags[i], `![${alt}](${safeUrl})`);
      })
      .catch((err) => {
        swap(tags[i], '');
        onUploadError?.(err);
      });
  });
}

export const commands = {
  bold: (v) => wrap(v, '**', 'bold text'),
  italic: (v) => wrap(v, '*', 'italic text'),
  strike: (v) => wrap(v, '~~', 'text'),
  code: (v) => wrap(v, '`', 'code'),
  math: (v) => wrap(v, '$', 'E = mc^2'),
  heading: (level) => (v) => setLinePrefix(v, () => '#'.repeat(level) + ' '),
  cycleHeading: (v) => {
    const line = v.state.doc.lineAt(v.state.selection.main.from);
    const existing = /^#{1,6}\s/.exec(line.text)?.[0] ?? '';
    const current = existing.trim().length;
    const next = current >= 3 ? 0 : current + 1;
    return applyChanges(v, { from: line.from, to: line.from + existing.length, insert: next ? '#'.repeat(next) + ' ' : '' });
  },
  quote: (v) => setLinePrefix(v, () => '> ', { quote: true }),
  ul: (v) => setLinePrefix(v, () => '- '),
  ol: (v) => setLinePrefix(v, (i) => `${i + 1}. `),
  task: (v) => setLinePrefix(v, () => '- [ ] '),
  link: (v) => {
    const r = v.state.selection.main;
    if (onUrlPlaceholder(v)) return (v.focus(), true);
    const text = v.state.sliceDoc(r.from, r.to);
    const isUrl = /^https?:\/\/\S+$/.test(text);
    const insert = isUrl ? `[link text](${text})` : `[${text || 'link text'}](https://)`;
    const selStart = isUrl ? r.from + 1 : r.from + insert.length - 9;
    const selLen = isUrl ? 9 : 8;
    v.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.range(selStart, selStart + selLen), userEvent: 'input' });
    v.focus();
    return true;
  },
  image: (v) => {
    const r = v.state.selection.main;
    if (onUrlPlaceholder(v)) return (v.focus(), true);
    const alt = v.state.sliceDoc(r.from, r.to) || 'alt text';
    const insert = `![${alt}](https://)`;
    const start = r.from + insert.length - 9;
    v.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.range(start, start + 8), userEvent: 'input' });
    v.focus();
    return true;
  },
  codeBlock: (v) => {
    const r = v.state.selection.main;
    const line = v.state.doc.lineAt(r.from);
    // A selection on a fence line (like the "js" just inserted) is not code to fence: add a new block.
    const onFence = r.to <= line.to && /^\s*```/.test(line.text);
    return r.empty || onFence ? insertBlock(v, '```js\n\n```', 3, 2) : fenceLines(v);
  },
  table: (v) => insertBlock(v, '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |', 2, 8),
  hr: (v) => insertBlock(v, '---'),
  /** Opens a file chooser and uploads the images at the cursor (only when the editor has uploadImage). */
  uploadImage: (v) => (uploaders.get(v)?.() ?? false),
};

// ---- Editor factory -----------------------------------------------------

export function createEditor(parent, { onChange, onSave, onScroll, onCursor, onCycleView, uploadImage, onUploadError }) {
  // Line numbers live in a compartment; the setting is kept here so load() can restore it.
  const lineNumbersCompartment = new Compartment();
  let showLineNumbers = false;
  const gutter = () => (showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []);

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: '', extensions: [] }),
  });

  const upload = { uploadImage, onUploadError };
  /** Lets the user choose images and uploads them at the cursor; false without uploadImage. */
  function pickImage() {
    if (!uploadImage) return false;
    const input = document.createElement('input');
    Object.assign(input, { type: 'file', accept: IMAGE_TYPES.join(','), multiple: true });
    input.style.display = 'none';
    const done = () => input.remove();
    input.addEventListener('change', () => {
      done();
      const files = imageFiles(input.files);
      const r = view.state.selection.main;
      if (files.length) insertImages(view, files, r.from, r.to, upload, 'input');
    });
    input.addEventListener('cancel', done);
    document.body.append(input);
    input.click();
    return true;
  }
  uploaders.set(view, pickImage);

  const extensions = [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    // pasteURLAsLink: pasting a URL over selected text makes "[text](url)".
    markdown({ base: markdownLanguage, codeLanguages: languages, pasteURLAsLink: true }),
    syntaxHighlighting(markdownHighlight),
    baseTheme,
    placeholder('Start writing Markdown…'),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor', spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
    keymap.of([
      // Handled here (before defaultKeymap's Mod-/ comment toggle) and kept from the page's own shortcut handler.
      { key: 'Mod-s', run: () => (onSave?.(), true), preventDefault: true, stopPropagation: true },
      { key: 'Mod-/', run: () => (onCycleView?.(), true), preventDefault: true, stopPropagation: true },
      { key: 'Mod-b', run: commands.bold },
      { key: 'Mod-i', run: commands.italic },
      { key: 'Mod-Shift-x', run: commands.strike },
      { key: 'Mod-e', run: commands.code },
      { key: 'Mod-k', run: commands.link },
      { key: 'Mod-Shift-k', run: commands.codeBlock },
      { key: 'Mod-Alt-1', run: commands.heading(1) },
      { key: 'Mod-Alt-2', run: commands.heading(2) },
      { key: 'Mod-Alt-3', run: commands.heading(3) },
      { key: 'Mod-Shift-7', run: commands.ol },
      { key: 'Mod-Shift-8', run: commands.ul },
      { key: 'Mod-Shift-9', run: commands.task },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((tr) => tr.annotation(externalLoad))) onChange?.(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) {
        const pos = u.state.selection.main.head;
        const line = u.state.doc.lineAt(pos);
        onCursor?.({ line: line.number, col: pos - line.from + 1, selected: u.state.selection.main.to - u.state.selection.main.from });
      }
    }),
    EditorView.domEventHandlers({
      scroll: () => onScroll?.(),
      // Pasted or dropped images are uploaded; anything else is left to CodeMirror.
      paste: (e, v) => {
        const files = uploadImage ? imageFiles(e.clipboardData?.files) : [];
        if (!files.length) return false;
        // Office apps put a picture of copied text next to the text: paste the text then.
        const text = e.clipboardData.getData('text/plain').trim();
        if (text && !files.some((f) => text.includes(f.name))) return false;
        const r = v.state.selection.main;
        insertImages(v, files, r.from, r.to, upload, 'input.paste');
        return true;
      },
      drop: (e, v) => {
        const files = uploadImage ? imageFiles(e.dataTransfer?.files) : [];
        if (!files.length) return false;
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
        insertImages(v, files, pos, pos, upload, 'input.drop');
        return true;
      },
    }),
  ];

  // Distance from the top of the scroll container's content to the document start.
  const docOffset = () => view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;

  const newState = (doc) => EditorState.create({ doc, extensions: [lineNumbersCompartment.of(gutter()), extensions] });
  view.setState(newState(''));

  return {
    view,
    /** Replaces the whole document (new undo history), without firing onChange. */
    load(text) {
      view.setState(newState(text));
    },
    /** Replaces content but keeps undo history (e.g. restoring a revision). */
    replace(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: externalLoad.of(true) });
    },
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    run: (cmd) => cmd(view),
    pickImage,
    setLineNumbers(on) {
      showLineNumbers = !!on;
      view.dispatch({ effects: lineNumbersCompartment.reconfigure(gutter()) });
    },
    /** 1-based line number at the top of the visible area (fractional). */
    topLine() {
      const scroller = view.scrollDOM;
      const height = Math.max(0, scroller.scrollTop - docOffset());
      const block = view.lineBlockAtHeight(height);
      const frac = block.height ? (height - block.top) / block.height : 0;
      return view.state.doc.lineAt(block.from).number + Math.min(Math.max(frac, 0), 0.999);
    },
    scrollToLine(lineNo, { select = false } = {}) {
      const n = Math.min(Math.max(1, Math.floor(lineNo)), view.state.doc.lines);
      const line = view.state.doc.line(n);
      if (select) {
        view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) });
        view.focus();
        return;
      }
      const block = view.lineBlockAt(line.from);
      view.scrollDOM.scrollTop = docOffset() + block.top + block.height * (lineNo - Math.floor(lineNo));
    },
    /** Flips "[ ]"/"[x]" on a task item line (also inside blockquotes); false if the line is not a task. */
    toggleTaskAtLine(lineNo) {
      if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > view.state.doc.lines) return false;
      const line = view.state.doc.line(lineNo);
      const m = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\](?=\s)/.exec(line.text);
      if (!m) return false;
      const pos = line.from + m[1].length;
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: m[2] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
      return true;
    },
  };
}
