// Serves the installable app in docs/ as GitHub Pages would: plain static
// files (compressed when the browser accepts it), docs/404.html for a
// missing address, and no server-side storage. Usage: npm run serve:docs
// (PORT defaults to 8080).
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', 'docs');
/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function createStaticServer() {
  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.normalize(path.join(ROOT, pathname));
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        // Like Pages: any missing address gets docs/404.html.
        fs.readFile(path.join(ROOT, '404.html'), (err404, page) => {
          if (err404) res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
          else res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(page);
        });
        return;
      }
      const type = TYPES[path.extname(file)] || 'application/octet-stream';
      // Pages compresses text files for browsers that accept it; so does this.
      const compress = /^(text|application\/(javascript|json|manifest))/.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding', ...(compress ? { 'Content-Encoding': 'gzip' } : {}) });
      res.end(compress ? zlib.gzipSync(data) : data);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  createStaticServer().listen(port, () => {
    console.log(`Serving docs/ at http://localhost:${port}`);
  });
}

module.exports = { createStaticServer };
