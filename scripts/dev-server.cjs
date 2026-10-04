// Local preview of the same public/ output deployed to hosting. Run pnpm dev.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { projectRoot } = require('./app-source.cjs');
const root = path.join(projectRoot, 'public');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.webp':'image/webp' };
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Build first with pnpm run build');
const server = http.createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(400).end(); }
});
server.listen(4173, '127.0.0.1', () => console.log('SAPURI preview: http://127.0.0.1:4173 — rebuild/restart after editing src/.'));
