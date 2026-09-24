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
  { tag: t.heading1, fontWeight: '700', fontSize: '1.3em', color: 'var(--md-heading)' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.15em', color: 'var(--md-heading)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--md-heading)' },
  { tag: t.strong, fontWeight: '700' },
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
  '.cm-panel input, .cm-panel button': { font: 'inherit', fontSize: '13px' },
  '.cm-placeholder': { color: 'var(--text-faint)' },
});

// ---- Formatting commands ------------------------------------------------

function wrap(view, before, after = before, placeholderText = 'text') {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    const outerBefore = view.state.sliceDoc(range.from - before.length, range.from);
    const outerAfter = view.state.sliceDoc(range.to, range.to + after.length);
    // Toggle off when the selection is already wrapped.
    if (outerBefore === before && outerAfter === after) {
      return {
        changes: [
          { from: range.from - before.length, to: range.from, insert: '' },
          { from: range.to, to: range.to + after.length, insert: '' },
        ],
        range: EditorSelection.range(range.from - before.length, range.to - before.length),
      };
    }
    const inner = text || placeholderText;
    return {
      changes: { from: range.from, to: range.to, insert: before + inner + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + inner.length),
    };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
  view.focus();
  return true;
}

function selectedLines(state) {
  const lines = new Set();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) lines.add(n);
  }
  return [...lines].map((n) => state.doc.line(n));
}

const LINE_PREFIX_RE = /^(\s*)(#{1,6}\s|>\s?|[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s)?/;

/** Sets (or toggles off) a block prefix such as "## ", "> ", "- " on every selected line. */
function setLinePrefix(view, makePrefix) {
  const lines = selectedLines(view.state);
  const first = makePrefix(0);
  const prefixOf = (line) => LINE_PREFIX_RE.exec(line.text)[2] ?? '';
  const allHave = lines.every((l) => prefixOf(l) && sameKind(prefixOf(l), first));
  const changes = lines.map((line, i) => {
    const m = LINE_PREFIX_RE.exec(line.text);
    const indent = m[1];
    const existing = m[2] ?? '';
    const from = line.from + indent.length;
    const insert = allHave ? '' : makePrefix(i);
    return { from, to: from + existing.length, insert };
  });
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

function sameKind(a, b) {
  const kind = (p) => (/^\d/.test(p) ? 'ol' : p.includes('[') ? 'task' : p.trim());
  return kind(a) === kind(b);
}

function insertBlock(view, text, selectOffset = null, selectLength = 0) {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const needsLeadingNewline = line.text.trim().length > 0;
  const prefix = needsLeadingNewline ? (range.from === line.to ? '\n\n' : '\n') : '';
  const insert = prefix + text + '\n';
  const at = needsLeadingNewline && range.from !== line.to ? line.to : range.from;
  const anchor = at + prefix.length + (selectOffset ?? text.length);
  view.dispatch({
    changes: { from: at, to: needsLeadingNewline ? at : range.to, insert },
    selection: EditorSelection.range(anchor, anchor + selectLength),
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
}

export const commands = {
  bold: (v) => wrap(v, '**', '**', 'bold text'),
  italic: (v) => wrap(v, '*', '*', 'italic text'),
  strike: (v) => wrap(v, '~~', '~~', 'text'),
  code: (v) => wrap(v, '`', '`', 'code'),
  math: (v) => wrap(v, '$', '$', 'E = mc^2'),
  heading: (level) => (v) => setLinePrefix(v, () => '#'.repeat(level) + ' '),
  cycleHeading: (v) => {
    const line = v.state.doc.lineAt(v.state.selection.main.from);
    const current = /^(#{1,6})\s/.exec(line.text)?.[1].length ?? 0;
    const next = current >= 3 ? 0 : current + 1;
    const existing = /^#{1,6}\s/.exec(line.text)?.[0] ?? '';
    v.dispatch({ changes: { from: line.from, to: line.from + existing.length, insert: next ? '#'.repeat(next) + ' ' : '' }, userEvent: 'input' });
    v.focus();
    return true;
  },
  quote: (v) => setLinePrefix(v, () => '> '),
  ul: (v) => setLinePrefix(v, () => '- '),
  ol: (v) => setLinePrefix(v, (i) => `${i + 1}. `),
  task: (v) => setLinePrefix(v, () => '- [ ] '),
  link: (v) => {
    const r = v.state.selection.main;
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
    const alt = v.state.sliceDoc(r.from, r.to) || 'alt text';
    const insert = `![${alt}](https://)`;
    const start = r.from + insert.length - 9;
    v.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.range(start, start + 8), userEvent: 'input' });
    v.focus();
    return true;
  },
  codeBlock: (v) => {
    const r = v.state.selection.main;
    const text = v.state.sliceDoc(r.from, r.to);
    if (text) return wrap(v, '```\n', '\n```');
    return insertBlock(v, '```js\n\n```', 3, 2);
  },
  table: (v) => insertBlock(v, '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |', 2, 8),
  hr: (v) => insertBlock(v, '---'),
};

// ---- Editor factory -----------------------------------------------------

export function createEditor(parent, { onChange, onSave, onScroll, onCursor }) {
  const lineNumbersCompartment = new Compartment();

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: '', extensions: [] }),
  });

  const extensions = [
    lineNumbersCompartment.of([]),
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
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(markdownHighlight),
    baseTheme,
    placeholder('Start writing Markdown…'),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor', spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
    keymap.of([
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
      { key: 'Mod-s', run: () => (onSave?.(), true), preventDefault: true },
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
    }),
  ];

  // Distance from the top of the scroll container's content to the document start.
  const docOffset = () => view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;

  const newState = (doc) => EditorState.create({ doc, extensions });
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
    setLineNumbers(on) {
      view.dispatch({ effects: lineNumbersCompartment.reconfigure(on ? [lineNumbers(), highlightActiveLineGutter()] : []) });
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
    toggleTaskAtLine(lineNo) {
      const line = view.state.doc.line(lineNo);
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(line.text);
      if (!m) return false;
      const pos = line.from + m[1].length;
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: m[2] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
      return true;
    },
  };
}
