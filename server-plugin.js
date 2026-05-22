import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { todos: [], tags: ['计划内'] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { todos: [], tags: ['计划内'] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
      server.middlewares.use('/api/data', (req, res) => {
        if (req.method === 'GET') {
          sendJson(res, 200, readData());
        } else if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              writeData(JSON.parse(body));
              sendJson(res, 200, { ok: true });
            } catch {
              sendJson(res, 400, { ok: false, error: 'Invalid JSON data' });
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
