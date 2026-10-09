const R='/tmp/claude-0/review/clone/'; const {compileProject}=require(R+'src/index.js');
const RealDate=Date; const T=RealDate.UTC(2026,9,9,12,0,0,0);
class Frozen extends RealDate{constructor(...a){a.length?super(...a):super(T)} static now(){return T}}
global.Date=Frozen; const i={project_name:'تحديد',project_goal:'نظام للاختبار'};
const r1=compileProject(JSON.parse(JSON.stringify(i))),r2=compileProject(JSON.parse(JSON.stringify(i)));
console.log('frozen clock: generated_at equal =',r1.receipt.generated_at===r2.receipt.generated_at,'| content hashes equal =',r1.receipt.blueprint_content_hash===r2.receipt.blueprint_content_hash, r1.receipt.generated_at);
