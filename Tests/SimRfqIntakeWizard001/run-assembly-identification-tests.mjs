import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../SRC/modules/rfq-workspace/intake-wizard.js', import.meta.url), 'utf8');
const functions = ['selectChoice','renderStep','preliminaryAssemblyLabel','clearAnswerForStep','handleSubmit','escapeHtml'].map(name => {
  const start = source.indexOf('  function '+name+'(');
  return source.slice(start,source.indexOf('\n  }',start)+4);
});
const context = {state:{currentStep:6,intakeType:'NEW_QUOTE_REQUEST',preliminaryAssemblyType:null},steps:()=>['intake-type','customer','assembly-count','assembly-number','revision','quantity','assembly-type','scope'],next(){context.state.currentStep++;},render(){},question:(title,body,hint)=>title+body+hint,choice:(label,value)=>'<button data-choice="'+value+'">'+label+'</button>'};
vm.createContext(context);
vm.runInContext(source.match(/^  const intakeAssemblyTypes =.*$/m)[0]+'\n'+functions.join('\n'),context);
assert.match(source,/"quantity", "assembly-type", "scope"/);
assert.equal((context.renderStep().match(/data-choice=/g)||[]).length,5);
for(const type of ['PCB_ASSEMBLY','CABLE_AND_HARNESS_ASSEMBLY','CHASSIS_BOX_BUILD_ASSEMBLY','UNKNOWN']) {
 context.state.currentStep=6;context.selectChoice('assembly-type',type);
 assert.equal(context.state.preliminaryAssemblyType.type,type);assert.equal(context.state.currentStep,7);
}
context.state.currentStep=6;context.selectChoice('assembly-type','OTHER');
assert.equal(context.state.currentStep,6);assert.match(context.renderStep(),/Describe the assembly type/);assert.match(context.renderStep(),/maxlength="200"/);
context.handleSubmit({preventDefault(){},target:{closest(selector){return selector==='[data-intake-form]'?{dataset:{intakeForm:'assembly-type-description'},querySelector(){return {value:'Test fixture'}}}:null;}}});
assert.equal(context.state.preliminaryAssemblyType.otherDescription,'Test fixture');assert.equal(context.state.currentStep,7);
context.selectChoice('assembly-type','UNKNOWN');assert.equal(context.state.preliminaryAssemblyType.otherDescription,null);
context.clearAnswerForStep(6);assert.equal(context.state.preliminaryAssemblyType,null);
console.log('PASS: assembly step order, five choices, navigation, Other description, Unknown and edit reset.');
