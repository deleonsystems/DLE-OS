using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ApprovedPartManagerTests
{
    internal static async Task Run(string repository,JsonSerializerOptions options)
    {
        var original=await File.ReadAllBytesAsync(Path.Combine(repository,".sim-state/data/rfq-intakes.json"));
        var source=JsonNode.Parse(original)!;
        var persona=new SimPersona("test","test","Progress Reviewer","ACTIVE",[],[],true,"SIM");
        void Check(bool ok,string text){if(!ok)throw new Exception(text);Console.WriteLine("PASS: "+text);}
        foreach(var id in new[]{"RFQI-SIM-0035","RFQI-SIM-0041"})
        {
            var node=source["records"]!.AsArray().Single(n=>(string?)n!["intakeId"]==id)!.DeepClone();
            node["status"]="TECHNICAL_REVIEW_IN_PROGRESS";node["technicalReview"]!["workflow"]=null;node["technicalReview"]!["bomAcceptances"]=new JsonArray();
            var record=node.Deserialize<SimRfqIntakeRecord>(options)!;
            var root=Path.Combine(Path.GetTempPath(),"dle-approved-parts-"+Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(root,"data"));
            var documents=Path.Combine(root,"intake-documents",record.RequestCorrelationId);Directory.CreateDirectory(documents);
            foreach(var f in record.TechnicalFiles.Where(f=>f.DocumentId is not null))foreach(var ext in new[]{".bin",".json"})
                File.Copy(Path.Combine(repository,".sim-state/intake-documents",record.RequestCorrelationId,f.DocumentId+ext),Path.Combine(documents,f.DocumentId+ext));
            var dataPath=Path.Combine(root,"data/rfq-intakes.json");
            await File.WriteAllTextAsync(dataPath,new JsonObject{["schema"]="DLE_RFQ_INTAKE_DATASET_V1",["records"]=new JsonArray(node)}.ToJsonString());
            var store=new SimRfqIntakeStore(root);
            async Task<SimRfqIntakeRecord> Read()=>JsonSerializer.SerializeToElement(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(id),options).GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
            Dictionary<string,string> Values(SimCandidateRow r)=>SimCandidateBomProvider.Fields.ToDictionary(k=>k,k=>r.Values[k]);
            async Task Accept(int index)
            {
                var bom=(await Read()).TechnicalReview!.CandidateBom!;var row=bom.Rows[index];
                var assembly=row.WorkingState?.AssemblyPartNumber??row.AssemblyIdentity?.PartNumber??row.Alternates?.FirstOrDefault(a=>a.Origin=="MANUAL"&&a.ReviewStatus=="CONFIRMED")?.PartNumber;
                await store.CandidateBomAsync(id,persona,new(bom.Id,index,Values(row),WorksheetAcceptance:new(row.ReviewState.Token,row.ComponentType,assembly,ManualPartNumber:row.WorkingState?.ManualPartNumber,ManufacturerName:row.WorkingState?.ManufacturerName)));
            }

            var initial=(await Read()).TechnicalReview!.CandidateBom!;
            var index=Array.FindIndex(initial.Rows,r=>r.Values["lineNumber"]==(id=="RFQI-SIM-0041"?"53":"5"));
            var row=initial.Rows[index];var part=row.ManufacturerIdentity!.Proposals.First();
            var number=id=="RFQI-SIM-0041"&&part.PartNumber!="CF14JT5K10"?"CF14JT5K10":part.PartNumber+"-CORRECTED";
            var sourceBefore=JsonSerializer.Serialize((await Read()).TechnicalReview!.ScannedBomReview,options);
            var request=new SimApprovedPartChange(part.Id,number,part.ManufacturerName,row.ReviewState.Token);
            await store.CandidateBomAsync(id,persona,new(initial.Id,index,null,ApprovedPartChange:request));
            var saved=(await Read()).TechnicalReview!.CandidateBom!;var corrected=saved.Rows[index];
            Check(corrected.RowId==row.RowId&&saved.Id==initial.Id&&saved.Rows.Length==initial.Rows.Length,id+" same row and Candidate identity");
            Check(corrected.ManufacturerIdentity!.Proposals.Single(p=>p.Id==part.Id).PartNumber==number&&corrected.ManufacturerIdentity.Proposals.Single(p=>p.Id==part.Id).ManufacturerName==part.ManufacturerName,id+" corrected P/N and manufacturer reopen");
            Check(!corrected.ReviewState.Reviewed&&corrected.WorkingState is not null,id+" manager Save requires row Accept");
            Check(JsonSerializer.Serialize(corrected.Alternates,options)==JsonSerializer.Serialize(row.Alternates,options),id+" technical alternates unchanged");
            Check(corrected.ManufacturerIdentity.Proposals.Where(p=>p.Id!=part.Id).Select(p=>p.Id).SequenceEqual(row.ManufacturerIdentity.Proposals.Where(p=>p.Id!=part.Id).Select(p=>p.Id)),id+" unrelated identities preserved");
            var checkpoint=await File.ReadAllBytesAsync(dataPath);
            try{await store.CandidateBomAsync(id,persona,new(initial.Id,index,null,ApprovedPartChange:request));throw new Exception("stale write accepted");}catch(SimRfqIntakeProblem e){Check(e.Code=="SIM_APPROVED_PART_STALE"&&checkpoint.SequenceEqual(await File.ReadAllBytesAsync(dataPath)),id+" stale manager save atomic");}
            await Accept(index);saved=(await Read()).TechnicalReview!.CandidateBom!;
            Check(saved.Rows[index].ReviewState.Reviewed&&saved.Rows[index].ManufacturerIdentity!.Proposals.Single(p=>p.Id==part.Id).PartNumber==number,id+" Accept retains corrected identity and locks");
            // Add via Save Progress to qualify the shared unsaved-exit persistence path.
            var accepted=saved.Rows[index];var count=accepted.ManufacturerIdentity!.Proposals.Length;
            await store.CandidateBomAsync(id,persona,new(saved.Id,-1,null,ProgressRows:[new(index,accepted.ReviewState.Token,Values(accepted),accepted.ComponentType,ApprovedPartChange:new(null,"ADDED-APPROVED-PN","Added manufacturer",accepted.ReviewState.Token))]));
            saved=(await Read()).TechnicalReview!.CandidateBom!;var added=saved.Rows[index];
            Check(added.ManufacturerIdentity!.Proposals.Length==count+1&&!added.ReviewState.Reviewed,id+" add approved identity via Save Progress reopens accepted row");
            checkpoint=await File.ReadAllBytesAsync(dataPath);
            try{await store.CandidateBomAsync(id,persona,new(saved.Id,index,null,ApprovedPartChange:new(null,"ADDED-APPROVED-PN","Added manufacturer",added.ReviewState.Token)));throw new Exception("duplicate accepted");}catch(SimRfqIntakeProblem e){Check(e.Code=="SIM_APPROVED_PART_DUPLICATE"&&checkpoint.SequenceEqual(await File.ReadAllBytesAsync(dataPath)),id+" duplicate addition blocked without writes");}
            await Accept(index);saved=(await Read()).TechnicalReview!.CandidateBom!;
            Check(saved.Rows[index].ReviewState.Reviewed&&saved.Rows[index].ManufacturerIdentity!.Proposals.Length==count+1,id+" added list persists and accepts without copies");
            var multiIndex=id=="RFQI-SIM-0041"?Array.FindIndex(saved.Rows,r=>r.Values["lineNumber"]=="41"):index;
            var multi=saved.Rows[multiIndex];var multiPart=multi.ManufacturerIdentity!.Proposals.First();var others=JsonSerializer.Serialize(multi.ManufacturerIdentity.Proposals.Skip(1),options);
            await store.CandidateBomAsync(id,persona,new(saved.Id,multiIndex,null,ApprovedPartChange:new(multiPart.Id,multiPart.PartNumber+"-EDIT","Edited manufacturer",multi.ReviewState.Token)));
            saved=(await Read()).TechnicalReview!.CandidateBom!;
            Check(JsonSerializer.Serialize(saved.Rows[multiIndex].ManufacturerIdentity!.Proposals.Skip(1),options)==others,id+" multi-P/N edit preserves unrelated proposals exactly");
            Check(JsonSerializer.Serialize((await Read()).TechnicalReview!.ScannedBomReview,options)==sourceBefore,id+" upstream transcription unchanged; no rebuild");
            var subIndex=Array.FindIndex(saved.Rows,r=>r.ComponentType=="SUBASSEMBLY");
            if(subIndex>=0){var sub=saved.Rows[subIndex];try{await store.CandidateBomAsync(id,persona,new(saved.Id,subIndex,null,ApprovedPartChange:new(null,"INVALID","Maker",sub.ReviewState.Token)));throw new Exception("Subassembly changed");}catch(SimRfqIntakeProblem e){Check(e.Code=="SIM_APPROVED_PART_TYPE",id+" Subassembly keeps separate Assembly identity workflow");}}
            Console.WriteLine("DISPOSABLE_APPROVED_PART_STATE="+root);
        }
        Check(original.SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(repository,".sim-state/data/rfq-intakes.json"))),"normal SIM data unchanged");
    }
}
