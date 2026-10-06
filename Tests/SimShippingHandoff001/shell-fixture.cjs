// Run the repository's actual shell navigation with the isolated Shipping API.
const fs=require('node:fs');
const source=fs.readFileSync('DLE_Work_Center_v4.0.0.html','latin1');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
module.exports=async function installShell(page){
 await page.evaluate(()=>{
  if(!document.querySelector('main')){
   const main=document.createElement('main');main.innerHTML='<section id="home" class="screen active"><div class="workspace-home active" data-workspace-home="shipping"></div></section>';
   document.body.append(main);const queue=document.querySelector('#queue');queue.dataset.workspaceMount='shipping';main.querySelector('[data-workspace-home]').append(queue);
   const style=document.createElement('style');style.textContent='.screen:not(.active){display:none}';document.head.append(style);
  }
 });
 await page.addScriptTag({url:'/SRC/shell/workspace-registry.js'});
 await page.addScriptTag({url:'/SRC/shell/workspace-shell.js'});
 await page.addScriptTag({url:'/SRC/modules/shipping/shipping-workspace.js'});
 await page.addScriptTag({content:`let currentScreen='home';let screenHistory=[];
 window.updatePills=()=>{};
 window.updateWorkspaceHomeView=()=>DleWorkspaceShell.updateWorkspaceHomeView();
 window.setWorkspaceView=id=>{window.entered=id;DleWorkspaceShell.setWorkspaceView(id);};
 ${between('    function go(id,','    function goBack()')}
 ${between('    function goBack()','    function goHome()')}
 ${between('    function updateBackButton()','    function updatePills()')}
 DleWorkspaceShell.init();setWorkspaceView('shipping');`});
};
