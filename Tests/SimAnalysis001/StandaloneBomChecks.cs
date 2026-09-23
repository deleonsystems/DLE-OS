using System.Text.Json;
using System.Text.Json.Nodes;

internal static class StandaloneBomChecks
{
    internal static async Task Run(string root, string dataPath, SimPersona persona, string fixtureFolder)
    {
        var original = await File.ReadAllTextAsync(dataPath);
        var approval = Environment.GetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256");
        var json = DleAnalysisContract.Json;
        void Check(bool condition, string message) { if (!condition) throw new Exception(message); Console.WriteLine("PASS: standalone BOM - " + message); }
        try {
            Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256", null);
            var dataset = JsonNode.Parse(original)!;
            var record = dataset["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!;
            var drawing = record.TechnicalReview!.TechnicalPackage!.Documents[0] with { EmbeddedBom = false, ProductionUse = "PRIMARY_DRAWING", BomUse = "NO_BOM_ROLE" };
            var bytes = await File.ReadAllBytesAsync(Path.Combine(fixtureFolder, "standalone.pdf"));
            var file = await new SimIntakeDocuments(root).Stage(record.RequestCorrelationId, "standalone.pdf", 0, new MemoryStream(bytes), record.CreatedBy);
            var bom = new SimPackageDocument(file.DocumentId!, file.Name, "BOM", "GOVERNING", "PARENT_ASSEMBLY", null,
                IdentityReview: new("BOM_ONLY", Decision: "CONFIRMED", ReviewedBy: persona.DisplayName),
                PartNumberReview: new("MANUFACTURER", true), ProductionUse: "NOT_FOR_PRODUCTION", BomUse: "GOVERNING_BOM");
            var package = new SimTechnicalPackage([drawing, bom], bom.DocumentId, "test", true, persona.DisplayName, DateTimeOffset.UtcNow, "STANDALONE_BOM");
            record = record with { TechnicalFiles = [record.TechnicalFiles[0], file], TechnicalReview = record.TechnicalReview with { TechnicalPackage = package, CandidateBom = null } };
            async Task Save(SimRfqIntakeRecord value) { dataset["records"]![0] = JsonSerializer.SerializeToNode(value,json); await File.WriteAllTextAsync(dataPath,dataset.ToJsonString()); }
            await Save(record);
            var store = new SimRfqIntakeStore(root);
            Check(SimTechnicalPackageProvider.IsGoverningCandidateSource(bom), "standalone governing source eligible");
            Check(!SimTechnicalPackageProvider.IsGoverningCandidateSource(bom with { Role = "SUPPORTING" }) &&
                  !SimTechnicalPackageProvider.IsGoverningCandidateSource(bom with { Applicability = "SUBASSEMBLY" }) &&
                  !SimTechnicalPackageProvider.IsGoverningCandidateSource(drawing), "supporting, subassembly and drawing-without-BOM rejected");
            foreach (var invalid in new[] { file with { Type = "application/vnd.ms-excel" }, file with { BinaryStatus = "UNVERIFIED" } }) {
                await Save(record with { TechnicalFiles = [record.TechnicalFiles[0], invalid] });
                try { await store.SubmitAnalysis(record.IntakeId, persona); throw new Exception("Invalid governing binary accepted"); }
                catch (SimRfqIntakeProblem) { Check(true,"unverified/non-PDF governing source rejected"); }
            }
            await Save(record);
            try { await store.CandidateBomAsync(record.IntakeId,persona); throw new Exception("Standalone source entered ten-row synchronous parser"); }
            catch (SimRfqIntakeProblem) { Check(true,"legacy synchronous build cannot truncate standalone BOM"); }
            Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256", DleAnalysisContract.Hash(bytes));
            var job = await store.SubmitAnalysis(record.IntakeId,persona);
            Check(job.Input.ProviderRoute == DleAnalysisPolicy.Local && job.Input.ResultVersion == DleAnalysisContract.EnrichedResultVersion && job.Input.PilotRowLimit == 1000,
                "standalone PDF selects full-table local parser without enrichment source, even if hosted-approved");
            var claimed = (await store.ClaimAnalysisJob())!.Value;
            var response = await new LocalDocumentAnalysisProvider(root).ExecuteAnalysisJob(claimed.Job.Input, claimed.Documents,
                DleAnalysisContract.InstructionsFor(claimed.Job.Input.InstructionVersion), CancellationToken.None);
            Check(response.Result.Rows.Length == 12, "real parser extracts all twelve rows from page one");
            for (var i=0;i<12;i++) {
                var fields=response.Result.Rows[i].Fields;
                Check(fields["partNumber"].Value == "SOLO-PART-"+(i+1) && fields["quantity"].Value == "2" &&
                    fields["designators"].Value == $"R{i*2+1} R{i*2+2}" && fields["quantity"].Evidence.DocumentId == bom.DocumentId,
                    "row " +(i+1)+" quantities, designators and authoritative evidence preserved");
            }
            await store.SetAnalysisState(job.Input.JobId,"VALIDATING");
            await store.PublishAnalysis(job.Input.JobId,response);
            var persisted=JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!;
            Check(persisted.TechnicalReview!.CandidateBom is {Rows.Length:12} candidate && candidate.GoverningDocumentId == bom.DocumentId,
                "normal publish persists twelve-row standalone candidate");
            Check(persisted.TechnicalReview.TechnicalPackage!.Documents[0] == drawing, "production drawing classification remains unchanged");
            await new SimRfqIntakeStore(root).CandidateBomAsync(record.IntakeId,persona);
            Check(true,"standalone candidate survives reopen and normal candidate access");
            await CustomerRequestDocumentChecks.Run(root,dataPath,persona,bytes);
        } finally {
            await File.WriteAllTextAsync(dataPath,original);
            Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256",approval);
        }
    }
}
