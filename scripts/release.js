/* 发布辅助：把 neu:build 产物打包为单个 zip 并生成 SHA-256 校验文件，
   随后输出 gh release create 命令（需本机已安装并登录 GitHub CLI）。
   用法：npm run neu:build 之后执行 `npm run release -- <版本号>`（版本号不带 v 前缀），
   版本号必须与 package.json 的 version 一致。 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const tag = String(process.argv[2] || '').replace(/^v/i, '');
if (!tag) {
  console.error('用法: npm run release -- <版本号>（不带 v 前缀）');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));
if (pkg.version !== tag) {
  console.error(`package.json 版本（${pkg.version}）与目标版本（${tag}）不一致，请先更新 package.json`);
  process.exit(1);
}

const appDir = path.join(root, 'dist', 'todo-tools');
const exe = path.join(appDir, 'todo-tools-win_x64.exe');
const res = path.join(appDir, 'resources.neu');
for (const f of [exe, res]) {
  if (!existsSync(f)) {
    console.error(`缺少构建产物: ${f}（请先执行 npm run neu:build）`);
    process.exit(1);
  }
}

const releaseDir = path.join(root, 'release');
mkdirSync(releaseDir, { recursive: true });
const zipPath = path.join(releaseDir, 'todo-tools-win_x64.zip');
const shaPath = path.join(releaseDir, 'todo-tools-win_x64.zip.sha256');

execSync(
  `powershell -NoProfile -NonInteractive -Command "Compress-Archive -LiteralPath '${exe}','${res}' -DestinationPath '${zipPath}' -Force"`,
  { stdio: 'inherit' }
);
const hash = execSync(
  `powershell -NoProfile -NonInteractive -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '${zipPath}').Hash.ToLower()"`
).toString().trim();
writeFileSync(shaPath, `${hash}\n`);

console.log(`\n已生成发布产物:`);
console.log(`  ${zipPath}`);
console.log(`  ${shaPath}`);
console.log(`  SHA-256: ${hash}`);
console.log(`\n发布命令（确认 Release 草稿内容后执行）:`);
console.log(`  gh release create v${tag} ${zipPath} ${shaPath} --title "TODO Tools v${tag}" --notes "更新内容说明"`);
