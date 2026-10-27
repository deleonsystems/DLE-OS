using System.Text.Json;

internal sealed record LibraryReadyBom(string Status,bool Ready,int Version,int RowCount);
internal sealed record LibraryReadyDocument(string Id,int Version,string Name,string[] Purposes,string Use,string? Origin);
internal sealed record LibraryReadyCopy(string Id,string Status,string RelativePath,DateTimeOffset? VerifiedAtUtc,DateTimeOffset RequestedAtUtc,bool SourceMatches,bool DestinationMatches,LibraryFolderCopyAudit Receipt);
internal sealed record LibraryReadyIncoming(string DocumentId,string Name,string Decision,PreparationLibraryReference? ExistingDocument,bool OsCopyRecorded,LibraryReadyCopy[] FolderCopies);
internal sealed record LibraryReadyTask(string Code,string Label,string State,string Detail);
internal sealed record LibraryReadyCounts(int Documents,int Materials,int Production,int Both,int Incoming,int Handled,int Unresolved);
internal sealed record LibraryReadySummary(LibraryPackagePreparation? Request,LibraryReadyTask[] RequestedWork,LibraryReadyBom Bom,LibraryReadyDocument[] Documents,LibraryReadyIncoming[] IncomingFiles,LibraryReadyCounts Counts,string? RequestNotes=null,bool CopyHistoryComplete=true);
internal sealed record LibraryPackageHandoff(int SchemaVersion,LibraryReadySummary Summary,string? SubmissionNote,string? PreparationToken,string CopyReceiptsToken,string BomToken,string DocumentsToken);
internal sealed record LibraryReadyState(LibraryReadySummary Summary,string PreviewToken,string PackageToken,string BomToken,string DocumentsToken,string? PreparationToken,string CopyReceiptsToken,string[] Blockers,bool Locked);

internal sealed partial class SimLibraryPreparation
{
 // Keep the same preparation -> Library lock order used by copy and file-disposition actions.
 internal async Task<object> WithPackageContext(string? id,string key,SimPersona p,bool write,Func<LibraryPreparation?,Task<object>> action){
  Permit(p,true,write);await gate.WaitAsync();try{
   LibraryPreparation? record=null;
   if(!string.IsNullOrEmpty(id)){
    record=await Read(id)??throw new IOException("The Library request is unavailable.");
    Require(record.Id==id&&record.LibraryKey==key&&record.Status=="IN_PREPARATION","This request does not target the selected Assembly Records. Open the correct request before submitting.");
   }
   return await action(record);
  }finally{gate.Release();}
 }
}

internal sealed partial class SimLibraryBomStore
{
 private static LibraryPackagePreparation ReadyRequest(LibraryPreparation r)=>new(r.Id,r.ProjectId,r.IntakeId,r.LineNumber,r.DisplayId??r.IntakeId,r.IncomingRevision,r.SourceFingerprint,r.RequestedQuantity,r.RequestedScope);
 private async Task<string?> ResolveReadyRequest(string key,string? requested,SimPersona p){Permission(p);Header(key);await gate.WaitAsync();try{return string.IsNullOrEmpty(requested)?ReadPackages(key).Versions.LastOrDefault()?.Preparation?.Id:requested;}finally{gate.Release();}}
 internal async Task<object> ReviewPreview(string key,string? preparationId,SimPersona p,SimLibraryPreparation? preparation){
  Permission(p);Require(preparation is not null,"Review summary support is unavailable. Reopen the assembly workspace.");var resolved=await ResolveReadyRequest(key,preparationId,p);
  return await preparation!.WithPackageContext(resolved,key,p,false,async context=>{
   await gate.WaitAsync();try{
    var packages=ReadPackages(key);
    if(string.IsNullOrEmpty(preparationId))Require(packages.Versions.LastOrDefault()?.Preparation?.Id==resolved,"The linked request changed. Reopen Ready for review.");
    var view=await BuildReadyState(key,packages,await Read(key),await PackageDocuments(key),context);
    return new{key,view.Summary,view.PreviewToken,view.PackageToken,view.BomToken,view.DocumentsToken,preparationId=context?.Id,canSubmit=p.Can("assembly_library.edit")&&!view.Locked&&view.Blockers.Length==0,view.Blockers,reviewHandoff=true};
   }finally{gate.Release();}
  });
 }
 internal async Task<object> SubmitReviewedPackage(LibraryPackageCommand c,SimPersona p,SimLibraryPreparation? preparation){
  Permission(p,write:true);Require(c.Action=="SUBMIT"&&!string.IsNullOrWhiteSpace(c.ExpectedPreviewToken),"Open Ready for review before submitting.");
  Require(preparation is not null,"Review summary support is unavailable. Reopen the assembly workspace.");
  var resolved=await ResolveReadyRequest(c.Key,c.PreparationId,p);
  return await preparation!.WithPackageContext(resolved,c.Key,p,true,context=>ChangePackage(c with{PreparationId=resolved},p,preparationContext:context,readyFlow:true));
 }
 private async Task<(LibraryFolderCopyAudit[] Receipts,bool Complete)> ReadyCopyReceipts(LibraryPreparation? preparation){
  if(preparation is null)return([],true);
  var directory=Path.Combine(root,"folder-copies");if(!Directory.Exists(directory))return([],true);
  var receipts=new List<LibraryFolderCopyAudit>();var complete=true;
  foreach(var path in Directory.EnumerateFiles(directory,"*.json")){
   try{
    using var document=JsonDocument.Parse(await File.ReadAllTextAsync(path));
    if(document.RootElement.ValueKind!=JsonValueKind.Object||!document.RootElement.TryGetProperty("preparationId",out var owner)||owner.ValueKind!=JsonValueKind.String){complete=false;continue;}
    if(owner.GetString()!=preparation.Id)continue;
    var receipt=document.RootElement.Deserialize<LibraryFolderCopyAudit>(Json);
    if(receipt is null||receipt.IntakeId!=preparation.IntakeId||receipt.ProjectId!=preparation.ProjectId||Path.GetFileNameWithoutExtension(path)!=receipt.Id||receipt.Folder is null||receipt.RequestedBy is null||string.IsNullOrEmpty(receipt.DocumentId)||receipt.Status is not("COPIED" or "PREPARING" or "CHECK_REQUIRED" or "FAILED")){complete=false;continue;}
    receipts.Add(receipt);
   }catch(Exception e)when(e is JsonException or IOException or UnauthorizedAccessException){complete=false;}
  }
  return(receipts.OrderBy(r=>r.Id,StringComparer.Ordinal).ToArray(),complete);
 }
 private async Task<LibraryReadyState> BuildReadyState(string key,LibraryPackagesRecord packages,LibraryBomRecord bom,(LibraryDocumentsRecord Record,LibraryDocumentVersion[] Included) docs,LibraryPreparation? preparation){
  if(preparation is not null){
   Require(preparation.LibraryKey==key&&preparation.Status=="IN_PREPARATION","The Library request destination changed. Reopen the request.");
   var context=await FolderContext(key);Require(context.Drawing==preparation.DrawingRevision&&context.Bom==preparation.BomRevision,"The request and saved assembly revision differ. Review the Library destination before submitting.");
  }
  var history=await ReadyCopyReceipts(preparation);var receipts=history.Receipts;
  var incoming=(preparation?.Files??[]).Select(file=>{
   var disposition=(preparation!.FileDispositions??[]).SingleOrDefault(d=>d.File==file&&d.DocumentId==file.DocumentId&&d.Decision is "ALREADY_IN_RECORDS" or "DO_NOT_USE");
   var copies=receipts.Where(r=>r.DocumentId==file.DocumentId).Select(r=>new LibraryReadyCopy(r.Id,r.Status,r.RelativePath,r.VerifiedBy?.AtUtc,r.RequestedBy.AtUtc,r.Sha256==file.Sha256&&r.Size==file.Size,r.Folder.SourceKeyRaw==key&&r.Folder.DrawingRevision==preparation.DrawingRevision&&r.Folder.BomRevision==preparation.BomRevision,r)).ToArray();
   return new LibraryReadyIncoming(file.DocumentId,file.Name,disposition?.Decision??"UNRESOLVED",disposition?.ExistingDocument,preparation.Promoted.Contains(file.DocumentId),copies);
  }).ToArray();
  var selected=docs.Included.Select(d=>new LibraryReadyDocument(d.Id,d.Version,Path.GetFileName(d.Source.RelativePath),d.Purposes,d.Use,d.Origin)).ToArray();
  var bomReady=bom.Draft is not null&&Blockers(bom.Draft).Length==0;
  var bomSummary=new LibraryReadyBom(bom.Draft is null?"NOT_BUILT":bomReady?"READY":"DRAFT",bomReady,bom.Draft?.InternalVersion??0,bom.Draft?.Rows.Length??0);
  var handled=incoming.Count(f=>f.Decision!="UNRESOLVED");
  var counts=new LibraryReadyCounts(selected.Length,selected.Count(d=>d.Use is "MATERIALS" or "BOTH"),selected.Count(d=>d.Use is "PRODUCTION" or "BOTH"),selected.Count(d=>d.Use=="BOTH"),incoming.Length,handled,incoming.Length-handled);
  var work=(preparation?.Tasks??[]).Select(code=>code switch{
   "BUILD_BOM"=>new LibraryReadyTask(code,"Build DLE-OS BOM",bomReady?"READY":bom.Draft is null?"MISSING":"REVIEW",bom.Draft is null?"No saved BOM yet.":bomReady?$"{bomSummary.RowCount} saved rows pass the BOM checks.":"The saved BOM still has items to resolve."),
   "IDENTIFY_FILES"=>new LibraryReadyTask(code,"Identify and disposition files",counts.Unresolved>0?"UNRESOLVED":selected.Length==0?"MISSING":selected.Any(d=>d.Purposes.Length==0)?"REVIEW":"RECORDED",$"{selected.Length} files selected for this package."+(counts.Unresolved>0?$" {counts.Unresolved} incoming files await a decision.":"")+(selected.Any(d=>d.Purposes.Length==0)?$" {selected.Count(d=>d.Purposes.Length==0)} selected files need a purpose.":"")),
   "COMPARE_FILES" or "CHECK_FILES"=>new LibraryReadyTask(code,code=="COMPARE_FILES"?"Compare incoming files with Assembly Records":"Check existing drawings/files",counts.Unresolved==0&&counts.Incoming>0?"RECORDED":"UNRESOLVED",$"{handled} of {incoming.Length} incoming files have saved decisions."),
   "RESOLVE_REVISION"=>new LibraryReadyTask(code,"Review revision difference","RECORDED","Library destination selected; incoming revision remains recorded separately."),
   _=>new LibraryReadyTask(code,"Requested work","REVIEW","Review the requested work with the saved package.")
  }).ToArray();
  var summary=new LibraryReadySummary(preparation is null?null:ReadyRequest(preparation),work,bomSummary,selected,incoming,counts,string.IsNullOrWhiteSpace(preparation?.Work)?null:preparation.Work,history.Complete);
  var prepToken=preparation is null?null:Hash(JsonSerializer.SerializeToUtf8Bytes(preparation,Json));var copiesToken=Hash(JsonSerializer.SerializeToUtf8Bytes(receipts,Json));
  var bomToken=Token(bom);var documentsToken=DocumentsToken(docs.Record);var packageToken=PackageToken(packages);
  var token=Hash(JsonSerializer.SerializeToUtf8Bytes(new{key,packageToken,bomToken,documentsToken,prepToken,copiesToken,summary},Json));
  return new(summary,token,packageToken,bomToken,documentsToken,prepToken,copiesToken,PackageBlockers(bom,docs.Included),PackageLocked(bom));
 }
}
