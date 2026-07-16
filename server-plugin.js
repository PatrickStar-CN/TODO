import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');
const DESKTOP_DATA_FILE = path.join(__dirname, 'todo_data.json');

function readData() {
  /* 透传模式：直接返回文件内容（可能是 ENC: 加密文本或旧明文 JSON） */
  if (!fs.existsSync(DATA_FILE)) {
    return '';
  }
  return fs.readFileSync(DATA_FILE, 'utf-8');
}

function writeData(content) {
  /* 透传模式：直接写入 body 字符串，不解析 JSON */
  if (fs.existsSync(DATA_FILE)) {
    const current = fs.readFileSync(DATA_FILE, 'utf-8');
    const isEncrypted = current.startsWith('ENC:') || current.includes('\nENC:');
    const recoveryBackup = path.join(__dirname, 'data.json.encrypted-recovery.bak');
    if (isEncrypted && !fs.existsSync(recoveryBackup)) {
      fs.writeFileSync(recoveryBackup, current, 'utf-8');
    }
  }
  fs.writeFileSync(DATA_FILE, content, 'utf-8');
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

export default function dataServerPlugin() {
  return {
    name: 'data-server',
    configureServer(server) {
      server.middlewares.use('/api/recovery-data', (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        const content = fs.existsSync(DESKTOP_DATA_FILE)
          ? fs.readFileSync(DESKTOP_DATA_FILE, 'utf-8')
          : '';
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(content);
      });

      server.middlewares.use('/api/data', (req, res) => {
        if (req.method === 'GET') {
          /* 直接返回文件原始内容（可能是 ENC: 加密文本或旧明文 JSON） */
          const content = readData();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(content);
        } else if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              writeData(body);
              sendJson(res, 200, { ok: true });
            } catch {
              sendJson(res, 500, { ok: false, error: 'Failed to write data' });
            }
          });
          req.on('error', () => {
            sendJson(res, 500, { ok: false, error: 'Failed to read request body' });
          });
        } else {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        }
      });
    }
  };
}
