import { rcedit } from 'rcedit';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.resolve(__dirname, '../app.config.json'), 'utf-8'));
/* exe 版本跟随 package.json，确保与 npm 发布版本一致 */
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const version = pkg.version || config.version;
const exePath = path.resolve(__dirname, `../dist/${config.binaryName}/${config.binaryName}-win_x64.exe`);

await rcedit(exePath, {
  'version-string': {
    FileDescription: config.description || config.name,
    ProductName: config.name,
    CompanyName: config.author || '',
    LegalCopyright: config.copyright || '',
    OriginalFilename: `${config.binaryName}.exe`
  },
  'file-version': version,
  'product-version': version
});

console.log(`Patched exe: ${config.name} v${version}`);
