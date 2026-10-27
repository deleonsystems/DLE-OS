using System.Text.Json;
internal sealed record IncomingPackageFile(string? Id,string Name,long Size,string Type,string Identification,bool Available,bool RoutedToLibrary,bool AddedInReview,string? IdentificationDetails=null,PreparationFileDisposition? Disposition=null);
internal sealed record IncomingPackageView(string Id,string Customer,string Assembly,string IncomingRevision,string Request,string Status,IncomingPackageFile[] Files,bool CanOpen,bool RoutedFilesOnly,string? Notice,IncomingPackageFile[]? HandledFiles=null,string? Token=null,bool CanDisposition=false,string? LibraryKey=null,string? DrawingRevision=null,string? BomRevision=null);
internal sealed record IncomingPackageBytes(string Name,string Type,byte[] Bytes);
internal sealed partial class SimLibraryPreparation
{
 private static void IncomingPermission(SimPersona p,string module){
  if(module=="library")Permit(p,true);else if(module=="review")Permit(p,false);else if(module!="intake"||!p.IsActive)throw new LibraryBomPermissionException();
 }
 private async Task<(PreparationIntake Source,SimRfqIntakeAssembly Assembly,LibraryPreparation? Preparation)> IncomingContext(string intakeId,int line){
  var source=SimAssemblyProjects.Scope(await intake(intakeId),line);var assembly=source.Assemblies.Single(a=>a.LineNumber==line);return(source,assembly,await Read(Id(source,line)));
 }
 private static SimRfqIntakeDocument[] OriginalIncoming(PreparationIntake source)=>source.Files.Where(f=>f.ReviewOrigin is null).ToArray();
 internal async Task<IncomingPackageView> IncomingPackage(string intakeId,int line,string? preparationId,SimPersona p,string module){IncomingPermission(p,module);await gate.WaitAsync();try{
  PreparationIntake source;SimRfqIntakeAssembly assembly;LibraryPreparation? r;
  if(module=="library"){
   r=await Read(preparationId??"")??throw new IOException("Preparation request unavailable.");Require(r.Status is "NEEDS_PREPARATION" or "IN_PREPARATION","This incoming package is not routed to Library.");(source,assembly,_)=await IncomingContext(r.IntakeId,r.LineNumber);Require(source.Customer.CustomerId==r.CustomerId,"Incoming customer context changed. Return to Technical Review.");
  }else(source,assembly,r)=await IncomingContext(intakeId,line);
  return BuildIncomingPackage(source,assembly,r,p,module);
 }finally{gate.Release();}}
 private IncomingPackageView BuildIncomingPackage(PreparationIntake source,SimRfqIntakeAssembly assembly,LibraryPreparation? r,SimPersona p,string module){
  var originals=OriginalIncoming(source);var routed=(r?.Files??[]).Select(f=>f.DocumentId).ToHashSet(StringComparer.Ordinal);IncomingPackageFile[] files;
  if(module=="library")files=r!.Files.Select(f=>{var metadata=source.Files.SingleOrDefault(d=>d.DocumentId==f.DocumentId);return new IncomingPackageFile(f.DocumentId,f.Name,f.Size,metadata?.Type??"application/octet-stream",metadata?.InitialIdentification?.Type??"UNKNOWN",true,true,metadata?.ReviewOrigin is not null,metadata?.InitialIdentification?.OtherDescription,CurrentDisposition(r,f));}).ToArray();
  else files=originals.Select(f=>new IncomingPackageFile(f.DocumentId,f.Name,f.Size,f.Type,f.InitialIdentification?.Type??"UNKNOWN",f.BinaryStatus=="VERIFIED"&&f.DocumentId is not null,routed.Contains(f.DocumentId??""),false,f.InitialIdentification?.OtherDescription)).ToArray();
  var handled=module=="library"?files.Where(f=>f.Disposition is not null).ToArray():null;if(module=="library")files=files.Where(f=>f.Disposition is null).ToArray();
  var request=source.DisplayId??SimAssemblyProjects.Label(source.IntakeId,assembly);var revision=module=="library"?r!.IncomingRevision:assembly.Revision;var name=module=="library"?r!.AssemblyNumber:assembly.AssemblyNumber;
  return new(Id(source,assembly.LineNumber),source.Customer.CustomerName,name,revision,request,r?.Status??"AWAITING_ASSESSMENT",files,module!="intake"||p.Can("technical_review.view"),module=="library",module=="library"?"Files sent to Library; original Intake evidence is retained.":"Original Intake files assigned to this assembly.",handled,module=="library"?Hash(r):null,module=="library"&&p.Can("assembly_library.edit"),module=="library"?r!.LibraryKey:null,module=="library"?r!.DrawingRevision:null,module=="library"?r!.BomRevision:null);
 }
 internal async Task<IncomingPackageBytes> IncomingPackageFile(string intakeId,int line,string? preparationId,string documentId,SimPersona p,string module){
  // Intake's existing submitted-document open permission remains Technical Review view.
  IncomingPermission(p,module);if(module=="intake")Permit(p,false);await gate.WaitAsync();try{
   if(module=="library"){
    var r=await Read(preparationId??"")??throw new IOException("Preparation request unavailable.");Require(r.Status is "NEEDS_PREPARATION" or "IN_PREPARATION","This incoming package is not routed to Library.");var f=r.Files.SingleOrDefault(f=>f.DocumentId==documentId);Require(f is not null,"File is not included in this Library preparation request.");var bytes=r.Promoted.Contains(documentId)?await File.ReadAllBytesAsync(Path.Combine(root,"evidence",f!.Sha256)):(await open(r.IntakeId,documentId)).Bytes;Require(bytes.LongLength==f!.Size&&SimLibraryBomStore.Hash(bytes)==f.Sha256,"Retained incoming evidence could not be verified.");return new(f.Name,ContentType(f.Name,bytes),bytes);
   }
   var (source,_,_)=await IncomingContext(intakeId,line);var file=OriginalIncoming(source).SingleOrDefault(f=>f.DocumentId==documentId&&f.BinaryStatus=="VERIFIED");Require(file is not null,"Choose a retained Intake file assigned to this assembly.");var read=await open(source.IntakeId,documentId);Require(read.Document.DocumentId==file!.DocumentId&&read.Document.Name==file.Name&&read.Bytes.LongLength==file.Size,"Retained incoming file does not match this request.");return new(file.Name,ContentType(file.Name,read.Bytes),read.Bytes);
  }finally{gate.Release();}
 }
 private static string ContentType(string name,byte[] bytes)=>Path.GetExtension(name).Equals(".pdf",StringComparison.OrdinalIgnoreCase)&&bytes.AsSpan().StartsWith("%PDF-"u8)?"application/pdf":"application/octet-stream";
}
internal static partial class SimLibraryPreparationEndpoints
{
 private static void MapIncoming(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimLibraryPreparation store){
  async Task<IResult> Run(HttpContext c,string module,string intakeId,int line,string? id,string? document){c.Response.Headers.CacheControl="private, no-store";c.Response.Headers["X-Content-Type-Options"]="nosniff";if(!state.Current.IsHealthy)return Results.Json(new{message="SIM storage is not ready."},statusCode:503);try{
   var p=personas.Resolve(c);if(document is null)return Results.Json(await store.IncomingPackage(intakeId,line,id,p,module));var file=await store.IncomingPackageFile(intakeId,line,id,document,p,module);c.Response.Headers.ContentDisposition=new System.Net.Http.Headers.ContentDispositionHeaderValue(file.Type=="application/pdf"&&c.Request.Query["download"]!="true"?"inline":"attachment"){FileNameStar=file.Name}.ToString();return Results.File(file.Bytes,file.Type,enableRangeProcessing:true);
  }catch(LibraryBomPermissionException e){return Results.Json(new{message=e.Message},statusCode:403);}catch(SimRfqIntakeProblem e){return Results.Json(new{message=e.Message,code=e.Code},statusCode:e.StatusCode);}catch(Exception e)when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or JsonException){return Results.Json(new{message="Incoming evidence is unavailable. Original records were not changed."},statusCode:503);}}
  foreach(var module in new[]{"intake","review"}){var context=module;var route=module=="review"?"technical-review":"intake";app.MapGet("/api/sim/"+route+"/incoming-package",(string intakeId,int lineNumber,HttpContext c)=>Run(c,context,intakeId,lineNumber,null,null));app.MapGet("/api/sim/"+route+"/incoming-package/file",(string intakeId,int lineNumber,string documentId,HttpContext c)=>Run(c,context,intakeId,lineNumber,null,documentId));}
  app.MapGet("/api/sim/assembly-library/incoming-package",(string id,HttpContext c)=>Run(c,"library","",0,id,null));app.MapGet("/api/sim/assembly-library/incoming-package/file",(string id,string documentId,HttpContext c)=>Run(c,"library","",0,id,documentId));
 }
}
