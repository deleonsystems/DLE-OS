import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../SRC/workspaces/technical-review/technical-review-workspace.js',import.meta.url),'utf8');
const names=['renderWorkflowStep','unifiedEligible','resumeWorkflow','packageDraft','flowButton','renderUnifiedGoverning','isBomSource','bomSourceLabel','escapeHtml'];
const parts=names.map(name=>{const start=source.indexOf('  function '+name+'(');const line=source.slice(start,source.indexOf('\n',start));return line.trimEnd().endsWith('}')?line:source.slice(start,source.indexOf('\n  }',start)+4);});
const state={selected:{record:{intakeType:'NEW_QUOTE_REQUEST',status:'TECHNICAL_REVIEW_IN_PROGRESS',technicalReview:{workflow:{}},technicalFiles:[{documentId:'pdf',name:'drawing.pdf',initialIdentification:{type:'DRAWING_AND_BOM'}},{documentId:'xls',name:'bom.xls',initialIdentification:{type:'BOM_ONLY'}}]}}};
const c={state,renderDetail(){},packageMessage(){return ''}};vm.createContext(c);vm.runInContext(parts.join('\n'),c);
const r=state.selected.record,w=r.technicalReview.workflow;
assert.equal(c.unifiedEligible(r),true);
const pack=c.packageDraft();assert.equal(pack.documents[0].documentType,'ASSEMBLY_DRAWING');assert.equal(pack.documents[0].embeddedBom,true);assert.equal(pack.documents[0].role,'UNRESOLVED');assert.equal(pack.documents[1].documentType,'BOM');assert.equal(pack.governingBomDocumentId,null);assert.equal(w.packageConfirmed,undefined);
for(const [changes,step] of [[{},'inventory'],[{packageConfirmed:true},'sufficiency'],[{sufficient:true},'context'],[{historyReviewed:true},'definition'],[{manufacturing:{id:'m'}},'governing']]) {Object.assign(w,changes);c.resumeWorkflow();assert.equal(state.step,step);}
r.technicalReview.candidateBom={};c.resumeWorkflow();assert.equal(state.step,'candidate');
r.technicalReview.materialsReviewStatus='QUALIFIED';c.resumeWorkflow();assert.equal(state.step,'release');
r.status='ON_HOLD';c.resumeWorkflow();assert.equal(state.step,'sufficiency');
const html=c.renderUnifiedGoverning({documents:[{documentId:'pdf',name:'drawing.pdf',documentType:'ASSEMBLY_DRAWING',embeddedBom:true,applicability:'PARENT_ASSEMBLY'}],governingBomDocumentId:'pdf'});
assert.match(html,/Save selection and build Candidate BOM/);assert.doesNotMatch(html,/compare-package|Save selection and compare BOM/);
assert.equal(c.unifiedEligible({intakeType:'NEW_ORDER'}),false);assert.equal(c.unifiedEligible({intakeType:'NEW_QUOTE_REQUEST',technicalReview:{bomAcceptances:[{}]}}),false);
console.log('PASS: unified package prefill remains unconfirmed; resume checkpoints; hold precedence; Candidate-only material path; historical/New Order exclusion.');

state.step='definition';state.selected.manufacturingDrawingIds=['pdf'];w.manufacturingDrawingId='pdf';r.technicalReview.technicalPackage={documents:[{documentId:'pdf',name:'Reviewed drawing.pdf',documentType:'ASSEMBLY_DRAWING',role:'UNRESOLVED',applicability:'SUPPORTING_REFERENCE'},{documentId:'xls',name:'BOM only.xls',documentType:'BOM',role:'UNRESOLVED',applicability:'SUPPORTING_REFERENCE'}]};
const definition=c.renderWorkflowStep(r);assert.match(definition,/<option value="pdf" selected>Reviewed drawing.pdf/);assert.doesNotMatch(definition,/<option value="xls"/);
console.log('PASS: manufacturing dropdown uses server eligibility and restores saved drawing selection.');
