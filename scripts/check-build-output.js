import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const neutralinoConfig = JSON.parse(
  readFileSync(path.join(projectRoot, 'neutralino.config.json'), 'utf-8')
);
const distributionPath = neutralinoConfig.cli?.distributionPath || 'dist';
const binaryName = neutralinoConfig.cli?.binaryName;
const exePath = path.resolve(
  projectRoot,
  distributionPath,
  binaryName,
  `${binaryName}-win_x64.exe`
);

if (!existsSync(exePath)) process.exit(0);

try {
  const file = openSync(exePath, 'r+');
  closeSync(file);
} catch (error) {
  if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
    console.error(`Build output is in use: ${exePath}`);
    console.error('Exit TODO Tools from the Windows system tray, then run "npm run neu:build" again.');
    process.exit(1);
  }
  throw error;
}
