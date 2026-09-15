using System.Text;
using System.Text.Json;

internal sealed partial class SimRfqIntakeStore
{
    // Pure projection: no document reads, inferred reviewer decisions, or source-selection changes.
    internal static DleDocumentAnalysisProfile AnalysisProfile(string intakeId, SimTechnicalPackage package, SimPackageDocument doc, string? selectionVersion = null)
    {
        var classification = new DleReviewedClassification(doc.DocumentType, doc.EmbeddedBom, doc.Role,
            doc.Applicability, doc.SubassemblyPartNumber, doc.IdentityReview?.Type);
        var partNumbers = new DlePartNumberContext(doc.PartNumberReview?.Basis, doc.PartNumberReview?.ProvidesManufacturerPartNumbers);
        var evidence = new DleReviewEvidence(string.IsNullOrEmpty(package.ReviewedBy) ? null : package.ReviewedBy,
            package.ReviewedAtUtc == default ? null : package.ReviewedAtUtc,
            doc.IdentityReview?.ReviewedBy, doc.IdentityReview?.ReviewedAtUtc, doc.IdentityReview?.Decision,
            doc.PartNumberReview?.ReviewedBy, doc.PartNumberReview?.ReviewedAtUtc);
        var reviewed = doc.IdentityReview?.Decision is "CONFIRMED" or "CORRECTED" || !string.IsNullOrEmpty(package.ReviewedBy);
        var resolvedScope = doc.Applicability == "PARENT_ASSEMBLY" ||
            (doc.Applicability == "SUBASSEMBLY" && !string.IsNullOrWhiteSpace(doc.SubassemblyPartNumber));
        string? purpose = doc.DocumentId == package.GoverningBomDocumentId ? "GOVERNING_BOM" :
            reviewed && resolvedScope && doc.Role is "SUPPORTING" or "REFERENCED" && doc.DocumentType != "UNKNOWN"
                ? partNumbers.ProvidesManufacturerPartNumbers == true ? "MANUFACTURER_ENRICHMENT" : "REFERENCE"
                : null;
        if (selectionVersion == DleAnalysisContract.SourceSelectionVersion)
            purpose = SimAnalysisSourceSelection.Purpose(package, doc);
        var fingerprint = DleAnalysisContract.Hash(JsonSerializer.SerializeToUtf8Bytes(new {
            package.GoverningBomDocumentId, classification, partNumbers, evidence, purpose
        }, DleAnalysisContract.Json));
        return new(DleAnalysisContract.ProfileVersion, new(intakeId, doc.DocumentId), classification, partNumbers, evidence, purpose, fingerprint);
    }

    private async Task<DleAnalysisDocument[]> AnalysisDocuments(SimRfqIntakeRecord record, string? selectionVersion = null)
    {
        RequireWorkflowMaterials(record);
        var review = record.TechnicalReview;
        var package = review?.TechnicalPackage;
        var governing = package?.Documents.SingleOrDefault(d => d.DocumentId == package.GoverningBomDocumentId);
        if (record.Environment != "SIM" || record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" ||
            review?.AssemblyHistory?.AssemblyClassification is not ("EXISTING_ASSEMBLY" or "NEW_ASSEMBLY") ||
            governing is not { DocumentType: "ASSEMBLY_DRAWING", EmbeddedBom: true, Applicability: "PARENT_ASSEMBLY", Role: "GOVERNING" })
            throw SimRfqIntakeProblem.Conflict("ANALYSIS_SOURCE_REQUIRED", "Confirm assembly history and select the governing parent assembly drawing first.");
        var selected = SimAnalysisSourceSelection.Select(package!, selectionVersion);
        var output = new List<DleAnalysisDocument>();
        foreach (var selectedDocument in selected)
        {
            var file = record.TechnicalFiles.SingleOrDefault(d => d.DocumentId == selectedDocument.DocumentId && d.BinaryStatus == "VERIFIED")
                ?? throw SimRfqIntakeProblem.Conflict("ANALYSIS_BINARY_REQUIRED", "Each selected source must have a verified staged binary.");
            await documents.Verify(record.RequestCorrelationId, file, record.CreatedBy);
            var bytes = await documents.Bytes(record.RequestCorrelationId, file.DocumentId!);
            output.Add(new(new(file.DocumentId!, DleAnalysisContract.Hash(bytes), file.Name, file.Type,
                selectedDocument.DocumentType, selectedDocument.Role, selectedDocument.Applicability, selectedDocument.EmbeddedBom,
                AnalysisProfile(record.IntakeId, package!, selectedDocument, selectionVersion)), bytes));
        }
        return output.ToArray();
    }
    internal async Task<DleAnalysisJob> SubmitAnalysis(string intakeId, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var record = dataset.Records.SingleOrDefault(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r))
                ?? throw SimRfqIntakeProblem.NotFound("ANALYSIS_REVIEW_MISSING", "Review not found.");
            var sources = await AnalysisDocuments(record, DleAnalysisContract.SourceSelectionVersion);
            var route = DleAnalysisPolicy.Select(sources);
            var enriched = route == DleAnalysisPolicy.Local && sources.Any(s => s.Source.Profile?.DerivedAnalysisPurpose == "MANUFACTURER_ENRICHMENT");
            var instructionVersion = enriched ? DleAnalysisContract.EnrichedInstructionVersion : DleAnalysisContract.InstructionVersion;
            var existing = dataset.AnalysisJobs.LastOrDefault(j => j.Input.IntakeId == intakeId && DleAnalysisContract.Active(j.Status));
            if (existing is not null) return existing;
            var assembly = record.Assemblies.OrderBy(a => a.LineNumber).First();
            var now = DateTimeOffset.UtcNow;
            var input = new DleAnalysisInput(Guid.NewGuid().ToString("D"), "BUILD_CANDIDATE_BOM", intakeId,
                assembly.AssemblyNumber, assembly.Revision, assembly.Quantity, record.TechnicalReview!.TechnicalPackage!.GoverningBomDocumentId!,
                sources.Select(d => d.Source).ToArray(), 2, enriched ? 1000 : 10, DleAnalysisContract.InputVersion,
                enriched ? DleAnalysisContract.EnrichedResultVersion : DleAnalysisContract.ResultVersion,
                instructionVersion, DleAnalysisContract.Hash(Encoding.UTF8.GetBytes(DleAnalysisContract.InstructionsFor(instructionVersion))),
                "GOVERNING_AUTHORITATIVE_SUPPORTING_CORROBORATES_ONLY", persona.DisplayName, now, now.AddMinutes(3), route,
                DleAnalysisContract.SourceSelectionVersion);
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
                var sources = await AnalysisDocuments(record, job.Input.SourceSelectionVersion);
                if (!SameAnalysisSources(job.Input, record, sources)) throw new InvalidDataException("Source changed");
                if (DleAnalysisContract.Hash(Encoding.UTF8.GetBytes(DleAnalysisContract.InstructionsFor(job.Input.InstructionVersion))) != job.Input.InstructionHash)
                    throw new InvalidDataException("Instructions changed");
                DleAnalysisPolicy.RequirePermitted(job.Input.ProviderRoute, sources);
                job = job with { Status = "RUNNING", UpdatedAtUtc = DateTimeOffset.UtcNow };
                dataset.AnalysisJobs[index] = job;
                await WriteVerifiedAsync(dataset);
                // Providers receive the persisted snapshot, never refreshed live review metadata.
                return (job, sources.Select(d => new DleAnalysisDocument(
                    job.Input.Sources.Single(s => s.DocumentId == d.Source.DocumentId), d.Bytes)).ToArray());
            }
            catch (Exception e) when (e is IOException or InvalidDataException or SimRfqIntakeProblem)
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
        if (input.ContractVersion != DleAnalysisContract.InputVersion && input.ContractVersion != DleAnalysisContract.LegacyInputVersion)
            return false;
        // V1 jobs keep their original comparison semantics and are never relabelled as V2.
        var current = sources.Select(d => input.ContractVersion == DleAnalysisContract.LegacyInputVersion
            ? d.Source with { Profile = null } : d.Source);
        var assembly = record.Assemblies.OrderBy(a => a.LineNumber).First();
        return record.TechnicalReview?.TechnicalPackage?.GoverningBomDocumentId == input.GoverningDocumentId &&
            assembly.AssemblyNumber == input.Assembly && assembly.Revision == input.Revision && assembly.Quantity == input.Quantity &&
            JsonSerializer.Serialize(current.OrderBy(s => s.DocumentId)) == JsonSerializer.Serialize(input.Sources.OrderBy(s => s.DocumentId));
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
            try { if (recordIndex >= 0) { sources = await AnalysisDocuments(dataset.Records[recordIndex], job.Input.SourceSelectionVersion); DleAnalysisPolicy.RequirePermitted(job.Input.ProviderRoute, sources); } }
            catch (Exception e) when (e is IOException or InvalidDataException or SimRfqIntakeProblem) { sources = null; }
            if (sources is null || !SameAnalysisSources(job.Input, dataset.Records[recordIndex], sources) ||
                DleAnalysisContract.Hash(Encoding.UTF8.GetBytes(DleAnalysisContract.InstructionsFor(job.Input.InstructionVersion))) != job.Input.InstructionHash)
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
                        false, null, null, [], Guid.NewGuid().ToString("D"), r.Fields,
                        ManufacturerIdentity: job.Input.ResultVersion == DleAnalysisContract.EnrichedResultVersion
                            ? new(r.ManufacturerProposals ?? [], r.ManufacturerUncertainty ?? "No manufacturer proposal.", []) : null);
                }).ToArray();
                var candidate = new SimCandidateBom(Guid.NewGuid().ToString("D"), job.Input.ResultVersion == DleAnalysisContract.EnrichedResultVersion ? "Candidate BOM" : "Candidate BOM — Pilot", job.Input.GoverningDocumentId,
                    sources.Single(d => d.Source.DocumentId == job.Input.GoverningDocumentId).Source.Sha256, job.Input.GoverningPage,
                    "DLE analysis", false, DateTimeOffset.UtcNow, job.Input.RequestedBy,
                    job.Input.Sources.Where(s => s.DocumentId != job.Input.GoverningDocumentId).Select(s => s.DocumentId).ToArray(),
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
