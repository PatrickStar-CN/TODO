import { rcedit } from 'rcedit';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.resolve(__dirname, '../app.config.json'), 'utf-8'));
const exePath = path.resolve(__dirname, `../dist/${config.binaryName}/${config.binaryName}-win_x64.exe`);

await rcedit(exePath, {
  'version-string': {
    FileDescription: config.description || config.name,
    ProductName: config.name,
    CompanyName: config.author || '',
    LegalCopyright: config.copyright || '',
    OriginalFilename: `${config.binaryName}.exe`
  },
  'file-version': config.version,
  'product-version': config.version
});

console.log(`Patched exe: ${config.name} v${config.version}`);
