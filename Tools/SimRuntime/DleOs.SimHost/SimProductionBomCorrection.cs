using System.Text.Json;
using System.Text.Json.Nodes;

// One bounded SIM recovery, not a live-quote lookup or a new acceptance baseline.
internal sealed record SimProductionBomCorrectionRequest(Guid CaseId, long ExpectedWorkingVersion,
    int ExpectedProcessRevision, string ExpectedProcessContentToken, string Reason);
internal sealed record SimProductionBomCorrection(Guid Id, string Kind, DateTimeOffset AtUtc,
    string ActorId, string Actor, string Reason, string WorkOrderNumber, Guid CaseId,
    long WorkingVersion, string BaseReleasedBomIdentity, int BaseReleasedBomVersion,
    string SourceRfq, SimBomProcessView Source, JsonElement PriorDraft, JsonElement PriorFrozenDraft,
    JsonElement PriorLineage);

internal static class SimProductionBomRecovery
{
    internal const string WorkOrder = "0999998";
    internal const string SourceRfq = "RFQI-SIM-0036";
    internal const string BaseIdentity = "SIM-KITTING-V1:4247CA56886A9A506827C19EE93DE88ACD46EC5861C9B9F0B74B1E7734A8C03A";
    internal const string SourceToken = "610F657ED914735B762B3DD2AD588CE5A9267628B836BB42AA8C3BCC23CC7780";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static void Require(bool ok, string message)
    { if (!ok) throw KittingCaseProblem.Conflict("production_bom_correction_conflict", message); }

    internal static JsonElement Annotate(JsonElement draft, JsonElement lineage, SimProductionBomCorrection correction)
    {
        var rows = lineage.GetProperty("rows").Deserialize<SimCandidateRow[]>(Json)!;
        Require(rows.Length == 55 && rows.Select(r => r.RowId).Distinct().Count() == 55,
            "The accepted source must retain all 55 unique BOM row identities.");
        var process = correction.Source.Rows.ToDictionary(r => r.Key, StringComparer.Ordinal);
        Require(process.Count == 55 && rows.All(r => process.ContainsKey(SimRfqIntakeStore.BomProcessLineKey(r))),
            "Production process keys do not match the exact accepted BOM values.");
        var root = JsonNode.Parse(draft.GetRawText())!.AsObject();
        var groups = root["groups"]!.AsArray();
        Require(groups.Count == rows.Length, "The saved requirements have changed.");
        var seen = new HashSet<string>();
        foreach (var group in groups)
        {
            var id = group!["sourceRowId"]!.GetValue<string>();
            var row = rows.SingleOrDefault(r => r.RowId == id);
            Require(row is not null && seen.Add(id) && group["sourceRowIndex"]!.GetValue<int>() == row.Index,
                "A saved requirement no longer matches its accepted source row.");
            var entry = process[SimRfqIntakeStore.BomProcessLineKey(row!)];
            group["process"] = JsonSerializer.SerializeToNode(entry, Json);
        }
        root["productionBomCorrection"] = Summary(correction);
        return JsonSerializer.SerializeToElement(root, Json);
    }

    internal static JsonObject Summary(SimProductionBomCorrection c) => new()
    {
        ["id"] = c.Id.ToString(), ["kind"] = c.Kind, ["atUtc"] = c.AtUtc.ToString("O"),
        ["actorId"] = c.ActorId, ["actor"] = c.Actor, ["reason"] = c.Reason,
        ["sourceRfq"] = c.SourceRfq, ["sourceProcessRevision"] = c.Source.Revision,
        ["sourceProcessContentToken"] = c.Source.ContentToken, ["sourceProcessHash"] = c.Source.SourceHash,
        ["baseReleasedBomIdentity"] = c.BaseReleasedBomIdentity,
        ["originallyCapturedAtAcceptance"] = false
    };

    internal static JsonElement AnnotateLineage(JsonElement lineage, SimProductionBomCorrection c)
    {
        var root = JsonNode.Parse(lineage.GetRawText())!.AsObject();
        root["productionBomCorrection"] = Summary(c);
        return JsonSerializer.SerializeToElement(root, Json);
    }
}

internal sealed partial class SimRfqIntakeStore
{
    // Caller holds the Intake gate, so source annotations cannot change before commit.
    internal async Task<SimBomProcessView> ReadRecoveryProcessUnderGate(SimPersona actor) =>
        ProcessView(await BomProcessRfq(SimProductionBomRecovery.SourceRfq), await ReadBomProcessDocuments(), actor);
}

internal sealed partial class SimKittingRequirementsProvider
{
    internal Task<T> WithProductionRecoverySource<T>(SimStateMetadata runtime, SimPersona actor,
        Func<SimKittingReleasedRequirements, SimBomProcessView, Task<T>> action) =>
        intakes.WithKittingSource(async () => await action(
            await ResolveAsync(SimProductionBomRecovery.WorkOrder, runtime),
            await intakes.ReadRecoveryProcessUnderGate(actor)));
}

internal sealed partial class SimKittingCases
{
    internal async Task<object> CorrectProductionBom(string wo, SimProductionBomCorrectionRequest request, SimPersona actor)
    {
        Permission(actor, true);
        if (!actor.IsSuperAdmin) throw new SimOrderEntryPermissionException();
        SimProductionBomRecovery.Require(Normalize(wo) == SimProductionBomRecovery.WorkOrder,
            "This recovery is restricted to the approved Abbott SIM trial.");
        SimProductionBomRecovery.Require(!string.IsNullOrWhiteSpace(request.Reason) && request.Reason.Length <= 1000,
            "Record the authorization and correction reason.");
        return await state.WithStableRuntime(async runtime =>
            await provider.WithProductionRecoverySource<object>(runtime, actor, async (release, source) =>
            {
                SimProductionBomRecovery.Require(runtime.Environment == "SIM" && release.ReleasedBomIdentity == SimProductionBomRecovery.BaseIdentity &&
                    release.ReleasedBomVersion == 1 && release.BuildQuantity == 25 && release.AssemblyItemNumber == "B11283-17" && release.Revision == "B",
                    "The approved released BOM identity changed.");
                SimProductionBomRecovery.Require(source.Revision == 7 && source.Revision == request.ExpectedProcessRevision &&
                    source.ContentToken == SimProductionBomRecovery.SourceToken && source.ContentToken == request.ExpectedProcessContentToken,
                    "Review the current production metadata before correcting this baseline.");
                return View(await operations.CorrectSimProductionBom(runtime, request, release, source, actor, UtcNow()), actor);
            }));
    }
}

internal sealed partial class SimOperationsDataStore
{
    internal async Task<SimKittingCaseRecord> CorrectSimProductionBom(SimStateMetadata runtime,
        SimProductionBomCorrectionRequest request, SimKittingReleasedRequirements release, SimBomProcessView source,
        SimPersona actor, DateTimeOffset now)
    {
        await gate.WaitAsync();
        try
        {
            EnsurePacketPath(); EnsureHealthy();
            await using var connection = OpenReadWrite(); await connection.OpenAsync();
            await using var transaction = connection.BeginTransaction();
            await ValidatePacketDatabaseAsync(connection, transaction, runtime);
            var current = await ReadSimKittingCase(connection, transaction, SimProductionBomRecovery.WorkOrder, runtime.Generation)
                ?? throw KittingCaseProblem.NotFound("kitting_case_not_found", "The approved Kitting case no longer exists.");
            SimProductionBomRecovery.Require(current.CaseId == request.CaseId && current.ReleasedBomIdentity == release.ReleasedBomIdentity,
                "The Kitting case or baseline changed.");
            // A retry returns the retained correction; it never recaptures newer quote data.
            if (current.ProductionBomCorrection is not null) return current;
            SimProductionBomRecovery.Require(current.WorkingVersion == request.ExpectedWorkingVersion && current.EditingSessionId is null &&
                current.State == "KITTING_IN_PROGRESS" && current.RunNumber == 1,
                "Save and close the latest Kitting work before applying this recovery.");
            var correction = new SimProductionBomCorrection(Guid.NewGuid(), "AUTHORIZED_SIM_BASELINE_CORRECTION", now,
                actor.Id, actor.DisplayName, request.Reason.Trim(), current.WorkOrderNumber, current.CaseId, current.WorkingVersion,
                current.ReleasedBomIdentity, current.ReleasedBomVersion, SimProductionBomRecovery.SourceRfq, source,
                current.Draft.Clone(), current.FrozenDraft.Clone(), current.Lineage.Clone());
            var next = current with
            {
                Draft = SimProductionBomRecovery.Annotate(current.Draft, release.Lineage, correction),
                FrozenDraft = SimProductionBomRecovery.Annotate(current.FrozenDraft, release.Lineage, correction),
                Lineage = SimProductionBomRecovery.AnnotateLineage(current.Lineage, correction),
                ProductionBomCorrection = correction
            };
            SimKittingCases.RequireFrozen(next.FrozenDraft, next.Draft);
            // This metadata recovery does not masquerade as an operator save or change its working version.
            await SaveKittingRecord(connection, transaction, next);
            await transaction.CommitAsync();
            return next;
        }
        finally { gate.Release(); }
    }
}
