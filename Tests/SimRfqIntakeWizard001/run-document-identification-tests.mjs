import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../SRC/modules/rfq-workspace/intake-wizard.js', import.meta.url), 'utf8');
const names = ['renderFiles','handleChange','handleInput','setTechnicalFiles','technicalFileIdentity','removeTechnicalFile','formatBytes','escapeHtml'];
const functions = names.map(name => {
  const start = source.search(new RegExp('  (?:async )?function ' + name + '\\('));
  const end = source.indexOf('\n  }', start) + 4;
  // formatBytes is a one-line function.
  return name === 'formatBytes' ? source.slice(start, source.indexOf('\n', start)) : source.slice(start, end);
});
const context = {state:{technicalFiles:[],submit:{status:'idle'}}, root:{querySelector(){return null}}, render(){}, deleteStagedTechnicalFile:async()=>{}, console};
vm.createContext(context);
vm.runInContext(source.match(/^  const initialDocumentTypes =.*$/m)[0] + '\n' + functions.join('\n'), context);
const pdf = {name:'B11283-17 REV. B.pdf',size:10,type:'application/pdf',lastModified:1};
const xls = {name:'B11283-17-BOMCR1.xls',size:20,type:'application/vnd.ms-excel',lastModified:2};
context.setTechnicalFiles([pdf]); context.setTechnicalFiles([xls]);
let html = context.renderFiles();
assert.equal((html.match(/<option /g)||[]).length,10);
assert.equal((html.match(/value="UNKNOWN" selected/g)||[]).length,2);
const choose = (index,value) => context.handleChange({target:{matches:s=>s==='[data-intake-identification]',dataset:{intakeIdentification:String(index)},value}});
for (const type of ['DRAWING','DRAWING_AND_BOM','BOM_ONLY','OTHER','UNKNOWN']) {
  choose(0,type); assert.equal(context.state.technicalFiles[0].initialIdentification.type,type);
}
choose(0,'DRAWING_AND_BOM'); choose(1,'BOM_ONLY');
assert.equal(context.state.technicalFiles[0].initialIdentification.type,'DRAWING_AND_BOM');
assert.equal(context.state.technicalFiles[1].initialIdentification.type,'BOM_ONLY');
choose(1,'OTHER');
context.handleInput({target:{matches:s=>s==='[data-intake-identification-description]',dataset:{intakeIdentificationDescription:'1'},value:'Purchase specification <test>'}});
assert.match(context.renderFiles(),/Describe this file/);
assert.match(context.renderFiles(),/Purchase specification &lt;test&gt;/);
choose(1,'BOM_ONLY'); assert.doesNotMatch(context.renderFiles(),/Describe this file|Purchase specification/);
await context.removeTechnicalFile(0);
assert.equal(context.state.technicalFiles[0].name,xls.name);
assert.equal(context.state.technicalFiles[0].initialIdentification.type,'BOM_ONLY');
context.setTechnicalFiles([pdf]);
assert.equal(context.state.technicalFiles[1].initialIdentification,undefined);
assert.match(context.renderFiles(),/value="UNKNOWN" selected/);
assert.match(context.renderFiles(),/Preliminary/);
console.log('PASS: five preliminary choices, Unknown default, independent files, Other text, removal/re-add and escaped labels.');
