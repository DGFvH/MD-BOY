import { test, expect } from '@playwright/test';

// A first visit opens the sign-up form.
async function register(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.fill('#auth-email', `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`);
  await page.fill('#auth-password', 'a-very-good-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

test('register, write Markdown, see preview, and persist', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await register(page);

  // The welcome document opens with a rendered preview.
  const preview = page.locator('.pane-preview .markdown-body');
  await expect(preview.locator('h1')).toHaveText('Welcome to Hashmark');
  await expect(preview.locator('table')).toBeVisible();
  await expect(preview.locator('.katex').first()).toBeVisible();
  await expect(preview.locator('.mermaid-block.rendered svg')).toBeVisible({ timeout: 15_000 });

  // Create a new document and type into it.
  await page.getByRole('button', { name: 'New doc' }).click();
  await expect(page.locator('.title-input')).toBeFocused();
  await page.keyboard.press('Enter'); // leave the title field
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('# Shopping list\n\n- [ ] Apples\n- [x] Bread\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n');

  await expect(preview.locator('h1')).toHaveText('Shopping list');
  await expect(preview.locator('input.task-list-item-checkbox')).toHaveCount(2);
  await expect(preview.locator('table td').first()).toHaveText('1');
  await expect(preview.locator('pre code .hljs-keyword')).toHaveText('const');
  // The first H1 becomes the title of an untitled document.
  await expect(page.locator('.title-input')).toHaveValue('Shopping list');

  // Tick a task in the preview; the source updates.
  await preview.locator('input.task-list-item-checkbox').first().click();
  await expect(editor).toContainText('- [x] Apples');

  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 5000 });
  await expect(page.locator('.tree-row', { hasText: 'Shopping list' })).toBeVisible();

  // Reload: the content is stored on the server.
  await page.reload();
  await expect(page.locator('.title-input')).toHaveValue('Shopping list');
  await expect(preview.locator('h1')).toHaveText('Shopping list');
  await expect(editor).toContainText('- [x] Apples');

  // Back returns to the previously opened document.
  await page.locator('.tree-row', { hasText: 'Welcome to Hashmark' }).click();
  await expect(page.locator('.title-input')).toHaveValue('Welcome to Hashmark');
  await page.goBack();
  await expect(page.locator('.title-input')).toHaveValue('Shopping list');

  // Search finds it.
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('apples');
  await expect(page.locator('.search-result strong')).toHaveText('Shopping list');

  expect(errors).toEqual([]);
});

test('a document moved to the trash can be restored', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await register(page);

  await page.getByRole('button', { name: 'New doc' }).click();
  await expect(page.locator('.title-input')).toBeFocused();
  await page.keyboard.type('Keep me');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Some text worth keeping.');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 5000 });

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  const row = page.locator('.tree-row', { hasText: 'Keep me' });
  await expect(row).toHaveCount(0);

  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const item = page.locator('.trash-item', { hasText: 'Keep me' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Restore' }).click();
  await expect(item).toHaveCount(0);
  await expect(row).toBeVisible();

  await row.click();
  await expect(page.locator('.title-input')).toHaveValue('Keep me');
  await expect(page.locator('.cm-content')).toContainText('Some text worth keeping.');

  expect(errors).toEqual([]);
});

test('toolbar list button on an empty line puts the cursor after the marker', async ({ page }) => {
  await register(page);

  await page.getByRole('button', { name: 'New doc' }).click();
  await expect(page.locator('.title-input')).toBeFocused();
  await page.keyboard.press('Enter'); // leave the title field
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.getByRole('button', { name: /^Bulleted list/ }).click();
  await page.keyboard.type('First item');

  await expect(editor).toHaveText('- First item');
  await expect(page.locator('.pane-preview .markdown-body ul li')).toHaveText('First item');
});
