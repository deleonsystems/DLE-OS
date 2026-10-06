using System.Text.Json;

internal sealed partial class SimOperationsDataStore
{
    // One read-only snapshot binds availability to the exact immutable shortage origin.
    internal async Task<(SimPurchasingView, SimReceivingSnapshot, Dictionary<string, SimKittingReturnOrigin>, Dictionary<string, string>)>
        ReadKittingSupply(SimStateMetadata runtime)
    {
        EnsurePacketPath(); EnsureHealthy();
        await using var connection = OpenReadOnly(); await connection.OpenAsync();
        await using var transaction = connection.BeginTransaction();
        await ValidatePacketDatabaseAsync(connection, transaction, runtime);
        var purchasing = await PurchasingView(connection, transaction, runtime, false);
        var receiving = await ReceivingSnapshot(connection, transaction);
        var cases = await PurchasingRows<SimKittingCaseRecord>(connection, transaction, "SimKittingCase");
        var submissions = await PurchasingRows<SimKittingSubmission>(connection, transaction, "SimKittingSubmission");
        // Material readiness belongs to Kitting, never to purchase/receipt quantities.
        var materialStates = cases.Where(c => c.Generation == runtime.Generation)
            .GroupBy(c => c.WorkOrderNumber).ToDictionary(g => g.Key, g => g.OrderByDescending(c => c.RunNumber).First().State);
        var origins = new Dictionary<string, SimKittingReturnOrigin>();
        foreach (var demand in purchasing.Demands.Where(d => d.SourceCurrent && d.ShortQuantity > 0))
        {
            var current = cases.SingleOrDefault(c => c.CaseId == demand.CaseId && c.Generation == runtime.Generation &&
                c.WorkOrderNumber == demand.WorkOrderNumber && c.State == "KIT_SHORT");
            var submission = submissions.SingleOrDefault(s => s.SubmissionId == demand.SubmissionId && s.CaseId == demand.CaseId);
            if (current is null || submission is null || current.ReleasedBomIdentity != demand.ReleasedBomIdentity) continue;
            using var snapshot = JsonDocument.Parse(submission.SnapshotJson);
            var draft = Field(snapshot.RootElement, "draft");
            var rows = Field(draft, "groups").EnumerateArray()
                .Where(g => PurchasingText(g, "sourceRowId") == demand.SourceRowId).ToArray();
            if (rows.Length != 1) continue;
            var row = rows[0];
            origins[demand.DemandId] = new(current.CaseId, current.WorkingVersion, submission.SubmissionId,
                current.ReleasedBomIdentity, demand.SourceRowId, PurchasingText(row, "groupId"),
                Field(row, "findNumber").ToString(), PurchasingText(row, "sequence"),
                demand.RequiredQuantity, demand.KittedQuantity);
        }
        await transaction.CommitAsync();
        return (purchasing, receiving, origins, materialStates);
    }
}
