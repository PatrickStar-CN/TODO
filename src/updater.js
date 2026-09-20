/* 应用自动更新（仅 Neutralino 桌面端生效，Web 端降级为提示）
 *
 * 流程：
 *  1. 设置页「检查更新」→ GET GitHub releases/latest，tag 与本地版本做 semver 比对
 *     （30s 超时；非版本号形态 tag 无法解析时保守判定为无更新；
 *     HttpWebRequest 优先、curl 兜底，两路均显式走系统代理）；
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

/* PowerShell 单引号字面量转义：路径含 ' 时双写，避免 -Command 解析断裂 */
export function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/* TLS 兼容片段：Tls12 必备，Tls11/Tls13 反射追加（旧 .NET 无 Tls13 枚举时忽略） */
export function buildTlsPs() {
  return `$tls=[System.Net.SecurityProtocolType]::Tls12; try { $tls=$tls -bor ([Enum]::Parse([System.Net.SecurityProtocolType],'Tls11')) } catch {}; try { $tls=$tls -bor ([Enum]::Parse([System.Net.SecurityProtocolType],'Tls13')) } catch {}; [System.Net.ServicePointManager]::SecurityProtocol=$tls`;
}

/* 系统代理装配片段：先判 IsBypassed（直连地址不走代理），否则挂系统代理并带上
 * 默认凭证（直接系统代理无害，需 NTLM/Kerberos 认证的代理可解 407） */
export function buildProxyAssignPs(targetVar, reqVar) {
  return `$sysProxy=[System.Net.WebRequest]::GetSystemWebProxy(); if ($sysProxy -ne $null -and !($sysProxy.IsBypassed(${targetVar}))) { ${reqVar}.Proxy=$sysProxy; try { ${reqVar}.Proxy.Credentials=[System.Net.CredentialCache]::DefaultCredentials } catch {} }`;
}

/* curl 代理参数片段：解析失败时保持直连（curl.exe 默认不读 WinINET 系统代理，
 * 必须显式 --proxy，否则开着系统代理也会直连超时）；旁路地址加 --noproxy */
export function buildCurlProxyPs(targetVar) {
  return `$sysProxy=[System.Net.WebRequest]::GetSystemWebProxy(); $proxyArgs=@(); if ($sysProxy -ne $null -and !($sysProxy.IsBypassed(${targetVar}))) { try { $p=$sysProxy.GetProxy(${targetVar}); if ($p -ne $null -and ![string]::IsNullOrEmpty($p.AbsoluteUri)) { $proxyArgs+=@('--proxy',$p.AbsoluteUri); $proxyArgs+=@('--proxy-anyauth') } } catch {} } else { $proxyArgs+=@('--noproxy','*') }`;
}

/* 网络错误摘要：压成单行并截断，供界面展示（仅含主机/状态等诊断信息，不含密钥） */
export function sanitizeNetDetail(s, max = 160) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/* 检查阶段第一路：HttpWebRequest 取 GitHub API JSON。
 * 成功 exit 0；服务端/代理返回 HTTP 状态则 exit 该状态码；网络层失败 exit 1
 * 并把首错写入 errPath（execCommand 的 stdout 捕获不可靠，用文件透传细节）。 */
export function buildFetchWebRequestPs(url, jsonPath, errPath) {
  const u = psQuote(url);
  const o = psQuote(jsonPath);
  const e = psQuote(errPath);
  return `try { ${buildTlsPs()}; $target=${u}; $req=[System.Net.WebRequest]::Create($target); $req.Method='GET'; $req.Timeout=30000; $req.ReadWriteTimeout=30000; ${buildProxyAssignPs('$target', '$req')}; $req.UserAgent='TODO-Tools-Updater'; $req.Accept='application/vnd.github+json'; $req.Headers['X-GitHub-Api-Version']='2022-11-28'; $resp=$req.GetResponse(); $sr=New-Object System.IO.StreamReader($resp.GetResponseStream(),[System.Text.Encoding]::UTF8); $d=$sr.ReadToEnd(); $sr.Close(); $resp.Close(); [System.IO.File]::WriteAllText(${o},$d,[System.Text.Encoding]::UTF8) } catch { $code=1; $ex=$_.Exception; while ($ex) { if ($ex.Response) { try { $code=[int]$ex.Response.StatusCode; break } catch {} }; $ex=$ex.InnerException }; try { $msg=$_.Exception.Message; if ([string]::IsNullOrEmpty($msg)) { $msg=$_.ToString() }; [System.IO.File]::WriteAllText(${e},$msg,[System.Text.Encoding]::UTF8) } catch {}; if ($code -ge 100 -and $code -le 599) { exit $code }; exit 1 }`;
}

/* 检查阶段第二路：curl 兜底（.NET 代理/TLS 握手失败时用）。
 * 成功 exit 0；HTTP 错误 exit 该状态码（-w 取码）；网络失败 exit 1，stderr 进日志。 */
export function buildFetchCurlPs(url, jsonPath, codePath, logPath) {
  const u = psQuote(url);
  const o = psQuote(jsonPath);
  const c = psQuote(codePath);
  const l = psQuote(logPath);
  return `try { $target=${u}; $out=${o}; $codeFile=${c}; $logFile=${l}; ${buildCurlProxyPs('$target')}; & curl.exe -sS -L --fail --retry 2 --connect-timeout 15 --max-time 30 -A 'TODO-Tools-Updater' -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' @proxyArgs -o $out -w '%{http_code}' $target > $codeFile 2> $logFile; $httpCode=((Get-Content $codeFile -Raw -ErrorAction SilentlyContinue) | Out-String).Trim(); if ($LASTEXITCODE -eq 0) { exit 0 }; if ($httpCode -match '^\\d{3}$') { exit [int]$httpCode }; exit 1 } catch { exit 1 }`;
}

/* 下载阶段第一路：HttpWebRequest 流式落盘（可轮询进度），失败 exit 1 */
export function buildDownloadWebRequestPs(url, dest) {
  const u = psQuote(url);
  const o = psQuote(dest);
  return `try { ${buildTlsPs()}; $target=${u}; $req=[System.Net.WebRequest]::Create($target); $req.Method='GET'; $req.Timeout=30000; $req.ReadWriteTimeout=30000; ${buildProxyAssignPs('$target', '$req')}; $resp=$req.GetResponse(); $in=$resp.GetResponseStream(); $out=[System.IO.File]::Create(${o}); $in.CopyTo($out); $out.Close(); $in.Close(); $resp.Close() } catch { exit 1 }`;
}

/* 下载阶段第二路：curl 流式落盘，代理在 PowerShell 内解析后显式传入 */
export function buildDownloadCurlPs(url, dest, logPath) {
  const u = psQuote(url);
  const o = psQuote(dest);
  const l = psQuote(logPath);
  return `try { $target=${u}; $out=${o}; $logFile=${l}; ${buildCurlProxyPs('$target')}; & curl.exe -sS -L --fail --retry 3 --connect-timeout 15 --max-time 300 @proxyArgs -o $out $target > $logFile 2>&1; exit $LASTEXITCODE } catch { exit 1 }`;
}

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

  /* 诊断日志：检查/下载各阶段的退出码与 stderr 尾部追加到 temp/update-check.log
   *（桌面端无控制台可看，出问题时凭此文件定位；保留最近 60 行，写失败不阻塞流程） */
  const appendCheckLog = async (dir, line) => {
    try {
      const p = joinPath(dir, 'update-check.log');
      const prev = await Neutralino.filesystem.readFile(p).catch(() => '');
      const keep = String(prev).split(/\r?\n/).slice(-60).join('\n');
      await Neutralino.filesystem.writeFile(p, `${keep}${keep ? '\n' : ''}[${new Date().toISOString()}] ${line}`);
    } catch {}
  };

  /* 脚本一律落盘后用 -File 执行：内联 -Command 要经 cmd 中转，&、%、> 等元字符
   * 会被改写导致脚本根本没跑起来（且无任何输出文件）；-File 只传一个短路径参数，
   * 不受此影响。exec 自身抛错（如进程起不来）转为带 execThrow 标记的 Error，
   * 调用方据此给出可诊断文案而不是空细节。 */
  const execPsScript = async (dir, stage, psName, psContent) => {
    const psPath = joinPath(dir, psName);
    await Neutralino.filesystem.writeFile(psPath, psContent);
    let r;
    try {
      r = await Neutralino.os.execCommand(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psPath}"`
      );
    } catch (e) {
      const msg = `exec启动失败:${e?.message || e}`;
      await appendCheckLog(dir, `${stage} THROW ${sanitizeNetDetail(msg, 160)}`);
      const err = new Error(msg);
      err.execThrow = true;
      throw err;
    }
    await appendCheckLog(dir, `${stage} exit=${r.exitCode} stderr=${sanitizeNetDetail(r.stdErr, 120) || '-'}`);
    return r;
  };

  /* GitHub 资产 URL 的 302 与最终直链均不带 CORS 头，WebView2 fetch 跨源必被拦，
     下载只能走 Neutralino 原生进程（无 CORS 限制）：
     1) HttpWebRequest 优先：显式走系统代理（含默认凭证、IsBypassed 判断），显式超时防卡死，
        流式落盘可轮询进度；
     2) curl 兜底：代理在 PowerShell 内解析后显式 --proxy 传入（curl.exe 默认不读
        WinINET 系统代理），流式落盘，stdout/stderr 重定向到日志文件。
     两路脚本均落盘后 -File 执行，避免内联 -Command 被 cmd 改写元字符。 */
  async function downloadFileExec(url, dest, tag = 'dl') {
    const dir = await updateDir();
    let r;
    /* 原始细节直接上抛，由 downloadWithProgress 统一包一层用户文案，避免双重包裹 */
    try {
      r = await execPsScript(dir, `${tag}-web`, `${tag}-web.ps1`, buildDownloadWebRequestPs(url, dest));
    } catch (e) {
      throw new Error(e?.message || String(e));
    }
    if (r.exitCode === 0) return r;
    console.warn('[updater] WebClient failed, fallback to curl:', r.stdErr || r.exitCode);
    await removeFile(dest);
    const curlLog = `${dest}.curl.log`;
    await removeFile(curlLog);
    try {
      r = await execPsScript(dir, `${tag}-curl`, `${tag}-curl.ps1`, buildDownloadCurlPs(url, dest, curlLog));
    } catch (e) {
      throw new Error(e?.message || String(e));
    }
    if (r.exitCode !== 0) {
      const log = await Neutralino.filesystem.readFile(curlLog).catch(() => '');
      throw new Error(sanitizeNetDetail(log, 160) || `curl exit ${r.exitCode}`);
    }
    return r;
  }

  /* 下载 zip 并轮询临时文件大小回传进度（exec 通道无进度事件，用文件大小近似）；
     失败清理半文件并自动重试一次；取消后丢弃结果回到 available */
  async function downloadWithProgress(url, dest, totalSize, tag = 'dl') {
    let lastErr = null;
    for (let attempt = 0; attempt <= 1; attempt++) {
      if (cancelRequested) throw cancelledError();
      const task = downloadFileExec(url, dest, tag);
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

  /* GitHub API JSON 通过原生进程拉取：HttpWebRequest 优先（显式走系统代理，
     含默认凭证与 IsBypassed 判断；WebView2 fetch 跨源/直连会超时），失败再 curl 兜底
     （代理在 PowerShell 内解析后显式 --proxy 传入）；显式 30s 超时避免无响应卡死；
     附带 GitHub 推荐请求头（User-Agent/Accept/X-GitHub-Api-Version）。
     结果写入临时文件再读取（execCommand 的 stdout 捕获不可靠，不用重定向输出）。
     脚本落盘后 -File 执行（内联 -Command 经 cmd 中转会被改写元字符导致静默失败）。
     HTTP 状态码以进程退出码透传，调用方据此区分 404（无发布版本）/ 403·429（限流）/ 其他错误；
     纯网络失败时附带阶段码与 sanitized 细节（err.detail），调用方展示可诊断文案；
     全过程追加 temp/todo-tools-update/update-check.log，桌面端无控制台时凭此定位。 */
  async function fetchJson(url) {
    const dir = await updateDir();
    const jsonPath = joinPath(dir, 'latest-release.json');
    const errPath = joinPath(dir, 'latest-release.err.txt');
    const codePath = joinPath(dir, 'latest-release.code');
    const curlLog = joinPath(dir, 'latest-release.curl.log');
    await removeFile(jsonPath);
    await removeFile(errPath);
    await removeFile(codePath);
    await removeFile(curlLog);
    const httpError = (status, detail) => {
      const err = new Error(`HTTP ${status}`);
      err.status = status;
      if (detail) err.detail = detail;
      return err;
    };
    /* 首错 + curl 日志尾部拼成诊断摘要（单行截断，不含密钥） */
    const readNetDetail = async () => {
      const first = await Neutralino.filesystem.readFile(errPath).catch(() => '');
      const log = await Neutralino.filesystem.readFile(curlLog).catch(() => '');
      const tail = String(log).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join(' ');
      return sanitizeNetDetail([first, tail].filter(Boolean).join(' '));
    };
    /* exit=0 不代表万事大吉：文件可能缺失、为空或带 BOM/乱码导致解析失败。
     * .NET WriteAllText 默认写 UTF-8 BOM，而 JSON.parse 见 BOM 即抛错，故先剥离；
     * 读/解失败抛带 jsonBad 标记的错（含文件大小与头部摘要），并记入诊断日志。 */
    const readJsonResult = async (stage) => {
      let raw;
      try {
        raw = await Neutralino.filesystem.readFile(jsonPath);
      } catch (e) {
        await appendCheckLog(dir, `${stage} json missing: ${sanitizeNetDetail(e?.message || e, 80) || '-'}`);
        const err = new Error(`更新信息读取失败（${e?.message || e}）`);
        err.jsonBad = true;
        err.detail = 'json missing';
        throw err;
      }
      const text = String(raw).replace(/^\uFEFF/, '');
      try {
        const data = JSON.parse(text);
        await appendCheckLog(dir, `${stage} json ok size=${text.length}`);
        await removeFile(jsonPath);
        await removeFile(errPath);
        await removeFile(codePath);
        await removeFile(curlLog);
        return data;
      } catch (e) {
        const head = sanitizeNetDetail(text.slice(0, 80), 80);
        await appendCheckLog(dir, `${stage} json bad size=${text.length} head=${head || '-'} parse=${sanitizeNetDetail(e?.message, 80) || '-'}`);
        const err = new Error(`更新信息解析失败（${e?.message || e}）`);
        err.jsonBad = true;
        err.detail = `json size=${text.length}${head ? ` head=${head}` : ''}`;
        throw err;
      }
    };
    /* 阶段码：W=第一路退出码，C=第二路退出码（throw=进程没起来） */
    let webExit = 'x';
    let curlExit = 'x';
    let execThrowMsg = '';
    /* 第一路 HttpWebRequest：HTTP 状态明确时直接抛（重试无意义），仅网络异常重试一次 */
    for (let attempt = 0; attempt <= 1; attempt++) {
      let r;
      try {
        r = await execPsScript(dir, 'check-web', 'check-web.ps1', buildFetchWebRequestPs(url, jsonPath, errPath));
      } catch (e) {
        execThrowMsg = execThrowMsg || e.message;
        webExit = 'throw';
        if (attempt === 0) {
          await new Promise((r2) => setTimeout(r2, 600));
          continue;
        }
        break;
      }
      if (r.exitCode === 0) {
        /* 退出码 0 但文件缺失/带 BOM/非 JSON 时不直接抛秃错：记阶段码 Wjson，
         * 重试一次无果则继续走 curl 兜底，细节进日志与最终文案 */
        try {
          return await readJsonResult('check-web');
        } catch (e) {
          if (!e?.jsonBad) throw e;
          webExit = 'json';
          console.warn('[updater] check-web json unreadable:', e.detail);
          if (attempt === 0) {
            await new Promise((r2) => setTimeout(r2, 600));
            continue;
          }
          break;
        }
      }
      if (r.exitCode >= 100 && r.exitCode <= 599) throw httpError(r.exitCode);
      webExit = String(r.exitCode);
      console.warn(`[updater] check via WebRequest failed (attempt ${attempt + 1}):`, r.stdErr || `exit ${r.exitCode}`);
      if (attempt === 0) await new Promise((r2) => setTimeout(r2, 600));
    }
    /* 第二路 curl 兜底：.NET 代理/TLS 握手失败时仍有机会走通系统代理 */
    let rc = null;
    try {
      rc = await execPsScript(dir, 'check-curl', 'check-curl.ps1', buildFetchCurlPs(url, jsonPath, codePath, curlLog));
    } catch (e) {
      execThrowMsg = execThrowMsg || e.message;
      curlExit = 'throw';
    }
    if (rc) {
      if (rc.exitCode === 0) {
        try {
          return await readJsonResult('check-curl');
        } catch (e) {
          const err = new Error(`解析更新信息失败（${e?.message || e}）`);
          err.detail = [e.detail, await readNetDetail()].filter(Boolean).join(' ');
          throw err;
        }
      }
      if (rc.exitCode >= 100 && rc.exitCode <= 599) throw httpError(rc.exitCode);
      curlExit = String(rc.exitCode);
      console.warn('[updater] check via curl failed:', rc.stdErr || `exit ${rc.exitCode}`);
    }
    const detail = await readNetDetail();
    const bits = [`W${webExit}/C${curlExit}`, execThrowMsg, detail].filter(Boolean).join(' ');
    const err = new Error(`网络连接异常（${bits}）`);
    err.detail = bits;
    throw err;
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
      } else if (e?.status === 407) {
        const d = e?.detail ? sanitizeNetDetail(e.detail) : '';
        setState({ phase: 'failed', error: d ? `检查更新失败：代理需要认证（HTTP 407），请检查系统代理设置（${d}）` : '检查更新失败：代理需要认证（HTTP 407），请检查系统代理设置' });
      } else if (e?.status) {
        setState({ phase: 'failed', error: `检查更新失败：GitHub API 返回 HTTP ${e.status}` });
      } else {
        const d = e?.detail ? sanitizeNetDetail(e.detail) : '';
        console.warn('[updater] check failed:', e?.message || e, d);
        setState({ phase: 'failed', error: d ? `检查更新失败：网络连接异常（${d}）` : '检查更新失败：网络连接异常，请检查网络或系统代理后重试' });
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
      await downloadWithProgress(zipAsset.browser_download_url, zipPath, zipAsset.size || 0, 'dl-zip');

      setState({ phase: 'downloading', version, progress: 0.99 });
      try {
        await downloadFileExec(shaAsset.browser_download_url, shaPath, 'dl-sha');
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
