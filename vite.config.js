import { defineConfig } from 'vite';
import dataServerPlugin from './server-plugin.js';

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
  plugins: [dataServerPlugin(), neutralinoInjectPlugin()]
});
