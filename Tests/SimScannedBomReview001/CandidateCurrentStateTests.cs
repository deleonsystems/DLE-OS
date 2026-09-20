using System.Text.Json;
using System.Text.Json.Nodes;

internal static class CandidateCurrentStateTests
{
    internal static async Task Run(string repository,JsonSerializerOptions options)
    {
        var original=await File.ReadAllBytesAsync(Path.Combine(repository,".sim-state/data/rfq-intakes.json"));
        var source=JsonNode.Parse(original)!;
        var persona=new SimPersona("test","test","Progress Reviewer","ACTIVE",[],[],true,"SIM");
        void Check(bool ok,string text){if(!ok)throw new Exception(text);Console.WriteLine("PASS: "+text);}
        foreach(var id in new[]{"RFQI-SIM-0041","RFQI-SIM-0035"})
        {
            var node=source["records"]!.AsArray().Single(n=>(string?)n!["intakeId"]==id)!.DeepClone();
            node["status"]="TECHNICAL_REVIEW_IN_PROGRESS";node["technicalReview"]!["workflow"]=null;node["technicalReview"]!["bomAcceptances"]=new JsonArray();
            var record=node.Deserialize<SimRfqIntakeRecord>(options)!;
            var root=Path.Combine(Path.GetTempPath(),"dle-candidate-current-"+Guid.NewGuid().ToString("N"));
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
            var before=(await Read()).TechnicalReview!.CandidateBom!;
            var indices=id=="RFQI-SIM-0041"?new[]{"17","18","19"}.Select(line=>Array.FindIndex(before.Rows,r=>r.Values["lineNumber"]==line)).ToArray():new[]{Array.FindIndex(before.Rows,r=>r.ComponentType!="SUBASSEMBLY"&&r.ManufacturerIdentity?.Proposals.Select(p=>(p.PartNumber,p.ManufacturerName)).Distinct().Count()>1),Array.FindIndex(before.Rows,r=>r.ComponentType=="SUBASSEMBLY")};
            var acceptanceHistory=JsonSerializer.Serialize(record.TechnicalReview!.BomAcceptances,options);
            foreach(var index in indices) {
                Check(index>=0,id+" proof row exists");
                var initial=(await Read()).TechnicalReview!.CandidateBom!.Rows[index];
                var identities=initial.ManufacturerIdentity?.Proposals.Select(p=>(p.PartNumber,p.ManufacturerName)).Distinct().OrderBy(p=>p.PartNumber).ThenBy(p=>p.ManufacturerName).ToArray();
                var proposalCount=initial.ManufacturerIdentity?.Proposals.Length??0;
                int? priorRevision=null;
                if(initial.ManufacturerIdentity?.Proposals.LastOrDefault(p=>p.SourceLabel=="Manual Technical Review correction") is {} legacy) {
                    var selected=SimCandidateBomProvider.Review(before,new(before.Id,index,Values(initial),PrimarySelection:new(legacy.Id,null,null,initial.ReviewState.Token)),persona).Rows[index];
                    Check(selected.ReviewState.Reviewed&&selected.ManufacturerIdentity!.Proposals.Any(p=>p.PartNumber==legacy.PartNumber&&selected.ManufacturerIdentity.Decision(p.Id)=="CONFIRMED"),id+" legacy displayed P/N resolves after consolidation");
                    var rejected=initial with {ManufacturerIdentity=initial.ManufacturerIdentity with {History=initial.ManufacturerIdentity.History.Append(new(legacy.Id,"REJECTED",persona.DisplayName,DateTimeOffset.UtcNow)).ToArray()}};
                    var retained=SimCandidateBomProvider.Review(before with {Rows=before.Rows.Select((r,i)=>i==index?rejected:r).ToArray()},new(before.Id,-1,null,ProgressRows:[new(index,rejected.ReviewState.Token,Values(rejected),rejected.ComponentType)]),persona).Rows[index];
                    Check(retained.ManufacturerIdentity!.Proposals.Length==proposalCount&&retained.ManufacturerIdentity.Decision(legacy.Id)=="REJECTED",id+" explicit rejected identities never merged");
                }
                for(var iteration=0;iteration<3;iteration++) {
                    var bom=(await Read()).TechnicalReview!.CandidateBom!;var row=bom.Rows[index];var values=Values(row);
                    values[initial.Values["lineNumber"]=="18"?"designators":"description"]+=" / edit "+iteration;
                    await store.CandidateBomAsync(id,persona,new(bom.Id,index==indices.Last()?index:-1,index==indices.Last()?values:null,
                        WorksheetAcceptance:index==indices.Last()?new(row.ReviewState.Token,row.ComponentType,row.AssemblyIdentity?.PartNumber??"QUALIFICATION-ASSEMBLY"):null,
                        ProgressRows:index==indices.Last()?null:[new(index,row.ReviewState.Token,values,row.ComponentType)]));
                    var saved=(await Read()).TechnicalReview!.CandidateBom!;
                    Check(saved.Rows.Length==before.Rows.Length&&saved.Id==before.Id&&saved.Rows[index].RowId==initial.RowId&&saved.Rows.Count(r=>r.RowId==initial.RowId)==1,id+" line "+initial.Values["lineNumber"]+" same unique Candidate row");
                    Check(saved.Rows[index].Values["description"]==values["description"]&&saved.Rows[index].Values["designators"]==values["designators"],id+" working values reopen in place");
                    if(index!=indices.Last()){Check(!saved.Rows[index].ReviewState.Reviewed,id+" Save Progress leaves Needs Review");await Accept(index);}
                    var current=(await Read()).TechnicalReview!.CandidateBom!.Rows[index];
                    Console.WriteLine($"COUNTS {id} line {initial.Values["lineNumber"]}: rows {before.Rows.Length}->{saved.Rows.Length}; proposals {proposalCount}->{current.ManufacturerIdentity?.Proposals.Length??0}");
                    Check((current.ManufacturerIdentity?.Proposals.Length??0)<=proposalCount,id+" ordinary edits never append P/N identities");
                    Check(current.ReviewState.Reviewed,id+" Accept locks same row");
                    if(identities is not null)Check(current.ManufacturerIdentity!.Proposals.Select(p=>(p.PartNumber,p.ManufacturerName)).Distinct().OrderBy(p=>p.PartNumber).ThenBy(p=>p.ManufacturerName).SequenceEqual(identities),id+" legitimate MFG choices unchanged");
                    Check(current.Corrections.Count(c=>c.Field is "description" or "designators" or "quantity" or "lineNumber")==0,id+" no routine-field correction history");
                    Check((current.WholeRowHistory?.Length??0)<=1,id+" current row approval has bounded state");
                    if(priorRevision.HasValue)Check(current.ManufacturerIdentity?.Revision==priorRevision,id+" routine edits do not revise manufacturer identity");
                    priorRevision=current.ManufacturerIdentity?.Revision;
                    Check((current.ManufacturerIdentity?.History.Length??0)<=(current.ManufacturerIdentity?.Proposals.Length??0),id+" one current decision per MFG identity");
                    proposalCount=current.ManufacturerIdentity?.Proposals.Length??0;
                }
            }
            var after=(await Read()).TechnicalReview!.CandidateBom!;
            for(var i=0;i<before.Rows.Length;i++)if(!indices.Contains(i))Check(JsonSerializer.Serialize(before.Rows[i],options)==JsonSerializer.Serialize(after.Rows[i],options),id+" untouched row "+i);
            Check(JsonSerializer.Serialize((await Read()).TechnicalReview!.BomAcceptances,options)==acceptanceHistory,id+" Accepted BOM history unchanged");
            Console.WriteLine("DISPOSABLE_CURRENT_STATE="+root);
        }
        Check(original.SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(repository,".sim-state/data/rfq-intakes.json"))),"normal SIM dataset unchanged");
    }
}
