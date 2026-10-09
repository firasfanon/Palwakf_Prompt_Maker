const path=require('path');const root=process.argv[2];const src=require('fs').readFileSync(path.join(root,'evidence/gfpi-operational-mb1/repro/a11y_audit.js'),'utf8');
const m=src.match(/const AUDIT = \(\) => \{[\s\S]*?\n\};/);const AUDIT=eval('('+m[0].replace('const AUDIT = ','').replace(/;\s*$/,'')+')');
const {chromium}=require(path.join(root,'node_modules/playwright'));
(async()=>{const b=await chromium.launch();const p=await b.newPage();await p.setContent('<html><body><button id="x"></button><input id="x"><div style="width:3000px">w</div></body></html>');
console.log(JSON.stringify(await p.evaluate(AUDIT)));await b.close();})();
