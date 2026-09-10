using System.Text.Json;

internal sealed record SimRfqIntakeDocument(
    string Name,
    long Size,
    string Type,
    long LastModified, string? DocumentId = null, string? BinaryStatus = null, string? DocumentReference = null, DateTimeOffset? StagedAtUtc = null);

internal sealed record SimRfqIntakeCustomer(
    string CustomerId,
    string CustomerNumber,
    string CustomerName,
    string ResolutionSource);

internal sealed record SimRfqIntakeAssembly(
    int LineNumber,
    string AssemblyNumber,
    string Revision,
    int Quantity);

internal sealed record SimRfqIntakeCreateRequest(
    string? IntakeType,
    SimRfqIntakeCustomer? Customer,
    int AssemblyCount,
    SimRfqIntakeAssembly[]? Assemblies,
    string? DeLeonScope,
    bool TechnicalFilesProvided,
    SimRfqIntakeDocument[]? TechnicalFiles,
    string[]? CustomerRequirements,
    string? CreatedBy,
    string? RequestCorrelationId);

internal sealed record SimTechnicalReviewDispositionRequest(
    string? AssemblyType,
    string? AssemblyDrawingFile,
    string? BomFile,
    bool GerbersRequired,
    string[]? GerberFiles,
    string[]? SubAssemblyDocuments,
    string? MaterialResponsibility,
    string[]? CustomerSuppliedItems,
    bool TechnicalPackageSufficient,
    string? Disposition,
    string? ReviewerNotes);

internal sealed record SimTechnicalReviewResult(
    string ReviewType,
    string AssemblyType,
    string AssemblyDrawingFile,
    string BomFile,
    bool GerbersRequired,
    string[] GerberFiles,
    string[] SubAssemblyDocuments,
    string MaterialResponsibility,
    string[] CustomerSuppliedItems,
    bool TechnicalPackageSufficient,
    string Disposition,
    string ReviewStatus,
    string? DownstreamHandoffTarget,
    string? DownstreamHandoffState,
    string ReviewedBy,
    DateTimeOffset ReviewedAtUtc,
    string ReviewerNotes,
    SimAssemblyHistoryQuestion? AssemblyHistory = null,
    SimMaterialsDefinition? MaterialsDefinition = null,
    SimTechnicalPackage? TechnicalPackage = null,
    SimSubassemblyCoverage[]? SubassemblyCoverage = null,
    SimCandidateBom? CandidateBom = null);

internal sealed class SimRfqIntakeProblem : Exception
{
    internal int StatusCode { get; }
    internal string Code { get; }

    private SimRfqIntakeProblem(int statusCode, string code, string message) : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }

    internal static SimRfqIntakeProblem BadRequest(string code, string message) =>
        new(StatusCodes.Status400BadRequest, code, message);

    internal static SimRfqIntakeProblem NotFound(string code, string message) =>
        new(StatusCodes.Status404NotFound, code, message);

    internal static SimRfqIntakeProblem Conflict(string code, string message) =>
        new(StatusCodes.Status409Conflict, code, message);
}

internal sealed class SimRfqIntakeStore
{
    private const string DatasetSchema = "DLE_RFQ_INTAKE_DATASET_V1";
    private readonly string dataPath;
    private readonly SimIntakeDocuments documents;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly JsonSerializerOptions jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    internal SimRfqIntakeStore(string stateRoot)
    {
        documents = new SimIntakeDocuments(stateRoot);
        dataPath = SimRuntimeOptions.ResolveStatePath(stateRoot, "data", "rfq-intakes.json");
    }

    internal async Task<object> CreateAsync(
        SimRfqIntakeCreateRequest request,
        SimPersona persona,
        SimStateMetadata metadata)
    {
        Validate(request);
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var correlationId = request.RequestCorrelationId!.Trim();
            var duplicate = dataset.Records.FirstOrDefault(record =>
                string.Equals(record.RequestCorrelationId, correlationId, StringComparison.Ordinal));
            if (duplicate is not null) return new { duplicate = true, record = duplicate };

            var verifiedFiles = new List<SimRfqIntakeDocument>();
            foreach (var file in request.TechnicalFiles ?? [])
            {
                if (file.DocumentId is not null) verifiedFiles.Add(await documents.Verify(correlationId, file, persona.DisplayName));
                else if (file.BinaryStatus is not null || file.DocumentReference is not null || file.StagedAtUtc is not null)
                    throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_REFERENCE_INVALID", "Verified binary state requires a governed staged document.");
                else verifiedFiles.Add(file);
            }
            if (verifiedFiles.Where(file => file.DocumentId is not null).Select(file => file.DocumentId).Distinct().Count() != verifiedFiles.Count(file => file.DocumentId is not null))
                throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_REFERENCE_INVALID", "A staged document cannot be attached twice.");
            var sequence = checked(++dataset.LastIntakeSequence);
            var intakeId = $"RFQI-SIM-{sequence:0000}";
            var now = DateTimeOffset.UtcNow;
            var record = new SimRfqIntakeRecord(
                intakeId,
                correlationId,
                "DLE_RFQ_INTAKE_V1",
                "Technical Review",
                "READY_FOR_RFQ_QUALIFICATION",
                request.IntakeType!.Trim(),
                request.Customer!,
                request.AssemblyCount,
                request.Assemblies!,
                request.DeLeonScope!.Trim(),
                request.TechnicalFilesProvided,
                verifiedFiles.ToArray(),
                request.TechnicalFilesProvided ? verifiedFiles.All(file => file.BinaryStatus == "VERIFIED") ? "BINARIES_VERIFIED_SIM" : "METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED" : "NOT_PROVIDED",
                request.CustomerRequirements!,
                persona.DisplayName,
                now,
                metadata.ScenarioId,
                metadata.Generation,
                "SIM");
            dataset.Records.Add(record);
            dataset.UpdatedAtUtc = now;
            await WriteVerifiedAsync(dataset);
            return new { duplicate = false, record };
        }
        finally
        {
            gate.Release();
        }
    }

    internal async Task<SimRfqIntakeDocument> StageDocument(string draft, string name, long modified, Stream stream, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            if ((await ReadDatasetAsync()).Records.Any(r => r.RequestCorrelationId == draft)) throw SimRfqIntakeProblem.Conflict("SIM_INTAKE_ALREADY_SUBMITTED", "This intake has already been submitted.");
            return await documents.Stage(draft, name, modified, stream, persona.DisplayName);
        }
        finally { gate.Release(); }
    }
    internal async Task RemoveStagedDocument(string draft, string id, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            if ((await ReadDatasetAsync()).Records.Any(r => r.RequestCorrelationId == draft)) throw SimRfqIntakeProblem.Conflict("SIM_INTAKE_ALREADY_SUBMITTED", "Submitted intake documents cannot be removed as drafts.");
            await documents.Remove(draft,id,persona.DisplayName);
        }
        finally { gate.Release(); }
    }
    internal async Task<(SimRfqIntakeDocument Document, byte[] Bytes)> OpenDocument(string intakeId, string id)
    {
        var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == intakeId);
        var doc = record?.TechnicalFiles.SingleOrDefault(d => d.DocumentId == id && d.BinaryStatus == "VERIFIED");
        if (doc is null) throw SimRfqIntakeProblem.NotFound("SIM_DOCUMENT_NOT_FOUND", "No staged document with this ID belongs to the intake.");
        return (doc, await documents.Bytes(record!.RequestCorrelationId,id));
    }

    internal async Task<object?> ReadAsync(string intakeId)
    {
        var dataset = await ReadDatasetAsync();
        return dataset.Records.FirstOrDefault(record =>
            string.Equals(record.IntakeId, intakeId, StringComparison.OrdinalIgnoreCase));
    }

    internal async Task<object> ListTechnicalReviewsAsync()
    {
        var dataset = await ReadDatasetAsync();
        var items = dataset.Records
            .Where(IsTechnicalReviewRecord)
            .Where(record => record.Status is not ("NO_LONGER_REQUIRED" or "READY_FOR_RFQ_WORKING_QUEUE"))
            .OrderByDescending(record => record.CreatedAtUtc)
            .Select(BuildTechnicalReviewQueueItem)
            .ToArray();
        return new
        {
            items,
            returnedCount = items.Length,
            reviewType = "RFQ_REVIEW",
            environment = "SIM",
            synthetic = true
        };
    }

    internal async Task<object?> ReadTechnicalReviewAsync(string intakeId)
    {
        var dataset = await ReadDatasetAsync();
        var record = dataset.Records.FirstOrDefault(item =>
            string.Equals(item.IntakeId, intakeId, StringComparison.OrdinalIgnoreCase) &&
            IsTechnicalReviewRecord(item));
        return record is null ? null : new
        {
            reviewType = "RFQ_REVIEW",
            reviewTypeLabel = "RFQ Review",
            reviewStatusLabel = ReviewStatusLabel(record.Status),
            deletionEligibility = new { allowed = DeletionBlockReason(record) is null, reason = DeletionBlockReason(record) },
            record
        };
    }

    internal async Task<object> SaveTechnicalReviewAsync(
        string intakeId,
        SimTechnicalReviewDispositionRequest request,
        SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(item =>
                string.Equals(item.IntakeId, intakeId, StringComparison.OrdinalIgnoreCase) &&
                IsTechnicalReviewRecord(item));
            if (index < 0)
                throw SimRfqIntakeProblem.NotFound("DLE_OS_SIM_TECHNICAL_REVIEW_NOT_FOUND",
                    "The SIM Technical Review item does not exist.");

            var record = dataset.Records[index];
            // Closed reviews remain readable, but stale clients cannot reopen or overwrite them.
            if (record.Status == "NO_LONGER_REQUIRED" && request.Disposition != "NO_LONGER_REQUIRED")
                throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_CLOSED",
                    "This Technical Review is closed as No Longer Required.");
            var result = ValidateTechnicalReview(request, record, persona);
            var status = result.DownstreamHandoffState ?? result.ReviewStatus;
            var updated = record with { Status = status, TechnicalReview = result };
            dataset.Records[index] = updated;
            dataset.UpdatedAtUtc = result.ReviewedAtUtc;
            await WriteVerifiedAsync(dataset);
            return new
            {
                reviewType = "RFQ_REVIEW",
                reviewTypeLabel = "RFQ Review",
                reviewStatusLabel = ReviewStatusLabel(updated.Status),
                record = updated
            };
        }
        finally
        {
            gate.Release();
        }
    }

    internal async Task<object> UpdateAssemblyHistoryAsync(string intakeId, string? classification, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(item => item.IntakeId.Equals(intakeId, StringComparison.OrdinalIgnoreCase) && IsTechnicalReviewRecord(item));
            if (index < 0) throw SimRfqIntakeProblem.NotFound("DLE_OS_SIM_TECHNICAL_REVIEW_NOT_FOUND", "The SIM Technical Review item does not exist.");
            var record = dataset.Records[index];
            if (record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" || record.TechnicalReview is null)
                throw SimRfqIntakeProblem.Conflict("DLE_OS_SIM_REVIEW_NOT_STARTED", "Start an active Technical Review before answering the history question.");
            var history = record.TechnicalReview.AssemblyHistory ?? SimAssemblyHistoryProvider.Lookup(record);
            if (classification is not null)
            {
                var expected = history.HistoryFound ? "EXISTING_ASSEMBLY" : "NEW_ASSEMBLY";
                if (classification != expected)
                    throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_ASSEMBLY_CLASSIFICATION_INVALID", "The assembly decision must match the history lookup result.");
                if (history.AssemblyClassification != classification)
                    history = history with { AssemblyClassification = classification, ConfirmedBy = persona.DisplayName, ConfirmedAtUtc = DateTimeOffset.UtcNow };
            }
            if (history != record.TechnicalReview.AssemblyHistory)
            {
                record = record with { TechnicalReview = record.TechnicalReview with { AssemblyHistory = history } };
                dataset.Records[index] = record;
                dataset.UpdatedAtUtc = DateTimeOffset.UtcNow;
                await WriteVerifiedAsync(dataset);
            }
            return new { reviewType = "RFQ_REVIEW", reviewTypeLabel = "RFQ Review", reviewStatusLabel = ReviewStatusLabel(record.Status), record };
        }
        finally { gate.Release(); }
    }

    internal async Task<object> ReviewMaterialsAsync(string intakeId, SimPersona persona, SimPackageRequest? packageRequest = null, bool inventoryOnly = false)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(item => item.IntakeId.Equals(intakeId, StringComparison.OrdinalIgnoreCase) && IsTechnicalReviewRecord(item));
            if (index < 0) throw SimRfqIntakeProblem.NotFound("DLE_OS_SIM_TECHNICAL_REVIEW_NOT_FOUND", "The SIM Technical Review item does not exist.");
            var record = dataset.Records[index];
            var history = record.TechnicalReview?.AssemblyHistory;
            var revision = record.Assemblies.OrderBy(item => item.LineNumber).First().Revision.Trim();
            if (record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" || history?.AssemblyClassification != "EXISTING_ASSEMBLY" ||
                !history.RevisionsFound.Contains(revision, StringComparer.OrdinalIgnoreCase))
                throw SimRfqIntakeProblem.Conflict("DLE_OS_SIM_BOM_HISTORY_REQUIRED", "Confirm existing assembly history for the requested revision before reviewing materials.");
            if (inventoryOnly || record.TechnicalReview!.MaterialsDefinition is null || record.TechnicalReview.TechnicalPackage?.GoverningBomDocumentId is null)
            {
                var package = packageRequest is null ? record.TechnicalReview!.TechnicalPackage ?? SimTechnicalPackageProvider.Inventory(record) : SimTechnicalPackageProvider.Validate(record, packageRequest, persona);
                var definition = inventoryOnly ? null : SimMaterialsDefinitionProvider.Compare(record with { TechnicalReview = record.TechnicalReview! with { TechnicalPackage = package } }, persona);
                var sameSources = JsonSerializer.Serialize(package.Documents, jsonOptions) == JsonSerializer.Serialize(record.TechnicalReview!.TechnicalPackage?.Documents, jsonOptions) && package.GoverningBomDocumentId == record.TechnicalReview.TechnicalPackage?.GoverningBomDocumentId;
                record = record with { TechnicalReview = record.TechnicalReview! with { TechnicalPackage = package, MaterialsDefinition = definition, CandidateBom = sameSources ? record.TechnicalReview.CandidateBom : null,
                    SubassemblyCoverage = definition is null ? null : SimTechnicalPackageProvider.Coverage(package, definition) } };
                dataset.Records[index] = record;
                dataset.UpdatedAtUtc = DateTimeOffset.UtcNow;
                await WriteVerifiedAsync(dataset);
            }
            return new { reviewType = "RFQ_REVIEW", reviewTypeLabel = "RFQ Review", reviewStatusLabel = ReviewStatusLabel(record.Status), record };
        }
        finally { gate.Release(); }
    }

    internal async Task<object> CandidateBomAsync(string intakeId, SimPersona persona, SimCandidateReviewRequest? request = null)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r));
            if (index < 0) throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND", "Technical Review was not found.");
            var record = dataset.Records[index];
            var review = record.TechnicalReview;
            var package = review?.TechnicalPackage;
            var governing = package?.Documents.SingleOrDefault(d => d.DocumentId == package.GoverningBomDocumentId);
            if (record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" || review?.AssemblyHistory?.AssemblyClassification is not ("EXISTING_ASSEMBLY" or "NEW_ASSEMBLY") ||
                governing is not { DocumentType: "ASSEMBLY_DRAWING", EmbeddedBom: true, Applicability: "PARENT_ASSEMBLY", Role: "GOVERNING" })
                throw SimRfqIntakeProblem.Conflict("SIM_CANDIDATE_SOURCE_REQUIRED", "Start review, confirm assembly history, and explicitly select a governing parent assembly drawing with an embedded BOM.");
            var file = record.TechnicalFiles.SingleOrDefault(d => d.DocumentId == governing.DocumentId && d.BinaryStatus == "VERIFIED" && d.Type == "application/pdf");
            if (file is null) throw SimRfqIntakeProblem.Conflict("SIM_CANDIDATE_BINARY_REQUIRED", "The governing PDF must have a verified SIM staged binary.");
            var bytes = await documents.Bytes(record.RequestCorrelationId, file.DocumentId!);
            var candidate = review.CandidateBom;
            if (candidate is not null && (candidate.GoverningDocumentId != file.DocumentId || candidate.GoverningSha256 != Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant()))
                throw SimRfqIntakeProblem.Conflict("SIM_CANDIDATE_SOURCE_CHANGED", "The governing source changed. Reconfirm the package before building a new candidate.");
            if (request is not null)
            {
                if (candidate is null) throw SimRfqIntakeProblem.Conflict("SIM_CANDIDATE_REQUIRED", "Build the candidate before reviewing rows.");
                candidate = SimCandidateBomProvider.Review(candidate, request, persona);
            }
            else candidate ??= await SimCandidateBomProvider.Extract(bytes, package!, persona);
            record = record with { TechnicalReview = review with { CandidateBom = candidate } };
            dataset.Records[index] = record;
            dataset.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await WriteVerifiedAsync(dataset);
            return new { reviewType = "RFQ_REVIEW", reviewTypeLabel = "RFQ Review", reviewStatusLabel = ReviewStatusLabel(record.Status), record };
        }
        finally { gate.Release(); }
    }

    internal async Task<object> DeleteTechnicalReviewAsync(string intakeId)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var record = dataset.Records.FirstOrDefault(item =>
                string.Equals(item.IntakeId, intakeId, StringComparison.OrdinalIgnoreCase) && IsTechnicalReviewRecord(item));
            if (record is null)
                throw SimRfqIntakeProblem.NotFound("DLE_OS_SIM_TECHNICAL_REVIEW_NOT_FOUND",
                    "The SIM Technical Review item does not exist.");

            var blockedReason = DeletionBlockReason(record);
            if (blockedReason is not null)
                throw SimRfqIntakeProblem.Conflict("DLE_OS_SIM_TECHNICAL_REVIEW_DELETE_UNSAFE",
                    blockedReason + " Nothing was deleted.");

            foreach (var file in record.TechnicalFiles.Where(file => file.DocumentId is not null)) await documents.Verify(record.RequestCorrelationId, file, record.CreatedBy);
            // Own only this record, embedded review, and verified SIM copies.
            // Never interpret source filenames as paths or delete source/master data.
            dataset.Records.Remove(record);
            dataset.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await WriteVerifiedAsync(dataset);
            foreach (var file in record.TechnicalFiles.Where(file => file.DocumentId is not null)) await documents.Remove(record.RequestCorrelationId,file.DocumentId!,record.CreatedBy);
            return new { deleted = true, intakeId = record.IntakeId, environment = "SIM" };
        }
        finally
        {
            gate.Release();
        }
    }

    private static string? DeletionBlockReason(SimRfqIntakeRecord record)
    {
        if (record.Environment != "SIM") return "Deletion is limited to SIM intake records.";
        // RFQ Qualification is the original name for this same early intake destination.
        if (record.HandoffTarget is not ("Technical Review" or "RFQ Qualification"))
            return "The intake handoff target is outside the supported intake/review boundary.";
        if (record.DocumentPreservationState is not ("NOT_PROVIDED" or "METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED" or "BINARIES_VERIFIED_SIM"))
            return "The document storage state requires a governed ownership check before deletion.";
        var review = record.TechnicalReview;
        if (review is not null)
        {
            // ValidateTechnicalReview writes this exact pair without creating an RFQ work record.
            // Only that known placeholder is exempt; any other link/state remains protected.
            var futureRfqPlaceholder = review.DownstreamHandoffTarget == "RFQs" &&
                review.DownstreamHandoffState == "READY_FOR_RFQ_WORKING_QUEUE" &&
                review.Disposition == "QUALIFIED_READY_FOR_RFQ" && review.ReviewStatus == "QUALIFIED_READY_FOR_RFQ";
            if (!futureRfqPlaceholder && (!string.IsNullOrWhiteSpace(review.DownstreamHandoffTarget) ||
                !string.IsNullOrWhiteSpace(review.DownstreamHandoffState)))
                return "The review contains a downstream handoff reference that requires preservation or relationship verification.";
            if (!IsEarlyReviewState(review.ReviewStatus) || !IsEarlyReviewState(review.Disposition))
                return "The review status or disposition is outside the recognized early review states.";
        }
        return IsEarlyReviewState(record.Status) ? null : "The intake status is outside the recognized early review states.";
    }

    private static bool IsEarlyReviewState(string value) => value is
        "READY_FOR_RFQ_QUALIFICATION" or "TECHNICAL_REVIEW_IN_PROGRESS" or "START_TECHNICAL_REVIEW" or
        "QUALIFIED_READY_FOR_RFQ" or "READY_FOR_RFQ_WORKING_QUEUE" or
        "NO_LONGER_REQUIRED" or "NEEDS_CUSTOMER_CLARIFICATION" or "MISSING_TECHNICAL_DOCUMENTS" or
        "REVISION_DOCUMENT_CONFLICT" or "BLOCKED_NEEDS_ESCALATION";

    private static bool IsTechnicalReviewRecord(SimRfqIntakeRecord record) =>
        string.Equals(record.Schema, "DLE_RFQ_INTAKE_V1", StringComparison.Ordinal) &&
        string.Equals(record.IntakeType, "NEW_QUOTE_REQUEST", StringComparison.Ordinal);

    private static object BuildTechnicalReviewQueueItem(SimRfqIntakeRecord record)
    {
        var assembly = record.Assemblies.OrderBy(item => item.LineNumber).FirstOrDefault();
        return new
        {
            reviewType = "RFQ_REVIEW",
            reviewTypeLabel = "RFQ Review",
            record.IntakeId,
            record.Customer,
            assembly,
            record.CreatedAtUtc,
            record.DocumentPreservationState,
            record.Status,
            reviewStatusLabel = ReviewStatusLabel(record.Status),
            record.TechnicalReview
        };
    }

    private static string ReviewStatusLabel(string status) => status switch
    {
        "READY_FOR_RFQ_QUALIFICATION" => "Needs Technical Review",
        "TECHNICAL_REVIEW_IN_PROGRESS" => "Technical Review in progress",
        "NO_LONGER_REQUIRED" => "No Longer Required",
        "READY_FOR_RFQ_WORKING_QUEUE" => "Qualified — Ready for RFQ",
        "NEEDS_CUSTOMER_CLARIFICATION" => "Needs Customer Clarification",
        "MISSING_TECHNICAL_DOCUMENTS" => "Missing Technical Documents",
        "REVISION_DOCUMENT_CONFLICT" => "Revision / Document Conflict",
        "BLOCKED_NEEDS_ESCALATION" => "Blocked / Needs Escalation",
        _ => status.Replace('_', ' ')
    };

    private static SimTechnicalReviewResult ValidateTechnicalReview(
        SimTechnicalReviewDispositionRequest request,
        SimRfqIntakeRecord record,
        SimPersona persona)
    {
        var entryDisposition = request.Disposition?.Trim();
        if (entryDisposition is "START_TECHNICAL_REVIEW" or "NO_LONGER_REQUIRED")
        {
            if (record.Status == "READY_FOR_RFQ_WORKING_QUEUE" ||
                !string.IsNullOrWhiteSpace(record.TechnicalReview?.DownstreamHandoffTarget) ||
                !string.IsNullOrWhiteSpace(record.TechnicalReview?.DownstreamHandoffState))
                throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_ALREADY_HANDED_OFF",
                    "This review has already been handed off to RFQ.");
            var entryStatus = entryDisposition == "NO_LONGER_REQUIRED"
                ? "NO_LONGER_REQUIRED" : "TECHNICAL_REVIEW_IN_PROGRESS";
            var previous = record.TechnicalReview;
            if (previous?.Disposition == entryDisposition) return previous;
            var result = previous ?? new SimTechnicalReviewResult(
                "RFQ_REVIEW", "", "", "", false, [], [], "", [], false,
                "", "", null, null, "", default, "");
            return result with
            {
                Disposition = entryDisposition, ReviewStatus = entryStatus,
                DownstreamHandoffTarget = null, DownstreamHandoffState = null,
                ReviewedBy = persona.DisplayName, ReviewedAtUtc = DateTimeOffset.UtcNow
            };
        }

        var assemblyType = request.AssemblyType?.Trim() ?? "";
        if (assemblyType != "PCB_ASSEMBLY")
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_ASSEMBLY_TYPE_INVALID",
                "PCB Assembly is the only supported assembly type in Phase 1.");

        var disposition = request.Disposition?.Trim() ?? "";
        var statuses = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["QUALIFIED_READY_FOR_RFQ"] = "QUALIFIED_READY_FOR_RFQ",
            ["NEEDS_CUSTOMER_CLARIFICATION"] = "NEEDS_CUSTOMER_CLARIFICATION",
            ["MISSING_TECHNICAL_DOCUMENTS"] = "MISSING_TECHNICAL_DOCUMENTS",
            ["REVISION_DOCUMENT_CONFLICT"] = "REVISION_DOCUMENT_CONFLICT",
            ["BLOCKED_NEEDS_ESCALATION"] = "BLOCKED_NEEDS_ESCALATION"
        };
        if (!statuses.TryGetValue(disposition, out var reviewStatus))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_DISPOSITION_INVALID",
                "Select a supported Technical Review disposition.");

        var knownFiles = record.TechnicalFiles.Select(file => file.Name).ToHashSet(StringComparer.Ordinal);
        var drawing = request.AssemblyDrawingFile?.Trim() ?? "";
        var bom = request.BomFile?.Trim() ?? "";
        var gerbers = NormalizeFileSelection(request.GerberFiles, knownFiles, "Gerber");
        var subAssemblies = NormalizeFileSelection(request.SubAssemblyDocuments, knownFiles, "sub-assembly");
        if (!string.IsNullOrWhiteSpace(drawing) && !knownFiles.Contains(drawing))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_DOCUMENT_INVALID",
                "The selected Assembly Drawing is not present in the intake metadata.");
        if (!string.IsNullOrWhiteSpace(bom) && !knownFiles.Contains(bom))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_DOCUMENT_INVALID",
                "The selected BOM is not present in the intake metadata.");
        if (!string.IsNullOrWhiteSpace(drawing) && drawing == bom)
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_DOCUMENT_CONFLICT",
                "Assembly Drawing and BOM must identify different files.");

        var responsibility = request.MaterialResponsibility?.Trim() ?? "";
        if (responsibility is not ("FULL_TURNKEY" or "CUSTOMER_SUPPLIED" or "HYBRID"))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_RESPONSIBILITY_INVALID",
                "Select Full turnkey, Customer-supplied material, or Hybrid responsibility.");
        var customerSupplied = (request.CustomerSuppliedItems ?? [])
            .Select(value => value.Trim()).Where(value => value.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (responsibility is "CUSTOMER_SUPPLIED" or "HYBRID" && customerSupplied.Length == 0)
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_CUSTOMER_SUPPLY_REQUIRED",
                "Identify the customer-supplied material or components.");
        if (responsibility == "FULL_TURNKEY") customerSupplied = [];

        if (disposition == "QUALIFIED_READY_FOR_RFQ")
        {
            if (string.IsNullOrWhiteSpace(drawing) || string.IsNullOrWhiteSpace(bom))
                throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_MINIMUM_PACKAGE_REQUIRED",
                    "PCB Assembly qualification requires an Assembly Drawing and BOM.");
            if (responsibility == "FULL_TURNKEY" && request.GerbersRequired && gerbers.Length == 0)
                throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_GERBERS_REQUIRED",
                    "Gerbers are required for this full-turnkey PCB package before qualification.");
            if (!request.TechnicalPackageSufficient)
                throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_PACKAGE_INSUFFICIENT",
                    "A technically insufficient package cannot be qualified for RFQ.");
        }

        var qualified = disposition == "QUALIFIED_READY_FOR_RFQ";
        return new SimTechnicalReviewResult(
            "RFQ_REVIEW", assemblyType, drawing, bom, request.GerbersRequired, gerbers,
            subAssemblies, responsibility, customerSupplied, request.TechnicalPackageSufficient,
            disposition, reviewStatus, qualified ? "RFQs" : null,
            qualified ? "READY_FOR_RFQ_WORKING_QUEUE" : null,
            persona.DisplayName, DateTimeOffset.UtcNow, request.ReviewerNotes?.Trim() ?? "", record.TechnicalReview?.AssemblyHistory, record.TechnicalReview?.MaterialsDefinition, record.TechnicalReview?.TechnicalPackage, record.TechnicalReview?.SubassemblyCoverage, record.TechnicalReview?.CandidateBom);
    }

    private static string[] NormalizeFileSelection(string[]? selected, HashSet<string> knownFiles, string label)
    {
        var values = (selected ?? []).Select(value => value.Trim()).Where(value => value.Length > 0)
            .Distinct(StringComparer.Ordinal).ToArray();
        if (values.Any(value => !knownFiles.Contains(value)))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_TECHNICAL_REVIEW_DOCUMENT_INVALID",
                $"A selected {label} document is not present in the intake metadata.");
        return values;
    }

    private static void Validate(SimRfqIntakeCreateRequest request)
    {
        if (request.IntakeType != "NEW_QUOTE_REQUEST")
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_RFQ_INTAKE_TYPE_INVALID", "New Quote Request is the only supported intake type.");
        if (request.Customer is null || request.Customer.ResolutionSource != "sim-canonical-customer-directory" ||
            string.IsNullOrWhiteSpace(request.Customer.CustomerId) || string.IsNullOrWhiteSpace(request.Customer.CustomerName))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_RFQ_CUSTOMER_INVALID", "Select a customer from the SIM Canonical Customer Directory.");
        if (request.AssemblyCount < 1 || request.Assemblies is null || request.Assemblies.Length != request.AssemblyCount)
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_RFQ_ASSEMBLY_COUNT_INVALID", "Assembly count must match the supplied assembly records.");
        if (request.Assemblies.Any(item => string.IsNullOrWhiteSpace(item.AssemblyNumber) ||
            string.IsNullOrWhiteSpace(item.Revision) || item.Quantity < 1))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_RFQ_ASSEMBLY_INVALID", "Every assembly requires a number, explicit revision, and positive quantity.");
        if (request.DeLeonScope is not ("MATERIAL_AND_LABOR" or "LABOR_ONLY" or "MATERIAL_ONLY"))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_RFQ_SCOPE_INVALID", "Select a supported De Leon scope.");
        if (request.TechnicalFilesProvided && (request.TechnicalFiles is null || request.TechnicalFiles.Length == 0))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_RFQ_FILES_REQUIRED", "Associate at least one source file when technical files were provided.");
        if (request.CustomerRequirements is null || !request.CustomerRequirements.Contains("PRICE") ||
            !request.CustomerRequirements.Contains("LEAD_TIME"))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_RFQ_REQUIREMENTS_INVALID", "Price and Lead Time must be captured for this RFQ intake.");
        if (!Guid.TryParse(request.RequestCorrelationId, out _))
            throw SimRfqIntakeProblem.BadRequest("DLE_OS_SIM_RFQ_CORRELATION_INVALID", "Request correlation ID must be a UUID.");
    }

    private async Task<SimRfqIntakeDataset> ReadDatasetAsync()
    {
        if (!File.Exists(dataPath)) return new SimRfqIntakeDataset();
        await using var stream = File.OpenRead(dataPath);
        var dataset = await JsonSerializer.DeserializeAsync<SimRfqIntakeDataset>(stream, jsonOptions);
        if (dataset?.Schema != DatasetSchema)
            throw new InvalidOperationException("SIM RFQ Intake data schema is invalid.");
        // Upgrade legacy datasets before any mutation. Deletion must never recycle IDs.
        foreach (var record in dataset.Records)
        {
            if (record.IntakeId.StartsWith("RFQI-SIM-", StringComparison.Ordinal) &&
                long.TryParse(record.IntakeId[9..], out var sequence))
                dataset.LastIntakeSequence = Math.Max(dataset.LastIntakeSequence, sequence);
        }
        return dataset;
    }

    private async Task WriteVerifiedAsync(SimRfqIntakeDataset dataset)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(dataPath)!);
        var temporaryPath = dataPath + ".write-" + Guid.NewGuid().ToString("N");
        SimRuntimeOptions.EnsureDescendant(Path.GetDirectoryName(dataPath)!, temporaryPath);
        try
        {
            await File.WriteAllTextAsync(temporaryPath, JsonSerializer.Serialize(dataset, jsonOptions));
            await using (var verify = File.OpenRead(temporaryPath))
            {
                var roundTrip = await JsonSerializer.DeserializeAsync<SimRfqIntakeDataset>(verify, jsonOptions);
                if (roundTrip?.Schema != DatasetSchema || roundTrip.Records.Count != dataset.Records.Count)
                    throw new IOException("SIM RFQ Intake write verification failed.");
            }
            File.Move(temporaryPath, dataPath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private sealed class SimRfqIntakeDataset
    {
        public string Schema { get; set; } = DatasetSchema;
        public int Version { get; set; } = 1;
        public long LastIntakeSequence { get; set; }
        public DateTimeOffset UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
        public List<SimRfqIntakeRecord> Records { get; set; } = [];
    }
}

internal sealed record SimRfqIntakeRecord(
    string IntakeId,
    string RequestCorrelationId,
    string Schema,
    string HandoffTarget,
    string Status,
    string IntakeType,
    SimRfqIntakeCustomer Customer,
    int AssemblyCount,
    SimRfqIntakeAssembly[] Assemblies,
    string DeLeonScope,
    bool TechnicalFilesProvided,
    SimRfqIntakeDocument[] TechnicalFiles,
    string DocumentPreservationState,
    string[] CustomerRequirements,
    string CreatedBy,
    DateTimeOffset CreatedAtUtc,
    string ScenarioId,
    long Generation,
    string Environment,
    SimTechnicalReviewResult? TechnicalReview = null);
