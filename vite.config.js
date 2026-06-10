import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dataServerPlugin from './server-plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    assetsDir: 'assets'
  },
  plugins: [dataServerPlugin(), copyExtraFilesPlugin(), neutralinoInjectPlugin()]
});
