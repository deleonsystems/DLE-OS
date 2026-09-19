internal sealed record SimBomColumnMapping(string Header, string Field);
internal sealed record SimScannedBomSetup(string Id, string DocumentId, string Sha256, int StartPage, int EndPage,
    SimBomColumnMapping[] Columns, string Reviewer, DateTimeOffset SavedAtUtc);
internal sealed record SimScannedBomSource(string DocumentId, string Sha256, SimPdfReadabilityResult Readability,
    SimScannedBomSetup? Setup, bool NeedsConfirmation);
internal sealed record SimScannedBomSetupRequest(string DocumentId, string Sha256, string ExpectedReviewToken,
    string? ExpectedSetupId, int StartPage, int EndPage, SimBomColumnMapping[] Columns);

internal sealed partial class SimRfqIntakeStore
{
    private static readonly HashSet<string> SetupFields = ["FIND_NUMBER", "CUSTOMER_PART_NUMBER", "QUANTITY", "UNIT",
        "REFERENCE_DESIGNATORS", "DESCRIPTION", "MANUFACTURER_1", "MANUFACTURER_PART_NUMBER_1", "MANUFACTURER_2",
        "MANUFACTURER_PART_NUMBER_2", "MANUFACTURER_3", "MANUFACTURER_PART_NUMBER_3", "MANUFACTURER_IDENTITY_1",
        "MANUFACTURER_IDENTITY_2", "MANUFACTURER_IDENTITY_3", "IGNORE"];

    internal async Task<SimScannedBomSource?> ScannedBomSource(SimRfqIntakeRecord record)
    {
        var id = record.TechnicalReview?.TechnicalPackage?.GoverningBomDocumentId;
        var file = record.TechnicalFiles.SingleOrDefault(f => f.DocumentId == id && f.BinaryStatus == "VERIFIED" && f.Type == "application/pdf");
        if (file is null) return null;
        var bytes = await documents.Bytes(record.RequestCorrelationId, file.DocumentId!);
        var readability = file.Readability ?? await SimPdfReadability.Inspect(bytes);
        var hash = DleAnalysisContract.Hash(bytes);
        var setup = record.TechnicalReview?.ScannedBomSetup;
        return new(file.DocumentId!, hash, readability, setup,
            setup is not null && (setup.DocumentId != id || setup.Sha256 != hash));
    }

    private async Task RequireTextBom(SimRfqIntakeRecord record)
    {
        if ((await ScannedBomSource(record))?.Readability.Status == "IMAGE_ONLY")
            throw SimRfqIntakeProblem.Conflict("SCANNED_BOM_SETUP_REQUIRED",
                "Scanned BOM — use Set Up BOM Extraction. Read & Build Candidate BOM is coming next.");
    }

    internal async Task<object?> SaveScannedBomSetup(string intakeId, SimScannedBomSetupRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var dataset = await ReadDatasetAsync();
            var record = dataset.Records.SingleOrDefault(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r))
                ?? throw SimRfqIntakeProblem.NotFound("REVIEW_MISSING", "Review not found.");
            if (record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" || record.TechnicalReview?.Workflow?.Outputs is not null)
                throw SimRfqIntakeProblem.Conflict("SETUP_READ_ONLY", "Start Technical Review before saving BOM setup.");
            var source = await ScannedBomSource(record);
            if (source is null || source.Readability.Status != "IMAGE_ONLY")
                throw SimRfqIntakeProblem.Conflict("SCANNED_SOURCE_REQUIRED", "Select a scanned Main BOM PDF first.");
            if (request.DocumentId != source.DocumentId || request.Sha256 != source.Sha256 ||
                request.ExpectedReviewToken != PackageReviewToken(record) || request.ExpectedSetupId != source.Setup?.Id)
                throw SimRfqIntakeProblem.Conflict("BOM_SETUP_STALE", "The source or review changed. Reopen setup and confirm it again.");
            if (request.StartPage < 1 || request.EndPage < request.StartPage || source.Readability.PageCount is not int pages || request.EndPage > pages)
                throw SimRfqIntakeProblem.BadRequest("BOM_SETUP_PAGES", "Choose a valid start and end page within this PDF.");
            if (request.Columns is null || request.Columns.Length is < 1 or > 32 || request.Columns.Any(c =>
                c is null || string.IsNullOrWhiteSpace(c.Header) || c.Header.Length > 120 || !SetupFields.Contains(c.Field)))
                throw SimRfqIntakeProblem.BadRequest("BOM_SETUP_COLUMNS", "Give each column a drawing header and a meaning.");
            var mapped = request.Columns.Where(c => c.Field != "IGNORE").Select(c => c.Field).ToArray();
            if (mapped.Distinct().Count() != mapped.Length || !mapped.Contains("CUSTOMER_PART_NUMBER") || !mapped.Contains("QUANTITY"))
                throw SimRfqIntakeProblem.BadRequest("BOM_SETUP_COLUMNS", "Map Customer P/N and Qty; use each meaning only once, except Ignore.");
            for (var i = 1; i <= 3; i++)
                if (mapped.Contains($"MANUFACTURER_IDENTITY_{i}") && (mapped.Contains($"MANUFACTURER_{i}") || mapped.Contains($"MANUFACTURER_PART_NUMBER_{i}")))
                    throw SimRfqIntakeProblem.BadRequest("BOM_SETUP_COLUMNS", "Use either combined or separate manufacturer columns for each source.");
            var columns = request.Columns.Select(c => c with { Header = c.Header.Trim() }).ToArray();
            var existing = source.Setup;
            // Validate concurrency and source first, even for an unchanged save. Preserve identity and timestamp on a no-op.
            if (existing is null || existing.DocumentId != source.DocumentId || existing.Sha256 != source.Sha256 ||
                existing.StartPage != request.StartPage || existing.EndPage != request.EndPage || !existing.Columns.SequenceEqual(columns))
            {
                var setup = new SimScannedBomSetup(Guid.NewGuid().ToString("D"), source.DocumentId, source.Sha256,
                    request.StartPage, request.EndPage, columns, persona.DisplayName, DateTimeOffset.UtcNow);
                var updated = record with { TechnicalReview = record.TechnicalReview! with { ScannedBomSetup = setup } };
                dataset.Records[dataset.Records.IndexOf(record)] = updated;
                dataset.UpdatedAtUtc = DateTimeOffset.UtcNow;
                await WriteVerifiedAsync(dataset);
            }
        }
        finally { gate.Release(); }
        return await ReadTechnicalReviewAsync(intakeId);
    }
}
