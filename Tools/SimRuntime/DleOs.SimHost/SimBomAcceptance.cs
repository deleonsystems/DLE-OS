using System.Text.Json;
using System.Text.RegularExpressions;
using System.Text.Json.Nodes;

// RFQ-scoped acceptance; this is not a production BOM or overall review release.
internal sealed record SimBomAcceptance(int Version, SimCandidateBom Candidate,
    SimTechnicalPackage Package, string ReviewedBy, DateTimeOffset ReviewedAtUtc);
internal sealed record SimBomCompletionRequest(SimCandidateBom Candidate);

internal sealed partial class SimRfqIntakeStore
{
    private static JsonNode? ComparableSnapshot(JsonNode? node, string? field = null)
    {
        if (node is JsonObject obj) return new JsonObject(obj.Select(p => KeyValuePair.Create(p.Key, ComparableSnapshot(p.Value, p.Key))));
        if (node is JsonArray array) return new JsonArray(array.Select(n => ComparableSnapshot(n)).ToArray());
        if (field?.EndsWith("Utc", StringComparison.OrdinalIgnoreCase) == true && node is JsonValue value && value.TryGetValue<string>(out var text) &&
            Regex.IsMatch(text, @"^\d{4}-\d{2}-\d{2}T") && DateTimeOffset.TryParse(text, out var date))
            return JsonValue.Create(date.UtcDateTime.ToString("O"));
        return node?.DeepClone();
    }
    internal async Task<object> CompleteBomReview(string intakeId, SimBomCompletionRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r));
            if (index < 0) throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review was not found.");
            var record = dataset.Records[index];
            var review = record.TechnicalReview;
            var bom = review?.CandidateBom;
            if (bom is null || bom.Rows.Length == 0)
                throw SimRfqIntakeProblem.Conflict("SIM_BOM_MISSING", "Build a Candidate BOM before completing BOM Review.");
            if (request.Candidate is null || !JsonNode.DeepEquals(ComparableSnapshot(JsonSerializer.SerializeToNode(request.Candidate, jsonOptions)), ComparableSnapshot(JsonSerializer.SerializeToNode(bom, jsonOptions))))
                throw SimRfqIntakeProblem.Conflict("SIM_BOM_CHANGED", "The candidate changed. Reopen and review the latest version before completing BOM Review.");
            var sources = await AnalysisDocuments(record, bom.Analysis?.SourceSnapshot.SourceSelectionVersion);
            if (dataset.AnalysisJobs.Any(j => j.Input.IntakeId == intakeId && DleAnalysisContract.Active(j.Status)))
                throw SimRfqIntakeProblem.Conflict("SIM_BOM_ANALYZING", "Wait for the current analysis to finish before completing BOM Review.");
            var governing = sources.Single(s => s.Source.DocumentId == review!.TechnicalPackage!.GoverningBomDocumentId).Source;
            if (bom.GoverningDocumentId != governing.DocumentId || bom.GoverningSha256 != governing.Sha256 ||
                (bom.Analysis is not null && !SameAnalysisSources(bom.Analysis.SourceSnapshot, record, sources)))
                throw SimRfqIntakeProblem.Conflict("SIM_BOM_SOURCE_CHANGED", "The source package changed. Build and review a new candidate before completing BOM Review.");
            var blockers = bom.Rows.Where(row => !row.ReviewState.Reviewed)
                .Select(row => "Row " + (row.Index + 1) + ": " + string.Join(" ", row.ReviewState.Reasons)).ToArray();
            if (blockers.Length > 0)
                throw SimRfqIntakeProblem.Conflict("SIM_BOM_UNRESOLVED", string.Join("; ", blockers));
            var acceptances = review!.BomAcceptances ?? [];
            if (!acceptances.Any(a => a.Candidate.Id == bom.Id))
            {
                // Full immutable snapshot includes corrections, alternate tombstones and evidence.
                var snapshot = JsonSerializer.Deserialize<SimCandidateBom>(JsonSerializer.Serialize(bom, jsonOptions), jsonOptions)!;
                acceptances = acceptances.Append(new(acceptances.Length + 1, snapshot, review.TechnicalPackage!, persona.DisplayName, DateTimeOffset.UtcNow)).ToArray();
            }
            record = record with { TechnicalReview = review with { BomAcceptances = acceptances,
                MaterialsReviewStatus = "QUALIFIED", NextReviewPhase = "MANUFACTURING_LABOR_REVIEW" } };
            dataset.Records[index] = record;
            dataset.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await WriteVerifiedAsync(dataset);
            return new { reviewType = "RFQ_REVIEW", reviewTypeLabel = "RFQ Review", reviewStatusLabel = ReviewStatusLabel(record.Status), record };
        }
        finally { gate.Release(); }
    }
}
