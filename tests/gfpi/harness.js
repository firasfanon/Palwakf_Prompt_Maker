'use strict';
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function runAll(label) {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  ok   ' + t.name); }
    catch (e) { fail++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e)); }
  }
  console.log('\n' + label + ': ' + pass + '/' + (pass + fail) + ' passed');
  if (fail) process.exit(1);
}
module.exports = { test, runAll };
