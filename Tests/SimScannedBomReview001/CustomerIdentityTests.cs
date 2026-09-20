using System.Text.Json;
using System.Text.Json.Nodes;

internal static class CustomerIdentityTests
{
    internal static async Task Run(string repository, JsonSerializerOptions options)
    {
        var original=await File.ReadAllBytesAsync(Path.Combine(repository,".sim-state/data/rfq-intakes.json"));
        var source=JsonNode.Parse(original)!;
        var persona=new SimPersona("test","test","Identity Reviewer","ACTIVE",[],[],true,"SIM");
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: "+label);}
        Dictionary<string,string> Values(SimCandidateRow r)=>SimCandidateBomProvider.Fields.ToDictionary(k=>k,k=>r.Values[k]);
        foreach(var id in new[]{"RFQI-SIM-0041","RFQI-SIM-0035"})
        {
            var node=source["records"]!.AsArray().Single(n=>(string?)n!["intakeId"]==id)!.DeepClone();
            node["status"]="TECHNICAL_REVIEW_IN_PROGRESS";node["technicalReview"]!["workflow"]=null;node["technicalReview"]!["bomAcceptances"]=new JsonArray();
            // Establish legacy identity preconditions only in the disposable copy.
            foreach(var item in node["technicalReview"]!["candidateBom"]!["rows"]!.AsArray()) {
                item!.AsObject().Remove("primaryIdentity");
                if(id=="RFQI-SIM-0041" && new[]{"H4-150","H4-116","H2-224","F2-134","N4-243"}.Contains((string?)item["values"]!["partNumber"])) {
                    item["componentType"]="STANDARD_COTS";item["confirmed"]=false;item.AsObject().Remove("assemblyIdentity");item.AsObject().Remove("workingState");
                }
            }
            var record=node.Deserialize<SimRfqIntakeRecord>(options)!;
            var root=Path.Combine(Path.GetTempPath(),"dle-customer-identity-"+Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(root,"data"));
            var documents=Path.Combine(root,"intake-documents",record.RequestCorrelationId);Directory.CreateDirectory(documents);
            foreach(var f in record.TechnicalFiles.Where(f=>f.DocumentId is not null))foreach(var ext in new[]{".bin",".json"})
                File.Copy(Path.Combine(repository,".sim-state/intake-documents",record.RequestCorrelationId,f.DocumentId+ext),Path.Combine(documents,f.DocumentId+ext));
            var dataPath=Path.Combine(root,"data/rfq-intakes.json");
            await File.WriteAllTextAsync(dataPath,new JsonObject{["schema"]="DLE_RFQ_INTAKE_DATASET_V1",["records"]=new JsonArray(node)}.ToJsonString());
            var store=new SimRfqIntakeStore(root);
            async Task<SimRfqIntakeRecord> Read()=>JsonSerializer.SerializeToElement(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(id),options).GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
            async Task<SimCandidateBom> Bom()=> (await Read()).TechnicalReview!.CandidateBom!;
            async Task Reject(Func<Task> run,string code){var bytes=await File.ReadAllBytesAsync(dataPath);try{await run();throw new Exception("Unexpected success: "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code&&bytes.SequenceEqual(await File.ReadAllBytesAsync(dataPath)),code+" rejects atomically");}}
            async Task Basis(int index,string basis,string? number,bool progress=false){var b=await Bom();var r=b.Rows[index];var change=new SimIdentityBasisChange(basis,number,r.ReviewState.Token);await store.CandidateBomAsync(id,persona,progress?new(b.Id,-1,null,ProgressRows:[new(index,r.ReviewState.Token,Values(r),r.ComponentType,IdentityBasisChange:change)]):new(b.Id,index,null,IdentityBasisChange:change));}
            async Task Accept(int index){var b=await Bom();var r=b.Rows[index];await store.CandidateBomAsync(id,persona,new(b.Id,index,Values(r),WorksheetAcceptance:new(r.ReviewState.Token,r.ComponentType,r.AssemblyIdentity?.PartNumber??r.Alternates?.FirstOrDefault(a=>a.Origin=="MANUAL"&&a.ReviewStatus=="CONFIRMED")?.PartNumber)));}
            var before=await Bom();
            Check(before.Rows.Where(r=>r.ComponentType!="SUBASSEMBLY").All(r=>r.IdentityBasis=="MANUFACTURER_PN"),id+" legacy manufacturer default without migration");
            var multiIndex=Array.FindIndex(before.Rows,r=>r.ComponentType!="SUBASSEMBLY"&&r.ManufacturerIdentity?.Proposals.Length>1);
            var manufacturers=JsonSerializer.Serialize(before.Rows[multiIndex].ManufacturerIdentity,options);
            await Basis(multiIndex,"CUSTOMER_PN",before.Rows[multiIndex].Values["partNumber"]);
            Check(!(await Bom()).Rows[multiIndex].ReviewState.Reviewed,"basis change requires row acceptance");
            await Accept(multiIndex);
            await Basis(multiIndex,"MANUFACTURER_PN",null);
            Check(JsonSerializer.Serialize((await Bom()).Rows[multiIndex].ManufacturerIdentity,options)==manufacturers,"basis switches preserve all manufacturer identities and decisions");
            Check(!(await Bom()).Rows[multiIndex].ReviewState.Reviewed,"return to manufacturer requires re-Accept");await Accept(multiIndex);
            var sub=before.Rows.FirstOrDefault(r=>r.ComponentType=="SUBASSEMBLY");
            if(sub is not null){Check(sub.IdentityBasis=="ASSEMBLY_PN","Subassembly retains separate basis");await Reject(async()=>{await Basis(sub.Index,"CUSTOMER_PN","wrong");},"SIM_IDENTITY_BASIS_TYPE");await Accept(sub.Index);Check((await Bom()).Rows[sub.Index].ReviewState.Reviewed,"Subassembly existing Accept passes");}
            if(id=="RFQI-SIM-0041")
            {
                var index=Array.FindIndex(before.Rows,r=>r.Values["partNumber"]=="H4-150");var old=before.Rows[index];
                var alternates=JsonSerializer.Serialize(old.Alternates,options);var manufacturer=JsonSerializer.Serialize(old.ManufacturerIdentity,options);
                await Reject(async()=>{await Accept(index);},"SIM_MFG_REVIEW_INVALID");
                await Reject(async()=>{await Basis(index,"CUSTOMER_PN"," ");},"SIM_IDENTITY_BASIS_INVALID");
                await Basis(index,"CUSTOMER_PN","H4-150",true);
                var saved=(await Bom()).Rows[index];
                Check(saved.PrimaryIdentity?.PartNumber=="H4-150"&&saved.IdentityBasis=="CUSTOMER_PN"&&!saved.ReviewState.Reviewed,"H4-150 Save Progress persists explicit customer identity; Needs Review");
                await Reject(async()=>{await store.CandidateBomAsync(id,persona,new(before.Id,index,null,IdentityBasisChange:new("MANUFACTURER_PN",null,old.ReviewState.Token)));},"SIM_IDENTITY_BASIS_STALE");
                await Accept(index);saved=(await Bom()).Rows[index];
                Check(saved.ReviewState.Reviewed&&saved.PrimaryIdentity?.Reviewer==persona.DisplayName,"H4-150 accepts and reopens from disk");
                Check(JsonSerializer.Serialize(saved.ManufacturerIdentity,options)==manufacturer&&JsonSerializer.Serialize(saved.Alternates,options)==alternates,"no manufacturer impersonation or alternate crossover");
                foreach(var pn in new[]{"H4-116","H2-224","F2-134","N4-243"}){var r=(await Bom()).Rows.Single(r=>r.Values["partNumber"]==pn);Check(r.PrimaryIdentity is null&&r.ManufacturerIdentity?.Proposals.Length==0,pn+" remains unclassified");}
                var pending=saved with {Alternates=[new("pending",null,"ALT","MANUAL","NEEDS_REVIEW","",null,null,null,null,[])]};
                Check(!pending.ReviewState.Reviewed,"pending alternate still blocks even with customer identity");
                var invalid=saved with {Values=new(saved.Values){["quantity"]="0"}};Check(!invalid.ReviewState.Reviewed,"invalid quantity gate preserved");
                var changed=saved with {Values=new(saved.Values){["partNumber"]="CHANGED"}};Check(!changed.ReviewState.Reviewed,"changed BOM P/N invalidates customer identity");
                await Basis(index,"CUSTOMER_PN","H4-150-EDIT");Check(!(await Bom()).Rows[index].ReviewState.Reviewed,"customer P/N edit reopens row");await Basis(index,"CUSTOMER_PN","H4-150");await Accept(index);
                var after=(await Read()).TechnicalReview!;var originalReview=record.TechnicalReview!;
                Check(after.MaterialResponsibility==originalReview.MaterialResponsibility&&JsonSerializer.Serialize(after.CustomerSuppliedItems,options)==JsonSerializer.Serialize(originalReview.CustomerSuppliedItems,options),"no supply responsibility inference");
                Check(!JsonSerializer.SerializeToElement(await store.BomCompletionReadiness(id,new(await Bom())),options).GetProperty("ready").GetBoolean(),"other unresolved rows still block completion");
                // Complete only a disposable fixture; explicit dummy identities resolve unrelated test rows.
                for(int i=0;i<before.Rows.Length;i++){var b=await Bom();var r=b.Rows[i];if(r.ReviewState.Reviewed)continue;var v=Values(r);if(!int.TryParse(v["lineNumber"],out var line)||line<1)v["lineNumber"]=(i+1).ToString();if(!decimal.TryParse(v["quantity"],out var qty)||qty<=0)v["quantity"]="1";await store.CandidateBomAsync(id,persona,new(b.Id,i,v,WorksheetAcceptance:new(r.ReviewState.Token,r.ComponentType,r.AssemblyIdentity?.PartNumber??"TEST-ASSEMBLY",ManualPartNumber:r.ManufacturerIdentity?.Proposals.Any(p=>!string.IsNullOrWhiteSpace(p.PartNumber))==true?null:"TEST-PART-"+i)));}
                var ready=await Bom();await store.CompleteBomReview(id,new(ready),persona);
                var accepted=(await Read()).TechnicalReview!.BomAcceptances!.Last().Candidate.Rows[index];
                Check(accepted.IdentityBasis=="CUSTOMER_PN"&&accepted.PrimaryIdentity?.PartNumber=="H4-150"&&accepted.ReviewState.Reviewed,"Accepted BOM immutable snapshot preserves customer basis and P/N");
                await File.WriteAllTextAsync(Path.Combine(root,"accepted-fixture.json"),JsonSerializer.Serialize(await Read(),options));
            }
            Console.WriteLine("CUSTOMER_IDENTITY_FIXTURE="+root);
        }
        Check(original.SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(repository,".sim-state/data/rfq-intakes.json"))),"normal SIM dataset unchanged");
    }
}
