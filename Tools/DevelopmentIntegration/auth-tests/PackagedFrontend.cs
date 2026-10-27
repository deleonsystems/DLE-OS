using System.Reflection;
using DleOs.Security;

// Reflection is confined to the qualification binary: the production frontend
// references these hooks directly. Tests can run against old or packaged assembly.
internal static class PackagedFrontend {
 internal static Guid[] ReviewerIds=[];
 internal static bool Enabled=>Environment.GetCommandLineArgs().Contains("--package");
 static Type Setup=>typeof(CurrentUserContext).Assembly.GetType("QuotingFrontendSetup",true)!;
 static object Settings(Uri backend){var t=Setup.Assembly.GetType("QuotingFrontendSettings",true)!;return Activator.CreateInstance(t,true,backend.ToString(),Path.Combine(TestPaths.Root,"connected/web"),ReviewerIds)!;}
 internal static void Register(IServiceCollection services,Uri backend)=>Setup.GetMethod("Register")!.Invoke(null,[services,Settings(backend)]);
 internal static void Authority(WebApplication app)=>Setup.GetMethod("Authority")!.Invoke(null,[app]);
 internal static void Map(WebApplication app,Uri backend)=>Setup.GetMethod("Map")!.Invoke(null,[app,Settings(backend)]);
 internal static string Inject(string html,ResolvedSecurityUser user)=>(string)Setup.GetMethod("Inject")!.Invoke(null,[html,"{}",user])!;
 internal static void Check(Action<bool,string> check){
  if(!Enabled)return;
  try{Setup.GetMethod("Read")!.Invoke(null,[Array.Empty<string>()]);throw new Exception("Unset frontend accepted");}
  catch(TargetInvocationException e)when(e.InnerException is InvalidOperationException){check(true,"packaged frontend refuses unset bindings");}
  check(Setup.Assembly.GetName().Name=="DleOs.DevelopmentFrontend","qualification loaded rebuilt frontend executable assembly");
  var legacy=new ResolvedSecurityUser(Guid.NewGuid(),"synthetic-existing","Synthetic existing user","ACTIVE",[new SecurityRole(Guid.NewGuid(),"KITTING_PILOT",false)],new HashSet<string>{"kitting.view"});
  var html="<html><head></head><body></body></html>";
  check(!Inject(html,legacy).Contains("full-mount.mjs"),"existing non-quoting user keeps baseline frontend injection");
  var remaining=(string[])Setup.GetMethod("RemainingArgs")!.Invoke(null,[new[]{"--dle-os-windows-service","--service-config","UNUSED-FIXTURE","--quoting-config","UNUSED-FIXTURE"}])!;
  check(remaining.SequenceEqual(new[]{"--dle-os-windows-service","--service-config","UNUSED-FIXTURE"}),"quoting config preserves established service bootstrap arguments");
 }
}
