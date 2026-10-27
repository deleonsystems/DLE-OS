// Production scoped transport. Identity comes only from the existing server session.
export function createQuotingTransport({origin,csrf,fetcher=fetch}){
 let epoch=0,closed=false;const pending=new Set();
 function cancel(){epoch++;for(const c of pending)c.abort();pending.clear();}
 return Object.freeze({cancel,close(){closed=true;cancel();},async request(path,options={}){
  if(closed)throw Error('Session unavailable');
  const url=new URL(path,origin);
  if(url.origin!==origin||!(url.pathname.startsWith('/api/quoting/v1/')||url.pathname.startsWith('/incoming/SRC/')))throw Error('Unmapped integration resource');
  const headers=new Headers(options.headers);for(const name of ['X-Fixture-Session','X-Rehearsal-Intent','X-DLE-OS-Identity-Assertion','X-DLE-OS-Correlation-ID','Authorization'])headers.delete(name);
  const method=(options.method||'GET').toUpperCase();
  if(!['GET','HEAD'].includes(method)){const token=csrf();if(!token)throw Error('Session integrity token unavailable');headers.set('RequestVerificationToken',token);}
  const generation=epoch,controller=new AbortController();pending.add(controller);
  const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)controller.abort();
  try{const response=await fetcher(url,{...options,headers,credentials:'same-origin',signal:controller.signal});
   if(generation!==epoch||controller.signal.aborted)throw new DOMException('Workspace/session changed','AbortError');
   if(response.status===401){closed=true;cancel();throw Error('Session unavailable');}return response;
  }finally{pending.delete(controller);options.signal?.removeEventListener('abort',abort);}
 }});
}
