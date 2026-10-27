using System.Collections.Concurrent;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using DleOs.Quoting.Identity;
using DleOs.Security;
using DleOs.TrustedIdentity;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.FileProviders;

internal static class ComposedChecks
{
 internal static async Task Run(Action<bool,string> check){
  var directory=new DirectoryFixture();var tickets=new FileTickets();
  foreach(var role in CandidateRoles.All){var id=Guid.NewGuid();directory.Users[role.Persona]=new(id,role.Persona,"Synthetic "+role.Persona,"ACTIVE",[new(Guid.NewGuid(),role.Code,false)],role.Permissions.ToHashSet());}
  using var key=ECDsa.Create(ECCurve.NamedCurves.nistP256);using var pub=ECDsa.Create();pub.ImportSubjectPublicKeyInfo(key.ExportSubjectPublicKeyInfo(),out _);using var issuer=new Es256IdentityAssertionIssuer(key);using var validator=new Es256IdentityAssertionValidator(pub);
  var root=Path.GetFullPath(Path.Combine(TestPaths.Root,"disposable/composed-"+Guid.NewGuid().ToString("N")));Directory.CreateDirectory(root);
  var referencePath=Path.Combine(root,"library.json");var referenceBytes=JsonSerializer.SerializeToUtf8Bytes(new LibraryReference("2026-10-27T00:00:00Z","synthetic-composition",new string('A',64),[]));await File.WriteAllBytesAsync(referencePath,referenceBytes);var libraryReference=new VerifiedLibraryReference(referencePath,Convert.ToHexString(SHA256.HashData(referenceBytes)));
  var domain=BoundQuotingDomain.Create(root,"quoting-evidence",libraryReference);var store=domain.Intake;var prep=domain.Preparation;var library=domain.Library;var now=DateTimeOffset.UtcNow;var metadata=new SimStateMetadata("DEVELOPMENT","composed-synthetic",1,1,1,now,now,1,now,1,1,1);
  using var customerClient=new HttpClient(new ReferenceChecks.DirectoryHandler()){BaseAddress=new Uri("http://127.0.0.1:5052")};
  var b=WebApplication.CreateBuilder();b.Logging.ClearProviders();b.WebHost.UseUrls("http://127.0.0.1:0");b.Services.AddSingleton<IIdentityAssertionValidator>(validator);b.Services.AddSingleton<IUserAuthorizationResolver>(directory);await using var backend=RuntimeApplication.Compose(b,domain,libraryReference,new CanonicalQuotingCustomers(customerClient),"DLE-OS-HOST\\DLE-OS-DEV-FRONTEND",directory.Users.Values.Select(u=>u.UserId).ToArray(),metadata,app=>app.Use(async(c,next)=>{c.User=new(new ClaimsIdentity([new Claim(ClaimTypes.Name,"DLE-OS-HOST\\DLE-OS-DEV-FRONTEND")],"isolated-service-transport"));await next();}));
  // Test transport principal only. No Windows credentials or handshake are used.
  await backend.StartAsync();
  var bb=new Uri(backend.Urls.Single());
  var f=WebApplication.CreateBuilder();f.Logging.ClearProviders();f.WebHost.UseUrls("http://127.0.0.1:0");f.Services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());f.Services.AddHttpContextAccessor();f.Services.AddSingleton<IIdentityResolver>(directory);f.Services.AddScoped<ICurrentUserContext,CurrentUserContext>();f.Services.AddSingleton<IIdentityAssertionIssuer>(issuer);
  f.Services.AddAntiforgery(o=>{o.Cookie.Name="__Host-DLEOS-CSRF";o.Cookie.SecurePolicy=CookieSecurePolicy.Always;o.Cookie.HttpOnly=true;o.Cookie.SameSite=SameSiteMode.Lax;o.Cookie.Path="/";o.HeaderName="RequestVerificationToken";});
  f.Services.AddAuthentication(o=>{o.DefaultAuthenticateScheme=DleOsOidcSchemes.Cookie;o.DefaultSignInScheme=DleOsOidcSchemes.Cookie;}).AddCookie(DleOsOidcSchemes.Cookie,o=>{o.Cookie.Name="__Host-DLEOS-Session";o.Cookie.SecurePolicy=CookieSecurePolicy.Always;o.Cookie.HttpOnly=true;o.Cookie.SameSite=SameSiteMode.Lax;o.Cookie.Path="/";o.SessionStore=tickets;o.SlidingExpiration=false;o.ExpireTimeSpan=TimeSpan.FromMinutes(30);o.Events.OnRedirectToLogin=c=>{c.Response.StatusCode=401;return Task.CompletedTask;};});
  f.Services.AddQuotingBffAdapters(bb);f.Services.AddAuthorization();if(PackagedFrontend.Enabled)PackagedFrontend.Register(f.Services,bb);await using var frontend=f.Build();
  // Models the existing HTTPS termination, entirely on temporary loopback HTTP.
  // This test does not certify TLS or browser secure-cookie transport behavior.
  frontend.Use(async(c,next)=>{c.Request.Scheme="https";c.Response.Headers.CacheControl="no-store";try{await next();}catch(IdentityDenied e){c.Response.StatusCode=e.Status;await c.Response.WriteAsJsonAsync(new{code=e.Code});}});frontend.UseAuthentication();frontend.UseAuthorization();
  frontend.UseStaticFiles(new StaticFileOptions{FileProvider=new PhysicalFileProvider(Path.GetFullPath(Path.Combine(TestPaths.Root,"connected/web")))});
  frontend.UseStaticFiles(new StaticFileOptions{FileProvider=new PhysicalFileProvider(Path.GetFullPath(Path.Combine(TestPaths.Root,"baseline-frontend")))});
  if(PackagedFrontend.Enabled)PackagedFrontend.Map(frontend,bb);else frontend.MapMethods("/api/quoting/v1/{**path}",["GET","POST","PUT","DELETE"],(HttpContext c,QuotingBffProxy proxy)=>proxy.Forward(c));
  frontend.MapPost("/auth/logout",async(HttpContext c,IAntiforgery csrf)=>{try{await csrf.ValidateRequestAsync(c);}catch(AntiforgeryValidationException){return Results.StatusCode(403);}await c.SignOutAsync(DleOsOidcSchemes.Cookie);return Results.NoContent();});
  // These admission endpoints exist only in this test assembly, never QuotingRuntime.
  frontend.MapPost("/test-fixture/signin/{persona}",async(string persona,HttpContext c)=>{if(!directory.Users.ContainsKey(persona))return Results.NotFound();await c.SignInAsync(DleOsOidcSchemes.Cookie,new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub",persona),new Claim(ClaimTypes.NameIdentifier,persona)],DleOsOidcSchemes.Cookie)),new AuthenticationProperties{ExpiresUtc=DateTimeOffset.UtcNow.AddMinutes(5)});return Results.NoContent();});
  frontend.MapGet("/test-fixture/csrf",(HttpContext c,IAntiforgery csrf)=>Results.Json(new{token=csrf.GetAndStoreTokens(c).RequestToken}));
  frontend.MapGet("/",async(HttpContext c,BffQuotingIdentity identity,IAntiforgery csrf)=>{var principal=await identity.Resolve(c);var baseline=Path.GetFullPath(Path.Combine(TestPaths.Root,"baseline-frontend/DLE_Work_Center_v4.0.0.html"));var html=PackagedFrontend.Enabled?PackagedFrontend.Inject(await File.ReadAllTextAsync(baseline),directory.Users.Values.Single(u=>u.UserId==principal.UserId)):CandidateIdentityUi.Inject(await File.ReadAllTextAsync(baseline),JsonSerializer.Serialize(QuotingPolicy.Session(principal)));html=SharedDeviceSessionUi.Inject(html,csrf.GetAndStoreTokens(c).RequestToken!);if(!PackagedFrontend.Enabled)html=html.Insert(html.LastIndexOf("</body>",StringComparison.OrdinalIgnoreCase),"<script type='module' src='/full-mount.mjs'></script>");return Results.Content(html,"text/html");});
  await frontend.StartAsync();var fb=new Uri(frontend.Urls.Single());
  var ports=new[]{bb.Port,fb.Port};if(ports.Any(p=>new[]{5041,5042,5043,5051,5052,5053,5054,5056,5057}.Contains(p))){await frontend.StopAsync();await backend.StopAsync();throw new Exception("Protected port selected");}
  using var client=new HttpClient(new HttpClientHandler{UseCookies=false,AllowAutoRedirect=false}){BaseAddress=fb};
  string Cookie(HttpResponseMessage response,string name)=>response.Headers.GetValues("Set-Cookie").Select(v=>v.Split(';')[0]).Single(v=>v.StartsWith(name+"="));
  async Task<HttpResponseMessage> Request(string path,string? cookie=null,HttpMethod? method=null,string? token=null){var r=new HttpRequestMessage(method??HttpMethod.Get,path);if(cookie!=null)r.Headers.Add("Cookie",cookie);if(token!=null)r.Headers.Add("RequestVerificationToken",token);r.Headers.Add("X-Fixture-Session","junior");r.Headers.Add("X-DLE-OS-Identity-Assertion","forged");return await client.SendAsync(r);}
  try{
   using(var anonymous=await Request("/api/quoting/v1/session"))check((int)anonymous.StatusCode==401,"composed host denies anonymous/fixture-header admission");
   foreach(var asset in new[]{"/full-mount.mjs","/quoting-transport.mjs","/SRC/shell/workspace-registry.js","/incoming/SRC/workspaces/rfqs/rfqs-workspace.js"}){using var resource=await Request(asset);check(resource.IsSuccessStatusCode,"composed shell asset route: "+asset);}
   foreach(var persona in new[]{"ray","michelle","adan"}){
    using var login=await Request("/test-fixture/signin/"+persona,method:HttpMethod.Post);var cookie=Cookie(login,"__Host-DLEOS-Session");
    using(var session=await Request("/api/quoting/v1/session",cookie)){var body=JsonDocument.Parse(await session.Content.ReadAsStringAsync());check(session.IsSuccessStatusCode&&body.RootElement.GetProperty("user").GetProperty("id").GetString()==directory.Users[persona].UserId.ToString("D"),"real cookie -> BFF -> assertion -> runtime: "+persona);}
    using(var customerResponse=await Request("/api/quoting/v1/customers",cookie))check((int)customerResponse.StatusCode==(persona=="ray"?200:403),"bound canonical customer route enforces role: "+persona);
    using(var libraryResponse=await Request("/api/quoting/v1/assembly-library/preliminary",cookie)){var body=await libraryResponse.Content.ReadAsStringAsync();check(libraryResponse.IsSuccessStatusCode&&body.Contains("synthetic-composition"),"bound Library route retains package provenance: "+persona);}
    using(var home=await Request("/",cookie)){var html=await home.Content.ReadAsStringAsync();check(home.IsSuccessStatusCode&&html.Contains("dle-auth-signout-form")&&html.Contains("dle-authorization-bootstrap-script"),"preserved full shell with actual logout UI: "+persona);}
    using(var denied=await Request("/api/quoting/v1/technical-reviews",cookie))check((int)denied.StatusCode==403,"composed direct TR route denied: "+persona);
    using(var forbidden=await Request("/api/quoting/v1/rfq-intakes",cookie,HttpMethod.Post))check((int)forbidden.StatusCode==403,"composed POST without CSRF denied: "+persona);
    using var csrf=await Request("/test-fixture/csrf",cookie);var csrfCookie=Cookie(csrf,"__Host-DLEOS-CSRF");var token=JsonDocument.Parse(await csrf.Content.ReadAsStringAsync()).RootElement.GetProperty("token").GetString()!;
    using(var badLogout=await Request("/auth/logout",cookie,HttpMethod.Post))check((int)badLogout.StatusCode==403,"logout requires CSRF: "+persona);
    using(var logout=await Request("/auth/logout",cookie+"; "+csrfCookie,HttpMethod.Post,token))check(logout.StatusCode==HttpStatusCode.NoContent,"actual cookie signout succeeds: "+persona);
    using(var replayed=await Request("/api/quoting/v1/session",cookie))check((int)replayed.StatusCode==401,"logged-out cookie cannot be replayed: "+persona);
   }
   using var relogin=await Request("/test-fixture/signin/ray",method:HttpMethod.Post);var old=Cookie(relogin,"__Host-DLEOS-Session");
   var original=directory.Users["ray"];directory.Users["ray"]=original with{AccountStatus="DISABLED"};using(var disabled=await Request("/api/quoting/v1/session",old))check((int)disabled.StatusCode==403,"active cookie cannot bypass disabled account");directory.Users["ray"]=original;
   directory.Users["ray"]=original with{Roles=[]};using(var changed=await Request("/api/quoting/v1/session",old))check((int)changed.StatusCode==403,"role removal applies to existing cookie");directory.Users["ray"]=original;
   tickets.ExpireAll();using(var expired=await Request("/api/quoting/v1/session",old))check((int)expired.StatusCode==401,"expired server ticket rejects unchanged browser cookie");
   using var fresh=await Request("/test-fixture/signin/ray",method:HttpMethod.Post);var revoked=Cookie(fresh,"__Host-DLEOS-Session");tickets.Clear();using(var revokedResponse=await Request("/api/quoting/v1/session",revoked))check((int)revokedResponse.StatusCode==401,"server ticket revocation rejects unchanged cookie");
   check(typeof(CurrentUserContext).Assembly.GetName().Name=="DleOs.DevelopmentFrontend"&&typeof(ResolvedSecurityUser).Assembly.GetName().Name=="DleOs.Security"&&typeof(Es256IdentityAssertionValidator).Assembly.GetName().Name=="DleOs.TrustedIdentity","composed host executes actual deployed assembly types");
  }finally{await frontend.StopAsync();await backend.StopAsync();tickets.Clear();foreach(var port in ports){using var probe=new System.Net.Sockets.TcpClient();try{await probe.ConnectAsync("127.0.0.1",port);throw new Exception("Composed listener remains open");}catch(System.Net.Sockets.SocketException){check(true,"composed loopback listener closed: "+port);}}await File.WriteAllTextAsync(Path.Combine(root,"cleanup.json"),JsonSerializer.Serialize(new{Ports=ports,Closed=true,TicketsRemaining=tickets.Count}));}
 }
 sealed class DirectoryFixture:IIdentityResolver,IUserAuthorizationResolver{internal readonly Dictionary<string,ResolvedSecurityUser> Users=[];public Task<ResolvedSecurityUser?> ResolveAsync(string provider,string subject,CancellationToken t=default)=>Task.FromResult(Users.GetValueOrDefault(subject));public Task<ResolvedSecurityUser?> ResolveByUserIdAsync(Guid id,CancellationToken t=default)=>Task.FromResult(Users.Values.SingleOrDefault(u=>u.UserId==id));}
}
