// The table tools on /csv-to-markdown-table and /markdown-table-generator.
// csv mode: paste CSV, TSV or cells copied from a spreadsheet; grid mode: type into a grid.
// Either way the Markdown table goes into the editor below, with its preview.
import { h } from './ui.js';
import { parseDelimited, toMarkdownTable } from './table-md.js';

// ---- UI ---------------------------------------------------------------------

function options(onChange) {
  const header = h('input', { type: 'checkbox', id: 'tt-header', checked: true, onChange });
  const align = h('select', { id: 'tt-align', 'aria-label': 'Column alignment', onChange },
    h('option', { value: 'none' }, 'Default alignment'),
    h('option', { value: 'left' }, 'Align left'),
    h('option', { value: 'center' }, 'Align center'),
    h('option', { value: 'right' }, 'Align right'));
  const el = h('div', { class: 'tt-options' }, h('label', {}, header, ' First row is the header'), align);
  return { el, get: () => ({ header: header.checked, align: align.value }) };
}

function mountCsv(panel, api) {
  const input = panel.querySelector('textarea') ?? h('textarea');
  input.id ||= 'tt-input';
  const status = h('p', { class: 'tt-status', role: 'status' });
  const opts = options(() => convert());
  function convert() {
    if (!input.value.trim()) {
      status.textContent = '';
      return;
    }
    const rows = parseDelimited(input.value);
    const md = toMarkdownTable(rows, opts.get());
    if (!md) return;
    api.setText(`${md}\n`);
    const cols = Math.max(...rows.map((r) => r.length));
    status.textContent = `${rows.length} rows × ${cols} columns converted.`;
  }
  input.addEventListener('input', convert);
  panel.replaceChildren(
    h('label', { for: input.id, class: 'tt-label' }, 'Paste CSV, TSV or cells from Excel / Google Sheets'),
    input, h('div', { class: 'tt-row' }, opts.el, status));
  panel.classList.add('ready');
}

function mountGrid(panel, api) {
  let data = [['Name', 'Role', 'Since'], ['Ada', 'Engineer', '2021'], ['Grace', 'Admiral', '2019']];
  const table = h('table', { class: 'tt-grid' });
  const opts = options(() => emit());

  function emit() {
    api.setText(`${toMarkdownTable(data, opts.get())}\n`);
  }

  function render(focus) {
    table.replaceChildren(...data.map((row, r) => h('tr', {}, row.map((value, c) => h('td', {},
      h('input', {
        type: 'text', value, 'aria-label': `Row ${r + 1}, column ${c + 1}`, dataset: { r, c },
        onInput: (e) => {
          data[r][c] = e.target.value;
          emit();
        },
        // Cells copied from a spreadsheet fill the grid from this cell on.
        onPaste: (e) => {
          const text = e.clipboardData.getData('text/plain');
          if (!/[\t\n]/.test(text.trim())) return;
          e.preventDefault();
          const rows = parseDelimited(text, '\t');
          rows.forEach((cells, i) => cells.forEach((cell, j) => {
            while (data.length <= r + i) data.push(Array(data[0].length).fill(''));
            if (c + j >= data[0].length) data = data.map((d) => [...d, ...Array(c + j + 1 - d.length).fill('')]);
            data[r + i][c + j] = cell;
          }));
          render();
          emit();
        },
      }))))));
    if (focus) table.querySelector(`input[data-r="${focus[0]}"][data-c="${focus[1]}"]`)?.focus();
  }

  const cols = () => data[0].length;
  const btn = (label, fn) => h('button', { type: 'button', class: 'tt-btn', onClick: fn }, label);
  const controls = h('div', { class: 'tt-controls' },
    btn('+ Row', () => { data.push(Array(cols()).fill('')); render([data.length - 1, 0]); emit(); }),
    btn('+ Column', () => { data = data.map((r) => [...r, '']); render([0, cols() - 1]); emit(); }),
    btn('− Row', () => { if (data.length > 1) { data.pop(); render(); emit(); } }),
    btn('− Column', () => { if (cols() > 1) { data = data.map((r) => r.slice(0, -1)); render(); emit(); } }),
    btn('Clear', () => { data = data.map((r) => r.map(() => '')); render([0, 0]); emit(); }));

  render();
  panel.replaceChildren(
    h('p', { class: 'tt-label' }, 'Type in the grid, or paste cells from a spreadsheet. The Markdown appears below.'),
    h('div', { class: 'tt-grid-wrap' }, table),
    h('div', { class: 'tt-row' }, controls, opts.el));
  panel.classList.add('ready');
}

export function mountTableTool(panel, api) {
  if (panel.dataset.mode === 'grid') mountGrid(panel, api);
  else mountCsv(panel, api);
}
