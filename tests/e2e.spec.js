import { test, expect } from '@playwright/test';

test('register, write Markdown, see preview, and persist', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.fill('#auth-email', `e2e-${Date.now()}@example.com`);
  await page.fill('#auth-password', 'a-very-good-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  // The welcome document opens with a rendered preview.
  const preview = page.locator('.pane-preview .markdown-body');
  await expect(preview.locator('h1')).toHaveText('Welcome to MD-BOY');
  await expect(preview.locator('table')).toBeVisible();
  await expect(preview.locator('.katex').first()).toBeVisible();
  await expect(preview.locator('.mermaid-block.rendered svg')).toBeVisible({ timeout: 15_000 });

  // Create a new document and type into it.
  await page.getByRole('button', { name: 'New doc' }).click();
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

  // Search finds it.
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('apples');
  await expect(page.locator('.search-result strong')).toHaveText('Shopping list');

  expect(errors).toEqual([]);
});
