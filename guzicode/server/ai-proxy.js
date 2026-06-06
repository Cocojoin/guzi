const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));

const baseUrl = trimTrailingSlash(process.env.AIPRO_BASE_URL || 'https://vip.aipro.love');
const apiKey = process.env.AIPRO_API_KEY;
const model = process.env.AIPRO_MODEL || 'claude-opus-4-7';
const port = Number(process.env.AI_PROXY_PORT || 8787);
const host = process.env.AI_PROXY_HOST || '127.0.0.1';

if (!apiKey) {
  console.error('Missing AIPRO_API_KEY. Create server/.env from server/.env.example.');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/api/ai/chat') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  try {
    const body = await readJson(req);
    const messages = normalizeMessages(body);

    if (!messages.length) {
      sendJson(res, 400, { error: 'messages is required' });
      return;
    }

    const upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 1024,
        stream: false
      })
    });

    const text = await upstream.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { raw: text };
    }

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        error: 'AI provider request failed',
        detail: data
      });
      return;
    }

    sendJson(res, 200, {
      content: data.choices?.[0]?.message?.content || '',
      usage: data.usage || null,
      raw: data
    });
  } catch (error) {
    sendJson(res, 500, {
      error: 'AI proxy error',
      message: error.message
    });
  }
});

server.listen(port, host, () => {
  console.log(`AI proxy listening on http://${host}:${port}`);
});

function normalizeMessages(body) {
  if (Array.isArray(body.messages)) return body.messages;
  if (typeof body.prompt === 'string' && body.prompt.trim()) {
    return [{ role: 'user', content: body.prompt.trim() }];
  }
  return [];
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const index = trimmed.indexOf('=');
    if (index === -1) return;

    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}
