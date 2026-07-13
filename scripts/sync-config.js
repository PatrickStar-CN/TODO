import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.resolve(__dirname, '../app.config.json'), 'utf-8'));
/* 版本以 package.json 为唯一真相源 */
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const neuConfigPath = path.resolve(__dirname, '../neutralino.config.json');
const currentNeuConfigText = readFileSync(neuConfigPath, 'utf-8');
const neuConfig = JSON.parse(currentNeuConfigText);

neuConfig.version = pkg.version;
neuConfig.modes.window.title = config.windowTitle || config.name;
neuConfig.modes.window.width = config.windowWidth || 1100;
neuConfig.modes.window.height = config.windowHeight || 700;
neuConfig.modes.window.minWidth = config.minWidth || 800;
neuConfig.modes.window.minHeight = config.minHeight || 500;
neuConfig.cli.binaryName = config.binaryName;

const nextNeuConfigText = JSON.stringify(neuConfig, null, 2) + '\n';
if (nextNeuConfigText !== currentNeuConfigText) {
  writeFileSync(neuConfigPath, nextNeuConfigText);
  console.log(`Synced neutralino.config.json from app.config.json (version ${pkg.version} from package.json)`);
} else {
  console.log(`neutralino.config.json already in sync (version ${pkg.version})`);
}
