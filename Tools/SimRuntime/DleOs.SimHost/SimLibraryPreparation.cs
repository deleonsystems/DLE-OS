using System.Text.Json;


using System.Text;


internal sealed record PreparationIntake(string IntakeId,string CorrelationId,SimRfqIntakeCustomer Customer,SimRfqIntakeAssembly[] Assemblies,SimRfqIntakeDocument[] Files,string Status,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? ProjectId=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? DisplayId=null);


internal sealed record PreparationFile(string DocumentId,string Name,string Sha256,long Size);


internal sealed record PreparationEvent(string Action,string Notes,LibraryActor Actor,string? LibraryKey=null,PreparationFile[]? Files=null,string? SourceFingerprint=null,string? DrawingRevision=null,string? BomRevision=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string[]? Tasks=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimAssemblyHeader? HistoricalMatch=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] PreparationDispositionAudit? Disposition=null);


// Shared request/assembly preparation identity. Not an approved package or an RFQ output.


internal sealed record LibraryPreparation(string Id,int Revision,string IntakeId,string CorrelationId,int LineNumber,string CustomerId,string AssemblyNumber,string IncomingRevision,string Status,string? LibraryKey,string DrawingRevision,string BomRevision,string Work,string SourceFingerprint,PreparationFile[] Files,PreparationEvent[] History,string[] Promoted,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? ProjectId=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? DisplayId=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] int? RequestedQuantity=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? RequestedScope=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string[]? Tasks=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimAssemblyHeader? HistoricalMatch=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] PreparationFileDisposition[]? FileDispositions=null);


internal sealed record PreparationCommand(string IntakeId,int LineNumber,string Token,string SourceFingerprint,string Action,string? LibraryKey,string DrawingRevision,string BomRevision,string Work,string[] DocumentIds,string[]? Tasks=null,string? HistoricalLibraryKey=null);


internal sealed record PreparationWorkCommand(string Id,string Token,string Action,string? DocumentId=null,string? Destination=null,string? LibraryKey=null,string? DrawingRevision=null,string? BomRevision=null);


internal sealed partial class SimLibraryPreparation(string stateRoot,Func<SimAssemblyHeader[]> preliminary,Func<string,Task<PreparationIntake>> intake,Func<string,string,Task<(SimRfqIntakeDocument Document,byte[] Bytes)>> open)


{


 private readonly string root=Path.Combine(stateRoot,"library-preparation-v1");private readonly SemaphoreSlim gate=new(1,1);

 internal Func<LibraryPreparation,Task<LibraryFinalReview?>>? FinalReviewLookup {get;set;}


 private static readonly JsonSerializerOptions Json=SimLibraryBomStore.Json;


 private static string Hash(object? value)=>SimLibraryBomStore.Hash(JsonSerializer.SerializeToUtf8Bytes(value,Json));


 private static void Require([System.Diagnostics.CodeAnalysis.DoesNotReturnIf(false)] bool b,string m){if(!b)throw SimRfqIntakeProblem.Conflict("LIBRARY_PREPARATION",m);}


 private static void Permit(SimPersona p,bool library,bool write=false){if(!p.IsActive||!p.Can(library?"assembly_library.view":"technical_review.view")||(write&&!p.Can(library?"assembly_library.edit":"technical_review.disposition")))throw new LibraryBomPermissionException();}


 private static LibraryActor Actor(SimPersona p)=>new(p.Id,p.DisplayName,DateTimeOffset.UtcNow);


 private static string Id(PreparationIntake source,int line)=>source.ProjectId is null?Hash(new{intake=source.IntakeId,line}):Hash(new{intake=source.IntakeId,projectId=source.ProjectId});


 internal async Task<LibraryPreparation?> Find(string id,int line){var source=SimAssemblyProjects.Scope(await intake(id),line);return await Read(Id(source,line));}


 private string PathFor(string id){Require(id is not null&&id.Length==64&&id.All(Uri.IsHexDigit),"Invalid preparation identity.");return Path.Combine(root,id+".json");}


 private async Task<LibraryPreparation?> Read(string id){var path=PathFor(id);return File.Exists(path)?JsonSerializer.Deserialize<LibraryPreparation>(await File.ReadAllTextAsync(path),Json):null;}


 private async Task Write(LibraryPreparation record){Directory.CreateDirectory(root);var path=PathFor(record.Id);var temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";try{await File.WriteAllTextAsync(temp,JsonSerializer.Serialize(record,Json));Require(Hash(JsonSerializer.Deserialize<LibraryPreparation>(await File.ReadAllTextAsync(temp),Json)!)==Hash(record),"Preparation save verification failed.");File.Move(temp,path,true);}finally{if(File.Exists(temp))File.Delete(temp);}}


 internal SimAssemblyHeader[] Headers(){var added=new List<SimAssemblyHeader>();var dir=Path.Combine(root,"assemblies");if(Directory.Exists(dir))foreach(var path in Directory.EnumerateFiles(dir,"*.json")){var h=JsonSerializer.Deserialize<SimAssemblyHeader>(File.ReadAllText(path),Json)??throw new IOException("Library identity unavailable.");Require(h.ContractVersion=="LIBRARY_MANAGED_V1"&&h.SourceKeyRaw.StartsWith("LIBRARY:",StringComparison.Ordinal),"Managed Library identity invalid.");var recordPath=PathFor(h.SourceKeyRaw[8..]);if(File.Exists(recordPath)){var record=JsonSerializer.Deserialize<LibraryPreparation>(File.ReadAllText(recordPath),Json);if(record?.LibraryKey==h.SourceKeyRaw&&record.Status=="IN_PREPARATION")added.Add(h);}}return [..preliminary(),..added];}


 private object View(LibraryPreparation r,PreparationIntake source,SimPersona p)=>new{structuredPreparation=true,simplePreparationTasks=true,libraryResolvesDestination=true,record=r,token=Hash(r),sourceFingerprint=Hash(source),source,canEdit=p.Can("technical_review.disposition"),canBrowseLibrary=p.Can("assembly_library.view"),headers=p.Can("assembly_library.view")?Headers():[]};


 internal async Task<object> Assessment(string id,int line,SimPersona p){Permit(p,false);await gate.WaitAsync();try{var source=SimAssemblyProjects.Scope(await intake(id),line);var a=source.Assemblies.SingleOrDefault(a=>a.LineNumber==line)??throw SimRfqIntakeProblem.BadRequest("PREPARATION_LINE","Choose an assembly line.");var r=await Read(Id(source,line))??new(Id(source,line),0,id,source.CorrelationId,line,source.Customer.CustomerId,a.AssemblyNumber,a.Revision,"AWAITING_ASSESSMENT",null,"","","",Hash(source),[],[],[],source.ProjectId,source.DisplayId,source.ProjectId is null?null:a.Quantity,source.ProjectId is null?null:a.Scope);return View(r,source,p);}finally{gate.Release();}}


 internal async Task<object> Assess(PreparationCommand c,SimPersona p){Permit(p,false,true);await gate.WaitAsync();try{var source=SimAssemblyProjects.Scope(await intake(c.IntakeId),c.LineNumber);Require(source.Status is not("NO_LONGER_REQUIRED" or "READY_FOR_RFQ_WORKING_QUEUE"),"This request is no longer open for initial assessment.");var a=source.Assemblies.SingleOrDefault(a=>a.LineNumber==c.LineNumber)??throw SimRfqIntakeProblem.BadRequest("PREPARATION_LINE","Choose an assembly line.");var id=Id(source,c.LineNumber);var r=await Read(id)??new(id,0,c.IntakeId,source.CorrelationId,c.LineNumber,source.Customer.CustomerId,a.AssemblyNumber,a.Revision,"AWAITING_ASSESSMENT",null,"","","",Hash(source),[],[],[],source.ProjectId,source.DisplayId,source.ProjectId is null?null:a.Quantity,source.ProjectId is null?null:a.Scope);


  Require(Hash(r)==c.Token&&Hash(source)==c.SourceFingerprint,"The request or assessment changed. Reopen before saving.");Require(r.Status!="IN_PREPARATION","Library preparation has started; coordinate changes with the Library author.");Require(c.Action is "SAVE" or "SEND" or "REQUEST_INFORMATION","Unsupported assessment action.");Require(c.Work is not null&&c.Work.Length<=4000&&c.DrawingRevision is not null&&c.BomRevision is not null&&c.DrawingRevision.Length<=100&&c.BomRevision.Length<=100,"Assessment fields are invalid.");Require(c.DocumentIds is not null&&c.DocumentIds.Length<=100&&c.DocumentIds.Distinct().Count()==c.DocumentIds.Length,"Choose unique incoming files.");


  var tasks=c.Tasks??r.Tasks;Require(tasks is null||(tasks.Length<=5&&tasks.Distinct().Count()==tasks.Length&&tasks.All(t=>t is "BUILD_BOM" or "CHECK_FILES" or "RESOLVE_REVISION" or "IDENTIFY_FILES" or "COMPARE_FILES")),"Choose supported preparation tasks.");


  var historical=r.HistoricalMatch;if(c.Tasks is not null){historical=null;if(!string.IsNullOrEmpty(c.HistoricalLibraryKey)){Permit(p,true);historical=Headers().SingleOrDefault(h=>h.SourceKeyRaw==c.HistoricalLibraryKey);Require(historical is not null,"Historical Library match is unavailable. Search again.");}}


  // Initial review preserves prior destination context; only Library may resolve it.
  c=c with{LibraryKey=r.LibraryKey,DrawingRevision=r.DrawingRevision,BomRevision=r.BomRevision};
  SimAssemblyHeader? target=null;if(!string.IsNullOrEmpty(c.LibraryKey)){Permit(p,true);target=Headers().SingleOrDefault(h=>h.SourceKeyRaw==c.LibraryKey);Require(target is not null,"Choose an existing Library identity.");Require(c.DrawingRevision==target.DrawingRevision.TrimEnd()&&c.BomRevision==target.BomRevision.TrimEnd(),"Selected Library revision context changed. Select the assembly again.");}


  if(c.Action=="SEND")Require(!string.IsNullOrWhiteSpace(c.Work)||tasks is {Length:>0},"Choose preparation tasks or add a note.");if(c.Action=="REQUEST_INFORMATION")Require(!string.IsNullOrWhiteSpace(c.Work),"Describe the missing information in Notes.");


  var files=new List<PreparationFile>();foreach(var docId in c.DocumentIds!){var doc=source.Files.SingleOrDefault(f=>f.DocumentId==docId);Require(doc is not null&&doc.BinaryStatus=="VERIFIED","Choose a verified file from this intake.");var read=await open(c.IntakeId,docId);Require(read.Document.DocumentId==docId&&read.Document.Name==doc!.Name,"Incoming file identity changed.");files.Add(new(docId,doc!.Name,SimLibraryBomStore.Hash(read.Bytes),read.Bytes.LongLength));}


  var status=c.Action=="SEND"?"NEEDS_PREPARATION":c.Action=="REQUEST_INFORMATION"?"WAITING_FOR_INFORMATION":"ASSESSMENT_DRAFT";


  // Repeated identical routing is idempotent; no duplicate queue item or assembly creation.


  if(r.Status==status&&r.LibraryKey==c.LibraryKey&&r.Work==c.Work&&r.DrawingRevision==c.DrawingRevision&&r.BomRevision==c.BomRevision&&Hash(r.Files)==Hash(files)&&Hash(r.Tasks)==Hash(tasks)&&Hash(r.HistoricalMatch)==Hash(historical))return View(r,source,p);


  r=r with{Revision=r.Revision+1,Status=status,Tasks=tasks,HistoricalMatch=historical,RequestedQuantity=source.ProjectId is null?null:a.Quantity,RequestedScope=source.ProjectId is null?null:a.Scope,LibraryKey=string.IsNullOrEmpty(c.LibraryKey)?null:c.LibraryKey,DrawingRevision=c.DrawingRevision,BomRevision=c.BomRevision,Work=c.Work,SourceFingerprint=Hash(source),Files=files.ToArray(),FileDispositions=RetainedDispositions(r,files),History=[..r.History,new(c.Action,c.Work,Actor(p),c.LibraryKey,files.ToArray(),Hash(source),c.DrawingRevision,c.BomRevision,tasks,historical)]};await Write(r);return View(r,source,p);


 }finally{gate.Release();}}


 internal async Task<object> Queue(SimPersona p){Permit(p,true);await gate.WaitAsync();try{var items=new List<object>();if(Directory.Exists(root))foreach(var path in Directory.EnumerateFiles(root,"*.json")){var r=JsonSerializer.Deserialize<LibraryPreparation>(await File.ReadAllTextAsync(path),Json)!;if(r.Status is "NEEDS_PREPARATION" or "IN_PREPARATION"){var finalReview=FinalReviewLookup is null?null:await FinalReviewLookup(r);items.Add(new{record=r,token=Hash(r),finalReview,displayStatus=finalReview?.Status??r.Status,displayStatusLabel=finalReview?.StatusLabel??(r.Status=="IN_PREPARATION"?"In preparation":"Needs preparation")});}}return new{items,headers=Headers(),libraryResolvesDestination=true,canEdit=p.Can("assembly_library.edit"),finalReviewRoundtrip=FinalReviewLookup is not null};}finally{gate.Release();}}


 internal async Task<object> Work(PreparationWorkCommand c,SimPersona p){Permit(p,true,true);await gate.WaitAsync();try{var r=await Read(c.Id)??throw new IOException("Preparation item not found.");Require(Hash(r)==c.Token,"Preparation changed. Reopen before continuing.");Require(r.Status is "NEEDS_PREPARATION" or "IN_PREPARATION","This item is not ready for Library preparation.");Require(c.Action is "START" or "PROMOTE","Unsupported preparation action.");


  if(c.Action=="START"&&r.Status!="IN_PREPARATION")Require(Hash(SimAssemblyProjects.Scope(await intake(r.IntakeId),r.LineNumber))==r.SourceFingerprint,"The intake changed since routing. Return to Technical Review for reassessment.");


  if(c.Action=="START"&&r.Status=="IN_PREPARATION")return new{record=r,token=Hash(r)};


  if(c.Action=="START"){
   Require(c.Destination is "existing" or "new","Choose the Library destination before starting preparation.");
   Require(c.DrawingRevision is not null&&c.BomRevision is not null&&c.DrawingRevision.Length<=100&&c.BomRevision.Length<=100,"Enter the intended revision context; unknown BOM revision may remain blank.");
   if(c.Destination=="existing"){
    var selected=Headers().SingleOrDefault(h=>h.SourceKeyRaw==c.LibraryKey);
    Require(selected is not null,"Choose an available Library assembly.");
    Require(selected.BillNumber.TrimEnd()==r.AssemblyNumber,"Choose the same assembly number; cross-assembly mapping is not supported.");
    Require(selected.DrawingRevision.TrimEnd()==c.DrawingRevision&&selected.BomRevision.TrimEnd()==c.BomRevision,"Library revisions changed. Reopen the preparation item.");
    r=r with{LibraryKey=selected.SourceKeyRaw,DrawingRevision=c.DrawingRevision,BomRevision=c.BomRevision};
   }else{Require(string.IsNullOrEmpty(c.LibraryKey),"A new revision must not reuse an existing Library key.");r=r with{LibraryKey=null,DrawingRevision=c.DrawingRevision,BomRevision=c.BomRevision};}
  }

  if(c.Action=="PROMOTE"){Require(r.Status=="IN_PREPARATION","Start preparation first.");var f=r.Files.SingleOrDefault(f=>f.DocumentId==c.DocumentId);Require(f is not null,"Choose a routed file.");Require(!IsHandled(r,f!),"This file has been handled. Reopen it in the incoming package before saving an OS copy.");var read=await open(r.IntakeId,f!.DocumentId);Require(SimLibraryBomStore.Hash(read.Bytes)==f.Sha256&&read.Bytes.LongLength==f.Size,"Incoming evidence changed. Original reference retained; no promotion saved.");var dir=Path.Combine(root,"evidence");Directory.CreateDirectory(dir);var path=Path.Combine(dir,f.Sha256);if(File.Exists(path))Require(SimLibraryBomStore.Hash(await File.ReadAllBytesAsync(path))==f.Sha256,"Promoted copy verification failed.");else{var tmp=path+"."+Guid.NewGuid().ToString("N")+".tmp";try{await File.WriteAllBytesAsync(tmp,read.Bytes);Require(SimLibraryBomStore.Hash(await File.ReadAllBytesAsync(tmp))==f.Sha256,"Promotion verification failed.");File.Move(tmp,path);}finally{if(File.Exists(tmp))File.Delete(tmp);}}if(r.Promoted.Contains(f.DocumentId))return new{record=r,token=Hash(r)};r=r with{Promoted=[..r.Promoted,f.DocumentId]};}


  else if(r.LibraryKey is null){var key="LIBRARY:"+r.Id;var h=new SimAssemblyHeader(key,Hash(new{r.Id,r.AssemblyNumber,r.DrawingRevision,r.BomRevision}),"LIBRARY_MANAGED_V1",r.AssemblyNumber,"",r.DrawingRevision,"",r.BomRevision,false);var dir=Path.Combine(root,"assemblies");Directory.CreateDirectory(dir);var path=Path.Combine(dir,r.Id+".json");if(File.Exists(path))Require(Hash(JsonSerializer.Deserialize<SimAssemblyHeader>(await File.ReadAllTextAsync(path),Json)!)==Hash(h),"Existing managed identity differs; no overwrite.");else{var tmp=path+"."+Guid.NewGuid().ToString("N")+".tmp";try{await File.WriteAllTextAsync(tmp,JsonSerializer.Serialize(h,Json));Require(Hash(JsonSerializer.Deserialize<SimAssemblyHeader>(await File.ReadAllTextAsync(tmp),Json)!)==Hash(h),"Managed identity verification failed.");File.Move(tmp,path);}finally{if(File.Exists(tmp))File.Delete(tmp);}}r=r with{LibraryKey=key};}


  else Require(Headers().Any(h=>h.SourceKeyRaw==r.LibraryKey&&h.DrawingRevision.TrimEnd()==r.DrawingRevision&&h.BomRevision.TrimEnd()==r.BomRevision),"Library identity or revision context changed. Return for reassessment.");


  r=r with{Revision=r.Revision+1,Status="IN_PREPARATION",History=[..r.History,new(c.Action,c.Action=="START"?"Library destination: "+c.Destination:c.DocumentId??"",Actor(p),r.LibraryKey,DrawingRevision:r.DrawingRevision,BomRevision:r.BomRevision)]};await Write(r);return new{record=r,token=Hash(r)};


 }finally{gate.Release();}}


 internal async Task<object> IncomingEvidence(string intakeId,string documentId,SimPersona p){Permit(p,false);var source=await intake(intakeId);Require(source.Files.Any(f=>f.DocumentId==documentId&&f.BinaryStatus=="VERIFIED"),"Choose a verified incoming file.");var file=await open(intakeId,documentId);return new{name=file.Document.Name,base64=Convert.ToBase64String(file.Bytes)};}


 internal async Task<object> Evidence(string id,string documentId,SimPersona p){Permit(p,true);await gate.WaitAsync();try{var r=await Read(id)??throw new IOException("Preparation not found.");Require(r.Status is "NEEDS_PREPARATION" or "IN_PREPARATION","File is not routed to Library.");var f=r.Files.SingleOrDefault(f=>f.DocumentId==documentId);Require(f is not null,"File does not belong to this package.");var bytes=r.Promoted.Contains(documentId)?await File.ReadAllBytesAsync(Path.Combine(root,"evidence",f!.Sha256)):(await open(r.IntakeId,documentId)).Bytes;Require(SimLibraryBomStore.Hash(bytes)==f!.Sha256,"Evidence changed or unavailable.");return new{name=f.Name,base64=Convert.ToBase64String(bytes),promoted=r.Promoted.Contains(documentId)};}finally{gate.Release();}}


}


internal sealed partial class SimRfqIntakeStore


{


 internal Func<string,int,Task<LibraryPreparation?>>? PreparationLookup {get;set;}

 internal Func<LibraryPreparation,Task<LibraryFinalReview?>>? PreparationFinalReviewLookup {get;set;}


 internal async Task<PreparationIntake> PreparationSource(string id){var r=(await ReadDatasetAsync()).Records.SingleOrDefault(r=>r.IntakeId==id&&r.Environment=="SIM"&&r.IntakeType=="NEW_QUOTE_REQUEST")??throw SimRfqIntakeProblem.NotFound("PREPARATION_INTAKE","Quotation intake not found.");return new(r.IntakeId,r.RequestCorrelationId,r.Customer,r.Assemblies,r.TechnicalFiles,r.Status);}


}


