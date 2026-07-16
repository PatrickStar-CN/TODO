/* 本地存储加密模块
 * 算法：AES-GCM-256
 * 密钥派生：PBKDF2(100k iterations, SHA-256) 从稳定应用标识 + salt 派生
 *
 * 文件存储格式（多实例共享）：
 *   <salt-base64>
 *   ENC:<base64(iv[12] || ciphertext || authTag[16])>
 *
 * - salt 嵌入文件本身，不依赖 localStorage → 多实例天然共享
 * - 解密时兼容旧版“设备指纹 + salt”密钥
 * - 旧格式（无 salt 前缀，单行 ENC: 或明文）自动回退到 localStorage salt
 * - 明文 JSON 直接透传（自动迁移）
 */

const STORAGE_KEY_SALT = 'todo_app_salt';
const PREFIX = 'ENC:';
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

let cachedKey = null;

function getCrypto() {
  return (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) ? window.crypto : null;
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* 设备指纹：UA + 语言 + 屏幕尺寸 + 时区 */
function getDeviceFingerprint() {
  const parts = [
    navigator.userAgent || '',
    navigator.language || '',
    `${screen.width}x${screen.height}`,
    String(new Date().getTimezoneOffset())
  ];
  return parts.join('|');
}

function getLegacyFingerprintCandidates() {
  const fingerprint = getDeviceFingerprint();
  const [userAgent, language, display, timezone] = fingerprint.split('|');
  const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
  const edgeMatch = userAgent.match(/Edg\/(\d+)/);
  const currentMajor = Number(edgeMatch?.[1] || chromeMatch?.[1]);
  if (!Number.isFinite(currentMajor)) return [];

  const candidates = [];
  for (let major = currentMajor; major >= Math.max(100, currentMajor - 20); major--) {
    let candidateUa = userAgent.replace(/Chrome\/[\d.]+/, `Chrome/${major}.0.0.0`);
    candidateUa = candidateUa.replace(/Edg\/[\d.]+/, `Edg/${major}.0.0.0`);
    candidates.push([candidateUa, language, display, timezone].join('|'));
  }
  return candidates;
}

/* 读取/生成 localStorage salt（向后兼容旧格式） */
function getOrCreateLocalSalt() {
  let saltB64 = localStorage.getItem(STORAGE_KEY_SALT);
  if (!saltB64) {
    const c = getCrypto();
    if (!c) throw new Error('Web Crypto API not available');
    const salt = c.getRandomValues(new Uint8Array(SALT_LENGTH));
    saltB64 = bytesToBase64(salt);
    localStorage.setItem(STORAGE_KEY_SALT, saltB64);
  }
  return base64ToBytes(saltB64);
}

function generateNewSalt() {
  const c = getCrypto();
  if (!c) throw new Error('Web Crypto API not available');
  const salt = c.getRandomValues(new Uint8Array(SALT_LENGTH));
  /* 同时持久化到 localStorage（向后兼容） */
  localStorage.setItem(STORAGE_KEY_SALT, bytesToBase64(salt));
  return salt;
}

async function deriveKeyWithSalt(salt, legacyFingerprint = false) {
  const c = getCrypto();
  if (!c) throw new Error('Web Crypto API not available');
  const enc = new TextEncoder();
  const material = enc.encode(
    legacyFingerprint
      ? `todo-tools::v1::${getDeviceFingerprint()}`
      : 'todo-tools::v2::local-data'
  );
  const baseKey = await c.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/* 解析文件内容，返回 { salt, encrypted } 或 null（旧格式） */
function parseFileContent(content) {
  if (typeof content !== 'string') return null;
  const newlineIdx = content.indexOf('\n');
  if (newlineIdx > 0) {
    const saltLine = content.substring(0, newlineIdx).trim();
    const rest = content.substring(newlineIdx + 1);
    /* salt 必须是 base64 格式（24 字符对应 16 字节），后续是 ENC: 密文 */
    if (saltLine && /^[A-Za-z0-9+/=]+$/.test(saltLine) && rest.startsWith(PREFIX)) {
      try {
        const salt = base64ToBytes(saltLine);
        if (salt.length === SALT_LENGTH) {
          return { salt, encrypted: rest };
        }
      } catch { /* fall through */ }
    }
  }
  return null;
}

export async function initCrypto() {
  /* 初始化时优先使用 localStorage salt（旧兼容），首次启动时生成 */
  try {
    const salt = getOrCreateLocalSalt();
    cachedKey = await deriveKeyWithSalt(salt);
  } catch (err) {
    console.warn('[crypto] 初始化失败，将以明文保存:', err);
    cachedKey = null;
  }
}

export function isCryptoReady() {
  return cachedKey !== null;
}

/* 加密并嵌入 salt 到输出中（新格式） */
export async function encrypt(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt expects string');
  }
  if (!cachedKey) {
    return plaintext;
  }
  const c = getCrypto();
  const iv = c.getRandomValues(new Uint8Array(IV_LENGTH));
  const enc = new TextEncoder();
  const ciphertext = await c.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cachedKey,
    enc.encode(plaintext)
  );
  const ctBytes = new Uint8Array(ciphertext);
  const out = new Uint8Array(iv.length + ctBytes.length);
  out.set(iv, 0);
  out.set(ctBytes, iv.length);

  /* 从 localStorage 取 salt 嵌入到输出中 */
  const saltB64 = localStorage.getItem(STORAGE_KEY_SALT) || bytesToBase64(c.getRandomValues(new Uint8Array(SALT_LENGTH)));
  return saltB64 + '\n' + PREFIX + bytesToBase64(out);
}

/* 用指定 salt 解密 */
async function decryptWithSalt(encrypted, salt) {
  const c = getCrypto();
  const data = base64ToBytes(encrypted.slice(PREFIX.length));
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);
  const stableKey = await deriveKeyWithSalt(salt);
  try {
    const plainBuf = await c.subtle.decrypt({ name: 'AES-GCM', iv }, stableKey, ciphertext);
    return new TextDecoder().decode(plainBuf);
  } catch (stableError) {
    try {
      const legacyKey = await deriveKeyWithSalt(salt, true);
      const plainBuf = await c.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, ciphertext);
      return new TextDecoder().decode(plainBuf);
    } catch {}

    for (const fingerprint of getLegacyFingerprintCandidates()) {
      try {
        const enc = new TextEncoder();
        const material = enc.encode(`todo-tools::v1::${fingerprint}`);
        const baseKey = await c.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
        const legacyKey = await c.subtle.deriveKey(
          { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
          baseKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
        const plainBuf = await c.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, ciphertext);
        return new TextDecoder().decode(plainBuf);
      } catch {}
    }
    throw stableError;
  }
}

/* 自动识别并解密：新格式（带 salt）→ 旧格式（用 localStorage salt）→ 透传 */
export async function tryDecrypt(content) {
  if (typeof content !== 'string') return content;

  /* 1. 新格式：salt 在文件第一行 */
  const parsed = parseFileContent(content);
  if (parsed) {
    try {
      return await decryptWithSalt(parsed.encrypted, parsed.salt);
    } catch (err) {
      /* 新格式解密失败，尝试用 localStorage salt 解密（兼容同 salt 的情况） */
      try {
        const lsSalt = getOrCreateLocalSalt();
        return await decryptWithSalt(parsed.encrypted, lsSalt);
      } catch {
        throw err;
      }
    }
  }

  /* 2. 旧格式：单行 ENC: 前缀，依赖 localStorage salt */
  if (content.startsWith(PREFIX)) {
    const lsSalt = getOrCreateLocalSalt();
    return await decryptWithSalt(content, lsSalt);
  }

  /* 3. 明文 JSON：透传 */
  return content;
}

export function tryDecryptSync(content) {
  if (typeof content !== 'string') return false;
  return content.startsWith(PREFIX) || parseFileContent(content) !== null;
}

/* 显式解密接口（用于调试） */
export async function decrypt(content) {
  return await tryDecrypt(content);
}
