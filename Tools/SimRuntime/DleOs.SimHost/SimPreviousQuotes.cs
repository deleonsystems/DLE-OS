using System.Text.Json;

// A reference to an explicitly selected workbook, not imported prices or approved evidence.
internal sealed record SimPreviousQuoteSelection(int Version,string Name,string Path,SimLinkedSource Source,string FolderToken,string SelectedBy,DateTimeOffset SelectedAtUtc);
internal sealed record SimPreviousQuoteRecord(int ContractVersion,SimLibraryRfqBinding Binding,string ScenarioId,long Generation,string Department,SimPreviousQuoteSelection[] History,string ContentHash);
internal sealed record SimPreviousQuoteCommand(string Department,string ExpectedToken,string FolderToken,string Path,string SourceToken);
internal sealed record SimPreviousQuoteEntry(string Name,string Path,bool IsDirectory,bool Selectable,long? Size,DateTimeOffset? ModifiedUtc);
internal sealed record SimPreviousQuoteFolder(string Address,string Assembly,string DrawingRevision,string BomRevision);
internal sealed record SimPreviousQuoteView(int ContractVersion,string Department,bool Available,string? UnavailableReason,bool CanSelect,SimPreviousQuoteFolder? Folder,string FolderToken,string Path,SimPreviousQuoteEntry[] Entries,bool Truncated,string SelectionToken,SimPreviousQuoteSelection? Selection,bool SelectionCurrent,string? SelectionIssue,int OpenWorksheetContractVersion=1);
internal sealed record SimPreviousQuoteSaved(SimPreviousQuoteSelection Selection,string SelectionToken,bool SelectionCurrent=true,string? SelectionIssue=null);
internal sealed record SimPreviousQuoteDescription(string Name,string Path,SimLinkedSource Source,string FolderToken);
internal sealed record SimPreviousQuoteDownload(string Name,string Type,byte[] Bytes);
internal sealed record SimPreviousQuoteFolderContext(SimDrawingFolders? Sources,LibraryFolderLink? Link,string QuoteRoot,string FolderToken,string Address,string? UnavailableReason);

internal sealed partial class SimLibraryBomStore
{
 // RFQ identity is supplied by the verified receipt, never by a browser-provided Library key.
 // Lock order matches the existing RFQ adapter: Intake -> Library. The callback must not reenter Intake.
 internal async Task<object> WithPreviousQuoteFolder(SimLibraryRfqBinding binding,SimPersona persona,Func<SimPreviousQuoteFolderContext,Task<object>> action)
 {
  if(!persona.Can("rfq.view"))throw new LibraryBomPermissionException();_=await ReadRfqPackage(binding);await gate.WaitAsync();try{
   var package=ReadPackages(binding.LibraryKey).Versions.Single(v=>v.Id==binding.PackageId);VerifyPackage(package);
   var folders=await ReadFolder(binding.LibraryKey);var link=folders.Current;
   SimPreviousQuoteFolderContext unavailable(string reason)=>new(null,link,"","","",reason);
   if(link is null)return await action(unavailable("Link this assembly's revision folder in Assembly Library first."));
   var context=await FolderContext(binding.LibraryKey);
   if(link.AssemblyNumber!=package.Bom.AssemblyNumber||link.DrawingRevision!=package.Bom.DrawingRevision||link.BomRevision!=package.Bom.BomRevision||link.DrawingRevision!=context.Drawing||link.BomRevision!=context.Bom)
    return await action(unavailable("The linked folder belongs to a different assembly revision. Check the Assembly Library folder link."));
   var sources=Sources();
   SimPreviousQuoteFolderContext selected;
   try{
    Require(link.RelativePath.Length>0,"Choose an assembly revision folder in Assembly Library first.");
    var quoteRoot=SimDrawingFolders.Normalize(link.RelativePath+"/QUOTE");
    var resolved=sources.Resolve(link.RootId,quoteRoot);
    var token=Hash(JsonSerializer.SerializeToUtf8Bytes(new{binding,folderToken=FolderToken(folders),resolved.Root.Path,quoteRoot},Json));
    selected=new(sources,link,quoteRoot,token,resolved.Path,null);
   }catch(Exception e)when(e is SimRfqIntakeProblem or IOException or UnauthorizedAccessException or System.Security.SecurityException){return await action(unavailable("The linked revision's QUOTE folder is missing or unavailable."));}
   return await action(selected);
  }finally{gate.Release();}
 }
}

internal sealed partial class SimRfqIntakeStore
{
 internal Func<SimLibraryRfqBinding,SimPersona,Func<SimPreviousQuoteFolderContext,Task<object>>,Task<object>>? PreviousQuotesAccess {get;set;}
 private string PreviousQuotesRoot=>Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(dataPath)!)!,"rfq-previous-quotes-v1");
 private static void PreviousQuoteRequire(bool ok,string message){if(!ok)throw SimRfqIntakeProblem.Conflict("PREVIOUS_QUOTE_CHANGED",message);}
   private static void PreviousQuotePermission(SimPersona persona,string department,bool write=false){if(!persona.Can(write?(department=="materials"?"rfq.materials.edit":"technical_review.disposition"):"rfq.view"))throw new LibraryBomPermissionException();}
private static void PreviousQuoteDepartment(string department){if(department is not("materials" or "labor"))throw SimRfqIntakeProblem.Conflict("PREVIOUS_QUOTE_SCOPE","Choose Materials or Labor.");}
 private static bool PreviousQuoteExcel(string path)=>!Path.GetFileName(path).StartsWith("~$",StringComparison.Ordinal)&&Path.GetExtension(path).ToLowerInvariant() is ".xls" or ".xlsx";
 private static string PreviousQuoteHash(SimPreviousQuoteRecord record)=>SimLibraryBomStore.Hash(JsonSerializer.SerializeToUtf8Bytes(record with{ContentHash=""},SimLibraryBomStore.Json));
 private string PreviousQuotePath(SimLibraryRfqBinding binding,string department){_ = RfqProjectPath(binding.ProjectId);PreviousQuoteDepartment(department);return Path.Combine(PreviousQuotesRoot,binding.ProjectId,department+".json");}
 private async Task<SimPreviousQuoteRecord> ReadPreviousQuote(SimRfqIntakeRecord rfq,string department)
 {
  var binding=rfq.LibraryRfq!;var path=PreviousQuotePath(binding,department);
  if(!File.Exists(path)){var empty=new SimPreviousQuoteRecord(1,binding,rfq.ScenarioId,rfq.Generation,department,[],"");return empty with{ContentHash=PreviousQuoteHash(empty)};}
  var record=JsonSerializer.Deserialize<SimPreviousQuoteRecord>(await File.ReadAllTextAsync(path),jsonOptions)??throw new IOException("Previous quote reference could not be read.");
  PreviousQuoteRequire(record.ContractVersion==1&&record.ContentHash==PreviousQuoteHash(record)&&record.Binding==binding&&record.ScenarioId==rfq.ScenarioId&&record.Generation==rfq.Generation&&record.Department==department,"The saved workbook belongs to a different quote version. Its reference was retained; review the project association.");
  PreviousQuoteRequire(record.History.Select((s,i)=>s.Version==i+1).All(v=>v),"Saved workbook history could not be verified.");
  return record;
 }
 private async Task WritePreviousQuote(SimPreviousQuoteRecord record)
 {
  PreviousQuoteRequire(record.ContentHash==PreviousQuoteHash(record),"Workbook reference verification failed.");var path=PreviousQuotePath(record.Binding,record.Department);Directory.CreateDirectory(Path.GetDirectoryName(path)!);var temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";
  try{await File.WriteAllTextAsync(temp,JsonSerializer.Serialize(record,jsonOptions));var check=JsonSerializer.Deserialize<SimPreviousQuoteRecord>(await File.ReadAllTextAsync(temp),jsonOptions);PreviousQuoteRequire(check is not null&&check.ContentHash==record.ContentHash&&PreviousQuoteHash(check)==record.ContentHash,"Workbook reference verification failed.");File.Move(temp,path,true);}finally{if(File.Exists(temp))File.Delete(temp);}
 }
 private static string PreviousQuoteRelative(string? path)=>SimDrawingFolders.Normalize(path??"");
 private static string PreviousQuoteFull(SimPreviousQuoteFolderContext c,string path)=>SimDrawingFolders.Normalize(c.QuoteRoot+(path.Length==0?"":"/"+path));
 private static async Task<SimLinkedFileRead> ReadPreviousQuoteFile(SimPreviousQuoteFolderContext c,string path)
 {
  PreviousQuoteRequire(c.UnavailableReason is null&&c.Link is not null&&c.Sources is not null,"The linked QUOTE folder is not available.");
  path=PreviousQuoteRelative(path);PreviousQuoteRequire(path.Length>0&&PreviousQuoteExcel(path),"Choose an Excel workbook (.xls or .xlsx).");
  var link=c.Link!;
  // Association itself is narrowed to QUOTE, not merely checked in the UI.
  var association=new SimDrawingFolderAssociation(link.Id,0,link.RootId,c.QuoteRoot,"QUOTE","",link.AssemblyNumber,link.BomRevision,link.Actor.Name,link.Actor.AtUtc);
  return await c.Sources!.ReadFile(association,PreviousQuoteFull(c,path),"LIBRARY_DOCUMENT");
 }
 private static async Task<(bool Current,string? Issue)> PreviousQuoteCurrent(SimPreviousQuoteFolderContext context,SimPreviousQuoteSelection? selection)
 {
  if(selection is null)return(false,null);
  if(context.UnavailableReason is not null)return(false,context.UnavailableReason+" The saved workbook reference is retained.");
  if(selection.FolderToken!=context.FolderToken)return(false,"The linked folder changed. The saved workbook reference is retained; select a file again only after checking it.");
  try{var file=await ReadPreviousQuoteFile(context,selection.Path);return file.Source.SourceToken==selection.Source.SourceToken?(true,null):(false,"The selected workbook changed since selection. Its earlier reference is retained; select it again to use the current file.");}
  catch(Exception e)when(e is SimRfqIntakeProblem or IOException or UnauthorizedAccessException or System.Security.SecurityException){return(false,"The selected workbook is missing or unavailable. Its saved reference is retained.");}
 }
 private async Task<SimRfqIntakeRecord> PreviousQuoteRfq(string id,string department,SimPersona persona,bool write=false)
 {
  PreviousQuotePermission(persona,department,write);PreviousQuoteDepartment(department);var rfq=await RequireRfqRecord(id);RequireRequestedRfqDepartment(rfq,department);return rfq;
 }
 internal async Task<SimPreviousQuoteView> PreviousQuotes(string id,string department,string? path,SimPersona persona)
 {
  PreviousQuotePermission(persona,department);PreviousQuoteDepartment(department);path=PreviousQuoteRelative(path);await gate.WaitAsync();try{
   var rfq=await PreviousQuoteRfq(id,department,persona);
   if(rfq.LibraryRfq is null||PreviousQuotesAccess is null)return new(1,department,false,"Previous Quotes requires an approved Assembly Library package and linked revision folder.",false,null,"",path,[],false,"",null,false,null);
   var record=await ReadPreviousQuote(rfq,department);var selection=record.History.LastOrDefault();
   return (SimPreviousQuoteView)await PreviousQuotesAccess(rfq.LibraryRfq,persona,async c=>{
    var status=await PreviousQuoteCurrent(c,selection);var entries=new List<SimPreviousQuoteEntry>();var truncated=false;var available=c.UnavailableReason is null;var reason=c.UnavailableReason;
    if(available){try{
     var full=PreviousQuoteFull(c,path);var listing=c.Sources!.Browse(c.Link!.RootId,full);truncated=listing.Truncated;var directory=c.Sources.Resolve(c.Link.RootId,full);
     foreach(var entry in listing.Entries){if(entry.Name.StartsWith("~$",StringComparison.Ordinal))continue;long? size=null;DateTimeOffset? modified=null;if(!entry.IsDirectory){var info=new FileInfo(Path.Combine(directory.Path,entry.Name));if((info.Attributes&FileAttributes.ReparsePoint)!=0)continue;size=info.Length;modified=info.LastWriteTimeUtc;}var relative=path.Length==0?entry.Name:path+"/"+entry.Name;entries.Add(new(entry.Name,relative,entry.IsDirectory,!entry.IsDirectory&&PreviousQuoteExcel(entry.Name),size,modified));}
    }catch(Exception e)when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or SimRfqIntakeProblem){available=false;reason="This QUOTE folder is missing or unavailable. Go back and try another folder.";entries.Clear();}}
    return new SimPreviousQuoteView(1,department,available,reason,available&&persona.Can(department=="materials"?"rfq.materials.edit":"technical_review.disposition"),c.Link is null?null:new(c.Address,c.Link.AssemblyNumber,c.Link.DrawingRevision,c.Link.BomRevision),c.FolderToken,path,entries.ToArray(),truncated,record.ContentHash,selection,status.Current,status.Issue);
   });
  }finally{gate.Release();}
 }
 internal async Task<SimPreviousQuoteDescription> DescribePreviousQuote(string id,string department,string folderToken,string path,SimPersona persona)
 {
  PreviousQuotePermission(persona,department);PreviousQuoteDepartment(department);path=PreviousQuoteRelative(path);await gate.WaitAsync();try{
   var rfq=await PreviousQuoteRfq(id,department,persona);PreviousQuoteRequire(rfq.LibraryRfq is not null&&PreviousQuotesAccess is not null,"Previous Quotes is not available for this RFQ.");
   return (SimPreviousQuoteDescription)await PreviousQuotesAccess!(rfq.LibraryRfq!,persona,async c=>{PreviousQuoteRequire(c.UnavailableReason is null&&c.FolderToken==folderToken,"The linked QUOTE folder changed. Reopen Previous Quotes.");var file=await ReadPreviousQuoteFile(c,path);return new SimPreviousQuoteDescription(file.Name,path,file.Source,c.FolderToken);});
  }finally{gate.Release();}
 }
 internal async Task<SimPreviousQuoteSaved> SelectPreviousQuote(string id,SimPreviousQuoteCommand command,SimPersona persona)
 {
  PreviousQuotePermission(persona,command.Department,true);PreviousQuoteDepartment(command.Department);var path=PreviousQuoteRelative(command.Path);await gate.WaitAsync();try{
   var rfq=await PreviousQuoteRfq(id,command.Department,persona,write:true);PreviousQuoteRequire(rfq.LibraryRfq is not null&&PreviousQuotesAccess is not null,"Previous Quotes is not available for this RFQ.");var record=await ReadPreviousQuote(rfq,command.Department);
   return (SimPreviousQuoteSaved)await PreviousQuotesAccess!(rfq.LibraryRfq!,persona,async c=>{
    PreviousQuoteRequire(c.UnavailableReason is null&&c.FolderToken==command.FolderToken,"The linked QUOTE folder changed. Nothing was selected; reopen Previous Quotes.");
    var file=await ReadPreviousQuoteFile(c,path);PreviousQuoteRequire(file.Source.SourceToken==command.SourceToken,"The workbook changed since selection. Nothing was saved; select it again after checking it.");
    var previous=record.History.LastOrDefault();
    // Exact repeat is idempotent even when the first response was lost. A different choice still requires its current token.
    if(previous is not null&&previous.Path==path&&previous.FolderToken==c.FolderToken&&previous.Source.SourceToken==file.Source.SourceToken)return new SimPreviousQuoteSaved(previous,record.ContentHash);
    PreviousQuoteRequire(command.ExpectedToken==record.ContentHash,"The selected workbook changed in another session. Your previous selection is retained; reopen Previous Quotes.");
    var selected=new SimPreviousQuoteSelection(record.History.Length+1,file.Name,path,file.Source,c.FolderToken,persona.DisplayName,DateTimeOffset.UtcNow);
    var next=record with{History=[..record.History,selected],ContentHash=""};next=next with{ContentHash=PreviousQuoteHash(next)};await WritePreviousQuote(next);return new SimPreviousQuoteSaved(selected,next.ContentHash);
   });
  }finally{gate.Release();}
 }
 internal async Task<SimPreviousQuoteDownload> OpenSelectedPreviousQuote(string id,string department,string selectionToken,SimPersona persona)
 {
  PreviousQuotePermission(persona,department);PreviousQuoteDepartment(department);
  if(string.IsNullOrWhiteSpace(selectionToken))throw SimRfqIntakeProblem.BadRequest("PREVIOUS_QUOTE_TOKEN","Reopen Previous Quotes before opening the selected workbook.");
  await gate.WaitAsync();try{
   var rfq=await PreviousQuoteRfq(id,department,persona);PreviousQuoteRequire(rfq.LibraryRfq is not null&&PreviousQuotesAccess is not null,"Previous Quotes is not available for this RFQ.");
   var record=await ReadPreviousQuote(rfq,department);PreviousQuoteRequire(record.ContentHash==selectionToken,"The workbook selection changed. Reopen Previous Quotes before opening it.");
   var selection=record.History.LastOrDefault();PreviousQuoteRequire(selection is not null,"Select a workbook for this department first.");
   return (SimPreviousQuoteDownload)await PreviousQuotesAccess!(rfq.LibraryRfq!,persona,async c=>{
    PreviousQuoteRequire(c.UnavailableReason is null&&c.FolderToken==selection!.FolderToken,"The linked QUOTE folder changed or is unavailable. The saved selection is retained; check it before opening.");
    // Use only the persisted selection. The browser cannot supply a file path or substitute another workbook.
    var file=await ReadPreviousQuoteFile(c,selection!.Path);
    PreviousQuoteRequire(file.Source.SourceToken==selection.Source.SourceToken&&file.Source.Sha256==selection.Source.Sha256&&file.Source.Size==selection.Source.Size&&file.Name==selection.Name,"The selected workbook changed. Nothing was downloaded; check it and explicitly select the current file if intended.");
    return new SimPreviousQuoteDownload(file.Name,Path.GetExtension(file.Name).Equals(".xls",StringComparison.OrdinalIgnoreCase)?"application/vnd.ms-excel":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",file.Bytes);
   });
  }finally{gate.Release();}
 }
}

internal static partial class SimRfqIntakeEndpoints
{
 internal static void MapPreviousQuotes(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
 {
  async Task<IResult> Run(HttpContext c,bool write,Func<SimPersona,Task<object>> action){c.Response.Headers.CacheControl="private, no-store";var denied=DeniedTechnicalReview(c,state,personas,write?"rfq.materials.edit":"rfq.view");if(denied is not null)return denied;try{var result=await action(personas.Resolve(c));return result is IResult response?response:Results.Json(result);}catch(LibraryBomPermissionException e){return Results.Json(new{message=e.Message},statusCode:403);}catch(SimRfqIntakeProblem e){return Results.Json(new{message=e.Message,code=e.Code},statusCode:e.StatusCode);}catch(Exception e)when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or JsonException){return Results.Json(new{message="Previous Quotes is unavailable. Saved selections and estimates are unchanged; reopen to check before retrying."},statusCode:503);}}
  app.MapGet("/api/sim/rfqs/{id}/previous-quotes",(string id,string department,string? path,HttpContext c)=>Run(c,false,async p=>await store.PreviousQuotes(id,department,path,p)));
  app.MapGet("/api/sim/rfqs/{id}/previous-quotes/describe",(string id,string department,string folderToken,string path,HttpContext c)=>Run(c,false,async p=>await store.DescribePreviousQuote(id,department,folderToken,path,p)));
  app.MapPut("/api/sim/rfqs/{id}/previous-quotes/selection",(string id,SimPreviousQuoteCommand command,HttpContext c)=>Run(c,true,async p=>await store.SelectPreviousQuote(id,command,p)));
  app.MapGet("/api/sim/rfqs/{id}/previous-quotes/file",(string id,string department,string selectionToken,HttpContext c)=>Run(c,false,async p=>{var file=await store.OpenSelectedPreviousQuote(id,department,selectionToken,p);c.Response.Headers["X-Content-Type-Options"]="nosniff";return Results.File(file.Bytes,file.Type,fileDownloadName:file.Name);}));
 }
}
