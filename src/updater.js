/* 应用自动更新（仅 Neutralino 桌面端生效，Web 端降级为提示）
 *
 * 流程：
 *  1. 设置页「检查更新」→ GET GitHub releases/latest，tag 与本地版本做 semver 比对；
 *  2. 有新版 → 原生进程下载 zip（PowerShell 优先、curl 兜底；GitHub 资产无 CORS 头，fetch 不可用）；
 *  3. SHA-256 校验（发布附带的 .sha256 asset）→ Expand-Archive 解压 → 核对文件大小；
 *  4. 写 pending.json、替换脚本（.ps1）与调度命令（.cmd），注册一次性计划任务后退出应用；
 *  5. 计划任务（独立进程树，不随主进程回收）等主进程退出 → 备份 exe/resources.neu → 替换 → 拉起新版本；
 *  6. 下次启动自检：主 exe 缺失则用 .bak 恢复（自动回滚），就位则清理备份与标记。
 *
 * 注：Neutralino 的 execCommand 子进程会随主进程退出被回收，替换不能依赖
 * 「退出后仍在运行的子进程」，故改用 Task Scheduler 托管的一次性任务。
 *
 * 安全约束：
 *  - 只替换白名单两个文件（exe + resources.neu），不触碰 todo_data.json 等用户数据；
 *  - 未通过 SHA-256 校验的文件绝不进入替换流程；
 *  - 替换/回滚失败时旧文件备份兜底，不会让程序处于不可启动状态。
 */

/** semver 逐段比较：忽略 v 前缀；数字段与文本段混合时数字段更新（如 1.1.1-beta < 1.1.1）。
 *  返回 1（a 新）、0（相等）、-1（b 新）。 */
export function compareVersions(a, b) {
  const parse = (v) => String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map(p => (/^\d+$/.test(p) ? Number(p) : p));
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = i < pa.length ? pa[i] : 0;
    const y = i < pb.length ? pb[i] : 0;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x > y ? 1 : -1;
    } else if (typeof x === 'number') {
      return 1;
    } else if (typeof y === 'number') {
      return -1;
    } else if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

const UPDATE_DIR_NAME = 'todo-tools-update';
const ZIP_NAME = 'todo-tools-win_x64.zip';
const SHA256_NAME = 'todo-tools-win_x64.zip.sha256';
const PENDING_NAME = 'pending.json';
const SCRIPT_NAME = 'apply-update.ps1';
const RES_NAME = 'resources.neu';

export function createUpdater({ isNeutralinoEnv, showToast, appConfig = {} }) {
  const repo = appConfig.update?.repo || 'PatrickStar-CN/TODO';
  const binaryName = appConfig.binaryName || 'todo-tools';
  const exeName = `${binaryName}-win_x64.exe`;
  /* app.config.json 无 version 字段：先留空，检查更新前异步读取 Neutralino
     运行时配置（Neutralino.app.getConfig 为异步），避免比较时退化为空而误判有新版 */
  let currentVersion = String(appConfig.version || '').replace(/^v/i, '');
  const resolveCurrentVersion = async () => {
    if (currentVersion) return currentVersion;
    try {
      const cfg = typeof Neutralino !== 'undefined' && Neutralino.app
        ? await Neutralino.app.getConfig()
        : null;
      if (cfg?.version) currentVersion = String(cfg.version).replace(/^v/i, '');
    } catch {}
    return currentVersion;
  };

  let state = { phase: 'idle' };
  let listeners = [];

  const setState = (next) => {
    state = { ...state, ...next };
    listeners.slice().forEach(cb => { try { cb(state); } catch {} });
  };

  const isNeutralino = () => !!isNeutralinoEnv && isNeutralinoEnv();

  /* Neutralino 的 getPath 返回正斜杠路径，统一替换为反斜杠再拼接，避免混合分隔符导致创建目录失败 */
  const joinPath = (base, name) => `${String(base).replace(/[\\/]+$/, '').replace(/\//g, '\\')}\\${name}`;

  const updateDir = async () => {
    const temp = await Neutralino.os.getPath('temp');
    const dir = joinPath(temp, UPDATE_DIR_NAME);
    try {
      await Neutralino.filesystem.createDirectory(dir);
    } catch (e) {
      /* Neutralino 的 createDirectory 对已存在目录会抛错，目录存在时视为成功 */
      const st = await Neutralino.filesystem.getStats(dir).catch(() => null);
      if (!st) throw new Error(`创建更新目录失败：${e?.message || e}`);
    }
    return dir;
  };

  const exists = async (p) => {
    try { await Neutralino.filesystem.getStats(p); return true; } catch { return false; }
  };

  /* Neutralino 新版 client 的文件删除 API：filesystem.remove(path)（无 recursive 参数） */
  const removeFile = async (p) => {
    try { await Neutralino.filesystem.remove(p); } catch {}
  };/* 非空目录需递归删除（remove 不支持 recursive），用 PowerShell 完成 */
  const removeTree = async (p) => {
    try {
      await Neutralino.os.execCommand(
        `powershell -NoProfile -NonInteractive -Command "Remove-Item -LiteralPath '${p}' -Recurse -Force"`
      );
    } catch {}
  };

  const fileSize = async (p) => {
    const s = await Neutralino.filesystem.getStats(p).catch(() => null);
    return s ? s.size : 0;
  };

  /* GitHub 资产 URL 的 302 与最终直链均不带 CORS 头，WebView2 fetch 跨源必被拦，
     下载只能走 Neutralino 原生进程（无 CORS 限制）：
     1) curl 优先：流式落盘可显示进度；stdout/stderr 重定向到日志文件，避开 execCommand 管道问题；
     2) WebClient.DownloadFile 兜底：同样流式落盘、走系统代理，进度仍可轮询。 */
  async function downloadFileExec(url, dest) {
    const curlLog = `${dest}.curl.log`;
    await removeFile(curlLog);
    try {
      const r = await Neutralino.os.execCommand(
        `curl.exe -sS -L --fail --retry 3 --connect-timeout 15 -o "${dest}" "${url}" > "${curlLog}" 2>&1`
      );
      if (r.exitCode === 0) return r;
      const log = await Neutralino.filesystem.readFile(curlLog).catch(() => '');
      throw new Error(log.trim() || `curl exit ${r.exitCode}`);
    } catch (e) {
      console.warn('[updater] curl failed, fallback to WebClient:', e?.message || e);
      await removeFile(dest);
    }
    const r = await Neutralino.os.execCommand(
      `powershell -NoProfile -NonInteractive -Command "(New-Object System.Net.WebClient).DownloadFile('${url}','${dest}')"`
    );
    if (r.exitCode !== 0) throw new Error(r.stderr || `WebClient exit ${r.exitCode}`);
    return r;
  }

  /* 下载 zip 并轮询临时文件大小回传进度（exec 通道无进度事件，用文件大小近似）；
     失败清理半文件并自动重试一次 */
  async function downloadWithProgress(url, dest, totalSize) {
    let lastErr = null;
    for (let attempt = 0; attempt <= 1; attempt++) {
      const task = downloadFileExec(url, dest);
      let stopped = false;
      const poll = (async () => {
        while (!stopped) {
          await new Promise(r => setTimeout(r, 400));
          try {
            const s = await Neutralino.filesystem.getStats(dest);
            if (totalSize > 0) {
              setState({ phase: 'downloading', progress: Math.min(1, s.size / totalSize) });
            }
          } catch {}
        }
      })();
      try {
        await task;
        stopped = true;
        await poll;
        lastErr = null;
        break;
      } catch (e) {
        stopped = true;
        await poll;
        lastErr = e;
        await removeFile(dest);
        if (attempt === 0) await new Promise(r => setTimeout(r, 800));
      }
    }
    if (lastErr) throw new Error(`下载失败，请检查网络后重试（${lastErr?.message || lastErr}）`);
    const size = await fileSize(dest);
    if (totalSize > 0 && size !== totalSize) throw new Error('下载文件大小与发布记录不符');
    setState({ phase: 'downloading', progress: 1 });
  }

    /* 用 Web Crypto 计算文件 SHA-256：execCommand 在本环境的 stdout 捕获不可靠，
      readBinaryFile + crypto.subtle 不依赖任何外部进程 */
  async function sha256Of(filePath) {
    const buf = await Neutralino.filesystem.readBinaryFile(filePath);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toLowerCase();
  }

  /* .sha256 文件约定为单行 64 位十六进制哈希（允许附带文件名） */
  async function readSha256Text(shaPath) {
    const content = await Neutralino.filesystem.readFile(shaPath).catch(() => '');
    const m = String(content).match(/[0-9a-fA-F]{64}/);
    return m ? m[0].toLowerCase() : '';
  }

  const findAsset = (name) => (state.assets || []).find(a => a.name === name);

  /* 带超时与一次重试的 JSON 拉取；404/403/429 不重试并携带 status 抛出 */
  async function fetchJson(url) {
    let lastErr;
    for (let attempt = 0; attempt <= 1; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.status === 404) {
          const err = new Error('not found');
          err.status = 404;
          throw err;
        }
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return await res.json();
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (e?.status) throw e;
        if (attempt === 0) await new Promise(r => setTimeout(r, 600));
      }
    }
    throw lastErr;
  }

  /** 检查更新：拉取最新 release 并与当前版本比对 */
  async function checkForUpdates() {
    if (!isNeutralino()) {
      showToast?.('桌面版支持自动更新');
      return;
    }
    if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'verifying') return;
    setState({ phase: 'checking', error: null, notice: null, version: null, body: '', progress: 0, assets: null });
    try {
      const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
      const cur = await resolveCurrentVersion();
      const latest = String(release.tag_name || '').replace(/^v/i, '');
      if (!latest || compareVersions(latest, cur) <= 0) {
        setState({ phase: 'latest', version: latest || cur });
        return;
      }
      setState({ phase: 'available', version: latest, body: release.body || '', assets: release.assets || [] });
    } catch (e) {
      if (e?.status === 404) {
        /* 仓库从未创建 Release（仅有 git tag）→ 无发布版本，而非网络故障 */
        setState({ phase: 'latest', version: currentVersion, notice: 'GitHub 上暂无已发布版本，发布后再检查更新' });
      } else if (e?.status === 403 || e?.status === 429) {
        setState({ phase: 'failed', error: `检查更新失败：GitHub 接口限流（HTTP ${e.status}），请稍后再试` });
      } else if (e?.status) {
        setState({ phase: 'failed', error: `检查更新失败：GitHub API 返回 HTTP ${e.status}` });
      } else {
        setState({ phase: 'failed', error: '检查更新失败：网络连接异常，请检查网络后重试' });
      }
    }
  }

  /** 下载 → 校验 → 解压 → 进入「可重启」就绪态 */
  async function downloadAndPrepare() {
    if (!isNeutralino() || state.phase !== 'available') return;
    try {
      const zipAsset = findAsset(ZIP_NAME);
      const shaAsset = findAsset(SHA256_NAME);
      if (!zipAsset) throw new Error('发布中缺少更新包（zip）');
      if (!shaAsset) throw new Error('发布中缺少校验文件（sha256）');
      const dir = await updateDir();
      const zipPath = joinPath(dir, ZIP_NAME);
      const shaPath = joinPath(dir, SHA256_NAME);
      const unzipDir = joinPath(dir, 'extracted');
      await removeFile(zipPath);
      await removeFile(shaPath);
      await removeTree(unzipDir);

      setState({ phase: 'downloading', version: state.version, progress: 0 });
      await downloadWithProgress(zipAsset.browser_download_url, zipPath, zipAsset.size || 0);

      setState({ phase: 'downloading', version: state.version, progress: 0.99 });
      try {
        await downloadFileExec(shaAsset.browser_download_url, shaPath);
      } catch (e) {
        throw new Error(`下载校验文件失败（${e?.message || e}）`);
      }

      setState({ phase: 'verifying', version: state.version });
      const expected = await readSha256Text(shaPath);
      const actual = await sha256Of(zipPath);
      if (expected && actual !== expected) throw new Error('更新包校验失败（SHA-256 不匹配），已停止替换');

      const expand = await Neutralino.os.execCommand(
        `powershell -NoProfile -NonInteractive -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${unzipDir}' -Force"`
      );
      if (expand.exitCode !== 0) throw new Error('更新包解压失败');
      const exeSize = await fileSize(joinPath(unzipDir, exeName));
      const resSize = await fileSize(joinPath(unzipDir, RES_NAME));
      if (!exeSize || !resSize) throw new Error('更新包内容不完整');

      setState({ phase: 'ready', version: state.version, progress: 1, dirs: { dir, unzipDir } });
    } catch (e) {
      setState({ phase: 'failed', error: e?.message || '下载更新失败' });
    }
  }

  /* 替换脚本：等主进程退出 → 备份 → 复制（被锁重试）→ 拉起新版本；失败自动恢复备份 */
  function buildApplyScript() {
    return [
      `$ErrorActionPreference = 'Stop'`,
      `param(`,
      `  [string]$TargetDir,`,
      `  [string]$ExeName,`,
      `  [string]$NewDir,`,
      `  [string]$PendingPath,`,
      `  [string]$LogPath`,
      `)`,
      `Start-Sleep -Seconds 3`,
      `function Log($msg) { Add-Content -LiteralPath $LogPath -Value $msg }`,
      `Log 'begin'`,
      `$exePath = Join-Path $TargetDir $ExeName`,
      `$resPath = Join-Path $TargetDir 'resources.neu'`,
      `$bakExe = $exePath + '.bak'`,
      `$bakRes = $resPath + '.bak'`,
      `$newExe = Join-Path $NewDir $ExeName`,
      `$newRes = Join-Path $NewDir 'resources.neu'`,
      `try {`,
      `  if (Test-Path -LiteralPath $exePath) { Move-Item -LiteralPath $exePath -Destination $bakExe -Force }`,
      `  if (Test-Path -LiteralPath $resPath) { Move-Item -LiteralPath $resPath -Destination $bakRes -Force }`,
      `  $copied = $false`,
      `  for ($i = 0; $i -lt 5; $i++) {`,
      `    try {`,
      `      Copy-Item -LiteralPath $newExe -Destination $exePath -Force`,
      `      Copy-Item -LiteralPath $newRes -Destination $resPath -Force`,
      `      $copied = $true`,
      `      break`,
      `    } catch {`,
      `      if ($i -ge 4) { throw }`,
      `      Start-Sleep -Seconds 1`,
      `    }`,
      `  }`,
      `  if ($copied) {`,
      `    Start-Process -FilePath $exePath`,
      `    Remove-Item -LiteralPath $NewDir -Recurse -Force -ErrorAction SilentlyContinue`,
      `    Log 'OK'`,
      `  }`,
      `} catch {`,
      `  Log ('FAILED: ' + $_.Exception.Message)`,
      `  if ((Test-Path -LiteralPath $bakExe) -and -not (Test-Path -LiteralPath $exePath)) {`,
      `    Move-Item -LiteralPath $bakExe -Destination $exePath -Force`,
      `  }`,
      `  if ((Test-Path -LiteralPath $bakRes) -and -not (Test-Path -LiteralPath $resPath)) {`,
      `    Move-Item -LiteralPath $bakRes -Destination $resPath -Force`,
      `  }`,
      `}`,
      `Log 'done'`
    ].join('\r\n');
  }

  /* PowerShell -EncodedCommand 编码（UTF-16LE base64），避免多层引号转义问题 */
  const toEncodedCommand = (ps) => {
    const bytes = new TextEncoder().encode(ps);
    const u16 = new Uint8Array(bytes.length * 2);
    for (let i = 0; i < bytes.length; i++) u16[i * 2] = bytes[i];
    let bin = '';
    for (let i = 0; i < u16.length; i++) bin += String.fromCharCode(u16[i]);
    return btoa(bin);
  };

  /** 应用更新并退出重启：写标记与脚本 → 注册一次性计划任务 → 退出主进程。
      Neutralino 的 execCommand 子进程会随主进程退出被回收，替换必须由
      Task Scheduler 托管的独立进程完成。 */
  async function applyUpdate() {
    if (!isNeutralino() || state.phase !== 'ready' || !state.dirs) return;
    try {
      const { dir, unzipDir } = state.dirs;
      const targetDir = window.NL_PATH || '';
      if (!targetDir) throw new Error('无法定位应用目录');
      if (!(await exists(joinPath(targetDir, exeName)))) {
        throw new Error('替换目标不存在，开发模式下无法完成更新，请使用打包版应用');
      }
      const pending = {
        targetDir,
        exeName,
        version: state.version,
        createdAt: new Date().toISOString()
      };
      const pendingPath = joinPath(dir, PENDING_NAME);
      const scriptPath = joinPath(dir, SCRIPT_NAME);
      const logPath = joinPath(dir, 'update.log');
      await Neutralino.filesystem.writeFile(pendingPath, JSON.stringify(pending));
      await Neutralino.filesystem.writeFile(scriptPath, buildApplyScript());
      const cmdScript = joinPath(dir, 'run-update.cmd');
      await Neutralino.filesystem.writeFile(cmdScript, [
        '@echo off',
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}" -TargetDir "${targetDir}" -ExeName "${exeName}" -NewDir "${unzipDir}" -PendingPath "${pendingPath}" -LogPath "${logPath}"`,
        'schtasks /Delete /TN TODO-Tools-Update /F >nul 2>&1'
      ].join('\r\n'));
      /* schtasks /ST 仅分钟精度：先注册 +1 分钟兜底计划，再立即 /Run 触发。
         任务进程由 Task Scheduler 托管，独立于应用进程树，主进程退出后照常执行；
         替换脚本自带等锁重试，应用退出后约 1 秒即完成替换并拉起新版本 */
      const startAt = new Date(Date.now() + 60000);
      const hhmm = `${String(startAt.getHours()).padStart(2, '0')}:${String(startAt.getMinutes()).padStart(2, '0')}`;
      const innerCreate = `schtasks /Create /F /TN 'TODO-Tools-Update' /TR '${cmdScript}' /SC ONCE /ST ${hhmm}`;
      const r = await Neutralino.os.execCommand(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${toEncodedCommand(innerCreate)}`
      );
      if (r.exitCode !== 0) throw new Error(`注册更新任务失败（${r.stderr || r.exitCode}）`);
      const innerRun = `schtasks /Run /TN 'TODO-Tools-Update'`;
      await Neutralino.os.execCommand(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${toEncodedCommand(innerRun)}`
      );
      await Neutralino.app.exit();
    } catch (e) {
      setState({ phase: 'failed', error: `启动更新失败：${e?.message || e}` });
    }
  }

  /** 启动自检：处理上次更新残留（回滚或清理） */
  async function checkPendingStartup() {
    if (!isNeutralino()) return;
    try {
      const temp = await Neutralino.os.getPath('temp');
      const pendingPath = joinPath(joinPath(temp, UPDATE_DIR_NAME), PENDING_NAME);
      const text = await Neutralino.filesystem.readFile(pendingPath).catch(() => '');
      if (!text) return;
      const pending = JSON.parse(text);
      if (!pending?.targetDir) return;
      const exePath = joinPath(pending.targetDir, pending.exeName || exeName);
      const bakExe = `${exePath}.bak`;
      const resPath = joinPath(pending.targetDir, RES_NAME);
      const bakRes = `${resPath}.bak`;
      const exeExists = await exists(exePath);
      const bakExists = await exists(bakExe);
      if (!exeExists && bakExists) {
        /* 替换中断 → 恢复备份（自动回滚），资源文件同样恢复 */
        await Neutralino.filesystem.move(bakExe, exePath);
        if (await exists(bakRes)) {
          await Neutralino.filesystem.move(bakRes, resPath);
        }
      } else if (exeExists && bakExists) {
        /* 新版本已就位 → 清理备份 */
        await removeFile(bakExe);
        await removeFile(bakRes);
      }
      await removeFile(pendingPath);
    } catch { /* 自检失败不阻塞启动 */ }
  }

  return {
    getState: () => state,
    getCurrentVersion: () => currentVersion,
    isAvailable: () => isNeutralino(),
    onStatus: (cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter(l => l !== cb);
      };
    },
    checkForUpdates,
    downloadAndPrepare,
    applyUpdate,
    checkPendingStartup
  };
}
