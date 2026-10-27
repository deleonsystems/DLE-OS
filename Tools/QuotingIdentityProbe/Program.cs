using System.Net;
using System.Net.Http.Json;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.AspNetCore.Server.HttpSys;
using Microsoft.Extensions.Hosting.WindowsServices;

// Preparation only. No installation, URLACL, credential, policy or account code.
// Each operating mode requires a later separately approved operator invocation.
internal static class Probe {
 internal const string Name="DleOsQuotingIdentityProbe";
 internal const string Identity=@"NT SERVICE\DleOsQuotingIdentityProbe";
 internal const string Operator=@"DLE-OS-HOST\Miguel";
 internal const string Prefix="http://127.0.0.1:51328/quoting-identity-probe/";
 internal const string Root=@"C:\ProgramData\DLE-OS\QuotingIdentityProbe";
 internal static readonly JsonSerializerOptions Json=new(){WriteIndented=true};
 internal static string RunDirectory(Guid run)=>Path.Combine(Root,"runs",run.ToString("D"));
 internal static void Save(Guid run,string area,string file,object record){
  // Directories must be explicitly prepared with reviewed ACLs by the operator.
  // CreateNew preserves any existing receipt; no overwrites or automatic retries.
  using var stream=new FileStream(Path.Combine(RunDirectory(run),area,file),FileMode.CreateNew,FileAccess.Write,FileShare.Read);
  JsonSerializer.Serialize(stream,record,Json);
 }
 internal static async Task<object> Request(Guid run,string label,bool credentials,CancellationToken stop){
  using var handler=new HttpClientHandler{UseDefaultCredentials=credentials,UseCookies=false,AllowAutoRedirect=false,UseProxy=false};
  using var client=new HttpClient(handler){Timeout=TimeSpan.FromSeconds(10)};
  using var request=new HttpRequestMessage(HttpMethod.Post,Prefix+"observe");
  request.Headers.Add("X-Probe-Run",run.ToString("D"));request.Headers.Add("X-Probe-Case",label);
  request.Content=JsonContent.Create(new{fixture="transport-only",businessData=false});
  try{using var response=await client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,stop);
   // Only status is recorded: never authentication headers, tokens or cookies.
   return new{Case=label,Status=(int)response.StatusCode,Received=true,ProcessIdentity=WindowsIdentity.GetCurrent().Name};
  }catch(Exception e) when(e is HttpRequestException or OperationCanceledException){return new{Case=label,Received=false,ErrorType=e.GetType().Name,ProcessIdentity=WindowsIdentity.GetCurrent().Name};}
 }
 internal static async Task<int> Main(string[] args){
  try{
   if(args.Length!=2||!Guid.TryParseExact(args[1],"D",out var run)||run==Guid.Empty||args[0] is not ("--service" or "--observer" or "--negative"))throw new InvalidOperationException("Exact mode and nonempty run UUID required");
   var scm=WindowsServiceHelpers.IsWindowsService();var identity=WindowsIdentity.GetCurrent().Name;
   if(args[0]=="--service"){
    if(!scm||!identity.Equals(Identity,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Exact SCM/virtual identity required");
    var builder=Host.CreateDefaultBuilder(Array.Empty<string>()).UseContentRoot(AppContext.BaseDirectory).ConfigureAppConfiguration((_,c)=>c.Sources.Clear()).UseWindowsService(o=>o.ServiceName=Name);
    builder.ConfigureLogging(l=>{l.ClearProviders();l.AddSimpleConsole();});
    builder.ConfigureServices(s=>{s.Configure<HostOptions>(o=>o.ShutdownTimeout=TimeSpan.FromSeconds(5));s.AddSingleton(new Run(run));s.AddHostedService<Caller>();});
    await builder.Build().RunAsync();return 0;
   }
   if(scm||!identity.Equals(Operator,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Observer/negative control require Miguel interactive context");
   if(new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))throw new InvalidOperationException("Observer and controls require unelevated Miguel");
   if(args[0]=="--negative"){
    using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(25));
    Save(run,"observer","negative.json",new{Run=run,At=DateTimeOffset.UtcNow,Results=new[]{await Request(run,"unrelated-miguel",true,timeout.Token),await Request(run,"anonymous",false,timeout.Token)}});return 0;
   }
   var b=WebApplication.CreateBuilder(new WebApplicationOptions{Args=[],ContentRootPath=AppContext.BaseDirectory});
   b.Configuration.Sources.Clear();
   b.Logging.ClearProviders(); // Receipt files contain only explicitly bounded metadata.
   b.WebHost.UseHttpSys(o=>{o.UrlPrefixes.Add(Prefix);o.Authentication.Schemes=Microsoft.AspNetCore.Server.HttpSys.AuthenticationSchemes.Negotiate|Microsoft.AspNetCore.Server.HttpSys.AuthenticationSchemes.NTLM;o.Authentication.AllowAnonymous=false;});
   b.Services.Configure<HostOptions>(o=>o.ShutdownTimeout=TimeSpan.FromSeconds(5));
   await using var app=b.Build();int sequence=0;
   app.Run(async c=>{
    if(!IPAddress.IsLoopback(c.Connection.RemoteIpAddress??IPAddress.None)||c.Request.Method!="POST"||(c.Request.PathBase+c.Request.Path)!="/quoting-identity-probe/observe"||c.Request.Headers["X-Probe-Run"].ToString()!=run.ToString("D")){c.Response.StatusCode=404;return;}
    var label=c.Request.Headers["X-Probe-Case"].ToString();if(label is not ("virtual-service" or "unrelated-miguel" or "anonymous")){c.Response.StatusCode=400;return;}
    var count=Interlocked.Increment(ref sequence);if(count>6){c.Response.StatusCode=429;return;}
    var win=c.User.Identity as WindowsIdentity;var actual=c.User.Identity;
    var allow=actual?.IsAuthenticated==true&&string.Equals(actual.Name,Identity,StringComparison.OrdinalIgnoreCase);
    Save(run,"observer",$"request-{count}.json",new{Run=run,At=DateTimeOffset.UtcNow,Case=label,Authenticated=actual?.IsAuthenticated??false,ObservedName=actual?.Name,ObservedSid=win?.User?.Value,AuthenticationType=actual?.AuthenticationType,ImpersonationLevel=win?.ImpersonationLevel.ToString(),ExpectedName=Identity,Allowed=allow,Status=allow?200:403});
    c.Response.StatusCode=allow?200:403;await c.Response.WriteAsJsonAsync(new{transportAccepted=allow,businessAuthorization=false});
   });
   using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(90));
   await app.StartAsync(deadline.Token);
   Save(run,"observer","started.json",new{Run=run,At=DateTimeOffset.UtcNow,Pid=Environment.ProcessId,Identity=identity,Prefix,ExpiresAfterSeconds=90});
   try{await app.WaitForShutdownAsync(deadline.Token);}catch(OperationCanceledException){}
   finally{using var shutdown=new CancellationTokenSource(TimeSpan.FromSeconds(5));await app.StopAsync(shutdown.Token);Save(run,"observer","stopped.json",new{Run=run,At=DateTimeOffset.UtcNow,Requests=sequence});}
   return 0;
  }catch(Exception e){Console.Error.WriteLine("Probe failed: "+e.GetType().Name);return 2;}
 }
 internal sealed record Run(Guid Id);
 internal sealed class Caller(Run run,IHostApplicationLifetime lifetime):BackgroundService{
  protected override async Task ExecuteAsync(CancellationToken stop){
   await Task.Yield();
   try{Save(run.Id,"caller","result.json",new{Run=run.Id,At=DateTimeOffset.UtcNow,Pid=Environment.ProcessId,Scm=WindowsServiceHelpers.IsWindowsService(),Result=await Request(run.Id,"virtual-service",true,stop)});}
   finally{lifetime.StopApplication();}
  }
}
}
