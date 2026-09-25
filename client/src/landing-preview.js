// Loaded on demand by landing.js.
import 'katex/dist/katex.min.css';
import { renderMarkdown } from './preview.js';
import { renderDiagrams } from './render/mermaid.js';

export function renderInto(el, text, dark) {
  el.innerHTML = text.trim() ? renderMarkdown(text) : '<p class="preview-empty">Nothing to preview yet.</p>';
  // Ticking a box in the preview would not change the text here, so keep them read-only.
  for (const box of el.querySelectorAll('input[type="checkbox"]')) box.disabled = true;
  if (el.querySelector('.mermaid-block')) renderDiagrams(el, dark ? 'dark' : 'default');
}
