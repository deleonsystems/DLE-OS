using System.Text.Json;
using System.Text.Json.Nodes;

var root = Path.Combine(Path.GetTempPath(), "dle-analysis-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(Path.Combine(root, "data"));
var json = DleAnalysisContract.Json;
var persona = new SimPersona("fixture", "fixture", "Analysis Fixture Reviewer", "ACTIVE", [], [], true, "test");
var store = new SimRfqIntakeStore(root);
var staging = new SimIntakeDocuments(root);
var correlation = Guid.NewGuid().ToString("D");
var fixtureFolder = args[0];
var sourceBytes = await File.ReadAllBytesAsync(Path.Combine(fixtureFolder, "governing.pdf"));
var supportBytes = await File.ReadAllBytesAsync(Path.Combine(fixtureFolder, "supporting.pdf"));
var governing = await staging.Stage(correlation, "governing.pdf", 0, new MemoryStream(sourceBytes), persona.DisplayName);
var supporting = await staging.Stage(correlation, "supporting.pdf", 0, new MemoryStream(supportBytes), persona.DisplayName);
Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256", DleAnalysisContract.Hash(sourceBytes) + "," + DleAnalysisContract.Hash(supportBytes));
var record = new { intakeId = "RFQI-SIM-0001", requestCorrelationId = correlation, environment = "SIM", intakeType = "NEW_QUOTE_REQUEST", handoffTarget = "Technical Review", status = "TECHNICAL_REVIEW_IN_PROGRESS",
    schema = "DLE_RFQ_INTAKE_V1", createdBy = persona.DisplayName, assemblies = new[] { new { lineNumber = 1, assemblyNumber = "DEMO-ASSEMBLY", revision = "A", quantity = 2 } },
    technicalFiles = new[] { governing, supporting }, technicalReview = new { reviewStatus = "TECHNICAL_REVIEW_IN_PROGRESS", disposition = "START_TECHNICAL_REVIEW",
        assemblyHistory = new { assemblyClassification = "EXISTING_ASSEMBLY" }, technicalPackage = new { governingBomDocumentId = governing.DocumentId,
            documents = new[] { new { documentId = governing.DocumentId, name = governing.Name, documentType = "ASSEMBLY_DRAWING", role = "GOVERNING", applicability = "PARENT_ASSEMBLY", embeddedBom = true },
                new { documentId = supporting.DocumentId, name = supporting.Name, documentType = "BOM", role = "SUPPORTING", applicability = "PARENT_ASSEMBLY", embeddedBom = false } } } } };
var dataPath = Path.Combine(root, "data", "rfq-intakes.json");
await File.WriteAllTextAsync(dataPath, JsonSerializer.Serialize(new { schema = "DLE_RFQ_INTAKE_DATASET_V1", records = new[] { record } }, json));
void Check(bool condition, string name) { if (!condition) throw new Exception("FAIL: " + name); Console.WriteLine("PASS: " + name); }
var job = await store.SubmitAnalysis(record.intakeId, persona);
Check(job.Status == "QUEUED" && (await new SimRfqIntakeStore(root).LatestAnalysis(record.intakeId))?.Input.JobId == job.Input.JobId, "queued job survives new store instance");
Check((await store.SubmitAnalysis(record.intakeId, persona)).Input.JobId == job.Input.JobId, "duplicate submit reuses active job");
var claimed = (await store.ClaimAnalysisJob())!.Value;
Check(claimed.Job.Status == "RUNNING", "durable claim");
DleAnalysisResult Example() => new(DleAnalysisContract.ResultVersion, "EXTRACTED", "PARTIAL", "Six-row synthetic unit-test result", Enumerable.Range(1, 6).Select(i =>
    new DleAnalysisRow(SimCandidateBomProvider.Fields.ToDictionary(f => f, f => new DleAnalysisField(f == "lineNumber" ? i.ToString() : f == "quantity" ? "1" : "unit-test",
        new(governing.DocumentId!, 2, null, "row " + i), "Unit-test evidence only", "NOT_COMPARED", null, null)))).ToArray());
DleAnalysisResponse result;
if (args.Contains("--real"))
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(3));
    result = await new CodexAppServerAnalysisProvider(root, Console.WriteLine).ExecuteAnalysisJob(claimed.Job.Input, claimed.Documents, DleAnalysisContract.Instructions, timeout.Token);
    await File.WriteAllTextAsync(Path.Combine(root, "synthetic-provider-result.json"), JsonSerializer.Serialize(result, json));
    Check(result.Result.Rows.Length == 6, "actual App Server returns six synthetic document rows");
    Check(result.Result.Rows[1].Fields["quantity"].Relationship == "CONFLICT", "actual provider identifies deliberate supporting conflict");
}
else result = await new UnitTestOfflineProvider(Example()).ExecuteAnalysisJob(job.Input, claimed.Documents, DleAnalysisContract.Instructions, default);
DleAnalysisContract.Validate(job.Input, result.Result);
await store.SetAnalysisState(job.Input.JobId, "VALIDATING");
await store.PublishAnalysis(job.Input.JobId, result);
JsonNode Data() => JsonNode.Parse(File.ReadAllText(dataPath))!;
var candidate = Data()["records"]![0]!["technicalReview"]!["candidateBom"]!.Deserialize<SimCandidateBom>(json)!;
Check(candidate.Analysis?.Status == "NEEDS_REVIEW" && candidate.Rows.All(r => r.RowId is not null && r.AnalysisFields is not null), "candidate status and field evidence persisted");
var corrected = new Dictionary<string, string>(candidate.Rows[0].Values) { ["partNumber"] = "HUMAN-CORRECTION", ["lineNumber"] = "1", ["quantity"] = "1" };
await store.CandidateBomAsync(record.intakeId, persona, new(candidate.Id, 0, corrected));
SimCandidateBom Current() => Data()["records"]![0]!["technicalReview"]!["candidateBom"]!.Deserialize<SimCandidateBom>(json)!;
Check(Current().Rows.All(r => r.ComponentType == "STANDARD_COTS"), "new provider rows default to Standard COTS");
var originalValues = JsonSerializer.Serialize(Current().Rows[0].Extracted);
foreach (var component in new[] { "SUBASSEMBLY", "REFERENCE_ONLY", "OTHER", "STANDARD_COTS", "SUBASSEMBLY" })
{
    await store.CandidateBomAsync(record.intakeId, persona, new(candidate.Id, 0, null, ComponentChange:new(component,Current().Rows[0].ComponentTypeRevision)));
    Check(Current().Rows[0].ComponentType == component, "component type persists: " + component);
}
var typed = Current().Rows[0];
Check(typed.Corrections.Count(c => c.Field == "componentType") == 5 && typed.Corrections.Last().Reviewer == persona.DisplayName && JsonSerializer.Serialize(typed.Extracted) == originalValues, "component changes audit actor/time without changing extracted values");
try { await store.CandidateBomAsync(record.intakeId, persona, new(candidate.Id,0,null,ComponentChange:new("INVALID",5))); throw new Exception("accepted component"); }
catch(SimRfqIntakeProblem e) when(e.Code == "SIM_COMPONENT_TYPE_INVALID") { Console.WriteLine("PASS: unknown component type rejected"); }
try { await store.CandidateBomAsync(record.intakeId, persona, new(candidate.Id,0,null,ComponentChange:new("OTHER",0))); throw new Exception("accepted stale component"); }
catch(SimRfqIntakeProblem e) when(e.Code == "SIM_COMPONENT_TYPE_STALE") { Console.WriteLine("PASS: stale component change rejected"); }
async Task Alternate(string action, string? id, string? number, string status = "NEEDS_REVIEW") =>
    await store.CandidateBomAsync(record.intakeId, persona, new(candidate.Id, 0, null,
        new(action, id, number, status, Current().Rows[0].AlternateRevision)));
Check((Current().Rows[0].Alternates ?? []).Length == 0, "zero alternates safe default");
var oldJson = JsonSerializer.SerializeToNode(candidate, json)!;
oldJson.AsObject().Remove("contractVersion");
foreach (var oldRow in oldJson["rows"]!.AsArray()) { oldRow!.AsObject().Remove("alternates"); oldRow.AsObject().Remove("alternateRevision"); oldRow.AsObject().Remove("componentType"); oldRow.AsObject().Remove("componentTypeRevision"); }
var legacy = oldJson.Deserialize<SimCandidateBom>(json)!;
Check(legacy.ContractVersion == "DLE_CANDIDATE_BOM_V1" && (legacy.Rows[0].Alternates ?? []).Length == 0, "old candidate with absent alternate property remains readable");
Check(legacy.Rows[0].ComponentType == "STANDARD_COTS", "old candidate missing Component Type defaults safely");
await Alternate("ADD", null, "DEMO-ALT-1");
var added = Current().Rows[0].Alternates!.Single();
Check(Current().ContractVersion == SimCandidateBomProvider.ContractVersion && added.Origin == "MANUAL" && added.OriginalPartNumber is null && added.ReviewStatus == "NEEDS_REVIEW" && added.ApprovalEvidence is null && added.History[0].Reviewer == persona.DisplayName, "manual add is versioned, audited and never approved/extracted");
await Alternate("ADD", null, "DEMO-ALT-2");
Check(Current().Rows[0].Alternates!.Length == 2, "multiple alternates retain independent IDs");
try { await store.CandidateBomAsync(record.intakeId, persona, new(candidate.Id, 0, null, new("EDIT", added.Id, "STALE", "CONFIRMED", 0))); throw new Exception("accepted stale edit"); }
catch (SimRfqIntakeProblem e) when (e.Code == "SIM_ALTERNATE_STALE") { Console.WriteLine("PASS: stale alternate mutation blocked"); }
try { await Alternate("EDIT", added.Id, "BAD", "APPROVED"); throw new Exception("accepted approval"); }
catch (SimRfqIntakeProblem e) when (e.Code == "SIM_ALTERNATE_INVALID") { Console.WriteLine("PASS: alternate engineering approval cannot be assigned"); }
await Alternate("EDIT", added.Id, "DEMO-ALT-1-CORRECTED", "CONFIRMED");
var edited = Current().Rows[0].Alternates![0];
Check(edited.Id == added.Id && edited.History.Length == 2 && edited.History[1].Previous == "DEMO-ALT-1" && edited.PartNumber == "DEMO-ALT-1-CORRECTED", "alternate correction retains original entry and reviewer history");
var sourceEvidence = new DleAnalysisEvidence(governing.DocumentId!, 2, null, "synthetic alternate note");
var extracted = candidate with { Rows = [candidate.Rows[0] with { Alternates = [added with { Origin = "EXTRACTED", OriginalPartNumber = "ORIGINAL-ALT", SourceEvidence = sourceEvidence, SourceContext = "GOVERNING", Uncertainty = "Synthetic evidence" }] }] };
var changedExtracted = SimCandidateBomProvider.Review(extracted, new(extracted.Id, 0, null, new("EDIT", added.Id, "CORRECTED-ALT", "UNCERTAIN", 0)), persona).Rows[0].Alternates![0];
Check(changedExtracted.OriginalPartNumber == "ORIGINAL-ALT" && changedExtracted.SourceEvidence == sourceEvidence && changedExtracted.Uncertainty == "Synthetic evidence", "alternate edits preserve extracted provenance and uncertainty");
await Alternate("REMOVE", added.Id, null);
Check(Current().Rows[0].Alternates![0].RemovedAtUtc is not null && Current().Rows[0].Alternates![0].History.Last().Action == "REMOVED" && Current().Rows[0].Alternates!.Count(a => a.RemovedAtUtc is null) == 1, "removal hides active alternate and preserves its audit");
store = new SimRfqIntakeStore(root);
var reopened = await store.ReadAsync(record.intakeId);
Check(Current().Rows[0].Alternates!.Length == 2 && Current().Rows[0].Alternates![0].History.Length == 3, "alternate add correction removal survive persistence reopen");
Check(DleAnalysisContract.Hash(await staging.Bytes(correlation, governing.DocumentId!)) == DleAnalysisContract.Hash(sourceBytes), "alternate editing never modifies staged governing binary");
async Task CompletionBlocked(string code) {
    try { await store.CompleteBomReview(record.intakeId, new(Current()), persona); throw new Exception("unexpected BOM completion"); }
    catch (SimRfqIntakeProblem e) when (e.Code == code) { Console.WriteLine("PASS: BOM completion blocked: " + code); }
}
await CompletionBlocked("SIM_BOM_UNRESOLVED");
for (var i = 0; i < Current().Rows.Length; i++)
    await store.CandidateBomAsync(record.intakeId, persona, new(candidate.Id, i, Current().Rows[i].Values));
await CompletionBlocked("SIM_BOM_UNRESOLVED"); // Unconfirmed alternate still blocks even after fields are confirmed.
var activeAlternate = Current().Rows[0].Alternates!.Single(a => a.RemovedAtUtc is null);
await Alternate("EDIT", activeAlternate.Id, activeAlternate.PartNumber, "CONFIRMED");
var beforeSourceTest = Data();
var sourceTest = Data(); sourceTest["records"]![0]!["technicalReview"]!["candidateBom"]!["governingSha256"] = "changed";
await File.WriteAllTextAsync(dataPath, sourceTest.ToJsonString());
await CompletionBlocked("SIM_BOM_SOURCE_CHANGED");
await File.WriteAllTextAsync(dataPath, beforeSourceTest.ToJsonString());
var pendingCompletionJob = await store.SubmitAnalysis(record.intakeId, persona);
await CompletionBlocked("SIM_BOM_ANALYZING");
await store.SetAnalysisState(pendingCompletionJob.Input.JobId, "FAILED");
var acceptedSnapshot = JsonSerializer.Serialize(Current(), json);
await store.CompleteBomReview(record.intakeId, new(Current()), persona);
Check(Data()["records"]![0]!["technicalReview"]!["materialsReviewStatus"]!.GetValue<string>() == "QUALIFIED", "bridge candidate materials completion persists");
var next = await store.SubmitAnalysis(record.intakeId, persona); await store.ClaimAnalysisJob(); await store.SetAnalysisState(next.Input.JobId, "VALIDATING"); await store.PublishAnalysis(next.Input.JobId, result);
Check(JsonSerializer.Serialize(Data()["records"]![0]!["technicalReview"]!["bomAcceptances"]![0]!["candidate"]!.Deserialize<SimCandidateBom>(json), json) == acceptedSnapshot, "later analysis leaves accepted snapshot unchanged");
Check(Data()["records"]![0]!["technicalReview"]!["materialsReviewStatus"] is null, "new candidate requires materials review again");
var prior = Data()["records"]![0]!["technicalReview"]!["candidateBomVersions"]![0]!.Deserialize<SimCandidateBom>(json)!;
Check(prior.Rows[0].Values["partNumber"] == "HUMAN-CORRECTION" && prior.Rows[0].Extracted["partNumber"] != "HUMAN-CORRECTION" && prior.Rows[0].Corrections.Length > 0, "new version preserves prior extraction and correction audit");
Check(prior.Rows[0].Alternates!.Length == 2 && prior.Rows[0].Alternates![0].History.Length == 3, "candidate version history preserves alternate audit including removal");
Check(prior.Rows[0].ComponentType == "SUBASSEMBLY" && prior.Rows[0].Corrections.Count(c=>c.Field=="componentType")==5, "candidate version history preserves component classification and audit");
store = new SimRfqIntakeStore(root);
Check((await store.LatestAnalysis(record.intakeId))?.Status == "SUCCEEDED", "result and job survive store restart");
var stale = await store.SubmitAnalysis(record.intakeId, persona); await store.ClaimAnalysisJob(); await store.SetAnalysisState(stale.Input.JobId, "VALIDATING");
var changed = Data(); changed["records"]![0]!["status"] = "NO_LONGER_REQUIRED"; await File.WriteAllTextAsync(dataPath, changed.ToJsonString());
await store.PublishAnalysis(stale.Input.JobId, result);
Check((await store.LatestAnalysis(record.intakeId))?.Status == "STALE", "closed review blocks late publication");
changed = Data(); changed["records"]![0]!["status"] = "TECHNICAL_REVIEW_IN_PROGRESS"; await File.WriteAllTextAsync(dataPath, changed.ToJsonString());
var interrupted = await store.SubmitAnalysis(record.intakeId, persona); await store.ClaimAnalysisJob(); await new SimRfqIntakeStore(root).RecoverAnalysisJobs();
Check((await store.LatestAnalysis(record.intakeId))?.ErrorCode == "HOST_RESTARTED", "interrupted job becomes truthful restart failure");
var retry = await store.SubmitAnalysis(record.intakeId, persona);
Check(retry.Input.JobId != interrupted.Input.JobId, "retry creates a separate durable attempt");
var blockedProvider = new BlockingOfflineProvider();
using (var service = new DleAnalysisJobService(store, blockedProvider))
{
    await service.StartAsync(default);
    await blockedProvider.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
    Check((await store.LatestAnalysis(record.intakeId).WaitAsync(TimeSpan.FromSeconds(1)))?.Status == "RUNNING", "provider wait does not hold the intake store lock");
    blockedProvider.Release.TrySetResult();
    for (var i = 0; i < 50 && (await store.LatestAnalysis(record.intakeId))?.Status != "FAILED"; i++) await Task.Delay(50);
    Check((await store.LatestAnalysis(record.intakeId))?.Status == "FAILED", "unavailable provider becomes durable failure");
    await service.StopAsync(default);
}
var timeoutJob = await store.SubmitAnalysis(record.intakeId, persona);
using (var service = new DleAnalysisJobService(store, new TimeoutOfflineProvider()))
{
    await service.StartAsync(default);
    for (var i = 0; i < 50 && (await store.LatestAnalysis(record.intakeId))?.Status != "TIMED_OUT"; i++) await Task.Delay(50);
    Check((await store.LatestAnalysis(record.intakeId))?.Status == "TIMED_OUT", "provider timeout persists TIMED_OUT");
    await service.StopAsync(default);
}
var changedSourceJob = await store.SubmitAnalysis(record.intakeId, persona); await store.ClaimAnalysisJob(); await store.SetAnalysisState(changedSourceJob.Input.JobId, "VALIDATING");
changed = Data(); changed["records"]![0]!["technicalReview"]!["technicalPackage"]!["governingBomDocumentId"] = supporting.DocumentId;
await File.WriteAllTextAsync(dataPath, changed.ToJsonString()); await store.PublishAnalysis(changedSourceJob.Input.JobId, result);
Check((await store.LatestAnalysis(record.intakeId))?.Status == "STALE", "changed governing selection blocks publication");
changed = Data(); changed["records"]![0]!["technicalReview"]!["technicalPackage"]!["governingBomDocumentId"] = governing.DocumentId;
await File.WriteAllTextAsync(dataPath, changed.ToJsonString());
var deletedJob = await store.SubmitAnalysis(record.intakeId, persona); await store.ClaimAnalysisJob(); await store.SetAnalysisState(deletedJob.Input.JobId, "VALIDATING");
var preservedRecord = Data()["records"]![0]!.DeepClone();
changed = Data(); changed["records"]!.AsArray().Clear(); await File.WriteAllTextAsync(dataPath, changed.ToJsonString()); await store.PublishAnalysis(deletedJob.Input.JobId, result);
Check((await store.LatestAnalysis(record.intakeId))?.Status == "STALE" && Data()["records"]!.AsArray().Count == 0, "deleted review never resurrects from late result");
changed = Data(); changed["records"]!.AsArray().Add(preservedRecord); await File.WriteAllTextAsync(dataPath, changed.ToJsonString());
try { DleAnalysisContract.Validate(retry.Input, Example() with { Coverage = "COMPLETE" }); throw new Exception("accepted invalid result"); } catch (InvalidDataException) { Console.WriteLine("PASS: malformed/completeness validation"); }
Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256", "");
try { await store.SubmitAnalysis(record.intakeId, persona); throw new Exception("accepted unapproved bytes"); } catch (SimRfqIntakeProblem e) when (e.Code == "ANALYSIS_FIXTURE_ONLY") { Console.WriteLine("PASS: unapproved documents blocked before dispatch"); }
Console.WriteLine("ISOLATED_TEST_STATE=" + root);

sealed class UnitTestOfflineProvider(DleAnalysisResult result) : IAnalysisProvider
{
    public Task<DleAnalysisResponse> ExecuteAnalysisJob(DleAnalysisInput input, DleAnalysisDocument[] documents, string instructions, CancellationToken cancellationToken)
        => Task.FromResult(new DleAnalysisResponse(result, "UNIT_TEST_OFFLINE", "1", "none"));
}
sealed class BlockingOfflineProvider : IAnalysisProvider
{
    public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public async Task<DleAnalysisResponse> ExecuteAnalysisJob(DleAnalysisInput input, DleAnalysisDocument[] documents, string instructions, CancellationToken cancellationToken)
    { Entered.TrySetResult(); await Release.Task.WaitAsync(cancellationToken); throw new IOException("Isolated provider-unavailable fixture"); }
}
sealed class TimeoutOfflineProvider : IAnalysisProvider
{
    public Task<DleAnalysisResponse> ExecuteAnalysisJob(DleAnalysisInput input, DleAnalysisDocument[] documents, string instructions, CancellationToken cancellationToken)
        => throw new OperationCanceledException("Isolated timeout fixture");
}
