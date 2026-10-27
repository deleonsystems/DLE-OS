using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using DleOs.Security;
using DleOs.TrustedIdentity;
using DleOs.Quoting.Identity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.DataProtection;

var checks=new List<string>();
void Check(bool value,string label){if(!value)throw new Exception(label);checks.Add(label);Console.WriteLine("PASS "+label);}
if(args.Contains("--composed-only")){await ComposedChecks.Run(Check);return;}
async Task Deny(Func<Task> action,int status,string label){try{await action();throw new Exception("Unexpected allow: "+label);}catch(IdentityDenied e){Check(e.Status==status,label+": "+e.Code);}}
ResolvedSecurityUser User(params string[] personas){var roles=CandidateRoles.All.Where(r=>personas.Contains(r.Persona)).ToArray();return new(Guid.NewGuid(),"synthetic","Synthetic fixture","ACTIVE",roles.Select(r=>new SecurityRole(Guid.NewGuid(),r.Code,false)).ToArray(),roles.SelectMany(r=>r.Permissions).ToHashSet());}
var user=User("ray");var users=new FakeUsers{User=user};
using var signerKey=ECDsa.Create(ECCurve.NamedCurves.nistP256);using var verifierKey=ECDsa.Create();verifierKey.ImportSubjectPublicKeyInfo(signerKey.ExportSubjectPublicKeyInfo(),out _);
using var signer=new Es256IdentityAssertionIssuer(signerKey);using var verifier=new Es256IdentityAssertionValidator(verifierKey);
const string service="DLE-OS-HOST\\DLE-OS-DEV-FRONTEND";
var replay=new QuotingReplayStore();var backend=new BackendQuotingIdentity(verifier,users,replay,TimeProvider.System,service);
string Token(ResolvedSecurityUser u,string audience=QuotingPolicy.Audience,DateTimeOffset? now=null)=>signer.Issue(new(u.UserId,u.UserName,u.DisplayName,u.Roles.Select(r=>r.RoleCode).ToArray(),u.IsSuperAdmin,audience,"DEVELOPMENT","test-correlation"),now);
DefaultHttpContext Context(string? token=null,string method="GET",string? caller=service){var c=new DefaultHttpContext();c.Request.Method=method;if(caller!=null)c.User=new(new ClaimsIdentity([new Claim(ClaimTypes.Name,caller)],"Negotiate"));if(token!=null)c.Request.Headers[TrustedIdentityContract.HeaderName]=token;c.Request.Headers["X-DLE-OS-Correlation-ID"]="test-correlation";return c;}
var good=Token(user);
Check((await backend.Resolve(Context(good))).UserId==user.UserId,"backend preserves immutable user ID");
await Deny(()=>backend.Resolve(Context(good,caller:null)),403,"unauthenticated service denied");
await Deny(()=>backend.Resolve(Context(good,caller:"attacker")),403,"wrong caller denied");
await Deny(()=>backend.Resolve(Context()),403,"missing assertion denied");
await Deny(()=>backend.Resolve(Context(Token(user,TrustedIdentityContract.OperationalAudience))),403,"operational audience cannot authorize quoting");
await Deny(()=>backend.Resolve(Context(Token(user,now:DateTimeOffset.UtcNow.AddMinutes(-6)))),401,"expired assertion denied");
using(var wrong=new Es256IdentityAssertionIssuer(ECDsa.Create(ECCurve.NamedCurves.nistP256))){var t=wrong.Issue(new(user.UserId,user.UserName,user.DisplayName,user.Roles.Select(r=>r.RoleCode).ToArray(),false,QuotingPolicy.Audience,"DEVELOPMENT","test-correlation"));await Deny(()=>backend.Resolve(Context(t)),403,"wrong signing trust denied");}
var badCorrelation=Context(good);badCorrelation.Request.Headers["X-DLE-OS-Correlation-ID"]="other";await Deny(()=>backend.Resolve(badCorrelation),403,"correlation mismatch denied");
await backend.Resolve(Context(good,"POST"));await Deny(()=>backend.Resolve(Context(good,"POST")),409,"write assertion replay denied");
users.User=user with{AccountStatus="DISABLED"};await Deny(()=>backend.Resolve(Context(good)),403,"disabled user denied after valid assertion");
users.User=null;await Deny(()=>backend.Resolve(Context(good)),403,"missing authoritative user denied");
users.User=user with{Roles=[]};await Deny(()=>backend.Resolve(Context(good)),403,"removed role denied immediately");
users.User=user with{ExplicitPermissions=new HashSet<string>()};await Deny(()=>backend.Resolve(Context(good)),403,"stale permission catalog denied");
users.User=User("ray","adan") with{UserId=user.UserId};await Deny(()=>backend.Resolve(Context(good)),403,"changed role combination requires fresh assertion");
var combination=await backend.Resolve(Context(Token(users.User)));Check(combination.Permissions.Contains("assembly_library.edit")&&!combination.Permissions.Contains("technical_review.disposition"),"combined roles union only scoped rights");
users.User=user with{ExplicitPermissions=user.ExplicitPermissions.Concat(new[]{"kitting.view","technical_review.disposition"}).ToHashSet()};var scoped=await backend.Resolve(Context(good));Check(!scoped.Permissions.Contains("kitting.view")&&!scoped.Permissions.Contains("technical_review.disposition"),"extra database permissions cannot broaden managed quoting role");users.User=user;
var administrator=user with{Roles=[new SecurityRole(Guid.NewGuid(),"SUPER_ADMIN",true)]};var adminProjection=QuotingPolicy.Project(administrator);Check(adminProjection.IsSuperAdmin&&adminProjection.Workspaces.Contains("technical-review"),"existing active SUPER_ADMIN retains incoming workspace authority");
var absent=new BackendQuotingIdentity(verifier,users,replay,TimeProvider.System,"");await Deny(()=>absent.Resolve(Context(good)),503,"missing trust binding closed");

// Real antiforgery service with in-memory data protection. Authentication result is
// an explicit test double for the pre-existing OIDC handler, not a new login mechanism.
var auth=new FakeAuthentication();var services=new ServiceCollection();services.AddLogging();FixtureDataProtection.Configure(services);services.AddAntiforgery(o=>o.HeaderName="RequestVerificationToken");services.AddSingleton<IAuthenticationService>(auth);using var sp=services.BuildServiceProvider();var csrf=sp.GetRequiredService<IAntiforgery>();
var endUser=new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub","synthetic-sub"),new Claim(ClaimTypes.NameIdentifier,"synthetic-sub")],"test-ticket"));
auth.Result=AuthenticateResult.Success(new AuthenticationTicket(endUser,new AuthenticationProperties{ExpiresUtc=DateTimeOffset.UtcNow.AddMinutes(5)},QuotingPolicy.CookieScheme));
DefaultHttpContext Browser(string method="GET"){var c=new DefaultHttpContext{RequestServices=sp,User=endUser};c.Request.Method=method;c.Request.Scheme="https";c.Request.Host=new("fixture.invalid");return c;}
var accessor=new HttpContextAccessor();var current=new CurrentUserContext(accessor,users);accessor.HttpContext=Browser();var bff=new BffQuotingIdentity(current,csrf,TimeProvider.System);
Check((await bff.Resolve(accessor.HttpContext)).UserId==user.UserId,"BFF uses established CurrentUserContext and immutable ID");
auth.Result=AuthenticateResult.Fail("expired");await Deny(()=>bff.Resolve(Browser()),401,"failed or logged-out session denied");
auth.Result=AuthenticateResult.Success(new AuthenticationTicket(endUser,new AuthenticationProperties{ExpiresUtc=DateTimeOffset.UtcNow.AddMinutes(-1)},QuotingPolicy.CookieScheme));await Deny(()=>bff.Resolve(Browser()),401,"expired ticket denied");
auth.Result=AuthenticateResult.Success(new AuthenticationTicket(endUser,new AuthenticationProperties{ExpiresUtc=DateTimeOffset.UtcNow.AddMinutes(5)},QuotingPolicy.CookieScheme));
await Deny(()=>bff.Resolve(Browser("POST")),403,"missing CSRF denied by actual antiforgery service");
var issue=Browser();var tokens=csrf.GetAndStoreTokens(issue);var post=Browser("POST");post.Request.Headers.Cookie=issue.Response.Headers.SetCookie.ToString().Split(';')[0];post.Request.Headers["RequestVerificationToken"]=tokens.RequestToken;Check((await bff.Resolve(post)).UserId==user.UserId,"actual antiforgery token validates");
var forgedPost=Browser("POST");forgedPost.Request.Headers.Cookie=post.Request.Headers.Cookie;forgedPost.Request.Headers["RequestVerificationToken"]="forged";await Deny(()=>bff.Resolve(forgedPost),403,"forged CSRF denied on fresh request");
var canceled=Browser();canceled.RequestAborted=new CancellationToken(true);try{await bff.Resolve(canceled);throw new Exception("Cancellation ignored");}catch(OperationCanceledException){Check(true,"canceled request stops before identity work");}
var capture=new CaptureHandler();using(var client=new HttpClient(capture)){
 var proxy=new QuotingBffProxy(bff,signer,client,new Uri("http://127.0.0.1:55000/"),new PendingQuotingAuthorizations(TimeProvider.System));
 var incoming=Browser();incoming.Request.Path="/api/quoting/v1/session";incoming.Request.Headers[TrustedIdentityContract.HeaderName]="forged";incoming.Request.Headers["X-Fixture-Session"]="junior";incoming.Request.Headers.Authorization="forged";
 await proxy.Forward(incoming);
 Check(capture.Fixture==null&&capture.Authorization==null,"BFF strips client fixture and authorization headers");
 var assertion=verifier.Validate(capture.Assertion,QuotingPolicy.Audience,"DEVELOPMENT");Check(assertion.IsValid&&assertion.User!.UserId==user.UserId,"BFF issues established signed assertion from current user");
 await Deny(()=>new QuotingBffProxy(bff,signer,client,new Uri("http://127.0.0.1:5056/"),new PendingQuotingAuthorizations(TimeProvider.System)).Forward(incoming),503,"BFF cannot target protected worker");
 await Deny(()=>new QuotingBffProxy(bff,signer,client,new Uri("https://other.invalid/"),new PendingQuotingAuthorizations(TimeProvider.System)).Forward(incoming),503,"BFF cannot target remote service");
}

// Actual non-rehearsal route assembly: no fixture persona selector is compiled.
Check(typeof(ConnectedActors).GetMethod("Persona",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)==null,"runtime assembly excludes fixture identity selector");
Check(typeof(ConnectedActors).Assembly.GetType("DleOs.Integration.RehearsalStore")==null,"runtime excludes retired rehearsal persistence implementation");
Check(SimPersonaCatalog.All.Count==0&&SimPersonaCatalog.Get("administrator")==null,"runtime has no synthetic persona catalog or default account");
var actorContract=JsonSerializer.SerializeToElement(new SimPersona(Guid.NewGuid().ToString(),"synthetic-test","Synthetic test","ACTIVE",[],[],false,"test").CurrentUserContract());
Check(actorContract.GetProperty("environment").GetString()=="DEVELOPMENT"&&!actorContract.GetProperty("synthetic").GetBoolean(),"runtime actor diagnostics cannot claim SIM or fixture identity");
try{new SimPersonaSessionStore().Resolve(new DefaultHttpContext());throw new Exception("Fixture enabled");}catch(InvalidOperationException){Check(true,"runtime legacy fixture session cannot activate");}
var root=Path.GetFullPath(Path.Combine(TestPaths.Root,"disposable/auth-"+Guid.NewGuid().ToString("N")));Directory.CreateDirectory(root);
var store=new SimRfqIntakeStore(Path.Combine(root,"state"),"ISOLATED_DEVELOPMENT_REHEARSAL");var prep=new SimLibraryPreparation(Path.Combine(root,"state"),()=>[],store.PreparationSource,store.OpenDocument);var library=new SimLibraryBomStore(Path.Combine(root,"state"),prep.Headers);var now=DateTimeOffset.UtcNow;var meta=new SimStateMetadata("ISOLATED_DEVELOPMENT_REHEARSAL","auth-fixture",1,1,1,now,now,1,now,1,1,1);
var builder=WebApplication.CreateBuilder();builder.Logging.ClearProviders();builder.WebHost.UseUrls("http://127.0.0.1:0");builder.Services.AddSingleton<IQuotingIdentity>(backend);await using var app=builder.Build();app.Use(async(c,next)=>{c.User=new(new ClaimsIdentity([new Claim(ClaimTypes.Name,service)],"test-service-transport"));await next();});app.MapConnected(store,prep,library,meta,new ManagedLibraryEvidence(root,"quoting-evidence"));await app.StartAsync();var port=new Uri(app.Urls.Single()).Port;
if(new[]{5041,5042,5043,5051,5052,5053,5054,5056,5057}.Contains(port)){await app.StopAsync();throw new Exception("Protected port selected");}
using var http=new HttpClient{BaseAddress=new Uri(app.Urls.Single())};try{
 async Task<int> Status(string path,string? token){using var req=new HttpRequestMessage(HttpMethod.Get,path);req.Headers.Add("X-Fixture-Session","junior");req.Headers.Add("X-Rehearsal-Intent","fixture-only");req.Headers.Add("X-DLE-OS-Correlation-ID","test-correlation");if(token!=null)req.Headers.Add(TrustedIdentityContract.HeaderName,token);using var response=await http.SendAsync(req);return(int)response.StatusCode;}
 Check(await Status("/api/quoting/v1/session",null)==403,"client fixture headers cannot authorize runtime route");
 foreach(var persona in new[]{"ray","michelle","adan"}){users.User=User(persona);var token=Token(users.User);Check(await Status("/api/quoting/v1/session",token)==200,persona+" authenticated session route");Check(await Status("/api/quoting/v1/technical-reviews",token)==403,persona+" direct technical route denied");Check(await Status("/api/quoting/v1/rfqs",token)==(persona=="adan"?403:200),persona+" direct RFQ route agrees with workspace");}
}finally{await app.StopAsync();using var probe=new System.Net.Sockets.TcpClient();try{await probe.ConnectAsync("127.0.0.1",port);throw new Exception("Listener open");}catch(System.Net.Sockets.SocketException){Check(true,"temporary identity test listener closed");}}
await FreshAuthorizationChecks.Run(Check);
await ReferenceChecks.Run(Check);
await FileTickets.Qualify(Check);
PackagedFrontend.Check(Check);
await PackagedAssets.Check(Check);
await ComposedChecks.Run(Check);
await File.WriteAllTextAsync(Path.GetFullPath(Path.Combine(TestPaths.Root,"auth-tests/identity-results.json")),JsonSerializer.Serialize(new{Passed=true,Count=checks.Count,Checks=checks,Port=port,Closed=true,ProductionSecretsUsed=false},new JsonSerializerOptions{WriteIndented=true}));

sealed class FakeUsers:IIdentityResolver,IUserAuthorizationResolver{public ResolvedSecurityUser? User;public Task<ResolvedSecurityUser?> ResolveAsync(string provider,string subject,CancellationToken token=default)=>Task.FromResult(subject=="synthetic-sub"?User:null);public Task<ResolvedSecurityUser?> ResolveByUserIdAsync(Guid id,CancellationToken token=default)=>Task.FromResult(User?.UserId==id?User:null);}
sealed class FakeAuthentication:IAuthenticationService{public AuthenticateResult Result=AuthenticateResult.NoResult();public Task<AuthenticateResult> AuthenticateAsync(HttpContext c,string? s)=>Task.FromResult(Result);public Task ChallengeAsync(HttpContext c,string? s,AuthenticationProperties? p)=>throw new NotSupportedException();public Task ForbidAsync(HttpContext c,string? s,AuthenticationProperties? p)=>throw new NotSupportedException();public Task SignInAsync(HttpContext c,string? s,ClaimsPrincipal p,AuthenticationProperties? a)=>throw new NotSupportedException();public Task SignOutAsync(HttpContext c,string? s,AuthenticationProperties? p)=>throw new NotSupportedException();}
sealed class CaptureHandler:HttpMessageHandler{public string? Fixture,Authorization,Assertion;protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r,CancellationToken t){Fixture=r.Headers.TryGetValues("X-Fixture-Session",out var f)?f.Single():null;Authorization=r.Headers.TryGetValues("Authorization",out var a)?a.Single():null;Assertion=r.Headers.GetValues(TrustedIdentityContract.HeaderName).Single();return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK){Content=new StringContent("{}")});}}
