internal static class CheckpointPaths {
 internal static string Repository {
  get {
   var configured=Environment.GetEnvironmentVariable("DLE_TEST_REPOSITORY");
   if(!string.IsNullOrEmpty(configured))return Path.GetFullPath(configured);
   for(var p=new DirectoryInfo(Directory.GetCurrentDirectory());p is not null;p=p.Parent)
    if(Directory.Exists(Path.Combine(p.FullName,"Tools","SimRuntime","DleOs.SimHost")))return p.FullName;
   throw new InvalidOperationException("Run from this repository or set DLE_TEST_REPOSITORY.");
  }
 }
 internal static string Results {
  get {var p=Environment.GetEnvironmentVariable("DLE_CHECKPOINT_RESULTS")??Path.Combine(AppContext.BaseDirectory,"results");Directory.CreateDirectory(p);return p;}
 }
}
