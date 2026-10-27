using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Security.Claims;
using DleOs.Security;
using DleOs.TrustedIdentity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Server.HttpSys;
using Microsoft.Extensions.DependencyInjection;

namespace DleOs.Quoting.Identity;

// This contract reuses the established ES256 issuer: the signed correlation is
// a domain-separated SHA256 commitment to the complete authorization response.
// No new signing key, end-user credential or browser permission is introduced.
public static class FreshAuthorization {
 public const string Path="/internal/quoting/v1/authorization";
 public const string Audience="dle-os-development-quoting-authorization-v1";
 public const string Caller=@"NT SERVICE\DleOsDevelopmentQuoting";
 // Read-only `sc.exe showsid DleOsDevelopmentQuoting`; final SCM acceptance remains required.
 public const string CallerSid="S-1-5-80-2215837332-1385069786-3903630375-3118558622-574371864";
 public static bool IsCaller(ClaimsPrincipal? principal){
  var sids=principal?.FindAll(ClaimTypes.PrimarySid).Select(c=>c.Value).ToArray();
  return principal?.Identity?.IsAuthenticated==true&&string.Equals(principal.Identity.Name,Caller,StringComparison.OrdinalIgnoreCase)&&sids is {Length:1}&&sids[0]==CallerSid;
 }
 public static HttpClientHandler DirectTransport()=>new(){UseDefaultCredentials=true,UseCookies=false,AllowAutoRedirect=false,UseProxy=false,Proxy=null};
 public const int BodyLimit=6*1024*1024, ResponseLimit=128*1024;
 public static readonly TimeSpan Lifetime=TimeSpan.FromSeconds(10);
 public static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
 public static string Commitment(string payload)=>Hash("DLE-OS-QUOTING-AUTHORIZATION-V1\n"+payload);
 public static void Reviewers(Guid[] ids){if(ids.Length is 0 or >32||ids.Any(x=>x==Guid.Empty)||ids.Distinct().Count()!=ids.Length)throw new IdentityDenied(503,"REVIEWER_BINDING_INVALID");}
 public static async Task<string> RequestHash(HttpContext c){
  c.Request.EnableBuffering();var position=c.Request.Body.Position;
  try { using var bytes=new MemoryStream();var buffer=new byte[8192];int n;
   while((n=await c.Request.Body.ReadAsync(buffer,c.RequestAborted))>0){if(bytes.Length+n>BodyLimit)throw new IdentityDenied(413,"QUOTING_BODY_LIMIT");await bytes.WriteAsync(buffer.AsMemory(0,n),c.RequestAborted);}
   return Hash(JsonSerializer.Serialize(new[]{c.Request.Method,c.Request.Path.ToString(),c.Request.QueryString.ToString(),c.Request.ContentType??"",Convert.ToHexString(SHA256.HashData(bytes.ToArray()))}));
  }finally{c.Request.Body.Position=position;}
 }
 public static Uri Endpoint(string? value){
  if(!Uri.TryCreate(value,UriKind.Absolute,out var u)||u.Scheme!="http"||u.Host!="127.0.0.1"||u.Port is 0 or 5060||u.AbsolutePath!=Path||u.Query!=""||u.Fragment!=""||u.UserInfo!="")throw new IdentityDenied(503,"AUTHORIZATION_ENDPOINT_INVALID");
  return u;
 }
}
public sealed record AuthorizationQuery(string Assertion,string RequestHash,Guid Challenge);
public sealed record AuthorizationUser(Guid UserId,string UserName,string DisplayName,string AccountStatus,SecurityRole[] Roles,string[] Permissions){
 public static AuthorizationUser From(ResolvedSecurityUser u)=>new(u.UserId,u.UserName,u.DisplayName,u.AccountStatus,u.Roles.ToArray(),QuotingPolicy.Project(u).Permissions.Order(StringComparer.Ordinal).ToArray());
 public ResolvedSecurityUser ToUser()=>new(UserId,UserName,DisplayName,AccountStatus,Roles,Permissions.ToHashSet(StringComparer.Ordinal));
}
public sealed record AuthorizationSnapshot(Guid Challenge,string AssertionHash,string RequestHash,DateTimeOffset IssuedAt,DateTimeOffset ExpiresAt,AuthorizationUser User,Guid[] ApprovedReviewers,AuthorizationUser[] Reviewers);
public sealed record AuthorizationResponse(string Payload,string Proof);

// One entry per currently running BFF request; canceled/completed requests remove
// their entry. A callback consumes it atomically before touching security data.
public sealed class PendingQuotingAuthorizations(TimeProvider clock){
 public sealed record Entry(QuotingPrincipal User,string RequestHash,DateTimeOffset ExpiresAt,CancellationToken Aborted,Func<CancellationToken,Task> RecheckSession);
 readonly ConcurrentDictionary<string,Entry> entries=new();
 readonly object gate=new();
 public IDisposable Add(string assertion,QuotingPrincipal user,string hash,CancellationToken aborted,Func<CancellationToken,Task> recheckSession){
  lock(gate){
  foreach(var p in entries.Where(p=>p.Value.ExpiresAt<=clock.GetUtcNow()||p.Value.Aborted.IsCancellationRequested))entries.TryRemove(p.Key,out _);
  if(entries.Count>=256)throw new IdentityDenied(503,"AUTHORIZATION_CAPACITY");
  var key=FreshAuthorization.Hash(assertion);
  if(!entries.TryAdd(key,new(user,hash,clock.GetUtcNow()+FreshAuthorization.Lifetime,aborted,recheckSession)))throw new IdentityDenied(409,"AUTHORIZATION_DUPLICATE");
  return new Lease(()=>entries.TryRemove(key,out _));
  }
 }
 public Entry Take(AuthorizationQuery q){
  if(q.Challenge==Guid.Empty||q.Assertion.Length>16384||q.RequestHash.Length!=64)throw new IdentityDenied(400,"AUTHORIZATION_QUERY_INVALID");
  if(!entries.TryRemove(FreshAuthorization.Hash(q.Assertion),out var entry))throw new IdentityDenied(409,"AUTHORIZATION_NOT_PENDING");
  if(entry.ExpiresAt<=clock.GetUtcNow()||entry.Aborted.IsCancellationRequested||entry.RequestHash!=q.RequestHash)throw new IdentityDenied(403,"AUTHORIZATION_REQUEST_MISMATCH");
  return entry;
 }
 sealed class Lease(Action dispose):IDisposable{public void Dispose()=>dispose();}
}

public sealed class FrontendAuthorizationAuthority(PendingQuotingAuthorizations pending,IUserAuthorizationResolver users,IIdentityAssertionIssuer issuer,TimeProvider clock,Guid[] reviewers){
 public async Task<AuthorizationResponse> Answer(AuthorizationQuery query,CancellationToken cancellation){
  FreshAuthorization.Reviewers(reviewers);var request=pending.Take(query);
  using var linked=CancellationTokenSource.CreateLinkedTokenSource(cancellation,request.Aborted);
  linked.CancelAfter(FreshAuthorization.Lifetime);var token=linked.Token;
  try {
   await request.RecheckSession(token);
   // Deliberately bypasses ICurrentUserContext's per-request memoization; this
   // existing resolver performs a new authoritative lookup for every callback.
   var user=await users.ResolveByUserIdAsync(request.User.UserId,token);var principal=QuotingPolicy.Project(user);
   if(principal.UserId!=request.User.UserId||principal.IsSuperAdmin!=request.User.IsSuperAdmin||!principal.Roles.SequenceEqual(request.User.Roles)||!principal.Permissions.Order().SequenceEqual(request.User.Permissions.Order()))throw new IdentityDenied(403,"AUTHORIZATION_CHANGED");
   var eligible=new List<AuthorizationUser>();
   foreach(var id in reviewers){var candidate=await users.ResolveByUserIdAsync(id,token);if(candidate is null)continue;
    if(candidate.UserId!=id)throw new IdentityDenied(503,"REVIEWER_IDENTITY_MISMATCH");
    try{var p=QuotingPolicy.Project(candidate);if(p.IsSuperAdmin||p.Permissions.Contains("technical_review.disposition"))eligible.Add(AuthorizationUser.From(candidate));}catch(IdentityDenied){ }
   }
   token.ThrowIfCancellationRequested();var now=clock.GetUtcNow();if(now>=request.ExpiresAt)throw new IdentityDenied(403,"AUTHORIZATION_EXPIRED");
   var payload=JsonSerializer.Serialize(new AuthorizationSnapshot(query.Challenge,FreshAuthorization.Hash(query.Assertion),query.RequestHash,now,request.ExpiresAt,AuthorizationUser.From(user!),reviewers,eligible.ToArray()));
   if(Encoding.UTF8.GetByteCount(payload)>FreshAuthorization.ResponseLimit/2)throw new IdentityDenied(503,"AUTHORIZATION_RESPONSE_LIMIT");
   var proof=issuer.Issue(new(principal.UserId,principal.UserName,principal.DisplayName,principal.Roles,principal.IsSuperAdmin,FreshAuthorization.Audience,TrustedIdentityContract.DevelopmentEnvironment,FreshAuthorization.Commitment(payload)),now);
   return new(payload,proof);
  }catch(IdentityDenied){throw;}catch(OperationCanceledException){throw;}catch{throw new IdentityDenied(503,"AUTHORIZATION_SECURITY_UNAVAILABLE");}
 }
}

// Request scoped; only a validated response may satisfy the existing resolver
// interface. It cannot discover an arbitrary user or connect to SQL.
public sealed class FrontendAuthorizationClient(HttpClient http,Uri endpoint,IIdentityAssertionValidator validator,IHttpContextAccessor contexts,TimeProvider clock,Guid[] reviewers):IUserAuthorizationResolver {
 Task<AuthorizationSnapshot>? snapshot;
 readonly object gate=new();
 public async Task<ResolvedSecurityUser?> ResolveByUserIdAsync(Guid id,CancellationToken cancellation=default){
  var c=contexts.HttpContext??throw new IdentityDenied(503,"AUTHORIZATION_CONTEXT_REQUIRED");
  Task<AuthorizationSnapshot> read;lock(gate){read=snapshot??=Read(c);}var data=await read;cancellation.ThrowIfCancellationRequested();c.RequestAborted.ThrowIfCancellationRequested();
  if(clock.GetUtcNow()>=data.ExpiresAt)throw new IdentityDenied(403,"AUTHORIZATION_EXPIRED");
  return (data.User.UserId==id?data.User:data.Reviewers.SingleOrDefault(u=>u.UserId==id))?.ToUser();
 }
 async Task<AuthorizationSnapshot> Read(HttpContext c){
  FreshAuthorization.Endpoint(endpoint.ToString());FreshAuthorization.Reviewers(reviewers);
  var assertion=c.Request.Headers[TrustedIdentityContract.HeaderName].ToString();
  var original=validator.Validate(assertion,QuotingPolicy.Audience,TrustedIdentityContract.DevelopmentEnvironment,clock.GetUtcNow());
  if(!original.IsValid||original.User is null)throw new IdentityDenied(403,"AUTHORIZATION_ASSERTION_INVALID");
  var hash=await FreshAuthorization.RequestHash(c);var challenge=Guid.NewGuid();
  using var timeout=CancellationTokenSource.CreateLinkedTokenSource(c.RequestAborted);timeout.CancelAfter(FreshAuthorization.Lifetime);
  try {
   using var request=new HttpRequestMessage(HttpMethod.Post,endpoint){Content=JsonContent.Create(new AuthorizationQuery(assertion,hash,challenge))};
   using var response=await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,timeout.Token);
   if(!response.IsSuccessStatusCode)throw new IdentityDenied(response.StatusCode==System.Net.HttpStatusCode.Forbidden?403:503,"AUTHORIZATION_UNAVAILABLE");
   using var stream=await response.Content.ReadAsStreamAsync(timeout.Token);using var bytes=new MemoryStream();var buffer=new byte[8192];int n;
   while((n=await stream.ReadAsync(buffer,timeout.Token))>0){if(bytes.Length+n>FreshAuthorization.ResponseLimit)throw new IdentityDenied(503,"AUTHORIZATION_RESPONSE_LIMIT");await bytes.WriteAsync(buffer.AsMemory(0,n),timeout.Token);}
   var envelope=JsonSerializer.Deserialize<AuthorizationResponse>(bytes.ToArray(),new JsonSerializerOptions(JsonSerializerDefaults.Web))??throw new IdentityDenied(503,"AUTHORIZATION_RESPONSE_INVALID");
   var proof=validator.Validate(envelope.Proof,FreshAuthorization.Audience,TrustedIdentityContract.DevelopmentEnvironment,clock.GetUtcNow());
   if(!proof.IsValid||proof.User is null||proof.User.UserId!=original.User.UserId||proof.User.CorrelationId!=FreshAuthorization.Commitment(envelope.Payload))throw new IdentityDenied(403,"AUTHORIZATION_PROOF_INVALID");
   var data=JsonSerializer.Deserialize<AuthorizationSnapshot>(envelope.Payload)??throw new IdentityDenied(403,"AUTHORIZATION_PAYLOAD_INVALID");var now=clock.GetUtcNow();
   if(data.Challenge!=challenge||data.AssertionHash!=FreshAuthorization.Hash(assertion)||data.RequestHash!=hash||data.User.UserId!=original.User.UserId||data.IssuedAt>now.AddSeconds(1)||data.ExpiresAt<=now||data.ExpiresAt-data.IssuedAt>FreshAuthorization.Lifetime||data.ExpiresAt<=data.IssuedAt)throw new IdentityDenied(403,"AUTHORIZATION_BINDING_INVALID");
   if(!data.ApprovedReviewers.Order().SequenceEqual(reviewers.Order())||data.Reviewers.Length>reviewers.Length||data.Reviewers.Select(u=>u.UserId).Distinct().Count()!=data.Reviewers.Length||data.Reviewers.Any(u=>!reviewers.Contains(u.UserId)))throw new IdentityDenied(403,"AUTHORIZATION_REVIEWERS_INVALID");
   var principal=QuotingPolicy.Project(data.User.ToUser());if(principal.IsSuperAdmin!=proof.User.IsSuperAdmin||!principal.Roles.SequenceEqual(proof.User.Roles.Order()))throw new IdentityDenied(403,"AUTHORIZATION_ROLES_INVALID");
   foreach(var r in data.Reviewers){var p=QuotingPolicy.Project(r.ToUser());if(!p.IsSuperAdmin&&!p.Permissions.Contains("technical_review.disposition"))throw new IdentityDenied(403,"AUTHORIZATION_REVIEWER_INELIGIBLE");}
   return data;
  }catch(IdentityDenied){throw;}catch(OperationCanceledException) when(!c.RequestAborted.IsCancellationRequested){throw new IdentityDenied(503,"AUTHORIZATION_TIMEOUT");}catch(OperationCanceledException){throw;}catch{throw new IdentityDenied(503,"AUTHORIZATION_UNAVAILABLE");}
 }
}

public static class FrontendAuthorizationEndpoint {
 // Middleware executes before cookie authorization/current-user middleware.
 // The endpoint explicitly authenticates HTTP.sys Windows transport, never cookies.
 public static IApplicationBuilder UseQuotingAuthorization(this IApplicationBuilder app)=>app.Use(async(c,next)=>{
  if(c.Request.Path!=FreshAuthorization.Path){await next();return;}
  c.Response.Headers.CacheControl="no-store";
  try{
   if(c.Connection.RemoteIpAddress is not {} remote||!System.Net.IPAddress.IsLoopback(remote))throw new IdentityDenied(403,"AUTHORIZATION_LOCAL_ONLY");
   if(c.Request.Method!="POST")throw new IdentityDenied(405,"AUTHORIZATION_METHOD");
   var transport=await c.AuthenticateAsync(HttpSysDefaults.AuthenticationScheme);
   // Principal and SID come only from the explicit HTTP.sys authentication scheme.
   // Never read caller authority from browser headers or the cookie principal.
   if(!transport.Succeeded||!FreshAuthorization.IsCaller(transport.Principal))throw new IdentityDenied(403,"AUTHORIZATION_CALLER_DENIED");
   if(c.Request.ContentLength is >24576)throw new IdentityDenied(413,"AUTHORIZATION_QUERY_LIMIT");
   using var body=new MemoryStream();var buffer=new byte[4096];int n;
   while((n=await c.Request.Body.ReadAsync(buffer,c.RequestAborted))>0){if(body.Length+n>24576)throw new IdentityDenied(413,"AUTHORIZATION_QUERY_LIMIT");await body.WriteAsync(buffer.AsMemory(0,n),c.RequestAborted);}
   var q=JsonSerializer.Deserialize<AuthorizationQuery>(body.ToArray(),new JsonSerializerOptions(JsonSerializerDefaults.Web))??throw new IdentityDenied(400,"AUTHORIZATION_QUERY_INVALID");
   var result=await c.RequestServices.GetRequiredService<FrontendAuthorizationAuthority>().Answer(q,c.RequestAborted);await c.Response.WriteAsJsonAsync(result,c.RequestAborted);
  }catch(IdentityDenied e){c.Response.StatusCode=e.Status;await c.Response.WriteAsJsonAsync(new{code=e.Code},c.RequestAborted);}catch(OperationCanceledException){c.Response.StatusCode=503;}catch{c.Response.StatusCode=503;}
 });
}
