// Sign-in / sign-up screen.
import { api } from '../api.js';
import { h, modal, toast } from '../ui.js';
import { getPrefs, setPref } from '../storage.js';
import { APP_NAME } from '../brand.js';

let configPromise = null;
let screenSeq = 0;

// Server settings ({ registration }), fetched once; a failed fetch is retried next time.
function loadConfig() {
  configPromise ??= api.config().catch(() => {
    configPromise = null;
    return null;
  });
  return configPromise;
}

/**
 * Shows the auth screen in `root`. mode is 'login' or 'register'; without one,
 * first-time visitors get the sign-up form. onSignedIn(user, { isNew }) runs
 * after a successful sign-in or sign-up.
 */
export async function showAuth(root, { mode, notice = '', email: emailValue = '', onSignedIn }) {
  const seq = ++screenSeq;
  const config = await loadConfig();
  if (seq !== screenSeq) return; // a newer screen was requested meanwhile
  const registration = config?.registration !== false;
  if (!registration || !mode) mode = registration && !getPrefs().hasAccount ? 'register' : 'login';
  const isLogin = mode === 'login';
  const again = (next) => showAuth(root, { mode: next, email: email.value, onSignedIn });

  const error = h('div', { class: 'auth-error', role: 'alert' }, notice);
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, id: 'auth-email', value: emailValue });
  const password = h('input', {
    type: 'password', name: 'password', required: true, minlength: '8', id: 'auth-password',
    autocomplete: isLogin ? 'current-password' : 'new-password',
    'aria-describedby': isLogin ? null : 'auth-password-hint',
  });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, isLogin ? 'Sign in' : 'Create account');

  const form = h('form', {
    class: 'stack',
    onSubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        const res = isLogin ? await api.login(email.value, password.value) : await api.register(email.value, password.value);
        setPref('hasAccount', true);
        if (res.confirm) return showCheckEmail(root, email.value, onSignedIn);
        await onSignedIn(res.user, { isNew: !isLogin });
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
        // Keep the keyboard where the fix is likely needed.
        const field = /email/i.test(err.message) && !/password/i.test(err.message) ? email : password;
        field.focus();
        field.select();
      }
    },
  },
  h('div', { class: 'stack', style: 'gap:6px' }, h('label', { for: 'auth-email' }, 'Email'), email),
  h('div', { class: 'stack', style: 'gap:6px' },
    h('label', { for: 'auth-password' }, 'Password'),
    password,
    !isLogin && h('small', { class: 'muted', id: 'auth-password-hint' }, 'At least 8 characters.')),
  error,
  submit);

  root.replaceChildren(
    h('div', { class: 'auth' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), APP_NAME),
        h('h1', {}, isLogin ? 'Welcome back' : 'Create your account'),
        form,
        isLogin && h('div', { class: 'auth-switch' },
          h('button', { type: 'button', class: 'link-btn', onClick: () => showForgot(root, email.value, onSignedIn) }, 'Forgot password?')),
        registration && h('div', { class: 'auth-switch' },
          isLogin ? 'New here? ' : 'Already have an account? ',
          h('button', { type: 'button', class: 'link-btn', onClick: () => again(isLogin ? 'register' : 'login') },
            isLogin ? 'Create an account' : 'Sign in')))),
  );
  (emailValue ? password : email).focus();
}

function card(root, title, ...children) {
  root.replaceChildren(
    h('div', { class: 'auth' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), APP_NAME),
        h('h1', {}, title),
        ...children)));
}

// After signing up: the account works once the email address is confirmed.
function showCheckEmail(root, email, onSignedIn) {
  card(root, 'Check your email',
    h('p', { class: 'muted' }, 'We sent a link to ', h('strong', {}, email), '. Open it to confirm your address, then sign in.'),
    h('div', { class: 'auth-switch' },
      h('button', { type: 'button', class: 'link-btn', onClick: () => showAuth(root, { mode: 'login', email, onSignedIn }) }, 'Back to sign in')));
}

function showForgot(root, emailValue, onSignedIn) {
  const email = h('input', { type: 'email', required: true, id: 'reset-email', autocomplete: 'email', value: emailValue });
  const error = h('div', { class: 'auth-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Send reset link');
  const back = () => showAuth(root, { mode: 'login', email: email.value, onSignedIn });
  card(root, 'Reset your password',
    h('form', {
      class: 'stack',
      onSubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        submit.disabled = true;
        try {
          await api.resetPassword(email.value);
          card(root, 'Check your email',
            h('p', { class: 'muted' }, 'If there is an account for ', h('strong', {}, email.value), ', we sent a link to choose a new password.'),
            h('div', { class: 'auth-switch' }, h('button', { type: 'button', class: 'link-btn', onClick: back }, 'Back to sign in')));
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    h('div', { class: 'stack', style: 'gap:6px' }, h('label', { for: 'reset-email' }, 'Email'), email),
    error,
    submit),
    h('div', { class: 'auth-switch' }, h('button', { type: 'button', class: 'link-btn', onClick: back }, 'Back to sign in')));
  email.focus();
}

/** Shown when someone opens the link from a "reset your password" email. */
export function showNewPassword() {
  return modal({
    title: 'Choose a new password',
    render: (close) => {
      const input = h('input', { type: 'password', id: 'new-password', required: true, minlength: '8', autocomplete: 'new-password', autofocus: true });
      const error = h('div', { class: 'auth-error', role: 'alert' });
      const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save password');
      return h('form', {
        class: 'stack',
        onSubmit: async (e) => {
          e.preventDefault();
          error.textContent = '';
          submit.disabled = true;
          try {
            await api.setNewPassword(input.value);
            close(true);
            toast('Your password was changed.');
          } catch (err) {
            error.textContent = err.message;
            submit.disabled = false;
          }
        },
      },
      h('div', { class: 'form-row' }, h('label', { for: 'new-password' }, 'New password'), input,
        h('small', { class: 'muted' }, 'At least 8 characters.')),
      error,
      h('div', { class: 'modal-actions' }, submit));
    },
  });
}
