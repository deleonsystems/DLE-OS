using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

// All fixture construction below is confined to a unique disposable backup. The live
// checkpoint is opened read-only; no test invokes a host endpoint or physical receipt.
internal static class AdditionalChecks
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal static async Task<int> Run(string repo, string source)
    {
        var checks = 0;
        void Check(bool value, string message)
        {
            if (!value) throw new Exception(message);
            checks++; Console.WriteLine("PASS " + message);
        }
        var sourceDb = Path.Combine(source, "data", "dle-os-sim.db");
        var sourceHash = Hash(sourceDb);
        var root = Path.Combine(repo, "tmp", "purchasing", "additional-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        foreach (var folder in new[] { "data", "state" })
        foreach (var file in Directory.EnumerateFiles(Path.Combine(source, folder), "*", SearchOption.AllDirectories))
        {
            if (file.EndsWith("dle-os-sim.db", StringComparison.OrdinalIgnoreCase) || file.EndsWith("-wal") || file.EndsWith("-shm")) continue;
            var target = Path.Combine(root, Path.GetRelativePath(source, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!); File.Copy(file, target);
        }
        var database = Path.Combine(root, "data", "dle-os-sim.db");
        await using (var from = Connection(sourceDb, true))
        await using (var to = Connection(database))
        {
            await from.OpenAsync(); await to.OpenAsync(); from.BackupDatabase(to);
            // Make this qualification repeatable even after the authorized live purchase.
            await Execute(to, "DROP TABLE IF EXISTS SimPurchasingCommand; DROP TABLE IF EXISTS SimPurchasingEvent; DROP TABLE IF EXISTS SimPurchaseLine; DROP TABLE IF EXISTS SimBuyingPlan; DROP TABLE IF EXISTS SimPurchasingDemand;");
        }
        var state = new SimStateStore(root); await state.InitializeAsync();
        var operations = new SimOperationsDataStore(repo, root); await operations.InitializeAsync(state.Current.Metadata!);
        var runtime = state.Current.Metadata!;
        var service = new SimPurchasingService(state, operations);
        var actor = SimPersonaCatalog.Default;
        var buyer = SimPersonaCatalog.Get("purchasing-buyer") ?? actor;
        var sourceCase = (await operations.ReadSimKittingCase("0999999", runtime))!;
        var sourceSubmission = (await operations.ReadSimKittingSubmissions("0999999", runtime)).OrderByDescending(s => s.SubmittedAtUtc).First();

        await AddFixture("1000001", "1000001", 5, "2026-10-16", false);
        await AddFixture("1000002", "1000002", 8, "2026-10-18", true);
        await AddFixture("1000003", "1000003", 8, "2026-10-19", false, "KITTING_IN_PROGRESS");
        await AddFixture("1000004", "1000004", 0, "2026-10-20", false, "KIT_COMPLETE");

        var initial = await service.Read(actor);
        var original = initial.Demands.Single(d => d.WorkOrderNumber == "0999999");
        var grouped = initial.Demands.Single(d => d.WorkOrderNumber == "1000001");
        var unknown = initial.Demands.Single(d => d.WorkOrderNumber == "1000002");
        Check(!initial.Demands.Any(d => d.WorkOrderNumber is "1000003" or "1000004"), "unsubmitted and complete Kitting cases cannot create Purchasing demand");
        Check(original.CompatibilityKey == grouped.CompatibilityKey && grouped.ShortQuantity == 5,
            "two distinct jobs can share the same governed requirement compatibility without changing source shortages");
        Check(unknown.QualityRequirements.MaterialCertRequired is null && unknown.QualityRequirements.TravelerRequired is null,
            "missing reviewed selection fields remain unknown rather than invented Not Required");
        Check(original.QualityRequirements.CocRequired is null && original.QualityRequirements.InspectionRequired is null &&
            original.QualityRequirements.TravelerRequired == true && !original.QualityRequirements.PoTraceabilityRequired,
            "finished-assembly evidence is not silently recast as supplier CoC or inspection while Traveler stays separate");

        var acceptRace = await Race(
            () => service.Accept(original.DemandId, new(original.Version, Guid.NewGuid()), actor),
            () => service.Accept(original.DemandId, new(original.Version, Guid.NewGuid()), buyer));
        Check(acceptRace.Count(r => r.Value is not null) == 1 && acceptRace.Count(r => r.Error?.StatusCode == 409) == 1,
            "simultaneous buyers produce one accepted demand and one concurrency conflict");
        original = acceptRace.Single(r => r.Value is not null).Value!;
        grouped = await service.Accept(grouped.DemandId, new(grouped.Version, Guid.NewGuid()), actor);
        unknown = await service.Accept(unknown.DemandId, new(unknown.Version, Guid.NewGuid()), actor);

        SimBuyingPlanRequest Plan(decimal buy, string date, SimPurchasingDemand[] demands, string? purpose = null) =>
            new(0, Guid.NewGuid(), "DLE-SIM-SUPPLIER", "SIM-OPTO-4", buy, "EA", 1.25m, "USD",
                "2026-10-01", date, null, "Isolated multi-job reservation qualification", purpose,
                demands.Select(d => new SimDemandCoverageRequest(d.DemandId, d.ShortQuantity, d.Version)).ToArray());

        var plans = await Race(
            () => service.SavePlan(null, Plan(15, "2026-10-07", [original, grouped], "Two units for synthetic stock"), actor),
            () => service.SavePlan(null, Plan(15, "2026-10-07", [original, grouped], "Two units for synthetic stock"), buyer));
        Check(plans.Count(r => r.Value is not null) == 1 && plans.Count(r => r.Error?.StatusCode == 409) == 1,
            "simultaneous buying plans reserve grouped demand atomically with one winner");
        var plan = plans.Single(r => r.Value is not null).Value!;
        Check(plan.Coverage.Length == 2 && plan.Coverage.Sum(c => c.Quantity) == 13 && plan.BuyQuantity == 15 && plan.ExcessQuantity == 2,
            "one buying plan covers 8 plus 5 across two WOs and preserves explicit excess of 2");
        var ready = await service.Ready(plan.PlanId, new(plan.Version, Guid.NewGuid()), actor);
        var purchase = await service.Purchase(plan.PlanId, new(ready.Version, Guid.NewGuid(), "0000001", "010", "2026-09-23", "SIM-GROUPED", null), actor);
        var secondPlan = await service.SavePlan(null, Plan(8, "2026-10-03", [unknown]), actor);
        var secondReady = await service.Ready(secondPlan.PlanId, new(secondPlan.Version, Guid.NewGuid()), actor);
        await service.Purchase(secondPlan.PlanId, new(secondReady.Version, Guid.NewGuid(), "0000002", "010", "2026-09-23", null, null), actor);
        var expected = await service.Expected(actor);
        Check(expected.Items.Length == 2 && expected.Items[0].ExpectedDate == "2026-10-03" && expected.Items[1].ExpectedDate == "2026-10-07",
            "expected Receiving queue sorts actual persisted PO lines by expected date ascending");
        var groupedReceipt = expected.Items.Single(i => i.PurchaseId == purchase.PurchaseId);
        Check(groupedReceipt.Coverage.Length == 2 && groupedReceipt.OrderedQuantity == 15 && groupedReceipt.ReceivedQuantity == 0 && groupedReceipt.OpenQuantity == 15,
            "two covered WOs produce one physical expected PO line with zero receipt quantity");
        Check(groupedReceipt.Coverage.Select(c => c.CustomerDueDate).Order().SequenceEqual(new[] { "2026-10-14", "2026-10-16" }) &&
            groupedReceipt.MaterialNeedBy == "" && groupedReceipt.RequestedDate == "2026-10-01",
            "multiple customer due dates remain job context separate from requested, expected and absent material need-by");
        Check((await service.History(actor)).Count(e => e.EventType == "SHORTAGE_ACCEPTED" && e.EntityId == original.DemandId) == 1,
            "concurrent loser appends no duplicate demand-acceptance audit");

        await using (var connection = Connection(database))
        {
            await connection.OpenAsync();
            foreach (var sql in new[] { "UPDATE SimPurchasingEvent SET PayloadJson='{}';", "DELETE FROM SimPurchasingEvent;",
                "UPDATE SimPurchaseLine SET PayloadJson='{}';", "DELETE FROM SimPurchaseLine;" })
            {
                var rejected = false;
                try { await Execute(connection, sql); } catch (SqliteException e) when (e.SqliteErrorCode == 19) { rejected = true; }
                Check(rejected, "database rejects history rewrite: " + sql.Split(' ')[0] + " " + (sql.Contains("SimPurchaseLine") ? "purchase" : "audit"));
            }
        }

        // A legitimate later submission in the disposable test case must not create
        // fresh buying authority for a shortage already covered by a retained PO.
        await operations.SubmitSimKittingCase("0999999", runtime, actor, sourceSubmission.SubmittedAtUtc.AddMinutes(1), current => current);
        var afterResubmit = await service.Read(actor);
        var sameJob = afterResubmit.Demands.Where(d => d.CaseId == original.CaseId && d.SourceRowId == original.SourceRowId).ToArray();
        Check(sameJob.Length == 2 && sameJob.All(d => !d.SourceCurrent),
            "Kitting resubmission preserves predecessor and blocks successor pending explicit demand reconciliation");
        var successor = sameJob.Single(d => d.DemandId != original.DemandId);
        var blocked = false;
        try { await service.Accept(successor.DemandId, new(successor.Version, Guid.NewGuid()), actor); }
        catch (SimPurchasingProblem e) when (e.StatusCode == 409) { blocked = true; }
        Check(blocked, "resubmitted source cannot bypass retained PO coverage through a new demand ID");
        Check((await service.Expected(actor)).Items.Length == 2 && (await service.History(actor)).Count(e => e.EventType == "PURCHASE_RECORDED") == 2,
            "source change preserves purchased-line history and expected receipts without duplicate purchase");
        Check(Hash(sourceDb) == sourceHash, "additional qualification never changes live database bytes");
        Console.WriteLine("Additional purchasing qualification clone: " + root);
        return checks;

        async Task AddFixture(string wo, string so, decimal shortage, string due, bool removeSelections, string caseState = "KIT_SHORT")
        {
            var id = Guid.NewGuid();
            var lineage = JsonNode.Parse(sourceCase.Lineage.GetRawText())!;
            lineage["workOrderNumber"] = wo; lineage["salesOrderNumber"] = so;
            if (removeSelections && lineage["contractRequirements"] is JsonObject requirement)
            { requirement.Remove("traceabilityDeliverables"); requirement.Remove("aerospaceRequirements"); }
            var draft = JsonNode.Parse(sourceCase.Draft.GetRawText())!;
            var group = draft["groups"]!.AsArray().Single(g => g!["partNumber"]!.GetValue<string>() == "SIM-OPTO-4")!;
            var entry = group["entry"]!; var count = group["requiredQuantity"]!.GetValue<decimal>() - shortage;
            entry["pickedQuantity"] = count; entry["shortageQuantity"] = shortage;
            entry["result"] = shortage > 0 ? "COUNTED_SHORT" : "COUNTED_COMPLETE";
            entry["allocations"]![0]!["quantity"] = count;
            var record = sourceCase with { CaseId = id, WorkOrderNumber = wo, State = caseState,
                Lineage = Element(lineage), Draft = Element(draft), ShortRequirementCount = shortage > 0 ? 1 : 0, TotalShortage = shortage };
            var submissionId = Guid.NewGuid();
            var snapshot = JsonNode.Parse(sourceSubmission.SnapshotJson)!;
            snapshot["caseId"] = id.ToString(); snapshot["submissionId"] = submissionId.ToString(); snapshot["workOrderNumber"] = wo;
            snapshot["lineage"] = lineage.DeepClone(); snapshot["draft"] = draft.DeepClone();
            var submission = sourceSubmission with { SubmissionId = submissionId, CaseId = id, SnapshotJson = snapshot.ToJsonString() };

            await using var connection = Connection(database); await connection.OpenAsync();
            var sourceLineText = await Scalar(connection, "SELECT PayloadJson FROM SalesOrderLine WHERE SalesOrderNumber='0099999' AND LineNumber='010';");
            var line = JsonNode.Parse(sourceLineText)!; var lineId = Guid.NewGuid().ToString("N");
            line["salesOrderLineId"] = lineId; line["salesOrderNumber"] = so; line["customerDueDate"] = due;
            await Execute(connection, "INSERT INTO SalesOrderLine SELECT @id,CustomerNumber,CustomerName,CustomerPurchaseOrderNumber,@so,LineNumber,ItemNumber,EstimatedShipDate,QuantityOrdered,@json FROM SalesOrderLine WHERE SalesOrderNumber='0099999' AND LineNumber='010';",
                ("@id", lineId), ("@so", so), ("@json", line.ToJsonString()));
            await Execute(connection, "INSERT INTO SimKittingCase VALUES(@id,@wo,@release,@generation,@json);",
                ("@id", id.ToString()), ("@wo", wo), ("@release", record.ReleasedBomIdentity), ("@generation", record.Generation), ("@json", JsonSerializer.Serialize(record, Json)));
            await Execute(connection, "INSERT INTO SimKittingSubmission SELECT @id,@case,SubmissionType,VersionNumber,@json,PdfBytes,PdfSha256 FROM SimKittingSubmission WHERE SubmissionId=@source;",
                ("@id", submissionId.ToString()), ("@case", id.ToString()), ("@json", JsonSerializer.Serialize(submission, Json)), ("@source", sourceSubmission.SubmissionId.ToString()));
        }
    }

    private static async Task<(T? Value, SimPurchasingProblem? Error)[]> Race<T>(Func<Task<T>> first, Func<Task<T>> second) where T : class
    {
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<(T?, SimPurchasingProblem?)> Attempt(Func<Task<T>> action)
        {
            await start.Task;
            try { return (await action(), null); } catch (SimPurchasingProblem error) { return (null, error); }
        }
        var a = Task.Run(() => Attempt(first)); var b = Task.Run(() => Attempt(second)); start.SetResult();
        return await Task.WhenAll(a, b);
    }
    private static JsonElement Element(JsonNode node) => JsonSerializer.SerializeToElement(node, Json);
    private static string Hash(string file) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
    private static SqliteConnection Connection(string file, bool readOnly = false) => new(new SqliteConnectionStringBuilder
    { DataSource = file, Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate, Pooling = false }.ToString());
    private static async Task Execute(SqliteConnection connection, string sql, params (string Key, object Value)[] parameters)
    {
        await using var command = connection.CreateCommand(); command.CommandText = sql;
        foreach (var (key, value) in parameters) command.Parameters.AddWithValue(key, value);
        await command.ExecuteNonQueryAsync();
    }
    private static async Task<string> Scalar(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand(); command.CommandText = sql;
        return (string)(await command.ExecuteScalarAsync())!;
    }
}
