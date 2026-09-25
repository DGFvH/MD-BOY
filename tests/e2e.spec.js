import { test, expect } from '@playwright/test';

// A first visit opens the sign-up form.
async function register(page) {
  await page.goto('/app');
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

test('a Markdown file dropped on the editor is imported, and the open document is left alone', async ({ page }) => {
  await register(page);

  await page.getByRole('button', { name: 'New doc' }).click();
  await expect(page.locator('.title-input')).toBeFocused();
  await page.keyboard.press('Enter');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('# Drop target\n\nOriginal text.');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 5000 });

  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['# Imported\n\nFile body.\n'], 'imported.md', { type: 'text/markdown' }));
    return dt;
  });
  const box = await editor.boundingBox();
  const at = { dataTransfer, clientX: box.x + 40, clientY: box.y + 10 };
  await editor.dispatchEvent('dragover', at);
  await editor.dispatchEvent('drop', at);
  await expect(page.locator('.title-input')).toHaveValue('imported');
  await expect(editor).toContainText('File body.');

  await page.locator('.tree-row', { hasText: 'Drop target' }).click();
  await expect(page.locator('.title-input')).toHaveValue('Drop target');
  await expect(editor).toContainText('Original text.');
  await expect(editor).not.toContainText('File body.');
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

test('a saved version opens read-only, and its in-page links keep the route', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await register(page);

  await page.getByRole('button', { name: 'New doc' }).click();
  await expect(page.locator('.title-input')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(`# Notes\n\n- [ ] A task\n\nSee the note.[^1]\n\n${'Filler.\n\n'.repeat(60)}[^1]: The note.\n`);
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 5000 });
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved to the version history.')).toBeVisible();

  await page.getByRole('button', { name: 'Version history' }).click();
  await page.locator('.revision').first().click();
  const version = page.locator('dialog .revision-preview');
  await expect(version.locator('input.task-list-item-checkbox')).toBeDisabled();
  const hash = await page.evaluate(() => location.hash);
  await version.locator('sup a').first().click();
  await expect.poll(() => version.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => location.hash)).toBe(hash);

  expect(errors).toEqual([]);
});

async function newDocWith(page, text) {
  await page.getByRole('button', { name: 'New doc' }).click();
  await page.keyboard.press('Enter');
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(text);
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 5000 });
}

test('a pasted image is uploaded and shown in the preview', async ({ page }) => {
  await register(page);
  await newDocWith(page, '# Pictures\n\n');
  await page.evaluate(async () => {
    // A 1×1 PNG.
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dot.png', { type: 'image/png' }));
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.cm-content')).toContainText(/!\[dot\]\(\/i\/[\w-]{22}\)/);
  const img = page.locator('.pane-preview .markdown-body img[alt="dot"]');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBe(1);
});

test('a read-only share link opens for someone who is signed out', async ({ page, browser }) => {
  await register(page);
  await newDocWith(page, '# Shared notes\n\n> [!NOTE]\n> Visible to anyone with the link.\n');
  await expect(page.locator('.pane-preview .markdown-alert-note')).toBeVisible();

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Share read-only link/ }).click();
  await page.getByRole('button', { name: 'Create link' }).click();
  const url = await page.getByRole('textbox', { name: 'Share link' }).inputValue();
  expect(url).toMatch(/\/s\/[\w-]{22}$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tree-row.active .tree-badge')).toBeVisible();

  const stranger = await browser.newContext();
  const view = await stranger.newPage();
  await view.goto(url);
  await expect(view.locator('h1')).toHaveText('Shared notes');
  await expect(view.locator('.markdown-alert-note')).toContainText('Visible to anyone');
  await expect(view.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await stranger.close();
});

test('another tab showing the same document picks up saved changes', async ({ page, context }) => {
  await register(page);
  await newDocWith(page, '# Two tabs\n\nfirst');
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator('.cm-content')).toContainText('first');

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' and second');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 5000 });
  await expect(other.locator('.cm-content')).toContainText('first and second', { timeout: 5000 });
});

test('every colour theme can be picked and is remembered', async ({ page }) => {
  await register(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const seen = new Set();
  for (const [label, id] of [['Light', 'light'], ['Dark', 'dark'], ['Sepia', 'sepia'], ['High contrast', 'contrast']]) {
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemcheckbox', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    seen.add(await bg());
  }
  expect(seen.size).toBe(4);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the sidebar drawer holds focus and closes with Escape', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await register(page);

    // The theme choices move from the top bar into the ⋯ menu.
    await expect(page.getByRole('button', { name: 'Theme' })).toBeHidden();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const menuButton = page.getByRole('button', { name: 'Show sidebar' });
    await menuButton.click();
    await expect(page.locator('.app')).toHaveClass(/mobile-sidebar-open/);
    await expect(page.locator('.tree-row.active .tree-main')).toBeFocused(); // not the search box: no keyboard pop-up
    expect(await page.locator('main').evaluate((el) => el.inert)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.app')).not.toHaveClass(/mobile-sidebar-open/);
    await expect(menuButton).toBeFocused();
    expect(await page.locator('main').evaluate((el) => el.inert)).toBe(false);

    expect(errors).toEqual([]);
  });
});

test('the landing page is static, crawlable HTML that leads to the editor', async ({ page, request }) => {
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toContainText('Free online Markdown editor');
  expect(scripts).toEqual([]); // no editor JavaScript on the landing page
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  for (const block of ld) JSON.parse(block);
  await page.getByRole('link', { name: /Start writing/ }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

  for (const path of ['/guide', '/privacy', '/robots.txt', '/llms.txt']) expect((await request.get(path)).status()).toBe(200);
  expect((await request.get('/nope')).status()).toBe(404);
});

test('the /learn articles are crawlable pages with valid structured data', async ({ page }) => {
  for (const path of ['/learn', '/learn/markdown-to-pdf', '/learn/markdown-tables', '/learn/markdown-math-and-diagrams', '/learn/markdown-vs-rich-text']) {
    const res = await page.goto(path);
    expect(res.status(), path).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    for (const block of await page.locator('script[type="application/ld+json"]').allTextContents()) JSON.parse(block);
  }
});
