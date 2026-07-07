/* 本地存储加密模块
 * 算法：AES-GCM-256
 * 密钥派生：PBKDF2(100k iterations, SHA-256) 从设备指纹 + salt 派生
 * 加密格式：ENC:<base64(iv[12] || ciphertext || authTag[16])>
 * 兼容：明文 JSON 直接返回（自动迁移）
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

function ensureSalt() {
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

function getDeviceFingerprint() {
  /* 用户设备指纹：UA + 语言 + 屏幕尺寸 */
  const parts = [
    navigator.userAgent || '',
    navigator.language || '',
    `${screen.width}x${screen.height}`,
    String(new Date().getTimezoneOffset())
  ];
  return parts.join('|');
}

async function deriveKey() {
  const c = getCrypto();
  if (!c) throw new Error('Web Crypto API not available');
  const salt = ensureSalt();
  const enc = new TextEncoder();
  const material = enc.encode(`todo-tools::v1::${getDeviceFingerprint()}`);

  const baseKey = await c.subtle.importKey(
    'raw',
    material,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function initCrypto() {
  try {
    cachedKey = await deriveKey();
  } catch (err) {
    console.warn('[crypto] 初始化失败，将以明文保存:', err);
    cachedKey = null;
  }
}

export function isCryptoReady() {
  return cachedKey !== null;
}

export async function encrypt(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt expects string');
  }
  if (!cachedKey) {
    /* 加密不可用：返回原文（兼容模式） */
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
  return PREFIX + bytesToBase64(out);
}

export async function decrypt(content) {
  if (typeof content !== 'string' || !content.startsWith(PREFIX)) {
    return content;
  }
  if (!cachedKey) {
    throw new Error('Crypto not initialized');
  }
  const c = getCrypto();
  const data = base64ToBytes(content.slice(PREFIX.length));
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);
  const plainBuf = await c.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cachedKey,
    ciphertext
  );
  return new TextDecoder().decode(plainBuf);
}

export function tryDecryptSync(content) {
  /* 同步版本的格式判断，仅用于检测（不解密） */
  if (typeof content !== 'string') return false;
  return content.startsWith(PREFIX);
}

export async function tryDecrypt(content) {
  /* 自动识别格式：是 ENC: 前缀则解密，否则原样返回 */
  if (typeof content !== 'string') return content;
  if (content.startsWith(PREFIX)) {
    return await decrypt(content);
  }
  return content;
}
