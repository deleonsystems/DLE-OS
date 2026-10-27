using System.Security.Cryptography;
using System.Text.Json;
using DleOs.Quoting.Identity;
using DleOs.Security;
using DleOs.TrustedIdentity;
using Microsoft.AspNetCore.Server.HttpSys;
using Microsoft.Data.SqlClient;

internal sealed record RuntimeSettings(bool ActivationApproved,string? ListenUrl,string? ApplicationRoot,
 string? LibraryPackage,string? LibrarySha256,string? TrustedCaller,string? PublicKeyPath,
 string? SecurityConnectionString,string? SecurityDatabase,Guid[]? ReviewerUserIds,string? PythonExecutable,string? PythonSha256);

internal static class RuntimeApplication {
 internal static RuntimeSettings Validate(string path){
  var s=JsonSerializer.Deserialize<RuntimeSettings>(File.ReadAllText(path),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})??throw new InvalidOperationException("Settings required");
  if(!s.ActivationApproved)throw new InvalidOperationException("Activation is not approved in this package");
  if(!Uri.TryCreate(s.ListenUrl,UriKind.Absolute,out var url)||url.Scheme!="http"||!url.IsLoopback||url.Port==0||new[]{80,443,5041,5042,5043,5051,5052,5053,5054,5056,5057}.Contains(url.Port))throw new InvalidOperationException("Dedicated loopback URL required");
  foreach(var p in new[]{s.ApplicationRoot,s.LibraryPackage,s.PublicKeyPath,s.PythonExecutable})if(string.IsNullOrWhiteSpace(p)||!Path.IsPathFullyQualified(p))throw new InvalidOperationException("Explicit absolute bindings required");
  if(!string.Equals(s.TrustedCaller,@"DLE-OS-HOST\DLE-OS-DEV-FRONTEND",StringComparison.OrdinalIgnoreCase)||s.LibrarySha256?.Length!=64||s.PythonSha256?.Length!=64||s.ReviewerUserIds is null||s.ReviewerUserIds.Length==0||s.ReviewerUserIds.Distinct().Count()!=s.ReviewerUserIds.Length||s.ReviewerUserIds.Any(x=>x==Guid.Empty))throw new InvalidOperationException("Trust/reference/reviewer bindings required");
  if(!string.Equals(Path.GetFullPath(s.ApplicationRoot!),@"C:\ProgramData\DLE-OS\DevelopmentQuoting",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Dedicated quoting storage required");
  var sql=new SqlConnectionStringBuilder(s.SecurityConnectionString??"");
  if(sql.TrustServerCertificate || sql.Encrypt.ToString().Equals("False",StringComparison.OrdinalIgnoreCase) || sql.Encrypt.ToString().Equals("Optional",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Validated SQL encryption required");
  if(!sql.IntegratedSecurity||!string.IsNullOrEmpty(sql.UserID)||!string.IsNullOrEmpty(sql.Password)||s.SecurityDatabase!="DLE_OS_SECURITY_DEV"||sql.InitialCatalog!=s.SecurityDatabase||sql.DataSource!=@"lpc:.\SQLEXPRESS")throw new InvalidOperationException("Explicit integrated-security non-LIVE security database required");
  return s;
 }
 // Shared by the production executable and synthetic executable qualification.
 // All identity implementations must be registered before this call.
 internal static WebApplication Compose(WebApplicationBuilder builder,BoundQuotingDomain domain,IQuotingLibraryReference reference,IQuotingCustomers customers,string caller,Guid[] reviewers,SimStateMetadata metadata,Action<WebApplication>? configureAuthentication=null){
  QuotingServiceLifecycle.Configure(builder);
  builder.Services.AddQuotingBackendAdapters(caller);
  builder.Services.AddSingleton(reference);builder.Services.AddSingleton(customers);
  builder.Services.AddSingleton(sp=>new QuotingReviewers(sp.GetRequiredService<IUserAuthorizationResolver>(),reviewers));
  var app=builder.Build();configureAuthentication?.Invoke(app);QuotingServiceLifecycle.Attach(app);app.MapGet("/health/configuration",()=>Results.Json(new{environment="DEVELOPMENT",configurationLoaded=true,externalDependenciesQualified=false}));
  app.MapConnected(domain.Intake,domain.Preparation,domain.Library,metadata,domain.Evidence);return app;
 }
 internal static async Task<int> Main(string[] args){
  try{
   var invocation=QuotingServiceLifecycle.Arguments(args);
   QuotingServiceLifecycle.CheckServiceContext(invocation.Service);
   var s=Validate(invocation.Config); // Before any directory, key, SQL or listener operation.
   if(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(s.PythonExecutable!)))!=s.PythonSha256)throw new InvalidOperationException("Qualified Python dependency mismatch");
   Environment.SetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON",s.PythonExecutable);
   var reference=new VerifiedLibraryReference(s.LibraryPackage!,s.LibrarySha256!);_ = reference.Read();
   using var validator=new Es256IdentityAssertionValidator(IdentityAssertionKeyLoader.LoadPublicKey(s.PublicKeyPath!));
   var domain=BoundQuotingDomain.Create(s.ApplicationRoot!,"quoting-evidence",reference);
   var b=WebApplication.CreateBuilder(new WebApplicationOptions { Args=Array.Empty<string>(), ContentRootPath=AppContext.BaseDirectory });
   b.WebHost.UseHttpSys(o=>{o.UrlPrefixes.Add(s.ListenUrl!.TrimEnd('/')+"/");o.Authentication.Schemes=AuthenticationSchemes.Negotiate|AuthenticationSchemes.NTLM;o.Authentication.AllowAnonymous=false;});
   b.Services.AddSingleton<IIdentityAssertionValidator>(validator);b.Services.AddSingleton<IUserAuthorizationResolver>(new SqlUserAuthorizationResolver(s.SecurityConnectionString!));
   using var customerClient=new HttpClient(new HttpClientHandler{UseDefaultCredentials=true,UseCookies=false,AllowAutoRedirect=false}){BaseAddress=new Uri("http://127.0.0.1:5052")};
   var now=DateTimeOffset.UtcNow;var metadata=new SimStateMetadata("DEVELOPMENT","quoting",1,1,1,now,now,1,now,1,1,1);
   await using var app=Compose(b,domain,reference,new CanonicalQuotingCustomers(customerClient),s.TrustedCaller!,s.ReviewerUserIds!,metadata);
   await app.RunAsync();return 0;
  }catch(Exception e){Console.Error.WriteLine("Quoting host did not start: "+e.GetType().Name);return 2;}
 }
}
