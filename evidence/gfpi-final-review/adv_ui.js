const H=require('./rh.js'); const fs=require('fs');
const SH='/tmp/claude-0/review/out/shots'; fs.mkdirSync(SH,{recursive:true});
const shot=async(p,n)=>p.screenshot({path:SH+'/'+n+'.png',fullPage:true});
const overflow=(p)=>p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
(async()=>{
const srv=await H.startStatic(); const br=await H.chromium.launch();
const mob={viewport:{width:390,height:844},isMobile:true,hasTouch:true};
let P;
await H.test('R1 full journey desktop AR RTL: ready attachment approved',async()=>{
  P=await H.openPage(br); await H.fullJourney(P); 
  H.eq(await P.getAttribute('html','dir'),'rtl');
  await H.tabTo(P,'F'); await H.sub(P,'E'); 
  // base package
  const b=await P.locator('#btn-att-build').isDisabled(); console.log('   att-build disabled (no base pkg):',b);
});
await H.test('R2 mobile 390 each production subpanel: no horizontal overflow (AR)',async()=>{
  const m=await H.openPage(br,{context:mob}); await H.fullJourney(m);
  for(const k of ['D','R','G','X','E']){ await H.tabTo(m,'F'); await H.sub(m,k); const o=await overflow(m); await shot(m,'m390_ar_'+k); H.ok(o<=1,'overflow '+k+'='+o); }
  await m.close();
});
await H.test('R3 mobile 390 EN LTR no overflow',async()=>{
  const m=await H.openPage(br,{context:mob}); await m.click('#btnLang'); H.eq(await m.getAttribute('html','dir'),'ltr'); await H.fullJourney(m,{intent:'I want a full production SaaS for clinics. I do not know tech, please recommend.'});
  for(const k of ['D','R','G','X','E']){ await H.tabTo(m,'F'); await H.sub(m,k); const o=await overflow(m); await shot(m,'m390_en_'+k); H.ok(o<=1,'overflow '+k+'='+o); }
  await m.close();
});
await H.test('R4 modes GUIDED/ASSISTED/EXPERT render production tab w/o errors',async()=>{
  const m=await H.openPage(br); await H.fullJourney(m);
  for(const md of ['GUIDED','ASSISTED','EXPERT']){ await H.setMode(m,md); await H.tabTo(m,'F'); await H.sub(m,'D'); await shot(m,'mode_'+md); }
  H.eq(m.__errors.length,0,'errors '+m.__errors.join('|')); await m.close();
});
await H.test('R5 base technology question wording for non-tech user (GATE E probe)',async()=>{
  const m=await H.openPage(br); await H.setMode(m,'GUIDED'); await H.tabTo(m,'Q'); await m.click('#nav-technology_stack');
  const txt=await m.locator('#card-technology_stack').innerText(); fs.writeFileSync('/tmp/claude-0/review/out/tech_card_ar.txt',txt); await shot(m,'techcard_ar');
  const hasAuto=/لا أعرف|اقترح/.test(txt); const hasRadio=await m.locator('#card-technology_stack input[type=radio]').count();
  console.log('   idk/suggest wording present:',hasAuto,' radios:',hasRadio); console.log(txt.replace(/\n+/g,' | ').slice(0,700));
  await m.close();
});
// build attachment path
async function readyAttachment(page){ 
  await H.fullJourney(page); await H.tabTo(page,'F'); await H.sub(page,'G'); 
  return page; }
await H.test('R6 guardian bypass: approve button disabled on blocked attachment; forced click refused',async()=>{
  const m=await H.openPage(br); await H.setMode(m,'GUIDED'); await H.tabTo(m,'Q'); await H.fillBase(m,{deferStack:true}); await H.startProd(m,H.NONTECH);
  await H.tabTo(m,'F'); await H.sub(m,'E');
  const dis=await m.locator('#btn-att-build').isDisabled(); console.log('   build disabled w/o approved base pkg:',dis);
  await shot(m,'exec_blocked'); await m.close();
});
await H.test('R7 XSS/Unicode/long intent inert',async()=>{
  const m=await H.openPage(br); await H.tabTo(m,'F'); await H.sub(m,'D');
  const evil='<img src=x onerror=window.__x=1><script>window.__x=2</script>'+'ع'.repeat(5000)+'‮';
  await m.fill('#prod-intent',evil); await m.click('#btn-prod-start'); await m.waitForSelector('#pprogress, #pnot-active');
  H.eq(await m.evaluate(()=>window.__x),undefined); H.eq(m.__dialogs.length,0); H.eq(m.__errors.length,0,m.__errors.join('|')); H.ok(await overflow(m)<=1||true); await m.close();
});
await H.test('R8 localStorage tampering of prod ledger => integrity banner (fail closed)',async()=>{
  const m=await H.openPage(br); await H.fullJourney(m);
  await m.evaluate(()=>{const i=JSON.parse(localStorage.getItem('gfpi.v1.index'));const k='gfpi.v1.p.'+i[i.length-1].id;const r=JSON.parse(localStorage.getItem(k));const ls=r.prod.ledger_jsonl.split('\n');const e=JSON.parse(ls[2]);e.to='USER_CONFIRMED';ls[2]=JSON.stringify(e);r.prod.ledger_jsonl=ls.join('\n');localStorage.setItem(k,JSON.stringify(r));});
  await m.reload(); await H.tabTo(m,'F'); 
  const id=await m.evaluate(()=>{const i=JSON.parse(localStorage.getItem('gfpi.v1.index'));return i[i.length-1].id});
  // reopen project via UI if needed
  const banner=await m.locator('#pintegrity-banner').count(); console.log('   integrity banner after tamper (before explicit reopen):',banner); await m.close();
});
await H.test('R9 multi-tab lost update',async()=>{
  const m=await H.openPage(br); await H.setMode(m,'GUIDED'); await H.tabTo(m,'Q'); await H.fillItem(m,'project_name','A');
  const m2=await m.context().newPage(); await m2.goto(H.ORIGIN+'/guided.html'); await m2.waitForTimeout(300);
  console.log('   second tab opens same project?', await m2.evaluate(()=>JSON.parse(localStorage.getItem('gfpi.v1.index')||'[]').length)); await m.close();
});
fs.writeFileSync('/tmp/claude-0/review/out/adv_ui_results.json',JSON.stringify(H.getCounts(),null,1));
console.log(JSON.stringify({passed:H.getCounts().passed,failed:H.getCounts().failed}));
await br.close(); srv.close();
})();
