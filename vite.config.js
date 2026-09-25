import { defineConfig, loadEnv } from 'vite';
import { applyPublicUrl, normalizePublicUrl, robotsTxt, sitemapXml, llmsTxt } from './build/site.mjs';
import { fileURLToPath } from 'node:url';

// @vscode/markdown-it-katex depends on an older KaTeX. The app passes it the top-level
// KaTeX (whose CSS it loads), so point the plugin's own import there too: one copy, one version.
function singleKatex() {
  const importer = fileURLToPath(new URL('./client/src/preview.js', import.meta.url));
  return {
    name: 'hashlite:single-katex',
    enforce: 'pre',
    resolveId(source, from) {
      if (source === 'katex' && from?.includes('@vscode/markdown-it-katex')) {
        return this.resolve('katex', importer, { skipSelf: true });
      }
    },
  };
}

// Fills %PUBLIC_URL% in every page and writes robots.txt, sitemap.xml and llms.txt.
// Without a public URL, tags that need an absolute address are left out.
function publicSite(publicUrl) {
  const base = normalizePublicUrl(publicUrl);
  return {
    name: 'hashlite:public-site',
    transformIndexHtml: { order: 'post', handler: (html) => applyPublicUrl(html, base) },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(base) });
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: llmsTxt(base) });
      if (base) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(base) });
    },
  };
}

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => ({
  root: 'client',
  envDir: ROOT_DIR,
  plugins: [singleKatex(), publicSite(loadEnv(mode, ROOT_DIR, 'VITE_').VITE_PUBLIC_URL)],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    // Public pages (landing, guide, privacy, 404) are plain HTML + a little CSS;
    // the editor lives at /app.
    rollupOptions: {
      input: {
        landing: fileURLToPath(new URL('./client/index.html', import.meta.url)),
        app: fileURLToPath(new URL('./client/app/index.html', import.meta.url)),
        guide: fileURLToPath(new URL('./client/guide/index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./client/privacy/index.html', import.meta.url)),
        notFound: fileURLToPath(new URL('./client/404.html', import.meta.url)),
        share: fileURLToPath(new URL('./client/s/index.html', import.meta.url)),
        learn: fileURLToPath(new URL('./client/learn/index.html', import.meta.url)),
        'markdown-to-pdf': fileURLToPath(new URL('./client/learn/markdown-to-pdf/index.html', import.meta.url)),
        'markdown-tables': fileURLToPath(new URL('./client/learn/markdown-tables/index.html', import.meta.url)),
        'markdown-math-and-diagrams': fileURLToPath(new URL('./client/learn/markdown-math-and-diagrams/index.html', import.meta.url)),
        'markdown-vs-rich-text': fileURLToPath(new URL('./client/learn/markdown-vs-rich-text/index.html', import.meta.url)),
        'ai-chat-to-document': fileURLToPath(new URL('./client/learn/ai-chat-to-document/index.html', import.meta.url)),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
}));
