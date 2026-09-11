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
var next = await store.SubmitAnalysis(record.intakeId, persona); await store.ClaimAnalysisJob(); await store.SetAnalysisState(next.Input.JobId, "VALIDATING"); await store.PublishAnalysis(next.Input.JobId, result);
var prior = Data()["records"]![0]!["technicalReview"]!["candidateBomVersions"]![0]!.Deserialize<SimCandidateBom>(json)!;
Check(prior.Rows[0].Values["partNumber"] == "HUMAN-CORRECTION" && prior.Rows[0].Extracted["partNumber"] != "HUMAN-CORRECTION" && prior.Rows[0].Corrections.Length > 0, "new version preserves prior extraction and correction audit");
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
