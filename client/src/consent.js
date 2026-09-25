// The cookie banner. With analytics configured (VITE_GA_ID), it asks before any analytics
// cookie is set: Google Analytics loads only after "Allow". Without analytics, it is a
// one-time notice that Hashlite only stores what it needs.
import './consent.css';
import { GA_ID, loadAnalytics, stopAnalytics } from './analytics.js';

const CONSENT_KEY = 'hashlite:consent'; // 'granted' | 'denied'
const NOTICE_KEY = 'hashlite:notice'; // the notice was seen (no analytics configured)

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Can't remember it: the banner comes back next visit.
  }
}

function button(label, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function banner(message, buttons) {
  document.querySelector('.cookie-notice')?.remove();
  const box = document.createElement('div');
  box.className = 'cookie-notice';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Cookies and storage');
  const text = document.createElement('p');
  const link = document.createElement('a');
  link.href = '/privacy#cookies';
  link.textContent = 'Privacy';
  text.append(message, link);
  const actions = document.createElement('div');
  actions.className = 'cookie-actions';
  actions.append(...buttons(() => box.remove()));
  box.append(text, actions);
  document.body.append(box);
}

function askConsent() {
  banner('Can Hashlite use analytics cookies (Google Analytics) to see how the site is used? Your documents are never included. ', (close) => [
    button('Decline', 'cookie-btn', () => {
      write(CONSENT_KEY, 'denied');
      close();
      stopAnalytics(); // withdrawing an earlier "Allow"
    }),
    button('Allow', 'cookie-btn cookie-ok', () => {
      write(CONSENT_KEY, 'granted');
      close();
      loadAnalytics();
    }),
  ]);
}

/** Shows the banner if needed, and loads analytics when it was allowed before. */
export function showStorageNotice() {
  if (GA_ID) {
    const choice = read(CONSENT_KEY);
    if (choice === 'granted') loadAnalytics();
    else if (choice !== 'denied') askConsent();
    return;
  }
  if (read(NOTICE_KEY) === '1') return;
  banner('No tracking cookies here. Hashlite only stores what it needs in your browser to keep you signed in and save your work. ', (close) => [
    button('OK', 'cookie-btn cookie-ok', () => {
      write(NOTICE_KEY, '1');
      close();
    }),
  ]);
}

/** "Cookie settings": asks the question again. */
export function openCookieSettings() {
  if (GA_ID) askConsent();
}

// Any element with data-cookie-settings opens the question again (the footer, the privacy
// page). Without analytics there is nothing to ask, so they are hidden.
if (!GA_ID) {
  for (const el of document.querySelectorAll('[data-cookie-settings]')) (el.closest('li, p') ?? el).hidden = true;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest?.('[data-cookie-settings]')) return;
  e.preventDefault();
  openCookieSettings();
});
