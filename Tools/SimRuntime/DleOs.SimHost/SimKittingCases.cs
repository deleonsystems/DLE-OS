using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

// The shared pure draft rules use this exception boundary in both hosts. No DEV service or
// connection configuration is loaded into SIM.
internal sealed class KittingCaseProblem(int statusCode,string code,string message):Exception(message)
{
    internal int StatusCode{get;}=statusCode;
    internal string Code{get;}=code;
    internal static KittingCaseProblem BadRequest(string code,string message)=>new(400,code,message);
    internal static KittingCaseProblem Conflict(string code,string message)=>new(409,code,message);
    internal static KittingCaseProblem NotFound(string code,string message)=>new(404,code,message);
}
internal record SimKittingVersionRequest(long ExpectedWorkingVersion);
internal record SimKittingEditableRequest(long ExpectedWorkingVersion,Guid? EditingSessionId):SimKittingVersionRequest(ExpectedWorkingVersion);
internal sealed record SimKittingSaveRequest(long ExpectedWorkingVersion,Guid? EditingSessionId,JsonElement Draft):SimKittingEditableRequest(ExpectedWorkingVersion,EditingSessionId);
internal sealed record SimKittingTraceabilityRequest(long ExpectedWorkingVersion,Guid? EditingSessionId,bool PoTraceabilityRequired):SimKittingEditableRequest(ExpectedWorkingVersion,EditingSessionId);
internal sealed record SimKittingTraceabilityAmendmentRequest(Guid CaseId,long ExpectedWorkingVersion,
    Guid? EditingSessionId,bool? PoTraceabilityRequired,string? Reason):SimKittingEditableRequest(ExpectedWorkingVersion,EditingSessionId);
internal sealed record SimKittingTraceabilityAmendment(Guid AmendmentId,string Kind,Guid CaseId,
    bool OriginalRequired,bool PreviousEffectiveRequired,bool NewEffectiveRequired,string Reason,
    string ActorId,string Actor,DateTimeOffset AtUtc,long ExpectedWorkingVersion,long ResultingWorkingVersion,
    string ReleasedBomIdentity,int ReleasedBomVersion);
internal sealed record SimKittingStartRequest(string? CustomerNumber=null,string? OriginSalesOrderNumber=null,
    string? OriginSalesOrderLineNumber=null,string? AssemblyItemNumber=null,string? Revision=null,
    string? ReleasedBomIdentity=null,JsonElement? Draft=null);
internal sealed record SimKittingCaseRecord(Guid CaseId,string WorkOrderNumber,int RunNumber,
    string AssemblyItemNumber,string Revision,string ReleasedBomIdentity,int ReleasedBomVersion,string State,
    string StartedBy,DateTimeOffset StartedAtUtc,string LastOperator,DateTimeOffset LastWorkedAtUtc,
    Guid? EditingSessionId,string? EditingOwner,string? EditingActorId,DateTimeOffset? EditingAcquiredAtUtc,
    DateTimeOffset? EditingExpiresAtUtc,long WorkingVersion,bool PoTraceabilityRequired,
    int ActionableCount,int CompletedCount,int ShortRequirementCount,decimal TotalShortage,
    JsonElement Draft,JsonElement FrozenDraft,JsonElement Lineage,long Generation,
    [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    SimKittingTraceabilityAmendment? PoTraceabilityAmendment=null,
    [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    SimProductionBomCorrection? ProductionBomCorrection=null);
internal sealed record SimKittingEvent(Guid EventId,long Sequence,Guid CaseId,string EventType,string ActorId,
    string Actor,DateTimeOffset EventAtUtc,long WorkingVersion,JsonElement Detail);
internal sealed record SimKittingSubmission(Guid SubmissionId,Guid CaseId,string SubmissionType,int VersionNumber,
    string SnapshotJson,string SubmittedBy,DateTimeOffset SubmittedAtUtc,string PdfFileName,string PdfSha256);

internal sealed partial class SimKittingCases(SimStateStore state,SimOperationsDataStore operations,SimKittingRequirementsProvider provider)
{
    internal Func<DateTimeOffset> UtcNow {get;set;}=()=>DateTimeOffset.UtcNow;
    internal Func<Task>? BeforeStartCommitForTest {get;set;}
    private static readonly TimeSpan Lease=TimeSpan.FromMinutes(15);
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    internal static string Normalize(string value)=>Regex.IsMatch(value??"","^[0-9]{1,7}$")?value!.PadLeft(7,'0'):
        throw KittingCaseProblem.BadRequest("malformed_identifier","Work Order must contain one to seven digits.");
    private static void Permission(SimPersona actor,bool write)
    {if(!actor.Can(write?"kitting.disposition":"kitting.view"))throw new SimOrderEntryPermissionException();}

    internal async Task<object> Released(string wo,SimPersona actor)=>await state.WithStableRuntime(async runtime=>{
        Permission(actor,false);var release=await provider.ResolveAsync(Normalize(wo),runtime);
        return (object)new{supported=true,canEdit=actor.Can("kitting.disposition"),release.WorkOrderNumber,release.AssemblyItemNumber,
            release.Revision,release.BuildQuantity,release.ReleasedBomIdentity,release.ReleasedBomVersion,release.Draft,release.Lineage,
            release.PoTraceabilityRequired,environment="SIM"};
    });
    internal async Task<object> Read(string wo,SimPersona actor)=>await state.WithStableRuntime(async runtime=>{
        Permission(actor,false);wo=Normalize(wo);var current=await operations.ReadSimKittingCase(wo,runtime);
        if(current is not null)return Wrap(current,actor,true);
        var supported=false;
        try{await provider.ResolveAsync(wo,runtime);supported=true;}catch(SimRfqIntakeProblem){}
        var legacy=await operations.ReadKittingCaseAsync(wo,runtime.Generation);
        if(!supported&&legacy is null)throw KittingCaseProblem.NotFound("kitting_case_not_found","No supported or retained Kitting case exists for this Work Order.");
        var value=legacy is null?new Dictionary<string,object?>():JsonSerializer.Deserialize<Dictionary<string,object?>>(JsonSerializer.Serialize(legacy,Json),Json)!;
        value["workOrderNumber"]=wo;value["capabilities"]=new{supported,canEdit=supported&&actor.Can("kitting.disposition"),canAmendPoTraceability=false};
        value["readOnly"]=!supported||!actor.Can("kitting.disposition");value["environment"]="SIM";
        value.TryAdd("kittingCase",null);value.TryAdd("hasPersistentKittingHistory",false);return (object)value;
    });
    private object Wrap(SimKittingCaseRecord current,SimPersona actor,bool supported)=>new{
        workOrderNumber=current.WorkOrderNumber,kittingCase=View(current,actor),hasPersistentKittingHistory=true,
        legacyMaterialStatus=(object?)null,capabilities=new{supported,canEdit=supported&&actor.Can("kitting.disposition")&&current.State!="KIT_COMPLETE",
            canAmendPoTraceability=supported&&CanAmend(current,actor)},
        readOnly=!supported||!actor.Can("kitting.disposition"),environment="SIM",generation=current.Generation};
    private static bool CanAmend(SimKittingCaseRecord c,SimPersona actor)=>c.State!="KIT_COMPLETE"&&
        actor.Can("kitting.disposition")&&actor.Can("kitting.traceability.amend")&&OriginalPolicy(c) is not null;
    internal static bool? OriginalPolicy(SimKittingCaseRecord c)=>c.FrozenDraft.ValueKind==JsonValueKind.Object&&c.FrozenDraft.TryGetProperty("poTraceabilityRequired",out var value)&&
        value.ValueKind is JsonValueKind.True or JsonValueKind.False?value.GetBoolean():null;
    internal object View(SimKittingCaseRecord c,SimPersona? actor=null)=>Contract(c,UtcNow(),actor is not null&&CanAmend(c,actor));
    internal static object Contract(SimKittingCaseRecord c,DateTimeOffset now,bool canAmendPoTraceability=false)=>new{c.CaseId,c.WorkOrderNumber,c.RunNumber,isActiveRun=true,c.AssemblyItemNumber,c.Revision,
        c.ReleasedBomIdentity,c.ReleasedBomVersion,c.State,c.StartedBy,c.StartedAtUtc,c.LastOperator,c.LastWorkedAtUtc,c.EditingSessionId,
        c.EditingOwner,c.EditingAcquiredAtUtc,c.EditingExpiresAtUtc,c.WorkingVersion,c.ActionableCount,c.CompletedCount,c.ShortRequirementCount,
        c.TotalShortage,c.PoTraceabilityRequired,originalPoTraceabilityRequired=OriginalPolicy(c),c.PoTraceabilityAmendment,canAmendPoTraceability,
        isEditing=c.EditingSessionId is not null&&c.EditingExpiresAtUtc>now,c.Draft,c.Lineage};

    internal async Task<object> Start(string wo,SimKittingStartRequest request,SimPersona actor)=>await state.WithStableRuntime(async runtime=>{
        Permission(actor,true);wo=Normalize(wo);
        return await provider.WithReleasedRequirements<object>(wo,runtime,async release=>{
        if(request.ReleasedBomIdentity is not null&&request.ReleasedBomIdentity!=release.ReleasedBomIdentity ||
            request.AssemblyItemNumber is not null&&request.AssemblyItemNumber!=release.AssemblyItemNumber ||
            request.Revision is not null&&request.Revision!=release.Revision)
            throw KittingCaseProblem.Conflict("released_requirements_changed","Refresh the current released requirements before starting.");
        if(request.Draft is {} submitted)RequireFrozen(release.Draft,submitted);
        var header=release.Draft.GetProperty("header");
        foreach(var pair in new[]{(request.CustomerNumber,"customerNumber"),(request.OriginSalesOrderNumber,"salesOrder"),(request.OriginSalesOrderLineNumber,"salesOrderLine")})
            if(pair.Item1 is not null&&pair.Item1!=header.GetProperty(pair.Item2).GetString())throw KittingCaseProblem.Conflict("canonical_order_changed","Selected order anchors do not match this canonical Work Order.");
        var now=UtcNow();var draft=Stamp(release.Draft,release.Draft,actor,now);
        var validation=KittingDraftValidator.Validate(draft,wo,false,release.PoTraceabilityRequired);
        var record=new SimKittingCaseRecord(Guid.NewGuid(),wo,1,release.AssemblyItemNumber,release.Revision,
            release.ReleasedBomIdentity,release.ReleasedBomVersion,"KITTING_IN_PROGRESS",actor.DisplayName,now,actor.DisplayName,now,
            Guid.NewGuid(),actor.DisplayName,actor.Id,now,now+Lease,1,release.PoTraceabilityRequired,validation.ActionableCount,0,0,0,
            draft,release.Draft.Clone(),release.Lineage.Clone(),runtime.Generation);
        if(BeforeStartCommitForTest is not null)await BeforeStartCommitForTest();
        record=await operations.StartSimKittingCase(record,runtime,actor);
        return View(record,actor);
        });
    });
    internal Task<object> Resume(string wo,SimKittingVersionRequest request,SimPersona actor)=>Change(wo,actor,(c,now)=>{
        Version(c,request);if(c.State=="KIT_COMPLETE")throw KittingCaseProblem.Conflict("kitting_case_complete","Kit Complete is read-only.");
        if(c.EditingSessionId is not null&&c.EditingExpiresAtUtc>now)throw KittingCaseProblem.Conflict("kitting_case_in_use","An active editing lease already exists.");
        var action=c.EditingSessionId is null?"EDITING_ACQUIRED":"STALE_LEASE_RECOVERED";
        return(c with{EditingSessionId=Guid.NewGuid(),EditingOwner=actor.DisplayName,EditingActorId=actor.Id,EditingAcquiredAtUtc=now,EditingExpiresAtUtc=now+Lease},action,(object)new{previousOwner=c.EditingOwner});
    });
    internal Task<object> Save(string wo,SimKittingSaveRequest request,SimPersona actor,bool exit=false)=>Change(wo,actor,(c,now)=>{
        Editable(c,request,actor,now);RequireFrozen(c.FrozenDraft,request.Draft);ProtectMaterialEvidence(c.Draft,request.Draft);
        KittingDraftValidator.Validate(request.Draft,c.WorkOrderNumber,false,c.PoTraceabilityRequired,true);
        var draft=Stamp(request.Draft,c.Draft,actor,now);var validation=KittingDraftValidator.Validate(draft,c.WorkOrderNumber,false,c.PoTraceabilityRequired,true);
        return(c with{Draft=draft,ActionableCount=validation.ActionableCount,CompletedCount=validation.CompletedCount,ShortRequirementCount=validation.ShortCount,
            TotalShortage=validation.TotalShortage,EditingSessionId=exit?null:c.EditingSessionId,EditingOwner=exit?null:c.EditingOwner,
            EditingActorId=exit?null:c.EditingActorId,EditingAcquiredAtUtc=exit?null:c.EditingAcquiredAtUtc,EditingExpiresAtUtc=exit?null:now+Lease},
            exit?"SAVE_EXIT":"AUTOSAVED",(object)new{validation.ActionableCount,validation.CompletedCount,draftHash=Hash(draft)});
    });
    internal Task<object> Abandon(string wo,SimKittingEditableRequest request,SimPersona actor)=>Change(wo,actor,(c,now)=>{
        Editable(c,request,actor,now);return(c with{EditingSessionId=null,EditingOwner=null,EditingActorId=null,EditingAcquiredAtUtc=null,EditingExpiresAtUtc=null},"EDITING_ABANDONED",(object)new{draftSaved=false});
    });
    internal Task<object> Traceability(string wo,SimKittingTraceabilityRequest request,SimPersona actor)
    {
        Permission(actor,true);
        throw KittingCaseProblem.Conflict("po_traceability_amendment_required","PO traceability can only be changed through an authorized reviewed amendment with a reason.");
    }
    internal Task<object> AmendTraceability(string wo,SimKittingTraceabilityAmendmentRequest request,SimPersona actor)
    {
        Permission(actor,true);
        if(!actor.Can("kitting.traceability.amend"))throw new SimOrderEntryPermissionException();
        if(request.CaseId==Guid.Empty||request.PoTraceabilityRequired is null)
            throw KittingCaseProblem.BadRequest("po_traceability_amendment_required_fields","Select the existing case and explicitly choose the reviewed PO traceability requirement.");
        var reason=request.Reason?.Trim()??"";
        if(reason.Length is <1 or >4000)
            throw KittingCaseProblem.BadRequest("po_traceability_amendment_reason","A reviewed amendment requires a reason of 1 to 4000 characters.");
        return Change(wo,actor,(c,now)=>{
            Editable(c,request,actor,now);
            if(c.CaseId!=request.CaseId)throw KittingCaseProblem.Conflict("kitting_case_identity_changed","The reviewed amendment targets a different Kitting case. Reload before continuing.");
            var required=request.PoTraceabilityRequired.Value;
            if(c.PoTraceabilityRequired==required)
                throw KittingCaseProblem.Conflict("po_traceability_amendment_no_change","The reviewed requirement already matches the effective policy; no amendment was recorded.");
            var original=OriginalPolicy(c)??throw KittingCaseProblem.Conflict("po_traceability_original_unknown","The frozen original requirement is unavailable; this case cannot use the reviewed amendment command.");
            // Validate existing evidence under the proposed policy without changing any row,
            // source requirement, frozen release, original lineage or retained submission.
            KittingDraftValidator.Validate(c.Draft,c.WorkOrderNumber,false,required);
            var amendment=new SimKittingTraceabilityAmendment(Guid.NewGuid(),"REVIEWED_AMENDMENT",c.CaseId,
                original,c.PoTraceabilityRequired,required,reason,actor.Id,actor.DisplayName,now,
                c.WorkingVersion,c.WorkingVersion+1,c.ReleasedBomIdentity,c.ReleasedBomVersion);
            return(c with{PoTraceabilityRequired=required,PoTraceabilityAmendment=amendment,EditingExpiresAtUtc=now+Lease},
                "PO_TRACEABILITY_CHANGED",(object)amendment);
        });
    }
    private async Task<object> Change(string wo,SimPersona actor,Func<SimKittingCaseRecord,DateTimeOffset,(SimKittingCaseRecord Record,string Action,object Detail)> mutate)=>
        await state.WithStableRuntime(async runtime=>{Permission(actor,true);wo=Normalize(wo);
            return View(await operations.ChangeSimKittingCase(wo,runtime,actor,UtcNow(),mutate),actor);});
    private static void Version(SimKittingCaseRecord c,SimKittingVersionRequest request){if(c.WorkingVersion!=request.ExpectedWorkingVersion)throw KittingCaseProblem.Conflict("kitting_case_version_changed","The case changed. Reload its latest saved state.");}
    internal static void Editable(SimKittingCaseRecord c,SimKittingEditableRequest request,SimPersona actor,DateTimeOffset now){Version(c,request);
        if(c.State=="KIT_COMPLETE")throw KittingCaseProblem.Conflict("kitting_case_complete","Kit Complete is read-only.");
        if(request.EditingSessionId is null||request.EditingSessionId!=c.EditingSessionId||c.EditingActorId!=actor.Id||c.EditingExpiresAtUtc<=now)
            throw KittingCaseProblem.Conflict("editing_lease_required","The editing lease is absent, expired, or owned by another user.");}
    internal static void RequireFrozen(JsonElement frozen,JsonElement submitted)
    {
        if(Structure(frozen).ToJsonString()!=Structure(submitted).ToJsonString())throw KittingCaseProblem.Conflict("released_requirements_immutable","Required parts, quantities, references, alternatives and source lineage cannot be edited.");
    }
    private static JsonNode Structure(JsonElement value)
    {
        var root=JsonNode.Parse(value.GetRawText())?.AsObject()??throw KittingCaseProblem.BadRequest("draft_required","A valid draft is required.");
        root.Remove("employeeName");
        if(root["groups"] is not JsonArray groups)throw KittingCaseProblem.BadRequest("requirements_required","Requirement groups are required.");
        foreach(var group in groups){var row=group!.AsObject();foreach(var key in new[]{"entry","rowState","revisionNumber","lastSubmittedBy","lastSubmittedAtUtc"})row.Remove(key);}
        return Sort(root);
    }
    private static JsonNode Sort(JsonNode node)=>node switch{JsonObject o=>new JsonObject(o.OrderBy(x=>x.Key,StringComparer.Ordinal).Select(x=>KeyValuePair.Create(x.Key,x.Value is null?null:Sort(x.Value))).ToArray()),JsonArray a=>new JsonArray(a.Select(x=>x is null?null:Sort(x)).ToArray()),
        JsonValue v when v.TryGetValue<JsonElement>(out var e)&&e.ValueKind==JsonValueKind.Number&&e.TryGetDecimal(out var number)=>JsonNode.Parse(number.ToString("G29",CultureInfo.InvariantCulture))!,_=>node.DeepClone()};
    private static string Hash(JsonElement value)=>Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Sort(JsonNode.Parse(value.GetRawText())!).ToJsonString())));
    internal static JsonElement Stamp(JsonElement value,JsonElement previous,SimPersona actor,DateTimeOffset now)
    {
        var node=JsonNode.Parse(value.GetRawText())!;node["employeeName"]=actor.DisplayName;
        var old=JsonNode.Parse(previous.GetRawText())!["groups"]!.AsArray();var groups=node["groups"]!.AsArray();
        for(var i=0;i<groups.Count;i++){
            var group=groups[i]!.AsObject();var prior=old[i]!.AsObject();var rowState=group["rowState"]?.ToString();
            if(rowState is not("EDITING" or "SUBMITTED"))throw KittingCaseProblem.BadRequest("kitting_row_state_invalid","Row state must be Editing or Submitted.");
            var submitted=rowState=="SUBMITTED";
            if(group["entry"] is null&&submitted)throw KittingCaseProblem.BadRequest("kitting_entry_required","A submitted row requires execution evidence.");
            if(group["actionable"]?.GetValue<bool>()!=true&&(group["entry"] is not null||submitted))throw KittingCaseProblem.BadRequest("nonactionable_execution","Nonactionable requirements cannot carry execution evidence.");
            var changed=Execution(group["entry"])?.ToJsonString()!=Execution(prior["entry"])?.ToJsonString();
            foreach(var key in new[]{"lastSubmittedBy","lastSubmittedAtUtc"}){group.Remove(key);if(prior[key] is {} previousValue)group[key]=previousValue.DeepClone();}
            var revision=int.TryParse(prior["revisionNumber"]?.ToString(),out var parsed)?parsed:0;
            group["revisionNumber"]=revision;
            if(submitted&&(changed||prior["rowState"]?.ToString()!="SUBMITTED")){
                group["lastSubmittedBy"]=actor.DisplayName;group["lastSubmittedAtUtc"]=now;group["revisionNumber"]=revision+1;
            }
            if(group["entry"] is null)continue;
            if(!changed){group["entry"]=prior["entry"]!.DeepClone();continue;}
            var entry=group["entry"]!;entry["evidenceOperator"]=actor.DisplayName;entry["evidenceAtUtc"]=now;
            if(entry["allocations"] is JsonArray allocations)foreach(var allocation in allocations){
                var priorAllocation=(prior["entry"]?["allocations"] as JsonArray)?.FirstOrDefault(x=>x?["allocationId"]?.ToString()==allocation?["allocationId"]?.ToString());
                if(Execution(allocation)?.ToJsonString()==Execution(priorAllocation)?.ToJsonString()&&priorAllocation is not null){
                    allocation!["evidenceOperator"]=priorAllocation["evidenceOperator"]?.DeepClone();allocation["evidenceAtUtc"]=priorAllocation["evidenceAtUtc"]?.DeepClone();
                }else{allocation!["evidenceOperator"]=actor.DisplayName;allocation["evidenceAtUtc"]=now;}
            }
            // Derived displayed totals never trust a caller's picked/extra/result claims.
            if(entry["method"]?.ToString()=="COUNT"){
                var countedAllocations=entry["allocations"] as JsonArray;decimal total=0;var valid=countedAllocations is {Count:>0};
                var eligible=group["eligibleParts"]!.AsArray().Select(x=>x!.ToString()).ToHashSet(StringComparer.OrdinalIgnoreCase);
                if(countedAllocations is not null)foreach(var a in countedAllocations){if(!decimal.TryParse(a?["quantity"]?.ToString(),NumberStyles.Number,CultureInfo.InvariantCulture,out var qty)||qty<0||!eligible.Contains(a?["partNumber"]?.ToString()??""))valid=false;else total+=qty;}
                var required=decimal.Parse(group["requiredQuantity"]!.ToString(),CultureInfo.InvariantCulture);
                entry["pickedQuantity"]=valid?JsonValue.Create(total):null;entry["shortageQuantity"]=valid?JsonValue.Create(Math.Max(required-total,0)):null;
                entry["extraQuantity"]=valid?JsonValue.Create(Math.Max(total-required,0)):null;entry["result"]=!valid?"COUNT_REQUIRED":total<required?"COUNTED_SHORT":total>required?"COUNTED_EXTRA":"COUNTED_EXACT";
            }else{entry["pickedQuantity"]=null;entry["shortageQuantity"]=0;entry["extraQuantity"]=null;entry["result"]=entry["method"]?.ToString()=="COMPLETE_MIN_EXTRA"?"COMPLETE_MIN_EXTRA":"COMPLETE";}
        }
        return JsonSerializer.SerializeToElement(node,Json);
    }
    private static JsonNode? Execution(JsonNode? source)
    {
        if(source is null)return null;var node=source.DeepClone();
        if(node is JsonObject obj){obj.Remove("evidenceOperator");obj.Remove("evidenceAtUtc");if(obj["allocations"] is JsonArray allocations)
            for(var i=0;i<allocations.Count;i++)allocations[i]=Execution(allocations[i]);}
        return Sort(node);
    }
    private static void RejectUnsupportedReceipt(JsonElement draft)
    {
        foreach(var group in draft.GetProperty("groups").EnumerateArray()){
            if(!group.TryGetProperty("entry",out var entry)||entry.ValueKind!=JsonValueKind.Object)continue;
            static bool Has(JsonElement element)=>element.TryGetProperty("acceptedMaterial",out var material)&&material.ValueKind is not(JsonValueKind.Null or JsonValueKind.Undefined);
            if(Has(entry)||(entry.TryGetProperty("allocations",out var allocations)&&allocations.ValueKind==JsonValueKind.Array&&allocations.EnumerateArray().Any(Has)))
                throw KittingCaseProblem.BadRequest("sim_receipt_evidence_unavailable","Canonical SIM accepted-receipt evidence is not available. Do not supply an unverified receipt identity.");
        }
    }
    internal Task<object> History(string wo,SimPersona actor)=>state.WithStableRuntime(async runtime=>{Permission(actor,false);return (object)new{workOrderNumber=Normalize(wo),events=await operations.ReadSimKittingEvents(Normalize(wo),runtime)};});
    internal Task<object> Submissions(string wo,SimPersona actor)=>state.WithStableRuntime(async runtime=>{Permission(actor,false);return (object)new{workOrderNumber=Normalize(wo),submissions=await operations.ReadSimKittingSubmissions(Normalize(wo),runtime)};});
    internal async Task<object> Submit(string wo,SimKittingSaveRequest request,SimPersona actor)=>await state.WithStableRuntime(async runtime=>{
        Permission(actor,true);wo=Normalize(wo);var result=await operations.SubmitSimKittingCase(wo,runtime,actor,UtcNow(),c=>{
            Editable(c,request,actor,UtcNow());RequireFrozen(c.FrozenDraft,request.Draft);ProtectMaterialEvidence(c.Draft,request.Draft);
            KittingDraftValidator.Validate(request.Draft,wo,true,c.PoTraceabilityRequired,true);
            var draft=Stamp(request.Draft,c.Draft,actor,UtcNow());var valid=KittingDraftValidator.Validate(draft,wo,true,c.PoTraceabilityRequired,true);
            return c with{Draft=draft,ActionableCount=valid.ActionableCount,CompletedCount=valid.CompletedCount,ShortRequirementCount=valid.ShortCount,TotalShortage=valid.TotalShortage};
        });return View(result,actor);
    });
    internal Task<(byte[] Bytes,string Name)> Pdf(string wo,Guid id,SimPersona actor)=>state.WithStableRuntime(async runtime=>{Permission(actor,false);return await operations.ReadSimKittingPdf(Normalize(wo),id,runtime);});
}

internal sealed partial class SimOperationsDataStore
{
    private static readonly JsonSerializerOptions KittingJson=new(JsonSerializerDefaults.Web);
    private const string KittingSchema="""
CREATE TABLE IF NOT EXISTS SimKittingCase(CaseId TEXT PRIMARY KEY,WorkOrderNumber TEXT NOT NULL UNIQUE,ReleasedBomIdentity TEXT NOT NULL,Generation INTEGER NOT NULL,PayloadJson TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS SimKittingCaseEvent(EventSequence INTEGER PRIMARY KEY AUTOINCREMENT,EventId TEXT NOT NULL UNIQUE,CaseId TEXT NOT NULL,
 EventType TEXT NOT NULL CHECK(EventType IN ('STARTED','EDITING_ACQUIRED','STALE_LEASE_RECOVERED','AUTOSAVED','SAVE_EXIT','EDITING_ABANDONED','PO_TRACEABILITY_CHANGED','SUBMITTED_KIT_SHORT','SUBMITTED_KIT_COMPLETE')),
 ActorId TEXT NOT NULL,Actor TEXT NOT NULL,EventAtUtc TEXT NOT NULL,WorkingVersion INTEGER NOT NULL,DetailJson TEXT NOT NULL,FOREIGN KEY(CaseId) REFERENCES SimKittingCase(CaseId));
CREATE TABLE IF NOT EXISTS SimKittingSubmission(SubmissionId TEXT PRIMARY KEY,CaseId TEXT NOT NULL,SubmissionType TEXT NOT NULL,VersionNumber INTEGER NOT NULL,
 PayloadJson TEXT NOT NULL,PdfBytes BLOB NOT NULL,PdfSha256 TEXT NOT NULL,UNIQUE(CaseId,SubmissionType,VersionNumber),FOREIGN KEY(CaseId) REFERENCES SimKittingCase(CaseId));
CREATE TRIGGER IF NOT EXISTS SimKittingEventNoUpdate BEFORE UPDATE ON SimKittingCaseEvent BEGIN SELECT RAISE(ABORT,'Kitting history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS SimKittingEventNoDelete BEFORE DELETE ON SimKittingCaseEvent BEGIN SELECT RAISE(ABORT,'Kitting history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS SimKittingSubmissionNoUpdate BEFORE UPDATE ON SimKittingSubmission BEGIN SELECT RAISE(ABORT,'Kitting submissions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS SimKittingSubmissionNoDelete BEFORE DELETE ON SimKittingSubmission BEGIN SELECT RAISE(ABORT,'Kitting submissions are immutable'); END;
""";

    internal async Task<SimKittingCaseRecord?> ReadSimKittingCase(string wo,SimStateMetadata runtime)
    {
        EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadOnly();await connection.OpenAsync();
        await ValidatePacketDatabaseAsync(connection,null,runtime);return await ReadSimKittingCase(connection,null,wo,runtime.Generation);
    }
    private static async Task<SimKittingCaseRecord?> ReadSimKittingCase(SqliteConnection connection,SqliteTransaction? transaction,string wo,long generation)
    {
        if(!await PacketExistsAsync(connection,transaction,"SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='SimKittingCase';"))return null;
        await using var command=connection.CreateCommand();command.Transaction=transaction;command.CommandText="SELECT PayloadJson FROM SimKittingCase WHERE WorkOrderNumber=@wo;";command.Parameters.AddWithValue("@wo",wo);
        if(await command.ExecuteScalarAsync() is not string json)return null;
        var result=JsonSerializer.Deserialize<SimKittingCaseRecord>(json,KittingJson)!;
        if(result.Generation!=generation)throw KittingCaseProblem.Conflict("sim_kitting_generation","Kitting case belongs to another SIM generation.");
        return result;
    }
    internal async Task<SimKittingCaseRecord> StartSimKittingCase(SimKittingCaseRecord record,SimStateMetadata runtime,SimPersona actor)
    {
        await gate.WaitAsync();try{
            EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadWrite();await connection.OpenAsync();
            await using var transaction=connection.BeginTransaction();await ValidatePacketDatabaseAsync(connection,transaction,runtime);
            var existing=await ReadSimKittingCase(connection,transaction,record.WorkOrderNumber,runtime.Generation);
            if(existing is not null){
                if(existing.ReleasedBomIdentity!=record.ReleasedBomIdentity)throw KittingCaseProblem.Conflict("kitting_case_already_exists","A case is already bound to different frozen requirements.");
                return existing;
            }
            await ExecuteAsync(connection,transaction,KittingSchema);
            await ExecuteAsync(connection,transaction,"INSERT INTO SimKittingCase VALUES(@id,@wo,@identity,@generation,@json);",
                ("@id",record.CaseId.ToString()),("@wo",record.WorkOrderNumber),("@identity",record.ReleasedBomIdentity),("@generation",runtime.Generation),("@json",JsonSerializer.Serialize(record,KittingJson)));
            await KittingEvent(connection,transaction,record,"STARTED",actor,record.StartedAtUtc,new{record.ReleasedBomIdentity,record.ReleasedBomVersion,
                record.ActionableCount,governingDisposition="NEEDS_KITTING",dispositionSource="CANONICAL_ELIGIBILITY",record.Lineage});
            await transaction.CommitAsync();return record;
        }finally{gate.Release();}
    }
    internal async Task<SimKittingCaseRecord> ChangeSimKittingCase(string wo,SimStateMetadata runtime,SimPersona actor,DateTimeOffset now,
        Func<SimKittingCaseRecord,DateTimeOffset,(SimKittingCaseRecord Record,string Action,object Detail)> mutate)
    {
        await gate.WaitAsync();try{
            EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadWrite();await connection.OpenAsync();
            await using var transaction=connection.BeginTransaction();await ValidatePacketDatabaseAsync(connection,transaction,runtime);
            var current=await ReadSimKittingCase(connection,transaction,wo,runtime.Generation)??throw KittingCaseProblem.NotFound("kitting_case_not_found","No SIM Kitting case exists for this Work Order.");
            var change=mutate(current,now);var next=change.Record with{WorkingVersion=current.WorkingVersion+1,LastOperator=actor.DisplayName,LastWorkedAtUtc=now};
            await SaveKittingRecord(connection,transaction,next);await KittingEvent(connection,transaction,next,change.Action,actor,now,change.Detail);
            await transaction.CommitAsync();return next;
        }finally{gate.Release();}
    }
    private static Task SaveKittingRecord(SqliteConnection connection,SqliteTransaction transaction,SimKittingCaseRecord record)=>
        ExecuteAsync(connection,transaction,"UPDATE SimKittingCase SET PayloadJson=@json WHERE CaseId=@id;",("@json",JsonSerializer.Serialize(record,KittingJson)),("@id",record.CaseId.ToString()));
    private static Task KittingEvent(SqliteConnection connection,SqliteTransaction transaction,SimKittingCaseRecord record,
        string action,SimPersona actor,DateTimeOffset now,object detail)=>ExecuteAsync(connection,transaction,
            "INSERT INTO SimKittingCaseEvent(EventId,CaseId,EventType,ActorId,Actor,EventAtUtc,WorkingVersion,DetailJson) VALUES(@event,@case,@type,@actorId,@actor,@at,@version,@detail);",
            ("@event",Guid.NewGuid().ToString()),("@case",record.CaseId.ToString()),("@type",action),("@actorId",actor.Id),("@actor",actor.DisplayName),
            ("@at",now.ToString("O",CultureInfo.InvariantCulture)),("@version",record.WorkingVersion),("@detail",JsonSerializer.Serialize(detail,KittingJson)));
    internal async Task<SimKittingEvent[]> ReadSimKittingEvents(string wo,SimStateMetadata runtime)
    {
        EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadOnly();await connection.OpenAsync();await ValidatePacketDatabaseAsync(connection,null,runtime);
        var current=await ReadSimKittingCase(connection,null,wo,runtime.Generation);if(current is null)return [];
        await using var command=connection.CreateCommand();command.CommandText="SELECT EventId,EventSequence,CaseId,EventType,ActorId,Actor,EventAtUtc,WorkingVersion,DetailJson FROM SimKittingCaseEvent WHERE CaseId=@case ORDER BY EventSequence;";command.Parameters.AddWithValue("@case",current.CaseId.ToString());
        var events=new List<SimKittingEvent>();await using var reader=await command.ExecuteReaderAsync();while(await reader.ReadAsync())events.Add(new(Guid.Parse(reader.GetString(0)),reader.GetInt64(1),Guid.Parse(reader.GetString(2)),reader.GetString(3),reader.GetString(4),reader.GetString(5),DateTimeOffset.Parse(reader.GetString(6),CultureInfo.InvariantCulture),reader.GetInt64(7),JsonDocument.Parse(reader.GetString(8)).RootElement.Clone()));return events.ToArray();
    }
    internal async Task<SimKittingSubmission[]> ReadSimKittingSubmissions(string wo,SimStateMetadata runtime)
    {
        EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadOnly();await connection.OpenAsync();await ValidatePacketDatabaseAsync(connection,null,runtime);
        var current=await ReadSimKittingCase(connection,null,wo,runtime.Generation);if(current is null)return [];
        await using var command=connection.CreateCommand();command.CommandText="SELECT PayloadJson FROM SimKittingSubmission WHERE CaseId=@case ORDER BY VersionNumber;";command.Parameters.AddWithValue("@case",current.CaseId.ToString());
        var submissions=new List<SimKittingSubmission>();await using var reader=await command.ExecuteReaderAsync();while(await reader.ReadAsync())submissions.Add(JsonSerializer.Deserialize<SimKittingSubmission>(reader.GetString(0),KittingJson)!);return submissions.ToArray();
    }
    internal async Task<SimKittingCaseRecord> SubmitSimKittingCase(string wo,SimStateMetadata runtime,SimPersona actor,DateTimeOffset now,
        Func<SimKittingCaseRecord,SimKittingCaseRecord> validate)
    {
        await gate.WaitAsync();try{
            EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadWrite();await connection.OpenAsync();
            await using var transaction=connection.BeginTransaction();await ValidatePacketDatabaseAsync(connection,transaction,runtime);
            var current=await ReadSimKittingCase(connection,transaction,wo,runtime.Generation)??throw KittingCaseProblem.NotFound("kitting_case_not_found","No case exists.");
            var prepared=validate(current);var type=prepared.ShortRequirementCount>0?"KIT_SHORT":"KIT_COMPLETE";
            await using var command=connection.CreateCommand();command.Transaction=transaction;command.CommandText="SELECT COALESCE(MAX(VersionNumber),0)+1 FROM SimKittingSubmission WHERE CaseId=@case AND SubmissionType=@type;";
            command.Parameters.AddWithValue("@case",current.CaseId.ToString());command.Parameters.AddWithValue("@type",type);var version=Convert.ToInt32(await command.ExecuteScalarAsync());
            var earlier=await PurchasingRows<SimKittingSubmission>(connection,transaction,"SimKittingSubmission");
            var predecessor=earlier.Where(s=>s.CaseId==current.CaseId).OrderByDescending(s=>s.SubmittedAtUtc).ThenByDescending(s=>s.VersionNumber).FirstOrDefault();
            var applications=ActiveApplications(await PurchasingRows<SimKittingMaterialEvent>(connection,transaction,"SimKittingMaterialEvent")).Where(e=>e.CaseId==current.CaseId).ToArray();
            var applicationIds=applications.Select(e=>e.EventId).ToArray();
            var id=Guid.NewGuid();var snapshot=JsonSerializer.Serialize(new{schemaVersion=2,submissionId=id,current.CaseId,current.RunNumber,workOrderNumber=wo,current.AssemblyItemNumber,current.Revision,
                predecessorSubmissionId=predecessor?.SubmissionId,applicationIds,applications,
                predecessorDraft=predecessor is null?(JsonElement?)null:JsonDocument.Parse(predecessor.SnapshotJson).RootElement.GetProperty("draft").Clone(),
                current.ReleasedBomIdentity,submissionType=type,versionNumber=version,submittedBy=actor.DisplayName,submittedAtUtc=now,current.PoTraceabilityRequired,
                originalPoTraceabilityRequired=SimKittingCases.OriginalPolicy(current),current.PoTraceabilityAmendment,draft=prepared.Draft,current.Lineage},KittingJson);
            var bytes=KittingCasePdfWriter.Create(snapshot);var hash=Convert.ToHexString(SHA256.HashData(bytes));var name=$"WO{wo}_{type.Replace('_','-')}_V{version:000}.pdf";
            var receipt=new SimKittingSubmission(id,current.CaseId,type,version,snapshot,actor.DisplayName,now,name,hash);
            if(predecessor is not null) {
                await EnsureKittingMaterialSchema(connection,transaction);
                foreach(var demand in (await PurchasingRows<SimPurchasingDemand>(connection,transaction,"SimPurchasingDemand")).Where(d=>d.CaseId==current.CaseId)) {
                    var row=prepared.Draft.GetProperty("groups").EnumerateArray().Single(g=>PurchasingText(g,"sourceRowId")==demand.SourceRowId);
                    var reconciliation=new SimKittingDemandReconciliation(Guid.NewGuid(),demand.DemandId,current.CaseId,demand.SubmissionId,predecessor.SubmissionId,id,
                        demand.ShortQuantity,Number(Field(row,"entry"),"shortageQuantity"),applications.Where(e=>e.DemandId==demand.DemandId).Select(e=>e.EventId).ToArray(),actor.Id,now,current.WorkingVersion+1);
                    await ExecuteAsync(connection,transaction,"INSERT INTO SimKittingDemandReconciliation VALUES(@id,@json)",("@id",reconciliation.Id.ToString()),("@json",JsonSerializer.Serialize(reconciliation,KittingJson)));
                }
            }
            await ExecuteAsync(connection,transaction,"INSERT INTO SimKittingSubmission VALUES(@id,@case,@type,@version,@json,@pdf,@hash);",
                ("@id",id.ToString()),("@case",current.CaseId.ToString()),("@type",type),("@version",version),("@json",JsonSerializer.Serialize(receipt,KittingJson)),("@pdf",bytes),("@hash",hash));
            var next=prepared with{State=type,WorkingVersion=current.WorkingVersion+1,LastOperator=actor.DisplayName,LastWorkedAtUtc=now,
                EditingSessionId=null,EditingActorId=null,EditingOwner=null,EditingAcquiredAtUtc=null,EditingExpiresAtUtc=null};
            await SaveKittingRecord(connection,transaction,next);await KittingEvent(connection,transaction,next,"SUBMITTED_"+type,actor,now,new{submissionId=id,version,pdfSha256=hash});
            await transaction.CommitAsync();return next;
        }finally{gate.Release();}
    }
    internal async Task<(byte[] Bytes,string Name)> ReadSimKittingPdf(string wo,Guid id,SimStateMetadata runtime)
    {
        EnsurePacketPath();EnsureHealthy();await using var connection=OpenReadOnly();await connection.OpenAsync();await ValidatePacketDatabaseAsync(connection,null,runtime);
        var current=await ReadSimKittingCase(connection,null,wo,runtime.Generation)??throw KittingCaseProblem.NotFound("kitting_case_not_found","No case exists.");
        await using var command=connection.CreateCommand();command.CommandText="SELECT PayloadJson,PdfBytes,PdfSha256 FROM SimKittingSubmission WHERE CaseId=@case AND SubmissionId=@id;";
        command.Parameters.AddWithValue("@case",current.CaseId.ToString());command.Parameters.AddWithValue("@id",id.ToString());await using var reader=await command.ExecuteReaderAsync();
        if(!await reader.ReadAsync())throw KittingCaseProblem.NotFound("kitting_pdf_not_found","No retained SIM submission exists.");
        var receipt=JsonSerializer.Deserialize<SimKittingSubmission>(reader.GetString(0),KittingJson)!;var bytes=(byte[])reader[1];
        if(Convert.ToHexString(SHA256.HashData(bytes))!=reader.GetString(2))throw KittingCaseProblem.Conflict("kitting_pdf_hash","Stored PDF integrity verification failed.");
        return(bytes,receipt.PdfFileName);
    }
}
