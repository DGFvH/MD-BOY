import { test, expect, viaNode, PROXIED, SUPABASE_URL_RE } from './fixtures.mjs';
import { resetTestAccount, TEST_EMAIL, TEST_PASSWORD } from './account.mjs';
import { editorLink } from '../mcp/server.js';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Signs in to a freshly emptied Supabase test account (the welcome document is
// created on the first sign-in, as for a new user).
async function register(page) {
  await resetTestAccount();
  await page.goto('/app');
  const signIn = page.getByRole('heading', { name: 'Welcome back' });
  const signUp = page.getByRole('heading', { name: 'Create your account' });
  await expect(signIn.or(signUp)).toBeVisible();
  if (await signUp.isVisible()) await page.locator('.auth-switch .link-btn', { hasText: 'Sign in' }).click();
  await expect(signIn).toBeVisible();
  await page.fill('#auth-email', TEST_EMAIL);
  await page.fill('#auth-password', TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 });
}

test('signing up asks to confirm the email address', async ({ page }) => {
  // No real email is sent: the sign-up request is answered as Supabase does when
  // confirmation is required (a user, but no session).
  await page.route('**/auth/v1/signup**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: '', email: 'new@example.com', identities: [{ id: 'x' }], user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() }),
  }));
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.fill('#auth-email', 'new@example.com');
  await page.fill('#auth-password', 'a-very-good-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText('new@example.com')).toBeVisible();
});

test('register, write Markdown, see preview, and persist', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await register(page);

  // The welcome document opens with a rendered preview.
  const preview = page.locator('.pane-preview .markdown-body');
  await expect(preview.locator('h1')).toHaveText('Welcome to Hashlite');
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
  await page.locator('.tree-row', { hasText: 'Welcome to Hashlite' }).click();
  await expect(page.locator('.title-input')).toHaveValue('Welcome to Hashlite');
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
  await expect(page.locator('.title-input')).toBeFocused(); // the new document is open
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
  await expect(page.locator('.cm-content')).toContainText(/!\[dot\]\(https:\/\/\S+\/storage\/v1\/object\/public\/images\/[\w-]+\/[\w-]{22}\.png\)/);
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
  if (PROXIED) await stranger.route(SUPABASE_URL_RE, viaNode);
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
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Theme…' }).click();
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

    // The theme choices are in the ⋯ menu.
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Theme…' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dark', exact: true }).click();
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

// Replaces the text in the home page editor.
async function typeInHomeEditor(page, text) {
  const editor = page.locator('.home-editor .cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

test('the home page is crawlable HTML that opens into a working editor', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Free online Markdown editor');
  for (const block of await page.locator('script[type="application/ld+json"]').allTextContents()) JSON.parse(block);

  // The editor fills the screen below the header.
  const box = await page.locator('.home-editor').boundingBox();
  const viewport = page.viewportSize();
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 4);
  expect(box.y).toBeLessThan(80);

  // The real editor replaces the static one; the preview renders math.
  const preview = page.locator('.he-preview .markdown-body');
  await expect(page.locator('.home-editor .cm-content')).toBeVisible();
  await expect(preview.locator('h2')).toHaveText('Welcome to Hashlite');
  await expect(preview.locator('.katex').first()).toBeVisible();

  await typeInHomeEditor(page, '## My notes\n\n- [ ] one\n\n$$x^2$$');
  await expect(preview.locator('h2')).toHaveText('My notes');
  await preview.locator('input[type="checkbox"]').click(); // ticks the box in the text
  await expect(page.locator('.home-editor .cm-content')).toContainText('- [x] one');
  await page.reload(); // kept in this browser
  await expect(page.locator('.home-editor .cm-content')).toContainText('My notes');

  // Views
  await page.getByRole('button', { name: 'Preview only' }).click();
  await expect(page.locator('.he-editor')).toBeHidden();
  await page.getByRole('button', { name: /^Editor only/ }).click();
  await expect(page.locator('.he-preview')).toBeHidden();
  await page.getByRole('button', { name: 'Side by side' }).click();

  for (const path of ['/guide', '/privacy', '/robots.txt', '/llms.txt', '/sitemap.xml', '/learn/ai-chat-to-document']) expect((await request.get(path)).status()).toBe(200);
  expect((await request.get('/nope')).status()).toBe(404);
  expect(await (await request.get('/llms.txt')).text()).toContain('#text=');
  expect(errors).toEqual([]);
});

test('the home editor exports without an account', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await typeInHomeEditor(page, '# Report\n\n| a | b |\n| - | - |\n| 1 | 2 |');
  await expect(page.locator('.he-preview table')).toBeVisible();

  await page.getByRole('button', { name: 'More actions' }).click();
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download Markdown (.md)' }).click()]);
  expect(md.suggestedFilename()).toBe('Report.md');

  await page.getByRole('button', { name: 'More actions' }).click();
  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download HTML (.html)' }).click()]);
  expect(html.suggestedFilename()).toBe('Report.html');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy as formatted text' }).click();
  await expect(page.getByText('Copied. Paste it into Word, Google Docs or an email.')).toBeVisible();
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return (await item.getType('text/html')).text();
  });
  expect(copied).toContain('<table>');
  expect(copied).toContain('<h1');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Theme…' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Sepia', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
});

test('a #text= link opens that Markdown in the home editor', async ({ page }) => {
  await page.goto(`/#text=${encodeURIComponent('# Linked doc\n\nFrom a link.')}`);
  await expect(page.locator('.he-preview h1')).toHaveText('Linked doc');
  await expect(page).toHaveURL(/\/$/); // the text is not left in the address bar
  await page.reload();
  await expect(page.locator('.he-preview h1')).toHaveText('Linked doc'); // kept like typed text

  // Opening another link over edited text can be undone.
  await page.goto(`/#text=${encodeURIComponent('# Second')}`);
  await expect(page.locator('.he-preview h1')).toHaveText('Second');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.he-preview h1')).toHaveText('Linked doc');
});

test('saving from the home editor asks for an account, then keeps the document', async ({ page }) => {
  await resetTestAccount();
  await page.goto('/');
  await typeInHomeEditor(page, '# From the home page\n\nHello there.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.getByText('Create a free account to save the document you started.')).toBeVisible();

  await page.locator('.auth-switch .link-btn', { hasText: 'Sign in' }).click();
  await expect(page.getByText('Sign in to save the document you started.')).toBeVisible();
  await page.fill('#auth-email', TEST_EMAIL);
  await page.fill('#auth-password', TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.title-input')).toHaveValue('From the home page', { timeout: 15_000 });
  await expect(page.locator('.cm-content')).toContainText('Hello there.');
  expect(await page.evaluate(() => localStorage.getItem('hashlite:guest'))).toBeNull();

  // Back on the home page, the header links to the documents.
  await page.goto('/');
  await expect(page.locator('#nav-account')).toHaveText('My documents');
});

test('every tool page is an indexable page with a working editor', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const slugs = ['markdown-to-word', 'markdown-to-google-docs', 'markdown-to-pdf-converter', 'markdown-to-html', 'markdown-viewer',
    'csv-to-markdown-table', 'markdown-table-generator', 'mermaid-editor', 'latex-math-editor', 'readme-editor'];
  for (const slug of slugs) {
    const res = await page.goto(`/${slug}`);
    expect(res.status(), slug).toBe(200);
    expect((await res.text()).match(/<h1[\s>]/g), slug).toHaveLength(1); // the served HTML has one h1: the tool's name
    for (const block of await page.locator('script[type="application/ld+json"]').allTextContents()) JSON.parse(block);
    await expect(page.locator('.home-editor.ready .cm-content'), slug).toBeAttached(); // hidden on the viewer, which opens in preview
  }
  await page.goto('/tools');
  await expect(page.locator('.hub a')).toHaveCount(slugs.length);
  await expect(page.getByRole('link', { name: 'Open in Hashlite' })).toHaveAttribute('href', /^javascript:.*hashlite\.io\/#text=/);
  expect(errors).toEqual([]);
});

test('CSV and spreadsheet cells become a Markdown table', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/csv-to-markdown-table');
  await expect(page.locator('.table-tool.ready')).toBeVisible();
  await page.fill('#tt-input', 'City\tPeople\nAmsterdam\t931,298\nUtrecht\t361,924');
  await expect(page.locator('.he-preview table tbody tr')).toHaveCount(2);
  await expect(page.locator('.he-preview th').first()).toHaveText('City');
  await expect(page.getByText('3 rows × 2 columns converted.')).toBeVisible();

  await page.selectOption('#tt-align', 'right');
  await expect(page.locator('.home-editor .cm-content')).toContainText('------:');
  await page.getByRole('button', { name: 'Copy Markdown' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('| Amsterdam | 931,298 |');

  // Quoted commas and pipes
  await page.fill('#tt-input', 'a,b\n"x, y",p|q');
  await expect(page.locator('.home-editor .cm-content')).toContainText('p\\|q');
  await expect(page.locator('.he-preview td').first()).toHaveText('x, y');
});

test('the table generator writes Markdown from the grid', async ({ page }) => {
  await page.goto('/markdown-table-generator');
  await expect(page.locator('.table-tool.ready')).toBeVisible();
  await page.getByRole('textbox', { name: 'Row 2, column 1' }).fill('Linus');
  await expect(page.locator('.he-preview tbody tr').first()).toContainText('Linus');
  await page.getByRole('button', { name: '+ Row' }).click();
  await expect(page.locator('.he-preview tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: '+ Column' }).click();
  await expect(page.locator('.he-preview thead th')).toHaveCount(4);
});

test('tool pages keep their own text, and Save hands it to the app', async ({ page }) => {
  await page.goto('/');
  await typeInHomeEditor(page, '# Home text');
  await page.goto('/mermaid-editor');
  await expect(page.locator('.he-preview .mermaid-block').first()).toBeVisible();
  await typeInHomeEditor(page, '# Diagram notes');
  await page.goto('/');
  await expect(page.locator('.he-preview h1')).toHaveText('Home text');
  await page.goto('/mermaid-editor');
  await expect(page.locator('.he-preview h1')).toHaveText('Diagram notes');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Create a free account to save the document you started.')).toBeVisible();
  const handed = await page.evaluate(() => JSON.parse(localStorage.getItem('hashlite:guest')));
  expect(handed).toEqual({ content: '# Diagram notes', pending: true });
});

test('the viewer opens in preview, and HTML downloads carry an optional credit', async ({ page }) => {
  await page.goto('/markdown-viewer');
  await expect(page.locator('.he-editor')).toBeHidden();
  await expect(page.locator('.he-preview h1')).toHaveText('Drop a Markdown file here');

  const download = async () => {
    await page.getByRole('button', { name: 'More actions' }).click();
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download HTML (.html)' }).click()]);
    return (await import('node:fs')).readFileSync(await file.path(), 'utf8');
  };
  expect(await download()).toContain('Written with <a href="https://hashlite.io"');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Credit Hashlite in HTML downloads' }).click();
  expect(await download()).not.toContain('Written with');
});

test.describe('installable app', () => {
  test.use({ serviceWorkers: 'allow' });

  test('has a manifest, works as a share target and opens offline', async ({ page, context, request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.share_target.action).toBe('/share-target');
    expect(manifest.icons.some((i) => i.sizes === '512x512')).toBe(true);

    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // Sharing text from another app: the service worker turns the POST into #text=.
    await page.evaluate(() => {
      const form = Object.assign(document.createElement('form'), { method: 'POST', action: '/share-target' });
      form.enctype = 'application/x-www-form-urlencoded';
      for (const [name, value] of [['title', 'Shared'], ['text', '# Shared note\n\nFrom my phone']]) {
        form.append(Object.assign(document.createElement('input'), { type: 'hidden', name, value }));
      }
      document.body.append(form);
      form.submit();
    });
    await expect(page.locator('.he-preview h1')).toHaveText('Shared note');
    await expect(page.locator('.home-editor .cm-content')).toContainText('From my phone');

    // Offline, the cached page still opens.
    await page.reload();
    await expect(page.locator('.home-editor.ready')).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.home-title')).toHaveText('Free online Markdown editor');
    await context.setOffline(false);
  });
});

test('a link from the connector (open_in_hashlite) opens that document in the editor', async ({ page }) => {
  const markdown = '# From the assistant\n\n| Step | Owner |\n| --- | --- |\n| Plan | Ada |\n\nMath: $x^2$ & more';
  const link = new URL(editorLink(markdown));
  await page.goto(`/${link.hash}`);
  await expect(page.locator('.he-preview h1')).toHaveText('From the assistant');
  await expect(page.locator('.he-preview td').first()).toHaveText('Plan');
  await expect(page.locator('.he-preview .katex').first()).toBeVisible();
  await page.goto('/connect');
  await expect(page.locator('h1')).toHaveText('Connect Hashlite to your AI assistant');
  await expect(page.locator('pre code').first()).toContainText('/api/mcp');
});

test('the account connector: OAuth consent, tools, refresh and disconnect', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  await resetTestAccount();

  // Discovery, and the 401 that makes a client start the login.
  const resource = await (await request.get('/.well-known/oauth-protected-resource/api/account-mcp')).json();
  expect(resource.resource).toBe(`${baseURL}/api/account-mcp`);
  const server = await (await request.get('/.well-known/oauth-authorization-server')).json();
  expect(server.code_challenge_methods_supported).toEqual(['S256']);
  const anonymous = await request.post('/api/account-mcp', { data: {} });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()['www-authenticate']).toContain('resource_metadata="');

  // Registration: https or localhost only.
  expect((await request.post('/api/oauth/register', { data: { client_name: 'Evil', redirect_uris: ['http://evil.example/cb'] } })).status()).toBe(400);
  const redirectUri = `${baseURL}/callback`;
  const reg = await request.post('/api/oauth/register', { data: { client_name: 'Test assistant', redirect_uris: [redirectUri] } });
  expect(reg.status()).toBe(201);
  const { client_id: clientId } = await reg.json();

  // Consent: sign in, Allow, back to the app with a code.
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = (uri = redirectUri) => `/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: uri, state: 'st4te', code_challenge: challenge, code_challenge_method: 'S256',
  })}`;
  await page.goto(authorize('https://attacker.example/cb'));
  await expect(page.getByRole('heading', { name: 'This link doesn’t work' })).toBeVisible();
  await page.goto(authorize());
  await expect(page.getByText('Test assistant wants to connect to your Hashlite documents.')).toBeVisible();
  await page.fill('#auth-email', TEST_EMAIL);
  await page.fill('#auth-password', TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect Test assistant?' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL(/\/callback\?/);
  const back = new URL(page.url());
  expect(back.searchParams.get('state')).toBe('st4te');
  const code = back.searchParams.get('code');

  // Token exchange: the verifier must match, and a code works once.
  const exchange = (v) => request.post('/api/oauth/token', { form: { grant_type: 'authorization_code', code, code_verifier: v, client_id: clientId, redirect_uri: redirectUri } });
  const wrong = await exchange(randomBytes(48).toString('base64url'));
  expect(wrong.status()).toBe(400);
  expect((await wrong.json()).error).toBe('invalid_grant');
  const tokens = await (await exchange(verifier)).json();
  expect(tokens.token_type).toBe('Bearer');
  expect((await exchange(verifier)).status()).toBe(400); // used

  // The tools, as an MCP client with the access token.
  const connect = async (access) => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseURL}/api/account-mcp`), { requestInit: { headers: { Authorization: `Bearer ${access}` } } }));
    return client;
  };
  const client = await connect(tokens.access_token);
  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(['search_documents', 'list_documents', 'read_document', 'create_document', 'update_document', 'share_document', 'open_in_hashlite']));
  const call = (name, args) => client.callTool({ name, arguments: args });

  const created = await call('create_document', { title: 'From Claude', markdown: '# Plan\n\nZebra crossing notes.' });
  const id = created.structuredContent.id;
  expect(created.structuredContent.url).toContain(`/app#/doc/${id}`);
  const read = await call('read_document', { id });
  expect(read.structuredContent.content).toContain('Zebra crossing');
  const updated = await call('update_document', { id, markdown: '# Plan\n\nUpdated by the assistant.', version: read.structuredContent.version });
  expect(updated.structuredContent.version).toBe(read.structuredContent.version + 1);
  const stale = await call('update_document', { id, markdown: 'stale', version: read.structuredContent.version });
  expect(stale.isError).toBe(true);
  expect(stale.content[0].text).toMatch(/changed after you read it/);
  const found = await call('search_documents', { query: 'assistant' });
  expect(found.structuredContent.results.map((r) => r.id)).toContain(id);
  const listed = await call('list_documents', {});
  expect(listed.structuredContent.documents.some((d) => d.title === 'From Claude')).toBe(true);
  const missing = await call('read_document', { id: '00000000-0000-4000-8000-000000000000' });
  expect(missing.isError).toBe(true);
  const shared = await call('share_document', { id });
  expect(shared.structuredContent.url).toMatch(/\/s\/[\w-]{22}$/);
  await client.close();

  // The update kept the earlier text in the document's history, and the app shows the document.
  await page.goto(`/app#/doc/${id}`);
  await expect(page.locator('.cm-content')).toContainText('Updated by the assistant.', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Version history' }).click();
  await expect(page.locator('.side-panel')).toBeVisible();

  // Refresh rotates the tokens: the old refresh token stops working.
  const refresh = (t) => request.post('/api/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: t, client_id: clientId } });
  const fresh = await (await refresh(tokens.refresh_token)).json();
  expect(fresh.access_token).toBeTruthy();
  expect((await refresh(tokens.refresh_token)).status()).toBe(400);

  // Disconnect in the Account dialog: the token stops working.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Account…' }).click();
  await expect(page.getByText('Test assistant', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect Test assistant' }).click();
  await expect(page.getByText('No apps are connected.')).toBeVisible();
  const after = await request.post('/api/account-mcp', {
    headers: { Authorization: `Bearer ${fresh.access_token}`, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(after.status()).toBe(401);
});

test.describe('cookie banner', () => {
  test.use({ storageNotice: true });

  test('analytics loads only after Allow, without document text or queries', async ({ page }) => {
    const gaRequests = [];
    page.on('request', (r) => { if (/googletagmanager\.com/.test(r.url())) gaRequests.push(r.url()); });

    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Cookies and storage' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy#cookies');
    await banner.getByRole('button', { name: 'Decline' }).click();
    await expect(banner).toBeHidden();
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: /Create your account|Welcome back/ })).toBeVisible();
    await expect(banner).toBeHidden(); // the answer is remembered
    expect(gaRequests).toEqual([]);

    // Changing the answer from the footer.
    await page.goto(`/?q=secret#text=${encodeURIComponent('# Private text')}`);
    await page.getByRole('button', { name: 'Cookie settings' }).click();
    await banner.getByRole('button', { name: 'Allow' }).click();
    await expect.poll(() => gaRequests.length).toBeGreaterThan(0);
    expect(gaRequests[0]).toContain('id=G-');
    const config = await page.evaluate(() => [...window.dataLayer].find((args) => args[0] === 'config')?.[2]);
    expect(config.page_location).toBe(new URL(page.url()).origin + '/');
    expect(config.allow_ad_personalization_signals).toBe(false);

    // Loaded on later pages without asking again, and switched off by Decline.
    await page.goto('/privacy');
    await expect(banner).toBeHidden();
    await expect.poll(() => gaRequests.length).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Cookie settings' }).first().click();
    await banner.getByRole('button', { name: 'Decline' }).click();
    expect(await page.evaluate(() => Object.keys(window).some((k) => k.startsWith('ga-disable-') && window[k] === true))).toBe(true);
  });
});

test('the /learn articles are crawlable pages with valid structured data', async ({ page }) => {
  for (const path of ['/learn', '/learn/ai-chat-to-document', '/learn/markdown-to-pdf', '/learn/markdown-tables', '/learn/markdown-math-and-diagrams', '/learn/markdown-vs-rich-text']) {
    const res = await page.goto(path);
    expect(res.status(), path).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    for (const block of await page.locator('script[type="application/ld+json"]').allTextContents()) JSON.parse(block);
  }
});

test('opening the editor without a connection says so, then recovers', async ({ page, context }) => {
  await register(page);
  let offline = true;
  await context.route(SUPABASE_URL_RE, (route) => (offline ? route.abort('internetdisconnected') : route.fallback()));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Can’t reach Hashlite' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Your documents couldn’t be loaded.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New document' })).toBeHidden();
  offline = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.tree-row', { hasText: 'Welcome to Hashlite' })).toBeVisible({ timeout: 15_000 });
});
