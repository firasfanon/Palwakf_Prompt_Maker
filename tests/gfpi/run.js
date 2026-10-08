'use strict';
const fs = require('fs');
const path = require('path');
const { runAll } = require('./harness');
fs.readdirSync(__dirname).filter((f) => /\.test\.js$/.test(f)).sort().forEach((f) => require(path.join(__dirname, f)));
runAll('GFPI').catch((e) => { console.error(e); process.exit(1); });
