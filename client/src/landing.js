// The home page: its editor, and the account link in the header.
import { mountHomeEditor } from './home-editor.js';

const root = document.getElementById('try');
if (root) mountHomeEditor(root);

// Signed in on this browser (the session supabase-js keeps): the header links to the documents.
try {
  if (localStorage.getItem('hashlite:auth')) document.getElementById('nav-account').textContent = 'My documents';
} catch {
  // Storage blocked: keep "Sign in".
}
