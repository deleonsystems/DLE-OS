// Read-only visual fixture: renders a saved response; never contacts the SIM API.
import fs from 'node:fs';
import http from 'node:http';
const folder='output/source-pn-compact/';
const envelope=fs.readFileSync(folder+'envelope.json','utf8').replace(/^\uFEFF/,'');
const shell=fs.readFileSync('DLE_Work_Center_v4.0.0.html','utf8');
const baseStyles=[...shell.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname!=='/fixture'){
    res.end(`<!doctype html><style>body{margin:12px;background:#090f19;color:#e2e8f0;font:14px Arial}a{color:#93c5fd;margin-right:16px}iframe{display:block;height:850px;border:1px solid #334155;margin-top:12px}</style><nav><a href="/?width=1280">Normal 1280</a><a href="/?width=900">Narrow 900</a><a href="/?width=1280&before=1">Before</a></nav><p id="result">Read-only visual fixture. API requests are blocked.</p><iframe title="Candidate BOM visual fixture" style="width:${url.searchParams.get('width')==='900'?'900':'1280'}px" src="/fixture${url.searchParams.has('before')?'?before=1':''}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin)document.getElementById('result').textContent=e.data})</script>`);return;
  }
  const before=url.searchParams.has('before');
  const script=fs.readFileSync(before?folder+'before.js':'SRC/workspaces/technical-review/technical-review-workspace.js','utf8').replace('  window.DleWorkspaces = window.DleWorkspaces || {};','  window.visual={state,renderDetail,bindInteractions,setMount:x=>mount=x};\n  window.DleWorkspaces = window.DleWorkspaces || {};');
  const css=fs.readFileSync(before?folder+'before.css':'SRC/workspaces/technical-review/technical-review-workspace.css','utf8');
  res.end(`<!doctype html><meta charset="utf-8"><style>${baseStyles}\n${css}\nbody{margin:0;background:#0b1220;font-family:Arial,sans-serif}.technical-review-workspace{padding:16px}</style><div data-workspace-mount="technical-review" class="technical-review-guided"><div class="technical-review-workspace"><div id="technicalReviewDetail"></div></div></div><script>${script}</script><script>
  window.fetch=()=>{throw Error('API disabled in visual fixture')};
  const t=window.visual;t.setMount(document.querySelector('[data-workspace-mount]'));t.bindInteractions();t.state.selected=${envelope};t.state.step='candidate';t.state.guided=true;t.renderDetail();
  const heights=()=>[...document.querySelectorAll('tr[data-worksheet-row]')].map(r=>r.getBoundingClientRect().height);
  let prior=heights();
  document.addEventListener('click',()=>{prior=heights()},true);
  document.addEventListener('toggle',event=>{
    if(!event.target.matches('.source-pn-popover,.source-pn-review'))return;
    requestAnimationFrame(()=>{const after=heights(),panel=event.target,box=panel.getBoundingClientRect(),open=panel.matches('[popover]')?panel.matches(':popover-open'):panel.open;
      const delta=Math.max(0,...after.map((h,i)=>Math.abs(h-prior[i])));
      parent.postMessage('Viewport '+innerWidth+'px; rows '+after.length+'; maximum row-height change '+delta+'px; editor '+(open?'open':'closed')+(open?'; panel '+Math.round(box.width)+' × '+Math.round(box.height)+'px; within viewport '+(box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight):'')+'; no API writes',location.origin);
    });
  },true);
  </script>`);
}).listen(5198,'127.0.0.1',()=>console.log('Read-only visual fixture: http://127.0.0.1:5198'));
