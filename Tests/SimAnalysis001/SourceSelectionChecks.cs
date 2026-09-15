using System.Text.Json;
using System.Text.Json.Nodes;

internal static class SourceSelectionChecks
{
    internal static async Task Run(string root, string dataPath, SimPersona persona)
    {
        var original = await File.ReadAllTextAsync(dataPath);
        var json = DleAnalysisContract.Json;
        var record = JsonNode.Parse(original)!["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!;
        var package = record.TechnicalReview!.TechnicalPackage!;
        var governing = package.Documents[0];
        var support = package.Documents[1] with { IdentityReview = new("BOM_ONLY", Decision: "CONFIRMED"),
            PartNumberReview = new("CUSTOMER_INTERNAL", true), Role = "REFERENCED" };
        var version = DleAnalysisContract.SourceSelectionVersion;
        void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS: source selection — " + name); }
        SimTechnicalPackage Pack(params SimPackageDocument[] docs) => package with { Documents = [governing, .. docs] };
        string? Purpose(SimPackageDocument doc) => SimAnalysisSourceSelection.Purpose(Pack(doc), doc);
        Check(SimAnalysisSourceSelection.Select(Pack(), version).Single() == governing, "governing always included");
        foreach (var role in new[] { "SUPPORTING", "REFERENCED", "UNRESOLVED" })
            foreach (var basis in new[] { "CUSTOMER_INTERNAL", "MIXED", "MANUFACTURER", "UNKNOWN" }) {
                var doc = support with { Role = role, PartNumberReview = new(basis, true) };
                Check(SimAnalysisSourceSelection.Select(Pack(doc), version).Length == 2 && Purpose(doc) == "MANUFACTURER_ENRICHMENT", role + "/" + basis + " capability, not basis, grants enrichment");
            }
        Check(Purpose(support with { PartNumberReview = new("MANUFACTURER", false) }) == "REFERENCE", "false capability is contextual only");
        Check(Purpose(support with { Role = "UNRESOLVED", PartNumberReview = new("MANUFACTURER", false) }) is null, "no indiscriminate unresolved inclusion");
        foreach (var doc in new[] {
            support with { IdentityReview = new("BOM_ONLY") },
            support with { DocumentType = "UNKNOWN" }, support with { DocumentType = "GERBER" },
            support with { Role = "EXCLUDED" }, support with { Role = "SUPERSEDED" },
            support with { Role = "GOVERNING" },
            support with { Applicability = "SUBASSEMBLY", SubassemblyPartNumber = "UNRELATED" },
            support with { SubassemblyPartNumber = "OTHER-ASSEMBLY" }
        }) Check(Purpose(doc) is null, "unreviewed, unrelated, unsupported or excluded context stays out");
        Check(SimAnalysisSourceSelection.Purpose(Pack(), support) is null, "foreign package source excluded");
        foreach (var scope in new[] { "SUPPORTING_REFERENCE", "UNRESOLVED", "" }) {
            try { SimAnalysisSourceSelection.Select(Pack(support with { Applicability = scope }), version); throw new Exception("Scope guessed"); }
            catch (SimRfqIntakeProblem e) when (e.Code == "ANALYSIS_ENRICHMENT_SCOPE_REQUIRED") { Check(true, "unresolved scope explicitly blocks"); }
        }
        try { SimAnalysisSourceSelection.Select(Pack(Enumerable.Range(0,4).Select(i => support with { DocumentId = "fixture-" + i }).ToArray()), version); throw new Exception("Limit ignored"); }
        catch (SimRfqIntakeProblem e) when (e.Code == "ANALYSIS_SOURCE_LIMIT") { Check(true, "four-source cap enforced"); }

        var store = new SimRfqIntakeStore(root);
        async Task Seed(SimTechnicalPackage p) => await File.WriteAllTextAsync(dataPath,
            JsonSerializer.Serialize(new { schema = "DLE_RFQ_INTAKE_DATASET_V1", records = new[] { record with { TechnicalReview = record.TechnicalReview! with { TechnicalPackage = p } } } }, json));
        try {
            foreach (var publish in new[] { false, true }) {
                await Seed(Pack(support));
                var job = await store.SubmitAnalysis(record.IntakeId, persona);
                Check(job.Input.SourceSelectionVersion == version && job.Input.Sources[1].Profile?.DerivedAnalysisPurpose == "MANUFACTURER_ENRICHMENT", "new referenced source frozen with pinned policy");
                if (publish) { await store.ClaimAnalysisJob(); await store.SetAnalysisState(job.Input.JobId, "VALIDATING"); }
                var changed = JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!;
                changed["records"]![0]!["technicalReview"]!["technicalPackage"]!["documents"]![1]!["partNumberReview"]!["providesManufacturerPartNumbers"] = false;
                await File.WriteAllTextAsync(dataPath, changed.ToJsonString());
                if (publish) await store.PublishAnalysis(job.Input.JobId, new(new("unused", "unused", "unused", "unused", []), "TEST", "1", "none"));
                else Check(await store.ClaimAnalysisJob() is null, "changed reference not claimed");
                Check((await store.LatestAnalysis(record.IntakeId))!.Status == "STALE", "newly included source mutation stales " + (publish ? "publication" : "queue"));
            }
            // Recreate a pre-Slice-2 V2 job without relabelling its profiles or adding the reference source.
            await Seed(Pack(support));
            var current = await store.SubmitAnalysis(record.IntakeId, persona);
            var legacyInput = current.Input with { SourceSelectionVersion = null,
                Sources = [current.Input.Sources[0] with { Profile = SimRfqIntakeStore.AnalysisProfile(record.IntakeId, Pack(support), governing) }] };
            var legacyData = JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!;
            legacyData["analysisJobs"]![0]!["input"] = JsonSerializer.SerializeToNode(legacyInput, json);
            await File.WriteAllTextAsync(dataPath, legacyData.ToJsonString());
            var legacyClaim = (await new SimRfqIntakeStore(root).ClaimAnalysisJob())!.Value;
            Check(legacyClaim.Documents.Length == 1 && legacyClaim.Job.Input.ContractVersion == "DLE_ANALYSIS_JOB_V2" && legacyClaim.Job.Input.SourceSelectionVersion is null, "historical V2 retains legacy selected sources and profile meaning");

            // Synthetic opaque XLS bytes: deliberately never parsed by this slice.
            var xls = await new SimIntakeDocuments(root).Stage(record.RequestCorrelationId, "synthetic-enrichment.xls", 0,
                new MemoryStream("SYNTHETIC UNSUPPORTED XLS FIXTURE"u8.ToArray()), persona.DisplayName);
            record = record with { TechnicalFiles = [record.TechnicalFiles[0], xls] };
            support = support with { DocumentId = xls.DocumentId!, Name = xls.Name };
            await Seed(Pack(support));
            var xlsJob = await store.SubmitAnalysis(record.IntakeId, persona);
            var claimed = (await store.ClaimAnalysisJob())!.Value;
            Check(xlsJob.Input.ProviderRoute == DleAnalysisPolicy.Local && claimed.Documents.Length == 2 &&
                claimed.Documents[1].Source.MimeType == "application/vnd.ms-excel", "staged XLS reaches frozen local job without hosted approval");
            var result = await new LocalDocumentAnalysisProvider().ExecuteAnalysisJob(claimed.Job.Input, claimed.Documents, DleAnalysisContract.Instructions, default);
            DleAnalysisContract.Validate(claimed.Job.Input, result.Result);
            Check(result.Result.CoverageReason.Contains("NOT PROCESSED") &&
                result.Result.Rows.All(r => r.Fields.Values.All(f => f.Relationship == "NOT_COMPARED" && f.SupportingEvidence is null)), "included XLS explicitly not processed; no fabricated reconciliation");
            await store.SetAnalysisState(xlsJob.Input.JobId, "VALIDATING");
            await store.PublishAnalysis(xlsJob.Input.JobId, result);
            Check((await new SimRfqIntakeStore(root).LatestAnalysis(record.IntakeId))!.Status == "SUCCEEDED", "unchanged governing extraction publishes and survives reopen with XLS snapshot");
        } finally { await File.WriteAllTextAsync(dataPath, original); }
    }
}
