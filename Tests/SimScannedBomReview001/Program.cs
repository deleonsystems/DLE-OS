using System.Text.Json;
using System.Text.Json.Nodes;

try
{
var repository = Path.GetFullPath(args[0]);
var root = Path.Combine(Path.GetTempPath(), "dle-scan-review-test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(Path.Combine(root, "data"));
var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
if (args.Contains("--identity-browser")) {
    var browserStore=new SimRfqIntakeStore(args[^1]);
    try {
        var input=JsonNode.Parse(Console.In.ReadToEnd())!;var id=(string)input["intakeId"]!;
        object? response=(string?)input["action"] switch {
            "review"=>await browserStore.CandidateBomAsync(id,new SimPersona("test","test","Browser Reviewer","ACTIVE",[],[],true,"SIM"),input["request"]!.Deserialize<SimCandidateReviewRequest>(options)),
            "readiness"=>await browserStore.BomCompletionReadiness(id,input["request"]!.Deserialize<SimBomCompletionRequest>(options)!),
            _=>await browserStore.ReadTechnicalReviewAsync(id)
        };
        Console.WriteLine(JsonSerializer.Serialize(response,options));
    } catch(SimRfqIntakeProblem e){Console.WriteLine(JsonSerializer.Serialize(new {message=e.Message,code=e.Code},options));Environment.ExitCode=1;}
    return;
}
if (args.Contains("--row-current-state")) { await CandidateCurrentStateTests.Run(repository, options); return; }
if (args.Contains("--positions")) { await PositionCoverageTests.Run(repository, options, args[^1]); return; }
if (args.Contains("--dnp")) { await DnpTests.Run(repository, options); return; }
if (args.Contains("--customer-identity")) { await CustomerIdentityTests.Run(repository, options); return; }
if (args.Contains("--approved-parts")) { await ApprovedPartManagerTests.Run(repository, options); return; }
if (args.Contains("--progress")) { await CandidateProgressTests.Run(repository, options); return; }
if (args.Contains("--inline-description")) { await InlineDescriptionTests.Run(repository, args[^1], options); return; }
var dataset = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(repository, ".sim-state/data/rfq-intakes.json")))!;
var recordNode = dataset["records"]!.AsArray().Single(n => (string?)n!["intakeId"] == "RFQI-SIM-0041")!.DeepClone();
if (!args.Contains("--preserved") && !args.Contains("--candidate")) recordNode["technicalReview"]!.AsObject().Remove("scannedBomReview");
// Candidate lifecycle qualification starts without derived history, regardless of the local scenario's progress.
if (args.Contains("--candidate")) { recordNode["status"]="TECHNICAL_REVIEW_IN_PROGRESS"; recordNode["technicalReview"]!["workflow"]!["outputs"]=null; }
if (args.Contains("--candidate"))
    foreach (var field in new[] { "candidateBom", "candidateBomVersions", "bomAcceptances", "materialsReviewStatus", "nextReviewPhase" })
        recordNode["technicalReview"]!.AsObject().Remove(field);
var record = recordNode.Deserialize<SimRfqIntakeRecord>(options)!;
var textRecord = dataset["records"]!.AsArray().Single(n => (string?)n!["intakeId"] == "RFQI-SIM-0035")!.Deserialize<SimRfqIntakeRecord>(options)!;
foreach (var r in new[] { record, textRecord })
{
    var folder = Path.Combine(root, "intake-documents", r.RequestCorrelationId);
    Directory.CreateDirectory(folder);
    foreach (var f in r.TechnicalFiles.Where(f => f.DocumentId is not null))
        foreach (var ext in new[] { ".json", ".bin" })
            File.Copy(Path.Combine(repository, ".sim-state/intake-documents", r.RequestCorrelationId, f.DocumentId + ext), Path.Combine(folder, f.DocumentId + ext));
}
var dataPath = Path.Combine(root, "data/rfq-intakes.json");
await File.WriteAllTextAsync(dataPath, new JsonObject { ["schema"] = "DLE_RFQ_INTAKE_DATASET_V1", ["records"] = new JsonArray(recordNode) }.ToJsonString());
var store = new SimRfqIntakeStore(root);
var persona = new SimPersona("test", "test", "Worksheet Tester", "ACTIVE", [], [], true, "SIM");
if (args.Contains("--candidate")) { await ScannedCandidateTests.Run(store, record, persona, dataPath, options); if ((await store.ScannedBomSource(textRecord))?.Readability.Status != "TEXT_READABLE") throw new Exception("Scenario 1 changed"); Console.WriteLine("PASS: Scenario 1 remains text-readable"); return; }
if (args.Contains("--preserved")) { await PreservedWorksheetTests.Run(store, record, persona, dataPath, options); return; }
void Check(bool ok, string label) { if (!ok) throw new Exception(label); Console.WriteLine("PASS: " + label); }
async Task Reject(Func<Task> action, string code) { try { await action(); throw new Exception("Expected rejection " + code); } catch (SimRfqIntakeProblem e) { Check(e.Code == code, code); } }
JsonElement Envelope(object? value) => JsonSerializer.SerializeToElement(value, options);
var envelope = Envelope(await store.ReadTechnicalReviewAsync(record.IntakeId));
var setup = record.TechnicalReview!.ScannedBomSetup!;
var request = new SimScanReadRequest(setup.DocumentId, setup.Sha256, setup.Id, envelope.GetProperty("packageReviewToken").GetString()!);
await Reject(async () => { await store.ReadScannedBom(record.IntakeId, request with { Sha256 = "wrong" }, persona); }, "SCAN_REVIEW_STALE");
var bytes = await new SimIntakeDocuments(root).Bytes(record.RequestCorrelationId, setup.DocumentId);
await Reject(async () => { await SimScannedBomReader.Read(bytes, setup with { EndPage = 4 }); }, "SCAN_LAYOUT_UNVERIFIED");
var read = Envelope(await store.ReadScannedBom(record.IntakeId, request, persona));
request = request with { ExpectedReviewToken = read.GetProperty("packageReviewToken").GetString()! };
var afterRecord = read.GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
var review = afterRecord.TechnicalReview!.ScannedBomReview!;
Check(review.Rows.Length == 106 && review.Rows.Select(r => r.Position).SequenceEqual(Enumerable.Range(1,106)), "all 106 fixed source positions survive local OCR");
Check(review.Rows.GroupBy(r => r.Page).Select(g => g.Count()).SequenceEqual(new[] {48,48,10}), "pages 3–5 only, correct per-page coverage");
Check(review.Rows.All(r => r.Cells.Count == 12), "12 mapped columns on every row");
Check(review.Rows[40].Cells["MANUFACTURER_1"].Value == "YAGEO" && review.Rows[40].Cells["MANUFACTURER_2"].Value == "PANASONIC" && review.Rows[40].Cells["MANUFACTURER_3"].Value == "STACKPOLE", "three manufacturer identities remain in their columns");
Check(review.Rows[97].Cells.ContainsKey("QUANTITY") && review.Rows[105].Cells.ContainsKey("QUANTITY"), "A/R cells survive even if not read");
Check(review.Rows.Count(r => r.RowType == "NOT_USED") == 14 && review.Rows.Count(r => r.RowType == "BLANK") == 6 && review.Rows[27].RowType == "CONTINUATION", "special rows preserved separately");
Check(review.Rows[46].SourceNote.Contains("SEND LOOSE") && review.Rows[102].SourceNote.Contains("ATI TO SUPPLY"), "footnote markers and source notes preserved");
Check(JsonSerializer.Serialize(afterRecord with { TechnicalReview = afterRecord.TechnicalReview with { ScannedBomReview = null } }, options) == JsonSerializer.Serialize(record, options), "no Candidate or other business/review fields changed");
var edits = review.Rows.Select(r => new SimScanRowEdit(r.Position,r.RowType,r.Cells.ToDictionary(c => c.Key,c => c.Value.Value),r.SourceNote,r.Reviewed)).ToArray();
edits[97].Values["QUANTITY"] = "A/R"; edits[0].Values["UNIT"] = "EA";
edits[27].Values["REFERENCE_DESIGNATORS"] = "C35,39,40,42";
var save = new SimScanSaveRequest(review.Id,review.Version,setup.DocumentId,setup.Sha256,setup.Id,request.ExpectedReviewToken,edits);
await Reject(async () => { await store.SaveScannedBomReview(record.IntakeId,save with { Rows = edits[..105] },persona); }, "SCAN_REVIEW_ROWS");
await Reject(async () => { await store.SaveScannedBomReview(record.IntakeId,save with { Rows = edits.Reverse().ToArray() },persona); }, "SCAN_REVIEW_ROWS");
await Reject(async () => { await store.SaveScannedBomReview(record.IntakeId,save with { SetupId = "changed" },persona); }, "SCAN_REVIEW_STALE");
var saved = Envelope(await store.SaveScannedBomReview(record.IntakeId,save,persona));
request = request with { ExpectedReviewToken = saved.GetProperty("packageReviewToken").GetString()! };
await Reject(async () => { await store.SaveScannedBomReview(record.IntakeId,save,persona); }, "SCAN_REVIEW_STALE");
var reopened = Envelope(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(record.IntakeId)).GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
var w = reopened.TechnicalReview!.ScannedBomReview!;
Check(w.Version == 2 && w.Rows[97].Cells["QUANTITY"].Value == "A/R" && w.Rows[0].Cells["UNIT"].Value == "EA" && w.Rows[27].Cells["REFERENCE_DESIGNATORS"].Value == "C35,39,40,42", "corrections save and reopen without row merging");
Check(w.Setup.Id == setup.Id && w.Setup.Sha256 == setup.Sha256 && w.SavedBy == persona.DisplayName, "RFQ/document/hash/mapping/reviewer provenance retained");
var reused = Envelope(await store.ReadScannedBom(record.IntakeId,request,persona)).GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
Check(reused.TechnicalReview!.ScannedBomReview!.Version == 2 && reused.TechnicalReview.CandidateBom is null, "Read BOM reopens corrections without overwriting or publishing");
await Reject(async () => { await store.SubmitAnalysis(record.IntakeId,persona); }, "SCANNED_BOM_SETUP_REQUIRED");
Check((await store.ScannedBomSource(textRecord))!.Readability.Status == "TEXT_READABLE", "Scenario 1 still selects normal text PDF path");
Console.WriteLine("Disposable test state: " + root);

}
catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode=1; }
