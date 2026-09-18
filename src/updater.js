/* 应用自动更新（仅 Neutralino 桌面端生效，Web 端降级为提示）
 *
 * 流程：
 *  1. 设置页「检查更新」→ GET GitHub releases/latest，tag 与本地版本做 semver 比对
 *     （30s 超时；非版本号形态 tag 无法解析时保守判定为无更新）；
 *  2. 有新版 → 原生进程下载 zip（HttpWebRequest 优先、curl 兜底且带总超时；
 *     GitHub 资产无 CORS 头，fetch 不可用；下载支持逻辑取消，取消后回到可重试态）；
 *  3. SHA-256 校验（发布附带的 .sha256 asset；取不到期望哈希则直接失败，绝不跳过）
 *     → Expand-Archive 解压 → 核对文件大小；
 *  4. 写 pending.json 与替换脚本（.ps1），注册一次性计划任务后退出应用;
 *  5. 计划任务（独立进程树，不随主进程回收）等主进程退出 → 备份 exe/resources.neu → 替换 → 拉起新版本；
 *  6. 下次启动自检：按 pending.version 与运行版本比对判定成败——成功清理备份，
 *     失败成对回滚（避免 exe 新 + res 旧混搭）并清理标记。
 *
 * 注：Neutralino 的 execCommand 子进程会随主进程退出被回收，替换不能依赖
 * 「退出后仍在运行的子进程」，故改用 Task Scheduler 托管的一次性任务。
 *
 * 安全约束：
 *  - 只替换白名单两个文件（exe + resources.neu），不触碰 todo_data.json 等用户数据；
 *  - 未通过 SHA-256 校验的文件绝不进入替换流程；
 *  - 替换/回滚失败时旧文件备份兜底，不会让程序处于不可启动状态。
 */

import { isNeutralinoEnv } from './shared.js';

/** semver 逐段比较：忽略 v 前缀；数字段与文本段混合时数字段更新（如 1.1.1-beta < 1.1.1）。
 *  空版本视为最旧（本地版本未知时允许提示更新）；
 *  非版本号形态的 tag（如 release-1.0.0）无法解析时保守返回 0，避免误报更新。
 *  返回 1（a 新）、0（相等或无法判定）、-1（b 新）。 */
export function compareVersions(a, b) {
  const parse = (v) => {
    /* semver 构建元数据（+ 后缀）不参与优先级比较 */
    const s = String(v ?? '').trim().replace(/^v/i, '').split('+')[0];
    if (!s) return [];
    if (!/^\d/.test(s)) return null;
    return s.split(/[.-]/).map(p => (/^\d+$/.test(p) ? Number(p) : p));
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa === null || pb === null) return 0;
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

/* PowerShell -EncodedCommand 编码：必须按 UTF-16LE 编码后 base64。
 * 旧实现按 UTF-8 字节逐个补零，仅 ASCII 正确；TEMP 路径含 CJK（中文用户名）时会变成乱码，
 * 导致计划任务注册出乱码 /TR。此处按码点遍历并正确处理代理对（emoji 等）。 */
export function toEncodedCommand(ps) {
  const units = [];
  for (const ch of String(ps)) {
    const cp = ch.codePointAt(0);
    if (cp > 0xFFFF) {
        const v = cp - 0x10000;
        units.push((v >> 10) + 0xD800, (v & 0x3FF) + 0xDC00);
    } else {
      units.push(cp);
    }
  }
  let bin = '';
  for (const u of units) bin += String.fromCharCode(u & 0xFF, u >> 8);
  return btoa(bin);
}

/* 计划任务 /TR 值：整体用单引号包裹以兼容含空格路径；路径内单引号按 PowerShell 规则双写转义。
 * schtasks.exe 收到时外层单引号已由 PowerShell 去掉，内层双引号原样保留，
 * 任务计划程序启动时 -File 参数可正确解析含空格/中文路径。 */
export function buildUpdateTaskRun(scriptPath) {
  const safe = String(scriptPath).replace(/'/g, "''");
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${safe}"`;
}

export function createUpdater({ showToast, appConfig = {} }) {
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
  /* 下载取消标记：execCommand 无中止接口，取消为逻辑取消——后台下载完成后丢弃结果并回到 available */
  let cancelRequested = false;
  const cancelledError = () => {
    const err = new Error('已取消下载');
    err.cancelled = true;
    return err;
  };

  const setState = (next) => {
    state = { ...state, ...next };
    listeners.slice().forEach(cb => { try { cb(state); } catch {} });
  };

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

  /* 用备份恢复目标：move 优先（目标不存在时一次成功）；目标已存在导致 move 失败时，
     先移除目标再恢复；两步都失败则保留现场并记日志，不让程序处于不可启动状态 */
  const restoreBak = async (bak, target) => {
    if (!(await exists(bak))) return;
    try {
      await Neutralino.filesystem.move(bak, target);
      return;
    } catch {}
    try {
      await removeFile(target);
      await Neutralino.filesystem.move(bak, target);
    } catch (e) {
      console.warn('[updater] rollback failed:', e?.message || e);
    }
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
     1) HttpWebRequest 优先：走系统代理（curl 不读系统代理，直连易超时），显式 30s 超时防卡死，
        流式落盘可轮询进度；
     2) curl 兜底：流式落盘，stdout/stderr 重定向到日志文件。 */
  async function downloadFileExec(url, dest) {
    let r = await Neutralino.os.execCommand(
      `powershell -NoProfile -NonInteractive -Command "try { [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12; $req=[System.Net.WebRequest]::Create('${url}'); $req.Method='GET'; $req.Timeout=30000; $req.ReadWriteTimeout=30000; $req.Proxy=[System.Net.WebRequest]::GetSystemWebProxy(); $resp=$req.GetResponse(); $in=$resp.GetResponseStream(); $out=[System.IO.File]::Create('${dest}'); $in.CopyTo($out); $out.Close(); $in.Close(); $resp.Close() } catch { exit 1 }"`
    );
    if (r.exitCode === 0) return r;
    console.warn('[updater] WebClient failed, fallback to curl:', r.stdErr || r.exitCode);
    await removeFile(dest);
    const curlLog = `${dest}.curl.log`;
    await removeFile(curlLog);
    r = await Neutralino.os.execCommand(
      `curl.exe -sS -L --fail --retry 3 --connect-timeout 15 --max-time 300 -o "${dest}" "${url}" > "${curlLog}" 2>&1`
    );
    if (r.exitCode !== 0) {
      const log = await Neutralino.filesystem.readFile(curlLog).catch(() => '');
      throw new Error(log.trim() || `curl exit ${r.exitCode}`);
    }
    return r;
  }

  /* 下载 zip 并轮询临时文件大小回传进度（exec 通道无进度事件，用文件大小近似）；
     失败清理半文件并自动重试一次；取消后丢弃结果回到 available */
  async function downloadWithProgress(url, dest, totalSize) {
    let lastErr = null;
    for (let attempt = 0; attempt <= 1; attempt++) {
      if (cancelRequested) throw cancelledError();
      const task = downloadFileExec(url, dest);
      let stopped = false;
      const poll = (async () => {
        while (!stopped && !cancelRequested) {
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
        if (cancelRequested) throw cancelledError();
        lastErr = null;
        break;
      } catch (e) {
        stopped = true;
        await poll;
        lastErr = e;
        await removeFile(dest);
        if (e?.cancelled) break;
        if (attempt === 0) await new Promise(r => setTimeout(r, 800));
      }
    }
    if (lastErr?.cancelled) throw lastErr;
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

  /* GitHub API JSON 通过原生进程拉取：HttpWebRequest 走系统代理（WebView2 fetch 直连会超时），
     显式 30s 超时避免无响应卡死；附带 GitHub 推荐请求头（User-Agent/Accept/X-GitHub-Api-Version）。
     结果写入临时文件再读取（execCommand 的 stdout 捕获不可靠，不用重定向输出）。
     HTTP 状态码以进程退出码透传，调用方据此区分 404（无发布版本）/ 403·429（限流）/ 其他错误。 */
  async function fetchJson(url) {
    const dir = await updateDir();
    const jsonPath = joinPath(dir, 'latest-release.json');
    await removeFile(jsonPath);
    const ps = `try { [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12; $req=[System.Net.WebRequest]::Create('${url}'); $req.Method='GET'; $req.Timeout=30000; $req.ReadWriteTimeout=30000; $req.Proxy=[System.Net.WebRequest]::GetSystemWebProxy(); $req.UserAgent='TODO-Tools-Updater'; $req.Accept='application/vnd.github+json'; $req.Headers['X-GitHub-Api-Version']='2022-11-28'; $resp=$req.GetResponse(); $sr=New-Object System.IO.StreamReader($resp.GetResponseStream(),[System.Text.Encoding]::UTF8); $d=$sr.ReadToEnd(); $sr.Close(); $resp.Close(); [System.IO.File]::WriteAllText('${jsonPath}',$d,[System.Text.Encoding]::UTF8) } catch { $code=1; $ex=$_.Exception; while ($ex) { if ($ex.Response) { try { $code=[int]$ex.Response.StatusCode; break } catch {} }; $ex=$ex.InnerException }; if ($code -ge 100 -and $code -le 599) { exit $code }; exit 1 }`;
    const cmd = `powershell -NoProfile -NonInteractive -Command "${ps}"`;
    let lastErr;
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const r = await Neutralino.os.execCommand(cmd);
        if (r.exitCode !== 0) {
          const err = new Error(`HTTP ${r.exitCode}`);
          err.status = r.exitCode;
          throw err;
        }
        const data = JSON.parse(await Neutralino.filesystem.readFile(jsonPath));
        await removeFile(jsonPath);
        return data;
      } catch (e) {
        lastErr = e;
        /* HTTP 状态明确（404 无发布/403·429 限流/5xx）时重试无意义，仅网络异常与解析失败重试一次 */
        if (e?.status || attempt > 0) break;
        await new Promise(r => setTimeout(r, 600));
      }
    }
    throw lastErr;
  }

  /** 检查更新：拉取最新 release 并与当前版本比对 */
  async function checkForUpdates() {
    if (!isNeutralinoEnv()) {
      showToast?.('桌面版支持自动更新');
      return;
    }
    if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'verifying') return;
    setState({ phase: 'checking', error: null, notice: null, version: null, body: '', progress: 0, assets: null });
    /* 先解析本地版本：404 等失败分支也要能展示当前版本，而不是空 */
    const cur = await resolveCurrentVersion();
    try {
      const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
      const latest = String(release.tag_name || '').replace(/^v/i, '');
      if (!latest || compareVersions(latest, cur) <= 0) {
        /* 本地已是最新（或本地更新）时展示本地版本，避免误显示远端旧版本号 */
        setState({ phase: 'latest', version: cur || latest });
        return;
      }
      setState({ phase: 'available', version: latest, body: release.body || '', assets: release.assets || [] });
    } catch (e) {
      if (e?.status === 404) {
        /* 仓库从未创建 Release（仅有 git tag）→ 无发布版本，而非网络故障 */
        setState({ phase: 'latest', version: cur || currentVersion, notice: 'GitHub 上暂无已发布版本，发布后再检查更新' });
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
    if (!isNeutralinoEnv() || state.phase !== 'available') return;
    cancelRequested = false;
    /* 取消/失败时恢复到可重试的 available 态，需保留版本与资产信息 */
    const { version, body, assets } = state;
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

      setState({ phase: 'downloading', version, progress: 0 });
      await downloadWithProgress(zipAsset.browser_download_url, zipPath, zipAsset.size || 0);

      setState({ phase: 'downloading', version, progress: 0.99 });
      try {
        await downloadFileExec(shaAsset.browser_download_url, shaPath);
      } catch (e) {
        if (e?.cancelled) throw e;
        throw new Error(`下载校验文件失败（${e?.message || e}）`);
      }

      setState({ phase: 'verifying', version });
      const expected = await readSha256Text(shaPath);
      /* fail-closed：取不到期望哈希绝不跳过校验 */
      if (!expected) throw new Error('校验文件格式异常（未找到 SHA-256 哈希），已停止替换');
      const actual = await sha256Of(zipPath);
      if (actual !== expected) throw new Error('更新包校验失败（SHA-256 不匹配），已停止替换');

      const expand = await Neutralino.os.execCommand(
        `powershell -NoProfile -NonInteractive -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${unzipDir}' -Force"`
      );
      if (expand.exitCode !== 0) throw new Error('更新包解压失败');
      const exeSize = await fileSize(joinPath(unzipDir, exeName));
      const resSize = await fileSize(joinPath(unzipDir, RES_NAME));
      if (!exeSize || !resSize) throw new Error('更新包内容不完整');

      /* 下载/校验段均可被取消：在进入 ready 前统一检查，避免取消后仍被覆盖为就绪态 */
      if (cancelRequested) throw cancelledError();
      setState({ phase: 'ready', version, progress: 1, dirs: { dir, unzipDir } });
    } catch (e) {
      if (e?.cancelled) {
        setState({ phase: 'available', version, body, assets: assets || [], error: null, notice: null, progress: 0 });
        return;
      }
      setState({ phase: 'failed', error: e?.message || '下载更新失败' });
    }
  }

  /** 取消下载：回到 available 可重试态；后台若仍在下载，完成时丢弃结果 */
  function cancelDownload() {
    if (state.phase !== 'downloading' && state.phase !== 'verifying') return false;
    cancelRequested = true;
    const { version, body, assets } = state;
    setState({ phase: 'available', version, body, assets: assets || [], error: null, notice: null, progress: 0 });
    return true;
  }

  /* 替换脚本：由计划任务以 -File 启动，$PSScriptRoot 即更新目录。
     参数从同目录 pending.json 读取（UTF-8，用 .NET ReadAllText 避免 PowerShell 5.1 按 ANSI 解码中文乱码），
     从而 schtasks /TR 只需一条短命令（/TR 值不能超过 261 字符）。
     流程：等待主进程退出（独占打开探测，最长 20s；超时则继续，靠后续复制重试与回滚兜底）
     → 备份 → 复制（被锁重试）→ 拉起新版本；失败自动恢复备份；最后自删任务。 */
  function buildApplyScript() {
    return [
      `$ErrorActionPreference = 'Stop'`,
      `$dir = $PSScriptRoot`,
      `$log = Join-Path $dir 'update.log'`,
      `function Log($msg) { Add-Content -LiteralPath $log -Value $msg }`,
      `Log 'begin'`,
      `try {`,
      `  $pending = [System.IO.File]::ReadAllText((Join-Path $dir 'pending.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json`,
      `  $targetDir = ($pending.targetDir -replace '/', '\')`,
      `  $exeName = $pending.exeName`,
      `  $newDir = Join-Path $dir 'extracted'`,
      `  $exePath = Join-Path $targetDir $exeName`,
      `  $resPath = Join-Path $targetDir 'resources.neu'`,
      `  $bakExe = $exePath + '.bak'`,
      `  $bakRes = $resPath + '.bak'`,
      `  $newExe = Join-Path $newDir $exeName`,
      `  $newRes = Join-Path $newDir 'resources.neu'`,
      `  for ($i = 0; $i -lt 20; $i++) {`,
      `    try {`,
      `      if (Test-Path -LiteralPath $exePath) { $t = [System.IO.File]::Open($exePath, 'Open', 'Read', 'None'); $t.Close() }`,
      `      if (Test-Path -LiteralPath $resPath) { $t = [System.IO.File]::Open($resPath, 'Open', 'Read', 'None'); $t.Close() }`,
      `      break`,
      `    } catch { Start-Sleep -Seconds 1 }`,
      `  }`,
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
      `    Remove-Item -LiteralPath $newDir -Recurse -Force -ErrorAction SilentlyContinue`,
      `    Log 'OK'`,
      `  }`,
      `} catch {`,
      `  Log ('FAILED: ' + $_.Exception.Message)`,
      `  if ((Test-Path -LiteralPath $bakExe) -and -not (Test-Path -LiteralPath $exePath)) { Move-Item -LiteralPath $bakExe -Destination $exePath -Force }`,
      `  if ((Test-Path -LiteralPath $bakRes) -and -not (Test-Path -LiteralPath $resPath)) { Move-Item -LiteralPath $bakRes -Destination $resPath -Force }`,
      `}`,
      `Log 'done'`,
      `schtasks /Delete /TN TODO-Tools-Update /F | Out-Null`
    ].join('\r\n');
  }

  /* PowerShell -EncodedCommand 编码与计划任务 /TR 构造见模块顶层 toEncodedCommand / buildUpdateTaskRun */

  /** 应用更新并退出重启：写标记与脚本 → 注册一次性计划任务 → 退出主进程。
      Neutralino 的 execCommand 子进程会随主进程退出被回收，替换必须由
      Task Scheduler 托管的独立进程完成。 */
  async function applyUpdate() {
    if (!isNeutralinoEnv() || state.phase !== 'ready' || !state.dirs) return;
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
      await Neutralino.filesystem.writeFile(pendingPath, JSON.stringify(pending));
      await Neutralino.filesystem.writeFile(scriptPath, buildApplyScript());
      /* schtasks /ST 仅分钟精度：先注册 +1 分钟兜底计划，再立即 /Run 触发。
         任务进程由 Task Scheduler 托管，独立于应用进程树，主进程退出后照常执行。
         /TR 值不能超过 261 字符：直接以 -File 启动替换脚本，参数由脚本从
         pending.json 自读，避免 .cmd 中转的中文编码与长命令超限问题。 */
      const startAt = new Date(Date.now() + 60000);
      const hhmm = `${String(startAt.getHours()).padStart(2, '0')}:${String(startAt.getMinutes()).padStart(2, '0')}`;
      const innerCreate = `schtasks /Create /F /TN 'TODO-Tools-Update' /SC ONCE /ST ${hhmm} /TR '${buildUpdateTaskRun(scriptPath)}'`;
      const r = await Neutralino.os.execCommand(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${toEncodedCommand(innerCreate)}`
      );
      if (r.exitCode !== 0) throw new Error(`注册更新任务失败（${r.stdErr || r.exitCode}）`);
      const innerRun = `schtasks /Run /TN 'TODO-Tools-Update'`;
      const runResult = await Neutralino.os.execCommand(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${toEncodedCommand(innerRun)}`
      );
      /* /Run 失败必须抛错：否则应用退出后更新静默丢失 */
      if (runResult.exitCode !== 0) throw new Error(`触发更新任务失败（${runResult.stdErr || runResult.exitCode}）`);
      await Neutralino.app.exit();
    } catch (e) {
      setState({ phase: 'failed', error: `启动更新失败：${e?.message || e}` });
    }
  }

  /** 启动自检：按运行版本判定上次更新成败——成功清理备份，失败用备份成对回滚（避免 exe 新 + res 旧混搭） */
  async function checkPendingStartup() {
    if (!isNeutralinoEnv()) return;
    try {
      const temp = await Neutralino.os.getPath('temp');
      const pendingPath = joinPath(joinPath(temp, UPDATE_DIR_NAME), PENDING_NAME);
      const text = await Neutralino.filesystem.readFile(pendingPath).catch(() => '');
      if (!text) return;
      let pending = null;
      try {
        pending = JSON.parse(text);
      } catch {
        await removeFile(pendingPath);
        return;
      }
      if (!pending?.targetDir) {
        await removeFile(pendingPath);
        return;
      }
      const exePath = joinPath(pending.targetDir, pending.exeName || exeName);
      const bakExe = `${exePath}.bak`;
      const resPath = joinPath(pending.targetDir, RES_NAME);
      const bakRes = `${resPath}.bak`;
      const bakExists = await exists(bakExe);
      let updated;
      if (pending.version) {
        /* pending.version 为替换后的目标版本：当前运行版本一致即成功 */
        const running = await resolveCurrentVersion();
        updated = running
          ? running === String(pending.version).replace(/^v/i, '')
          : await exists(exePath);
      } else {
        /* 旧格式标记：沿用以往规则（exe 缺失即失败） */
        updated = await exists(exePath);
      }
      if (updated) {
        /* 新版本已在运行 → 清理备份 */
        if (bakExists) {
          await removeFile(bakExe);
          await removeFile(bakRes);
        }
      } else if (bakExists) {
        /* 更新未生效 → 成对恢复备份 */
        await restoreBak(bakExe, exePath);
        await restoreBak(bakRes, resPath);
      }
      await removeFile(pendingPath);
    } catch { /* 自检失败不阻塞启动 */ }
  }

  return {
    getState: () => state,
    getCurrentVersion: () => currentVersion,
    resolveCurrentVersion,
    getRepo: () => repo,
    isAvailable: () => isNeutralinoEnv(),
    onStatus: (cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter(l => l !== cb);
      };
    },
    checkForUpdates,
    downloadAndPrepare,
    cancelDownload,
    applyUpdate,
    checkPendingStartup
  };
}
