// A read-only shared document: /s/<token>. The token is the only key; the database
// function returns that one document, never anything else.
import 'katex/dist/katex.min.css';
import { supabase } from './supabase.js';
import { renderMarkdown } from './preview.js';
import { renderDiagrams } from './render/mermaid.js';
import { h } from './ui.js';

const article = document.getElementById('doc');
const foot = document.getElementById('foot');
const token = location.pathname.split('/').filter(Boolean)[1] ?? location.hash.slice(1);
const dark = matchMedia('(prefers-color-scheme: dark)').matches;

function show(message) {
  article.replaceChildren(h('h1', {}, 'Not available'), h('p', {}, message), h('p', {}, h('a', { href: '/' }, 'Go to Hashlite')));
}

async function load() {
  if (!/^[\w-]{22}$/.test(token ?? '')) return show('This link is not valid.');
  const { data, error } = await supabase.rpc('get_shared_document', { p_token: token });
  if (error) return show(error.status === 0 ? 'You appear to be offline.' : 'This document could not be loaded.');
  const doc = data?.[0];
  if (!doc) return show('This link is not shared (any more).');
  document.title = `${doc.title} – Hashlite`;
  article.innerHTML = renderMarkdown(doc.content);
  // Read-only: checkboxes can't be ticked here.
  for (const box of article.querySelectorAll('input[type="checkbox"]')) box.disabled = true;
  renderDiagrams(article, dark ? 'dark' : 'default');
  foot.replaceChildren(`Last updated ${doc.updated_at.slice(0, 10)} · Written with `, h('a', { href: '/' }, 'Hashlite'), ', a free online Markdown editor.');
  foot.hidden = false;
}

load();
