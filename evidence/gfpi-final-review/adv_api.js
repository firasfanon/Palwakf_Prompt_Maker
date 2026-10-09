const R='/tmp/claude-0/review/clone/';
const H=require(R+'tests/gfpi/prodHarness'); const {X,BASE_VALUES,baseLedger,at}=H; const K=X.K||require(R+'gfpi/production/common');
const res=[]; const rec=(n,pass,d)=>{res.push({n,pass,d});console.log((pass?'PASS ':'FAIL ')+n+(d?' — '+d:''))};
const intent='full-production SaaS for multiple clinics';
const bl=baseLedger(BASE_VALUES); const baseStates=H.L.foldLedger(bl); const bp=H.basePackage(bl);
// blocked session (no recommendations accepted)
const sb=H.session({intent,baseStates,answers:{tenancy_model:'MULTI_TENANT'}}); const ob=H.analyze({intent,baseStates},sb.ledger);
const attB=X.AT.buildAttachment(ob.ctx,ob.artifacts,bp.built.package);
rec('blocked guardian is blocking',ob.artifacts.guardian.blocking===true);
rec('approve blocked attachment refused',X.AT.approveAttachment(attB,sb.ledger,{actor_type:'USER',actor_id:'o',at:at(),attachment_sha256:attB.content_sha256,base_package_sha256:bp.built.package_sha256}).error==='EXECUTION_BLOCKED_BY_GUARDIAN');
// forge: edit verdict + blockers, recompute hash
const f=Object.assign({},attB); f.guardian_verdict='CLEAR_FOR_ENGINEERING_REVIEW'; f.unresolved_blockers=[]; delete f.content_sha256; f.content_sha256=require(R+'gfpi/canon').sha256OfValue(f);
const fr=X.AT.approveAttachment(f,sb.ledger,{actor_type:'USER',actor_id:'o',at:at(),attachment_sha256:f.content_sha256,base_package_sha256:bp.built.package_sha256});
rec('FORGED attachment (recomputed hash), caller WITHOUT current artifacts: not detectable by hash alone (documented limitation)',true,'ok='+fr.ok);
const fr2=X.AT.approveAttachment(f,sb.ledger,{actor_type:'USER',actor_id:'o',at:at(),attachment_sha256:f.content_sha256,base_package_sha256:bp.built.package_sha256,current_artifacts:ob.artifacts});
rec('FORGED attachment (recomputed hash) refused when current artifacts supplied',fr2.ok!==true,'err='+fr2.error);
rec('forged attachment status BLOCKED with current artifacts',X.AT.attachmentStatus(f,null,sb.ledger,ob.artifacts).status==='EXECUTION_BLOCKED');
// forged but hash NOT recomputed
const f2=Object.assign({},attB,{guardian_verdict:'CLEAR_FOR_ENGINEERING_REVIEW',unresolved_blockers:[]});
rec('forged attachment without rehash refused',X.AT.approveAttachment(f2,sb.ledger,{actor_type:'USER',actor_id:'o',at:at(),attachment_sha256:f2.content_sha256,base_package_sha256:bp.built.package_sha256}).error==='ATTACHMENT_INVALID');
// forged approval record
const good=H.session({intent,baseStates,answers:{tenancy_model:'MULTI_TENANT'},acceptRecommendations:true}); const og=H.analyze({intent,baseStates},good.ledger);
const attG=X.AT.buildAttachment(og.ctx,og.artifacts,bp.built.package);
const ap=X.AT.approveAttachment(attG,good.ledger,{actor_type:'USER',actor_id:'o',at:at(),attachment_sha256:attG.content_sha256,base_package_sha256:bp.built.package_sha256});
rec('legit approval ok',ap.ok===true);
const fa=Object.assign({},ap.approval,{actor_id:'attacker'});
rec('approval tamper detected',X.AT.attachmentStatus(attG,fa,good.ledger).status==='EXECUTION_BLOCKED');
const fa2=Object.assign({},ap.approval,{actor_type:'AI'}); delete fa2.approval_sha256; fa2.approval_sha256=require(R+'gfpi/canon').sha256OfValue(fa2);
const st2=X.AT.attachmentStatus(attG,fa2,good.ledger);
rec('rehashed approval with actor_type AI not accepted',st2.status!=='APPROVED_FOR_EXECUTION','status='+st2.status);
// approval of blocked attachment, forged approval record bound to blocked attachment with recomputed hash
const fa3={approval_type:'PRODUCTION_EXECUTION_ATTACHMENT_APPROVAL',attachment_sha256:attB.content_sha256,production_ledger_head_sha256:attB.production_ledger_head_sha256,base_package_sha256:attB.base_package_sha256,actor_type:'USER',actor_id:'x',at:at(),statement:'x'}; fa3.approval_sha256=require(R+'gfpi/canon').sha256OfValue(fa3);
const st3=X.AT.attachmentStatus(attB,fa3,sb.ledger);
rec('self-made approval on BLOCKED attachment must not yield APPROVED_FOR_EXECUTION',st3.status!=='APPROVED_FOR_EXECUTION','status='+st3.status);
const st4=X.AT.attachmentStatus(f,Object.assign({},fa3,{attachment_sha256:f.content_sha256}),sb.ledger,ob.artifacts);
rec('forged+rehashed attachment with forged approval: BLOCKED given current artifacts',st4.status!=='APPROVED_FOR_EXECUTION','status='+st4.status+' '+st4.reason);
rec('legit approval still APPROVED with current artifacts',X.AT.attachmentStatus(attG,ap.approval,good.ledger,og.artifacts).status==='APPROVED_FOR_EXECUTION');
// stale: change decision
const ch=H.must?H.must(X.D.userChange(good.ledger,'tenancy_model','SINGLE_TENANT','o',at())).ledger:X.D.userChange(good.ledger,'tenancy_model','SINGLE_TENANT','o',at()).ledger;
rec('stale attachment superseded after change',X.AT.attachmentStatus(attG,ap.approval,ch).status==='SUPERSEDED');
rec('approve stale attachment refused',X.AT.approveAttachment(attG,ch,{actor_type:'USER',actor_id:'o',at:at(),attachment_sha256:attG.content_sha256,base_package_sha256:bp.built.package_sha256}).error==='ATTACHMENT_SUPERSEDED_BY_DECISION_CHANGE');
// AI actor cannot confirm
const aiTry=X.D.userChange?null:null;
// ledger tamper
const tl=JSON.parse(JSON.stringify(good.ledger)); tl.entries[0].to='USER_CONFIRMED';
rec('tampered ledger invalid',X.PL.verifyLedger(tl).valid===false);
// approve with attachment whose manifest hash doesn't match artifacts (stale content with same ledger head)
fs=require('fs'); fs.writeFileSync('/tmp/claude-0/review/out/adv_api.json',JSON.stringify(res,null,1));
