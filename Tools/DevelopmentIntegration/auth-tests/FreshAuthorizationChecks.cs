using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using System.Text.Json;
using DleOs.Quoting.Identity;
using DleOs.Security;
using DleOs.TrustedIdentity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

internal static class FreshAuthorizationChecks {
 internal static async Task Run(Action<bool,string> check){
  async Task Denied(Func<Task> action,string name){try{await action();throw new Exception("Not denied: "+name);}catch(IdentityDenied){check(true,name);}}
  var role=CandidateRoles.ForFixture("ray")!;var id=Guid.NewGuid();var reviewer=Guid.NewGuid();
  var ray=new ResolvedSecurityUser(id,"ray","Synthetic Ray","ACTIVE",[new(Guid.NewGuid(),role.Code,false)],role.Permissions.ToHashSet());
  var admin=new ResolvedSecurityUser(reviewer,"reviewer","Synthetic Reviewer","ACTIVE",[new(Guid.NewGuid(),"SUPER_ADMIN",true)],new HashSet<string>());
  var directory=new Directory();directory.Rows[id]=ray;directory.Rows[reviewer]=admin;
  var clock=new Clock();var pending=new PendingQuotingAuthorizations(clock);
  using var key=ECDsa.Create(ECCurve.NamedCurves.nistP256);using var publicKey=ECDsa.Create();publicKey.ImportSubjectPublicKeyInfo(key.ExportSubjectPublicKeyInfo(),out _);
  using var issuer=new Es256IdentityAssertionIssuer(key);using var validator=new Es256IdentityAssertionValidator(publicKey);
  var authority=new FrontendAuthorizationAuthority(pending,directory,issuer,clock,[reviewer]);
  using var handler=new Handler(authority);using var http=new HttpClient(handler);
  var access=new HttpContextAccessor();const string caller=@"DLE-OS-HOST\DLE-OS-DEV-FRONTEND";
  DefaultHttpContext Context(){var c=new DefaultHttpContext();c.Request.Method="POST";c.Request.Path="/api/quoting/v1/rfq-intakes";c.Request.ContentType="application/json";c.Request.Body=new MemoryStream("{}"u8.ToArray());c.User=new(new ClaimsIdentity([new Claim(ClaimTypes.Name,caller)],"synthetic-transport"));var correlation=Guid.NewGuid().ToString();c.Request.Headers["X-DLE-OS-Correlation-ID"]=correlation;c.Request.Headers[TrustedIdentityContract.HeaderName]=issuer.Issue(new(id,ray.UserName,ray.DisplayName,ray.Roles.Select(r=>r.RoleCode).ToArray(),false,QuotingPolicy.Audience,"DEVELOPMENT",correlation),clock.GetUtcNow());return c;}
  FrontendAuthorizationClient Client(HttpContext c){access.HttpContext=c;return new(http,new Uri("http://127.0.0.1:55111"+FreshAuthorization.Path),validator,access,clock,[reviewer]);}
  async Task<IDisposable> Lease(HttpContext c,Func<CancellationToken,Task>? session=null)=>pending.Add(c.Request.Headers[TrustedIdentityContract.HeaderName]!,QuotingPolicy.Project(ray),await FreshAuthorization.RequestHash(c),c.RequestAborted,session??(_=>Task.CompletedTask));
  async Task RunGood(){var c=Context();using var lease=await Lease(c);var client=Client(c);var backend=new BackendQuotingIdentity(validator,client,new(),clock,caller);var p=await backend.Resolve(c);check(p.UserId==id,"fresh callback preserves immutable user and managed rights");var r=await client.ResolveByUserIdAsync(reviewer);check(r?.IsSuperAdmin==true,"approved current reviewer resolved from same verified request snapshot");check(await client.ResolveByUserIdAsync(Guid.NewGuid())==null,"arbitrary user lookup unavailable");check(handler.Calls==1,"per-request snapshot prevents duplicate callback during reviewer lookup");}
  await RunGood();handler.Calls=0;
  foreach(var kind in new[]{"disabled","removed-role","missing-permission","role-change","missing","unavailable"}){
   var c=Context();using var lease=await Lease(c);
   directory.Rows[id]=kind switch{"disabled"=>ray with{AccountStatus="DISABLED"},"removed-role"=>ray with{Roles=[]},"missing-permission"=>ray with{ExplicitPermissions=new HashSet<string>()},"role-change"=>ray with{Roles=[..ray.Roles,new(Guid.NewGuid(),"EXTRA",false)]},_=>ray};
   if(kind=="missing")directory.Rows.Remove(id);directory.Fail=kind=="unavailable";
   await Denied(()=>Client(c).ResolveByUserIdAsync(id),"fresh authority rejects "+kind);directory.Fail=false;directory.Rows[id]=ray;
  }
  foreach(var change in new[]{"path","method","query","body","type"}){
   var c=Context();using var lease=await Lease(c);switch(change){case "path":c.Request.Path="/api/quoting/v1/other";break;case "method":c.Request.Method="DELETE";break;case "query":c.Request.QueryString=new("?other=true");break;case "body":c.Request.Body=new MemoryStream("{\"forged\":true}"u8.ToArray());break;case "type":c.Request.ContentType="text/plain";break;}
   await Denied(()=>Client(c).ResolveByUserIdAsync(id),"request binding rejects changed "+change);
  }
  foreach(var mode in new[]{"challenge","subject","request","assertion","expired","future","long-lived","reviewer-list","reviewer-ineligible","reviewer-duplicate","permissions","proof","audience","unsigned-payload"}){
   var c=Context();using var lease=await Lease(c);
   handler.Change=result=>{
    var d=JsonSerializer.Deserialize<AuthorizationSnapshot>(result.Payload)!;
    d=mode switch{
     "challenge"=>d with{Challenge=Guid.NewGuid()},"subject"=>d with{User=d.User with{UserId=Guid.NewGuid()}},"request"=>d with{RequestHash=new string('A',64)},"assertion"=>d with{AssertionHash=new string('B',64)},
     "expired"=>d with{IssuedAt=clock.GetUtcNow().AddSeconds(-20),ExpiresAt=clock.GetUtcNow().AddSeconds(-10)},"future"=>d with{IssuedAt=clock.GetUtcNow().AddMinutes(1),ExpiresAt=clock.GetUtcNow().AddMinutes(1).AddSeconds(5)},"long-lived"=>d with{ExpiresAt=clock.GetUtcNow().AddMinutes(1)},
     "reviewer-list"=>d with{ApprovedReviewers=[Guid.NewGuid()]},"reviewer-ineligible"=>d with{Reviewers=[AuthorizationUser.From(ray with{UserId=reviewer})]},"reviewer-duplicate"=>d with{Reviewers=[..d.Reviewers,..d.Reviewers]},"permissions"=>d with{User=d.User with{Permissions=[]}},_=>d};
    var payload=JsonSerializer.Serialize(d);var token=issuer.Issue(new(id,ray.UserName,ray.DisplayName,ray.Roles.Select(r=>r.RoleCode).ToArray(),false,mode=="audience"?QuotingPolicy.Audience:FreshAuthorization.Audience,"DEVELOPMENT",FreshAuthorization.Commitment(payload)),clock.GetUtcNow());
    if(mode=="proof")token="invalid";if(mode=="unsigned-payload")payload+=" ";return new(payload,token);
   };
   await Denied(()=>Client(c).ResolveByUserIdAsync(id),"response rejects "+mode);handler.Change=null;
  }
  {var c=Context();using var lease=await Lease(c);await Client(c).ResolveByUserIdAsync(id);var prior=handler.Last!;handler.Change=_=>prior;var other=Context();using var lease2=await Lease(other);await Denied(()=>Client(other).ResolveByUserIdAsync(id),"captured signed response cannot authorize another request");handler.Change=null;}
  {var c=Context();using var lease=await Lease(c);await Client(c).ResolveByUserIdAsync(id);await Denied(()=>Client(c).ResolveByUserIdAsync(id),"second callback for same assertion is denied");}
  {var c=Context();using var lease=await Lease(c,_=>throw new IdentityDenied(401,"SESSION_REVOKED"));await Denied(()=>Client(c).ResolveByUserIdAsync(id),"session revocation between admission and callback is denied");}
  {var c=Context();using var lease=await Lease(c);clock.Offset=TimeSpan.FromSeconds(11);await Denied(()=>Client(c).ResolveByUserIdAsync(id),"expired pending request is denied");clock.Offset=TimeSpan.Zero;}
  {var c=Context();using(var lease=await Lease(c)){}await Denied(()=>Client(c).ResolveByUserIdAsync(id),"completed BFF request cannot be authorized later");}
  {var c=Context();using var cancel=new CancellationTokenSource();c.RequestAborted=cancel.Token;using var lease=await Lease(c);cancel.Cancel();try{await Client(c).ResolveByUserIdAsync(id);throw new Exception("Canceled accepted");}catch(OperationCanceledException){check(true,"navigation cancellation stops authorization");}}
  foreach(var kind in new[]{"disabled","removed","ineligible"}){var c=Context();using var lease=await Lease(c);directory.Rows[reviewer]=kind=="disabled"?admin with{AccountStatus="DISABLED"}:ray with{UserId=reviewer};if(kind=="removed")directory.Rows.Remove(reviewer);var client=Client(c);await client.ResolveByUserIdAsync(id);check(await client.ResolveByUserIdAsync(reviewer)==null,"reviewer no longer offered when "+kind);directory.Rows[reviewer]=admin;}
  {var c=Context();using var lease=await Lease(c);var query=new AuthorizationQuery(c.Request.Headers[TrustedIdentityContract.HeaderName]!,await FreshAuthorization.RequestHash(c),Guid.NewGuid());var results=await Task.WhenAll(Enumerable.Range(0,8).Select(async _=>{try{await authority.Answer(query,default);return true;}catch(IdentityDenied){return false;}}));check(results.Count(x=>x)==1,"concurrent callbacks consume one pending authorization exactly once");}
  check(!typeof(FrontendAuthorizationClient).GetFields(System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).Any(f=>f.FieldType.Name.Contains("Sql")),"frontend resolver has no SQL dependency or fallback field");
  foreach(var target in new[]{"http://localhost:55111","http://[::1]:55111","http://example.invalid:55111","http://user@127.0.0.1:55111"}){
   try{FreshAuthorization.Endpoint(target+FreshAuthorization.Path);throw new Exception("Endpoint admitted");}catch(IdentityDenied){check(true,"authorization endpoint rejects unqualified target "+target);}
  }
  await EndpointChecks(authority,check);
 }
 static async Task EndpointChecks(FrontendAuthorizationAuthority authority,Action<bool,string> check){
  var b=WebApplication.CreateBuilder();b.Logging.ClearProviders();b.WebHost.UseUrls("http://127.0.0.1:0");b.Services.AddSingleton(authority);b.Services.AddAuthentication().AddScheme<AuthenticationSchemeOptions,FixtureServiceAuthentication>(Microsoft.AspNetCore.Server.HttpSys.HttpSysDefaults.AuthenticationScheme,_=>{});
  await using var app=b.Build();app.UseQuotingAuthorization();await app.StartAsync();var url=app.Urls.Single();var port=new Uri(url).Port;
  using var direct=FreshAuthorization.DirectTransport(); check(!direct.UseProxy&&direct.Proxy is null&&!direct.AllowAutoRedirect&&!direct.UseCookies&&direct.UseDefaultCredentials,"direct transport has pinned no-proxy credential policy");
  using var http=new HttpClient(direct){BaseAddress=new Uri(url)};
  var proxyKeys=new[]{"HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","NO_PROXY"};
  var oldEnvironment=proxyKeys.ToDictionary(k=>k,Environment.GetEnvironmentVariable);
  var oldProxy=HttpClient.DefaultProxy;var poisoned=new ForbiddenProxy();HttpClient.DefaultProxy=poisoned;
  foreach(var key in proxyKeys)Environment.SetEnvironmentVariable(key,key=="NO_PROXY"?"":"http://proxy.invalid:9");
  try{foreach(var caller in new[]{"anonymous","wrong","wrong-sid","missing-sid","duplicate-sid","machine","correct"}){using var request=new HttpRequestMessage(HttpMethod.Post,FreshAuthorization.Path);request.Headers.Add("X-Test-Caller",caller);request.Content=JsonContent.Create(new AuthorizationQuery("not-pending",new string('A',64),Guid.NewGuid()));using var response=await http.SendAsync(request);check((int)response.StatusCode==(caller=="correct"?409:403),"internal endpoint caller gate: "+caller);}using var get=await http.GetAsync(FreshAuthorization.Path);check((int)get.StatusCode==405,"internal authority exposes no browser GET lookup");}
  finally{HttpClient.DefaultProxy=oldProxy;foreach(var pair in oldEnvironment)Environment.SetEnvironmentVariable(pair.Key,pair.Value);check(poisoned.Calls==0,"environment and default proxy injection cannot redirect callback transport");await app.StopAsync();using var probe=new System.Net.Sockets.TcpClient();try{await probe.ConnectAsync("127.0.0.1",port);throw new Exception("Listener open");}catch(System.Net.Sockets.SocketException){check(true,"authority endpoint fixture listener closed");}}
 }
 sealed class ForbiddenProxy:IWebProxy{public int Calls;public ICredentials? Credentials{get;set;}public Uri GetProxy(Uri destination){Calls++;throw new Exception("Proxy must not be used");}public bool IsBypassed(Uri host){Calls++;throw new Exception("Proxy must not be consulted");}}
 sealed class Clock:TimeProvider{public TimeSpan Offset;public override DateTimeOffset GetUtcNow()=>DateTimeOffset.UtcNow+Offset;}
 sealed class Directory:IUserAuthorizationResolver{public Dictionary<Guid,ResolvedSecurityUser> Rows=[];public bool Fail;public Task<ResolvedSecurityUser?> ResolveByUserIdAsync(Guid id,CancellationToken t=default){t.ThrowIfCancellationRequested();if(Fail)throw new InvalidOperationException("Synthetic unavailable");return Task.FromResult(Rows.GetValueOrDefault(id));}}
 sealed class Handler(FrontendAuthorizationAuthority authority):HttpMessageHandler{public int Calls;public AuthorizationResponse? Last;public Func<AuthorizationResponse,AuthorizationResponse>? Change;protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r,CancellationToken t){Calls++;if(r.Headers.Contains("Cookie")||r.Headers.Contains("Authorization"))throw new Exception("Credentials forwarded");var q=await r.Content!.ReadFromJsonAsync<AuthorizationQuery>(cancellationToken:t);var a=await authority.Answer(q!,t);Last=a;return new(HttpStatusCode.OK){Content=JsonContent.Create(Change?.Invoke(a)??a)};}}
}

// Qualification executable only. Never compiled into frontend or runtime.
internal sealed class FixtureServiceAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> o,ILoggerFactory l,UrlEncoder e):AuthenticationHandler<AuthenticationSchemeOptions>(o,l,e){
 protected override Task<AuthenticateResult> HandleAuthenticateAsync(){var caller=Request.Headers["X-Test-Caller"].ToString();if(caller=="anonymous")return Task.FromResult(AuthenticateResult.NoResult());var identity=caller=="wrong"?"WRONG\\CALLER":caller=="machine"?@"DOMAIN\DLE-OS-HOST$":FreshAuthorization.Caller;var claims=new List<Claim>{new(ClaimTypes.Name,identity)};if(caller!="missing-sid")claims.Add(new(ClaimTypes.PrimarySid,caller=="wrong-sid"?"S-1-5-18":FreshAuthorization.CallerSid));if(caller=="duplicate-sid")claims.Add(new(ClaimTypes.PrimarySid,FreshAuthorization.CallerSid));return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims,Scheme.Name)),Scheme.Name)));}
}
