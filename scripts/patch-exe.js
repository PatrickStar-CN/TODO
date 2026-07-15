import { rcedit } from 'rcedit';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.resolve(__dirname, '../app.config.json'), 'utf-8'));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const neutralinoConfig = JSON.parse(readFileSync(path.resolve(__dirname, '../neutralino.config.json'), 'utf-8'));
const version = pkg.version || config.version;
const distributionPath = neutralinoConfig.cli?.distributionPath || 'dist';
const binaryName = neutralinoConfig.cli?.binaryName || config.binaryName;
const exePath = path.resolve(__dirname, '..', distributionPath, binaryName, `${binaryName}-win_x64.exe`);

if (!existsSync(exePath)) {
  throw new Error(
    `Neutralino Windows executable was not generated: ${exePath}. ` +
    'Run "npx neu update" to install the runtime binaries, then build again.'
  );
}

await rcedit(exePath, {
  'version-string': {
    FileDescription: config.description || config.name,
    ProductName: config.name,
    CompanyName: config.author || '',
    LegalCopyright: config.copyright || '',
    OriginalFilename: `${binaryName}.exe`
  },
  'file-version': version,
  'product-version': version
});

console.log(`Patched exe: ${config.name} v${version}`);
