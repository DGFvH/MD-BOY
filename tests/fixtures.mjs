// Playwright fixtures. Behind this sandbox's HTTP proxy, Chromium's own connections to
// Supabase are slow and flaky, while Node's are fine, so (only when a proxy is set)
// the browser's Supabase requests are passed through Node's fetch.
import { test as base, expect } from '@playwright/test';

const PROXIED = !!(process.env.HTTPS_PROXY || process.env.https_proxy);

export async function viaNode(route) {
  const req = route.request();
  const headers = { ...req.headers() };
  delete headers['content-length'];
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(req.url(), { method: req.method(), headers, body: req.postDataBuffer() ?? undefined, redirect: 'manual' });
      break;
    } catch (err) {
      if (attempt >= 2) return route.abort('failed');
    }
  }
  const body = Buffer.from(await res.arrayBuffer());
  const out = {};
  res.headers.forEach((v, k) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v;
  });
  await route.fulfill({ status: res.status, headers: out, body });
}

export const test = base.extend({
  // The cookie banner is answered ("Decline") up front, so it never covers what a test
  // clicks. test.use({ storageNotice: true }) shows it.
  storageNotice: [false, { option: true }],
  context: async ({ context, storageNotice }, use) => {
    if (PROXIED) await context.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, viaNode);
    if (!storageNotice) {
      await context.addInitScript(() => {
        localStorage.setItem('hashlite:notice', '1');
        localStorage.setItem('hashlite:consent', 'denied');
      });
    }
    // Tests never talk to Google Analytics; the consent test watches these requests.
    await context.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await use(context);
  },
});

export { expect };
export const SUPABASE_URL_RE = /^https:\/\/[a-z0-9]+\.supabase\.co\//;
export { PROXIED };
