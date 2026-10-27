import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {entries,phaseModules} from './web/phase-home.mjs';
const roles=JSON.parse(fs.readFileSync(new URL('./roles.json',import.meta.url)));
const source=fs.readFileSync(new URL('./CandidateIdentityUi.cs',import.meta.url),'utf8');
const rules=source.match(/const workspaceRules=Object.freeze\(([^\n]+)\);/)[1];
const install=source.slice(source.indexOf('  function installCapabilities(body){'),source.indexOf('  function showIdentity(body){'));
const checks=[];
for(const role of roles){
 const ids=['dle-home',...Object.keys(phaseModules),'kitting','production','purchasing','operations-center','invoice-history'];
 const options=ids.map(value=>({value,dataset:{}}));
 const selector={options,selectedOptions:[options[0]]};
 const context={window:{DleOsBootstrap:{authorizationReady(){}}},document:{body:{},querySelectorAll(){return[]},getElementById(id){return id==='workspaceViewSelect'?selector:null},addEventListener(){}},MutationObserver:class{observe(){}},announceCapabilities(c){c.apply()}};
 const controlRules=source.slice(source.indexOf('  const rules=Object.freeze('),source.indexOf('  const workspaceRules='));
 vm.createContext(context);vm.runInContext(`${controlRules}const workspaceRules=Object.freeze(${rules});${install}`,context);
 context.installCapabilities({permissions:role.permissions,roles:[role.code],allowedWorkspaces:role.workspaces,isSuperAdmin:false});
 assert.deepEqual(options.filter(o=>!o.hidden&&!o.disabled).map(o=>o.value).sort(),[...role.workspaces].sort());
 assert.equal(context.window.DleOsCapabilities.isSuperAdmin,false);
 assert.equal(context.window.DleOsCapabilities.kittingWorkspaceAvailable,false);
 checks.push(role.code+' actual bootstrap visibility and no Kitting/admin');
 const tiles=entries([{id:'kitting',requiredPermission:'kitting.view'}],p=>role.permissions.includes(p),Object.fromEntries(Object.keys(phaseModules).map(id=>[id,true])));
 assert.deepEqual(tiles.filter(t=>t.enabled).map(t=>t.nativeId).sort(),role.workspaces.filter(id=>id!=='dle-home').sort());
 checks.push(role.code+' actual Home enabled tiles match');
 // A broad permission does not override the explicit workspace restriction.
 context.installCapabilities({permissions:[...role.permissions,'technical_review.view','kitting.view'],allowedWorkspaces:role.workspaces,isSuperAdmin:false});
 assert.equal(options.find(o=>o.value==='technical-review').disabled,true);
 assert.equal(options.find(o=>o.value==='kitting').disabled,true);
 checks.push(role.code+' explicit workspace cap rejects extra permission'); if(role.persona==='ray'){
  context.installCapabilities({permissions:[],roles:['SUPER_ADMIN'],allowedWorkspaces:['dle-home','rfqs'],isSuperAdmin:true});
  assert.equal(options.filter(o=>o.disabled||o.hidden).length,0);
  checks.push('existing SUPER_ADMIN retains all existing DEV workspaces');
 }
}
fs.writeFileSync(new URL('./roles-ui-results.json',import.meta.url),JSON.stringify({Passed:true,Count:checks.length,Checks:checks,BrowserExecuted:false},null,2));
console.log('PASS '+checks.length+' actual bootstrap/Home module checks (Node VM, not browser)');
