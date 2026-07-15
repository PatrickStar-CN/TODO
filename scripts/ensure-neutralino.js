import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windowsBinary = path.join(projectRoot, 'bin', 'neutralino-win_x64.exe');

if (existsSync(windowsBinary)) {
  console.log('Neutralino runtime is ready.');
  process.exit(0);
}

console.log('Neutralino runtime is missing; downloading configured binaries...');

const neuCli = path.join(projectRoot, 'node_modules', '@neutralinojs', 'neu', 'bin', 'neu.js');
if (!existsSync(neuCli)) {
  throw new Error('Neutralino CLI is not installed. Run "npm install" first.');
}

const result = spawnSync(process.execPath, [neuCli, 'update'], {
  cwd: projectRoot,
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0 || !existsSync(windowsBinary)) {
  throw new Error('Neutralino runtime download failed. Check the network, then run "npx neu update".');
}

console.log('Neutralino runtime downloaded.');
