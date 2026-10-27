using System.Text.Json;

internal sealed record SimManualBomOrigin(string Kind, string CreatedBy, DateTimeOffset CreatedAtUtc, int Revision = 0,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? PreviousCandidateId = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? RevisionReason = null);
internal sealed record SimManualBomRequest(string? ExpectedReviewToken);
internal sealed record SimManualRowRequest(string CandidateId, string RowId, int ExpectedRevision);

internal sealed partial class SimRfqIntakeStore
{
    private static void RequireManualWork(SimRfqIntakeRecord record, SimRfqIntakeDataset dataset, bool allowAccepted = false)
    {
        if (record.Environment != "SIM" || record.IntakeType != "NEW_QUOTE_REQUEST" ||
            record.Status is not ("TECHNICAL_REVIEW_IN_PROGRESS" or "ON_HOLD") ||
            record.TechnicalReview?.Workflow is not { Outputs: null } ||
            !string.IsNullOrEmpty(record.TechnicalReview.DownstreamHandoffState))
            throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_BOM_STATE", "Start an active Technical Review before authoring a working BOM.");
        if (dataset.AnalysisJobs.Any(j => j.Input.IntakeId == record.IntakeId && DleAnalysisContract.Active(j.Status)))
            throw SimRfqIntakeProblem.Conflict("SIM_BOM_ANALYZING", "Wait for analysis to finish before authoring a working BOM.");
        if (!allowAccepted && record.TechnicalReview.CandidateBom is { } bom &&
            (record.TechnicalReview.BomAcceptances ?? []).Any(a => a.Candidate.Id == bom.Id))
            throw SimRfqIntakeProblem.Conflict("SIM_BOM_ACCEPTED", "The accepted BOM is read-only.");
    }

    internal async Task<object> CreateManualBom(string intakeId, SimManualBomRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r));
            if (index < 0) throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review was not found.");
            var record = dataset.Records[index];
            RequireManualWork(record, dataset);
            var review = record.TechnicalReview!;
            // Repeated clicks or a lost response reopen the same draft; never replace a candidate.
            if (review.CandidateBom?.ManualDraft is not null) return WorkflowEnvelope(record);
            if (review.CandidateBom is not null || (review.CandidateBomVersions?.Length ?? 0) > 0)
                throw SimRfqIntakeProblem.Conflict("SIM_CANDIDATE_EXISTS", "A BOM already exists. This action cannot replace existing BOM work.");
            if (request.ExpectedReviewToken != PackageReviewToken(record))
                throw SimRfqIntakeProblem.Conflict("SIM_PACKAGE_CHANGED", "The review changed. Reopen the package before creating a BOM.");
            var now = DateTimeOffset.UtcNow;
            var candidate = new SimCandidateBom(Guid.NewGuid().ToString("D"), "DLE-authored working BOM",
                "", "", 0, "DLE_MANUAL_AUTHORING_V1", false, now, persona.DisplayName, [],
                "Manually authored in DLE-OS. No customer-document extraction or inferred values.", [],
                ContractVersion: SimCandidateBomProvider.ContractVersion,
                ManualDraft: new("DLE_AUTHORED", persona.DisplayName, now));
            record = record with { TechnicalReview = review with { CandidateBom = candidate } };
            dataset.Records[index] = record;
            dataset.UpdatedAtUtc = now;
            await WriteVerifiedAsync(dataset);
            return WorkflowEnvelope(record);
        }
        finally { gate.Release(); }
    }

    internal async Task<object> AddManualBomRow(string intakeId, SimManualRowRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r));
            if (index < 0) throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review was not found.");
            var record = dataset.Records[index];
            RequireManualWork(record, dataset);
            var bom = record.TechnicalReview!.CandidateBom;
            if (bom?.ManualDraft is null || bom.Id != request.CandidateId || !Guid.TryParseExact(request.RowId, "D", out _))
                throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_BOM_REQUIRED", "Reopen the current manually authored BOM.");
            if (bom.Rows.Any(r => r.RowId == request.RowId)) return WorkflowEnvelope(record);
            if (request.ExpectedRevision != bom.ManualDraft.Revision)
                throw SimRfqIntakeProblem.Conflict("SIM_MANUAL_BOM_CHANGED", "The BOM changed. Reopen it before adding a row.");
            if (bom.Rows.Length >= 1000)
                throw SimRfqIntakeProblem.BadRequest("SIM_MANUAL_BOM_LIMIT", "This worksheet supports up to 1000 rows.");
            var values = SimCandidateBomProvider.Fields.ToDictionary(f => f, _ => "");
            // This is a worksheet position, not an inferred customer item identifier.
            values["lineNumber"] = (bom.Rows.Length + 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var row = new SimCandidateRow(bom.Rows.Length,
                SimCandidateBomProvider.Fields.ToDictionary(f => f, _ => ""), values, [],
                SimCandidateBomProvider.Fields.ToDictionary(f => f, _ => "UNCERTAIN"), false, null, null, [],
                RowId: request.RowId, ComponentType: "UNKNOWN", SourcePositionKind: "DLE_AUTHORED");
            bom = bom with { Rows = [.. bom.Rows, row],
                ManualDraft = bom.ManualDraft with { Revision = bom.ManualDraft.Revision + 1 },
                Progress = new(persona.DisplayName, DateTimeOffset.UtcNow) };
            record = record with { TechnicalReview = record.TechnicalReview with { CandidateBom = bom } };
            dataset.Records[index] = record; dataset.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await WriteVerifiedAsync(dataset);
            return WorkflowEnvelope(record);
        }
        finally { gate.Release(); }
    }
}
