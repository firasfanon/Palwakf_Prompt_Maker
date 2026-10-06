'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIST = path.join(__dirname, '..', '..', 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json' };
http.createServer((req, res) => {
  let p = req.url === '/' ? '/prompt-maker-app.html' : req.url;
  const file = path.join(DIST, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
    res.end(data);
  });
}).listen(4173, () => console.log('static server on :4173'));
