// Account dialog: change password, download every document, delete the account.
import { api } from '../api.js';
import { h, icons, modal, toast } from '../ui.js';

function section(title, ...children) {
  return h('section', { class: 'stack', style: 'gap:8px;padding-top:14px;border-top:1px solid var(--border)' },
    h('h3', { style: 'margin:0;font-size:14px' }, title), ...children);
}

function passwordField(label, autocomplete, extra = {}) {
  return h('input', { type: 'password', required: true, autocomplete, 'aria-label': label, placeholder: label, ...extra });
}

/**
 * Opens the account dialog. beforeExport() runs before the download starts (to save
 * the open document); onDeleted() runs after the account was deleted.
 */
export function showAccount({ user, beforeExport, onDeleted }) {
  return modal({
    title: 'Account',
    render: (close) => {
      // Change password
      const current = passwordField('Current password', 'current-password', { autofocus: true });
      const next = passwordField('New password (at least 8 characters)', 'new-password', { minlength: '8' });
      const pwError = h('div', { class: 'auth-error', role: 'alert' });
      const pwSubmit = h('button', { type: 'submit', class: 'btn' }, 'Change password');
      const pwForm = h('form', {
        class: 'stack',
        style: 'gap:8px',
        onSubmit: async (e) => {
          e.preventDefault();
          pwError.textContent = '';
          pwSubmit.disabled = true;
          try {
            await api.changePassword(current.value, next.value);
            current.value = next.value = '';
            toast('Password changed. Other devices were signed out.');
          } catch (err) {
            pwError.textContent = err.message;
            current.focus();
          } finally {
            pwSubmit.disabled = false;
          }
        },
      },
      // Lets password managers know which account the new password belongs to.
      h('input', { type: 'text', autocomplete: 'username', value: user?.email ?? '', hidden: true, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }),
      current, next, pwError,
      h('div', {}, pwSubmit));

      // Download everything
      const exportBtn = h('button', {
        type: 'button',
        class: 'btn',
        html: `${icons.download}<span>Download all documents (.zip)</span>`,
        onClick: async () => {
          exportBtn.disabled = true;
          try {
            await beforeExport?.();
          } catch {
            // Export what the server has.
          }
          exportBtn.disabled = false;
          // A link with `download` does not unload the page or trigger the leave prompt.
          const a = h('a', { href: api.exportUrl, download: 'hashmark-export.zip', hidden: true });
          document.body.append(a);
          a.click();
          a.remove();
        },
      });

      // Delete the account
      const delPassword = passwordField('Your password', 'current-password');
      const delError = h('div', { class: 'auth-error', role: 'alert' });
      const delSubmit = h('button', { type: 'submit', class: 'btn btn-danger' }, 'Delete my account');
      const delForm = h('form', {
        class: 'stack',
        style: 'gap:8px',
        onSubmit: async (e) => {
          e.preventDefault();
          delError.textContent = '';
          delSubmit.disabled = true;
          try {
            await api.deleteAccount(delPassword.value);
            close(true);
            onDeleted?.();
          } catch (err) {
            delError.textContent = err.message;
            delSubmit.disabled = false;
            delPassword.focus();
          }
        },
      },
      h('p', { class: 'muted' }, 'This permanently deletes your account, all documents, folders and history. It cannot be undone. Type your password to confirm.'),
      delPassword, delError,
      h('div', {}, delSubmit));

      return h('div', { class: 'stack', style: 'gap:14px' },
        h('p', { class: 'muted' }, 'Signed in as ', h('strong', {}, user?.email ?? '')),
        section('Change password', pwForm),
        section('Your documents',
          h('p', { class: 'muted' }, 'Get every document as a Markdown file, in folders like in the sidebar.'),
          h('div', {}, exportBtn)),
        section('Delete account', delForm));
    },
  });
}
