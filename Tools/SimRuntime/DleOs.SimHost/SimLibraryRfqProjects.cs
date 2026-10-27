using System.Text.Json;

// Stable child identity and immutable approved-package reference. DisplayId is a string,
// never a decimal; the project GUID remains the storage identity.
internal sealed record SimLibraryRfqBinding(string ProjectId,string ParentIntakeId,int LineNumber,string DisplayId,
 string LibraryKey,string PackageId,int PackageVersion,string PackageHash,string PreparationId,string BomId,int BomVersion,string GoverningDocumentId);
internal sealed record SimLibraryRfqReceipt(string ContractVersion,SimLibraryRfqBinding Binding,
 SimRfqIntakeCustomer Customer,SimRfqIntakeAssembly Assembly,string RequestCorrelationId,string[] CustomerRequirements,
 string CreatedBy,DateTimeOffset CreatedAtUtc,string ScenarioId,long Generation,string Scope,
 string ReceivedBy,DateTimeOffset ReceivedAtUtc,string ContentHash);
internal sealed record SimLibraryRfqHandoffCommand(string IntakeId,int LineNumber,string PackageId,string ExpectedToken,string? GoverningDocumentId=null);
internal sealed record SimLibraryRfqSource(string PackageToken,LibraryPackageVersion Package,string[] Blockers);
internal sealed record SimLibraryRfqFile(string Name,string Type,byte[] Bytes);

internal sealed partial class SimLibraryBomStore
{
 // All entry points originate from the protected RFQ/TR store. Lock order is
 // Intake -> Preparation (lookup releases) -> Library; no callback enters Intake.
 internal async Task<object> WithRfqSource(LibraryPreparation request,Func<SimLibraryRfqSource,Task<object>> action)
 {
  await gate.WaitAsync();try{
   var record=ReadPackages(request.LibraryKey??"");
   var version=record.Versions.LastOrDefault(v=>PackageBelongsTo(v,request));
   Require(version is not null,"Submit this request's Library package for approval first.");
   VerifyPackage(version!);
   var blockers=new List<string>();
   if(version!.Status!="APPROVED")blockers.Add("Technical Review must approve this package first.");
   var bom=await Read(request.LibraryKey!);
   if(bom.Draft is not null&&bom.Draft.Id!=version.Bom.Id)blockers.Add("A newer BOM draft exists. Review the intended version before handing it to RFQs.");
   if(request.Status!="IN_PREPARATION")blockers.Add("The Library request no longer has a preparation destination.");
   await VerifyEvidence(version.Bom);
   foreach(var doc in version.Documents)await PackageEvidenceBytes(doc);
   return await action(new(PackageToken(record),version,blockers.ToArray()));
  }finally{gate.Release();}
 }
 internal async Task<LibraryPackageVersion> ReadRfqPackage(SimLibraryRfqBinding binding)
 {
  await gate.WaitAsync();try{
   var version=ReadPackages(binding.LibraryKey).Versions.SingleOrDefault(v=>v.Id==binding.PackageId);
   Require(version is not null&&version.Status=="APPROVED"&&version.Version==binding.PackageVersion&&version.ContentHash==binding.PackageHash,
    "The approved RFQ package could not be verified. Its quoted version was not replaced.");
   VerifyPackage(version!);
   Require(version!.Preparation is {} p&&p.Id==binding.PreparationId&&p.ProjectId==binding.ProjectId&&p.IntakeId==binding.ParentIntakeId&&p.LineNumber==binding.LineNumber&&p.DisplayId==binding.DisplayId&&version.Bom.Id==binding.BomId&&version.Bom.InternalVersion==binding.BomVersion,
    "The RFQ package belongs to a different request.");
   return version;
  }finally{gate.Release();}
 }
 internal async Task<SimLibraryRfqFile> ReadRfqFile(SimLibraryRfqBinding binding,string documentId)
 {
  // ReadRfqPackage releases the gate before this scoped byte read. Approved versions
  // and evidence are immutable; verify again after reacquiring it.
  _=await ReadRfqPackage(binding);
  await gate.WaitAsync();try{
   var version=ReadPackages(binding.LibraryKey).Versions.Single(v=>v.Id==binding.PackageId);
   VerifyPackage(version);
   var doc=version.Documents.SingleOrDefault(d=>d.Identification.Id==documentId);
   Require(doc is not null,"This file is not in the approved RFQ package.");
   var name=Path.GetFileName(doc!.Identification.Source.RelativePath);
   var type=Path.GetExtension(name).ToLowerInvariant() switch{ ".pdf"=>"application/pdf",".txt"=>"text/plain",".xls"=>"application/vnd.ms-excel",".xlsx"=>"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",".png"=>"image/png",".jpg" or ".jpeg"=>"image/jpeg",_=>"application/octet-stream"};
   return new(name,type,await PackageEvidenceBytes(doc));
  }finally{gate.Release();}
 }
}

internal sealed partial class SimRfqIntakeStore
{
 internal Func<LibraryPreparation,Func<SimLibraryRfqSource,Task<object>>,Task<object>>? LibraryRfqSource {get;set;}
 internal Func<SimLibraryRfqBinding,Task<LibraryPackageVersion>>? LibraryRfqPackageRead {get;set;}
 internal Func<SimLibraryRfqBinding,string,Task<SimLibraryRfqFile>>? LibraryRfqFileRead {get;set;}
 // Isolated tests may interrupt the commit before any durable receipt exists.
 internal Action? BeforeRfqReceiptCommit {get;set;}
 private string RfqProjectRoot=>Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(dataPath)!)!,"rfq-projects-v1");
 private static void RfqProjectRequire(bool condition,string message){if(!condition)throw SimRfqIntakeProblem.Conflict("LIBRARY_RFQ_HANDOFF",message);}
 private static void RfqProjectPermission(SimPersona p,bool write=false){if(!p.IsActive||!p.Can(write?"technical_review.disposition":"technical_review.view"))throw new LibraryBomPermissionException();}
 private static string RfqReceiptHash(SimLibraryRfqReceipt r)=>SimLibraryBomStore.Hash(JsonSerializer.SerializeToUtf8Bytes(r with{ContentHash=""},SimLibraryBomStore.Json));
 private string RfqProjectPath(string projectId){RfqProjectRequire(Guid.TryParse(projectId,out var id)&&id.ToString()==projectId,"Choose a valid independent project.");return Path.Combine(RfqProjectRoot,projectId+".json");}
 private void VerifyRfqReceipt(SimLibraryRfqReceipt r,string? expectedProject=null)
 {
  RfqProjectRequire(r.ContractVersion=="LIBRARY_RFQ_PROJECT_V1"&&r.ContentHash==RfqReceiptHash(r),"RFQ handoff receipt could not be verified.");
  _=RfqProjectPath(r.Binding.ProjectId);
  RfqProjectRequire((expectedProject is null||r.Binding.ProjectId==expectedProject)&&r.Binding.ProjectId==r.Assembly.ProjectId&&r.Binding.LineNumber==r.Assembly.LineNumber&&r.Binding.DisplayId==r.Binding.ParentIntakeId+"."+r.Binding.LineNumber.ToString(System.Globalization.CultureInfo.InvariantCulture)&&r.Assembly.Quantity>0,
   "RFQ handoff identity could not be verified.");
 }
 private async Task<SimLibraryRfqReceipt?> ReadRfqReceipt(string projectId)
 {
  var path=RfqProjectPath(projectId);if(!File.Exists(path))return null;
  var receipt=JsonSerializer.Deserialize<SimLibraryRfqReceipt>(await File.ReadAllTextAsync(path),jsonOptions)??throw new IOException("RFQ receipt is unavailable.");
  VerifyRfqReceipt(receipt,projectId);return receipt;
 }
 private async Task<SimLibraryRfqReceipt[]> ReadRfqReceipts()
 {
  if(!Directory.Exists(RfqProjectRoot))return [];
  var rows=new List<SimLibraryRfqReceipt>();
  foreach(var path in Directory.EnumerateFiles(RfqProjectRoot,"*.json")){
   var id=Path.GetFileNameWithoutExtension(path);var receipt=await ReadRfqReceipt(id);if(receipt is not null)rows.Add(receipt);
  }
  RfqProjectRequire(rows.Select(r=>r.Binding.DisplayId).Distinct().Count()==rows.Count,"Duplicate RFQ display identities require review.");
  return rows.ToArray();
 }
 private async Task WriteRfqReceipt(SimLibraryRfqReceipt receipt)
 {
  VerifyRfqReceipt(receipt);Directory.CreateDirectory(RfqProjectRoot);var path=RfqProjectPath(receipt.Binding.ProjectId);
  var temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
  try{
   await File.WriteAllTextAsync(temporary,JsonSerializer.Serialize(receipt,jsonOptions));
   var check=JsonSerializer.Deserialize<SimLibraryRfqReceipt>(await File.ReadAllTextAsync(temporary),jsonOptions)??throw new IOException("RFQ receipt verification failed.");
   VerifyRfqReceipt(check,receipt.Binding.ProjectId);
   BeforeRfqReceiptCommit?.Invoke();
   File.Move(temporary,path,false);
  }finally{if(File.Exists(temporary))File.Delete(temporary);}
 }
 // RFQ-only resolvers. Never append projected children to the shared Intake dataset.
 private async Task<(SimRfqIntakeRecord[] Records,object[] Unavailable)> RfqEntries()
 {
  var dataset=await ReadDatasetAsync();var rows=dataset.Records.Where(RfqEligible).ToList();var unavailable=new List<object>();
  foreach(var path in Directory.Exists(RfqProjectRoot)?Directory.EnumerateFiles(RfqProjectRoot,"*.json"):[]){
   var projectId=Path.GetFileNameWithoutExtension(path);
   var owners=dataset.Records.Where(r=>r.QuoteComposition is not null).SelectMany(r=>r.Assemblies.Select(a=>new{Record=r,Assembly=a})).Where(x=>x.Assembly.ProjectId==projectId).ToArray();var owner=owners.FirstOrDefault();
   try{
    var receipt=await ReadRfqReceipt(projectId)??throw new IOException("RFQ receipt is unavailable.");
    RfqProjectRequire(owners.Length==1,"The RFQ request association could not be verified.");
    RfqProjectRequire(LibraryRfqPackageRead is not null,"Approved-package access is not available.");
    RfqProjectRequire(!dataset.Records.Any(r=>r.IntakeId==receipt.Binding.DisplayId||r.IntakeId==receipt.Binding.ParentIntakeId&&RfqEligible(r))&&!rows.Any(r=>r.IntakeId==receipt.Binding.DisplayId),"A legacy RFQ conflicts with this independent project.");
    var effective=await EffectiveRfqReceipt(receipt);
    rows.Add(BuildLibraryRfqRecord(effective,await LibraryRfqPackageRead!(effective.Binding)));
   }catch(Exception e)when(e is IOException or UnauthorizedAccessException or JsonException or SimRfqIntakeProblem){
    unavailable.Add(new{projectId,displayId=owner is null?"Unavailable project":SimAssemblyProjects.Label(owner.Record.IntakeId,owner.Assembly),parentIntakeId=owner?.Record.IntakeId,message="Approved package unavailable. Contact Technical Review to check the saved handoff; other projects remain available."});
   }
  }
  return(rows.OrderBy(r=>r.LibraryRfq?.ParentIntakeId??r.IntakeId,StringComparer.Ordinal).ThenBy(r=>r.LibraryRfq?.LineNumber??0).ToArray(),unavailable.ToArray());
 }
 private async Task<SimRfqIntakeRecord[]> RfqRecords()=>(await RfqEntries()).Records;
 private async Task<SimLibraryRfqReceipt?> RfqReceiptByDisplay(string id)
 {
  var dataset=await ReadDatasetAsync();var owner=dataset.Records.Where(r=>r.QuoteComposition is not null).SelectMany(r=>r.Assemblies.Select(a=>new{Record=r,Assembly=a})).SingleOrDefault(x=>SimAssemblyProjects.Label(x.Record.IntakeId,x.Assembly)==id);
  if(owner?.Assembly.ProjectId is null)return null;
  var receipt=await ReadRfqReceipt(owner.Assembly.ProjectId);
  if(receipt is not null)RfqProjectRequire(receipt.Binding.DisplayId==id&&receipt.Binding.ParentIntakeId==owner.Record.IntakeId,"The RFQ request identity differs.");
  return receipt;
 }
 private async Task<SimRfqIntakeRecord> RequireRfqRecord(string id)
 {
  var dataset=await ReadDatasetAsync();var legacy=dataset.Records.SingleOrDefault(r=>r.IntakeId==id&&RfqEligible(r));if(legacy is not null)return legacy;
  var receipt=await RfqReceiptByDisplay(id)??throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY","Qualified RFQ project not found.");
  RfqProjectRequire(LibraryRfqPackageRead is not null&&!dataset.Records.Any(r=>r.IntakeId==id||r.IntakeId==receipt.Binding.ParentIntakeId&&RfqEligible(r)),"A legacy RFQ conflicts with this independent project.");
  var effective=await EffectiveRfqReceipt(receipt);
  return BuildLibraryRfqRecord(effective,await LibraryRfqPackageRead!(effective.Binding));
 }
 internal async Task<object> ReadRfqQueue(){await gate.WaitAsync();try{var entries=await RfqEntries();var lanes=await ReadRfqLanes();return new{items=entries.Records.Select(r=>RfqView(r,lanes)).ToArray(),unavailableItems=entries.Unavailable,rfqProjectHandoff=LibraryRfqPackageRead is not null};}finally{gate.Release();}}
 private static bool ReceiptMatchesFinal(SimLibraryRfqReceipt? receipt,LibraryFinalReview? review)=>receipt is not null&&review is not null&&review.Status=="APPROVED"&&receipt.Binding.PackageId==review.PackageId&&receipt.Binding.PackageHash==review.ContentHash&&receipt.Binding.ProjectId==review.ProjectId&&receipt.Binding.PreparationId==review.PreparationId;
 private async Task<(SimRfqIntakeRecord Parent,SimRfqIntakeAssembly Assembly,LibraryPreparation Preparation)> RfqHandoffContext(string intakeId,int lineNumber)
 {
  RfqProjectRequire(LibraryRfqSource is not null&&LibraryRfqPackageRead is not null&&LibraryRfqFileRead is not null&&PreparationLookup is not null,"Approved-package RFQ handoff is not available.");
  var dataset=await ReadDatasetAsync();var parent=dataset.Records.SingleOrDefault(r=>r.IntakeId==intakeId&&r.Environment=="SIM"&&r.IntakeType=="NEW_QUOTE_REQUEST"&&r.QuoteComposition is not null);
  RfqProjectRequire(parent is not null&&parent.Status is not("NO_LONGER_REQUIRED" or "READY_FOR_RFQ_WORKING_QUEUE"),"Choose an open independent assembly request.");
  var assembly=parent!.Assemblies.SingleOrDefault(a=>a.LineNumber==lineNumber);
  RfqProjectRequire(assembly?.ProjectId is not null,"Choose a saved independent assembly project.");
  _=RfqProjectPath(assembly!.ProjectId!);
  var preparation=await PreparationLookup!(intakeId,lineNumber);
  RfqProjectRequire(preparation is not null&&preparation.ProjectId==assembly.ProjectId&&preparation.IntakeId==parent.IntakeId&&preparation.LineNumber==lineNumber&&preparation.AssemblyNumber==assembly.AssemblyNumber&&preparation.IncomingRevision==assembly.Revision&&preparation.RequestedQuantity==assembly.Quantity&&preparation.RequestedScope==(assembly.Scope??parent.DeLeonScope)&&preparation.LibraryKey is not null,
   "The preparation request does not match this assembly line. Reopen the request.");
  var scoped=SimAssemblyProjects.Scope(new(parent.IntakeId,parent.RequestCorrelationId,parent.Customer,parent.Assemblies,parent.TechnicalFiles,parent.Status),lineNumber);
  RfqProjectRequire(preparation!.SourceFingerprint==SimLibraryBomStore.Hash(JsonSerializer.SerializeToUtf8Bytes(scoped,SimLibraryBomStore.Json)),"Incoming request files or customer context changed. Review that change before handing off.");
  var display=SimAssemblyProjects.Label(parent.IntakeId,assembly);
  var lanes=await ReadRfqLanes();
  RfqProjectRequire(!lanes.ContainsKey(parent.IntakeId)&&!dataset.Records.Any(r=>r.IntakeId==display),"A legacy parent/project RFQ already exists. Resolve that conflict before handing off.");
  if(lanes.ContainsKey(display))RfqProjectRequire(await ReadRfqReceipt(assembly.ProjectId!) is not null,"This RFQ has costing data without a verified package receipt. No data was replaced.");
  return(parent,assembly,preparation!);
 }
 private static LibraryPackageDocument[] RfqGoverningChoices(LibraryPackageVersion package)=>package.Documents.Where(d=>d.Identification.Use is "PRODUCTION" or "BOTH"&&d.Identification.Purposes.Contains("DRAWING")).ToArray();
 private string RfqHandoffToken(SimRfqIntakeRecord parent,SimRfqIntakeAssembly assembly,LibraryPreparation preparation,SimLibraryRfqSource source)=>SimLibraryBomStore.Hash(JsonSerializer.SerializeToUtf8Bytes(new{parent.IntakeId,parent.Customer,parent.RequestCorrelationId,parent.CustomerRequirements,parent.Status,assembly,preparation.Id,preparation.Revision,source.PackageToken,source.Package.ContentHash},jsonOptions));
 internal async Task<object> PreviewRfqHandoff(string intakeId,int lineNumber,SimPersona persona)
 {
  RfqProjectPermission(persona);await gate.WaitAsync();try{
   var context=await RfqHandoffContext(intakeId,lineNumber);var existing=await ReadRfqReceipt(context.Assembly.ProjectId!);
   return await LibraryRfqSource!(context.Preparation,source=>{
    var binding=source.Package.Preparation!;var choices=RfqGoverningChoices(source.Package);
    var blockers=source.Blockers.ToList();
    if((context.Assembly.Scope??context.Parent.DeLeonScope)!="MATERIAL_ONLY"&&choices.Length==0)blockers.Add("Select an approved production drawing for Labor before handing off.");
    if(existing is not null&&existing.Binding.PackageId!=source.Package.Id)blockers.Add("This project already quotes another approved version. An explicit version change is required; existing work was retained.");
    var same=existing is not null&&existing.Binding.PackageId==source.Package.Id&&existing.Binding.PackageHash==source.Package.ContentHash;
    return Task.FromResult<object>(new{rfqProjectHandoff=true,intakeId,lineNumber,projectId=context.Assembly.ProjectId,displayId=SimAssemblyProjects.Label(intakeId,context.Assembly),packageId=source.Package.Id,packageVersion=source.Package.Version,packageHash=source.Package.ContentHash,
     token=RfqHandoffToken(context.Parent,context.Assembly,context.Preparation,source),canSend=persona.Can("technical_review.disposition")&&blockers.Count==0&&!same,blockers=blockers.ToArray(),
     governingDocuments=choices.Select(d=>new{id=d.Identification.Id,name=Path.GetFileName(d.Identification.Source.RelativePath)}).ToArray(),governingDocumentId=choices.Length==1?choices[0].Identification.Id:null,receipt=existing?.Binding});
   });
  }finally{gate.Release();}
 }
 internal async Task<object> SendRfqHandoff(SimLibraryRfqHandoffCommand command,SimPersona persona)
 {
  RfqProjectPermission(persona,true);await gate.WaitAsync();try{
   var context=await RfqHandoffContext(command.IntakeId,command.LineNumber);var existing=await ReadRfqReceipt(context.Assembly.ProjectId!);
   if(existing is not null){
    RfqProjectRequire(existing.Binding.PackageId==command.PackageId,"This project already quotes a different approved version. Nothing was replaced.");
    RfqProjectRequire(command.GoverningDocumentId is null||command.GoverningDocumentId==existing.Binding.GoverningDocumentId,"This project already uses a different governing drawing. Nothing was replaced.");
    _=BuildLibraryRfqRecord(existing,await LibraryRfqPackageRead!(existing.Binding));
    return new{rfqProjectHandoff=true,received=true,duplicate=true,rfqId=existing.Binding.DisplayId,receipt=existing.Binding};
   }
   return await LibraryRfqSource!(context.Preparation,async source=>{
    RfqProjectRequire(source.Package.Id==command.PackageId&&command.ExpectedToken==RfqHandoffToken(context.Parent,context.Assembly,context.Preparation,source),"The approved package or request changed. Reopen Send to RFQs; nothing was sent.");
    RfqProjectRequire(source.Blockers.Length==0,string.Join(" ",source.Blockers));
    var scope=context.Assembly.Scope??context.Parent.DeLeonScope;var choices=RfqGoverningChoices(source.Package);
    var governing=command.GoverningDocumentId??(choices.Length==1?choices[0].Identification.Id:"");
    RfqProjectRequire(scope=="MATERIAL_ONLY"&&governing==""||choices.Any(d=>d.Identification.Id==governing),"Choose the approved production drawing for Labor.");
    var package=source.Package;var p=package.Preparation!;
    RfqProjectRequire(p.ProjectId==context.Assembly.ProjectId&&p.RequestedQuantity==context.Assembly.Quantity&&p.RequestedScope==scope,"Approved package quantity or scope differs from the request.");
    var binding=new SimLibraryRfqBinding(context.Assembly.ProjectId!,context.Parent.IntakeId,context.Assembly.LineNumber,SimAssemblyProjects.Label(context.Parent.IntakeId,context.Assembly),context.Preparation.LibraryKey!,package.Id,package.Version,package.ContentHash,context.Preparation.Id,package.Bom.Id,package.Bom.InternalVersion,governing);
    var receipt=new SimLibraryRfqReceipt("LIBRARY_RFQ_PROJECT_V1",binding,context.Parent.Customer,context.Assembly,context.Parent.RequestCorrelationId,context.Parent.CustomerRequirements,context.Parent.CreatedBy,context.Parent.CreatedAtUtc,context.Parent.ScenarioId,context.Parent.Generation,scope,persona.DisplayName,DateTimeOffset.UtcNow,"");
    receipt=receipt with{ContentHash=RfqReceiptHash(receipt)};
    _=BuildLibraryRfqRecord(receipt,package); // Reject unsupported mapping before the sole durable write.
    await WriteRfqReceipt(receipt);
    return new{rfqProjectHandoff=true,received=true,duplicate=false,rfqId=binding.DisplayId,receipt=binding};
   });
  }finally{gate.Release();}
 }
 private static bool RfqDepartmentAllows(LibraryPackageDocument doc,string department)=>department switch{"materials"=>doc.Identification.Use is "MATERIALS" or "BOTH","labor"=>doc.Identification.Use is "PRODUCTION" or "BOTH",_=>false};
 private async Task<(SimLibraryRfqReceipt Receipt,LibraryPackageVersion Package)> RfqDocumentContext(string id,string department)
 {
  RfqProjectRequire(department is "materials" or "labor","Choose Materials or Labor documents.");
  var receipt=await RfqReceiptByDisplay(id)??throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY","Approved RFQ project not found.");
  RfqProjectRequire(LibraryRfqPackageRead is not null&&LibraryRfqFileRead is not null,"Approved-package access is unavailable.");
  receipt=await EffectiveRfqReceipt(receipt);
  return(receipt,await LibraryRfqPackageRead!(receipt.Binding));
 }
 internal async Task<object> RfqProjectDocuments(string id,string department,SimPersona persona)
 {
  if(!persona.Can("rfq.view"))throw new LibraryBomPermissionException();await gate.WaitAsync();try{
   var context=await RfqDocumentContext(id,department);
   return new{libraryRfq=context.Receipt.Binding,department,items=context.Package.Documents.Where(d=>RfqDepartmentAllows(d,department)).Select(d=>new{id=d.Identification.Id,name=Path.GetFileName(d.Identification.Source.RelativePath),purposes=d.Identification.Purposes,use=d.Identification.Use,origin=d.Identification.Origin,sourceEvidence=d.Identification.Purposes.Any(p=>p is "VPRO5_TXT" or "VPRO5_BMM_PDF"),version=d.Identification.Version,sha256=d.EvidenceHash,size=d.Identification.Source.Size}).ToArray()};
  }finally{gate.Release();}
 }
 internal async Task<SimLibraryRfqFile> RfqProjectFile(string id,string documentId,string department,SimPersona persona)
 {
  if(!persona.Can("rfq.view"))throw new LibraryBomPermissionException();await gate.WaitAsync();try{
   var context=await RfqDocumentContext(id,department);
   RfqProjectRequire(context.Package.Documents.Any(d=>d.Identification.Id==documentId&&RfqDepartmentAllows(d,department)),"This file is not selected for this department's approved package.");
   return await LibraryRfqFileRead!(context.Receipt.Binding,documentId);
  }finally{gate.Release();}
 }
 // Internal estimator-only helper. Caller has already enforced the same RFQ role
 // and owns the Intake gate; no second gate acquisition or generic Intake fallback.
 private async Task<SimLibraryRfqFile> ReadRfqProjectFile(string id,string documentId,string department)
 {
  var context=await RfqDocumentContext(id,department);
  RfqProjectRequire(context.Package.Documents.Any(d=>d.Identification.Id==documentId&&RfqDepartmentAllows(d,department)),"This file is not selected for this department's approved package.");
  return await LibraryRfqFileRead!(context.Receipt.Binding,documentId);
 }
}

internal static partial class SimRfqIntakeEndpoints
{
 private static void MapLibraryRfqProjects(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
 {
  async Task<IResult> Run(HttpContext c,bool write,Func<SimPersona,Task<object>> action,bool rfqRead=false){
   var denied=DeniedTechnicalReview(c,state,personas,rfqRead?"rfq.view":write?"technical_review.disposition":"technical_review.view");if(denied is not null)return denied;
   c.Response.Headers.CacheControl="private, no-store";
   try{return Results.Json(await action(personas.Resolve(c)));}
   catch(LibraryBomPermissionException e){return Results.Json(new{message=e.Message},statusCode:403);}
   catch(SimRfqIntakeProblem e){return Results.Json(new{message=e.Message,code=e.Code},statusCode:e.StatusCode);}
   catch(Exception e)when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or JsonException){return Results.Json(new{message="The saved RFQ package could not be verified. Reopen to check whether the handoff completed before retrying."},statusCode:503);}
  }
  app.MapGet("/api/sim/technical-review/rfq-handoff",(string intakeId,int lineNumber,HttpContext c)=>Run(c,false,p=>store.PreviewRfqHandoff(intakeId,lineNumber,p)));
  app.MapPost("/api/sim/technical-review/rfq-handoff",(SimLibraryRfqHandoffCommand command,HttpContext c)=>Run(c,true,p=>store.SendRfqHandoff(command,p)));
  app.MapGet("/api/sim/rfqs/{id}/documents",(string id,string department,HttpContext c)=>Run(c,false,p=>store.RfqProjectDocuments(id,department,p),rfqRead:true));
  app.MapGet("/api/sim/rfqs/{id}/documents/{documentId}",(string id,string documentId,string department,HttpContext c)=>Run(c,false,async p=>{var file=await store.RfqProjectFile(id,documentId,department,p);return new{name=file.Name,type=file.Type,base64=Convert.ToBase64String(file.Bytes)};},rfqRead:true));
 }
}
