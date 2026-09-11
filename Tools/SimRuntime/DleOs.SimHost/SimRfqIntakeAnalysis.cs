using System.Text;
using System.Text.Json;

internal sealed partial class SimRfqIntakeStore
{
    private async Task<DleAnalysisDocument[]> AnalysisDocuments(SimRfqIntakeRecord record)
    {
        var review = record.TechnicalReview;
        var package = review?.TechnicalPackage;
        var governing = package?.Documents.SingleOrDefault(d => d.DocumentId == package.GoverningBomDocumentId);
        if (record.Environment != "SIM" || record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" ||
            review?.AssemblyHistory?.AssemblyClassification is not ("EXISTING_ASSEMBLY" or "NEW_ASSEMBLY") ||
            governing is not { DocumentType: "ASSEMBLY_DRAWING", EmbeddedBom: true, Applicability: "PARENT_ASSEMBLY", Role: "GOVERNING" })
            throw SimRfqIntakeProblem.Conflict("ANALYSIS_SOURCE_REQUIRED", "Confirm assembly history and select the governing parent assembly drawing first.");
        var selected = package!.Documents.Where(d => d.DocumentId == governing.DocumentId || d.Role == "SUPPORTING").ToArray();
        if (selected.Length is < 1 or > 4) throw SimRfqIntakeProblem.Conflict("ANALYSIS_SOURCE_LIMIT", "This pilot supports up to four approved sources.");
        var output = new List<DleAnalysisDocument>();
        foreach (var selectedDocument in selected)
        {
            var file = record.TechnicalFiles.SingleOrDefault(d => d.DocumentId == selectedDocument.DocumentId && d.BinaryStatus == "VERIFIED")
                ?? throw SimRfqIntakeProblem.Conflict("ANALYSIS_BINARY_REQUIRED", "Each selected source must have a verified staged binary.");
            await documents.Verify(record.RequestCorrelationId, file, record.CreatedBy);
            var bytes = await documents.Bytes(record.RequestCorrelationId, file.DocumentId!);
            output.Add(new(new(file.DocumentId!, DleAnalysisContract.Hash(bytes), file.Name, file.Type,
                selectedDocument.DocumentType, selectedDocument.Role, selectedDocument.Applicability, selectedDocument.EmbeddedBom), bytes));
        }
        return output.ToArray();
    }
    private static void ApprovePilot(DleAnalysisDocument[] sources)
    {
        // Explicit server-side byte allowlist. Names, customer metadata and browser flags cannot authorize transmission.
        var approved = (Environment.GetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256") ?? "")
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (sources.Any(d => !approved.Contains(d.Source.Sha256, StringComparer.OrdinalIgnoreCase)))
            throw SimRfqIntakeProblem.Conflict("ANALYSIS_FIXTURE_ONLY", "This experimental bridge is enabled only for explicitly approved non-sensitive fixture files. No documents were sent.");
    }
    internal async Task<DleAnalysisJob> SubmitAnalysis(string intakeId, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var record = dataset.Records.SingleOrDefault(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r))
                ?? throw SimRfqIntakeProblem.NotFound("ANALYSIS_REVIEW_MISSING", "Review not found.");
            var sources = await AnalysisDocuments(record);
            ApprovePilot(sources);
            var existing = dataset.AnalysisJobs.LastOrDefault(j => j.Input.IntakeId == intakeId && DleAnalysisContract.Active(j.Status));
            if (existing is not null) return existing;
            var assembly = record.Assemblies.OrderBy(a => a.LineNumber).First();
            var now = DateTimeOffset.UtcNow;
            var input = new DleAnalysisInput(Guid.NewGuid().ToString("D"), "BUILD_CANDIDATE_BOM", intakeId,
                assembly.AssemblyNumber, assembly.Revision, assembly.Quantity, record.TechnicalReview!.TechnicalPackage!.GoverningBomDocumentId!,
                sources.Select(d => d.Source).ToArray(), 2, 10, DleAnalysisContract.InputVersion, DleAnalysisContract.ResultVersion,
                DleAnalysisContract.InstructionVersion, DleAnalysisContract.Hash(Encoding.UTF8.GetBytes(DleAnalysisContract.Instructions)),
                "GOVERNING_AUTHORITATIVE_SUPPORTING_CORROBORATES_ONLY", persona.DisplayName, now, now.AddMinutes(3));
            var job = new DleAnalysisJob(input, "QUEUED", now);
            dataset.AnalysisJobs.Add(job);
            await WriteVerifiedAsync(dataset);
            return job;
        }
        finally { gate.Release(); }
    }
    internal async Task<DleAnalysisJob?> LatestAnalysis(string intakeId)
    {
        await gate.WaitAsync();
        try { return (await ReadDatasetAsync()).AnalysisJobs.LastOrDefault(j => j.Input.IntakeId == intakeId); }
        finally { gate.Release(); }
    }
    internal async Task RecoverAnalysisJobs()
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var changed = false;
            for (var i = 0; i < dataset.AnalysisJobs.Count; i++)
                if (dataset.AnalysisJobs[i].Status is "RUNNING" or "VALIDATING")
                {
                    dataset.AnalysisJobs[i] = dataset.AnalysisJobs[i] with { Status = "FAILED", UpdatedAtUtc = DateTimeOffset.UtcNow,
                        ErrorCode = "HOST_RESTARTED", Message = "Analysis was interrupted by restart. Retry is available." };
                    changed = true;
                }
            if (changed) await WriteVerifiedAsync(dataset);
        }
        finally { gate.Release(); }
    }
    internal async Task<(DleAnalysisJob Job, DleAnalysisDocument[] Documents)?> ClaimAnalysisJob()
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.AnalysisJobs.FindIndex(j => j.Status == "QUEUED");
            if (index < 0) return null;
            var job = dataset.AnalysisJobs[index];
            if (DateTimeOffset.UtcNow >= job.Input.DeadlineUtc)
            {
                dataset.AnalysisJobs[index] = job with { Status = "TIMED_OUT", UpdatedAtUtc = DateTimeOffset.UtcNow,
                    ErrorCode = "DEADLINE_EXCEEDED", Message = "The analysis deadline expired before execution. Retry is available." };
                await WriteVerifiedAsync(dataset);
                return null;
            }
            try
            {
                var record = dataset.Records.SingleOrDefault(r => r.IntakeId == job.Input.IntakeId)
                    ?? throw new InvalidDataException("Review deleted");
                var sources = await AnalysisDocuments(record);
                if (!SameAnalysisSources(job.Input, record, sources)) throw new InvalidDataException("Source changed");
                if (DleAnalysisContract.Hash(Encoding.UTF8.GetBytes(DleAnalysisContract.Instructions)) != job.Input.InstructionHash)
                    throw new InvalidDataException("Instructions changed");
                ApprovePilot(sources);
                job = job with { Status = "RUNNING", UpdatedAtUtc = DateTimeOffset.UtcNow };
                dataset.AnalysisJobs[index] = job;
                await WriteVerifiedAsync(dataset);
                return (job, sources);
            }
            catch (Exception e) when (e is IOException or SimRfqIntakeProblem)
            {
                dataset.AnalysisJobs[index] = job with { Status = "STALE", UpdatedAtUtc = DateTimeOffset.UtcNow,
                    ErrorCode = "SOURCE_UNAVAILABLE", Message = "Review/source approval changed or job expired. Reopen before retrying." };
                await WriteVerifiedAsync(dataset);
                return null;
            }
        }
        finally { gate.Release(); }
    }
    private static bool SameAnalysisSources(DleAnalysisInput input, SimRfqIntakeRecord record, DleAnalysisDocument[] sources)
    {
        var assembly = record.Assemblies.OrderBy(a => a.LineNumber).First();
        return record.TechnicalReview?.TechnicalPackage?.GoverningBomDocumentId == input.GoverningDocumentId &&
            assembly.AssemblyNumber == input.Assembly && assembly.Revision == input.Revision && assembly.Quantity == input.Quantity &&
            JsonSerializer.Serialize(sources.Select(d => d.Source).OrderBy(s => s.DocumentId)) == JsonSerializer.Serialize(input.Sources.OrderBy(s => s.DocumentId));
    }
    internal async Task SetAnalysisState(string jobId, string status, string? code = null, string? message = null)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.AnalysisJobs.FindIndex(j => j.Input.JobId == jobId);
            if (index < 0 || !DleAnalysisContract.Active(dataset.AnalysisJobs[index].Status)) return;
            dataset.AnalysisJobs[index] = dataset.AnalysisJobs[index] with { Status = status, ErrorCode = code, Message = message, UpdatedAtUtc = DateTimeOffset.UtcNow };
            await WriteVerifiedAsync(dataset);
        }
        finally { gate.Release(); }
    }
    internal async Task PublishAnalysis(string jobId, DleAnalysisResponse response)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var jobIndex = dataset.AnalysisJobs.FindIndex(j => j.Input.JobId == jobId);
            if (jobIndex < 0 || dataset.AnalysisJobs[jobIndex].Status != "VALIDATING") return;
            var job = dataset.AnalysisJobs[jobIndex];
            var recordIndex = dataset.Records.FindIndex(r => r.IntakeId == job.Input.IntakeId);
            DleAnalysisDocument[]? sources = null;
            try { if (recordIndex >= 0) { sources = await AnalysisDocuments(dataset.Records[recordIndex]); ApprovePilot(sources); } }
            catch (Exception e) when (e is IOException or SimRfqIntakeProblem) { sources = null; }
            if (sources is null || !SameAnalysisSources(job.Input, dataset.Records[recordIndex], sources) ||
                DleAnalysisContract.Hash(Encoding.UTF8.GetBytes(DleAnalysisContract.Instructions)) != job.Input.InstructionHash)
            {
                dataset.AnalysisJobs[jobIndex] = job with { Status = "STALE", UpdatedAtUtc = DateTimeOffset.UtcNow,
                    ErrorCode = "SOURCE_CHANGED", Message = "Review or sources changed during analysis. No candidate was replaced." };
            }
            else
            {
                DleAnalysisContract.Validate(job.Input, response.Result);
                var record = dataset.Records[recordIndex];
                var review = record.TechnicalReview!;
                var rows = response.Result.Rows.Select((r, i) => {
                    var values = r.Fields.ToDictionary(p => p.Key, p => p.Value.Value ?? "");
                    return new SimCandidateRow(i, values, new(values), [], r.Fields.ToDictionary(p => p.Key, p => p.Value.Relationship),
                        false, null, null, [], Guid.NewGuid().ToString("D"), r.Fields);
                }).ToArray();
                var candidate = new SimCandidateBom(Guid.NewGuid().ToString("D"), "Candidate BOM — Pilot", job.Input.GoverningDocumentId,
                    sources.Single(d => d.Source.DocumentId == job.Input.GoverningDocumentId).Source.Sha256, job.Input.GoverningPage,
                    "DLE analysis", false, DateTimeOffset.UtcNow, job.Input.RequestedBy,
                    job.Input.Sources.Where(s => s.Role == "SUPPORTING").Select(s => s.DocumentId).ToArray(),
                    "Partial analysis. Supporting evidence is shown per field; human review is required.", rows,
                    new(jobId, job.Input, response.Provider, response.ProviderVersion, response.Model, response.Result.Coverage, response.Result.CoverageReason),
                    SimCandidateBomProvider.ContractVersion);
                var versions = review.CandidateBomVersions ?? [];
                if (review.CandidateBom is not null) versions = versions.Append(review.CandidateBom).ToArray();
                dataset.Records[recordIndex] = record with { TechnicalReview = review with { CandidateBom = candidate, CandidateBomVersions = versions, MaterialsReviewStatus = null, NextReviewPhase = null } };
                dataset.AnalysisJobs[jobIndex] = job with { Status = "SUCCEEDED", CandidateId = candidate.Id, UpdatedAtUtc = DateTimeOffset.UtcNow };
            }
            // Candidate and terminal job state are committed together by the existing single writer.
            await WriteVerifiedAsync(dataset);
        }
        finally { gate.Release(); }
    }
}
