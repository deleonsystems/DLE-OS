using System.Text.Json;
using System.Text.Json.Nodes;

internal static class PreservedWorksheetTests
{
    internal static async Task Run(SimRfqIntakeStore store, SimRfqIntakeRecord record, SimPersona persona, string dataPath, JsonSerializerOptions options)
    {
        void Check(bool ok, string label) { if (!ok) throw new Exception(label); Console.WriteLine("PASS: " + label); }
        async Task Reject(Func<Task> action, string code)
        {
            try { await action(); throw new Exception("Expected " + code); }
            catch (SimRfqIntakeProblem e) { Check(e.Code == code, code); }
        }
        var old = record.TechnicalReview!.ScannedBomReview!;
        Check(old.Setup.Id != record.TechnicalReview.ScannedBomSetup!.Id, "fixture reproduces newer current setup and original worksheet setup");
        var before = await File.ReadAllTextAsync(dataPath);
        var opened = JsonSerializer.SerializeToElement(await store.OpenScannedBomReview(record.IntakeId), options);
        Check(await File.ReadAllTextAsync(dataPath) == before, "opening preserved worksheet does not write dataset or run extraction");
        var w = opened.GetProperty("record").GetProperty("technicalReview").GetProperty("scannedBomReview").Deserialize<SimScannedBomReview>(options)!;
        Check(JsonSerializer.Serialize(w,options) == JsonSerializer.Serialize(old,options) && w.Rows.Length == 106, "worksheet ID/version/106 rows/corrections/provenance unchanged on open");
        var current = record.TechnicalReview.ScannedBomSetup!;
        var sameSetup = new SimScannedBomSetupRequest(current.DocumentId,current.Sha256,opened.GetProperty("packageReviewToken").GetString()!,current.Id,current.StartPage,current.EndPage,current.Columns);
        var noOp = JsonSerializer.SerializeToElement(await store.SaveScannedBomSetup(record.IntakeId,sameSetup,persona),options);
        Check(await File.ReadAllTextAsync(dataPath) == before, "unchanged setup save performs no dataset write, ID/timestamp/version changes");
        Check(!noOp.GetProperty("scannedBomSource").GetProperty("needsConfirmation").GetBoolean(), "persisted current document/hash/setup is ready");
        var edits = w.Rows.Select(r => new SimScanRowEdit(r.Position,r.RowType,r.Cells.ToDictionary(c=>c.Key,c=>c.Value.Value),r.SourceNote,r.Reviewed)).ToArray();
        edits[0].Values["REFERENCE_DESIGNATORS"] = "U1";
        edits[1] = edits[1] with { RowType = "OTHER", SourceNote = "Disposable save qualification", Reviewed = true };
        var request = new SimScanSaveRequest(w.Id,w.Version,w.Setup.DocumentId,w.Setup.Sha256,w.Setup.Id,opened.GetProperty("packageReviewToken").GetString()!,edits);
        await Reject(async()=>{await store.SaveScannedBomReview(record.IntakeId,request with {SetupId=record.TechnicalReview.ScannedBomSetup.Id},persona);},"SCAN_REVIEW_STALE");
        var saved = JsonSerializer.SerializeToElement(await store.SaveScannedBomReview(record.IntakeId,request,persona),options);
        var result = saved.GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
        var persisted = JsonSerializer.SerializeToElement(await store.OpenScannedBomReview(record.IntakeId), options)
            .GetProperty("record").GetProperty("technicalReview").GetProperty("scannedBomReview").Deserialize<SimScannedBomReview>(options)!;
        Check(persisted.Version == old.Version + 1 && persisted.Rows[1].RowType == "OTHER" &&
            persisted.Rows[1].SourceNote == "Disposable save qualification" && persisted.Rows[1].Reviewed,
            "save persists row types, notes, reviewed state and incremented version across reopen");
        Check(JsonSerializer.Serialize(persisted.Setup, options) == JsonSerializer.Serialize(old.Setup, options) &&
            persisted.Rows.Zip(old.Rows).All(pair => pair.First.Page == pair.Second.Page && pair.First.Position == pair.Second.Position &&
                pair.First.Cells.All(c => c.Value.Original == pair.Second.Cells[c.Key].Original && c.Value.SourceBounds == pair.Second.Cells[c.Key].SourceBounds)),
            "save preserves original mapping, document/hash associations, OCR originals and all source bounds");
        Check(result.TechnicalReview!.ScannedBomReview!.Rows[0].Cells["REFERENCE_DESIGNATORS"].Value == "U1" && result.TechnicalReview.ScannedBomReview.Setup.Id == old.Setup.Id,
            "edit/save works against original worksheet setup in disposable state");
        Check(result.TechnicalReview.ScannedBomSetup!.Id == record.TechnicalReview.ScannedBomSetup.Id && result.TechnicalReview.CandidateBom is null,
            "save does not alter current mapping or publish Candidate");
        await Reject(async()=>{await store.SaveScannedBomReview(record.IntakeId,request,persona);},"SCAN_REVIEW_STALE");
        var changedRequest = sameSetup with { ExpectedReviewToken = saved.GetProperty("packageReviewToken").GetString()!, EndPage = 4 };
        var changedSetup = JsonSerializer.SerializeToElement(await store.SaveScannedBomSetup(record.IntakeId,changedRequest,persona),options);
        Check(changedSetup.GetProperty("record").GetProperty("technicalReview").GetProperty("scannedBomSetup").GetProperty("id").GetString() != current.Id,
            "material page-range change creates a new setup ID");
        await Reject(async()=>{await store.SaveScannedBomSetup(record.IntakeId,changedRequest,persona);},"BOM_SETUP_STALE");
        var afterSetupChange = JsonSerializer.SerializeToElement(await store.OpenScannedBomReview(record.IntakeId),options);
        Check(afterSetupChange.GetProperty("record").GetProperty("technicalReview").GetProperty("scannedBomReview").GetRawText() == saved.GetProperty("record").GetProperty("technicalReview").GetProperty("scannedBomReview").GetRawText(),
            "changed current setup preserves and opens earlier worksheet exactly without extraction");
        var node = JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!;
        node["records"]![0]!["technicalReview"]!["scannedBomReview"]!["setup"]!["sha256"] = "changed";
        await File.WriteAllTextAsync(dataPath,node.ToJsonString());
        await Reject(async()=>{await store.OpenScannedBomReview(record.IntakeId);},"SCAN_REVIEW_SOURCE_UNAVAILABLE");
        Console.WriteLine("No OCR invoked; all test writes were to disposable storage: " + dataPath);
    }
}
