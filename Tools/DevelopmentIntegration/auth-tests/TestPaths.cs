internal static class TestPaths {
 internal static readonly string Root=Initialize();
 static string Initialize(){
  var args=Environment.GetCommandLineArgs();var at=Array.IndexOf(args,"--fixture-root");
  var root=at>=0&&at+1<args.Length?Path.GetFullPath(args[at+1]):Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../../../"));
  if(!File.Exists(Path.Combine(root,"connected/fixtures/drawing.pdf")))throw new InvalidOperationException("Synthetic fixture root required");
  Directory.CreateDirectory(Path.Combine(root,"auth-tests"));return root;
 }
}
