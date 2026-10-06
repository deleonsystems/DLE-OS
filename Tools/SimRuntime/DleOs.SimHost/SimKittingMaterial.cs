using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

internal sealed record SimKittingMaterialRequest(long ExpectedWorkingVersion, Guid? EditingSessionId,
    Guid RequestId, Guid CaseId, Guid SourceSubmissionId, string SourceRowId, string RequirementId,
    string DemandId, string ReceiptLineId, long ExpectedMaterialVersion, decimal Quantity, string Uom)
    : SimKittingEditableRequest(ExpectedWorkingVersion, EditingSessionId);
internal sealed record SimKittingCorrectionRequest(long ExpectedWorkingVersion, Guid? EditingSessionId,
    Guid RequestId, Guid CaseId, Guid SourceSubmissionId, string SourceRowId, string RequirementId,
    string AllocationId, string ExpectedAllocationHash, string Reason)
    : SimKittingEditableRequest(ExpectedWorkingVersion, EditingSessionId);
internal sealed record SimKittingReversalRequest(long ExpectedWorkingVersion, Guid? EditingSessionId,
    Guid RequestId, Guid CaseId, Guid ApplicationId, long ExpectedMaterialVersion, string Reason,
    bool MaterialReturnedToStaging) : SimKittingEditableRequest(ExpectedWorkingVersion, EditingSessionId);
internal sealed record SimKittingMaterialEvent(Guid EventId, string Kind, Guid RequestId, Guid CaseId,
    string WorkOrderNumber, string ReleasedBomIdentity, Guid SourceSubmissionId, string SourceRowId,
    string RequirementId, string DemandId, string ReceiptLineId, decimal Quantity, string Uom,
    Guid? ReversesApplicationId, string Reason, string ActorId, string Actor, DateTimeOffset AtUtc,
    long ExpectedWorkingVersion, long ResultingWorkingVersion, long ExpectedMaterialVersion,
    long ResultingMaterialVersion, JsonElement BeforeRequirement, JsonElement AfterRequirement,
    SimAcceptedMaterial? Receipt, SimPurchasingDemand? Demand);
internal sealed record SimKittingDemandReconciliation(Guid Id, string DemandId, Guid CaseId,
    Guid SourceSubmissionId, Guid PredecessorSubmissionId, Guid SuccessorSubmissionId,
    decimal OriginalShort, decimal RemainingShort, Guid[] ApplicationIds, string ActorId,
    DateTimeOffset AtUtc, long WorkingVersion);
internal sealed record SimKittingMaterialResult(SimKittingCaseRecord Case, SimKittingMaterialEvent Event);

internal sealed partial class SimKittingCases
{
    internal Task<object> MaterialContext(string wo, SimPersona actor) => state.WithStableRuntime(async runtime => {
        Permission(actor, false);
        return await operations.ReadKittingMaterialContext(Normalize(wo), runtime);
    });
    internal Task<object> ApplyMaterial(string wo, SimKittingMaterialRequest request, SimPersona actor) =>
        MaterialCommand(wo, "APPLIED", request.RequestId, request, actor);
    internal Task<object> CorrectAllocation(string wo, SimKittingCorrectionRequest request, SimPersona actor) =>
        MaterialCommand(wo, "MANUAL_ALLOCATION_CORRECTED", request.RequestId, request, actor);
    internal Task<object> ReverseMaterial(string wo, SimKittingReversalRequest request, SimPersona actor) =>
        MaterialCommand(wo, "REVERSED", request.RequestId, request, actor);
    private Task<object> MaterialCommand(string wo, string action, Guid requestId,
        SimKittingEditableRequest request, SimPersona actor) => state.WithStableRuntime(async runtime => {
        Permission(actor, true);
        var result = await operations.ChangeKittingMaterial(Normalize(wo), runtime, action, requestId, request, actor, UtcNow());
        return (object)new { kittingCase = View(result.Case, actor), applicationEvent = result.Event };
    });

    // Generic Save can retain governed evidence, but cannot introduce, edit, move or delete it.
    internal static void ProtectMaterialEvidence(JsonElement previous, JsonElement proposed)
    {
        static Dictionary<string, string> Evidence(JsonElement draft) {
            var result = new Dictionary<string, string>();
            foreach (var group in draft.GetProperty("groups").EnumerateArray()) {
                if (!group.TryGetProperty("entry", out var entry) || entry.ValueKind != JsonValueKind.Object) continue;
                if (entry.TryGetProperty("acceptedMaterial", out var direct) && direct.ValueKind == JsonValueKind.Object)
                    throw KittingCaseProblem.Conflict("governed_application_required", "Use Apply Accepted Material for receipt evidence.");
                if (!entry.TryGetProperty("allocations", out var rows) || rows.ValueKind != JsonValueKind.Array) continue;
                foreach (var row in rows.EnumerateArray()) {
                    if (!row.TryGetProperty("acceptedMaterial", out var identity) || identity.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) continue;
                    var key = group.GetProperty("groupId").GetString() + ":" + row.GetProperty("allocationId").GetString();
                    if (!result.TryAdd(key, SimPurchasingService.Hash(new { method = entry.GetProperty("method"), row })))
                        throw KittingCaseProblem.Conflict("governed_application_required", "Application evidence cannot be duplicated.");
                }
            }
            return result;
        }
        var before = Evidence(previous); var after = Evidence(proposed);
        if (before.Count != after.Count || before.Any(x => !after.TryGetValue(x.Key, out var value) || value != x.Value))
            throw KittingCaseProblem.Conflict("governed_application_required", "Applied material is protected. Use a reviewed application reversal to correct it.");
    }
}

internal sealed partial class SimOperationsDataStore
{
    private static async Task EnsureKittingMaterialSchema(SqliteConnection c, SqliteTransaction tx)
    {
        foreach (var table in new[] { "SimKittingMaterialEvent", "SimKittingDemandReconciliation" }) {
            await ExecuteAsync(c, tx, $"CREATE TABLE IF NOT EXISTS {table}(Id TEXT PRIMARY KEY,PayloadJson TEXT NOT NULL);");
            await ExecuteAsync(c, tx, $"CREATE TRIGGER IF NOT EXISTS {table}NoUpdate BEFORE UPDATE ON {table} BEGIN SELECT RAISE(ABORT,'Kitting material evidence is append-only'); END;");
            await ExecuteAsync(c, tx, $"CREATE TRIGGER IF NOT EXISTS {table}NoDelete BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT,'Kitting material evidence is append-only'); END;");
        }
        await ExecuteAsync(c, tx, "CREATE TABLE IF NOT EXISTS SimKittingMaterialCommand(RequestId TEXT PRIMARY KEY,RequestHash TEXT NOT NULL,ResponseJson TEXT NOT NULL);");
        foreach (var verb in new[] { "UPDATE", "DELETE" })
            await ExecuteAsync(c, tx, $"CREATE TRIGGER IF NOT EXISTS SimKittingMaterialCommandNo{verb} BEFORE {verb} ON SimKittingMaterialCommand BEGIN SELECT RAISE(ABORT,'Kitting commands are immutable'); END;");
    }
    internal static SimKittingMaterialEvent[] ActiveApplications(IEnumerable<SimKittingMaterialEvent> events) {
        var all = events.ToArray(); var reversed = all.Where(e => e.Kind == "REVERSED").Select(e => e.ReversesApplicationId).ToHashSet();
        return all.Where(e => e.Kind == "APPLIED" && !reversed.Contains(e.EventId)).ToArray();
    }
    private static JsonElement MaterialRow(JsonElement draft, string source, string requirement) =>
        draft.GetProperty("groups").EnumerateArray().SingleOrDefault(g => PurchasingText(g, "sourceRowId") == source && PurchasingText(g, "groupId") == requirement);
    private static JsonElement OriginalRow(SimKittingCaseRecord current, SimKittingSubmission[] submissions,
        Guid id, string source, string requirement) {
        var sub = submissions.SingleOrDefault(s => s.CaseId == current.CaseId && s.SubmissionId == id && s.SubmissionType == "KIT_SHORT")
            ?? throw KittingCaseProblem.Conflict("shortage_origin_invalid", "The immutable shortage origin does not match this case.");
        using var snapshot = JsonDocument.Parse(sub.SnapshotJson);
        if (PurchasingText(snapshot.RootElement, "releasedBomIdentity") != current.ReleasedBomIdentity)
            throw KittingCaseProblem.Conflict("shortage_origin_invalid", "The shortage belongs to a different frozen release.");
        var row = MaterialRow(Field(snapshot.RootElement, "draft"), source, requirement);
        if (row.ValueKind != JsonValueKind.Object || Number(Field(row, "entry"), "shortageQuantity") <= 0)
            throw KittingCaseProblem.Conflict("shortage_origin_invalid", "Select the exact immutable shortage requirement.");
        return row.Clone();
    }
    private static JsonArray Allocations(JsonNode row) => row["entry"]?["allocations"] as JsonArray
        ?? throw KittingCaseProblem.Conflict("count_evidence_required", "Receipt application requires retained count allocations.");
    private static bool ReceiptBacked(JsonNode? allocation) => allocation?["acceptedMaterial"] is JsonObject;
    private static void RequireOriginalCounts(JsonElement original, JsonNode working) {
        var originalAllocations = JsonNode.Parse(original.GetRawText())?["entry"]?["allocations"] as JsonArray;
        var manual = Allocations(working).Where(a => !ReceiptBacked(a)).ToArray();
        if (originalAllocations is null || originalAllocations.Count != manual.Length ||
            originalAllocations.Where((a, i) => SimPurchasingService.Hash(a!) != SimPurchasingService.Hash(manual[i]!)).Any())
            throw KittingCaseProblem.Conflict("manual_rekit_correction_required", "Review and correct manual re-kit changes before applying accepted material. Original count evidence must remain intact.");
    }
    private static JsonElement Recount(JsonNode draft, JsonNode row, SimKittingCaseRecord current, SimPersona actor, DateTimeOffset now) {
        var total = Allocations(row).Sum(a => a!["quantity"]!.GetValue<decimal>());
        var required = row["requiredQuantity"]!.GetValue<decimal>(); var entry = row["entry"]!;
        entry["method"] = "COUNT"; entry["pickedQuantity"] = total; entry["shortageQuantity"] = Math.Max(0, required-total);
        entry["extraQuantity"] = Math.Max(0, total-required); entry["result"] = total < required ? "COUNTED_SHORT" : total > required ? "COUNTED_EXTRA" : "COUNTED_EXACT";
        row["rowState"] = "SUBMITTED";
        return SimKittingCases.Stamp(JsonSerializer.SerializeToElement(draft, KittingJson), current.Draft, actor, now);
    }
    internal async Task<object> ReadKittingMaterialContext(string wo, SimStateMetadata runtime) {
        EnsurePacketPath(); EnsureHealthy(); await using var c = OpenReadOnly(); await c.OpenAsync();
        await using var tx = c.BeginTransaction(); await ValidatePacketDatabaseAsync(c, tx, runtime);
        var current = await ReadSimKittingCase(c, tx, wo, runtime.Generation) ?? throw KittingCaseProblem.NotFound("kitting_case_not_found", "No Kitting case exists.");
        var purchasing = await PurchasingView(c, tx, runtime, false); var receiving = await ReceivingSnapshot(c, tx);
        var submissions = await PurchasingRows<SimKittingSubmission>(c, tx, "SimKittingSubmission");
        var events = await PurchasingRows<SimKittingMaterialEvent>(c, tx, "SimKittingMaterialEvent");
        var requirements = new List<object>();
        foreach (var demand in purchasing.Demands.Where(d => d.CaseId == current.CaseId && d.SourceCurrent && d.ShortQuantity > 0)) {
            var original = OriginalRow(current, submissions, demand.SubmissionId, demand.SourceRowId,
                PurchasingText(current.Draft.GetProperty("groups").EnumerateArray().Single(g => PurchasingText(g,"sourceRowId")==demand.SourceRowId),"groupId"));
            var groupId = PurchasingText(original,"groupId"); var row = MaterialRow(current.Draft,demand.SourceRowId,groupId);
            var originalIds = Field(Field(original,"entry"),"allocations").EnumerateArray().Select(a=>PurchasingText(a,"allocationId")).ToHashSet();
            var allocations = Field(Field(row,"entry"),"allocations");
            var corrections = allocations.ValueKind != JsonValueKind.Array ? [] : allocations.EnumerateArray()
                .Where(a=>!originalIds.Contains(PurchasingText(a,"allocationId")) && Field(a,"acceptedMaterial").ValueKind != JsonValueKind.Object)
                .Select(a=>new { allocationId=PurchasingText(a,"allocationId"), quantity=Number(a,"quantity"), allocationHash=SimPurchasingService.Hash(a) }).ToArray();
            var material = receiving.Materials.Where(m=>m.StagedAtUtc is not null && m.AvailableQuantity>0 && m.Coverage.Any(a=>a.DemandId==demand.DemandId && a.Quantity>a.AppliedQuantity))
                .Select(m=>new {m.ReceiptLineId,m.Version,m.PoNumber,m.PoLine,m.PackingSlipNumber,m.StagingLocation,
                    uom=m.PurchasingUom,availableQuantity=Math.Min(m.AvailableQuantity,m.Coverage.Single(a=>a.DemandId==demand.DemandId).Quantity-m.Coverage.Single(a=>a.DemandId==demand.DemandId).AppliedQuantity)}).ToArray();
            requirements.Add(new {demand.DemandId,demand.SubmissionId,demand.SourceRowId,requirementId=groupId,
                findNumber=Field(original,"findNumber"),demand.PartNumber,demand.Uom,demand.RequiredQuantity,
                previouslyKitted=demand.KittedQuantity,remainingShort=Number(Field(row,"entry"),"shortageQuantity"),corrections,materials=material,
                applications=ActiveApplications(events).Where(e=>e.CaseId==current.CaseId&&e.SourceRowId==demand.SourceRowId)
                    .Select(e=>new {e.EventId,e.ReceiptLineId,e.Quantity,e.Uom,e.Actor,e.AtUtc,e.Receipt,
                        currentMaterialVersion=receiving.Materials.Single(m=>m.ReceiptLineId==e.ReceiptLineId).Version}).ToArray()});
        }
        return new {current.CaseId,current.WorkingVersion,current.State,requirements};
    }
    internal async Task<SimKittingMaterialResult> ChangeKittingMaterial(string wo, SimStateMetadata runtime,
        string action, Guid requestId, SimKittingEditableRequest request, SimPersona actor, DateTimeOffset now) {
        if (requestId == Guid.Empty) throw KittingCaseProblem.BadRequest("request_id_required", "A stable command ID is required.");
        await gate.WaitAsync(); try {
            EnsurePacketPath(); EnsureHealthy(); await using var c = OpenReadWrite(); await c.OpenAsync();
            await using var tx = c.BeginTransaction(); await ValidatePacketDatabaseAsync(c, tx, runtime);
            await EnsureKittingMaterialSchema(c,tx);
            var hash=SimPurchasingService.Hash(new {wo,action,request=JsonSerializer.SerializeToElement(request,request.GetType(),KittingJson),actor.Id,runtime.Generation});
            await using (var replay=c.CreateCommand()) {
                replay.Transaction=tx; replay.CommandText="SELECT RequestHash,ResponseJson FROM SimKittingMaterialCommand WHERE RequestId=@id"; replay.Parameters.AddWithValue("@id",requestId.ToString());
                await using var reader=await replay.ExecuteReaderAsync(); if(await reader.ReadAsync()) {
                    if(reader.GetString(0)!=hash)throw KittingCaseProblem.Conflict("request_reused","This command ID belongs to different input or another actor.");
                    return JsonSerializer.Deserialize<SimKittingMaterialResult>(reader.GetString(1),KittingJson)!;
                }
            }
            var current=await ReadSimKittingCase(c,tx,wo,runtime.Generation)??throw KittingCaseProblem.NotFound("kitting_case_not_found","No Kitting case exists.");
            SimKittingCases.Editable(current,request,actor,now);
            if(current.State!="KIT_SHORT")throw KittingCaseProblem.Conflict("kit_short_required","Re-kit requires a submitted Kit Short case.");
            var events=await PurchasingRows<SimKittingMaterialEvent>(c,tx,"SimKittingMaterialEvent");
            var submissions=await PurchasingRows<SimKittingSubmission>(c,tx,"SimKittingSubmission");
            var draft=JsonNode.Parse(current.Draft.GetRawText())!;
            Guid caseId, origin; string source, requirement, reason="", demandId="", receiptId="",uom="";
            decimal quantity=0; long materialVersion=0; Guid? reversal=null;
            SimAcceptedMaterial? material=null; SimPurchasingDemand? demand=null;
            var id=Guid.NewGuid(); JsonNode row; JsonElement original;
            if(request is SimKittingReversalRequest reverse) {
                var app=ActiveApplications(events).SingleOrDefault(e=>e.EventId==reverse.ApplicationId && e.CaseId==current.CaseId)
                    ??throw KittingCaseProblem.Conflict("application_not_active","This application is absent or already reversed.");
                if(!reverse.MaterialReturnedToStaging)throw KittingCaseProblem.BadRequest("physical_return_required","Confirm physical return to the recorded staging location before reversing consumption.");
                if(submissions.Any(s=>s.CaseId==current.CaseId && JsonDocument.Parse(s.SnapshotJson).RootElement.TryGetProperty("applicationIds",out var ids)&&ids.EnumerateArray().Any(x=>x.GetGuid()==app.EventId)))
                    throw KittingCaseProblem.Conflict("application_submitted","Submitted application evidence requires a subsequent reviewed workflow; it cannot be reversed in this draft.");
                caseId=reverse.CaseId;origin=app.SourceSubmissionId;source=app.SourceRowId;requirement=app.RequirementId;
                reason=reverse.Reason;demandId=app.DemandId;receiptId=app.ReceiptLineId;quantity=-app.Quantity;uom=app.Uom;reversal=app.EventId;demand=app.Demand;
                material=(await ReceivingSnapshot(c,tx)).Materials.Single(m=>m.ReceiptLineId==receiptId);materialVersion=reverse.ExpectedMaterialVersion;
            } else if(request is SimKittingCorrectionRequest correction) {
                caseId=correction.CaseId;origin=correction.SourceSubmissionId;source=correction.SourceRowId;requirement=correction.RequirementId;reason=correction.Reason;
            } else if(request is SimKittingMaterialRequest apply) {
                caseId=apply.CaseId;origin=apply.SourceSubmissionId;source=apply.SourceRowId;requirement=apply.RequirementId;
                demandId=apply.DemandId;receiptId=apply.ReceiptLineId;quantity=apply.Quantity;uom=apply.Uom;materialVersion=apply.ExpectedMaterialVersion;
                var purchasing=await PurchasingView(c,tx,runtime,false);
                demand=purchasing.Demands.SingleOrDefault(d=>d.DemandId==demandId&&d.CaseId==caseId&&d.SourceCurrent&&d.SubmissionId==origin&&d.SourceRowId==source&&d.WorkOrderNumber==wo)
                    ??throw KittingCaseProblem.Conflict("assigned_demand_required","The exact current shortage demand and submission must match.");
                material=(await ReceivingSnapshot(c,tx)).Materials.SingleOrDefault(m=>m.ReceiptLineId==receiptId)
                    ??throw KittingCaseProblem.Conflict("accepted_material_required","The governed accepted material was not found.");
                if(!purchasing.Purchases.Any(p=>p.PurchaseId==material.PurchaseId&&p.Coverage.Any(a=>a.DemandId==demandId)))
                    throw KittingCaseProblem.Conflict("assigned_demand_required","Receipt is not assigned to this purchase demand.");
            } else throw KittingCaseProblem.BadRequest("command_invalid","Unknown material command.");
            if(caseId!=current.CaseId)throw KittingCaseProblem.Conflict("kitting_case_identity_changed","Selected case identity changed.");
            original=OriginalRow(current,submissions,origin,source,requirement);
            row=draft["groups"]!.AsArray().SingleOrDefault(g=>g?["sourceRowId"]?.ToString()==source&&g?["groupId"]?.ToString()==requirement)
                ??throw KittingCaseProblem.Conflict("requirement_identity_invalid","Select the exact frozen requirement.");
            var before=JsonSerializer.SerializeToElement(row,KittingJson);
            var allocations=Allocations(row);
            if(action is "REVERSED" or "MANUAL_ALLOCATION_CORRECTED") {
                reason=reason?.Trim()??"";if(reason.Length is <1 or >4000)throw KittingCaseProblem.BadRequest("review_reason_required","A reviewed correction requires a reason.");
            }
            if(request is SimKittingCorrectionRequest correctionRequest) {
                var allocation=allocations.SingleOrDefault(a=>a?["allocationId"]?.ToString()==correctionRequest.AllocationId)
                    ??throw KittingCaseProblem.Conflict("allocation_changed","The selected manual allocation is no longer present.");
                if(ReceiptBacked(allocation)||SimPurchasingService.Hash(allocation)!=correctionRequest.ExpectedAllocationHash ||
                    Field(Field(original,"entry"),"allocations").EnumerateArray().Any(a=>PurchasingText(a,"allocationId")==correctionRequest.AllocationId))
                    throw KittingCaseProblem.Conflict("allocation_correction_invalid","Only the reviewed additional manual allocation can be corrected; original and applied evidence are protected.");
                allocations.Remove(allocation); RequireOriginalCounts(original,row);
            } else {
                if(material!.Version!=materialVersion)throw KittingCaseProblem.Conflict("material_version_changed","Accepted material changed. Refresh its balance before applying.");
                if(action=="APPLIED") {
                    RequireOriginalCounts(original,row);
                    var remaining=Math.Max(0,row["requiredQuantity"]!.GetValue<decimal>()-allocations.Sum(a=>a!["quantity"]!.GetValue<decimal>()));
                    var assigned=material.Coverage.SingleOrDefault(a=>a.DemandId==demandId&&a.WorkOrderNumber==wo);
                    if(material.StagedAtUtc is null || string.IsNullOrWhiteSpace(material.StagingLocation)||assigned is null)
                        throw KittingCaseProblem.Conflict("staged_assignment_required","Accepted material must be staged and assigned to this exact demand.");
                    if(uom!=demand!.Uom||uom!=material.PurchasingUom||uom!=row["unitOfMeasure"]!.ToString())throw KittingCaseProblem.Conflict("uom_mismatch","Receipt and shortage UOM must match.");
                    if(material.ApprovedPartNumber!=demand.PartNumber||!row["eligibleParts"]!.AsArray().Any(p=>p!.ToString()==material.ApprovedPartNumber))throw KittingCaseProblem.Conflict("part_mismatch","Receipt part does not match this shortage.");
                    if(quantity<=0||quantity>remaining||quantity>material.AvailableQuantity||quantity>assigned.Quantity-assigned.AppliedQuantity)
                        throw KittingCaseProblem.Conflict("application_quantity_invalid","Quantity must be positive and within the shortage, assigned balance and receipt balance.");
                    allocations.Add(JsonSerializer.SerializeToNode(new {allocationId="AM-"+id.ToString("N"),partNumber=material.ApprovedPartNumber,quantity,purchaseOrder=material.PoNumber,
                        acceptedMaterial=new {identityType="SIM_ACCEPTED_MATERIAL_APPLICATION",applicationId=id,receiptLineId=material.ReceiptLineId,partNumber=material.ApprovedPartNumber,purchaseOrderNumber=material.PoNumber,
                            poLine=material.PoLine,material.PackingSlipNumber,material.StagingLocation,quantityAccepted=material.AcceptedQuantity,appliedQuantity=quantity,demandId,sourceSubmissionId=origin,sourceRowId=source,requirementId=requirement},
                        evidenceOperator=actor.DisplayName,evidenceAtUtc=now},KittingJson));
                } else {
                    var allocation=allocations.SingleOrDefault(a=>a?["acceptedMaterial"]?["applicationId"]?.ToString()==reversal.ToString())
                        ??throw KittingCaseProblem.Conflict("application_evidence_missing","Working application evidence is missing; no reversal was recorded.");
                    allocations.Remove(allocation);
                }
            }
            var updatedDraft=Recount(draft,row,current,actor,now); SimKittingCases.RequireFrozen(current.FrozenDraft,updatedDraft);
            var valid=KittingDraftValidator.Validate(updatedDraft,wo,false,current.PoTraceabilityRequired,true);
            var next=current with {Draft=updatedDraft,WorkingVersion=current.WorkingVersion+1,LastOperator=actor.DisplayName,LastWorkedAtUtc=now,
                EditingExpiresAtUtc=now+TimeSpan.FromMinutes(15),ActionableCount=valid.ActionableCount,CompletedCount=valid.CompletedCount,ShortRequirementCount=valid.ShortCount,TotalShortage=valid.TotalShortage};
            var audit=new SimKittingMaterialEvent(id,action,requestId,caseId,wo,current.ReleasedBomIdentity,origin,source,requirement,demandId,receiptId,quantity,uom,reversal,reason,
                actor.Id,actor.DisplayName,now,current.WorkingVersion,next.WorkingVersion,materialVersion,material is null?0:materialVersion+1,before,
                MaterialRow(updatedDraft,source,requirement).Clone(),material,demand);
            await ExecuteAsync(c,tx,"INSERT INTO SimKittingMaterialEvent VALUES(@id,@json)",("@id",id.ToString()),("@json",JsonSerializer.Serialize(audit,KittingJson)));
            await SaveKittingRecord(c,tx,next);
            // Existing case audit schema is retained; detailed governed evidence lives in the append-only material event.
            await KittingEvent(c,tx,next,"AUTOSAVED",actor,now,new {action,materialEventId=id,requestId,sourceRowId=source,quantity,reason});
            var result=new SimKittingMaterialResult(next,audit);
            await ExecuteAsync(c,tx,"INSERT INTO SimKittingMaterialCommand VALUES(@id,@hash,@json)",("@id",requestId.ToString()),("@hash",hash),("@json",JsonSerializer.Serialize(result,KittingJson)));
            await tx.CommitAsync();return result;
        } finally {gate.Release();}
    }
}
