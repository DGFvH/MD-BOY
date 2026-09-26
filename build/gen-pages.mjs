// Writes the tool pages (client/<slug>/index.html) and the /tools hub from build/tools.mjs.
// Run with `npm run gen:pages` after changing tools.mjs; the output is committed, so the
// normal build (and Vite's page list) doesn't depend on this script.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import { full as emoji } from 'markdown-it-emoji';
import katexPluginModule from '@vscode/markdown-it-katex';
import katex from 'katex';
import alerts from '../client/src/render/alerts.js';
import { TOOLS, toolBySlug } from './tools.mjs';

const CLIENT = fileURLToPath(new URL('../client/', import.meta.url));
const katexPlugin = katexPluginModule.default ?? katexPluginModule;

// The same Markdown flavour as the app, for the preview that is in the page before the editor loads.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
  .use(taskLists, { enabled: false })
  .use(footnote)
  .use(alerts)
  .use(mark)
  .use(emoji, { shortcuts: {} })
  .use(katexPlugin, { katex, throwOnError: false });
md.renderer.rules.table_open = (t, i, o, e, self) => `<div class="table-wrap">${self.renderToken(t, i, o)}`;
md.renderer.rules.table_close = (t, i, o, e, self) => `${self.renderToken(t, i, o)}</div>\n`;
// The page's own <h1> is the tool name, so the example's headings go one level down here.
for (const type of ['heading_open', 'heading_close']) {
  md.renderer.rules[type] = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    t.tag = `h${Math.min(6, Number(t.tag.slice(1)) + 1)}`;
    return self.renderToken(tokens, idx, options);
  };
}
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  if (t.info.trim() === 'mermaid') return `<div class="mermaid-block"><pre class="mermaid-src">${md.utils.escapeHtml(t.content)}</pre></div>\n`;
  return defaultFence(tokens, idx, options, env, self);
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const json = (value) => JSON.stringify(value, null, 2).replace(/</g, '\\u003c').split('\n').map((l) => `      ${l}`).join('\n').trimStart();

function head({ path, title, description, jsonLd }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="theme-color" content="#4f46e5" />
    <meta name="color-scheme" content="light dark" />
    <link rel="canonical" href="%PUBLIC_URL%${path}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Hashlite" />
    <meta property="og:title" content="${esc(title.replace(/ \| Hashlite$/, ''))}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="%PUBLIC_URL%${path}" />
    <meta property="og:image" content="%PUBLIC_URL%/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="%PUBLIC_URL%/og.png" />
    <link rel="stylesheet" href="/src/site.css" />
    <script type="application/ld+json">
      ${json(jsonLd)}
    </script>
  </head>`;
}

const header = (h1) => `    <a class="skip-link" href="#try">Skip to the editor</a>
    <header class="site-header home-header">
      <div class="container wide">
        <a class="brand" href="/" aria-label="Hashlite home"><img src="/favicon.svg" alt="" width="32" height="32" /><span class="brand-name">Hashlite</span></a>
        <h1 class="home-title">${esc(h1)}</h1>
        <nav class="site-nav" aria-label="Main">
          <ul>
            <li class="hide-sm"><a href="/tools">Tools</a></li>
            <li class="hide-sm"><a href="/learn">Learn</a></li>
            <li><a class="nav-cta" id="nav-account" href="/app">Sign in</a></li>
          </ul>
        </nav>
      </div>
    </header>`;

const footer = `    <footer class="site-footer">
      <div class="container">
        <p>© Hashlite</p>
        <nav aria-label="Footer">
          <ul>
            <li><a href="/tools">Tools</a></li>
            <li><a href="/learn">Learn</a></li>
            <li><a href="/guide">Cheat sheet</a></li>
            <li><a href="/privacy">Privacy</a></li>
            <li><button type="button" class="footer-link" data-cookie-settings>Cookie settings</button></li>
            <li><a href="/">Open editor</a></li>
          </ul>
        </nav>
      </div>
    </footer>`;

function toolPanel(tool) {
  if (tool.tool === 'csv') {
    return `      <section class="table-tool" data-mode="csv" aria-label="CSV input">
        <label class="tt-label" for="tt-input">Paste CSV, TSV or cells from Excel / Google Sheets</label>
        <textarea id="tt-input" spellcheck="false">${esc(tool.toolSample)}</textarea>
      </section>\n`;
  }
  if (tool.tool === 'grid') {
    return `      <section class="table-tool" data-mode="grid" aria-label="Table grid">
        <p class="tt-label">Type in the grid, or paste cells from a spreadsheet. The Markdown appears below.</p>
      </section>\n`;
  }
  return '';
}

function toolPage(tool) {
  const path = `/${tool.slug}`;
  const faq = tool.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: `${tool.name} – Hashlite`,
        url: `%PUBLIC_URL%${path}`,
        description: tool.description,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any (web browser)',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        isPartOf: { '@type': 'WebSite', name: 'Hashlite', url: '%PUBLIC_URL%/' },
      },
      { '@type': 'FAQPage', mainEntity: faq },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: '%PUBLIC_URL%/' },
          { '@type': 'ListItem', position: 2, name: 'Tools', item: '%PUBLIC_URL%/tools' },
          { '@type': 'ListItem', position: 3, name: tool.name, item: `%PUBLIC_URL%${path}` },
        ],
      },
    ],
  };
  const view = tool.view ?? 'split';
  const related = tool.related.map((slug) => toolBySlug(slug)).map((t) => `<li><a href="/${t.slug}">${esc(t.h1)}</a></li>`).join('');
  return `${head({ path, title: tool.title, description: tool.description, jsonLd })}
  <body class="home">
${header(tool.h1)}

    <main id="main">
${toolPanel(tool)}      <section class="home-editor${tool.tool ? ' with-tool' : ''}" id="try" aria-label="Markdown editor" tabindex="-1" data-page="${tool.slug}" data-view="${view}" data-action="${tool.action}">
        <div class="he-bar">
          <span class="he-loading">Loading the editor…</span>
        </div>
        <div class="he-panes" data-view="${view}">
          <div class="he-pane he-editor">
            <textarea class="he-fallback" id="try-input" spellcheck="false" aria-label="Markdown">
${esc(tool.sample)}</textarea>
          </div>
          <div class="he-pane he-preview" id="try-preview">
            <article class="markdown-body">
${md.render(tool.sample)}            </article>
          </div>
        </div>
      </section>

      <section class="section" aria-labelledby="about">
        <div class="container intro">
          <h2 id="about">${esc(tool.h1)}, free and in your browser</h2>
          <p class="lead">${tool.intro}</p>
        </div>
      </section>

      <section class="section alt" aria-labelledby="how">
        <div class="container">
          <h2 id="how">How it works</h2>
          <ol class="steps">
${tool.steps.map(([title, text]) => `            <li><h3>${esc(title)}</h3><p>${esc(text)}</p></li>`).join('\n')}
          </ol>
          ${tool.guide ? `<p><a href="${tool.guide}">Read the full guide →</a></p>` : ''}
        </div>
      </section>

      <section class="section" aria-labelledby="faq">
        <div class="container faq">
          <h2 id="faq">Questions</h2>
${tool.faq.map(([q, a]) => `          <details>
            <summary><h3>${esc(q)}</h3></summary>
            <div class="answer"><p>${esc(a)}</p></div>
          </details>`).join('\n')}
          <nav class="related" aria-labelledby="related-h">
            <h2 id="related-h">More free tools</h2>
            <ul>${related}<li><a href="/tools">All tools</a></li></ul>
          </nav>
        </div>
      </section>
    </main>

${footer}
    <script type="module" src="/src/site.js"></script>
    <script type="module" src="/src/landing.js"></script>
  </body>
</html>
`;
}

// A bookmarklet: sends the selected text (or the page title and address) to the editor.
export const BOOKMARKLET = "javascript:(()=>{const s=String(getSelection()).trim()||document.title+'\\n\\n'+location.href;open('https://hashlite.io/#text='+encodeURIComponent(s),'_blank')})()";

function hubPage() {
  const path = '/tools';
  const description = 'Free Markdown tools that work in your browser with no sign-up: convert Markdown to Word, Google Docs, PDF or HTML, CSV to Markdown tables, Mermaid and LaTeX editors, and more.';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: 'Free Markdown tools',
        url: `%PUBLIC_URL%${path}`,
        description,
        hasPart: TOOLS.map((t) => ({ '@type': 'WebApplication', name: t.h1, url: `%PUBLIC_URL%/${t.slug}` })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: '%PUBLIC_URL%/' },
          { '@type': 'ListItem', position: 2, name: 'Tools', item: `%PUBLIC_URL%${path}` },
        ],
      },
    ],
  };
  return `${head({ path, title: 'Free Markdown Tools – Convert, View and Edit Online | Hashlite', description, jsonLd })}
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="container">
        <a class="brand" href="/" aria-label="Hashlite home"><img src="/favicon.svg" alt="" width="32" height="32" />Hashlite</a>
        <nav class="site-nav" aria-label="Main">
          <ul>
            <li class="hide-xs"><a href="/learn">Learn</a></li>
            <li><a class="nav-cta" href="/">Open editor</a></li>
          </ul>
        </nav>
      </div>
    </header>

    <main id="main">
      <div class="container narrow prose">
        <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Tools</li></ol></nav>
        <div class="page-head">
          <h1>Free Markdown tools</h1>
          <p>Each tool is the Hashlite editor, set up for one job. They all run in your browser, need no sign-up, and never upload your text.</p>
        </div>
        <ul class="hub">
${TOOLS.map((t) => `          <li><a href="/${t.slug}">${esc(t.h1)}</a><p>${esc(t.description)}</p></li>`).join('\n')}
        </ul>

        <h2 id="bookmarklet">Open any text in Hashlite</h2>
        <p>Drag this button to your bookmarks bar. On any page, select some text and click the bookmark: the selection opens in the Hashlite editor, ready to format and export.</p>
        <p><a class="btn btn-secondary bookmarklet" href="${esc(BOOKMARKLET)}" title="Drag me to your bookmarks bar">Open in Hashlite</a></p>
        <p>Some sites block bookmarklets. There, copy the text and paste it into <a href="/">the editor</a> instead.</p>

        <h2 id="install">Install Hashlite as an app</h2>
        <p>
          Hashlite can be installed like an app, and then opens in its own window and works offline. In Chrome or Edge, use the
          install button in the address bar; on an iPhone or iPad, tap Share › Add to Home Screen; on Android, tap ⋮ › Install app.
          Once installed on a phone, you can share text from other apps straight to Hashlite.
        </p>

        <h2 id="link">Open Markdown with a link</h2>
        <p>Tools and scripts can open text in the editor: link to <code>%PUBLIC_URL%/#text=</code> followed by the URL-encoded Markdown. The text stays in the part after <code>#</code>, which is never sent to a server.</p>
      </div>
    </main>

${footer}
    <script type="module" src="/src/site.js"></script>
  </body>
</html>
`;
}

for (const tool of TOOLS) {
  mkdirSync(`${CLIENT}${tool.slug}`, { recursive: true });
  writeFileSync(`${CLIENT}${tool.slug}/index.html`, toolPage(tool));
}
mkdirSync(`${CLIENT}tools`, { recursive: true });
writeFileSync(`${CLIENT}tools/index.html`, hubPage());
console.log(`Wrote ${TOOLS.length} tool pages and /tools.`);
