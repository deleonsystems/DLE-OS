using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

internal sealed class SimProductionService(SimStateStore state,SimOperationsDataStore operations,SimRfqIntakeStore intakes,
    SimKittingRequirementsProvider provider,SimIntakeDocuments documents)
{
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private readonly SimProductionStore store=new(operations.DatabasePath);
    internal Func<DateTimeOffset> UtcNow {get;set;}=()=>DateTimeOffset.UtcNow;
    internal static string Hash(object value)=>Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value,Json)));
    private static void Permission(SimPersona actor,bool write){if(!actor.Can(write?"production.manage":"production.view"))throw new SimOrderEntryPermissionException();}
    private static void Require(bool valid,string code,string message){if(!valid)throw KittingCaseProblem.Conflict(code,message);}
    internal static string Status(string material,bool validTraveler)=>material switch{
        "NEEDS_KITTING" or "KITTING_IN_PROGRESS"=>"AWAITING_KITTING","KIT_SHORT"=>"AWAITING_PARTS",
        "KIT_COMPLETE" when validTraveler=>"READY_TO_START_PRODUCTION","KIT_COMPLETE"=>"TRAVELER_REVIEW_REQUIRED",_=>"SOURCE_REVIEW_REQUIRED"};
    internal Task<JsonElement> Read(string wo,SimPersona actor)=>WithSource(wo,actor,false,async(s,r)=>await View(s,r,actor));
    private Task<T> WithSource<T>(string wo,SimPersona actor,bool write,Func<SimProductionSource,SimStateMetadata,Task<T>> action)=>state.WithStableRuntime(async runtime=>{
        Permission(actor,write);wo=SimKittingCases.Normalize(wo);
        // Same lock order as imported-order release and Kitting Start. Intake source cannot be
        // reopened/held between validation and Traveler mutation. Never reads mutable Labor plans.
        return await provider.WithReleasedRequirements(wo,runtime,async release=>await action(await Source(wo,runtime,release),runtime));
    });
    private async Task<SimProductionSource> Source(string wo,SimStateMetadata runtime,SimKittingReleasedRequirements release)
    {
        var caseRecord=await operations.ReadSimKittingCase(wo,runtime);
        Require(caseRecord is null||caseRecord.ReleasedBomIdentity==release.ReleasedBomIdentity,"production_release_changed","The retained Kitting release no longer matches the governed accepted-order source.");
        var intakeId=release.Lineage.GetProperty("source").GetProperty("intakeId").GetString()!;
        var record=(SimRfqIntakeRecord)(await intakes.ReadAsync(intakeId))!;
        var acceptance=record.OrderEntry!.Acceptance;var accepted=acceptance.Package;var baseline=accepted.TechnicalSource!.Baseline!;
        var labor=baseline.Labor;var line=accepted.Facts.Lines.Single();var sourceRfq=(SimRfqIntakeRecord)(await intakes.ReadAsync(baseline.Quote.IntakeId))!;
        Require(labor.Version>0&&labor.DefinitionId==baseline.Definition.Manufacturing.Id&&labor.Quantity==line.Quantity&&labor.Operations.Length>0,
            "production_labor_source","Frozen accepted Labor is missing or does not match the manufacturing definition and order quantity.");
        var approval=accepted.Quote?.Approval;
        Require(approval is not null&&approval.Id==baseline.Quote.ApprovalId&&approval.Version==baseline.Quote.ApprovalVersion&&
            approval.Summary.LaborVersion==labor.Version&&approval.Summary.ManufacturingDefinitionId==labor.DefinitionId&&approval.Summary.LaborComplete,
            "production_labor_approval","Frozen Labor must match the exact approved quote version retained by the accepted order.");
        Require(labor.Operations.Select(o=>o.Id).Distinct().Count()==labor.Operations.Length&&labor.Operations.All(o=>!string.IsNullOrWhiteSpace(o.Id)),
            "production_source_identity","Frozen Labor operation identities must be unique and nonempty.");
        var manufacturing=baseline.Definition.Manufacturing;
        var authorityIds=new[]{manufacturing.GoverningDocumentId,baseline.Definition.Materials.Candidate.GoverningDocumentId}
            .Concat(manufacturing.SupportingDocumentIds).Concat(manufacturing.SubassemblyDocumentIds).Concat(manufacturing.TechnicalDocumentIds).ToHashSet(StringComparer.Ordinal);
        var documentsInPackage=manufacturing.Package.Documents.Concat(baseline.Definition.Materials.Package.Documents)
            .DistinctBy(d=>d.DocumentId).Where(d=>authorityIds.Contains(d.DocumentId)).ToArray();
        Require(documentsInPackage.Length==authorityIds.Count,"production_technical_reference","Every frozen production authority must retain a document reference in the accepted package.");
        var refs=new List<SimTravelerReference>();
        foreach(var doc in documentsInPackage){
            Require(sourceRfq.TechnicalFiles.Any(d=>d.DocumentId==doc.DocumentId&&d.BinaryStatus=="VERIFIED"),"production_technical_reference","A frozen technical document is no longer associated with its source intake.");
            var bytes=await documents.Bytes(sourceRfq.RequestCorrelationId,doc.DocumentId);var hash=Convert.ToHexString(SHA256.HashData(bytes));
            if(doc.DocumentId==baseline.Definition.Materials.Candidate.GoverningDocumentId)
                Require(string.Equals(hash,baseline.Definition.Materials.Candidate.GoverningSha256,StringComparison.OrdinalIgnoreCase),"production_technical_hash","The frozen governing BOM file failed hash verification.");
            refs.Add(new(doc.DocumentId,doc.Name,doc.DocumentType=="BOM"?"BOM":doc.DocumentType=="ASSEMBLY_DRAWING"?"Technical Drawing":"Technical Reference",
                $"/api/production/v1/work-orders/{wo}/documents/{doc.DocumentId}",hash));
        }
        Require(refs.Any(d=>d.DocumentId==baseline.Definition.Manufacturing.GoverningDocumentId)&&refs.Any(d=>d.DocumentId==baseline.Definition.Materials.Candidate.GoverningDocumentId),
            "production_technical_reference","Both governing BOM and production drawing references are required.");
        var latest=caseRecord is null?null:(await operations.ReadSimKittingSubmissions(wo,runtime)).Where(s=>s.CaseId==caseRecord.CaseId)
            .OrderByDescending(s=>s.SubmittedAtUtc).ThenByDescending(s=>s.VersionNumber).FirstOrDefault();
        JsonElement? snapshot=latest is null?null:JsonDocument.Parse(latest.SnapshotJson).RootElement.Clone();
        if(caseRecord?.State=="KIT_COMPLETE")Require(latest?.SubmissionType=="KIT_COMPLETE"&&snapshot?.GetProperty("releasedBomIdentity").GetString()==caseRecord.ReleasedBomIdentity,
            "production_final_kit","Kit Complete requires its final governed submission with the same frozen release.");
        var source=JsonSerializer.SerializeToElement(new{acceptanceId=acceptance.Id,acceptedIntakeId=intakeId,acceptedRevision=acceptance.PackageRevision,
            acceptance.SourceToken,quote=baseline.Quote,quoteApprovalId=baseline.Quote.ApprovalId,quoteApprovalVersion=baseline.Quote.ApprovalVersion,
            laborVersion=labor.Version,manufacturingDefinitionId=labor.DefinitionId,labor.CalculationVersion,labor.ManufacturingLead,
            technicalSourceToken=baseline.SourceToken,release.ReleasedBomIdentity,release.ReleasedBomVersion,
            sourceOperations=labor.Operations.Select(o=>new{o.Id,o.ParentId}).ToArray(),technicalDocuments=refs},Json);
        // Fingerprint includes only immutable accepted/frozen source, never mutable quote worksheets.
        var token=Hash(new{source,labor,release.Draft});
        var parents=labor.Operations.Where(o=>o.ParentId is null).ToArray();var projected=new List<SimTravelerOperation>();
        foreach(var op in labor.Operations){
            var parentIndex=Array.FindIndex(parents,p=>p.Id==(op.ParentId??op.Id));
            Require(parentIndex>=0,"production_source_parent","Frozen Labor contains an unsupported parent reference.");
            var sequence=(parentIndex+1)*10m;
            if(op.ParentId is not null){var siblings=labor.Operations.Where(o=>o.ParentId==op.ParentId).ToArray();
                Require(siblings.Length<=99,"production_source_order","Too many child operations for the supported sequence precision.");sequence+=(Array.FindIndex(siblings,s=>s.Id==op.Id)+1)/100m;}
            var visuals=new List<SimTravelerReference>();
            foreach(var visual in (op.Visuals??[]).Where(v=>!v.Removed)){
                Require(visual.RowId==op.Id&&visual.DefinitionId==labor.DefinitionId&&visual.IntakeId==sourceRfq.IntakeId,"production_visual_scope","Frozen visual references must retain their original operation and definition.");
                var bytes=await documents.Bytes(sourceRfq.RequestCorrelationId,visual.DocumentId);
                Require(bytes.LongLength==visual.Size&&Convert.ToHexString(SHA256.HashData(bytes))==visual.Sha256,"production_visual_hash","A frozen production visual failed verification.");
                visuals.Add(new(visual.DocumentId,visual.Name,visual.Type,$"/api/production/v1/work-orders/{wo}/visuals/{visual.DocumentId}",visual.Sha256,visual.Caption));
            }
            projected.Add(new("trvop-"+Hash(new{token,op.Id})[..24],op.Id,sequence,op.Name,"UNCLASSIFIED",true,"",op.Instructions,"","","","","",
                new(op.OperationQuantity,op.RunSeconds??op.RunMinutes*60,op.SetupMinutes,op.TimeBasis,labor.CalculationVersion),
                (op.Notes??[]).Where(n=>!n.Removed&&n.Purpose=="PRODUCTION").ToArray(),visuals.ToArray(),refs.ToArray()));
        }
        var questionnaire=accepted.Questionnaire;
        var package=JsonSerializer.SerializeToElement(new{workOrderNumber=wo,
            context=new{customer=record.Customer.CustomerName,customerNumber=record.Customer.CustomerNumber,assembly=line.Assembly,revision=line.Revision,
                quantity=line.Quantity,customerDueDate=line.CustomerDueDate,sourceQuote=baseline.Quote.QuoteNumber,sourceIntakeId=intakeId},
            source,sourceToken=token,technicalDocuments=refs,bom=Bom(caseRecord?.FrozenDraft??release.Draft,snapshot),
            kitting=caseRecord is null?null:new{caseRecord.CaseId,caseRecord.WorkingVersion,state=caseRecord.State,
                submissionId=latest?.SubmissionId,submissionVersion=latest?.VersionNumber,submittedBy=latest?.SubmittedBy,submittedAtUtc=latest?.SubmittedAtUtc,
                pdfUrl=latest is null?null:$"/api/production/v1/work-orders/{wo}/kitting.pdf",
                requirements=snapshot is {} snap?snap.GetProperty("draft").GetProperty("groups"):JsonSerializer.SerializeToElement(Array.Empty<object>()),
                applications=snapshot is {} sn?Field(sn,"applications"):JsonSerializer.SerializeToElement(Array.Empty<object>())},
            customerRequirements=new{travelerRequired=questionnaire?.TraceabilityDeliverables?.Contains("TRAVELER")==true,
                traceabilityDeliverables=questionnaire?.TraceabilityDeliverables??[],aerospaceRequirements=questionnaire?.AerospaceRequirements??[],
                questionnaire?.PoFlowdowns,questionnaire?.AdditionalContractQualityRequirements,questionnaire?.SpecialRequirements,questionnaire?.OtherCustomerRequirements}
        },Json);
        return new(token,package,projected.ToArray(),sourceRfq.IntakeId,sourceRfq.RequestCorrelationId,caseRecord,latest);
    }
    private static JsonElement Field(JsonElement value,string key)=>value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out var child)?child:JsonSerializer.SerializeToElement<object?>(null);
    private static string Text(JsonElement value,string key)=>Field(value,key).ValueKind==JsonValueKind.String?Field(value,key).GetString()!:"";
    private static decimal? Number(JsonElement value,string key)=>Field(value,key).ValueKind==JsonValueKind.Number?Field(value,key).GetDecimal():null;
    private static object[] Bom(JsonElement frozen,JsonElement? snapshot)
    {
        var final=snapshot is {} s?s.GetProperty("draft").GetProperty("groups").EnumerateArray().ToDictionary(g=>Text(g,"groupId")):new Dictionary<string,JsonElement>();
        var applications=snapshot is {} a&&Field(a,"applications").ValueKind==JsonValueKind.Array?Field(a,"applications").EnumerateArray().ToArray():[];
        return frozen.GetProperty("groups").EnumerateArray().Select(g=>{
            var id=Text(g,"groupId");final.TryGetValue(id,out var result);var entry=Field(result,"entry");
            if(result.ValueKind==JsonValueKind.Object)Require(Text(result,"sourceRowId")==Text(g,"sourceRowId"),"production_bom_join","Final Kitting evidence does not match the stable released requirement identity.");
            var allocations=Field(entry,"allocations").ValueKind==JsonValueKind.Array?Field(entry,"allocations").EnumerateArray().ToArray():[];
            var applied=applications.Where(x=>Text(x,"requirementId")==id&&Text(x,"sourceRowId")==Text(g,"sourceRowId")).ToArray();
            decimal appliedQty=applied.Sum(x=>Number(x,"quantity")??0);
            var counted=Number(entry,"pickedQuantity");
            return (object)new{requirementId=id,sourceRowId=Text(g,"sourceRowId"),find=Text(g,"sequence"),partNumber=Text(g,"partNumber"),description=Text(g,"description"),
                references=Field(g,"references"),requiredEach=Number(g,"requiredEach"),requiredQuantity=Number(g,"requiredQuantity"),uom=Text(g,"unitOfMeasure"),
                eligibleParts=Field(g,"eligibleParts"),dnp=Text(g,"classification")=="DNP",method=Text(entry,"method"),result=Text(entry,"result"),
                recordedKittedQuantity=counted,originalKittedQuantity=counted is null?null:counted-appliedQty,acceptedMaterialApplied=appliedQty,
                shortage=Number(entry,"shortageQuantity"),allocations,
                acceptedMaterials=applied.Select(x=>new{materialId=Text(x,"receiptLineId"),purchaseOrderNumber=Text(Field(x,"receipt"),"poNumber"),
                    purchaseOrderLine=Text(Field(x,"receipt"),"poLine"),quantity=Number(x,"quantity"),applicationId=Text(x,"eventId")}).ToArray()};
        }).ToArray();
    }
    private async Task<JsonElement> View(SimProductionSource source,SimStateMetadata runtime,SimPersona actor)
    {
        var wo=source.Package.GetProperty("workOrderNumber").GetString()!;var retained=await store.Read(wo,runtime.Generation);
        var package=JsonNode.Parse((retained.Bound?.FrozenPackage??source.Package).GetRawText())!.AsObject();
        var route=retained.Bound?.Operations??retained.Definition?.Operations??source.Operations;
        var errors=Validation(route,source,retained.Bound?.SourceToken??retained.Definition?.SourceToken);
        if(retained.Bound is null)errors.Add("An approved Traveler must be bound to this Work Order.");
        var material=source.Case?.State??"NEEDS_KITTING";var ready=material=="KIT_COMPLETE"&&retained.Bound is not null&&errors.Count==0;
        package["materialStatus"]=material;package["productionStatus"]=Status(material,ready);package["ready"]=ready;
        package["validationErrors"]=JsonSerializer.SerializeToNode(errors,Json);package["definition"]=JsonSerializer.SerializeToNode(retained.Definition,Json);
        package["boundTraveler"]=JsonSerializer.SerializeToNode(retained.Bound is null?null:new{retained.Bound.Id,retained.Bound.Version,retained.Bound.DefinitionId,
            retained.Bound.DefinitionVersion,retained.Bound.SourceToken,retained.Bound.ApprovedAt,retained.Bound.CreatedAt,retained.Bound.CreatedBy,retained.Bound.Operations},Json);
        package["operations"]=JsonSerializer.SerializeToNode(route.OrderBy(o=>o.Sequence),Json);package["history"]=JsonSerializer.SerializeToNode(retained.History,Json);
        package["canManage"]=actor.Can("production.manage");package["executionStarted"]=false;package["currentOperations"]=new JsonArray();
        var first=route.Where(o=>o.Classification=="PRODUCTION"&&o.Enabled).OrderBy(o=>o.Sequence).FirstOrDefault();
        package["firstOperation"]=first is null?null:JsonSerializer.SerializeToNode(new{first.Id,first.Sequence,first.Name,state=ready?"READY":"NOT_READY",executionState="NOT_STARTED",startAvailable=false},Json);
        return JsonSerializer.SerializeToElement(package,Json);
    }
    private static List<string> Validation(SimTravelerOperation[] route,SimProductionSource source,string? token)
    {
        var errors=new List<string>();
        if(token is not null&&token!=source.Token)errors.Add("The frozen source fingerprint changed; approval/binding requires source review.");
        if(route.Length!=source.Operations.Length||route.Select(o=>o.SourceOperationId).Distinct().Count()!=route.Length||route.Any(o=>!source.Operations.Any(s=>s.SourceOperationId==o.SourceOperationId)))errors.Add("All frozen source operations must remain represented exactly once.");
        if(route.Select(o=>o.Id).Distinct().Count()!=route.Length||route.Any(o=>string.IsNullOrWhiteSpace(o.Id)))errors.Add("Traveler operation identities must be stable and unique.");
        if(route.Any(o=>o.ExecutionState!="NOT_STARTED"))errors.Add("Traveler definition review must not create execution state.");
        if(route.Any(o=>o.Sequence<=0)||route.Select(o=>o.Sequence).Distinct().Count()!=route.Length)errors.Add("Operation sequence values must be positive and unique.");
        if(route.Any(o=>o.Classification=="UNCLASSIFIED"))errors.Add("Review source operations and explicitly classify Materials prerequisites.");
        if(!route.Any(o=>o.Classification=="PRODUCTION"&&o.Enabled))errors.Add("At least one active Production operation is required.");
        if(route.Any(o=>o.Classification=="MATERIALS_PREREQUISITE"&&(o.Enabled||string.IsNullOrWhiteSpace(o.ExclusionReason))))errors.Add("Materials prerequisites must remain explicitly excluded from active Production.");
        foreach(var op in route){var original=source.Operations.FirstOrDefault(o=>o.SourceOperationId==op.SourceOperationId);if(original is null)continue;
            if(op.Id!=original.Id||op.Name!=original.Name||op.Instructions!=original.Instructions||Hash(op.ProductionNotes)!=Hash(original.ProductionNotes)||Hash(op.Visuals)!=Hash(original.Visuals)||Hash(op.TechnicalReferences)!=Hash(original.TechnicalReferences)||Hash(op.EstimatingBasis)!=Hash(original.EstimatingBasis))
                errors.Add("Frozen source instructions, notes, estimating basis and verified references must be retained: "+op.SourceOperationId);
            if(!op.Enabled&&string.IsNullOrWhiteSpace(op.ExclusionReason))errors.Add("Disabled operations need an explicit exclusion reason.");
        }
        return errors;
    }
    internal Task<JsonElement> Seed(string wo,SimTravelerSeedRequest request,SimPersona actor)=>WithSource(wo,actor,true,async(source,runtime)=>{
        Require(request.SourceToken==source.Token,"traveler_source_changed","Refresh the frozen source before seeding.");
        var ids=request.MaterialsPrerequisiteSourceIds??[];
        Require(ids.Distinct().Count()==ids.Length&&ids.All(id=>source.Operations.Any(o=>o.SourceOperationId==id)),"traveler_prerequisite_identity","Select existing source operation identities for Materials prerequisites.");
        var route=source.Operations.Select(o=>o with{Classification=ids.Contains(o.SourceOperationId)?"MATERIALS_PREREQUISITE":"PRODUCTION",Enabled=!ids.Contains(o.SourceOperationId),
            ExclusionReason=ids.Contains(o.SourceOperationId)?"Reviewed Materials prerequisite; excluded from active Production route.":""}).ToArray();
        Require(Validation(route,source,source.Token).Count==0,"traveler_validation","Review valid operation classification before seeding.");
        await store.Change(SimKittingCases.Normalize(wo),runtime.Generation,async(c,t,d,b)=>{
            await ValidateCase(c,t,source,runtime);
            Require(d is null,"traveler_already_exists","This Work Order already has a governed Traveler Definition.");var now=UtcNow();
            var next=new SimTravelerDefinition(Guid.NewGuid(),SimKittingCases.Normalize(wo),runtime.Generation,1,1,"DRAFT",source.Token,route,null,null,actor.DisplayName,now,source.Package.GetProperty("source"));
            await SimProductionStore.Save(c,t,next);await Event(c,t,next,"SEEDED",actor,now,new{source.Token,materialsPrerequisiteSourceIds=ids,sourceOperations=route.Select(o=>o.SourceOperationId)});
        });return await View(source,runtime,actor);
    });
    internal Task<JsonElement> Lease(string wo,SimTravelerVersionRequest request,SimPersona actor)=>Change(wo,actor,async(c,t,d,b,s,now)=>{
        Version(d,request.ExpectedWorkingVersion);Require(d.Lease is null||d.Lease.ExpiresAt<=now||d.Lease.ActorId==actor.Id,"traveler_in_use","Another reviewer holds the Traveler editing lease.");
        var next=d with{WorkingVersion=d.WorkingVersion+1,Lease=new(Guid.NewGuid(),actor.Id,actor.DisplayName,now.AddMinutes(15))};
        await SimProductionStore.Save(c,t,next);await Event(c,t,next,"EDIT_LEASE_ACQUIRED",actor,now,new{previousOwner=d.Lease?.ActorId});
    });
    internal Task<JsonElement> Draft(string wo,SimTravelerDraftRequest request,SimPersona actor)=>Change(wo,actor,async(c,t,d,b,source,now)=>{
        Editable(d,request.ExpectedWorkingVersion,request.LeaseId,actor,now);
        Require(!string.IsNullOrWhiteSpace(request.Reason)&&request.Reason.Length<=2000,"traveler_reason_required","Record why the Traveler draft is being revised.");
        var edits=request.Operations??[];Require(edits.Length==d.Operations.Length&&edits.Select(o=>o.Id).Distinct().Count()==edits.Length&&edits.All(o=>d.Operations.Any(p=>p.Id==o.Id)),"traveler_operation_identity","Retain every source operation and its stable Traveler identity.");
        var route=d.Operations.Select(old=>{var edit=edits.Single(o=>o.Id==old.Id);
            Require((edit.Department?.Length??0)<=120&&(edit.WorkCenter?.Length??0)<=120&&(edit.ShopInstructions?.Length??0)<=8000&&(edit.ManagementNotes?.Length??0)<=4000&&(edit.InspectionRequirements?.Length??0)<=4000&&(edit.ExclusionReason?.Length??0)<=2000,"traveler_edit_size","Traveler fields exceed the supported length.");
            return old with{Sequence=edit.Sequence,Department=edit.Department?.Trim()??"",WorkCenter=edit.WorkCenter?.Trim()??"",ShopInstructions=edit.ShopInstructions?.Trim()??"",
                ManagementNotes=edit.ManagementNotes?.Trim()??"",InspectionRequirements=edit.InspectionRequirements?.Trim()??"",Enabled=edit.Enabled,ExclusionReason=edit.ExclusionReason?.Trim()??""};}).ToArray();
        var errors=Validation(route,source,d.SourceToken);Require(errors.Count==0,"traveler_validation",string.Join(" ",errors));
        var renewedLease=d.Lease! with{ExpiresAt=now.AddMinutes(15)};
        var next=d with{WorkingVersion=d.WorkingVersion+1,Version=d.Status=="APPROVED"?d.Version+1:d.Version,Status="DRAFT",Operations=route,Approval=null,Lease=renewedLease};
        await SimProductionStore.Save(c,t,next);await Event(c,t,next,"DRAFT_REVISED",actor,now,new{reason=request.Reason,boundTravelerUnchanged=b?.Id,priorVersion=d.Version,operations=route});
    });
    internal Task<JsonElement> Approve(string wo,SimTravelerApproveRequest request,SimPersona actor)=>Change(wo,actor,async(c,t,d,b,source,now)=>{
        Editable(d,request.ExpectedWorkingVersion,request.LeaseId,actor,now);Require(d.Status=="DRAFT","traveler_already_approved","This Traveler version is already approved.");
        var errors=Validation(d.Operations,source,d.SourceToken);Require(errors.Count==0,"traveler_validation",string.Join(" ",errors));
        var stamp=new SimTravelerApprovalStamp(actor.Id,actor.DisplayName,now,d.Version);
        var next=d with{WorkingVersion=d.WorkingVersion+1,Status="APPROVED",Approval=stamp,Lease=null};
        await SimProductionStore.Approve(c,t,new(d.Id,d.Version,d.SourceToken,d.Operations,stamp,d.Source));await SimProductionStore.Save(c,t,next);
        await Event(c,t,next,"APPROVED",actor,now,new{version=d.Version,contentHash=Hash(d.Operations)});
    });
    internal Task<JsonElement> Bind(string wo,SimTravelerBindRequest request,SimPersona actor)=>Change(wo,actor,async(c,t,d,b,source,now)=>{
        Version(d,request.ExpectedWorkingVersion);Require(b is null,"traveler_already_bound","This Work Order already has a frozen Traveler. Later changes require a governed amendment, which is outside this slice.");
        Require(d.Status=="APPROVED"&&d.Version==request.ApprovedVersion,"traveler_approval_required","Bind the current explicitly approved Traveler version.");
        Require(source.Case?.State=="KIT_COMPLETE"&&source.Submission?.SubmissionType=="KIT_COMPLETE","production_materials_required","A final governed Kit Complete release is required before binding the first WO Traveler.");
        var a=await SimProductionStore.Approval(c,t,d.Id,request.ApprovedVersion);Require(a is not null&&a.SourceToken==source.Token,"traveler_approval_required","The immutable approved version or its current frozen source is unavailable.");
        var errors=Validation(a!.Operations,source,a.SourceToken);Require(errors.Count==0,"traveler_validation",string.Join(" ",errors));
        var bound=new SimWoTraveler(Guid.NewGuid(),d.WorkOrderNumber,d.Generation,1,d.Id,a.Version,a.SourceToken,a.Operations,a.Approval.AtUtc,actor.DisplayName,now,source.Package);
        await SimProductionStore.Bind(c,t,bound);var next=d with{WorkingVersion=d.WorkingVersion+1};await SimProductionStore.Save(c,t,next);
        await Event(c,t,next,"WO_BOUND",actor,now,new{travelerId=bound.Id,bound.Version,definitionVersion=a.Version,source.Submission!.SubmissionId,executionStarted=false});
    });
    private Task<JsonElement> Change(string wo,SimPersona actor,Func<Microsoft.Data.Sqlite.SqliteConnection,Microsoft.Data.Sqlite.SqliteTransaction,SimTravelerDefinition,SimWoTraveler?,SimProductionSource,DateTimeOffset,Task> action)=>WithSource(wo,actor,true,async(source,runtime)=>{
        await store.Change(SimKittingCases.Normalize(wo),runtime.Generation,async(c,t,d,b)=>{
            await ValidateCase(c,t,source,runtime);
            Require(d is not null,"traveler_not_seeded","Seed a reviewed Traveler Definition first.");Require(d!.SourceToken==source.Token,"traveler_source_changed","The approved source changed; refresh and resolve lineage before editing.");
            await action(c,t,d,b,source,UtcNow());});return await View(source,runtime,actor);
    });
    private static async Task ValidateCase(Microsoft.Data.Sqlite.SqliteConnection c,Microsoft.Data.Sqlite.SqliteTransaction t,SimProductionSource source,SimStateMetadata runtime){
        if(source.Case is null)return;
        var current=await SimProductionStore.One<SimKittingCaseRecord>(c,t,"SimKittingCase",source.Case.WorkOrderNumber,runtime.Generation);
        Require(current is not null&&current.CaseId==source.Case.CaseId&&current.WorkingVersion==source.Case.WorkingVersion&&current.State==source.Case.State&&
            current.ReleasedBomIdentity==source.Case.ReleasedBomIdentity,"production_materials_changed","Materials changed while the Traveler was being reviewed. Reload before continuing.");
    }
    private static void Version(SimTravelerDefinition d,long expected)=>Require(d.WorkingVersion==expected,"traveler_version_changed","Another reviewer changed this Traveler. Reload before continuing.");
    private static void Editable(SimTravelerDefinition d,long version,Guid lease,SimPersona actor,DateTimeOffset now){Version(d,version);Require(d.Lease is not null&&d.Lease.Id==lease&&d.Lease.ActorId==actor.Id&&d.Lease.ExpiresAt>now,"traveler_lease_required","Acquire an active Traveler editing lease for this reviewer.");}
    private static Task Event(Microsoft.Data.Sqlite.SqliteConnection c,Microsoft.Data.Sqlite.SqliteTransaction t,SimTravelerDefinition d,string action,SimPersona actor,DateTimeOffset now,object detail)=>
        SimProductionStore.Event(c,t,new(Guid.NewGuid(),d.Id,d.WorkOrderNumber,d.Generation,action,d.WorkingVersion,actor.Id,actor.DisplayName,now,JsonSerializer.SerializeToElement(detail,Json)));
    internal Task<(byte[] Bytes,string Type,string Name)> Document(string wo,string id,bool visual,SimPersona actor)=>WithSource(wo,actor,false,async(source,runtime)=>{
        var view=await View(source,runtime,actor);var refs=visual?view.GetProperty("operations").EnumerateArray().SelectMany(o=>o.GetProperty("visuals").EnumerateArray()).ToArray():view.GetProperty("technicalDocuments").EnumerateArray().ToArray();
        var reference=refs.FirstOrDefault(r=>Text(r,"documentId")==id);Require(reference.ValueKind==JsonValueKind.Object,"production_document_scope","This verified document is not a reference in this Production package.");
        var bytes=await documents.Bytes(source.SourceCorrelationId,id);Require(Convert.ToHexString(SHA256.HashData(bytes))==Text(reference,"sha256"),"production_document_hash","The frozen document reference failed verification.");
        return(bytes,visual?Text(reference,"type"):"application/pdf",Text(reference,"name"));
    });
    internal Task<(byte[] Bytes,string Name)> KittingPdf(string wo,SimPersona actor)=>WithSource(wo,actor,false,async(source,runtime)=>{
        var view=await View(source,runtime,actor);var kitting=view.GetProperty("kitting");
        Require(Field(kitting,"submissionId").ValueKind==JsonValueKind.String,"production_final_kit","No governed Kitting submission is available.");
        return await operations.ReadSimKittingPdf(SimKittingCases.Normalize(wo),kitting.GetProperty("submissionId").GetGuid(),runtime);
    });
}
