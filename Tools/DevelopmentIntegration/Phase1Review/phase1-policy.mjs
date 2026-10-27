// Candidate-only contract guard. No global fetch replacement and no role grants.
export const incoming = Object.freeze(['rfq-quoting','technical-review','assembly-library','rfqs']);
export const existing = Object.freeze(['operations-center','invoice-history','purchasing','kitting','production','paperwork-tracking']);
const permission={'rfq-quoting':'rfq.intake.create','technical-review':'technical_review.view','assembly-library':'assembly_library.view','rfqs':'rfq.view'};
export function qualified(runtime){return runtime?.environment==='ISOLATED_DEVELOPMENT'&&runtime?.phase1Enabled===true&&runtime?.quotingContract==='DEV_QUOTING_PHASE1_V1'&&runtime?.identityContract==='INTERNAL_USER_ID_V1'&&runtime?.storageApproved===true;}
export function destination(id,runtime,can){
 if(id.startsWith('existing:'))return existing.includes(id.slice(9))?{kind:'EXISTING_DEV',nativeId:id.slice(9),deferToExistingAuthorization:true,label:'DEV existing'}:{kind:'DENIED',reason:'Unknown existing DEV destination'};
 if(!id.startsWith('incoming:'))return {kind:'DENIED',reason:'Unknown destination'};
 const nativeId=id.slice(9);if(!incoming.includes(nativeId))return {kind:'DENIED',reason:'From SIM · not integrated'};
 if(!qualified(runtime))return {kind:'DENIED',reason:'DEV phase 1 from SIM · integration unavailable'};
 if(!can(permission[nativeId]))return {kind:'DENIED',reason:'Not assigned'};
 return {kind:'INCOMING_PHASE1',nativeId,label:'DEV phase 1 from SIM'};
}
// Explicit examples awaiting HOST contract review. Unknown route/method fails closed.
export const routes=Object.freeze([
 ['GET','/api/quoting/v1/intakes','rfq.intake.create'],
 ['POST','/api/quoting/v1/intakes','rfq.intake.create'],
 ['GET','/api/quoting/v1/technical-reviews','technical_review.view'],
 ['GET','/api/quoting/v1/library','assembly_library.view'],
 ['GET','/api/quoting/v1/rfqs','rfq.view']
]);
export function apiDecision(method,path,runtime,can,{authenticated=false,csrfValid=false}={}){
 const lower=path.toLowerCase();if(lower==='/api/sim'||lower.startsWith('/api/sim/'))return {status:404,code:'SIM_ROUTE_NOT_EXPOSED'};
 if(lower!=='/api/quoting/v1'&&!lower.startsWith('/api/quoting/v1/'))return {status:0,code:'DEFER_EXISTING_CONTRACT'};
 if(!qualified(runtime))return {status:503,code:'QUOTING_INTEGRATION_UNAVAILABLE'};
 if(!authenticated)return {status:401,code:'AUTHENTICATION_REQUIRED'};
 const route=routes.find(r=>r[0]===method&&r[1]===path);if(!route)return {status:404,code:'QUOTING_ROUTE_NOT_MAPPED'};
 if(!can(route[2]))return {status:403,code:'QUOTING_PERMISSION_DENIED'};
 if(!['GET','HEAD'].includes(method)&&!csrfValid)return {status:403,code:'ANTIFORGERY_REQUIRED'};
 return {status:200,code:'CANDIDATE_CONTRACT_ONLY',permission:route[2]};
}
export function incomingUrl(path,origin){if(!path.startsWith('/api/quoting/v1/')||path.includes('://')||/[\r\n\\]/.test(path))throw Error('Unapproved incoming API URL');const u=new URL(path,origin);if(u.origin!==origin||!u.pathname.startsWith('/api/quoting/v1/'))throw Error('Same-origin quoting API required');return u.href;}
