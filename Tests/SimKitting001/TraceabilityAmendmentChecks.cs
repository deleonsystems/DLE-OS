using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

internal static class SimKittingTraceabilityAmendmentChecks
{
    internal static async Task<int> Run(string repo, string source)
    {
        var count = 0;
        void Check(bool pass, string label)
        {
            if (!pass) throw new Exception(label);
            count++; Console.WriteLine("PASS " + label);
        }
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        JsonElement E(object value) => JsonSerializer.SerializeToElement(value, json);
        T Request<T>(object value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, json), json)!;
        string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
        var sourceHashes = new[] { "data/dle-os-sim.db", "data/rfq-intakes.json", "state/metadata.json" }
            .ToDictionary(x => x, x => Hash(Path.Combine(source, x)));
        var root = Path.Combine(repo, "tmp", "kitting", "traceability-amendment-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        foreach (var folder in new[] { "data", "state" })
        foreach (var file in Directory.EnumerateFiles(Path.Combine(source, folder), "*", SearchOption.AllDirectories))
        {
            if (file.EndsWith("dle-os-sim.db") || file.EndsWith("-wal") || file.EndsWith("-shm")) continue;
            var destination = Path.Combine(root, Path.GetRelativePath(source, file));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination);
        }
        await using (var from = new SqliteConnection(new SqliteConnectionStringBuilder
            { DataSource = Path.Combine(source, "data/dle-os-sim.db"), Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString()))
        await using (var to = new SqliteConnection(new SqliteConnectionStringBuilder
            { DataSource = Path.Combine(root, "data/dle-os-sim.db"), Pooling = false }.ToString()))
        {
            await from.OpenAsync(); await to.OpenAsync(); from.BackupDatabase(to);
            // Reset case fixtures only in this disposable copy; never modify the supplied checkpoint.
            await using var reset = to.CreateCommand();
            reset.CommandText = "DROP TABLE IF EXISTS SimKittingSubmission; DROP TABLE IF EXISTS SimKittingCaseEvent; DROP TABLE IF EXISTS SimKittingCase;";
            await reset.ExecuteNonQueryAsync();
        }
        var state = new SimStateStore(root); await state.InitializeAsync();
        var operations = new SimOperationsDataStore(repo, root); await operations.InitializeAsync(state.Current.Metadata!);
        var intakes = new SimRfqIntakeStore(root);
        var provider = new SimKittingRequirementsProvider(intakes, operations);
        var service = new SimKittingCases(state, operations, provider);
        var admin = SimPersonaCatalog.Default;
        var kitOperator = SimPersonaCatalog.Get("kitting-operator")!;
        const string wo = "0999999";
        var release = await provider.ResolveAsync(wo, state.Current.Metadata!);
        var current = E(await service.Start(wo, Request<SimKittingStartRequest>(new
            { releasedBomIdentity = release.ReleasedBomIdentity }), kitOperator));
        SimKittingVersionRequest Version(JsonElement c) => new(c.GetProperty("workingVersion").GetInt64());
        SimKittingSaveRequest Save(JsonElement c, JsonElement draft) => new(c.GetProperty("workingVersion").GetInt64(), c.GetProperty("editingSessionId").GetGuid(), draft);
        SimKittingTraceabilityAmendmentRequest Amendment(JsonElement c, bool? required = false, string? reason = "Separate production Traveler from material-source PO evidence.") =>
            new(c.GetProperty("caseId").GetGuid(), c.GetProperty("workingVersion").GetInt64(), c.GetProperty("editingSessionId").GetGuid(), required, reason);
        async Task<JsonElement> Read() => E(await service.Read(wo, admin)).GetProperty("kittingCase").Clone();
        async Task<JsonElement[]> Events() => E(await service.History(wo, admin)).GetProperty("events").EnumerateArray().Select(e => e.Clone()).ToArray();
        async Task Reject(Func<Task> action, string label, string? code = null)
        {
            try { await action(); }
            catch (KittingCaseProblem e) when (code is null || e.Code == code) { Check(true, label); return; }
            catch (SimOrderEntryPermissionException) when (code is null) { Check(true, label); return; }
            throw new Exception(label + " was not rejected");
        }
        JsonElement PositiveCountWithoutPo(JsonElement c)
        {
            var draft = JsonNode.Parse(c.GetProperty("draft").GetRawText())!;
            var group = draft["groups"]![0]!;
            var required = group["requiredQuantity"]!.GetValue<decimal>();
            group["rowState"] = "SUBMITTED";
            group["entry"] = JsonSerializer.SerializeToNode(new
            {
                method = "COUNT", selectedPartNumber = (string?)null, purchaseOrder = "",
                allocations = new[] { new { allocationId = "ISOLATED-OPTIONAL-1", partNumber = group["partNumber"]!.ToString(), quantity = required, purchaseOrder = "" } },
                pickedQuantity = required, shortageQuantity = 0m, extraQuantity = 0m, result = "COUNTED_EXACT"
            }, json);
            return E(draft);
        }

        Check(current.GetProperty("poTraceabilityRequired").GetBoolean(), "amendment fixture retains original Required policy");
        await Reject(async () => { await service.Save(wo, Save(current, PositiveCountWithoutPo(current)), kitOperator); },
            "Required policy rejects positive allocation without supplier PO", "po_traceability_required");
        await Reject(async () => { await service.AmendTraceability(wo, Amendment(current), kitOperator); }, "ordinary Kitting operator cannot amend policy");
        await Reject(async () => { await service.AmendTraceability(wo, Amendment(current), SimPersonaCatalog.Get("read-only-viewer")!); }, "read-only user cannot amend policy");
        await Reject(async () => { await service.AmendTraceability(wo, Amendment(current), admin with { AccountStatus = "DISABLED" }); }, "disabled administrator cannot amend policy");
        await Reject(async () => { await service.AmendTraceability(wo, Amendment(current), admin); }, "amendment administrator must own the active editing lease");
        current = E(await service.Save(wo, Save(current, current.GetProperty("draft")), kitOperator, true));
        current = E(await service.Resume(wo, Version(current), admin));
        var before = (await operations.ReadSimKittingCase(wo, state.Current.Metadata!))!;
        var previousEvents = await Events();
        var valid = Amendment(current);
        await Reject(async () => { await service.AmendTraceability(wo, valid with { CaseId = Guid.NewGuid() }, admin); }, "amendment rejects a different case identity");
        await Reject(async () => { await service.AmendTraceability(wo, valid with { ExpectedWorkingVersion = valid.ExpectedWorkingVersion - 1 }, admin); }, "amendment rejects stale working version");
        await Reject(async () => { await service.AmendTraceability(wo, valid with { EditingSessionId = Guid.NewGuid() }, admin); }, "amendment rejects a stale editing session");
        await Reject(async () => { await service.AmendTraceability(wo, valid with { PoTraceabilityRequired = null }, admin); }, "amendment requires an explicit policy decision");
        await Reject(async () => { await service.AmendTraceability(wo, valid with { Reason = "  " }, admin); }, "amendment requires a reviewed reason");
        await Reject(async () => { await service.AmendTraceability(wo, valid with { Reason = new string('x', 4001) }, admin); }, "amendment rejects an oversized reason");
        await Reject(async () => { await service.AmendTraceability(wo, valid with { PoTraceabilityRequired = true }, admin); }, "amendment rejects a no-op policy decision");
        service.UtcNow = () => DateTimeOffset.UtcNow.AddMinutes(16);
        await Reject(async () => { await service.AmendTraceability(wo, valid, admin); }, "amendment rejects an expired lease");
        service.UtcNow = () => DateTimeOffset.UtcNow;
        await Reject(async () => { await service.Traceability(wo, new(valid.ExpectedWorkingVersion, valid.EditingSessionId, false), admin); },
            "legacy plain policy setter cannot bypass reviewed amendment", "po_traceability_amendment_required");
        Check((await Read()).GetProperty("workingVersion").GetInt64() == before.WorkingVersion && (await Events()).Length == previousEvents.Length,
            "rejected amendments preserve working version and history");

        var reason = "Reviewed correction: Traveler is required; material-source PO traceability is not required.";
        current = E(await service.AmendTraceability(wo, valid with { Reason = "  " + reason + "  " }, admin));
        var amended = (await operations.ReadSimKittingCase(wo, state.Current.Metadata!))!;
        Check(!current.GetProperty("poTraceabilityRequired").GetBoolean() && amended.WorkingVersion == before.WorkingVersion + 1,
            "reviewed amendment sets effective Optional policy and increments version once");
        Check(amended.CaseId == before.CaseId && amended.RunNumber == before.RunNumber && amended.ReleasedBomIdentity == before.ReleasedBomIdentity &&
            amended.ReleasedBomVersion == before.ReleasedBomVersion && amended.State == before.State,
            "policy amendment preserves case, run, release and execution state");
        Check(amended.FrozenDraft.GetRawText() == before.FrozenDraft.GetRawText() && amended.Draft.GetRawText() == before.Draft.GetRawText() &&
            amended.Lineage.GetRawText() == before.Lineage.GetRawText(), "policy amendment leaves frozen requirements, draft and original lineage unchanged");
        Check(amended.FrozenDraft.GetProperty("poTraceabilityRequired").GetBoolean() && amended.Lineage.GetProperty("poTraceabilityRequired").GetBoolean() &&
            amended.CompletedCount == 0 && amended.ShortRequirementCount == 0 && amended.Draft.GetProperty("groups").EnumerateArray().All(g => g.GetProperty("entry").ValueKind == JsonValueKind.Null),
            "original Required inference remains historical evidence; amendment adds no execution evidence");
        var afterEvents = await Events();
        Check(afterEvents.Length == previousEvents.Length + 1 && previousEvents.Select(e => e.GetRawText()).SequenceEqual(afterEvents.Take(previousEvents.Length).Select(e => e.GetRawText())),
            "policy amendment appends one event without changing prior history");
        var amendmentEvent = afterEvents.Last(); var detail = amendmentEvent.GetProperty("detail");
        Check(amendmentEvent.GetProperty("eventType").GetString() == "PO_TRACEABILITY_CHANGED" && detail.GetProperty("kind").GetString() == "REVIEWED_AMENDMENT" &&
            detail.GetProperty("originalRequired").GetBoolean() && detail.GetProperty("previousEffectiveRequired").GetBoolean() && !detail.GetProperty("newEffectiveRequired").GetBoolean(),
            "amendment event distinguishes original, prior effective and reviewed effective policy");
        Check(detail.GetProperty("reason").GetString() == reason && detail.GetProperty("actorId").GetString() == admin.Id &&
            detail.GetProperty("actor").GetString() == admin.DisplayName && detail.GetProperty("atUtc").GetDateTimeOffset() != default &&
            detail.GetProperty("releasedBomIdentity").GetString() == before.ReleasedBomIdentity && detail.GetProperty("caseId").GetGuid() == before.CaseId,
            "amendment records trimmed reason, server actor/time and original release linkage");
        Check(detail.GetProperty("expectedWorkingVersion").GetInt64() == before.WorkingVersion && detail.GetProperty("resultingWorkingVersion").GetInt64() == amended.WorkingVersion,
            "amendment audit records exact expected and resulting versions");
        await Reject(async () => { await service.AmendTraceability(wo, valid, admin); }, "replayed stale amendment cannot append another event");

        service = new SimKittingCases(state, operations, provider);
        current = await Read();
        Check(!current.GetProperty("poTraceabilityRequired").GetBoolean(), "effective Optional policy survives service reload");
        current = E(await service.Save(wo, Save(current, PositiveCountWithoutPo(current)), admin, true));
        Check(!current.GetProperty("poTraceabilityRequired").GetBoolean() && current.GetProperty("completedCount").GetInt32() == 1 &&
            current.GetProperty("shortRequirementCount").GetInt32() == 0 && current.GetProperty("editingSessionId").ValueKind == JsonValueKind.Null,
            "Optional policy permits positive allocation without PO and survives Save and Exit");
        service = new SimKittingCases(state, operations, provider);
        current = E(await service.Resume(wo, Version(await Read()), admin));
        Check(!current.GetProperty("poTraceabilityRequired").GetBoolean() && current.GetProperty("caseId").GetGuid() == before.CaseId &&
            current.GetProperty("draft").GetProperty("groups")[0].GetProperty("entry").GetProperty("allocations")[0].GetProperty("purchaseOrder").GetString() == "",
            "Resume retains amended policy and isolated material evidence on the same case");
        await Reject(async () => { await service.AmendTraceability(wo, Amendment(current, true, "Isolated stricter policy check"), admin); },
            "amendment cannot require missing PO evidence on existing positive allocations", "po_traceability_required");

        // Only this disposable copy is completed, to verify future immutable reports consume effective policy.
        var complete = JsonNode.Parse(current.GetProperty("draft").GetRawText())!;
        foreach (var node in complete["groups"]!.AsArray())
        {
            node!["rowState"] = "SUBMITTED";
            node["entry"] = JsonSerializer.SerializeToNode(new { method = "COMPLETE", selectedPartNumber = node["partNumber"]!.ToString(),
                purchaseOrder = "", allocations = Array.Empty<object>(), pickedQuantity = (decimal?)null, shortageQuantity = 0m,
                extraQuantity = (decimal?)null, result = "COMPLETE" }, json);
        }
        current = E(await service.Submit(wo, Save(current, E(complete)), admin));
        var submissions = E(await service.Submissions(wo, admin)).GetProperty("submissions");
        var snapshot = JsonDocument.Parse(submissions[0].GetProperty("snapshotJson").GetString()!).RootElement;
        Check(!snapshot.GetProperty("poTraceabilityRequired").GetBoolean() && snapshot.GetProperty("draft").GetProperty("poTraceabilityRequired").GetBoolean(),
            "future submission records effective Optional policy while retaining original frozen draft evidence");
        var pdf = await service.Pdf(wo, submissions[0].GetProperty("submissionId").GetGuid(), admin);
        Check(System.Text.Encoding.ASCII.GetString(pdf.Bytes).Contains("P.O. TRACEABILITY  OPTIONAL"), "future PDF displays effective Optional policy");
        foreach (var pair in sourceHashes) Check(Hash(Path.Combine(source, pair.Key)) == pair.Value, "amendment qualification leaves source checkpoint unchanged: " + pair.Key);
        Console.WriteLine("Traceability amendment qualification used disposable state: " + root);
        return count;
    }
}
