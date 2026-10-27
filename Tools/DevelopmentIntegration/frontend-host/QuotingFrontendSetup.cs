using System.Text.Json;
using DleOs.Quoting.Identity;
using DleOs.Security;
using Microsoft.Extensions.FileProviders;

public sealed record QuotingFrontendSettings(bool ActivationApproved,string? BackendUrl,string? AssetsRoot,Guid[] ReviewerUserIds);
public static class QuotingFrontendSetup {
 public static QuotingFrontendSettings Read(string[] args){
  var indexes=args.Select((v,i)=>(v,i)).Where(x=>x.v=="--quoting-config").Select(x=>x.i).ToArray();
  if(indexes.Length!=1||indexes[0]+1>=args.Length)throw new InvalidOperationException();
  var s=JsonSerializer.Deserialize<QuotingFrontendSettings>(File.ReadAllText(args[indexes[0]+1]),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})??throw new InvalidOperationException();
  if(!s.ActivationApproved||!Uri.TryCreate(s.BackendUrl,UriKind.Absolute,out var u)||!u.IsLoopback||u.Scheme!="http"||u.Port==0||new[]{80,443,5041,5042,5043,5051,5052,5053,5054,5056,5057}.Contains(u.Port)||string.IsNullOrWhiteSpace(s.AssetsRoot)||!Path.IsPathFullyQualified(s.AssetsRoot)||!Directory.Exists(s.AssetsRoot))throw new InvalidOperationException();
  if(!Path.GetFullPath(s.AssetsRoot!).Equals(Path.Combine(AppContext.BaseDirectory,"quoting-assets"),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Assets must belong to the packaged release");
  FreshAuthorization.Reviewers(s.ReviewerUserIds);
  return s;
 }
 public static string[] RemainingArgs(string[] args){var at=Array.IndexOf(args,"--quoting-config");return args.Where((_,i)=>i!=at&&i!=at+1).ToArray();}
 public static void Register(IServiceCollection services,QuotingFrontendSettings settings){
  FreshAuthorization.Reviewers(settings.ReviewerUserIds);
  services.AddQuotingBffAdapters(new Uri(settings.BackendUrl!));
  services.AddScoped(sp=>new FrontendAuthorizationAuthority(sp.GetRequiredService<PendingQuotingAuthorizations>(),sp.GetRequiredService<IUserAuthorizationResolver>(),sp.GetRequiredService<DleOs.TrustedIdentity.IIdentityAssertionIssuer>(),TimeProvider.System,settings.ReviewerUserIds));
 }
 public static void Authority(WebApplication app)=>app.UseQuotingAuthorization();
 public static void Map(WebApplication app,QuotingFrontendSettings settings){
  app.UseStaticFiles(new StaticFileOptions{FileProvider=new PhysicalFileProvider(settings.AssetsRoot!)});
  app.MapMethods("/api/quoting/v1/{**path}",["GET","HEAD","POST","PUT","DELETE"],async(HttpContext c,QuotingBffProxy proxy)=>{
   try{await proxy.Forward(c);}catch(IdentityDenied e){c.Response.StatusCode=e.Status;await c.Response.WriteAsJsonAsync(new{code=e.Code});}
  }).RequireAuthorization();
 }
 public static string Inject(string html,string baselinePayload,ResolvedSecurityUser user){
  QuotingPrincipal principal;
  try{principal=QuotingPolicy.Project(user);}catch(IdentityDenied){return DevelopmentIdentityUi.Inject(html,baselinePayload);}
  html=CandidateIdentityUi.Inject(html,JsonSerializer.Serialize(QuotingPolicy.Session(principal),new JsonSerializerOptions(JsonSerializerDefaults.Web)));
  return html.Insert(html.LastIndexOf("</body>",StringComparison.OrdinalIgnoreCase),"<script type=\"module\" src=\"/full-mount.mjs\"></script>");
 }
}
