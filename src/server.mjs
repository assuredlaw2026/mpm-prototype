// MPM prototype — HTTP server (node:http, no dependencies).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';
import { buildApp } from './app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' };

// Optional site-wide password gate. Active only when SITE_PASSWORD is set in the
// environment (e.g. on the host). When unset (local runs and the test suite) the
// gate is disabled, so behavior and tests are unchanged. Any username is accepted;
// only the password is checked.
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
function authorized(req) {
  if (!SITE_PASSWORD) return true;
  const h = req.headers['authorization'] || '';
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) return false;
  let decoded = '';
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch { return false; }
  const pass = decoded.slice(decoded.indexOf(':') + 1);
  const a = Buffer.from(pass), b = Buffer.from(SITE_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createServer(dbPath = ':memory:') {
  const db = openDb(dbPath);
  const route = buildApp(db);

  const server = http.createServer((req, res) => {
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="MPM Prototype", charset="UTF-8"', 'content-type': 'text/plain' });
      return res.end('Authentication required.');
    }
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams.entries());

    if (pathname.startsWith('/api/')) {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
      req.on('end', () => {
        let body = {};
        if (raw) { try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'E_BAD_JSON', message: 'invalid JSON body' }); } }
        const headers = { 'x-account-id': req.headers['x-account-id'] };
        const out = route(req.method, pathname, query, body, headers);
        send(res, out.status, out.body);
      });
      return;
    }
    // static / SPA
    serveStatic(res, pathname);
  });

  server.on('close', () => { try { db.close(); } catch {} });
  return server;
}

function send(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

function serveStatic(res, pathname) {
  // tenant deep link and app routes serve the SPA shell; real asset files (with an extension) are served as-is
  const isNavRoute = pathname === '/' || pathname === '/app' || pathname === '/inspect' || pathname.startsWith('/app/') || pathname.startsWith('/inspect/');
  let rel = isNavRoute ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (e, data) => {
    if (e) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  const server = createServer(process.env.DB_PATH || path.join(process.cwd(), 'mpm.db'));
  server.listen(port, () => {
    console.log(`MPM prototype running at http://localhost:${port}`);
    console.log('Phases 1-3 are live with backend enforcement. Phase 4 (live SMS/notice/mailing) is gated.');
  });
}
