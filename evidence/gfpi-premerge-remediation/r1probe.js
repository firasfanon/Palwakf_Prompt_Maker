const {chromium}=require('/tmp/claude-0/-home-claude/08b8c8c2-6cf8-4695-b690-d26fc7bf7c3e/scratchpad/pbv/m/node_modules/playwright');
const file=process.argv[2];
(async()=>{const b=await chromium.launch();
for (const fam of ['(default)','DejaVu Sans','Liberation Sans','Noto Sans','Verdana']) for (const dir of ['rtl','ltr']) {
 const p=await b.newPage({viewport:{width:390,height:844}}); await p.goto('file://'+file);
 if(fam!=='(default)') await p.addStyleTag({content:'*{font-family:"'+fam+'",sans-serif !important}'});
 await p.evaluate(d=>{document.documentElement.dir=d},dir);
 const r=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,h1:Math.round(document.querySelector('header h1').getBoundingClientRect().width),h1left:Math.round(document.querySelector('header h1').getBoundingClientRect().left)}));
 console.log(fam.padEnd(16),dir,JSON.stringify(r)); await p.close();}
await b.close()})()
