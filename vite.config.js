import { defineConfig } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

// Writes "<file>.br" and "<file>.gz" next to every text asset over 1 KB, so the server
// can send them precompressed.
function precompress() {
  let outDir;
  return {
    name: 'hashmark:precompress',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const all = await readdir(outDir, { recursive: true }).catch(() => []); // e.g. a failed build
      const files = all.filter((f) => /\.(js|css|svg|html)$/.test(f));
      await Promise.all(
        files.map(async (file) => {
          const path = join(outDir, file);
          const data = await readFile(path);
          if (data.length <= 1024) return;
          const [br, gzipped] = await Promise.all([
            brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
            gz(data, { level: 9 }),
          ]);
          if (br.length < data.length) await writeFile(`${path}.br`, br);
          if (gzipped.length < data.length) await writeFile(`${path}.gz`, gzipped);
        }),
      );
    },
  };
}

// @vscode/markdown-it-katex depends on an older KaTeX. The app passes it the top-level
// KaTeX (whose CSS it loads), so point the plugin's own import there too: one copy, one version.
function singleKatex() {
  const importer = fileURLToPath(new URL('./client/src/preview.js', import.meta.url));
  return {
    name: 'hashmark:single-katex',
    enforce: 'pre',
    resolveId(source, from) {
      if (source === 'katex' && from?.includes('@vscode/markdown-it-katex')) {
        return this.resolve('katex', importer, { skipSelf: true });
      }
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [singleKatex(), precompress()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
