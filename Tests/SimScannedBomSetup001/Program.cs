using System.Text.Json;
using System.Text.Json.Nodes;

// Read existing local scenarios; perform every mutation in disposable test storage.
var repository = Path.GetFullPath(args[0]);
var root = Path.Combine(Path.GetTempPath(), "dle-scanned-setup-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(Path.Combine(root, "data"));
var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var sourceData = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(repository, ".sim-state/data/rfq-intakes.json")))!;
var recordNode = sourceData["records"]!.AsArray().Single(n => n!["intakeId"]!.GetValue<string>() == "RFQI-SIM-0040")!.DeepClone();
recordNode["technicalReview"]!.AsObject().Remove("scannedBomSetup");
var record = recordNode.Deserialize<SimRfqIntakeRecord>(options)!;
var textRecord = sourceData["records"]!.AsArray().Single(n => n!["intakeId"]!.GetValue<string>() == "RFQI-SIM-0035")!.Deserialize<SimRfqIntakeRecord>(options)!;
foreach (var r in new[] { record, textRecord })
{
    var folder = Path.Combine(root, "intake-documents", r.RequestCorrelationId);
    Directory.CreateDirectory(folder);
    foreach (var f in r.TechnicalFiles.Where(f => f.DocumentId is not null))
        foreach (var suffix in new[] { ".bin", ".json" })
            File.Copy(Path.Combine(repository, ".sim-state/intake-documents", r.RequestCorrelationId, f.DocumentId + suffix), Path.Combine(folder, f.DocumentId + suffix));
}
var data = new JsonObject { ["schema"] = "DLE_RFQ_INTAKE_DATASET_V1", ["records"] = new JsonArray(recordNode) };
var dataPath = Path.Combine(root, "data/rfq-intakes.json");
await File.WriteAllTextAsync(dataPath, data.ToJsonString());
var store = new SimRfqIntakeStore(root);
var persona = new SimPersona("test", "test", "Setup Reviewer", "ACTIVE", [], [], true, "SIM");
void Check(bool ok, string message) { if (!ok) throw new Exception(message); Console.WriteLine("PASS: " + message); }
async Task Reject(Func<Task> action, string code)
{
    try { await action(); throw new Exception("Expected " + code); }
    catch (SimRfqIntakeProblem e) { Check(e.Code == code, code); }
}
var source = (await store.ScannedBomSource(record))!;
Check(source.Readability.Status == "IMAGE_ONLY" && source.Readability.PageCount == 5, "older Scenario 2 detected locally without metadata mutation");
var preview = await SimPdfPagePreview.Render(await new SimIntakeDocuments(root).Bytes(record.RequestCorrelationId, source.DocumentId), 3);
Check(preview.Take(8).SequenceEqual(new byte[] {137,80,78,71,13,10,26,10}), "page 3 renders locally as PNG without OCR");
Check((await store.ScannedBomSource(textRecord))?.Readability.Status == "TEXT_READABLE", "Scenario 1 remains text-readable");
await Reject(async () => { await store.SubmitAnalysis(record.IntakeId, persona); }, "SCANNED_BOM_SETUP_REQUIRED");
var envelope = JsonSerializer.SerializeToElement(await store.ReadTechnicalReviewAsync(record.IntakeId), options);
var request = new SimScannedBomSetupRequest(source.DocumentId, source.Sha256, envelope.GetProperty("packageReviewToken").GetString()!, null, 3, 5,
    [new("ITEM", "FIND_NUMBER"),new("PART NUMBER", "CUSTOMER_PART_NUMBER"),new("REF DESIG.", "REFERENCE_DESIGNATORS"),new("QTY", "QUANTITY"),
     new("UNIT", "UNIT"),new("DESCRIPTION", "DESCRIPTION"),new("MFR #1 / PART NUMBER", "MANUFACTURER_IDENTITY_1"),
     new("MFR #2 / PART NUMBER", "MANUFACTURER_IDENTITY_2"),new("MFR #3 / PART NUMBER", "MANUFACTURER_IDENTITY_3")]);
await Reject(async () => { await store.SaveScannedBomSetup(record.IntakeId, request with { Sha256 = "wrong" }, persona); }, "BOM_SETUP_STALE");
await Reject(async () => { await store.SaveScannedBomSetup(record.IntakeId, request with { EndPage = 6 }, persona); }, "BOM_SETUP_PAGES");
await Reject(async () => { await store.SaveScannedBomSetup(record.IntakeId, request with { Columns = [new("P/N", "CUSTOMER_PART_NUMBER"),new("QTY", "QUANTITY"),new("QTY2", "QUANTITY")] }, persona); }, "BOM_SETUP_COLUMNS");
var saved = JsonSerializer.SerializeToElement(await store.SaveScannedBomSetup(record.IntakeId, request, persona), options);
var savedRecord = saved.GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
var setup = savedRecord.TechnicalReview!.ScannedBomSetup!;
Check(setup.StartPage == 3 && setup.EndPage == 5 && setup.Columns.Length == 9 && setup.Sha256 == source.Sha256 && setup.Reviewer == persona.DisplayName, "pages/mappings/hash/reviewer saved");
Check(JsonSerializer.Serialize(savedRecord with { TechnicalReview = savedRecord.TechnicalReview with { ScannedBomSetup = null } }, options) == JsonSerializer.Serialize(record, options), "setup changes no BOM/business/review decisions");
await Reject(async () => { await store.SaveScannedBomSetup(record.IntakeId, request, persona); }, "BOM_SETUP_STALE");
await Reject(async () => { await store.SubmitAnalysis(record.IntakeId, persona); }, "SCANNED_BOM_SETUP_REQUIRED");
var reopened = JsonSerializer.SerializeToElement(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(record.IntakeId), options);
Check(!reopened.GetProperty("scannedBomSource").GetProperty("needsConfirmation").GetBoolean(), "reopen shows current setup ready");
var replacement = await new SimIntakeDocuments(root).Stage(record.RequestCorrelationId, "replacement.pdf", 1,
    new MemoryStream(await new SimIntakeDocuments(root).Bytes(record.RequestCorrelationId, source.DocumentId)), persona.DisplayName);
var changed = savedRecord with { TechnicalFiles = [.. savedRecord.TechnicalFiles, replacement], TechnicalReview = savedRecord.TechnicalReview with {
    TechnicalPackage = savedRecord.TechnicalReview.TechnicalPackage! with { GoverningBomDocumentId = replacement.DocumentId } } };
Check((await store.ScannedBomSource(changed))!.NeedsConfirmation, "different source ID cannot silently reuse setup even with identical bytes");
Check((await store.ScannedBomSource(savedRecord with { TechnicalReview = savedRecord.TechnicalReview with { ScannedBomSetup = setup with { Sha256 = "old-hash" } } }))!.NeedsConfirmation, "different hash requires confirmation");
Console.WriteLine("Disposable test state: " + root);
