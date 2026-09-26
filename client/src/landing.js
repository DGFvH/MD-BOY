// The home page and the tool pages: the editor, a table tool where the page has one, and the
// account link in the header.
import { mountHomeEditor } from './home-editor.js';

const root = document.getElementById('try');
const api = root ? mountHomeEditor(root) : null;

const tool = document.querySelector('.table-tool');
if (api && tool) import('./table-tool.js').then(({ mountTableTool }) => mountTableTool(tool, api));

// Signed in on this browser (the session supabase-js keeps): the header links to the documents.
try {
  const nav = document.getElementById('nav-account');
  if (nav && localStorage.getItem('hashlite:auth')) nav.textContent = 'My documents';
} catch {
  // Storage blocked: keep "Sign in".
}
