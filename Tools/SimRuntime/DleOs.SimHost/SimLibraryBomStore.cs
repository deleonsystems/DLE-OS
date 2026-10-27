using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed class LibraryBomPermissionException : Exception { internal LibraryBomPermissionException() : base("Your current persona does not have permission for this Library action.") {} }
internal sealed record LibraryActor(string Id,string Name,DateTimeOffset AtUtc);
internal sealed record LibraryAlternate(string Id,string PartNumber,string Manufacturer,string Status,LibraryActor? Decision=null,string? Reason=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] LibraryAlternateSourceDecision? SourceDecision=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? NumberRole=null);
internal sealed record LibraryRowSource(string RowId,Dictionary<string,string> Extracted,Dictionary<string,DleAnalysisField>? Fields,SimCandidateAlternate[] Alternates);
internal sealed record LibraryVproSource(string GoverningSha256,string Parser,SimVproImport VproImport,SimPreparationGroup[]? PreparationGroups=null);
internal sealed record LibraryBomRow(string Id,string Find,string SourcePartNumber,string Description,string Quantity,string Unit,string ReferenceDesignators,
    string IdentityBasis,string ManufacturerPartNumber,string ManufacturerName,bool IdentityConfirmed,bool Dnp,string Notes,bool PreparationRequired,
    LibraryAlternate[] Alternates,string? SelectedAlternateId=null,LibraryRowSource? Source=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] LibraryRowAcceptance? Acceptance=null);
internal sealed record LibraryBomDraft(string Id,string AssemblyNumber,string DrawingRevision,string BomRevision,string ChangeNotes,string QuantityBasis,
    bool PreparationAssessed,LibraryBomRow[] Rows,LibraryActor Author,LibraryActor SavedBy,LibraryVproSource? Import=null,string? EvidenceHash=null,string? EvidenceName=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] LibraryFolderEvidence? FolderEvidence=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)] bool RowAcceptanceRequired=false,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)] int InternalVersion=0,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)] DateTimeOffset? ImportedAtUtc=null);
internal sealed record LibraryReviewAttempt(string Id,int Version,string Status,LibraryBomDraft Snapshot,string ContentHash,LibraryActor SubmittedBy,
    LibraryActor? ReviewedBy=null,string? Comments=null,LibraryActor? WithdrawnBy=null);
internal sealed record LibraryBomEvent(string Action,string DraftId,LibraryActor Actor,string? Details=null);
internal sealed record LibrarySourceVersion(string Id,int Version,LibraryBomDraft Snapshot,string ContentHash,LibraryActor ArchivedBy);
internal sealed record LibraryBomRecord(string SourceKeyRaw,int Revision,LibraryBomDraft? Draft,LibraryReviewAttempt[] Reviews,LibraryBomEvent[] History,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)] LibrarySourceVersion[]? SourceVersions=null);
internal sealed record LibraryRowEdit(string Id,string Find,string SourcePartNumber,string Description,string Quantity,string Unit,string ReferenceDesignators,
    string IdentityBasis,string ManufacturerPartNumber,string ManufacturerName,bool IdentityConfirmed,bool Dnp,string Notes,bool PreparationRequired,string? SelectedAlternateId=null,LibraryNumberRoleEdit[]? NumberRoles=null);
internal sealed record LibraryBomCommand(string SourceKeyRaw,string ExpectedToken,string Action,string? DrawingRevision=null,string? BomRevision=null,
    string? ChangeNotes=null,string? QuantityBasis=null,bool PreparationAssessed=false,LibraryRowEdit[]? Rows=null,string? TextBase64=null,string? FileName=null,
    bool ConfirmIdentity=false,string? IdentityReason=null,string? ReviewId=null,string? Comments=null,string? RowId=null,string? AlternateId=null,
    string? PartNumber=null,string? Manufacturer=null,string? AlternateDecision=null,LibraryFolderSelection? FolderSelection=null);
internal sealed record LibraryBomView(LibraryBomRecord Record,string Token,string[] Blockers,bool CanEdit,bool CanReview,bool SourceAlternateAcceptance=true,bool RowAcceptanceAvailable=true,bool PerAssemblyQuantities=true,string[]? PreparationRowIds=null,bool AlternateDecisionSavesDraft=true,bool SourceVersionUpdates=true,bool OptionalNobQuantities=true,bool SourceCutNotesAdvisory=true,string[]? SourceInstructionRowIds=null,bool RowAcceptConfirmsIdentity=true,bool PartNumberRoles=true,LibraryPackageVersion? ApprovedPackage=null,string? PackageStatus=null,bool PackageLocked=false);

// SIM-only Library storage. Never reads or writes job candidates, ERP or a source share.
internal sealed partial class SimLibraryBomStore(string stateRoot,Func<SimAssemblyHeader[]> headers)
{
    private readonly string root=Path.Combine(stateRoot,"assembly-library-v1");
    private readonly SemaphoreSlim gate=new(1,1);
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){WriteIndented=true};
    internal static string Hash(byte[] value)=>Convert.ToHexString(SHA256.HashData(value));
    internal static string Token(LibraryBomRecord r)=>Hash(JsonSerializer.SerializeToUtf8Bytes(r,Json));
    private static int NextVersion(LibraryBomRecord r)=>1+new[]{r.Draft?.InternalVersion??0,r.Draft is null?0:1,r.Reviews.Select(v=>Math.Max(v.Version,v.Snapshot.InternalVersion)).DefaultIfEmpty().Max(),(r.SourceVersions??[]).Select(v=>v.Version).DefaultIfEmpty().Max()}.Max();
    private static LibraryActor Actor(SimPersona p)=>new(p.Id,p.DisplayName,DateTimeOffset.UtcNow);
    private static void Require(bool b,string message){if(!b)throw SimRfqIntakeProblem.Conflict("LIBRARY_BOM",message);}
    internal static void Permission(SimPersona p,bool review=false,bool write=false)
    {
        if(!p.IsActive || (review ? !p.Can(write?"technical_review.disposition":"technical_review.view") : !p.Can("assembly_library.view") || write&&!p.Can("assembly_library.edit")))
            throw new LibraryBomPermissionException();
    }
    private string PathFor(string key)=>Path.Combine(root,Hash(Encoding.UTF8.GetBytes(key))+".json");
    private SimAssemblyHeader Header(string key)=>headers().SingleOrDefault(h=>h.SourceKeyRaw==key)??throw SimRfqIntakeProblem.BadRequest("LIBRARY_KEY","Select an exact preliminary Library header.");
    private async Task<LibraryBomRecord> Read(string key)
    {
        var path=PathFor(key);if(!File.Exists(path))return new(key,0,null,[],[]);
        var r=JsonSerializer.Deserialize<LibraryBomRecord>(await File.ReadAllTextAsync(path),Json)??throw new InvalidDataException("Library record unavailable.");
        Require(r.SourceKeyRaw==key,"Library identity verification failed.");return r;
    }
    private async Task Write(LibraryBomRecord record)
    {
        Directory.CreateDirectory(root);var path=PathFor(record.SourceKeyRaw);var temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";
        try {await File.WriteAllTextAsync(temp,JsonSerializer.Serialize(record,Json));var check=JsonSerializer.Deserialize<LibraryBomRecord>(await File.ReadAllTextAsync(temp),Json)!;
            Require(Token(check)==Token(record),"Library save verification failed.");File.Move(temp,path,true);
        } finally {if(File.Exists(temp))File.Delete(temp);}
    }
    private LibraryBomView View(LibraryBomRecord r,SimPersona p)=>new(r,Token(r),r.Draft is null?[]:Blockers(r.Draft),p.Can("assembly_library.edit")&&p.Can("assembly_library.view")&&!PackageLocked(r),p.Can("technical_review.disposition"),PreparationRowIds:r.Draft is null?[]:r.Draft.Rows.Where(row=>PreparationApplies(r.Draft,row)).Select(row=>row.Id).ToArray(),SourceInstructionRowIds:r.Draft is null?[]:r.Draft.Rows.Where(row=>SourceInstructionApplies(r.Draft,row)).Select(row=>row.Id).ToArray(),ApprovedPackage:ApprovedPackage(r.SourceKeyRaw),PackageStatus:PackageStatus(r.SourceKeyRaw),PackageLocked:PackageLocked(r));
    internal async Task<LibraryBomView> Get(string key,SimPersona p)
    {Permission(p);Header(key);await gate.WaitAsync();try{return View(await Read(key),p);}finally{gate.Release();}}
    internal async Task<object[]> Queue(SimPersona p)
    {
        Permission(p,review:true);await gate.WaitAsync();try {
            if(!Directory.Exists(root))return [];
            var list=new List<object>();foreach(var path in Directory.EnumerateFiles(root,"*.json")){
                var r=JsonSerializer.Deserialize<LibraryBomRecord>(await File.ReadAllTextAsync(path),Json)!;
                foreach(var v in r.Reviews.Where(v=>v.Status=="SUBMITTED"))list.Add(new{r.SourceKeyRaw,Token=Token(r),Review=v,CanReview=p.Can("technical_review.disposition")});
            }return list.ToArray();
        }finally{gate.Release();}
    }
    private async Task VerifyEvidence(LibraryBomDraft d)
    {
        if(d.EvidenceHash is null)return;
        Require(System.Text.RegularExpressions.Regex.IsMatch(d.EvidenceHash,"^[A-F0-9]{64}$"),"Invalid evidence identity.");
        var bytes=await File.ReadAllBytesAsync(Path.Combine(root,"evidence",d.EvidenceHash+".txt"));
        Require(Hash(bytes)==d.EvidenceHash && d.Import?.GoverningSha256.Equals(d.EvidenceHash,StringComparison.OrdinalIgnoreCase)==true,"Preserved source evidence changed; this version cannot be submitted or approved.");
    }
    internal async Task<byte[]> Evidence(string key,string? reviewId,SimPersona p,bool review=false)
    {
        Permission(p,review);Header(key);await gate.WaitAsync();try{var r=await Read(key);var d=reviewId is null?r.Draft:r.Reviews.SingleOrDefault(v=>v.Id==reviewId)?.Snapshot;
            if(!review && reviewId?.StartsWith("package:")==true){var v=ReadPackages(key).Versions.SingleOrDefault(v=>v.Id==reviewId[8..]);Require(v is not null,"Saved package unavailable.");VerifyPackage(v!);d=v!.Bom;}
            if(!review && reviewId?.StartsWith("source:")==true){var archived=(r.SourceVersions??[]).SingleOrDefault(v=>v.Id==reviewId[7..]);Require(archived is not null,"Saved version unavailable.");Require(Hash(JsonSerializer.SerializeToUtf8Bytes(archived!.Snapshot,Json))==archived.ContentHash,"Saved version integrity check failed.");d=archived.Snapshot;}
            Require(d?.EvidenceHash is not null,"No TXT evidence is attached to this version.");if(review)Require(reviewId is not null && r.Reviews.Any(v=>v.Id==reviewId),"Review access requires a submitted version.");await VerifyEvidence(d!);
            return await File.ReadAllBytesAsync(Path.Combine(root,"evidence",d!.EvidenceHash+".txt"));
        }finally{gate.Release();}
    }
    internal static string[] Blockers(LibraryBomDraft d)
    {
        var errors=new List<string>();
        if(string.IsNullOrWhiteSpace(d.BomRevision))errors.Add("Enter the BOM revision being submitted; it is separate from the drawing revision.");
        if(!SupportedBasis(d.QuantityBasis))errors.Add("This saved quantity basis is not per assembly. Resolve the source basis explicitly; quantities and UOM have not been converted.");
        if(d.Rows.Length==0)errors.Add("Add at least one BOM row.");
        if(PreparationPending(d))
            errors.Add("Preparation details pending. Stock consumption and downstream use are unsupported in this slice; retain this BOM as a draft.");
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var r in d.Rows){var name="Find "+(string.IsNullOrEmpty(r.Find)?"(blank)":r.Find)+": ";
            var remaining=r.Alternates.Count(a=>!NumberReviewed(r,a));
            if(remaining>0)errors.Add(name+remaining+" part number(s) need review. Choose Customer P/N or review the Manufacturer P/N before accepting this row.");
            var source=new SimCandidateRow(0,r.Source?.Extracted??new(),new(),[],new(),false,null,null,[],RowId:r.Source?.RowId);
            if(!SimPreparation.LiteralFind(source,r.Find))errors.Add(name+"use a positive Find number or the exact imported decimal/NOB label.");
            if(r.Find!="NOB"&&!seen.Add(r.Find))errors.Add(name+"duplicate Find; resolve explicitly.");
            if(OptionalNob(r)?OptionalNobDemand(r) is null:!SimCandidateBomProvider.ValidQuantity(r.Quantity,r.Dnp))errors.Add(name+(OptionalNob(r)?"enter zero or a positive optional NOB quantity.":"enter a valid positive quantity (DNP may be zero or blank)."));
            if(!r.Dnp&&!ZeroOptionalNob(r)&&string.IsNullOrWhiteSpace(r.Unit))errors.Add(name+"enter an explicit UOM.");
            if(!r.Dnp&&string.IsNullOrWhiteSpace(r.SourcePartNumber))errors.Add(name+"enter the source/internal part reference.");
            if(!r.Dnp&&r.SelectedAlternateId is null&&(!r.IdentityConfirmed||r.IdentityBasis is not ("MFG" or "CUSTOMER" or "ASSEMBLY")))errors.Add(name+"confirm the part identity; unknown internal ownership is not approved identity.");
            if(!r.Dnp&&r.SelectedAlternateId is null&&r.IdentityBasis=="MFG"&&string.IsNullOrWhiteSpace(r.ManufacturerPartNumber))errors.Add(name+"enter the confirmed manufacturer P/N.");
            if(r.SelectedAlternateId is {} id && !r.Alternates.Any(a=>a.Id==id&&ManufacturerEligible(r,a)))errors.Add(name+"choose a reviewed Manufacturer P/N; a Customer P/N cannot be selected here.");
        }
        if(d.RowAcceptanceRequired&&d.Rows.Any(r=>!RowAccepted(d,r)))errors.Add("Accept every working row before submitting this BOM for review.");
        return errors.Distinct().ToArray();
    }
    private static string Text(string? value,int limit=2000){value??="";Require(value.Length<=limit&&!value.Contains('\0'),"A field is too long or contains invalid characters.");return value;}
    private static LibraryRowEdit ConfirmAcceptedIdentity(LibraryRowEdit e)=>e with{
        ManufacturerPartNumber=e.IdentityBasis=="MFG"&&string.IsNullOrWhiteSpace(e.ManufacturerPartNumber)?e.SourcePartNumber:e.ManufacturerPartNumber,
        IdentityConfirmed=e.IdentityBasis is "MFG" or "CUSTOMER" or "ASSEMBLY" or "INTERNAL_UNKNOWN"};
    private static LibraryBomRow Edit(LibraryRowEdit e,LibraryBomRow? old,LibraryActor? actor=null)
    {
        Require(Guid.TryParse(e.Id,out _)||old is not null,"New rows require a stable generated identity.");
        var identityChanged=old is not null&&(old.SourcePartNumber!=e.SourcePartNumber||old.IdentityBasis!=e.IdentityBasis||(old.ManufacturerPartNumber!=e.ManufacturerPartNumber&&!(old.IdentityBasis=="MFG"&&e.IdentityBasis=="MFG"&&string.IsNullOrWhiteSpace(old.ManufacturerPartNumber)&&e.ManufacturerPartNumber==e.SourcePartNumber&&old.SourcePartNumber==e.SourcePartNumber))||old.ManufacturerName!=e.ManufacturerName||old.Dnp!=e.Dnp);
        var alts=ApplyNumberRoles(e,old,actor);
        if(identityChanged)alts=alts.Select(a=>a.NumberRole=="CUSTOMER"?a:a with{Status="STALE"}).ToArray();
        Require(e.SelectedAlternateId is null||alts.Any(a=>a.Id==e.SelectedAlternateId&&(ManufacturerEligible(old!,a)||(e.SelectedAlternateId==old?.SelectedAlternateId&&a.NumberRole is null))),"Choose a currently approved alternate; approval and selection are separate.");
        return new(e.Id,Text(e.Find,40),Text(e.SourcePartNumber),Text(e.Description),Text(e.Quantity,80),Text(e.Unit,40),Text(e.ReferenceDesignators),
            Text(e.IdentityBasis,30),Text(e.ManufacturerPartNumber),Text(e.ManufacturerName),e.IdentityConfirmed,e.Dnp,Text(e.Notes,4000),e.PreparationRequired,alts,e.SelectedAlternateId,old?.Source,old?.Acceptance);
    }
    internal async Task<LibraryBomView> Change(LibraryBomCommand c,SimPersona p,bool review=false)
    {
        Permission(p,review,true);Require(review ? c.Action is "APPROVE" or "CHANGES_REQUESTED" : c.Action is "START" or "SAVE" or "IMPORT" or "UPDATE_SOURCE" or "SUBMIT" or "WITHDRAW" or "REVISE" or "ALTERNATE" or "ACCEPT_ROW" or "EDIT_ROW","Unsupported action in this module.");
        var h=Header(c.SourceKeyRaw);await gate.WaitAsync();try {
            var r=await Read(c.SourceKeyRaw);Require(c.ExpectedToken==Token(r),"This Library version changed. Reload before trying again; your unsaved edits have not been applied.");
            if(!review)Require(!PackageLocked(r),"This package version is fixed. Use Start changes or Withdraw on the assembly screen first.");var actor=Actor(p);var d=r.Draft;var pending=r.Reviews.SingleOrDefault(v=>v.Status=="SUBMITTED");
            if(c.Action=="START"){
                Require(d is null&&pending is null&&r.Reviews.Length==0,"A version already exists. Resume it or start a revision.");
                d=new(Guid.NewGuid().ToString(),h.BillNumber.TrimEnd(),h.DrawingRevision.TrimEnd(),h.BomRevision.TrimEnd(),"","PER_ASSEMBLY",false,[],actor,actor,InternalVersion:NextVersion(r));
            } else if(c.Action=="REVISE"){
                Require(d is null&&pending is null,"Finish or withdraw the existing working version first.");
                var previous=r.Reviews.LastOrDefault(v=>v.Status is "APPROVED" or "CHANGES_REQUESTED" or "WITHDRAWN");Require(previous is not null,"No reviewed version is available to revise.");
                Require(!string.IsNullOrWhiteSpace(c.Comments),"Explain the revision.");
                d=previous!.Snapshot with{Id=Guid.NewGuid().ToString(),Author=actor,SavedBy=actor,ChangeNotes=Text(c.Comments,4000),InternalVersion=NextVersion(r)};
            } else if(c.Action=="WITHDRAW"){
                Require(pending is not null&&d is null,"Only a submitted version can be withdrawn.");
                Require(!string.IsNullOrWhiteSpace(c.Comments),"Explain why the submission is being withdrawn.");
                r=r with{Reviews=r.Reviews.Select(v=>v.Id==pending!.Id?v with{Status="WITHDRAWN",WithdrawnBy=actor,Comments=Text(c.Comments,4000)}:v).ToArray()};
                d=pending!.Snapshot with{Id=Guid.NewGuid().ToString(),Author=actor,SavedBy=actor};
            } else if(review){
                Require(pending is not null&&pending.Id==c.ReviewId&&d is null,"The submitted version is no longer pending.");
                Require(Hash(JsonSerializer.SerializeToUtf8Bytes(pending!.Snapshot,Json))==pending.ContentHash,"Submitted content verification failed.");
                await VerifyEvidence(pending.Snapshot);
                Require(!string.IsNullOrWhiteSpace(c.Comments),"Enter review notes or required changes.");
                if(c.Action=="APPROVE")Require(Blockers(pending.Snapshot).Length==0,string.Join(" ",Blockers(pending.Snapshot)));
                r=r with{Reviews=r.Reviews.Select(v=>v.Id==pending.Id?v with{Status=c.Action=="APPROVE"?"APPROVED":"CHANGES_REQUESTED",ReviewedBy=actor,Comments=Text(c.Comments,4000)}:v).ToArray()};
            } else {
                Require(d is not null&&pending is null,"Open an editable draft first. Submitted and approved versions cannot be edited.");
                if(c.Action is "SAVE" or "ACCEPT_ROW" or "EDIT_ROW" || (c.Action=="ALTERNATE"&&c.Rows is not null)){
                    await VerifyEvidence(d!);
                    Require(SupportedBasis(d!.QuantityBasis)&&SupportedBasis(c.QuantityBasis),"Library quantities are per one assembly. Resolve the explicit incompatible basis before saving; no values were converted.");
                    Require(c.Rows is not null&&c.Rows.Length<=1000&&c.Rows.Select(e=>e.Id).Distinct().Count()==c.Rows.Length,"Use up to 1000 uniquely identified rows.");
                    Require(d!.Rows.All(old=>c.Rows!.Any(e=>e.Id==old.Id)),"Existing rows cannot disappear silently. Use DNP with a note for an unused position.");
                    d=d with{DrawingRevision=Text(c.DrawingRevision,200),BomRevision=Text(c.BomRevision,200),ChangeNotes=Text(c.ChangeNotes,4000),QuantityBasis="PER_ASSEMBLY",PreparationAssessed=c.PreparationAssessed,
                        Rows=c.Rows!.Select(e=>Edit(c.Action=="ACCEPT_ROW"&&e.Id==c.RowId?ConfirmAcceptedIdentity(e):e,d.Rows.SingleOrDefault(old=>old.Id==e.Id),actor)).ToArray(),SavedBy=actor};
                    if(d.Import is not null && (d.Import.VproImport?.IdentityConfirmation is {} confirmation ? confirmation.Revision!=d.BomRevision : !string.Equals(SimVproParser.Describe(Convert.FromBase64String(await EvidenceBase64(d))).Drawing,d.AssemblyNumber+" REV "+d.BomRevision,StringComparison.OrdinalIgnoreCase)))
                        Require(false,"Imported source identity is tied to its BOM revision. Keep it or explicitly import/reconcile a new source into an empty draft.");
                    d=InvalidateRows(d);
                    if(c.Action is "ACCEPT_ROW" or "EDIT_ROW"){
                        var target=d.Rows.SingleOrDefault(r=>r.Id==c.RowId);Require(target is not null,"Select an existing row.");
                        if(c.Action=="ACCEPT_ROW"){
                            if(d.Import is not null)SimVproParser.Parse(Convert.FromBase64String(await EvidenceBase64(d)),d.Import.VproImport.DocumentId,d.AssemblyNumber,d.BomRevision,actor.Name,d.Import.VproImport.IdentityConfirmation,libraryOptionalNob:true);
                            var errors=Blockers(d with{Rows=[target!],RowAcceptanceRequired=false,Import=null}).ToList();
                            if(PreparationApplies(d,target!))errors.Add("Find "+target!.Find+": Preparation details pending. Resolve the cut-from-stock or preparation requirements before accepting this row.");
                            if(target!.Find!="NOB"&&d.Rows.Count(r=>r.Find==target.Find)>1)errors.Add("Duplicate Find; resolve it before accepting this row.");
                            Require(errors.Count==0,string.Join(" ",errors));
                            target=target with{Acceptance=new(RowFingerprint(d,target),actor)};
                        }else target=target! with{Acceptance=null};
                        d=d with{RowAcceptanceRequired=true,Rows=d.Rows.Select(r=>r.Id==target.Id?target:r).ToArray()};
                    }
                }
                if(c.Action is "IMPORT" or "UPDATE_SOURCE"){
                    var previous=d!;var updating=c.Action=="UPDATE_SOURCE";
                    if(updating){Require(d!.Rows.Length>0 || d.Import is not null,"Use Import VPRO5 TXT for an empty draft.");await VerifyEvidence(d);}

                    Require(SupportedBasis(d!.QuantityBasis),"Resolve the explicit non-assembly quantity basis before importing; no quantities were converted.");
                    Require(updating || (d!.Rows.Length==0&&d.Import is null),"Import is available only in an empty draft; existing work is not replaced.");
                    Require(c.FileName?.EndsWith(".txt",StringComparison.OrdinalIgnoreCase)==true,"Choose a VPRO5 TXT export.");
                    LibraryFolderEvidence? folderEvidence=null;
                    if(c.FolderSelection is not null){var linked=await LinkedTxt(c.SourceKeyRaw,c.FolderSelection,p,true);c=c with{TextBase64=Convert.ToBase64String(linked.Read.Bytes),FileName=linked.Read.Name};folderEvidence=linked.Evidence;}
                    Require(c.TextBase64 is not null&&c.TextBase64.Length<=1400000,"Choose a TXT export up to 1 MB.");
                    byte[] bytes;try{bytes=Convert.FromBase64String(c.TextBase64!);}catch(FormatException){throw SimRfqIntakeProblem.BadRequest("LIBRARY_FILE","Invalid file bytes.");}
                    var description=SimVproParser.Describe(bytes);var hash=Hash(bytes);var document="library-"+hash;
                    if(updating)Require(hash!=d!.EvidenceHash && !(r.SourceVersions??[]).Any(v=>v.Snapshot.EvidenceHash==hash) && !r.Reviews.Any(v=>v.Snapshot.EvidenceHash==hash),"This TXT is already saved in this BOM history. Choose the updated export; no version was changed.");
                    SimVproIdentityConfirmation? confirmation=null;
                    if(!string.Equals(description.Drawing,d.AssemblyNumber+" REV "+d.BomRevision,StringComparison.OrdinalIgnoreCase)){
                        Require(c.ConfirmIdentity&&!string.IsNullOrWhiteSpace(c.IdentityReason),"Source identity: "+description.Drawing+"; Library target: "+d.AssemblyNumber+" REV "+d.BomRevision+". Explicitly reconcile these identities with a reason.");
                        confirmation=new(document,DleAnalysisContract.Hash(bytes),description.Drawing,d.AssemblyNumber,d.BomRevision,Text(c.IdentityReason,2000),p.DisplayName,actor.AtUtc);
                    }
                    var parsed=SimVproParser.Parse(bytes,document,d.AssemblyNumber,d.BomRevision,p.DisplayName,confirmation,libraryOptionalNob:true);
                    var rows=parsed.Rows.Select(row=>new LibraryBomRow(row.RowId!,row.Values.GetValueOrDefault("lineNumber")??"",row.Values.GetValueOrDefault("partNumber")??"",row.Values.GetValueOrDefault("description")??"",row.Values.GetValueOrDefault("quantity")??"",row.Values.GetValueOrDefault("unit")??"",row.Values.GetValueOrDefault("designators")??"","UNRESOLVED","","",false,row.ComponentType=="DNP","",false,
                        (row.Alternates??[]).Select(a=>new LibraryAlternate(a.Id,a.PartNumber??"",a.ManufacturerName??"","PROPOSED")).ToArray(),Source:new(row.RowId!,row.Extracted,row.AnalysisFields,row.Alternates??[]))).ToArray();
                    Directory.CreateDirectory(Path.Combine(root,"evidence"));var evidence=Path.Combine(root,"evidence",hash+".txt");
                    if(File.Exists(evidence))Require(Hash(await File.ReadAllBytesAsync(evidence))==hash,"Existing evidence failed integrity verification.");else await File.WriteAllBytesAsync(evidence,bytes);
                    if(updating){var archive=new LibrarySourceVersion(Guid.NewGuid().ToString(),Math.Max(1,previous.InternalVersion),previous,Hash(JsonSerializer.SerializeToUtf8Bytes(previous,Json)),actor);
                        var next=NextVersion(r);r=r with{SourceVersions=[..r.SourceVersions??[],archive]};
                        d=new(Guid.NewGuid().ToString(),previous.AssemblyNumber,previous.DrawingRevision,previous.BomRevision,"","PER_ASSEMBLY",false,[],actor,actor,RowAcceptanceRequired:true,InternalVersion:next);}
                    d=d! with{ImportedAtUtc=actor.AtUtc,Rows=rows,Import=new(parsed.GoverningSha256,parsed.Parser,parsed.VproImport!,parsed.PreparationGroups),EvidenceHash=hash,EvidenceName=Path.GetFileName(Text(c.FileName,200)),FolderEvidence=folderEvidence,SavedBy=actor};
                } else if(c.Action=="ALTERNATE"){
                    var row=d!.Rows.SingleOrDefault(x=>x.Id==c.RowId);Require(row is not null,"Select an existing row.");var alts=row!.Alternates;
                    if(c.AlternateDecision=="ADD") {Require(!string.IsNullOrWhiteSpace(c.PartNumber),"Enter an alternate P/N.");alts=[..alts,new(Guid.NewGuid().ToString(),Text(c.PartNumber),Text(c.Manufacturer),"PROPOSED",NumberRole:"MFG")];}
                    else {
                        Permission(p,review:true,write:true);Require(c.AlternateDecision is "APPROVED" or "REJECTED" or "APPROVE_SOURCE","Choose accept, approve or reject.");if(c.AlternateDecision!="APPROVE_SOURCE")Require(!string.IsNullOrWhiteSpace(c.Comments),"Record the alternate decision basis.");
                        Require(alts.Any(a=>a.Id==c.AlternateId),"Alternate no longer exists.");
                        var decided=alts.SingleOrDefault(a=>a.Id==c.AlternateId);if(c.AlternateDecision is "APPROVED" or "APPROVE_SOURCE")Require(decided is not null&&ManufacturerRole(row,decided),"Choose Manufacturer P/N for this number first. Customer references are not manufacturer alternatives.");
                        var sourceDecision=c.AlternateDecision=="APPROVE_SOURCE"?await VerifyAlternateSource(d,row,alts.Single(a=>a.Id==c.AlternateId)):null;
                        alts=alts.Select(a=>a.Id==c.AlternateId?a with{Status=c.AlternateDecision=="APPROVE_SOURCE"?"APPROVED":c.AlternateDecision!,Decision=actor,Reason=sourceDecision is null?Text(c.Comments,4000):null,SourceDecision=sourceDecision}:a).ToArray();
                    }
                    // A deliberate decision may also select the sole alternate for a confirmed non-manufacturer source identity.
                    // Never infer that identity from the source column, PN spelling, or import alone.
                    var chooseSole=c.AlternateDecision is "APPROVE_SOURCE" or "APPROVED"
                        && alts.Length==1 && ManufacturerEligible(row,alts[0])
                        && row.IdentityConfirmed && row.IdentityBasis is "CUSTOMER" or "INTERNAL_UNKNOWN"
                        && !row.Dnp && row.SelectedAlternateId is null
                        && (string.IsNullOrWhiteSpace(row.ManufacturerPartNumber)||row.ManufacturerPartNumber==alts[0].PartNumber);
                    d=d with{Rows=d.Rows.Select(x=>x.Id==row.Id?x with{Alternates=alts,SelectedAlternateId=chooseSole?alts[0].Id:alts.Any(a=>a.Id==x.SelectedAlternateId&&ManufacturerEligible(x,a))?x.SelectedAlternateId:null}:x).ToArray(),SavedBy=actor};
                } else if(c.Action=="SUBMIT"){
                    var blockers=Blockers(d!);Require(blockers.Length==0,string.Join(" ",blockers));await VerifyEvidence(d!);
                    var version=new LibraryReviewAttempt(Guid.NewGuid().ToString(),r.Reviews.Length+1,"SUBMITTED",d!,Hash(JsonSerializer.SerializeToUtf8Bytes(d,Json)),actor);
                    r=r with{Reviews=[..r.Reviews,version]};d=null;
                }
            }
            if(d is not null)d=InvalidateRows(d);
            r=r with{Draft=d,Revision=r.Revision+1,History=[..r.History,new(c.Action,d?.Id??pending?.Snapshot.Id??r.Reviews.LastOrDefault()?.Snapshot.Id??"",actor,c.Action is "SAVE" or "ALTERNATE" or "ACCEPT_ROW" or "EDIT_ROW" ? JsonSerializer.Serialize(new{c.RowId,c.AlternateId,c.AlternateDecision,d?.DrawingRevision,d?.BomRevision,d?.ChangeNotes,d?.QuantityBasis,d?.PreparationAssessed,Rows=d?.Rows.Select(x=>new{x.Id,x.Find,x.SourcePartNumber,x.Description,x.ReferenceDesignators,x.Quantity,x.Unit,x.IdentityBasis,x.ManufacturerPartNumber,x.ManufacturerName,x.IdentityConfirmed,x.Dnp,x.Notes,x.PreparationRequired,x.SelectedAlternateId,x.Alternates,x.Acceptance}),c.Comments},Json) : Text(c.Comments??c.IdentityReason,4000))]};
            await Write(r);return View(r,p);
        } finally {gate.Release();}
    }
    private async Task<string> EvidenceBase64(LibraryBomDraft d)=>Convert.ToBase64String(await File.ReadAllBytesAsync(Path.Combine(root,"evidence",d.EvidenceHash+".txt")));
}
