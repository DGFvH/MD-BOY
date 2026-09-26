// The OAuth consent page (/oauth/authorize): an app such as Claude asks to use the connector
// for the signed-in user's documents. Checks the request, asks the user to sign in and to
// allow or deny, then sends them back to the app with a one-time code (PKCE required).
import './markdown.css';
import './styles.css';
import { api } from './api.js';
import { h } from './ui.js';
import { applyTheme } from './theme.js';
import { APP_NAME } from './brand.js';

applyTheme();
const root = document.getElementById('app');
const q = new URLSearchParams(location.search);
const req = {
  responseType: q.get('response_type'),
  clientId: q.get('client_id') ?? '',
  redirectUri: q.get('redirect_uri') ?? '',
  state: q.get('state'),
  challenge: q.get('code_challenge'),
  method: q.get('code_challenge_method'),
};

function card(title, ...children) {
  root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), APP_NAME),
    h('h1', {}, title),
    ...children)));
}

// Back to the app, with the result in the query (RFC 6749 §4.1.2, RFC 9207 iss).
function returnToApp(params) {
  const url = new URL(req.redirectUri);
  for (const [k, v] of Object.entries({ ...params, state: req.state, iss: location.origin })) {
    if (v != null) url.searchParams.set(k, v);
  }
  location.replace(url.href);
}

function showSignIn(appName) {
  const email = h('input', { type: 'email', id: 'auth-email', autocomplete: 'email', required: true });
  const password = h('input', { type: 'password', id: 'auth-password', autocomplete: 'current-password', required: true });
  const error = h('div', { class: 'auth-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Sign in');
  card('Sign in to continue',
    h('p', { class: 'muted auth-intro' }, h('strong', {}, appName), ' wants to connect to your Hashlite documents.'),
    h('form', {
      class: 'stack',
      onSubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        submit.disabled = true;
        try {
          await api.login(email.value, password.value);
          showConsent(appName);
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    h('div', { class: 'stack', style: 'gap:6px' }, h('label', { for: 'auth-email' }, 'Email'), email),
    h('div', { class: 'stack', style: 'gap:6px' }, h('label', { for: 'auth-password' }, 'Password'), password),
    error, submit),
    h('div', { class: 'auth-switch' }, 'No account yet? ', h('a', { href: '/app', target: '_blank', rel: 'noopener' }, 'Create one'), ', then come back here.'),
    h('div', { class: 'auth-switch' }, h('button', { type: 'button', class: 'link-btn', onClick: () => returnToApp({ error: 'access_denied' }) }, 'Cancel')));
  email.focus();
}

async function showConsent(appName) {
  const user = await api.sessionUser();
  const error = h('div', { class: 'auth-error', role: 'alert' });
  const allow = h('button', {
    type: 'button', class: 'btn btn-primary btn-block',
    onClick: async () => {
      allow.disabled = deny.disabled = true;
      try {
        returnToApp({ code: await api.oauthCreateCode(req.clientId, req.redirectUri, req.challenge) });
      } catch (err) {
        error.textContent = err.message;
        allow.disabled = deny.disabled = false;
      }
    },
  }, 'Allow');
  const deny = h('button', { type: 'button', class: 'btn btn-block', onClick: () => returnToApp({ error: 'access_denied' }) }, 'Deny');
  card(`Connect ${appName}?`,
    h('p', {}, h('strong', {}, appName), ' wants to use your Hashlite documents. It will be able to:'),
    h('ul', { class: 'consent-list' },
      h('li', {}, 'search, list and read your documents'),
      h('li', {}, 'create documents, and change them (earlier versions stay in each document’s history)'),
      h('li', {}, 'create read-only share links, when you ask it to')),
    h('p', { class: 'muted' }, 'You’ll return to ', h('strong', {}, new URL(req.redirectUri).host),
      '. You can disconnect at any time under Account › Connected apps.'),
    h('p', { class: 'muted' }, 'Signed in as ', h('strong', {}, user?.email ?? ''), '. ',
      h('button', { type: 'button', class: 'link-btn', onClick: async () => { await api.logout().catch(() => {}); showSignIn(appName); } }, 'Not you?')),
    error,
    h('div', { class: 'stack' }, allow, deny));
  allow.focus();
}

async function start() {
  // Without a valid client and redirect address there is nowhere safe to send an error.
  let appName;
  try {
    if (!req.clientId || !req.redirectUri) throw new Error('The link is incomplete.');
    appName = await api.oauthClientInfo(req.clientId, req.redirectUri);
  } catch (err) {
    card('This link doesn’t work', h('p', { class: 'muted' }, err.message, ' Start connecting again from the app you came from.'));
    return;
  }
  if (req.responseType !== 'code') return returnToApp({ error: 'unsupported_response_type' });
  if (!/^[A-Za-z0-9_-]{43}$/.test(req.challenge ?? '') || req.method !== 'S256') {
    return returnToApp({ error: 'invalid_request', error_description: 'PKCE with S256 is required.' });
  }
  if (await api.sessionUser()) showConsent(appName);
  else showSignIn(appName);
}

start();
