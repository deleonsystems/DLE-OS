using System.Text;
using System.Text.Json;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal sealed record LibraryFolderCopyCommand(string PreparationId,string ExpectedPreparationToken,string DocumentId,string PreviewToken,bool Confirmed);
internal sealed record LibraryFolderCopyAudit(string Id,string PreparationId,string? ProjectId,string IntakeId,string DocumentId,string OriginalName,string Sha256,long Size,string SourceFingerprint,LibraryFolderLink Folder,string RootPath,string RelativePath,string Status,LibraryActor RequestedBy,LibraryActor? VerifiedBy=null);
internal sealed record LibraryFolderCopyPreview(string Destination,string Name,string FolderToken,string PreviewToken,bool CanCopy,bool AlreadyCopied,string? Message);
// Exact existing folders only. New revision/ECR homes need a separately authorized creation/link workflow.
internal sealed record LibraryFolderCopyGrant(string Id,string Path,string RelativePath);

internal sealed partial class SimLibraryPreparation
{
 internal async Task<object> IncomingFolderCopy(string id,string token,string documentId,SimPersona p,Func<LibraryPreparation,PreparationFile,byte[],Task<object>> action){
  Permit(p,true,true);await gate.WaitAsync();try{
   var r=await Read(id)??throw new IOException("Preparation is unavailable.");Require(Hash(r)==token,"Preparation changed. Reopen the request before copying.");Require(r.Status=="IN_PREPARATION"&&r.LibraryKey is not null,"Open the assembly preparation destination first.");
   var file=r.Files.SingleOrDefault(f=>f.DocumentId==documentId);Require(file is not null,"Choose a file included in this request.");Require(!IsHandled(r,file!),"This file has been handled. Reopen it in the incoming package before copying.");
   var bytes=r.Promoted.Contains(documentId)?await File.ReadAllBytesAsync(Path.Combine(root,"evidence",file!.Sha256)):(await open(r.IntakeId,documentId)).Bytes;
   Require(bytes.LongLength==file!.Size&&SimLibraryBomStore.Hash(bytes)==file.Sha256,"Incoming evidence changed. No folder copy was made.");return await action(r,file,bytes);
  }finally{gate.Release();}
 }
}

internal sealed partial class SimLibraryBomStore
{
 // Separate, default-off write allowlist; the existing source browser remains read-only.
 private bool CopyAllowed(string id,string path,string relative){var policy=Path.Combine(stateRoot,"library-folder-copy-policy.json");var raw=File.Exists(policy)?File.ReadAllText(policy):null;if(string.IsNullOrWhiteSpace(raw))return false;
  try{var allowed=JsonSerializer.Deserialize<LibraryFolderCopyGrant[]>(raw,Json)??[];Require(allowed.Length<=16&&allowed.All(r=>r is not null&&!string.IsNullOrWhiteSpace(r.Id)&&!string.IsNullOrWhiteSpace(r.Path)&&Path.IsPathFullyQualified(r.Path)&&!string.IsNullOrWhiteSpace(r.RelativePath)&&SimDrawingFolders.Normalize(r.RelativePath)==r.RelativePath),"Folder copy policy must name exact existing assembly folders.");return allowed.Any(r=>r.Id==id&&Path.TrimEndingDirectorySeparator(Path.GetFullPath(r.Path)).Equals(Path.TrimEndingDirectorySeparator(path),StringComparison.OrdinalIgnoreCase)&&r.RelativePath.Equals(relative,StringComparison.OrdinalIgnoreCase));}
  catch(Exception e)when(e is JsonException or ArgumentException){throw SimRfqIntakeProblem.Conflict("LIBRARY_COPY_POLICY","Folder copying is disabled until its exact destination folder is approved.");}}
 private string CopyAuditPath(string id)=>Path.Combine(root,"folder-copies",id+".json");
 private async Task WriteCopyAudit(LibraryFolderCopyAudit audit){var path=CopyAuditPath(audit.Id);Directory.CreateDirectory(Path.GetDirectoryName(path)!);var tmp=path+"."+Guid.NewGuid().ToString("N")+".tmp";try{await File.WriteAllTextAsync(tmp,JsonSerializer.Serialize(audit,Json));Require(JsonSerializer.Deserialize<LibraryFolderCopyAudit>(await File.ReadAllTextAsync(tmp),Json)==audit,"Copy receipt could not be verified.");File.Move(tmp,path,true);}finally{if(File.Exists(tmp))File.Delete(tmp);}}
 private static bool CopyTargetExists(string path){try{_ = File.GetAttributes(path);return true;}catch(FileNotFoundException){return false;}catch(DirectoryNotFoundException){return false;}}
 private static async Task<bool> CopyMatches(string path,PreparationFile file){if((File.GetAttributes(path)&(FileAttributes.Directory|FileAttributes.ReparsePoint))!=0)return false;using var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read,81920,FileOptions.Asynchronous);return stream.Length==file.Size&&Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(stream))==file.Sha256;}
 private async Task<(LibraryFolderLink Link,string FolderToken,string RootPath,string Directory,string Target,string Relative,string Id,string Token,LibraryFolderCopyAudit? Audit)> CopyContext(LibraryPreparation preparation,PreparationFile file){
  var key=preparation.LibraryKey!;Header(key);var folders=await ReadFolder(key);Require(folders.Current is not null,"Link an Assembly Folder before copying.");var link=folders.Current!;var context=await FolderContext(key);
  Require(link.DrawingRevision==context.Drawing&&link.BomRevision==context.Bom&&link.DrawingRevision==preparation.DrawingRevision&&link.BomRevision==preparation.BomRevision,"The linked assembly revision changed. Review the destination before copying.");
  Require(file.Name.Length<=255&&file.Name.Length>0&&!file.Name.Contains('/')&&SimDrawingFolders.Normalize(file.Name)==file.Name,"The incoming filename is unsafe. No copy was made.");
  Require(new[]{".pdf",".docx",".xls",".xlsx",".csv",".txt",".png",".jpg",".jpeg",".gif",".webp"}.Contains(Path.GetExtension(file.Name).ToLowerInvariant()),"This file type is not supported for Library documents.");Require(file.Size>0&&file.Size<=20*1024*1024,"Choose a nonempty document up to 20 MB.");
  var selected=Sources().Resolve(link.RootId,link.RelativePath);Require(selected.Relative.Length>0,"Choose an assembly folder, not the source root.");var relative=selected.Relative+"/"+file.Name;SimDrawingFolders.Normalize(relative);var target=Path.Combine(selected.Path,file.Name);
  var id=Hash(JsonSerializer.SerializeToUtf8Bytes(new{PreparationId=preparation.Id,file.DocumentId,file.Sha256,LinkId=link.Id,selected.Root.Path,relative},Json));var token=Hash(JsonSerializer.SerializeToUtf8Bytes(new{preparation.Id,PreparationToken=JsonSerializer.Serialize(preparation,Json),FolderToken=FolderToken(folders),file,selected.Root.Path,relative},Json));
  var auditPath=CopyAuditPath(id);var audit=File.Exists(auditPath)?JsonSerializer.Deserialize<LibraryFolderCopyAudit>(await File.ReadAllTextAsync(auditPath),Json):null;
  if(audit is not null)Require(audit.Id==id&&audit.PreparationId==preparation.Id&&audit.DocumentId==file.DocumentId&&audit.Sha256==file.Sha256&&audit.Folder==link&&audit.RelativePath==relative&&audit.RootPath==selected.Root.Path,"Copy receipt does not match this destination.");
  return(link,FolderToken(folders),selected.Root.Path,selected.Path,target,relative,id,token,audit);
 }
 internal async Task<object> PreviewIncomingCopy(LibraryPreparation preparation,PreparationFile file,SimPersona p){Permission(p,write:true);if(!p.Can("assembly_library.folder_copy"))throw new LibraryBomPermissionException();await gate.WaitAsync();try{var c=await CopyContext(preparation,file);var enabled=CopyAllowed(c.Link.RootId,c.RootPath,c.Link.RelativePath);var exists=CopyTargetExists(c.Target);var interrupted=CopyTargetExists(Path.Combine(c.Directory,"~dle-os-"+c.Id+".partial"));var copied=c.Audit is not null&&c.Audit.Status!="FAILED"&&exists&&await CopyMatches(c.Target,file);return new LibraryFolderCopyPreview(c.Target,file.Name,c.FolderToken,c.Token,enabled&&!exists&&!interrupted,copied,copied?"Already copied; matching bytes verified.":interrupted?"An interrupted copy needs checking before retrying. Original Intake evidence is retained.":exists?"A file with this name already exists. Nothing will be overwritten.":!enabled?"Copying to this server folder is not enabled yet.":null);}finally{gate.Release();}}
 // Only isolated tests can inject failures or exercise an in-flight rename; no endpoint/config exposes this seam.
 internal Action<string>? FolderCopyTestStep {get;set;}
 internal async Task<object> CopyIncoming(LibraryPreparation preparation,PreparationFile file,byte[] bytes,LibraryFolderCopyCommand command,SimPersona p){Permission(p,write:true);if(!p.Can("assembly_library.folder_copy"))throw new LibraryBomPermissionException();await gate.WaitAsync();try{
  Require(command.Confirmed,"Confirm the displayed destination before copying.");var c=await CopyContext(preparation,file);Require(command.PreviewToken==c.Token,"The source or linked destination changed. Check the destination again.");Require(CopyAllowed(c.Link.RootId,c.RootPath,c.Link.RelativePath),"Copying to this server folder is not enabled yet.");Require(bytes.LongLength==file.Size&&Hash(bytes)==file.Sha256,"Incoming evidence verification failed.");
  using var held=new LibraryCopyDirectoryGuard(c.Directory);Sources().Resolve(c.Link.RootId,c.Link.RelativePath);
  if(CopyTargetExists(c.Target)){Require(c.Audit is not null&&c.Audit.Status!="FAILED"&&await CopyMatches(c.Target,file),"A file with this name already exists. Nothing was overwritten.");var recovered=c.Audit! with{Status="COPIED",VerifiedBy=Actor(p)};await WriteCopyAudit(recovered);return new{copied=true,alreadyCopied=true,destination=c.Target};}
  Require(c.Audit?.Status!="COPIED","The previously copied file is now missing. Review it before making another copy.");
  var audit=c.Audit??new(c.Id,preparation.Id,preparation.ProjectId,preparation.IntakeId,file.DocumentId,file.Name,file.Sha256,file.Size,preparation.SourceFingerprint,c.Link,c.RootPath,c.Relative,"PREPARING",Actor(p));await WriteCopyAudit(audit with{Status="PREPARING"});
  var temp=Path.Combine(c.Directory,"~dle-os-"+c.Id+".partial");var owned=false;var published=false;
  try{
   using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None,81920,FileOptions.Asynchronous|FileOptions.WriteThrough)){owned=true;await stream.WriteAsync(bytes);stream.Flush(true);FolderCopyTestStep?.Invoke("TEMP_WRITTEN");stream.Position=0;Require(Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(stream))==file.Sha256,"Temporary copy verification failed.");}
   Sources().Resolve(c.Link.RootId,c.Link.RelativePath);FolderCopyTestStep?.Invoke("BEFORE_PUBLISH");File.Move(temp,c.Target,false);owned=false;published=true;Require(await CopyMatches(c.Target,file),"Destination verification failed. Reopen to check the copy before retrying.");FolderCopyTestStep?.Invoke("PUBLISHED");await WriteCopyAudit(audit with{Status="COPIED",VerifiedBy=Actor(p)});return new{copied=true,alreadyCopied=false,destination=c.Target};
  }catch(Exception e)when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or SimRfqIntakeProblem){
   if(owned){try{File.Delete(temp);}catch(IOException){}catch(UnauthorizedAccessException){}}
   try{await WriteCopyAudit(audit with{Status=published?"CHECK_REQUIRED":"FAILED"});}catch(IOException){}catch(UnauthorizedAccessException){}
   throw SimRfqIntakeProblem.Conflict("LIBRARY_FOLDER_COPY",published?"The file may have been copied, but its receipt was not completed. Reopen and verify before retrying; nothing was overwritten.":"Copy did not complete. Original Intake evidence is retained. Check the destination before retrying; nothing was overwritten.");
  }
 }finally{gate.Release();}}
}

// Pin the selected directory and every ancestor without delete sharing; never follow reparse points.
// No privilege, ACL, registry or credential changes. Unsupported/busy filesystems fail closed.
internal sealed class LibraryCopyDirectoryGuard:IDisposable{
 private readonly List<SafeFileHandle> handles=[];
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,ExactSpelling=true)]private static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 internal LibraryCopyDirectoryGuard(string path){try{if(!OperatingSystem.IsWindows())throw new IOException("Folder copying requires the supported Windows runtime.");var chain=new Stack<string>();for(var d=new DirectoryInfo(path);d is not null;d=d.Parent)chain.Push(d.FullName);while(chain.Count>0){var next=chain.Pop();var handle=CreateFileW(next,0x81,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(handle.IsInvalid){var error=Marshal.GetLastWin32Error();handle.Dispose();throw new IOException("Folder is busy or unavailable; no copy was made. ("+next+")",new System.ComponentModel.Win32Exception(error));}handles.Add(handle);if((File.GetAttributes(next)&FileAttributes.ReparsePoint)!=0)throw new IOException("Linked directories are not supported for copying.");}}catch{Dispose();throw;}}
 public void Dispose(){foreach(var handle in handles.AsEnumerable().Reverse())handle.Dispose();handles.Clear();}
}

internal static class SimLibraryFolderCopyEndpoints{
 internal static void Map(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimLibraryBomStore library,SimLibraryPreparation preparation){
  async Task<IResult> Run(HttpContext c,string id,string token,string documentId,LibraryFolderCopyCommand? command){c.Response.Headers.CacheControl="private, no-store";if(!state.Current.IsHealthy)return Results.Json(new{message="SIM storage is not ready."},statusCode:503);var actor=personas.Resolve(c);if(!actor.Can("assembly_library.folder_copy"))return Results.Json(new{message="Folder copying is not permitted for this profile."},statusCode:403);try{return Results.Json(await preparation.IncomingFolderCopy(id,token,documentId,actor,async(r,f,bytes)=>command is null?await library.PreviewIncomingCopy(r,f,actor):await library.CopyIncoming(r,f,bytes,command,actor)));}catch(LibraryBomPermissionException e){return Results.Json(new{message=e.Message},statusCode:403);}catch(SimRfqIntakeProblem e){return Results.Json(new{message=e.Message,code=e.Code},statusCode:e.StatusCode);}catch(Exception e)when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or JsonException){return Results.Json(new{message="Folder access is unavailable. Original Intake evidence is retained. Reopen to verify saved state before retrying."},statusCode:503);}}
  app.MapGet("/api/sim/assembly-library/preparation/folder-copy",(string id,string token,string documentId,HttpContext c)=>Run(c,id,token,documentId,null));
  app.MapPost("/api/sim/assembly-library/preparation/folder-copy",(LibraryFolderCopyCommand command,HttpContext c)=>Run(c,command.PreparationId,command.ExpectedPreparationToken,command.DocumentId,command));
 }
}
