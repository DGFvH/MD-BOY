// A one-time notice about browser storage. Hashlite has no tracking or analytics; it only
// stores what is strictly needed (the sign-in session, drafts, preferences), so this informs
// rather than asks.
import './consent.css';

const KEY = 'hashlite:notice';

function seen() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function showStorageNotice() {
  if (seen() || document.querySelector('.cookie-notice')) return;
  const box = document.createElement('div');
  box.className = 'cookie-notice';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Cookies and storage');

  const text = document.createElement('p');
  text.append('No tracking cookies here. Hashlite only stores what it needs in your browser to keep you signed in and save your work. ');
  const link = document.createElement('a');
  link.href = '/privacy#cookies';
  link.textContent = 'Privacy';
  text.append(link);

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'cookie-ok';
  ok.textContent = 'OK';
  ok.addEventListener('click', () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Can't remember it: the notice comes back next visit.
    }
    box.remove();
  });

  box.append(text, ok);
  document.body.append(box);
}
