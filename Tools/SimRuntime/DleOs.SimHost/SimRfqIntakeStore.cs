using System.Text.Json;

internal sealed record SimRfqIntakeDocument(
    string Name,
    long Size,
    string Type,
    long LastModified);

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
    string ReviewerNotes);

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
}

internal sealed class SimRfqIntakeStore
{
    private const string DatasetSchema = "DLE_RFQ_INTAKE_DATASET_V1";
    private readonly string dataPath;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly JsonSerializerOptions jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    internal SimRfqIntakeStore(string stateRoot)
    {
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

            var sequence = dataset.Records.Count + 1;
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
                request.TechnicalFiles ?? [],
                request.TechnicalFilesProvided ? "METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED" : "NOT_PROVIDED",
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
            persona.DisplayName, DateTimeOffset.UtcNow, request.ReviewerNotes?.Trim() ?? "");
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
