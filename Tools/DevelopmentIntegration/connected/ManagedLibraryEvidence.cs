using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// Application-owned evidence, NOT the existing external/server-folder copy feature.
// This candidate deliberately accepts only a disposable workspace root.
internal sealed record ManagedEvidenceCommand(string PreparationId,string ExpectedPreparationToken,string DocumentId,string RequestId,string ExpectedFolderToken);
internal sealed record ManagedEvidenceReceipt(string RequestId,string ActorId,string PreparationId,string DocumentId,string LibraryKey,string DrawingRevision,string BomRevision,string Sha256,long Size,string RelativePath,string Status);
internal sealed class ManagedLibraryEvidence
{
 readonly string root,receipts;readonly string rootId="fixture";readonly SemaphoreSlim gate=new(1,1);
 // Explicit application-owned binding. Construction does not create directories.
 // The host must authorize/provision this root separately; no source folder writes.
 internal ManagedLibraryEvidence(string applicationRoot,string configuredRootId){
  if(string.IsNullOrWhiteSpace(configuredRootId)||configuredRootId=="fixture"||configuredRootId.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c!='-'))throw new ArgumentException("Explicit evidence root identity required");
  if(!Path.IsPathFullyQualified(applicationRoot))throw new ArgumentException("Absolute application-owned root required");
  var run=Path.GetFullPath(applicationRoot);CheckPath(run);
  root=Path.Combine(run,"source");receipts=Path.Combine(run,"managed-evidence-receipts");rootId=configuredRootId;
  CheckPath(root);CheckPath(receipts);
 }
 internal ManagedLibraryEvidence(string disposableRunRoot){
  var run=Path.GetFullPath(disposableRunRoot);var allowed=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"..","..","..","..","disposable"));
  // Resolve from this candidate's connected project, independent of Debug/Release.
  if(!run.StartsWith(allowed+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Evidence root must be a disposable candidate run.");
  root=Path.Combine(run,"source");receipts=Path.Combine(run,"managed-evidence-receipts");
  Directory.CreateDirectory(root);CheckPath(root);
 }
 static string Hash(string s)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));
 static void CheckPath(string path){
  for(var d=new DirectoryInfo(Path.GetDirectoryName(path)!);d is not null;d=d.Parent)if(d.Exists&&(d.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Linked storage ancestor rejected");
  if((File.Exists(path)||Directory.Exists(path))&&(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new IOException("Linked evidence rejected");
 }
 internal Task<object> Preview(SimLibraryPreparation prep,SimLibraryBomStore library,string id,string token,string documentId,SimPersona actor)=>prep.IncomingFolderCopy(id,token,documentId,actor,async(r,f,b)=>{
  var folder=await library.Folder(r.LibraryKey!,actor);
  return new{expectedFolderToken=folder.Token,libraryKey=r.LibraryKey,drawingRevision=r.DrawingRevision,bomRevision=r.BomRevision,name=f.Name,sha256=f.Sha256,size=f.Size,applicationOwned=true};
 });
 internal Task<object> Transfer(SimLibraryPreparation prep,SimLibraryBomStore library,ManagedEvidenceCommand command,SimPersona actor)=>prep.IncomingFolderCopy(command.PreparationId,command.ExpectedPreparationToken,command.DocumentId,actor,async(r,f,bytes)=>{
  if(!actor.Can("assembly_library.edit"))throw new LibraryBomPermissionException();
  if(!Guid.TryParseExact(command.RequestId,"D",out _))throw SimRfqIntakeProblem.BadRequest("EVIDENCE_REQUEST_ID","Use a request UUID.");
  if(f.Size<=0||f.Size>5*1024*1024||Path.GetFileName(f.Name)!=f.Name||f.Name.IndexOfAny(Path.GetInvalidFileNameChars())>=0)throw SimRfqIntakeProblem.BadRequest("EVIDENCE_FILE","Unsafe evidence name or size.");
  await gate.WaitAsync();try{
   CheckPath(root);var relative=Hash(r.LibraryKey+"\n"+r.DrawingRevision+"\n"+r.BomRevision);var directory=Path.Combine(root,relative);CheckPath(directory);
   var path=Path.Combine(directory,f.Name);CheckPath(path);Directory.CreateDirectory(receipts);CheckPath(receipts);
   var receiptPath=Path.Combine(receipts,command.RequestId+".json");CheckPath(receiptPath);
   var expected=new ManagedEvidenceReceipt(command.RequestId,actor.Id,r.Id,f.DocumentId,r.LibraryKey!,r.DrawingRevision,r.BomRevision,f.Sha256,f.Size,relative+"/"+f.Name,"PREPARING");
   ManagedEvidenceReceipt? receipt=null;
   if(File.Exists(receiptPath)){
    receipt=JsonSerializer.Deserialize<ManagedEvidenceReceipt>(await File.ReadAllTextAsync(receiptPath),SimLibraryBomStore.Json)!;
    if(receipt with{Status="PREPARING"}!=expected)throw SimRfqIntakeProblem.Conflict("EVIDENCE_RETRY_MISMATCH","This request belongs to other evidence, context or actor.");
   }
   var folder=await library.Folder(r.LibraryKey!,actor);
   if(folder.Record.Current is {} linked&&(linked.RootId!=rootId||linked.RelativePath!=relative||linked.DrawingRevision!=r.DrawingRevision||linked.BomRevision!=r.BomRevision))throw SimRfqIntakeProblem.Conflict("EVIDENCE_DESTINATION","Existing folder is outside this managed evidence context. Nothing was replaced.");
   if(receipt is null&&folder.Token!=command.ExpectedFolderToken)throw SimRfqIntakeProblem.Conflict("EVIDENCE_STALE","The Library folder changed. Preview again.");
   if(File.Exists(path)){
    if(receipt is null||new FileInfo(path).Length!=f.Size||Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path)))!=f.Sha256)throw SimRfqIntakeProblem.Conflict("EVIDENCE_CONFLICT","An existing file is not owned by this transfer. Nothing was overwritten.");
   }else{
    if(receipt?.Status=="VERIFIED")throw SimRfqIntakeProblem.Conflict("EVIDENCE_MISSING","Previously verified evidence is missing. Investigation is required.");
    Directory.CreateDirectory(directory);CheckPath(directory);await SaveReceipt(receiptPath,expected);
    var pending=path+"."+command.RequestId+".pending";CheckPath(pending);
    if(File.Exists(pending))throw SimRfqIntakeProblem.Conflict("EVIDENCE_UNCERTAIN","An interrupted transfer needs verification before retry.");
    try{await File.WriteAllBytesAsync(pending,bytes);if(Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(pending)))!=f.Sha256)throw new IOException("Evidence verification failed");File.Move(pending,path,false);}finally{if(File.Exists(pending))File.Delete(pending);}
   }
   if(folder.Record.Current is null)folder=await library.LinkFolder(new(r.LibraryKey!,folder.Token,rootId,relative,r.DrawingRevision,r.BomRevision),actor);
   var verified=expected with{Status="VERIFIED"};await SaveReceipt(receiptPath,verified);
   return new{receipt=verified,folderToken=folder.Token,applicationOwned=true};
  }finally{gate.Release();}
 });
 static async Task SaveReceipt(string path,ManagedEvidenceReceipt receipt){var pending=path+".pending";CheckPath(pending);try{await File.WriteAllTextAsync(pending,JsonSerializer.Serialize(receipt,SimLibraryBomStore.Json));if(JsonSerializer.Deserialize<ManagedEvidenceReceipt>(await File.ReadAllTextAsync(pending),SimLibraryBomStore.Json)!=receipt)throw new IOException("Receipt verification failed");File.Move(pending,path,true);}finally{if(File.Exists(pending))File.Delete(pending);}}
}
