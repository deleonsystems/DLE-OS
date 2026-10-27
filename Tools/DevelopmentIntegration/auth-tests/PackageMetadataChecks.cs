using System.Text.Json;

internal static class PackageMetadataChecks {
 internal static void Run(Action<bool,string> check){
  if(!PackagedFrontend.Enabled)return;
  var frontend=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"..","frontend"));
  var path=Path.Combine(frontend,"runtime-build-info.json");
  var data=JsonSerializer.Deserialize<DevRuntimeBuildInfo>(File.ReadAllText(path),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})!;
  void Reject(Action action,string label){bool rejected=false;try{action();}catch(InvalidOperationException){rejected=true;}check(rejected,label);}
  if(data.SourceDirty)Reject(()=>DevRuntimeBuildInfo.Load(path),"dirty package cannot pass existing runtime activation guard");
  else check(DevRuntimeBuildInfo.Load(path).GitHead==data.GitHead,"verified clean package metadata passes actual loader");
  // This clean record is an in-memory validator fixture, never a deployed file.
  var fixture=data with{SourceDirty=false};
  var root=Path.Combine(TestPaths.Root,"disposable","metadata-"+Guid.NewGuid().ToString("N"));
  Directory.CreateDirectory(Path.Combine(root,"frontend"));
  try{
   foreach(var f in Directory.GetFiles(Path.Combine(frontend,"frontend"),"*",SearchOption.AllDirectories)){
    var target=Path.Combine(root,"frontend",Path.GetRelativePath(Path.Combine(frontend,"frontend"),f));Directory.CreateDirectory(Path.GetDirectoryName(target)!);File.Copy(f,target);
   }
   var manifest=Path.Combine(root,"frontend-manifest.json");File.Copy(Path.Combine(frontend,"frontend-manifest.json"),manifest);
   check(FrontendReleaseManifestValidator.Validate(Path.Combine(root,"frontend"),manifest,fixture).FileCount==fixture.FrontendFileCount,"generated manifest passes actual frontend integrity validator");
   Reject(()=>FrontendReleaseManifestValidator.Validate(Path.Combine(root,"frontend"),manifest,fixture with{GitHead=new string('0',40)}),"frontend manifest rejects mismatched commit");
   Reject(()=>DevRuntimeBuildInfo.Load(Path.Combine(root,"missing.json")),"missing runtime metadata rejected");
   var file=Directory.GetFiles(Path.Combine(root,"frontend"),"*",SearchOption.AllDirectories)[0];var original=File.ReadAllBytes(file);File.AppendAllText(file,"altered");
   Reject(()=>FrontendReleaseManifestValidator.Validate(Path.Combine(root,"frontend"),manifest,fixture),"altered frontend file rejected");File.WriteAllBytes(file,original);
   File.AppendAllText(manifest," ");Reject(()=>FrontendReleaseManifestValidator.Validate(Path.Combine(root,"frontend"),manifest,fixture),"altered frontend manifest rejected");
   check(!Directory.GetFiles(AppContext.BaseDirectory,"*results.json",SearchOption.TopDirectoryOnly).Any(),"distributable qualification payload excludes stale result receipts");
  }finally{Directory.Delete(root,true);}
 }
}
