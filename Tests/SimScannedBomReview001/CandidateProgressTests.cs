using System.Text.Json;
using System.Text.Json.Nodes;

internal static class CandidateProgressTests
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
            var root=Path.Combine(Path.GetTempPath(),"dle-candidate-progress-"+Guid.NewGuid().ToString("N"));
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
            await Accept(0);await Accept(1);
            var before=(await Read()).TechnicalReview!.CandidateBom!;
            var row=before.Rows[2];var values=Values(row);values["description"]="Saved working description — not accepted";values["designators"]="R101, R102";
            var edit=new SimCandidateProgressRow(2,row.ReviewState.Token,values,row.ComponentType);
            await store.CandidateBomAsync(id,persona,new(before.Id,-1,null,ProgressRows:[edit]));
            var saved=await Read();var after=saved.TechnicalReview!.CandidateBom!;
            Check(after.Id==before.Id&&after.Rows.Length==before.Rows.Length,id+" save/reopen retains Candidate id/count without rebuild");
            Check(after.Rows[0].ReviewState.Reviewed&&after.Rows[1].ReviewState.Reviewed,id+" accepted rows remain accepted");
            Check(after.Rows[2].Values["description"]==values["description"]&&!after.Rows[2].ReviewState.Reviewed&&after.Rows[2].WorkingState is not null,id+" saved Description resumes as Needs Review");
            Check(after.Rows[2].Values["designators"]=="R101, R102"&&!after.Rows[2].ReviewState.Reviewed,id+" saved Ref Des resumes without acceptance");
            Check(after.Rows[2].Extracted["description"]==row.Extracted["description"],id+" Customer Description unchanged");
            Check(after.Progress?.SavedBy==persona.DisplayName&&after.Progress.SavedAtUtc!=default,id+" server save feedback persisted");
            Check((saved.TechnicalReview.BomAcceptances?.Length??0)==0&&saved.Status=="TECHNICAL_REVIEW_IN_PROGRESS",id+" Save Progress does not complete Candidate");
            for(var i=3;i<after.Rows.Length;i++)Check(JsonSerializer.Serialize(after.Rows[i],options)==JsonSerializer.Serialize(before.Rows[i],options),id+" untouched row "+i);
            try{await store.CompleteBomReview(id,new(after),persona);throw new Exception("Completion unexpectedly passed");}catch(SimRfqIntakeProblem e){Check(e.Code=="SIM_BOM_UNRESOLVED",id+" existing completion gates hold");}
            var readiness=JsonSerializer.SerializeToElement(await store.BomCompletionReadiness(id,new(after)),options);
            Check(!readiness.GetProperty("ready").GetBoolean(),id+" readiness uses unresolved backend gate");
            var bytes=await File.ReadAllBytesAsync(dataPath);
            var another=after.Rows[4];var changes=Values(another);changes["description"]="Must not partially save";
            try{await store.CandidateBomAsync(id,persona,new(after.Id,-1,null,ProgressRows:[new(4,another.ReviewState.Token,changes,another.ComponentType),edit]));throw new Exception("Stale save passed");}
            catch(SimRfqIntakeProblem e){Check(e.Code=="SIM_PROGRESS_STALE"&&(await File.ReadAllBytesAsync(dataPath)).SequenceEqual(bytes),id+" stale multi-row save is atomic");}
            await Accept(2);after=(await Read()).TechnicalReview!.CandidateBom!;
            Check(after.Rows[2].WorkingState is null&&after.Rows[2].ReviewState.Reviewed,id+" saved working row accepts normally and locks");
            Check(after.Rows[2].ManufacturerIdentity!.Proposals.Any(p=>after.Rows[2].ManufacturerIdentity!.Decision(p.Id)=="CONFIRMED"),id+" identity reaffirmation retained after progress save");
            // Other existing editable inputs use the same working Candidate, never an approved identity draft.
            var sub=after.Rows[3];
            await store.CandidateBomAsync(id,persona,new(after.Id,-1,null,ProgressRows:[new(3,sub.ReviewState.Token,Values(sub),"SUBASSEMBLY",AssemblyPartNumber:"SAVED-ASSEMBLY")]));
            after=(await Read()).TechnicalReview!.CandidateBom!;
            Check(after.Rows[3].ComponentType=="SUBASSEMBLY"&&after.Rows[3].WorkingState?.AssemblyPartNumber=="SAVED-ASSEMBLY"&&!after.Rows[3].ReviewState.Reviewed,id+" type/assembly input resumes without granting acceptance");
            await Accept(3);after=(await Read()).TechnicalReview!.CandidateBom!;
            Check(after.Rows[3].AssemblyIdentity?.PartNumber=="SAVED-ASSEMBLY"&&after.Rows[3].ReviewState.Reviewed,id+" resumed Subassembly accepts through existing rules");
            var manual=after.Rows[4];
            await store.CandidateBomAsync(id,persona,new(after.Id,-1,null,ProgressRows:[new(4,manual.ReviewState.Token,Values(manual),"STANDARD_COTS",ManualPartNumber:"SAVED-MANUAL",ManufacturerName:"Saved maker")]));
            after=(await Read()).TechnicalReview!.CandidateBom!;
            Check(after.Rows[4].WorkingState?.ManualPartNumber=="SAVED-MANUAL"&&!after.Rows[4].ReviewState.Reviewed,id+" manual identity input is saved but unapproved");
            await Accept(4);
            var accepted=(await Read()).TechnicalReview!.CandidateBom!;
            Check(accepted.Rows[4].ReviewState.Reviewed&&accepted.Rows[4].ManufacturerIdentity!.Proposals.Any(p=>p.PartNumber=="SAVED-MANUAL"),id+" saved manual identity accepts normally");
            await store.CandidateBomAsync(id,persona,new(accepted.Id,-1,null,ProgressRows:[]));
            Check(JsonSerializer.Serialize((await Read()).TechnicalReview!.CandidateBom!.Rows,options)==JsonSerializer.Serialize(accepted.Rows,options),id+" clean Save Progress changes no rows");
            // Resolve remaining rows explicitly through the existing acceptance contract in this disposable scenario.
            for(var i=0;i<accepted.Rows.Length;i++) {
                var current=(await Read()).TechnicalReview!.CandidateBom!;var pending=current.Rows[i];if(pending.ReviewState.Reviewed)continue;
                var reviewedValues=Values(pending);if(!int.TryParse(reviewedValues["lineNumber"],out var line)||line<1)reviewedValues["lineNumber"]=(i+1).ToString();if(!decimal.TryParse(reviewedValues["quantity"],out var qty)||qty<=0)reviewedValues["quantity"]="1";if(string.IsNullOrWhiteSpace(reviewedValues["description"])||reviewedValues["description"]=="-")reviewedValues["description"]="Reviewed qualification description";
                var manualNumber=pending.ManufacturerIdentity?.Proposals.Any(p=>!string.IsNullOrWhiteSpace(p.PartNumber))==true?null:"QUALIFICATION-PART-"+i;
                await store.CandidateBomAsync(id,persona,new(current.Id,i,reviewedValues,WorksheetAcceptance:new(pending.ReviewState.Token,pending.ComponentType,pending.AssemblyIdentity?.PartNumber??"QUALIFICATION-ASSEMBLY",ManualPartNumber:manualNumber)));
            }
            var ready=(await Read()).TechnicalReview!.CandidateBom!;
            var readinessBytes=await File.ReadAllBytesAsync(dataPath);
            Check(JsonSerializer.SerializeToElement(await store.BomCompletionReadiness(id,new(ready)),options).GetProperty("ready").GetBoolean(),id+" all accepted passes shared readiness gate");
            Check(readinessBytes.SequenceEqual(await File.ReadAllBytesAsync(dataPath)),id+" readiness is read-only");
            Check(!JsonSerializer.SerializeToElement(await store.BomCompletionReadiness(id,new(before)),options).GetProperty("ready").GetBoolean(),id+" stale snapshot blocks readiness");
            await store.CompleteBomReview(id,new(ready),persona);
            Check((await Read()).TechnicalReview!.BomAcceptances!.Last().Candidate.Rows[2].Values["designators"]=="R101, R102",id+" final completion retains reviewed Ref Des");
            Console.WriteLine("DISPOSABLE_PROGRESS_STATE="+root);
        }
        Check(original.SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(repository,".sim-state/data/rfq-intakes.json"))),"normal SIM dataset unchanged");
    }
}
