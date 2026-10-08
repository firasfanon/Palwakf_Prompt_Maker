'use strict';
// Generates schemas/gfpi/<Type>.schema.json from gfpi/artifacts.js. `--check` fails on drift.
const fs = require('fs');
const path = require('path');
const { GFPI_ARTIFACT_TYPES, toJsonSchema } = require('../gfpi/artifacts');

const dir = path.join(__dirname, '..', 'schemas', 'gfpi');
const check = process.argv.includes('--check');
let drift = 0;
fs.mkdirSync(dir, { recursive: true });
Object.keys(GFPI_ARTIFACT_TYPES).forEach((t) => {
  const text = JSON.stringify(toJsonSchema(t), null, 2) + '\n';
  const file = path.join(dir, t + '.schema.json');
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('DRIFT: ' + file); drift++; }
  } else fs.writeFileSync(file, text);
});
if (check) { if (drift) process.exit(1); console.log('gfpi schemas: no drift (' + Object.keys(GFPI_ARTIFACT_TYPES).length + ')'); }
else console.log('gfpi schemas written');
