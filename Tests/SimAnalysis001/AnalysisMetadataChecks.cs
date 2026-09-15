using System.Text.Json;
using System.Text.Json.Nodes;

internal static class AnalysisMetadataChecks
{
    internal static async Task Run(string root, string dataPath, SimPersona persona)
    {
        var original = await File.ReadAllTextAsync(dataPath);
        var json = DleAnalysisContract.Json;
        void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS: metadata — " + name); }
        JsonNode Data() => JsonNode.Parse(File.ReadAllText(dataPath))!;
        JsonNode Package(JsonNode data) => data["records"]![0]!["technicalReview"]!["technicalPackage"]!;
        var baseline = JsonNode.Parse(original)!;
        var package = Package(baseline);
        package["reviewedBy"] = persona.DisplayName;
        package["reviewedAtUtc"] = "2026-09-01T00:00:00Z";
        foreach (var (d, i) in package["documents"]!.AsArray().Select((d, i) => (d!, i))) {
            d["identityReview"] = new JsonObject { ["type"] = i == 0 ? "DRAWING_AND_BOM" : "BOM_ONLY", ["decision"] = "CONFIRMED", ["reviewedBy"] = persona.DisplayName };
            d["partNumberReview"] = new JsonObject { ["basis"] = "CUSTOMER_INTERNAL", ["providesManufacturerPartNumbers"] = i == 1, ["reviewedBy"] = persona.DisplayName };
        }
        var seed = baseline.ToJsonString();
        var store = new SimRfqIntakeStore(root);
        var intake = baseline["records"]![0]!["intakeId"]!.GetValue<string>();
        async Task Reset() => await File.WriteAllTextAsync(dataPath, seed);
        try {
            await Reset();
            var job = await store.SubmitAnalysis(intake, persona);
            var frozen = JsonSerializer.Serialize(job.Input, json);
            var sources = job.Input.Sources;
            Check(job.Input.ContractVersion == "DLE_ANALYSIS_JOB_V2", "new job uses V2");
            Check(sources[0].Profile is { ContractVersion: "DLE_DOCUMENT_ANALYSIS_PROFILE_V1", DerivedAnalysisPurpose: "GOVERNING_BOM" } &&
                sources[1].Profile?.DerivedAnalysisPurpose == "MANUFACTURER_ENRICHMENT", "governing and enrichment purpose");
            Check(sources[0].Profile?.PartNumberContext == new DlePartNumberContext("CUSTOMER_INTERNAL", false) &&
                sources[1].Profile?.PartNumberContext.ProvidesManufacturerPartNumbers == true, "P/N context preserves explicit false and true");
            Check(sources.All(s => s.Sha256.Length == 64 && s.Profile?.MetadataFingerprint.Length == 64 &&
                s.Profile.StagedBinaryReference == new DleStagedBinaryReference(intake, s.DocumentId) &&
                s.Profile.ReviewedClassification.Role == s.Role && s.Profile.ReviewedClassification.Applicability == s.Applicability &&
                s.Profile.ReviewEvidence.PartNumberReviewer == persona.DisplayName), "hashes, opaque staged references, classification and audit frozen");
            Check(JsonSerializer.Serialize((await new SimRfqIntakeStore(root).LatestAnalysis(intake))!.Input, json) == frozen, "snapshot survives store restart");
            var mutations = new (string Name, Action<JsonNode> Change)[] {
                ("P/N basis", d => d["partNumberReview"]!["basis"] = "MIXED"),
                ("manufacturer capability", d => d["partNumberReview"]!["providesManufacturerPartNumbers"] = false),
                ("role", d => d["role"] = "REFERENCED"),
                ("applicability", d => d["applicability"] = "SUPPORTING_REFERENCE"),
                ("classification", d => d["documentType"] = "SUPPORTING_DOCUMENT"),
                ("embedded BOM", d => d["embeddedBom"] = true),
                ("subassembly identity", d => d["subassemblyPartNumber"] = "SYNTHETIC-SUB")
            };
            foreach (var mutation in mutations) foreach (var publish in new[] { false, true }) {
                await Reset(); job = await store.SubmitAnalysis(intake, persona);
                if (publish) { await store.ClaimAnalysisJob(); await store.SetAnalysisState(job.Input.JobId, "VALIDATING"); }
                var changed = Data(); mutation.Change(Package(changed)["documents"]![1]!);
                await File.WriteAllTextAsync(dataPath, changed.ToJsonString());
                if (publish) await store.PublishAnalysis(job.Input.JobId, new(new("unused", "unused", "unused", "unused", []), "TEST", "1", "none"));
                else Check(await store.ClaimAnalysisJob() is null, "changed input never claimed");
                Check((await store.LatestAnalysis(intake))!.Status == "STALE", mutation.Name + (publish ? " stales publication" : " stales queued job"));
                Check((await store.LatestAnalysis(intake))!.Input.Sources[1].Profile!.PartNumberContext.Basis == "CUSTOMER_INTERNAL", "saved snapshot not rewritten");
            }
            await Reset(); job = await store.SubmitAnalysis(intake, persona);
            var binaryPath = Path.Combine(root, "intake-documents", baseline["records"]![0]!["requestCorrelationId"]!.GetValue<string>(), job.Input.GoverningDocumentId + ".bin");
            var bytes = await File.ReadAllBytesAsync(binaryPath);
            try {
                var corrupt = bytes.ToArray(); corrupt[^1] ^= 1;
                await File.WriteAllBytesAsync(binaryPath, corrupt);
                Check(await store.ClaimAnalysisJob() is null && (await store.LatestAnalysis(intake))!.Status == "STALE", "binary hash change remains protected");
            } finally { await File.WriteAllBytesAsync(binaryPath, bytes); }
            await Reset(); job = await store.SubmitAnalysis(intake, persona);
            var legacy = Data(); legacy["analysisJobs"]![0]!["input"]!["contractVersion"] = "DLE_ANALYSIS_JOB_V1";
            legacy["analysisJobs"]![0]!["input"]!.AsObject().Remove("sourceSelectionVersion");
            foreach (var source in legacy["analysisJobs"]![0]!["input"]!["sources"]!.AsArray()) source!.AsObject().Remove("profile");
            await File.WriteAllTextAsync(dataPath, legacy.ToJsonString());
            var claimed = (await new SimRfqIntakeStore(root).ClaimAnalysisJob())!.Value;
            Check(claimed.Job.Input.ContractVersion == "DLE_ANALYSIS_JOB_V1" && claimed.Documents.All(d => d.Source.Profile is null), "legacy queued jobs keep V1 meaning and provider snapshot");
            var model = baseline["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!.TechnicalReview!.TechnicalPackage!;
            var unresolved = model.Documents[1] with { Role = "UNRESOLVED", Applicability = "SUPPORTING_REFERENCE" };
            Check(SimRfqIntakeStore.AnalysisProfile(intake, model, unresolved).DerivedAnalysisPurpose is null, "unresolved scope/role does not imply enrichment");
            var reference = model.Documents[1] with { Role = "REFERENCED" };
            Check(SimRfqIntakeStore.AnalysisProfile(intake, model, reference).DerivedAnalysisPurpose == "MANUFACTURER_ENRICHMENT", "profile supports future referenced enrichment without selection redesign");
            Check(SimRfqIntakeStore.AnalysisProfile(intake, model, reference with { PartNumberReview = null }).PartNumberContext == new DlePartNumberContext(null, null), "missing historical metadata remains unknown");
        } finally { await File.WriteAllTextAsync(dataPath, original); }
    }
}
