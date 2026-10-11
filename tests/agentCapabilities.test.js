'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256, createAgentCapabilitiesHandoff } = require('../src/agentCapabilityContracts');

const ROOT = path.resolve(__dirname, '..');
const BP = path.join(ROOT, 'evidence', 'pm-factory-integrated-v1', 'integration', 'bp', 'new_react_desktop.json');
function input() { const raw = fs.readFileSync(BP); return { raw, blueprint: JSON.parse(raw.toString('utf8')) }; }
const make = () => { const {raw, blueprint} = input(); return createAgentCapabilitiesHandoff(blueprint, raw); };

test('reference contract is bound to exact blueprint bytes', () => {
  const {raw, blueprint} = input(); const result=make();
  assert.equal(result.contract_id, 'PM_FACTORY_AGENT_CAPABILITIES_HANDOFF_V1');
  assert.equal(result.producer.blueprint_sha256, sha256(raw));
  assert.equal(result.producer.project_name, blueprint.project_name);
  assert.deepEqual(result.ui_ux_design.product_surfaces, blueprint.product_surfaces);
  assert.equal(result.ui_ux_design.output_claim, 'NOT_GENERATED');
});

test('agent authority always remains false and review is not faked', () => {
  const h=make();
  assert.equal(h.authority.runtime_admission, false);
  assert.equal(h.authority.execution_authorized, false);
  assert.equal(h.skills_selection.status, 'NOT_INVOKED');
  assert.equal(h.skills_selection.runtime_admitted, false);
  assert.deepEqual(h.skills_selection.selected_skills, []);
  assert.deepEqual(h.visual_qa_feedback.findings, []);
  assert.equal(h.visual_qa_feedback.status, 'NOT_RUN');
  assert.equal(h.materialization.production_ready, false);
});

test('skills reference request uses the exact nonmutating scope', () => {
  const h=make();
  assert.equal(h.skills_selection.capability, 'skills.select.read_only');
  assert.equal(h.skills_selection.request.scope, 'engineering_reference');
  assert.equal(h.skills_selection.request.requested_mode, 'read_only_reference');
  assert.match(h.skills_selection.request.task_id, /^pmref_[a-f0-9]{24}$/);
});

test('contract generation is deterministic', () => {
  const a=make(); const b=make();
  assert.deepEqual(a,b);
  assert.equal(JSON.stringify(a),JSON.stringify(b));
});

test('invalid and mismatched inputs rejected with no output claim', () => {
  const {raw,blueprint}=input();
  assert.throws(()=>createAgentCapabilitiesHandoff({}, raw),/INVALID_BLUEPRINT/);
  assert.throws(()=>createAgentCapabilitiesHandoff(blueprint,Buffer.from('{}')), /MISMATCH/);
  const changed={...blueprint, project_name:'forged'};
  assert.throws(()=>createAgentCapabilitiesHandoff(changed,raw), /MISMATCH/);
  assert.throws(()=>createAgentCapabilitiesHandoff(blueprint,Buffer.alloc(3*1024*1024+1)), /SIZE_LIMIT/);
});

test('unknown source fields cannot grant execution',()=>{
  const {raw,blueprint}=input();
  const extended={...blueprint, x_execution_authorized:true, x_runtime_admitted:true};
  const bytes=Buffer.from(JSON.stringify(extended));
  const h=createAgentCapabilitiesHandoff(extended,bytes);
  assert.equal(h.authority.execution_authorized,false);
  assert.equal(h.skills_selection.runtime_admitted,false);
});

test('design references copied only from explicitly confirmed input',()=>{
  const {blueprint}=input();
  const clone=JSON.parse(JSON.stringify(blueprint));
  clone.confirmed_requirements=[{field:'design_references',status:'CONFIRMED',value:'RTL professional reference'},
   {field:'design_references',status:'ASSUMED',value:'unconfirmed style'}];
  const h=createAgentCapabilitiesHandoff(clone,Buffer.from(JSON.stringify(clone)));
  assert.deepEqual(h.ui_ux_design.confirmed_design_references,['RTL professional reference']);
});

test('CLI writes exclusive sidecar and rejects replay',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-agent-handoff-'));
  try{
    const target=path.join(dir,'handoff.json');
    const argv=[path.join(ROOT,'tools','agent-capabilities-handoff.js'),'--blueprint',BP,'--out',target];
    const first=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:15000});
    assert.equal(first.status,0,first.stderr);
    const bytes=fs.readFileSync(target);
    const second=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:15000});
    assert.notEqual(second.status,0);
    assert.deepEqual(fs.readFileSync(target),bytes);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
