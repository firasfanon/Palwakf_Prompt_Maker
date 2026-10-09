const H=require('./rh.js'); const fs=require('fs');
(async()=>{
const srv=await H.startStatic(); const br=await H.chromium.launch();
await H.test('R10 UI forgery: blocked attachment tampered in storage (verdict+blockers+recomputed hash+self approval) must NOT show APPROVED',async()=>{
  const m=await H.openPage(br); await H.setMode(m,'GUIDED'); await H.tabTo(m,'Q'); await H.fillBase(m,{deferStack:true}); await H.startProd(m,H.NONTECH);
  await H.tabTo(m,'P'); await m.click('#btn-gen'); await m.waitForSelector('#pkg-card'); await m.locator('#chk-technology_stack').check(); await m.click('#btn-approve'); await m.waitForSelector('#pkg-status');
  await H.tabTo(m,'F'); await H.sub(m,'E'); await m.click('#btn-att-build'); await m.waitForSelector('#patt-status');
  H.eq(await m.getAttribute('#patt-status','data-status'),'EXECUTION_BLOCKED'); 
  H.eq(await m.locator('#btn-att-approve').count(),0,'no approve button when blocked');
  await m.evaluate(()=>{const C=window.GFPI.canon;const i=JSON.parse(localStorage.getItem('gfpi.v1.index'));const k='gfpi.v1.p.'+i[i.length-1].id;const r=JSON.parse(localStorage.getItem(k));
    const e=r.prod.attachments[0];const a=e.attachment;a.guardian_verdict='CLEAR_FOR_ENGINEERING_REVIEW';a.unresolved_blockers=[];delete a.content_sha256;a.content_sha256=C.sha256OfValue(a);
    const ap={approval_type:'PRODUCTION_EXECUTION_ATTACHMENT_APPROVAL',attachment_sha256:a.content_sha256,production_ledger_head_sha256:a.production_ledger_head_sha256,base_package_sha256:a.base_package_sha256,actor_type:'USER',actor_id:'forger',at:new Date().toISOString(),statement:'x'};ap.approval_sha256=C.sha256OfValue(ap);e.approval=ap;localStorage.setItem(k,JSON.stringify(r));});
  await m.reload(); await m.waitForTimeout(300);
  if(!(await m.locator('#tab-F').count())) throw new Error('no tab');
  await H.tabTo(m,'F'); await H.sub(m,'E').catch(()=>{});
  const st=await m.getAttribute('#patt-status','data-status').catch(()=>'(none)'); console.log('   status after forgery:',st);
  await m.screenshot({path:'/tmp/claude-0/review/out/shots/forged_att.png',fullPage:true});
  H.ok(st!=='APPROVED_FOR_EXECUTION','FORGED approval displayed as APPROVED_FOR_EXECUTION');
});
await H.test('R11 exported stale attachment carries its own status (not ambiguous)',async()=>{
  const m=await H.openPage(br); await H.fullJourney(m);
  await H.tabTo(m,'P'); await m.click('#btn-gen'); await m.waitForSelector('#pkg-card'); await m.locator('#chk-technology_stack').check(); await m.click('#btn-approve'); await m.waitForSelector('#pkg-status');
  await H.tabTo(m,'F'); await H.sub(m,'E'); await m.click('#btn-att-build'); await m.click('#btn-att-approve');
  await H.sub(m,'D'); await m.click('#psec-decided summary'); await m.click('#pbtn-change-tenancy_model'); await m.check('input[name="pchg-tenancy_model"][value="SINGLE_TENANT"]'); await m.click('#pbtn-apply-tenancy_model');
  await H.sub(m,'E'); const [dl]=await Promise.all([m.waitForEvent('download'),m.click('#btn-att-dl')]); const p=await dl.path(); const j=JSON.parse(fs.readFileSync(p,'utf8'));
  console.log('   export keys:',Object.keys(j).join(','),'| status shown in UI:',await m.getAttribute('#patt-status','data-status'));
  H.ok('status' in j,'export lacks status field (stale approved attachment is indistinguishable from valid)');
});
await H.test('R12 keyboard: production tab reachable and operable with Tab/Enter only',async()=>{
  const m=await H.openPage(br); await H.tabTo(m,'F'); await H.sub(m,'D'); await m.fill('#prod-intent','full production SaaS clinics'); await m.focus('#btn-prod-start'); await m.keyboard.press('Enter'); await m.waitForSelector('#pprogress, #pnot-active');
  const f=await m.evaluate(()=>document.activeElement && (document.activeElement.id||document.activeElement.tagName)); console.log('   focus after start:',f);
});
await H.test('R13 external network / CSP: zero external requests, zero page errors',async()=>{
  const m=await H.openPage(br); await H.fullJourney(m); H.eq(m.__external.length,0,m.__external.join(',')); H.eq(m.__errors.length,0,m.__errors.join('|'));
});
fs.writeFileSync('/tmp/claude-0/review/out/adv_ui2_results.json',JSON.stringify(H.getCounts(),null,1));
console.log(JSON.stringify({passed:H.getCounts().passed,failed:H.getCounts().failed}));
await br.close(); srv.close();
})();
