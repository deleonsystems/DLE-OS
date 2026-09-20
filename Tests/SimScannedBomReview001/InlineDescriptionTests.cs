using System.Text.Json;
using System.Text.Json.Nodes;

// Replay actual browser-produced acceptance payloads against the real store in disposable storage.
internal static class InlineDescriptionTests
{
    internal static async Task Run(string repository, string requestsPath, JsonSerializerOptions options)
    {
        var sourcePath=Path.Combine(repository,".sim-state/data/rfq-intakes.json");
        var originalBytes=await File.ReadAllBytesAsync(sourcePath);
        var source=JsonNode.Parse(originalBytes)!;
        var requests=JsonNode.Parse(await File.ReadAllTextAsync(requestsPath))!.AsArray();
        var reopenedRecords=new JsonArray();
        var persona=new SimPersona("test","test","Inline Description Reviewer","ACTIVE",[],[],true,"SIM");
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: "+label);}
        foreach(var item in requests)
        {
            var id=(string)item!["intakeId"]!;
            var node=source["records"]!.AsArray().Single(r=>(string?)r!["intakeId"]==id)!.DeepClone();
            // Completed readable scenario is immutable in SIM; only this disposable copy is reopened.
            node["status"]="TECHNICAL_REVIEW_IN_PROGRESS";
            var review=node["technicalReview"]!.AsObject();review["workflow"]=null;review["bomAcceptances"]=new JsonArray();
            var record=node.Deserialize<SimRfqIntakeRecord>(options)!;
            var root=Path.Combine(Path.GetTempPath(),"dle-inline-description-"+Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(root,"data"));
            var documents=Path.Combine(root,"intake-documents",record.RequestCorrelationId);Directory.CreateDirectory(documents);
            foreach(var file in record.TechnicalFiles.Where(f=>f.DocumentId is not null))
                foreach(var ext in new[]{".bin",".json"})
                    File.Copy(Path.Combine(repository,".sim-state/intake-documents",record.RequestCorrelationId,file.DocumentId+ext),Path.Combine(documents,file.DocumentId+ext));
            await File.WriteAllTextAsync(Path.Combine(root,"data/rfq-intakes.json"),new JsonObject{["schema"]="DLE_RFQ_INTAKE_DATASET_V1",["records"]=new JsonArray(node)}.ToJsonString());
            var request=item["request"]!.Deserialize<SimCandidateReviewRequest>(options)!;
            var before=record.TechnicalReview!.CandidateBom!;
            var store=new SimRfqIntakeStore(root);
            await store.CandidateBomAsync(id,persona,request);
            var reopened=new SimRfqIntakeStore(root);
            var envelope=JsonSerializer.SerializeToElement(await reopened.ReadTechnicalReviewAsync(id),options);
            reopenedRecords.Add(JsonNode.Parse(envelope.GetProperty("record").GetRawText()));
            var after=envelope.GetProperty("record").GetProperty("technicalReview").GetProperty("candidateBom").Deserialize<SimCandidateBom>(options)!;
            var row=after.Rows[request.RowIndex];
            Check(row.Values["description"]==request.Values!["description"],id+" edited Description persists after new store/reopen");
            Check(row.Extracted["description"]==before.Rows[request.RowIndex].Extracted["description"],id+" immutable Customer Description survives correction/reopen");
            Check(row.Reviewer==persona.DisplayName,id+" current row approval uses server reviewer");
            Check(row.ReviewState.Reviewed,id+" accepted row is locked/reviewed");
            Check(!row.Corrections.Any(c=>c.Field=="description"),id+" ordinary Description does not append correction history");
            Check(after.Id==before.Id&&after.Rows.Length==before.Rows.Length,id+" Candidate identity and row count unchanged");
            foreach(var key in before.Rows[request.RowIndex].Values.Keys.Where(k=>k!="description"))
                Check(row.Values[key]==before.Rows[request.RowIndex].Values[key],id+" preserves "+key);
            for(var i=0;i<before.Rows.Length;i++)if(i!=request.RowIndex)
                Check(JsonSerializer.Serialize(after.Rows[i],options)==JsonSerializer.Serialize(before.Rows[i],options),id+" preserves other row "+i);
            if(id=="RFQI-SIM-0035") {
                var accepted=JsonSerializer.SerializeToElement(await reopened.CompleteBomReview(id,new(after),persona),options);
                var snapshot=accepted.GetProperty("record").GetProperty("technicalReview").GetProperty("bomAcceptances")[0].GetProperty("candidate").Deserialize<SimCandidateBom>(options)!;
                Check(snapshot.Rows[request.RowIndex].Extracted["description"]==row.Extracted["description"]&&snapshot.Rows[request.RowIndex].Values["description"]==row.Values["description"],"real Accepted BOM snapshot retains both Customer and Reviewed Description");
            }
            if(id=="RFQI-SIM-0041") {
                var weak=after.Rows.First(r=>r.Extracted.GetValueOrDefault("description")=="-"&&r.ManufacturerIdentity?.Proposals.Any(p=>!string.IsNullOrWhiteSpace(p.PartNumber))==true);
                var values=new[]{"lineNumber","partNumber","quantity","designators","description"}.ToDictionary(k=>k,k=>weak.Values[k]);
                values["description"]="IC COMPARATOR 4CH 14-PDIP";
                await reopened.CandidateBomAsync(id,persona,new(after.Id,weak.Index,values,WorksheetAcceptance:new(weak.ReviewState.Token,weak.ComponentType)));
                var again=JsonSerializer.SerializeToElement(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(id),options);
                var corrected=again.GetProperty("record").GetProperty("technicalReview").GetProperty("candidateBom").Deserialize<SimCandidateBom>(options)!.Rows[weak.Index];
                Check(corrected.Extracted["description"]=="-"&&corrected.Values["description"]==values["description"]&&corrected.ReviewState.Reviewed,"weak customer description stays '-' while reviewed description persists independently");
            }

        }
        await File.WriteAllTextAsync(Path.Combine(Path.GetDirectoryName(requestsPath)!,"inline-reopened.json"),reopenedRecords.ToJsonString());
        Check(originalBytes.SequenceEqual(await File.ReadAllBytesAsync(sourcePath)),"normal SIM dataset unchanged; no OCR or candidate rebuild");
    }
}
