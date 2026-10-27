using System.Text;
using System.Text.Json;
internal sealed record LibraryFolderLink(string Id,string SourceKeyRaw,string AssemblyNumber,string DrawingRevision,string BomRevision,string RootId,string RelativePath,string FolderName,LibraryActor Actor);
internal sealed record LibraryFolderRecord(string SourceKeyRaw,int Revision,LibraryFolderLink? Current,LibraryFolderLink[] History);
internal sealed record LibraryFolderView(LibraryFolderRecord Record,string Token,object[] Roots,bool CanEdit,string DrawingRevision,string BomRevision,string? WindowsPath);
internal sealed record LibraryFolderCommand(string SourceKeyRaw,string ExpectedToken,string RootId,string RelativePath,string DrawingRevision,string BomRevision);
internal sealed record LibraryFolderSelection(string FolderToken,string RelativePath,string SourceToken);
internal sealed record LibraryFolderEvidence(LibraryFolderLink Association,string RelativePath,string Sha256,long Size,DateTimeOffset LastWriteUtc,DateTimeOffset CreatedUtc,LibraryActor SelectedBy);
internal sealed partial class SimLibraryBomStore
{
 internal Func<SimDrawingFolders>? BoundDrawingSources {get;set;}
 private SimDrawingFolders Sources(){
  if(BoundDrawingSources is not null)return BoundDrawingSources();
#if REHEARSAL
  return new(Environment.GetEnvironmentVariable("DLE_OS_SIM_DRAWING_ROOTS"));
#else
  throw SimRfqIntakeProblem.Conflict("LIBRARY_SOURCE_UNBOUND","Library source binding is required.");
#endif
 }
 // The address is a validated view of current configuration, never persisted into the association.
 private string? FolderWindowsPath(LibraryFolderLink? link){
  if(link is null)return null;
  try{return Sources().Resolve(link.RootId,link.RelativePath).Path;}
  catch(Exception e)when(e is SimRfqIntakeProblem or IOException or UnauthorizedAccessException){return null;}
 }
 private string FolderPath(string key)=>Path.Combine(root,"folders",Hash(Encoding.UTF8.GetBytes(key))+".json");
 private async Task<LibraryFolderRecord> ReadFolder(string key){var path=FolderPath(key);if(!File.Exists(path))return new(key,0,null,[]);var record=JsonSerializer.Deserialize<LibraryFolderRecord>(await File.ReadAllTextAsync(path),Json)!;Require(record.SourceKeyRaw==key,"Folder identity verification failed.");return record;}
 private static string FolderToken(LibraryFolderRecord r)=>Hash(JsonSerializer.SerializeToUtf8Bytes(r,Json));
 private async Task<(string Drawing,string Bom)> FolderContext(string key){var h=Header(key);var r=await Read(key);var d=r.Draft??r.Reviews.LastOrDefault()?.Snapshot;return(d?.DrawingRevision??h.DrawingRevision.TrimEnd(),d?.BomRevision??h.BomRevision.TrimEnd());}
 internal async Task<LibraryFolderView> Folder(string key,SimPersona p){Permission(p);Header(key);await gate.WaitAsync();try{var r=await ReadFolder(key);var context=await FolderContext(key);return new(r,FolderToken(r),Sources().Choices(),p.Can("assembly_library.edit"),context.Drawing,context.Bom,FolderWindowsPath(r.Current));}finally{gate.Release();}}
 internal async Task<LibraryFolderView> LinkFolder(LibraryFolderCommand c,SimPersona p){Permission(p,write:true);var h=Header(c.SourceKeyRaw);await gate.WaitAsync();try{
  var r=await ReadFolder(c.SourceKeyRaw);Require(FolderToken(r)==c.ExpectedToken,"The folder link changed. Reopen the selector.");var context=await FolderContext(c.SourceKeyRaw);Require(c.DrawingRevision==context.Drawing&&c.BomRevision==context.Bom,"The assembly revision context changed. Reopen the selector.");
  var folder=Sources().Resolve(c.RootId,c.RelativePath);var link=new LibraryFolderLink(Guid.NewGuid().ToString(),c.SourceKeyRaw,h.BillNumber.TrimEnd(),context.Drawing,context.Bom,c.RootId,folder.Relative,folder.Relative.Length==0?folder.Root.Label:Path.GetFileName(folder.Path),Actor(p));
  r=r with{Revision=r.Revision+1,Current=link,History=[..r.History,link]};var path=FolderPath(c.SourceKeyRaw);Directory.CreateDirectory(Path.GetDirectoryName(path)!);var temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";
  try{await File.WriteAllTextAsync(temp,JsonSerializer.Serialize(r,Json));Require(FolderToken(JsonSerializer.Deserialize<LibraryFolderRecord>(await File.ReadAllTextAsync(temp),Json)!)==FolderToken(r),"Folder save verification failed.");File.Move(temp,path,true);}finally{if(File.Exists(temp))File.Delete(temp);}
  return new(r,FolderToken(r),Sources().Choices(),true,context.Drawing,context.Bom,folder.Path);
 }finally{gate.Release();}}
 internal async Task<SimDrawingFolderListing> BrowseFolder(string key,string rootId,string relative,SimPersona p){Permission(p);Header(key);await Task.CompletedTask;return Sources().Browse(rootId,relative);}
 private async Task<(SimLinkedFileRead Read,LibraryFolderEvidence Evidence)> LinkedTxt(string key,LibraryFolderSelection selection,SimPersona p,bool verify){
  var r=await ReadFolder(key);Require(r.Current is not null,"Link an Assembly Folder first.");Require(FolderToken(r)==selection.FolderToken,"The folder link changed. Select the TXT again.");var link=r.Current!;var context=await FolderContext(key);Require(link.DrawingRevision==context.Drawing&&link.BomRevision==context.Bom,"The linked folder belongs to a different revision context. Review and save the folder link again.");
  Require(selection.RelativePath.EndsWith(".txt",StringComparison.OrdinalIgnoreCase),"Choose a VPRO5 TXT export.");
  // Adapter to the existing bounded, read-only file verifier. No RFQ association is read or written.
  var read=await Sources().ReadFile(new(link.Id,0,link.RootId,link.RelativePath,link.FolderName,"",link.AssemblyNumber,link.BomRevision,link.Actor.Name,link.Actor.AtUtc),selection.RelativePath,"BOM_REFERENCE");
  Require(read.Bytes.Length<=1048576,"Choose a TXT export up to 1 MB.");if(verify)Require(read.Source.SourceToken==selection.SourceToken,"The source file changed. Select it again; no import was saved.");
  return(read,new(link,selection.RelativePath,read.Source.Sha256,read.Source.Size,read.Source.LastWriteUtc,read.Source.CreatedUtc,Actor(p)));
 }
 internal async Task<object> DescribeFolderTxt(string key,LibraryFolderSelection selection,SimPersona p){Permission(p);Header(key);await gate.WaitAsync();try{var result=await LinkedTxt(key,selection,p,false);return new{result.Read.Name,result.Read.Source.SourceToken,result.Read.Source.Sha256,result.Read.Source.Size,header=SimVproParser.Describe(result.Read.Bytes).Drawing};}finally{gate.Release();}}
}
