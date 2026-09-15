using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ReviewDocumentChecks
{
    internal static async Task Run(string root, string dataPath, SimPersona persona)
    {
        var before = await File.ReadAllTextAsync(dataPath);
        var json = DleAnalysisContract.Json;
        var store = new SimRfqIntakeStore(root);
        SimRfqIntakeRecord Current() => JsonNode.Parse(File.ReadAllText(dataPath))!["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!;
        var setup = JsonNode.Parse(before)!;
        setup["records"]![0]!["technicalReview"]!["candidateBom"]!["rows"]![0]!["componentType"] = "SUBASSEMBLY";
        setup["records"]![0]!["technicalReview"]!["candidateBom"]!["rows"]![0]!["values"]!["partNumber"] = "N4-TEST";
        await File.WriteAllTextAsync(dataPath, setup.ToJsonString());
        var original = Current();
        var row = original.TechnicalReview!.CandidateBom!.Rows[0];
        var target = new SimRowDocumentTarget(original.TechnicalReview.CandidateBom.Id, row.RowId ?? $"{original.TechnicalReview.CandidateBom.Id}:row:{row.Index}", 0, row.ReviewState.Token);
        var added = new List<string>();
        void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS: review documents — " + name); }
        try
        {
            var bytes = Encoding.UTF8.GetBytes("Synthetic technical document; no customer data.");
            foreach (var type in new[] { "DRAWING", "DRAWING_AND_BOM", "BOM_ONLY", "GERBER_FILES", "UNKNOWN", "OTHER" })
            {
                await store.AddReviewDocument(original.IntakeId, "synthetic-"+type+".gbr", 123,
                    new(type, "PARENT_ASSEMBLY", Note:"Synthetic note", RowTarget:type == "GERBER_FILES" ? target : null), new MemoryStream(bytes), persona);
                var file = Current().TechnicalFiles.Last(); added.Add(file.DocumentId!);
                Check(file.ReviewOrigin is {SourceStage:"Technical Review"} && file.ReviewOrigin.AddedBy == persona.DisplayName && string.Equals(file.ReviewOrigin.Sha256, DleAnalysisContract.Hash(bytes), StringComparison.OrdinalIgnoreCase) && file.InitialIdentification is null, type+" trusted provenance without rewriting Intake identity");
                var reopened = await new SimRfqIntakeStore(root).OpenDocument(original.IntakeId, file.DocumentId!);
                Check(reopened.Bytes.SequenceEqual(bytes) && reopened.Document.DocumentReference == $"sim-document:{original.RequestCorrelationId}:{file.DocumentId}", type+" binary opens from persisted ID after store restart");
            }
            var current = Current();
            Check(current.TechnicalFiles.Length == original.TechnicalFiles.Length+6 && JsonSerializer.Serialize(current.TechnicalFiles.Take(original.TechnicalFiles.Length),json)==JsonSerializer.Serialize(original.TechnicalFiles,json), "multiple additions preserve original files exactly");
            Check(JsonSerializer.Serialize(current.TechnicalReview! with {TechnicalPackage=original.TechnicalReview!.TechnicalPackage},json)==JsonSerializer.Serialize(original.TechnicalReview,json), "Candidate, accepted versions and all review decisions preserved");
            Check((await store.LatestAnalysis(original.IntakeId))?.Input.JobId == JsonNode.Parse(before)!["analysisJobs"]?.AsArray().LastOrDefault()?["input"]?["jobId"]?.GetValue<string>(), "no automatic analysis started");
            var pack=current.TechnicalReview.TechnicalPackage!;
            var gerber=pack.Documents.Single(d=>d.DocumentId==added[3]);
            Check(gerber.DocumentType=="GERBER" && gerber.SubassemblyPartNumber=="N4-TEST" && gerber.RowAssociation?.CandidateId==target.CandidateId && gerber.RowAssociation.RowId==target.RowId && gerber.IdentityReview?.Decision=="CONFIRMED", "Gerber first class, identities separate and no redundant identity confirmation");
            Check(gerber.RowAssociation!.ProposedSubassemblyIdentities.SequenceEqual((row.Alternates ?? []).Where(a=>a.RemovedAtUtc is null && a.Origin=="MANUAL" && a.ReviewStatus=="CONFIRMED").Select(a=>a.PartNumber).Distinct()), "saved manual DLE proposals preserved separately");
            Check(SimAnalysisSourceSelection.Purpose(pack,gerber) is null, "no Gerber parsing/analysis");
            var drawing=pack.Documents.Single(d=>d.DocumentId==added[0]) with {Role="SUPPORTING"};
            var future=pack with {Documents=pack.Documents.Select(d=>d.DocumentId==drawing.DocumentId?drawing:d).ToArray()};
            Check(SimAnalysisSourceSelection.Purpose(future,drawing)=="REFERENCE", "future supporting drawing obeys existing source-selection rules");
            foreach(var request in new[]{new SimReviewDocumentRequest("INVALID","PARENT_ASSEMBLY"),new("DRAWING","INVALID"),new("GERBER_FILES","SUBASSEMBLY"),new("OTHER","PARENT_ASSEMBLY",Note:new string('n',501))})
            {
                var stable=File.ReadAllText(dataPath);
                try { await store.AddReviewDocument(original.IntakeId,"bad.gbr",0,request,new MemoryStream(bytes),persona);throw new Exception("Invalid metadata accepted"); }
                catch(SimRfqIntakeProblem p) when(p.StatusCode==400) {}
                Check(File.ReadAllText(dataPath)==stable,"invalid metadata rejected before mutation");
            }
            try { await store.AddReviewDocument(original.IntakeId,"../unsafe.gbr",0,new("OTHER","PARENT_ASSEMBLY"),new MemoryStream(bytes),persona);throw new Exception("Unsafe filename accepted"); } catch(SimRfqIntakeProblem) {}
            try { await store.AddReviewDocument(original.IntakeId,"stale.gbr",0,new("GERBER_FILES","PARENT_ASSEMBLY",RowTarget:target with {ExpectedToken="stale"}),new MemoryStream(bytes),persona);throw new Exception("Stale context accepted"); } catch(SimRfqIntakeProblem p) when(p.Code=="SIM_ROW_DOCUMENT_STALE") {Console.WriteLine("PASS: review documents — stale row context blocked");}
            var standardRow=current.TechnicalReview.CandidateBom!.Rows[1];
            var standardTarget=new SimRowDocumentTarget(target.CandidateId,standardRow.RowId ?? $"{target.CandidateId}:row:{standardRow.Index}",1,standardRow.ReviewState.Token);
            await store.AddReviewDocument(original.IntakeId,"datasheet.pdf",0,new("DATASHEET","PARENT_ASSEMBLY",RowTarget:standardTarget),new MemoryStream(bytes),persona);
            added.Add(Current().TechnicalFiles.Last().DocumentId!);
            Check(Current().TechnicalReview!.TechnicalPackage!.Documents.Last().RowAssociation?.CustomerBomPartNumber==standardRow.Values["partNumber"],"normal component datasheet inherits row identity");
            var binary=Path.Combine(root,"intake-documents",original.RequestCorrelationId,added[0]+".bin");
            await File.WriteAllTextAsync(binary,"tampered");
            try { await store.OpenDocument(original.IntakeId,added[0]);throw new Exception("Tampering accepted"); } catch(SimRfqIntakeProblem) { Console.WriteLine("PASS: review documents — hash tampering blocks retrieval"); }
            foreach(var status in new[]{"NO_LONGER_REQUIRED","READY_FOR_RFQ_WORKING_QUEUE"}) {
                var data=JsonNode.Parse(File.ReadAllText(dataPath))!;data["records"]![0]!["status"]=status;File.WriteAllText(dataPath,data.ToJsonString());
                try { await store.AddReviewDocument(original.IntakeId,"closed.gbr",0,new("OTHER","PARENT_ASSEMBLY"),new MemoryStream(bytes),persona);throw new Exception("Closed review changed"); } catch(SimRfqIntakeProblem) {Console.WriteLine("PASS: review documents — closed/completed review blocked");}
            }
        }
        finally
        {
            await File.WriteAllTextAsync(dataPath,before);
            var staging=new SimIntakeDocuments(root);
            foreach(var id in added) await staging.Remove(original.RequestCorrelationId,id,persona.DisplayName);
        }
    }
}
