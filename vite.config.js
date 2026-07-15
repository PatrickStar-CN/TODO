import { defineConfig } from 'vite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dataServerPlugin from './server-plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function cleanWebOutputPlugin() {
  return {
    name: 'clean-web-output',
    buildStart() {
      const outDir = resolve(__dirname, 'dist');
      const publicDir = resolve(__dirname, 'public');
      const generatedEntries = ['assets', 'index.html', 'app.config.json'];

      if (existsSync(publicDir)) {
        generatedEntries.push(...readdirSync(publicDir));
      }

      for (const entry of new Set(generatedEntries)) {
        rmSync(resolve(outDir, entry), { recursive: true, force: true, maxRetries: 3 });
      }
    }
  };
}

function copyExtraFilesPlugin() {
  return {
    name: 'copy-extra-files',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const srcConfig = resolve(__dirname, 'app.config.json');
      if (existsSync(srcConfig)) {
        copyFileSync(srcConfig, resolve(outDir, 'app.config.json'));
      }
    }
  };
}

function neutralinoInjectPlugin() {
  return {
    name: 'neutralino-inject',
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === 'production' || this?.meta?.watchMode === false) {
        return html.replace(
          '</body>',
          '  <script src="./neutralino.js"></script>\n</body>'
        );
      }
      return html;
    }
  };
}

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: false
  },
  plugins: [cleanWebOutputPlugin(), dataServerPlugin(), copyExtraFilesPlugin(), neutralinoInjectPlugin()]
});
