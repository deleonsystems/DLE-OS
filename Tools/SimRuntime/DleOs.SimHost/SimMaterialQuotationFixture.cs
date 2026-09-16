using System.Globalization;
using System.Text.Json;

internal sealed record SimMaterialQuotationFixtureCustomer(string CustomerId, string CustomerNumber, string CustomerName);
internal sealed record SimMaterialQuotationFixtureAssembly(string AssemblyNumber, string Revision, int Quantity);
internal sealed record SimMaterialQuotationFixtureRow(string PartNumber, string Quantity, string Designators,
    string Description, string ComponentType, string[] AlternatePartNumbers);
internal sealed record SimMaterialQuotationFixtureDefinition(string Schema, string IntakeId, string RequestCorrelationId,
    string ScenarioId, DateTimeOffset CreatedAtUtc, SimMaterialQuotationFixtureCustomer Customer,
    SimMaterialQuotationFixtureAssembly Assembly, SimMaterialQuotationFixtureRow[] Rows);

internal sealed partial class SimRfqIntakeStore
{
    internal const string MaterialQuotationFixtureId = "RFQI-SIM-0040";
    private const string MaterialQuotationFixtureSchema = "DLE_MATERIAL_QUOTATION_UI_FIXTURE_V1";

    internal async Task EnsureMaterialQuotationFixtureAsync(string repositoryRoot)
    {
        var fixturePath = Path.Combine(repositoryRoot, "Tools", "SimRuntime", "Scenarios", "material-quotation.ui-fixture.v1.json");
        SimRuntimeOptions.EnsureDescendant(repositoryRoot, fixturePath);
        var fixture = JsonSerializer.Deserialize<SimMaterialQuotationFixtureDefinition>(
            await File.ReadAllTextAsync(fixturePath), jsonOptions)
            ?? throw new InvalidDataException("Material Quotation UI fixture is unreadable.");
        ValidateMaterialQuotationFixture(fixture);

        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var existing = dataset.Records.SingleOrDefault(record => record.IntakeId == fixture.IntakeId);
            if (existing is not null)
            {
                if (existing.ScenarioId != fixture.ScenarioId || !RfqEligible(existing))
                    throw new InvalidDataException($"{fixture.IntakeId} is already used by a non-fixture record.");
                return;
            }

            dataset.Records.Add(BuildMaterialQuotationFixture(fixture));
            dataset.LastIntakeSequence = Math.Max(dataset.LastIntakeSequence, 40);
            dataset.UpdatedAtUtc = fixture.CreatedAtUtc;
            await WriteVerifiedAsync(dataset);
        }
        finally { gate.Release(); }
    }

    private static void ValidateMaterialQuotationFixture(SimMaterialQuotationFixtureDefinition fixture)
    {
        if (fixture.Schema != MaterialQuotationFixtureSchema || fixture.IntakeId != MaterialQuotationFixtureId ||
            !Guid.TryParse(fixture.RequestCorrelationId, out _) || fixture.Customer is null || fixture.Assembly is null ||
            fixture.Assembly.Quantity <= 0 || fixture.Rows is null || fixture.Rows.Length is < 6 or > 20 ||
            fixture.Rows.Any(row => string.IsNullOrWhiteSpace(row.PartNumber) || string.IsNullOrWhiteSpace(row.Description) ||
                !decimal.TryParse(row.Quantity, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var quantity) || quantity <= 0 ||
                row.ComponentType is not ("STANDARD_COTS" or "SUBASSEMBLY" or "REFERENCE_ONLY" or "OTHER")))
            throw new InvalidDataException("Material Quotation UI fixture contract is invalid.");
    }

    private static SimRfqIntakeRecord BuildMaterialQuotationFixture(SimMaterialQuotationFixtureDefinition fixture)
    {
        const string reviewer = "SIM Material Quotation Fixture";
        const string bomDocumentId = "SIM-UI-BOM-0040";
        const string drawingDocumentId = "SIM-UI-DRAWING-0040";
        var package = new SimTechnicalPackage(
            [new(bomDocumentId, "SIM Material Quotation Fixture BOM", "BOM", "GOVERNING", "PARENT_ASSEMBLY", null),
             new(drawingDocumentId, "SIM Material Quotation Fixture Assembly Drawing", "ASSEMBLY_DRAWING", "GOVERNING", "PARENT_ASSEMBLY", null)],
            bomDocumentId, "SIM_MATERIAL_QUOTATION_UI_FIXTURE_V1", true, reviewer, fixture.CreatedAtUtc, "STANDALONE_BOM");
        var rows = fixture.Rows.Select((definition, index) =>
        {
            var values = new Dictionary<string, string>
            {
                ["lineNumber"] = (index + 1).ToString(CultureInfo.InvariantCulture),
                ["partNumber"] = definition.PartNumber,
                ["quantity"] = definition.Quantity,
                ["designators"] = definition.Designators,
                ["description"] = definition.Description
            };
            var alternates = definition.AlternatePartNumbers.Select((partNumber, alternateIndex) =>
                new SimCandidateAlternate($"SIM-ALT-0040-{index + 1:D3}-{alternateIndex + 1:D2}", null, partNumber,
                    "MANUAL", "CONFIRMED", "None.", null, "Synthetic UI fixture", null, null,
                    [new("ADDED", null, partNumber, "CONFIRMED", reviewer, fixture.CreatedAtUtc)])).ToArray();
            return new SimCandidateRow(index, new(values), new(values), [],
                SimCandidateBomProvider.Fields.ToDictionary(field => field, _ => "MATCH"), true, reviewer,
                fixture.CreatedAtUtc, [], $"SIM-ROW-0040-{index + 1:D3}", null, alternates, 0, definition.ComponentType);
        }).ToArray();
        var candidate = new SimCandidateBom("SIM-CANDIDATE-0040-V1", "Accepted BOM — Material Quotation UI Fixture",
            bomDocumentId, "synthetic-ui-fixture-no-source-binary", 1, "SIM_MATERIAL_QUOTATION_UI_FIXTURE_V1", true,
            fixture.CreatedAtUtc, reviewer, [], "Synthetic fixture; no supplier comparison asserted.", rows,
            ContractVersion: SimCandidateBomProvider.ContractVersion);
        var acceptance = new SimBomAcceptance(1, candidate, package, reviewer, fixture.CreatedAtUtc);
        var manufacturing = new SimManufacturingDefinition("SIM-MFG-0040-V1", drawingDocumentId, [], [], [], package,
            true, reviewer, fixture.CreatedAtUtc);
        var outputs = new SimQuotationInputs("READY", "QUOTATION_MATERIALS", acceptance, "QUOTATION_LABOR",
            manufacturing, reviewer, fixture.CreatedAtUtc);
        var workflow = new SimReviewWorkflow("PACKAGE_REVIEW_V1", true, true, true, null, manufacturing, outputs,
            [new("FIXTURE_RELEASE", "Deterministic Material Quotation UI fixture", reviewer, fixture.CreatedAtUtc)]);
        var history = new SimAssemblyHistoryQuestion(fixture.Assembly.AssemblyNumber, fixture.Customer.CustomerNumber,
            true, false, [], null, [], "SIM_MATERIAL_QUOTATION_UI_FIXTURE_V1", true, fixture.CreatedAtUtc,
            "NEW_ASSEMBLY", reviewer, fixture.CreatedAtUtc);
        var review = new SimTechnicalReviewResult("RFQ_REVIEW", "PCB_ASSEMBLY", "", "", false, [], [],
            "DLE_FULL_TURNKEY", [], true, "TECHNICAL_REVIEW_COMPLETE", "READY_FOR_RFQ_WORKING_QUEUE",
            "QUOTATION_INPUTS", "READY", reviewer, fixture.CreatedAtUtc,
            "Deterministic synthetic record for Material Quotation UI development.", history,
            null, package, [], candidate, [], [acceptance], "QUALIFIED", null,
            ["MANUFACTURING_DEFINITION", "MATERIAL_BOM_DEFINITION"], "COMPLETE", workflow);
        return new SimRfqIntakeRecord(fixture.IntakeId, fixture.RequestCorrelationId, "DLE_RFQ_INTAKE_V1",
            "Technical Review", "READY_FOR_RFQ_WORKING_QUEUE", "NEW_QUOTE_REQUEST",
            new(fixture.Customer.CustomerId, fixture.Customer.CustomerNumber, fixture.Customer.CustomerName,
                "SIM_MATERIAL_QUOTATION_UI_FIXTURE_V1"), 1,
            [new(1, fixture.Assembly.AssemblyNumber, fixture.Assembly.Revision, fixture.Assembly.Quantity)],
            "MATERIAL_AND_LABOR", false, [], "SYNTHETIC_UI_FIXTURE_NO_BINARIES", ["PRICE", "LEAD_TIME"],
            reviewer, fixture.CreatedAtUtc, fixture.ScenarioId, 1, "SIM", review);
    }
}
