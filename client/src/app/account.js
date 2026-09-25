// Account dialog: change password, download every document, delete the account.
import { api } from '../api.js';
import { h, icons, modal, toast, downloadFile } from '../ui.js';

function section(title, ...children) {
  return h('section', { class: 'modal-section' }, h('h3', {}, title), ...children);
}

/** A password input with a visible label; `hint` is shown under it. */
function passwordField(id, label, autocomplete, { hint, ...extra } = {}) {
  const input = h('input', {
    type: 'password', id, required: true, autocomplete, 'aria-describedby': hint ? `${id}-hint` : null, ...extra,
  });
  const row = h('div', { class: 'form-row' },
    h('label', { for: id }, label),
    input,
    hint && h('small', { class: 'muted', id: `${id}-hint` }, hint));
  return { input, row };
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
      const current = passwordField('acc-current', 'Current password', 'current-password', { autofocus: true });
      const next = passwordField('acc-new', 'New password', 'new-password', { minlength: '8', hint: 'At least 8 characters.' });
      const pwError = h('div', { class: 'auth-error', role: 'alert' });
      const pwSubmit = h('button', { type: 'submit', class: 'btn' }, 'Change password');
      const pwForm = h('form', {
        class: 'stack',
        onSubmit: async (e) => {
          e.preventDefault();
          pwError.textContent = '';
          pwSubmit.disabled = true;
          try {
            await api.changePassword(current.input.value, next.input.value);
            current.input.value = next.input.value = '';
            toast('Password changed. Other devices were signed out.');
          } catch (err) {
            pwError.textContent = err.message;
            current.input.focus();
          } finally {
            pwSubmit.disabled = false;
          }
        },
      },
      // Lets password managers know which account the new password belongs to.
      h('input', { type: 'text', autocomplete: 'username', value: user?.email ?? '', hidden: true, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }),
      current.row, next.row, pwError,
      h('div', { class: 'form-actions' }, pwSubmit));

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
          try {
            downloadFile('hashlite-export.zip', await api.exportZip(), 'application/zip');
          } catch (err) {
            toast(err.message, { type: 'error' });
          } finally {
            exportBtn.disabled = false;
          }
        },
      });

      // Delete the account
      const delPassword = passwordField('acc-delete', 'Your password', 'current-password');
      const delError = h('div', { class: 'auth-error', role: 'alert' });
      const delSubmit = h('button', { type: 'submit', class: 'btn btn-danger' }, 'Delete my account');
      const delForm = h('form', {
        class: 'stack',
        onSubmit: async (e) => {
          e.preventDefault();
          delError.textContent = '';
          delSubmit.disabled = true;
          try {
            await api.deleteAccount(delPassword.input.value);
            close(true);
            onDeleted?.();
          } catch (err) {
            delError.textContent = err.message;
            delSubmit.disabled = false;
            delPassword.input.focus();
          }
        },
      },
      h('p', { class: 'muted' }, 'This permanently deletes your account, all documents, folders and history. It cannot be undone. Type your password to confirm.'),
      delPassword.row, delError,
      h('div', { class: 'form-actions' }, delSubmit));

      return h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'Signed in as ', h('strong', {}, user?.email ?? '')),
        section('Change password', pwForm),
        section('Your documents',
          h('p', { class: 'muted' }, 'Get every document as a Markdown file, in folders like in the sidebar.'),
          h('div', { class: 'form-actions' }, exportBtn)),
        h('section', { class: 'modal-section danger-zone' }, h('h3', {}, 'Delete account'), delForm));
    },
  });
}
