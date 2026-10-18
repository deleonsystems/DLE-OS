using System.Text.Json;
using Microsoft.Data.Sqlite;

internal sealed partial class SimOperationsDataStore
{
    private static readonly JsonSerializerOptions PurchasingJson = SimPurchasingService.Json;
    private const string PurchasingSchema = """
CREATE TABLE IF NOT EXISTS SimPurchasingDemand(DemandId TEXT PRIMARY KEY,PayloadJson TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS SimBuyingPlan(PlanId TEXT PRIMARY KEY,PayloadJson TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS SimPurchaseLine(PurchaseId TEXT PRIMARY KEY,ExpectedReceiptId TEXT NOT NULL UNIQUE,Supplier TEXT NOT NULL,PoNumber TEXT NOT NULL,PoLine TEXT NOT NULL,PayloadJson TEXT NOT NULL,UNIQUE(Supplier,PoNumber,PoLine));
CREATE TABLE IF NOT EXISTS SimPurchasingCommand(RequestId TEXT PRIMARY KEY,RequestHash TEXT NOT NULL,ResponseJson TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS SimPurchasingEvent(EventSequence INTEGER PRIMARY KEY AUTOINCREMENT,EventId TEXT NOT NULL UNIQUE,PayloadJson TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS SimPurchasingEventNoUpdate BEFORE UPDATE ON SimPurchasingEvent BEGIN SELECT RAISE(ABORT,'Purchasing history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS SimPurchasingEventNoDelete BEFORE DELETE ON SimPurchasingEvent BEGIN SELECT RAISE(ABORT,'Purchasing history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS SimPurchaseLineNoUpdate BEFORE UPDATE ON SimPurchaseLine BEGIN SELECT RAISE(ABORT,'Recorded developmental PO lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS SimPurchaseLineNoDelete BEFORE DELETE ON SimPurchaseLine BEGIN SELECT RAISE(ABORT,'Recorded developmental PO lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS SimPurchasingCommandNoUpdate BEFORE UPDATE ON SimPurchasingCommand BEGIN SELECT RAISE(ABORT,'Purchasing command history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS SimPurchasingCommandNoDelete BEFORE DELETE ON SimPurchasingCommand BEGIN SELECT RAISE(ABORT,'Purchasing command history is immutable'); END;
""";

    internal async Task<SimPurchasingView> ReadPurchasing(SimStateMetadata runtime, bool canManage)
    {
        EnsurePacketPath(); EnsureHealthy();
        await using var connection = OpenReadOnly(); await connection.OpenAsync();
        await using var transaction = connection.BeginTransaction();
        await ValidatePacketDatabaseAsync(connection, transaction, runtime);
        var result = await PurchasingView(connection, transaction, runtime, canManage);
        await transaction.CommitAsync(); return result;
    }

    // A shared Operations gate and one SQLite transaction protect source checks, coverage reservations,
    // plan transitions, immutable purchase creation, audit and replay together. Kitting uses the same gate.
    internal async Task<T> ChangePurchasing<T>(SimStateMetadata runtime, string action, Guid requestId,
        object request, SimPersona actor, DateTimeOffset now,
        Func<SimPurchasingView, DateTimeOffset, SimPurchasingChange> mutate, Func<SimPurchasingChange, T> select)
    {
        await gate.WaitAsync();
        try
        {
            EnsurePacketPath(); EnsureHealthy();
            await using var connection = OpenReadWrite(); await connection.OpenAsync();
            await using var transaction = connection.BeginTransaction();
            await ValidatePacketDatabaseAsync(connection, transaction, runtime);
            await ExecuteAsync(connection, transaction, PurchasingSchema);
            var requestHash = SimPurchasingService.Hash(new { action, request, actor.Id, runtime.Generation });
            await using (var replay = connection.CreateCommand())
            {
                replay.Transaction = transaction;
                replay.CommandText = "SELECT RequestHash,ResponseJson FROM SimPurchasingCommand WHERE RequestId=@id;";
                replay.Parameters.AddWithValue("@id", requestId.ToString());
                await using var reader = await replay.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    if (reader.GetString(0) != requestHash)
                        throw SimPurchasingProblem.Conflict("request_reused", "That request ID belongs to different input or another actor.");
                    return JsonSerializer.Deserialize<T>(reader.GetString(1), PurchasingJson)!;
                }
            }
            var view = await PurchasingView(connection, transaction, runtime, true);
            var change = mutate(view, now);
            if (change.Demand is { } demand)
                await ExecuteAsync(connection, transaction,
                    "INSERT INTO SimPurchasingDemand VALUES(@id,@json) ON CONFLICT(DemandId) DO UPDATE SET PayloadJson=excluded.PayloadJson;",
                    ("@id", demand.DemandId), ("@json", JsonSerializer.Serialize(demand, PurchasingJson)));
            if (change.Plan is { } plan)
                await ExecuteAsync(connection, transaction,
                    "INSERT INTO SimBuyingPlan VALUES(@id,@json) ON CONFLICT(PlanId) DO UPDATE SET PayloadJson=excluded.PayloadJson;",
                    ("@id", plan.PlanId.ToString()), ("@json", JsonSerializer.Serialize(plan, PurchasingJson)));
            if (change.Purchase is { } purchase)
                await ExecuteAsync(connection, transaction,
                    "INSERT INTO SimPurchaseLine VALUES(@id,@expected,@supplier,@po,@line,@json);",
                    ("@id", purchase.PurchaseId.ToString()), ("@expected", purchase.ExpectedReceiptId.ToString()),
                    ("@supplier", purchase.Supplier), ("@po", purchase.PoNumber), ("@line", purchase.PoLine),
                    ("@json", JsonSerializer.Serialize(purchase, PurchasingJson)));
            await ExecuteAsync(connection, transaction, "INSERT INTO SimPurchasingEvent(EventId,PayloadJson) VALUES(@id,@json);",
                ("@id", change.Audit.EventId.ToString()), ("@json", JsonSerializer.Serialize(change.Audit, PurchasingJson)));
            var response = select(change);
            await ExecuteAsync(connection, transaction, "INSERT INTO SimPurchasingCommand VALUES(@id,@hash,@json);",
                ("@id", requestId.ToString()), ("@hash", requestHash), ("@json", JsonSerializer.Serialize(response, PurchasingJson)));
            await transaction.CommitAsync(); return response;
        }
        finally { gate.Release(); }
    }

    private static async Task<T[]> PurchasingRows<T>(SqliteConnection connection, SqliteTransaction? transaction, string table)
    {
        if (!await PacketExistsAsync(connection, transaction, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=@name;", ("@name", table))) return [];
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT PayloadJson FROM " + table + ";";
        var result = new List<T>(); await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) result.Add(JsonSerializer.Deserialize<T>(reader.GetString(0), PurchasingJson)!);
        return result.ToArray();
    }

    private static async Task<SimPurchasingView> PurchasingView(SqliteConnection connection, SqliteTransaction transaction,
        SimStateMetadata runtime, bool canManage)
    {
        var stored = await PurchasingRows<SimPurchasingDemand>(connection, transaction, "SimPurchasingDemand");
        var plans = await PurchasingRows<SimBuyingPlan>(connection, transaction, "SimBuyingPlan");
        var purchases = await ReceivingPurchases(connection, transaction,
            await PurchasingRows<SimPurchaseLine>(connection, transaction, "SimPurchaseLine"));
        var cases = await PurchasingRows<SimKittingCaseRecord>(connection, transaction, "SimKittingCase");
        var submissions = await PurchasingRows<SimKittingSubmission>(connection, transaction, "SimKittingSubmission");
        var active = new Dictionary<string, SimPurchasingDemand>(StringComparer.Ordinal);
        foreach (var current in cases.Where(c => c.Generation == runtime.Generation && c.State is "KIT_SHORT" or "KIT_COMPLETE"))
        {
            var latest = submissions.Where(s => s.CaseId == current.CaseId)
                .OrderByDescending(s => s.SubmittedAtUtc).ThenByDescending(s => s.VersionNumber).FirstOrDefault();
            // Retained buying authority stays tied to its immutable shortage while a re-kit draft is edited.
            var sourceIds = stored.Where(d=>d.CaseId==current.CaseId).Select(d=>d.SubmissionId).ToHashSet();
            if(latest is not null)sourceIds.Add(latest.SubmissionId);
            foreach(var submission in submissions.Where(s=>sourceIds.Contains(s.SubmissionId)&&s.CaseId==current.CaseId&&s.SubmissionType=="KIT_SHORT")) {
            var retainedOrigin=stored.Any(d=>d.CaseId==current.CaseId&&d.SubmissionId==submission.SubmissionId);
            using var document = JsonDocument.Parse(submission.SnapshotJson);
            var snapshot = document.RootElement;
            var draft = Field(snapshot, "draft"); var lineage = Field(snapshot, "lineage");
            if (PurchasingText(snapshot, "releasedBomIdentity") != current.ReleasedBomIdentity ||
                (!retainedOrigin && (current.EditingSessionId is not null || SimPurchasingService.Hash(current.Draft) != SimPurchasingService.Hash(draft)))) continue;
            var so = PurchasingText(lineage, "salesOrderNumber"); var soLine = PurchasingText(lineage, "salesOrderLineNumber");
            var customer = Field(lineage, "customer"); var customerNumber = PurchasingText(customer, "customerNumber");
            var canonical = await PurchasingSalesLine(connection, transaction, customerNumber, so, soLine);
            if (canonical is null) continue;
            var dueDate = PurchasingText(canonical.Value, "customerDueDate");
            var requirements = Field(lineage, "contractRequirements");
            var selections = TextArray(requirements, "traceabilityDeliverables").Concat(TextArray(requirements, "aerospaceRequirements")).ToArray();
            var quality = new SimPurchasingQuality(current.PoTraceabilityRequired,
                SimKittingCases.OriginalPolicy(current) ?? current.PoTraceabilityRequired,
                current.PoTraceabilityAmendment?.AmendmentId,
                // A reviewed finished-assembly CoC is retained in ContractRequirements; it does not
                // establish a supplier CoC requirement. Unknown receiving applicability stays unknown.
                null, Field(requirements, "traceabilityDeliverables").ValueKind == JsonValueKind.Array &&
                    Field(requirements, "aerospaceRequirements").ValueKind == JsonValueKind.Array ? selections.Contains("MATERIAL_CERTS") : null,
                null, Field(requirements, "traceabilityDeliverables").ValueKind == JsonValueKind.Array ? selections.Contains("TRAVELER") : null,
                string.Join("\n", new[] { PurchasingText(requirements, "poFlowdowns"), PurchasingText(requirements, "additionalContractQualityRequirements"),
                    PurchasingText(requirements, "specialRequirements") }.Where(s => s.Length > 0)),
                current.PoTraceabilityAmendment is null ? "SUBMITTED_KITTING_REVIEWED_POLICY" : "SUBMITTED_KITTING_WITH_REVIEWED_AMENDMENT",
                requirements.ValueKind == JsonValueKind.Undefined ? JsonSerializer.SerializeToElement<object?>(null) : requirements.Clone());
            foreach (var group in Field(draft, "groups").EnumerateArray())
            {
                var entry = Field(group, "entry"); var shortage = Number(entry, "shortageQuantity");
                if (shortage <= 0 || !Flag(group, "actionable")) continue;
                var sourceRowId = PurchasingText(group, "sourceRowId");
                // An older submission retains only demands already accepted from that snapshot.
                // Its unaccepted sibling rows are superseded by the latest submitted kit.
                if(submission.SubmissionId != latest?.SubmissionId && !stored.Any(d=>d.CaseId==current.CaseId && d.SubmissionId==submission.SubmissionId && d.SourceRowId==sourceRowId)) continue;
                if (sourceRowId.Length == 0 || stored.Any(d=>d.CaseId==current.CaseId&&d.SourceRowId==sourceRowId&&d.SubmissionId!=submission.SubmissionId)) continue;
                var part = PurchasingText(group, "partNumber"); var uom = PurchasingText(group, "unitOfMeasure");
                var id = SimPurchasingService.StableId($"{runtime.Generation}:{current.CaseId}:{submission.SubmissionId}:{sourceRowId}");
                var compatibility = SimPurchasingService.Hash(new { current.ReleasedBomIdentity, sourceRowId, part, uom,
                    eligibleParts = TextArray(group, "eligibleParts"), customerNumber, quality });
                var fingerprint = SimPurchasingService.Hash(new { submission.SubmissionId, submission.SnapshotJson, sourceRowId,
                    customerDueDate = dueDate, quality, canonical = canonical.Value });
                active[id] = new SimPurchasingDemand(id, 0, "INCOMING", true, fingerprint, current.CaseId,
                    submission.SubmissionId, submission.VersionNumber, current.ReleasedBomIdentity, sourceRowId,
                    PurchasingText(group, "sequence"), part, part, PurchasingText(group, "description"), Number(group, "requiredQuantity"),
                    Number(entry, "pickedQuantity"), shortage, uom, current.WorkOrderNumber, so, soLine,
                    PurchasingText(customer, "customerName"), customerNumber, current.AssemblyItemNumber, current.Revision,
                    Number(lineage, "buildQuantity"), dueDate, "", quality, compatibility, null, null, null, CustomerSupply: SimKittingSupplyDisposition.Effective(group), SupplyDisposition: SimKittingSupplyDisposition.Disposition(group), CustomerPoNumber: PurchasingText(canonical.Value, "customerPurchaseOrderNumber"));
            }
        }
        }
        var reconciliations = await PurchasingRows<SimKittingDemandReconciliation>(connection,transaction,"SimKittingDemandReconciliation");
        // Persisted source snapshots never disappear merely because Kitting was resubmitted.
        // Explicit successor Submit adds reconciliation; accepted source snapshots remain immutable.
        foreach (var retained in stored)
        {
            var current = active.GetValueOrDefault(retained.DemandId);
            var reconciliation=reconciliations.Where(r=>r.DemandId==retained.DemandId).OrderByDescending(r=>r.WorkingVersion).FirstOrDefault();
            active[retained.DemandId] = retained with {
                SourceCurrent = current is not null && current.SourceFingerprint == retained.SourceFingerprint && reconciliation?.RemainingShort != 0,
                State = reconciliation?.RemainingShort == 0 ? "RESOLVED" : retained.State,
                RemainingShortQuantity = reconciliation?.RemainingShort,
                ReconciliationId = reconciliation?.Id, CustomerPoNumber = current?.CustomerPoNumber ?? retained.CustomerPoNumber };
        }
        // A successor submission is not fresh buying authority while an older accepted demand for
        // the same case/requirement remains. In particular, do not bypass purchased coverage merely
        // by changing the submission-derived demand ID. Existing purchased coverage is retained.
        foreach (var incoming in active.Values.Where(d => d.State == "INCOMING").ToArray())
        {
            if (stored.Any(prior => prior.DemandId != incoming.DemandId && prior.CaseId == incoming.CaseId &&
                prior.SourceRowId == incoming.SourceRowId))
                active[incoming.DemandId] = incoming with { SourceCurrent = false };
        }
        // Current job responsibility follows the latest submitted kit, even for an existing
        // accepted demand. Its original submission, PO coverage and purchase history are retained.
        foreach (var demand in active.Values.ToArray()) {
            var latest = submissions.Where(s=>s.CaseId==demand.CaseId).OrderByDescending(s=>s.SubmittedAtUtc).ThenByDescending(s=>s.VersionNumber).FirstOrDefault();
            if(latest is null) { active[demand.DemandId]=demand with{CustomerContact=null}; continue; }
            using var snapshot=JsonDocument.Parse(latest.SnapshotJson);
            var row=Field(Field(snapshot.RootElement,"draft"),"groups").EnumerateArray().FirstOrDefault(g=>PurchasingText(g,"sourceRowId")==demand.SourceRowId);
            if(row.ValueKind!=JsonValueKind.Object) { active[demand.DemandId]=demand with{CustomerContact=null}; continue; }
            var effective=SimKittingSupplyDisposition.Effective(row);
            if(demand.BalanceSource is {} balance && balance.SubmissionId==latest.SubmissionId) {
                if(balance.Responsibility=="PURCHASED")effective=null;
                else {
                    var customerRow=System.Text.Json.Nodes.JsonNode.Parse(row.GetRawText())!;
                    customerRow["supplyDisposition"]=new System.Text.Json.Nodes.JsonObject{["responsibility"]="CUSTOMER_SUPPLIED"};
                    effective=SimKittingSupplyDisposition.Effective(JsonSerializer.SerializeToElement(customerRow));
                }
            }
            var conflicts=effective is null ? Array.Empty<string>() :
                purchases.Where(p=>p.Coverage.Any(c=>c.DemandId==demand.DemandId)&&p.OpenQuantity>0)
                    .Select(p=>$"Existing PO {p.PoNumber} / {p.PoLine}: {p.OpenQuantity} open. Review with Buyer; not cancelled.")
                    .Concat(plans.Where(p=>p.PurchaseId is null&&p.Coverage.Any(c=>c.DemandId==demand.DemandId)).Select(p=>$"Existing buying plan for {p.BuyQuantity} {p.PurchasingUom}. Review with Buyer; not cancelled.")).ToArray();
            active[demand.DemandId]=demand with{CurrentSubmissionId=latest.SubmissionId,CustomerSupply=effective,SupplyDisposition=SimKittingSupplyDisposition.Disposition(row),SupplyConflicts=conflicts,CustomerContact=SimPurchasingService.CurrentContact(demand,latest.SubmissionId,effective)};
        }
        return new("SIM", runtime.Generation, canManage, active.Values.OrderBy(d => d.WorkOrderNumber)
            .ThenBy(d => d.FindNumber).ToArray(), plans.OrderBy(p => p.CreatedAtUtc).ToArray(), purchases.OrderBy(p => p.CreatedAtUtc).ToArray());
    }

    private static async Task<JsonElement?> PurchasingSalesLine(SqliteConnection connection, SqliteTransaction transaction,
        string customer, string so, string line)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT PayloadJson FROM SalesOrderLine WHERE CustomerNumber=@customer AND SalesOrderNumber=@so AND LineNumber=@line;";
        command.Parameters.AddWithValue("@customer", customer); command.Parameters.AddWithValue("@so", so); command.Parameters.AddWithValue("@line", line);
        if (await command.ExecuteScalarAsync() is not string json) return null;
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    internal async Task<object> ReadPurchasingKittedBom(string demandId, SimStateMetadata runtime)
    {
        EnsurePacketPath(); EnsureHealthy();
        await using var connection = OpenReadOnly(); await connection.OpenAsync();
        await using var transaction = connection.BeginTransaction(); await ValidatePacketDatabaseAsync(connection, transaction, runtime);
        var view = await PurchasingView(connection, transaction, runtime, false);
        var demand = SimPurchasingService.Demand(view, demandId);
        var submissions = await PurchasingRows<SimKittingSubmission>(connection, transaction, "SimKittingSubmission");
        var submission = submissions.Single(s => s.SubmissionId == demand.SubmissionId && s.CaseId == demand.CaseId);
        var snapshot = JsonDocument.Parse(submission.SnapshotJson).RootElement.Clone();
        return new { submission.SubmissionId, demand.WorkOrderNumber, snapshot,
            pdfUrl = $"/api/kitting-cases/v1/work-orders/{demand.WorkOrderNumber}/submissions/{submission.SubmissionId}/pdf", readOnly = true };
    }
    internal async Task<SimPurchasingAudit[]> ReadPurchasingHistory(SimStateMetadata runtime)
    {
        EnsurePacketPath(); EnsureHealthy();
        await using var connection = OpenReadOnly(); await connection.OpenAsync();
        await ValidatePacketDatabaseAsync(connection, null, runtime);
        return (await PurchasingRows<SimPurchasingAudit>(connection, null, "SimPurchasingEvent")).OrderBy(a => a.AtUtc).ToArray();
    }
    private static JsonElement Field(JsonElement value, string key) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out var item) ? item : default;
    private static string PurchasingText(JsonElement value, string key) => Field(value, key) is { ValueKind: JsonValueKind.String } item ? item.GetString() ?? "" : "";
    private static decimal Number(JsonElement value, string key) => Field(value, key) is { ValueKind: JsonValueKind.Number } item && item.TryGetDecimal(out var number) ? number : 0;
    private static bool Flag(JsonElement value, string key) => Field(value, key).ValueKind == JsonValueKind.True;
    private static string[] TextArray(JsonElement value, string key) => Field(value, key) is { ValueKind: JsonValueKind.Array } array
        ? array.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToArray() : [];
}
