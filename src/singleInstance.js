/* OS 命名 Mutex 单实例（仅 Neutralino 桌面端生效，Web 端直接放行）
 *
 * 原理：
 * 1. 快捷探测：短命 PowerShell 用 [Mutex]::OpenExisting 查命名 Mutex 是否存在。
 *    存在（exit 0）→ 已有实例；不存在（exit 10）→ 进入抢占。
 * 2. 原子抢占：后台 spawnProcess 启动隐藏 PowerShell 持有者，
 *    以 new Mutex($true, name, [ref]$createdNew) 做 OS 级 test-and-set；
 *    已存在则持有者 exit 42，应用据此判定输掉竞态。
 *    正确性只依赖持有者自身的 createdNew/exit 42，探测仅是让第二实例
 *    退得更快的优化，绝不能把“复探 Mutex 是否存在”当作仲裁依据
 *    （双实例同抢时双方复探都存在，会误出双主实例）。
 * 3. 释放：正常退出时 updateSpawnedProcess(id, 'exit') 终止持有者；
 *    崩溃/kill 时持有者随主进程被回收，Mutex 由 OS 自动释放，无过期等待。
 */

import { isNeutralinoEnv } from './shared.js';

/* 竞态输家的持有者退出码：与 buildHolderPs 中的 exit 42 保持一致 */
export const HOLDER_LOST_EXIT_CODE = 42;
/* 抢占确认等待：PowerShell 冷启动约 200–600ms，超时未退出即视为获胜 */
export const HOLDER_CONFIRM_WAIT_MS = 800;

/* Mutex 名构造：仅保留 [A-Za-z0-9._-]，其余转 '-' 并收敛；超长截断 64。
 * 统一 Local\ 会话命名空间（按登录会话隔离，无需提权；Global\ 需
 * SeCreateGlobalPrivilege 且跨 RDP 会话互斥，不采用）。 */
export function buildMutexName(applicationId) {
  const clean = String(applicationId || '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 64);
  return `Local\\TODO-Tools-SingleInstance-${clean || 'app.todotools'}`;
}

export const SINGLE_INSTANCE_MUTEX = buildMutexName('app.todotools');

/* 探测脚本：存在 exit 0；WaitHandleCannotBeOpenedException 即不存在 exit 10；
 * 其他异常（无权访问等）exit 1，调用侧判为 unknown。 */
export function buildProbePs(name) {
  const n = quotePs(name);
  return `try { $m=[System.Threading.Mutex]::OpenExisting(${n}); $m.Close(); exit 0 } catch [System.Threading.WaitHandleCannotBeOpenedException] { exit 10 } catch { exit 1 }`;
}

/* 持有者脚本：$createdNew 为原子 test-and-set 结果；输家 exit 42；
 * 赢家阻塞持有直到进程退出（正常 ReleaseMutex + Dispose，崩溃由 OS 回收）。 */
export function buildHolderPs(name) {
  const n = quotePs(name);
  return `$createdNew=$false; try { $m=New-Object System.Threading.Mutex($true,${n},[ref]$createdNew) } catch { exit 1 }; if (-not $createdNew) { exit 42 }; try { Wait-Event -Timeout 2147483 } finally { try { $m.ReleaseMutex() } catch {}; $m.Dispose() }`;
}

/* 探测退出码映射：0→存在 / 10→不存在 / 其他（含执行失败）→未知 */
export function decideProbe(exitCode) {
  if (exitCode === 0) return 'exists';
  if (exitCode === 10) return 'absent';
  return 'unknown';
}

/* PowerShell 单引号字面量转义：含 ' 时双写（与 updater.js psQuote 同规则，
 * 此处独立实现以保持本模块无重依赖）。 */
function quotePs(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/* -EncodedCommand 编码：UTF-16LE 后 base64（与 updater.js toEncodedCommand
 * 同规则，含代理对处理；独立实现以保持本模块无重依赖）。 */
function toEncodedCommand(ps) {
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

function powershellHidden(encoded) {
  return `powershell -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
}

async function resolveMutexName() {
  let applicationId = '';
  try {
    const cfg = typeof Neutralino !== 'undefined' && Neutralino.app
      ? await Neutralino.app.getConfig()
      : null;
    applicationId = cfg?.applicationId || '';
  } catch {}
  return buildMutexName(applicationId);
}

/* 等待持有者进程退出并判定是否输掉竞态：只认 exit 42；
 * 其他退出码（持有者自身异常）按 unknown 处理，由调用侧 fail-open。
 * 用 window 原生监听以便事后移除，不污染 Neutralino.events。 */
function waitHolderLost(id, timeoutMs = HOLDER_CONFIRM_WAIT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (lost) => {
      if (done) return;
      done = true;
      try { window.removeEventListener('spawnedProcess', onEvent); } catch {}
      resolve(lost);
    };
    const onEvent = (evt) => {
      const detail = evt?.detail;
      if (detail?.id !== id) return;
      if (detail?.action === 'exit') finish(Number(detail?.data) === HOLDER_LOST_EXIT_CODE);
    };
    try {
      window.addEventListener('spawnedProcess', onEvent);
    } catch {
      resolve(false);
      return;
    }
    setTimeout(() => finish(false), timeoutMs);
  });
}

let holderId = null;

export async function acquireSingleInstance() {
  if (!isNeutralinoEnv()) return { primary: true };
  const name = await resolveMutexName();

  /* 1. 快捷探测：已存在则直接让路，不启动持有者 */
  let probe = 'unknown';
  try {
    const r = await Neutralino.os.execCommand(powershellHidden(toEncodedCommand(buildProbePs(name))));
    probe = decideProbe(r?.exitCode);
  } catch {
    probe = 'unknown';
  }
  if (probe === 'exists') return { primary: false };
  if (probe === 'unknown') {
    console.warn('[single-instance] OS 命名 Mutex 探测失败，继续作为单实例启动');
    return { primary: true };
  }

  /* 2. 原子抢占：胜负只看自己持有者是否 exit 42 */
  let spawned = null;
  try {
    spawned = await Neutralino.os.spawnProcess(powershellHidden(toEncodedCommand(buildHolderPs(name))));
  } catch (error) {
    console.warn('[single-instance] Mutex 持有者启动失败，继续作为单实例启动:', error);
    return { primary: true };
  }
  let lost = false;
  try {
    lost = await waitHolderLost(spawned.id);
  } catch {
    lost = false;
  }
  if (lost) return { primary: false };
  holderId = spawned.id;
  return { primary: true };
}

/* 幂等释放：正常退出与更新退出前调用；失败吞错（崩溃路径由 OS 自动回收）。 */
export async function releaseSingleInstance() {
  if (holderId === null) return;
  const id = holderId;
  holderId = null;
  try {
    if (typeof Neutralino !== 'undefined' && Neutralino.os?.updateSpawnedProcess) {
      await Neutralino.os.updateSpawnedProcess(id, 'exit');
    }
  } catch {}
}
