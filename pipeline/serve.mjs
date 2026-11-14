// Tiny static server for local preview:  node pipeline/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const port = +process.argv[2] || 8765;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  // the AI endpoint only exists on the deployed Worker; locally the page falls back to its automatic summary
  if (rel === '/api/brief') { res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"AI runs on the deployed site only"}'); return; }
  let file = path.join(SITE, rel);
  if (!file.startsWith(SITE)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
