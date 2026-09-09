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
                "RFQ Qualification",
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
    string Environment);
