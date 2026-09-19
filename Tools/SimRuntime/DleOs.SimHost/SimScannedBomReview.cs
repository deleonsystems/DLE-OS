using System.Diagnostics;
using System.Text.Json;

internal sealed record SimScanBounds(double X, double Y, double Width, double Height);
internal sealed record SimScanCell(string Value, string Original, string Status, SimScanBounds? SourceBounds = null);
internal sealed record SimScanRow(int Position, int Page, string RowType, Dictionary<string, SimScanCell> Cells,
    string SourceNote, bool Reviewed);
internal sealed record SimScannedBomReview(string Id, int Version, string IntakeId, SimScannedBomSetup Setup,
    string ExtractionMethod, SimScanRow[] Rows, string CreatedBy, DateTimeOffset CreatedAtUtc,
    string SavedBy, DateTimeOffset SavedAtUtc);
internal sealed record SimScanReadRequest(string DocumentId, string Sha256, string SetupId, string ExpectedReviewToken);
internal sealed record SimScanRowEdit(int Position, string RowType, Dictionary<string, string> Values, string SourceNote, bool Reviewed);
internal sealed record SimScanSaveRequest(string Id, int ExpectedVersion, string DocumentId, string Sha256,
    string SetupId, string ExpectedReviewToken, SimScanRowEdit[] Rows);

internal sealed partial class SimRfqIntakeStore
{
    private async Task RequirePreservedScanSource(SimRfqIntakeRecord record, SimScannedBomReview review)
    {
        var file = record.TechnicalFiles.SingleOrDefault(f => f.DocumentId == review.Setup.DocumentId &&
            f.BinaryStatus == "VERIFIED" && f.Type == "application/pdf");
        if (file is null || DleAnalysisContract.Hash(await documents.Bytes(record.RequestCorrelationId, review.Setup.DocumentId)) != review.Setup.Sha256)
            throw SimRfqIntakeProblem.Conflict("SCAN_REVIEW_SOURCE_UNAVAILABLE", "The worksheet's exact source document is unavailable or changed. The worksheet has been preserved.");
    }

    internal async Task<object?> OpenScannedBomReview(string intakeId)
    {
        var data = await ReadDatasetAsync();
        var record = data.Records.SingleOrDefault(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r))
            ?? throw SimRfqIntakeProblem.NotFound("REVIEW_MISSING", "Review not found.");
        var review = record.TechnicalReview?.ScannedBomReview
            ?? throw SimRfqIntakeProblem.NotFound("SCAN_REVIEW_MISSING", "No scanned BOM worksheet has been saved yet.");
        await RequirePreservedScanSource(record, review);
        return await ReadTechnicalReviewAsync(intakeId);
    }

    private async Task<SimScannedBomSetup> RequireScanReviewSource(SimRfqIntakeRecord record, string documentId,
        string hash, string setupId, string reviewToken)
    {
        if (record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" || record.TechnicalReview?.Workflow?.Outputs is not null)
            throw SimRfqIntakeProblem.Conflict("SCAN_REVIEW_READ_ONLY", "Start Technical Review before editing the scanned BOM.");
        var source = await ScannedBomSource(record);
        if (source?.Readability.Status != "IMAGE_ONLY" || source.Setup is null || source.NeedsConfirmation ||
            source.DocumentId != documentId || source.Sha256 != hash || source.Setup.Id != setupId ||
            PackageReviewToken(record) != reviewToken)
            throw SimRfqIntakeProblem.Conflict("SCAN_REVIEW_STALE", "The source or saved setup changed. Reopen Technical Review before continuing.");
        return source.Setup;
    }

    internal async Task<object?> ReadScannedBom(string intakeId, SimScanReadRequest request, SimPersona persona)
    {
        // Do not hold the dataset lock while OCR runs. Revalidate source, setup and workflow before persisting.
        var data = await ReadDatasetAsync();
        var record = data.Records.SingleOrDefault(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r))
            ?? throw SimRfqIntakeProblem.NotFound("REVIEW_MISSING", "Review not found.");
        var setup = await RequireScanReviewSource(record, request.DocumentId, request.Sha256, request.SetupId, request.ExpectedReviewToken);
        var existing = record.TechnicalReview!.ScannedBomReview;
        if (existing is not null)
        {
            if (existing.Setup.Id != setup.Id) throw SimRfqIntakeProblem.Conflict("SCAN_REVIEW_STALE", "The saved worksheet uses an earlier setup. It has been preserved; do not overwrite it.");
            return await ReadTechnicalReviewAsync(intakeId);
        }
        var rows = await SimScannedBomReader.Read(await documents.Bytes(record.RequestCorrelationId, setup.DocumentId), setup);
        await gate.WaitAsync();
        try
        {
            data = await ReadDatasetAsync();
            record = data.Records.SingleOrDefault(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r))
                ?? throw SimRfqIntakeProblem.NotFound("REVIEW_MISSING", "Review not found.");
            await RequireScanReviewSource(record, request.DocumentId, request.Sha256, request.SetupId, request.ExpectedReviewToken);
            if (record.TechnicalReview!.ScannedBomReview is null)
            {
                var now = DateTimeOffset.UtcNow;
                var review = new SimScannedBomReview(Guid.NewGuid().ToString("D"), 1, intakeId, setup,
                    "LOCAL_WINDOWS_OCR_VERIFIED_LAYOUT_V1", rows, persona.DisplayName, now, persona.DisplayName, now);
                data.Records[data.Records.IndexOf(record)] = record with { TechnicalReview = record.TechnicalReview with { ScannedBomReview = review } };
                data.UpdatedAtUtc = now;
                await WriteVerifiedAsync(data);
            }
        }
        finally { gate.Release(); }
        return await ReadTechnicalReviewAsync(intakeId);
    }

    internal async Task<object?> SaveScannedBomReview(string intakeId, SimScanSaveRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try
        {
            var data = await ReadDatasetAsync();
            var record = data.Records.SingleOrDefault(r => r.IntakeId == intakeId && IsTechnicalReviewRecord(r))
                ?? throw SimRfqIntakeProblem.NotFound("REVIEW_MISSING", "Review not found.");
            var review = record.TechnicalReview!.ScannedBomReview;
            if (record.Status != "TECHNICAL_REVIEW_IN_PROGRESS" || record.TechnicalReview.Workflow?.Outputs is not null)
                throw SimRfqIntakeProblem.Conflict("SCAN_REVIEW_READ_ONLY", "Start Technical Review before editing the scanned BOM.");
            if (review is null || review.Id != request.Id || review.Version != request.ExpectedVersion ||
                review.Setup.Id != request.SetupId || review.Setup.DocumentId != request.DocumentId || review.Setup.Sha256 != request.Sha256 ||
                PackageReviewToken(record) != request.ExpectedReviewToken)
                throw SimRfqIntakeProblem.Conflict("SCAN_REVIEW_STALE", "This worksheet changed in another session. Reopen it before saving.");
            await RequirePreservedScanSource(record, review);
            var setup = review.Setup;
            var fields = setup.Columns.Select(c => c.Field).ToHashSet();
            var types = new HashSet<string> { "COMPONENT", "NOT_USED", "BLANK", "CONTINUATION", "OTHER" };
            if (request.Rows is null || request.Rows.Length != review.Rows.Length || request.Rows.Any(r => r is null) ||
                !request.Rows.Select(r => r.Position).SequenceEqual(review.Rows.Select(r => r.Position)) ||
                request.Rows.Any(r => !types.Contains(r.RowType) || r.Values is null || !fields.SetEquals(r.Values.Keys) ||
                    r.Values.Values.Any(v => v is null || v.Length > 1000) || r.SourceNote is null || r.SourceNote.Length > 2000))
                throw SimRfqIntakeProblem.BadRequest("SCAN_REVIEW_ROWS", "Keep every source position and mapped column. Check the row types and text lengths.");
            var rows = review.Rows.Zip(request.Rows, (row, edit) => row with {
                RowType = edit.RowType, SourceNote = edit.SourceNote, Reviewed = edit.Reviewed,
                Cells = row.Cells.ToDictionary(c => c.Key, c => c.Value with {
                    Value = edit.Values[c.Key], Status = edit.Reviewed ? "REVIEWED" :
                        edit.Values[c.Key] != c.Value.Value ? "CORRECTED" : c.Value.Status == "REVIEWED" ? "NEEDS_REVIEW" : c.Value.Status })
            }).ToArray();
            var now = DateTimeOffset.UtcNow;
            var updated = review with { Version = review.Version + 1, Rows = rows, SavedBy = persona.DisplayName, SavedAtUtc = now };
            var derivedCandidate = record.TechnicalReview.CandidateBom?.ReviewedScanSource is not null ? record.TechnicalReview.CandidateBom : null;
            data.Records[data.Records.IndexOf(record)] = record with { TechnicalReview = record.TechnicalReview with {
                ScannedBomReview = updated,
                CandidateBom = derivedCandidate is not null ? null : record.TechnicalReview.CandidateBom,
                CandidateBomVersions = derivedCandidate is not null ? (record.TechnicalReview.CandidateBomVersions ?? []).Append(derivedCandidate).ToArray() : record.TechnicalReview.CandidateBomVersions,
                MaterialsReviewStatus = record.TechnicalReview.CandidateBom?.ReviewedScanSource is not null ? null : record.TechnicalReview.MaterialsReviewStatus,
                NextReviewPhase = record.TechnicalReview.CandidateBom?.ReviewedScanSource is not null ? null : record.TechnicalReview.NextReviewPhase } };
            data.UpdatedAtUtc = now;
            await WriteVerifiedAsync(data);
        }
        finally { gate.Release(); }
        return await ReadTechnicalReviewAsync(intakeId);
    }
}

internal static class SimScannedBomReader
{
    private static readonly SemaphoreSlim Slot = new(1);
    internal static async Task<SimScanRow[]> Read(byte[] bytes, SimScannedBomSetup setup)
    {
        // V1 uses the layout checked against this exact scan. An unqualified layout must never guess row/column positions.
        string[] fields = ["FIND_NUMBER", "CUSTOMER_PART_NUMBER", "REFERENCE_DESIGNATORS", "QUANTITY", "UNIT", "DESCRIPTION",
            "MANUFACTURER_1", "MANUFACTURER_PART_NUMBER_1", "MANUFACTURER_2", "MANUFACTURER_PART_NUMBER_2", "MANUFACTURER_3", "MANUFACTURER_PART_NUMBER_3"];
        if (setup.Sha256 != "26423130598d77611b5aef4ace057cef889d452d152a73611887c76203c638db" ||
            DleAnalysisContract.Hash(bytes) != setup.Sha256 || setup.StartPage != 3 || setup.EndPage != 5 ||
            !setup.Columns.Select(c => c.Field).SequenceEqual(fields))
            throw SimRfqIntakeProblem.Conflict("SCAN_LAYOUT_UNVERIFIED", "This scanned table's row and column layout has not been verified yet. The saved setup is preserved.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        try { await Slot.WaitAsync(timeout.Token); }
        catch (OperationCanceledException e) { throw new IOException("Local scanned BOM reading is busy. Try again.", e); }
        using var process = new Process();
        try
        {
            var python = Environment.GetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON") ?? Path.Combine(
                Environment.GetEnvironmentVariable("USERPROFILE") ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
            process.StartInfo = new(python) { UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            process.StartInfo.ArgumentList.Add("-I");
            process.StartInfo.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "sim_scanned_bom.py"));
            process.Start();
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var errors = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.StandardInput.BaseStream.WriteAsync(bytes, timeout.Token); process.StandardInput.Close();
            await process.WaitForExitAsync(timeout.Token);
            var json = await output; await errors;
            if (process.ExitCode != 0) throw new IOException("Local scanned BOM reading failed. Your saved review has not been changed.");
            var rows = JsonSerializer.Deserialize<SimScanRow[]>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
            if (rows.Length != 106 || !rows.Select(r => r.Position).SequenceEqual(Enumerable.Range(1, 106)) ||
                rows.Any(r => r.Page != (r.Position <= 48 ? 3 : r.Position <= 96 ? 4 : 5) || !fields.ToHashSet().SetEquals(r.Cells.Keys)))
                throw new IOException("The scanned table structure could not be verified.");
            return rows;
        }
        catch (Exception e) when (e is OperationCanceledException or System.ComponentModel.Win32Exception or JsonException)
        { throw new IOException("Local scanned BOM reading is unavailable. Try again.", e); }
        finally
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            Slot.Release();
        }
    }
}
