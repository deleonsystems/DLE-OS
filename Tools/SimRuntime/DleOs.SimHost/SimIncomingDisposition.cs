using System.Text.Json;

// Decisions belong to this routed request, not to the source document or an approved package.
internal sealed record PreparationLibraryReference(string LibraryKey,string DrawingRevision,string BomRevision,string DocumentsToken,LibraryDocumentVersion Document);
internal sealed record PreparationFileDisposition(string DocumentId,string Decision,PreparationFile File,string? LibraryKey,string DrawingRevision,string BomRevision,LibraryActor Actor,PreparationLibraryReference? ExistingDocument=null);
internal sealed record PreparationDispositionAudit(string RequestId,string CommandHash,PreparationFileDisposition Value,string SourceFingerprint);
internal sealed record PreparationFileDispositionCommand(string Id,string Token,string DocumentId,string Decision,bool Confirmed,string RequestId,string? LibraryDocumentId=null,int? LibraryDocumentVersion=null,string? LibraryDocumentsToken=null);

internal sealed partial class SimLibraryPreparation
{
 private static PreparationFileDisposition? CurrentDisposition(LibraryPreparation r,PreparationFile f)=>
  (r.FileDispositions??[]).SingleOrDefault(d=>d.DocumentId==f.DocumentId&&d.File==f&&d.Decision is "ALREADY_IN_RECORDS" or "DO_NOT_USE");
 private static bool IsHandled(LibraryPreparation r,PreparationFile f)=>CurrentDisposition(r,f) is not null;
 private static PreparationFileDisposition[]? RetainedDispositions(LibraryPreparation r,IEnumerable<PreparationFile> files){
  if(r.FileDispositions is null)return null;
  var current=files.ToArray();return r.FileDispositions.Where(d=>current.Any(f=>f==d.File)).ToArray();
 }
 internal async Task<object> Disposition(PreparationFileDispositionCommand c,SimPersona p,
  Func<LibraryPreparation,PreparationFileDispositionCommand,SimPersona,Task<PreparationLibraryReference?>>? resolve=null)
 {
  Permit(p,true,true);await gate.WaitAsync();try{
   var r=await Read(c.Id)??throw new IOException("Preparation request unavailable.");
   Require(r.Status is "NEEDS_PREPARATION" or "IN_PREPARATION","This request is not open for Library preparation.");
   Require(c.Confirmed,"Choose a file decision and save it.");
   Require(c.Decision is "ALREADY_IN_RECORDS" or "DO_NOT_USE" or "REOPEN","Choose a supported file decision.");
   Require(Guid.TryParseExact(c.RequestId,"D",out var requestId),"A file-save request identifier is required.");
   var canonicalId=requestId.ToString("D");var commandHash=Hash(c);
   var file=r.Files.SingleOrDefault(f=>f.DocumentId==c.DocumentId);Require(file is not null,"Choose a file routed to this request.");
   var prior=r.History.Select(e=>e.Disposition).SingleOrDefault(a=>a?.RequestId==canonicalId);
   var (source,assembly,_)=await IncomingContext(r.IntakeId,r.LineNumber);
   Require(source.Customer.CustomerId==r.CustomerId&&assembly.AssemblyNumber==r.AssemblyNumber,"Incoming assembly context changed. Return to Technical Review.");
   if(prior is not null){
    Require(prior.CommandHash==commandHash,"This save identifier was already used for a different decision.");
    var latest=r.History.LastOrDefault(e=>e.Disposition?.Value.DocumentId==c.DocumentId)?.Disposition;
    Require(latest?.RequestId==canonicalId&&prior.Value.File==file,"This file was changed after that save. Reopen the package to see its current decision.");
    return new{record=r,token=Hash(r),incomingPackage=BuildIncomingPackage(source,assembly,r,p,"library"),replayed=true};
   }
   Require(Hash(r)==c.Token,"Preparation changed. Reopen the incoming package before saving; your choice has not been applied.");
   var existing=CurrentDisposition(r,file!);
   Require(c.Decision=="REOPEN"?existing is not null:existing is null,c.Decision=="REOPEN"?"This file is already awaiting disposition.":"This file has already been handled. Reopen it before changing its decision.");
   var hasReference=c.LibraryDocumentId is not null||c.LibraryDocumentVersion is not null||c.LibraryDocumentsToken is not null;
   Require(!hasReference||c.Decision=="ALREADY_IN_RECORDS","An existing Library document can only accompany Already in Assembly Records.");
   PreparationLibraryReference? reference=null;
   if(c.Decision!="REOPEN"){
    Require(Hash(source)==r.SourceFingerprint,"Incoming files or request details changed. Return to Technical Review before handling this file.");
    var sourceFile=source.Files.SingleOrDefault(f=>f.DocumentId==file!.DocumentId);
    Require(sourceFile is not null&&sourceFile.BinaryStatus=="VERIFIED"&&sourceFile.Name==file!.Name,"The original incoming file is no longer verified for this request.");
    var read=await open(r.IntakeId,file!.DocumentId);
    Require(read.Document.DocumentId==file.DocumentId&&read.Document.Name==file.Name&&read.Bytes.LongLength==file.Size&&SimLibraryBomStore.Hash(read.Bytes)==file.Sha256,"Incoming evidence changed. No file decision was saved.");
   }
   if(c.Decision=="ALREADY_IN_RECORDS"){
    Require(!string.IsNullOrEmpty(r.LibraryKey),"Choose the Assembly Records destination before marking a file already present.");
    var h=Headers().SingleOrDefault(h=>h.SourceKeyRaw==r.LibraryKey);
    Require(h is not null&&h.BillNumber.TrimEnd()==r.AssemblyNumber&&h.DrawingRevision.TrimEnd()==r.DrawingRevision&&h.BomRevision.TrimEnd()==r.BomRevision,"The selected Assembly Records revision changed. Review the destination first.");
    if(hasReference){
     Require(!string.IsNullOrEmpty(c.LibraryDocumentId)&&c.LibraryDocumentVersion>0&&!string.IsNullOrEmpty(c.LibraryDocumentsToken),"Select a complete saved Library document reference, or leave it unassigned.");
    }
    Require(resolve is not null,"Assembly Records verification is unavailable. Reopen the package.");
    reference=await resolve!(r,c,p);
   }
   var actor=Actor(p);
   var decision=new PreparationFileDisposition(file!.DocumentId,c.Decision,file,r.LibraryKey,r.DrawingRevision,r.BomRevision,actor,reference);
   var remaining=(r.FileDispositions??[]).Where(d=>d.DocumentId!=file.DocumentId).ToList();if(c.Decision!="REOPEN")remaining.Add(decision);
   var receipt=new PreparationDispositionAudit(canonicalId,commandHash,decision,r.SourceFingerprint);
   r=r with{Revision=r.Revision+1,FileDispositions=remaining.ToArray(),History=[..r.History,new("FILE_DISPOSITION",c.Decision,actor,r.LibraryKey,[file],r.SourceFingerprint,r.DrawingRevision,r.BomRevision,Disposition:receipt)]};
   // Prepare the response before the single atomic record write; no follow-up read is needed by the UI.
   var package=BuildIncomingPackage(source,assembly,r,p,"library");await Write(r);
   return new{record=r,token=Hash(r),incomingPackage=package,replayed=false};
  }finally{gate.Release();}
 }
}

internal sealed partial class SimLibraryBomStore
{
 // Called while the preparation lock is held: same preparation -> Library lock order as folder copy.
 // This captures a saved version only. It neither reads the live share nor asserts byte equivalence.
 internal async Task<PreparationLibraryReference?> ResolvePreparationDocument(LibraryPreparation preparation,PreparationFileDispositionCommand command,SimPersona p){
  Permission(p,write:true);var key=preparation.LibraryKey!;var header=Header(key);await gate.WaitAsync();try{
   Require(header.BillNumber.TrimEnd()==preparation.AssemblyNumber,"The Library assembly does not match this request.");
   var context=await FolderContext(key);
   Require(context.Drawing==preparation.DrawingRevision&&context.Bom==preparation.BomRevision,"The Assembly Records revision changed. Reopen the package.");
   if(command.LibraryDocumentId is null)return null;
   var record=await ReadDocuments(key,context.Drawing,context.Bom);
   Require(DocumentsToken(record)==command.LibraryDocumentsToken,"Identified Library files changed. Reopen the file choices before saving.");
   var current=record.History.Where(d=>d.Id==command.LibraryDocumentId).OrderBy(d=>d.Version).LastOrDefault();
   Require(current is not null&&current.Version==command.LibraryDocumentVersion,"Choose a current saved Library file version.");
   Require(current!.Association.SourceKeyRaw==key&&current.Association.DrawingRevision==context.Drawing&&current.Association.BomRevision==context.Bom,"Saved file revision context could not be verified.");
   return new(key,context.Drawing,context.Bom,DocumentsToken(record),current);
  }finally{gate.Release();}
 }
}
